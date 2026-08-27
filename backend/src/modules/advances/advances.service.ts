import { Prisma } from '@prisma/client';
import type {
  CancelAdvanceInput,
  CreateAdvanceInput,
  DeferAdvanceScheduleInput,
  ListAdvancesQuery,
  SessionUser,
  UpdateAdvanceInput,
} from '@payroll/shared';
import { isoDateToUtcDate } from '@payroll/shared';
import { prisma, type PrismaTransactionClient } from '../../lib/prisma';
import { badRequest, conflict, notFound } from '../../common/http-error';
import { diffFields } from '../../common/audit-diff';
import type { RequestMeta } from '../../common/request-meta';
import { recordAuditLog } from '../audit-log/audit-log.service';
import { assertSiteAccess, isMasterAdmin } from '../../common/authz-policy';
import { assertEntryEditable } from '../payroll-entry/payroll-entry.service';
import { findOrCreateScheduledPayrollPeriod } from '../payroll-processing/payroll-processing.service';

/**
 * Advances (Phase 4 Checkpoint 5, docs/architecture/database/advances.md §15/§15a). Tracks a
 * `LOAN`/`EID_ADVANCE` given to an employee and its remaining balance; deducted against a specific
 * cycle's `PayrollEntry` (linked via `advanceId`/`eidAdvanceId`, never re-inferred later).
 *
 * **Approved architecture decisions, frozen for this checkpoint:**
 * - At most one `ACTIVE` Advance per employee per type (`Advance_employeeId_type_active_key`,
 *   the partial unique index in the migration) — enforced here as a fast, clean pre-check, with the
 *   database index as the concurrency backstop (translated to a clean 409 by the global error
 *   handler's existing P2002 handling, same precedent as Salary Release's double-release guard).
 * - No generic Outstanding-Payroll-Obligation provider/hook registry — `payroll-processing.service.ts`
 *   calls `materializeScheduledAdvanceDeductions` below directly.
 * - Cash Advances, Advance-only Bank Sheets, and Company Bank Account management are out of scope.
 * - Payroll Entry CSV/Excel import/export is unchanged — no automatic Advance linking during import.
 * - No new permission — every export below is gated by the existing `ADVANCES_MANAGE` (Payroll
 *   Staff, site-scoped, and Master Admin only; Finance holds no Advances permission).
 */

const advanceWithEmployeeInclude = { employee: true } as const;

type AdvanceWithEmployee = Prisma.AdvanceGetPayload<{ include: typeof advanceWithEmployeeInclude }>;

/** v1.0.4 Deputation Visibility checkpoint — the Employee's own current `site`/`unit` (a direct,
 * required FK each, never a historical join) joined in the SAME query as the Advance/Employee fetch
 * itself, so the Advances list can show where an employee is currently deputed without a second
 * round-trip per row. */
const advanceListInclude = {
  employee: { include: { site: true, unit: true } },
  originalScheduledPeriod: true,
  currentScheduledPeriod: true,
} satisfies Prisma.AdvanceInclude;

/**
 * Defensive backstop (v1.0.2 Advance Edit/Cancel checkpoint, 2026-08-25) for the DB-level
 * `Advance_outstandingBalance_check` CHECK constraint (`outstandingBalance >= 0 AND
 * outstandingBalance <= totalAmount`). Every code path in this module that computes a new
 * `outstandingBalance` derives it from figures that should already keep it in range — but a
 * pre-existing inconsistent Advance (its linked `PayrollEntry.advanceDeduction`/
 * `eidAdvanceDeduction` diverged from what this Advance's own bookkeeping expects, e.g. because it
 * was edited directly on the Payroll Entry before `assertDeductionNotAdvanceLinked`
 * — `payroll-entry.service.ts` — existed) can still produce an out-of-range value here. Called
 * immediately before every `tx.advance.update()` in this file so that case fails with one clear,
 * actionable domain error instead of an unhandled Postgres constraint violation surfacing as a
 * generic 500 (the exact production defect this checkpoint root-caused).
 */
function assertOutstandingBalanceWithinBounds(outstandingBalance: Prisma.Decimal, totalAmount: Prisma.Decimal): void {
  if (outstandingBalance.lessThan(0) || outstandingBalance.greaterThan(totalAmount)) {
    throw conflict(
      `This Advance's outstanding balance (PKR ${outstandingBalance.toFixed(2)}) is inconsistent with its recorded amount ` +
        `(PKR ${totalAmount.toFixed(2)}) — its linked payroll deduction was likely changed outside the Advances module. ` +
        'A Master Admin should review this employee\'s Payroll Entry before this Advance can be edited or cancelled.',
    );
  }
}

async function getAdvanceOrThrow(id: string, client: PrismaTransactionClient = prisma): Promise<AdvanceWithEmployee> {
  const advance = await client.advance.findUnique({ where: { id }, include: advanceWithEmployeeInclude });
  if (!advance) {
    throw notFound('Advance not found');
  }
  return advance;
}

