import { SAMPLE_INTERVAL_MS } from './chartConfig';
import { smoothing } from './scales';

export type ViewportMode = 'live' | 'manual';

export interface ViewportSnapshot {
  mode: ViewportMode;
  /** Live window width; Infinity = whole buffer. */
  rangeMs: number;
}

const MIN_SPAN_MS = SAMPLE_INTERVAL_MS * 12;

/**
 * Shared time domain for all time-based charts (line, bar, heatmap), kept outside React.
 *
 * Wheel/drag events mutate it directly and the render loop reads `start`/`end` on the
 * next frame, so an interaction costs zero React renders. React only hears about
 * *mode* changes (live <-> manual, range preset) through `subscribe`, which is what the
 * TimeRangeSelector needs.
 *
 * In live mode the right edge eases toward the newest sample instead of jumping every
 * 100 ms, which is what makes the scroll look continuous at 60 fps.
 */
export class ViewportStore {
  start = 0;
  end = 0;
  version = 0;

  private mode: ViewportMode = 'live';
  private rangeMs = Number.POSITIVE_INFINITY;
  private liveStart = Number.NaN;
  private liveEnd = Number.NaN;
  private manualStart = 0;
  private manualEnd = 0;
  private snapshot: ViewportSnapshot = { mode: 'live', rangeMs: Number.POSITIVE_INFINITY };
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ViewportSnapshot => this.snapshot;

  private publish(): void {
    if (this.snapshot.mode === this.mode && this.snapshot.rangeMs === this.rangeMs) return;
    this.snapshot = { mode: this.mode, rangeMs: this.rangeMs };
    this.listeners.forEach((l) => l());
  }

  get isLive(): boolean {
    return this.mode === 'live';
  }

  /** Called once per frame before charts draw. Returns true if the domain moved. */
  advance(dtMs: number, dataStart: number, dataEnd: number): boolean {
    if (!(dataEnd >= dataStart)) return false;
    let s: number;
    let e: number;
    if (this.mode === 'live') {
      const k = smoothing(dtMs, 90);
      const span = Math.max(MIN_SPAN_MS, (Number.isFinite(this.rangeMs) ? this.rangeMs : dataEnd - dataStart) || MIN_SPAN_MS);
      // Snap on big discontinuities (backfill, window resize, returning to the tab).
      const snap = !Number.isFinite(this.liveEnd) || Math.abs(dataEnd - this.liveEnd) > span * 0.25;
      this.liveEnd = snap ? dataEnd : this.ease(this.liveEnd, dataEnd, k);
      const targetStart = Number.isFinite(this.rangeMs) ? Math.max(dataStart, this.liveEnd - this.rangeMs) : dataStart;
      const snapStart = snap || !Number.isFinite(this.liveStart) || Math.abs(targetStart - this.liveStart) > span * 0.25;
      this.liveStart = snapStart ? targetStart : this.ease(this.liveStart, targetStart, k);
      s = this.liveStart;
      e = this.liveEnd;
      if (e - s < MIN_SPAN_MS) s = e - MIN_SPAN_MS;
    } else {
      s = this.manualStart;
      e = this.manualEnd;
    }
    if (s === this.start && e === this.end) return false;
    this.start = s;
    this.end = e;
    this.version++;
    return true;
  }

  private ease(current: number, target: number, k: number): number {
    const next = current + (target - current) * k;
    return Math.abs(target - next) < 1 ? target : next;
  }

  setRange(rangeMs: number): void {
    this.rangeMs = rangeMs;
    this.mode = 'live';
    this.version++;
    this.publish();
  }

  goLive(): void {
    this.mode = 'live';
    this.version++;
    this.publish();
  }

  setManualDomain(start: number, end: number, dataStart: number, dataEnd: number): void {
    let s = Math.min(start, end);
    let e = Math.max(start, end);
    if (e - s < MIN_SPAN_MS) {
      const mid = (s + e) / 2;
      s = mid - MIN_SPAN_MS / 2;
      e = mid + MIN_SPAN_MS / 2;
    }
    [s, e] = clampWindow(s, e, dataStart, dataEnd);
    this.manualStart = s;
    this.manualEnd = e;
    this.mode = 'manual';
    this.version++;
    this.publish();
  }

  /**
   * Zoom by `factor` (<1 zooms in). While live, zoom changes the live window width and
   * keeps following the stream; in manual mode it zooms around the pointer.
   */
  zoom(anchor: number, factor: number, dataStart: number, dataEnd: number): void {
    const span = this.end - this.start;
    if (!(span > 0) || !(dataEnd > dataStart)) return;
    const fullSpan = Math.max(MIN_SPAN_MS, dataEnd - dataStart);
    const nextSpan = Math.min(fullSpan, Math.max(MIN_SPAN_MS, span * factor));
    if (this.mode === 'live') {
      this.rangeMs = nextSpan >= fullSpan * 0.999 ? Number.POSITIVE_INFINITY : nextSpan;
      this.version++;
      this.publish();
      return;
    }
    const ratio = (anchor - this.start) / span;
    const s = anchor - ratio * nextSpan;
    this.setManualDomain(s, s + nextSpan, dataStart, dataEnd);
  }

  pan(deltaMs: number, dataStart: number, dataEnd: number): void {
    const span = this.end - this.start;
    if (!(span > 0)) return;
    this.setManualDomain(this.start + deltaMs, this.end + deltaMs, dataStart, dataEnd);
  }
}

function clampWindow(s: number, e: number, dataStart: number, dataEnd: number): [number, number] {
  if (!(dataEnd > dataStart)) return [s, e];
  const span = e - s;
  if (span >= dataEnd - dataStart) return [dataStart, dataEnd];
  if (s < dataStart) return [dataStart, dataStart + span];
  if (e > dataEnd) return [dataEnd - span, dataEnd];
  return [s, e];
}
