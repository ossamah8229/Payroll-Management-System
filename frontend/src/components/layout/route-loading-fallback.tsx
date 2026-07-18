import { Skeleton } from '@/components/ui/skeleton';

/**
 * AUD-012 (Post-Phase-5 Stabilization Checkpoint 4) — the one shared fallback every lazy route
 * (and the pre-existing session-loading check in `App.tsx`'s `RequireSession`) renders while its
 * code or its session check is in flight. Deliberately not a full app-shell skeleton (no fake
 * sidebar/topbar) — a lazy route's own `<AppShell>` renders the real chrome the moment its module
 * resolves, so duplicating it here would only flash a second, slightly different-looking shell for
 * one frame. `bg-bg` (the app's own background token, never pure white) plus a centered pulse
 * avoids the "blank white flash" this checkpoint's own requirement calls out, and `role="status"`/
 * `aria-live="polite"` make the wait announced to assistive tech without needing a page-specific
 * spinner anywhere else.
 */
export function RouteLoadingFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading"
      className="flex min-h-screen items-center justify-center bg-bg"
    >
      <Skeleton className="h-8 w-8 rounded-full" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
