// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import {
  downloadEmployeeStatementExport,
  employeeStatementExportUrl,
  employeeStatementUrl,
  extractFilenameFromContentDisposition,
} from './use-employee-statement';

describe('employeeStatementUrl', () => {
  it('requests the plain employee endpoint when no range is given', () => {
    expect(employeeStatementUrl('emp-1', {})).toBe('/api/v1/employees/emp-1/statement');
  });

  it('includes both fromCycleId and toCycleId when a custom range is given', () => {
    expect(employeeStatementUrl('emp-1', { fromCycleId: 'cycle-a', toCycleId: 'cycle-b' })).toBe(
      '/api/v1/employees/emp-1/statement?fromCycleId=cycle-a&toCycleId=cycle-b',
    );
  });
});

describe('employeeStatementExportUrl', () => {
  it('builds the plain export endpoint for a format when no range is given', () => {
    expect(employeeStatementExportUrl('emp-1', {}, 'pdf')).toBe('/api/v1/employees/emp-1/statement/pdf');
    expect(employeeStatementExportUrl('emp-1', {}, 'xlsx')).toBe('/api/v1/employees/emp-1/statement/xlsx');
    expect(employeeStatementExportUrl('emp-1', {}, 'csv')).toBe('/api/v1/employees/emp-1/statement/csv');
  });

  it('includes both fromCycleId and toCycleId when a custom range is given', () => {
    expect(employeeStatementExportUrl('emp-1', { fromCycleId: 'cycle-a', toCycleId: 'cycle-b' }, 'pdf')).toBe(
      '/api/v1/employees/emp-1/statement/pdf?fromCycleId=cycle-a&toCycleId=cycle-b',
    );
  });
});

describe('extractFilenameFromContentDisposition', () => {
  it('extracts a quoted filename', () => {
    expect(
      extractFilenameFromContentDisposition(
        'attachment; filename="employee-statement-e001-2026-01-to-2026-06.pdf"',
        'fallback.pdf',
      ),
    ).toBe('employee-statement-e001-2026-01-to-2026-06.pdf');
  });

  it('extracts an unquoted filename', () => {
    expect(extractFilenameFromContentDisposition('attachment; filename=statement.csv', 'fallback.csv')).toBe(
      'statement.csv',
    );
  });

  it('falls back for a missing header', () => {
    expect(extractFilenameFromContentDisposition(null, 'fallback.pdf')).toBe('fallback.pdf');
    expect(extractFilenameFromContentDisposition(undefined, 'fallback.pdf')).toBe('fallback.pdf');
  });

  it('falls back for a malformed header with no filename token', () => {
    expect(extractFilenameFromContentDisposition('attachment', 'fallback.pdf')).toBe('fallback.pdf');
  });

  it('falls back for an empty filename value', () => {
    expect(extractFilenameFromContentDisposition('attachment; filename=""', 'fallback.pdf')).toBe('fallback.pdf');
  });

  it('strips a path separator defensively rather than trusting it as a directory', () => {
    expect(extractFilenameFromContentDisposition('attachment; filename="../../etc/evil.pdf"', 'fallback.pdf')).toBe(
      'evil.pdf',
    );
  });
});

describe('downloadEmployeeStatementExport', () => {
  // Only the two static methods are patched, never `vi.stubGlobal('URL', ...)` — replacing the
  // whole global `URL` constructor can break Vite/Vitest's own module runner elsewhere in the
  // suite, which internally relies on `new URL(...)`.
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function mockBlobResponse(headers: Record<string, string> = {}) {
    const blob = new Blob(['file contents']);
    return {
      ok: true,
      status: 200,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      blob: async () => blob,
    };
  }

  /** Real jsdom `<a>` elements already reflect `.download` as a normal DOM property — spying on
   * the prototype's own `click` and reading `this.download` at call time is simpler and more
   * realistic than replacing `document.createElement` itself. */
  function spyOnAnchorClick(): { getLastDownloadFilename: () => string | undefined } {
    let lastFilename: string | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      lastFilename = this.download;
    });
    return { getLastDownloadFilename: () => lastFilename };
  }

  it('fetches the format-specific export endpoint (GET, no body) and downloads the backend-provided filename', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockBlobResponse({ 'content-disposition': 'attachment; filename="employee-statement-e001-all.pdf"' }));
    vi.stubGlobal('fetch', fetchMock);
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
    const { getLastDownloadFilename } = spyOnAnchorClick();

    await downloadEmployeeStatementExport('emp-1', {}, 'pdf');

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/employees/emp-1/statement/pdf', { credentials: 'include' });
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('method');
    expect(getLastDownloadFilename()).toBe('employee-statement-e001-all.pdf');
  });

  it('throws an ApiError when the response is not ok, without attempting a download', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, headers: { get: () => null } }));
    const { getLastDownloadFilename } = spyOnAnchorClick();

    await expect(downloadEmployeeStatementExport('emp-1', {}, 'csv')).rejects.toBeInstanceOf(ApiError);
    expect(getLastDownloadFilename()).toBeUndefined();
  });

  it('falls back to a default filename when Content-Disposition is unavailable (e.g. not exposed cross-origin by CORS)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockBlobResponse()));
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
    const { getLastDownloadFilename } = spyOnAnchorClick();

    await downloadEmployeeStatementExport('emp-1', {}, 'xlsx');

    expect(getLastDownloadFilename()).toBe('employee-statement.xlsx');
  });

  it('falls back to a default filename when Content-Disposition is present but malformed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockBlobResponse({ 'content-disposition': 'attachment' })));
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
    const { getLastDownloadFilename } = spyOnAnchorClick();

    await downloadEmployeeStatementExport('emp-1', {}, 'csv');

    expect(getLastDownloadFilename()).toBe('employee-statement.csv');
  });
});
