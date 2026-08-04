import type { SessionUser } from '@payroll/shared';
import { Decimal } from 'decimal.js';
import { prisma } from '../../lib/prisma';
import { badRequest, conflict, notFound } from '../../common/http-error';
import type { RequestMeta } from '../../common/request-meta';
import { recordAuditLog } from '../audit-log/audit-log.service';
import { assertSiteAccess, isMasterAdmin } from '../../common/authz-policy';
import { consumeMaterializationsForReleasedEntries } from '../corrections/corrections.materialization.service';
import { computeReleaseRecoveryAdjustment } from '../corrections/corrections.materialization';
import { lockPayrollCycleForUpdate } from '../corrections/corrections.repository';
import { createNegativePayrollRecoveryAdjustment } from '../corrections/corrections.service';
import { settleAdvancesForReleasedEntries } from '../advances/advances.service';
import { computeEntryCalc, WORK_LINES_INCLUDE } from '../payroll-entry/payroll-entry.service';
import { evaluatePayrollEntryReleaseReadiness } from './payroll-release-eligibility';

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
   * — i.e. every *other* Unit they also touch has already released *and* the entry isn't currently
   * Held (Hold Workflow Verification, Phase 7F, 2026-08-04 — fixed a real inconsistency: this count
   * previously included Held entries even though `releaseProjectUnit` itself has always excluded
   * them, so the Release confirmation dialog overstated how many employees were actually about to
   * be paid). Always `0` once this Unit itself has released (there is nothing left to release).
   * Purely informational, computed fresh on every read — never stored (Principle 5). */
  willReleaseCount: number;
  /** Among `entryCount`, how many are currently on Hold (`hold: true`, still unresolved) — Hold
   * Workflow Verification, Phase 7F, 2026-08-04. Never included in `willReleaseCount`; closes the
   * "operator can't see why an employee isn't about to release" visibility gap this checkpoint's
   * own workflow audit found (`docs/PROJECT_PROGRESS.md`'s Phase 7F entry). */
  heldCount: number;
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
      select: { id: true, released: true, hold: true, payoutOutcome: true, workLines: { select: { unitId: true } } },
    }),
  ]);

  const releaseByUnitId = new Map(releases.map((release) => [release.unitId, release]));
  const releasedUnitIdSet = new Set(releases.map((release) => release.unitId));

  return units.map((unit) => {
    const touching = entries.filter((entry) => entry.workLines.some((line) => line.unitId === unit.id));
    const release = releaseByUnitId.get(unit.id);

    // Negative Payroll Recovery checkpoint (2026-07-26) — an entry already resolved by an earlier
    // release sweep as NO_PAY_DUE/RECOVERY_DUE is just as "nothing left to release" as one that's
    // `released = true`; both must be excluded here the same way. Hold Workflow Verification
    // (Phase 7F, 2026-08-04) — `entry.hold` is excluded too, matching `releaseProjectUnit`'s own
    // candidate query (`hold: false`), which this count had drifted out of sync with. **No longer
    // short-circuited to `0` just because this Unit already released** (the pre-Phase-7F shape) —
    // `releaseProjectUnit` itself now performs a Late/Straggler Sweep for exactly this case (an
    // entry Held when this Unit originally released, since un-Held), so this count must keep
    // reflecting it afterward too, or the Release page would never show the operator anything left
    // to act on.
    const willReleaseCount = touching.filter((entry) => {
      if (entry.released || entry.hold || entry.payoutOutcome !== null) return false;
      const touchedUnitIds = new Set(entry.workLines.map((line) => line.unitId));
      touchedUnitIds.delete(unit.id);
      return [...touchedUnitIds].every((id) => releasedUnitIdSet.has(id));
    }).length;

    const heldCount = touching.filter((entry) => entry.hold && !entry.released && entry.payoutOutcome === null).length;

    return {
      unit: { id: unit.id, name: unit.name, code: unit.code, isActive: unit.isActive },
      released: Boolean(release),
      releasedAt: release?.releasedAt.toISOString() ?? null,
      releasedBy: release ? { id: release.releasedBy.id, name: release.releasedBy.name } : null,
      entryCount: touching.length,
      willReleaseCount,
      heldCount,
    };
  });
}

