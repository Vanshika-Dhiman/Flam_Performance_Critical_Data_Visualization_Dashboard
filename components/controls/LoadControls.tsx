'use client';

import { memo, useTransition } from 'react';
import { LOAD_OPTIONS, WINDOW_OPTIONS } from '@/lib/chartConfig';
import { formatCompact, formatInt } from '@/lib/format';
import { useBackfillStatus, useControls, useControlsDispatch } from '@/components/providers/DataProvider';
import BenchmarkPanel from '@/components/ui/BenchmarkPanel';

/** Data generation controls: pause/resume, load, buffer window, stress test, benchmark. */
function LoadControls() {
  const { stream, stressMode } = useControls();
  const dispatch = useControlsDispatch();
  const backfill = useBackfillStatus();
  const [isPending, startTransition] = useTransition();

  return (
    <section className="card load-controls" aria-labelledby="load-title">
      <header className="card-header">
        <div className="card-titles">
          <h2 id="load-title">Data stream</h2>
          <p className="card-subtitle">Simulated feed · a batch every 100 ms · 5 regions</p>
        </div>
        <button
          type="button"
          className={`btn ${stream.streaming ? '' : 'btn-primary'}`}
          aria-pressed={!stream.streaming}
          onClick={() => dispatch({ type: 'setStreaming', streaming: !stream.streaming })}
        >
          {stream.streaming ? 'Pause stream' : 'Resume stream'}
        </button>
      </header>

      <div className="control-grid">
        <label className="field">
          <span className="field-label">Samples per batch</span>
          <select
            value={stream.pointsPerTick}
            onChange={(e) => dispatch({ type: 'setPointsPerTick', value: Number(e.target.value) })}
          >
            {LOAD_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {formatInt(value)} · {formatCompact(value * 10)} pts/s
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">Points in buffer</span>
          <select
            value={stream.windowSize}
            onChange={(e) => startTransition(() => dispatch({ type: 'setWindowSize', value: Number(e.target.value) }))}
          >
            {WINDOW_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {formatInt(value)} points
              </option>
            ))}
          </select>
        </label>

        <div className="field">
          <span className="field-label">Stress test</span>
          <button
            type="button"
            className={`btn ${stressMode ? 'btn-danger' : ''}`}
            aria-pressed={stressMode}
            onClick={() => startTransition(() => dispatch({ type: 'setStressMode', enabled: !stressMode }))}
          >
            {stressMode ? 'Stop stress test' : '100k pts · 10k/s'}
          </button>
        </div>
      </div>

      {backfill.state !== 'idle' || isPending ? (
        <p className={`notice notice-${backfill.state === 'error' ? 'error' : 'info'}`} role="status">
          {backfill.message ?? 'Applying…'}
        </p>
      ) : null}

      <BenchmarkPanel />
    </section>
  );
}

export default memo(LoadControls);
