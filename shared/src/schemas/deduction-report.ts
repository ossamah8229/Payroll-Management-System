import { z } from 'zod';

/**
 * Phase 7 Reports, Deduction Report Checkpoint 1A (approved Checkpoint 0 architecture review,
 * 2026-08-07; frozen decisions carried over verbatim from the authorizing instruction). Shared Zod
 * validation + response contracts for this report, following the same shared-schema-validation
 * convention Employee Payroll History/Project Site Payroll Report already established
 * (`shared/src/schemas/employee-payroll-history.ts`, `.../project-site-payroll-report.ts`) rather
 * than hand-parsing `req.query`.
 *
 * **Business purpose (frozen):** a single-cycle, deduction-type-centric operational report — "which
 * employees had which deduction(s) this cycle, how much, and what does each type total to
 * company-wide" — filterable and sortable by deduction type. Deliberately NOT a cross-cycle
 * history, an Advance Recovery report, a Variance report, or a second Project Site Payroll Report.
 *
 * **Report scope (frozen):** one row = one `PayrollEntry`. `cycleId` is required and singular — no
 * `fromCycleId`/`toCycleId` range, no generic date range, no cross-cycle browsing, mirroring
 * Project Site Payroll Report's own "one cycle at a time" shape rather than Employee Payroll
 * History's cycle-range browser.
 *
 * **Permission (frozen):** `reports:view`, not `statements:view` — this report is a row-level,
 * one-cycle, site-scoped operational view, the same disclosure class as Payroll Summary/Project
 * Site Payroll Report, not Employee Payroll History's more sensitive, cross-cycle,
 * employee-searchable history.
 *
 * **Row status** reuses the exact same 5-state precedence-ordered concept every other row-level
 * report in this module already established (`RELEASED > HELD > NO_PAY_DUE > RECOVERY_DUE >
 * PENDING`), derived server-side only via the now-neutral
 * `backend/src/modules/reports/payroll-entry-row-status.ts` (this report is that module's third
 * consumer, the threshold this project's own "extract generic code at the third consumer"
 * convention uses). This file re-declares the union under this report's own name rather than
 * importing `EmployeePayrollHistoryRowStatus`/`ProjectSitePayrollReportRowStatus` — the three are
 * structurally identical (the same `PayrollEntry.released`/`.hold`/`.payoutOutcome` state machine,
 * not a report-specific concept), but keeping each report's own public DTO independently named
 * avoids a confusing cross-report type import in any one module's public contract — the established
 * convention this checkpoint's own architecture review confirmed remains correct even though the
 * *backend derivation logic* is now shared.
 *
 * **Deduction types (frozen) — exactly five**: Effective EOBI (`eobiApplicable ? eobiAmount : 0`,
 * never a raw sum/filter of `eobiAmount` alone), Advance Deduction, EID Advance Deduction, Fine,
 * Correction Balance Recovery. Explicitly excluded: Correction Balance Payable (an earning, not a
 * deduction), Leave Earned (an earning), `BalanceAdjustment.remainingAmount` (a live, cross-cycle
 * obligation — out of scope for a single-cycle report, same reasoning Payroll Summary's own §5
 * already established for `pendingReleaseAmount` vs. joining that table), Correction Payments/
 * settlement-ledger events, and any `AdjustmentType`/reason categorization (`PayrollEntry.fine`
 * carries no `AdjustmentType` link at all — not representable without a schema change out of scope
 * here).
 */

export const DEDUCTION_REPORT_ROW_STATUS_VALUES = ['RELEASED', 'HELD', 'NO_PAY_DUE', 'RECOVERY_DUE', 'PENDING'] as const;

export type DeductionReportRowStatus = (typeof DEDUCTION_REPORT_ROW_STATUS_VALUES)[number];

export const deductionReportRowStatusSchema = z.enum(DEDUCTION_REPORT_ROW_STATUS_VALUES);

