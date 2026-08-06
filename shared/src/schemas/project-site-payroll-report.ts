import { z } from 'zod';

/**
 * Phase 7 Reports, Project Site Payroll Report Checkpoint 1A (approved Checkpoint 0 architecture
 * review, 2026-08-06). Shared Zod validation + response contracts for this report, following the
 * same shared-schema-validation convention Employee Payroll History established
 * (`shared/src/schemas/employee-payroll-history.ts`) rather than hand-parsing `req.query`.
 *
 * **Report scope (frozen decision 1):** "Which employees were paid at the selected Project
 * Site(s) during one payroll cycle?" One row = one `PayrollEntry`. This is deliberately NOT a
 * cross-cycle report — `cycleId` is required, exactly one cycle, no `fromCycleId`/`toCycleId`
 * range, no historical browser. That distinction is what keeps this report's permission at
 * `reports:view` rather than Employee Payroll History's own `statements:view` — see
 * `docs/architecture/workflows/reports.md`'s Project Site Payroll Report section for the full
 * Checkpoint 0 reasoning.
 *
 * **Row status** reuses the exact same 5-state precedence-ordered concept Employee Payroll
 * History already established (`RELEASED > HELD > NO_PAY_DUE > RECOVERY_DUE > PENDING`), derived
 * server-side only. This file re-declares the union under this report's own name rather than
 * importing `EmployeePayrollHistoryRowStatus` — the two are structurally identical (same
 * `PayrollEntry.released`/`.hold`/`.payoutOutcome` state machine, not an Employee-History-specific
 * concept), but keeping each report's own public DTO independently named avoids a confusing
 * cross-report type import in either module's public contract. The backend service still calls
 * Employee Payroll History's own `deriveEmployeePayrollHistoryRowStatus`/
 * `employeePayrollHistoryRowStatusWhereClause` directly (structurally assignable, identical
 * values) rather than re-implementing that derivation logic a second time — see
 * `backend/src/modules/reports/project-site-payroll.service.ts`'s own doc comment. Per this
 * project's own "extract generic code only at the third consumer" convention, this is the second
 * consumer of that derivation logic — not yet a hard extraction to a `common/`-scoped module.
 */

export const PROJECT_SITE_PAYROLL_REPORT_ROW_STATUS_VALUES = [
  'RELEASED',
  'HELD',
  'NO_PAY_DUE',
  'RECOVERY_DUE',
  'PENDING',
] as const;

export type ProjectSitePayrollReportRowStatus = (typeof PROJECT_SITE_PAYROLL_REPORT_ROW_STATUS_VALUES)[number];

export const projectSitePayrollReportRowStatusSchema = z.enum(PROJECT_SITE_PAYROLL_REPORT_ROW_STATUS_VALUES);

/** Deliberately excludes `cycle` (Employee Payroll History's own default sort) — this report is
 * always exactly one cycle, so sorting by it would be a no-op. `netSalary` is not a stored column
 * (see `PROJECT_SITE_PAYROLL_REPORT_EXPORT_MAX_ROWS` below) — every one of these five appends a
 * deterministic `PayrollEntry.id ASC` tie-break server-side, mirroring Employee Payroll History's
 * own discipline. */
export const PROJECT_SITE_PAYROLL_REPORT_SORT_FIELDS = ['employeeCode', 'employeeName', 'site', 'netSalary', 'rowStatus'] as const;

export type ProjectSitePayrollReportSortField = (typeof PROJECT_SITE_PAYROLL_REPORT_SORT_FIELDS)[number];

export const PROJECT_SITE_PAYROLL_REPORT_SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type ProjectSitePayrollReportSortDirection = (typeof PROJECT_SITE_PAYROLL_REPORT_SORT_DIRECTIONS)[number];

export const PROJECT_SITE_PAYROLL_REPORT_DEFAULT_PAGE_SIZE = 25;
export const PROJECT_SITE_PAYROLL_REPORT_MAX_PAGE_SIZE = 100;

/**
 * Reuses the exact same bound and reasoning Employee Payroll History's own
 * `EMPLOYEE_PAYROLL_HISTORY_EXPORT_MAX_ROWS` already established (`netSalary` is a `calcNet()`
 * result, never a stored column, so it cannot be summed/sorted at the SQL level without an
 * independent, drift-prone second formula) — independently named rather than imported, per this
 * project's own "extract at the third consumer" convention (this is only the second report to
 * need this exact ceiling). Applied identically to both the export row count *and* totals
 * computation *and* `sortBy=netSalary` (see the backend service) — unlike Payroll Summary, whose
 * own aggregation grain (Project Sites, dozens) never needed a ceiling at all, this report's
 * aggregation grain (employees within one cycle) is the same order of magnitude as Employee
 * Payroll History's, so it inherits EPH's guarded-computation safety net even though it otherwise
 * reuses Payroll Summary's totals *field/bucket* model (frozen decision 6).
 */
