import { useQuery } from '@tanstack/react-query';
import {
  PROJECT_SITE_PAYROLL_REPORT_DEFAULT_PAGE_SIZE,
  type ProjectSitePayrollReportExportFormat,
  type ProjectSitePayrollReportExportLimitError,
  type ProjectSitePayrollReportListResponse,
  type ProjectSitePayrollReportRowStatus,
  type ProjectSitePayrollReportSortDirection,
  type ProjectSitePayrollReportSortField,
} from '@payroll/shared';
import { apiRequest, ApiError, API_BASE_URL } from '@/lib/api-client';
import { formatCyclePeriodSlug, type PayrollCycle } from '@/hooks/use-payroll-cycles';
import { extractFilenameFromContentDisposition } from '@/hooks/use-employee-statement';

/**
 * Phase 7 Reports, Project Site Payroll Report Checkpoint 1B — the frontend data layer over the
 * frozen Checkpoint 1A backend (`docs/architecture/workflows/reports.md` §16). Every DTO this
 * report needs is already exported from `@payroll/shared`
 * (`shared/src/schemas/project-site-payroll-report.ts`), mirroring `use-employee-payroll-history.ts`'s
 * own convention of importing the shared contract directly rather than hand-copying it.
 */

export interface ProjectSitePayrollReportFilters {
  cycleId: string;
  siteIds?: string[];
  unitId?: string;
  rowStatus?: ProjectSitePayrollReportRowStatus;
  hasCorrection?: boolean;
}

export interface ProjectSitePayrollReportListParams extends ProjectSitePayrollReportFilters {
  page: number;
  pageSize: number;
  sortBy: ProjectSitePayrollReportSortField;
  sortDir: ProjectSitePayrollReportSortDirection;
}

/** The filter portion shared verbatim by the list URL and the export URL — kept as one function so
 * the two request shapes can never silently drift apart from each other (mirrors
 * `use-employee-payroll-history.ts`'s own `appendFilterParams`). Site ids are sorted before being
 * joined so an equivalent selection in a different pick order never produces a different query
 * string / query key (Step 3: "sorted/deterministic Site ID representation"). */
function appendFilterParams(query: URLSearchParams, filters: ProjectSitePayrollReportFilters): void {
  query.set('cycleId', filters.cycleId);
  if (filters.siteIds?.length) query.set('siteIds', [...filters.siteIds].sort().join(','));
  if (filters.unitId) query.set('unitId', filters.unitId);
  if (filters.rowStatus) query.set('rowStatus', filters.rowStatus);
  if (filters.hasCorrection !== undefined) query.set('hasCorrection', String(filters.hasCorrection));
}

export function projectSitePayrollReportListUrl(params: ProjectSitePayrollReportListParams): string {
  const query = new URLSearchParams();
  appendFilterParams(query, params);
  query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize));
  query.set('sortBy', params.sortBy);
  query.set('sortDir', params.sortDir);
  return `/api/v1/reports/project-site-payroll?${query.toString()}`;
}

function projectSitePayrollReportListQueryKey(params: ProjectSitePayrollReportListParams) {
  return [
    'reports',
    'project-site-payroll',
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
 * cycle (frozen decision 1/3), matching every other single-required-cycle report/document hook in
 * this app (`usePayrollSummaryReport`, `useBankSheet`, `useCashReceiving`). No client-side
 * filtering or sorting ever happens here — the server response is rendered as-is. */
export function useProjectSitePayrollReportList(params: ProjectSitePayrollReportListParams) {
  return useQuery({
    queryKey: projectSitePayrollReportListQueryKey(params),
    queryFn: () => apiRequest<ProjectSitePayrollReportListResponse>(projectSitePayrollReportListUrl(params)),
    enabled: Boolean(params.cycleId),
  });
}

export const PROJECT_SITE_PAYROLL_REPORT_PAGE_SIZE = PROJECT_SITE_PAYROLL_REPORT_DEFAULT_PAGE_SIZE;

// --- Export --------------------------------------------------------------------------------

export function projectSitePayrollReportExportUrl(
  filters: ProjectSitePayrollReportFilters,
  sortBy: ProjectSitePayrollReportSortField,
  sortDir: ProjectSitePayrollReportSortDirection,
  format: ProjectSitePayrollReportExportFormat,
): string {
  const query = new URLSearchParams();
  appendFilterParams(query, filters);
  query.set('sortBy', sortBy);
  query.set('sortDir', sortDir);
  query.set('format', format);
  return `${API_BASE_URL}/api/v1/reports/project-site-payroll/export?${query.toString()}`;
}

/** Thrown instead of a generic `ApiError('EXPORT_FAILED', ...)` on a 413
 * `EXPORT_ROW_LIMIT_EXCEEDED` response — carries the backend's own structured counts, mirroring
 * Employee Payroll History's identical `ExportRowLimitExceededError`. Independently named/declared
 * (not imported from `use-employee-payroll-history.ts`) since the two reports' export endpoints are
 * unrelated request paths that happen to share the same error shape. */
export class ProjectSitePayrollReportExportRowLimitExceededError extends ApiError {
  constructor(
    public readonly matchingCount: number,
    public readonly maxRows: number,
    message: string,
  ) {
    super(413, 'EXPORT_ROW_LIMIT_EXCEEDED', message);
    this.name = 'ProjectSitePayrollReportExportRowLimitExceededError';
  }
}

/**
 * Triggers a browser download of every matching row (up to the backend's 20,000-row ceiling) —
 * never just the current on-screen page; the export endpoint accepts no `page`/`pageSize` at all
 * (Step 3/Step 9). Bypasses `apiRequest` since the response is a file, mirroring
 * `downloadEmployeePayrollHistoryExport`'s own fetch/blob flow. Always revokes the created object
 * URL once the download has been triggered, whether the link click happened or not.
 */
export async function downloadProjectSitePayrollReportExport(
  cycle: Pick<PayrollCycle, 'id' | 'year' | 'month'>,
  filters: ProjectSitePayrollReportFilters,
  sortBy: ProjectSitePayrollReportSortField,
  sortDir: ProjectSitePayrollReportSortDirection,
  format: ProjectSitePayrollReportExportFormat,
): Promise<void> {
  const response = await fetch(projectSitePayrollReportExportUrl(filters, sortBy, sortDir, format), {
    credentials: 'include',
  });

  if (!response.ok) {
    if (response.status === 413) {
      const payload = (await response.json().catch(() => undefined)) as
        | { error?: ProjectSitePayrollReportExportLimitError }
        | undefined;
      const errorBody = payload?.error;
      throw new ProjectSitePayrollReportExportRowLimitExceededError(
        errorBody?.matchingCount ?? 0,
        errorBody?.maxRows ?? 0,
        errorBody?.message ??
          'This export matches too many rows. Narrow your filters (site, unit, or row status) and try again.',
      );
    }
    throw new ApiError(
      response.status,
      'EXPORT_FAILED',
      `Failed to export the Project Site Payroll Report as ${format.toUpperCase()}`,
    );
  }

  const blob = await response.blob();
  const filename = extractFilenameFromContentDisposition(
    response.headers.get('content-disposition'),
    `project-site-payroll-${formatCyclePeriodSlug(cycle)}.${format}`,
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
