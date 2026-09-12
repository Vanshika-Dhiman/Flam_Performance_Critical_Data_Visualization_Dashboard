'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { CATEGORIES, CATEGORY_COUNT } from '@/lib/chartConfig';
import { formatDateTime, formatMs, localTzOffsetMs } from '@/lib/format';
import { LINE_MARGIN, createLineState, drawLineChart, nearestRowStart } from '@/lib/renderers/lineRenderer';
import { SvgAxis } from '@/lib/svgAxis';
import { TooltipController } from '@/lib/tooltip';
import type { ChartConfig } from '@/lib/types';
import { useChartInteractions, type HoverState } from '@/hooks/useChartInteractions';
import { useChartRenderer, type ChartRenderContext } from '@/hooks/useChartRenderer';
import { useControls, useDashboardCore } from '@/components/providers/DataProvider';
import { useTheme } from '@/components/providers/ThemeProvider';
import ChartFrame from './ChartFrame';
import SeriesLegend from './SeriesLegend';

const HINT = 'Drag to pan · Ctrl/⌘ + scroll or pinch to zoom · Shift + drag to select · Double-click for live';

/**
 * Canvas draws the data (thousands of vertices); SVG carries crisp text and the
 * interactive overlays (crosshair, selection brush). React renders this component when
 * its props, filters or theme change — never for data updates or pointer movement.
 */
function LineChart({ config }: { config: ChartConfig }) {
  const core = useDashboardCore();
  const { filters } = useControls();
  const { theme } = useTheme();

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const xAxisRef = useRef<SVGGElement>(null);
  const yAxisRef = useRef<SVGGElement>(null);
  const crosshairRef = useRef<SVGLineElement>(null);
  const brushRef = useRef<SVGRectElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hover = useRef<HoverState>({ active: false, x: 0, y: 0 });

  const [state] = useState(createLineState);
  const filtersRef = useRef(filters);
  const themeRef = useRef(theme);
  const overlay = useRef<{ x: SvgAxis; y: SvgAxis; tooltip: TooltipController; tz: number } | null>(null);
  const seen = useRef({ store: -1, viewport: -1 });

  useEffect(() => {
    overlay.current = {
      x: new SvgAxis(xAxisRef.current!, 'bottom'),
      y: new SvgAxis(yAxisRef.current!, 'left'),
      tooltip: new TooltipController(tooltipRef.current!),
      tz: localTzOffsetMs(),
    };
    return () => {
      overlay.current = null;
    };
  }, []);

  const needsDraw = useCallback(
    () => core.store.version !== seen.current.store || core.viewport.version !== seen.current.viewport,
    [core],
  );

  const draw = useCallback(
    ({ ctx, size, frame }: ChartRenderContext) => {
      const { store, viewport } = core;
      seen.current.store = store.version;
      seen.current.viewport = viewport.version;
      const ui = overlay.current;
      const currentTheme = themeRef.current;
      const currentFilters = filtersRef.current;

      const animating = drawLineChart(state, {
        ctx,
        size,
        store,
        start: viewport.start,
        end: viewport.end,
        filters: currentFilters,
        theme: currentTheme,
        dt: frame.dt,
        live: viewport.isLive,
        tzOffsetMs: ui?.tz ?? 0,
      });
      if (!ui) return animating;

      const plot = state.plot;
      ui.x.update(state.xPos, state.xTicks.labels, state.xTicks.values.length, plot.y + plot.h + 8, [0, size.width]);
      ui.y.update(state.yPos, state.yLabels, state.yTicks.length, plot.x - 8, [0, size.height]);

      const h = hover.current;
      const crosshair = crosshairRef.current;
      const span = viewport.end - viewport.start;
      if (h.active && crosshair && span > 0 && h.x >= plot.x && h.x <= plot.x + plot.w && h.y >= plot.y - 8 && h.y <= plot.y + plot.h + 4) {
        const row = nearestRowStart(store, viewport.start + ((h.x - plot.x) / plot.w) * span);
        if (row >= 0) {
          const rowTs = store.timestampAt(row);
          const x = Math.max(plot.x, Math.min(plot.x + plot.w, plot.x + ((rowTs - viewport.start) / span) * plot.w));
          crosshair.setAttribute('x1', String(x));
          crosshair.setAttribute('x2', String(x));
          crosshair.setAttribute('y1', String(plot.y));
          crosshair.setAttribute('y2', String(plot.y + plot.h));
          crosshair.removeAttribute('display');

          ui.tooltip.setHeader(formatDateTime(rowTs, true));
          let rows = 0;
          for (let i = row; i < Math.min(store.size, row + CATEGORY_COUNT * 2); i++) {
            const p = store.physical(i);
            if (store.timestamps[p] !== rowTs) break;
            const c = store.categories[p];
            if (((currentFilters.categoryMask >> c) & 1) === 0) continue;
            ui.tooltip.setRow(rows++, `${formatMs(store.values[p])} ms`, CATEGORIES[c].label, currentTheme.series[c], 'line');
          }
          ui.tooltip.setRowCount(rows);
          ui.tooltip.show(x, h.y, size.width, size.height);
          return animating;
        }
      }
      crosshair?.setAttribute('display', 'none');
      ui.tooltip.hide();
      return animating;
    },
    [core, state],
  );

  const { invalidate } = useChartRenderer({ canvasRef, containerRef, draw, needsDraw });

  useEffect(() => {
    filtersRef.current = filters;
    themeRef.current = theme;
    invalidate();
  }, [filters, theme, invalidate]);

  useChartInteractions({ targetRef: containerRef, margin: LINE_MARGIN, hover, invalidate, brushRef });

  return (
    <ChartFrame chart="line" title={`${config.title} (${config.unit})`} subtitle={config.subtitle} legend={<SeriesLegend shape="line" showValues />} hint={HINT}>
      <div
        ref={containerRef}
        className="chart-surface"
        style={{ height: config.height }}
        tabIndex={0}
        role="group"
        aria-roledescription="interactive chart"
        aria-label={`${config.title}. Arrow keys pan, plus and minus zoom, Escape returns to live. Values are listed in the data table.`}
      >
        <canvas ref={canvasRef} className="chart-canvas" />
        <svg className="chart-overlay" aria-hidden="true">
          <g ref={xAxisRef} />
          <g ref={yAxisRef} />
          <line ref={crosshairRef} className="crosshair" display="none" />
          <rect ref={brushRef} className="brush" display="none" />
        </svg>
        <div ref={tooltipRef} className="chart-tooltip" data-visible="false" />
      </div>
    </ChartFrame>
  );
}

export default memo(LineChart);
