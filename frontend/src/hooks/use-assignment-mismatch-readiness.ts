import { useQuery } from '@tanstack/react-query';
import {
  ASSIGNMENT_MISMATCH_READINESS_DEFAULT_PAGE_SIZE,
  type AssignmentMismatchReadinessExportFormat,
  type AssignmentMismatchReadinessExportLimitError,
  type AssignmentMismatchReadinessListResponse,
  type AssignmentMismatchReadinessSortDirection,
  type AssignmentMismatchReadinessSortField,
  type AssignmentMismatchShape,
} from '@payroll/shared';
import { apiRequest, ApiError, API_BASE_URL } from '@/lib/api-client';
import { formatCyclePeriodSlug, type PayrollCycle } from '@/hooks/use-payroll-cycles';
import { extractFilenameFromContentDisposition } from '@/hooks/use-employee-statement';

/**
 * Bulk Assignment-Mismatch Readiness Audit — frontend data layer (approved 2026-09-28
 * architecture review) over the read-only backend
 * (`shared/src/schemas/assignment-mismatch-readiness.ts`, `reports.routes.ts`'s
 * `/assignment-mismatch-readiness` routes). Every DTO this report needs is already exported from
 * `@payroll/shared`, mirroring `use-overtime-report.ts`'s own convention of importing the shared
 * contract directly rather than hand-copying it.
 *
 * This module issues GET requests only — there is no mutation hook here, deliberately: this
 * checkpoint adds no Apply/classification control to this report. A row's existing "Apply current
 * assignment" affordance, where eligible, still lives exclusively on the Payroll Entry grid
 * (`use-payroll-entries.ts`'s `useApplyEmployeeAssignment`), unchanged.
 */

export interface AssignmentMismatchReadinessFilters {
  cycleId: string;
  siteIds?: string[];
  unitId?: string;
  shape?: AssignmentMismatchShape;
  held?: boolean;
  safeShapeOnly?: boolean;
}

export interface AssignmentMismatchReadinessListParams extends AssignmentMismatchReadinessFilters {
  page: number;
  pageSize: number;
  sortBy: AssignmentMismatchReadinessSortField;
  sortDir: AssignmentMismatchReadinessSortDirection;
}

/** The filter portion shared verbatim by the list URL and the export URL — kept as one function so
 * the two request shapes can never silently drift apart from each other (mirrors
 * `use-overtime-report.ts`'s own `appendFilterParams`). Site ids are sorted before being joined so
 * an equivalent selection in a different pick order never produces a different query string /
 * query key. */
function appendFilterParams(query: URLSearchParams, filters: AssignmentMismatchReadinessFilters): void {
  query.set('cycleId', filters.cycleId);
  if (filters.siteIds?.length) query.set('siteIds', [...filters.siteIds].sort().join(','));
  if (filters.unitId) query.set('unitId', filters.unitId);
  if (filters.shape) query.set('shape', filters.shape);
  if (filters.held !== undefined) query.set('held', String(filters.held));
  if (filters.safeShapeOnly !== undefined) query.set('safeShapeOnly', String(filters.safeShapeOnly));
}

export function assignmentMismatchReadinessListUrl(params: AssignmentMismatchReadinessListParams): string {
  const query = new URLSearchParams();
  appendFilterParams(query, params);
  query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize));
  query.set('sortBy', params.sortBy);
  query.set('sortDir', params.sortDir);
  return `/api/v1/reports/assignment-mismatch-readiness?${query.toString()}`;
}

function assignmentMismatchReadinessListQueryKey(params: AssignmentMismatchReadinessListParams) {
  return [
    'reports',
    'assignment-mismatch-readiness',
    params.cycleId,
    [...(params.siteIds ?? [])].sort().join(','),
    params.unitId ?? '',
    params.shape ?? '',
    params.held ?? '',
    params.safeShapeOnly ?? '',
    params.sortBy,
    params.sortDir,
    params.page,
    params.pageSize,
  ] as const;
}

