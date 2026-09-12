'use client';

import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ALL_CATEGORIES_MASK, CATEGORIES } from '@/lib/chartConfig';
import { formatDateTime, formatInt, formatMs } from '@/lib/format';
import { latencyStatus, type TimeSeriesStore } from '@/lib/ringBuffer';
import type { FilterState, LatencyStatus } from '@/lib/types';
import { useControls, useDashboardCore } from '@/components/providers/DataProvider';
import { useIsClient } from '@/hooks/useIsClient';
import { useUiTick } from '@/hooks/useUiTick';
import { useVirtualization } from '@/hooks/useVirtualization';

const ROW_HEIGHT = 34;
const VALUE_FILTER_MAX = 1000;

interface TableIndex {
  /** Sequence numbers of matching rows, newest first; null = unfiltered (seq = head - 1 - i). */
  seqs: Float64Array | null;
  count: number;
  head: number;
}

function isUnfiltered(filters: FilterState): boolean {
  return filters.categoryMask === ALL_CATEGORIES_MASK && filters.valueMin <= 0 && filters.valueMax >= VALUE_FILTER_MAX;
}

function buildIndex(store: TimeSeriesStore, filters: FilterState, scratch: { buffer: Float64Array }): TableIndex {
  if (isUnfiltered(filters)) return { seqs: null, count: store.size, head: store.head };
  if (scratch.buffer.length < store.size) scratch.buffer = new Float64Array(store.capacity);
  const seqs = scratch.buffer;
  const { values, categories } = store;
  let count = 0;
  for (let logical = store.size - 1; logical >= 0; logical--) {
    const p = store.physical(logical);
    if (((filters.categoryMask >> categories[p]) & 1) === 0) continue;
    const v = values[p];
    if (v < filters.valueMin || v > filters.valueMax) continue;
    seqs[count++] = store.head - store.size + logical;
  }
  return { seqs, count, head: store.head };
}

/** Returns `value` while unfrozen, and the last unfrozen value while frozen. */
function useFreezable<T>(value: T, frozen: boolean): T {
  const [held, setHeld] = useState(value);
  useEffect(() => {
    if (!frozen) setHeld(value);
  }, [value, frozen]);
  return frozen ? held : value;
}

const STATUS_LABEL: Record<LatencyStatus, string> = { ok: 'OK', warning: 'Slow', critical: 'Over SLO' };
const STATUS_ICON: Record<LatencyStatus, string> = { ok: '✓', warning: '!', critical: '✕' };

interface RowProps {
  top: number;
  seq: number;
  evicted: boolean;
  timestamp: number;
  value: number;
  requests: number;
  category: number;
  showTime: boolean;
}

const TableRow = memo(function TableRow({ top, evicted, timestamp, value, requests, category, showTime }: RowProps) {
  if (evicted) {
    return (
      <div className="table-row table-row-evicted" role="row" style={{ transform: `translateY(${top}px)` }}>
        <span role="cell">Evicted from the buffer</span>
      </div>
    );
  }
  const status = latencyStatus(value);
  return (
    <div className="table-row" role="row" style={{ transform: `translateY(${top}px)` }}>
      <span role="cell" className="cell-time">{showTime ? formatDateTime(timestamp, true) : '—'}</span>
      <span role="cell" className="cell-region">
        <span className="legend-key legend-key-rect" style={{ background: `var(--s${category + 1})` }} aria-hidden="true" />
        {CATEGORIES[category]?.label}
      </span>
      <span role="cell" className="cell-num">{formatMs(value)}</span>
      <span role="cell" className="cell-num cell-requests">{formatInt(requests)}</span>
      <span role="cell" className={`status status-${status}`}>
        <span className="status-icon" aria-hidden="true">{STATUS_ICON[status]}</span>
        {STATUS_LABEL[status]}
      </span>
    </div>
  );
});

/**
 * Virtualised raw-sample table (the accessible text alternative to the charts).
 *
 * - Only visible rows (+ overscan) are mounted; each row is memoised by primitive props.
 * - Filters are read through useDeferredValue: typing/dragging stays responsive while
 *   the re-index of up to 250k rows renders at lower priority (the stale list is dimmed).
 * - Follows the stream at ≤4 Hz while scrolled to the top. Scrolling down freezes the
 *   snapshot (rows stop jumping) and offers a "jump to latest" pill.
 */
function DataTable() {
  const core = useDashboardCore();
  const { filters, stream } = useControls();
  const deferredFilters = useDeferredValue(filters);
  const stale = deferredFilters !== filters;
  const tick = useUiTick();
  const isClient = useIsClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const [scratch] = useState(() => ({ buffer: new Float64Array(0) }));

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const next = el.scrollTop < ROW_HEIGHT;
      setFollowing((prev) => (prev === next ? prev : next));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const snapshotTick = useFreezable(tick, !following);
  const index = useMemo(
    () => buildIndex(core.store, deferredFilters, scratch),
    // snapshotTick / windowSize are the triggers that the mutable store changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [core, deferredFilters, scratch, snapshotTick, stream.windowSize],
  );

  const { range, scrollToTop } = useVirtualization({ scrollRef, itemCount: index.count, itemHeight: ROW_HEIGHT });
  const store = core.store;
  const newRows = following ? 0 : Math.max(0, store.head - index.head);

  const rows = [];
  for (let i = range.start; i < range.end; i++) {
    const seq = index.seqs ? index.seqs[i] : index.head - 1 - i;
    const p = store.seqToPhysical(seq);
    rows.push(
      <TableRow
        key={seq}
        top={i * ROW_HEIGHT}
        seq={seq}
        evicted={p < 0}
        timestamp={p < 0 ? 0 : store.timestamps[p]}
        value={p < 0 ? 0 : store.values[p]}
        requests={p < 0 ? 0 : store.requests[p]}
        category={p < 0 ? 0 : store.categories[p]}
        showTime={isClient}
      />,
    );
  }

  return (
    <section className="card chart-card table-card" data-chart="table" aria-labelledby="table-title">
      <header className="card-header">
        <div className="card-titles">
          <h2 id="table-title">Raw samples</h2>
          <p className="card-subtitle">
            {formatInt(index.count)} rows · newest first · virtualised ({Math.max(0, range.end - range.start)} rows in the DOM)
          </p>
        </div>
        {newRows > 0 ? (
          <button type="button" className="btn btn-primary btn-small" onClick={scrollToTop}>
            ↑ {formatInt(newRows)} new
          </button>
        ) : null}
      </header>
      <div className="table" role="table" aria-rowcount={index.count + 1} aria-busy={stale}>
        <div className="table-row table-head" role="row">
          <span role="columnheader">Time</span>
          <span role="columnheader">Region</span>
          <span role="columnheader" className="cell-num">Latency ms</span>
          <span role="columnheader" className="cell-num cell-requests">Requests</span>
          <span role="columnheader">Status</span>
        </div>
        <div ref={scrollRef} className="table-scroll" data-stale={stale || undefined} tabIndex={0} aria-label="Sample rows, scrollable">
          <div className="table-spacer" style={{ height: range.totalHeight }}>
            {rows}
          </div>
        </div>
      </div>
    </section>
  );
}

export default memo(DataTable);
