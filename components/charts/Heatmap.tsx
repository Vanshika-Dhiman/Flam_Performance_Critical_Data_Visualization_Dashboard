'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AGGREGATION_OPTIONS } from '@/lib/chartConfig';
import { formatDateTime, formatInt, localTzOffsetMs } from '@/lib/format';
import { HEAT_MARGIN, createHeatmapState, drawHeatmap } from '@/lib/renderers/heatmapRenderer';
import { SvgAxis } from '@/lib/svgAxis';
import { TooltipController } from '@/lib/tooltip';
import type { ChartConfig } from '@/lib/types';
import { useChartInteractions, type HoverState } from '@/hooks/useChartInteractions';
import { useChartRenderer, type ChartRenderContext } from '@/hooks/useChartRenderer';
import { useControls, useDashboardCore } from '@/components/providers/DataProvider';
import { useTheme } from '@/components/providers/ThemeProvider';
import ChartFrame from './ChartFrame';

function Heatmap({ config }: { config: ChartConfig }) {
  const core = useDashboardCore();
  const { aggregation } = useControls();
  const { theme } = useTheme();

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const xAxisRef = useRef<SVGGElement>(null);
  const yAxisRef = useRef<SVGGElement>(null);
  const brushRef = useRef<SVGRectElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hover = useRef<HoverState>({ active: false, x: 0, y: 0 });

  const [state] = useState(createHeatmapState);
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
    ({ ctx, size }: ChartRenderContext) => {
      const { engine, viewport } = core;
      seen.current.engine = engine.version;
      seen.current.viewport = viewport.version;
      const ui = overlay.current;
      const h = hover.current;

      drawHeatmap(state, {
        ctx,
        size,
        result: engine.latest,
        resultVersion: engine.version,
        start: viewport.start,
        end: viewport.end,
        theme: themeRef.current,
        tzOffsetMs: ui?.tz ?? 0,
        hoverX: h.active ? h.x : null,
        hoverY: h.active ? h.y : null,
      });
      if (!ui) return;

      const plot = state.plot;
      ui.x.update(state.xPos, state.xTicks.labels, state.xTicks.values.length, plot.y + plot.h + 8, [0, size.width]);
      ui.y.update(state.yPos, state.yLabels, state.yTicks.length, plot.x - 8, [0, size.height]);

      const info = state.hover;
      if (h.active && info.active) {
        ui.tooltip.setHeader(`${formatDateTime(info.bucketStart)} – ${formatDateTime(info.bucketEnd)}`);
        ui.tooltip.setRow(0, formatInt(info.count), info.count === 1 ? 'sample' : 'samples', 'transparent', 'none');
        const band = info.top
          ? `≥ ${Math.round(info.binLow)} ms`
          : `${Math.round(info.binLow)}–${Math.round(info.binHigh)} ms`;
        ui.tooltip.setRow(1, band, 'latency band', 'transparent', 'none');
        ui.tooltip.setRowCount(2);
        ui.tooltip.show(h.x, h.y, size.width, size.height);
      } else {
        ui.tooltip.hide();
      }
    },
    [core, state],
  );

  const { invalidate } = useChartRenderer({ canvasRef, containerRef, draw, needsDraw });

  useEffect(() => {
    themeRef.current = theme;
    invalidate();
  }, [theme, invalidate]);

  useChartInteractions({ targetRef: containerRef, margin: HEAT_MARGIN, hover, invalidate, brushRef });

  const bucketLabel = AGGREGATION_OPTIONS.find((o) => o.key === aggregation)?.label ?? aggregation;

  return (
    <ChartFrame
      chart="heatmap"
      title={`${config.title} (ms)`}
      subtitle={`${config.subtitle} · ${bucketLabel} columns`}
      legend={
        <div className="ramp-legend" aria-label="Colour scale: lighter means fewer samples, darker means more (log scale)">
          <span>Fewer</span>
          <span className="ramp ramp-heat" aria-hidden="true" />
          <span>More samples (log)</span>
        </div>
      }
    >
      <div
        ref={containerRef}
        className="chart-surface"
        style={{ height: config.height }}
        tabIndex={0}
        role="group"
        aria-roledescription="interactive chart"
        aria-label={`${config.title}: sample counts by time bucket and latency band.`}
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

export default memo(Heatmap);
