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

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
}

export async function apiRequest<TResponse>(path: string, options: RequestOptions = {}): Promise<TResponse> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (method !== 'GET' && csrfToken) {
    headers['x-csrf-token'] = csrfToken;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  captureCsrfToken(response);

  if (response.status === 204) {
    return undefined as TResponse;
  }

  const payload = await response.json().catch(() => undefined);

  if (!response.ok) {
    const code = payload?.error?.code ?? 'UNKNOWN_ERROR';
    const message = payload?.error?.message ?? `Request failed with status ${response.status}`;
    throw new ApiError(response.status, code, message);
  }

  return payload as TResponse;
}
