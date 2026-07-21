import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { forbidden } from '../http-error';
import { isProduction } from '../../config/env';

/**
 * Double-submit-cookie CSRF protection (docs/architecture/authentication.md) — a direct,
 * necessary consequence of choosing cookie-based sessions over bearer tokens. Implemented
 * directly (rather than pulling in a third-party middleware) since the pattern is small,
 * well-understood, and this keeps the exact behavior fully auditable:
 *
 * 1. `issueCsrfCookie` sets a random token in a cookie (still not `httpOnly`, for defense in
 *    depth/debuggability, but the frontend does not rely on reading it via `document.cookie` — see
 *    below) and, on every safe (GET/HEAD/OPTIONS) response, also echoes that same token in an
 *    `x-csrf-token` *response header*.
 * 2. `csrfProtection` requires every state-changing request (POST/PUT/PATCH/DELETE) to send that
 *    same token back in an `x-csrf-token` *request* header. A request whose header doesn't match
 *    its cookie is rejected — a malicious third-party page can trigger a request that *carries*
 *    the victim's cookies automatically, but it cannot *read* the response header to put the
 *    token's value in its own forged request.
 *
 * **Why a response header, not just the cookie (frontend/src/lib/api-client.ts):** frontend and
 * backend are deployed as separate origins (docs/architecture/deployment.md), so
 * `document.cookie` in the frontend's own document can never see a cookie that belongs to the
 * backend's origin — that isn't a bug to work around, it's the browser's same-origin policy
 * working as designed. The frontend instead reads the token from this response header (which CORS
 * explicitly exposes to it, see `app.ts`'s `exposedHeaders`) and holds it in memory, echoing it
 * back on state-changing requests exactly as `csrfProtection` requires.
 *
 * GET/HEAD/OPTIONS are exempt from the *check*, matching standard CSRF practice (safe methods must
 * not mutate state in the first place) — but a safe request is exactly when the header is emitted,
 * since that's the frontend's only opportunity to learn/refresh the token.
 *
 * **`sameSite: 'none'` in production:** the deployed frontend and backend sit on two independent
 * `*.onrender.com` subdomains, which browsers treat as cross-*site* (`onrender.com` is on the
 * Public Suffix List — docs/release/KNOWN_ISSUES_v1.0.md KI-2), not merely cross-origin.
 * `SameSite=Lax` cookies are never attached to a cross-site `fetch`/`XHR` request (only to
 * top-level navigations), so without this the cookie would simply never reach the backend on any
 * API call — `None` (paired with `Secure`, required by browsers for `None`) is what actually makes
 * the cookie ride along on those requests. Development keeps `'lax'` — the Vite dev-server proxy
 * (`vite.config.ts`) makes frontend and backend look same-origin locally, where `Lax` already works
 * and is the more conservative default.
 */
const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function issueCsrfCookie(req: Request, res: Response, next: NextFunction): void {
  let token = req.cookies?.[CSRF_COOKIE_NAME];
  if (!token) {
    token = randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE_NAME, token, {
      httpOnly: false,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
    });
  }
  if (SAFE_METHODS.has(req.method)) {
    res.setHeader(CSRF_HEADER_NAME, token);
  }
  next();
}

export function csrfProtection(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.get(CSRF_HEADER_NAME);

  if (!cookieToken || !headerToken || !tokensMatch(cookieToken, headerToken)) {
    next(forbidden('Missing or invalid CSRF token'));
    return;
  }

  next();
}

function tokensMatch(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}
