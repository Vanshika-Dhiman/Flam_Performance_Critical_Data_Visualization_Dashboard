/**
 * Shared domain types.
 *
 * The public `DataPoint` shape matches the assignment brief, but the hot path never
 * allocates DataPoint objects: samples live in columnar typed arrays inside
 * `TimeSeriesStore`. DataPoint is only materialised for tooltips, table rows and the
 * JSON API.
 */

export type CategoryId = 'us-east' | 'eu-central' | 'ap-south' | 'us-west' | 'sa-east';

export type LatencyStatus = 'ok' | 'warning' | 'critical';

export interface DataPoint {
  timestamp: number;
  /** Request latency in milliseconds. */
  value: number;
  category: CategoryId;
  metadata?: {
    /** Requests served during the sample interval. */
    requests: number;
    /** Monotonic sequence number of the sample in the stream. */
    seq: number;
    status: LatencyStatus;
  };
}

export interface CategoryDefinition {
  id: CategoryId;
  label: string;
  /** Median latency (ms) at zero load. */
  baseLatency: number;
  /** Requests per sample interval at peak traffic. */
  peakRequests: number;
  /** UTC offset of the region, used for its diurnal traffic curve. */
  utcOffsetHours: number;
}

export type ChartType = 'line' | 'bar' | 'scatter' | 'heatmap';

export interface ChartConfig {
  id: string;
  type: ChartType;
  title: string;
  subtitle: string;
  dataKey: 'value' | 'requests';
  unit: string;
  visible: boolean;
  /** CSS height of the chart surface, x-axis band included. */
  height: number;
}

export type AggregationLevel = '1m' | '5m' | '1h';

export type TimeRangeKey = '15m' | '1h' | '6h' | '24h' | 'all';

export interface FilterState {
  /** Bit i set => category i visible. */
  categoryMask: number;
  valueMin: number;
  valueMax: number;
}

export interface StreamSettings {
  streaming: boolean;
  pointsPerTick: number;
  windowSize: number;
}

export interface DashboardControls {
  filters: FilterState;
  aggregation: AggregationLevel;
  stream: StreamSettings;
  stressMode: boolean;
  /** Settings to restore when stress mode is switched off. */
  preStressStream: StreamSettings | null;
}

export interface PerformanceMetrics {
  fps: number;
  /** Mean frame interval over the last second (ms). */
  frameTime: number;
  /** Worst frame interval over the last second (ms). */
  worstFrame: number;
  /** JS heap in MB, null where the browser does not expose it. */
  memoryUsage: number | null;
  /** Heap growth trend in MB/min (least squares over the session), null until enough samples. */
  memoryTrend: number | null;
  /** Main-thread canvas draw time per frame, averaged (ms). */
  renderTime: number;
  /** Worker aggregation time for the latest result (ms). */
  dataProcessingTime: number;
  /** Request -> result round trip including transfer and queueing (ms). */
  roundTripTime: number;
  /** Main-thread cost to snapshot the buffer for the worker (ms). */
  snapshotTime: number;
  /** Long tasks (>50ms) observed in the last 10 s, null if unsupported. */
  longTasks: number | null;
  /** Latency from the most recent chart input event to the frame that showed it (ms). */
  inputLatency: number | null;
  /** React commits per second (dev / profiling builds only). */
  reactCommits: number | null;
  pointCount: number;
  ingestRate: number;
  workerMode: 'worker' | 'main-thread' | 'starting';
}

export interface GeneratorState {
  rng: number;
  nextTimestamp: number;
  /** Per-category Ornstein-Uhlenbeck noise level (ms). */
  levels: number[];
  /** Remaining samples of an active incident per category. */
  incidentLeft: number[];
  /** Incident latency multiplier per category. */
  incidentMagnitude: number[];
}

/** Compact, serialisable dataset handed from the Server Component to the client. */
export interface InitialSnapshot {
  version: 1;
  rows: number;
  categories: number;
  startTime: number;
  intervalMs: number;
  /** Base64 Uint16 latency, 0.1 ms resolution, row-major (rows x categories). */
  values: string;
  /** Base64 Uint16 request counts, row-major. */
  requests: string;
  generator: GeneratorState;
  generatedAt: number;
}

export interface CategoryStats {
  count: number;
  mean: number;
  p95: number;
  min: number;
  max: number;
  last: number;
}

export interface AggregationParams {
  bucketMs: number;
  tzOffsetMs: number;
  categoryCount: number;
  categoryMask: number;
  valueMin: number;
  valueMax: number;
  /** Time window used for the summary statistics. */
  statsStart: number;
  statsEnd: number;
  heatBins: number;
  heatMin: number;
  heatMax: number;
  /** Threshold used for the "over SLO" share. */
  sloMs: number;
  /** 256 x RGBA colour ramp for the heatmap. */
  heatLut: Uint8ClampedArray;
}

export interface AggregationResult {
  requestId: number;
  bucketMs: number;
  bucketStart: number;
  bucketCount: number;
  /** Allocated bucket columns (>= bucketCount); pixel buffer width. */
  bucketCapacity: number;
  categoryCount: number;
  /** bucket x category request sums. */
  requestSums: Float32Array;
  /** bucket x bin sample counts. */
  heatCounts: Uint32Array;
  heatMaxCount: number;
  heatBins: number;
  heatMin: number;
  heatMax: number;
  /** RGBA, width = bucketCapacity, height = heatBins, top row = highest latency. */
  heatPixels: Uint8ClampedArray;
  stats: CategoryStats[];
  total: CategoryStats & { requests: number; overSlo: number; spanMs: number };
  /** Timestamp of the newest sample included (marks the partial bucket). */
  lastTimestamp: number;
  computeMs: number;
}

export interface ColumnsView {
  timestamps: Float64Array;
  values: Float32Array;
  requests: Float32Array;
  categories: Uint8Array;
  length: number;
}
