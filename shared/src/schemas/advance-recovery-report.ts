import { z } from 'zod';
import { advanceRepaymentTypeSchema, advanceStatusSchema, advanceTypeSchema, type AdvanceRepaymentType, type AdvanceStatus, type AdvanceType } from './advance';

/**
 * Phase 7 Reports, Advance Recovery Report Checkpoint 1A (approved Checkpoint 0 architecture
 * review; frozen decisions carried over verbatim from the authorizing instruction). Shared Zod
 * validation + response contracts, following the same shared-schema-validation convention every
 * sibling report in this module already established (`deduction-report.ts`, `overtime-report.ts`).
 *
 * **Business purpose (frozen):** an Advance-domain recovery and outstanding-balance report — which
 * employee Advances exist, LOAN vs EID_ADVANCE, original amount, recovered to date, current
 * outstanding balance, current status, and (only when a Payroll Cycle is selected) how much was
 * recovered through that cycle. NOT a generic deductions report, NOT a Correction/Balance
 * Adjustment recovery report, NOT an Employee Payroll History replacement, NOT a Statements
 * replacement. `correctionBalanceRecovery` is never incorporated here — that recovery domain is
 * completely excluded (frozen decision, §1).
 *
 * **Report grain (frozen):** one row = one `Advance` record. `Advance.id` is the stable row
 * identity — never one row per `PayrollEntry`, per recovery installment, or per employee/cycle.
 * LOAN and EID_ADVANCE share this same grain (one report, not two).
 *
 * **Cycle is OPTIONAL (frozen) — deliberately unlike Project Site Payroll Report/Deduction
 * Report/Overtime Report's own mandatory single-cycle shape.** Omitted: the Advance roster
 * according to the other filters, with `recoveredThisCycle` absent (`null`) on every row — never a
 * fabricated historical zero. Selected: adds historical recovery context (`recoveredThisCycle`) on
 * top of the same roster — it never redefines `currentOutstandingBalance`/`recoveredToDate`, which
 * both always remain LIVE CURRENT figures, never "as of the selected cycle" (frozen decision §3/§8
 * — there is deliberately no `outstandingBalanceAsOfCycle` field; the schema cannot truthfully
 * provide one).
 *
 * **Permission (frozen):** `reports:view`, not `statements:view` — this is an operational Reports-
 * catalogue report, applied independently to list, export, and the detail/history endpoint.
 *
 * **Site authorization (frozen, disclosed V1 limitation):** `Advance` has no historical `siteId` of
 * its own anywhere in this schema. V1 authorizes every Advance row using `Advance.employee.siteId`
 * — the employee's CURRENT site — the same limitation this schema's own historical-payroll-employee
 * lookup module already documents for Advance-only employees. A transferred employee's Advance
 * (and its recovery history) follows their CURRENT site, not the site they belonged to when the
 * Advance was originally given. Not a bug, not silently worked around — no `siteId` column is added
 * to `Advance`, no migration exists for this checkpoint.
 *
 * **Canonical financial values (frozen, never re-derived):** Original Amount = `Advance.totalAmount`.
 * Current Outstanding Balance = `Advance.outstandingBalance` (authoritative — never replayed from
 * `PayrollEntry` deduction history). Recovered To Date = `totalAmount - outstandingBalance`.
 * Recovered This Cycle (only when a Cycle is selected) = the matching `PayrollEntry` row's own
 * `advanceDeduction` (LOAN, joined via `advanceId`) or `eidAdvanceDeduction` (EID_ADVANCE, joined
 * via `eidAdvanceId`) for that exact cycle — never a replay/re-sum of unrelated cycles.
 */

// --- Filter query params -----------------------------------------------------------------------

const uuid = () => z.string().uuid();

/** Mirrors every sibling report's own `uuidListQueryParam` exactly (single string, comma-separated
 * string, or repeated-key array; deduplicated; `undefined` if empty). */
