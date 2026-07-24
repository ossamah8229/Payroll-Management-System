import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import type { SessionUser } from '@payroll/shared';
import { AppShell } from './app-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/**
 * The one consistent "authenticated, but not authorized for this page" state (Post-Phase-5
 * Stabilization Checkpoint 4B remediation) — rendered by `RequirePermission`
 * (require-permission.tsx) in place of the protected page whenever a route-level permission check
 * fails, so the protected page component itself never mounts and never issues its own data
 * fetches. Deliberately distinct from three other, separate states this app already has: a
 * genuinely unknown route (`NotFoundPage`), no session at all (`RequireSession`'s redirect to
 * `/login`, App.tsx), and a network/server failure (each page's own existing error state, e.g.
 * `correction-request-detail-page.tsx`'s "Could not load..." card) — this is specifically "you're
 * logged in, this just isn't for you," never any of those other cases.
 *
 * This is a usability layer only — the backend's own `requirePermission` middleware is what
 * actually enforces this; a user who already has an authorized page open keeps it open even if
 * their permissions change mid-session (the next data-fetching action against the backend is what
 * would then fail, not this component).
 */
export function AccessDeniedPage({ user }: { user: SessionUser }) {
  return (
    <AppShell user={user} title="Access Denied">
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-20 text-center" role="alert">
          <ShieldAlert className="h-8 w-8 text-text-faint" aria-hidden />
          <h1 className="text-sm font-semibold text-text">You do not have permission to access this page.</h1>
          <p className="max-w-[420px] text-xs text-text-muted">
            If you believe this is a mistake, contact a Master User to review your account's permissions.
          </p>
          <Button asChild size="sm" className="mt-2">
            <Link to="/">Back to Dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </AppShell>
  );
}
