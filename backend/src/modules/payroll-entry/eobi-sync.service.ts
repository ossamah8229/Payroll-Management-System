import type { PrismaTransactionClient } from '../../lib/prisma';
import type { RequestMeta } from '../../common/request-meta';
import { recordAuditLog } from '../audit-log/audit-log.service';

/**
 * EOBI Bidirectional Synchronisation (Phase 7D refinement, 2026-07-30; permissions/audit revision
 * the same day) — `docs/architecture/database/employee.md`/`payroll-entry.md`'s shared invariant:
 *
 *   Employee.defaultEobiApplicable === current Draft PayrollEntry.eobiApplicable
 *
 * must hold after any successful change from *either* screen. `Employee` remains the source of
 * truth for the employee's current/default applicability; the current Draft entry may operate on
 * it day to day, but because the client requires both locations to agree, a Draft-entry change
 * writes back to `Employee` too. This is the **one** place that dual write happens — both
 * `employees.service.ts`'s `updateEmployee` and `payroll-entry.service.ts`'s `updatePayrollEntry`
 * call this function from inside their own transaction rather than re-implementing the write or
 * calling each other's route/service (no recursive API calls, no cross-module HTTP chaining).
 *
 * **This is an internal system synchronisation, not a second user edit** — the caller's own route
 * permission (`payroll:entry` for `updatePayrollEntry`, `employees:edit` for `updateEmployee`) is
 * the only authorisation this write ever requires; this function itself performs no permission
 * check of its own (it has no `currentUser` to check one against — only an `actorUserId` to audit
 * with), and neither caller requires the *other* screen's permission before invoking it. A user
 * without `employees:edit` still cannot reach `PATCH /employees/:id` (or any of its other fields)
 * directly, and a user without `payroll:entry` still cannot reach `PATCH /payroll-entries/:id` (or
 * any of its other fields) directly — only the synchronised EOBI write is exempt from the
 * counterpart permission, because it is not an independent edit of that resource.
 *
 * **Audit**: every EOBI applicability change on either entity — whichever screen originates it —
 * is recorded under one consistent action name per entity (`employee.eobi_updated` /
 * `payroll_entry.eobi_updated`), tagged with `metadata.origin` (`'employee_registry'` or
 * `'payroll_entry'`) identifying which screen triggered the overall operation. This function always
 * records the *counterpart* entity's own entry (the one it just wrote); each caller separately
 * records its *own* entity's entry, under the same action name, immediately after its own write —
 * see `updatePayrollEntry`/`updateEmployee`'s own doc comments. Never folded into, or duplicated
 * alongside, the generic `payroll_entry.updated`/`employee.updated` bundle.
 *
 * **Historical safety**: only ever touches the *current* Draft cycle's entry (found fresh, inside
 * the caller's transaction, via `status: 'DRAFT'` — the same single-Draft-cycle invariant every
 * other cycle-lifecycle function in this codebase relies on) and only when that entry is still
 * genuinely editable (`released = false`, `payoutOutcome = null` — mirrors
 * `payroll-entry.service.ts`'s own `assertEntryEditable`, deliberately not imported from there to
 * keep this module dependency-free of both call sites, avoiding any risk of a circular import).
 * Released/Archived cycles, and any entry a Unit release sweep has already resolved, are never
 * reachable here — there is no "find the most recent entry" fallback that could ever touch history.
 *
 * **No employee ⇒ no entry created.** If the employee has no entry in the current Draft cycle (or
 * no Draft cycle exists at all), this is a deliberate no-op: `Employee.defaultEobiApplicable` is
 * already the correct, retained value, and it's what `createPayrollCycle`/`createPayrollEntry`/
 * `syncEmployeeIntoCurrentDraftCycle` already copy onto a *newly created* entry — this function
 * only ever updates an *existing* entry, never creates one.
 *
 * **No update loops**: each direction only ever writes to the *other* record, never re-reads or
 * re-writes the record it was called from, and only writes at all when the target's current value
 * actually differs from the requested one (an already-consistent pair produces zero writes and zero
 * audit noise) — there is no path back into this function from the write it performs.
 */
export type EobiSyncOrigin = 'employee_registry' | 'payroll_entry';

interface SyncEobiApplicabilityArgs {
  /** The caller's own open transaction — both the primary edit and this synchronised write commit
   * or roll back together, never partially applied. */
  tx: PrismaTransactionClient;
  employeeId: string;
  newValue: boolean;
  origin: EobiSyncOrigin;
  actorUserId: string;
  requestMeta: RequestMeta;
  /** Required when `origin === 'payroll_entry'` — the entry being edited, already known by the
   * caller (avoids a redundant lookup); recorded in the `Employee` audit entry's metadata so the
   * originating entry is traceable. */
  sourcePayrollEntryId?: string;
}

export async function syncEobiApplicability({
  tx,
  employeeId,
  newValue,
  origin,
  actorUserId,
  requestMeta,
  sourcePayrollEntryId,
}: SyncEobiApplicabilityArgs): Promise<void> {
  if (origin === 'payroll_entry') {
    const employee = await tx.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: { defaultEobiApplicable: true },
    });
    if (employee.defaultEobiApplicable === newValue) return;

    await tx.employee.update({ where: { id: employeeId }, data: { defaultEobiApplicable: newValue } });
    await recordAuditLog(
      {
        actorUserId,
        action: 'employee.eobi_updated',
        entityType: 'Employee',
        entityId: employeeId,
        metadata: {
          previousValue: employee.defaultEobiApplicable,
          newValue,
          origin: 'payroll_entry',
          sourcePayrollEntryId: sourcePayrollEntryId ?? null,
        },
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      },
      tx,
    );
    return;
  }

  // employee_registry -> current Draft Payroll Entry, if one exists.
  const draftCycle = await tx.payrollCycle.findFirst({ where: { status: 'DRAFT' } });
  if (!draftCycle) return;

  const entry = await tx.payrollEntry.findUnique({
    where: { cycleId_employeeId: { cycleId: draftCycle.id, employeeId } },
  });
  if (!entry || entry.released || entry.payoutOutcome !== null) return;
  if (entry.eobiApplicable === newValue) return;

  await tx.payrollEntry.update({
    where: { id: entry.id },
    data: { eobiApplicable: newValue, version: { increment: 1 } },
  });
  await recordAuditLog(
    {
      actorUserId,
      action: 'payroll_entry.eobi_updated',
      entityType: 'PayrollEntry',
      entityId: entry.id,
      metadata: {
        previousValue: entry.eobiApplicable,
        newValue,
        origin: 'employee_registry',
        employeeId,
        cycleId: draftCycle.id,
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    },
    tx,
  );
}
