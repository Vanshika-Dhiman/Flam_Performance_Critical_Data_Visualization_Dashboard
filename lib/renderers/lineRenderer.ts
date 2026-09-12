import {
  approach,
  beginFrame,
  drawBaseline,
  drawEmptyState,
  drawHorizontalGrid,
  plotRectFor,
  type CanvasSize,
  type PlotMargin,
  type PlotRect,
} from '../canvasUtils';
import { CATEGORY_COUNT } from '../chartConfig';
import type { TimeSeriesStore } from '../ringBuffer';
import { createTickSet, linearTicks, niceMax, smoothing, timeTicks, type TickSet } from '../scales';
import type { ChartTheme } from '../theme';
import type { FilterState } from '../types';

export const LINE_MARGIN: PlotMargin = { top: 14, right: 18, bottom: 28, left: 48 };

/**
 * Line renderer with level-of-detail:
 *   - zoomed in (< 2 samples per device pixel): every sample is a vertex;
 *   - otherwise M4 decimation: per series, per device-pixel column keep first/min/max/last.
 *     The rasterised result is identical to drawing every point, but the path never has
 *     more than 4 vertices per pixel column, so 250k samples draw as fast as 10k.
 */
export interface LineState {
  cols: number;
  first: Float32Array;
  last: Float32Array;
  min: Float32Array;
  max: Float32Array;
  has: Uint8Array;
  segs: Int32Array;
  yMax: number;
  xTicks: TickSet;
  xPos: number[];
  yTicks: number[];
  yPos: number[];
  yLabels: string[];
  plot: PlotRect;
  lod: 'raw' | 'm4';
  verticesDrawn: number;
  /** Last drawn point per series (for live end markers); reused every frame. */
  endX: Float32Array;
  endY: Float32Array;
  started: Uint8Array;
}

export function createLineState(): LineState {
  return {
    cols: 0,
    first: new Float32Array(0),
    last: new Float32Array(0),
    min: new Float32Array(0),
    max: new Float32Array(0),
    has: new Uint8Array(0),
    segs: new Int32Array(4),
    yMax: Number.NaN,
    xTicks: createTickSet(),
    xPos: [],
    yTicks: [],
    yPos: [],
    yLabels: [],
    plot: { x: 0, y: 0, w: 1, h: 1 },
    lod: 'raw',
    verticesDrawn: 0,
    endX: new Float32Array(CATEGORY_COUNT),
    endY: new Float32Array(CATEGORY_COUNT),
    started: new Uint8Array(CATEGORY_COUNT),
  };
}

export interface LineDrawInput {
  ctx: CanvasRenderingContext2D;
  size: CanvasSize;
  store: TimeSeriesStore;
  start: number;
  end: number;
  filters: FilterState;
  theme: ChartTheme;
  dt: number;
  live: boolean;
  tzOffsetMs: number;
}

