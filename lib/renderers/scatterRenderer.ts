import {
  beginFrame,
  buildLut,
  createScratchCanvas,
  drawBaseline,
  drawHorizontalGrid,
  plotRectFor,
  type CanvasSize,
  type PlotMargin,
  type PlotRect,
  type ScratchCanvas,
  type ScratchContext,
} from '../canvasUtils';
import { CATEGORY_COUNT, LATENCY_SCALE_MAX, REQUESTS_SCALE_MAX } from '../chartConfig';
import { formatCompact } from '../format';
import type { TimeSeriesStore } from '../ringBuffer';
import { linearTicks } from '../scales';
import type { ChartTheme } from '../theme';
import type { FilterState } from '../types';

export const SCATTER_MARGIN: PlotMargin = { top: 14, right: 18, bottom: 28, left: 48 };
const CELL = 2;

export interface ScatterHover {
  active: boolean;
  count: number;
  reqLow: number;
  reqHigh: number;
  latLow: number;
  latHigh: number;
}

export interface ScatterState {
  counts: Uint16Array;
  gridW: number;
  gridH: number;
  maxCount: number;
  plotted: number;
  scratch: { canvas: ScratchCanvas; ctx: ScratchContext } | null;
  image: ImageData | null;
  lut: Uint8ClampedArray | null;
  lutTheme: ChartTheme | null;
  segs: Int32Array;
  xTicks: number[];
  xPos: number[];
  xLabels: string[];
  yTicks: number[];
  yPos: number[];
  yLabels: string[];
  plot: PlotRect;
  yMin: number;
  yMax: number;
  hover: ScatterHover;
  /** Visible index range from the last draw, used as the dirty check. */
  lastI0: number;
  lastI1: number;
}

export function createScatterState(): ScatterState {
  return {
    counts: new Uint16Array(0),
    gridW: 0,
    gridH: 0,
    maxCount: 0,
    plotted: 0,
    scratch: null,
    image: null,
    lut: null,
    lutTheme: null,
    segs: new Int32Array(4),
    xTicks: [],
    xPos: [],
    xLabels: [],
    yTicks: [],
    yPos: [],
    yLabels: [],
    plot: { x: 0, y: 0, w: 1, h: 1 },
    yMin: 0,
    yMax: LATENCY_SCALE_MAX,
    hover: { active: false, count: 0, reqLow: 0, reqHigh: 0, latLow: 0, latHigh: 0 },
    lastI0: -1,
    lastI1: -1,
  };
}

export interface ScatterDrawInput {
  ctx: CanvasRenderingContext2D;
  size: CanvasSize;
  store: TimeSeriesStore;
  i0: number;
  i1: number;
  filters: FilterState;
  theme: ChartTheme;
  highlightCount: number;
  hoverX: number | null;
  hoverY: number | null;
}

export function scatterYDomain(filters: FilterState): [number, number] {
  const min = Math.max(0, filters.valueMin);
  return [min, Math.max(min + 50, Math.min(filters.valueMax, LATENCY_SCALE_MAX))];
}

/**
 * Density scatter: every sample in the time window is binned into a 2x2 CSS-pixel grid
 * and each cell is coloured by its (log) overlap count. Cost is O(samples + cells) with a
 * single putImageData, instead of one fillRect per point, and overplotting becomes
 * information instead of a solid blob.
 */
