import { prisma } from './prisma';

/**
 * Deletes every persisted express-session row belonging to `userId`, straight from the
 * connect-pg-simple-managed `"session"` table (created/owned by that library — see
 * `src/app.ts`'s `PgSession` configuration — not a Prisma-modeled table, hence the raw query).
 *
 * AUD-009: called after a password change or reset so every browser/device currently
 * authenticated as that user is forced to re-authenticate with the new password, without
 * restarting the process and without touching any other user's session. Each express-session
 * row's own JSON payload stores the authenticated user id under the `userId` key exactly as
 * `POST /auth/login` sets it (`req.session.userId = userId`, `src/types/express.d.ts`'s
 * `SessionData.userId`), so a plain JSON-path equality match is enough to find every row that
 * belongs to this user — no join or extra session metadata needed.
 *
 * Deleting the row directly (rather than only updating application state) is what makes this
 * effective without a server restart: the next request carrying that session's cookie asks the
 * store for a now-nonexistent `sid`, `attachUser` sees no session, and `requireAuth` rejects it —
 * the same "next request fails" guarantee this codebase already relies on for deactivation
 * (`docs/architecture/authentication.md`). If the caller's own current request session belongs to
 * this same user, deleting its row here does not resurrect itself later in the response cycle:
 * express-session's own `rolling: true` behavior only re-persists a session via `touch` (a plain
 * `UPDATE ... WHERE sid = $1`, a no-op against an already-deleted row) unless the session was
 * actually modified during the request, which changing/resetting a password does not do. A caller
 * that also wants the *current* request's own session/cookie cleared explicitly (rather than just
 * failing on the *next* request) should still call `req.session.destroy()` itself afterwards —
 * see `auth.routes.ts`'s `/change-password` and `users.routes.ts`'s `/:id/reset-password`.
 *
 * Returns the number of session rows deleted, primarily so a caller/test can assert against it.
 */
export async function invalidateAllSessionsForUser(userId: string): Promise<number> {
  return prisma.$executeRaw`DELETE FROM "session" WHERE (sess ->> 'userId') = ${userId}`;
}
