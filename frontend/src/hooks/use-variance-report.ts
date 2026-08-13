import { useQuery } from '@tanstack/react-query';
import {
  VARIANCE_REPORT_DEFAULT_PAGE_SIZE,
  type VarianceReportDirection,
  type VarianceReportEmployeeSearchResponse,
  type VarianceReportExportFormat,
  type VarianceReportExportLimitError,
  type VarianceReportListResponse,
  type VarianceReportSortDirection,
  type VarianceReportSortField,
} from '@payroll/shared';
import { apiRequest, ApiError, API_BASE_URL } from '@/lib/api-client';
import { formatCyclePeriodSlug, type PayrollCycle } from '@/hooks/use-payroll-cycles';
import { extractFilenameFromContentDisposition } from '@/hooks/use-employee-statement';

/**
 * Variance / Month-on-Month Report Checkpoint 1B — the frontend data layer over the frozen
 * Checkpoint 1A backend (`docs/architecture/workflows/reports.md`'s own Variance section,
 * `shared/src/schemas/variance-report.ts`). Every DTO this report needs is already exported from
 * `@payroll/shared`, mirroring every sibling report hook's own convention of importing the shared
 * contract directly rather than hand-copying it.
 *
 * The one genuine difference from every sibling report hook: two required Cycle ids
 * (`currentCycleId`/`comparisonCycleId`), never one. `useVarianceReportList` is disabled until BOTH
 * are present — never a request with only one Cycle selected, and never a request mixing a stale
 * Cycle id with a freshly-changed one (the caller passes both from the same render, so there is no
 * window where one is up to date and the other isn't).
 */

export interface VarianceReportFilters {
  currentCycleId: string;
  comparisonCycleId: string;
  siteIds?: string[];
  unitId?: string;
  employeeId?: string;
  direction?: VarianceReportDirection;
  hasCorrection?: boolean;
}

export interface VarianceReportListParams extends VarianceReportFilters {
  page: number;
  pageSize: number;
  sortBy: VarianceReportSortField;
  sortDir: VarianceReportSortDirection;
}

/** The filter portion shared verbatim by the list URL and the export URL — kept as one function so
 * the two request shapes can never silently drift apart from each other. Site ids are sorted before
 * being joined so an equivalent selection in a different pick order never produces a different query
 * string / query key (Checkpoint 1B §5/§16). */
function appendFilterParams(query: URLSearchParams, filters: VarianceReportFilters): void {
  query.set('currentCycleId', filters.currentCycleId);
  query.set('comparisonCycleId', filters.comparisonCycleId);
  if (filters.siteIds?.length) query.set('siteIds', [...filters.siteIds].sort().join(','));
  if (filters.unitId) query.set('unitId', filters.unitId);
  if (filters.employeeId) query.set('employeeId', filters.employeeId);
  if (filters.direction) query.set('direction', filters.direction);
  if (filters.hasCorrection !== undefined) query.set('hasCorrection', String(filters.hasCorrection));
}

export function varianceReportListUrl(params: VarianceReportListParams): string {
  const query = new URLSearchParams();
  appendFilterParams(query, params);
  query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize));
  query.set('sortBy', params.sortBy);
  query.set('sortDir', params.sortDir);
  return `/api/v1/reports/variance?${query.toString()}`;
}

function varianceReportListQueryKey(params: VarianceReportListParams) {
  return [
    'reports',
    'variance',
    params.currentCycleId,
    params.comparisonCycleId,
    [...(params.siteIds ?? [])].sort().join(','),
    params.unitId ?? '',
    params.employeeId ?? '',
    params.direction ?? '',
    params.hasCorrection ?? '',
    params.sortBy,
    params.sortDir,
    params.page,
    params.pageSize,
  ] as const;
}

/** Disabled until BOTH `currentCycleId` and `comparisonCycleId` are non-empty (Checkpoint 1B §5/§21)
 * — this report's own cross-cycle grain has no meaningful "one cycle selected" partial state, unlike
 * every single-cycle sibling report's own `Boolean(cycleId)` gate. */
export function useVarianceReportList(params: VarianceReportListParams) {
  return useQuery({
    queryKey: varianceReportListQueryKey(params),
    queryFn: () => apiRequest<VarianceReportListResponse>(varianceReportListUrl(params)),
    enabled: Boolean(params.currentCycleId) && Boolean(params.comparisonCycleId),
  });
}

export const VARIANCE_REPORT_PAGE_SIZE = VARIANCE_REPORT_DEFAULT_PAGE_SIZE;

// --- Employee lookup -------------------------------------------------------------------------

