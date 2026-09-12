'use client';

import { useSyncExternalStore } from 'react';
import { useDashboardCore } from '@/components/providers/DataProvider';

const serverTick = () => 0;

/** Re-render at most ~4x/s, and only when data or aggregates actually changed. */
export function useUiTick(): number {
  const { ticker } = useDashboardCore();
  return useSyncExternalStore(ticker.subscribe, ticker.getTick, serverTick);
}
