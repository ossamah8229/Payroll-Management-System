import { z } from 'zod';

/**
 * Phase 7 Reports, Overtime Report Checkpoint 1A (approved Checkpoint 0 architecture review,
 * 2026-08-07; frozen decisions carried over verbatim from the authorizing instruction). Shared Zod
 * validation + response contracts for this report, following the same shared-schema-validation
 * convention every other report in this module already established
 * (`shared/src/schemas/{employee-payroll-history,project-site-payroll-report,deduction-report}.ts`)
 * rather than hand-parsing `req.query`.
 *
 * **Business purpose (frozen):** a single-cycle operational overtime report — "which employees
 * worked overtime this cycle, at which Unit, how many hours, at what rate, and how much did it
 * cost" — filterable by Has Overtime. Deliberately NOT a cross-cycle trend (that overlaps the
 * not-yet-built Variance/Month-on-Month Report), and NOT a second Project Site Payroll Report or
 * Employee Payroll History.
 *
 * **Report grain (frozen, intentional architectural exception):** one row = one
 * `PayrollEntryWorkLine`, not one `PayrollEntry` — every other row-level report in this module
 * (Employee Payroll History, Project Site Payroll Report, Deduction Report) is `PayrollEntry`-grain.
 * OT hours/rate are genuinely work-line-scoped, not entry-scoped (`docs/architecture/database/
 * payroll-entry.md` §12a) — a multi-unit employee's OT rate has no single correct value at
 * entry-grain (each Unit can carry its own `otRate`, or none, deriving its own effective rate from
 * `grossPay / that line's cycleDays / 8`). Work-line grain is the only grain where OT Hours,
 * Effective OT Rate, and OT Earnings are all unambiguous, correctly attributed per Unit, and never
 * require picking/hiding one line's rate over another's. An employee with 2 work lines this cycle
 * therefore appears as 2 rows here — Employee Code + Unit together identify a row, not Employee
 * Code alone. Entry-level fields (Row Status, Has Correction, Gross Pay) repeat identically across
 * a given entry's rows; they are NOT double-counted in totals (see totals doc comments below).
 *
 * **Permission (frozen):** `reports:view`, not `statements:view` — a single-cycle, site-scoped,
 * non-employee-searchable operational report, the same disclosure class as Project Site Payroll
 * Report/Deduction Report, not Employee Payroll History's more sensitive, cross-cycle,
 * employee-searchable history.
 *
 * **Canonical overtime fields (frozen) — never a second formula:** OT Hours is the stored
 * `PayrollEntryWorkLine.otHours` column, read verbatim. Effective OT Rate and OT Earnings are both
 * read from canonical `calcNet` (`shared/src/lib/calc-net.ts`) — never independently recomputed.
 * Each work line's `otEarned_i`/`effectiveOtRate_i` inside `calcNet` depends only on that line's own
 * `otHours`/`otRate`/`cycleDays` and the parent entry's `grossPay` — never on any sibling work line
 * — so this report's own `calcEntryRow` (`overtime-report.service.ts`) calls `calcNet` with exactly
 * one work line (this row's own), which is mathematically identical to reading that same line's own
 * breakdown out of a call made with the entry's complete `workLines` array. This avoids fetching
 * sibling work lines this report never displays, while remaining provably the same canonical
 * computation, not an approximation of it.
 *
 * **Row status** reuses the exact same 5-state precedence-ordered concept every other row-level
 * report in this module already established (`RELEASED > HELD > NO_PAY_DUE > RECOVERY_DUE >
 * PENDING`), derived server-side only via the neutral `backend/src/modules/reports/
 * payroll-entry-row-status.ts` (this report is its fourth consumer, after Employee Payroll History,
 * Project Site Payroll Report, and Deduction Report). This file re-declares the union under this
 * report's own name rather than importing another report's type, per the same "no confusing
 * cross-report type reference in a public DTO" convention every sibling report already follows —
 * only the *totals* breakdown (see `OvertimeReportTotals` below) narrows to 3 of these 5 states
 * (approved decision — Totals section), the row-level `rowStatus` field and the `rowStatus` filter
 * both still support all 5.
 */