/**
 * Deliberately excludes `eobiDeduction`/`totalDeductions`/`netSalary`/`cycle` (frozen decision —
 * Sorting section): effective EOBI needs the `eobiApplicable ? eobiAmount : 0` conditional, and
 * Total Deductions is a derived sum — neither is a plain stored column a Prisma `orderBy` can
 * express, and this checkpoint deliberately does not introduce a bounded in-memory sort exception
 * for either (unlike Employee Payroll History's/Project Site Payroll Report's own disclosed
 * `netSalary` exception) absent real usage proving the need. `advanceDeduction`,
 * `eidAdvanceDeduction`, `fine`, and `correctionBalanceRecovery` are all real, directly-sortable
 * stored `PayrollEntry` columns. `cycle` is excluded because this report is always exactly one
 * cycle, so sorting by it would be a no-op (same reasoning Project Site Payroll Report's own sort
 * field list already applies). Every one of these appends a deterministic `PayrollEntry.id ASC`
 * tie-break server-side.
 */
export const DEDUCTION_REPORT_SORT_FIELDS = [
  'employeeCode',
  'employeeName',
  'site',
  'advanceDeduction',
  'eidAdvanceDeduction',
  'fine',
  'correctionBalanceRecovery',
  'rowStatus',
] as const;

export type DeductionReportSortField = (typeof DEDUCTION_REPORT_SORT_FIELDS)[number];

export const DEDUCTION_REPORT_SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type DeductionReportSortDirection = (typeof DEDUCTION_REPORT_SORT_DIRECTIONS)[number];

export const DEDUCTION_REPORT_DEFAULT_PAGE_SIZE = 25;
export const DEDUCTION_REPORT_MAX_PAGE_SIZE = 100;

/**
 * Reuses the exact same bound and reasoning Employee Payroll History's/Project Site Payroll
 * Report's own export ceilings already established — Total Deductions (if it were summed as a
 * derived figure) and the underlying `calcNet`-adjacent effective-EOBI computation are not
 * SQL-aggregable without an independent, drift-prone second formula, so this report's totals are
 * computed via the same bounded fetch-and-sum-via-`calcNet`/`sumMoney` strategy Project Site
 * Payroll Report already uses for its own totals — deliberately the *same* unified computation
 * path for every total field (including the plain-stored-column ones), not a second, split
 * SQL-aggregate path for those, per this checkpoint's own explicit "reuse canonical financial
 * calculation semantics, do not create a second SQL financial formula" instruction. Independently
 * named rather than imported, per this project's own "extract at the third consumer" convention
 * (this is only the third report to need this exact ceiling/reasoning).
 */
export const DEDUCTION_REPORT_EXPORT_MAX_ROWS = 20_000;

const uuid = () => z.string().uuid();

/** Mirrors `project-site-payroll-report.ts`'s own `uuidListQueryParam` exactly (single string,
 * comma-separated string, or repeated-key array; deduplicated; `undefined` if empty). */
const uuidListQueryParam = z.preprocess((raw) => {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const values = Array.isArray(raw) ? raw : [raw];
  const flattened = values.flatMap((value) => String(value).split(',')).filter((value) => value.length > 0);
  if (flattened.length === 0) return undefined;
  return [...new Set(flattened)];
}, z.array(uuid()).optional());

const uuidQueryParam = z.preprocess((raw) => (raw === '' || raw === undefined ? undefined : raw), uuid().optional());

/** The established tri-state boolean query-parsing convention (`design-system.md` §2.4: All/Yes/No
 * — `undefined` sent for "All," never a false-equivalent value) — identical to
 * `project-site-payroll-report.ts`'s own `booleanQueryParam`, reused verbatim for `hasCorrection`
 * and this report's own five deduction-presence filters below. */
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
  z.number().int().min(1).max(DEDUCTION_REPORT_MAX_PAGE_SIZE).optional().default(DEDUCTION_REPORT_DEFAULT_PAGE_SIZE),
);

