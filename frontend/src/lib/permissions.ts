import { PERMISSIONS, type PermissionKey, type SessionUser } from '@payroll/shared';

/** True if `user` holds `permission` directly — the session's own `permissions` array already
 * reflects every RolePermission row for their role (including Master Admin's implicit "every
 * permission"), so no role-name special-casing belongs here. */
export function hasPermission(user: SessionUser, permission: PermissionKey): boolean {
  return user.permissions.includes(permission);
}

/** True if `user` holds at least one of `permissions` (OR semantics). */
export function hasAnyPermission(user: SessionUser, permissions: PermissionKey[]): boolean {
  return permissions.some((permission) => hasPermission(user, permission));
}

/** True if `user` holds every one of `permissions` (AND semantics) — the counterpart to
 * `hasAnyPermission`, for the rarer case where a page/action genuinely needs more than one
 * permission at once rather than any-of-several (Post-Phase-5 Stabilization Checkpoint 4B
 * remediation, `RequirePermission`'s own `allOf` mode). No current route needs this yet — every
 * existing multi-permission gate in this app (`nav-config.ts`, backend `requirePermission` calls)
 * is any-of — but the guard supports both explicitly rather than assuming any-of is the only shape
 * a permission check will ever take. */
export function hasAllPermissions(user: SessionUser, permissions: PermissionKey[]): boolean {
  return permissions.every((permission) => hasPermission(user, permission));
}

/** `RequirePermission`'s (components/layout/require-permission.tsx) own prop shape, reused here so
 * the actual authorization decision is a plain, deterministic function — this codebase's own
 * established testing convention (vitest.config.ts: logic tests only, no component/DOM rendering)
 * means the guard's behavior is verified by unit-testing this function directly, never by
 * rendering the component. `allOf` takes precedence when both are somehow provided; omitting both
 * means "no requirement beyond an authenticated session," matching `nav-config.ts`'s own
 * `isNavItemVisible` convention for an absent `requiredPermission`. */
export interface PermissionRequirement {
  permission?: PermissionKey | PermissionKey[];
  allOf?: PermissionKey[];
}

export function isAuthorizedFor(user: SessionUser, requirement: PermissionRequirement): boolean {
  if (requirement.allOf) return hasAllPermissions(user, requirement.allOf);
  if (requirement.permission) {
    return hasAnyPermission(user, Array.isArray(requirement.permission) ? requirement.permission : [requirement.permission]);
  }
  return true;
}

// --- Corrections domain (Phase 6 Checkpoint 6A) -----------------------------------------------
// Mirrors the backend's own ENTRY_VIEW_PERMISSIONS/BALANCE_VIEW_PERMISSIONS convention
// (backend/src/modules/corrections/corrections.routes.ts) as a single frontend source of truth
// for the same "payroll:entry OR corrections:approve" view rule, so the sidebar, the Corrections
// page, and both detail pages can't drift out of sync with each other or with the backend.
const CORRECTIONS_VIEW_PERMISSIONS: PermissionKey[] = [PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.CORRECTIONS_APPROVE];

export function canAccessCorrections(user: SessionUser): boolean {
  return hasAnyPermission(user, CORRECTIONS_VIEW_PERMISSIONS);
}

export function canViewCorrectionsLedger(user: SessionUser): boolean {
  return hasAnyPermission(user, CORRECTIONS_VIEW_PERMISSIONS);
}

export function canReviewCorrectionRequests(user: SessionUser): boolean {
  return hasPermission(user, PERMISSIONS.CORRECTIONS_APPROVE);
}

export function canRequestCorrection(user: SessionUser): boolean {
  return hasPermission(user, PERMISSIONS.PAYROLL_ENTRY);
}

export type CorrectionsTab = 'queue' | 'ledger';

/** The tab a user should land on when opening `/corrections`: Review Queue takes priority when
 * authorized (today's intended default for a dual-permission holder), falling back to the Ledger,
 * or `null` when the user is authorized for neither — the page then shows its own access-denied
 * state instead of rendering a hidden or unauthorized default tab. */
export function defaultCorrectionsTab(user: SessionUser): CorrectionsTab | null {
  if (canReviewCorrectionRequests(user)) return 'queue';
  if (canViewCorrectionsLedger(user)) return 'ledger';
  return null;
}
