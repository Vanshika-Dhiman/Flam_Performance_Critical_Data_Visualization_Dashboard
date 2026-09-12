import { useId, type ReactNode } from 'react';
import type { ChartType } from '@/lib/types';

interface ChartFrameProps {
  chart: ChartType | 'table';
  title: string;
  subtitle: string;
  legend?: ReactNode;
  actions?: ReactNode;
  hint?: string;
  children: ReactNode;
}

/** Card chrome shared by every chart: title, subtitle, legend row, body, hint. */
export default function ChartFrame({ chart, title, subtitle, legend, actions, hint, children }: ChartFrameProps) {
  const headingId = useId();
  return (
    <section className="card chart-card" data-chart={chart} aria-labelledby={headingId}>
      <header className="card-header">
        <div className="card-titles">
          <h2 id={headingId}>{title}</h2>
          <p className="card-subtitle">{subtitle}</p>
        </div>
        {actions}
      </header>
      {legend ? <div className="legend-row">{legend}</div> : null}
      {children}
      {hint ? <p className="chart-hint">{hint}</p> : null}
    </section>
  );
}
