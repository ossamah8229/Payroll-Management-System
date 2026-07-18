import type { PrismaTransactionClient } from '../../lib/prisma';

/**
 * Phase 6 Checkpoint 2 — the transaction-scoped advisory-lock helper approved by the Product
 * Decision Resolution (2026-07-18, Decision 2): "Correction creation and baseline reconstruction
 * must use a PostgreSQL transaction-scoped advisory lock keyed to the source Payroll Entry,"
 * covering baseline load, delta calculation, duplicate/conflict validation, and the
 * `Correction`/`BalanceAdjustment` insert — with existing database constraints and conditional
 * updates retained as a secondary safeguard, not a replacement.
 *
 * **Wired into `corrections.service.ts`'s `approveCorrectionRequest`/`rejectCorrectionRequest`
 * since Phase 6 Checkpoint 3.** `acquireBalanceAdjustmentLock`/`withBalanceAdjustmentLock`, below,
 * are Checkpoint 4's own separate addition — a distinct lock for a distinct aggregate (a
 * `BalanceAdjustment`, not a `PayrollEntry`), deliberately not reusing this file's `PayrollEntry`
 * lock's key space (see that function's own comment for why).
 *
 * `pg_advisory_xact_lock` is session/transaction-scoped: acquired here, automatically released at
 * the enclosing transaction's commit or rollback — no explicit unlock call, no lock-leak risk if
 * the caller's transaction throws partway through. Must be called with a transaction client (the
 * `tx` parameter of a `prisma.$transaction(async (tx) => { ... })` callback), never the bare
 * `prisma` singleton — an advisory lock taken outside a transaction releases at the end of that
 * single statement, which would lock nothing for the duration this is meant to protect.
 */
export async function acquirePayrollEntryLock(
  payrollEntryId: string,
  tx: PrismaTransactionClient,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${payrollEntryId}))`;
}

/**
 * Runs `fn` after acquiring the transaction-scoped advisory lock for `payrollEntryId` — the
 * reusable wrapper future transactional checkpoints should call rather than invoking
 * `acquirePayrollEntryLock` and their own logic as two separate steps. `fn` itself must use the
 * same `tx` client for every read/write it performs, or its work would not actually be inside the
 * locked transaction.
 */
export async function withPayrollEntryLock<T>(
  payrollEntryId: string,
  tx: PrismaTransactionClient,
  fn: () => Promise<T>,
): Promise<T> {
  await acquirePayrollEntryLock(payrollEntryId, tx);
  return fn();
}

/**
 * Phase 6 Checkpoint 4 — the transaction-scoped advisory lock for one `BalanceAdjustment`,
 * protecting settlement recording exactly the way `acquirePayrollEntryLock` protects correction
 * approval. A **separate** lock, not a reuse of the `PayrollEntry` one above — settlement never
 * touches `PayrollEntry`/`Correction`/baseline-reconstruction state at all, only a
 * `BalanceAdjustment` and its own settlement children, so serializing it against an unrelated
 * `PayrollEntry`-keyed lock would be both meaningless and needlessly blocking.
 *
 * The hashed string is namespaced (`'balance-adjustment:' || id`), not the bare UUID
 * `acquirePayrollEntryLock` hashes — `hashtext` operates on the string itself, so this guarantees
 * a `BalanceAdjustment` id can never collide with a `PayrollEntry` id in the same 32-bit advisory
 * lock key space, however astronomically unlikely a bare-UUID collision already would have been.
 */
export async function acquireBalanceAdjustmentLock(
  balanceAdjustmentId: string,
  tx: PrismaTransactionClient,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'balance-adjustment:' + balanceAdjustmentId}))`;
}

export async function withBalanceAdjustmentLock<T>(
  balanceAdjustmentId: string,
  tx: PrismaTransactionClient,
  fn: () => Promise<T>,
): Promise<T> {
  await acquireBalanceAdjustmentLock(balanceAdjustmentId, tx);
  return fn();
}
