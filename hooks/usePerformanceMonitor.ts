'use client';

import { useEffect, useState } from 'react';
import { RollingSeries, readHeapMB, supportsEntryType } from '@/lib/performanceUtils';
import type { PerformanceMetrics } from '@/lib/types';
import { useDashboardCore } from '@/components/providers/DataProvider';

const INITIAL: PerformanceMetrics = {
  fps: 0,
  frameTime: 0,
  worstFrame: 0,
  memoryUsage: null,
  memoryTrend: null,
  renderTime: 0,
  dataProcessingTime: 0,
  roundTripTime: 0,
  snapshotTime: 0,
  longTasks: null,
  inputLatency: null,
  reactCommits: null,
  pointCount: 0,
  ingestRate: 0,
  workerMode: 'starting',
};

const HEAP_SAMPLE_MS = 5000;
const MIN_TREND_SAMPLES = 24; // two minutes: shorter windows mostly measure GC sawtooth

/**
 * Samples the render loop, heap and PerformanceObservers twice a second and publishes a
 * single metrics object. Only the component using this hook re-renders.
 *
 * - FPS / frame time: from the shared rAF loop's frame history.
 * - Memory: performance.memory (Chromium). Trend = least-squares slope over the session.
 * - Long tasks: PerformanceObserver('longtask') — any main-thread block > 50 ms.
 * - Aggregation round trip: PerformanceObserver('measure') on the engine's User Timing.
 */
export function usePerformanceMonitor(intervalMs = 500): PerformanceMetrics & { heapHistory: RollingSeries | null; fpsHistory: RollingSeries | null } {
  const core = useDashboardCore();
  const [metrics, setMetrics] = useState<PerformanceMetrics>(INITIAL);
  const [histories] = useState(() => ({ heap: new RollingSeries(720), fps: new RollingSeries(120) }));

  useEffect(() => {
    const longTasks = new RollingSeries(256);
    let roundTrip = 0;
    const observers: PerformanceObserver[] = [];

    if (supportsEntryType('longtask')) {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push(entry.startTime, entry.duration);
      });
      observer.observe({ type: 'longtask' });
      observers.push(observer);
    }
    if (supportsEntryType('measure')) {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === 'dashboard:aggregate-roundtrip') roundTrip = entry.duration;
        }
      });
      observer.observe({ type: 'measure' });
      observers.push(observer);
    }

    let lastHeapSample = -Infinity;
    const id = window.setInterval(() => {
      const now = performance.now();
      const frame = core.loop.stats(now);
      const heap = readHeapMB();
      if (heap !== null && now - lastHeapSample >= HEAP_SAMPLE_MS) {
        histories.heap.push(now, heap);
        lastHeapSample = now;
      }
      histories.fps.push(now, frame.fps);

      let recentLongTasks = 0;
      for (let i = 0; i < longTasks.size; i++) if (now - longTasks.timeAt(i) <= 10_000) recentLongTasks++;

      const latest = core.engine.latest;
      setMetrics({
        fps: frame.fps,
        frameTime: frame.frameTime,
        worstFrame: frame.worstFrame,
        memoryUsage: heap,
        memoryTrend: histories.heap.size >= MIN_TREND_SAMPLES ? histories.heap.slopePerMinute() : null,
        renderTime: frame.renderCost,
        dataProcessingTime: latest?.computeMs ?? 0,
        roundTripTime: roundTrip,
        snapshotTime: core.engine.snapshotMs,
        longTasks: supportsEntryType('longtask') ? recentLongTasks : null,
        inputLatency: core.loop.interactions.worstRecent(now),
        reactCommits: core.commits.rate(),
        pointCount: core.store.size,
        ingestRate: core.ingest.rate(now),
        workerMode: core.engine.mode,
      });
    }, intervalMs);

    return () => {
      window.clearInterval(id);
      observers.forEach((o) => o.disconnect());
    };
  }, [core, intervalMs, histories]);

  return { ...metrics, heapHistory: histories.heap, fpsHistory: histories.fps };
}
