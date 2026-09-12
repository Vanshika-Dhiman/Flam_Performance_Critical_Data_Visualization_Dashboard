import type { ChartConfig, ChartType } from '@/lib/types';
import BarChart from './charts/BarChart';
import Heatmap from './charts/Heatmap';
import LineChart from './charts/LineChart';
import ScatterPlot from './charts/ScatterPlot';
import FilterPanel from './controls/FilterPanel';
import LoadControls from './controls/LoadControls';
import TimeRangeSelector from './controls/TimeRangeSelector';
import ChartErrorBoundary from './ui/ChartErrorBoundary';
import DataTable from './ui/DataTable';
import PerformanceMonitor from './ui/PerformanceMonitor';
import StatsBar from './ui/StatsBar';

/**
 * Server Component. It holds no state and ships no JavaScript of its own: it only lays
 * out the client "islands" (charts, controls) and passes them serialisable config. The
 * interactive leaves hydrate; this layout markup does not.
 */
export default function Dashboard({ configs }: { configs: readonly ChartConfig[] }) {
  const find = (type: ChartType) => configs.find((c) => c.type === type && c.visible);
  const line = find('line');
  const bar = find('bar');
  const heatmap = find('heatmap');
  const scatter = find('scatter');

  return (
    <>
      <section className="deck" aria-label="Data stream and performance">
        <LoadControls />
        <PerformanceMonitor />
      </section>

      <section className="filter-row card" aria-label="Filters (apply to every chart and the table)">
        <TimeRangeSelector />
        <FilterPanel />
      </section>

      <StatsBar />

      <div className="chart-grid">
        {line ? (
          <ChartErrorBoundary name={line.title}>
            <LineChart config={line} />
          </ChartErrorBoundary>
        ) : null}
        {bar ? (
          <ChartErrorBoundary name={bar.title}>
            <BarChart config={bar} />
          </ChartErrorBoundary>
        ) : null}
        {heatmap ? (
          <ChartErrorBoundary name={heatmap.title}>
            <Heatmap config={heatmap} />
          </ChartErrorBoundary>
        ) : null}
        {scatter ? (
          <ChartErrorBoundary name={scatter.title}>
            <ScatterPlot config={scatter} />
          </ChartErrorBoundary>
        ) : null}
        <ChartErrorBoundary name="Data table">
          <DataTable />
        </ChartErrorBoundary>
      </div>
    </>
  );
}
