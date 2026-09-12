'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { currentDpr, getContext2d, syncCanvasSize, type CanvasSize } from '@/lib/canvasUtils';
import type { FrameInfo } from '@/lib/renderLoop';
import { useDashboardCore } from '@/components/providers/DataProvider';

export interface ChartRenderContext {
  ctx: CanvasRenderingContext2D;
  size: CanvasSize;
  frame: FrameInfo;
}

export interface ChartRendererOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  containerRef: RefObject<HTMLElement | null>;
  /** Draw the chart. Return true to request another frame (e.g. an easing animation). */
  draw: (rc: ChartRenderContext) => boolean | void;
  /** Cheap per-frame dirty check (compare data/viewport versions). */
  needsDraw?: (frame: FrameInfo) => boolean;
  priority?: number;
}

/**
 * Connects a <canvas> to the shared render loop.
 *
 * - The draw callback is held in a ref (latest-ref pattern) so the loop registration and
 *   ResizeObserver are created exactly once per mount, not on every render.
 * - Redraws only when something changed: resize, `invalidate()`, or `needsDraw()`.
 * - Skips drawing entirely while the chart is scrolled out of view (IntersectionObserver).
 * - Backing store is sized in device pixels (DPR capped at 2) for crisp lines.
 * - Errors thrown inside the loop are re-thrown during render so the nearest React error
 *   boundary shows a fallback instead of the loop silently dying.
 */
export function useChartRenderer({ canvasRef, containerRef, draw, needsDraw, priority = 0 }: ChartRendererOptions) {
  const { loop } = useDashboardCore();
  const drawRef = useRef(draw);
  const needsDrawRef = useRef(needsDraw);
  const dirtyRef = useRef(true);
  const sizeRef = useRef<CanvasSize | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    drawRef.current = draw;
    needsDrawRef.current = needsDraw;
  });

  if (error) throw error;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let ctx: CanvasRenderingContext2D;
    try {
      ctx = getContext2d(canvas);
    } catch (e) {
      setError(e);
      return;
    }

    let visible = true;
    const setSize = (width: number, height: number) => {
      sizeRef.current = { width, height, dpr: currentDpr() };
      dirtyRef.current = true;
    };
    const rect = container.getBoundingClientRect();
    setSize(rect.width, rect.height);

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) setSize(entry.contentRect.width, entry.contentRect.height);
    });
    resizeObserver.observe(container);

    const intersectionObserver = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      visible = entry ? entry.isIntersecting : true;
      if (visible) dirtyRef.current = true;
    });
    intersectionObserver.observe(container);

    const onWindowResize = () => {
      const r = container.getBoundingClientRect();
      setSize(r.width, r.height);
    };
    window.addEventListener('resize', onWindowResize);

    const removeTask = loop.add({
      priority,
      render(frame) {
        const size = sizeRef.current;
        if (!visible || !size || size.width < 2 || size.height < 2) return;
        const resized = syncCanvasSize(canvas, size);
        const changed = needsDrawRef.current ? needsDrawRef.current(frame) : false;
        if (!resized && !dirtyRef.current && !changed) return;
        dirtyRef.current = false;
        if (drawRef.current({ ctx, size, frame })) dirtyRef.current = true;
      },
      onError: (e) => setError(e),
    });

    return () => {
      removeTask();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      window.removeEventListener('resize', onWindowResize);
    };
  }, [loop, canvasRef, containerRef, priority]);

  const invalidate = useCallback(() => {
    dirtyRef.current = true;
  }, []);

  return { invalidate, sizeRef };
}
