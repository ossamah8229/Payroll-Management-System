import { z } from 'zod';

/**
 * Bulk Assignment-Mismatch Readiness Audit (2026-09-28 approved architecture review — see
 * `docs/PROJECT_PROGRESS.md`'s "Deferred work" note on Payroll Deputation Sync / PR #22 for the
 * roadmap origin). Shared Zod validation + response contracts, following the same
 * shared-schema-validation convention every sibling report already established
 * (`shared/src/schemas/variance-report.ts`, `.../overtime-report.ts`).
 *
 * **Business purpose (frozen — approved review):** a strictly read-only list of Draft
 * `PayrollEntry` rows whose payroll-period attribution (`PayrollEntry.siteId` /
 * `PayrollEntryWorkLine.unitId`) no longer matches the employee's *current* Employee Registry
 * assignment (`Employee.siteId`/`.unitId`) — so payroll staff can review each mismatch before
 * Salary Release and decide, case by case, whether it's an intentional payroll deputation or needs
 * reconciling via the existing "Apply current assignment" action. This report performs **no
 * mutation, no classification write, and no automatic synchronization** — it only ever reads.
 *
 * **Report grain (frozen):** one row per Draft `PayrollEntry` that has at least one mismatch
 * (never a row per work line, never a row per employee across cycles) — every touched work line's
 * own comparison is nested inside that one row (`workLines`, below), since a split entry can have
 * some lines matching and others not (Checkpoint's own explicit regression requirement: a primary
 * line that matches must never hide a secondary line that doesn't).
 *
 * **Comparison predicate (frozen):** a Draft, unreleased, `payoutOutcome === null` PayrollEntry
 * mismatches when `PayrollEntry.siteId !== Employee.siteId` OR any of its work lines has
 * `unitId !== Employee.unitId`. Released entries, `payoutOutcome`-resolved entries, and any cycle
 * whose `status !== 'DRAFT'` are excluded outright — never shown, never implied to need a fix.
 * Held entries (`hold = true`) ARE included (Draft/editable either way — `hold` never changes
 * mutability, only release-sweep eligibility) and carry their own `held: true` flag so the UI can
 * mark them without confusing "worth reviewing" with "ready to release."
 *
 * **Reporting source of truth:** every row's own `payrollSiteId`/`workLines[].unitId` come from
 * `PayrollEntry`/`PayrollEntryWorkLine` — the sole authorization/reporting source
 * (`getAccessibleSiteIds`/`assertSiteAccess` are applied against `PayrollEntry.siteId`, never
 * `Employee.siteId`). `currentEmployeeSiteId`/`currentEmployeeUnitId` are comparison-context fields
 * only, read live from `Employee` — never substituted as the entry's own attribution anywhere.
 *
 * **Permission (approved):** `payroll:entry` OR `payroll:view` — the exact same `VIEW_PERMISSIONS`
 * gate `payroll-entry.routes.ts` already uses for the Payroll Entry grid itself (the same audience
 * that already sees this same mismatch as a per-row amber indicator there); not `reports:view`.
 *
 * **Filters (approved, closed set):** Cycle (required, Draft only — enforced server-side, not just
 * by the frontend's own cycle picker), Site (multi-select), Unit (single-Site-scoped), Shape
 * (single line / split), Held (tri-state), Safe-shape-only (one-click-Apply-eligible rows only —
 * informational filter, never a bulk-apply trigger).
 */

// --- Shape / eligibility ---------------------------------------------------------------------

export const ASSIGNMENT_MISMATCH_SHAPE_VALUES = ['SINGLE_LINE', 'SPLIT'] as const;
export type AssignmentMismatchShape = (typeof ASSIGNMENT_MISMATCH_SHAPE_VALUES)[number];

export const assignmentMismatchShapeSchema = z.enum(ASSIGNMENT_MISMATCH_SHAPE_VALUES);

// --- Sorting -------------------------------------------------------------------------------------

