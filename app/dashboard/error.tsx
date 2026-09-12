'use client';

import { useEffect } from 'react';

/** Route-level error boundary (must be a Client Component). */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Dashboard failed to render', error);
  }, [error]);

  return (
    <section className="card error-card" role="alert">
      <h2>The dashboard could not be loaded</h2>
      <p className="card-subtitle">
        {error.message || 'Unexpected error'}
        {error.digest ? ` (ref ${error.digest})` : ''}
      </p>
      <button type="button" className="btn btn-primary" onClick={reset}>
        Try again
      </button>
    </section>
  );
}
