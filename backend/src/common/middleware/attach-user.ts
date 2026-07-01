import type { NextFunction, Request, Response } from 'express';
import { unauthorized } from '../http-error';
import { loadSessionUser } from '../../modules/auth/auth.service';

/**
 * Loads the current user (role, permissions, site assignments) onto `req.currentUser` for any
 * request carrying a valid session — fresh from the database every time, never from a cache
 * (docs/architecture/authentication.md). Does not itself reject unauthenticated requests; use
 * `requireAuth` (below) or `requirePermission` after this for routes that need a session.
 */
export async function attachUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const userId = req.session.userId;

  if (!userId) {
    next();
    return;
  }

  const sessionUser = await loadSessionUser(userId);

  if (!sessionUser) {
    // The session cookie refers to a user that no longer exists or has been deactivated —
    // destroy the now-meaningless session rather than leaving a dangling cookie.
    req.session.destroy(() => undefined);
    next();
    return;
  }

  req.currentUser = sessionUser;
  next();
}

/** Rejects any request without an authenticated, active user. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.currentUser) {
    next(unauthorized());
    return;
  }
  next();
}
