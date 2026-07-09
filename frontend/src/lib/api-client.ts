/**
 * Thin fetch wrapper — always sends cookies (`credentials: 'include'`), always echoes the CSRF
 * cookie back as a header on state-changing requests (docs/architecture/authentication.md), and
 * normalizes the backend's `{ error: { code, message } }` shape into a typed exception.
 *
 * `VITE_API_URL` is empty in development (Vite's dev-server proxy makes the backend look
 * same-origin, see vite.config.ts) and set to the real backend URL in production, where frontend
 * and backend are genuinely different Render services (docs/architecture/deployment.md).
 */
const API_BASE_URL = import.meta.env.VITE_API_URL ?? '';

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

/** Exported so callers that must bypass `apiRequest` (e.g. a multipart file upload, or triggering
 * a file-download navigation) can still echo the CSRF cookie the same way — one implementation of
 * "read this cookie," not one per caller. */
export function readCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
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

  if (method !== 'GET') {
    const csrfToken = readCookie('csrf_token');
    if (csrfToken) {
      headers['x-csrf-token'] = csrfToken;
    }
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

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
