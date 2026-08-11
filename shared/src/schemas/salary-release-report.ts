import { z } from 'zod';

/**
 * Phase 7 Reports, Salary Release Report Checkpoint 1A (approved Checkpoint 0 architecture review;
 * frozen decisions carried over verbatim from the authorizing instruction). Shared Zod validation +
 * response contracts for this report, following the same shared-schema-validation convention every
 * sibling report already established (`shared/src/schemas/project-site-payroll-report.ts`,
 * `.../deduction-report.ts`) rather than hand-parsing `req.query`.
 *
 * **Business purpose (frozen):** a single-cycle operational release-reconciliation report — which
 * employees were released this Cycle, which remain Pending/Held, which resolved No Pay Due/Recovery
 * Due, what the original released amount was, and which rows carry correction/balance-salary
 * context. Deliberately NOT a cross-cycle employee release history (Employee Payroll History's own
 * job), not a full audit report, not a Corrections ledger, not a Statements replacement, and not a
 * payment-channel analytics report.
 *
 * **Report grain (frozen):** one row = one `PayrollEntry`. `PayrollUnitRelease` is implementation/
 * audit context for the release workflow — never this report's own list grain.
 *
 * **Cycle scope (frozen):** `cycleId` is required and singular — no `fromCycleId`/`toCycleId` range,
 * no cross-cycle browsing, mirroring Project Site Payroll Report's/Deduction Report's/Overtime
 * Report's own "one cycle at a time" shape.
 *
 * **Permission (frozen) — the first Reports-module report approved for an OR permission gate:**
 * `reports:view` OR `payroll:view` (`requirePermission([PERMISSIONS.REPORTS_VIEW,
 * PERMISSIONS.PAYROLL_VIEW])`, the same any-of pattern `payroll-entry.routes.ts`'s own
 * `VIEW_PERMISSIONS` already established). Finance holds `payroll:view`/`payroll:release` but not
 * `reports:view`; Payroll Staff holds `reports:view` but not `payroll:view`. Gating on `reports:view`
 * alone would exclude Finance — the role that actually executes releases — from a report whose whole
 * subject is release reconciliation. `payroll:release` by itself does NOT imply access; only
 * `payroll:view` (which Finance's role grant also carries) does.
 *
 * **Row status** reuses the exact same 5-state precedence-ordered concept every other row-level
 * report in this module already established (`RELEASED > HELD > NO_PAY_DUE > RECOVERY_DUE >
 * PENDING`), derived server-side only via the shared `backend/src/modules/reports/
 * payroll-entry-row-status.ts`. This file re-declares the union under this report's own name rather
 * than importing a sibling report's own type — the same "no confusing cross-report type reference in
 * a public DTO" convention every sibling report's own row-status union already follows.
 *
 * **Released actor (frozen):** Released At is included; Released By is deliberately EXCLUDED from
 * this report's list/export/print in V1 — `PayrollEntry.releasedBy` may represent whichever Unit-
 * release action happened to complete the final touched Unit for a multi-Unit entry, not a
 * semantically reliable "person who released this employee's salary." No email, user id, or audit
 * actor of any kind is ever exposed by this report.
 *
 * **Payment method / channel (frozen):** deliberately excluded from V1. The schema stores no
 * canonical release/payment channel — `bankId IS NULL` is an inference about banking configuration,
 * not authoritative release metadata, and is not presented as one here.
 *
 * **Original Released Amount (frozen, financial-correctness-critical):** `calcNet` applied to a
 * `RELEASED` entry's own immutable stored columns — proven immutable after release (no correction/
 * materialization write path can ever touch a released entry's own calc-input columns; see
 * `salary-release-report.service.ts`'s own doc comment for the full trace). For a non-`RELEASED`
 * row, `originalReleasedAmount` is `null` — never a pending calculated net salary mislabeled as an
 * amount that was released.
 */

export const SALARY_RELEASE_REPORT_ROW_STATUS_VALUES = ['RELEASED', 'HELD', 'NO_PAY_DUE', 'RECOVERY_DUE', 'PENDING'] as const;

export type SalaryReleaseReportRowStatus = (typeof SALARY_RELEASE_REPORT_ROW_STATUS_VALUES)[number];

export const salaryReleaseReportRowStatusSchema = z.enum(SALARY_RELEASE_REPORT_ROW_STATUS_VALUES);

/**
 * DB-native sorting only in V1 (frozen decision — Sorting section): `employeeCode`/`employeeName`/
 * `site`/`rowStatus` mirror every sibling report's own approved fields; `releasedAt` is a genuine,
 * plain stored `PayrollEntry` column (unlike every sibling report's own excluded `netSalary`), so it
 * is DB-native here with no bounded in-memory sort exception needed. `originalReleasedAmount`/
 * `correctionBalancePayable`/`correctionBalanceRecovery` are deliberately NOT sortable — the first is
 * a `calcNet` result gated to `RELEASED` rows only (not a plain, universally-orderable column), and a
 * bounded in-memory sort exception is not introduced absent real usage proving the need (mirroring
 * Deduction Report's/Overtime Report's own demonstrated restraint). Every one of these appends a
 * deterministic `PayrollEntry.id ASC` tie-break server-side.
 */
