import { CATEGORY_COUNT, SAMPLE_INTERVAL_MS } from './chartConfig';
import type { ColumnsView } from './types';

/**
 * Compact wire formats.
 *
 * 10k DataPoint objects as JSON are ~1.2 MB (the JSON API returns 588 KB for 5k). Latency quantised to 0.1 ms and request
 * counts both fit in Uint16, timestamps and categories are implied by (startTime, row,
 * column), so the same data is 40 KB of bytes (~54 KB base64) in the RSC payload and
 * 40 KB + 16 B over the binary API.
 */

const LATENCY_SCALE = 10;

function clampU16(v: number): number {
  return v < 0 ? 0 : v > 65535 ? 65535 : Math.round(v);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function quantizeLatency(values: Float32Array): Uint16Array {
  const out = new Uint16Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = clampU16(values[i] * LATENCY_SCALE);
  return out;
}

export function quantizeRequests(requests: Float32Array): Uint16Array {
  const out = new Uint16Array(requests.length);
  for (let i = 0; i < requests.length; i++) out[i] = clampU16(requests[i]);
  return out;
}

export function encodeColumnsBase64(values: Float32Array, requests: Float32Array): { values: string; requests: string } {
  const v = quantizeLatency(values);
  const r = quantizeRequests(requests);
  return {
    values: bytesToBase64(new Uint8Array(v.buffer)),
    requests: bytesToBase64(new Uint8Array(r.buffer)),
  };
}

/** Expand row-major Uint16 columns back into full columns with implied time/category. */
export function expandColumns(
  valuesU16: Uint16Array,
  requestsU16: Uint16Array,
  startTime: number,
  categories = CATEGORY_COUNT,
  intervalMs = SAMPLE_INTERVAL_MS,
): ColumnsView {
  const length = Math.min(valuesU16.length, requestsU16.length);
  const cols: ColumnsView = {
    timestamps: new Float64Array(length),
    values: new Float32Array(length),
    requests: new Float32Array(length),
    categories: new Uint8Array(length),
    length,
  };
  for (let i = 0; i < length; i++) {
    const row = Math.floor(i / categories);
    cols.timestamps[i] = startTime + row * intervalMs;
    cols.values[i] = valuesU16[i] / LATENCY_SCALE;
    cols.requests[i] = requestsU16[i];
    cols.categories[i] = i % categories;
  }
  return cols;
}

export function decodeBase64Columns(values: string, requests: string, startTime: number, categories: number, intervalMs: number): ColumnsView {
  const vb = base64ToBytes(values);
  const rb = base64ToBytes(requests);
  return expandColumns(
    new Uint16Array(vb.buffer, 0, vb.byteLength >> 1),
    new Uint16Array(rb.buffer, 0, rb.byteLength >> 1),
    startTime,
    categories,
    intervalMs,
  );
}

/**
 * Binary history format (little-endian):
 *   0  Float64 startTime
 *   8  Uint32  rows
 *   12 Uint16  categories
 *   14 Uint16  interval in seconds
 *   16 Uint16[rows*categories] latency x10
 *   .. Uint16[rows*categories] requests
 */
export function encodeBinaryHistory(startTime: number, rows: number, values: Float32Array, requests: Float32Array): ArrayBuffer {
  const n = rows * CATEGORY_COUNT;
  const buffer = new ArrayBuffer(16 + n * 4);
  const view = new DataView(buffer);
  view.setFloat64(0, startTime, true);
  view.setUint32(8, rows, true);
  view.setUint16(12, CATEGORY_COUNT, true);
  view.setUint16(14, SAMPLE_INTERVAL_MS / 1000, true);
  new Uint16Array(buffer, 16, n).set(quantizeLatency(values));
  new Uint16Array(buffer, 16 + n * 2, n).set(quantizeRequests(requests));
  return buffer;
}

export function decodeBinaryHistory(buffer: ArrayBuffer): ColumnsView {
  if (buffer.byteLength < 16) throw new Error('History payload too short');
  const view = new DataView(buffer);
  const startTime = view.getFloat64(0, true);
  const rows = view.getUint32(8, true);
  const categories = view.getUint16(12, true);
  const intervalMs = view.getUint16(14, true) * 1000;
  const n = rows * categories;
  if (buffer.byteLength < 16 + n * 4) throw new Error('History payload truncated');
  return expandColumns(new Uint16Array(buffer, 16, n), new Uint16Array(buffer, 16 + n * 2, n), startTime, categories, intervalMs);
}
