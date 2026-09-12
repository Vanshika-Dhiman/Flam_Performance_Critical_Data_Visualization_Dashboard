import {
  aggregate,
  columnBuffers,
  createBufferPool,
  resultBuffers,
  type WorkerAggregateRequest,
  type WorkerResponse,
} from '../lib/aggregation';

/**
 * Aggregation worker. Receives a transferred snapshot of the ring buffer, returns the
 * aggregates plus the snapshot buffers themselves (ping-pong transfer), so neither side
 * allocates per update once warmed up.
 */

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerAggregateRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
const pool = createBufferPool();

scope.onmessage = (event) => {
  const msg = event.data;
  if (!msg || msg.type !== 'aggregate') return;
  for (const buffer of msg.recycle) pool.release(buffer);

  try {
    const result = aggregate(msg.columns, msg.params, msg.id, pool);
    scope.postMessage({ type: 'result', id: msg.id, result, columns: msg.columns }, [
      ...columnBuffers(msg.columns),
      ...resultBuffers(result),
    ]);
  } catch (error) {
    scope.postMessage(
      { type: 'error', id: msg.id, message: error instanceof Error ? error.message : String(error), columns: msg.columns },
      columnBuffers(msg.columns),
    );
  }
};
