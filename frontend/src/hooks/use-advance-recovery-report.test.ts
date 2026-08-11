// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-client';
import {
  AdvanceRecoveryReportExportRowLimitExceededError,
  advanceRecoveryReportExportUrl,
  advanceRecoveryReportListUrl,
  downloadAdvanceRecoveryReportExport,
  useAdvanceRecoveryReportList,
} from './use-advance-recovery-report';

describe('advanceRecoveryReportListUrl', () => {
  it('requests the plain endpoint with only page/pageSize/sortBy/sortDir when no cycle or filters are given', () => {
    expect(advanceRecoveryReportListUrl({ page: 1, pageSize: 25, sortBy: 'employeeName', sortDir: 'asc' })).toBe(
      '/api/v1/reports/advance-recovery?page=1&pageSize=25&sortBy=employeeName&sortDir=asc',
    );
  });

  it('never requires cycleId — the optional-Cycle roster is a complete, valid request on its own', () => {
    const url = advanceRecoveryReportListUrl({ page: 1, pageSize: 25, sortBy: 'employeeName', sortDir: 'asc' });
    expect(url).not.toContain('cycleId');
  });

  it('includes cycleId only when explicitly provided', () => {
    const url = advanceRecoveryReportListUrl({
      cycleId: 'cycle-1',
      page: 1,
      pageSize: 25,
      sortBy: 'employeeName',
      sortDir: 'asc',
    });
    expect(url).toContain('cycleId=cycle-1');
  });

  it('includes every filter field when given', () => {
    const url = advanceRecoveryReportListUrl({
      siteIds: ['site-b', 'site-a'],
      employeeId: 'employee-1',
      advanceType: 'LOAN',
      status: 'ACTIVE',
      hasOutstandingBalance: true,
      cycleId: 'cycle-1',
      page: 2,
      pageSize: 50,
      sortBy: 'originalAmount',
      sortDir: 'desc',
    });
    expect(url).toContain('siteIds=site-a%2Csite-b');
    expect(url).toContain('employeeId=employee-1');
    expect(url).toContain('advanceType=LOAN');
    expect(url).toContain('status=ACTIVE');
    expect(url).toContain('hasOutstandingBalance=true');
    expect(url).toContain('cycleId=cycle-1');
    expect(url).toContain('page=2');
    expect(url).toContain('pageSize=50');
    expect(url).toContain('sortBy=originalAmount');
    expect(url).toContain('sortDir=desc');
  });

  it('produces the identical query string regardless of Site pick order (stable query keys)', () => {
    const params = { page: 1, pageSize: 25, sortBy: 'employeeName' as const, sortDir: 'asc' as const };
    const a = advanceRecoveryReportListUrl({ ...params, siteIds: ['site-a', 'site-b'] });
    const b = advanceRecoveryReportListUrl({ ...params, siteIds: ['site-b', 'site-a'] });
    expect(a).toBe(b);
  });

  it('omits siteIds entirely for an empty array (no filter, never zero-site scope)', () => {
    const url = advanceRecoveryReportListUrl({ siteIds: [], page: 1, pageSize: 25, sortBy: 'employeeName', sortDir: 'asc' });
    expect(url).not.toContain('siteIds');
  });

  it('omits hasOutstandingBalance when undefined ("All")', () => {
    const url = advanceRecoveryReportListUrl({ page: 1, pageSize: 25, sortBy: 'employeeName', sortDir: 'asc' });
    expect(url).not.toContain('hasOutstandingBalance');
  });
});

describe('useAdvanceRecoveryReportList — always enabled (Cycle is optional)', () => {
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

  it('issues exactly one request with no cycleId at all — an omitted Cycle is a complete, valid request', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ cycle: null, page: 1, pageSize: 25, total: 0, rows: [], totals: {}, generatedAt: '' }),
    });

    const { result } = renderHook(() => useAdvanceRecoveryReportList({ ...baseParams }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain('cycleId');
    expect(result.current.data?.cycle).toBeNull();
  });

  it('issues exactly one request carrying cycleId once a Cycle is selected', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        cycle: { id: 'cycle-1', year: 2026, month: 8, status: 'DRAFT' },
        page: 1,
        pageSize: 25,
        total: 0,
        rows: [],
        totals: {},
        generatedAt: '',
      }),
    });

    const { result } = renderHook(() => useAdvanceRecoveryReportList({ ...baseParams, cycleId: 'cycle-1' }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('cycleId=cycle-1');
  });
});

describe('advanceRecoveryReportExportUrl', () => {
  it('builds the export endpoint with format and no page/pageSize ever accepted', () => {
    const url = advanceRecoveryReportExportUrl({}, 'employeeName', 'asc', 'csv');
    expect(url).toContain('/api/v1/reports/advance-recovery/export?');
    expect(url).toContain('sortBy=employeeName&sortDir=asc&format=csv');
    expect(url).not.toContain('page=');
    expect(url).not.toContain('pageSize=');
  });

  it('works with no cycleId — an export of the current roster is valid without a Cycle', () => {
    const url = advanceRecoveryReportExportUrl({}, 'employeeName', 'asc', 'csv');
    expect(url).not.toContain('cycleId');
  });

  it('includes filters and cycleId when given', () => {
    const url = advanceRecoveryReportExportUrl(
      { siteIds: ['site-1'], employeeId: 'employee-1', advanceType: 'EID_ADVANCE', status: 'RESERVED', hasOutstandingBalance: false, cycleId: 'cycle-1' },
      'currentOutstandingBalance',
      'desc',
      'xlsx',
    );
    expect(url).toContain('siteIds=site-1');
    expect(url).toContain('employeeId=employee-1');
    expect(url).toContain('advanceType=EID_ADVANCE');
    expect(url).toContain('status=RESERVED');
    expect(url).toContain('hasOutstandingBalance=false');
    expect(url).toContain('cycleId=cycle-1');
    expect(url).toContain('format=xlsx');
  });
});