const uuidListQueryParam = z.preprocess((raw) => {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const values = Array.isArray(raw) ? raw : [raw];
  const flattened = values.flatMap((value) => String(value).split(',')).filter((value) => value.length > 0);
  if (flattened.length === 0) return undefined;
  return [...new Set(flattened)];
}, z.array(uuid()).optional());

const uuidQueryParam = z.preprocess((raw) => (raw === '' || raw === undefined ? undefined : raw), uuid().optional());

/** The established tri-state boolean query-parsing convention (`design-system.md` §2.4:
 * All/Yes/No — `undefined` sent for "All," never a false-equivalent value), reused verbatim for
 * `hasOutstandingBalance`. */
const booleanQueryParam = z.preprocess((raw) => {
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}, z.boolean().optional());

const pageQueryParam = z.preprocess(
  (raw) => (raw === undefined || raw === '' ? undefined : Number(raw)),
  z.number().int().min(1).optional().default(1),
);

export const ADVANCE_RECOVERY_REPORT_DEFAULT_PAGE_SIZE = 25;
export const ADVANCE_RECOVERY_REPORT_MAX_PAGE_SIZE = 100;

const pageSizeQueryParam = z.preprocess(
  (raw) => (raw === undefined || raw === '' ? undefined : Number(raw)),
  z.number().int().min(1).max(ADVANCE_RECOVERY_REPORT_MAX_PAGE_SIZE).optional().default(ADVANCE_RECOVERY_REPORT_DEFAULT_PAGE_SIZE),
);

/**
 * The approved V1 filter set only (frozen decision §9): Site (multi-select, current
 * `Employee.siteId`), Employee, Advance Type, Status, Has Outstanding Balance (tri-state:
 * omitted = All, `true` = `outstandingBalance > 0`, `false` = `outstandingBalance <= 0`), and an
 * OPTIONAL Cycle. Deliberately excludes Unit, amount range, date range, roster-status, Has
 * Correction, and any correction-recovery filter.
 */
const advanceRecoveryReportFilterFields = {
  siteIds: uuidListQueryParam,
  employeeId: uuidQueryParam,
  advanceType: z.preprocess((raw) => (raw === '' ? undefined : raw), advanceTypeSchema.optional()),
  status: z.preprocess((raw) => (raw === '' ? undefined : raw), advanceStatusSchema.optional()),
  hasOutstandingBalance: booleanQueryParam,
  cycleId: uuidQueryParam,
};

/**
 * Kept database-native throughout (frozen decision §13) — every field here is either a plain stored
 * `Advance` column or a relation's own plain stored column (`employee.employeeCode`/`.name`/
 * `site.name`). `recoveredThisCycle` is deliberately NOT sortable in V1 — it is not a stored
 * `Advance` column, and this checkpoint does not introduce a bounded in-memory sort exception for
 * it absent real usage proving the need (unlike Employee Payroll History's own disclosed
 * `netSalary` exception).
 */
export const ADVANCE_RECOVERY_REPORT_SORT_FIELDS = [
  'employeeCode',
  'employeeName',
  'site',
  'advanceType',
  'status',
  'originalAmount',
  'currentOutstandingBalance',
  'dateGiven',
] as const;

export type AdvanceRecoveryReportSortField = (typeof ADVANCE_RECOVERY_REPORT_SORT_FIELDS)[number];

export const ADVANCE_RECOVERY_REPORT_SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type AdvanceRecoveryReportSortDirection = (typeof ADVANCE_RECOVERY_REPORT_SORT_DIRECTIONS)[number];

const sortByField = z.preprocess(
  (raw) => (raw === '' || raw === undefined ? undefined : raw),
  z.enum(ADVANCE_RECOVERY_REPORT_SORT_FIELDS).optional().default('employeeName'),
);
const sortDirField = z.preprocess(
  (raw) => (raw === '' || raw === undefined ? undefined : raw),
  z.enum(ADVANCE_RECOVERY_REPORT_SORT_DIRECTIONS).optional().default('asc'),
);

