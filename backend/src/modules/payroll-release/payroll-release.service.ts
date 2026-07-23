import type { SessionUser } from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { badRequest, conflict, notFound } from '../../common/http-error';
import type { RequestMeta } from '../../common/request-meta';
import { recordAuditLog } from '../audit-log/audit-log.service';
import { assertSiteAccess } from '../../common/authz-policy';
import { consumeMaterializationsForReleasedEntries } from '../corrections/corrections.materialization.service';
import { lockPayrollCycleForUpdate } from '../corrections/corrections.repository';

/**
 * Salary Release foundation (Phase 4 Checkpoint 2, docs/architecture/database/release.md §12b) —
 * owns `PayrollUnitRelease`, the release event for one Project Unit, for one cycle, and the sweep
 * that derives `PayrollEntry.released` from it. `PayrollUnitReadiness` ("Ready for Release") and
 * the Late Entry one-off release path are both explicitly deferred past this checkpoint — see
 * docs/PROJECT_PROGRESS.md's Phase 4 Checkpoint 2 entry for the scope decision.
 *
 * **Phase 6 Checkpoint 7 addition:** `releaseProjectUnit` is the exact moment `PayrollEntry.released`
 * flips true — the schema's own definition of "the triggering PayrollEntry release" a `DEFERRED
 * PAYABLE`/`RECOVERY` `BalanceAdjustment` settles through
 * (`docs/architecture/database/balance-adjustments.md §14`). It now also acquires
 * `lockPayrollCycleForUpdate` (`corrections.repository.ts`) as the *first* lock in its own
 * transaction — becoming a third participant in Checkpoint 5's documented "cycle, then adjustment"
 * lock order, alongside Draft-cycle materialization — and, immediately after the `toRelease` sweep,
 * calls `consumeMaterializationsForReleasedEntries` to flip every `ACTIVE`
 * `BalanceAdjustmentMaterialization` reserved against those entries to `CONSUMED`, inside this same
 * transaction. See that function's own doc comment (`corrections.materialization.service.ts`) for
 * the full settlement mechanics.
 */

export interface UnitReleaseStatus {
  unit: { id: string; name: string; code: string | null; isActive: boolean };
  released: boolean;
  releasedAt: string | null;
  releasedBy: { id: string; name: string } | null;
  /** Entries in this cycle, at this Site, whose work lines touch this Unit — regardless of
   * whether they're already released via some other Unit's earlier sweep. */
  entryCount: number;
  /** Among `entryCount`, how many would flip to `released = true` right now if this Unit released
   * — i.e. every *other* Unit they also touch has already released. Always `0` once this Unit
   * itself has released (there is nothing left to release). Purely informational, computed fresh
   * on every read — never stored (Principle 5). */
  willReleaseCount: number;
}

/**
 * Per-Unit release status for one Site within one cycle — what the Release UI's unit list and
 * confirmation dialog are both built from. Site-scoped exactly like every other Payroll Entry
 * read (`assertSiteAccess`); Master User and Finance/Payroll Staff assigned to this Site may call
 * it, matching `docs/architecture/authentication.md`'s "Finance can see what it's about to
 * release" and Payroll Staff's own read access to their own sites' payroll data.
 */
