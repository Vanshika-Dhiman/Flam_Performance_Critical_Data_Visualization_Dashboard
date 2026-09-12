import { CATEGORIES, SLO_MS } from './chartConfig';
import type { ColumnsView, DataPoint, LatencyStatus } from './types';

type Listener = () => void;

export function latencyStatus(latencyMs: number): LatencyStatus {
  if (latencyMs >= SLO_MS) return 'critical';
  if (latencyMs >= 200) return 'warning';
  return 'ok';
}

/**
 * Fixed-capacity, columnar ring buffer for time-ordered samples.
 *
 * - Memory is allocated once per capacity (17 bytes/sample) and never grows, so the
 *   dashboard can stream for hours with a flat heap.
 * - Every sample has a monotonic sequence number `seq`; its physical slot is always
 *   `seq % capacity`. Consumers (the virtual table) can hold on to seqs and detect
 *   eviction in O(1).
 * - Timestamps are non-decreasing, so visible ranges are found with binary search.
 * - `version` increments on every committed batch; renderers compare versions instead
 *   of subscribing, which keeps React out of the 60 fps path.
 */
export class TimeSeriesStore {
  capacity: number;
  size = 0;
  /** Sequence number the next sample will receive. */
  head = 0;
  version = 0;
  timestamps: Float64Array;
  values: Float32Array;
  requests: Float32Array;
  categories: Uint8Array;

  private readonly listeners = new Set<Listener>();

