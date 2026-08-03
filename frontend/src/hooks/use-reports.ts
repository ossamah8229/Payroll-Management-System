import { useQuery } from '@tanstack/react-query';
import { apiRequest, ApiError, API_BASE_URL } from '@/lib/api-client';
import { formatCyclePeriodSlug, type PayrollCycle } from '@/hooks/use-payroll-cycles';

/**
 * Phase 8B Checkpoint 1 — the frontend's own copy of the canonical Payroll Summary Report DTO shape
 * (`backend/src/modules/reports/reports.types.ts`), following this codebase's established convention
 * of a frontend-local mirror rather than a cross-workspace import (`EmployeeStatement`/
 * `use-employee-statement.ts`, `BankSheetResult`/`use-bank-sheet.ts`) — the backend module stays the
 * single source of truth for what these fields *mean*; this file only describes the wire shape.
 */

export type PayrollCycleStatusRef = 'DRAFT' | 'RELEASED' | 'ARCHIVED';

export interface PayrollSummaryCycleRef {
  id: string;
  year: number;
  month: number;
  status: PayrollCycleStatusRef;
}

export interface PayrollSummaryFigures {
  employeeCount: number;
  heldCount: number;
  releasedCount: number;
  pendingReleaseCount: number;
  noPayDueCount: number;
  recoveryDueCount: number;
  grossPay: string;
  overtimeAmount: string;
  allowances: string;
  eobi: string;
  advanceDeductions: string;
  eidAdvanceDeductions: string;
  fines: string;
  balancePayableIncluded: string;
  recoveryDeducted: string;
  totalEarnings: string;
  totalDeductions: string;
  netSalary: string;
  releasedAmount: string;
  pendingReleaseAmount: string;
}

export interface PayrollSummarySiteRow extends PayrollSummaryFigures {
  siteId: string;
  siteName: string;
}

export interface PayrollSummaryReport {
  cycle: PayrollSummaryCycleRef;
  generatedAt: string;
  filters: { siteIds: string[] | null };
  cycleTotals: PayrollSummaryFigures;
  page: number;
  pageSize: number;
  total: number;
  siteRows: PayrollSummarySiteRow[];
}

export interface PayrollSummaryReportParams {
  cycleId: string;
  siteIds?: string[];
  page?: number;
  pageSize?: number;
}

/** Builds the exact query string `GET /api/v1/reports/payroll-summary` accepts — pulled out as a
 * pure function (matching `employeeStatementUrl`'s own precedent) so the request-shape contract is
 * directly unit-testable without mounting the page or mocking `fetch`. */
export function payrollSummaryReportUrl(params: PayrollSummaryReportParams): string {
  const query = new URLSearchParams({ cycleId: params.cycleId });
  if (params.siteIds?.length) query.set('siteIds', params.siteIds.join(','));
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  return `/api/v1/reports/payroll-summary?${query.toString()}`;
}

function payrollSummaryQueryKey(params: PayrollSummaryReportParams) {
  return [
    'reports',
    'payroll-summary',
    params.cycleId,
    [...(params.siteIds ?? [])].sort().join(','),
    params.page ?? 1,
    params.pageSize ?? '',
  ] as const;
}

/** Derived, read-only — the Payroll Summary Report has no table of its own (Phase 8A/8B). Disabled
 * until a `cycleId` is selected, matching every other cycle-scoped report/document hook in this app
 * (`useBankSheet`, `useCashReceiving`). */
export function usePayrollSummaryReport(cycleId: string | undefined, params: Omit<PayrollSummaryReportParams, 'cycleId'>) {
  const fullParams: PayrollSummaryReportParams = { cycleId: cycleId ?? '', ...params };
  return useQuery({
    queryKey: payrollSummaryQueryKey(fullParams),
    queryFn: () => apiRequest<PayrollSummaryReport>(payrollSummaryReportUrl(fullParams)),
    enabled: Boolean(cycleId),
  });
}

export type PayrollSummaryExportFormat = 'csv' | 'xlsx';

/** Builds the exact query string `GET /api/v1/reports/payroll-summary/export` accepts — deliberately
 * never accepts `page`/`pageSize` (the export is always the complete filtered report). */
export function payrollSummaryExportUrl(
  cycleId: string,
  siteIds: string[] | undefined,
  format: PayrollSummaryExportFormat,
): string {
  const params = new URLSearchParams({ cycleId, format });
  if (siteIds?.length) params.set('siteIds', siteIds.join(','));
  return `${API_BASE_URL}/api/v1/reports/payroll-summary/export?${params.toString()}`;
}

/**
 * Triggers a browser download of the Payroll Summary Report export — bypasses `apiRequest` since the
 * response is a file, mirroring `downloadBankSheetExport`'s own fetch/blob download flow exactly.
 * Always exports the complete filtered report (every site row), never just the on-screen pagination
 * page — the backend's own export endpoint re-derives the full filtered dataset independently of
 * `page`/`pageSize` (`reports.service.ts`), so this call deliberately never forwards them.
 */
export async function downloadPayrollSummaryExport(
  cycle: Pick<PayrollCycle, 'id' | 'year' | 'month'>,
  siteIds: string[] | undefined,
  format: PayrollSummaryExportFormat,
): Promise<void> {
  const response = await fetch(payrollSummaryExportUrl(cycle.id, siteIds, format), {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new ApiError(response.status, 'EXPORT_FAILED', `Failed to export the Payroll Summary Report as ${format.toUpperCase()}`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `payroll-summary-${formatCyclePeriodSlug(cycle)}.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}