export function drawScatter(state: ScatterState, input: ScatterDrawInput): void {
  const { ctx, size, store, i0, i1, filters, theme, highlightCount, hoverX, hoverY } = input;
  const plot = plotRectFor(size, SCATTER_MARGIN);
  state.plot = plot;
  state.lastI0 = i0;
  state.lastI1 = i1;
  beginFrame(ctx, size, theme.surface);

  const gridW = Math.max(1, Math.floor(plot.w / CELL));
  const gridH = Math.max(1, Math.floor(plot.h / CELL));
  if (gridW !== state.gridW || gridH !== state.gridH) {
    state.gridW = gridW;
    state.gridH = gridH;
    state.counts = new Uint16Array(gridW * gridH);
    state.scratch = createScratchCanvas(gridW, gridH);
    state.image = state.scratch.ctx.createImageData(gridW, gridH);
  } else {
    state.counts.fill(0);
  }
  if (state.lutTheme !== theme) {
    state.lut = buildLut(theme.densityRamp);
    state.lutTheme = theme;
  }

  const [yMin, yMax] = scatterYDomain(filters);
  state.yMin = yMin;
  state.yMax = yMax;
  const counts = state.counts;
  const gx = gridW / REQUESTS_SCALE_MAX;
  const gy = gridH / (yMax - yMin);
  const mask = filters.categoryMask;
  const { values, requests, categories } = store;
  let maxCount = 0;
  let plotted = 0;

  const segCount = store.segments(i0, i1, state.segs);
  for (let s = 0; s < segCount; s++) {
    for (let p = state.segs[s * 2], b = state.segs[s * 2 + 1]; p < b; p++) {
      if (((mask >> categories[p]) & 1) === 0) continue;
      const v = values[p];
      if (v < filters.valueMin || v > filters.valueMax) continue;
      let cx = Math.floor(requests[p] * gx);
      if (cx >= gridW) cx = gridW - 1;
      let cy = gridH - 1 - Math.floor((v - yMin) * gy);
      if (cy < 0) cy = 0;
      else if (cy >= gridH) cy = gridH - 1;
      const idx = cy * gridW + cx;
      const n = counts[idx] + 1;
      if (n < 65535) counts[idx] = n;
      if (n > maxCount) maxCount = n;
      plotted++;
    }
  }
  state.maxCount = maxCount;
  state.plotted = plotted;

  // Axes & grid under the points.
  linearTicks(yMin, yMax, Math.max(2, Math.floor(plot.h / 50)), state.yTicks);
  state.yPos.length = 0;
  state.yLabels.length = 0;
  for (const v of state.yTicks) {
    state.yPos.push(plot.y + plot.h - ((v - yMin) / (yMax - yMin)) * plot.h);
    state.yLabels.push(String(v));
  }
  drawHorizontalGrid(ctx, plot, state.yPos, theme.grid, size.dpr);
  linearTicks(0, REQUESTS_SCALE_MAX, Math.max(2, Math.floor(plot.w / 90)), state.xTicks);
  state.xPos.length = 0;
  state.xLabels.length = 0;
  for (const v of state.xTicks) {
    state.xPos.push(plot.x + (v / REQUESTS_SCALE_MAX) * plot.w);
    state.xLabels.push(formatCompact(v));
  }

  if (maxCount > 0 && state.scratch && state.image && state.lut) {
    const data = state.image.data;
    const lut = state.lut;
    const logMax = Math.log1p(maxCount);
    for (let i = 0, px = 0; i < counts.length; i++, px += 4) {
      const n = counts[i];
      if (n === 0) {
        data[px + 3] = 0;
        continue;
      }
      const li = maxCount === 1 ? 0 : Math.min(255, Math.floor((Math.log1p(n - 1) / logMax) * 255)) * 4;
      data[px] = lut[li];
      data[px + 1] = lut[li + 1];
      data[px + 2] = lut[li + 2];
      data[px + 3] = 255;
    }
    state.scratch.ctx.putImageData(state.image, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(state.scratch.canvas as CanvasImageSource, plot.x, plot.y, gridW * CELL, gridH * CELL);
    ctx.imageSmoothingEnabled = true;
  }

  // Newest samples: hollow rings (an annotation, not a series colour).
  const highlightFrom = Math.max(i0, i1 - Math.min(highlightCount, 5 * CATEGORY_COUNT));
  if (i1 === store.size && highlightFrom < i1) {
    ctx.beginPath();
    for (let logical = highlightFrom; logical < i1; logical++) {
      const p = store.physical(logical);
      if (((mask >> categories[p]) & 1) === 0) continue;
      const v = values[p];
      if (v < filters.valueMin || v > filters.valueMax) continue;
      const x = plot.x + Math.min(1, requests[p] / REQUESTS_SCALE_MAX) * plot.w;
      const y = plot.y + plot.h - Math.min(1, Math.max(0, (v - yMin) / (yMax - yMin))) * plot.h;
      ctx.moveTo(x + 4, y);
      ctx.arc(x, y, 4, 0, Math.PI * 2);
    }
    ctx.lineWidth = 4;
    ctx.strokeStyle = theme.surface;
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = theme.textPrimary;
    ctx.stroke();
  }

  state.hover.active = false;
  if (hoverX !== null && hoverY !== null && hoverX >= plot.x && hoverX < plot.x + gridW * CELL && hoverY >= plot.y && hoverY < plot.y + gridH * CELL) {
    // Snap to the densest cell within a 24px target so single dots are easy to hit.
    const hx = Math.floor((hoverX - plot.x) / CELL);
    const hy = Math.floor((hoverY - plot.y) / CELL);
    let best = -1;
    let bestCount = 0;
    const r = 6;
    for (let y = Math.max(0, hy - r); y <= Math.min(gridH - 1, hy + r); y++) {
      for (let x = Math.max(0, hx - r); x <= Math.min(gridW - 1, hx + r); x++) {
        const n = counts[y * gridW + x];
        if (n > bestCount) {
          bestCount = n;
          best = y * gridW + x;
        }
      }
    }
    if (best >= 0) {
      const bx = best % gridW;
      const by = Math.floor(best / gridW);
      const reqPerCell = REQUESTS_SCALE_MAX / gridW;
      const latPerCell = (yMax - yMin) / gridH;
      state.hover = {
        active: true,
        count: bestCount,
        reqLow: bx * reqPerCell,
        reqHigh: (bx + 1) * reqPerCell,
        latLow: yMin + (gridH - 1 - by) * latPerCell,
        latHigh: yMin + (gridH - by) * latPerCell,
      };
      ctx.strokeStyle = theme.textPrimary;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(plot.x + bx * CELL - 3, plot.y + by * CELL - 3, CELL + 6, CELL + 6);
    }
  }

  drawBaseline(ctx, plot, theme.baseline, size.dpr);
}