export interface ReleaseUnitResult {
  release: { id: string; cycleId: string; unitId: string; releasedAt: string; releasedById: string };
  /** Entries whose own `netSalary > 0` — the only entries this release actually pays; `released`
   * flips `true` for exactly these (Negative Payroll Recovery checkpoint, 2026-07-26 — `released`
   * keeps meaning exactly what it always has: money was paid). */
  releasedEntryCount: number;
  /** `netSalary = 0` — no payment due; `payoutOutcome = NO_PAY_DUE`. */
  noPayDueCount: number;
  /** `netSalary < 0` — the employee was overpaid/over-deducted; `payoutOutcome = RECOVERY_DUE` and
   * a `BalanceAdjustment(type: RECOVERY)` is created for each (`recoveryDueCount` entries → exactly
   * `recoveryDueCount` new adjustments). */
  recoveryDueCount: number;
  /** Excluded from this sweep entirely — duplicate identity/payment-destination data or missing
   * required banking details (`payroll-release-eligibility.ts`). Stays `released: false,
   * hold: false, payoutOutcome: null`; still blocks Finalize until fixed or manually held. */
  blockedCount: number;
  /** Salary Release visibility (2026-07-26 refinement) — one entry per `blockedCount`, so the
   * operator can see *which* employees were excluded and *why*, not just a bare count. Never
   * includes another employee's own identifying details — `blockReasons` are generic, field-named
   * strings (e.g. `"Duplicate Account Number"`), the same ones `payroll_entry.release_blocked`'s
   * own audit metadata records. */
  blockedEntries: Array<{ id: string; employeeId: string; employeeName: string; blockReasons: string[] }>;
  /** Phase 6 Checkpoint 7 — how many `ACTIVE` `BalanceAdjustmentMaterialization` reservations this
   * release consumed (flipped to `CONSUMED`, realized as a `BalanceAdjustmentSettlement`). `0` on
   * every release before Checkpoint 5's materialization existed, or when none of the entries this
   * Unit just released happened to carry an active reservation. */
  correctionSettlementsConsumed: number;
  /** Presentation & Workflow Stabilization Checkpoint, 2026-07-25 (Issue 5) — how many `RESERVED`
   * Advances this release settled to `PAID_OFF` (`settleAdvancesForReleasedEntries`). `0` when none
   * of the entries this Unit just released carried a fully-reserved Advance/Eid Advance deduction. */
  advancesSettled: number;
  /** Late/Straggler Sweep (Hold Workflow Verification, Phase 7F, 2026-08-04) — `true` when this
   * Unit already had its own `PayrollUnitRelease` row *before* this call, and this call swept only
   * newly-eligible stragglers (the documented scenario: an entry was Held when this Unit
   * originally released, and has since been un-Held) rather than performing a first-time release.
   * No new `PayrollUnitRelease` row is written for a late sweep — see the function's own doc
   * comment for why "insert-once, no un-release" still holds. */
  isLateSweep: boolean;
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
 *
 * **Late/Straggler Sweep (Hold Workflow Verification, Phase 7F, 2026-08-04)** — closes a
 * previously-documented, explicitly-deferred gap ("the Late Entry one-off release path... explicitly
 * deferred," this function's own historical doc comment): calling this again for a Unit that
 * already has its own `PayrollUnitRelease` row is *not* rejected outright anymore. It is still never
 * a second release *event* — no new row is written, `PayrollUnitRelease` stays insert-once, and
 * `released`/`payoutOutcome` are still set exactly once per entry, permanently — but it now sweeps
 * any entry that has become newly eligible *since* that original event, the one workflow this
 * checkpoint's own audit found genuinely blocked: an entry Held at the moment its Unit released,
 * later un-Held (Draft-cycle editing explicitly permits changing `hold` right up until the entry
 * itself locks — `assertEntryEditable`), had no path back to being released at all before this
 * change, for the rest of that cycle's life. If nothing is newly eligible (the ordinary "I clicked
 * Release twice by mistake" case), this still rejects with the same 409 conflict as before.
 */
export async function releaseProjectUnit(
  currentUser: SessionUser,
  cycleId: string,
  unitId: string,
  /** Phase 7E durability checkpoint (A4) — the `{entryId, version}` pairs the Salary Release page
   * last displayed for this Unit, when it provides them (optional, backward-compatible — see
   * `releaseProjectUnitSchema`). Verified inside this same locked transaction, below, against
   * whatever this sweep is about to actually release; a mismatch means a save landed on one of
   * these entries after the operator's own read and before this click, so the release is rejected
   * outright rather than proceeding against entries the operator never actually saw in their final
   * form. */
  expectedVersions: { entryId: string; version: number }[] | undefined,
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

  return prisma.$transaction(
    async (tx) => {
      // Phase 6 Checkpoint 7 — first in the documented "cycle, then adjustment" lock order
      // (`corrections.materialization.service.ts`), making this transaction a third participant
      // alongside Draft-cycle materialization and Finalize Cycle's own implicit row lock. Also
      // closes a pre-existing, unrelated race for free: re-confirms `status = 'DRAFT'` under lock,
      // since an outer, pre-transaction check could otherwise be stale against a concurrent
      // Finalize Cycle call.
      const lockedCycle = await lockPayrollCycleForUpdate(cycleId, tx);
      if (!lockedCycle || lockedCycle.status !== 'DRAFT') {
        throw conflict('This payroll cycle is no longer Draft');
      }

      // Late/Straggler Sweep (Phase 7F, 2026-08-04) — re-checked here, under the same lock, rather
      // than via an outer pre-check (the previous shape) specifically so this and a concurrent
      // fresh-release attempt for the same Unit can never both decide "no existing row" and race
      // each other into the unique-constraint backstop below. An existing row means this call is a
      // late sweep, not a fresh release — see the function's own doc comment.
      const existingRelease = await tx.payrollUnitRelease.findUnique({
        where: { cycleId_unitId: { cycleId, unitId } },
      });
      const isLateSweep = existingRelease !== null;

      let release: { id: string; cycleId: string; unitId: string; releasedAt: Date; releasedById: string };
      if (existingRelease) {
        release = existingRelease;
      } else {
        release = await tx.payrollUnitRelease.create({
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
      }

      // Negative Payroll Recovery checkpoint (2026-07-26) — `payoutOutcome: null` is an explicit,
      // defense-in-depth exclusion alongside `released: false`: once an entry's payoutOutcome is
      // set, every Unit it touches is, by construction, already released, so it could never
      // legitimately reappear as a candidate here again — this just makes that invariant explicit
      // rather than relying solely on that transitive proof.
      const candidates = await tx.payrollEntry.findMany({
        where: {
          cycleId,
          siteId: unit.siteId,
          released: false,
          hold: false,
          payoutOutcome: null,
          workLines: { some: { unitId } },
        },
        include: {
          employee: {
            select: {
              name: true,
              fatherName: true,
              cnic: true,
              employeeCode: true,
              // Master Data Boundary (Phase 7D, 2026-07-30; extended Phase 7F, 2026-08-04) —
              // `designation`/`bankId`/`branchCode`/`accountNumber`/`iban`/`grossPay`/name/father
              // name are no longer Draft-editable on `PayrollEntry` itself (Employee Registry is now
              // the sole editable source); release is therefore the one remaining moment these get
              // synced onto the entry's own frozen columns, from Employee Registry's *current*
              // values, not whatever this entry happened to be bootstrapped with. See the
              // `liveMasterByEntryId` sync below.
              designation: true,
              bankId: true,
              branchCode: true,
              accountNumber: true,
              iban: true,
              grossPay: true,
            },
          },
          workLines: WORK_LINES_INCLUDE,
        },
      });

      // Late/Straggler Sweep (Phase 7F, 2026-08-04) — a late-sweep call with genuinely nothing new
      // eligible (the ordinary "already released, clicked again by mistake" case) still rejects
      // exactly as this function always has, preserving that existing behavior/error contract.
      if (isLateSweep && candidates.length === 0) {
        throw conflict('This Project Unit has already been released for this cycle');
      }

      // Phase 7E durability checkpoint (A4) — reject the whole release (the transaction rolls
      // back, including the `PayrollUnitRelease` row and audit entry already written above) if any
      // entry the operator's own last read expected to be part of this sweep has since changed
      // version, or is no longer a live candidate for it at all (held, already resolved via
      // another path, etc.) — either way, the world moved since the operator looked, so this must
      // not silently release entries in a form they never actually saw. Skipped entirely when the
      // caller sends nothing (backward-compatible — see `releaseProjectUnitSchema`).
      if (expectedVersions && expectedVersions.length > 0) {
        const candidateVersionById = new Map(candidates.map((candidate) => [candidate.id, candidate.version]));
        const staleEntryIds = expectedVersions
          .filter(({ entryId, version }) => candidateVersionById.get(entryId) !== version)
          .map(({ entryId }) => entryId);
        if (staleEntryIds.length > 0) {
          throw conflict(
            'Payroll data at this Unit changed since it was last loaded — refresh the Release page and try again',
          );
        }
      }

      let releasedEntryCount = 0;
      let noPayDueCount = 0;
      let recoveryDueCount = 0;
      let blockedCount = 0;
      // Negative Payroll Recovery checkpoint (2026-07-26, accounting verification pass) — every
      // entry this sweep *resolves* (PAID, NO_PAY_DUE, or RECOVERY_DUE — a blocked entry is not
      // resolved, see `blockedEntries` below), not just the paid ones. A NO_PAY_DUE/RECOVERY_DUE
      // entry is just as locked and just as much "this is the release event" as a paid one — its
      // own materialized correction obligations and advance deductions must settle here too, or
      // they'd be stranded ACTIVE/RESERVED forever against an entry that can never release again.
      let resolvedEntryIds: string[] = [];
      // Salary Release visibility (2026-07-26 refinement) — declared here (not inside the
      // `candidates.length > 0` block below) so it's still in scope for the final return when
      // there are zero candidates at all.
      const blockedEntries: Array<{ id: string; employeeId: string; employeeName: string; blockReasons: string[] }> = [];

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

        // Late/Straggler Sweep (Phase 7F, 2026-08-04) — `candidates.length > 0` alone isn't enough
        // to justify a late sweep: a candidate that also touches another, still-unreleased Unit
        // isn't actually resolvable by *this* call (the same multi-Unit wait rule a fresh release
        // already enforces via `toRelease`) — e.g. a split employee whose Hold was removed at Unit
        // A, but who still waits on Unit B. Rejecting here, instead of silently returning a
        // no-effect 201, keeps the late-sweep error contract identical to the "nothing new" case
        // above for every reason nothing happened, not just the narrowest one.
        if (isLateSweep && toRelease.length === 0) {
          throw conflict('This Project Unit has already been released for this cycle');
        }

        // Negative Payroll Recovery & Employee Identity/Banking Uniqueness checkpoint (2026-07-26)
        // — classify every entry this sweep would otherwise release, via the one canonical
        // eligibility function (Part C of the checkpoint brief), before writing anything. A
        // blocked entry is excluded from this sweep entirely, same tier as `hold` — it stays
        // `released: false, hold: false, payoutOutcome: null`, still visible and still blocking
        // Finalize until its master data is fixed or it's manually held.
        const paidIds: string[] = [];
        const noPayDueIds: string[] = [];
        const recoveryEntries: Array<{ id: string; employeeId: string; netSalary: string }> = [];
        const releasedAt = new Date();
        // Master Data Boundary (Phase 7D, 2026-07-30; extended Phase 7F, 2026-08-04) — release is
        // now the moment `designation`/`bankId`/`branchCode`/`accountNumber`/`iban`/`grossPay`/
        // employee name/father name get synced from Employee Registry's *current* record onto the
        // entry's own frozen columns (rather than relying on whatever the entry happened to be
        // bootstrapped or last edited with, now that ordinary Payroll Entry edits can no longer
        // touch any of these fields at all). Keyed by entry id so the per-outcome persistence below
        // (paid / no-pay-due / recovery-due) can apply the exact same synced values it was
        // evaluated against.
        const liveMasterByEntryId = new Map<
          string,
          {
            designation: string;
            bankId: string | null;
            branchCode: string | null;
            accountNumber: string | null;
            iban: string | null;
            grossPay: Decimal;
            employeeNameSnapshot: string;
            fatherNameSnapshot: string | null;
          }
        >();

        for (const entry of toRelease) {
          const liveMaster = {
            designation: entry.employee.designation,
            bankId: entry.employee.bankId,
            branchCode: entry.employee.branchCode,
            accountNumber: entry.employee.accountNumber,
            iban: entry.employee.iban,
            grossPay: entry.employee.grossPay,
            employeeNameSnapshot: entry.employee.name,
            fatherNameSnapshot: entry.employee.fatherName,
          };
          liveMasterByEntryId.set(entry.id, liveMaster);
          // Phase 7F (2026-08-04) — `computeEntryCalc` must see the *live* Gross Salary, not
          // whatever stale value this entry's own `grossPay` column happens to still hold (the
          // exact reported defect: an Employee Registry Gross Salary change must be reflected in
          // the Net Salary this release actually pays, right up to the moment of release). Only
          // `grossPay` is substituted here — `designation`/banking fields don't feed `calcNet`, so
          // there's nothing else in `liveMaster` this calculation needs.
          const calc = computeEntryCalc({ ...entry, grossPay: liveMaster.grossPay });
          // Negative Payroll Recovery checkpoint (2026-07-26, accounting verification pass) — a
          // negative `calcNet` result caused *purely* by this entry absorbing a prior cycle's own
          // RECOVERY obligation (`correctionBalanceRecovery`) must never read as grounds for a
          // *second*, brand-new recovery on top of the one already being settled — see
          // `computeReleaseRecoveryAdjustment`'s own doc comment for the exact three-case
          // accounting. Every downstream decision (eligibility classification, and how much of the
          // materialization actually settles) uses this adjusted figure, never the raw one.
          const { adjustedNetSalary } = computeReleaseRecoveryAdjustment(calc);
          const readiness = await evaluatePayrollEntryReleaseReadiness(
            {
              employeeId: entry.employeeId,
              bankId: liveMaster.bankId,
              accountNumber: liveMaster.accountNumber,
              iban: liveMaster.iban,
            },
            entry.employee,
            adjustedNetSalary,
            tx,
          );

          if (!readiness.releasable) {
            blockedCount += 1;
            blockedEntries.push({
              id: entry.id,
              employeeId: entry.employeeId,
              employeeName: entry.employee.name,
              blockReasons: readiness.blockReasons,
            });
            await recordAuditLog(
              {
                actorUserId: currentUser.id,
                action: 'payroll_entry.release_blocked',
                entityType: 'PayrollEntry',
                entityId: entry.id,
                metadata: { cycleId, triggeringUnitId: unitId, releaseId: release.id, blockReasons: readiness.blockReasons },
                ipAddress: requestMeta.ipAddress,
                userAgent: requestMeta.userAgent,
              },
              tx,
            );
            continue;
          }

          if (readiness.payoutOutcome === 'PAID') {
            paidIds.push(entry.id);
          } else if (readiness.payoutOutcome === 'NO_PAY_DUE') {
            noPayDueIds.push(entry.id);
          } else {
            recoveryEntries.push({ id: entry.id, employeeId: entry.employeeId, netSalary: adjustedNetSalary });
          }
        }

        if (paidIds.length > 0) {
          // Master Data Boundary (Phase 7D, 2026-07-30) — per-entry `update` rather than the
          // previous single `updateMany`, since each entry's frozen `liveMasterByEntryId` snapshot
          // differs by employee; bounded by this one Unit's own headcount, same as the audit-log
          // loop immediately below, so this stays small even at the 10,000-employee design floor
          // (Principle 10).
          for (const id of paidIds) {
            await tx.payrollEntry.update({
              where: { id },
              data: {
                released: true,
                releasedAt,
                releasedBy: currentUser.id,
                version: { increment: 1 },
                ...liveMasterByEntryId.get(id)!,
              },
            });
          }
          // One `payroll_entry.released` entry per swept entry (release.md §12b's explicit
          // requirement) — bounded by this one Unit's own headcount, not the whole cycle's, so
          // this loop stays small even at the 10,000-employee design floor (Principle 10).
          for (const id of paidIds) {
            await recordAuditLog(
              {
                actorUserId: currentUser.id,
                action: 'payroll_entry.released',
                entityType: 'PayrollEntry',
                entityId: id,
                metadata: { cycleId, triggeringUnitId: unitId, releaseId: release.id },
                ipAddress: requestMeta.ipAddress,
                userAgent: requestMeta.userAgent,
              },
              tx,
            );
          }
        }

        if (noPayDueIds.length > 0) {
          // Same per-entry rationale as `paidIds` above — `NO_PAY_DUE` is just as much a resolution
          // event as a paid release (`withLiveMasterData`'s own `payoutOutcome !== null` gate treats
          // it identically), so its master-data snapshot gets frozen here too.
          for (const id of noPayDueIds) {
            await tx.payrollEntry.update({
              where: { id },
              data: { payoutOutcome: 'NO_PAY_DUE', version: { increment: 1 }, ...liveMasterByEntryId.get(id)! },
            });
          }
          for (const id of noPayDueIds) {
            await recordAuditLog(
              {
                actorUserId: currentUser.id,
                action: 'payroll_entry.no_pay_due',
                entityType: 'PayrollEntry',
                entityId: id,
                metadata: { cycleId, triggeringUnitId: unitId, releaseId: release.id },
                ipAddress: requestMeta.ipAddress,
                userAgent: requestMeta.userAgent,
              },
              tx,
            );
          }
        }

        for (const entry of recoveryEntries) {
          await tx.payrollEntry.update({
            where: { id: entry.id },
            data: { payoutOutcome: 'RECOVERY_DUE', version: { increment: 1 }, ...liveMasterByEntryId.get(entry.id)! },
          });
          const adjustment = await createNegativePayrollRecoveryAdjustment(
            { id: entry.id, employeeId: entry.employeeId, cycleId },
            entry.netSalary,
            tx,
          );
          await recordAuditLog(
            {
              actorUserId: currentUser.id,
              action: 'payroll_entry.recovery_due',
              entityType: 'PayrollEntry',
              entityId: entry.id,
              metadata: {
                cycleId,
                triggeringUnitId: unitId,
                releaseId: release.id,
                balanceAdjustmentId: adjustment.id,
                amount: adjustment.amount.toString(),
              },
              ipAddress: requestMeta.ipAddress,
              userAgent: requestMeta.userAgent,
            },
            tx,
          );
        }

        releasedEntryCount = paidIds.length;
        noPayDueCount = noPayDueIds.length;
        recoveryDueCount = recoveryEntries.length;
        resolvedEntryIds = [...paidIds, ...noPayDueIds, ...recoveryEntries.map((entry) => entry.id)];
      }

      // Phase 6 Checkpoint 7 — second in the lock order, per adjustment, acquired inside
      // `consumeMaterializationsForReleasedEntries` itself. Scoped to exactly the entries this
      // sweep just resolved in this call, in any of the three outcomes — an entry already resolved
      // before this Unit's sweep ran keeps whatever happened at its own resolution event, never
      // revisited here.
      const consumption = await consumeMaterializationsForReleasedEntries(
        {
          entryIds: resolvedEntryIds,
          releasingCycleId: cycleId,
          actorUserId: currentUser.id,
          requestMeta,
        },
        tx,
      );

      // Issue 5's own settlement step — same "scoped to exactly the entries this sweep just
      // resolved in this call" rule as the correction consumption immediately above.
      const advanceSettlement = await settleAdvancesForReleasedEntries(
        {
          entryIds: resolvedEntryIds,
          actorUserId: currentUser.id,
          requestMeta,
        },
        tx,
      );

      // Late/Straggler Sweep (Phase 7F, 2026-08-04) — a distinct, explicitly-named audit trail
      // entry for traceability (an operator/auditor reviewing history should be able to tell "these
      // entries resolved days after this Unit's own original release," not just see them folded
      // silently into the original event) — written only when this call actually swept something,
      // never for the "isLateSweep but candidates.length === 0" case (already rejected above) or a
      // late sweep whose only candidates were entirely blocked.
      if (isLateSweep && resolvedEntryIds.length > 0) {
        await recordAuditLog(
          {
            actorUserId: currentUser.id,
            action: 'payroll_unit.late_sweep',
            entityType: 'PayrollUnitRelease',
            entityId: release.id,
            metadata: { cycleId, unitId, siteId: unit.siteId, resolvedEntryIds },
            ipAddress: requestMeta.ipAddress,
            userAgent: requestMeta.userAgent,
          },
          tx,
        );
      }

      return {
        release: {
          id: release.id,
          cycleId: release.cycleId,
          unitId: release.unitId,
          releasedAt: release.releasedAt.toISOString(),
          releasedById: release.releasedById,
        },
        releasedEntryCount,
        noPayDueCount,
        recoveryDueCount,
        blockedCount,
        blockedEntries,
        correctionSettlementsConsumed: consumption.consumedCount,
        advancesSettled: advanceSettlement.settledCount,
        isLateSweep,
      };
    },
    { timeout: 30_000 },
  );
}

/**
 * Release All (Phase 7F, 2026-08-04) — the bulk counterpart to `releaseProjectUnit` above. Salary
 * Release previously required releasing every Project Unit one at a time, even when an operator
 * genuinely wanted "release everything that's currently eligible" for one Site or for every Site
 * they can see. This never introduces a second release mechanism: it is purely a loop that calls
 * `releaseProjectUnit` — completely unmodified — once per not-yet-released Unit in scope, so every
 * existing guarantee (lock ordering, per-outcome master-data freeze, duplicate-identity blocking,
 * correction/advance settlement, audit trail) applies identically to a Release All-triggered
 * release as to a manual one. There is no reimplementation of the sweep/eligibility logic here.
 *
 * **Transaction strategy — one transaction per Project Unit, not one giant transaction for the
 * whole scope, and not one per employee.** Considered and rejected:
 *
 * - **One enormous transaction** wrapping every Unit in scope would (a) risk exceeding Prisma's own
 *   transaction timeout at the 10,000-employee design floor this codebase already tests against
 *   (`payroll-entry-performance.test.ts`), (b) hold `lockPayrollCycleForUpdate`'s row lock for the
 *   entire scope's duration, blocking every concurrent Payroll Entry edit and every other release
 *   against this cycle for however long the whole sweep takes, and (c) roll back *every* already-
 *   processed Unit if *any single* Unit anywhere in scope hit an unexpected error — the opposite of
 *   "must never leave inconsistent release state because one employee fails."
 * - **One transaction per employee** would require re-deriving the multi-unit-entry-waits-for-
 *   every-touched-Unit semantics `releaseProjectUnit` already owns outside of any single employee's
 *   own transaction (an entry only resolves once *every* Unit its work lines touch has released) —
 *   there is no natural single-employee transaction boundary this architecture already has; Unit is
 *   the smallest boundary that's both correct and already proven.
 * - **One transaction per Unit** (chosen) reuses the exact, already-battle-tested
 *   `releaseProjectUnit` transaction unmodified, bounds each transaction's blast radius to one
 *   Unit's own headcount (the same "stays small even at the 10,000-employee design floor" property
 *   `releaseProjectUnit`'s own per-entry loops already rely on), and means a genuine failure on one
 *   Unit never touches any other Unit's already-committed release — this call keeps going and
 *   reports that one Unit as failed rather than aborting the whole operation. Concurrency is also a
 *   non-factor for running Units in parallel instead: every `releaseProjectUnit` call takes
 *   `lockPayrollCycleForUpdate` as the *first* lock in its own transaction (Phase 6 Checkpoint 7's
 *   documented lock order), so concurrent Unit releases against the same cycle already fully
 *   serialize at the database level — running them concurrently from here would add lock-contention
 *   risk for zero real throughput gain, so this loop is deliberately sequential, not
 *   `Promise.all`-parallelized.
 *
 * A Unit that's already released before this call starts is silently skipped (not an error, not a
 * "failure") — Release All is idempotent to call again after a partial run or after some Units were
 * already released manually. `hold`ed entries are never touched by any Unit's own sweep (exactly as
 * a manual release already behaves) — `heldEntryCount` here is purely an informational count of how
 * many currently-unresolved entries in scope are on Hold, computed once upfront (Held entries never
 * move during this sweep, so it cannot go stale mid-call).
 */
export interface ReleaseAllResult {
  /** Entries whose own `netSalary > 0`, actually paid by this call — summed across every Unit this
   * call released. */
  releasedEntryCount: number;
  /** `netSalary = 0` outcomes, summed across every Unit this call released. */
  noPayDueCount: number;
  /** `netSalary < 0` outcomes, summed across every Unit this call released. */
  recoveryDueCount: number;
  /** Duplicate-identity/missing-banking-detail exclusions, summed across every Unit this call
   * released — same meaning as `ReleaseUnitResult.blockedCount`. */
  blockedCount: number;
  /** One entry per `blockedCount`, aggregated across every Unit this call touched — each tagged
   * with which Unit/Site it belongs to, since a single Release All call can span many of both. */
  blockedEntries: Array<{
    id: string;
    employeeId: string;
    employeeName: string;
    siteId: string;
    unitId: string;
    unitName: string;
    blockReasons: string[];
  }>;
  /** Currently-unresolved (`released: false, payoutOutcome: null`) entries in scope with
   * `hold: true` — informational only, never touched by this call. */
  heldEntryCount: number;
  /** How many Units this call actually released (excludes Units already released before the call
   * started, and Units that failed). */
  unitsReleased: number;
  /** Units already released before this call started — skipped, not a failure. */
  unitsAlreadyReleased: number;
  /** Units whose own `releaseProjectUnit` call threw an unexpected error — every other Unit in
   * scope is still processed; see `failedUnits` for which ones and why. */
  unitsFailed: number;
  failedUnits: Array<{ unitId: string; unitName: string; siteId: string; error: string }>;
  correctionSettlementsConsumed: number;
  advancesSettled: number;
}

export async function releaseAllEligible(
  currentUser: SessionUser,
  cycleId: string,
  /** `undefined` means "All Sites" — every Site `currentUser` can access (every Site for a Master
   * Admin, exactly `currentUser.siteIds` otherwise) — mirroring the Salary Release page's own
   * existing Site filter, which is already built from the same accessible-sites list. A specific
   * value releases only that one Site, exactly like selecting it in the existing filter today. */
  siteId: string | undefined,
  requestMeta: RequestMeta,
): Promise<ReleaseAllResult> {
  const cycle = await prisma.payrollCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) {
    throw notFound('Payroll cycle not found');
  }
  if (cycle.status !== 'DRAFT') {
    throw badRequest('Only the current Draft cycle can be released');
  }

  let siteIds: string[];
  if (siteId) {
    assertSiteAccess(currentUser, siteId);
    siteIds = [siteId];
  } else if (isMasterAdmin(currentUser)) {
    siteIds = (await prisma.projectSite.findMany({ select: { id: true } })).map((site) => site.id);
  } else {
    siteIds = currentUser.siteIds;
  }

  const empty: ReleaseAllResult = {
    releasedEntryCount: 0,
    noPayDueCount: 0,
    recoveryDueCount: 0,
    blockedCount: 0,
    blockedEntries: [],
    heldEntryCount: 0,
    unitsReleased: 0,
    unitsAlreadyReleased: 0,
    unitsFailed: 0,
    failedUnits: [],
    correctionSettlementsConsumed: 0,
    advancesSettled: 0,
  };

  if (siteIds.length === 0) {
    return empty;
  }

  // Informational only (see doc comment above) — computed once, upfront, across the whole scope.
  const heldEntryCount = await prisma.payrollEntry.count({
    where: { cycleId, siteId: { in: siteIds }, released: false, hold: true, payoutOutcome: null },
  });

  const units = await prisma.projectUnit.findMany({
    where: { siteId: { in: siteIds } },
    select: { id: true, name: true, siteId: true },
    orderBy: [{ siteId: 'asc' }, { name: 'asc' }],
  });
  if (units.length === 0) {
    return { ...empty, heldEntryCount };
  }

  const existingReleases = await prisma.payrollUnitRelease.findMany({
    where: { cycleId, unitId: { in: units.map((unit) => unit.id) } },
    select: { unitId: true },
  });
  const alreadyReleasedUnitIds = new Set(existingReleases.map((release) => release.unitId));
  const pending = units.filter((unit) => !alreadyReleasedUnitIds.has(unit.id));

  const result: ReleaseAllResult = {
    ...empty,
    heldEntryCount,
    unitsAlreadyReleased: units.length - pending.length,
  };

  // Sequential by design — see the "Transaction strategy" doc comment above.
  for (const unit of pending) {
    try {
      const unitResult = await releaseProjectUnit(currentUser, cycleId, unit.id, undefined, requestMeta);
      result.releasedEntryCount += unitResult.releasedEntryCount;
      result.noPayDueCount += unitResult.noPayDueCount;
      result.recoveryDueCount += unitResult.recoveryDueCount;
      result.blockedCount += unitResult.blockedCount;
      for (const entry of unitResult.blockedEntries) {
        result.blockedEntries.push({ ...entry, siteId: unit.siteId, unitId: unit.id, unitName: unit.name });
      }
      result.correctionSettlementsConsumed += unitResult.correctionSettlementsConsumed;
      result.advancesSettled += unitResult.advancesSettled;
      result.unitsReleased += 1;
    } catch (error) {
      // A Unit that raced to already-released between this call's own upfront lookup and its turn
      // in this loop (a manual release clicked at the same time) is a skip, not a failure — the
      // same "idempotent to re-call" guarantee the doc comment above promises.
      if (error instanceof Error && error.message.includes('already been released')) {
        result.unitsAlreadyReleased += 1;
        continue;
      }
      result.unitsFailed += 1;
      result.failedUnits.push({
        unitId: unit.id,
        unitName: unit.name,
        siteId: unit.siteId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  await recordAuditLog(
    {
      actorUserId: currentUser.id,
      action: 'payroll_release.release_all',
      entityType: 'PayrollCycle',
      entityId: cycleId,
      metadata: {
        siteId: siteId ?? null,
        siteCount: siteIds.length,
        unitsReleased: result.unitsReleased,
        unitsAlreadyReleased: result.unitsAlreadyReleased,
        unitsFailed: result.unitsFailed,
        releasedEntryCount: result.releasedEntryCount,
        noPayDueCount: result.noPayDueCount,
        recoveryDueCount: result.recoveryDueCount,
        blockedCount: result.blockedCount,
        heldEntryCount: result.heldEntryCount,
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    },
    prisma,
  );

  return result;
}
