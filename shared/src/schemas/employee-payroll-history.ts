import { z } from 'zod';

/**
 * Phase 7 Reports, Employee Payroll History Checkpoint 1A (approved architecture review +
 * approved product/architecture decisions, 2026-08-05). Shared Zod validation + response
 * contracts for this report — the first Reports-module report to validate its query parameters
 * through a shared schema rather than hand-parsing `req.query` (`reports.routes.ts`'s existing
 * `requireCycleIdQuery`/`parseSiteIdsQuery`/`parsePageQuery` helpers are intentionally left
 * untouched; this file does not refactor them).
 *
 * **Report grain (approved decision 6):** one row = one `PayrollEntry`. Because of
 * `PayrollEntry`'s own `@@unique([cycleId, employeeId])` constraint, this is equivalent to one
 * employee per payroll cycle — never a second reporting table, never a different grain.
 *
 * **Row status (approved decision, derived server-side only — the client never infers financial
 * status independently):** exactly five states, precedence-ordered
 * `RELEASED > HELD > NO_PAY_DUE > RECOVERY_DUE > PENDING`. See
 * `backend/src/modules/reports/employee-payroll-history-status.ts`'s `deriveEmployeePayrollHistoryRowStatus`
 * for the canonical derivation and its own doc comment for why this precedence is safe even
 * though the underlying `PayrollEntry` invariants already make every pair but one mutually
 * exclusive in valid data.
 */

export const EMPLOYEE_PAYROLL_HISTORY_ROW_STATUS_VALUES = [
  'RELEASED',
  'HELD',
  'NO_PAY_DUE',
  'RECOVERY_DUE',
  'PENDING',
] as const;

export type EmployeePayrollHistoryRowStatus = (typeof EMPLOYEE_PAYROLL_HISTORY_ROW_STATUS_VALUES)[number];

export const employeePayrollHistoryRowStatusSchema = z.enum(EMPLOYEE_PAYROLL_HISTORY_ROW_STATUS_VALUES);

/** Only these six values are ever accepted as a sort key — an arbitrary/typo'd `sortBy` is a 400,
 * never silently ignored or defaulted. Every one of these appends a deterministic
 * `PayrollEntry.id ASC` tie-break server-side (never left to the client to request or omit) —
 * see the service's own `buildOrderBy` for the exact secondary-key composition per field,
 * including the bounded, documented exception for `netSalary` (not a stored column — see
 * `docs/architecture/workflows/reports.md`'s Employee Payroll History section). */
export const EMPLOYEE_PAYROLL_HISTORY_SORT_FIELDS = [
  'cycle',
  'employeeCode',
  'employeeName',
  'site',
  'netSalary',
  'rowStatus',
] as const;

export type EmployeePayrollHistorySortField = (typeof EMPLOYEE_PAYROLL_HISTORY_SORT_FIELDS)[number];

export const EMPLOYEE_PAYROLL_HISTORY_SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type EmployeePayrollHistorySortDirection = (typeof EMPLOYEE_PAYROLL_HISTORY_SORT_DIRECTIONS)[number];

/** A *current* Employee Registry fact (`Employee.dateOfLeaving`), never a historical-row fact —
 * deliberately named `currentEmployeeRosterStatus`, not `employeeStatus`, so a caller can never
 * mistake this for "was this employee active at the time this specific row occurred." */
export const EMPLOYEE_PAYROLL_HISTORY_ROSTER_STATUS_VALUES = ['ACTIVE', 'DEPARTED'] as const;
export type EmployeePayrollHistoryRosterStatus = (typeof EMPLOYEE_PAYROLL_HISTORY_ROSTER_STATUS_VALUES)[number];

export const EMPLOYEE_PAYROLL_HISTORY_DEFAULT_PAGE_SIZE = 25;
export const EMPLOYEE_PAYROLL_HISTORY_MAX_PAGE_SIZE = 100;

/** Version 1's hard synchronous export ceiling (approved decision 2) — enforced server-side
 * before any CSV/XLSX generation begins (a `COUNT` preflight, never a truncated write), and
 * reused as the same safe bound for the totals aggregation described in
 * `EmployeePayrollHistoryTotals`'s own doc comment below. One named constant, never a magic
 * number duplicated at each enforcement point. */
