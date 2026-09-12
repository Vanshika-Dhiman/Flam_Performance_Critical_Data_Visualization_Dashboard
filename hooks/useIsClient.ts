'use client';

import { useSyncExternalStore } from 'react';

const noopSubscribe = () => () => {};

/**
 * false during SSR and hydration, true afterwards. Used for text that depends on the
 * viewer's timezone or locale, so the server HTML never mismatches the client.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}
