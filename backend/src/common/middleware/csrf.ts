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
 * 1. `issueCsrfCookie` sets a random token in a JS-readable cookie (not httpOnly — the frontend
 *    must be able to read it to echo it back).
 * 2. `csrfProtection` requires every state-changing request (POST/PUT/PATCH/DELETE) to send that
 *    same token back in an `x-csrf-token` header. A request whose header doesn't match its cookie
 *    is rejected — a malicious third-party page can trigger a request that *carries* the victim's
 *    cookies automatically, but it cannot *read* the cookie to put its value in the header.
 *
 * GET/HEAD/OPTIONS are exempt, matching standard CSRF practice (safe methods must not mutate
 * state in the first place).
 */
const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function issueCsrfCookie(req: Request, res: Response, next: NextFunction): void {
  if (!req.cookies?.[CSRF_COOKIE_NAME]) {
    const token = randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE_NAME, token, {
      httpOnly: false,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
    });
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