/**
 * Structural fields only — deterministic in-memory sort over the already fully-materialized,
 * per-cycle candidate set. This report's own mismatch predicate spans two relations
 * (`PayrollEntry`/`PayrollEntryWorkLine` vs. `Employee`) that cannot be expressed as a single
 * Prisma `WHERE`, so — mirroring Variance Report's own frozen precedent
 * (`variance-report.service.ts`'s own top-of-module doc comment) — the candidate set for one Draft
 * cycle is fetched once (bounded to that cycle, the same scale every sibling report's own
 * `listPayrollEntries`-style query already proves safe), the predicate evaluated in application
 * memory, and every filter/sort/paginate/totals step applied to that same materialized array.
 */
export const ASSIGNMENT_MISMATCH_READINESS_SORT_FIELDS = [
  'employeeCode',
  'employeeName',
  'payrollSite',
  'currentEmployeeSite',
] as const;

export type AssignmentMismatchReadinessSortField = (typeof ASSIGNMENT_MISMATCH_READINESS_SORT_FIELDS)[number];

export const ASSIGNMENT_MISMATCH_READINESS_SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type AssignmentMismatchReadinessSortDirection = (typeof ASSIGNMENT_MISMATCH_READINESS_SORT_DIRECTIONS)[number];

export const ASSIGNMENT_MISMATCH_READINESS_DEFAULT_PAGE_SIZE = 25;
export const ASSIGNMENT_MISMATCH_READINESS_MAX_PAGE_SIZE = 100;

/** Same ceiling convention every sibling report's own export endpoint already uses — gates the
 * export endpoint only (the on-screen list is always paginated regardless of this ceiling). The
 * underlying fetch is already bounded to one Draft cycle's own entries, so this is generous
 * headroom (Principle 10), not a load-bearing performance limit the way Variance Report's
 * two-cycle ceiling is. */
export const ASSIGNMENT_MISMATCH_READINESS_EXPORT_MAX_ROWS = 20_000;

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
  z.number().int().min(1).max(ASSIGNMENT_MISMATCH_READINESS_MAX_PAGE_SIZE).optional().default(ASSIGNMENT_MISMATCH_READINESS_DEFAULT_PAGE_SIZE),
);

/**
 * The approved, closed filter set. Deliberately excludes an Employee filter (not part of the
 * approved review — this is a bulk readiness list, not a per-employee lookup) and any financial
 * filter (this report carries no financial field at all — see `AssignmentMismatchReadinessRow`'s
 * own doc comment).
 */
const assignmentMismatchReadinessFilterFields = {
  cycleId: uuid(),
  siteIds: uuidListQueryParam,
  unitId: uuidQueryParam,
  shape: z.preprocess((raw) => (raw === '' ? undefined : raw), assignmentMismatchShapeSchema.optional()),
  held: booleanQueryParam,
  safeShapeOnly: booleanQueryParam,
};

const sortByField = z.preprocess(
  (raw) => (raw === '' || raw === undefined ? undefined : raw),
  z.enum(ASSIGNMENT_MISMATCH_READINESS_SORT_FIELDS).optional().default('employeeName'),
);
const sortDirField = z.preprocess(
  (raw) => (raw === '' || raw === undefined ? undefined : raw),
  z.enum(ASSIGNMENT_MISMATCH_READINESS_SORT_DIRECTIONS).optional().default('asc'),
);

export const assignmentMismatchReadinessListQuerySchema = z.object({
  ...assignmentMismatchReadinessFilterFields,
  page: pageQueryParam,
  pageSize: pageSizeQueryParam,
  sortBy: sortByField,
  sortDir: sortDirField,
});

export type AssignmentMismatchReadinessListQuery = z.infer<typeof assignmentMismatchReadinessListQuerySchema>;

export const ASSIGNMENT_MISMATCH_READINESS_EXPORT_FORMATS = ['csv', 'xlsx'] as const;
export type AssignmentMismatchReadinessExportFormat = (typeof ASSIGNMENT_MISMATCH_READINESS_EXPORT_FORMATS)[number];

export const assignmentMismatchReadinessExportQuerySchema = z.object({
  ...assignmentMismatchReadinessFilterFields,
  sortBy: sortByField,
  sortDir: sortDirField,
  format: z.enum(ASSIGNMENT_MISMATCH_READINESS_EXPORT_FORMATS),
});

export type AssignmentMismatchReadinessExportQuery = z.infer<typeof assignmentMismatchReadinessExportQuerySchema>;

// --- Response contracts ---------------------------------------------------------------------

