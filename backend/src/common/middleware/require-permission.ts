import type { NextFunction, Request, Response } from 'express';
import type { PermissionKey } from '@payroll/shared';
import { forbidden, unauthorized } from '../http-error';

/**
 * Permission-check middleware (docs/architecture/authentication.md): every route that touches
 * payroll, employee, or financial data passes through this before reaching its handler. There is
 * no route in this codebase that relies on the frontend hiding a button as its only access
 * control — this is the enforceable, server-side half of Principle 7.
 *
 * Must run after `attachUser`. A missing session and a session lacking the permission both result
 * in a rejection here; only the status code (401 vs 403) differs, matching normal REST
 * conventions.
 *
 * Accepts either a single permission or a list — a list is an **any-of** check (Phase 4 Checkpoint
 * 2's addition, first used to let a route accept either `payroll:entry` (Payroll Staff's edit
 * permission, which has always implied view access) or `payroll:view` (Finance's own, narrower,
 * read-only grant) without duplicating routes).
 */
export function requirePermission(permission: PermissionKey | PermissionKey[]) {
  const required = Array.isArray(permission) ? permission : [permission];

  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.currentUser) {
      next(unauthorized());
      return;
    }

    if (!required.some((key) => req.currentUser!.permissions.includes(key))) {
      next(forbidden(`Missing required permission: ${required.join(' or ')}`));
      return;
    }

    next();
  };
}
