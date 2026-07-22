import type { PermissionKey } from '../constants/permissions';

/**
 * The shape of "who is making this request" as attached to the request after authentication
 * and used by both the permission-check and site-scoping RBAC middleware
 * (docs/architecture/authentication.md). Returned as-is by GET /api/v1/auth/me for the
 * frontend's session bootstrap query.
 *
 * `roleCode` is a plain `string`, not the old fixed `RoleCode` union — Administration & Security
 * Management Phase 1 makes roles administrator-defined data rows, so a role's `code` is a
 * generated internal identifier for a custom role, not one of a closed set of literals. Business
 * logic must never branch on this value (`docs/architecture/authentication.md`'s "role names/codes
 * are unsuitable for business authorization" — the one deliberately-deferred exception being the
 * small set of pre-existing `roleCode === ROLE_CODES.MASTER_ADMIN` bypass checks, unchanged by
 * this phase). `roleId` is the role's own stable identity, for the frontend's own
 * self-protection UX (e.g. "you are currently assigned this role").
 */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  permissions: PermissionKey[];
  /** Assigned project site IDs. Empty for Master Admin — unrestricted access is implicit, not
   *  represented as "all site IDs," per docs/architecture/authentication.md. */
  siteIds: string[];
  themeAccentColor: string;
}
