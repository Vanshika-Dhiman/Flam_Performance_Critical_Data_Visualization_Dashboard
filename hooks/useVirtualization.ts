'use client';

import { useCallback, useEffect, useState, type RefObject } from 'react';

export interface VirtualRange {
  start: number;
  end: number;
  totalHeight: number;
  offsetY: number;
  scrollTop: number;
}

interface VirtualizationOptions {
  scrollRef: RefObject<HTMLElement | null>;
  itemCount: number;
  itemHeight: number;
  overscan?: number;
}

/**
 * Fixed-row-height windowing. Only rows intersecting the viewport (+ overscan) are
 * rendered, so a 250 000-row table keeps ~30 DOM rows.
 *
 * Scroll events are coalesced to one measurement per animation frame, and React state is
 * updated only when the first/last visible index actually changes — scrolling within a
 * row costs no render.
 */
export function useVirtualization({ scrollRef, itemCount, itemHeight, overscan = 8 }: VirtualizationOptions) {
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0 });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;

    const measure = () => {
      raf = 0;
      const scrollTop = el.scrollTop;
      const height = el.clientHeight;
      setViewport((prev) => {
        const sameRows =
          Math.floor(prev.scrollTop / itemHeight) === Math.floor(scrollTop / itemHeight) &&
          Math.ceil((prev.scrollTop + prev.height) / itemHeight) === Math.ceil((scrollTop + height) / itemHeight);
        // Keep scrollTop exact near the top so "is at top" checks stay correct.
        if (sameRows && (scrollTop > itemHeight) === (prev.scrollTop > itemHeight)) return prev;
        return { scrollTop, height };
      });
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };

    measure();
    el.addEventListener('scroll', onScroll, { passive: true });
    const resizeObserver = new ResizeObserver(onScroll);
    resizeObserver.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      resizeObserver.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scrollRef, itemHeight]);

  const first = Math.floor(viewport.scrollTop / itemHeight);
  const visible = Math.ceil(viewport.height / itemHeight);
  const start = Math.max(0, first - overscan);
  const end = Math.min(itemCount, first + visible + overscan);

  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [scrollRef]);

  const range: VirtualRange = {
    start,
    end: Math.max(start, end),
    totalHeight: itemCount * itemHeight,
    offsetY: start * itemHeight,
    scrollTop: viewport.scrollTop,
  };
  return { range, scrollToTop };
}
