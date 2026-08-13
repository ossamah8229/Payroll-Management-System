// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-client';
import {
  VarianceReportExportRowLimitExceededError,
  downloadVarianceReportExport,
  varianceReportExportUrl,
  varianceReportListUrl,
  useVarianceReportList,
} from './use-variance-report';

const CURRENT_CYCLE = { id: 'cycle-current', year: 2026, month: 8 };
const COMPARISON_CYCLE = { id: 'cycle-comparison', year: 2026, month: 7 };

const baseParams = {
  currentCycleId: CURRENT_CYCLE.id,
  comparisonCycleId: COMPARISON_CYCLE.id,
  page: 1,
  pageSize: 25,
  sortBy: 'employeeName',
  sortDir: 'asc',
} as const;

describe('varianceReportListUrl', () => {
  it('requests the plain endpoint with both cycle ids/page/pageSize/sortBy/sortDir when no other filters are given', () => {
    expect(varianceReportListUrl(baseParams)).toBe(
      '/api/v1/reports/variance?currentCycleId=cycle-current&comparisonCycleId=cycle-comparison&page=1&pageSize=25&sortBy=employeeName&sortDir=asc',
    );
  });

  it('includes every filter field when given, with Site ids sorted deterministically', () => {
    const url = varianceReportListUrl({
      ...baseParams,
      siteIds: ['site-b', 'site-a'],
      unitId: 'unit-1',
      employeeId: 'emp-1',
      direction: 'INCREASED',
      hasCorrection: true,
      page: 2,
      pageSize: 50,
      sortBy: 'currentNet',
      sortDir: 'desc',
    });
    expect(url).toContain('currentCycleId=cycle-current');
    expect(url).toContain('comparisonCycleId=cycle-comparison');
    expect(url).toContain('siteIds=site-a%2Csite-b');
    expect(url).toContain('unitId=unit-1');
    expect(url).toContain('employeeId=emp-1');
    expect(url).toContain('direction=INCREASED');
    expect(url).toContain('hasCorrection=true');
    expect(url).toContain('page=2');
    expect(url).toContain('pageSize=50');
    expect(url).toContain('sortBy=currentNet');
    expect(url).toContain('sortDir=desc');
  });

  it('produces the identical query string regardless of Site pick order (stable query keys)', () => {
    const a = varianceReportListUrl({ ...baseParams, siteIds: ['site-a', 'site-b'] });
    const b = varianceReportListUrl({ ...baseParams, siteIds: ['site-b', 'site-a'] });
    expect(a).toBe(b);
  });

  it('omits siteIds entirely for an empty array (no filter, never zero-site scope)', () => {
    const url = varianceReportListUrl({ ...baseParams, siteIds: [] });
    expect(url).not.toContain('siteIds');
  });

  it('omits direction/hasCorrection/employeeId/unitId when not given', () => {
    const url = varianceReportListUrl(baseParams);
    expect(url).not.toContain('direction=');
    expect(url).not.toContain('hasCorrection=');
    expect(url).not.toContain('employeeId=');
    expect(url).not.toContain('unitId=');
  });

  it('never includes an unsupported filter (minimum variance, roster status, release date, payment method, correction reason, released by)', () => {
    const url = varianceReportListUrl({ ...baseParams, siteIds: ['site-1'], unitId: 'unit-1', direction: 'DECREASED', hasCorrection: false });
    for (const unsupported of ['minVariance=', 'rosterStatus=', 'releaseDate=', 'paymentMethod=', 'correctionReason=', 'releasedBy=', 'dateFrom=', 'dateTo=']) {
      expect(url).not.toContain(unsupported);
    }
  });
});

