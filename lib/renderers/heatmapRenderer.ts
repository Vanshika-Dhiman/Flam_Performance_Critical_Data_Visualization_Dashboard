import {
  beginFrame,
  createScratchCanvas,
  drawBaseline,
  drawEmptyState,
  plotRectFor,
  type CanvasSize,
  type PlotMargin,
  type PlotRect,
  type ScratchCanvas,
  type ScratchContext,
} from '../canvasUtils';
import { createTickSet, linearTicks, timeTicks, type TickSet } from '../scales';
import type { ChartTheme } from '../theme';
import type { AggregationResult } from '../types';

export const HEAT_MARGIN: PlotMargin = { top: 14, right: 18, bottom: 28, left: 48 };

export interface HeatHover {
  active: boolean;
  bucketStart: number;
  bucketEnd: number;
  binLow: number;
  binHigh: number;
  count: number;
  top: boolean;
}

export interface HeatmapState {
  scratch: { canvas: ScratchCanvas; ctx: ScratchContext } | null;
  image: ImageData | null;
  uploadedVersion: number;
  xTicks: TickSet;
  xPos: number[];
  yTicks: number[];
  yPos: number[];
  yLabels: string[];
  plot: PlotRect;
  hover: HeatHover;
}

export function createHeatmapState(): HeatmapState {
  return {
    scratch: null,
    image: null,
    uploadedVersion: -1,
    xTicks: createTickSet(),
    xPos: [],
    yTicks: [],
    yPos: [],
    yLabels: [],
    plot: { x: 0, y: 0, w: 1, h: 1 },
    hover: { active: false, bucketStart: 0, bucketEnd: 0, binLow: 0, binHigh: 0, count: 0, top: false },
  };
}

export interface HeatmapDrawInput {
  ctx: CanvasRenderingContext2D;
  size: CanvasSize;
  result: AggregationResult | null;
  resultVersion: number;
  start: number;
  end: number;
  theme: ChartTheme;
  tzOffsetMs: number;
  hoverX: number | null;
  hoverY: number | null;
}

/**
 * The worker already colour-mapped the bucket x latency grid into RGBA. On a new result we
 * upload it once to an off-screen bitmap (one texel per cell); every frame after that is a
 * single scaled drawImage, so panning/zooming a 12 000 x 48 grid costs one GPU blit.
 */
export function drawHeatmap(state: HeatmapState, input: HeatmapDrawInput): void {
  const { ctx, size, result, resultVersion, start, end, theme, tzOffsetMs, hoverX, hoverY } = input;
  const plot = plotRectFor(size, HEAT_MARGIN);
  state.plot = plot;
  state.hover.active = false;
  beginFrame(ctx, size, theme.surface);

  if (!result || result.bucketCount === 0 || !(end > start)) {
    state.xTicks.values.length = 0;
    state.yTicks.length = 0;
    drawEmptyState(ctx, plot, 'Aggregating…', theme.textMuted);
    return;
  }

  const { bucketCapacity, heatBins: bins, bucketStart, bucketMs, bucketCount, heatMin, heatMax } = result;

  if (state.uploadedVersion !== resultVersion) {
    if (!state.scratch || state.scratch.canvas.width !== bucketCapacity || state.scratch.canvas.height !== bins) {
      state.scratch = createScratchCanvas(bucketCapacity, bins);
      state.image = state.scratch.ctx.createImageData(bucketCapacity, bins);
    }
    const image = state.image!;
    image.data.set(result.heatPixels.subarray(0, bucketCapacity * bins * 4));
    state.scratch.ctx.putImageData(image, 0, 0);
    state.uploadedVersion = resultVersion;
  }

  const span = end - start;
  const sx = (start - bucketStart) / bucketMs;
  const sw = span / bucketMs;
  const src0 = Math.max(0, sx);
  const src1 = Math.min(bucketCount, sx + sw);
  if (src1 > src0 && state.scratch) {
    const dx0 = plot.x + ((src0 - sx) / sw) * plot.w;
    const dx1 = plot.x + ((src1 - sx) / sw) * plot.w;
    // Upscaling: crisp cells. Downscaling (more buckets than pixels): filtered, so narrow
    // spikes blend instead of flickering in and out while panning.
    const downscale = src1 - src0 > (dx1 - dx0) * size.dpr;
    ctx.imageSmoothingEnabled = downscale;
    if (downscale) ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(state.scratch.canvas as CanvasImageSource, src0, 0, src1 - src0, bins, dx0, plot.y, dx1 - dx0, plot.h);
    ctx.imageSmoothingEnabled = true;
  }

  const kx = plot.w / span;
  timeTicks(start, end, Math.max(2, Math.floor(plot.w / 110)), tzOffsetMs, state.xTicks);
  state.xPos.length = 0;
  for (const t of state.xTicks.values) state.xPos.push(plot.x + (t - start) * kx);

  const ky = plot.h / (heatMax - heatMin);
  linearTicks(heatMin, heatMax, Math.max(2, Math.floor(plot.h / 50)), state.yTicks);
  state.yPos.length = 0;
  state.yLabels.length = 0;
  for (const v of state.yTicks) {
    state.yPos.push(plot.y + plot.h - (v - heatMin) * ky);
    state.yLabels.push(String(v));
  }

  if (hoverX !== null && hoverY !== null && hoverX >= plot.x && hoverX <= plot.x + plot.w && hoverY >= plot.y && hoverY <= plot.y + plot.h) {
    const b = Math.floor(sx + ((hoverX - plot.x) / plot.w) * sw);
    const bin = Math.min(bins - 1, Math.floor(((plot.y + plot.h - hoverY) / plot.h) * bins));
    if (b >= 0 && b < bucketCount && bin >= 0) {
      const binSize = (heatMax - heatMin) / bins;
      state.hover = {
        active: true,
        bucketStart: bucketStart + b * bucketMs,
        bucketEnd: bucketStart + (b + 1) * bucketMs,
        binLow: heatMin + bin * binSize,
        binHigh: heatMin + (bin + 1) * binSize,
        count: result.heatCounts[b * bins + bin],
        top: bin === bins - 1,
      };
      const cellX = plot.x + (bucketStart + b * bucketMs - start) * kx;
      const cellW = Math.max(3, bucketMs * kx);
      const cellH = Math.max(3, plot.h / bins);
      const cellY = plot.y + plot.h - (bin + 1) * (plot.h / bins);
      ctx.strokeStyle = theme.textPrimary;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cellX, cellY, cellW, cellH);
    }
  }

  drawBaseline(ctx, plot, theme.baseline, size.dpr);
}