export async function getUnitReleaseStatus(
  currentUser: SessionUser,
  cycleId: string,
  siteId: string,
): Promise<UnitReleaseStatus[]> {
  assertSiteAccess(currentUser, siteId);

  const cycle = await prisma.payrollCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) {
    throw notFound('Payroll cycle not found');
  }

  const units = await prisma.projectUnit.findMany({ where: { siteId }, orderBy: { name: 'asc' } });
  if (units.length === 0) {
    return [];
  }
  const unitIds = units.map((unit) => unit.id);

  const [releases, entries] = await Promise.all([
    prisma.payrollUnitRelease.findMany({
      where: { cycleId, unitId: { in: unitIds } },
      include: { releasedBy: true },
    }),
    // Scoped to this one Site, not the whole cycle — a PayrollEntryWorkLine can never reference a
    // Unit outside its parent entry's own Site (Principle 7), so this is already the complete set
    // of entries any of this Site's Units could possibly touch, and stays bounded to one Site's
    // headcount rather than the whole company's (Principle 10).
    prisma.payrollEntry.findMany({
      where: { cycleId, siteId },
      select: { id: true, released: true, workLines: { select: { unitId: true } } },
    }),
  ]);

  const releaseByUnitId = new Map(releases.map((release) => [release.unitId, release]));
  const releasedUnitIdSet = new Set(releases.map((release) => release.unitId));

  return units.map((unit) => {
    const touching = entries.filter((entry) => entry.workLines.some((line) => line.unitId === unit.id));
    const release = releaseByUnitId.get(unit.id);

    const willReleaseCount = release
      ? 0
      : touching.filter((entry) => {
          if (entry.released) return false;
          const touchedUnitIds = new Set(entry.workLines.map((line) => line.unitId));
          touchedUnitIds.delete(unit.id);
          return [...touchedUnitIds].every((id) => releasedUnitIdSet.has(id));
        }).length;

    return {
      unit: { id: unit.id, name: unit.name, code: unit.code, isActive: unit.isActive },
      released: Boolean(release),
      releasedAt: release?.releasedAt.toISOString() ?? null,
      releasedBy: release ? { id: release.releasedBy.id, name: release.releasedBy.name } : null,
      entryCount: touching.length,
      willReleaseCount,
    };
  });
}

export interface ReleaseUnitResult {
  release: { id: string; cycleId: string; unitId: string; releasedAt: string; releasedById: string };
  releasedEntryCount: number;
  /** Phase 6 Checkpoint 7 — how many `ACTIVE` `BalanceAdjustmentMaterialization` reservations this
   * release consumed (flipped to `CONSUMED`, realized as a `BalanceAdjustmentSettlement`). `0` on
   * every release before Checkpoint 5's materialization existed, or when none of the entries this
   * Unit just released happened to carry an active reservation. */
  correctionSettlementsConsumed: number;
}

/**
 * Releases one Project Unit for one cycle — inserts the immutable `PayrollUnitRelease` event row
 * and, in the same transaction, sweeps every non-held `PayrollEntry` at this Unit's own Site whose
 * work lines touch it. An entry flips to `released = true` only once *every* distinct Unit its
 * work lines touch has its own release row — a multi-unit split employee waits for all of them,
 * preserving one entry/one net salary/one downstream document even when split (Principle 1, 6).
 *
 * There is deliberately no "un-release" — `PayrollUnitRelease` is insert-once, unique on
 * `(cycleId, unitId)` (Principle 9), and every field this action reads off `PayrollEntry`
 * (`siteId`, bank details, designation) was already frozen at entry-creation/edit time, not
 * re-derived here — release only ever flips the `released` flag, it never touches those values, so
 * the entry it locks is already the exact permanent snapshot Principle 9 requires.
 */