  constructor(capacity: number) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.timestamps = new Float64Array(this.capacity);
    this.values = new Float32Array(this.capacity);
    this.requests = new Float32Array(this.capacity);
    this.categories = new Uint8Array(this.capacity);
  }

  get oldestSeq(): number {
    return this.head - this.size;
  }

  push(timestamp: number, value: number, requests: number, category: number): void {
    const p = this.head % this.capacity;
    this.timestamps[p] = timestamp;
    this.values[p] = value;
    this.requests[p] = requests;
    this.categories[p] = category;
    this.head++;
    if (this.size < this.capacity) this.size++;
  }

  /** Publish the pushes made since the last commit. */
  commit(): void {
    this.version++;
    this.listeners.forEach((listener) => listener());
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = (): number => this.version;

  /** Logical index (0 = oldest) to physical slot. */
  physical(logical: number): number {
    return (this.head - this.size + logical) % this.capacity;
  }

  /** Physical slot of a sequence number, or -1 if it has been evicted / not written yet. */
  seqToPhysical(seq: number): number {
    if (seq < this.head - this.size || seq >= this.head) return -1;
    return seq % this.capacity;
  }

  timestampAt(logical: number): number {
    return this.timestamps[this.physical(logical)];
  }

  firstTimestamp(): number {
    return this.size > 0 ? this.timestampAt(0) : Number.NaN;
  }

  lastTimestamp(): number {
    return this.size > 0 ? this.timestampAt(this.size - 1) : Number.NaN;
  }

  /** First logical index with timestamp >= t. */
  lowerBound(t: number): number {
    let lo = 0;
    let hi = this.size;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.timestampAt(mid) < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** First logical index with timestamp > t. */
  upperBound(t: number): number {
    let lo = 0;
    let hi = this.size;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.timestampAt(mid) <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * Physical [start, end) ranges covering logical [i0, i1). Writes pairs into `out`
   * (length >= 4) and returns the number of segments (0, 1 or 2). Lets hot loops
   * iterate typed arrays directly instead of paying a modulo per sample.
   */
  segments(i0: number, i1: number, out: Int32Array): number {
    const from = Math.max(0, i0);
    const to = Math.min(this.size, i1);
    if (to <= from) return 0;
    const start = this.physical(from);
    const end = start + (to - from);
    if (end <= this.capacity) {
      out[0] = start;
      out[1] = end;
      return 1;
    }
    out[0] = start;
    out[1] = this.capacity;
    out[2] = 0;
    out[3] = end - this.capacity;
    return 2;
  }

  /** Copy logical [0, size) into contiguous columns (used to snapshot for the worker). */
  copyInto(target: ColumnsView): number {
    const segs = new Int32Array(4);
    const count = this.segments(0, this.size, segs);
    let offset = 0;
    for (let s = 0; s < count; s++) {
      const a = segs[s * 2];
      const b = segs[s * 2 + 1];
      target.timestamps.set(this.timestamps.subarray(a, b), offset);
      target.values.set(this.values.subarray(a, b), offset);
      target.requests.set(this.requests.subarray(a, b), offset);
      target.categories.set(this.categories.subarray(a, b), offset);
      offset += b - a;
    }
    target.length = offset;
    return offset;
  }

  /** Change capacity, keeping the most recent samples. */
  resize(newCapacity: number): void {
    const capacity = Math.max(1, Math.floor(newCapacity));
    if (capacity === this.capacity) return;
    const keep = Math.min(this.size, capacity);
    this.rebuild(capacity, null, 0, keep);
  }

  /**
   * Insert older, chronologically ordered samples in front of the oldest sample (used
   * when a larger window is backfilled from `/api/data`). Returns how many were kept.
   */
  prepend(older: ColumnsView): number {
    const room = this.capacity - this.size;
    const n = Math.min(room, older.length);
    if (n <= 0) return 0;
    this.rebuild(this.capacity, older, older.length - n, this.size);
    return n;
  }

  private rebuild(capacity: number, older: ColumnsView | null, olderFrom: number, keepExisting: number): void {
    const olderCount = older ? older.length - olderFrom : 0;
    const total = olderCount + keepExisting;
    const timestamps = new Float64Array(capacity);
    const values = new Float32Array(capacity);
    const requests = new Float32Array(capacity);
    const categories = new Uint8Array(capacity);

    // Newest sample keeps its seq; everything else is numbered backwards from it.
    const head = Math.max(this.head, total);
    let seq = head - total;

    if (older) {
      for (let i = olderFrom; i < older.length; i++, seq++) {
        const dst = seq % capacity;
        timestamps[dst] = older.timestamps[i];
        values[dst] = older.values[i];
        requests[dst] = older.requests[i];
        categories[dst] = older.categories[i];
      }
    }
    for (let logical = this.size - keepExisting; logical < this.size; logical++, seq++) {
      const src = this.physical(logical);
      const dst = seq % capacity;
      timestamps[dst] = this.timestamps[src];
      values[dst] = this.values[src];
      requests[dst] = this.requests[src];
      categories[dst] = this.categories[src];
    }

    this.capacity = capacity;
    this.timestamps = timestamps;
    this.values = values;
    this.requests = requests;
    this.categories = categories;
    this.head = head;
    this.size = total;
    this.commit();
  }

  clear(): void {
    this.size = 0;
    this.commit();
  }

  pointAtPhysical(p: number, seq: number): DataPoint {
    const value = this.values[p];
    return {
      timestamp: this.timestamps[p],
      value,
      category: CATEGORIES[this.categories[p]]?.id ?? 'us-east',
      metadata: { requests: this.requests[p], seq, status: latencyStatus(value) },
    };
  }

  pointBySeq(seq: number): DataPoint | null {
    const p = this.seqToPhysical(seq);
    return p < 0 ? null : this.pointAtPhysical(p, seq);
  }

  /** Estimated bytes held by the columns. */
  byteSize(): number {
    return this.timestamps.byteLength + this.values.byteLength + this.requests.byteLength + this.categories.byteLength;
  }
}

export function allocateColumns(capacity: number): ColumnsView {
  return {
    timestamps: new Float64Array(capacity),
    values: new Float32Array(capacity),
    requests: new Float32Array(capacity),
    categories: new Uint8Array(capacity),
    length: 0,
  };
}
