import type { ReactNode } from 'react';
import ThemeToggle from '@/components/ui/ThemeToggle';

/** Server Component shell: static header/footer, rendered once and never hydrated. */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <h1>Pulse</h1>
            <p className="brand-subtitle">Edge API latency · real-time performance dashboard</p>
          </div>
        </div>
        <nav className="header-actions" aria-label="Resources">
          <a className="btn btn-ghost" href="/api/config" target="_blank" rel="noreferrer">
            Config API
          </a>
          <a className="btn btn-ghost" href="/api/data?points=50&format=json" target="_blank" rel="noreferrer">
            Data API
          </a>
          <ThemeToggle />
        </nav>
      </header>
      <main id="main">{children}</main>
      <footer className="app-footer">
        Built by Vanshika · Thapar Institute of Engineering &amp; Technology, Patiala · Next.js App Router, Canvas + SVG, no
        chart libraries
      </footer>
    </div>
  );
}
