import type { NextFunction, Request, Response } from 'express';
import { ROLE_CODES } from '@payroll/shared';
import { forbidden, unauthorized } from '../http-error';

/**
 * Site-scoping middleware (docs/architecture/authentication.md) — the second, independent RBAC
 * layer alongside `requirePermission`. Real, testable infrastructure as of Phase 1, but not yet
 * wired to any route: Employee Registry and Payroll Entry (the modules that actually have
 * site-scoped resources) don't exist until Phase 2/3. It's built now, ahead of those modules,
 * because it's foundational RBAC infrastructure the plan calls for in Phase 1 — using it is a
 * later phase's job, having it correct is this one's.
 *
 * Master Admin bypasses this check entirely (implicit, unrestricted access — an empty
 * `siteIds` array for a Payroll Staff user means zero access, never "all sites"; the two cases
 * are deliberately not conflated). For everyone else, the site ID resolved by `getSiteId` must be
 * one of the user's assigned sites, checked fresh against `req.currentUser.siteIds` (itself loaded
 * fresh from the database by `attachUser` on this same request — no caching layer to go stale).
 *
 * Usage once site-scoped routes exist, e.g.:
 *   router.get('/sites/:siteId/employees', requireSiteAccess((req) => req.params.siteId), handler)
 */
export function requireSiteAccess(getSiteId: (req: Request) => string | undefined) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.currentUser) {
      next(unauthorized());
      return;
    }

    if (req.currentUser.roleCode === ROLE_CODES.MASTER_ADMIN) {
      next();
      return;
    }

    const targetSiteId = getSiteId(req);

    if (!targetSiteId || !req.currentUser.siteIds.includes(targetSiteId)) {
      next(forbidden('You do not have access to this project site'));
      return;
    }

    next();
  };
}
