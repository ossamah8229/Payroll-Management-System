import { useQuery } from '@tanstack/react-query';
import { apiRequest, ApiError, API_BASE_URL } from '@/lib/api-client';

/**
 * Phase 7A Checkpoint 2 — the frontend's own copy of the canonical Statement DTO shape
 * (`backend/src/modules/statements/statements.types.ts`), following this codebase's own
 * established convention of a frontend-local mirror rather than a cross-workspace import
 * (`PayslipListItem`/`use-payslips.ts`, `BalanceAdjustment`/`use-balance-adjustments.ts`) — the
 * backend module stays the single source of truth for what these fields *mean*; this file only
 * describes the wire shape so the frontend can read it.
 */

export type StatementLedgerCategory = 'SALARY' | 'CORRECTION' | 'ADVANCE';

export type StatementLedgerEventKind =
  | 'CYCLE_PAID'
  | 'CYCLE_NO_PAY_DUE'
  | 'CYCLE_RECOVERY_DUE'
  | 'CYCLE_PENDING'
  | 'CYCLE_LEGACY_NEGATIVE_ANOMALY'
  | 'CORRECTION_APPROVED'
  | 'BALANCE_ADJUSTMENT_CREATED'
  | 'BALANCE_ADJUSTMENT_SETTLED'
  | 'CORRECTION_PAYMENT'
  | 'ADVANCE_GIVEN'
  | 'ADVANCE_DEDUCTION_RESERVED'
  | 'ADVANCE_DEDUCTION_FINAL'
  | 'ADVANCE_SCHEDULE_CHANGED'
  | 'ADVANCE_PAID_OFF'
  | 'ADVANCE_CANCELLED';

export type StatementBalanceKind = 'PAYABLE' | 'RECOVERABLE' | 'ADVANCE';
export type StatementMovementDirection = 'INCREASE' | 'DECREASE';

export interface StatementMovement {
  balance: StatementBalanceKind;
  direction: StatementMovementDirection;
  amount: string;
}

export interface StatementBalances {
  payableOutstanding: string;
  recoveryOutstanding: string;
  advanceOutstanding: string;
}

export interface StatementLedgerReference {
  payrollEntryId?: string;
  correctionId?: string;
  balanceAdjustmentId?: string;
  balanceAdjustmentSettlementId?: string;
  correctionPaymentId?: string;
  advanceId?: string;
  advanceScheduleChangeId?: string;
}

export interface StatementLedgerEntry {
  id: string;
  date: string;
  cycleId: string | null;
  cycleYear: number | null;
  cycleMonth: number | null;
  category: StatementLedgerCategory;
  kind: StatementLedgerEventKind;
  isInformational: boolean;
  movement: StatementMovement | null;
  runningBalances: StatementBalances;
  description: string;
  reference: StatementLedgerReference;
  sequence: number;
}

export interface StatementEmployeeIdentity {
  employeeId: string;
  employeeCode: string | null;
  cnic: string | null;
  name: string;
  currentSiteId: string;
  currentSiteName: string;
}

export interface StatementCycleRef {
  id: string;
  year: number;
  month: number;
}

export interface StatementRange {
  fromCycle: StatementCycleRef | null;
  toCycle: StatementCycleRef | null;
  cycleCount: number;
}

export type AdvanceHistoryRestrictionReason = 'CURRENT_SITE_OUT_OF_SCOPE';

export interface StatementScope {
  advanceHistoryIncluded: boolean;
  advanceHistoryRestriction?: AdvanceHistoryRestrictionReason;
}

export interface EmployeeStatement {
  employee: StatementEmployeeIdentity;
  range: StatementRange;
  scope: StatementScope;
  openingBalances: StatementBalances;
  closingBalances: StatementBalances;
  entries: StatementLedgerEntry[];
  generatedAt: string;
}

export interface EmployeeStatementRangeParams {
  /** Both or neither — the backend rejects one without the other. Omitted entirely resolves to
   * the latest 12 `PayrollCycle` rows system-wide, computed server-side (`statements.service.ts`)
   * so this hook never needs its own copy of that default. */
  fromCycleId?: string;
  toCycleId?: string;
}

/** Builds the exact query string `GET /api/v1/employees/:employeeId/statement` accepts — pulled
 * out as a pure function so the request-shape contract (`employeeId` + optional `fromCycleId`/
 * `toCycleId`) is directly unit-testable without mounting the page or mocking `fetch`. */
export function employeeStatementUrl(employeeId: string, range: EmployeeStatementRangeParams): string {
  const params = new URLSearchParams();
  if (range.fromCycleId) params.set('fromCycleId', range.fromCycleId);
  if (range.toCycleId) params.set('toCycleId', range.toCycleId);
  const query = params.toString();
  return `/api/v1/employees/${employeeId}/statement${query ? `?${query}` : ''}`;
}

/**
 * The one read this checkpoint's frontend performs — a plain `GET`, never a mutation (Phase 7A
 * Checkpoint 2 brief §11: viewing a Statement must cause only the backend's own already-designed
 * `statement.viewed` audit entry, nothing else). `enabled` is false until a caller has resolved a
 * complete, valid selection (employee, and either both range cycles or neither) — the page itself
 * owns exactly what "complete" means, this hook just refuses to fire without an `employeeId`.
 * `fromCycleId`/`toCycleId` are part of the query key, so switching Site/Unit selection alone
 * (without changing the resolved employee or range) never triggers a refetch — see the page's own
 * "no repeated Statement fetch from unrelated selector state" requirement.
 */