export const EMPLOYEE_PAYROLL_HISTORY_EXPORT_MAX_ROWS = 20_000;

const uuid = () => z.string().uuid();

/** Accepts Express's own raw query shapes for a repeatable/comma-separated filter — a single
 * string, a comma-separated string, or (when the same query key is repeated) a string array —
 * normalizes to a deduplicated array of UUIDs, or `undefined` if nothing was supplied. Malformed
 * entries fail the subsequent `.uuid()` element validation, never silently dropped. */
const uuidListQueryParam = z.preprocess((raw) => {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const values = Array.isArray(raw) ? raw : [raw];
  const flattened = values.flatMap((value) => String(value).split(',')).filter((value) => value.length > 0);
  if (flattened.length === 0) return undefined;
  return [...new Set(flattened)];
}, z.array(uuid()).optional());

const uuidQueryParam = z.preprocess((raw) => (raw === '' || raw === undefined ? undefined : raw), uuid().optional());

const booleanQueryParam = z.preprocess((raw) => {
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw; // let z.boolean() reject anything else with a clear validation error
}, z.boolean().optional());

const pageQueryParam = z.preprocess(
  (raw) => (raw === undefined || raw === '' ? undefined : Number(raw)),
  z.number().int().min(1).optional().default(1),
);

const pageSizeQueryParam = z.preprocess(
  (raw) => (raw === undefined || raw === '' ? undefined : Number(raw)),
  z.number().int().min(1).max(EMPLOYEE_PAYROLL_HISTORY_MAX_PAGE_SIZE).optional().default(EMPLOYEE_PAYROLL_HISTORY_DEFAULT_PAGE_SIZE),
);

/**
 * The filter set every list/export query shares (export omits pagination — see
 * `employeePayrollHistoryExportQuerySchema` below). Deliberately excludes, per the approved
 * architecture review: a standalone year/month filter (redundant with `fromCycleId`/`toCycleId`),
 * a generic calendar date range (less precise than a payroll-cycle range), and a vague
 * `releaseStatus` (ambiguous under per-Unit release — `rowStatus` is this report's own,
 * unambiguous, per-entry replacement). `fromCycleId`/`toCycleId` are validated for *existence*
 * here (UUID shape only); their semantic ordering (`from` not after `to`) can only be checked
 * once both cycles are actually looked up, so that check lives in the service layer, not here
 * (matches this codebase's existing convention of keeping cross-record validation out of Zod).
 */
const employeePayrollHistoryFilterFields = {
  employeeId: uuidQueryParam,
  siteIds: uuidListQueryParam,
  unitId: uuidQueryParam,
  fromCycleId: uuidQueryParam,
  toCycleId: uuidQueryParam,
  rowStatus: z.preprocess((raw) => (raw === '' ? undefined : raw), employeePayrollHistoryRowStatusSchema.optional()),
  hasCorrection: booleanQueryParam,
  hasOutstandingOriginBalance: booleanQueryParam,
  currentEmployeeRosterStatus: z.preprocess(
    (raw) => (raw === '' ? undefined : raw),
    z.enum(EMPLOYEE_PAYROLL_HISTORY_ROSTER_STATUS_VALUES).optional(),
  ),
};

export const employeePayrollHistoryListQuerySchema = z.object({
  ...employeePayrollHistoryFilterFields,
  page: pageQueryParam,
  pageSize: pageSizeQueryParam,
  sortBy: z.preprocess(
    (raw) => (raw === '' || raw === undefined ? undefined : raw),
    z.enum(EMPLOYEE_PAYROLL_HISTORY_SORT_FIELDS).optional().default('cycle'),
  ),
  sortDir: z.preprocess(
    (raw) => (raw === '' || raw === undefined ? undefined : raw),
    z.enum(EMPLOYEE_PAYROLL_HISTORY_SORT_DIRECTIONS).optional().default('desc'),
  ),
});

