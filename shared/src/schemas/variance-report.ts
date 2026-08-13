import { z } from 'zod';

/**
 * Phase 7 Reports, Variance / Month-on-Month Report Checkpoint 1A (approved Checkpoint 0
 * architecture review). Shared Zod validation + response contracts for this report, following the
 * same shared-schema-validation convention every sibling report already established
 * (`shared/src/schemas/deduction-report.ts`, `.../employee-payroll-history.ts`) rather than
 * hand-parsing `req.query`.
 *
 * **Business purpose (frozen — Checkpoint 0 §3):** an employee-level comparison of Net Salary
 * between exactly two explicit Payroll Cycles ("Current Cycle" and "Comparison Cycle"), augmented
 * with population classification (New/Departed/Continued) and transfer/context flags. NOT a
 * replacement for Employee Payroll History, not a detailed correction ledger, not a
 * deduction-component report, not a Payroll Summary site aggregate, not a release reconciliation
 * report.
 *
 * **Report grain (frozen — Checkpoint 0 §7):** exactly one row per Employee, paired by
 * `PayrollEntry.employeeId` across the two cycles — never per `PayrollEntryWorkLine`, never
 * matched by name/code/site/unit. `PayrollEntry`'s own `@@unique([cycleId, employeeId])`
 * constraint is what makes this pairing unambiguous: at most one entry per employee per cycle on
 * either side.
 *
 * **Cycle model (frozen — Checkpoint 0 §5/§6):** two explicit, independently-choosable Cycle IDs.
 * The API itself never infers "previous month" — a smart default (immediately-preceding cycle) is
 * a frontend/Checkpoint-1B concern layered on top of this always-explicit contract, never baked
 * into this schema or the backend service.
 *
 * **Permission (frozen):** `reports:view` only — no `statements:view`, no OR gate.
 *
 * **Filters (frozen — the complete, closed V1 set; nothing else is approved):** Current Cycle
 * (required), Comparison Cycle (required), Site (multi-select, matches a row when *either*
 * existing side belongs to a selected Site — Checkpoint 1A §12), Unit (single-Site-scoped,
 * matches when *either* existing side's entry has a work line at that Unit), Employee (exact
 * `employeeId`, resolved via the existing employee-search lookup, never a new org-wide directory
 * endpoint), Direction (Increased/Decreased/Unchanged — Continued rows only), Has Correction
 * (tri-state, matching either side).
 */

// --- Population / direction -------------------------------------------------------------------

/** Mutually exclusive (frozen — Checkpoint 1A §5). Derived purely from `PayrollEntry` row
 * presence/absence on each side — never from `Employee.dateOfLeaving`. */
export const VARIANCE_REPORT_POPULATION_STATUS_VALUES = ['NEW', 'DEPARTED', 'CONTINUED'] as const;
export type VarianceReportPopulationStatus = (typeof VARIANCE_REPORT_POPULATION_STATUS_VALUES)[number];

export const varianceReportPopulationStatusSchema = z.enum(VARIANCE_REPORT_POPULATION_STATUS_VALUES);

/** Applies only to `CONTINUED` rows (frozen — Checkpoint 1A §6). `null` on every `NEW`/`DEPARTED`
 * row — a population change is never represented as a 0-to-salary or salary-to-0 "variance." */
export const VARIANCE_REPORT_DIRECTION_VALUES = ['INCREASED', 'DECREASED', 'UNCHANGED'] as const;
export type VarianceReportDirection = (typeof VARIANCE_REPORT_DIRECTION_VALUES)[number];

export const varianceReportDirectionSchema = z.enum(VARIANCE_REPORT_DIRECTION_VALUES);

// --- Sorting -------------------------------------------------------------------------------------

/**
 * Structural fields — deterministic in-memory sort over the already fully-materialized, paired
 * candidate set (see the service's own top-of-module doc comment for why this report cannot push
 * `ORDER BY` into a single SQL query the way every sibling report does: the row set itself is an
 * application-computed pairing across two independent cycle-scoped queries, not one queryable
 * relation). Cheap and safe at any matching count — never gated by
 * `VARIANCE_REPORT_EXPORT_MAX_ROWS`.
 */
