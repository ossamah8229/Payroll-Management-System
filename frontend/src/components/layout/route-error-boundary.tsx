import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface RouteErrorBoundaryProps {
  children: ReactNode;
}

interface RouteErrorBoundaryState {
  hasError: boolean;
}

/**
 * AUD-012 (Post-Phase-5 Stabilization Checkpoint 4) — the smallest error boundary needed to make a
 * failed lazy-route chunk load visible instead of an unexplained blank screen. `React.lazy`'s
 * dynamic `import()` rejecting (most commonly: the browser has an old tab open past a new deploy,
 * so the chunk hash it's asking for no longer exists on the server) throws during render, which
 * `Suspense` alone does not catch — only an error boundary does. Deliberately minimal: no telemetry
 * hook, no retry-with-backoff, no distinction between a chunk-load failure and any other render
 * error a lazy page might throw — a full reload re-fetches the current `index.html` and its
 * up-to-date asset manifest, which is the correct fix for the actual common case above and requires
 * no broader error-reporting system.
 */
export class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  override state: RouteErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): RouteErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Route failed to load', error, errorInfo);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg text-center"
        >
          <div className="text-sm font-semibold text-text">This page failed to load.</div>
          <p className="max-w-[320px] text-xs text-text-muted">
            This can happen after an app update. Reloading the page usually fixes it.
          </p>
          <Button size="sm" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
