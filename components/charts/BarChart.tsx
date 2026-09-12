'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AGGREGATION_OPTIONS, CATEGORIES } from '@/lib/chartConfig';
import { formatDateTime, formatInt, localTzOffsetMs } from '@/lib/format';
import { BAR_MARGIN, createBarState, drawBarChart } from '@/lib/renderers/barRenderer';
import { SvgAxis } from '@/lib/svgAxis';
import { TooltipController } from '@/lib/tooltip';
import type { ChartConfig } from '@/lib/types';
import { useChartInteractions, type HoverState } from '@/hooks/useChartInteractions';
import { useChartRenderer, type ChartRenderContext } from '@/hooks/useChartRenderer';
import { useControls, useDashboardCore } from '@/components/providers/DataProvider';
import { useTheme } from '@/components/providers/ThemeProvider';
import ChartFrame from './ChartFrame';
import SeriesLegend from './SeriesLegend';

function BarChart({ config }: { config: ChartConfig }) {
  const core = useDashboardCore();
  const { filters, aggregation } = useControls();
  const { theme } = useTheme();

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const xAxisRef = useRef<SVGGElement>(null);
  const yAxisRef = useRef<SVGGElement>(null);
  const brushRef = useRef<SVGRectElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hover = useRef<HoverState>({ active: false, x: 0, y: 0 });

  const [state] = useState(() => createBarState(CATEGORIES.length));
  const filtersRef = useRef(filters);
  const themeRef = useRef(theme);
  const overlay = useRef<{ x: SvgAxis; y: SvgAxis; tooltip: TooltipController; tz: number } | null>(null);
  const seen = useRef({ engine: -1, viewport: -1 });

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
    () => core.engine.version !== seen.current.engine || core.viewport.version !== seen.current.viewport,
    [core],
  );

  const draw = useCallback(
    ({ ctx, size, frame }: ChartRenderContext) => {
      const { engine, viewport } = core;
      seen.current.engine = engine.version;
      seen.current.viewport = viewport.version;
      const ui = overlay.current;
      const h = hover.current;
      const currentTheme = themeRef.current;

      const animating = drawBarChart(state, {
        ctx,
        size,
        result: engine.latest,
        start: viewport.start,
        end: viewport.end,
        filters: filtersRef.current,
        theme: currentTheme,
        dt: frame.dt,
        tzOffsetMs: ui?.tz ?? 0,
        hoverX: h.active ? h.x : null,
      });
      if (!ui) return animating;

      const plot = state.plot;
      ui.x.update(state.xPos, state.xTicks.labels, state.xTicks.values.length, plot.y + plot.h + 8, [0, size.width]);
      ui.y.update(state.yPos, state.yLabels, state.yTicks.length, plot.x - 8, [0, size.height]);

      const info = state.hover;
      if (h.active && info.active && h.y >= plot.y && h.y <= plot.y + plot.h) {
        ui.tooltip.setHeader(`${formatDateTime(info.groupStart)} – ${formatDateTime(info.groupEnd)}${info.partial ? ' (filling)' : ''}`);
        let rows = 0;
        let total = 0;
        const mask = filtersRef.current.categoryMask;
        for (let c = CATEGORIES.length - 1; c >= 0; c--) {
          if (((mask >> c) & 1) === 0) continue;
          total += info.sums[c];
          ui.tooltip.setRow(rows++, formatInt(info.sums[c]), CATEGORIES[c].label, currentTheme.series[c], 'rect');
        }
        ui.tooltip.setRow(rows++, formatInt(total), 'Total requests', 'transparent', 'none');
        ui.tooltip.setRowCount(rows);
        ui.tooltip.show(h.x, h.y, size.width, size.height);
      } else {
        ui.tooltip.hide();
      }
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

  useChartInteractions({ targetRef: containerRef, margin: BAR_MARGIN, hover, invalidate, brushRef });

  const bucketLabel = AGGREGATION_OPTIONS.find((o) => o.key === aggregation)?.label ?? aggregation;

  return (
    <ChartFrame
      chart="bar"
      title={config.title}
      subtitle={`${config.subtitle} · ${bucketLabel} buckets`}
      legend={<SeriesLegend shape="rect" />}
    >
      <div
        ref={containerRef}
        className="chart-surface"
        style={{ height: config.height }}
        tabIndex={0}
        role="group"
        aria-roledescription="interactive chart"
        aria-label={`${config.title}, ${bucketLabel} buckets, stacked by region.`}
      >
        <canvas ref={canvasRef} className="chart-canvas" />
        <svg className="chart-overlay" aria-hidden="true">
          <g ref={xAxisRef} />
          <g ref={yAxisRef} />
          <rect ref={brushRef} className="brush" display="none" />
        </svg>
        <div ref={tooltipRef} className="chart-tooltip" data-visible="false" />
      </div>
    </ChartFrame>
  );
}

export default memo(BarChart);
