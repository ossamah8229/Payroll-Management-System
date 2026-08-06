// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import {
  ExportRowLimitExceededError,
  downloadEmployeePayrollHistoryExport,
  employeePayrollHistoryEmployeesUrl,
  employeePayrollHistoryExportUrl,
  employeePayrollHistoryListUrl,
} from './use-employee-payroll-history';

describe('employeePayrollHistoryListUrl', () => {
  it('requests the plain endpoint with only page/pageSize/sortBy/sortDir when no filters are given', () => {
    expect(employeePayrollHistoryListUrl({ page: 1, pageSize: 25, sortBy: 'cycle', sortDir: 'desc' })).toBe(
      '/api/v1/reports/employee-payroll-history?page=1&pageSize=25&sortBy=cycle&sortDir=desc',
    );
  });

  it('includes every filter field when given', () => {
    const url = employeePayrollHistoryListUrl({
      employeeId: 'emp-1',
      siteIds: ['site-b', 'site-a'],
      unitId: 'unit-1',
      fromCycleId: 'cycle-1',
      toCycleId: 'cycle-2',
      rowStatus: 'HELD',
      hasCorrection: true,
      hasOutstandingOriginBalance: false,
      currentEmployeeRosterStatus: 'DEPARTED',
      page: 2,
      pageSize: 50,
      sortBy: 'netSalary',
      sortDir: 'asc',
    });
    expect(url).toContain('employeeId=emp-1');
    expect(url).toContain('siteIds=site-b%2Csite-a');
    expect(url).toContain('unitId=unit-1');
    expect(url).toContain('fromCycleId=cycle-1');
    expect(url).toContain('toCycleId=cycle-2');
    expect(url).toContain('rowStatus=HELD');
    expect(url).toContain('hasCorrection=true');
    expect(url).toContain('hasOutstandingOriginBalance=false');
    expect(url).toContain('currentEmployeeRosterStatus=DEPARTED');
    expect(url).toContain('page=2');
    expect(url).toContain('pageSize=50');
    expect(url).toContain('sortBy=netSalary');
    expect(url).toContain('sortDir=asc');
  });

  it('omits siteIds entirely for an empty array (no filter, never zero-site scope)', () => {
    const url = employeePayrollHistoryListUrl({ siteIds: [], page: 1, pageSize: 25, sortBy: 'cycle', sortDir: 'desc' });
    expect(url).not.toContain('siteIds');
  });
});

describe('employeePayrollHistoryEmployeesUrl', () => {
  it('requests the plain endpoint with no params', () => {
    expect(employeePayrollHistoryEmployeesUrl({})).toBe('/api/v1/reports/employee-payroll-history/employees');
  });

  it('includes a trimmed search term and siteId/unitId narrowing filters', () => {
    expect(employeePayrollHistoryEmployeesUrl({ search: '  Jane  ', siteId: 'site-1', unitId: 'unit-1' })).toBe(
      '/api/v1/reports/employee-payroll-history/employees?search=Jane&siteId=site-1&unitId=unit-1',
    );
  });
});

describe('employeePayrollHistoryExportUrl', () => {
  it('builds the export endpoint with format and no page/pageSize ever accepted', () => {
    const url = employeePayrollHistoryExportUrl({}, 'cycle', 'desc', 'csv');
    expect(url).toContain('/api/v1/reports/employee-payroll-history/export?sortBy=cycle&sortDir=desc&format=csv');
    expect(url).not.toContain('page=');
  });

  it('includes filters when given', () => {
    const url = employeePayrollHistoryExportUrl({ employeeId: 'emp-1', siteIds: ['site-1'] }, 'netSalary', 'asc', 'xlsx');
    expect(url).toContain('employeeId=emp-1');
    expect(url).toContain('siteIds=site-1');
    expect(url).toContain('format=xlsx');
  });
});

describe('downloadEmployeePayrollHistoryExport', () => {
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

  it('fetches the export URL (GET, no body) and downloads using the server filename when present', async () => {
    const blob = new Blob(['file contents']);
    const headers = new Headers({ 'content-disposition': 'attachment; filename="employee-payroll-history-2026-07.csv"' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => blob, headers });
    vi.stubGlobal('fetch', fetchMock);
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
    const { getLastDownloadFilename } = spyOnAnchorClick();

    await downloadEmployeePayrollHistoryExport({}, 'cycle', 'desc', 'csv');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/reports/employee-payroll-history/export?sortBy=cycle&sortDir=desc&format=csv'),
      { credentials: 'include' },
    );
    expect(getLastDownloadFilename()).toBe('employee-payroll-history-2026-07.csv');
  });

  it('falls back to a computed filename when no Content-Disposition header is present', async () => {
    const blob = new Blob(['file contents']);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => blob, headers: new Headers() });
    vi.stubGlobal('fetch', fetchMock);
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
    const { getLastDownloadFilename } = spyOnAnchorClick();

    await downloadEmployeePayrollHistoryExport({}, 'cycle', 'desc', 'xlsx');

    expect(getLastDownloadFilename()).toBe('employee-payroll-history.xlsx');
  });

  it('throws a generic ApiError for a non-413 failure, without attempting a download', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, headers: new Headers() }));
    const { getLastDownloadFilename } = spyOnAnchorClick();

    await expect(downloadEmployeePayrollHistoryExport({}, 'cycle', 'desc', 'csv')).rejects.toBeInstanceOf(ApiError);
    expect(getLastDownloadFilename()).toBeUndefined();
  });

  it('throws ExportRowLimitExceededError with the backend structured message on 413, without attempting a download', async () => {
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

    const error = await downloadEmployeePayrollHistoryExport({}, 'cycle', 'desc', 'csv').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExportRowLimitExceededError);
    expect((error as ExportRowLimitExceededError).matchingCount).toBe(25000);
    expect((error as ExportRowLimitExceededError).maxRows).toBe(20000);
    expect((error as ExportRowLimitExceededError).message).toContain('Narrow your filters');
    expect(getLastDownloadFilename()).toBeUndefined();
  });
});