export interface VarianceReportEmployeeLookupParams {
  search?: string;
  siteId?: string;
  unitId?: string;
  page?: number;
  pageSize?: number;
}

export function varianceReportEmployeesUrl(params: VarianceReportEmployeeLookupParams): string {
  const query = new URLSearchParams();
  if (params.search?.trim()) query.set('search', params.search.trim());
  if (params.siteId) query.set('siteId', params.siteId);
  if (params.unitId) query.set('unitId', params.unitId);
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  const qs = query.toString();
  return `/api/v1/reports/variance/employees${qs ? `?${qs}` : ''}`;
}

/** Only ever fetches once a search term is present (`enabled`) — the same "don't fetch an unbounded
 * population" discipline every sibling report's own historical employee lookup already established
 * (this report reuses the identical `searchEmployeesByHistoricalPayroll` backend contract, never a
 * new org-wide directory — `variance-report.service.ts`'s own doc comment). */
export function useVarianceReportEmployeeSearch(params: VarianceReportEmployeeLookupParams, enabled: boolean) {
  return useQuery({
    queryKey: [
      'variance-report-employees',
      params.search?.trim() ?? '',
      params.siteId ?? '',
      params.unitId ?? '',
      params.page ?? 1,
      params.pageSize ?? '',
    ],
    queryFn: () => apiRequest<VarianceReportEmployeeSearchResponse>(varianceReportEmployeesUrl(params)),
    enabled,
  });
}

// --- Export --------------------------------------------------------------------------------

export function varianceReportExportUrl(
  filters: VarianceReportFilters,
  sortBy: VarianceReportSortField,
  sortDir: VarianceReportSortDirection,
  format: VarianceReportExportFormat,
): string {
  const query = new URLSearchParams();
  appendFilterParams(query, filters);
  query.set('sortBy', sortBy);
  query.set('sortDir', sortDir);
  query.set('format', format);
  return `${API_BASE_URL}/api/v1/reports/variance/export?${query.toString()}`;
}

/** Thrown instead of a generic `ApiError('EXPORT_FAILED', ...)` on a 413 `EXPORT_ROW_LIMIT_EXCEEDED`
 * response — carries the backend's own structured counts, mirroring every sibling report's identical
 * `*ExportRowLimitExceededError`. Independently named/declared (not imported from a sibling report's
 * hook) since each report's export endpoint is an unrelated request path that happens to share the
 * same error shape. */
export class VarianceReportExportRowLimitExceededError extends ApiError {
  constructor(
    public readonly matchingCount: number,
    public readonly maxRows: number,
    message: string,
  ) {
    super(413, 'EXPORT_ROW_LIMIT_EXCEEDED', message);
    this.name = 'VarianceReportExportRowLimitExceededError';
  }
}

/**
 * Triggers a browser download of every matching row (up to the backend's 20,000-row ceiling) — never
 * just the current on-screen page; the export endpoint accepts no `page`/`pageSize` at all. Bypasses
 * `apiRequest` since the response is a file, mirroring every sibling report's own fetch/blob flow.
 * Always revokes the created object URL once the download has been triggered, whether the link click
 * happened or not.
 */
export async function downloadVarianceReportExport(
  currentCycle: Pick<PayrollCycle, 'id' | 'year' | 'month'>,
  comparisonCycle: Pick<PayrollCycle, 'id' | 'year' | 'month'>,
  filters: VarianceReportFilters,
  sortBy: VarianceReportSortField,
  sortDir: VarianceReportSortDirection,
  format: VarianceReportExportFormat,
): Promise<void> {
  const response = await fetch(varianceReportExportUrl(filters, sortBy, sortDir, format), {
    credentials: 'include',
  });

  if (!response.ok) {
    if (response.status === 413) {
      const payload = (await response.json().catch(() => undefined)) as
        | { error?: VarianceReportExportLimitError }
        | undefined;
      const errorBody = payload?.error;
      throw new VarianceReportExportRowLimitExceededError(
        errorBody?.matchingCount ?? 0,
        errorBody?.maxRows ?? 0,
        errorBody?.message ??
          'This export matches too many rows. Narrow your filters (site, unit, employee, direction, or has correction) and try again.',
      );
    }
    throw new ApiError(response.status, 'EXPORT_FAILED', `Failed to export the Variance Report as ${format.toUpperCase()}`);
  }

  const blob = await response.blob();
  const filename = extractFilenameFromContentDisposition(
    response.headers.get('content-disposition'),
    `variance-report-${formatCyclePeriodSlug(comparisonCycle)}-vs-${formatCyclePeriodSlug(currentCycle)}.${format}`,
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
