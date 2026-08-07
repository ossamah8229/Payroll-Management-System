import { useQuery } from '@tanstack/react-query';
import {
  DEDUCTION_REPORT_DEFAULT_PAGE_SIZE,
  type DeductionReportExportFormat,
  type DeductionReportExportLimitError,
  type DeductionReportListResponse,
  type DeductionReportRowStatus,
  type DeductionReportSortDirection,
  type DeductionReportSortField,
} from '@payroll/shared';
import { apiRequest, ApiError, API_BASE_URL } from '@/lib/api-client';
import { formatCyclePeriodSlug, type PayrollCycle } from '@/hooks/use-payroll-cycles';
import { extractFilenameFromContentDisposition } from '@/hooks/use-employee-statement';

/**
 * Phase 7 Reports, Deduction Report Checkpoint 1B — the frontend data layer over the frozen
 * Checkpoint 1A backend (`docs/architecture/workflows/reports.md` §17). Every DTO this report needs
 * is already exported from `@payroll/shared` (`shared/src/schemas/deduction-report.ts`), mirroring
 * `use-project-site-payroll-report.ts`'s own convention of importing the shared contract directly
 * rather than hand-copying it.
 */

export interface DeductionReportFilters {
  cycleId: string;
  siteIds?: string[];
  unitId?: string;
  rowStatus?: DeductionReportRowStatus;
  hasCorrection?: boolean;
  hasEobi?: boolean;
  hasAdvanceDeduction?: boolean;
  hasEidAdvanceDeduction?: boolean;
  hasFine?: boolean;
  hasCorrectionRecovery?: boolean;
}

export interface DeductionReportListParams extends DeductionReportFilters {
  page: number;
  pageSize: number;
  sortBy: DeductionReportSortField;
  sortDir: DeductionReportSortDirection;
}

/** The filter portion shared verbatim by the list URL and the export URL — kept as one function so
 * the two request shapes can never silently drift apart from each other (mirrors
 * `use-project-site-payroll-report.ts`'s own `appendFilterParams`). Site ids are sorted before being
 * joined so an equivalent selection in a different pick order never produces a different query
 * string / query key. */
function appendFilterParams(query: URLSearchParams, filters: DeductionReportFilters): void {
  query.set('cycleId', filters.cycleId);
  if (filters.siteIds?.length) query.set('siteIds', [...filters.siteIds].sort().join(','));
  if (filters.unitId) query.set('unitId', filters.unitId);
  if (filters.rowStatus) query.set('rowStatus', filters.rowStatus);
  if (filters.hasCorrection !== undefined) query.set('hasCorrection', String(filters.hasCorrection));
  if (filters.hasEobi !== undefined) query.set('hasEobi', String(filters.hasEobi));
  if (filters.hasAdvanceDeduction !== undefined) query.set('hasAdvanceDeduction', String(filters.hasAdvanceDeduction));
  if (filters.hasEidAdvanceDeduction !== undefined)
    query.set('hasEidAdvanceDeduction', String(filters.hasEidAdvanceDeduction));
  if (filters.hasFine !== undefined) query.set('hasFine', String(filters.hasFine));
  if (filters.hasCorrectionRecovery !== undefined)
    query.set('hasCorrectionRecovery', String(filters.hasCorrectionRecovery));
}

export function deductionReportListUrl(params: DeductionReportListParams): string {
  const query = new URLSearchParams();
  appendFilterParams(query, params);
  query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize));
  query.set('sortBy', params.sortBy);
  query.set('sortDir', params.sortDir);
  return `/api/v1/reports/deduction-report?${query.toString()}`;
}

function deductionReportListQueryKey(params: DeductionReportListParams) {
  return [
    'reports',
    'deduction-report',
    params.cycleId,
    [...(params.siteIds ?? [])].sort().join(','),
    params.unitId ?? '',
    params.rowStatus ?? '',
    params.hasCorrection ?? '',
    params.hasEobi ?? '',
    params.hasAdvanceDeduction ?? '',
    params.hasEidAdvanceDeduction ?? '',
    params.hasFine ?? '',
    params.hasCorrectionRecovery ?? '',
    params.sortBy,
    params.sortDir,
    params.page,
    params.pageSize,
  ] as const;
}

