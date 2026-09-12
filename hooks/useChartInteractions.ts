'use client';

import { useEffect, type RefObject } from 'react';
import type { PlotMargin } from '@/lib/canvasUtils';
import { useDashboardCore } from '@/components/providers/DataProvider';

export interface HoverState {
  active: boolean;
  x: number;
  y: number;
}

interface InteractionOptions {
  targetRef: RefObject<HTMLElement | null>;
  margin: PlotMargin;
  hover: RefObject<HoverState>;
  invalidate: () => void;
  /** SVG rect used to preview a Shift+drag selection. */
  brushRef?: RefObject<SVGRectElement | null>;
  /** Enable zoom / pan / brush on the shared time axis (false = hover only). */
  timeAxis?: boolean;
}

/**
 * Pointer, wheel, touch and keyboard interactions for chart surfaces.
 *
 * Native listeners (wheel needs passive:false) mutate the shared ViewportStore and a
 * hover ref; the next animation frame reflects it. No React state is set, so an
 * interaction never re-renders a component. Each event is stamped with
 * `loop.interactions.markInput` so the performance panel can show input-to-frame latency.
 *
 *   Ctrl/⌘ + wheel, trackpad pinch, touch pinch  zoom (around the pointer)
 *   drag / horizontal wheel / ← →                  pan
 *   Shift + drag                                   zoom to selection
 *   double-click / Esc                             back to live
 */
export function useChartInteractions({ targetRef, margin, hover, invalidate, brushRef, timeAxis = true }: InteractionOptions): void {
  const core = useDashboardCore();

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    const { viewport, store, loop } = core;

    const pointers = new Map<number, number>();
    let mode: 'none' | 'pan' | 'brush' | 'pinch' = 'none';
    let lastClientX = 0;
    let brushStart = 0;
    let pinchDistance = 0;

    const plotWidth = () => Math.max(1, el.clientWidth - margin.left - margin.right);
    const timeAt = (offsetX: number) =>
      viewport.start + ((offsetX - margin.left) / plotWidth()) * (viewport.end - viewport.start);
    const bounds = (): [number, number] => [store.firstTimestamp(), store.lastTimestamp()];
    const touched = (event: Event) => {
      loop.interactions.markInput(event.timeStamp);
      invalidate();
    };

    const setHover = (x: number, y: number) => {
      hover.current = { active: true, x, y };
    };

    const updateBrush = (x0: number, x1: number, visible: boolean) => {
      const rect = brushRef?.current;
      if (!rect) return;
      if (!visible) {
        rect.setAttribute('display', 'none');
        return;
      }
      const left = Math.max(margin.left, Math.min(x0, x1));
      const right = Math.min(el.clientWidth - margin.right, Math.max(x0, x1));
      rect.removeAttribute('display');
      rect.setAttribute('x', String(left));
      rect.setAttribute('width', String(Math.max(0, right - left)));
      rect.setAttribute('y', String(margin.top));
      rect.setAttribute('height', String(Math.max(0, el.clientHeight - margin.top - margin.bottom)));
    };

    const onPointerDown = (event: PointerEvent) => {
      setHover(event.offsetX, event.offsetY);
      touched(event);
      if (!timeAxis || (event.pointerType === 'mouse' && event.button !== 0)) return;
      el.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, event.clientX);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDistance = Math.abs(a - b);
        mode = 'pinch';
        updateBrush(0, 0, false);
      } else if (event.shiftKey) {
        mode = 'brush';
        brushStart = event.offsetX;
        updateBrush(brushStart, brushStart, true);
      } else {
        mode = 'pan';
        lastClientX = event.clientX;
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      setHover(event.offsetX, event.offsetY);
      if (pointers.has(event.pointerId)) {
        pointers.set(event.pointerId, event.clientX);
        const [dataStart, dataEnd] = bounds();
        if (mode === 'pinch' && pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          const distance = Math.abs(a - b);
          if (pinchDistance > 0 && distance > 0) {
            const rect = el.getBoundingClientRect();
            viewport.zoom(timeAt((a + b) / 2 - rect.left), pinchDistance / distance, dataStart, dataEnd);
          }
          pinchDistance = distance;
        } else if (mode === 'pan') {
          const dx = event.clientX - lastClientX;
          lastClientX = event.clientX;
          if (dx !== 0) viewport.pan((-dx / plotWidth()) * (viewport.end - viewport.start), dataStart, dataEnd);
        } else if (mode === 'brush') {
          updateBrush(brushStart, event.offsetX, true);
        }
      }
      touched(event);
    };

    const endPointer = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);
      if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
      if (mode === 'brush') {
        updateBrush(0, 0, false);
        if (Math.abs(event.offsetX - brushStart) > 6) {
          const [dataStart, dataEnd] = bounds();
          viewport.setManualDomain(timeAt(brushStart), timeAt(event.offsetX), dataStart, dataEnd);
        }
      }
      if (pointers.size === 0) mode = 'none';
      else if (pointers.size === 1) {
        mode = 'pan';
        lastClientX = [...pointers.values()][0];
      }
      touched(event);
    };

    const onPointerLeave = (event: PointerEvent) => {
      if (pointers.size > 0) return;
      hover.current = { active: false, x: 0, y: 0 };
      touched(event);
    };

    const onWheel = (event: WheelEvent) => {
      if (!timeAxis) return;
      const [dataStart, dataEnd] = bounds();
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        viewport.zoom(timeAt(event.offsetX), Math.exp(event.deltaY * scale * 0.004), dataStart, dataEnd);
        touched(event);
      } else if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        event.preventDefault();
        viewport.pan(((event.deltaX * scale) / plotWidth()) * (viewport.end - viewport.start), dataStart, dataEnd);
        touched(event);
      }
    };

    const onDoubleClick = (event: MouseEvent) => {
      if (!timeAxis) return;
      viewport.goLive();
      touched(event);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!timeAxis) return;
      const [dataStart, dataEnd] = bounds();
      const span = viewport.end - viewport.start;
      const center = (viewport.start + viewport.end) / 2;
      switch (event.key) {
        case 'ArrowLeft':
          viewport.pan(-span * 0.1, dataStart, dataEnd);
          break;
        case 'ArrowRight':
          viewport.pan(span * 0.1, dataStart, dataEnd);
          break;
        case '+':
        case '=':
          viewport.zoom(center, 0.8, dataStart, dataEnd);
          break;
        case '-':
        case '_':
          viewport.zoom(center, 1.25, dataStart, dataEnd);
          break;
        case 'Escape':
        case 'Home':
          viewport.goLive();
          break;
        default:
          return;
      }
      event.preventDefault();
      touched(event);
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', endPointer);
    el.addEventListener('pointercancel', endPointer);
    el.addEventListener('pointerleave', onPointerLeave);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('dblclick', onDoubleClick);
    el.addEventListener('keydown', onKeyDown);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', endPointer);
      el.removeEventListener('pointercancel', endPointer);
      el.removeEventListener('pointerleave', onPointerLeave);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('dblclick', onDoubleClick);
      el.removeEventListener('keydown', onKeyDown);
    };
  }, [core, targetRef, margin, hover, invalidate, brushRef, timeAxis]);
}
