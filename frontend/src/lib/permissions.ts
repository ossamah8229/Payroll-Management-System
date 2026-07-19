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
