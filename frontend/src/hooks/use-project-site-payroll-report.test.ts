// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-client';
import {
  ProjectSitePayrollReportExportRowLimitExceededError,
  downloadProjectSitePayrollReportExport,
  projectSitePayrollReportExportUrl,
  projectSitePayrollReportListUrl,
  useProjectSitePayrollReportList,
} from './use-project-site-payroll-report';

const CYCLE = { id: 'cycle-1', year: 2026, month: 7 };

describe('projectSitePayrollReportListUrl', () => {
  it('requests the plain endpoint with cycleId/page/pageSize/sortBy/sortDir when no other filters are given', () => {
    expect(
      projectSitePayrollReportListUrl({ cycleId: 'cycle-1', page: 1, pageSize: 25, sortBy: 'employeeName', sortDir: 'asc' }),
    ).toBe('/api/v1/reports/project-site-payroll?cycleId=cycle-1&page=1&pageSize=25&sortBy=employeeName&sortDir=asc');
  });

  it('includes every filter field when given, with Site ids sorted deterministically', () => {
    const url = projectSitePayrollReportListUrl({
      cycleId: 'cycle-1',
      siteIds: ['site-b', 'site-a'],
      unitId: 'unit-1',
      rowStatus: 'HELD',
      hasCorrection: true,
      page: 2,
      pageSize: 50,
      sortBy: 'netSalary',
      sortDir: 'desc',
    });
    expect(url).toContain('cycleId=cycle-1');
    expect(url).toContain('siteIds=site-a%2Csite-b');
    expect(url).toContain('unitId=unit-1');
    expect(url).toContain('rowStatus=HELD');
    expect(url).toContain('hasCorrection=true');
    expect(url).toContain('page=2');
    expect(url).toContain('pageSize=50');
    expect(url).toContain('sortBy=netSalary');
    expect(url).toContain('sortDir=desc');
  });

  it('produces the identical query string regardless of Site pick order (stable query keys)', () => {
    const params = { cycleId: 'cycle-1', page: 1, pageSize: 25, sortBy: 'employeeName' as const, sortDir: 'asc' as const };
    const a = projectSitePayrollReportListUrl({ ...params, siteIds: ['site-a', 'site-b'] });
    const b = projectSitePayrollReportListUrl({ ...params, siteIds: ['site-b', 'site-a'] });
    expect(a).toBe(b);
  });

  it('omits siteIds entirely for an empty array (no filter, never zero-site scope)', () => {
    const url = projectSitePayrollReportListUrl({
      cycleId: 'cycle-1',
      siteIds: [],
      page: 1,
      pageSize: 25,
      sortBy: 'employeeName',
      sortDir: 'asc',
    });
    expect(url).not.toContain('siteIds');
  });
});