export const VARIANCE_REPORT_STRUCTURAL_SORT_FIELDS = [
  'employeeCode',
  'employeeName',
  'comparisonSite',
  'currentSite',
  'populationStatus',
] as const;

/**
 * `calcNet`-derived fields (frozen — Checkpoint 1A §18) — `comparisonNet`/`currentNet` are not
 * stored columns and `varianceAmount` is a derived difference of two such values, so none of the
 * three can be expressed as a plain comparison the way the structural fields above can. Sorting by
 * one of these three is rejected with a 400 once the matching (paired, filtered, authorized) row
 * count exceeds `VARIANCE_REPORT_EXPORT_MAX_ROWS` — the same disclosed, tested bounded-sort
 * exception Employee Payroll History's/Project Site Payroll Report's own `netSalary` sort already
 * established, applied here to two `calcNet` calls instead of one.
 */
export const VARIANCE_REPORT_BOUNDED_SORT_FIELDS = ['comparisonNet', 'currentNet', 'varianceAmount'] as const;

export const VARIANCE_REPORT_SORT_FIELDS = [
  ...VARIANCE_REPORT_STRUCTURAL_SORT_FIELDS,
  ...VARIANCE_REPORT_BOUNDED_SORT_FIELDS,
] as const;

export type VarianceReportSortField = (typeof VARIANCE_REPORT_SORT_FIELDS)[number];

export const VARIANCE_REPORT_SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type VarianceReportSortDirection = (typeof VARIANCE_REPORT_SORT_DIRECTIONS)[number];

export const VARIANCE_REPORT_DEFAULT_PAGE_SIZE = 25;
export const VARIANCE_REPORT_MAX_PAGE_SIZE = 100;

/**
 * The same 20,000-row ceiling every sibling report already established, reused rather than
 * inventing a second bound. Gates: (1) the aggregate monetary totals
 * (`comparisonTotalNet`/`currentTotalNet`/`aggregateVarianceAmount`/`aggregateVariancePercent`) —
 * `null` + `totalsComputed: false` beyond it; (2) a `calcNet`-derived sort field (above); (3) the
 * export endpoint. Population/direction/transfer/correction *counts* are **not** gated by this
 * ceiling (see the service's own totals doc comment for why: this report's own pairing already
 * requires materializing every accessible candidate row on both sides regardless of scale, so
 * those counts are an incidental, already-available byproduct of that unavoidable pass — unlike
 * every sibling report's own plain, independent single-table `WHERE`-based status counts).
 */
export const VARIANCE_REPORT_EXPORT_MAX_ROWS = 20_000;

const uuid = () => z.string().uuid();

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
  return raw;
}, z.boolean().optional());

const pageQueryParam = z.preprocess(
  (raw) => (raw === undefined || raw === '' ? undefined : Number(raw)),
  z.number().int().min(1).optional().default(1),
);

const pageSizeQueryParam = z.preprocess(
  (raw) => (raw === undefined || raw === '' ? undefined : Number(raw)),
  z.number().int().min(1).max(VARIANCE_REPORT_MAX_PAGE_SIZE).optional().default(VARIANCE_REPORT_DEFAULT_PAGE_SIZE),
);

/**
 * The approved, closed V1 filter set (frozen — Checkpoint 1A §12). Deliberately excludes minimum
 * absolute variance, release date, roster status, payment method, Released By, correction reason,
 * and any arbitrary date range — none of those are part of the approved architecture. Also
 * deliberately excludes a `populationStatus` filter: Checkpoint 1A's own approved filter list (§12)
 * names exactly seven filters and `populationStatus` is not one of them — every row already carries
 * its own `populationStatus` field, so a frontend can filter client-side on the returned page
 * without a server-side filter param; adding one server-side was not requested and would be an
 * unapproved contract addition.
 */
const varianceReportFilterFields = {
  currentCycleId: uuid(),
  comparisonCycleId: uuid(),
  siteIds: uuidListQueryParam,
  unitId: uuidQueryParam,
  employeeId: uuidQueryParam,
  direction: z.preprocess((raw) => (raw === '' ? undefined : raw), varianceReportDirectionSchema.optional()),
  hasCorrection: booleanQueryParam,
};

