'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { formatCompact, formatInt } from '@/lib/format';
import { SCATTER_MARGIN, createScatterState, drawScatter } from '@/lib/renderers/scatterRenderer';
import { SvgAxis } from '@/lib/svgAxis';
import { TooltipController } from '@/lib/tooltip';
import type { ChartConfig } from '@/lib/types';
import { useChartInteractions, type HoverState } from '@/hooks/useChartInteractions';
import { useChartRenderer, type ChartRenderContext } from '@/hooks/useChartRenderer';
import { useControls, useDashboardCore } from '@/components/providers/DataProvider';
import { useTheme } from '@/components/providers/ThemeProvider';
import ChartFrame from './ChartFrame';

function ScatterPlot({ config }: { config: ChartConfig }) {
  const core = useDashboardCore();
  const { filters, stream } = useControls();
  const { theme } = useTheme();

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const xAxisRef = useRef<SVGGElement>(null);
  const yAxisRef = useRef<SVGGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hover = useRef<HoverState>({ active: false, x: 0, y: 0 });

  const [state] = useState(createScatterState);
  const filtersRef = useRef(filters);
  const themeRef = useRef(theme);
  const highlightRef = useRef(stream.pointsPerTick);
  const overlay = useRef<{ x: SvgAxis; y: SvgAxis; tooltip: TooltipController } | null>(null);
  const seen = useRef({ store: -1 });
  const range = useRef({ i0: 0, i1: 0 });

  useEffect(() => {
    overlay.current = {
      x: new SvgAxis(xAxisRef.current!, 'bottom'),
      y: new SvgAxis(yAxisRef.current!, 'left'),
      tooltip: new TooltipController(tooltipRef.current!),
    };
    return () => {
      overlay.current = null;
    };
  }, []);

  // The scatter has no time axis, but it shows the samples inside the shared time window.
  // Redraw only when that index range or the data changed, not on every sub-pixel scroll.
  const needsDraw = useCallback(() => {
    const { store, viewport } = core;
    const i0 = store.lowerBound(viewport.start);
    const i1 = store.upperBound(viewport.end);
    range.current.i0 = i0;
    range.current.i1 = i1;
    return store.version !== seen.current.store || i0 !== state.lastI0 || i1 !== state.lastI1;
  }, [core, state]);

  const draw = useCallback(
    ({ ctx, size }: ChartRenderContext) => {
      const { store, viewport } = core;
      seen.current.store = store.version;
      if (range.current.i1 === 0 && store.size > 0) {
        range.current.i0 = store.lowerBound(viewport.start);
        range.current.i1 = store.upperBound(viewport.end);
      }
      const ui = overlay.current;
      const h = hover.current;

      drawScatter(state, {
        ctx,
        size,
        store,
        i0: range.current.i0,
        i1: range.current.i1,
        filters: filtersRef.current,
        theme: themeRef.current,
        highlightCount: highlightRef.current,
        hoverX: h.active ? h.x : null,
        hoverY: h.active ? h.y : null,
      });
      if (!ui) return;

      const plot = state.plot;
      ui.x.update(state.xPos, state.xLabels, state.xTicks.length, plot.y + plot.h + 8, [0, size.width]);
      ui.y.update(state.yPos, state.yLabels, state.yTicks.length, plot.x - 8, [0, size.height]);

      const info = state.hover;
      if (h.active && info.active) {
        ui.tooltip.setHeader(`${formatInt(state.plotted)} samples in view`);
        ui.tooltip.setRow(0, formatInt(info.count), info.count === 1 ? 'sample here' : 'samples here', 'transparent', 'none');
        ui.tooltip.setRow(1, `${Math.round(info.latLow)}–${Math.round(info.latHigh)} ms`, 'latency', 'transparent', 'none');
        ui.tooltip.setRow(2, `${formatCompact(info.reqLow)}–${formatCompact(info.reqHigh)}`, 'requests', 'transparent', 'none');
        ui.tooltip.setRowCount(3);
        ui.tooltip.show(h.x, h.y, size.width, size.height);
      } else {
        ui.tooltip.hide();
      }
    },
    [core, state],
  );

  const { invalidate } = useChartRenderer({ canvasRef, containerRef, draw, needsDraw });

  useEffect(() => {
    filtersRef.current = filters;
    themeRef.current = theme;
    highlightRef.current = stream.pointsPerTick;
    invalidate();
  }, [filters, theme, stream.pointsPerTick, invalidate]);

  useChartInteractions({ targetRef: containerRef, margin: SCATTER_MARGIN, hover, invalidate, timeAxis: false });

  return (
    <ChartFrame
      chart="scatter"
      title={`${config.title} (ms vs requests per sample)`}
      subtitle={config.subtitle}
      legend={
        <div className="ramp-legend" aria-label="Colour scale: darker cells contain more overlapping samples">
          <span>1 sample</span>
          <span className="ramp ramp-density" aria-hidden="true" />
          <span>Many</span>
          <span className="legend-ring" aria-hidden="true" />
          <span>Latest batch</span>
        </div>
      }
    >
      <div
        ref={containerRef}
        className="chart-surface"
        data-interaction="hover"
        style={{ height: config.height }}
        tabIndex={0}
        role="group"
        aria-roledescription="chart"
        aria-label={`${config.title}: latency on the vertical axis against requests per sample on the horizontal axis.`}
      >
        <canvas ref={canvasRef} className="chart-canvas" />
        <svg className="chart-overlay" aria-hidden="true">
          <g ref={xAxisRef} />
          <g ref={yAxisRef} />
        </svg>
        <div ref={tooltipRef} className="chart-tooltip" data-visible="false" />
      </div>
    </ChartFrame>
  );
}

export default memo(ScatterPlot);