export interface ListAdvancesResult {
  advances: Prisma.AdvanceGetPayload<{ include: typeof advanceListInclude }>[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * v1.0.4 Advances Scalability/Deputation checkpoint. Server-side pagination (`skip`/`take` pushed
 * into the query, mirroring `listPayrollEntries`/the Advance Recovery Report's own proven
 * `Promise.all([count, findMany])` pattern — see `reports-pagination.ts`'s normative rule this
 * follows) — replaces the prior unbounded `findMany` that returned every matching Advance in one
 * response regardless of history size. Deterministic `createdAt desc, id asc` ordering (the `id`
 * tie-break guarantees no row is ever skipped or duplicated across pages even if two Advances share
 * the exact same `createdAt` timestamp).
 *
 * Site filtering now accepts more than one site (`filters.siteIds`) — previously only a single
 * `siteId` could be pushed server-side; the page's own multi-site selector filtered the rest
 * client-side over what was, at the time, always the complete unbounded list. That client-side
 * fallback is no longer correct once results are paginated (a multi-site filter must be applied
 * before pagination, not after), so every selected site is now passed through and access-checked
 * here, exactly like the Advance Recovery Report's own `resolveSiteIdFilter`.
 *
 * `employee: { include: { site: true, unit: true } }` (Deputation Visibility) is a single joined
 * query, not a second per-row fetch — no N+1 risk.
 */
export async function listAdvances(currentUser: SessionUser, filters: ListAdvancesQuery): Promise<ListAdvancesResult> {
  if (filters.siteIds) {
    for (const siteId of filters.siteIds) assertSiteAccess(currentUser, siteId);
  }

  const siteIdFilter = filters.siteIds && filters.siteIds.length > 0
    ? filters.siteIds
    : !isMasterAdmin(currentUser)
      ? currentUser.siteIds
      : undefined;

  const where: Prisma.AdvanceWhereInput = {
    ...(filters.employeeId && { employeeId: filters.employeeId }),
    ...(filters.type && { type: filters.type }),
    ...(filters.status && { status: filters.status }),
    ...(siteIdFilter && { employee: { siteId: { in: siteIdFilter } } }),
  };

  const [total, advances] = await Promise.all([
    prisma.advance.count({ where }),
    prisma.advance.findMany({
      where,
      include: advanceListInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
  ]);

  return { advances, total, page: filters.page, pageSize: filters.pageSize };
}

export async function getAdvance(currentUser: SessionUser, id: string) {
  const advance = await prisma.advance.findUnique({
    where: { id },
    include: {
      employee: { include: { site: true, unit: true } },
      originalScheduledPeriod: true,
      currentScheduledPeriod: true,
      scheduleChanges: { orderBy: { changedAt: 'desc' }, include: { fromPeriod: true, toPeriod: true, changedBy: true } },
    },
  });
  if (!advance) {
    throw notFound('Advance not found');
  }
  assertSiteAccess(currentUser, advance.employee.siteId);
  return advance;
}

/**
 * The earliest payroll period a new Advance's deduction may be scheduled against (Operational
 * Stabilization Checkpoint, 2026-07-24 — BR-ADV-007, closing the gap where the original create form
 * accepted an unconstrained arbitrary `(year, month)`, including an already-past one that could
 * never be picked up by any materialization sweep). The current Draft cycle, if one exists — the
 * earliest a deduction could actually land, per BR-ADV-002's own "future Draft payroll cycle" floor
 * for deferrals; the exact same floor applies to a brand-new Advance's *first* schedule. If no cycle
 * is currently Draft (the narrow window between Finalize and the next rollover, or true first-run),
 * there is no real cycle to anchor against — falling back to today's real calendar month (never an
 * invented cycle) still rejects a genuinely stale past date without pretending a Draft exists.
 */
async function resolveEarliestEligiblePeriodKey(tx: PrismaTransactionClient): Promise<number> {
  const draftCycle = await tx.payrollCycle.findFirst({ where: { status: 'DRAFT' } });
  if (draftCycle) {
    return draftCycle.year * 12 + draftCycle.month;
  }
  const now = new Date();
  return now.getUTCFullYear() * 12 + (now.getUTCMonth() + 1);
}

function assertPeriodAtOrAfterFloor(period: { year: number; month: number }, floorKey: number): void {
  const periodKey = period.year * 12 + period.month;
  if (periodKey < floorKey) {
    throw badRequest(
      'The deduction start cycle cannot be earlier than the current Draft payroll cycle — a past period can never be picked up for deduction',
    );
  }
}

/**
 * The single-Advance materialization step (Operational Stabilization Checkpoint, 2026-07-24) —
 * extracted from `materializeScheduledAdvanceDeductions`'s own per-advance loop body so both the
 * cycle-bootstrap bulk sweep (below) and `createAdvance`'s new immediate-materialization step (also
 * below, Defect D/E's root-cause fix) share the exact one calculation, never two copies that could
 * drift. Applies `advance`'s next due amount onto `entryId` and advances/clears
 * `currentScheduledPeriodId` exactly as the bulk sweep already did — see that function's own doc
 * comment for the FULL_DEDUCTION/INSTALLMENT amount rule. Returns `true` if a deduction was actually
 * applied (`false` for the "no standing INSTALLMENT schedule yet" no-op case, matching the bulk
 * sweep's own `continue`).
 */
async function materializeOneAdvanceDeduction(
  tx: PrismaTransactionClient,
  params: {
    advance: { id: string; type: 'LOAN' | 'EID_ADVANCE'; repaymentType: 'FULL_DEDUCTION' | 'INSTALLMENT'; outstandingBalance: Prisma.Decimal; scheduledInstallmentAmount: Prisma.Decimal | null };
    entryId: string;
    cycleId: string;
    cycleYear: number;
    cycleMonth: number;
    actorUserId: string;
    requestMeta: RequestMeta;
  },
): Promise<boolean> {
  const { advance, entryId, cycleId, cycleYear, cycleMonth, actorUserId, requestMeta } = params;

  let amount: Prisma.Decimal;
  if (advance.repaymentType === 'FULL_DEDUCTION') {
    amount = advance.outstandingBalance;
  } else {
    if (!advance.scheduledInstallmentAmount || advance.scheduledInstallmentAmount.lessThanOrEqualTo(0)) {
      return false; // No standing schedule set yet — nothing to auto-apply.
    }
    amount = Prisma.Decimal.min(advance.scheduledInstallmentAmount, advance.outstandingBalance);
  }

  const newOutstanding = advance.outstandingBalance.minus(amount);
  // Reaching zero here only *reserves* the balance against this still-Draft entry — it does not
  // mean the Advance is actually paid off yet (Presentation & Workflow Stabilization Checkpoint,
  // 2026-07-25, Issue 5). `PAID_OFF` is set later, only once this entry actually Releases
  // (`settleAdvancesForReleasedEntries`, below). If this Draft deduction is itself reversed first
  // (edit/defer/cancel), `RESERVED` reverts to `ACTIVE` exactly like a partial deduction already did.
  const isReserved = newOutstanding.lessThanOrEqualTo(0);

  await tx.payrollEntry.update({
    where: { id: entryId },
    data:
      advance.type === 'LOAN'
        ? { advanceDeduction: amount, advanceId: advance.id, version: { increment: 1 } }
        : { eidAdvanceDeduction: amount, eidAdvanceId: advance.id, version: { increment: 1 } },
  });

  let nextPeriodId: string | null = null;
  if (!isReserved) {
    const nextYear = cycleMonth === 12 ? cycleYear + 1 : cycleYear;
    const nextMonthNum = cycleMonth === 12 ? 1 : cycleMonth + 1;
    const next = await findOrCreateScheduledPayrollPeriod(nextYear, nextMonthNum, tx);
    nextPeriodId = next.id;
  }

  await tx.advance.update({
    where: { id: advance.id },
    data: {
      outstandingBalance: isReserved ? new Prisma.Decimal(0) : newOutstanding,
      status: isReserved ? 'RESERVED' : 'ACTIVE',
      currentScheduledPeriodId: isReserved ? null : nextPeriodId,
      // Never set here — `paidOffAt` is only ever written by `settleAdvancesForReleasedEntries`,
      // at the moment of actual Release, never at Draft-stage reservation.
      paidOffAt: null,
    },
  });

  await recordAuditLog(
    {
      actorUserId,
      action: 'advance.schedule_materialized',
      entityType: 'Advance',
      entityId: advance.id,
      metadata: {
        cycleId,
        payrollEntryId: entryId,
        amount: amount.toFixed(2),
        outstandingBalanceBefore: advance.outstandingBalance.toFixed(2),
        outstandingBalanceAfter: newOutstanding.lessThanOrEqualTo(0) ? '0.00' : newOutstanding.toFixed(2),
        status: isReserved ? 'RESERVED' : 'ACTIVE',
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    },
    tx,
  );

  return true;
}

/**
 * Settles every `RESERVED` Advance whose reservation is carried by one of `entryIds` — called from
 * exactly one place, `payroll-release.service.ts`'s `releaseProjectUnit`, at the exact moment those
 * `PayrollEntry` rows actually flip `released: true` (Presentation & Workflow Stabilization
 * Checkpoint, 2026-07-25, Issue 5). Mirrors `consumeMaterializationsForReleasedEntries`
 * (`corrections.materialization.service.ts`) — the same established "reservation becomes final only
 * at the entry's own release" pattern already used for Correction `BalanceAdjustment`s, applied here
 * to Advances. A `RESERVED` Advance's `outstandingBalance` is already zero (that is what put it into
 * `RESERVED` in the first place) and nothing between reservation and release can change it except a
 * reversal path that would have already moved status back to `ACTIVE` — so this only ever flips
 * `status`/`paidOffAt`, never touches `outstandingBalance` again.
 */
export async function settleAdvancesForReleasedEntries(
  params: { entryIds: string[]; actorUserId: string; requestMeta: RequestMeta },
  tx: PrismaTransactionClient,
): Promise<{ settledCount: number }> {
  const { entryIds, actorUserId, requestMeta } = params;
  if (entryIds.length === 0) {
    return { settledCount: 0 };
  }

  const releasedEntries = await tx.payrollEntry.findMany({
    where: { id: { in: entryIds } },
    select: { advanceId: true, eidAdvanceId: true },
  });

  const advanceIds = new Set<string>();
  for (const entry of releasedEntries) {
    if (entry.advanceId) advanceIds.add(entry.advanceId);
    if (entry.eidAdvanceId) advanceIds.add(entry.eidAdvanceId);
  }
  if (advanceIds.size === 0) {
    return { settledCount: 0 };
  }

  const reservedAdvances = await tx.advance.findMany({
    where: { id: { in: [...advanceIds] }, status: 'RESERVED' },
  });

  const paidOffAt = new Date();
  for (const advance of reservedAdvances) {
    await tx.advance.update({
      where: { id: advance.id },
      data: { status: 'PAID_OFF', paidOffAt },
    });

    await recordAuditLog(
      {
        actorUserId,
        action: 'advance.paid_off',
        entityType: 'Advance',
        entityId: advance.id,
        metadata: { settledViaEntryIds: entryIds },
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      },
      tx,
    );
  }

  return { settledCount: reservedAdvances.length };
}

/**
 * Records a new Advance. `originalPeriod` resolves (find-or-create, never a direct write — see
 * `findOrCreateScheduledPayrollPeriod`) into the `ScheduledPayrollPeriod` both
 * `originalScheduledPeriodId` (immutable forever after, BR-ADV-001) and `currentScheduledPeriodId`
 * (the live pointer) are set to.
 *
 * **Root-cause fix, Operational Stabilization Checkpoint 2026-07-24 (Defect D/E):** production
 * observed an Advance recorded against the current Draft cycle not appearing as a deduction in that
 * cycle's Payroll Entry at all, requiring no code change to "wait it out" — because there wasn't one:
 * `materializeScheduledAdvanceDeductions` only ever runs at cycle *bootstrap*
 * (`payroll-processing.service.ts`'s `createPayrollCycle`/`archiveAndCreateNextPayrollCycle`), a
 * moment that, for any Advance recorded after the current Draft cycle already exists (the ordinary
 * case), has already happened. There was no path that re-materialized a deduction into an
 * *already-open* Draft cycle's existing `PayrollEntry` — not a frontend caching issue, a genuine
 * missing backend step. Fixed the same way `syncEmployeeIntoCurrentDraftCycle`
 * (`payroll-processing.service.ts`) closed the analogous gap for newly-created employees: if the
 * resolved period is the current Draft cycle and this employee already has a still-editable entry in
 * it, materialize immediately, in the same transaction as the Advance's own creation — no separate
 * mutation, no client-side refetch race, no cycle recreation required.
 */
export async function createAdvance(
  currentUser: SessionUser,
  input: CreateAdvanceInput,
  requestMeta: RequestMeta,
) {
  const employee = await prisma.employee.findUnique({ where: { id: input.employeeId } });
  if (!employee) {
    throw notFound('Employee not found');
  }
  assertSiteAccess(currentUser, employee.siteId);

  // Blocks on RESERVED too, not just ACTIVE (Presentation & Workflow Stabilization Checkpoint,
  // 2026-07-25) — a RESERVED Advance's balance already reads zero, but it is not yet confirmed
  // Paid Off (that only happens at actual Release), so a second Advance of the same type still
  // cannot be recorded until it either releases or is cancelled/reversed.
  const existingActive = await prisma.advance.findFirst({
    where: { employeeId: input.employeeId, type: input.type, status: { in: ['ACTIVE', 'RESERVED'] } },
  });
  if (existingActive) {
    const statusDescription =
      existingActive.status === 'RESERVED'
        ? 'reserved against the current Draft payroll (not yet released)'
        : 'ACTIVE';
    throw conflict(
      `This employee already has an ${input.type === 'LOAN' ? 'Advance' : 'Eid Advance'} that is ${statusDescription} — it must be fully paid off before a new one can be recorded`,
    );
  }

  return prisma.$transaction(async (tx) => {
    const floorKey = await resolveEarliestEligiblePeriodKey(tx);
    assertPeriodAtOrAfterFloor(input.originalPeriod, floorKey);

    const period = await findOrCreateScheduledPayrollPeriod(
      input.originalPeriod.year,
      input.originalPeriod.month,
      tx,
    );

    const advance = await tx.advance.create({
      data: {
        employeeId: input.employeeId,
        type: input.type,
        totalAmount: input.totalAmount,
        outstandingBalance: input.totalAmount,
        dateGiven: isoDateToUtcDate(input.dateGiven)!,
        repaymentType: input.repaymentType,
        scheduledInstallmentAmount: input.scheduledInstallmentAmount ?? null,
        notes: input.notes ?? null,
        status: 'ACTIVE',
        originalScheduledPeriodId: period.id,
        currentScheduledPeriodId: period.id,
      },
    });

    await recordAuditLog(
      {
        actorUserId: currentUser.id,
        action: 'advance.created',
        entityType: 'Advance',
        entityId: advance.id,
        metadata: {
          employeeId: input.employeeId,
          type: input.type,
          totalAmount: input.totalAmount,
          repaymentType: input.repaymentType,
          originalPeriod: input.originalPeriod,
        },
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      },
      tx,
    );

    // Immediate materialization (Defect D/E root-cause fix, doc comment above) — only when the
    // resolved period IS the current Draft cycle and this employee already has a still-editable
    // (not released) entry in it. Any other case (a genuinely future period, no Draft cycle yet, or
    // this employee's entry in the current Draft already individually released via a per-Unit Late
    // Entry release) is deliberately left unmaterialized here, exactly as it already was: a future
    // period is picked up at that cycle's own bootstrap, same as before, and an already-released
    // entry is never retroactively modified (Principle 9) — the Advance still exists and its
    // `currentScheduledPeriodId` still points at this period, so it surfaces on the Advances list for
    // manual attention rather than silently vanishing.
    const draftCycle = await tx.payrollCycle.findFirst({ where: { status: 'DRAFT' } });
    if (draftCycle && draftCycle.year === input.originalPeriod.year && draftCycle.month === input.originalPeriod.month) {
      const entry = await tx.payrollEntry.findUnique({
        where: { cycleId_employeeId: { cycleId: draftCycle.id, employeeId: input.employeeId } },
      });
      if (entry && !entry.released) {
        await materializeOneAdvanceDeduction(tx, {
          advance,
          entryId: entry.id,
          cycleId: draftCycle.id,
          cycleYear: draftCycle.year,
          cycleMonth: draftCycle.month,
          actorUserId: currentUser.id,
          requestMeta,
        });
      }
    }

    return tx.advance.findUniqueOrThrow({ where: { id: advance.id } });
  });
}

/**
 * Ordinary field edits — lifecycle-aware, narrowed to exactly `totalAmount`/`dateGiven`/`notes` by
 * explicit business decision (v1.0.2 Advance Edit/Cancel Final Product Semantics checkpoint,
 * 2026-08-25 — see `updateAdvanceSchema`'s own doc comment for the full "why exactly these three"
 * reasoning). Widened from the Operational Stabilization Checkpoint's (2026-07-24) shape, which also
 * allowed `repaymentType`/`scheduledInstallmentAmount`; those are now fixed at creation. The full
 * editability matrix:
 *
 * - `notes`: always editable, at any lifecycle stage, including `PAID_OFF`/`CANCELLED`.
 * - `dateGiven`: always editable, at any lifecycle stage, same as `notes` — traced to have zero
 *   effect on materialization/reservation/release (purely descriptive/reporting), so there is no
 *   lifecycle stage at which it needs to be, or safely can be, blocked.
 * - `totalAmount`: editable while `status = 'ACTIVE'` or `'RESERVED'`, bounded below by what has
 *   already been repaid (`totalAmount - outstandingBalance`, computed from THIS advance's own
 *   already-materialized deductions) — `outstandingBalance` is adjusted by the exact same delta so
 *   it always stays internally consistent (`newOutstanding = newTotalAmount - alreadyRepaid`), never
 *   independently recalculated. Rejected once `PAID_OFF`/`CANCELLED` — reopening a closed Advance is
 *   out of this checkpoint's scope (`status` stays a system-managed field either way; see
 *   `cancelAdvance` for the one user-facing status transition this module exposes).
 * - the deduction start cycle (`originalScheduledPeriodId`/`currentScheduledPeriodId`): never
 *   editable here, at any lifecycle stage. Before materialization, correct it by cancelling this
 *   Advance and recording a fresh one (`cancelAdvance`, below) — never a silent field edit, and never
 *   a hard delete (this schema's own "no hard-deletable financial/master record" convention, see the
 *   `Advance` model's doc comment). After materialization, `deferAdvanceSchedule` is the sanctioned
 *   path, and only that path may write an audited `AdvanceScheduleChange` row (its `payrollEntryId`
 *   column is `NOT NULL` by design — there never was, and still isn't, a "reschedule before it ever
 *   lands" mechanism, matching that function's own doc comment).
 * - `type`, `status`, `repaymentType`, `scheduledInstallmentAmount`: always system-/creation-managed
 *   only, never a plain field edit through this function.
 */
export async function updateAdvance(
  currentUser: SessionUser,
  id: string,
  input: UpdateAdvanceInput,
  requestMeta: RequestMeta,
) {
  const advance = await getAdvanceOrThrow(id);
  assertSiteAccess(currentUser, advance.employee.siteId);

  // v1.0.2 checkpoint: `totalAmount` is now the only remaining "financial" (ledger-affecting)
  // field — the status gate below exists for it alone; `dateGiven`/`notes` bypass it entirely at
  // every lifecycle stage (see the doc comment above). RESERVED is included alongside ACTIVE
  // (unchanged from the prior checkpoint) — a fully-materialized-but-unreleased Advance
  // (outstandingBalance already 0) still has a live, reversible Draft deduction, and Finance needs
  // to correct it without cancelling and re-recording.
  const isFinancialEdit = input.totalAmount !== undefined;
  if (isFinancialEdit && advance.status !== 'ACTIVE' && advance.status !== 'RESERVED') {
    const statusDescription = advance.status === 'PAID_OFF' ? 'fully paid off' : 'cancelled';
    throw badRequest(`This Advance is ${statusDescription} — only its date and notes can still be edited`);
  }

  // Does this edit actually change a value that affects what should be deducted this cycle? A
  // same-value resubmission (e.g. saving the modal after only touching `notes`/`dateGiven`) must not
  // needlessly reverse-and-recalculate an already-correct live Draft deduction — that would bump the
  // entry's `version` and write audit noise for a no-op. `totalAmount` is the only field left that
  // can ever trigger this (`dateGiven`/`notes` never touch the ledger — see the doc comment above).
  const financialValueChanged = input.totalAmount !== undefined && !advance.totalAmount.equals(input.totalAmount);

  const isLoan = advance.type === 'LOAN';

  return prisma.$transaction(async (tx) => {
    /**
     * The live, still-Draft (unreleased) entry currently carrying this Advance's materialized
     * deduction, if any — same lookup `cancelAdvance` uses. **Root-cause fix (post-review, this
     * checkpoint):** a prior version of this function only ever wrote `Advance.totalAmount`/
     * `outstandingBalance` on edit — it never touched an already-materialized Draft deduction, which
     * meant editing `totalAmount` on an Advance that already had a live (unreleased) Draft deduction
     * silently left that Draft figure stale under the OLD rules. Fixed by reversing that deduction
     * first (the identical math `cancelAdvance` and
     * `deferAdvanceSchedule` already use) and re-materializing it under the NEW rules, in the same
     * transaction, via the same shared `materializeOneAdvanceDeduction` helper every other
     * materialization path uses — never a second, independent recalculation. A RELEASED entry is
     * never returned by this query (`released: false`) and is therefore never reversed or touched,
     * regardless of what this edit changes (Principle 9).
     */
    const liveEntry = financialValueChanged
      ? await tx.payrollEntry.findFirst({
          where: isLoan ? { advanceId: advance.id, released: false } : { eidAdvanceId: advance.id, released: false },
          include: { cycle: true },
        })
      : null;

    let effectiveTotalAmount = advance.totalAmount;
    let effectiveOutstandingBalance = advance.outstandingBalance;
    let reversedAmount: Prisma.Decimal | null = null;

    if (liveEntry) {
      assertEntryEditable(liveEntry);
      const deductedAmount = isLoan ? liveEntry.advanceDeduction : liveEntry.eidAdvanceDeduction;
      if (deductedAmount.greaterThan(0)) {
        const guarded = await tx.payrollEntry.updateMany({
          where: { id: liveEntry.id, version: liveEntry.version },
          data: isLoan
            ? { advanceDeduction: '0', advanceId: null, version: { increment: 1 } }
            : { eidAdvanceDeduction: '0', eidAdvanceId: null, version: { increment: 1 } },
        });
        if (guarded.count === 0) {
          throw conflict('This payroll entry was changed by someone else — reload and try again');
        }
        reversedAmount = deductedAmount;
        // The true, permanent floor for a `totalAmount` reduction is what has been repaid via
        // RELEASED payroll only — restoring this cycle's still-reversible live deduction back onto
        // the balance here (before the `totalAmount` floor check below) is what excludes it
        // correctly, rather than treating a not-yet-released figure as if it were locked in.
        effectiveOutstandingBalance = advance.outstandingBalance.plus(deductedAmount);
      }
    }

    if (input.totalAmount !== undefined) {
      const newTotalAmount = new Prisma.Decimal(input.totalAmount);
      // `decimalString` (shared/src/schemas/advance.ts) only validates decimal *format* — a zero or
      // negative amount would otherwise reach the DB's own `Advance_totalAmount_check` (`totalAmount
      // > 0`) CHECK constraint unvalidated, surfacing as the same class of unhandled 500 this
      // checkpoint's `assertOutstandingBalanceWithinBounds` already fixes for `outstandingBalance`.
      if (newTotalAmount.lessThanOrEqualTo(0)) {
        throw badRequest('Total amount must be greater than zero');
      }
      const alreadyRepaid = effectiveTotalAmount.minus(effectiveOutstandingBalance);
      if (newTotalAmount.lessThan(alreadyRepaid)) {
        throw badRequest(
          `Total amount cannot be reduced below the ${alreadyRepaid.toFixed(2)} already repaid against this Advance`,
        );
      }
      effectiveOutstandingBalance = newTotalAmount.minus(alreadyRepaid);
      effectiveTotalAmount = newTotalAmount;
    }

    if (input.totalAmount !== undefined || reversedAmount) {
      assertOutstandingBalanceWithinBounds(effectiveOutstandingBalance, effectiveTotalAmount);
    }

    const data: Prisma.AdvanceUncheckedUpdateInput = {
      ...(input.notes !== undefined && { notes: input.notes }),
      ...(input.dateGiven !== undefined && { dateGiven: isoDateToUtcDate(input.dateGiven)! }),
      ...(input.totalAmount !== undefined && { totalAmount: effectiveTotalAmount }),
      ...((input.totalAmount !== undefined || reversedAmount) && { outstandingBalance: effectiveOutstandingBalance }),
    };

    const changes = diffFields(advance as unknown as Record<string, unknown>, data as unknown as Record<string, unknown>);

    // Concurrency guard (v1.0.2 checkpoint) — `Advance` carries no `version` column of its own
    // (unlike `PayrollEntry`), so this compares-and-swaps atomically on the exact fields this
    // function's own math was computed from (`status`/`outstandingBalance`/`totalAmount`) in one
    // SQL statement, exactly mirroring the proven `PayrollEntry` `updateMany({ where: { id,
    // version } })` pattern used a few lines above for the live entry. A prior version of this
    // guard used a separate `findUniqueOrThrow` read followed by a plain `.update()` — that has a
    // real, provable TOCTOU gap (two concurrent calls can both pass the read-check before either
    // commits its write), caught by this checkpoint's own concurrency tests; a single guarded
    // `updateMany` closes it, since Postgres evaluates the `WHERE` clause and applies the write
    // atomically, and a transaction that would touch an already-changed row blocks until the
    // winner commits, then correctly re-evaluates against the post-commit values. Ordinarily a
    // concurrent Edit/Cancel racing on the exact same live Draft deduction is already caught by
    // the `PayrollEntry`-side guard above (both this function and `cancelAdvance` touch it first);
    // this is what catches the remaining case — two concurrent calls that both find no live entry
    // to serialize on (e.g. two Advance edits before materialization, or a duplicate Cancel).
    const guardedAdvance = await tx.advance.updateMany({
      where: { id, status: advance.status, outstandingBalance: advance.outstandingBalance, totalAmount: advance.totalAmount },
      data,
    });
    if (guardedAdvance.count === 0) {
      throw conflict('This Advance was changed by someone else — reload and try again');
    }
    const updated = await tx.advance.findUniqueOrThrow({ where: { id } });

    if (Object.keys(changes).length > 0) {
      await recordAuditLog(
        {
          actorUserId: currentUser.id,
          action: 'advance.updated',
          entityType: 'Advance',
          entityId: id,
          metadata: { changes },
          ipAddress: requestMeta.ipAddress,
          userAgent: requestMeta.userAgent,
        },
        tx,
      );
    }

    if (liveEntry && reversedAmount) {
      await recordAuditLog(
        {
          actorUserId: currentUser.id,
          action: 'payroll_entry.advance_edit_reversed',
          entityType: 'PayrollEntry',
          entityId: liveEntry.id,
          metadata: { advanceId: id, reversedAmount: reversedAmount.toFixed(2) },
          ipAddress: requestMeta.ipAddress,
          userAgent: requestMeta.userAgent,
        },
        tx,
      );

      // Re-materializes the SAME cycle's deduction under the NEW rules — exactly once, via the one
      // shared calculation every other materialization path uses (never a second, independent one).
      await materializeOneAdvanceDeduction(tx, {
        advance: { ...updated, id: updated.id },
        entryId: liveEntry.id,
        cycleId: liveEntry.cycle.id,
        cycleYear: liveEntry.cycle.year,
        cycleMonth: liveEntry.cycle.month,
        actorUserId: currentUser.id,
        requestMeta,
      });
    }

    return tx.advance.findUniqueOrThrow({ where: { id } });
  });
}

/**
 * Cancels (voids) an Advance — the non-destructive, auditable correction for one entered by mistake
 * (Operational Stabilization Checkpoint, 2026-07-24, `database/advances.md §15`, Section G). Applies
 * uniformly whether or not any deduction has yet materialized: an Advance with zero history is
 * cancelled exactly the same way as one with a partial deduction already sitting in the current
 * Draft cycle — the only difference is whether there is a live Draft deduction to reverse first.
 *
 * **Never touches a RELEASED deduction** — if this Advance's only materialized history is already
 * released payroll, cancellation simply stops any further deduction (clears the live schedule
 * pointer) without altering that released `PayrollEntry` in any way (Principle 9). If a still-Draft
 * (unreleased) deduction currently carries this Advance's linkage, it is reversed first — the exact
 * same zero-the-entry-fields-and-restore-the-balance step `deferAdvanceSchedule` already performs —
 * so no dangling deduction is left referencing a cancelled Advance.
 *
 * Deliberately a status transition, never a delete: this schema has no delete path for `Advance` at
 * all (see the model's own doc comment) — the same non-destructive convention already governs every
 * other permanent financial/master record in this system (Employee's departure instead of deletion
 * being the direct precedent).
 */
export async function cancelAdvance(
  currentUser: SessionUser,
  id: string,
  input: CancelAdvanceInput,
  requestMeta: RequestMeta,
) {
  const advance = await getAdvanceOrThrow(id);
  assertSiteAccess(currentUser, advance.employee.siteId);

  // RESERVED is cancellable too (Presentation & Workflow Stabilization Checkpoint, 2026-07-25) —
  // it means a deduction fully covering the balance is sitting on a still-Draft (unreleased) entry,
  // not that the Advance is actually confirmed Paid Off yet, so voiding it and reversing that Draft
  // deduction is still meaningful right up until the entry releases.
  if (advance.status !== 'ACTIVE' && advance.status !== 'RESERVED') {
    throw badRequest(
      `This Advance is already ${advance.status === 'PAID_OFF' ? 'fully paid off' : 'cancelled'} — there is nothing to cancel`,
    );
  }

  const reason = input.reason.trim();
  if (reason.length === 0) {
    throw badRequest('A reason is required');
  }

  const isLoan = advance.type === 'LOAN';

  return prisma.$transaction(async (tx) => {
    // The live, still-Draft (unreleased) entry currently carrying this Advance's deduction, if any —
    // at most one can exist at a time (an already-released cycle's own linked entry is excluded by
    // `released: false`, and `currentScheduledPeriodId` only ever points at one live target).
    const liveEntry = await tx.payrollEntry.findFirst({
      where: isLoan ? { advanceId: advance.id, released: false } : { eidAdvanceId: advance.id, released: false },
      include: { cycle: true },
    });

    let restoredAmount: Prisma.Decimal | null = null;
    let outstandingAfterReversal = advance.outstandingBalance;

    if (liveEntry) {
      assertEntryEditable(liveEntry);
      const deductedAmount = isLoan ? liveEntry.advanceDeduction : liveEntry.eidAdvanceDeduction;
      if (deductedAmount.greaterThan(0)) {
        const guarded = await tx.payrollEntry.updateMany({
          where: { id: liveEntry.id, version: liveEntry.version },
          data: isLoan
            ? { advanceDeduction: '0', advanceId: null, version: { increment: 1 } }
            : { eidAdvanceDeduction: '0', eidAdvanceId: null, version: { increment: 1 } },
        });
        if (guarded.count === 0) {
          throw conflict('This payroll entry was changed by someone else — reload and try again');
        }
        restoredAmount = deductedAmount;
        outstandingAfterReversal = advance.outstandingBalance.plus(deductedAmount);
      }
    }

    assertOutstandingBalanceWithinBounds(outstandingAfterReversal, advance.totalAmount);

    // Concurrency guard (v1.0.2 checkpoint) — see `updateAdvance`'s identical guard for the full
    // reasoning: a single atomic compare-and-swap `updateMany`, not a separate read-then-write,
    // closes the real TOCTOU gap two concurrent Cancel calls (or an Edit racing a Cancel) would
    // otherwise hit when there's no shared live `PayrollEntry` row to serialize them on.
    const guardedCancel = await tx.advance.updateMany({
      where: { id, status: advance.status, outstandingBalance: advance.outstandingBalance },
      data: {
        status: 'CANCELLED',
        outstandingBalance: outstandingAfterReversal,
        currentScheduledPeriodId: null,
      },
    });
    if (guardedCancel.count === 0) {
      throw conflict('This Advance was changed by someone else — reload and try again');
    }
    const cancelled = await tx.advance.findUniqueOrThrow({ where: { id } });

    await recordAuditLog(
      {
        actorUserId: currentUser.id,
        action: 'advance.cancelled',
        entityType: 'Advance',
        entityId: id,
        metadata: {
          reason,
          reversedPayrollEntryId: liveEntry?.id ?? null,
          reversedAmount: restoredAmount ? restoredAmount.toFixed(2) : null,
          outstandingBalanceAfter: outstandingAfterReversal.toFixed(2),
        },
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      },
      tx,
    );

    if (liveEntry && restoredAmount) {
      await recordAuditLog(
        {
          actorUserId: currentUser.id,
          action: 'payroll_entry.advance_cancelled',
          entityType: 'PayrollEntry',
          entityId: liveEntry.id,
          metadata: { advanceId: id, reason, reversedAmount: restoredAmount.toFixed(2) },
          ipAddress: requestMeta.ipAddress,
          userAgent: requestMeta.userAgent,
        },
        tx,
      );
    }

    return cancelled;
  });
}

/**
 * Defers an Advance's currently-materialized deduction to a future Draft-eligible payroll period
 * (BR-ADV-002–006). Deliberately only ever operates on a deduction that has already materialized
 * into a real, still-Draft `PayrollEntry` — there is no "reschedule before it ever lands" action
 * (a genuinely simpler design than a pre-materialization reschedule path would be, and it matches
 * `AdvanceScheduleChange.payrollEntryId` being mandatory in the frozen schema).
 */
export async function deferAdvanceSchedule(
  currentUser: SessionUser,
  advanceId: string,
  input: DeferAdvanceScheduleInput,
  requestMeta: RequestMeta,
) {
  const advance = await getAdvanceOrThrow(advanceId);
  assertSiteAccess(currentUser, advance.employee.siteId);

  const entry = await prisma.payrollEntry.findUnique({
    where: { id: input.payrollEntryId },
    include: { cycle: true },
  });
  if (!entry) {
    throw notFound('Payroll entry not found');
  }
  assertSiteAccess(currentUser, entry.siteId);
  assertEntryEditable(entry);

  const isLoan = advance.type === 'LOAN';
  const linkedId = isLoan ? entry.advanceId : entry.eidAdvanceId;
  if (linkedId !== advance.id) {
    throw badRequest("This payroll entry is not currently carrying this advance's deduction");
  }

  // The exact amount THIS entry deducted — reversed back onto the balance below. Deliberately not
  // read from `advance.currentScheduledPeriodId`/`.status`: a `FULL_DEDUCTION` advance is marked
  // `PAID_OFF` the instant its deduction materializes, but the entry hasn't released yet, so
  // nothing about that is final — deferral must still be able to undo it (BR-ADV-002 applies to
  // "the deduction," not only to advances that happen to still read as `ACTIVE`).
  const deductedAmount = isLoan ? entry.advanceDeduction : entry.eidAdvanceDeduction;
  if (deductedAmount.lessThanOrEqualTo(0)) {
    throw badRequest('This payroll entry has no advance deduction to defer');
  }

  const targetKey = input.toPeriod.year * 12 + input.toPeriod.month;
  const currentCycleKey = entry.cycle.year * 12 + entry.cycle.month;
  if (targetKey <= currentCycleKey) {
    throw badRequest('An advance deduction may only be deferred to a future payroll period');
  }

  const conflictingCycle = await prisma.payrollCycle.findUnique({
    where: { year_month: { year: input.toPeriod.year, month: input.toPeriod.month } },
  });
  if (conflictingCycle && conflictingCycle.status !== 'DRAFT') {
    throw badRequest('This target period has already been released or archived and can no longer accept a deferred deduction');
  }

  const reason = input.reason.trim();
  if (reason.length === 0) {
    throw badRequest('A reason is required');
  }

  return prisma.$transaction(async (tx) => {
    // The "from" period is this entry's own cycle — where the deduction actually was — never
    // `advance.currentScheduledPeriodId`, which may have already auto-advanced past it (the
    // ordinary INSTALLMENT case) or been cleared to null (the FULL_DEDUCTION PAID_OFF case).
    const fromPeriod = await findOrCreateScheduledPayrollPeriod(entry.cycle.year, entry.cycle.month, tx);
    const toPeriod = await findOrCreateScheduledPayrollPeriod(input.toPeriod.year, input.toPeriod.month, tx);

    const guarded = await tx.payrollEntry.updateMany({
      where: { id: entry.id, version: entry.version },
      data: isLoan
        ? { advanceDeduction: '0', advanceId: null, version: { increment: 1 } }
        : { eidAdvanceDeduction: '0', eidAdvanceId: null, version: { increment: 1 } },
    });
    if (guarded.count === 0) {
      throw conflict('This payroll entry was changed by someone else — reload and try again');
    }

    const restoredBalance = advance.outstandingBalance.plus(deductedAmount);
    assertOutstandingBalanceWithinBounds(restoredBalance, advance.totalAmount);

    // Concurrency guard (v1.0.2 checkpoint) — same atomic compare-and-swap as `updateAdvance`/
    // `cancelAdvance`; this path always has a live entry (required above), so the entry-side
    // version guard already serializes the common race, but this keeps the Advance write itself
    // consistent with its siblings rather than leaving it as the one plain, unguarded `.update()`.
    const guardedDefer = await tx.advance.updateMany({
      where: { id: advanceId, status: advance.status, outstandingBalance: advance.outstandingBalance },
      data: {
        outstandingBalance: restoredBalance,
        status: 'ACTIVE',
        currentScheduledPeriodId: toPeriod.id,
        paidOffAt: null,
      },
    });
    if (guardedDefer.count === 0) {
      throw conflict('This Advance was changed by someone else — reload and try again');
    }
    const updatedAdvance = await tx.advance.findUniqueOrThrow({ where: { id: advanceId } });

    await tx.advanceScheduleChange.create({
      data: {
        advanceId,
        payrollEntryId: entry.id,
        fromPeriodId: fromPeriod.id,
        toPeriodId: toPeriod.id,
        reason,
        changedById: currentUser.id,
      },
    });

    await recordAuditLog(
      {
        actorUserId: currentUser.id,
        action: 'advance.deferred',
        entityType: 'Advance',
        entityId: advanceId,
        metadata: {
          payrollEntryId: entry.id,
          fromPeriod: { year: entry.cycle.year, month: entry.cycle.month },
          toPeriod: input.toPeriod,
          amountRestored: deductedAmount.toFixed(2),
          reason,
        },
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      },
      tx,
    );

    await recordAuditLog(
      {
        actorUserId: currentUser.id,
        action: 'payroll_entry.advance_deferred',
        entityType: 'PayrollEntry',
        entityId: entry.id,
        metadata: { advanceId, toPeriod: input.toPeriod, reason },
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      },
      tx,
    );

    return updatedAdvance;
  });
}

export interface MaterializeScheduledAdvanceDeductionsParams {
  cycleId: string;
  /** The `(year, month)` the resolved period itself names — the caller already knows this (it's
   * the new cycle's own year/month), so this function never needs to re-fetch the period row just
   * to compute "the following month" for advancing a not-yet-paid-off advance's pointer. */
  cycleYear: number;
  cycleMonth: number;
  resolvedPeriodId: string;
  employeeIdToEntryId: Map<string, string>;
  actorUserId: string;
  requestMeta: RequestMeta;
}

/**
 * The Advances half of the new-cycle bootstrap integration (Phase 4 Checkpoint 5) — called
 * directly from `payroll-processing.service.ts`'s `createPayrollCycle` and
 * `archiveAndCreateNextPayrollCycle` (Phase 5 Checkpoint 3), never a generic registry (approved
 * architecture decision). Runs inside the caller's own transaction. Returns the number of advances
 * actually materialized (excludes any `continue`d below) — Checkpoint 3's rollover audit
 * (`payroll_cycle.rollover_completed`) reports this count directly rather than re-deriving it.
 *
 * For every `ACTIVE` Advance whose `currentScheduledPeriodId` resolves to this cycle: `FULL_DEDUCTION`
 * deducts the entire `outstandingBalance` in one shot; `INSTALLMENT` deducts
 * `min(scheduledInstallmentAmount, outstandingBalance)` **only if** a `scheduledInstallmentAmount`
 * has been set — an `INSTALLMENT` advance with no standing schedule yet is deliberately left
 * unmaterialized (no value is ever computed by the system).
 *
 * **Departed employees (Phase 5 Checkpoint 3, closes this doc comment's own former gap):** a
 * departed employee whose scheduled period arrives now DOES have a new entry — rollover's own
 * bootstrap (`payroll-processing.service.ts`) includes every departed employee with an `ACTIVE`
 * Advance due this exact period, specifically so this function can reach them. `employeeIdToEntryId`
 * lacking an employee is therefore only expected via `createPayrollCycle`'s first-cycle-only path
 * (which by definition has no prior cycle for anyone to have departed from) or as a defensive
 * fallback should a future caller ever build the map incompletely.
 */
export async function materializeScheduledAdvanceDeductions(
  params: MaterializeScheduledAdvanceDeductionsParams,
  tx: PrismaTransactionClient,
): Promise<number> {
  const { cycleId, cycleYear, cycleMonth, resolvedPeriodId, employeeIdToEntryId, actorUserId, requestMeta } = params;

  const dueAdvances = await tx.advance.findMany({
    where: { status: 'ACTIVE', currentScheduledPeriodId: resolvedPeriodId },
  });

  let materializedCount = 0;

  for (const advance of dueAdvances) {
    const entryId = employeeIdToEntryId.get(advance.employeeId);
    if (!entryId) {
      // Phase 5 Checkpoint 3 closed the ordinary version of this gap — a departed employee with a
      // scheduled deduction due this period is now included in the new cycle's own bootstrap
      // (`payroll-processing.service.ts`'s `archiveAndCreateNextPayrollCycle`), so `entryId` is
      // normally found. This branch remains reachable only via `createPayrollCycle`'s own
      // first-cycle-only path (never a departed employee, by definition — there is no prior cycle
      // to have departed from) and as a defensive fallback if `employeeIdToEntryId` is ever built
      // incompletely by a future caller.
      continue;
    }

    // Shared with `createAdvance`'s own immediate-materialization step — see that function's helper
    // doc comment for why this is now one calculation, not two (Operational Stabilization
    // Checkpoint, 2026-07-24).
    const materialized = await materializeOneAdvanceDeduction(tx, {
      advance,
      entryId,
      cycleId,
      cycleYear,
      cycleMonth,
      actorUserId,
      requestMeta,
    });
    if (materialized) {
      materializedCount += 1;
    }
  }

  return materializedCount;
}
