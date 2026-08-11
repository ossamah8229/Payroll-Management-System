import { useQuery } from '@tanstack/react-query';
import {
  ADVANCE_RECOVERY_REPORT_DEFAULT_PAGE_SIZE,
  type AdvanceRecoveryReportDetail,
  type AdvanceRecoveryReportEmployeeLookupResponse,
  type AdvanceRecoveryReportExportFormat,
  type AdvanceRecoveryReportExportLimitError,
  type AdvanceRecoveryReportListResponse,
  type AdvanceRecoveryReportSortDirection,
  type AdvanceRecoveryReportSortField,
  type AdvanceStatus,
  type AdvanceType,
} from '@payroll/shared';
import { apiRequest, ApiError, API_BASE_URL } from '@/lib/api-client';
import { extractFilenameFromContentDisposition } from '@/hooks/use-employee-statement';

/**
 * Phase 7 Reports, Advance Recovery Report Checkpoint 1B — the frontend data layer over the frozen
 * Checkpoint 1A backend (`GET /api/v1/reports/advance-recovery` and its `employees`/`export`/`:advanceId`
 * siblings, `docs/architecture/workflows/reports.md` §19). Every DTO this report needs is already
 * exported from `@payroll/shared` (`shared/src/schemas/advance-recovery-report.ts`), mirroring every
 * sibling report's own convention of importing the shared contract directly.
 *
 * **Cycle is OPTIONAL here** — deliberately unlike Deduction/Overtime/Project Site Payroll Report's
 * own required-single-cycle hooks. `useAdvanceRecoveryReportList` is never `enabled`-gated on
 * `cycleId` — an omitted cycle is itself a valid, meaningful request (the current Advance roster with
 * `recoveredThisCycle: null` on every row).
 */

export interface AdvanceRecoveryReportFilters {
  siteIds?: string[];
  employeeId?: string;
  advanceType?: AdvanceType;
  status?: AdvanceStatus;
  hasOutstandingBalance?: boolean;
  cycleId?: string;
}

export interface AdvanceRecoveryReportListParams extends AdvanceRecoveryReportFilters {
  page: number;
  pageSize: number;
  sortBy: AdvanceRecoveryReportSortField;
  sortDir: AdvanceRecoveryReportSortDirection;
}

/** The filter portion shared verbatim by the list URL and the export URL — kept as one function so
 * the two request shapes can never silently drift apart from each other (mirrors every sibling
 * report's own `appendFilterParams`). Site ids are sorted before being joined so an equivalent
 * selection in a different pick order never produces a different query string / query key. */
function appendFilterParams(query: URLSearchParams, filters: AdvanceRecoveryReportFilters): void {
  if (filters.siteIds?.length) query.set('siteIds', [...filters.siteIds].sort().join(','));
  if (filters.employeeId) query.set('employeeId', filters.employeeId);
  if (filters.advanceType) query.set('advanceType', filters.advanceType);
  if (filters.status) query.set('status', filters.status);
  if (filters.hasOutstandingBalance !== undefined) {
    query.set('hasOutstandingBalance', String(filters.hasOutstandingBalance));
  }
  if (filters.cycleId) query.set('cycleId', filters.cycleId);
}

export function advanceRecoveryReportListUrl(params: AdvanceRecoveryReportListParams): string {
  const query = new URLSearchParams();
  appendFilterParams(query, params);
  query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize));
  query.set('sortBy', params.sortBy);
  query.set('sortDir', params.sortDir);
  return `/api/v1/reports/advance-recovery?${query.toString()}`;
}

function advanceRecoveryReportListQueryKey(params: AdvanceRecoveryReportListParams) {
  return [
    'reports',
    'advance-recovery',
    [...(params.siteIds ?? [])].sort().join(','),
    params.employeeId ?? '',
    params.advanceType ?? '',
    params.status ?? '',
    params.hasOutstandingBalance ?? '',
    params.cycleId ?? '',
    params.sortBy,
    params.sortDir,
    params.page,
    params.pageSize,
  ] as const;
}

/** Always enabled — Cycle is optional for this report (frozen decision), so an omitted `cycleId`
 * is itself a complete, valid request, never a reason to hold back the fetch. No client-side
 * filtering or sorting ever happens here — the server response is rendered as-is. */
export function useAdvanceRecoveryReportList(params: AdvanceRecoveryReportListParams) {
  return useQuery({
    queryKey: advanceRecoveryReportListQueryKey(params),
    queryFn: () => apiRequest<AdvanceRecoveryReportListResponse>(advanceRecoveryReportListUrl(params)),
  });
}

export const ADVANCE_RECOVERY_REPORT_PAGE_SIZE = ADVANCE_RECOVERY_REPORT_DEFAULT_PAGE_SIZE;

