// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  assignmentMismatchReadinessExportUrl,
  assignmentMismatchReadinessListUrl,
  useAssignmentMismatchReadinessList,
} from './use-assignment-mismatch-readiness';

const CYCLE = { id: 'cycle-1', year: 2026, month: 9 };

describe('assignmentMismatchReadinessListUrl', () => {
  it('requests the plain endpoint with cycleId/page/pageSize/sortBy/sortDir when no other filters are given', () => {
    expect(
      assignmentMismatchReadinessListUrl({ cycleId: 'cycle-1', page: 1, pageSize: 25, sortBy: 'employeeName', sortDir: 'asc' }),
    ).toBe('/api/v1/reports/assignment-mismatch-readiness?cycleId=cycle-1&page=1&pageSize=25&sortBy=employeeName&sortDir=asc');
  });

  it('includes every filter field when given, with Site ids sorted deterministically', () => {
    const url = assignmentMismatchReadinessListUrl({
      cycleId: 'cycle-1',
      siteIds: ['site-b', 'site-a'],
      unitId: 'unit-1',
      shape: 'SPLIT',
      held: true,
      safeShapeOnly: false,
      page: 2,
      pageSize: 50,
      sortBy: 'payrollSite',
      sortDir: 'desc',
    });
    expect(url).toContain('cycleId=cycle-1');
    expect(url).toContain('siteIds=site-a%2Csite-b');
    expect(url).toContain('unitId=unit-1');
    expect(url).toContain('shape=SPLIT');
    expect(url).toContain('held=true');
    expect(url).toContain('safeShapeOnly=false');
    expect(url).toContain('page=2');
    expect(url).toContain('pageSize=50');
    expect(url).toContain('sortBy=payrollSite');
    expect(url).toContain('sortDir=desc');
  });

  it('produces the identical query string regardless of Site pick order (stable query keys)', () => {
    const params = { cycleId: 'cycle-1', page: 1, pageSize: 25, sortBy: 'employeeName' as const, sortDir: 'asc' as const };
    const a = assignmentMismatchReadinessListUrl({ ...params, siteIds: ['site-a', 'site-b'] });
    const b = assignmentMismatchReadinessListUrl({ ...params, siteIds: ['site-b', 'site-a'] });
    expect(a).toBe(b);
  });

  it('omits siteIds entirely for an empty array (no filter, never zero-site scope)', () => {
    const url = assignmentMismatchReadinessListUrl({
      cycleId: 'cycle-1',
      siteIds: [],
      page: 1,
      pageSize: 25,
      sortBy: 'employeeName',
      sortDir: 'asc',
    });
    expect(url).not.toContain('siteIds');
  });

  it('omits shape/held/safeShapeOnly when undefined ("All")', () => {
    const url = assignmentMismatchReadinessListUrl({ cycleId: 'cycle-1', page: 1, pageSize: 25, sortBy: 'employeeName', sortDir: 'asc' });
    expect(url).not.toContain('shape');
    expect(url).not.toContain('held');
    expect(url).not.toContain('safeShapeOnly');
  });

  it('never includes an unsupported filter (this report has no financial/employee-search/date-range filter)', () => {
    const url = assignmentMismatchReadinessListUrl({ cycleId: 'cycle-1', page: 1, pageSize: 25, sortBy: 'employeeName', sortDir: 'asc' });
    for (const unsupported of ['employeeId=', 'netSalary=', 'grossPay=', 'fromCycleId=', 'toCycleId=']) {
      expect(url).not.toContain(unsupported);
    }
  });
});

describe('assignmentMismatchReadinessExportUrl', () => {
  it('mirrors the list filters plus format, against the export endpoint (absolute URL)', () => {
    const url = assignmentMismatchReadinessExportUrl(
      { cycleId: 'cycle-1', siteIds: ['site-a'], held: true },
      'employeeName',
      'asc',
      'xlsx',
    );
    expect(url).toContain('/api/v1/reports/assignment-mismatch-readiness/export?');
    expect(url).toContain('cycleId=cycle-1');
    expect(url).toContain('siteIds=site-a');
    expect(url).toContain('held=true');
    expect(url).toContain('format=xlsx');
  });
});

describe('useAssignmentMismatchReadinessList — no request without a Draft cycle', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  function wrapper({ children }: { children: ReactNode }) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return createElement(QueryClientProvider, { client: queryClient }, children);
  }

  const baseParams = { page: 1, pageSize: 25, sortBy: 'employeeName', sortDir: 'asc' } as const;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('disables the query and makes no request when cycleId is an empty string', () => {
    const { result } = renderHook(() => useAssignmentMismatchReadinessList({ cycleId: '', ...baseParams }), { wrapper });

    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.isFetching).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('enables the query and issues exactly one request once a real cycleId is supplied (positive control)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ cycle: CYCLE, page: 1, pageSize: 25, total: 0, rows: [], totals: {}, generatedAt: '' }),
    });

    const { result } = renderHook(() => useAssignmentMismatchReadinessList({ cycleId: 'cycle-1', ...baseParams }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/v1/reports/assignment-mismatch-readiness?cycleId=cycle-1');
  });

  it('changing only a filter issues exactly one new request, not a duplicate/stale one (stable query keys)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ cycle: CYCLE, page: 1, pageSize: 25, total: 0, rows: [], totals: {}, generatedAt: '' }),
    });

    type Params = Parameters<typeof useAssignmentMismatchReadinessList>[0];
    const initial: Params = { cycleId: 'cycle-1', ...baseParams };
    const { result, rerender } = renderHook((params: Params) => useAssignmentMismatchReadinessList(params), {
      wrapper,
      initialProps: initial,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const filtered: Params = { ...initial, held: true };
    rerender(filtered);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toContain('held=true');
  });
});