export const advanceRecoveryReportListQuerySchema = z.object({
  ...advanceRecoveryReportFilterFields,
  page: pageQueryParam,
  pageSize: pageSizeQueryParam,
  sortBy: sortByField,
  sortDir: sortDirField,
});

export type AdvanceRecoveryReportListQuery = z.infer<typeof advanceRecoveryReportListQuerySchema>;

export const ADVANCE_RECOVERY_REPORT_EXPORT_FORMATS = ['csv', 'xlsx'] as const;
export type AdvanceRecoveryReportExportFormat = (typeof ADVANCE_RECOVERY_REPORT_EXPORT_FORMATS)[number];

/** Same filters/sorting as the list query, no pagination — an export is always every matching row
 * (up to `ADVANCE_RECOVERY_REPORT_EXPORT_MAX_ROWS`), never just one page. */
export const advanceRecoveryReportExportQuerySchema = z.object({
  ...advanceRecoveryReportFilterFields,
  sortBy: sortByField,
  sortDir: sortDirField,
  format: z.enum(ADVANCE_RECOVERY_REPORT_EXPORT_FORMATS),
});

export type AdvanceRecoveryReportExportQuery = z.infer<typeof advanceRecoveryReportExportQuerySchema>;

/**
 * `ADVANCE_RECOVERY_REPORT_EXPORT_MAX_ROWS` (frozen decision §16/§11): unlike `calcNet`-based
 * sibling reports, every totals figure this report needs is a true DB aggregate (`SUM`/`COUNT`/
 * `GROUP BY` over `Advance`/`PayrollEntry` columns) — there is no bounded fetch-and-sum pass, and
 * therefore no `totalsComputed: false` fallback. This ceiling exists solely to bound export
 * generation cost (CSV/XLSX row rendering), exactly like every sibling report's own export ceiling.
 */
export const ADVANCE_RECOVERY_REPORT_EXPORT_MAX_ROWS = 20_000;

// --- Employee lookup -----------------------------------------------------------------------------

export const ADVANCE_RECOVERY_REPORT_EMPLOYEE_LOOKUP_DEFAULT_PAGE_SIZE = 50;
export const ADVANCE_RECOVERY_REPORT_EMPLOYEE_LOOKUP_MAX_PAGE_SIZE = 200;

/**
 * Authorized against CURRENT `Employee.siteId` (frozen decision §15) — deliberately NOT the
 * historical-payroll employee lookup Employee Payroll History/Statements share
 * (`searchEmployeesByHistoricalPayroll`), which is scoped by historical `PayrollEntry.siteId` and
 * would silently exclude/include the wrong employees for a report whose own authorization model is
 * current-site-based throughout (frozen decision §5).
 */
export const advanceRecoveryReportEmployeeLookupQuerySchema = z.object({
  search: z.preprocess((raw) => (raw === '' || raw === undefined ? undefined : raw), z.string().trim().min(1).optional()),
  siteId: uuidQueryParam,
  page: pageQueryParam,
  pageSize: z.preprocess(
    (raw) => (raw === undefined || raw === '' ? undefined : Number(raw)),
    z.number().int().min(1).max(ADVANCE_RECOVERY_REPORT_EMPLOYEE_LOOKUP_MAX_PAGE_SIZE).optional().default(ADVANCE_RECOVERY_REPORT_EMPLOYEE_LOOKUP_DEFAULT_PAGE_SIZE),
  ),
});

export type AdvanceRecoveryReportEmployeeLookupQuery = z.infer<typeof advanceRecoveryReportEmployeeLookupQuerySchema>;

export interface AdvanceRecoveryReportEmployeeCandidate {
  employeeId: string;
  employeeCode: string | null;
  name: string;
  siteId: string;
  siteName: string;
}

