'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { BENCHMARK_SCENARIOS, runBenchmark, type BenchmarkProgress, type BenchmarkResult } from '@/lib/benchmark';
import type { StreamSettings } from '@/lib/types';
import { useControls, useControlsDispatch, useDashboardCore } from '@/components/providers/DataProvider';

declare global {
  interface Window {
    __dashboardBenchmark?: { run: () => Promise<BenchmarkResult[]>; results: BenchmarkResult[] | null };
  }
}

function fmt(value: number | null, digits = 1): string {
  return value === null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

/**
 * In-app benchmark (also exposed as window.__dashboardBenchmark for scripts/benchmark.mjs).
 * Restores the previous stream settings when it finishes or is cancelled.
 */
function BenchmarkPanel() {
  const core = useDashboardCore();
  const dispatch = useControlsDispatch();
  const { stream } = useControls();
  const streamRef = useRef(stream);
  const [progress, setProgress] = useState<BenchmarkProgress | null>(null);
  const [results, setResults] = useState<BenchmarkResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!abortRef.current) streamRef.current = stream;
  }, [stream]);

  const run = useCallback(async (): Promise<BenchmarkResult[]> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const previous: StreamSettings = streamRef.current;
    setError(null);
    setResults(null);
    try {
      const output = await runBenchmark({
        core,
        applyStream: (next) => dispatch({ type: 'applyStream', stream: next }),
        onProgress: setProgress,
        signal: controller.signal,
      });
      setResults(output);
      if (window.__dashboardBenchmark) window.__dashboardBenchmark.results = output;
      return output;
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(e instanceof Error ? e.message : String(e));
      return [];
    } finally {
      dispatch({ type: 'applyStream', stream: previous });
      setProgress(null);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [core, dispatch]);

  useEffect(() => {
    window.__dashboardBenchmark = { run, results: null };
    return () => {
      abortRef.current?.abort();
      delete window.__dashboardBenchmark;
    };
  }, [run]);

  const running = progress !== null;
  const totalSeconds = BENCHMARK_SCENARIOS.reduce((s, sc) => s + sc.durationMs / 1000 + 2, 0);

  return (
    <details className="benchmark">
      <summary>Benchmark</summary>
      <p className="card-subtitle">
        Runs {BENCHMARK_SCENARIOS.length} load scenarios (~{Math.round(totalSeconds)} s) and records every frame. Keep this
        tab in the foreground.
      </p>
      <div className="benchmark-actions">
        {running ? (
          <>
            <button type="button" className="btn btn-danger" onClick={() => abortRef.current?.abort()}>
              Cancel
            </button>
            <span role="status">
              {progress.index + 1}/{progress.total} · {progress.label} · {progress.phase}…
            </span>
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => void run()}>
            Run benchmark
          </button>
        )}
        {results && results.length > 0 ? (
          <button type="button" className="btn btn-ghost" onClick={() => void navigator.clipboard?.writeText(JSON.stringify(results, null, 2))}>
            Copy JSON
          </button>
        ) : null}
      </div>
      {error ? <p className="notice notice-error">{error}</p> : null}
      {results && results.length > 0 ? (
        <div className="table-wrap">
          <table className="benchmark-table">
            <thead>
              <tr>
                <th scope="col">Scenario</th>
                <th scope="col">Avg FPS</th>
                <th scope="col">1% low</th>
                <th scope="col">Dropped</th>
                <th scope="col">Draw ms</th>
                <th scope="col">Worker ms</th>
                <th scope="col">Long tasks</th>
                <th scope="col">Heap MB</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  <td>{fmt(r.avgFps)}</td>
                  <td>{fmt(r.p1LowFps)}</td>
                  <td>
                    {r.droppedFrames}/{r.frames}
                  </td>
                  <td>
                    {fmt(r.avgRenderMs, 2)} <span className="muted">(p95 {fmt(r.p95RenderMs, 2)})</span>
                  </td>
                  <td>{fmt(r.avgAggregateMs, 2)}</td>
                  <td>{r.longTasks ?? '—'}</td>
                  <td>{fmt(r.heapEndMB)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </details>
  );
}

export default memo(BenchmarkPanel);