export type EmployeePayrollHistoryListQuery = z.infer<typeof employeePayrollHistoryListQuerySchema>;

export const EMPLOYEE_PAYROLL_HISTORY_EXPORT_FORMATS = ['csv', 'xlsx'] as const;
export type EmployeePayrollHistoryExportFormat = (typeof EMPLOYEE_PAYROLL_HISTORY_EXPORT_FORMATS)[number];

/** Same filters/sorting as the list query, no pagination — an export is always every matching
 * row (up to `EMPLOYEE_PAYROLL_HISTORY_EXPORT_MAX_ROWS`), never just one page. */
export const employeePayrollHistoryExportQuerySchema = z.object({
  ...employeePayrollHistoryFilterFields,
  sortBy: z.preprocess(
    (raw) => (raw === '' || raw === undefined ? undefined : raw),
    z.enum(EMPLOYEE_PAYROLL_HISTORY_SORT_FIELDS).optional().default('cycle'),
  ),
  sortDir: z.preprocess(
    (raw) => (raw === '' || raw === undefined ? undefined : raw),
    z.enum(EMPLOYEE_PAYROLL_HISTORY_SORT_DIRECTIONS).optional().default('desc'),
  ),
  format: z.enum(EMPLOYEE_PAYROLL_HISTORY_EXPORT_FORMATS),
});

export type EmployeePayrollHistoryExportQuery = z.infer<typeof employeePayrollHistoryExportQuerySchema>;

/**
 * Historical-payroll employee lookup (approved decision — reuses/extracts the Statements pattern,
 * never the current-site-scoped Employee Registry lookup). Mirrors
 * `shared` conventions but has no `SearchStatementEmployeesParams` equivalent of its own to import
 * from (that type stays Statements-module-local) — see
 * `backend/src/common/historical-payroll-employee-lookup.ts` for the shared service-layer
 * implementation both Statements and this report call.
 */
export const employeePayrollHistoryEmployeeLookupQuerySchema = z.object({
  search: z.preprocess((raw) => (raw === '' ? undefined : raw), z.string().trim().max(160).optional()),
  siteId: uuidQueryParam,
  unitId: uuidQueryParam,
  page: pageQueryParam,
  pageSize: pageSizeQueryParam,
});

export type EmployeePayrollHistoryEmployeeLookupQuery = z.infer<typeof employeePayrollHistoryEmployeeLookupQuerySchema>;

// --- Response contracts ---------------------------------------------------------------------

export interface EmployeePayrollHistoryCycleRef {
  id: string;
  year: number;
  month: number;
  status: 'DRAFT' | 'RELEASED' | 'ARCHIVED';
}

export interface EmployeePayrollHistoryUnitRef {
  id: string;
  name: string;
  code: string | null;
}

/** The one safe actor-identity shape this codebase ever returns for a User relation
 * (`system-conventions.md §4` — never a raw Prisma `User` record, never `passwordHash`). */
export interface EmployeePayrollHistoryActorRef {
  id: string;
  name: string;
}

/**
 * One list row — always the *original*, as-released figures (approved decision 7). Never a
 * "corrected net salary." `employeeCode`/`currentEmployeeRosterStatus` are explicitly *current*
 * Employee Registry facts (no historical snapshot exists for either) — never described as frozen
 * historical facts, per the approved architecture review's own correction to the generic report
 * template.
 */
