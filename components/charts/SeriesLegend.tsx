'use client';

import { memo } from 'react';
import { CATEGORIES } from '@/lib/chartConfig';
import { formatMs } from '@/lib/format';
import { useControls, useControlsDispatch, useDashboardCore } from '@/components/providers/DataProvider';
import { useUiTick } from '@/hooks/useUiTick';

interface SeriesLegendProps {
  shape: 'line' | 'rect';
  showValues?: boolean;
}

/**
 * Legend doubling as the region filter. Colour comes from CSS variables so the swatches
 * are correct on first paint in either theme; identity is also carried by the label.
 */
function SeriesLegend({ shape, showValues = false }: SeriesLegendProps) {
  const { filters } = useControls();
  const dispatch = useControlsDispatch();

  return (
    <ul className="legend" aria-label="Regions (click to toggle)">
      {CATEGORIES.map((category, index) => {
        const active = ((filters.categoryMask >> index) & 1) === 1;
        return (
          <li key={category.id}>
            <button
              type="button"
              className="legend-item"
              aria-pressed={active}
              onClick={(event) =>
                dispatch(event.altKey || event.metaKey ? { type: 'soloCategory', index } : { type: 'toggleCategory', index })
              }
              title="Click to toggle, Alt/⌘-click to show only this region"
            >
              <span className={`legend-key legend-key-${shape}`} style={{ background: `var(--s${index + 1})` }} aria-hidden="true" />
              <span className="legend-label">{category.label}</span>
              {showValues ? <LegendValue index={index} /> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Mean latency in view; the only part of the legend that re-renders (≤4 Hz). */
const LegendValue = memo(function LegendValue({ index }: { index: number }) {
  useUiTick();
  const { engine } = useDashboardCore();
  const stats = engine.latest?.stats[index];
  return <span className="legend-value">{stats && stats.count > 0 ? `${formatMs(stats.mean)} ms` : '—'}</span>;
});

export default memo(SeriesLegend);