export interface AssignmentMismatchReadinessCycleRef {
  id: string;
  year: number;
  month: number;
  status: 'DRAFT';
}

export interface AssignmentMismatchReadinessUnitRef {
  id: string;
  name: string;
  code: string | null;
}

/** One `PayrollEntryWorkLine`'s own comparison against the employee's current Unit — evaluated
 * independently for every line on the entry, never just the primary one (the frozen regression
 * requirement: a split entry whose primary line already matches must still surface here if a
 * secondary line doesn't). */
export interface AssignmentMismatchReadinessWorkLineRef {
  workLineId: string;
  unit: AssignmentMismatchReadinessUnitRef;
  /** Lowest `sortOrder` on the entry — the entry's "primary" line, same convention every sibling
   * report's own primary-Unit display already uses. Display-only context, never itself part of the
   * mismatch predicate (every line is evaluated, primary or not). */
  isPrimary: boolean;
  /** `true` when this specific line's `unitId` differs from the employee's current `unitId`. */
  unitMismatch: boolean;
  /** `true` when `days > 0 || otHours > 0` on this line — attendance/OT presence, read verbatim
   * off the stored columns, never recomputed. */
  hasAttendanceOrOt: boolean;
}

/**
 * One mismatched Draft `PayrollEntry` (approved review). Carries no financial field of any kind
 * (no Gross Pay, no Net Salary, no `calcNet` call) — this report exists purely to surface an
 * attribution divergence, never a monetary one, and computing one would invite exactly the
 * financial-neutrality risk the approved review explicitly ruled out.
 */
export interface AssignmentMismatchReadinessRow {
  payrollEntryId: string;
  employeeId: string;
  employeeCode: string | null;
  employeeName: string;
  designation: string;
  /** `PayrollEntry.siteId` — the reporting source of truth, never `Employee.siteId`. */
  payrollSiteId: string;
  payrollSiteName: string;
  workLines: AssignmentMismatchReadinessWorkLineRef[];
  /** Read live off `Employee` at request time — comparison context only, never substituted as this
   * row's own attribution. */
  currentEmployeeSiteId: string;
  currentEmployeeSiteName: string;
  currentEmployeeUnit: AssignmentMismatchReadinessUnitRef;
  /** `true` when `payrollSiteId !== currentEmployeeSiteId`. */
  siteMismatch: boolean;
  /** `true` when at least one work line's `unitMismatch` is `true`. */
  unitMismatch: boolean;
  shape: AssignmentMismatchShape;
  workLineCount: number;
  held: boolean;
  /** `true` when any work line has `days > 0 || otHours > 0` — the entry-level rollup of each
   * line's own `hasAttendanceOrOt`. */
  hasAttendanceOrOt: boolean;
  /**
   * Informational only — mirrors (never imports, never changes) the exact eligibility shape
   * `applyEmployeeAssignmentToDraftPayrollEntry` already enforces: exactly one work line, zero
   * days, zero OT hours (unreleased is already guaranteed by this report's own candidate scope).
   * This report renders no control from this flag — no Apply button, no bulk action. A payroll
   * staff user who wants to act on it still does so from the existing Payroll Entry grid's own
   * "Apply current assignment" row action, unchanged by this checkpoint.
   */
  safeOneClickShape: boolean;
}

export interface AssignmentMismatchReadinessTotals {
  /** Total mismatched rows in the complete filtered/authorized candidate set (not just the current
   * page). */
  matchingCount: number;
  siteMismatchCount: number;
  /** Rows whose Site matches but at least one Unit doesn't. */
  unitOnlyMismatchCount: number;
  splitCount: number;
  heldCount: number;
  safeOneClickShapeCount: number;
}

export interface AssignmentMismatchReadinessListResponse {
  cycle: AssignmentMismatchReadinessCycleRef;
  page: number;
  pageSize: number;
  total: number;
  rows: AssignmentMismatchReadinessRow[];
  totals: AssignmentMismatchReadinessTotals;
  generatedAt: string;
}

export interface AssignmentMismatchReadinessExportLimitError {
  code: 'EXPORT_ROW_LIMIT_EXCEEDED';
  matchingCount: number;
  maxRows: number;
  message: string;
}