describe('useProjectSitePayrollReportList — no request without a Cycle', () => {
  /**
   * Direct hook-level proof (not just a page-level mock, and not just the pure URL builders above)
   * that `enabled: Boolean(params.cycleId)` actually disables the underlying `useQuery` and issues
   * zero network calls — `global.fetch` is stubbed and asserted never-called, the same real-fetch-
   * mocking convention `use-payroll-entry-editor.test.tsx` already establishes for exercising a real
   * hook/query configuration rather than a pure function.
   */
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
    const { result } = renderHook(() => useProjectSitePayrollReportList({ cycleId: '', ...baseParams }), { wrapper });

    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.isFetching).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stays disabled with no request across re-renders as long as cycleId remains empty', () => {
    const { result, rerender } = renderHook(
      ({ cycleId }: { cycleId: string }) => useProjectSitePayrollReportList({ cycleId, ...baseParams }),
      { wrapper, initialProps: { cycleId: '' } },
    );
    rerender({ cycleId: '' });
    rerender({ cycleId: '' });

    expect(result.current.fetchStatus).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('enables the query and issues exactly one request to the list endpoint once a real cycleId is supplied (positive control)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ cycle: CYCLE, page: 1, pageSize: 25, total: 0, rows: [], totals: {}, generatedAt: '' }),
    });

    const { result } = renderHook(() => useProjectSitePayrollReportList({ cycleId: 'cycle-1', ...baseParams }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/v1/reports/project-site-payroll?cycleId=cycle-1');
  });

  it('transitioning from an empty cycleId to a real one flips the query from disabled to enabled, issuing exactly one request', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ cycle: CYCLE, page: 1, pageSize: 25, total: 0, rows: [], totals: {}, generatedAt: '' }),
    });

    const { result, rerender } = renderHook(
      ({ cycleId }: { cycleId: string }) => useProjectSitePayrollReportList({ cycleId, ...baseParams }),
      { wrapper, initialProps: { cycleId: '' } },
    );
    expect(fetchMock).not.toHaveBeenCalled();

    rerender({ cycleId: 'cycle-1' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('projectSitePayrollReportExportUrl', () => {
  it('builds the export endpoint with format and no page/pageSize ever accepted', () => {
    const url = projectSitePayrollReportExportUrl({ cycleId: 'cycle-1' }, 'employeeName', 'asc', 'csv');
    expect(url).toContain('/api/v1/reports/project-site-payroll/export?cycleId=cycle-1');
    expect(url).toContain('sortBy=employeeName&sortDir=asc&format=csv');
    expect(url).not.toContain('page=');
    expect(url).not.toContain('pageSize=');
  });

  it('includes filters when given', () => {
    const url = projectSitePayrollReportExportUrl(
      { cycleId: 'cycle-1', siteIds: ['site-1'], unitId: 'unit-1', rowStatus: 'RELEASED', hasCorrection: false },
      'netSalary',
      'desc',
      'xlsx',
    );
    expect(url).toContain('siteIds=site-1');
    expect(url).toContain('unitId=unit-1');
    expect(url).toContain('rowStatus=RELEASED');
    expect(url).toContain('hasCorrection=false');
    expect(url).toContain('format=xlsx');
  });
});

describe('downloadProjectSitePayrollReportExport', () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function spyOnAnchorClick(): { getLastDownloadFilename: () => string | undefined } {
    let lastFilename: string | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      lastFilename = this.download;
    });
    return { getLastDownloadFilename: () => lastFilename };
  }

  it('fetches the export URL (GET, no body), revokes the object URL, and downloads using the server filename when present', async () => {
    const blob = new Blob(['file contents']);
    const headers = new Headers({ 'content-disposition': 'attachment; filename="project-site-payroll.csv"' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => blob, headers });
    vi.stubGlobal('fetch', fetchMock);
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    const revokeSpy = vi.fn();
    URL.revokeObjectURL = revokeSpy;
    const { getLastDownloadFilename } = spyOnAnchorClick();

    await downloadProjectSitePayrollReportExport(CYCLE, { cycleId: 'cycle-1' }, 'employeeName', 'asc', 'csv');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/reports/project-site-payroll/export?cycleId=cycle-1'),
      { credentials: 'include' },
    );
    expect(getLastDownloadFilename()).toBe('project-site-payroll.csv');
    expect(revokeSpy).toHaveBeenCalledWith('blob:mock');
  });

  it('falls back to a computed filename (cycle-derived) when no Content-Disposition header is present', async () => {
    const blob = new Blob(['file contents']);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => blob, headers: new Headers() });
    vi.stubGlobal('fetch', fetchMock);
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
    const { getLastDownloadFilename } = spyOnAnchorClick();

    await downloadProjectSitePayrollReportExport(CYCLE, { cycleId: 'cycle-1' }, 'employeeName', 'asc', 'xlsx');

    expect(getLastDownloadFilename()).toBe('project-site-payroll-2026-07.xlsx');
  });

  it('throws a generic ApiError for a non-413 failure, without attempting a download', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, headers: new Headers() }));
    const { getLastDownloadFilename } = spyOnAnchorClick();

    await expect(
      downloadProjectSitePayrollReportExport(CYCLE, { cycleId: 'cycle-1' }, 'employeeName', 'asc', 'csv'),
    ).rejects.toBeInstanceOf(ApiError);
    expect(getLastDownloadFilename()).toBeUndefined();
  });

  it('throws ProjectSitePayrollReportExportRowLimitExceededError with the backend structured message on 413, without attempting a download', async () => {
    const errorBody = {
      error: {
        code: 'EXPORT_ROW_LIMIT_EXCEEDED',
        matchingCount: 25000,
        maxRows: 20000,
        message: 'This export matches 25000 rows, which exceeds the 20000-row limit. Narrow your filters and try again.',
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 413, headers: new Headers(), json: async () => errorBody }),
    );
    const { getLastDownloadFilename } = spyOnAnchorClick();

    const error = await downloadProjectSitePayrollReportExport(CYCLE, { cycleId: 'cycle-1' }, 'employeeName', 'asc', 'csv').catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ProjectSitePayrollReportExportRowLimitExceededError);
    expect((error as ProjectSitePayrollReportExportRowLimitExceededError).matchingCount).toBe(25000);
    expect((error as ProjectSitePayrollReportExportRowLimitExceededError).maxRows).toBe(20000);
    expect((error as ProjectSitePayrollReportExportRowLimitExceededError).message).toContain('Narrow your filters');
    expect(getLastDownloadFilename()).toBeUndefined();
  });
});
