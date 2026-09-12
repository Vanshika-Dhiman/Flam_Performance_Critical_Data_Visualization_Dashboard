import type { Metadata } from 'next';
import { Suspense } from 'react';
import Dashboard from '@/components/Dashboard';
import DashboardSkeleton from '@/components/DashboardSkeleton';
import { DataProvider } from '@/components/providers/DataProvider';
import { CHART_CONFIGS } from '@/lib/chartConfig';
import { getInitialSnapshot } from '@/lib/server/initialData';

export const metadata: Metadata = {
  title: 'Dashboard',
};

/**
 * Incremental Static Regeneration: the page (including the 10k-point initial dataset) is
 * pre-rendered at build and regenerated at most once a minute, so it is served from the
 * CDN. A stale snapshot is harmless — the client resumes the seeded generator from the
 * embedded state, so the stream continues seamlessly either way.
 */
export const revalidate = 60;

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardWithData />
    </Suspense>
  );
}

/** Async Server Component: streams in behind the Suspense boundary when rendered on demand. */
async function DashboardWithData() {
  const snapshot = await getInitialSnapshot();
  return (
    <DataProvider initialSnapshot={snapshot}>
      <Dashboard configs={CHART_CONFIGS} />
    </DataProvider>
  );
}
