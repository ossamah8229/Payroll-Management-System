import type { BrowserContext } from '@playwright/test';
import { getCsrfToken } from '../fixtures/auth';
import { BACKEND_URL } from '../setup/config';

/**
 * A thin, CSRF-aware wrapper around Playwright's own `context.request` — mirrors exactly what
 * `frontend/src/lib/api-client.ts` does in the real app (send the session cookie automatically,
 * echo the `csrf_token` cookie back as `x-csrf-token` on state-changing requests). Used by specs
 * to set up fixture data quickly (a site, a unit, an employee) through the real API rather than a
 * slower UI click-through, and by the session-revocation spec to prove a session is/isn't
 * authorized without needing a full page navigation per check.
 *
 * Every call targets `BACKEND_URL` directly rather than a path relative to `playwright.config.ts`'s
 * `baseURL` (the frontend, port 4200) — the frontend is served by `vite preview`, a static file
 * server with no `/api` proxy (unlike `vite dev`'s own dev-only proxy, `vite.config.ts`), exactly
 * matching how the real production frontend build itself talks to the backend cross-origin via
 * `VITE_API_URL` (`docs/architecture/deployment.md`), not same-origin. `context.request` still
 * shares the browser context's own cookie jar regardless of which origin it targets, so the session
 * cookie is sent correctly either way.
 */
export async function apiPost<T = unknown>(context: BrowserContext, path: string, body: unknown): Promise<T> {
  const csrfToken = await getCsrfToken(context);
  const res = await context.request.post(`${BACKEND_URL}${path}`, {
    data: body,
    headers: { 'x-csrf-token': csrfToken },
  });
  if (!res.ok()) {
    throw new Error(`POST ${path} failed: ${res.status()} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export async function apiGet<T = unknown>(context: BrowserContext, path: string): Promise<{ status: number; body: T }> {
  const res = await context.request.get(`${BACKEND_URL}${path}`);
  const body = (await res.json().catch(() => undefined)) as T;
  return { status: res.status(), body };
}

/** Whether the session this context holds is currently authorized — used by the session-revocation
 * spec, which needs to check auth state without a full page navigation (a navigation to a
 * now-unauthorized route would redirect to `/login`, which is itself a fine signal but slower and
 * less direct than reading the API's own status code). */
export async function isAuthenticated(context: BrowserContext): Promise<boolean> {
  const res = await context.request.get(`${BACKEND_URL}/api/v1/auth/me`);
  return res.status() === 200;
}
