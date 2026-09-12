import type { NextRequest } from 'next/server';
import { CATEGORIES, CATEGORY_COUNT, INITIAL_POINTS, MAX_WINDOW, SAMPLE_INTERVAL_MS } from '@/lib/chartConfig';
import { generateHistory } from '@/lib/dataGenerator';
import { encodeBinaryHistory } from '@/lib/encoding';
import { latencyStatus } from '@/lib/ringBuffer';
import type { DataPoint } from '@/lib/types';

/**
 * GET /api/data — historical samples, generated at the edge.
 *
 *   points   number of samples (rounded up to whole rows of 5 regions), 1..250000
 *   end      exclusive end timestamp in ms (default: now)
 *   seed     optional PRNG seed (default: derived from `end`)
 *   format   "binary" (compact Uint16 columns, used by the dashboard) | "json" (≤5000 points)
 *
 * Output is a pure function of (points, end, seed), so requests with an explicit `end`
 * are cacheable at the CDN.
 */
export const runtime = 'edge';

const JSON_LIMIT = 5000;

function intParam(value: string | null, fallback: number, min: number, max: number): number {
  const n = value === null ? Number.NaN : Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function GET(request: NextRequest): Response {
  const params = request.nextUrl.searchParams;
  const format = params.get('format') === 'binary' ? 'binary' : 'json';
  const limit = format === 'json' ? JSON_LIMIT : MAX_WINDOW;
  const points = intParam(params.get('points'), INITIAL_POINTS, 1, limit);
  const endParam = Number(params.get('end'));
  const explicitEnd = Number.isFinite(endParam) && endParam > 0;
  const end = explicitEnd ? endParam : Date.now();
  const seedParam = params.get('seed');
  const seed = seedParam !== null && Number.isFinite(Number(seedParam)) ? Number(seedParam) >>> 0 : undefined;

  const started = performance.now();
  const history = generateHistory(points, end, seed);
  const generateMs = performance.now() - started;

  const headers = new Headers({
    'Server-Timing': `generate;dur=${generateMs.toFixed(2)}`,
    'Cache-Control': explicitEnd ? 'public, max-age=3600, s-maxage=86400' : 'no-store',
    'X-Sample-Count': String(history.rows * CATEGORY_COUNT),
  });

  if (format === 'binary') {
    headers.set('Content-Type', 'application/octet-stream');
    return new Response(encodeBinaryHistory(history.startTime, history.rows, history.values, history.requests), { headers });
  }

  const data: DataPoint[] = [];
  let seq = 0;
  for (let r = 0; r < history.rows; r++) {
    const timestamp = history.startTime + r * SAMPLE_INTERVAL_MS;
    for (let c = 0; c < CATEGORY_COUNT; c++, seq++) {
      const value = Math.round(history.values[seq] * 10) / 10;
      data.push({
        timestamp,
        value,
        category: CATEGORIES[c].id,
        metadata: { requests: history.requests[seq], seq, status: latencyStatus(value) },
      });
    }
  }
  headers.set('Content-Type', 'application/json');
  return new Response(
    JSON.stringify({
      meta: { points: data.length, startTime: history.startTime, intervalMs: SAMPLE_INTERVAL_MS, categories: CATEGORIES.map((c) => c.id) },
      data,
    }),
    { headers },
  );
}
