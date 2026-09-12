'use client';

import { useEffect } from 'react';
import { CATEGORY_COUNT, TICK_MS } from '@/lib/chartConfig';
import { generateIntoStore } from '@/lib/dataGenerator';
import type { StreamSettings } from '@/lib/types';
import type { DashboardCore } from '@/components/providers/DataProvider';

/**
 * Simulated real-time feed: a batch arrives every 100 ms and is written straight into the
 * ring buffer. No React state is touched per tick; renderers notice the new store version
 * on their next frame and the aggregation engine is notified via the store subscription.
 *
 * The feed pauses while the tab is hidden (browsers throttle timers to 1 Hz there anyway)
 * and the interval is always cleared on unmount or settings change.
 */
export function useDataStream(core: DashboardCore, { streaming, pointsPerTick }: Pick<StreamSettings, 'streaming' | 'pointsPerTick'>): void {
  useEffect(() => {
    if (!streaming) return;
    const rows = Math.max(1, Math.round(pointsPerTick / CATEGORY_COUNT));

    const tick = () => {
      if (document.hidden) return;
      const added = generateIntoStore(core.generator, core.store, rows);
      core.store.commit();
      core.ingest.record(added);
    };

    const id = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(id);
  }, [core, streaming, pointsPerTick]);
}