export function useEmployeeStatement(employeeId: string | undefined, range: EmployeeStatementRangeParams) {
  return useQuery({
    queryKey: ['employee-statement', employeeId ?? '', range.fromCycleId ?? '', range.toCycleId ?? ''],
    queryFn: () => apiRequest<EmployeeStatement>(employeeStatementUrl(employeeId!, range)),
    enabled: Boolean(employeeId),
  });
}

/**
 * Phase 7B Checkpoint 3 — Employee Statement Print & Export (frontend). PDF/XLSX/CSV are the
 * three dedicated export routes `statements.routes.ts` already serves (Checkpoints 1-2); Browser
 * Print is a separate capability entirely (the shared `PrintButton`/`useTriggerPrint` system,
 * printing this page's own live DOM) and has no `StatementExportFormat` of its own.
 */
export type StatementExportFormat = 'pdf' | 'xlsx' | 'csv';

/** Builds the exact URL `GET /api/v1/employees/:employeeId/statement/{format}` accepts — the same
 * `fromCycleId`/`toCycleId` range contract `employeeStatementUrl` above already builds for the JSON
 * route, just against the dedicated PDF/XLSX/CSV export routes. Absolute (via `API_BASE_URL`),
 * since this is used directly as a `fetch` target for a blob download rather than only relative
 * navigation — mirrors `payslipPdfUrl`'s own reasoning (`use-payslips.ts`). */
export function employeeStatementExportUrl(
  employeeId: string,
  range: EmployeeStatementRangeParams,
  format: StatementExportFormat,
): string {
  const params = new URLSearchParams();
  if (range.fromCycleId) params.set('fromCycleId', range.fromCycleId);
  if (range.toCycleId) params.set('toCycleId', range.toCycleId);
  const query = params.toString();
  return `${API_BASE_URL}/api/v1/employees/${employeeId}/statement/${format}${query ? `?${query}` : ''}`;
}

/**
 * Parses a `Content-Disposition: attachment; filename="..."` header value into just the filename.
 *
 * Unlike every other export module in this app (`downloadBankSheetExport`, `downloadEmployeeExport`,
 * `downloadPayslipPdf` — each recomputes its own filename client-side and always overrides the
 * server's own `Content-Disposition`), Statements deliberately *prefers* the backend's own filename
 * (`buildStatementPdfFilename`/`buildStatementExportFilename`, `statements.routes.ts`) instead of
 * duplicating that logic a second time here: Statements' range is an arbitrary from/to `PayrollCycle`
 * pair (`rangeSlug`, same file), not a single cycle like every module that already accepts the
 * duplication — reimplementing that slug logic client-side would be meaningfully more code and a
 * second place it could drift from the backend's own naming.
 *
 * Falls back to `defaultFilename` for a missing or malformed header rather than throwing — a
 * cosmetic naming miss must never block a download that otherwise succeeded.
 */
export function extractFilenameFromContentDisposition(
  header: string | null | undefined,
  defaultFilename: string,
): string {
  if (!header) return defaultFilename;
  // The quoted pattern allows an empty capture (`filename=""`) so that case falls through to the
  // same "no usable candidate" check below, rather than accidentally matching the unquoted pattern
  // instead and keeping the literal quote characters as part of the filename.
  const quotedMatch = header.match(/filename="([^"]*)"/i);
  const unquotedMatch = quotedMatch ? null : header.match(/filename=([^;]+)/i);
  const candidate = (quotedMatch?.[1] ?? unquotedMatch?.[1])?.trim();
  if (!candidate) return defaultFilename;
  // Defensive only — this backend's own filenames are already `slugify`d ASCII with no path
  // separator (statements.routes.ts's `buildStatementFilenameStem`); this just guarantees a
  // malformed/unexpected header value can never be read as anything other than a bare filename.
  const safeName = candidate.split(/[/\\]/).pop()?.trim();
  return safeName || defaultFilename;
}

function triggerStatementBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Triggers a browser download of one Employee Statement export (PDF/XLSX/CSV) — bypasses
 * `apiRequest` since the response is a file, mirroring every other export module's own fetch/blob
 * download flow (`downloadBankSheetExport`, `downloadEmployeeExport`, `downloadPayslipPdf`). See
 * `extractFilenameFromContentDisposition` above for why Statements' own filename handling
 * deliberately differs from those.
 */
export async function downloadEmployeeStatementExport(
  employeeId: string,
  range: EmployeeStatementRangeParams,
  format: StatementExportFormat,
): Promise<void> {
  const response = await fetch(employeeStatementExportUrl(employeeId, range, format), { credentials: 'include' });
  if (!response.ok) {
    throw new ApiError(response.status, 'EXPORT_FAILED', `Failed to export the Statement as ${format.toUpperCase()}`);
  }
  const blob = await response.blob();
  const filename = extractFilenameFromContentDisposition(
    response.headers.get('content-disposition'),
    `employee-statement.${format}`,
  );
  triggerStatementBlobDownload(blob, filename);
}