export interface EmployeePayrollHistoryRow {
  payrollEntryId: string;
  cycle: EmployeePayrollHistoryCycleRef;
  employeeId: string;
  /** Current `Employee.employeeCode` — no historical snapshot exists on `PayrollEntry`. */
  employeeCode: string | null;
  /** `PayrollEntry.employeeNameSnapshot ?? Employee.name` — Payslip's own established
   * convention, reused here rather than reimplemented. */
  employeeName: string;
  /** Historical `PayrollEntry.siteId` — the row's own authorization-relevant site, never the
   * employee's current site. */
  siteId: string;
  siteName: string;
  /** The work line with the lowest `sortOrder`; `null` only if this entry's own required
   * "never zero lines" invariant were somehow violated (defensive typing, not an expected case). */
  primaryUnit: EmployeePayrollHistoryUnitRef | null;
  /** Count of this entry's *other* work lines beyond the primary one (0 for a single-unit
   * entry) — the full breakdown lives in the detail endpoint, never inlined into the list row. */
  additionalUnitCount: number;
  designation: string;
  /** Explicitly a *current* Employee Registry fact — see this file's own module doc comment. */
  currentEmployeeRosterStatus: EmployeePayrollHistoryRosterStatus;
  totalEarnings: string;
  totalDeductions: string;
  /** `calcNet()` over this entry's own stored columns — the immutable, as-released figure.
   * Never replaced by a correction-replayed value (approved decision 7). */
  netSalary: string;
  rowStatus: EmployeePayrollHistoryRowStatus;
  /** Count of approved `Correction` rows whose `payrollEntryId` is this entry — batched across
   * the page in one query, never one query per row. */
  correctionCount: number;
  /** Narrow, approved definition: a `BalanceAdjustment` whose *origin* is this entry (either
   * directly, `originPayrollEntryId`, or via a `Correction` this entry produced) currently has
   * `remainingAmount > 0`. Never true merely because this entry *consumed* a materialization
   * originating elsewhere — see the detail endpoint's `materializationsConsumedByThisEntry` for
   * that separate fact. */
  hasOutstandingOriginBalance: boolean;
  /** `PayrollEntry.releasedAt` only — release-actor identity is deliberately excluded from the
   * main row (approved Step 4 instruction); see the detail endpoint's `release.releasedBy`. */
  releasedAt: string | null;
}

/**
 * Unpaginated aggregate over every matching row (approved: totals must never be derived from the
 * current page alone).
 *
 * **Why the three monetary totals can be `null`:** `netSalary`/`totalEarnings`/`totalDeductions`
 * are never stored columns — they only exist as `calcNet()` results, which cannot be reproduced
 * as a SQL `SUM(...)` without an independent, drift-prone second implementation of the same
 * formula (explicitly forbidden by this checkpoint's own instructions). This service computes
 * them by fetching every matching row's `calcNet` inputs and summing via the canonical
 * `calcNet`/`sumMoney`, but only when `matchingCount` is within
 * `EMPLOYEE_PAYROLL_HISTORY_EXPORT_MAX_ROWS` — the same, already-approved safe synchronous bound
 * this checkpoint established for exports, reused here rather than inventing a second ceiling or
 * silently loading an unbounded result set. Beyond that bound, the five status counts (which
 * *are* plain DB aggregates over stored/derived-at-write-time columns) are still returned exactly;
 * only the three monetary sums and `correctedEntryCount`'s own money-adjacent context are marked
 * `totalsComputed: false` — visible and honest, never a silently wrong number. See
 * `docs/architecture/workflows/reports.md`'s Employee Payroll History section for the full
 * reasoning and the explicit conflict this resolves.
 */
export interface EmployeePayrollHistoryTotals {
  matchingCount: number;
  totalEarnings: string | null;
  totalDeductions: string | null;
  netSalaryTotal: string | null;
  /** `false` exactly when `matchingCount > EMPLOYEE_PAYROLL_HISTORY_EXPORT_MAX_ROWS` — narrow
   * the filters to get exact monetary totals. Never partially computed. */
  totalsComputed: boolean;
  releasedCount: number;
  heldCount: number;
  noPayDueCount: number;
  recoveryDueCount: number;
  pendingCount: number;
  /** Count of matching rows with at least one approved `Correction` — a plain DB count, always
   * computed regardless of `totalsComputed`. */
  correctedEntryCount: number;
}

export interface EmployeePayrollHistoryListResponse {
  page: number;
  pageSize: number;
  /** Total matching rows in the complete filtered/authorized scope — the pagination unit here is
   * `PayrollEntry` itself (report grain, approved decision 6), unlike Payroll Summary's Project
   * Site row count. */
  total: number;
  rows: EmployeePayrollHistoryRow[];
  totals: EmployeePayrollHistoryTotals;
  generatedAt: string;
}

