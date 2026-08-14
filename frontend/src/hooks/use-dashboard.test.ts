// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DASHBOARD_QUERY_KEY, useDashboard } from './use-dashboard';

const CYCLE = { id: 'cycle-1', year: 2026, month: 8, status: 'DRAFT' as const };

function mockDashboardResponse() {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({
      generatedAt: '2026-08-14T00:00:00.000Z',
      cycle: CYCLE,
      siteScope: { siteIds: null },
      totalEmployees: 42,
      netPayroll: '100000.00',
      pendingRelease: { count: 3, amount: '5000.00' },
      releaseProgress: {
        totalCount: 42,
        releasedCount: 39,
        pendingCount: 3,
        heldCount: 0,
        noPayDueCount: 0,
        recoveryDueCount: 0,
        releasedAmount: '95000.00',
        pendingAmount: '5000.00',
      },
      deductionBreakdown: { eobi: '100.00', advance: '200.00', eidAdvance: '0.00', fine: '0.00' },
      siteSummary: [],
      siteSummaryTotalSites: 0,
      attention: { heldEntries: { count: 0 }, pendingCorrections: { count: 0 }, recoveryDue: { count: 0, amount: '0.00' } },
    }),
  };
}

describe('useDashboard — stable query key, single request, no fan-out', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  function wrapper({ children }: { children: ReactNode }) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return createElement(QueryClientProvider, { client: queryClient }, children);
  }

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('has a stable, fixed query key — the endpoint takes no request parameters at all', () => {
    expect(DASHBOARD_QUERY_KEY).toEqual(['dashboard']);
  });

  it('issues exactly one request to GET /api/v1/dashboard on mount', async () => {
    fetchMock.mockResolvedValue(mockDashboardResponse());
    const { result } = renderHook(() => useDashboard(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/v1/dashboard');
  });

  it('never issues a second request from an unrelated rerender (no duplicate fetch)', async () => {
    fetchMock.mockResolvedValue(mockDashboardResponse());
    const { result, rerender } = renderHook(() => useDashboard(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender();
    rerender();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never fans out to any per-widget report endpoint — the mock only ever serves the one aggregation URL', async () => {
    fetchMock.mockResolvedValue(mockDashboardResponse());
    const { result } = renderHook(() => useDashboard(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const requestedUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(requestedUrls).toEqual(['/api/v1/dashboard']);
    for (const unexpected of [
      '/api/v1/reports/payroll-summary',
      '/api/v1/reports/deduction-report',
      '/api/v1/reports/salary-release',
      '/api/v1/reports/project-site-payroll',
      '/api/v1/reports/advance-recovery',
    ]) {
      expect(requestedUrls).not.toContain(unexpected);
    }
  });

  it('two independently mounted instances sharing one QueryClient still issue exactly one network request (cache dedup)', async () => {
    fetchMock.mockResolvedValue(mockDashboardResponse());
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function sharedWrapper({ children }: { children: ReactNode }) {
      return createElement(QueryClientProvider, { client: queryClient }, children);
    }

    const first = renderHook(() => useDashboard(), { wrapper: sharedWrapper });
    const second = renderHook(() => useDashboard(), { wrapper: sharedWrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces a genuine fetch failure as an error state, never a silently swallowed empty dashboard', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } }),
    });
    const { result } = renderHook(() => useDashboard(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
