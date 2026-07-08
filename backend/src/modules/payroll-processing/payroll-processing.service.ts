import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import type { CreatePayrollCycleInput, SessionUser } from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { conflict, notFound } from '../../common/http-error';
import type { RequestMeta } from '../../common/request-meta';
import { recordAuditLog } from '../audit-log/audit-log.service';

/**
 * Payroll Processing — owns the `PayrollCycle` lifecycle (docs/architecture/database/payroll-cycle.md
 * §10). Phase 3 Checkpoint 1 scope: cycle *creation* only (bootstrap and carry-forward). Finalize
 * Cycle, Release, Archiving, and Backup Package generation are explicitly NOT implemented here —
 * see this module's `createPayrollCycle` doc comment for the precise, approved scope boundary.
 */

const CHUNK_SIZE = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function listPayrollCycles() {
  return prisma.payrollCycle.findMany({ orderBy: [{ year: 'desc' }, { month: 'desc' }] });
}

export async function getPayrollCycle(id: string) {
  const cycle = await prisma.payrollCycle.findUnique({ where: { id } });
  if (!cycle) {
    throw notFound('Payroll cycle not found');
  }
  return cycle;
}

/**
 * Creates a `PayrollCycle` — either the very first one ever (no cycles exist yet) or a
 * subsequent one. Both share one implementation, since the entry-seeding logic itself is
 * identical either way and is squarely Phase 3's own concern (docs/IMPLEMENTATION_PLAN.md: "Builds
 * PayrollCycle Draft creation (bootstrapping the very first cycle)").
 *
 * **Explicit, approved scope boundary (Phase 3 Checkpoint 1) — what this function deliberately
 * does NOT do, and why:** the frozen architecture's *full* "new cycle creation" transaction
 * (docs/architecture/workflows/payroll-lifecycle.md §4) additionally requires the outgoing cycle to already
 * be `RELEASED`, archives it, generates a `BackupPackage`, and includes departed employees with a
 * `PENDING` `BalanceAdjustment` — that is explicitly Phase 5's job (`docs/IMPLEMENTATION_PLAN.md`
 * Phase 5), and depends on Finalize Cycle/Release (Phase 4), `BackupPackage`/`StorageProvider`
 * (Phase 5), and `BalanceAdjustment` (Phase 6), none of which exist yet. Building any of that now
 * would mean either stubbing out tables this checkpoint has no authorization to create, or
 * silently skipping a precondition the architecture treats as load-bearing — both rejected as
 * options. What IS enforced here, because it is a timeless, phase-independent invariant (§10):
 * only one `PayrollCycle` may ever be in `DRAFT` status at a time. The previous cycle's `status`
 * is left completely untouched by this function — it is never archived here.
 *
 * **The Payroll Bootstrap Rule (frozen business rule, confirmed 2026-07-07 — do not re-litigate):**
 * for a continuing employee (one with an entry in the most recent existing cycle), payroll-specific
 * values — `grossPay`, the new single work line's `cycleDays`/`otRate`, `leaveRate`,
 * `eobiApplicable`/`eobiAmount`, and any other payroll calculation parameter — are always carried
 * forward from that prior entry, never copied from `Employee`'s own record. Payroll values
 * represent payroll history and stay stable across cycles until intentionally changed in Payroll
 * Entry itself (Employee.grossPay is documented, §9, as a "template value only" — reverting to it
 * would silently discard a deliberate adjustment). Conversely, `designation`, `bankId`,
 * `branchCode`, `accountNumber`, `accountTitle`, the new line's `unitId` (Primary Project Unit),
 * and `siteId` always refresh from `Employee`'s CURRENT record, never the prior entry's — Employee
 * master data should always reflect the employee's latest assignment/banking information. This
 * also keeps the new entry's `siteId` consistent with whichever site the employee's current
 * default unit actually belongs to (a genuine cross-site transfer between cycles would otherwise
 * leave the new entry's `siteId` and its work line's unit referring to two different sites,
 * violating the composite-FK invariant). Attendance (`days`/`otHours`) always resets to zero —
 * attendance is a fresh decision made each cycle (§12a), never carried forward. A genuinely new
 * employee (no prior entry) seeds entirely fresh from `Employee`'s own defaults.
 *
 * **Performance (Principle 10):** seeds every entry via two chunked `createMany` calls rather than
 * one `create` per employee — this must not become an N-round-trip loop at the 10,000-employee
 * design floor. IDs are generated client-side (`randomUUID()`) so a `PayrollEntry` and its first
 * `PayrollEntryWorkLine` can be bulk-inserted separately while still referencing each other.
 */
