import {
  AGGREGATION_OPTIONS,
  CATEGORIES,
  CHART_CONFIGS,
  LOAD_OPTIONS,
  SAMPLE_INTERVAL_MS,
  SLO_MS,
  TICK_MS,
  TIME_RANGE_OPTIONS,
  WINDOW_OPTIONS,
} from '@/lib/chartConfig';

/**
 * GET /api/config — static chart configuration, generated once at build time
 * (force-static) and served as a plain file from the CDN.
 */
export const dynamic = 'force-static';

export function GET(): Response {
  return Response.json({
    builtAt: new Date().toISOString(),
    sampleIntervalMs: SAMPLE_INTERVAL_MS,
    tickMs: TICK_MS,
    sloMs: SLO_MS,
    categories: CATEGORIES,
    charts: CHART_CONFIGS,
    aggregation: AGGREGATION_OPTIONS,
    timeRanges: TIME_RANGE_OPTIONS.map((o) => ({ ...o, ms: Number.isFinite(o.ms) ? o.ms : null })),
    loadOptions: LOAD_OPTIONS,
    windowOptions: WINDOW_OPTIONS,
  });
}