const sortByField = z.preprocess(
  (raw) => (raw === '' || raw === undefined ? undefined : raw),
  z.enum(VARIANCE_REPORT_SORT_FIELDS).optional().default('employeeName'),
);
const sortDirField = z.preprocess(
  (raw) => (raw === '' || raw === undefined ? undefined : raw),
  z.enum(VARIANCE_REPORT_SORT_DIRECTIONS).optional().default('asc'),
);

export const varianceReportListQuerySchema = z.object({
  ...varianceReportFilterFields,
  page: pageQueryParam,
  pageSize: pageSizeQueryParam,
  sortBy: sortByField,
  sortDir: sortDirField,
});

export type VarianceReportListQuery = z.infer<typeof varianceReportListQuerySchema>;

export const VARIANCE_REPORT_EXPORT_FORMATS = ['csv', 'xlsx'] as const;
export type VarianceReportExportFormat = (typeof VARIANCE_REPORT_EXPORT_FORMATS)[number];

export const varianceReportExportQuerySchema = z.object({
  ...varianceReportFilterFields,
  sortBy: sortByField,
  sortDir: sortDirField,
  format: z.enum(VARIANCE_REPORT_EXPORT_FORMATS),
});

export type VarianceReportExportQuery = z.infer<typeof varianceReportExportQuerySchema>;

/** Reuses the identical historical-payroll employee-lookup contract shape every sibling report's
 * own `.../employees` discovery endpoint already uses (`searchEmployeesByHistoricalPayroll`) —
 * never a new org-wide employee directory. */
export const varianceReportEmployeeLookupQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  siteId: uuidQueryParam,
  unitId: uuidQueryParam,
  page: pageQueryParam,
  pageSize: z.preprocess((raw) => (raw === undefined || raw === '' ? undefined : Number(raw)), z.number().int().min(1).max(200).optional()),
});

export type VarianceReportEmployeeLookupQuery = z.infer<typeof varianceReportEmployeeLookupQuerySchema>;

export interface VarianceReportEmployeeCandidate {
  employeeId: string;
  employeeCode: string | null;
  cnic: string | null;
  name: string;
  currentSiteId: string;
  currentSiteName: string;
}

export interface VarianceReportEmployeeSearchResponse {
  total: number;
  page: number;
  pageSize: number;
  employees: VarianceReportEmployeeCandidate[];
}

// --- Response contracts ---------------------------------------------------------------------

export interface VarianceReportCycleRef {
  id: string;
  year: number;
  month: number;
  status: 'DRAFT' | 'RELEASED' | 'ARCHIVED';
}

export interface VarianceReportUnitRef {
  id: string;
  name: string;
  code: string | null;
}

/**
 * One employee-level comparison row (frozen — Checkpoint 1A §4/§5/§6/§7/§8/§9). Financial fields
 * come from canonical `calcNet` over each side's own stored `PayrollEntry` columns — never a
 * corrected/replayed value, never Salary Release payout, Bank Sheet/Cash Receiving, or
 * `BalanceAdjustment.remainingAmount` (Checkpoint 1A §7). No CNIC, no banking, no correction
 * reasons/actors — corrections are exposed as existence-only flags (Checkpoint 1A §8).
 */
export interface VarianceReportRow {
  employeeId: string;
  employeeCode: string | null;
  employeeName: string;
  populationStatus: VarianceReportPopulationStatus;
  /** `null` for `NEW`/`DEPARTED` rows — a population change, never a salary change (Checkpoint 1A
   * §6). */
  direction: VarianceReportDirection | null;
  comparisonPayrollEntryId: string | null;
  currentPayrollEntryId: string | null;
  comparisonSiteId: string | null;
  comparisonSiteName: string | null;
  currentSiteId: string | null;
  currentSiteName: string | null;
  /** `true` only for a `CONTINUED` row whose two sides' `siteId` differ — always `false` for
   * `NEW`/`DEPARTED` (nothing to compare). */
  siteTransfer: boolean;
  comparisonUnit: VarianceReportUnitRef | null;
  currentUnit: VarianceReportUnitRef | null;
  /** `true` only for a `CONTINUED` row whose two sides' primary Unit (lowest `sortOrder`, `id`
   * tie-break) differ — always `false` for `NEW`/`DEPARTED`. Display/filter only — never a
   * per-Unit financial allocation (Checkpoint 1A §9/§13). */
  unitChange: boolean;
  /** `calcNet(comparisonEntry).netSalary`, or `null` if no comparison-side entry exists. */
  comparisonNet: string | null;
  /** `calcNet(currentEntry).netSalary`, or `null` if no current-side entry exists. */
  currentNet: string | null;
  /** `currentNet - comparisonNet`, `CONTINUED` rows only; `null` otherwise (Checkpoint 1A §7). */
  varianceAmount: string | null;
  /** `null` when `comparisonNet` is `0` (never a divide-by-zero) or the row is not `CONTINUED`;
   * otherwise `(currentNet - comparisonNet) / comparisonNet * 100` (Checkpoint 1A §7). */
  variancePercent: string | null;
  /** Existence-only — never replayed into `comparisonNet`/`currentNet` (Checkpoint 1A §8). `false`
   * when that side has no entry at all. */
  hasComparisonCorrection: boolean;
  hasCurrentCorrection: boolean;
}