export interface AdvanceRecoveryReportEmployeeLookupResponse {
  total: number;
  page: number;
  pageSize: number;
  employees: AdvanceRecoveryReportEmployeeCandidate[];
}

// --- Response contracts: list ---------------------------------------------------------------------

export interface AdvanceRecoveryReportCycleRef {
  id: string;
  year: number;
  month: number;
  status: 'DRAFT' | 'RELEASED' | 'ARCHIVED';
}

/**
 * One list row — always `Advance`'s own LIVE CURRENT figures for `recoveredToDate`/
 * `currentOutstandingBalance`/`status`/`repaymentType` (frozen decision §8), never a value replayed
 * "as of" the selected Cycle. `recoveredThisCycle` is the sole historical field on this row — `null`
 * whenever no Cycle is selected, never a fabricated zero (frozen decision §3/§10).
 *
 * No CNIC, no banking/account fields, no audit-actor identity, no Correction/BalanceAdjustment
 * field of any kind (frozen decision §10).
 */
export interface AdvanceRecoveryReportRow {
  advanceId: string;
  employeeId: string;
  /** Current `Employee.employeeCode` — Advance has no historical snapshot of its own. */
  employeeCode: string | null;
  employeeName: string;
  /** Current `Employee.siteId` — Advance has no historical site of its own (frozen decision §5). */
  siteId: string;
  siteName: string;
  advanceType: AdvanceType;
  /** `Advance.totalAmount`. */
  originalAmount: string;
  /** `Advance.totalAmount - Advance.outstandingBalance` — a LIVE CURRENT figure. */
  recoveredToDate: string;
  /** `Advance.outstandingBalance` verbatim — the authoritative current balance, never replayed from
   * `PayrollEntry` deduction history. */
  currentOutstandingBalance: string;
  status: AdvanceStatus;
  repaymentType: AdvanceRepaymentType;
  /** ISO date (`YYYY-MM-DD`). */
  dateGiven: string;
  /** The linked `PayrollEntry`'s own `advanceDeduction`/`eidAdvanceDeduction` for the selected
   * Cycle — `null` whenever no Cycle is selected (never a fabricated historical zero). When a
   * Cycle IS selected, this is always a real string, including `"0.00"` for an Advance genuinely
   * uninvolved in that cycle's recovery (a real, meaningful fact — the Advance still belongs in
   * the roster per the other filters, it simply had no recovery event that cycle) — `null` and
   * `"0.00"` are never conflated. */
  recoveredThisCycle: string | null;
}

export interface AdvanceRecoveryReportTypeTotals {
  originalAmountTotal: string;
  recoveredToDateTotal: string;
  currentOutstandingBalanceTotal: string;
}

/**
 * Computed over the complete filtered/authorized dataset via true DB aggregation (`SUM`/`COUNT`/
 * `GROUP BY`), never just the current page and never a bounded in-memory fetch-and-sum pass (frozen
 * decision §11) — there is deliberately no `totalsComputed` flag; every field here is always exact,
 * regardless of how many Advances match.
 */
export interface AdvanceRecoveryReportTotals {
  matchingAdvanceCount: number;
  /** Distinct `employeeId` count across the matching Advances. */
  employeesWithAdvanceCount: number;
  loan: AdvanceRecoveryReportTypeTotals;
  eidAdvance: AdvanceRecoveryReportTypeTotals;
  activeCount: number;
  reservedCount: number;
  paidOffCount: number;
  cancelledCount: number;
  /** Non-null only when `cycleId` was provided (frozen decision §3/§11) — never implies a Cycle
   * recovery total exists when none was requested. */
  recoveredThisCycleTotal: string | null;
  recoveredThisCycleTotalByType: { loan: string; eidAdvance: string } | null;
}