export const SALARY_RELEASE_REPORT_SORT_FIELDS = ['employeeCode', 'employeeName', 'site', 'rowStatus', 'releasedAt'] as const;

export type SalaryReleaseReportSortField = (typeof SALARY_RELEASE_REPORT_SORT_FIELDS)[number];

export const SALARY_RELEASE_REPORT_SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type SalaryReleaseReportSortDirection = (typeof SALARY_RELEASE_REPORT_SORT_DIRECTIONS)[number];

export const SALARY_RELEASE_REPORT_DEFAULT_PAGE_SIZE = 25;
export const SALARY_RELEASE_REPORT_MAX_PAGE_SIZE = 100;

/**
 * Reuses the exact same bound and reasoning every sibling report's own export ceiling already
 * established — `originalReleasedAmount`/`pendingReleaseAmount` are `calcNet` results, never stored
 * columns, so they cannot be summed at the SQL level without an independent, drift-prone second
 * formula; totals are computed via the same bounded fetch-and-sum-via-`calcNet`/`sumMoney` strategy
 * every sibling report already uses. Independently named rather than imported, per this project's own
 * "extract at the third consumer" convention (already applied to this exact ceiling value four times
 * before).
 */
export const SALARY_RELEASE_REPORT_EXPORT_MAX_ROWS = 20_000;

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

/** The established tri-state boolean query-parsing convention (`design-system.md` §2.4: All/Yes/No —
 * `undefined` sent for "All," never a false-equivalent value) — identical to every sibling report's
 * own `booleanQueryParam`, reused verbatim for `hasCorrection`. */
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
  z.number().int().min(1).max(SALARY_RELEASE_REPORT_MAX_PAGE_SIZE).optional().default(SALARY_RELEASE_REPORT_DEFAULT_PAGE_SIZE),
);

/**
 * The approved filter set only (frozen decision — Approved Filters section): Payroll Cycle
 * (required, single), Site (multi-select), Unit (existing single-Site convention), Row Status, Has
 * Correction. Deliberately excludes Employee search, Designation, release-date range, Released By,
 * payment method, a separate Released/Held toggle (Row Status already covers the release-state
 * question), and Current Roster Status.
 */
const salaryReleaseReportFilterFields = {
  cycleId: uuid(),
  siteIds: uuidListQueryParam,
  unitId: uuidQueryParam,
  rowStatus: z.preprocess((raw) => (raw === '' ? undefined : raw), salaryReleaseReportRowStatusSchema.optional()),
  hasCorrection: booleanQueryParam,
};

const sortByField = z.preprocess(
  (raw) => (raw === '' || raw === undefined ? undefined : raw),
  z.enum(SALARY_RELEASE_REPORT_SORT_FIELDS).optional().default('employeeName'),
);
const sortDirField = z.preprocess(
  (raw) => (raw === '' || raw === undefined ? undefined : raw),
  z.enum(SALARY_RELEASE_REPORT_SORT_DIRECTIONS).optional().default('asc'),
);

export const salaryReleaseReportListQuerySchema = z.object({
  ...salaryReleaseReportFilterFields,
  page: pageQueryParam,
  pageSize: pageSizeQueryParam,
  sortBy: sortByField,
  sortDir: sortDirField,
});

export type SalaryReleaseReportListQuery = z.infer<typeof salaryReleaseReportListQuerySchema>;

export const SALARY_RELEASE_REPORT_EXPORT_FORMATS = ['csv', 'xlsx'] as const;
export type SalaryReleaseReportExportFormat = (typeof SALARY_RELEASE_REPORT_EXPORT_FORMATS)[number];

/** Same filters/sorting as the list query, no pagination — an export is always every matching row
 * (up to `SALARY_RELEASE_REPORT_EXPORT_MAX_ROWS`), never just one page. */
export const salaryReleaseReportExportQuerySchema = z.object({
  ...salaryReleaseReportFilterFields,
  sortBy: sortByField,
  sortDir: sortDirField,
  format: z.enum(SALARY_RELEASE_REPORT_EXPORT_FORMATS),
});

export type SalaryReleaseReportExportQuery = z.infer<typeof salaryReleaseReportExportQuerySchema>;

// --- Response contracts ---------------------------------------------------------------------

export interface SalaryReleaseReportCycleRef {
  id: string;
  year: number;
  month: number;
  status: 'DRAFT' | 'RELEASED' | 'ARCHIVED';
}

export interface SalaryReleaseReportUnitRef {
  id: string;
  name: string;
  code: string | null;
}