/** Disabled until a `cycleId` is selected — this report is always scoped to exactly one required
 * cycle, matching every other single-required-cycle report/document hook in this app
 * (`usePayrollSummaryReport`, `useProjectSitePayrollReportList`, `useBankSheet`, `useCashReceiving`).
 * No client-side filtering or sorting ever happens here — the server response is rendered as-is. */
export function useDeductionReportList(params: DeductionReportListParams) {
  return useQuery({
    queryKey: deductionReportListQueryKey(params),
    queryFn: () => apiRequest<DeductionReportListResponse>(deductionReportListUrl(params)),
    enabled: Boolean(params.cycleId),
  });
}

export const DEDUCTION_REPORT_PAGE_SIZE = DEDUCTION_REPORT_DEFAULT_PAGE_SIZE;

// --- Export --------------------------------------------------------------------------------

export function deductionReportExportUrl(
  filters: DeductionReportFilters,
  sortBy: DeductionReportSortField,
  sortDir: DeductionReportSortDirection,
  format: DeductionReportExportFormat,
): string {
  const query = new URLSearchParams();
  appendFilterParams(query, filters);
  query.set('sortBy', sortBy);
  query.set('sortDir', sortDir);
  query.set('format', format);
  return `${API_BASE_URL}/api/v1/reports/deduction-report/export?${query.toString()}`;
}

/** Thrown instead of a generic `ApiError('EXPORT_FAILED', ...)` on a 413
 * `EXPORT_ROW_LIMIT_EXCEEDED` response — carries the backend's own structured counts, mirroring
 * `ProjectSitePayrollReportExportRowLimitExceededError`. Independently named/declared (not imported
 * from a sibling report's hook) since each report's export endpoint is an unrelated request path
 * that happens to share the same error shape. */
export class DeductionReportExportRowLimitExceededError extends ApiError {
  constructor(
    public readonly matchingCount: number,
    public readonly maxRows: number,
    message: string,
  ) {
    super(413, 'EXPORT_ROW_LIMIT_EXCEEDED', message);
    this.name = 'DeductionReportExportRowLimitExceededError';
  }
}

/**
 * Triggers a browser download of every matching row (up to the backend's 20,000-row ceiling) —
 * never just the current on-screen page; the export endpoint accepts no `page`/`pageSize` at all.
 * Bypasses `apiRequest` since the response is a file, mirroring
 * `downloadProjectSitePayrollReportExport`'s own fetch/blob flow. Always revokes the created object
 * URL once the download has been triggered, whether the link click happened or not.
 */
export async function downloadDeductionReportExport(
  cycle: Pick<PayrollCycle, 'id' | 'year' | 'month'>,
  filters: DeductionReportFilters,
  sortBy: DeductionReportSortField,
  sortDir: DeductionReportSortDirection,
  format: DeductionReportExportFormat,
): Promise<void> {
  const response = await fetch(deductionReportExportUrl(filters, sortBy, sortDir, format), {
    credentials: 'include',
  });

  if (!response.ok) {
    if (response.status === 413) {
      const payload = (await response.json().catch(() => undefined)) as
        | { error?: DeductionReportExportLimitError }
        | undefined;
      const errorBody = payload?.error;
      throw new DeductionReportExportRowLimitExceededError(
        errorBody?.matchingCount ?? 0,
        errorBody?.maxRows ?? 0,
        errorBody?.message ??
          'This export matches too many rows. Narrow your filters (site, unit, deduction type, or row status) and try again.',
      );
    }
    throw new ApiError(
      response.status,
      'EXPORT_FAILED',
      `Failed to export the Deduction Report as ${format.toUpperCase()}`,
    );
  }

  const blob = await response.blob();
  const filename = extractFilenameFromContentDisposition(
    response.headers.get('content-disposition'),
    `deduction-report-${formatCyclePeriodSlug(cycle)}.${format}`,
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
