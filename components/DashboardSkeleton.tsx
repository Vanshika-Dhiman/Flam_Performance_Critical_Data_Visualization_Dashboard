import { CHART_CONFIGS } from '@/lib/chartConfig';

/**
 * Streaming fallback. Mirrors the real layout's dimensions (chart heights come from the
 * same static config), so swapping it for the dashboard causes no layout shift.
 */
export default function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard">
      <section className="deck">
        <div className="card skeleton-card" style={{ height: 196 }} />
        <div className="card skeleton-card" style={{ height: 196 }} />
      </section>
      <div className="card skeleton-card filter-row" style={{ height: 92 }} />
      <section className="stats-bar">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="stat-tile skeleton-card" style={{ height: 88 }} />
        ))}
      </section>
      <div className="chart-grid">
        {CHART_CONFIGS.map((config) => (
          <section key={config.id} className="card chart-card" data-chart={config.type}>
            <div className="skeleton-line" style={{ width: '40%' }} />
            <div className="skeleton-line" style={{ width: '65%', opacity: 0.6 }} />
            <div className="skeleton-block" style={{ height: config.height }} />
          </section>
        ))}
        <section className="card chart-card" data-chart="table">
          <div className="skeleton-line" style={{ width: '30%' }} />
          <div className="skeleton-block" style={{ height: 360 }} />
        </section>
      </div>
    </div>
  );
}
