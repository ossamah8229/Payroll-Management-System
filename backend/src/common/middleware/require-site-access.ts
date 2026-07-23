import type { NextFunction, Request, Response } from 'express';
import type { PermissionKey } from '@payroll/shared';
import { assertSiteAccess } from '../authz-policy';
import { forbidden, unauthorized } from '../http-error';

/**
 * Site-scoping middleware (docs/architecture/authentication.md) — the URL-param-scoped wrapper
 * around `assertSiteAccess` (`common/authz-policy.ts`), the same function every site-scoped
 * service calls once it has a `siteId` in hand. Kept as a distinct middleware (rather than folded
 * into every handler) because a handful of routes (Project Units) scope directly off a URL param
 * before any service-layer lookup happens.
 *
 * `globalPermission`, when supplied, names the one permission this route's domain classifies as
 * *global administrative authority* (docs/architecture/authentication.md's permission/scope
 * matrix) — a holder bypasses site-scoping entirely, the same as Master Admin. Omit it for a route
 * whose domain has no such global permission, so only Master Admin bypasses.
 *
 * Usage:
 *   router.post('/sites/:siteId/units',
 *     requireSiteAccess((req) => req.params.siteId, { globalPermission: PERMISSIONS.SITES_MANAGE }),
 *     handler)
 */
export function requireSiteAccess(
  getSiteId: (req: Request) => string | undefined,
  options: { globalPermission?: PermissionKey } = {},
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.currentUser) {
      next(unauthorized());
      return;
    }

    try {
      const targetSiteId = getSiteId(req);
      if (!targetSiteId) {
        next(forbidden('You do not have access to this project site'));
        return;
      }
      assertSiteAccess(req.currentUser, targetSiteId, options.globalPermission);
      next();
    } catch (error) {
      next(error);
    }
  };
}