describe('advanceRecoveryReportExportUrl — CSV/XLSX request parity', () => {
  const fullFilters = {
    siteIds: ['site-b', 'site-a'],
    employeeId: 'employee-1',
    advanceType: 'LOAN' as const,
    status: 'ACTIVE' as const,
    hasOutstandingBalance: true,
    cycleId: 'cycle-1',
  };

  it('CSV and XLSX built from identical current filters/sort produce identical query strings except for `format`', () => {
    const csvUrl = new URL(advanceRecoveryReportExportUrl(fullFilters, 'originalAmount', 'desc', 'csv'), 'http://x');
    const xlsxUrl = new URL(advanceRecoveryReportExportUrl(fullFilters, 'originalAmount', 'desc', 'xlsx'), 'http://x');

    const csvParams = new Map(csvUrl.searchParams);
    const xlsxParams = new Map(xlsxUrl.searchParams);
    csvParams.delete('format');
    xlsxParams.delete('format');
    expect(Object.fromEntries(csvParams)).toEqual(Object.fromEntries(xlsxParams));
    expect(csvUrl.searchParams.get('format')).toBe('csv');
    expect(xlsxUrl.searchParams.get('format')).toBe('xlsx');
  });

  it('neither format ever includes page/pageSize or an unsupported filter (unit, has correction, amount range, date range)', () => {
    for (const format of ['csv', 'xlsx'] as const) {
      const url = advanceRecoveryReportExportUrl(fullFilters, 'employeeCode', 'asc', format);
      for (const unsupported of ['page=', 'pageSize=', 'unitId=', 'hasCorrection=', 'amountFrom=', 'dateFrom=', 'rosterStatus=']) {
        expect(url).not.toContain(unsupported);
      }
    }
  });

  it('a tri-state left at "All" (undefined) is omitted identically for both formats, never sent as a false-equivalent value', () => {
    const partialFilters = { cycleId: 'cycle-1' };
    for (const format of ['csv', 'xlsx'] as const) {
      const url = advanceRecoveryReportExportUrl(partialFilters, 'employeeName', 'asc', format);
      expect(url).not.toContain('hasOutstandingBalance=');
    }
  });
});

describe('downloadAdvanceRecoveryReportExport', () => {
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
    const headers = new Headers({ 'content-disposition': 'attachment; filename="advance-recovery-report-asof-2026-08-10.csv"' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => blob, headers });
    vi.stubGlobal('fetch', fetchMock);
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    const revokeSpy = vi.fn();
    URL.revokeObjectURL = revokeSpy;
    const { getLastDownloadFilename } = spyOnAnchorClick();

    await downloadAdvanceRecoveryReportExport({}, 'employeeName', 'asc', 'csv');

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/v1/reports/advance-recovery/export?'), {
      credentials: 'include',
    });
    expect(getLastDownloadFilename()).toBe('advance-recovery-report-asof-2026-08-10.csv');
    expect(revokeSpy).toHaveBeenCalledWith('blob:mock');
  });

  it('falls back to a plain computed filename when no Content-Disposition header is present', async () => {
    const blob = new Blob(['file contents']);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => blob, headers: new Headers() });
    vi.stubGlobal('fetch', fetchMock);
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
    const { getLastDownloadFilename } = spyOnAnchorClick();

    await downloadAdvanceRecoveryReportExport({}, 'employeeName', 'asc', 'xlsx');

    expect(getLastDownloadFilename()).toBe('advance-recovery-report.xlsx');
  });

  it('throws a generic ApiError for a non-413 failure, without attempting a download', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, headers: new Headers() }));
    const { getLastDownloadFilename } = spyOnAnchorClick();

    await expect(downloadAdvanceRecoveryReportExport({}, 'employeeName', 'asc', 'csv')).rejects.toBeInstanceOf(ApiError);
    expect(getLastDownloadFilename()).toBeUndefined();
  });

  it('throws AdvanceRecoveryReportExportRowLimitExceededError with the backend structured message on 413, without attempting a download', async () => {
    const errorBody = {
      error: {
        code: 'EXPORT_ROW_LIMIT_EXCEEDED',
        matchingCount: 25000,
        maxRows: 20000,
        message: 'This export matches 25000 rows, which exceeds the 20000-row limit. Narrow your filters and try again.',
      },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 413, headers: new Headers(), json: async () => errorBody }));
    const { getLastDownloadFilename } = spyOnAnchorClick();

    const error = await downloadAdvanceRecoveryReportExport({}, 'employeeName', 'asc', 'csv').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdvanceRecoveryReportExportRowLimitExceededError);
    expect((error as AdvanceRecoveryReportExportRowLimitExceededError).matchingCount).toBe(25000);
    expect((error as AdvanceRecoveryReportExportRowLimitExceededError).maxRows).toBe(20000);
    expect((error as AdvanceRecoveryReportExportRowLimitExceededError).message).toContain('Narrow your filters');
    expect(getLastDownloadFilename()).toBeUndefined();
  });
});
