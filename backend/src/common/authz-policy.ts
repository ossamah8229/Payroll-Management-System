import { ROLE_CODES, type PermissionKey, type SessionUser } from '@payroll/shared';
import { forbidden } from './http-error';

/**
 * The single, shared authorization-policy module (docs/architecture/authentication.md's
 * permission/scope matrix) — the one place "is this user allowed to do X" and "which records can
 * they do it to" are decided, so every module's route guard and service-layer check stays
 * consistent with every other's. Before this module existed, the site-scope check was
 * implemented twice, independently — `require-site-access.ts`'s Express middleware and this file's
 * own `assertSiteAccess` (previously defined in `employees.service.ts`) — and the two drifted:
 * the service-layer version was taught to treat `sites:manage` as global administrative authority
 * (equivalent to Master Admin) for Project Sites visibility, but the middleware version was never
 * updated, so a custom role holding `sites:manage` could list every site but still get rejected
 * creating a Project Unit under one it wasn't individually assigned to (Post-Phase-5 UAT). Both
 * entry points now call the same `assertSiteAccess` below, so that class of drift can't recur.
 *
 * Every permission in this system is one of two kinds (see the matrix for the full per-permission
 * classification):
 *   - a **global administrative permission** — no "assigned site" concept applies; a holder
 *     administers the entity list itself (e.g. `sites:manage` for Project Sites/Units, same class
 *     as `users:manage`/`settings:manage`/`audit-log:view`, this system's `CRITICAL_ADMIN_PERMISSIONS`).
 *   - a **site-scoped operational permission** — a holder acts only within their own
 *     `UserSiteAssignment` rows (e.g. `employees:view/create/edit`, `payroll:entry`,
 *     `advances:manage`, `bank-sheets:view`, `payslips:view`, `corrections:approve`). Holding a
 *     *global* permission (like `sites:manage`) never implicitly widens a *site-scoped* one —
 *     an Employee/Payroll/etc. permission grants no access beyond its own module's site
 *     assignments, by design, even for a user who also happens to administer Sites/Units globally.
 *
 * `assertSiteAccess`/`getAccessibleSiteIds` take an optional `globalPermission` naming which
 * permission (if any) constitutes global authority for the calling domain — omitted entirely for
 * every site-scoped operational domain, so only the literal Master Admin role bypasses those.
 */

export function isMasterAdmin(user: SessionUser): boolean {
  return user.roleCode === ROLE_CODES.MASTER_ADMIN;
}

export function hasPermission(user: SessionUser, permission: PermissionKey): boolean {
  return user.permissions.includes(permission);
}

export function hasAnyPermission(user: SessionUser, permissions: PermissionKey[]): boolean {
  return permissions.some((permission) => user.permissions.includes(permission));
}

/**
 * True when `user` has unrestricted, system-wide authority for the calling domain — either the
 * literal Master Admin bootstrap role (always, every domain), or, when the caller names one,
 * a permission this system's matrix classifies as that domain's global administrative grant.
 */
export function hasGlobalAuthority(user: SessionUser, globalPermission?: PermissionKey): boolean {
  if (isMasterAdmin(user)) return true;
  return globalPermission !== undefined && hasPermission(user, globalPermission);
}

/**
 * The single site-scope guard, shared by every site-scoped service function and by
 * `requireSiteAccess` (the Express middleware wrapper around this same check, for routes that
 * scope by URL param rather than a value already loaded from the database). Throws the same 403
 * either way.
 */
export function assertSiteAccess(user: SessionUser, siteId: string, globalPermission?: PermissionKey): void {
  if (hasGlobalAuthority(user, globalPermission)) return;
  if (!user.siteIds.includes(siteId)) {
    throw forbidden('You do not have access to this project site');
  }
}

/**
 * The accessible-site-id filter for a scoped list/export query — `undefined` means "no filter,
 * global authority sees every site," matching this codebase's established convention (never
 * conflated with `[]`, which means "assigned to zero sites, sees nothing").
 */
export function getAccessibleSiteIds(user: SessionUser, globalPermission?: PermissionKey): string[] | undefined {
  return hasGlobalAuthority(user, globalPermission) ? undefined : user.siteIds;
}