/**
 * Computed over the complete filtered/authorized/paired dataset, never just the current page
 * (Checkpoint 1A §20/§21). Population/direction/transfer/correction counts are always exact,
 * regardless of `matchingCount` — see `VARIANCE_REPORT_EXPORT_MAX_ROWS`'s own doc comment for why
 * that's sound here (unlike a sibling report's plain independent status counts). Monetary totals
 * are `null` with `totalsComputed: false` once `matchingCount` exceeds the ceiling.
 *
 * **`aggregateVarianceAmount`/`aggregateVariancePercent` are computed from the aggregate totals
 * themselves (`currentTotalNet - comparisonTotalNet`, then that difference over
 * `comparisonTotalNet`) — never by summing or averaging individual rows'
 * `varianceAmount`/`variancePercent` (Checkpoint 1A §20).** This aggregate deliberately *does*
 * include the net effect of New/Departed employees (their one-sided salary contributes to
 * `currentTotalNet`/`comparisonTotalNet` respectively, even though their own row has no row-level
 * `varianceAmount`) — "how did total payroll change" is a genuinely different question from "how
 * did each continuing employee's own salary change," and this total answers the former.
 */
export interface VarianceReportTotals {
  matchingCount: number;
  newEmployeeCount: number;
  departedEmployeeCount: number;
  continuedEmployeeCount: number;
  /** `CONTINUED` rows only; three-way split, always sums to `continuedEmployeeCount`. */
  increasedCount: number;
  decreasedCount: number;
  unchangedCount: number;
  /** Count of rows (any population status) with `siteTransfer: true` — always `0` outside
   * `CONTINUED` rows since the flag itself is. */
  siteTransferCount: number;
  /** Count of rows with `hasComparisonCorrection || hasCurrentCorrection`. */
  correctedEntryCount: number;
  /** Sum of every row's `comparisonNet` (where a comparison-side entry exists) — includes `NEW`
   * rows' `0` contribution implicitly (they contribute nothing, since they have no comparison-side
   * entry to sum) and every `DEPARTED`/`CONTINUED` row's real comparison-side net. */
  comparisonTotalNet: string | null;
  /** Sum of every row's `currentNet` (where a current-side entry exists). */
  currentTotalNet: string | null;
  aggregateVarianceAmount: string | null;
  /** `null` when `comparisonTotalNet` is `0`. */
  aggregateVariancePercent: string | null;
  /** `false` exactly when `matchingCount > VARIANCE_REPORT_EXPORT_MAX_ROWS` — narrow the filters
   * to get exact monetary totals. Never partially computed. */
  totalsComputed: boolean;
}

export interface VarianceReportListResponse {
  currentCycle: VarianceReportCycleRef;
  comparisonCycle: VarianceReportCycleRef;
  page: number;
  pageSize: number;
  /** Total matching rows in the complete filtered/authorized/paired scope — the pagination unit
   * here is one Employee (report grain, Checkpoint 1A §4). */
  total: number;
  rows: VarianceReportRow[];
  totals: VarianceReportTotals;
  generatedAt: string;
}

export interface VarianceReportExportLimitError {
  code: 'EXPORT_ROW_LIMIT_EXCEEDED';
  matchingCount: number;
  maxRows: number;
  message: string;
}
