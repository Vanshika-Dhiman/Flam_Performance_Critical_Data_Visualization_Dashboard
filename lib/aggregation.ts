import type { AggregationParams, AggregationResult, CategoryStats, ColumnsView } from './types';

/**
 * Pure aggregation over a contiguous snapshot of the buffer. Runs inside the Web Worker
 * (and on the main thread only as a fallback). One O(n) pass produces:
 *   - stacked request sums per time bucket   -> BarChart
 *   - latency histogram per time bucket      -> Heatmap (counts + ready-to-blit RGBA)
 *   - per-region summary stats for the view  -> KPI tiles & legend
 *
 * Buckets are aligned to *local* time (IST buckets start at :00, not :30) and cover the
 * whole buffer, so panning and zooming never require re-aggregation; only new data or a
 * filter change does.
 */

export const MAX_BUCKETS = 12_000;
const HIST_MAX_MS = 2000;

export interface BufferAllocator {
  float32(length: number): Float32Array;
  uint32(length: number): Uint32Array;
  uint8Clamped(length: number): Uint8ClampedArray;
}

export const heapAllocator: BufferAllocator = {
  float32: (n) => new Float32Array(n),
  uint32: (n) => new Uint32Array(n),
  uint8Clamped: (n) => new Uint8ClampedArray(n),
};

/**
 * Recycles ArrayBuffers that the main thread transfers back once a result is replaced,
 * so steady-state aggregation allocates nothing.
 */
export function createBufferPool(maxBuffers = 12): BufferAllocator & { release(buffer: ArrayBuffer): void } {
  const free: ArrayBuffer[] = [];
  const take = (bytes: number): ArrayBuffer => {
    for (let i = 0; i < free.length; i++) {
      const b = free[i];
      if (b.byteLength >= bytes && b.byteLength <= bytes * 2) {
        free.splice(i, 1);
        return b;
      }
    }
    return new ArrayBuffer(bytes);
  };
  return {
    float32: (n) => new Float32Array(take(n * 4), 0, n).fill(0),
    uint32: (n) => new Uint32Array(take(n * 4), 0, n).fill(0),
    uint8Clamped: (n) => new Uint8ClampedArray(take(n), 0, n).fill(0),
    release(buffer) {
      if (buffer.byteLength === 0) return;
      free.push(buffer);
      if (free.length > maxBuffers) free.shift();
    },
  };
}

export interface WorkerAggregateRequest {
  type: 'aggregate';
  id: number;
  columns: ColumnsView;
  params: AggregationParams;
  recycle: ArrayBuffer[];
}

export type WorkerResponse =
  | { type: 'result'; id: number; result: AggregationResult; columns: ColumnsView }
  | { type: 'error'; id: number; message: string; columns: ColumnsView };

let histogram = new Uint32Array(0);

function emptyStats(): CategoryStats {
  return { count: 0, mean: Number.NaN, p95: Number.NaN, min: Number.NaN, max: Number.NaN, last: Number.NaN };
}

function p95FromHistogram(hist: Uint32Array, offset: number, count: number): number {
  if (count === 0) return Number.NaN;
  const target = Math.ceil(count * 0.95);
  let cumulative = 0;
  for (let b = 0; b <= HIST_MAX_MS; b++) {
    cumulative += hist[offset + b];
    if (cumulative >= target) return b + 0.5;
  }
  return HIST_MAX_MS;
}

