import type { SessionUser } from '@payroll/shared';

/**
 * The session cookie stores only the user's ID (docs/architecture/authentication.md) — role,
 * permissions, and site assignments are looked up fresh from the database on every request by
 * `attachUser` middleware, never cached in the session payload. This is deliberate: if a Master
 * Admin deactivates a user or changes their site assignment, that change must take effect on the
 * user's very next request, not at their next login.
 */
declare module 'express-session' {
  interface SessionData {
    userId?: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      /** Populated by `attachUser` for any request with a valid, active session. */
      currentUser?: SessionUser;
    }
  }
}

export {};
