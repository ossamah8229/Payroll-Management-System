import type { Prisma } from '@prisma/client';

/**
 * The one canonical, report-agnostic derivation of a `PayrollEntry`'s 5-state release/payout
 * status — extracted here at the **third** consumer (Employee Payroll History, Project Site
 * Payroll Report, Deduction Report), per this project's own "extract generic code only at the
 * third consumer" convention (already applied identically to `excelColumnWidth`,
 * `docs/architecture/workflows/reports.md` §15.7). Originally lived as
 * `deriveEmployeePayrollHistoryRowStatus`/`employeePayrollHistoryRowStatusWhereClause` in
 * `employee-payroll-history-status.ts`, named after the report that first needed it even though the
 * logic was never specific to that report — Project Site Payroll Report already imported it
 * directly as its second consumer rather than re-implementing it. This file is a behavior-preserving
 * rename/move only: same five states, same precedence, same WHERE semantics, same impossible-state
 * handling — verified by `backend/tests/payroll-entry-row-status.test.ts` and by every pre-existing
 * Employee Payroll History/Project Site Payroll Report test continuing to pass unweakened.
 *
 * Every list/detail/export row a consumer produces goes through `derivePayrollEntryRowStatus`;
 * every `rowStatus` list filter goes through `payrollEntryRowStatusWhereClause` — the two are kept
 * in lockstep by this file's own test suite's consistency check, so a future edit to one that
 * forgets the other is a failing test, not a silent drift.
 *
 * **Precedence, and why it's safe** (`RELEASED > HELD > NO_PAY_DUE > RECOVERY_DUE > PENDING`):
 * inspecting the actual schema/service invariants (`docs/architecture/database/payroll-entry.md
 * §12`, `docs/architecture/database/release.md §12c`, `payroll-release.service.ts`'s
 * `releaseProjectUnit`/`getUnitReleaseStatus`) shows these four "resolved" states are already
 * mutually exclusive in valid data, not merely by convention:
 *   - `released = true` is only ever set by a release sweep that excludes `hold = true` entries
 *     entirely (same tier as a block) and only for the `PAID` payout bucket — so `released` and
 *     `hold`, and `released` and a non-null `payoutOutcome`, can never both be true for the same
 *     row once a release actually happens.
 *   - `payoutOutcome` is likewise only ever set by that same sweep, for the same `hold = false`
 *     candidate set — a `hold = true` row is *never* considered by the sweep, so it can never
 *     acquire a `payoutOutcome` while held.
 *   - The migration's own raw-SQL CHECK (`payoutOutcome IS NULL OR released = false`) makes the
 *     `released`/`payoutOutcome` exclusivity a database-level guarantee, not just an
 *     application-level one.
 * So for any row actually produced by this system's own write paths, at most one of
 * `released`/`hold`/`payoutOutcome-is-set` is ever true — this function's precedence order only
 * matters for a hypothetical row that violated that invariant (a bug, a manual DB edit, or a
 * pre-migration legacy anomaly, the same class of case `bank-sheets.service.ts`'s own
 * negative-net-salary defensive filter already guards against elsewhere in this codebase). Rather
 * than throwing or returning an ambiguous result for that case, this function still returns one
 * deterministic answer — `RELEASED` wins over everything (this system's single most
 * consequential fact about a row), `HELD` wins over the payout-outcome buckets (an operator's
 * explicit hold should never be silently overridden by a stale payout classification), and
 * `PENDING` is the true fallback only when none of the other four apply.
 *
 * **Return type is deliberately a local, neutral union — not imported from any report's own shared
 * schema.** `EmployeePayrollHistoryRowStatus` and `ProjectSitePayrollReportRowStatus` (and this
 * checkpoint's own `DeductionReportRowStatus`) each declare the identical five string literals
 * independently, per each report's own established "no confusing cross-report type reference in a
 * public DTO" convention (`reports.md` §16.2) — that convention governs each report's own *public
 * contract* shape, not this backend-internal derivation module, so it is preserved unchanged here.
 * Every one of those report-specific unions is structurally identical to (and therefore directly
 * assignable to/from) `PayrollEntryRowStatus` below with no cast required.
 */
export type PayrollEntryRowStatus = 'RELEASED' | 'HELD' | 'NO_PAY_DUE' | 'RECOVERY_DUE' | 'PENDING';

export const PAYROLL_ENTRY_ROW_STATUS_VALUES: readonly PayrollEntryRowStatus[] = [
  'RELEASED',
  'HELD',
  'NO_PAY_DUE',
  'RECOVERY_DUE',
  'PENDING',
];

export function derivePayrollEntryRowStatus(entry: {
  released: boolean;
  hold: boolean;
  payoutOutcome: 'NO_PAY_DUE' | 'RECOVERY_DUE' | null;
}): PayrollEntryRowStatus {
  if (entry.released) return 'RELEASED';
  if (entry.hold) return 'HELD';
  if (entry.payoutOutcome === 'NO_PAY_DUE') return 'NO_PAY_DUE';
  if (entry.payoutOutcome === 'RECOVERY_DUE') return 'RECOVERY_DUE';
  return 'PENDING';
}

/**
 * The `WHERE` predicate equivalent of the derivation above, for a `rowStatus` list filter — built
 * from the *same* precedence, so "rows the filter returns for status X" and "rows this function
 * would derive as status X" never diverge. Each bucket's predicate explicitly excludes every
 * higher-precedence condition (e.g. `NO_PAY_DUE` requires `released = false AND hold = false`),
 * mirroring the derivation's own early-return order, not just its final field checks.
 */
export function payrollEntryRowStatusWhereClause(status: PayrollEntryRowStatus): Prisma.PayrollEntryWhereInput {
  switch (status) {
    case 'RELEASED':
      return { released: true };
    case 'HELD':
      return { released: false, hold: true };
    case 'NO_PAY_DUE':
      return { released: false, hold: false, payoutOutcome: 'NO_PAY_DUE' };
    case 'RECOVERY_DUE':
      return { released: false, hold: false, payoutOutcome: 'RECOVERY_DUE' };
    case 'PENDING':
      return { released: false, hold: false, payoutOutcome: null };
  }
}