export const OVERTIME_REPORT_ROW_STATUS_VALUES = ['RELEASED', 'HELD', 'NO_PAY_DUE', 'RECOVERY_DUE', 'PENDING'] as const;

export type OvertimeReportRowStatus = (typeof OVERTIME_REPORT_ROW_STATUS_VALUES)[number];

export const overtimeReportRowStatusSchema = z.enum(OVERTIME_REPORT_ROW_STATUS_VALUES);

/**
 * DB-native sortable fields only (frozen decision — Sorting section: "do not introduce bounded
 * in-memory sorting for Effective OT Rate or OT Earnings"). `otHours` is a plain stored
 * `PayrollEntryWorkLine` column, directly `orderBy`-able. `employeeCode`/`employeeName`/`site` sort
 * through the parent `PayrollEntry`'s own relations; `unit` sorts by this row's own `Unit.name`.
 * `rowStatus` uses the same disclosed `released`/`hold`/`payoutOutcome`-ordering approximation every
 * sibling report's own `rowStatus` sort already uses. Every branch appends a deterministic
 * `PayrollEntryWorkLine.id ASC` tie-break server-side (`overtime-report.service.ts`).
 */
export const OVERTIME_REPORT_SORT_FIELDS = ['employeeCode', 'employeeName', 'site', 'unit', 'otHours', 'rowStatus'] as const;

export type OvertimeReportSortField = (typeof OVERTIME_REPORT_SORT_FIELDS)[number];

export const OVERTIME_REPORT_SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type OvertimeReportSortDirection = (typeof OVERTIME_REPORT_SORT_DIRECTIONS)[number];

export const OVERTIME_REPORT_DEFAULT_PAGE_SIZE = 25;
export const OVERTIME_REPORT_MAX_PAGE_SIZE = 100;

/**
 * Reuses the exact same bound and reasoning Employee Payroll History's/Project Site Payroll
 * Report's/Deduction Report's own export ceilings already established. OT Earnings (and the
 * "with overtime" presence counts in totals) are not SQL-aggregable without an independent,
 * drift-prone second formula, so this report's bounded totals fields are computed via the same
 * bounded fetch-and-`calcNet`/`sumMoney` strategy those reports already use — deliberately gating
 * OT Hours' own total together with OT Earnings' (not splitting a "cheap SQL SUM" path out for the
 * stored-column field), per Deduction Report's own explicit "one unified bounded strategy for every
 * total, not a second SQL financial formula" precedent (`docs/architecture/workflows/reports.md`
 * Deduction Report §17.5) — only when `matchingCount` is within this ceiling; beyond it, `null` with
 * `totalsComputed: false`. Independently named rather than imported, per this project's own
 * "extract at the third consumer" convention (this checkpoint's constant, not a shared one).
 */
export const OVERTIME_REPORT_EXPORT_MAX_ROWS = 20_000;

const uuid = () => z.string().uuid();

/** Mirrors `deduction-report.ts`'s own `uuidListQueryParam` exactly (single string, comma-separated
 * string, or repeated-key array; deduplicated; `undefined` if empty). Deliberately duplicated, not
 * imported — this project's established convention for these small query-parsing helpers across
 * every report schema file in this module (none of the four extract them into a shared module). */
const uuidListQueryParam = z.preprocess((raw) => {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const values = Array.isArray(raw) ? raw : [raw];
  const flattened = values.flatMap((value) => String(value).split(',')).filter((value) => value.length > 0);
  if (flattened.length === 0) return undefined;
  return [...new Set(flattened)];
}, z.array(uuid()).optional());

const uuidQueryParam = z.preprocess((raw) => (raw === '' || raw === undefined ? undefined : raw), uuid().optional());

/** The established tri-state boolean query-parsing convention (`design-system.md` §2.4: All/Yes/No
 * — `undefined` sent for "All," never a false-equivalent value) — identical to every sibling
 * report's own `booleanQueryParam`, reused verbatim for `hasCorrection` and `hasOvertime` below. */
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
  z.number().int().min(1).max(OVERTIME_REPORT_MAX_PAGE_SIZE).optional().default(OVERTIME_REPORT_DEFAULT_PAGE_SIZE),
);