/** Returns true while the y-domain is still animating (needs another frame). */
export function drawLineChart(state: LineState, input: LineDrawInput): boolean {
  const { ctx, size, store, start, end, filters, theme, dt, live, tzOffsetMs } = input;
  const plot = plotRectFor(size, LINE_MARGIN);
  state.plot = plot;
  beginFrame(ctx, size, theme.surface);

  const C = CATEGORY_COUNT;
  const mask = filters.categoryMask;
  const vmin = filters.valueMin;
  const vmax = filters.valueMax;
  const { timestamps, values, categories } = store;

  if (store.size === 0 || !(end > start)) {
    state.xTicks.values.length = 0;
    state.yTicks.length = 0;
    drawEmptyState(ctx, plot, 'Waiting for data…', theme.textMuted);
    return false;
  }

  const i0 = Math.max(0, store.lowerBound(start) - C);
  const i1 = Math.min(store.size, store.upperBound(end) + C);
  const span = end - start;
  const cols = Math.max(1, Math.round(plot.w * size.dpr));
  const useM4 = (i1 - i0) / C > cols * 0.5;
  state.lod = useM4 ? 'm4' : 'raw';
  const segCount = store.segments(i0, i1, state.segs);
  const segs = state.segs;

  // Pass 1: visible maximum (and M4 buckets).
  let maxV = 0;
  if (useM4) {
    const cells = cols * C;
    if (state.cols !== cols || state.first.length < cells) {
      state.cols = cols;
      state.first = new Float32Array(cells);
      state.last = new Float32Array(cells);
      state.min = new Float32Array(cells);
      state.max = new Float32Array(cells);
      state.has = new Uint8Array(cells);
    } else {
      state.has.fill(0, 0, cells);
    }
    const { first, last, min, max, has } = state;
    const colScale = cols / span;
    for (let s = 0; s < segCount; s++) {
      const a = segs[s * 2];
      const b = segs[s * 2 + 1];
      for (let p = a; p < b; p++) {
        const c = categories[p];
        if (((mask >> c) & 1) === 0) continue;
        const v = values[p];
        if (v < vmin || v > vmax) continue;
        const t = timestamps[p];
        if (t < start || t > end) continue;
        let col = Math.floor((t - start) * colScale);
        if (col >= cols) col = cols - 1;
        const k = c * cols + col;
        if (has[k] === 0) {
          has[k] = 1;
          first[k] = last[k] = min[k] = max[k] = v;
        } else {
          last[k] = v;
          if (v < min[k]) min[k] = v;
          else if (v > max[k]) max[k] = v;
        }
        if (v > maxV) maxV = v;
      }
    }
  } else {
    for (let s = 0; s < segCount; s++) {
      for (let p = segs[s * 2], b = segs[s * 2 + 1]; p < b; p++) {
        const t = timestamps[p];
        if (t < start || t > end || ((mask >> categories[p]) & 1) === 0) continue;
        const v = values[p];
        if (v >= vmin && v <= vmax && v > maxV) maxV = v;
      }
    }
  }

  // Y domain eases toward a clean maximum so spikes don't make the axis jump.
  const target = niceMax(Math.max(50, maxV * 1.08));
  state.yMax = approach(state.yMax, target, smoothing(dt, 160), target * 0.002);
  const animating = state.yMax !== target;
  const yMax = state.yMax;
  const ky = plot.h / yMax;
  const baseY = plot.y + plot.h;

  // Grid + ticks (labels are applied to SVG by the component).
  linearTicks(0, yMax, Math.max(2, Math.floor(plot.h / 50)), state.yTicks);
  state.yPos.length = 0;
  state.yLabels.length = 0;
  for (let i = 0; i < state.yTicks.length; i++) {
    state.yPos.push(baseY - state.yTicks[i] * ky);
    state.yLabels.push(String(state.yTicks[i]));
  }
  drawHorizontalGrid(ctx, plot, state.yPos, theme.grid, size.dpr);
  timeTicks(start, end, Math.max(2, Math.floor(plot.w / 110)), tzOffsetMs, state.xTicks);
  const kx = plot.w / span;
  state.xPos.length = 0;
  for (let i = 0; i < state.xTicks.values.length; i++) state.xPos.push(plot.x + (state.xTicks.values[i] - start) * kx);

  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.x, plot.y - 8, plot.w + LINE_MARGIN.right, plot.h + 8);
  ctx.clip();
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const endX = state.endX.fill(Number.NaN);
  const endY = state.endY;
  let vertices = 0;

  if (useM4) {
    const { first, last, min, max, has } = state;
    const invDpr = 1 / size.dpr;
    for (let c = 0; c < C; c++) {
      if (((mask >> c) & 1) === 0) continue;
      const path = new Path2D();
      let started = false;
      const base = c * cols;
      for (let col = 0; col < cols; col++) {
        const k = base + col;
        if (has[k] === 0) continue;
        const x = plot.x + (col + 0.5) * invDpr;
        const yf = baseY - first[k] * ky;
        if (started) path.lineTo(x, yf);
        else {
          path.moveTo(x, yf);
          started = true;
        }
        path.lineTo(x, baseY - min[k] * ky);
        path.lineTo(x, baseY - max[k] * ky);
        const yl = baseY - last[k] * ky;
        path.lineTo(x, yl);
        endX[c] = x;
        endY[c] = yl;
        vertices += 4;
      }
      ctx.strokeStyle = theme.series[c];
      ctx.stroke(path);
    }
  } else {
    const paths: Path2D[] = [];
    const started = state.started.fill(0);
    for (let c = 0; c < C; c++) paths.push(new Path2D());
    for (let s = 0; s < segCount; s++) {
      for (let p = segs[s * 2], b = segs[s * 2 + 1]; p < b; p++) {
        const c = categories[p];
        if (((mask >> c) & 1) === 0) continue;
        const v = values[p];
        if (v < vmin || v > vmax) continue;
        const t = timestamps[p];
        const x = plot.x + (t - start) * kx;
        const y = baseY - v * ky;
        if (started[c]) paths[c].lineTo(x, y);
        else {
          paths[c].moveTo(x, y);
          started[c] = 1;
        }
        if (t <= end) {
          endX[c] = x;
          endY[c] = y;
        }
        vertices++;
      }
    }
    for (let c = 0; c < C; c++) {
      if (!started[c]) continue;
      ctx.strokeStyle = theme.series[c];
      ctx.stroke(paths[c]);
    }
  }
  state.verticesDrawn = vertices;

  // Live end markers: r=4 dot with a 2px surface ring, only while following the stream.
  if (live) {
    for (let c = 0; c < C; c++) {
      if (!Number.isFinite(endX[c]) || endX[c] < plot.x + plot.w - 12) continue;
      ctx.beginPath();
      ctx.arc(endX[c], endY[c], 6, 0, Math.PI * 2);
      ctx.fillStyle = theme.surface;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(endX[c], endY[c], 4, 0, Math.PI * 2);
      ctx.fillStyle = theme.series[c];
      ctx.fill();
    }
  }
  ctx.restore();

  drawBaseline(ctx, plot, theme.baseline, size.dpr);
  return animating;
}

/** Logical index of the first sample of the row nearest to `t`, or -1. */
export function nearestRowStart(store: TimeSeriesStore, t: number): number {
  if (store.size === 0) return -1;
  let i = store.lowerBound(t);
  if (i >= store.size) i = store.size - 1;
  if (i > 0 && Math.abs(store.timestampAt(i - 1) - t) < Math.abs(store.timestampAt(i) - t)) i--;
  const rowTs = store.timestampAt(i);
  while (i > 0 && store.timestampAt(i - 1) === rowTs) i--;
  return i;
}