export async function createPayrollCycle(
  currentUser: SessionUser,
  input: CreatePayrollCycleInput,
  requestMeta: RequestMeta,
) {
  const existingDraft = await prisma.payrollCycle.findFirst({ where: { status: 'DRAFT' } });
  if (existingDraft) {
    throw conflict(
      'A Draft payroll cycle already exists — only one cycle is ever in Draft state at a time',
    );
  }

  const duplicate = await prisma.payrollCycle.findUnique({
    where: { year_month: { year: input.year, month: input.month } },
  });
  if (duplicate) {
    throw conflict(`A payroll cycle for ${input.month}/${input.year} already exists`);
  }

  const sourceCycle = await prisma.payrollCycle.findFirst({
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
  });

  const activeEmployees = await prisma.employee.findMany({ where: { dateOfLeaving: null } });

  const sourceEntryByEmployeeId = new Map<
    string,
    Prisma.PayrollEntryGetPayload<{ include: { workLines: true } }>
  >();
  if (sourceCycle) {
    const sourceEntries = await prisma.payrollEntry.findMany({
      where: { cycleId: sourceCycle.id },
      include: { workLines: { orderBy: { sortOrder: 'asc' } } },
    });
    for (const entry of sourceEntries) {
      sourceEntryByEmployeeId.set(entry.employeeId, entry);
    }
  }

  const entryRows: Prisma.PayrollEntryCreateManyInput[] = [];
  const workLineRows: Prisma.PayrollEntryWorkLineCreateManyInput[] = [];

  for (const employee of activeEmployees) {
    const sourceEntry = sourceEntryByEmployeeId.get(employee.id);
    const primaryLine = sourceEntry?.workLines[0]; // already ordered by sortOrder asc
    const entryId = randomUUID();

    entryRows.push({
      id: entryId,
      cycleId: '', // placeholder, filled in once the cycle itself is created inside the transaction
      employeeId: employee.id,
      siteId: employee.siteId,
      designation: employee.designation,
      bankId: employee.bankId,
      branchCode: employee.branchCode,
      accountNumber: employee.accountNumber,
      accountTitle: employee.accountTitle,
      grossPay: sourceEntry?.grossPay ?? employee.grossPay,
      eobiAmount: sourceEntry?.eobiAmount ?? employee.defaultEobiAmount,
      eobiApplicable: sourceEntry?.eobiApplicable ?? employee.defaultEobiApplicable,
      leaveRate: sourceEntry?.leaveRate ?? null,
    });

    workLineRows.push({
      id: randomUUID(),
      payrollEntryId: entryId,
      siteId: employee.siteId,
      unitId: employee.unitId,
      cycleDays: primaryLine?.cycleDays ?? 30,
      otRate: primaryLine?.otRate ?? null,
    });
  }

  const cycle = await prisma.$transaction(
    async (tx) => {
      const created = await tx.payrollCycle.create({
        data: {
          year: input.year,
          month: input.month,
          sourceCycleId: sourceCycle?.id ?? null,
          createdBy: currentUser.id,
        },
      });

      for (const row of entryRows) {
        row.cycleId = created.id;
      }

      for (const batch of chunk(entryRows, CHUNK_SIZE)) {
        await tx.payrollEntry.createMany({ data: batch });
      }
      for (const batch of chunk(workLineRows, CHUNK_SIZE)) {
        await tx.payrollEntryWorkLine.createMany({ data: batch });
      }

      await recordAuditLog(
        {
          actorUserId: currentUser.id,
          action: 'payroll_cycle.created',
          entityType: 'PayrollCycle',
          entityId: created.id,
          metadata: {
            year: created.year,
            month: created.month,
            sourceCycleId: created.sourceCycleId,
            entryCount: entryRows.length,
          },
          ipAddress: requestMeta.ipAddress,
          userAgent: requestMeta.userAgent,
        },
        tx,
      );

      return created;
    },
    { timeout: 30_000 },
  );

  return cycle;
}