describe('useVarianceReportList — no request without BOTH cycles', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  function wrapper({ children }: { children: ReactNode }) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return createElement(QueryClientProvider, { client: queryClient }, children);
  }

  function mockOkResponse() {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        currentCycle: CURRENT_CYCLE,
        comparisonCycle: COMPARISON_CYCLE,
        page: 1,
        pageSize: 25,
        total: 0,
        rows: [],
        totals: {},
        generatedAt: '',
      }),
    });
  }

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('disables the query and makes no request when both cycle ids are empty', () => {
    const { result } = renderHook(() => useVarianceReportList({ ...baseParams, currentCycleId: '', comparisonCycleId: '' }), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('disables the query and makes no request when only currentCycleId is present', () => {
    const { result } = renderHook(() => useVarianceReportList({ ...baseParams, comparisonCycleId: '' }), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('disables the query and makes no request when only comparisonCycleId is present', () => {
    const { result } = renderHook(() => useVarianceReportList({ ...baseParams, currentCycleId: '' }), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('enables the query and issues exactly one request once BOTH cycle ids are supplied', async () => {
    mockOkResponse();
    const { result } = renderHook(() => useVarianceReportList(baseParams), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('currentCycleId=cycle-current');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('comparisonCycleId=cycle-comparison');
  });

  it('transitioning from one missing cycle to both present flips disabled to enabled, issuing exactly one request', async () => {
    mockOkResponse();
    const { result, rerender } = renderHook(
      ({ comparisonCycleId }: { comparisonCycleId: string }) => useVarianceReportList({ ...baseParams, comparisonCycleId }),
      { wrapper, initialProps: { comparisonCycleId: '' } },
    );
    expect(fetchMock).not.toHaveBeenCalled();

    rerender({ comparisonCycleId: COMPARISON_CYCLE.id });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('changing the comparison cycle while current stays fixed creates a new distinct query (a second request, never mixing stale rows)', async () => {
    mockOkResponse();
    const { result, rerender } = renderHook(
      ({ comparisonCycleId }: { comparisonCycleId: string }) => useVarianceReportList({ ...baseParams, comparisonCycleId }),
      { wrapper, initialProps: { comparisonCycleId: COMPARISON_CYCLE.id } },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender({ comparisonCycleId: 'cycle-other' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toContain('comparisonCycleId=cycle-other');
  });

  it('a rerender with the exact same params never issues a second request (no duplicate fetch from unrelated re-renders)', async () => {
    mockOkResponse();
    const { result, rerender } = renderHook(() => useVarianceReportList(baseParams), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender();
    rerender();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('varianceReportExportUrl', () => {
  it('builds the export endpoint with both cycle ids and format, and no page/pageSize ever accepted', () => {
    const url = varianceReportExportUrl(
      { currentCycleId: CURRENT_CYCLE.id, comparisonCycleId: COMPARISON_CYCLE.id },
      'employeeName',
      'asc',
      'csv',
    );
    expect(url).toContain('/api/v1/reports/variance/export?currentCycleId=cycle-current&comparisonCycleId=cycle-comparison');
    expect(url).toContain('sortBy=employeeName&sortDir=asc&format=csv');
    expect(url).not.toContain('page=');
    expect(url).not.toContain('pageSize=');
  });
});

/**
 * Request-parity proof: CSV and XLSX carry the exact current report state (both cycle ids, sorted
 * siteIds, unitId, employeeId, direction, hasCorrection, sortBy, sortDir), differing in nothing but
 * `format`, and never send `page`/`pageSize`.
 */
describe('varianceReportExportUrl — CSV/XLSX request parity', () => {
  const fullFilters = {
    currentCycleId: CURRENT_CYCLE.id,
    comparisonCycleId: COMPARISON_CYCLE.id,
    siteIds: ['site-b', 'site-a'],
    unitId: 'unit-1',
    employeeId: 'emp-1',
    direction: 'DECREASED' as const,
    hasCorrection: true,
  };

  it('CSV and XLSX built from the identical current filters/sort produce identical query strings except for `format`', () => {
    const csvUrl = new URL(varianceReportExportUrl(fullFilters, 'varianceAmount', 'desc', 'csv'), 'http://x');
    const xlsxUrl = new URL(varianceReportExportUrl(fullFilters, 'varianceAmount', 'desc', 'xlsx'), 'http://x');

    const csvParams = new Map(csvUrl.searchParams);
    const xlsxParams = new Map(xlsxUrl.searchParams);
    csvParams.delete('format');
    xlsxParams.delete('format');
    expect(Object.fromEntries(csvParams)).toEqual(Object.fromEntries(xlsxParams));
    expect(csvUrl.searchParams.get('format')).toBe('csv');
    expect(xlsxUrl.searchParams.get('format')).toBe('xlsx');
  });

  it('neither format ever includes page/pageSize or an unsupported filter', () => {
    for (const format of ['csv', 'xlsx'] as const) {
      const url = varianceReportExportUrl(fullFilters, 'employeeCode', 'asc', format);
      for (const unsupported of ['page=', 'pageSize=', 'minVariance=', 'rosterStatus=', 'releaseDate=', 'paymentMethod=']) {
        expect(url).not.toContain(unsupported);
      }
    }
  });

  it('a tri-state/optional field left unset is omitted from both formats identically', () => {
    const partialFilters = { currentCycleId: CURRENT_CYCLE.id, comparisonCycleId: COMPARISON_CYCLE.id };
    for (const format of ['csv', 'xlsx'] as const) {
      const url = varianceReportExportUrl(partialFilters, 'employeeName', 'asc', format);
      for (const omitted of ['siteIds=', 'unitId=', 'employeeId=', 'direction=', 'hasCorrection=']) {
        expect(url).not.toContain(omitted);
      }
    }
  });
});

describe('downloadVarianceReportExport', () => {
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
    const headers = new Headers({ 'content-disposition': 'attachment; filename="variance-report.csv"' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => blob, headers });
    vi.stubGlobal('fetch', fetchMock);
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    const revokeSpy = vi.fn();
    URL.revokeObjectURL = revokeSpy;
    const { getLastDownloadFilename } = spyOnAnchorClick();

    await downloadVarianceReportExport(
      CURRENT_CYCLE,
      COMPARISON_CYCLE,
      { currentCycleId: CURRENT_CYCLE.id, comparisonCycleId: COMPARISON_CYCLE.id },
      'employeeName',
      'asc',
      'csv',
    );

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/reports/variance/export?currentCycleId=cycle-current&comparisonCycleId=cycle-comparison'),
      { credentials: 'include' },
    );
    expect(getLastDownloadFilename()).toBe('variance-report.csv');
    expect(revokeSpy).toHaveBeenCalledWith('blob:mock');
  });

  it('falls back to a computed filename (both cycles) when no Content-Disposition header is present', async () => {
    const blob = new Blob(['file contents']);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => blob, headers: new Headers() });
    vi.stubGlobal('fetch', fetchMock);
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
    const { getLastDownloadFilename } = spyOnAnchorClick();

    await downloadVarianceReportExport(
      CURRENT_CYCLE,
      COMPARISON_CYCLE,
      { currentCycleId: CURRENT_CYCLE.id, comparisonCycleId: COMPARISON_CYCLE.id },
      'employeeName',
      'asc',
      'xlsx',
    );

    expect(getLastDownloadFilename()).toBe('variance-report-2026-07-vs-2026-08.xlsx');
  });

  it('throws a generic ApiError for a non-413 failure, without attempting a download', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, headers: new Headers() }));
    const { getLastDownloadFilename } = spyOnAnchorClick();

    await expect(
      downloadVarianceReportExport(
        CURRENT_CYCLE,
        COMPARISON_CYCLE,
        { currentCycleId: CURRENT_CYCLE.id, comparisonCycleId: COMPARISON_CYCLE.id },
        'employeeName',
        'asc',
        'csv',
      ),
    ).rejects.toBeInstanceOf(ApiError);
    expect(getLastDownloadFilename()).toBeUndefined();
  });

  it('throws VarianceReportExportRowLimitExceededError with the backend structured message on 413, without attempting a download', async () => {
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

    const error = await downloadVarianceReportExport(
      CURRENT_CYCLE,
      COMPARISON_CYCLE,
      { currentCycleId: CURRENT_CYCLE.id, comparisonCycleId: COMPARISON_CYCLE.id },
      'employeeName',
      'asc',
      'csv',
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VarianceReportExportRowLimitExceededError);
    expect((error as VarianceReportExportRowLimitExceededError).matchingCount).toBe(25000);
    expect((error as VarianceReportExportRowLimitExceededError).maxRows).toBe(20000);
    expect((error as VarianceReportExportRowLimitExceededError).message).toContain('Narrow your filters');
    expect(getLastDownloadFilename()).toBeUndefined();
  });
});
