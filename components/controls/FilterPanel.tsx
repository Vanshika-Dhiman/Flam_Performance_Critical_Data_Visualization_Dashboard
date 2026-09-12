'use client';

import { memo, useEffect, useState, useTransition } from 'react';
import { AGGREGATION_OPTIONS, ALL_CATEGORIES_MASK, CATEGORIES } from '@/lib/chartConfig';
import { useControls, useControlsDispatch } from '@/components/providers/DataProvider';

const VALUE_MAX = 1000;

/**
 * Region, latency-range and aggregation filters.
 *
 * Slider thumbs are driven by local state (urgent), while the global filter update is
 * dispatched inside startTransition: React may interrupt the resulting re-render of the
 * table if the user keeps dragging, so the slider itself never lags.
 */
function FilterPanel() {
  const { filters, aggregation } = useControls();
  const dispatch = useControlsDispatch();
  const [isPending, startTransition] = useTransition();
  const [range, setRange] = useState({ min: filters.valueMin, max: filters.valueMax });

  useEffect(() => {
    setRange({ min: filters.valueMin, max: filters.valueMax });
  }, [filters.valueMin, filters.valueMax]);

  const updateRange = (min: number, max: number) => {
    setRange({ min, max });
    startTransition(() => dispatch({ type: 'setValueRange', min, max }));
  };

  const allOn = filters.categoryMask === ALL_CATEGORIES_MASK;

  return (
    <div className="filter-panel" data-pending={isPending || undefined}>
      <fieldset className="field">
        <legend>Aggregation</legend>
        <div className="segmented" role="radiogroup" aria-label="Aggregation period">
          {AGGREGATION_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={aggregation === option.key}
              onClick={() => startTransition(() => dispatch({ type: 'setAggregation', level: option.key }))}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend>Regions</legend>
        <div className="chips">
          {CATEGORIES.map((category, index) => (
            <button
              key={category.id}
              type="button"
              className="chip"
              aria-pressed={((filters.categoryMask >> index) & 1) === 1}
              onClick={() => startTransition(() => dispatch({ type: 'toggleCategory', index }))}
            >
              <span className="legend-key legend-key-rect" style={{ background: `var(--s${index + 1})` }} aria-hidden="true" />
              {category.label}
            </button>
          ))}
          <button
            type="button"
            className="chip chip-ghost"
            disabled={allOn}
            onClick={() => startTransition(() => dispatch({ type: 'setCategoryMask', mask: ALL_CATEGORIES_MASK }))}
          >
            All
          </button>
        </div>
      </fieldset>

      <fieldset className="field range-field">
        <legend>
          Latency range <output className="range-output">{range.min}–{range.max >= VALUE_MAX ? `${VALUE_MAX}+` : range.max} ms</output>
        </legend>
        <div className="range-inputs">
          <label>
            <span className="visually-hidden">Minimum latency</span>
            <input
              type="range"
              min={0}
              max={VALUE_MAX}
              step={10}
              value={range.min}
              onChange={(e) => updateRange(Math.min(Number(e.target.value), range.max - 10), range.max)}
            />
          </label>
          <label>
            <span className="visually-hidden">Maximum latency</span>
            <input
              type="range"
              min={0}
              max={VALUE_MAX}
              step={10}
              value={range.max}
              onChange={(e) => updateRange(range.min, Math.max(Number(e.target.value), range.min + 10))}
            />
          </label>
        </div>
      </fieldset>

      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => startTransition(() => dispatch({ type: 'resetFilters' }))}
      >
        Reset filters
      </button>
    </div>
  );
}

export default memo(FilterPanel);
