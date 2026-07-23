/**
 * A typed HTTP error thrown by route handlers/services and translated into a consistent JSON
 * response shape by the error-handling middleware (src/common/middleware/error-handler.ts).
 */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const unauthorized = (message = 'Authentication required') =>
  new HttpError(401, message, 'UNAUTHORIZED');

export const forbidden = (message = 'You do not have permission to perform this action') =>
  new HttpError(403, message, 'FORBIDDEN');

/** Deliberately a distinct code from `forbidden()`'s generic `FORBIDDEN`, both 403 — the frontend
 * (`frontend/src/lib/api-client.ts`) matches on this exact code to trigger its one-shot CSRF
 * recovery retry, and must never do that for an ordinary permission-denied response (a real
 * `requirePermission`/`requireSiteAccess` rejection, which retrying could never fix and would only
 * mask). See `common/middleware/csrf.ts`'s `csrfProtection`. */
export const csrfMismatch = (message = 'Missing or invalid CSRF token') =>
  new HttpError(403, message, 'CSRF_TOKEN_MISMATCH');

export const notFound = (message = 'Resource not found') => new HttpError(404, message, 'NOT_FOUND');

export const badRequest = (message: string) => new HttpError(400, message, 'BAD_REQUEST');

/** A resource-state conflict — a stale optimistic-locking `version` (docs/architecture/
 * database/schema-invariants.md §22) or a business-rule collision (e.g. a Draft cycle already exists). */
export const conflict = (message: string) => new HttpError(409, message, 'CONFLICT');
