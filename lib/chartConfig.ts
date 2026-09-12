import type {
  AggregationLevel,
  CategoryDefinition,
  ChartConfig,
  DashboardControls,
  TimeRangeKey,
} from './types';

/**
 * Static configuration. Everything in this file is plain data, so it is safe to import
 * from Server Components, Route Handlers (edge) and the Web Worker alike, and it is
 * served pre-rendered from `/api/config`.
 */

export const SAMPLE_INTERVAL_MS = 10_000;
export const TICK_MS = 100;
export const INITIAL_POINTS = 10_000;
export const MAX_WINDOW = 250_000;
export const SLO_MS = 300;
export const LATENCY_SCALE_MAX = 600;

export const CATEGORIES: readonly CategoryDefinition[] = [
  { id: 'us-east', label: 'US East', baseLatency: 62, peakRequests: 4200, utcOffsetHours: -5 },
  { id: 'eu-central', label: 'EU Central', baseLatency: 84, peakRequests: 3600, utcOffsetHours: 1 },
  { id: 'ap-south', label: 'AP South', baseLatency: 118, peakRequests: 5400, utcOffsetHours: 5.5 },
  { id: 'us-west', label: 'US West', baseLatency: 74, peakRequests: 3100, utcOffsetHours: -8 },
  { id: 'sa-east', label: 'SA East', baseLatency: 128, peakRequests: 1900, utcOffsetHours: -3 },
];

export const CATEGORY_COUNT = CATEGORIES.length;
export const ALL_CATEGORIES_MASK = (1 << CATEGORY_COUNT) - 1;

/** Fixed x-domain for the latency-vs-load scatter so the axis never jitters. */
export const REQUESTS_SCALE_MAX = 8000;

export const CHART_CONFIGS: readonly ChartConfig[] = [
  {
    id: 'latency-line',
    type: 'line',
    title: 'Latency by region',
    subtitle: 'Every raw sample, min/max decimated per device pixel',
    dataKey: 'value',
    unit: 'ms',
    visible: true,
    height: 340,
  },
  {
    id: 'throughput-bar',
    type: 'bar',
    title: 'Requests per bucket',
    subtitle: 'Stacked by region, grouped by the selected aggregation',
    dataKey: 'requests',
    unit: 'requests',
    visible: true,
    height: 300,
  },
  {
    id: 'latency-heatmap',
    type: 'heatmap',
    title: 'Latency distribution',
    subtitle: 'Sample count per time bucket and latency band (log colour scale)',
    dataKey: 'value',
    unit: 'samples',
    visible: true,
    height: 300,
  },
  {
    id: 'load-scatter',
    type: 'scatter',
    title: 'Latency vs load',
    subtitle: 'Every sample in view, shaded by overlap density',
    dataKey: 'value',
    unit: 'ms',
    visible: true,
    height: 320,
  },
];

export const AGGREGATION_OPTIONS: readonly { key: AggregationLevel; label: string; ms: number }[] = [
  { key: '1m', label: '1 min', ms: 60_000 },
  { key: '5m', label: '5 min', ms: 300_000 },
  { key: '1h', label: '1 hour', ms: 3_600_000 },
];

export const TIME_RANGE_OPTIONS: readonly { key: TimeRangeKey; label: string; ms: number }[] = [
  { key: '15m', label: '15m', ms: 15 * 60_000 },
  { key: '1h', label: '1h', ms: 3_600_000 },
  { key: '6h', label: '6h', ms: 6 * 3_600_000 },
  { key: '24h', label: '24h', ms: 24 * 3_600_000 },
  { key: 'all', label: 'All', ms: Number.POSITIVE_INFINITY },
];

export const LOAD_OPTIONS: readonly number[] = [5, 10, 50, 250, 1000, 2500];
export const WINDOW_OPTIONS: readonly number[] = [10_000, 50_000, 100_000, 250_000];

export const HEAT_BINS = 48;

export function aggregationMs(level: AggregationLevel): number {
  return AGGREGATION_OPTIONS.find((o) => o.key === level)?.ms ?? 60_000;
}

export function timeRangeMs(key: TimeRangeKey): number {
  return TIME_RANGE_OPTIONS.find((o) => o.key === key)?.ms ?? Number.POSITIVE_INFINITY;
}

export const DEFAULT_CONTROLS: DashboardControls = {
  filters: { categoryMask: ALL_CATEGORIES_MASK, valueMin: 0, valueMax: 1000 },
  aggregation: '5m',
  stream: { streaming: true, pointsPerTick: 10, windowSize: INITIAL_POINTS },
  stressMode: false,
  preStressStream: null,
};

export const STRESS_STREAM = { streaming: true, pointsPerTick: 1000, windowSize: 100_000 } as const;