/**
 * The approved filter set only (frozen decisions — Filters section): Payroll Cycle (required,
 * single), Site (multi-select), Unit, Row Status, Has Correction, and one Has Overtime tri-state
 * (`otHours > 0` on this row's own work line — never split into separate hours/earnings filters,
 * and no amount/rate range in V1). Deliberately excludes Employee search, Designation, OT rate
 * filter, and any cross-cycle range — all explicitly out of scope for this checkpoint.
 */
const overtimeReportFilterFields = {
  cycleId: uuid(),
  siteIds: uuidListQueryParam,
  unitId: uuidQueryParam,
  rowStatus: z.preprocess((raw) => (raw === '' ? undefined : raw), overtimeReportRowStatusSchema.optional()),
  hasCorrection: booleanQueryParam,
  hasOvertime: booleanQueryParam,
};

/** Default `employeeName` ascending, matching Deduction Report's own default. */
const sortByField = z.preprocess(
  (raw) => (raw === '' || raw === undefined ? undefined : raw),
  z.enum(OVERTIME_REPORT_SORT_FIELDS).optional().default('employeeName'),
);
const sortDirField = z.preprocess(
  (raw) => (raw === '' || raw === undefined ? undefined : raw),
  z.enum(OVERTIME_REPORT_SORT_DIRECTIONS).optional().default('asc'),
);

export const overtimeReportListQuerySchema = z.object({
  ...overtimeReportFilterFields,
  page: pageQueryParam,
  pageSize: pageSizeQueryParam,
  sortBy: sortByField,
  sortDir: sortDirField,
});

export type OvertimeReportListQuery = z.infer<typeof overtimeReportListQuerySchema>;

export const OVERTIME_REPORT_EXPORT_FORMATS = ['csv', 'xlsx'] as const;
export type OvertimeReportExportFormat = (typeof OVERTIME_REPORT_EXPORT_FORMATS)[number];

/** Same filters/sorting as the list query, no pagination — an export is always every matching row
 * (up to `OVERTIME_REPORT_EXPORT_MAX_ROWS`), never just one page. */
export const overtimeReportExportQuerySchema = z.object({
  ...overtimeReportFilterFields,
  sortBy: sortByField,
  sortDir: sortDirField,
  format: z.enum(OVERTIME_REPORT_EXPORT_FORMATS),
});

export type OvertimeReportExportQuery = z.infer<typeof overtimeReportExportQuerySchema>;

// --- Response contracts ---------------------------------------------------------------------

export interface OvertimeReportCycleRef {
  id: string;
  year: number;
  month: number;
  status: 'DRAFT' | 'RELEASED' | 'ARCHIVED';
}

export interface OvertimeReportUnitRef {
  id: string;
  name: string;
  code: string | null;
}

/**
 * One list row = one `PayrollEntryWorkLine` (frozen grain — see file header). No CNIC, no banking,
 * no release-actor identity, no correction reasons, no Net Salary, no Total Earnings (frozen
 * decision — Columns section: this report stays focused on overtime, not a second Project Site
 * Payroll Report).
 */
export interface OvertimeReportRow {
  workLineId: string;
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
  /** This work line's own Unit — never nullable (a work line always references exactly one Unit). */
  unit: OvertimeReportUnitRef;
  designation: string;
  /** `PayrollEntryWorkLine.otHours`, read verbatim. */
  otHours: string;
  /** `calcNet()`'s own per-line effective rate — `otRate` when explicitly set, else derived
   * `dailyRate / 8` where `dailyRate = grossPay / this line's cycleDays`. Full decimal precision,
   * unrounded (matching Employee Payroll History's own detail-endpoint `effectiveOtRate` precedent
   * — `employee-payroll-history.service.ts`), never independently rounded/reformatted here. */
  effectiveOtRate: string;
  /** `calcNet()`'s own per-line `otEarned_i` — `otHours × effectiveOtRate`, rounded to 2dp. */
  otEarned: string;
  /** `PayrollEntry.grossPay` — kept as context for `effectiveOtRate`'s own derivation, not an
   * independent earning figure this report totals. */
  grossPay: string;
  /** Entry-level (repeats across this entry's other work-line rows, if any). */
  rowStatus: OvertimeReportRowStatus;
  /** Entry-level (repeats across this entry's other work-line rows, if any) — whether this entry
   * has at least one approved `Correction`. A boolean presence flag, not a count (unlike Deduction
   * Report's `correctionCount`) — approved decision, Columns section names "Has Correction". */
  hasCorrection: boolean;
}

