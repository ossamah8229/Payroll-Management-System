import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { csrfMismatch } from '../http-error';
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
 *
 * **Checkpoint 4C — concurrent first-contact race, and why an IP-keyed fix was rejected:** two
 * requests that both arrive before either has round-tripped a `Set-Cookie` back to the browser (two
 * tabs opened together, or several parallel first-load requests from one tab — `session` middleware
 * above does an async Postgres lookup, enough of an event-loop yield for Node to interleave two such
 * requests even within a single tab) each used to see `req.cookies[CSRF_COOKIE_NAME]` as empty and
 * mint its own random token independently. Each browser tab/request then holds a *different* token
 * in memory, but the shared cookie jar can only hold one value — whichever `Set-Cookie` the browser
 * applies last — so the other tab's next mutation sends a header that no longer matches the cookie
 * and is rejected with a 403.
 *
 * A first attempt at fixing this (Checkpoint 4D, since reverted) made concurrent "no cookie yet"
 * requests converge on one token via a short-lived, in-memory, per-process map keyed by `req.ip`.
 * Rejected on review, correctly: `req.ip` is not a browser identity — it identifies a network path,
 * not a tab, a user, or even reliably a single physical client (unrelated users behind one NAT/
 * corporate egress, or behind Render's own proxy layer, can share an IP; the two are not the same
 * thing this fix needed them to be). Worse, an in-memory `Map` is process-local: correctness
 * depended on every racing request landing on the *same* Node process within a fixed TTL window,
 * which silently stops holding the moment this backend runs more than one instance (the ordinary
 * case for any real deployment, and something this module must never assume against) or restarts
 * mid－window. A mitigation whose correctness depends on single-process, single-request-path
 * accidents of a dev/test environment is not a fix for a security-relevant race condition.
 *
 * **The corrected design (this file) does not try to prevent the race server-side at all.**
 * `issueCsrfCookie` is back to the simplest possible stateless rule: mint a token if the request has
 * none, echo it on safe methods, full stop — a first-contact race may still briefly mint two
 * different tokens, exactly as it could before Checkpoint 4C. What changed is that this is no longer
 * a problem the *server* needs to solve: `csrfProtection` below rejects a mismatch with a specific,
 * distinguishable error code (`CSRF_TOKEN_MISMATCH`, `common/http-error.ts`'s `csrfMismatch`), and
 * `frontend/src/lib/api-client.ts` performs one controlled recovery — refetch the token bound to
 * whichever cookie the browser actually currently holds (`GET /api/v1/csrf-token` in `app.ts`, a
 * dependency-free safe endpoint with exactly the same "echo if present, mint if not" behavior this
 * middleware already gives every safe request), then retry the original mutation exactly once. This
 * keeps the double-submit-cookie model and its timing-safe comparison completely unweakened — every
 * comparison is still a strict, real equality check — and needs no shared state, no assumption about
 * process topology, and no identity signal (IP or otherwise) at all.
 */
const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function csrfCookieOptions(): { httpOnly: boolean; secure: boolean; sameSite: 'none' | 'lax'; path: string } {
  return {
    httpOnly: false,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
  };
}

export function issueCsrfCookie(req: Request, res: Response, next: NextFunction): void {
  let token = req.cookies?.[CSRF_COOKIE_NAME];
  if (!token) {
    token = randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE_NAME, token, csrfCookieOptions());
  }
  if (SAFE_METHODS.has(req.method)) {
    res.setHeader(CSRF_HEADER_NAME, token);
  }
  next();
}

/**
 * Rotates the CSRF token, issuing a brand-new one in place of whatever the client currently holds
 * and echoing it in the response header of *this* response — even though this is called from
 * state-changing (non-safe) routes, which normally never emit the header — so the frontend's
 * existing `captureCsrfToken` (`frontend/src/lib/api-client.ts`, which reads the header off every
 * response, not just safe ones) picks up the new value with no separate round trip and no frontend
 * change required. Called after every privilege-boundary event that already rotates or destroys
 * *the acting request's own* session (login, logout, self-service password change, and an
 * administrator resetting *their own* password) — `docs/architecture/authentication.md` — so a
 * pre-authentication token is never still valid after that boundary, matching the same rationale as
 * the existing session-regenerate-on-login/destroy-on-logout behavior this sits alongside. Never
 * called when an administrator resets *someone else's* password
 * (`backend/src/modules/users/users.routes.ts`): that only destroys the *target* user's sessions,
 * an entirely different browser/cookie jar this response has no access to and no reason to touch —
 * the acting administrator's own token is correctly left exactly as it was.
 */
export function rotateCsrfCookie(res: Response): void {
  const token = randomBytes(32).toString('hex');
  res.cookie(CSRF_COOKIE_NAME, token, csrfCookieOptions());
  res.setHeader(CSRF_HEADER_NAME, token);
}

export function csrfProtection(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.get(CSRF_HEADER_NAME);

  if (!cookieToken || !headerToken || !tokensMatch(cookieToken, headerToken)) {
    next(csrfMismatch());
    return;
  }

  next();
}

function tokensMatch(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}