/** Minimum-identity search result — matches `StatementEmployeeCandidate`'s own privacy posture
 * exactly (no salary/banking/correction figures ever appear here). */
export interface EmployeePayrollHistoryEmployeeOption {
  employeeId: string;
  employeeCode: string | null;
  cnic: string | null;
  name: string;
  currentSiteId: string;
  currentSiteName: string;
}

export interface EmployeePayrollHistoryEmployeeSearchResponse {
  total: number;
  page: number;
  pageSize: number;
  employees: EmployeePayrollHistoryEmployeeOption[];
}

// --- Detail response -------------------------------------------------------------------------

export interface EmployeePayrollHistoryWorkLineDetail {
  id: string;
  unit: EmployeePayrollHistoryUnitRef;
  days: string;
  otHours: string;
  otRate: string | null;
  cycleDays: number;
  /** Full-precision rate, not a rounded monetary figure — matches `calcNet`'s own
   * `PayrollWorkLineCalcResult` contract exactly. */
  dailyRate: string;
  effectiveOtRate: string;
  earnedAmount: string;
  otEarned: string;
  sortOrder: number;
}

/**
 * The complete canonical `calcNet` breakdown over this entry's *stored* fields — the immutable,
 * as-released calculation (approved decision 7). `correctionBalancePayable`/
 * `correctionBalanceRecovery` are explicitly labeled as materialized settlements of an obligation
 * originating *elsewhere* (see `EmployeePayrollHistoryDetail.materializationsConsumedByThisEntry`
 * for the cross-reference), never as corrections originating from this row.
 */
export interface EmployeePayrollHistoryCalculation {
  grossPay: string;
  workLines: EmployeePayrollHistoryWorkLineDetail[];
  effectiveLeaveRate: string;
  leaveDays: string;
  leaveEarned: string;
  allowance: string;
  earnedAmount: string;
  otEarned: string;
  /** Materialized settlement of a PAYABLE obligation originating from another cycle/entry — see
   * `materializationsConsumedByThisEntry`. Not a correction originating from this row. */
  correctionBalancePayable: string;
  totalEarning: string;
  eobiAmount: string;
  eobiApplicable: boolean;
  eobiDeduction: string;
  advanceDeduction: string;
  eidAdvanceDeduction: string;
  fine: string;
  /** Materialized settlement of a RECOVERY obligation originating from another cycle/entry — see
   * `materializationsConsumedByThisEntry`. Not a correction originating from this row. */
  correctionBalanceRecovery: string;
  totalDeduction: string;
  netSalary: string;
}

export interface EmployeePayrollHistoryReleaseInfo {
  released: boolean;
  releasedAt: string | null;
  releasedBy: EmployeePayrollHistoryActorRef | null;
  /** Set only for a one-off Late Entry release. */
  lateReason: string | null;
  hold: boolean;
  payoutOutcome: 'NO_PAY_DUE' | 'RECOVERY_DUE' | null;
}

export interface EmployeePayrollHistoryAdvanceSummary {
  advanceId: string;
  type: 'LOAN' | 'EID_ADVANCE';
  totalAmount: string;
  outstandingBalance: string;
  status: string;
  dateGiven: string;
  /** This entry's own `advanceDeduction`/`eidAdvanceDeduction`, whichever links to this Advance —
   * a read-only summary, never an edit surface. */
  deductionThisEntry: string;
}

export interface EmployeePayrollHistorySettlementDetail {
  settlementId: string;
  cycle: EmployeePayrollHistoryCycleRef;
  amountApplied: string;
  appliedAt: string;
}

export interface EmployeePayrollHistoryCorrectionPaymentDetail {
  correctionPaymentId: string;
  amount: string;
  paidAt: string;
  paidBy: EmployeePayrollHistoryActorRef;
}

/** Banking fields are deliberately omitted here (approved Sensitive Detail Policy — CNIC and
 * actor identities are the individual-detail-only fields this checkpoint authorizes; bank
 * account number/IBAN/branch code are excluded even from the individual detail response). */
