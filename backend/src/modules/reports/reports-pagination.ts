/**
 * Phase 8B Checkpoint 1 — a minimal pagination utility scoped specifically to Payroll Summary's own
 * bounded case, NOT a generic reusable "Reports pagination foundation." Deliberately scoped to
 * `reports/` only, not promoted to `common/` — a codebase-wide generic abstraction is not justified by
 * one report.
 *
 * **What this module is for — read this before importing it into a new report:**
 *
 * - `resolveReportPage` (bounded `page`/`pageSize` clamping, mirroring `listPayrollEntries`'s own
 *   rule) is generically safe for any report and may be reused as-is.
 * - `paginateInMemory` is safe ONLY when the thing being paginated is already a small, bounded,
 *   fully-in-memory row set that some other, separately-bounded query already had to fully compute for
 *   correctness — Payroll Summary's case, where the pagination unit is Project Site (dozens, not
 *   thousands) and the underlying `PayrollEntry` fetch is always bounded to one cycle. It is NOT a
 *   general "fetch everything, then paginate" pattern, and must not be reached for by a future report
 *   just because it's already here.
 *
 * **Normative rule for future row-level reports** (Employee Payroll History, Deduction Report,
 * Overtime Report, Advance Recovery Report, Salary Release Report, and any other report whose
 * pagination unit is a row that can scale with employee/cycle history rather than a small, bounded
 * grouping key like Project Site): they MUST use database/query-level pagination (Prisma `skip`/
 * `take` pushed into the query itself). They MUST NOT fetch all historical rows and then slice the
 * result in application memory — `paginateInMemory` is the wrong tool for that shape, full stop. This
 * module does not (and, as of Checkpoint 1, should not) provide that DB-pagination abstraction yet;
 * build it when the first report that actually needs it is implemented, not speculatively now.
 *
 * `resolveReportPage`/`paginateInMemory` mirror the bounded `page`/`pageSize`/`skip`/`take` shape
 * every existing paginated endpoint already uses (`listPayrollEntries`, `searchStatementEmployees`)
 * — deterministic ordering is the caller's responsibility (sort before paginating), never implied
 * by this module.
 */

export const REPORTS_MAX_PAGE_SIZE = 100;
export const REPORTS_DEFAULT_PAGE_SIZE = 25;

export interface ResolvedReportPage {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

/** Clamps a caller-supplied `page`/`pageSize` into a safe, bounded shape — `page` floors at 1,
 * `pageSize` floors at 1 and ceilings at `REPORTS_MAX_PAGE_SIZE`, exactly matching
 * `listPayrollEntries`'s own clamping rule (`payroll-entry.service.ts`). `skip`/`take` are provided
 * for a future report whose grouping key is itself large enough to need a genuine database-level
 * `skip`/`take` fetch, rather than the in-memory `paginateInMemory` below. */
export function resolveReportPage(page?: number, pageSize?: number): ResolvedReportPage {
  const resolvedPage = Math.max(1, page ?? 1);
  const resolvedPageSize = Math.min(REPORTS_MAX_PAGE_SIZE, Math.max(1, pageSize ?? REPORTS_DEFAULT_PAGE_SIZE));
  return {
    page: resolvedPage,
    pageSize: resolvedPageSize,
    skip: (resolvedPage - 1) * resolvedPageSize,
    take: resolvedPageSize,
  };
}

export interface ReportPage<T> {
  total: number;
  page: number;
  pageSize: number;
  rows: T[];
}

/**
 * Slices an already-computed, already-sorted array into one page. Used by Payroll Summary
 * (Checkpoint 1) whose grouping key is Project Site — necessarily small (dozens, not thousands) even
 * at the 1,500-employee/multi-site scale this system targets, and whose per-row figures require a
 * full pass over that cycle's `PayrollEntry` rows regardless of which page is requested (canonical
 * `calcNet` cannot be reproduced as a SQL aggregate — Phase 8A investigation report §10/§4A;
 * Checkpoint 1 brief: "correctness is more important than clever query reduction"). This is
 * deliberately NOT "fetch every row across every cycle, then slice" — the underlying fetch is always
 * bounded to one cycle's own entries (the same bounded shape Payroll Entry's own grid already proves
 * safe at this scale), and only the resulting small, already-aggregated row set is paginated here. A
 * future report whose grouping key is itself large (e.g. a multi-year Employee Payroll History) should
 * push `skip`/`take` into its own Prisma query instead of calling this function.
 */
export function paginateInMemory<T>(rows: T[], page: number, pageSize: number): ReportPage<T> {
  const total = rows.length;
  const start = (page - 1) * pageSize;
  return { total, page, pageSize, rows: rows.slice(start, start + pageSize) };
}
