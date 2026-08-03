// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { downloadPayrollSummaryExport, payrollSummaryExportUrl, payrollSummaryReportUrl } from './use-reports';

describe('payrollSummaryReportUrl', () => {
  it('requests the plain endpoint with only cycleId when no other params are given', () => {
    expect(payrollSummaryReportUrl({ cycleId: 'cycle-1' })).toBe('/api/v1/reports/payroll-summary?cycleId=cycle-1');
  });

  it('includes siteIds joined by comma when given', () => {
    expect(payrollSummaryReportUrl({ cycleId: 'cycle-1', siteIds: ['site-a', 'site-b'] })).toBe(
      '/api/v1/reports/payroll-summary?cycleId=cycle-1&siteIds=site-a%2Csite-b',
    );
  });

  it('omits siteIds entirely for an empty array (no filter, never zero-site scope)', () => {
    expect(payrollSummaryReportUrl({ cycleId: 'cycle-1', siteIds: [] })).toBe(
      '/api/v1/reports/payroll-summary?cycleId=cycle-1',
    );
  });

  it('includes page and pageSize when given', () => {
    expect(payrollSummaryReportUrl({ cycleId: 'cycle-1', page: 2, pageSize: 10 })).toBe(
      '/api/v1/reports/payroll-summary?cycleId=cycle-1&page=2&pageSize=10',
    );
  });
});

describe('payrollSummaryExportUrl', () => {
  it('builds the export endpoint for a format with no page/pageSize parameters ever accepted', () => {
    const url = payrollSummaryExportUrl('cycle-1', undefined, 'csv');
    expect(url).toContain('/api/v1/reports/payroll-summary/export?cycleId=cycle-1&format=csv');
    expect(url).not.toContain('page=');
  });

  it('includes siteIds when given', () => {
    const url = payrollSummaryExportUrl('cycle-1', ['site-a'], 'xlsx');
    expect(url).toContain('siteIds=site-a');
    expect(url).toContain('format=xlsx');
  });
});

describe('downloadPayrollSummaryExport', () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function mockBlobResponse() {
    const blob = new Blob(['file contents']);
    return { ok: true, status: 200, blob: async () => blob };
  }

  function spyOnAnchorClick(): { getLastDownloadFilename: () => string | undefined } {
    let lastFilename: string | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      lastFilename = this.download;
    });
    return { getLastDownloadFilename: () => lastFilename };
  }

  it('fetches the export URL (GET, no body) and downloads a period-slugged filename', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockBlobResponse());
    vi.stubGlobal('fetch', fetchMock);
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
    const { getLastDownloadFilename } = spyOnAnchorClick();

    await downloadPayrollSummaryExport({ id: 'cycle-1', year: 2026, month: 7 }, undefined, 'csv');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/reports/payroll-summary/export?cycleId=cycle-1&format=csv'),
      { credentials: 'include' },
    );
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('method');
    expect(getLastDownloadFilename()).toBe('payroll-summary-2026-07.csv');
  });

  it('throws an ApiError when the response is not ok, without attempting a download', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    const { getLastDownloadFilename } = spyOnAnchorClick();

    await expect(
      downloadPayrollSummaryExport({ id: 'cycle-1', year: 2026, month: 7 }, undefined, 'xlsx'),
    ).rejects.toBeInstanceOf(ApiError);
    expect(getLastDownloadFilename()).toBeUndefined();
  });
});