/** Disabled until a `cycleId` is selected — this report is always scoped to exactly one required
 * Draft cycle (there is only ever at most one Draft cycle system-wide,
 * `use-payroll-cycles.ts`'s `useCurrentPayrollCycle`), matching every other single-required-cycle
 * report hook in this app. No client-side filtering/sorting/pagination ever happens here — the
 * server response is rendered as-is. */
export function useAssignmentMismatchReadinessList(params: AssignmentMismatchReadinessListParams) {
  return useQuery({
    queryKey: assignmentMismatchReadinessListQueryKey(params),
    queryFn: () => apiRequest<AssignmentMismatchReadinessListResponse>(assignmentMismatchReadinessListUrl(params)),
    enabled: Boolean(params.cycleId),
  });
}

export const ASSIGNMENT_MISMATCH_READINESS_PAGE_SIZE = ASSIGNMENT_MISMATCH_READINESS_DEFAULT_PAGE_SIZE;

// --- Export --------------------------------------------------------------------------------

export function assignmentMismatchReadinessExportUrl(
  filters: AssignmentMismatchReadinessFilters,
  sortBy: AssignmentMismatchReadinessSortField,
  sortDir: AssignmentMismatchReadinessSortDirection,
  format: AssignmentMismatchReadinessExportFormat,
): string {
  const query = new URLSearchParams();
  appendFilterParams(query, filters);
  query.set('sortBy', sortBy);
  query.set('sortDir', sortDir);
  query.set('format', format);
  return `${API_BASE_URL}/api/v1/reports/assignment-mismatch-readiness/export?${query.toString()}`;
}

/** Thrown instead of a generic `ApiError('EXPORT_FAILED', ...)` on a 413
 * `EXPORT_ROW_LIMIT_EXCEEDED` response — carries the backend's own structured counts, mirroring
 * every sibling report's identical `*ExportRowLimitExceededError`. */
export class AssignmentMismatchReadinessExportRowLimitExceededError extends ApiError {
  constructor(
    public readonly matchingCount: number,
    public readonly maxRows: number,
    message: string,
  ) {
    super(413, 'EXPORT_ROW_LIMIT_EXCEEDED', message);
    this.name = 'AssignmentMismatchReadinessExportRowLimitExceededError';
  }
}

/**
 * Triggers a browser download of every matching row (up to the backend's row ceiling) — never
 * just the current on-screen page; the export endpoint accepts no `page`/`pageSize` at all.
 * Bypasses `apiRequest` since the response is a file, mirroring every sibling report's own
 * fetch/blob flow. Always revokes the created object URL once the download has been triggered,
 * whether the link click happened or not.
 */
export async function downloadAssignmentMismatchReadinessExport(
  cycle: Pick<PayrollCycle, 'id' | 'year' | 'month'>,
  filters: AssignmentMismatchReadinessFilters,
  sortBy: AssignmentMismatchReadinessSortField,
  sortDir: AssignmentMismatchReadinessSortDirection,
  format: AssignmentMismatchReadinessExportFormat,
): Promise<void> {
  const response = await fetch(assignmentMismatchReadinessExportUrl(filters, sortBy, sortDir, format), {
    credentials: 'include',
  });

  if (!response.ok) {
    if (response.status === 413) {
      const payload = (await response.json().catch(() => undefined)) as
        | { error?: AssignmentMismatchReadinessExportLimitError }
        | undefined;
      const errorBody = payload?.error;
      throw new AssignmentMismatchReadinessExportRowLimitExceededError(
        errorBody?.matchingCount ?? 0,
        errorBody?.maxRows ?? 0,
        errorBody?.message ?? 'This export matches too many rows. Narrow your filters (site, unit, shape, or held) and try again.',
      );
    }
    throw new ApiError(
      response.status,
      'EXPORT_FAILED',
      `Failed to export the Assignment Mismatch Readiness report as ${format.toUpperCase()}`,
    );
  }

  const blob = await response.blob();
  const filename = extractFilenameFromContentDisposition(
    response.headers.get('content-disposition'),
    `assignment-mismatch-readiness-${formatCyclePeriodSlug(cycle)}.${format}`,
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