export async function releaseProjectUnit(
  currentUser: SessionUser,
  cycleId: string,
  unitId: string,
  requestMeta: RequestMeta,
): Promise<ReleaseUnitResult> {
  const unit = await prisma.projectUnit.findUnique({ where: { id: unitId } });
  if (!unit) {
    throw notFound('Project unit not found');
  }

  assertSiteAccess(currentUser, unit.siteId);

  const cycle = await prisma.payrollCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) {
    throw notFound('Payroll cycle not found');
  }
  if (cycle.status !== 'DRAFT') {
    throw badRequest('Only a Project Unit in the current Draft cycle can be released');
  }

  const existing = await prisma.payrollUnitRelease.findUnique({
    where: { cycleId_unitId: { cycleId, unitId } },
  });
  if (existing) {
    throw conflict('This Project Unit has already been released for this cycle');
  }

  return prisma.$transaction(
    async (tx) => {
      // Phase 6 Checkpoint 7 — first in the documented "cycle, then adjustment" lock order
      // (`corrections.materialization.service.ts`), making this transaction a third participant
      // alongside Draft-cycle materialization and Finalize Cycle's own implicit row lock. Also
      // closes a pre-existing, unrelated race for free: re-confirms `status = 'DRAFT'` under lock,
      // since the earlier pre-transaction check could otherwise be stale against a concurrent
      // Finalize Cycle call.
      const lockedCycle = await lockPayrollCycleForUpdate(cycleId, tx);
      if (!lockedCycle || lockedCycle.status !== 'DRAFT') {
        throw conflict('This payroll cycle is no longer Draft');
      }

      const release = await tx.payrollUnitRelease.create({
        data: { cycleId, unitId, releasedById: currentUser.id },
      });

      await recordAuditLog(
        {
          actorUserId: currentUser.id,
          action: 'payroll_unit.released',
          entityType: 'PayrollUnitRelease',
          entityId: release.id,
          metadata: { cycleId, unitId, siteId: unit.siteId },
          ipAddress: requestMeta.ipAddress,
          userAgent: requestMeta.userAgent,
        },
        tx,
      );

      const candidates = await tx.payrollEntry.findMany({
        where: { cycleId, siteId: unit.siteId, released: false, hold: false, workLines: { some: { unitId } } },
        select: { id: true, workLines: { select: { unitId: true } } },
      });

      let releasedEntryCount = 0;
      let releasedEntryIds: string[] = [];

      if (candidates.length > 0) {
        const otherTouchedUnitIds = new Set<string>();
        for (const entry of candidates) {
          for (const line of entry.workLines) {
            if (line.unitId !== unitId) otherTouchedUnitIds.add(line.unitId);
          }
        }

        const otherReleases = otherTouchedUnitIds.size
          ? await tx.payrollUnitRelease.findMany({
              where: { cycleId, unitId: { in: [...otherTouchedUnitIds] } },
              select: { unitId: true },
            })
          : [];
        const releasedElsewhere = new Set(otherReleases.map((r) => r.unitId));

        const toRelease = candidates.filter((entry) =>
          entry.workLines.every((line) => line.unitId === unitId || releasedElsewhere.has(line.unitId)),
        );

        if (toRelease.length > 0) {
          const releasedAt = new Date();
          await tx.payrollEntry.updateMany({
            where: { id: { in: toRelease.map((entry) => entry.id) } },
            data: { released: true, releasedAt, releasedBy: currentUser.id, version: { increment: 1 } },
          });

          // One `payroll_entry.released` entry per swept entry (release.md §12b's explicit
          // requirement) — bounded by this one Unit's own headcount, not the whole cycle's, so
          // this loop stays small even at the 10,000-employee design floor (Principle 10).
          for (const entry of toRelease) {
            await recordAuditLog(
              {
                actorUserId: currentUser.id,
                action: 'payroll_entry.released',
                entityType: 'PayrollEntry',
                entityId: entry.id,
                metadata: { cycleId, triggeringUnitId: unitId, releaseId: release.id },
                ipAddress: requestMeta.ipAddress,
                userAgent: requestMeta.userAgent,
              },
              tx,
            );
          }

          releasedEntryCount = toRelease.length;
          releasedEntryIds = toRelease.map((entry) => entry.id);
        }
      }

      // Phase 6 Checkpoint 7 — second in the lock order, per adjustment, acquired inside
      // `consumeMaterializationsForReleasedEntries` itself. Scoped to exactly the entries that
      // just flipped `released: true` in this call — an entry already released before this Unit's
      // sweep ran keeps whatever happened at its own release event, never revisited here.
      const consumption = await consumeMaterializationsForReleasedEntries(
        {
          entryIds: releasedEntryIds,
          releasingCycleId: cycleId,
          actorUserId: currentUser.id,
          requestMeta,
        },
        tx,
      );

      return {
        release: {
          id: release.id,
          cycleId: release.cycleId,
          unitId: release.unitId,
          releasedAt: release.releasedAt.toISOString(),
          releasedById: release.releasedById,
        },
        releasedEntryCount,
        correctionSettlementsConsumed: consumption.consumedCount,
      };
    },
    { timeout: 30_000 },
  );
}
