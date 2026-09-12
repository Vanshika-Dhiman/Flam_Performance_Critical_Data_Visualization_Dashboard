/**
 * Low-level canvas helpers shared by every renderer.
 */

/** Device-pixel-ratio cap: 3x phones would quadruple fill cost for no visible gain. */
export const MAX_DPR = 2;

export interface PlotMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PlotRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CanvasSize {
  width: number;
  height: number;
  dpr: number;
}

export function currentDpr(): number {
  if (typeof window === 'undefined') return 1;
  return Math.min(MAX_DPR, Math.max(1, window.devicePixelRatio || 1));
}

/** Resize the backing store only when needed (resizing clears the canvas and is costly). */
export function syncCanvasSize(canvas: HTMLCanvasElement, size: CanvasSize): boolean {
  const w = Math.max(1, Math.round(size.width * size.dpr));
  const h = Math.max(1, Math.round(size.height * size.dpr));
  if (canvas.width === w && canvas.height === h) return false;
  canvas.width = w;
  canvas.height = h;
  return true;
}

export function getContext2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  // alpha:false lets the compositor skip blending the canvas with the page.
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D context is not available in this browser');
  return ctx;
}

export function plotRectFor(size: CanvasSize, margin: PlotMargin): PlotRect {
  return {
    x: margin.left,
    y: margin.top,
    w: Math.max(1, size.width - margin.left - margin.right),
    h: Math.max(1, size.height - margin.top - margin.bottom),
  };
}

/** Reset transform to CSS pixels and paint the surface. */
export function beginFrame(ctx: CanvasRenderingContext2D, size: CanvasSize, surface: string): void {
  ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = surface;
  ctx.fillRect(0, 0, size.width, size.height);
}

/** Snap a CSS-pixel coordinate so a 1px hairline lands on whole device pixels. */
export function crisp(v: number, dpr: number): number {
  return (Math.round(v * dpr) + 0.5) / dpr;
}

export function drawHorizontalGrid(
  ctx: CanvasRenderingContext2D,
  plot: PlotRect,
  ys: readonly number[],
  color: string,
  dpr: number,
): void {
  ctx.beginPath();
  for (let i = 0; i < ys.length; i++) {
    const y = crisp(ys[i], dpr);
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.w, y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1 / dpr;
  ctx.stroke();
}

export function drawBaseline(ctx: CanvasRenderingContext2D, plot: PlotRect, color: string, dpr: number): void {
  const y = crisp(plot.y + plot.h, dpr);
  ctx.beginPath();
  ctx.moveTo(plot.x, y);
  ctx.lineTo(plot.x + plot.w, y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1 / dpr;
  ctx.stroke();
}

export function drawEmptyState(ctx: CanvasRenderingContext2D, plot: PlotRect, message: string, color: string): void {
  ctx.fillStyle = color;
  ctx.font = '13px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(message, plot.x + plot.w / 2, plot.y + plot.h / 2);
}

/** Rectangle with rounded top corners (data end) and square base, appended to a path. */
export function roundedTopRect(path: Path2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, w / 2, h));
  if (radius < 0.5) {
    path.rect(x, y, w, h);
    return;
  }
  path.moveTo(x, y + h);
  path.lineTo(x, y + radius);
  path.arcTo(x, y, x + radius, y, radius);
  path.lineTo(x + w - radius, y);
  path.arcTo(x + w, y, x + w, y + radius, radius);
  path.lineTo(x + w, y + h);
  path.closePath();
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 256-entry RGBA lookup table interpolated through evenly spaced ramp stops. */
export function buildLut(stops: readonly string[], size = 256): Uint8ClampedArray {
  const rgb = stops.map(hexToRgb);
  const lut = new Uint8ClampedArray(size * 4);
  const segments = rgb.length - 1;
  for (let i = 0; i < size; i++) {
    const t = (i / (size - 1)) * segments;
    const s = Math.min(segments - 1, Math.floor(t));
    const f = t - s;
    const a = rgb[s];
    const b = rgb[Math.min(segments, s + 1)];
    lut[i * 4] = a[0] + (b[0] - a[0]) * f;
    lut[i * 4 + 1] = a[1] + (b[1] - a[1]) * f;
    lut[i * 4 + 2] = a[2] + (b[2] - a[2]) * f;
    lut[i * 4 + 3] = 255;
  }
  return lut;
}

export type ScratchCanvas = OffscreenCanvas | HTMLCanvasElement;
export type ScratchContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/**
 * Off-DOM canvas used as a bitmap layer (heatmap image, scatter density). Prefers
 * OffscreenCanvas; falls back to a detached <canvas> on older Safari.
 */
export function createScratchCanvas(width: number, height: number): { canvas: ScratchCanvas; ctx: ScratchContext } {
  let canvas: ScratchCanvas;
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(width, height);
  } else {
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d') as ScratchContext | null;
  if (!ctx) throw new Error('Scratch canvas 2D context is not available');
  return { canvas, ctx };
}

/** Exponentially approach `target`; snaps when close so animations settle. */
export function approach(current: number, target: number, k: number, epsilon: number): number {
  if (!Number.isFinite(current)) return target;
  const next = current + (target - current) * k;
  return Math.abs(next - target) < epsilon ? target : next;
}
