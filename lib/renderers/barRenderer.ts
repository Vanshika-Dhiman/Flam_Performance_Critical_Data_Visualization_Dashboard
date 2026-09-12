import {
  approach,
  beginFrame,
  drawBaseline,
  drawEmptyState,
  drawHorizontalGrid,
  plotRectFor,
  roundedTopRect,
  type CanvasSize,
  type PlotMargin,
  type PlotRect,
} from '../canvasUtils';
import { formatCompact } from '../format';
import { createTickSet, linearTicks, niceMax, smoothing, timeTicks, type TickSet } from '../scales';
import type { ChartTheme } from '../theme';
import type { AggregationResult, FilterState } from '../types';

export const BAR_MARGIN: PlotMargin = { top: 14, right: 18, bottom: 28, left: 52 };

const MIN_BAR_PX = 3;
const MAX_BAR_PX = 24;

export interface BarHover {
  active: boolean;
  groupStart: number;
  groupEnd: number;
  sums: Float64Array;
  partial: boolean;
}

export interface BarState {
  yMax: number;
  xTicks: TickSet;
  xPos: number[];
  yTicks: number[];
  yPos: number[];
  yLabels: string[];
  plot: PlotRect;
  hover: BarHover;
  groupSize: number;
}

export function createBarState(categories: number): BarState {
  return {
    yMax: Number.NaN,
    xTicks: createTickSet(),
    xPos: [],
    yTicks: [],
    yPos: [],
    yLabels: [],
    plot: { x: 0, y: 0, w: 1, h: 1 },
    hover: { active: false, groupStart: 0, groupEnd: 0, sums: new Float64Array(categories), partial: false },
    groupSize: 1,
  };
}

export interface BarDrawInput {
  ctx: CanvasRenderingContext2D;
  size: CanvasSize;
  result: AggregationResult | null;
  start: number;
  end: number;
  filters: FilterState;
  theme: ChartTheme;
  dt: number;
  tzOffsetMs: number;
  hoverX: number | null;
}

/**
 * Stacked columns from pre-aggregated buckets. LOD: when a bucket is narrower than 3px,
 * neighbouring buckets are merged into fixed groups (aligned to bucket index, so the
 * grouping doesn't shimmer while panning).
 */
