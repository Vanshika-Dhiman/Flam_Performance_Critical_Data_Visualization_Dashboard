import { mean, percentile, readHeapMB, supportsEntryType } from './performanceUtils';
import type { DashboardCore } from '@/components/providers/DataProvider';
import type { StreamSettings } from './types';

export interface BenchmarkScenario {
  label: string;
  windowSize: number;
  pointsPerTick: number;
  durationMs: number;
}

export const BENCHMARK_SCENARIOS: readonly BenchmarkScenario[] = [
  { label: '10k points · 100 pts/s', windowSize: 10_000, pointsPerTick: 10, durationMs: 8000 },
  { label: '10k points · 2.5k pts/s', windowSize: 10_000, pointsPerTick: 250, durationMs: 8000 },
  { label: '50k points · 10k pts/s', windowSize: 50_000, pointsPerTick: 1000, durationMs: 8000 },
  { label: '100k points · 10k pts/s', windowSize: 100_000, pointsPerTick: 1000, durationMs: 8000 },
  { label: '250k points · 25k pts/s', windowSize: 250_000, pointsPerTick: 2500, durationMs: 8000 },
];

export interface BenchmarkResult {
  label: string;
  windowSize: number;
  pointsPerTick: number;
  frames: number;
  avgFps: number;
  /** FPS equivalent of the 99th percentile frame interval ("1% low"). */
  p1LowFps: number;
  p99FrameMs: number;
  maxFrameMs: number;
  droppedFrames: number;
  avgRenderMs: number;
  p95RenderMs: number;
  avgAggregateMs: number;
  longTasks: number | null;
  heapStartMB: number | null;
  heapEndMB: number | null;
  pointsInBuffer: number;
}

export interface BenchmarkProgress {
  index: number;
  total: number;
  label: string;
  phase: 'preparing' | 'warming up' | 'measuring';
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(id);
        reject(new DOMException('Benchmark cancelled', 'AbortError'));
      },
      { once: true },
    );
  });
}

async function waitUntil(predicate: () => boolean, timeoutMs: number, signal: AbortSignal): Promise<void> {
  const started = performance.now();
  while (!predicate() && performance.now() - started < timeoutMs) {
    await delay(100, signal);
  }
}

/**
 * Scripted benchmark: for each scenario, apply the load, wait for the buffer to fill
 * (backfill), warm up, then record every frame interval, the main-thread render cost of
 * every frame, worker aggregation times and long tasks.
 */
export async function runBenchmark(options: {
  core: DashboardCore;
  applyStream: (stream: StreamSettings) => void;
  onProgress: (progress: BenchmarkProgress) => void;
  signal: AbortSignal;
  scenarios?: readonly BenchmarkScenario[];
}): Promise<BenchmarkResult[]> {
  const { core, applyStream, onProgress, signal, scenarios = BENCHMARK_SCENARIOS } = options;
  const results: BenchmarkResult[] = [];

  for (let index = 0; index < scenarios.length; index++) {
    const scenario = scenarios[index];
    const total = scenarios.length;
    onProgress({ index, total, label: scenario.label, phase: 'preparing' });
    applyStream({ streaming: true, pointsPerTick: scenario.pointsPerTick, windowSize: scenario.windowSize });
    await waitUntil(
      () => core.store.capacity === scenario.windowSize && core.store.size >= scenario.windowSize * 0.95,
      20_000,
      signal,
    );
    onProgress({ index, total, label: scenario.label, phase: 'warming up' });
    await delay(1500, signal);

    onProgress({ index, total, label: scenario.label, phase: 'measuring' });
    const intervals: number[] = [];
    const renderCosts: number[] = [];
    const aggregateTimes: number[] = [];
    let lastFrame = 0;
    let longTasks = 0;

    const removeTask = core.loop.add({
      priority: 1000,
      render(frame) {
        if (lastFrame) {
          intervals.push(frame.now - lastFrame);
          renderCosts.push(core.loop.lastFrameCost);
        }
        lastFrame = frame.now;
      },
    });
    const unsubscribe = core.engine.subscribe(() => {
      if (core.engine.latest) aggregateTimes.push(core.engine.latest.computeMs);
    });
    let observer: PerformanceObserver | null = null;
    if (supportsEntryType('longtask')) {
      observer = new PerformanceObserver((list) => {
        longTasks += list.getEntries().length;
      });
      observer.observe({ type: 'longtask' });
    }
    const heapStartMB = readHeapMB();

    try {
      await delay(scenario.durationMs, signal);
    } finally {
      removeTask();
      unsubscribe();
      observer?.disconnect();
    }

    const sorted = [...intervals].sort((a, b) => a - b);
    const sortedCosts = [...renderCosts].sort((a, b) => a - b);
    const median = percentile(sorted, 50);
    let dropped = 0;
    for (const interval of intervals) dropped += Math.max(0, Math.round(interval / median) - 1);
    const p99 = percentile(sorted, 99);

    results.push({
      label: scenario.label,
      windowSize: scenario.windowSize,
      pointsPerTick: scenario.pointsPerTick,
      frames: intervals.length,
      avgFps: 1000 / mean(intervals),
      p1LowFps: 1000 / p99,
      p99FrameMs: p99,
      maxFrameMs: sorted[sorted.length - 1] ?? Number.NaN,
      droppedFrames: dropped,
      avgRenderMs: mean(renderCosts),
      p95RenderMs: percentile(sortedCosts, 95),
      avgAggregateMs: mean(aggregateTimes),
      longTasks: observer ? longTasks : null,
      heapStartMB,
      heapEndMB: readHeapMB(),
      pointsInBuffer: core.store.size,
    });
  }
  return results;
}
