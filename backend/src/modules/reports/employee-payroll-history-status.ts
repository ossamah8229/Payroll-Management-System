import type { Prisma } from '@prisma/client';
import type { EmployeePayrollHistoryRowStatus } from '@payroll/shared';

/**
 * The one canonical derivation of Employee Payroll History's 5-state `rowStatus` — never inferred
 * by the client, never redefined at a second call site (approved architecture review §5's own
 * requirement). Every list/detail/export row goes through `deriveEmployeePayrollHistoryRowStatus`;
 * every `rowStatus` list filter goes through `employeePayrollHistoryRowStatusWhereClause` — the two
 * are kept in lockstep by `employee-payroll-history-status.test.ts`'s own consistency test, so a
 * future edit to one that forgets the other is a failing test, not a silent drift.
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
 */
export function deriveEmployeePayrollHistoryRowStatus(entry: {
  released: boolean;
  hold: boolean;
  payoutOutcome: 'NO_PAY_DUE' | 'RECOVERY_DUE' | null;
}): EmployeePayrollHistoryRowStatus {
  if (entry.released) return 'RELEASED';
  if (entry.hold) return 'HELD';
  if (entry.payoutOutcome === 'NO_PAY_DUE') return 'NO_PAY_DUE';
  if (entry.payoutOutcome === 'RECOVERY_DUE') return 'RECOVERY_DUE';
  return 'PENDING';
}

/**
 * The `WHERE` predicate equivalent of the derivation above, for the `rowStatus` list filter —
 * built from the *same* precedence, so "rows the filter returns for status X" and "rows this
 * function would derive as status X" never diverge. Each bucket's predicate explicitly excludes
 * every higher-precedence condition (e.g. `NO_PAY_DUE` requires `released = false AND hold =
 * false`), mirroring the derivation's own early-return order, not just its final field checks.
 */
export function employeePayrollHistoryRowStatusWhereClause(
  status: EmployeePayrollHistoryRowStatus,
): Prisma.PayrollEntryWhereInput {
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
