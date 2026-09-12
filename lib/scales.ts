/**
 * Minimal scale & tick helpers (no D3). Written to be called every frame: callers pass
 * in reusable output arrays and no closures are created.
 */

export function niceStep(span: number, targetCount: number): number {
  if (!(span > 0)) return 1;
  const raw = span / Math.max(1, targetCount);
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / magnitude;
  const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return step * magnitude;
}

/** Round a maximum up to a clean axis value (0 / 250 / 500 ...). */
export function niceMax(value: number, targetCount = 4): number {
  if (!(value > 0)) return 1;
  const step = niceStep(value, targetCount);
  return Math.ceil(value / step) * step;
}

export function linearTicks(min: number, max: number, targetCount: number, out: number[]): number[] {
  out.length = 0;
  if (!(max > min)) return out;
  const step = niceStep(max - min, targetCount);
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const factor = Math.pow(10, decimals);
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) {
    out.push(Math.round(v * factor) / factor);
  }
  return out;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const TIME_STEPS = [
  SECOND, 5 * SECOND, 15 * SECOND, 30 * SECOND,
  MINUTE, 2 * MINUTE, 5 * MINUTE, 10 * MINUTE, 15 * MINUTE, 30 * MINUTE,
  HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR,
  DAY, 2 * DAY, 7 * DAY,
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export interface TickSet {
  values: number[];
  labels: string[];
  step: number;
}

export function createTickSet(): TickSet {
  return { values: [], labels: [], step: 0 };
}

/**
 * Time ticks aligned to local-time boundaries. `tzOffsetMs` is the local offset from
 * UTC (e.g. +19 800 000 for IST), so 1-hour ticks land on :00 local, not :30.
 */
export function timeTicks(t0: number, t1: number, targetCount: number, tzOffsetMs: number, out: TickSet): TickSet {
  out.values.length = 0;
  out.labels.length = 0;
  const span = t1 - t0;
  if (!(span > 0)) return out;
  const target = span / Math.max(1, targetCount);
  let step = TIME_STEPS[TIME_STEPS.length - 1];
  for (let i = 0; i < TIME_STEPS.length; i++) {
    if (TIME_STEPS[i] >= target) {
      step = TIME_STEPS[i];
      break;
    }
  }
  out.step = step;
  const first = Math.ceil((t0 + tzOffsetMs) / step) * step - tzOffsetMs;
  for (let t = first; t <= t1; t += step) {
    out.values.push(t);
    out.labels.push(formatTick(t, step, tzOffsetMs));
  }
  return out;
}

function formatTick(t: number, step: number, tzOffsetMs: number): string {
  const local = t + tzOffsetMs;
  const msOfDay = ((local % DAY) + DAY) % DAY;
  const hours = Math.floor(msOfDay / HOUR);
  const minutes = Math.floor((msOfDay % HOUR) / MINUTE);
  if (msOfDay === 0 || step >= DAY) {
    const d = new Date(t);
    return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  }
  if (step < MINUTE) {
    const seconds = Math.floor((msOfDay % MINUTE) / SECOND);
    return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
  }
  return `${pad2(hours)}:${pad2(minutes)}`;
}

/** Frame-rate independent exponential smoothing factor. */
export function smoothing(dtMs: number, timeConstantMs: number): number {
  return 1 - Math.exp(-Math.max(0, dtMs) / timeConstantMs);
}
