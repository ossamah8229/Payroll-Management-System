/**
 * Thin fetch wrapper — always sends cookies (`credentials: 'include'`), always echoes the CSRF
 * token back as a header on state-changing requests (docs/architecture/authentication.md), and
 * normalizes the backend's `{ error: { code, message } }` shape into a typed exception.
 *
 * `VITE_API_URL` is empty in development (Vite's dev-server proxy makes the backend look
 * same-origin, see vite.config.ts) and set to the real backend URL in production, where frontend
 * and backend are genuinely different Render services (docs/architecture/deployment.md). Exported
 * so direct-`fetch` callers that bypass `apiRequest` (file upload/download — see
 * `use-employees.ts`, `use-payroll-entries.ts`, `use-payslips.ts`, `use-bank-sheet.ts`,
 * `use-cash-receiving.ts`) build the same absolute URL instead of an accidental relative one that
 * would resolve against the *frontend's* own origin in production.
 */
export const API_BASE_URL = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * The CSRF token, held only in module memory (never localStorage/sessionStorage) and reset on
 * every full page load exactly like any other in-memory app state. The frontend cannot read the
 * `csrf_token` cookie directly via `document.cookie` — it belongs to the backend's own origin in
 * production (docs/architecture/deployment.md), and the browser's same-origin policy hides it from
 * this document regardless of the cookie's own `SameSite`/`Secure` settings. Instead, the backend
 * echoes the same token in an `x-csrf-token` *response* header on every safe (GET/HEAD/OPTIONS)
 * request (`backend/src/common/middleware/csrf.ts`), which CORS explicitly exposes to this page's
 * JS (`exposedHeaders` in `backend/src/app.ts`) — `captureCsrfToken` below picks it up from every
 * response, so the token is learned on first load (the session-bootstrap `GET /auth/me` call,
 * `use-session.ts`) and kept fresh after, with no separate "fetch a token" round trip needed.
 */
let csrfToken: string | undefined;

function captureCsrfToken(response: Response): void {
  const token = response.headers.get('x-csrf-token');
  if (token) csrfToken = token;
}

/** Exported so callers that must bypass `apiRequest` (a multipart file upload, or a blob/file
 * download triggered via a direct `fetch`) can still attach the CSRF token the same way. */
export function getCsrfToken(): string | undefined {
  return csrfToken;
}

/**
 * Checkpoint 4D correction — deterministic CSRF mismatch recovery.
 *
 * A prior implementation tried to prevent the concurrent-first-contact CSRF race entirely on the
 * backend, via an in-memory map keyed by the request's IP address. That was rejected on review:
 * `req.ip` is not a stable browser identity (unrelated users behind one NAT/corporate egress share
 * an IP; Render's own proxy layer can also affect what the backend sees as the client IP), and
 * correctness depended on every racing request landing on the *same* Node process within a fixed
 * TTL window — neither holds once this backend runs as more than one instance/process, which a
 * real deployment must be free to do. A map that "usually" converges concurrent requests on the
 * same token is not a fix for a security-relevant race condition.
 *
 * The corrected design keeps the backend simple and stateless (mint a token when none exists,
 * exactly like before Checkpoint 4C/4D) and instead makes the *client* recover deterministically
 * from a genuine mismatch:
 *
 * 1. `apiRequest` sends a state-changing request with whatever token it currently holds in memory.
 * 2. If the backend rejects it with the specific `CSRF_TOKEN_MISMATCH` code (never any other 4xx/
 *    5xx — a real permission denial, validation error, or server fault must never be retried, since
 *    retrying could never fix those and would only mask them) and this is the *first* attempt for
 *    this call, `refreshCsrfToken` below fetches the token bound to whatever `csrf_token` cookie
 *    the browser actually currently holds, from a dependency-free safe endpoint
 *    (`GET /api/v1/csrf-token`) that behaves exactly like `issueCsrfCookie` already does for any
 *    safe method: echo the cookie's existing token if present, mint one if not.
 * 3. The original request is retried exactly once with the refreshed token. A second mismatch is
 *    never retried again — it surfaces to the caller as a normal `ApiError`.
 *
 * This cannot loop: the recovery call is itself a plain safe `fetch` outside `apiRequest`, never
 * routed back through this retry logic, and a retried request is marked so it can never trigger a
 * second recovery. Concurrent requests that all hit a mismatch around the same moment share one
 * in-flight recovery call (`pendingCsrfRefresh`) rather than each firing their own — no refresh
 * storm. The double-submit comparison itself (`backend/src/common/middleware/csrf.ts`) is
 * completely unchanged and still strict; this only adds a client-side "learn the real current
 * token and try once more" step for the one error code that means exactly that.
 */
const CSRF_TOKEN_MISMATCH_CODE = 'CSRF_TOKEN_MISMATCH';

let pendingCsrfRefresh: Promise<void> | null = null;

async function refreshCsrfToken(): Promise<void> {
  if (!pendingCsrfRefresh) {
    pendingCsrfRefresh = fetch(`${API_BASE_URL}/api/v1/csrf-token`, { credentials: 'include' })
      .then((response) => {
        captureCsrfToken(response);
      })
      .finally(() => {
        pendingCsrfRefresh = null;
      });
  }
  return pendingCsrfRefresh;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /**
   * Phase 7E durability checkpoint (A5) — optional and `undefined` by default, so every existing
   * caller of `apiRequest` is completely unaffected (a hung request just hangs exactly as it did
   * before this checkpoint). Only Payroll Entry's own entry/work-line mutations
   * (`use-payroll-entries.ts`) pass this, deliberately scoped rather than a blanket default for
   * every request in the app — a narrow, low-risk change per the checkpoint's own instruction,
   * not a judgment that every other call site's current unbounded-wait behavior is fine long term.
   * When the timeout elapses first, the in-flight `fetch` is aborted, which rejects with a plain
   * `AbortError` — not an `ApiError` — so it flows through the exact same generic-retry path a
   * dropped network connection already does (`use-payroll-entry-editor.ts`'s `commit()` catch
   * block treats any non-`ApiError`/non-`ApiError`-409/400 failure identically); a hung save can
   * therefore never be mistaken for `'saved'`, and always becomes a visible, retryable `'error'`.
   */
  timeoutMs?: number;
}

export async function apiRequest<TResponse>(
  path: string,
  options: RequestOptions = {},
  _isCsrfRetry = false,
): Promise<TResponse> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (method !== 'GET' && csrfToken) {
    headers['x-csrf-token'] = csrfToken;
  }

  const timeoutController = options.timeoutMs !== undefined ? new AbortController() : undefined;
  const timeoutId =
    timeoutController !== undefined
      ? setTimeout(() => timeoutController.abort(), options.timeoutMs)
      : undefined;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: timeoutController?.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  captureCsrfToken(response);

  if (response.status === 204) {
    return undefined as TResponse;
  }

  const payload = await response.json().catch(() => undefined);

  if (!response.ok) {
    const code = payload?.error?.code ?? 'UNKNOWN_ERROR';

    if (!_isCsrfRetry && code === CSRF_TOKEN_MISMATCH_CODE) {
      await refreshCsrfToken();
      return apiRequest<TResponse>(path, options, true);
    }

    const message = payload?.error?.message ?? `Request failed with status ${response.status}`;
    throw new ApiError(response.status, code, message);
  }

  return payload as TResponse;
}