export function useAdvanceRecoveryReportDetail(advanceId: string | undefined) {
  return useQuery({
    queryKey: ['reports', 'advance-recovery', 'detail', advanceId ?? ''],
    queryFn: () => apiRequest<AdvanceRecoveryReportDetail>(`/api/v1/reports/advance-recovery/${advanceId}`),
    enabled: Boolean(advanceId),
  });
}

// --- Current-site employee lookup ---------------------------------------------------------------

export interface AdvanceRecoveryReportEmployeeLookupParams {
  search?: string;
  siteId?: string;
  page?: number;
  pageSize?: number;
}

export function advanceRecoveryReportEmployeesUrl(params: AdvanceRecoveryReportEmployeeLookupParams): string {
  const query = new URLSearchParams();
  if (params.search?.trim()) query.set('search', params.search.trim());
  if (params.siteId) query.set('siteId', params.siteId);
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  const qs = query.toString();
  return `/api/v1/reports/advance-recovery/employees${qs ? `?${qs}` : ''}`;
}

/** Only ever fetches once a search term is present (`enabled`) — the same "don't fetch an unbounded
 * population" discipline every sibling employee lookup already establishes. Authorized/scoped by
 * CURRENT `Employee.siteId` — deliberately not the historical-payroll lookup Employee Payroll
 * History/Statements share. */
export function useAdvanceRecoveryReportEmployeeSearch(
  params: AdvanceRecoveryReportEmployeeLookupParams,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [
      'advance-recovery-report-employees',
      params.search?.trim() ?? '',
      params.siteId ?? '',
      params.page ?? 1,
      params.pageSize ?? '',
    ],
    queryFn: () =>
      apiRequest<AdvanceRecoveryReportEmployeeLookupResponse>(advanceRecoveryReportEmployeesUrl(params)),
    enabled,
  });
}

// --- Export --------------------------------------------------------------------------------

export function advanceRecoveryReportExportUrl(
  filters: AdvanceRecoveryReportFilters,
  sortBy: AdvanceRecoveryReportSortField,
  sortDir: AdvanceRecoveryReportSortDirection,
  format: AdvanceRecoveryReportExportFormat,
): string {
  const query = new URLSearchParams();
  appendFilterParams(query, filters);
  query.set('sortBy', sortBy);
  query.set('sortDir', sortDir);
  query.set('format', format);
  return `${API_BASE_URL}/api/v1/reports/advance-recovery/export?${query.toString()}`;
}

/** Thrown instead of a generic `ApiError('EXPORT_FAILED', ...)` on a 413 `EXPORT_ROW_LIMIT_EXCEEDED`
 * response — carries the backend's own structured counts, mirroring every sibling report's own
 * `*ExportRowLimitExceededError`. Independently named/declared (not imported from a sibling report's
 * hook) since each report's export endpoint is an unrelated request path that happens to share the
 * same error shape. */
export class AdvanceRecoveryReportExportRowLimitExceededError extends ApiError {
  constructor(
    public readonly matchingCount: number,
    public readonly maxRows: number,
    message: string,
  ) {
    super(413, 'EXPORT_ROW_LIMIT_EXCEEDED', message);
    this.name = 'AdvanceRecoveryReportExportRowLimitExceededError';
  }
}

/**
 * Triggers a browser download of every matching row (up to the backend's 20,000-row ceiling) —
 * never just the current on-screen page; the export endpoint accepts no `page`/`pageSize` at all.
 * Bypasses `apiRequest` since the response is a file. Prefers the server's own `Content-Disposition`
 * filename (it already carries the "as of" export-time disclosure baked in, per the backend's own
 * doc comment), falling back to a plain computed name only if that header is absent. Always revokes
 * the created object URL once the download has been triggered.
 */
export async function downloadAdvanceRecoveryReportExport(
  filters: AdvanceRecoveryReportFilters,
  sortBy: AdvanceRecoveryReportSortField,
  sortDir: AdvanceRecoveryReportSortDirection,
  format: AdvanceRecoveryReportExportFormat,
): Promise<void> {
  const response = await fetch(advanceRecoveryReportExportUrl(filters, sortBy, sortDir, format), {
    credentials: 'include',
  });

  if (!response.ok) {
    if (response.status === 413) {
      const payload = (await response.json().catch(() => undefined)) as
        | { error?: AdvanceRecoveryReportExportLimitError }
        | undefined;
      const errorBody = payload?.error;
      throw new AdvanceRecoveryReportExportRowLimitExceededError(
        errorBody?.matchingCount ?? 0,
        errorBody?.maxRows ?? 0,
        errorBody?.message ??
          'This export matches too many rows. Narrow your filters (site, employee, advance type, or status) and try again.',
      );
    }
    throw new ApiError(
      response.status,
      'EXPORT_FAILED',
      `Failed to export the Advance Recovery Report as ${format.toUpperCase()}`,
    );
  }

  const blob = await response.blob();
  const filename = extractFilenameFromContentDisposition(
    response.headers.get('content-disposition'),
    `advance-recovery-report.${format}`,
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
