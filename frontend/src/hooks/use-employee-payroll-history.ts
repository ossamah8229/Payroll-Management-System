import { useQuery } from '@tanstack/react-query';
import {
  EMPLOYEE_PAYROLL_HISTORY_DEFAULT_PAGE_SIZE,
  type EmployeePayrollHistoryDetail,
  type EmployeePayrollHistoryEmployeeSearchResponse,
  type EmployeePayrollHistoryExportFormat,
  type EmployeePayrollHistoryExportLimitError,
  type EmployeePayrollHistoryListResponse,
  type EmployeePayrollHistoryRosterStatus,
  type EmployeePayrollHistoryRowStatus,
  type EmployeePayrollHistorySortDirection,
  type EmployeePayrollHistorySortField,
} from '@payroll/shared';
import { apiRequest, ApiError, API_BASE_URL } from '@/lib/api-client';
import { extractFilenameFromContentDisposition } from '@/hooks/use-employee-statement';

/**
 * Employee Payroll History Checkpoint 1B — the frontend data layer over the four Checkpoint 1A
 * backend endpoints (`docs/architecture/workflows/reports.md` §15). Unlike `use-reports.ts`'s own
 * `PayrollSummaryReport` (a backend-internal type this codebase mirrors locally because no shared
 * copy exists), every DTO this report needs is already exported from `@payroll/shared`
 * (`shared/src/schemas/employee-payroll-history.ts`) — importing it directly here avoids a second,
 * driftable hand-copy of 15+ interfaces this project's own "grep for duplicates" convention would
 * otherwise flag.
 */

export interface EmployeePayrollHistoryFilters {
  employeeId?: string;
  siteIds?: string[];
  unitId?: string;
  fromCycleId?: string;
  toCycleId?: string;
  rowStatus?: EmployeePayrollHistoryRowStatus;
  hasCorrection?: boolean;
  hasOutstandingOriginBalance?: boolean;
  currentEmployeeRosterStatus?: EmployeePayrollHistoryRosterStatus;
}

export interface EmployeePayrollHistoryListParams extends EmployeePayrollHistoryFilters {
  page: number;
  pageSize: number;
  sortBy: EmployeePayrollHistorySortField;
  sortDir: EmployeePayrollHistorySortDirection;
}

/** The filter portion shared verbatim by the list URL and the export URL — kept as one function so
 * the two request shapes can never silently drift apart from each other. */
function appendFilterParams(query: URLSearchParams, filters: EmployeePayrollHistoryFilters): void {
  if (filters.employeeId) query.set('employeeId', filters.employeeId);
  if (filters.siteIds?.length) query.set('siteIds', filters.siteIds.join(','));
  if (filters.unitId) query.set('unitId', filters.unitId);
  if (filters.fromCycleId) query.set('fromCycleId', filters.fromCycleId);
  if (filters.toCycleId) query.set('toCycleId', filters.toCycleId);
  if (filters.rowStatus) query.set('rowStatus', filters.rowStatus);
  if (filters.hasCorrection !== undefined) query.set('hasCorrection', String(filters.hasCorrection));
  if (filters.hasOutstandingOriginBalance !== undefined) {
    query.set('hasOutstandingOriginBalance', String(filters.hasOutstandingOriginBalance));
  }
  if (filters.currentEmployeeRosterStatus) {
    query.set('currentEmployeeRosterStatus', filters.currentEmployeeRosterStatus);
  }
}

export function employeePayrollHistoryListUrl(params: EmployeePayrollHistoryListParams): string {
  const query = new URLSearchParams();
  appendFilterParams(query, params);
  query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize));
  query.set('sortBy', params.sortBy);
  query.set('sortDir', params.sortDir);
  return `/api/v1/reports/employee-payroll-history?${query.toString()}`;
}

function employeePayrollHistoryListQueryKey(params: EmployeePayrollHistoryListParams) {
  return [
    'reports',
    'employee-payroll-history',
    params.employeeId ?? '',
    [...(params.siteIds ?? [])].sort().join(','),
    params.unitId ?? '',
    params.fromCycleId ?? '',
    params.toCycleId ?? '',
    params.rowStatus ?? '',
    params.hasCorrection ?? '',
    params.hasOutstandingOriginBalance ?? '',
    params.currentEmployeeRosterStatus ?? '',
    params.sortBy,
    params.sortDir,
    params.page,
    params.pageSize,
  ] as const;
}

/** Enabled by default — unlike Payroll Summary/Bank Sheet, this report is never scoped to a single
 * required cycle selection; an empty filter set is itself a valid, meaningful request (every
 * accessible row, latest cycle first). `enabled` lets the page hold off while a Cycle From/To
 * range is still incomplete or invalid (`fromCycle` later than `toCycle`), so a doomed request
 * is never sent. */
export function useEmployeePayrollHistoryList(params: EmployeePayrollHistoryListParams, enabled = true) {
  return useQuery({
    queryKey: employeePayrollHistoryListQueryKey(params),
    queryFn: () => apiRequest<EmployeePayrollHistoryListResponse>(employeePayrollHistoryListUrl(params)),
    enabled,
  });
}