export const PROJECT_SITE_PAYROLL_REPORT_EXPORT_MAX_ROWS = 20_000;

const uuid = () => z.string().uuid();

/** Mirrors `employee-payroll-history.ts`'s own `uuidListQueryParam` exactly (single string,
 * comma-separated string, or repeated-key array; deduplicated; `undefined` if empty). */
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
  z.number().int().min(1).max(PROJECT_SITE_PAYROLL_REPORT_MAX_PAGE_SIZE).optional().default(PROJECT_SITE_PAYROLL_REPORT_DEFAULT_PAGE_SIZE),
);

/**
 * The approved filter set only (frozen decisions — Filters section): Payroll Cycle (required,
 * single), Site (multi-select), Unit, Row Status, Has Correction. Deliberately excludes Employee
 * search, Designation, any date/month range, current roster status, and an outstanding-balance
 * filter — all explicitly out of scope for this checkpoint.
 */
const projectSitePayrollReportFilterFields = {
  cycleId: uuid(),
  siteIds: uuidListQueryParam,
  unitId: uuidQueryParam,
  rowStatus: z.preprocess((raw) => (raw === '' ? undefined : raw), projectSitePayrollReportRowStatusSchema.optional()),
  hasCorrection: booleanQueryParam,
};

const sortByField = z.preprocess(
  (raw) => (raw === '' || raw === undefined ? undefined : raw),
  z.enum(PROJECT_SITE_PAYROLL_REPORT_SORT_FIELDS).optional().default('employeeName'),
);
const sortDirField = z.preprocess(
  (raw) => (raw === '' || raw === undefined ? undefined : raw),
  z.enum(PROJECT_SITE_PAYROLL_REPORT_SORT_DIRECTIONS).optional().default('asc'),
);

export const projectSitePayrollReportListQuerySchema = z.object({
  ...projectSitePayrollReportFilterFields,
  page: pageQueryParam,
  pageSize: pageSizeQueryParam,
  sortBy: sortByField,
  sortDir: sortDirField,
});

export type ProjectSitePayrollReportListQuery = z.infer<typeof projectSitePayrollReportListQuerySchema>;

export const PROJECT_SITE_PAYROLL_REPORT_EXPORT_FORMATS = ['csv', 'xlsx'] as const;
export type ProjectSitePayrollReportExportFormat = (typeof PROJECT_SITE_PAYROLL_REPORT_EXPORT_FORMATS)[number];

/** Same filters/sorting as the list query, no pagination — an export is always every matching row
 * (up to `PROJECT_SITE_PAYROLL_REPORT_EXPORT_MAX_ROWS`), never just one page. */
export const projectSitePayrollReportExportQuerySchema = z.object({
  ...projectSitePayrollReportFilterFields,
  sortBy: sortByField,
  sortDir: sortDirField,
  format: z.enum(PROJECT_SITE_PAYROLL_REPORT_EXPORT_FORMATS),
});

export type ProjectSitePayrollReportExportQuery = z.infer<typeof projectSitePayrollReportExportQuerySchema>;

// --- Response contracts ---------------------------------------------------------------------

export interface ProjectSitePayrollReportCycleRef {
  id: string;
  year: number;
  month: number;
  status: 'DRAFT' | 'RELEASED' | 'ARCHIVED';
}

export interface ProjectSitePayrollReportUnitRef {
  id: string;
  name: string;
  code: string | null;
}

/**
 * One list row — always the *original*, as-released figures (frozen decision 6, mirroring
 * Employee Payroll History's own approved decision 7). Never a corrected/replayed Net Salary.
 * `correctionBalancePayable`/`correctionBalanceRecovery` are this cycle's own already-materialized
 * settlement amounts (stored `PayrollEntry` columns, exactly as Payroll Summary already surfaces
 * them) — informational, separate fields, never netted into a second calculation.
 */
