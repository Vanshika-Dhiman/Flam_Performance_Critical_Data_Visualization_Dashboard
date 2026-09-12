import {
  aggregate,
  columnBuffers,
  resultBuffers,
  type WorkerAggregateRequest,
  type WorkerResponse,
} from './aggregation';
import { buildLut } from './canvasUtils';
import { CATEGORY_COUNT, HEAT_BINS, LATENCY_SCALE_MAX, SLO_MS, aggregationMs } from './chartConfig';
import { localTzOffsetMs } from './format';
import { recordMeasure } from './performanceUtils';
import { allocateColumns, type TimeSeriesStore } from './ringBuffer';
import type { ChartTheme } from './theme';
import type { AggregationLevel, AggregationParams, AggregationResult, ColumnsView, FilterState } from './types';
import type { ViewportStore } from './viewport';

const MIN_INTERVAL_MS = 100;

export type EngineMode = 'starting' | 'worker' | 'main-thread';

/**
 * Schedules aggregation off the main thread.
 *
 * - Coalescing: at most one request is in flight; changes that arrive meanwhile set a
 *   dirty flag and are folded into the next request. The worker's own speed becomes the
 *   throttle, so a slow device degrades update rate, never frame rate.
 * - Zero-copy transfers in both directions with buffer recycling.
 * - If the worker cannot start or crashes, it falls back to the same pure function on
 *   the main thread and reports that in the performance panel.
 */
export class AggregationEngine {
  latest: AggregationResult | null = null;
  version = 0;
  mode: EngineMode = 'starting';
  snapshotMs = 0;
  lastError: string | null = null;

  private worker: Worker | null = null;
  private inFlight = false;
  private dirty = true;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSend = 0;
  private requestId = 0;
  private sentAt = 0;
  private input: ColumnsView | null = null;
  private recycle: ArrayBuffer[] = [];
  private unsubscribeStore: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();

  private filters: FilterState | null = null;
  private level: AggregationLevel = '5m';
  private lut: Uint8ClampedArray = new Uint8ClampedArray(256 * 4);

  constructor(
    private readonly store: TimeSeriesStore,
    private readonly viewport: ViewportStore,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = (): number => this.version;

  start(): void {
    if (this.unsubscribeStore) return;
    this.unsubscribeStore = this.store.subscribe(() => this.request());
    if (typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('../workers/aggregation.worker.ts', import.meta.url), {
          type: 'module',
          name: 'aggregation',
        });
        this.worker.onmessage = this.onMessage;
        this.worker.onerror = (event) => this.fallBack(event.message || 'Worker error');
        this.mode = 'worker';
      } catch (error) {
        this.fallBack(error instanceof Error ? error.message : 'Worker unavailable');
      }
    } else {
      this.mode = 'main-thread';
    }
    this.request(true);
  }

  stop(): void {
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.worker?.terminate();
    this.worker = null;
    this.inFlight = false;
    this.input = null;
    this.recycle = [];
    this.dirty = true;
  }

  configure(filters: FilterState, level: AggregationLevel, theme: ChartTheme): void {
    this.filters = filters;
    this.level = level;
    this.lut = buildLut(theme.heatRamp);
    this.request(true);
  }

  request(immediate = false): void {
    this.dirty = true;
    if (this.inFlight || this.timer) return;
    const wait = immediate ? 0 : Math.max(0, MIN_INTERVAL_MS - (performance.now() - this.lastSend));
    this.timer = setTimeout(this.flush, wait);
  }

  private buildParams(): AggregationParams | null {
    const filters = this.filters;
    if (!filters) return null;
    const heatMin = Math.max(0, filters.valueMin);
    const heatMax = Math.max(heatMin + 50, Math.min(filters.valueMax, LATENCY_SCALE_MAX));
    return {
      bucketMs: aggregationMs(this.level),
      tzOffsetMs: localTzOffsetMs(),
      categoryCount: CATEGORY_COUNT,
      categoryMask: filters.categoryMask,
      valueMin: filters.valueMin,
      valueMax: filters.valueMax,
      statsStart: this.viewport.end > this.viewport.start ? this.viewport.start : Number.NEGATIVE_INFINITY,
      statsEnd: this.viewport.end > this.viewport.start ? this.viewport.end : Number.POSITIVE_INFINITY,
      heatBins: HEAT_BINS,
      heatMin,
      heatMax,
      sloMs: SLO_MS,
      heatLut: this.lut,
    };
  }

  private readonly flush = (): void => {
    this.timer = null;
    if (!this.dirty || this.inFlight) return;
    const params = this.buildParams();
    if (!params) return;
    this.dirty = false;
    this.lastSend = performance.now();

    const snapStart = performance.now();
    if (!this.input || this.input.timestamps.length < this.store.size) {
      this.input = allocateColumns(this.store.capacity);
    }
    const columns = this.input;
    this.store.copyInto(columns);
    this.snapshotMs = performance.now() - snapStart;

    const id = ++this.requestId;
    this.sentAt = performance.now();

    if (this.worker) {
      const message: WorkerAggregateRequest = { type: 'aggregate', id, columns, params, recycle: this.recycle };
      this.inFlight = true;
      this.worker.postMessage(message, [...columnBuffers(columns), ...this.recycle]);
      this.input = null;
      this.recycle = [];
    } else {
      try {
        this.accept(aggregate(columns, params, id));
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
      }
      if (this.dirty) this.request();
    }
  };

  private readonly onMessage = (event: MessageEvent<WorkerResponse>): void => {
    const msg = event.data;
    this.inFlight = false;
    this.input = msg.columns;
    if (msg.type === 'result') {
      this.accept(msg.result);
    } else {
      this.lastError = msg.message;
    }
    if (this.dirty) this.request();
  };

  private accept(result: AggregationResult): void {
    const previous = this.latest;
    this.latest = result;
    this.version++;
    if (previous && this.worker) this.recycle.push(...resultBuffers(previous));
    recordMeasure('dashboard:aggregate-roundtrip', this.sentAt, performance.now());
    this.listeners.forEach((l) => l());
  }

  private fallBack(message: string): void {
    console.warn(`[aggregation] falling back to main thread: ${message}`);
    this.lastError = message;
    this.worker?.terminate();
    this.worker = null;
    this.mode = 'main-thread';
    this.inFlight = false;
    this.input = null;
    this.recycle = [];
    this.request(true);
  }
}
