const integerFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const compactFormat = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatInt(n: number): string {
  return Number.isFinite(n) ? integerFormat.format(n) : '—';
}

export function formatCompact(n: number): string {
  return Number.isFinite(n) ? compactFormat.format(n) : '—';
}

export function formatMs(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return v < 10 ? v.toFixed(1) : integerFormat.format(v);
}

/** "14:05:10" in local time. */
export function formatClock(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** "12 Sep 14:05" in local time. */
export function formatDateTime(ts: number, withSeconds = false): string {
  const d = new Date(ts);
  const time = withSeconds ? formatClock(ts) : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${time}`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return 'all';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 48) return rest ? `${hours}h ${rest}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const restH = hours % 24;
  return restH ? `${days}d ${restH}h` : `${days}d`;
}

export function localTzOffsetMs(): number {
  return -new Date().getTimezoneOffset() * 60_000;
}