export function drawBarChart(state: BarState, input: BarDrawInput): boolean {
  const { ctx, size, result, start, end, filters, theme, dt, tzOffsetMs, hoverX } = input;
  const plot = plotRectFor(size, BAR_MARGIN);
  state.plot = plot;
  state.hover.active = false;
  beginFrame(ctx, size, theme.surface);

  if (!result || result.bucketCount === 0 || !(end > start)) {
    state.xTicks.values.length = 0;
    state.yTicks.length = 0;
    drawEmptyState(ctx, plot, 'Aggregating…', theme.textMuted);
    return false;
  }

  const { bucketStart, bucketMs, bucketCount, requestSums, categoryCount: C } = result;
  const mask = filters.categoryMask;
  const span = end - start;
  const kx = plot.w / span;
  const bucketPx = bucketMs * kx;
  const group = bucketPx >= MIN_BAR_PX ? 1 : Math.ceil(MIN_BAR_PX / bucketPx);
  state.groupSize = group;
  const groupPx = bucketPx * group;
  const gFirst = Math.floor((start - bucketStart) / bucketMs / group);
  const gLast = Math.floor((end - bucketStart) / bucketMs / group);

  let maxSum = 0;
  for (let g = gFirst; g <= gLast; g++) {
    const b0 = Math.max(0, g * group);
    const b1 = Math.min(bucketCount, g * group + group);
    let sum = 0;
    for (let b = b0; b < b1; b++) {
      for (let c = 0; c < C; c++) if ((mask >> c) & 1) sum += requestSums[b * C + c];
    }
    if (sum > maxSum) maxSum = sum;
  }

  const target = niceMax(Math.max(1, maxSum * 1.05));
  state.yMax = approach(state.yMax, target, smoothing(dt, 160), target * 0.002);
  const animating = state.yMax !== target;
  const ky = plot.h / state.yMax;
  const baseY = plot.y + plot.h;

  linearTicks(0, state.yMax, Math.max(2, Math.floor(plot.h / 50)), state.yTicks);
  state.yPos.length = 0;
  state.yLabels.length = 0;
  for (const v of state.yTicks) {
    state.yPos.push(baseY - v * ky);
    state.yLabels.push(formatCompact(v));
  }
  drawHorizontalGrid(ctx, plot, state.yPos, theme.grid, size.dpr);
  timeTicks(start, end, Math.max(2, Math.floor(plot.w / 110)), tzOffsetMs, state.xTicks);
  state.xPos.length = 0;
  for (const t of state.xTicks.values) state.xPos.push(plot.x + (t - start) * kx);

  const gap = groupPx >= 6 ? 2 : groupPx >= MIN_BAR_PX ? 1 : 0;
  const barW = Math.max(1, Math.min(MAX_BAR_PX, groupPx - gap));
  const radius = barW >= 8 ? 4 : 0;
  const segmentGap = barW >= 4 ? 2 : 0;
  const partialBucket = Math.floor((result.lastTimestamp - bucketStart) / bucketMs);

  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.x, plot.y, plot.w, plot.h);
  ctx.clip();

  // Hovered column: a wash behind the bars (the mark itself stays the hit target).
  let hoverGroup = Number.NaN;
  if (hoverX !== null && hoverX >= plot.x && hoverX <= plot.x + plot.w) {
    const t = start + (hoverX - plot.x) / kx;
    hoverGroup = Math.floor((t - bucketStart) / bucketMs / group);
    const gStartT = bucketStart + hoverGroup * group * bucketMs;
    ctx.fillStyle = theme.overlay;
    ctx.fillRect(plot.x + (gStartT - start) * kx, plot.y, groupPx, plot.h);
  }

  const paths: Path2D[] = [];
  for (let c = 0; c < C; c++) paths.push(new Path2D());
  let partialX = Number.NaN;

  for (let g = gFirst; g <= gLast; g++) {
    const b0 = Math.max(0, g * group);
    const b1 = Math.min(bucketCount, g * group + group);
    if (b1 <= b0) continue;
    const gStartT = bucketStart + g * group * bucketMs;
    const x = plot.x + (gStartT - start) * kx + (groupPx - barW) / 2;

    let topC = -1;
    for (let c = C - 1; c >= 0 && topC < 0; c--) {
      if (((mask >> c) & 1) === 0) continue;
      for (let b = b0; b < b1; b++) {
        if (requestSums[b * C + c] > 0) {
          topC = c;
          break;
        }
      }
    }

    let y = baseY;
    const isHover = g === hoverGroup;
    for (let c = 0; c < C; c++) {
      if (((mask >> c) & 1) === 0) continue;
      let sum = 0;
      for (let b = b0; b < b1; b++) sum += requestSums[b * C + c];
      if (isHover) state.hover.sums[c] = sum;
      if (sum <= 0) continue;
      const h = sum * ky;
      const top = y - h;
      const bottom = y === baseY ? baseY : y - segmentGap;
      const segH = bottom - top;
      if (segH > 0.25) {
        if (c === topC && radius > 0) roundedTopRect(paths[c], x, top, barW, segH, radius);
        else paths[c].rect(x, top, barW, segH);
      }
      y = top;
    }
    if (isHover) {
      state.hover.active = true;
      state.hover.groupStart = gStartT;
      state.hover.groupEnd = gStartT + group * bucketMs;
      state.hover.partial = partialBucket >= b0 && partialBucket < b1;
    }
    if (partialBucket >= b0 && partialBucket < b1) partialX = x;
  }

  for (let c = 0; c < C; c++) {
    ctx.fillStyle = theme.series[c];
    ctx.fill(paths[c]);
  }

  // The newest bucket is still filling up: fade it so a short bar isn't read as a drop.
  if (Number.isFinite(partialX)) {
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = theme.surface;
    ctx.fillRect(partialX - 1, plot.y, barW + 2, plot.h);
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  drawBaseline(ctx, plot, theme.baseline, size.dpr);
  return animating;
}