/**
 * Computed over the complete filtered/authorized work-line scope, never the current page.
 *
 * **Always-exact, plain DB aggregates** (independent of `totalsComputed`): `matchingCount`
 * (work lines), and the four *distinct-entry* counts below — `releasedCount`/`heldCount`/
 * `pendingCount`/`correctedEntryCount` are each a `PayrollEntry` count (via a `workLines: {
 * some: ... }` relation filter mirroring the row-level `where`), not a raw matching-work-line
 * count, so an entry with 2 OT-matching work lines is never double-counted as 2 released entries.
 * Approved decision (Totals section) narrows the status breakdown to exactly 3 of the 5 canonical
 * `rowStatus` states — `NO_PAY_DUE`/`RECOVERY_DUE` entries are still included in `matchingCount`
 * and remain fully reachable via the `rowStatus` row filter (all 5 values), but are not broken out
 * as their own totals bucket in V1; the three counts therefore do not necessarily sum to
 * `matchingCount`.
 *
 * **Bounded** (only when `matchingCount` is within `OVERTIME_REPORT_EXPORT_MAX_ROWS`; beyond it,
 * `null` with `totalsComputed: false`, visible and honest, never a silently wrong or partial
 * number): `employeesWithOvertimeCount`/`sitesWithOvertimeCount`/`unitsWithOvertimeCount` (each
 * counted among the `otHours > 0` subset of matching rows — since this report is always exactly one
 * cycle, `PayrollEntry`'s own `@@unique([cycleId, employeeId])` makes "distinct employees" and
 * "distinct entries" the same count, so `employeesWithOvertimeCount` is a plain distinct-entry
 * count, no separate `employeeId` grouping needed), `totalOtHours` (`SUM(otHours)` — a plain stored
 * column, but deliberately gated together with `totalOtEarnings` rather than split out as an
 * always-available SQL aggregate, per Deduction Report's own explicit "one unified bounded
 * strategy, not a second SQL financial formula" precedent), and `totalOtEarnings` (canonical
 * `calcNet`-derived, summed via `sumMoney`).
 *
 * "Average OT Rate" is deliberately NOT implemented (frozen decision — a naive average would not be
 * hours-weighted and could misrepresent true blended OT cost; deferred pending a future, explicitly
 * hours-weighted design).
 */
export interface OvertimeReportTotals {
  matchingCount: number;
  employeesWithOvertimeCount: number | null;
  totalOtHours: string | null;
  totalOtEarnings: string | null;
  sitesWithOvertimeCount: number | null;
  unitsWithOvertimeCount: number | null;
  releasedCount: number;
  heldCount: number;
  pendingCount: number;
  correctedEntryCount: number;
  /** `false` exactly when `matchingCount > OVERTIME_REPORT_EXPORT_MAX_ROWS` — narrow the filters to
   * get exact figures. Never partially computed. */
  totalsComputed: boolean;
}

export interface OvertimeReportListResponse {
  cycle: OvertimeReportCycleRef;
  page: number;
  pageSize: number;
  /** Total matching rows in the complete filtered/authorized scope — the pagination unit here is
   * `PayrollEntryWorkLine` itself (frozen report grain — see file header). */
  total: number;
  rows: OvertimeReportRow[];
  totals: OvertimeReportTotals;
  generatedAt: string;
}

export interface OvertimeReportExportLimitError {
  code: 'EXPORT_ROW_LIMIT_EXCEEDED';
  matchingCount: number;
  maxRows: number;
  message: string;
}