/**
 * The approved filter set only (frozen decisions — Base Filters/Deduction Filter Model sections):
 * Payroll Cycle (required, single), Site (multi-select), Unit, Row Status, Has Correction, and five
 * independent tri-state deduction-presence filters (Model 2 — separate `All`/`Yes`/`No` selects,
 * never a single "Deduction Type" multi-select, per the approved semantics below). Deliberately
 * excludes Employee search, Designation, Amount range, Current Roster Status, and any date/cycle
 * range — all explicitly out of scope for this checkpoint.
 *
 * **Deduction predicate semantics (frozen, applied identically here and in the backend filter
 * builder)**: for `hasEobi`, `Yes` means `eobiApplicable === true AND` the configured `eobiAmount`
 * is positive (i.e. effective EOBI `> 0`); `No` means effective EOBI is `0`, which includes
 * `eobiApplicable === false` *and* the (structurally possible) case of `eobiApplicable === true`
 * with a zero-or-negative configured amount — never a raw `eobiAmount > 0` check that ignores
 * applicability. For `hasAdvanceDeduction`/`hasEidAdvanceDeduction`/`hasFine`/
 * `hasCorrectionRecovery`, `Yes` means the corresponding stored column is `> 0`; `No` means it is
 * `<= 0`. `All` (the default, omitted) sends no predicate. All five, when provided, combine with
 * `AND` semantics alongside every other filter.
 */
const deductionReportFilterFields = {
  cycleId: uuid(),
  siteIds: uuidListQueryParam,
  unitId: uuidQueryParam,
  rowStatus: z.preprocess((raw) => (raw === '' ? undefined : raw), deductionReportRowStatusSchema.optional()),
  hasCorrection: booleanQueryParam,
  hasEobi: booleanQueryParam,
  hasAdvanceDeduction: booleanQueryParam,
  hasEidAdvanceDeduction: booleanQueryParam,
  hasFine: booleanQueryParam,
  hasCorrectionRecovery: booleanQueryParam,
};

/** Default `employeeName` ascending (frozen decision — Sorting section). */
const sortByField = z.preprocess(
  (raw) => (raw === '' || raw === undefined ? undefined : raw),
  z.enum(DEDUCTION_REPORT_SORT_FIELDS).optional().default('employeeName'),
);
const sortDirField = z.preprocess(
  (raw) => (raw === '' || raw === undefined ? undefined : raw),
  z.enum(DEDUCTION_REPORT_SORT_DIRECTIONS).optional().default('asc'),
);

export const deductionReportListQuerySchema = z.object({
  ...deductionReportFilterFields,
  page: pageQueryParam,
  pageSize: pageSizeQueryParam,
  sortBy: sortByField,
  sortDir: sortDirField,
});

export type DeductionReportListQuery = z.infer<typeof deductionReportListQuerySchema>;

export const DEDUCTION_REPORT_EXPORT_FORMATS = ['csv', 'xlsx'] as const;
export type DeductionReportExportFormat = (typeof DEDUCTION_REPORT_EXPORT_FORMATS)[number];

/** Same filters/sorting as the list query, no pagination — an export is always every matching row
 * (up to `DEDUCTION_REPORT_EXPORT_MAX_ROWS`), never just one page. */
export const deductionReportExportQuerySchema = z.object({
  ...deductionReportFilterFields,
  sortBy: sortByField,
  sortDir: sortDirField,
  format: z.enum(DEDUCTION_REPORT_EXPORT_FORMATS),
});

export type DeductionReportExportQuery = z.infer<typeof deductionReportExportQuerySchema>;

// --- Response contracts ---------------------------------------------------------------------

export interface DeductionReportCycleRef {
  id: string;
  year: number;
  month: number;
  status: 'DRAFT' | 'RELEASED' | 'ARCHIVED';
}

export interface DeductionReportUnitRef {
  id: string;
  name: string;
  code: string | null;
}

/**
 * One list row — always the *original*, as-released figures, never a corrected/replayed value (a
 * `Correction` never mutates `PayrollEntry`'s own stored columns; `correctionBalanceRecovery` is
 * this cycle's own already-materialized settlement amount, exactly as Payroll Summary/Project Site
 * Payroll Report already surface it — informational, never re-netted). No Gross Pay, no Net Salary,
 * no Correction Balance Payable (an earning, out of scope for this deduction-only report — frozen
 * decision, Columns section), no CNIC, no banking, no release-actor/audit-actor identity, no
 * correction reasons, no live `BalanceAdjustment.remainingAmount`.
 */
