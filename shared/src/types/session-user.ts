import type { PermissionKey, RoleCode } from '../constants/permissions';

/**
 * The shape of "who is making this request" as attached to the request after authentication
 * and used by both the permission-check and site-scoping RBAC middleware
 * (docs/architecture/authentication.md). Returned as-is by GET /api/v1/auth/me for the
 * frontend's session bootstrap query.
 */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  roleCode: RoleCode;
  roleName: string;
  permissions: PermissionKey[];
  /** Assigned project site IDs. Empty for Master Admin — unrestricted access is implicit, not
   *  represented as "all site IDs," per docs/architecture/authentication.md. */
  siteIds: string[];
  themeAccentColor: string;
}