export interface EmployeePayrollHistoryBalanceAdjustmentSummary {
  balanceAdjustmentId: string;
  type: 'PAYABLE' | 'RECOVERY' | 'NONE';
  status: 'PENDING' | 'SETTLED';
  paymentTiming: 'IMMEDIATE' | 'DEFERRED' | null;
  amount: string;
  remainingAmount: string;
  settlements: EmployeePayrollHistorySettlementDetail[];
  correctionPayment: EmployeePayrollHistoryCorrectionPaymentDetail | null;
}

export interface EmployeePayrollHistoryCorrectionDetail {
  correctionId: string;
  approvedAt: string;
  approvedBy: EmployeePayrollHistoryActorRef;
  reason: string;
  field: string;
  oldValue: string;
  newValue: string;
  oldNetSalary: string;
  newNetSalary: string;
  adjustmentTypeLabel: string;
  /** `null` only for a zero-delta correction (no `BalanceAdjustment` is ever created for one). */
  resultingBalanceAdjustment: EmployeePayrollHistoryBalanceAdjustmentSummary | null;
}

/**
 * A `BalanceAdjustmentMaterialization` *consumed by* this entry — i.e. this entry's own
 * `correctionBalancePayable`/`correctionBalanceRecovery` includes this reservation. Carries the
 * obligation's true origin so the frontend can state "this cycle's Net Salary includes a
 * materialized Balance Adjustment originating from the {origin cycle}" without misattributing
 * the obligation to this (the consuming) cycle — the exact cross-cycle nuance the approved
 * architecture review's §6 identified.
 */
export interface EmployeePayrollHistoryMaterializationDetail {
  materializationId: string;
  amount: string;
  status: 'ACTIVE' | 'CONSUMED' | 'CANCELLED';
  originBalanceAdjustmentId: string;
  originType: 'PAYABLE' | 'RECOVERY' | 'NONE';
  /** The cycle the underlying obligation actually originated in — never this (consuming)
   * entry's own cycle. */
  originCycle: EmployeePayrollHistoryCycleRef;
  /** The `PayrollEntry` that originated the obligation (the corrected entry, or the entry whose
   * own negative release created it directly) — `null` only if that entry can no longer be
   * resolved (should not occur under this schema's RESTRICT-only delete policy). */
  originPayrollEntryId: string | null;
}

export interface EmployeePayrollHistoryAuditReference {
  entityType: string;
  entityId: string;
}

export interface EmployeePayrollHistoryDetail {
  payrollEntryId: string;
  identity: {
    employeeId: string;
    employeeCode: string | null;
    employeeName: string;
    /** Individual-detail-only field (approved Sensitive Detail Policy) — never returned by the
     * list endpoint or bulk export. */
    cnic: string | null;
    cycle: EmployeePayrollHistoryCycleRef;
    siteId: string;
    siteName: string;
    designation: string;
    currentEmployeeRosterStatus: EmployeePayrollHistoryRosterStatus;
  };
  calculation: EmployeePayrollHistoryCalculation;
  release: EmployeePayrollHistoryReleaseInfo;
  /** 0–2 entries (this entry's own linked `advanceId`/`eidAdvanceId`, if any) — never the
   * Advance's full cross-cycle history (that remains Statements' own domain). */
  advances: EmployeePayrollHistoryAdvanceSummary[];
  correctionsOriginatingFromThisEntry: EmployeePayrollHistoryCorrectionDetail[];
  /** Set only when this entry's own release directly created a `RECOVERY` `BalanceAdjustment`
   * (negative net salary at release, `payoutOutcome = RECOVERY_DUE`) — a distinct origin path
   * from `correctionsOriginatingFromThisEntry`, never conflated with a Correction-originated one. */
  automaticRecoveryBalanceAdjustment: EmployeePayrollHistoryBalanceAdjustmentSummary | null;
  materializationsConsumedByThisEntry: EmployeePayrollHistoryMaterializationDetail[];
  auditReferences: EmployeePayrollHistoryAuditReference[];
  generatedAt: string;
}

export interface EmployeePayrollHistoryExportLimitError {
  code: 'EXPORT_ROW_LIMIT_EXCEEDED';
  matchingCount: number;
  maxRows: number;
  message: string;
}
