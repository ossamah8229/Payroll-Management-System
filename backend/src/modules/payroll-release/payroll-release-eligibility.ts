import type { PrismaTransactionClient } from '../../lib/prisma';
import {
  findEmployeeByAccountNumber,
  findEmployeeByCnic,
  findEmployeeByEmployeeCode,
  findEmployeeByIban,
} from '../employees/employees.service';

/**
 * Negative Payroll Recovery & Employee Identity/Banking Uniqueness checkpoint (2026-07-26) —
 * `releaseProjectUnit`'s own canonical, single decision point for "what happens to this candidate
 * entry when its Unit(s) release" (Part C of the checkpoint brief). Two independent questions,
 * evaluated together so callers only need one round of DB lookups per entry:
 *
 * 1. **Is this entry releasable at all right now?** (`releasable`/`blockReasons`) — a duplicate
 *    CNIC/Employee Code (defense-in-depth once the database itself enforces these two — see
 *    `docs/architecture/database/employee.md §9`), a duplicate Account Number/IBAN (the real gap
 *    this checkpoint closes), or a bank-paid employee missing a required Account Number. A Cash
 *    employee (`bankId = null`) is never blocked for missing banking details. A non-releasable
 *    entry is excluded from this sweep entirely — same tier as `hold` — remaining
 *    `released: false, hold: false, payoutOutcome: null`, visible and still blocking Finalize
 *    until the underlying master data is fixed or the entry is manually held.
 * 2. **If it is releasable, which of the three payout buckets does its own `netSalary` put it in?**
 *    (`payoutOutcome`) — `PAID` (`netSalary > 0`, the ordinary case), `NO_PAY_DUE`
 *    (`netSalary = 0`), or `RECOVERY_DUE` (`netSalary < 0`, which additionally creates a
 *    `BalanceAdjustment(type: RECOVERY)` — see `releaseProjectUnit`). `released = true` is only
 *    ever set for `PAID` — this function never redefines what `released` means.
 *
 * Called from exactly one enforcement point (`releaseProjectUnit`), and reused read-only by the
 * Payroll Entry / Salary Release UI's per-entry readiness display — the one place this invariant
 * lives, instead of it being scattered across Bank Sheet/Cash Receiving/frontend checks.
 */

/** The exact block-reason wording, shared with the bulk-optimized variant this same file's own
 * doc comment describes (`attachReleaseBlockReasonsBulk`, `payroll-entry.service.ts`'s Payroll
 * Entry grid display) — one canonical set of strings, never redefined per call site. */
export const RELEASE_BLOCK_REASONS = {
  DUPLICATE_CNIC: 'Duplicate CNIC',
  DUPLICATE_EMPLOYEE_CODE: 'Duplicate Employee Code',
  MISSING_ACCOUNT_NUMBER: 'Missing Account Number',
  DUPLICATE_ACCOUNT_NUMBER: 'Duplicate Account Number',
  DUPLICATE_IBAN: 'Duplicate IBAN',
} as const;

export type EntryPayoutClassification = 'PAID' | 'NO_PAY_DUE' | 'RECOVERY_DUE';

export interface EntryReleaseReadiness {
  /** `false` ⇒ exclude this entry from the current release sweep entirely (like `hold`). */
  releasable: boolean;
  /** Human-readable reasons, e.g. `"Duplicate CNIC"`, `"Missing Account Number"` — empty when
   * `releasable`. Surfaced to the operator (Payroll Entry visibility), never silently swallowed. */
  blockReasons: string[];
  /** Meaningful only when `releasable`. */
  payoutOutcome: EntryPayoutClassification;
}

export interface ReleaseReadinessEntry {
  employeeId: string;
  bankId: string | null;
  accountNumber: string | null;
  iban: string | null;
}

export interface ReleaseReadinessEmployee {
  employeeCode: string | null;
  cnic: string | null;
}

export async function evaluatePayrollEntryReleaseReadiness(
  entry: ReleaseReadinessEntry,
  employee: ReleaseReadinessEmployee,
  netSalary: string | number,
  client: PrismaTransactionClient,
): Promise<EntryReleaseReadiness> {
  const blockReasons: string[] = [];

  // Defense-in-depth for CNIC/Employee Code: the database's own partial unique indexes already
  // prevent two employees from ever holding the same one going forward — this guards the window
  // before any legacy duplicate (predating this checkpoint) is remediated, and any theoretical race.
  if (employee.cnic) {
    const duplicate = await findEmployeeByCnic(employee.cnic, { excludeEmployeeId: entry.employeeId, client });
    if (duplicate) blockReasons.push(RELEASE_BLOCK_REASONS.DUPLICATE_CNIC);
  }
  if (employee.employeeCode) {
    const duplicate = await findEmployeeByEmployeeCode(employee.employeeCode, {
      excludeEmployeeId: entry.employeeId,
      client,
    });
    if (duplicate) blockReasons.push(RELEASE_BLOCK_REASONS.DUPLICATE_EMPLOYEE_CODE);
  }

  // The real gap this checkpoint closes: Account Number/IBAN never had uniqueness enforcement.
  // Checked against the entry's own frozen accountNumber/iban (the actual payment destination Bank
  // Sheet reads), not the employee's live record — same "copied, not linked" convention as every
  // other banking field on PayrollEntry.
  if (entry.bankId) {
    if (!entry.accountNumber) {
      blockReasons.push(RELEASE_BLOCK_REASONS.MISSING_ACCOUNT_NUMBER);
    } else {
      const duplicate = await findEmployeeByAccountNumber(entry.accountNumber, {
        excludeEmployeeId: entry.employeeId,
        client,
      });
      if (duplicate) blockReasons.push(RELEASE_BLOCK_REASONS.DUPLICATE_ACCOUNT_NUMBER);
    }
  }
  // Cash employee (bankId null): never blocked for a missing Account Number/IBAN (B8).
  if (entry.iban) {
    const duplicate = await findEmployeeByIban(entry.iban, { excludeEmployeeId: entry.employeeId, client });
    if (duplicate) blockReasons.push(RELEASE_BLOCK_REASONS.DUPLICATE_IBAN);
  }

  const net = Number(netSalary);
  const payoutOutcome: EntryPayoutClassification = net > 0 ? 'PAID' : net === 0 ? 'NO_PAY_DUE' : 'RECOVERY_DUE';

  return { releasable: blockReasons.length === 0, blockReasons, payoutOutcome };
}
