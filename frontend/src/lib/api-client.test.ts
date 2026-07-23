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
  const status = init.status ?? 200;
  // The Fetch spec forbids a body on a 204 — the real GET /api/v1/csrf-token recovery endpoint
  // (backend/src/app.ts) responds exactly this way (204, no body, token only in the header).
  const responseBody = status === 204 ? null : JSON.stringify(body);
  return new Response(responseBody, {
    status,
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

function csrfMismatchResponse() {
  return jsonResponse(
    { error: { code: 'CSRF_TOKEN_MISMATCH', message: 'Missing or invalid CSRF token' } },
    { status: 403 },
  );
}

/**
 * Checkpoint 4D correction — a rejected IP-keyed backend map was replaced with client-side
 * recovery: on a *specifically recognized* CSRF mismatch, refetch the token bound to whatever
 * cookie the browser currently holds (`GET /api/v1/csrf-token`) and retry the original mutation
 * exactly once (`api-client.ts`'s `refreshCsrfToken`/`apiRequest`).
 */
describe('apiRequest CSRF mismatch recovery', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('performs exactly one token refresh and retries the failed mutation once, using the refreshed token', async () => {
    const { apiRequest } = await freshApiClient();
    vi.mocked(fetch)
      .mockResolvedValueOnce(csrfMismatchResponse()) // original mutation, stale token
      .mockResolvedValueOnce(jsonResponse({}, { status: 204, headers: { 'x-csrf-token': 'refreshed-token' } })) // GET /api/v1/csrf-token
      .mockResolvedValueOnce(jsonResponse({ ok: true })); // retried mutation

    const result = await apiRequest<{ ok: boolean }>('/api/v1/employees', { method: 'POST', body: { name: 'x' } });

    expect(result).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(3);

    const [refreshUrl, refreshOptions] = vi.mocked(fetch).mock.calls[1]!;
    expect(refreshUrl).toContain('/api/v1/csrf-token');
    expect(refreshOptions?.method ?? 'GET').toBe('GET');

    const [, retryOptions] = vi.mocked(fetch).mock.calls[2]!;
    expect((retryOptions?.headers as Record<string, string>)['x-csrf-token']).toBe('refreshed-token');
  });

  it('surfaces a second, post-retry CSRF mismatch to the caller instead of retrying again', async () => {
    const { apiRequest, ApiError } = await freshApiClient();
    vi.mocked(fetch)
      .mockResolvedValueOnce(csrfMismatchResponse())
      .mockResolvedValueOnce(jsonResponse({}, { status: 204, headers: { 'x-csrf-token': 'refreshed-token' } }))
      .mockResolvedValueOnce(csrfMismatchResponse()); // retry also mismatches

    let caught: unknown;
    try {
      await apiRequest('/api/v1/employees', { method: 'POST', body: { name: 'x' } });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as InstanceType<typeof ApiError>).code).toBe('CSRF_TOKEN_MISMATCH');
    // Exactly 3 calls (original + refresh + one retry) — a second mismatch never triggers a
    // second refresh/retry cycle.
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['UNAUTHORIZED', 401],
    ['FORBIDDEN', 403],
    ['VALIDATION_ERROR', 400],
    ['CONFLICT', 409],
    ['UNPROCESSABLE', 422],
    ['INTERNAL_ERROR', 500],
  ])('does not retry a %s (%i) response as CSRF recovery', async (code, status) => {
    const { apiRequest } = await freshApiClient();
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: { code, message: 'nope' } }, { status }),
    );

    await expect(apiRequest('/api/v1/employees', { method: 'POST', body: { name: 'x' } })).rejects.toMatchObject({
      code,
    });
    // No refresh call, no retry — exactly the one request.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent mismatches into a single refresh call, not one per failing request', async () => {
    const { apiRequest } = await freshApiClient();
    let refreshCalls = 0;

    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/v1/csrf-token')) {
        refreshCalls += 1;
        return jsonResponse({}, { status: 204, headers: { 'x-csrf-token': 'refreshed-token' } });
      }
      // Two concurrent state-changing calls, both stale, both eventually retried successfully.
      return csrfMismatchResponse();
    });

    // First pass: both concurrent calls see CSRF_TOKEN_MISMATCH and each triggers recovery: since
    // the mock above always returns a mismatch for non-refresh URLs, both retries also mismatch —
    // what this test actually verifies is the refresh call itself is shared, not duplicated,
    // regardless of how many concurrent callers triggered it.
    await Promise.allSettled([
      apiRequest('/api/v1/employees', { method: 'POST', body: { name: 'a' } }),
      apiRequest('/api/v1/employees', { method: 'POST', body: { name: 'b' } }),
    ]);

    expect(refreshCalls).toBe(1);
  });

  it('never reads or writes localStorage/sessionStorage during a mismatch-recovery cycle', async () => {
    // vitest.config.ts deliberately runs this file under the plain Node environment, not jsdom
    // (no real `Storage`/`localStorage` global exists here) — stubbing plain spy objects on
    // `globalThis` is what actually proves the module under test never touches them, independent
    // of whatever DOM globals happen to be present in a given environment.
    const localStorageSpy = { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() };
    const sessionStorageSpy = { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() };
    vi.stubGlobal('localStorage', localStorageSpy);
    vi.stubGlobal('sessionStorage', sessionStorageSpy);

    const { apiRequest } = await freshApiClient();
    vi.mocked(fetch)
      .mockResolvedValueOnce(csrfMismatchResponse())
      .mockResolvedValueOnce(jsonResponse({}, { status: 204, headers: { 'x-csrf-token': 'refreshed-token' } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await apiRequest('/api/v1/employees', { method: 'POST', body: { name: 'x' } });

    for (const spy of [localStorageSpy, sessionStorageSpy]) {
      expect(spy.setItem).not.toHaveBeenCalled();
      expect(spy.getItem).not.toHaveBeenCalled();
      expect(spy.removeItem).not.toHaveBeenCalled();
      expect(spy.clear).not.toHaveBeenCalled();
    }
  });

  it('the retry bound is on the mismatch code, not the method — still never loops beyond one retry', async () => {
    // A GET can never legitimately receive CSRF_TOKEN_MISMATCH from this backend in practice
    // (csrfProtection exempts safe methods, and GET never even attaches the header), but the retry
    // guard itself keys on the error code, not the method, so this pins that even a hypothetical
    // GET mismatch still retries at most once and never loops.
    const { apiRequest } = await freshApiClient();
    vi.mocked(fetch)
      .mockResolvedValueOnce(csrfMismatchResponse())
      .mockResolvedValueOnce(jsonResponse({}, { status: 204, headers: { 'x-csrf-token': 'refreshed-token' } }))
      .mockResolvedValueOnce(csrfMismatchResponse());

    await expect(apiRequest('/api/v1/employees')).rejects.toMatchObject({ code: 'CSRF_TOKEN_MISMATCH' });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
