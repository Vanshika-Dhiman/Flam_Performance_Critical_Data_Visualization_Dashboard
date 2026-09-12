'use client';

import { memo, useSyncExternalStore } from 'react';
import { TIME_RANGE_OPTIONS } from '@/lib/chartConfig';
import { formatDuration } from '@/lib/format';
import { useDashboardCore } from '@/components/providers/DataProvider';

/**
 * Time range presets + live/paused state. Subscribes only to viewport *mode* changes,
 * so panning and zooming (which move the domain every frame) don't re-render it.
 */
function TimeRangeSelector() {
  const { viewport, store, engine } = useDashboardCore();
  const snapshot = useSyncExternalStore(viewport.subscribe, viewport.getSnapshot, viewport.getSnapshot);
  const live = snapshot.mode === 'live';
  const presetActive = TIME_RANGE_OPTIONS.some((o) => o.ms === snapshot.rangeMs);

  const zoom = (factor: number) => {
    const center = live ? viewport.end : (viewport.start + viewport.end) / 2;
    viewport.zoom(center, factor, store.firstTimestamp(), store.lastTimestamp());
    engine.request();
  };

  return (
    <div className="time-range">
      <fieldset className="field">
        <legend>Time range</legend>
        <div className="segmented" role="radiogroup" aria-label="Visible time range">
          {TIME_RANGE_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={live && snapshot.rangeMs === option.ms}
              onClick={() => {
                viewport.setRange(option.ms);
                engine.request(true);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <span className="field-label">View</span>
        <div className="view-controls">
          <button type="button" className="btn btn-icon" onClick={() => zoom(0.7)} aria-label="Zoom in">
            +
          </button>
          <button type="button" className="btn btn-icon" onClick={() => zoom(1.4)} aria-label="Zoom out">
            −
          </button>
          {live ? (
            <span className="live-pill" role="status">
              <span className="live-dot" aria-hidden="true" />
              Live{!presetActive ? ` · ${formatDuration(snapshot.rangeMs)}` : ''}
            </span>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                viewport.goLive();
                engine.request(true);
              }}
            >
              Resume live
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(TimeRangeSelector);
