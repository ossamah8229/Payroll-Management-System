import { useQuery } from '@tanstack/react-query';
import {
  OVERTIME_REPORT_DEFAULT_PAGE_SIZE,
  type OvertimeReportExportFormat,
  type OvertimeReportExportLimitError,
  type OvertimeReportListResponse,
  type OvertimeReportRowStatus,
  type OvertimeReportSortDirection,
  type OvertimeReportSortField,
} from '@payroll/shared';
import { apiRequest, ApiError, API_BASE_URL } from '@/lib/api-client';
import { formatCyclePeriodSlug, type PayrollCycle } from '@/hooks/use-payroll-cycles';
import { extractFilenameFromContentDisposition } from '@/hooks/use-employee-statement';

/**
 * Phase 7 Reports, Overtime Report Checkpoint 1B — the frontend data layer over the frozen
 * Checkpoint 1A backend (`docs/architecture/workflows/reports.md` §18). Every DTO this report needs
 * is already exported from `@payroll/shared` (`shared/src/schemas/overtime-report.ts`), mirroring
 * `use-deduction-report.ts`'s own convention of importing the shared contract directly rather than
 * hand-copying it.
 *
 * Report grain is `PayrollEntryWorkLine`, not `PayrollEntry` (frozen, intentional exception — see
 * the shared schema's own doc comment) — this hook never merges/dedupes rows by employee, it renders
 * exactly the rows the backend returns.
 */

export interface OvertimeReportFilters {
  cycleId: string;
  siteIds?: string[];
  unitId?: string;
  rowStatus?: OvertimeReportRowStatus;
  hasCorrection?: boolean;
  hasOvertime?: boolean;
}

export interface OvertimeReportListParams extends OvertimeReportFilters {
  page: number;
  pageSize: number;
  sortBy: OvertimeReportSortField;
  sortDir: OvertimeReportSortDirection;
}

/** The filter portion shared verbatim by the list URL and the export URL — kept as one function so
 * the two request shapes can never silently drift apart from each other (mirrors
 * `use-deduction-report.ts`'s own `appendFilterParams`). Site ids are sorted before being joined so
 * an equivalent selection in a different pick order never produces a different query string / query
 * key. */
function appendFilterParams(query: URLSearchParams, filters: OvertimeReportFilters): void {
  query.set('cycleId', filters.cycleId);
  if (filters.siteIds?.length) query.set('siteIds', [...filters.siteIds].sort().join(','));
  if (filters.unitId) query.set('unitId', filters.unitId);
  if (filters.rowStatus) query.set('rowStatus', filters.rowStatus);
  if (filters.hasCorrection !== undefined) query.set('hasCorrection', String(filters.hasCorrection));
  if (filters.hasOvertime !== undefined) query.set('hasOvertime', String(filters.hasOvertime));
}

export function overtimeReportListUrl(params: OvertimeReportListParams): string {
  const query = new URLSearchParams();
  appendFilterParams(query, params);
  query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize));
  query.set('sortBy', params.sortBy);
  query.set('sortDir', params.sortDir);
  return `/api/v1/reports/overtime-report?${query.toString()}`;
}

function overtimeReportListQueryKey(params: OvertimeReportListParams) {
  return [
    'reports',
    'overtime-report',
    params.cycleId,
    [...(params.siteIds ?? [])].sort().join(','),
    params.unitId ?? '',
    params.rowStatus ?? '',
    params.hasCorrection ?? '',
    params.hasOvertime ?? '',
    params.sortBy,
    params.sortDir,
    params.page,
    params.pageSize,
  ] as const;
}

/** Disabled until a `cycleId` is selected — this report is always scoped to exactly one required
 * cycle, matching every other single-required-cycle report/document hook in this app
 * (`useDeductionReportList`, `useProjectSitePayrollReportList`, `usePayrollSummaryReport`). No
 * client-side filtering, sorting, or row deduplication ever happens here — the server response
 * (one row per `PayrollEntryWorkLine`) is rendered as-is. */
export function useOvertimeReportList(params: OvertimeReportListParams) {
  return useQuery({
    queryKey: overtimeReportListQueryKey(params),
    queryFn: () => apiRequest<OvertimeReportListResponse>(overtimeReportListUrl(params)),
    enabled: Boolean(params.cycleId),
  });
}

export const OVERTIME_REPORT_PAGE_SIZE = OVERTIME_REPORT_DEFAULT_PAGE_SIZE;

// --- Export --------------------------------------------------------------------------------

export function overtimeReportExportUrl(
  filters: OvertimeReportFilters,
  sortBy: OvertimeReportSortField,
  sortDir: OvertimeReportSortDirection,
  format: OvertimeReportExportFormat,
): string {
  const query = new URLSearchParams();
  appendFilterParams(query, filters);
  query.set('sortBy', sortBy);
  query.set('sortDir', sortDir);
  query.set('format', format);
  return `${API_BASE_URL}/api/v1/reports/overtime-report/export?${query.toString()}`;
}

/** Thrown instead of a generic `ApiError('EXPORT_FAILED', ...)` on a 413
 * `EXPORT_ROW_LIMIT_EXCEEDED` response — carries the backend's own structured counts, mirroring
 * `DeductionReportExportRowLimitExceededError`. Independently named/declared (not imported from a
 * sibling report's hook) since each report's export endpoint is an unrelated request path that
 * happens to share the same error shape. */
export class OvertimeReportExportRowLimitExceededError extends ApiError {
  constructor(
    public readonly matchingCount: number,
    public readonly maxRows: number,
    message: string,
  ) {
    super(413, 'EXPORT_ROW_LIMIT_EXCEEDED', message);
    this.name = 'OvertimeReportExportRowLimitExceededError';
  }
}

/**
 * Triggers a browser download of every matching row (up to the backend's 20,000-row ceiling) —
 * never just the current on-screen page; the export endpoint accepts no `page`/`pageSize` at all.
 * Bypasses `apiRequest` since the response is a file, mirroring
 * `downloadDeductionReportExport`'s own fetch/blob flow. Always revokes the created object URL once
 * the download has been triggered, whether the link click happened or not.
 */
export async function downloadOvertimeReportExport(
  cycle: Pick<PayrollCycle, 'id' | 'year' | 'month'>,
  filters: OvertimeReportFilters,
  sortBy: OvertimeReportSortField,
  sortDir: OvertimeReportSortDirection,
  format: OvertimeReportExportFormat,
): Promise<void> {
  const response = await fetch(overtimeReportExportUrl(filters, sortBy, sortDir, format), {
    credentials: 'include',
  });

  if (!response.ok) {
    if (response.status === 413) {
      const payload = (await response.json().catch(() => undefined)) as
        | { error?: OvertimeReportExportLimitError }
        | undefined;
      const errorBody = payload?.error;
      throw new OvertimeReportExportRowLimitExceededError(
        errorBody?.matchingCount ?? 0,
        errorBody?.maxRows ?? 0,
        errorBody?.message ??
          'This export matches too many rows. Narrow your filters (site, unit, row status, or Has Overtime) and try again.',
      );
    }
    throw new ApiError(
      response.status,
      'EXPORT_FAILED',
      `Failed to export the Overtime Report as ${format.toUpperCase()}`,
    );
  }

  const blob = await response.blob();
  const filename = extractFilenameFromContentDisposition(
    response.headers.get('content-disposition'),
    `overtime-report-${formatCyclePeriodSlug(cycle)}.${format}`,
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