export interface DeductionReportRow {
  payrollEntryId: string;
  employeeId: string;
  /** Current `Employee.employeeCode` — no historical snapshot exists on `PayrollEntry`. */
  employeeCode: string | null;
  /** `PayrollEntry.employeeNameSnapshot ?? Employee.name` — the same established convention every
   * other row-level report in this module already uses. */
  employeeName: string;
  /** Historical `PayrollEntry.siteId` — never the employee's current site. */
  siteId: string;
  siteName: string;
  /** The work line with the lowest `sortOrder`; `null` only if this entry's own required "never
   * zero lines" invariant were somehow violated (defensive typing, not an expected case). */
  primaryUnit: DeductionReportUnitRef | null;
  /** Count of this entry's *other* work lines beyond the primary one — display only ("Primary Unit
   * (+N more)"), never a per-Unit financial allocation (frozen decision — Unit Behavior section). */
  additionalUnitCount: number;
  designation: string;
  /** `calcNet()`'s own applied EOBI deduction — zero whenever `eobiApplicable` is false, never the
   * raw stored `eobiAmount` column regardless of applicability. */
  eobi: string;
  advanceDeduction: string;
  eidAdvanceDeduction: string;
  fine: string;
  /** This cycle's own already-materialized RECOVERY settlement — never the live, cross-cycle
   * `BalanceAdjustment.remainingAmount`. */
  correctionBalanceRecovery: string;
  /** `calcNet()`'s own `totalDeduction` — eobi + advanceDeduction + eidAdvanceDeduction + fine +
   * correctionBalanceRecovery, the single canonical figure, never independently re-summed. */
  totalDeductions: string;
  rowStatus: DeductionReportRowStatus;
  /** Count of approved `Correction` rows whose `payrollEntryId` is this entry — batched across the
   * page in one query, never one query per row. */
  correctionCount: number;
  /** `PayrollEntry.releasedAt` only — no release-actor identity on this row (no detail endpoint
   * exists in V1, frozen decision — Detail Page section). */
  releasedAt: string | null;
}

/**
 * Computed over the complete filtered/authorized dataset, never the current page. Uses the same
 * unified bounded computation strategy Employee Payroll History/Project Site Payroll Report already
 * established: the five status-breakdown counts and `correctedEntryCount` are plain, always-exact
 * DB aggregates (independent of `totalsComputed`); every monetary total and
 * `employeesWithAnyDeduction` are computed via the same bounded fetch-and-`calcNet`/`sumMoney` pass
 * only when `matchingCount` is within `DEDUCTION_REPORT_EXPORT_MAX_ROWS` — beyond it, `null`
 * (monetary fields) / `null` (`employeesWithAnyDeduction`) with `totalsComputed: false`, visible and
 * honest, never a silently wrong or partial number, never a misleading zero.
 */
export interface DeductionReportTotals {
  matchingCount: number;
  /** Count of matching rows where at least one of the five deduction types is effectively `> 0` —
   * gated by `totalsComputed` exactly like the monetary totals below (not a plain DB count, since
   * effective EOBI requires the same `calcNet`-adjacent computation the other totals do). */
  employeesWithAnyDeduction: number | null;
  eobiTotal: string | null;
  advanceDeductionTotal: string | null;
  eidAdvanceDeductionTotal: string | null;
  fineTotal: string | null;
  correctionRecoveryTotal: string | null;
  totalDeductions: string | null;
  releasedCount: number;
  heldCount: number;
  noPayDueCount: number;
  recoveryDueCount: number;
  pendingCount: number;
  /** Count of matching rows with at least one approved `Correction` — a plain DB count, always
   * computed regardless of `totalsComputed`. */
  correctedEntryCount: number;
  /** `false` exactly when `matchingCount > DEDUCTION_REPORT_EXPORT_MAX_ROWS` — narrow the filters
   * to get exact monetary totals. Never partially computed. */
  totalsComputed: boolean;
}

export interface DeductionReportListResponse {
  cycle: DeductionReportCycleRef;
  page: number;
  pageSize: number;
  /** Total matching rows in the complete filtered/authorized scope — the pagination unit here is
   * `PayrollEntry` itself (report grain, frozen decision — Report Grain section). */
  total: number;
  rows: DeductionReportRow[];
  totals: DeductionReportTotals;
  generatedAt: string;
}

export interface DeductionReportExportLimitError {
  code: 'EXPORT_ROW_LIMIT_EXCEEDED';
  matchingCount: number;
  maxRows: number;
  message: string;
}
