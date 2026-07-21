import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `csrfToken` is held in module memory (not localStorage/sessionStorage —
 * docs/architecture/authentication.md CSRF Protection section), so each test re-imports the
 * module fresh via `vi.resetModules()` to avoid one test's captured token leaking into the next.
 */
async function freshApiClient() {
  vi.resetModules();
  return import('./api-client');
}

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
}

describe('apiRequest CSRF token handling', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not attach an x-csrf-token header before any token has been learned', async () => {
    const { apiRequest } = await freshApiClient();
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true }));

    await apiRequest('/api/v1/employees', { method: 'POST', body: { name: 'x' } });

    const [, options] = vi.mocked(fetch).mock.calls[0]!;
    expect((options?.headers as Record<string, string>)['x-csrf-token']).toBeUndefined();
  });

  it('captures the token from a GET response header and echoes it on the next state-changing request', async () => {
    const { apiRequest, getCsrfToken } = await freshApiClient();
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ user: null }, { headers: { 'x-csrf-token': 'token-abc' } }))
      .mockResolvedValueOnce(jsonResponse({ user: { id: '1' } }));

    await apiRequest('/api/v1/auth/me');
    expect(getCsrfToken()).toBe('token-abc');

    await apiRequest('/api/v1/auth/login', { method: 'POST', body: { email: 'a', password: 'b' } });

    const [, loginOptions] = vi.mocked(fetch).mock.calls[1]!;
    expect((loginOptions?.headers as Record<string, string>)['x-csrf-token']).toBe('token-abc');
  });

  it('captures the token even from an error (non-2xx) response, since the CSRF-issuing middleware runs before auth checks', async () => {
    const { apiRequest, getCsrfToken, ApiError } = await freshApiClient();
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        { error: { code: 'UNAUTHENTICATED', message: 'Not logged in' } },
        { status: 401, headers: { 'x-csrf-token': 'token-from-401' } },
      ),
    );

    await expect(apiRequest('/api/v1/auth/me')).rejects.toBeInstanceOf(ApiError);
    expect(getCsrfToken()).toBe('token-from-401');
  });

  it('never sends an x-csrf-token header on a GET request, even once a token is known', async () => {
    const { apiRequest } = await freshApiClient();
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({}, { headers: { 'x-csrf-token': 'token-xyz' } }))
      .mockResolvedValueOnce(jsonResponse({}));

    await apiRequest('/api/v1/employees');
    await apiRequest('/api/v1/employees');

    const [, secondGetOptions] = vi.mocked(fetch).mock.calls[1]!;
    expect((secondGetOptions?.headers as Record<string, string>)['x-csrf-token']).toBeUndefined();
  });

  it('builds request URLs by prefixing the configured API_BASE_URL, not a bare relative path', async () => {
    const { apiRequest, API_BASE_URL } = await freshApiClient();
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}));

    await apiRequest('/api/v1/employees');

    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${API_BASE_URL}/api/v1/employees`);
  });
});