/**
 * One list row (frozen decision — Approved List Row/Columns section). No Released By, no CNIC, no
 * account number, no IBAN, no bank details, no Payment Method, no correction reason, no audit actor,
 * no live `BalanceAdjustment.remainingAmount`.
 */
export interface SalaryReleaseReportRow {
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
  primaryUnit: SalaryReleaseReportUnitRef | null;
  /** Count of this entry's *other* work lines beyond the primary one — display only ("Primary Unit
   * (+N more)"), never a per-Unit financial allocation or release-event grain. */
  additionalUnitCount: number;
  designation: string;
  rowStatus: SalaryReleaseReportRowStatus;
  /**
   * `calcNet()`'s `netSalary` applied to this entry's own immutable stored columns, but only for a
   * `RELEASED` row — `null` for every other status. Never a pending calculated net salary mislabeled
   * as an amount that was released (frozen decision — Approved List Row/Columns section). Defensively
   * matches `netSalary > 0` (the same `bank-sheets.service.ts`/Payroll Summary guard against a
   * pre-existing legacy anomaly row) — a `RELEASED` row can only ever have a positive net salary by
   * construction, but this keeps the field's own honesty independent of that invariant holding.
   */
  originalReleasedAmount: string | null;
  /** This cycle's own already-materialized PAYABLE settlement — never the live, cross-cycle
   * `BalanceAdjustment.remainingAmount`. Separate context, never folded into `originalReleasedAmount`. */
  correctionBalancePayable: string;
  /** This cycle's own already-materialized RECOVERY settlement — never the live, cross-cycle
   * `BalanceAdjustment.remainingAmount`. Separate context, never folded into `originalReleasedAmount`. */
  correctionBalanceRecovery: string;
  /** `PayrollEntry.releasedAt` only — no release-actor identity anywhere on this row or report (no
   * detail endpoint exists in V1, frozen decision — No Detail Endpoint section). */
  releasedAt: string | null;
  /** Count of approved `Correction` rows whose `payrollEntryId` is this entry — batched across the
   * page in one query, never one query per row. */
  correctionCount: number;
}

/**
 * Computed over the complete filtered/authorized dataset, never the current page (frozen decision —
 * Totals section). The seven count fields are plain, always-exact DB aggregates, independent of
 * `totalsComputed`. `releasedAmount`/`pendingReleaseAmount`/`correctionBalancePayableTotal`/
 * `correctionBalanceRecoveryTotal` are computed via the same bounded fetch-and-`calcNet`/`sumMoney`
 * pass every sibling report's own monetary totals already use, only when `matchingCount` is within
 * `SALARY_RELEASE_REPORT_EXPORT_MAX_ROWS` — beyond it, `null` with `totalsComputed: false`, visible
 * and honest, never a silently wrong or partial number. `releasedAmount` sums only genuinely
 * `RELEASED` rows' net salary (`netSalary > 0` defensively filtered); `pendingReleaseAmount` sums only
 * genuinely `PENDING` rows' net salary — the two are never combined into one "Total Released" figure,
 * and neither ever includes a `NO_PAY_DUE`/`RECOVERY_DUE`/`HELD` row or a later balance-salary amount.
 */
export interface SalaryReleaseReportTotals {
  matchingCount: number;
  releasedCount: number;
  heldCount: number;
  noPayDueCount: number;
  recoveryDueCount: number;
  pendingCount: number;
  /** Count of matching rows with at least one approved `Correction` — a plain DB count, always
   * computed regardless of `totalsComputed`. */
  correctedEntryCount: number;
  /** Sum of `RELEASED` rows' own `netSalary` only — never `NO_PAY_DUE`/`RECOVERY_DUE`/`HELD`/
   * `PENDING`, and never a later balance-salary amount. */
  releasedAmount: string | null;
  /** Sum of genuinely `PENDING` rows' own positive payable `netSalary` only. */
  pendingReleaseAmount: string | null;
  correctionBalancePayableTotal: string | null;
  correctionBalanceRecoveryTotal: string | null;
  /** `false` exactly when `matchingCount > SALARY_RELEASE_REPORT_EXPORT_MAX_ROWS` — narrow the
   * filters to get exact monetary totals. Never partially computed. */
  totalsComputed: boolean;
}

export interface SalaryReleaseReportListResponse {
  cycle: SalaryReleaseReportCycleRef;
  page: number;
  pageSize: number;
  /** Total matching rows in the complete filtered/authorized scope — the pagination unit here is
   * `PayrollEntry` itself (report grain, frozen decision — Frozen Grain section). */
  total: number;
  rows: SalaryReleaseReportRow[];
  totals: SalaryReleaseReportTotals;
  generatedAt: string;
}

export interface SalaryReleaseReportExportLimitError {
  code: 'EXPORT_ROW_LIMIT_EXCEEDED';
  matchingCount: number;
  maxRows: number;
  message: string;
}