export function useEmployeePayrollHistoryDetail(payrollEntryId: string | undefined) {
  return useQuery({
    queryKey: ['reports', 'employee-payroll-history', 'detail', payrollEntryId ?? ''],
    queryFn: () =>
      apiRequest<EmployeePayrollHistoryDetail>(`/api/v1/reports/employee-payroll-history/${payrollEntryId}`),
    enabled: Boolean(payrollEntryId),
  });
}

// --- Historical employee lookup ---------------------------------------------------------------

export interface EmployeePayrollHistoryEmployeeLookupParams {
  search?: string;
  siteId?: string;
  unitId?: string;
  page?: number;
  pageSize?: number;
}

export function employeePayrollHistoryEmployeesUrl(params: EmployeePayrollHistoryEmployeeLookupParams): string {
  const query = new URLSearchParams();
  if (params.search?.trim()) query.set('search', params.search.trim());
  if (params.siteId) query.set('siteId', params.siteId);
  if (params.unitId) query.set('unitId', params.unitId);
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  const qs = query.toString();
  return `/api/v1/reports/employee-payroll-history/employees${qs ? `?${qs}` : ''}`;
}

/** Only ever fetches once a search term is present (`enabled`) — the same "don't fetch an
 * unbounded population" discipline `useStatementEmployeeSearch` already established. */
export function useEmployeePayrollHistoryEmployeeSearch(
  params: EmployeePayrollHistoryEmployeeLookupParams,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [
      'employee-payroll-history-employees',
      params.search?.trim() ?? '',
      params.siteId ?? '',
      params.unitId ?? '',
      params.page ?? 1,
      params.pageSize ?? '',
    ],
    queryFn: () =>
      apiRequest<EmployeePayrollHistoryEmployeeSearchResponse>(employeePayrollHistoryEmployeesUrl(params)),
    enabled,
  });
}

// --- Export --------------------------------------------------------------------------------

export function employeePayrollHistoryExportUrl(
  filters: EmployeePayrollHistoryFilters,
  sortBy: EmployeePayrollHistorySortField,
  sortDir: EmployeePayrollHistorySortDirection,
  format: EmployeePayrollHistoryExportFormat,
): string {
  const query = new URLSearchParams();
  appendFilterParams(query, filters);
  query.set('sortBy', sortBy);
  query.set('sortDir', sortDir);
  query.set('format', format);
  return `${API_BASE_URL}/api/v1/reports/employee-payroll-history/export?${query.toString()}`;
}

/** Thrown instead of a generic `ApiError('EXPORT_FAILED', ...)` on a 413
 * `EXPORT_ROW_LIMIT_EXCEEDED` response — carries the backend's own structured counts so the caller
 * can show its real message (never a generic "export failed") without a second round trip. */
export class ExportRowLimitExceededError extends ApiError {
  constructor(
    public readonly matchingCount: number,
    public readonly maxRows: number,
    message: string,
  ) {
    super(413, 'EXPORT_ROW_LIMIT_EXCEEDED', message);
    this.name = 'ExportRowLimitExceededError';
  }
}

/**
 * Triggers a browser download of every matching row (up to the backend's 20,000-row ceiling) —
 * never just the current on-screen page (the export endpoint independently re-derives the full
 * filtered/sorted dataset, `reports.routes.ts`). Bypasses `apiRequest` since the response is a
 * file, mirroring `downloadPayrollSummaryExport`/`downloadEmployeeStatementExport`'s own
 * fetch/blob flow. Prefers the server's own `Content-Disposition` filename (Statements' own
 * convention), falling back to a computed name only if that header is absent.
 */
export async function downloadEmployeePayrollHistoryExport(
  filters: EmployeePayrollHistoryFilters,
  sortBy: EmployeePayrollHistorySortField,
  sortDir: EmployeePayrollHistorySortDirection,
  format: EmployeePayrollHistoryExportFormat,
): Promise<void> {
  const response = await fetch(employeePayrollHistoryExportUrl(filters, sortBy, sortDir, format), {
    credentials: 'include',
  });

  if (!response.ok) {
    if (response.status === 413) {
      const payload = (await response.json().catch(() => undefined)) as
        | { error?: EmployeePayrollHistoryExportLimitError }
        | undefined;
      const errorBody = payload?.error;
      throw new ExportRowLimitExceededError(
        errorBody?.matchingCount ?? 0,
        errorBody?.maxRows ?? 0,
        errorBody?.message ??
          'This export matches too many rows. Narrow your filters (employee, site, or cycle range) and try again.',
      );
    }
    throw new ApiError(
      response.status,
      'EXPORT_FAILED',
      `Failed to export the Employee Payroll History Report as ${format.toUpperCase()}`,
    );
  }

  const blob = await response.blob();
  const filename = extractFilenameFromContentDisposition(
    response.headers.get('content-disposition'),
    `employee-payroll-history.${format}`,
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export const EMPLOYEE_PAYROLL_HISTORY_PAGE_SIZE = EMPLOYEE_PAYROLL_HISTORY_DEFAULT_PAGE_SIZE;