export interface AdvanceRecoveryReportListResponse {
  /** `null` whenever no `cycleId` was provided — never fabricated. */
  cycle: AdvanceRecoveryReportCycleRef | null;
  page: number;
  pageSize: number;
  /** Total matching rows in the complete filtered/authorized scope — the pagination unit here is
   * `Advance` itself (report grain, frozen decision §2). */
  total: number;
  rows: AdvanceRecoveryReportRow[];
  totals: AdvanceRecoveryReportTotals;
  generatedAt: string;
}

export interface AdvanceRecoveryReportExportLimitError {
  code: 'EXPORT_ROW_LIMIT_EXCEEDED';
  matchingCount: number;
  maxRows: number;
  message: string;
}

// --- Response contracts: detail/history ------------------------------------------------------------

/** Structurally identical to (and freely assignable from) `backend/src/modules/reports/
 * payroll-entry-row-status.ts`'s own neutral `PayrollEntryRowStatus` — independently declared here
 * per this module's own established "no confusing cross-report type reference in a public DTO"
 * convention (every sibling report's own `*RowStatus` union does the same). */
export const ADVANCE_RECOVERY_REPORT_ROW_STATUS_VALUES = ['RELEASED', 'HELD', 'NO_PAY_DUE', 'RECOVERY_DUE', 'PENDING'] as const;
export type AdvanceRecoveryReportRowStatus = (typeof ADVANCE_RECOVERY_REPORT_ROW_STATUS_VALUES)[number];

export interface AdvanceRecoveryReportDetailEmployeeRef {
  id: string;
  employeeCode: string | null;
  name: string;
  /** Current `Employee.siteId`/site name — the same authorization basis this detail endpoint itself
   * uses (frozen decision §5/§12). */
  siteId: string;
  siteName: string;
}

/**
 * One `PayrollEntry` genuinely linked to this Advance via `advanceId` (LOAN) or `eidAdvanceId`
 * (EID_ADVANCE) — a real recovery event, never a schedule/deferral event (frozen decision §12).
 * `siteId`/`siteName` are that `PayrollEntry`'s own HISTORICAL site — deliberately not the
 * employee's current site, unlike every other field in this detail response.
 */
export interface AdvanceRecoveryReportRecoveryEvent {
  payrollEntryId: string;
  cycleId: string;
  /** "August 2026" — presentation only. */
  cycleLabel: string;
  cycleYear: number;
  cycleMonth: number;
  siteId: string;
  siteName: string;
  /** This entry's own `advanceDeduction`/`eidAdvanceDeduction`, matching `Advance.type`. */
  amountRecovered: string;
  rowStatus: AdvanceRecoveryReportRowStatus;
  releasedAt: string | null;
}

/** One `AdvanceScheduleChange` row — a deferral/reschedule event, never a recovery event (frozen
 * decision §12 — the two are always kept clearly distinct, never merged into one list). */
export interface AdvanceRecoveryReportScheduleChangeEvent {
  id: string;
  fromPeriod: { year: number; month: number };
  toPeriod: { year: number; month: number };
  reason: string;
  changedAt: string;
  changedBy: { id: string; name: string };
}

export interface AdvanceRecoveryReportDetail {
  advanceId: string;
  employee: AdvanceRecoveryReportDetailEmployeeRef;
  advanceType: AdvanceType;
  originalAmount: string;
  recoveredToDate: string;
  currentOutstandingBalance: string;
  status: AdvanceStatus;
  repaymentType: AdvanceRepaymentType;
  scheduledInstallmentAmount: string | null;
  dateGiven: string;
  paidOffAt: string | null;
  /** Every genuinely linked `PayrollEntry`, newest cycle first. */
  recoveryHistory: AdvanceRecoveryReportRecoveryEvent[];
  /** Every `AdvanceScheduleChange`, newest first — separate from `recoveryHistory` (frozen decision
   * §12). */
  scheduleChanges: AdvanceRecoveryReportScheduleChangeEvent[];
  generatedAt: string;
}
