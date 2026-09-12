'use client';

import { memo } from 'react';
import { SLO_MS } from '@/lib/chartConfig';
import { formatCompact, formatInt, formatMs } from '@/lib/format';
import { useDashboardCore } from '@/components/providers/DataProvider';
import { useUiTick } from '@/hooks/useUiTick';

function Tile({ label, value, detail, status }: { label: string; value: string; detail?: string; status?: 'ok' | 'warning' | 'critical' }) {
  return (
    <div className="stat-tile">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {detail ? (
        <span className={status ? `status status-${status}` : 'stat-detail'}>
          {status ? <span className="status-icon" aria-hidden="true">{status === 'ok' ? '✓' : status === 'warning' ? '!' : '✕'}</span> : null}
          {detail}
        </span>
      ) : null}
    </div>
  );
}

/** Summary of the samples in the current view, computed by the aggregation worker. */
function StatsBar() {
  useUiTick();
  const { engine } = useDashboardCore();
  const total = engine.latest?.total;
  const has = !!total && total.count > 0;
  const overShare = has ? (total.overSlo / total.count) * 100 : Number.NaN;
  const status = !has ? undefined : overShare < 2 ? 'ok' : overShare < 10 ? 'warning' : 'critical';
  const throughput = has && total.spanMs > 0 ? total.requests / (total.spanMs / 1000) : Number.NaN;

  return (
    <section className="stats-bar" aria-label="Summary for the visible time range" aria-live="off">
      <Tile label="Samples in view" value={has ? formatInt(total.count) : '—'} detail="after filters" />
      <Tile label="Mean latency" value={has ? `${formatMs(total.mean)} ms` : '—'} detail={has ? `min ${formatMs(total.min)} · max ${formatMs(total.max)}` : undefined} />
      <Tile label="p95 latency" value={has ? `${formatMs(total.p95)} ms` : '—'} detail="95th percentile" />
      <Tile label="Throughput" value={has ? `${formatCompact(throughput)} req/s` : '—'} detail="all visible regions" />
      <Tile
        label={`Over ${SLO_MS} ms SLO`}
        value={has ? `${overShare.toFixed(1)}%` : '—'}
        detail={status === 'ok' ? 'Healthy' : status === 'warning' ? 'Degraded' : status === 'critical' ? 'Breaching' : undefined}
        status={status}
      />
    </section>
  );
}

export default memo(StatsBar);
