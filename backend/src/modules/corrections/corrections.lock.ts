import type { PrismaTransactionClient } from '../../lib/prisma';

/**
 * Phase 6 Checkpoint 2 — the transaction-scoped advisory-lock helper approved by the Product
 * Decision Resolution (2026-07-18, Decision 2): "Correction creation and baseline reconstruction
 * must use a PostgreSQL transaction-scoped advisory lock keyed to the source Payroll Entry,"
 * covering baseline load, delta calculation, duplicate/conflict validation, and the
 * `Correction`/`BalanceAdjustment` insert — with existing database constraints and conditional
 * updates retained as a secondary safeguard, not a replacement.
 *
 * **Not wired into any write path yet.** This checkpoint has no transactional correction-creation
 * flow to protect (Checkpoint 3's own scope) — this file exists so that flow has a single,
 * already-reviewed, reusable primitive to call rather than reinventing locking per checkpoint.
 * Exercised directly by this checkpoint's own tests (deterministic key derivation, same-entry
 * serialization) but never invoked by any route or service in this checkpoint's diff.
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
