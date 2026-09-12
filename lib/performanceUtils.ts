/**
 * Measurement primitives. All fixed-size and allocation-free on the hot path so that
 * measuring performance does not itself cause GC pressure.
 */

interface PerformanceWithMemory extends Performance {
  memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
}

/** Used JS heap in MB (Chromium only), null elsewhere. */
export function readHeapMB(): number | null {
  if (typeof performance === 'undefined') return null;
  const memory = (performance as PerformanceWithMemory).memory;
  return memory ? memory.usedJSHeapSize / 1_048_576 : null;
}

export function supportsEntryType(type: string): boolean {
  return (
    typeof PerformanceObserver !== 'undefined' &&
    Array.isArray(PerformanceObserver.supportedEntryTypes) &&
    PerformanceObserver.supportedEntryTypes.includes(type)
  );
}

/** Fixed-capacity (time, value) series with least-squares slope. */
export class RollingSeries {
  private readonly times: Float64Array;
  private readonly values: Float64Array;
  private cursor = 0;
  size = 0;

  constructor(readonly capacity: number) {
    this.times = new Float64Array(capacity);
    this.values = new Float64Array(capacity);
  }

  push(time: number, value: number): void {
    this.times[this.cursor] = time;
    this.values[this.cursor] = value;
    this.cursor = (this.cursor + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }

  /** i = 0 is the oldest retained sample. */
  valueAt(i: number): number {
    return this.values[(this.cursor - this.size + i + this.capacity) % this.capacity];
  }

  timeAt(i: number): number {
    return this.times[(this.cursor - this.size + i + this.capacity) % this.capacity];
  }

  last(): number {
    return this.size ? this.valueAt(this.size - 1) : Number.NaN;
  }

  /** Slope of value over time, in value units per minute. */
  slopePerMinute(): number | null {
    if (this.size < 6) return null;
    const t0 = this.timeAt(0);
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < this.size; i++) {
      const x = (this.timeAt(i) - t0) / 60_000;
      const y = this.valueAt(i);
      sx += x;
      sy += y;
      sxx += x * x;
      sxy += x * y;
    }
    const n = this.size;
    const denominator = n * sxx - sx * sx;
    if (Math.abs(denominator) < 1e-9) return null;
    return (n * sxy - sx * sy) / denominator;
  }
}

/** Events-per-second over a sliding one-second window. */
export class RateCounter {
  private readonly times = new Float64Array(64);
  private readonly counts = new Float64Array(64);
  private cursor = 0;

  record(count: number, now = performance.now()): void {
    this.times[this.cursor] = now;
    this.counts[this.cursor] = count;
    this.cursor = (this.cursor + 1) % this.times.length;
  }

  rate(now = performance.now(), windowMs = 1000): number {
    let total = 0;
    for (let i = 0; i < this.times.length; i++) {
      if (this.times[i] > 0 && now - this.times[i] <= windowMs) total += this.counts[i];
    }
    return (total * 1000) / windowMs;
  }
}

/**
 * Input-to-frame latency: the pointer/wheel handler marks the event timestamp and the
 * render loop resolves it once the frame that reflects it has been drawn.
 */
export class InteractionTracker {
  private pending = -1;
  lastLatency: number | null = null;
  private readonly recent = new RollingSeries(32);

  markInput(eventTimeStamp: number): void {
    if (this.pending < 0) this.pending = eventTimeStamp;
  }

  resolve(frameEnd: number): void {
    if (this.pending < 0) return;
    const latency = frameEnd - this.pending;
    this.pending = -1;
    if (latency >= 0 && latency < 5000) {
      this.lastLatency = latency;
      this.recent.push(frameEnd, latency);
    }
  }

  worstRecent(now: number, windowMs = 5000): number | null {
    let worst: number | null = null;
    for (let i = 0; i < this.recent.size; i++) {
      if (now - this.recent.timeAt(i) <= windowMs) {
        const v = this.recent.valueAt(i);
        worst = worst === null ? v : Math.max(worst, v);
      }
    }
    return worst;
  }
}

/** Counts React <Profiler> commits (only fires in development / profiling builds). */
export class CommitCounter {
  private readonly rateCounter = new RateCounter();
  seen = false;

  onRender = (): void => {
    this.seen = true;
    this.rateCounter.record(1);
  };

  rate(): number | null {
    return this.seen ? this.rateCounter.rate() : null;
  }
}

/** Emit a User Timing measure (visible in DevTools) without growing the timeline buffer. */
export function recordMeasure(name: string, start: number, end: number): void {
  if (typeof performance === 'undefined' || typeof performance.measure !== 'function') return;
  try {
    performance.measure(name, { start, end });
    performance.clearMeasures(name);
  } catch {
    // Older browsers without the options-bag overload: skip silently.
  }
}

export function percentile(sorted: ArrayLike<number>, p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

export function mean(values: ArrayLike<number>): number {
  if (values.length === 0) return Number.NaN;
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return sum / values.length;
}