export interface ProjectSitePayrollReportRow {
  payrollEntryId: string;
  employeeId: string;
  /** Current `Employee.employeeCode` — no historical snapshot exists on `PayrollEntry`. */
  employeeCode: string | null;
  /** `PayrollEntry.employeeNameSnapshot ?? Employee.name` — the same established convention
   * Payslip/Employee Payroll History already use (`docs/architecture/workflows/reports.md §8`). */
  employeeName: string;
  /** Historical `PayrollEntry.siteId` — never the employee's current site. */
  siteId: string;
  siteName: string;
  /** The work line with the lowest `sortOrder`; `null` only if this entry's own required "never
   * zero lines" invariant were somehow violated (defensive typing, not an expected case). */
  primaryUnit: ProjectSitePayrollReportUnitRef | null;
  /** Count of this entry's *other* work lines beyond the primary one (frozen decision 5: display
   * only, "Primary Unit (+N more)" — never a per-Unit financial allocation). */
  additionalUnitCount: number;
  designation: string;
  grossPay: string;
  allowance: string;
  /** `calcNet()`'s own applied EOBI deduction — zero whenever `eobiApplicable` is false, never the
   * raw stored `eobiAmount` column regardless of applicability. */
  eobiDeduction: string;
  advanceDeduction: string;
  eidAdvanceDeduction: string;
  fine: string;
  /** Materialized settlement of a PAYABLE obligation originating elsewhere — informational only,
   * never a correction originating from this row. */
  correctionBalancePayable: string;
  /** Materialized settlement of a RECOVERY obligation originating elsewhere — informational only. */
  correctionBalanceRecovery: string;
  totalEarnings: string;
  totalDeductions: string;
  /** `calcNet()` over this entry's own stored columns — the immutable, as-released figure. */
  netSalary: string;
  rowStatus: ProjectSitePayrollReportRowStatus;
  /** Count of approved `Correction` rows whose `payrollEntryId` is this entry — batched across the
   * page in one query, never one query per row. */
  correctionCount: number;
  /** `PayrollEntry.releasedAt` only — no release-actor identity on this row (no detail endpoint
   * exists in V1 to drill into it, frozen decision 4). */
  releasedAt: string | null;
}

/**
 * Reuses Payroll Summary's own totals *model* (frozen decision 6) — the same field set/grouping
 * `PayrollSummaryFigures` already established, renamed to match this report's own row-level column
 * vocabulary (`correctionBalancePayable`/`correctionBalanceRecovery` rather than Payroll Summary's
 * `balancePayableIncluded`/`recoveryDeducted`) — computed over the complete filtered dataset, never
 * the current page. Unlike Payroll Summary (whose aggregation grain, Project Sites, is always
 * small/bounded), this report's grain is employees within one cycle, the same order of magnitude
 * as Employee Payroll History — so `totalsComputed` inherits EPH's guarded-computation ceiling
 * (`PROJECT_SITE_PAYROLL_REPORT_EXPORT_MAX_ROWS`) rather than Payroll Summary's unconditional
 * computation. In practice, since this report is always scoped to one cycle, the ceiling is not
 * expected to bind at this system's current scale — see the Checkpoint 1A performance evidence.
 */
export interface ProjectSitePayrollReportTotals {
  matchingCount: number;
  releasedCount: number;
  heldCount: number;
  noPayDueCount: number;
  recoveryDueCount: number;
  pendingCount: number;
  /** Count of matching rows with at least one approved `Correction` — a plain DB count, always
   * computed regardless of `totalsComputed`. */
  correctedEntryCount: number;
  grossPay: string | null;
  allowance: string | null;
  eobiDeduction: string | null;
  advanceDeduction: string | null;
  eidAdvanceDeduction: string | null;
  fine: string | null;
  correctionBalancePayable: string | null;
  correctionBalanceRecovery: string | null;
  totalEarnings: string | null;
  totalDeductions: string | null;
  netSalaryTotal: string | null;
  /** `false` exactly when `matchingCount > PROJECT_SITE_PAYROLL_REPORT_EXPORT_MAX_ROWS` — narrow
   * the filters to get exact monetary totals. Never partially computed. */
  totalsComputed: boolean;
}

export interface ProjectSitePayrollReportListResponse {
  cycle: ProjectSitePayrollReportCycleRef;
  page: number;
  pageSize: number;
  /** Total matching rows in the complete filtered/authorized scope — the pagination unit here is
   * `PayrollEntry` itself (report grain, frozen decision 1). */
  total: number;
  rows: ProjectSitePayrollReportRow[];
  totals: ProjectSitePayrollReportTotals;
  generatedAt: string;
}

export interface ProjectSitePayrollReportExportLimitError {
  code: 'EXPORT_ROW_LIMIT_EXCEEDED';
  matchingCount: number;
  maxRows: number;
  message: string;
}
