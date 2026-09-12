'use client';

import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  name: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
  attempt: number;
}

/**
 * Isolates chart failures: one broken chart (e.g. no 2D context on an old device) shows a
 * retryable fallback while the rest of the dashboard keeps running. Errors thrown from
 * the render loop are re-thrown during render by useChartRenderer, so they land here too.
 */
export default class ChartErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.name}] render failed`, error, info.componentStack);
  }

  private readonly retry = () => {
    this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));
  };

  override render() {
    if (this.state.error) {
      return (
        <section className="card chart-card error-card" role="alert">
          <h2>{this.props.name} is unavailable</h2>
          <p className="card-subtitle">{this.state.error.message}</p>
          <button type="button" className="btn" onClick={this.retry}>
            Retry
          </button>
        </section>
      );
    }
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
  }
}
