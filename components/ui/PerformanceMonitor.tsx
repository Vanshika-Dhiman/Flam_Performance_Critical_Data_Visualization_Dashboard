'use client';

import { memo, useEffect, useRef } from 'react';
import { currentDpr } from '@/lib/canvasUtils';
import { formatCompact, formatInt } from '@/lib/format';
import type { RollingSeries } from '@/lib/performanceUtils';
import { usePerformanceMonitor } from '@/hooks/usePerformanceMonitor';
import { useTheme } from '@/components/providers/ThemeProvider';

function fpsStatus(fps: number): 'ok' | 'warning' | 'critical' {
  if (fps >= 55) return 'ok';
  if (fps >= 30) return 'warning';
  return 'critical';
}

function ms(value: number | null, digits = 1): string {
  return value === null || !Number.isFinite(value) ? '—' : `${value.toFixed(digits)} ms`;
}

function Sparkline({ series, version }: { series: RollingSeries | null; version: unknown }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !series) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = currentDpr();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const max = 70;
    const y = (v: number) => h - 2 - (Math.min(max, v) / max) * (h - 4);
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y(60)) + 0.5);
    ctx.lineTo(w, Math.round(y(60)) + 0.5);
    ctx.stroke();
    if (series.size < 2) return;
    ctx.beginPath();
    const step = w / (series.capacity - 1);
    const offset = series.capacity - series.size;
    for (let i = 0; i < series.size; i++) {
      const x = (offset + i) * step;
      if (i === 0) ctx.moveTo(x, y(series.valueAt(i)));
      else ctx.lineTo(x, y(series.valueAt(i)));
    }
    ctx.strokeStyle = theme.series[0];
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [series, version, theme]);

  return <canvas ref={canvasRef} className="sparkline" aria-hidden="true" />;
}

/**
 * Live performance HUD. Updates at 2 Hz from usePerformanceMonitor; it is the only
 * component that re-renders for these numbers.
 */
function PerformanceMonitor() {
  const m = usePerformanceMonitor(500);
  const status = fpsStatus(m.fps);
  const trend = m.memoryTrend;

  return (
    <section className="card perf-monitor" aria-labelledby="perf-title">
      <header className="card-header">
        <div className="card-titles">
          <h2 id="perf-title">Performance</h2>
          <p className="card-subtitle">Sampled from the render loop, heap and PerformanceObserver</p>
        </div>
        <span className={`badge badge-${m.workerMode === 'worker' ? 'ok' : m.workerMode === 'starting' ? 'muted' : 'warning'}`}>
          {m.workerMode === 'worker' ? 'Web Worker' : m.workerMode === 'starting' ? 'Starting…' : 'Main-thread fallback'}
        </span>
      </header>

      <div className="perf-layout">
        <div className="perf-fps">
          <span className="perf-fps-value" data-testid="fps-value">{m.fps ? Math.round(m.fps) : '—'}</span>
          <span className={`status status-${status}`}>
            <span className="status-icon" aria-hidden="true">{status === 'ok' ? '✓' : status === 'warning' ? '!' : '✕'}</span>
            FPS
          </span>
          <Sparkline series={m.fpsHistory} version={m} />
        </div>

        <dl className="perf-grid">
          <div>
            <dt>Frame time</dt>
            <dd>
              {ms(m.frameTime)} <span className="muted">max {ms(m.worstFrame, 0)}</span>
            </dd>
          </div>
          <div>
            <dt>JS heap</dt>
            <dd data-testid="heap-value">
              {m.memoryUsage === null ? 'n/a' : `${m.memoryUsage.toFixed(1)} MB`}{' '}
              <span className="muted">
                {trend === null ? (m.memoryUsage === null ? 'Chromium only' : 'trend after 2 min') : `${trend >= 0 ? '+' : ''}${trend.toFixed(2)} MB/min`}
              </span>
            </dd>
          </div>
          <div>
            <dt>Canvas draw / frame</dt>
            <dd>{ms(m.renderTime, 2)}</dd>
          </div>
          <div>
            <dt>Aggregation</dt>
            <dd>
              {ms(m.dataProcessingTime, 2)} <span className="muted">round trip {ms(m.roundTripTime, 1)}</span>
            </dd>
          </div>
          <div>
            <dt>Input → frame</dt>
            <dd>{m.inputLatency === null ? 'interact with a chart' : ms(m.inputLatency, 1)}</dd>
          </div>
          <div>
            <dt>Long tasks (10 s)</dt>
            <dd>{m.longTasks === null ? 'n/a' : m.longTasks}</dd>
          </div>
          <div>
            <dt>Points in buffer</dt>
            <dd data-testid="points-value">{formatInt(m.pointCount)}</dd>
          </div>
          <div>
            <dt>Ingest</dt>
            <dd>{formatCompact(m.ingestRate)} pts/s</dd>
          </div>
          <div>
            <dt>React commits</dt>
            <dd>{m.reactCommits === null ? <span className="muted">dev/profile build</span> : `${m.reactCommits.toFixed(0)}/s`}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

export default memo(PerformanceMonitor);
