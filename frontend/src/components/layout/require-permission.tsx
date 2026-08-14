import type { ReactNode } from 'react';
import type { PermissionKey, SessionUser } from '@payroll/shared';
import { isAuthorizedFor } from '@/lib/permissions';
import { AccessDeniedPage } from './access-denied';

export interface RequirePermissionProps {
  user: SessionUser;
  /** One permission, or a list checked with any-of (OR) semantics — the same shape and semantics
   * as `nav-config.ts`'s own `NavItem.requiredPermission`, so a route's guard and its sidebar
   * visibility are trivially kept in agreement (see each route's own usage in App.tsx). Omit
   * together with `allOf` for a route with no permission requirement (session alone is enough). */
  permission?: PermissionKey | PermissionKey[];
  /** A list checked with all-of (AND) semantics, for the rarer case where a route genuinely needs
   * more than one permission at once. Mutually exclusive with `permission` in practice — a route
   * needs one semantics or the other, never both at once. */
  allOf?: PermissionKey[];
  /** Forwarded verbatim to `AccessDeniedPage` — see its own doc comment. Only the `/` (Dashboard)
   * route passes this; every other route leaves it at its default. */
  hideHomeAction?: boolean;
  children: ReactNode;
}

/**
 * Reusable, permission-aware route guard (Post-Phase-5 Stabilization Checkpoint 4B remediation) —
 * replaces the previous pattern where every protected route rendered its page component
 * unconditionally once `RequireSession` (App.tsx) confirmed a session existed, regardless of
 * whether that session actually held the permission the page's own data needs. A user reaching an
 * unauthorized route via direct URL entry previously saw the full page shell and action toolbar
 * (Import/Export/New/etc. buttons) with only the underlying data fetch failing server-side —
 * this renders the shared `AccessDeniedPage` instead, so the protected page component never mounts
 * and never issues its own requests at all.
 *
 * Deliberately a **usability and clarity layer only** — every permission this guard checks is
 * already, independently enforced by the backend's own `requirePermission` middleware
 * (`backend/src/common/middleware/require-permission.ts`) and, where applicable, site-scope
 * middleware. Removing this component would only make the UI less helpful, never less secure.
 *
 * Always nest this *inside* `RequireSession` (App.tsx) — it assumes an authenticated `user` is
 * already available and never itself checks or redirects for authentication; that remains
 * `RequireSession`'s job alone, matching this app's existing separation between "are you signed
 * in" and "are you allowed to see this."
 */
export function RequirePermission({ user, permission, allOf, hideHomeAction, children }: RequirePermissionProps) {
  if (!isAuthorizedFor(user, { permission, allOf })) {
    return <AccessDeniedPage user={user} hideHomeAction={hideHomeAction} />;
  }

  return <>{children}</>;
}