export function aggregate(
  cols: ColumnsView,
  params: AggregationParams,
  requestId: number,
  alloc: BufferAllocator = heapAllocator,
): AggregationResult {
  const started = performance.now();
  const n = cols.length;
  const C = params.categoryCount;
  const bins = params.heatBins;
  const { bucketMs, tzOffsetMs, categoryMask, valueMin, valueMax, statsStart, statsEnd, sloMs, heatLut } = params;
  const { timestamps, values, requests, categories } = cols;

  const firstTs = n > 0 ? timestamps[0] : 0;
  const lastTs = n > 0 ? timestamps[n - 1] : 0;
  const lastBucket = Math.floor((lastTs + tzOffsetMs) / bucketMs);
  let firstBucket = Math.floor((firstTs + tzOffsetMs) / bucketMs);
  if (lastBucket - firstBucket + 1 > MAX_BUCKETS) firstBucket = lastBucket - MAX_BUCKETS + 1;
  const bucketCount = n > 0 ? lastBucket - firstBucket + 1 : 0;
  const bucketCapacity = Math.max(256, Math.ceil(bucketCount / 256) * 256);
  const bucketStart = firstBucket * bucketMs - tzOffsetMs;

  const requestSums = alloc.float32(bucketCapacity * C);
  const heatCounts = alloc.uint32(bucketCapacity * bins);

  const histSize = (C + 1) * (HIST_MAX_MS + 1);
  if (histogram.length !== histSize) histogram = new Uint32Array(histSize);
  else histogram.fill(0);

  const counts = new Float64Array(C);
  const sums = new Float64Array(C);
  const mins = new Float64Array(C).fill(Number.POSITIVE_INFINITY);
  const maxs = new Float64Array(C).fill(Number.NEGATIVE_INFINITY);
  const lasts = new Float64Array(C).fill(Number.NaN);
  let totalRequests = 0;
  let overSlo = 0;

  const heatMin = params.heatMin;
  const binScale = bins / Math.max(1, params.heatMax - heatMin);

  for (let i = 0; i < n; i++) {
    const c = categories[i];
    const v = values[i];
    if (((categoryMask >> c) & 1) === 0 || v < valueMin || v > valueMax) continue;
    const ts = timestamps[i];
    const b = Math.floor((ts + tzOffsetMs) / bucketMs) - firstBucket;
    if (b < 0) continue;
    const req = requests[i];
    requestSums[b * C + c] += req;

    let bin = Math.floor((v - heatMin) * binScale);
    if (bin < 0) bin = 0;
    else if (bin >= bins) bin = bins - 1;
    heatCounts[b * bins + bin]++;

    if (ts >= statsStart && ts <= statsEnd) {
      counts[c]++;
      sums[c] += v;
      if (v < mins[c]) mins[c] = v;
      if (v > maxs[c]) maxs[c] = v;
      lasts[c] = v;
      const h = v >= HIST_MAX_MS ? HIST_MAX_MS : v | 0;
      histogram[c * (HIST_MAX_MS + 1) + h]++;
      histogram[C * (HIST_MAX_MS + 1) + h]++;
      totalRequests += req;
      if (v > sloMs) overSlo++;
    }
  }

  // Heatmap pixels: log colour scale so rare spikes stay visible next to dense bands.
  let heatMaxCount = 0;
  const used = bucketCount * bins;
  for (let i = 0; i < used; i++) if (heatCounts[i] > heatMaxCount) heatMaxCount = heatCounts[i];
  const heatPixels = alloc.uint8Clamped(bucketCapacity * bins * 4);
  if (heatMaxCount > 0) {
    const logMax = Math.log1p(heatMaxCount);
    for (let b = 0; b < bucketCount; b++) {
      const base = b * bins;
      for (let bin = 0; bin < bins; bin++) {
        const count = heatCounts[base + bin];
        if (count === 0) continue;
        const t = Math.log1p(count) / logMax;
        const li = Math.min(255, Math.floor(t * 255)) * 4;
        const px = ((bins - 1 - bin) * bucketCapacity + b) * 4;
        heatPixels[px] = heatLut[li];
        heatPixels[px + 1] = heatLut[li + 1];
        heatPixels[px + 2] = heatLut[li + 2];
        heatPixels[px + 3] = 255;
      }
    }
  }

  const stats: CategoryStats[] = [];
  let totalCount = 0;
  let totalSum = 0;
  let totalMin = Number.POSITIVE_INFINITY;
  let totalMax = Number.NEGATIVE_INFINITY;
  for (let c = 0; c < C; c++) {
    if (counts[c] === 0) {
      stats.push(emptyStats());
      continue;
    }
    stats.push({
      count: counts[c],
      mean: sums[c] / counts[c],
      p95: p95FromHistogram(histogram, c * (HIST_MAX_MS + 1), counts[c]),
      min: mins[c],
      max: maxs[c],
      last: lasts[c],
    });
    totalCount += counts[c];
    totalSum += sums[c];
    totalMin = Math.min(totalMin, mins[c]);
    totalMax = Math.max(totalMax, maxs[c]);
  }

  return {
    requestId,
    bucketMs,
    bucketStart,
    bucketCount,
    bucketCapacity,
    categoryCount: C,
    requestSums,
    heatCounts,
    heatMaxCount,
    heatBins: bins,
    heatMin,
    heatMax: params.heatMax,
    heatPixels,
    stats,
    total: {
      count: totalCount,
      mean: totalCount ? totalSum / totalCount : Number.NaN,
      p95: p95FromHistogram(histogram, C * (HIST_MAX_MS + 1), totalCount),
      min: totalCount ? totalMin : Number.NaN,
      max: totalCount ? totalMax : Number.NaN,
      last: Number.NaN,
      requests: totalRequests,
      overSlo,
      spanMs: Math.max(0, Math.min(statsEnd, lastTs) - Math.max(statsStart, firstTs)),
    },
    lastTimestamp: lastTs,
    computeMs: performance.now() - started,
  };
}

export function resultBuffers(result: AggregationResult): ArrayBuffer[] {
  return [result.requestSums.buffer, result.heatCounts.buffer, result.heatPixels.buffer] as ArrayBuffer[];
}

export function columnBuffers(cols: ColumnsView): ArrayBuffer[] {
  return [cols.timestamps.buffer, cols.values.buffer, cols.requests.buffer, cols.categories.buffer] as ArrayBuffer[];
}
