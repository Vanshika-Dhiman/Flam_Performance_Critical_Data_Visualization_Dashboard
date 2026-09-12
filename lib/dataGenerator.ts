import { CATEGORIES, CATEGORY_COUNT, SAMPLE_INTERVAL_MS } from './chartConfig';
import type { TimeSeriesStore } from './ringBuffer';
import type { GeneratorState } from './types';

/**
 * Realistic, deterministic time-series generator (no Node APIs, so it runs in Server
 * Components, the edge Route Handler and the browser).
 *
 * Model per region, per 10 s sample:
 *   requests = peak * diurnalTraffic(localHour) * (1 + 6% noise), +25% during incidents
 *   latency  = base * (0.55 + 0.45 / (1 - utilisation))   // queueing curve
 *            + OU noise + right-skewed jitter, x incident multiplier
 *
 * The large-scale shape depends only on the timestamp, so a history generated on the
 * server lines up with the live stream on the client, and backfilled chunks join the
 * existing buffer without visible seams. The PRNG state is serialisable, which is how
 * the client resumes exactly where the Server Component stopped.
 */

const HOUR_MS = 3_600_000;
const TWO_PI = Math.PI * 2;
const WARMUP_ROWS = 60;

export function seedFromTime(time: number): number {
  let h = (Math.floor(time / 60_000) ^ 0x9e3779b9) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export function createGenerator(seed: number, startTime: number): GeneratorState {
  return {
    rng: seed | 0,
    nextTimestamp: startTime,
    levels: new Array<number>(CATEGORY_COUNT).fill(0),
    incidentLeft: new Array<number>(CATEGORY_COUNT).fill(0),
    incidentMagnitude: new Array<number>(CATEGORY_COUNT).fill(1),
  };
}

/** mulberry32: tiny, fast, good enough statistical quality, 32-bit serialisable state. */
function random(state: GeneratorState): number {
  let t = (state.rng = (state.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function gaussian(state: GeneratorState): number {
  const u = 1 - random(state);
  const v = random(state);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TWO_PI * v);
}

/** Share of peak traffic (≈0.22..1.0) for a region at a UTC timestamp. */
export function trafficFactor(timestamp: number, utcOffsetHours: number): number {
  const localHour = (((timestamp / HOUR_MS + utcOffsetHours) % 24) + 24) % 24;
  const day = 0.5 - 0.5 * Math.cos((TWO_PI * (localHour - 4)) / 24);
  const evening = 0.08 * Math.exp(-((localHour - 21) ** 2) / 3);
  return 0.22 + 0.7 * day + evening;
}

/**
 * Generate one row (one sample per region) into `values` / `requests` at `offset`.
 * Returns the row timestamp. Allocation-free.
 */
export function nextRow(
  state: GeneratorState,
  values: Float32Array,
  requests: Float32Array,
  offset: number,
): number {
  const ts = state.nextTimestamp;
  for (let c = 0; c < CATEGORY_COUNT; c++) {
    const def = CATEGORIES[c];

    if (state.incidentLeft[c] > 0) {
      state.incidentLeft[c]--;
    } else if (random(state) < 0.0009) {
      state.incidentLeft[c] = 6 + Math.floor(random(state) * 40);
      state.incidentMagnitude[c] = 1.6 + random(state) * 2.2;
    }
    const incident = state.incidentLeft[c] > 0 ? state.incidentMagnitude[c] : 1;

    let req = def.peakRequests * trafficFactor(ts, def.utcOffsetHours) * (1 + 0.06 * gaussian(state));
    if (incident > 1) req *= 1.25;

    const level = state.levels[c] * 0.92 + gaussian(state) * def.baseLatency * 0.045;
    state.levels[c] = level;

    const utilisation = Math.min(0.95, Math.max(0, req / (def.peakRequests * 1.35)));
    let latency = def.baseLatency * (0.55 + 0.45 / (1 - utilisation)) + level;
    latency += Math.abs(gaussian(state)) * def.baseLatency * 0.08;
    latency *= incident;

    values[offset + c] = latency < 4 ? 4 : latency;
    requests[offset + c] = req < 0 ? 0 : Math.round(req);
  }
  state.nextTimestamp = ts + SAMPLE_INTERVAL_MS;
  return ts;
}

const rowValues = new Float32Array(CATEGORY_COUNT);
const rowRequests = new Float32Array(CATEGORY_COUNT);

/** Append `rows` rows straight into the ring buffer (no intermediate objects). */
export function generateIntoStore(state: GeneratorState, store: TimeSeriesStore, rows: number): number {
  for (let r = 0; r < rows; r++) {
    const ts = nextRow(state, rowValues, rowRequests, 0);
    for (let c = 0; c < CATEGORY_COUNT; c++) {
      store.push(ts, rowValues[c], rowRequests[c], c);
    }
  }
  return rows * CATEGORY_COUNT;
}

export interface GeneratedHistory {
  rows: number;
  startTime: number;
  values: Float32Array;
  requests: Float32Array;
  state: GeneratorState;
}

/**
 * History of `points` samples ending just before `endTime` (exclusive), i.e. the last
 * row is at endTime - interval. Deterministic for a given (points, endTime, seed).
 */
export function generateHistory(points: number, endTime: number, seed = seedFromTime(endTime)): GeneratedHistory {
  const rows = Math.max(1, Math.ceil(points / CATEGORY_COUNT));
  const alignedEnd = Math.floor(endTime / SAMPLE_INTERVAL_MS) * SAMPLE_INTERVAL_MS;
  const startTime = alignedEnd - rows * SAMPLE_INTERVAL_MS;
  const state = createGenerator(seed, startTime - WARMUP_ROWS * SAMPLE_INTERVAL_MS);

  const scratchV = new Float32Array(CATEGORY_COUNT);
  const scratchR = new Float32Array(CATEGORY_COUNT);
  for (let r = 0; r < WARMUP_ROWS; r++) nextRow(state, scratchV, scratchR, 0);

  const values = new Float32Array(rows * CATEGORY_COUNT);
  const requests = new Float32Array(rows * CATEGORY_COUNT);
  for (let r = 0; r < rows; r++) nextRow(state, values, requests, r * CATEGORY_COUNT);

  return { rows, startTime, values, requests, state };
}
