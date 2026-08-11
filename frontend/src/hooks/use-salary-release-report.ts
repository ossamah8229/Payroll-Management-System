import { useQuery } from '@tanstack/react-query';
import {
  SALARY_RELEASE_REPORT_DEFAULT_PAGE_SIZE,
  type SalaryReleaseReportExportFormat,
  type SalaryReleaseReportExportLimitError,
  type SalaryReleaseReportListResponse,
  type SalaryReleaseReportRowStatus,
  type SalaryReleaseReportSortDirection,
  type SalaryReleaseReportSortField,
} from '@payroll/shared';
import { apiRequest, ApiError, API_BASE_URL } from '@/lib/api-client';
import { formatCyclePeriodSlug, type PayrollCycle } from '@/hooks/use-payroll-cycles';
import { extractFilenameFromContentDisposition } from '@/hooks/use-employee-statement';

/**
 * Phase 7 Reports, Salary Release Report Checkpoint 1B — the frontend data layer over the frozen
 * Checkpoint 1A backend (`docs/architecture/workflows/reports.md` §20). Every DTO this report needs
 * is already exported from `@payroll/shared` (`shared/src/schemas/salary-release-report.ts`),
 * mirroring `use-deduction-report.ts`'s own convention of importing the shared contract directly
 * rather than hand-copying it.
 *
 * Report grain is `PayrollEntry`, one row per entry — this hook never merges/dedupes rows and never
 * recomputes any financial value; every figure rendered is the backend's own already-computed value.
 */

export interface SalaryReleaseReportFilters {
  cycleId: string;
  siteIds?: string[];
  unitId?: string;
  rowStatus?: SalaryReleaseReportRowStatus;
  hasCorrection?: boolean;
}

export interface SalaryReleaseReportListParams extends SalaryReleaseReportFilters {
  page: number;
  pageSize: number;
  sortBy: SalaryReleaseReportSortField;
  sortDir: SalaryReleaseReportSortDirection;
}

/** The filter portion shared verbatim by the list URL and the export URL — kept as one function so
 * the two request shapes can never silently drift apart from each other (mirrors
 * `use-deduction-report.ts`'s own `appendFilterParams`). Site ids are sorted before being joined so
 * an equivalent selection in a different pick order never produces a different query string / query
 * key. */
function appendFilterParams(query: URLSearchParams, filters: SalaryReleaseReportFilters): void {
  query.set('cycleId', filters.cycleId);
  if (filters.siteIds?.length) query.set('siteIds', [...filters.siteIds].sort().join(','));
  if (filters.unitId) query.set('unitId', filters.unitId);
  if (filters.rowStatus) query.set('rowStatus', filters.rowStatus);
  if (filters.hasCorrection !== undefined) query.set('hasCorrection', String(filters.hasCorrection));
}

export function salaryReleaseReportListUrl(params: SalaryReleaseReportListParams): string {
  const query = new URLSearchParams();
  appendFilterParams(query, params);
  query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize));
  query.set('sortBy', params.sortBy);
  query.set('sortDir', params.sortDir);
  return `/api/v1/reports/salary-release?${query.toString()}`;
}

function salaryReleaseReportListQueryKey(params: SalaryReleaseReportListParams) {
  return [
    'reports',
    'salary-release',
    params.cycleId,
    [...(params.siteIds ?? [])].sort().join(','),
    params.unitId ?? '',
    params.rowStatus ?? '',
    params.hasCorrection ?? '',
    params.sortBy,
    params.sortDir,
    params.page,
    params.pageSize,
  ] as const;
}

/** Disabled until a `cycleId` is selected — this report is always scoped to exactly one required
 * cycle, matching every other single-required-cycle report/document hook in this app
 * (`useDeductionReportList`, `useOvertimeReportList`, `useProjectSitePayrollReportList`). No
 * client-side filtering, sorting, or row deduplication ever happens here — the server response
 * (one row per `PayrollEntry`) is rendered as-is. */
export function useSalaryReleaseReportList(params: SalaryReleaseReportListParams) {
  return useQuery({
    queryKey: salaryReleaseReportListQueryKey(params),
    queryFn: () => apiRequest<SalaryReleaseReportListResponse>(salaryReleaseReportListUrl(params)),
    enabled: Boolean(params.cycleId),
  });
}

export const SALARY_RELEASE_REPORT_PAGE_SIZE = SALARY_RELEASE_REPORT_DEFAULT_PAGE_SIZE;

// --- Export --------------------------------------------------------------------------------

export function salaryReleaseReportExportUrl(
  filters: SalaryReleaseReportFilters,
  sortBy: SalaryReleaseReportSortField,
  sortDir: SalaryReleaseReportSortDirection,
  format: SalaryReleaseReportExportFormat,
): string {
  const query = new URLSearchParams();
  appendFilterParams(query, filters);
  query.set('sortBy', sortBy);
  query.set('sortDir', sortDir);
  query.set('format', format);
  return `${API_BASE_URL}/api/v1/reports/salary-release/export?${query.toString()}`;
}

/** Thrown instead of a generic `ApiError('EXPORT_FAILED', ...)` on a 413
 * `EXPORT_ROW_LIMIT_EXCEEDED` response — carries the backend's own structured counts, mirroring
 * `DeductionReportExportRowLimitExceededError`. Independently named/declared (not imported from a
 * sibling report's hook) since each report's export endpoint is an unrelated request path that
 * happens to share the same error shape. */
export class SalaryReleaseReportExportRowLimitExceededError extends ApiError {
  constructor(
    public readonly matchingCount: number,
    public readonly maxRows: number,
    message: string,
  ) {
    super(413, 'EXPORT_ROW_LIMIT_EXCEEDED', message);
    this.name = 'SalaryReleaseReportExportRowLimitExceededError';
  }
}

/**
 * Triggers a browser download of every matching row (up to the backend's 20,000-row ceiling) —
 * never just the current on-screen page; the export endpoint accepts no `page`/`pageSize` at all.
 * Bypasses `apiRequest` since the response is a file, mirroring
 * `downloadDeductionReportExport`'s own fetch/blob flow. Always revokes the created object URL once
 * the download has been triggered, whether the link click happened or not.
 */
export async function downloadSalaryReleaseReportExport(
  cycle: Pick<PayrollCycle, 'id' | 'year' | 'month'>,
  filters: SalaryReleaseReportFilters,
  sortBy: SalaryReleaseReportSortField,
  sortDir: SalaryReleaseReportSortDirection,
  format: SalaryReleaseReportExportFormat,
): Promise<void> {
  const response = await fetch(salaryReleaseReportExportUrl(filters, sortBy, sortDir, format), {
    credentials: 'include',
  });

  if (!response.ok) {
    if (response.status === 413) {
      const payload = (await response.json().catch(() => undefined)) as
        | { error?: SalaryReleaseReportExportLimitError }
        | undefined;
      const errorBody = payload?.error;
      throw new SalaryReleaseReportExportRowLimitExceededError(
        errorBody?.matchingCount ?? 0,
        errorBody?.maxRows ?? 0,
        errorBody?.message ??
          'This export matches too many rows. Narrow your filters (site, unit, or row status) and try again.',
      );
    }
    throw new ApiError(
      response.status,
      'EXPORT_FAILED',
      `Failed to export the Salary Release Report as ${format.toUpperCase()}`,
    );
  }

  const blob = await response.blob();
  const filename = extractFilenameFromContentDisposition(
    response.headers.get('content-disposition'),
    `salary-release-report-${formatCyclePeriodSlug(cycle)}.${format}`,
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
