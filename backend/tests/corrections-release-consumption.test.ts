import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';
import * as auditLogService from '../src/modules/audit-log/audit-log.service';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

/**
 * Phase 6 Checkpoint 7 — release-time materialization consumption (`ACTIVE -> CONSUMED`).
 *
 * Every checkpoint through 6A deliberately deferred this transition ("a later checkpoint's own
 * event") — without it, a `BalanceAdjustment` materialized into a Draft cycle could never actually
 * reach `SETTLED`: the standalone/cycle-scoped settlement paths reject any amount already
 * `ACTIVE`-reserved (`RESERVED_AMOUNT_UNAVAILABLE`, Checkpoint 5A), and nothing else ever flipped
 * the reservation. This suite proves `releaseProjectUnit` (`payroll-release.service.ts`) now closes
 * that loop: the moment a `PayrollEntry` carrying an `ACTIVE` reservation actually releases, the
 * reservation is realized as a real `BalanceAdjustmentSettlement` and consumed.
 *
 * Fixtures mirror `corrections-materialization.test.ts`'s own established pattern —
 * `Correction`/`BalanceAdjustment` created directly via Prisma (this suite tests release-time
 * consumption, not how a `BalanceAdjustment` came to exist).
 */
describe('Phase 6 Checkpoint 7 — release-time materialization consumption', () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  // --- Agents --------------------------------------------------------------------------------

  async function masterAdminAgent(email: string) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.MASTER_ADMIN,
      permissionKeys: [PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.CORRECTIONS_APPROVE, PERMISSIONS.PAYROLL_CYCLE_MANAGE, PERMISSIONS.PAYROLL_RELEASE],
    });
  }

  // --- Fixtures --------------------------------------------------------------------------------

  let cycleCounter = 0;
  function nextCycleYearMonth(): { year: number; month: number } {
    cycleCounter += 1;
    return { year: 2900 + Math.floor(cycleCounter / 12), month: (cycleCounter % 12) + 1 };
  }

  async function makeSiteWithUnit(name: string) {
    const site = await prisma.projectSite.create({ data: { name } });
    const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} Unit`, code: 'U-1' } });
    return { site, unit };
  }

  async function makeEmployee(siteId: string, unitId: string, name: string) {
    return prisma.employee.create({ data: { name, designation: 'Guard', siteId, unitId, grossPay: '30000' } });
  }

  async function makeAdjustmentType(code: string) {
    return prisma.adjustmentType.create({ data: { code: `TEST_${code}`, label: code } });
  }

  async function makeCycle(createdBy: string, status: 'DRAFT' | 'RELEASED' | 'ARCHIVED' = 'RELEASED') {
    const { year, month } = nextCycleYearMonth();
    return prisma.payrollCycle.create({ data: { year, month, createdBy, status } });
  }

  async function makeEntry(siteId: string, unitId: string, employeeId: string, cycleId: string, released: boolean, releasedBy: string) {
    return prisma.payrollEntry.create({
      data: {
        cycleId,
        employeeId,
        siteId,
        designation: 'Guard',
        grossPay: '30000',
        released,
        releasedAt: released ? new Date() : null,
        releasedBy: released ? releasedBy : null,
        workLines: { create: [{ siteId, unitId, days: '30', cycleDays: 30, otHours: '0' }] },
      },
    });
  }

  async function makeCorrection(payrollEntryId: string, adjustmentTypeId: string, approvedById: string) {
    return prisma.correction.create({
      data: {
        payrollEntryId,
        field: 'GROSS_PAY',
        oldValue: '30000',
        newValue: '35000',
        oldNetSalary: '30000',
        newNetSalary: '35000',
        adjustmentTypeId,
        reason: 'Attendance miscounted for this period',
        approvedById,
      },
    });
  }

  async function makeBalanceAdjustment(
    correctionId: string,
    employeeId: string,
    sourceCycleId: string,
    adjustmentTypeId: string,
    overrides: Partial<{
      amount: string;
      type: 'PAYABLE' | 'RECOVERY';
      remainingAmount: string;
      recoveryInstallmentAmount: string | null;
    }> = {},
  ) {
    const amount = overrides.amount ?? '5000';
    const type = overrides.type ?? 'PAYABLE';
    return prisma.balanceAdjustment.create({
      data: {
        correctionId,
        employeeId,
        sourceCycleId,
        adjustmentTypeId,
        amount,
        type,
        remainingAmount: overrides.remainingAmount ?? amount,
        status: 'PENDING',
        paymentTiming: type === 'PAYABLE' ? 'DEFERRED' : null,
        recoveryInstallmentAmount: overrides.recoveryInstallmentAmount ?? null,
        remark: 'Balance from a correction',
      },
    });
  }

  /** Full fixture set: site/unit, an admin, a RELEASED source entry with an approved Correction, a
   * PENDING BalanceAdjustment, and a target Draft cycle with the same employee's own (unreleased)
   * entry — ready to materialize and then release. */
  async function makeFixtures(
    label: string,
    options: { type?: 'PAYABLE' | 'RECOVERY'; amount?: string; recoveryInstallmentAmount?: string | null } = {},
  ) {
    const { site, unit } = await makeSiteWithUnit(`Test Site CP7 ${label}`);
    const employee = await makeEmployee(site.id, unit.id, `CP7 Employee ${label}`);
    const admin = await masterAdminAgent(`cp7-${label}-admin@test.local`);
    const sourceCycle = await makeCycle(admin.userId, 'RELEASED');
    const sourceEntry = await makeEntry(site.id, unit.id, employee.id, sourceCycle.id, true, admin.userId);
    const adjustmentType = await makeAdjustmentType(label);
    const correction = await makeCorrection(sourceEntry.id, adjustmentType.id, admin.userId);
    const balanceAdjustment = await makeBalanceAdjustment(correction.id, employee.id, sourceCycle.id, adjustmentType.id, {
      type: options.type ?? 'PAYABLE',
      amount: options.amount ?? '5000',
      recoveryInstallmentAmount: options.recoveryInstallmentAmount,
    });

    const draftCycle = await makeCycle(admin.userId, 'DRAFT');
    const draftEntry = await makeEntry(site.id, unit.id, employee.id, draftCycle.id, false, admin.userId);

    return { site, unit, employee, admin, adjustmentType, correction, balanceAdjustment, draftCycle, draftEntry };
  }

  async function addDraftCycleEntry(
    site: { id: string },
    unit: { id: string },
    employee: { id: string },
    createdBy: string,
  ) {
    const cycle = await makeCycle(createdBy, 'DRAFT');
    const entry = await makeEntry(site.id, unit.id, employee.id, cycle.id, false, createdBy);
    return { cycle, entry };
  }

  async function materialize(admin: Awaited<ReturnType<typeof masterAdminAgent>>, balanceAdjustmentId: string, targetCycleId: string) {
    return admin.agent
      .post(`/api/v1/balance-adjustments/${balanceAdjustmentId}/materializations`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ targetCycleId });
  }

  async function release(admin: Awaited<ReturnType<typeof masterAdminAgent>>, cycleId: string, unitId: string) {
    return admin.agent.post(`/api/v1/payroll-cycles/${cycleId}/units/${unitId}/release`).set('x-csrf-token', admin.csrfToken).send({});
  }

  // --- Full PAYABLE consumption -----------------------------------------------------------------

  it('a full PAYABLE materialization is consumed on release — SETTLED, CONSUMED, one linked BalanceAdjustmentSettlement row', async () => {
    const { admin, unit, draftCycle, balanceAdjustment } = await makeFixtures('payable-full', { amount: '5000' });

    const materializeRes = await materialize(admin, balanceAdjustment.id, draftCycle.id);
    expect(materializeRes.status).toBe(201);
    expect(materializeRes.body.result.outcome).toBe('MATERIALIZED');

    const releaseRes = await release(admin, draftCycle.id, unit.id);
    expect(releaseRes.status).toBe(201);
    expect(releaseRes.body.correctionSettlementsConsumed).toBe(1);

    const adjustment = await prisma.balanceAdjustment.findUniqueOrThrow({ where: { id: balanceAdjustment.id } });
    expect(adjustment.status).toBe('SETTLED');
    expect(adjustment.remainingAmount.toString()).toBe('0');
    expect(adjustment.settledInCycleId).toBe(draftCycle.id);
    expect(adjustment.settledAt).not.toBeNull();

    const materialization = await prisma.balanceAdjustmentMaterialization.findUniqueOrThrow({
      where: { balanceAdjustmentId_cycleId: { balanceAdjustmentId: balanceAdjustment.id, cycleId: draftCycle.id } },
    });
    expect(materialization.status).toBe('CONSUMED');
    expect(materialization.consumedAt).not.toBeNull();
    expect(materialization.settlementId).not.toBeNull();

    const settlements = await prisma.balanceAdjustmentSettlement.findMany({ where: { balanceAdjustmentId: balanceAdjustment.id } });
    expect(settlements).toHaveLength(1);
    expect(settlements[0]!.cycleId).toBe(draftCycle.id);
    expect(settlements[0]!.amountApplied.toString()).toBe('5000');
    // Settlement <-> materialization link is bidirectional and consistent.
    expect(settlements[0]!.id).toBe(materialization.settlementId);
  });

  // --- Multi-cycle RECOVERY installments ----------------------------------------------------------

  it('a multi-cycle RECOVERY installment plan is consumed one release at a time, reaching SETTLED only on the final installment', async () => {
    const { site, unit, employee, admin, draftCycle: cycle1, draftEntry: entry1, balanceAdjustment } = await makeFixtures('recovery-multi', {
      type: 'RECOVERY',
      amount: '6000',
      recoveryInstallmentAmount: '2000',
    });
    void entry1;

    // Installment 1 of 3.
    const mat1 = await materialize(admin, balanceAdjustment.id, cycle1.id);
    expect(mat1.body.result.amount).toBe('2000.00');
    const rel1 = await release(admin, cycle1.id, unit.id);
    expect(rel1.status).toBe(201);
    expect(rel1.body.correctionSettlementsConsumed).toBe(1);

    let adjustment = await prisma.balanceAdjustment.findUniqueOrThrow({ where: { id: balanceAdjustment.id } });
    expect(adjustment.status).toBe('PENDING');
    expect(adjustment.remainingAmount.toString()).toBe('4000');

    // Installment 2 of 3.
    const { cycle: cycle2 } = await addDraftCycleEntry(site, unit, employee, admin.userId);
    const mat2 = await materialize(admin, balanceAdjustment.id, cycle2.id);
    expect(mat2.body.result.amount).toBe('2000.00');
    const rel2 = await release(admin, cycle2.id, unit.id);
    expect(rel2.status).toBe(201);
    expect(rel2.body.correctionSettlementsConsumed).toBe(1);

    adjustment = await prisma.balanceAdjustment.findUniqueOrThrow({ where: { id: balanceAdjustment.id } });
    expect(adjustment.status).toBe('PENDING');
    expect(adjustment.remainingAmount.toString()).toBe('2000');

    // Installment 3 of 3 — the final one, bringing remainingAmount to exactly zero.
    const { cycle: cycle3 } = await addDraftCycleEntry(site, unit, employee, admin.userId);
    const mat3 = await materialize(admin, balanceAdjustment.id, cycle3.id);
    expect(mat3.body.result.amount).toBe('2000.00');
    const rel3 = await release(admin, cycle3.id, unit.id);
    expect(rel3.status).toBe(201);
    expect(rel3.body.correctionSettlementsConsumed).toBe(1);

    adjustment = await prisma.balanceAdjustment.findUniqueOrThrow({ where: { id: balanceAdjustment.id } });
    expect(adjustment.status).toBe('SETTLED');
    expect(adjustment.remainingAmount.toString()).toBe('0');
    expect(adjustment.settledInCycleId).toBe(cycle3.id);

    const settlements = await prisma.balanceAdjustmentSettlement.findMany({
      where: { balanceAdjustmentId: balanceAdjustment.id },
      orderBy: { appliedAt: 'asc' },
    });
    expect(settlements).toHaveLength(3);
    expect(settlements.map((s) => s.amountApplied.toString())).toEqual(['2000', '2000', '2000']);
    expect(settlements.map((s) => s.cycleId)).toEqual([cycle1.id, cycle2.id, cycle3.id]);

    const materializations = await prisma.balanceAdjustmentMaterialization.findMany({ where: { balanceAdjustmentId: balanceAdjustment.id } });
    expect(materializations.every((m) => m.status === 'CONSUMED')).toBe(true);
  });

  // --- Failure rollback ----------------------------------------------------------------------------

  it('a failure during release-time consumption rolls back the entire release — no settlement, no CONSUMED transition, no released entry', async () => {
    const { admin, unit, draftCycle, draftEntry, balanceAdjustment } = await makeFixtures('rollback', { amount: '5000' });
    await materialize(admin, balanceAdjustment.id, draftCycle.id);

    const realRecordAuditLog = auditLogService.recordAuditLog;
    const spy = jest.spyOn(auditLogService, 'recordAuditLog').mockImplementation(async (input, client) => {
      if (input.action === 'balance_adjustment.settled' && (input.metadata as Record<string, unknown> | undefined)?.triggeredBy === 'RELEASE') {
        throw new Error('simulated failure during release-time settlement');
      }
      return realRecordAuditLog(input, client);
    });

    try {
      const releaseRes = await release(admin, draftCycle.id, unit.id);
      expect(releaseRes.status).toBe(500);
    } finally {
      spy.mockRestore();
    }

    // Nothing survives — the entry release, the PayrollUnitRelease row, and the correction
    // settlement/consumption all live in one transaction.
    const entry = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: draftEntry.id } });
    expect(entry.released).toBe(false);

    const unitRelease = await prisma.payrollUnitRelease.findUnique({ where: { cycleId_unitId: { cycleId: draftCycle.id, unitId: unit.id } } });
    expect(unitRelease).toBeNull();

    const adjustment = await prisma.balanceAdjustment.findUniqueOrThrow({ where: { id: balanceAdjustment.id } });
    expect(adjustment.status).toBe('PENDING');
    expect(adjustment.remainingAmount.toString()).toBe('5000');

    const materialization = await prisma.balanceAdjustmentMaterialization.findUniqueOrThrow({
      where: { balanceAdjustmentId_cycleId: { balanceAdjustmentId: balanceAdjustment.id, cycleId: draftCycle.id } },
    });
    expect(materialization.status).toBe('ACTIVE');

    const settlementCount = await prisma.balanceAdjustmentSettlement.count({ where: { balanceAdjustmentId: balanceAdjustment.id } });
    expect(settlementCount).toBe(0);

    // A retry, now unmocked, succeeds cleanly — proving the rollback left nothing corrupted.
    const retryRes = await release(admin, draftCycle.id, unit.id);
    expect(retryRes.status).toBe(201);
    expect(retryRes.body.correctionSettlementsConsumed).toBe(1);
  });

  // --- Repeated / idempotent release ----------------------------------------------------------------

  it('a repeated release attempt for the same Unit is rejected — no duplicate settlement or consumption', async () => {
    const { admin, unit, draftCycle, balanceAdjustment } = await makeFixtures('repeat-release', { amount: '5000' });
    await materialize(admin, balanceAdjustment.id, draftCycle.id);

    const first = await release(admin, draftCycle.id, unit.id);
    expect(first.status).toBe(201);

    const second = await release(admin, draftCycle.id, unit.id);
    expect(second.status).toBe(409);

    const settlementCount = await prisma.balanceAdjustmentSettlement.count({ where: { balanceAdjustmentId: balanceAdjustment.id } });
    expect(settlementCount).toBe(1);

    const materialization = await prisma.balanceAdjustmentMaterialization.findUniqueOrThrow({
      where: { balanceAdjustmentId_cycleId: { balanceAdjustmentId: balanceAdjustment.id, cycleId: draftCycle.id } },
    });
    expect(materialization.status).toBe('CONSUMED');
  });

  // --- Concurrent release protection -----------------------------------------------------------------

  it('two concurrent release attempts for the same Unit produce exactly one settlement and one CONSUMED materialization', async () => {
    const { admin, unit, draftCycle, balanceAdjustment } = await makeFixtures('concurrent-release', { amount: '5000' });
    await materialize(admin, balanceAdjustment.id, draftCycle.id);

    const [first, second] = await Promise.all([release(admin, draftCycle.id, unit.id), release(admin, draftCycle.id, unit.id)]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const settlementCount = await prisma.balanceAdjustmentSettlement.count({ where: { balanceAdjustmentId: balanceAdjustment.id } });
    expect(settlementCount).toBe(1);

    const adjustment = await prisma.balanceAdjustment.findUniqueOrThrow({ where: { id: balanceAdjustment.id } });
    expect(adjustment.status).toBe('SETTLED');
    expect(adjustment.remainingAmount.toString()).toBe('0');
  });

  // --- Unrelated materializations are untouched -------------------------------------------------------

  it('an unrelated ACTIVE materialization for a different employee/cycle is untouched by this release', async () => {
    const fixturesA = await makeFixtures('unrelated-a', { amount: '5000' });
    const fixturesB = await makeFixtures('unrelated-b', { amount: '3000' });

    await materialize(fixturesA.admin, fixturesA.balanceAdjustment.id, fixturesA.draftCycle.id);
    await materialize(fixturesB.admin, fixturesB.balanceAdjustment.id, fixturesB.draftCycle.id);

    const releaseRes = await release(fixturesA.admin, fixturesA.draftCycle.id, fixturesA.unit.id);
    expect(releaseRes.status).toBe(201);
    expect(releaseRes.body.correctionSettlementsConsumed).toBe(1);

    const adjustmentA = await prisma.balanceAdjustment.findUniqueOrThrow({ where: { id: fixturesA.balanceAdjustment.id } });
    expect(adjustmentA.status).toBe('SETTLED');

    // Fixture B's own materialization/adjustment/entry are entirely untouched — different cycle,
    // different employee, never named in this release's own `entryIds`.
    const adjustmentB = await prisma.balanceAdjustment.findUniqueOrThrow({ where: { id: fixturesB.balanceAdjustment.id } });
    expect(adjustmentB.status).toBe('PENDING');
    expect(adjustmentB.remainingAmount.toString()).toBe('3000');

    const materializationB = await prisma.balanceAdjustmentMaterialization.findUniqueOrThrow({
      where: { balanceAdjustmentId_cycleId: { balanceAdjustmentId: fixturesB.balanceAdjustment.id, cycleId: fixturesB.draftCycle.id } },
    });
    expect(materializationB.status).toBe('ACTIVE');

    const entryB = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: fixturesB.draftEntry.id } });
    expect(entryB.released).toBe(false);
  });

  // --- Standalone settlement still respects the reservation ceiling for OTHER reservations ------------

  it('standalone/cycle-scoped settlement still rejects an amount exceeding the unreserved balance — unaffected by release-time consumption', async () => {
    const { admin, draftCycle, balanceAdjustment } = await makeFixtures('reserved-ceiling', {
      type: 'RECOVERY',
      amount: '5000',
      recoveryInstallmentAmount: '2000',
    });
    // Reserve 2000 of 5000 into a Draft cycle without releasing it — the remaining 3000 is
    // unreserved, but a proposed settlement of the full 5000 must still be rejected.
    await materialize(admin, balanceAdjustment.id, draftCycle.id);

    const res = await admin.agent
      .post(`/api/v1/balance-adjustments/${balanceAdjustment.id}/settlements`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ cycleId: draftCycle.id, amount: '5000' });

    expect(res.status).toBe(400);
    expect(res.body.code ?? res.body.error?.code).toBe('RESERVED_AMOUNT_UNAVAILABLE');
  });

  // --- Audit -----------------------------------------------------------------------------------------

  it('exactly one balance_adjustment.settled audit event (triggeredBy RELEASE) is written per consumed materialization, only on success', async () => {
    const { admin, unit, draftCycle, balanceAdjustment } = await makeFixtures('audit-release', { amount: '5000' });
    await materialize(admin, balanceAdjustment.id, draftCycle.id);

    const events = await prisma.auditLog.count({
      where: { action: 'balance_adjustment.settled', entityId: balanceAdjustment.id },
    });
    expect(events).toBe(0);

    const releaseRes = await release(admin, draftCycle.id, unit.id);
    expect(releaseRes.status).toBe(201);

    const eventsAfter = await prisma.auditLog.findMany({
      where: { action: 'balance_adjustment.settled', entityId: balanceAdjustment.id },
    });
    expect(eventsAfter).toHaveLength(1);
    expect((eventsAfter[0]!.metadata as Record<string, unknown>).triggeredBy).toBe('RELEASE');
    expect((eventsAfter[0]!.metadata as Record<string, unknown>).materializationId).toBeDefined();
  });

  // --- Companion eligibility fix: materializing into an already-released entry is rejected -------------

  it('a materialization attempt against an already-released PayrollEntry is rejected (TARGET_ENTRY_ALREADY_RELEASED)', async () => {
    const { admin, unit, draftCycle, balanceAdjustment } = await makeFixtures('already-released-guard', { amount: '5000' });

    // Release the target cycle's Unit first, with nothing materialized yet.
    const releaseRes = await release(admin, draftCycle.id, unit.id);
    expect(releaseRes.status).toBe(201);
    expect(releaseRes.body.correctionSettlementsConsumed).toBe(0);

    // A manual materialization attempt against that now-released entry must be rejected, not
    // silently write into an immutable released PayrollEntry.
    const materializeRes = await materialize(admin, balanceAdjustment.id, draftCycle.id);
    expect(materializeRes.status).toBe(201);
    expect(materializeRes.body.result.outcome).toBe('SKIPPED');
    expect(materializeRes.body.result.reason).toBe('TARGET_ENTRY_ALREADY_RELEASED');

    const materializationCount = await prisma.balanceAdjustmentMaterialization.count({ where: { balanceAdjustmentId: balanceAdjustment.id } });
    expect(materializationCount).toBe(0);
  });
});
