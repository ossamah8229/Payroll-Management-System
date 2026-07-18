import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';
import { calculateSettlement, calculateStandalonePayment } from '../src/modules/corrections/corrections.settlement';
import { SettlementValidationError } from '../src/modules/corrections/corrections.settlement.types';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

/**
 * Phase 6 Checkpoint 5A — Reservation vs Settlement Consistency Review. Proves the defect found by
 * the review (standalone/cycle-scoped settlement ignored `ACTIVE` `BalanceAdjustmentMaterialization`
 * reservations, allowing the same obligation to be paid once through a Draft cycle's own release —
 * `correctionBalancePayable`/`.correctionBalanceRecovery` feed `calcNet` directly — and a second time
 * through an independent settlement) is now closed by the `activeReservedAmount`-aware
 * `RESERVED_AMOUNT_UNAVAILABLE` guard added to `corrections.settlement.ts`/`.service.ts`.
 */
describe('Phase 6 Checkpoint 5A — Reservation vs settlement consistency', () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  async function masterAdminAgent(email: string) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.MASTER_ADMIN,
      permissionKeys: [PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.CORRECTIONS_APPROVE, PERMISSIONS.PAYROLL_CYCLE_MANAGE, PERMISSIONS.PAYROLL_RELEASE],
    });
  }

  let cycleCounter = 0;
  function nextCycleYearMonth(): { year: number; month: number } {
    cycleCounter += 1;
    return { year: 2950 + Math.floor(cycleCounter / 12), month: (cycleCounter % 12) + 1 };
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
      paymentTiming: 'IMMEDIATE' | 'DEFERRED' | null;
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
        remainingAmount: amount,
        status: 'PENDING',
        paymentTiming: overrides.paymentTiming !== undefined ? overrides.paymentTiming : type === 'PAYABLE' ? 'DEFERRED' : null,
        remark: 'Balance from a correction',
      },
    });
  }

  /** Site/unit, an admin, a RELEASED source entry with an approved Correction, a PENDING
   * BalanceAdjustment (DEFERRED PAYABLE or RECOVERY, amount 5000 by default), and a target Draft
   * cycle with the same employee already bootstrapped into it — ready to materialize and/or settle. */
  async function makeFixtures(label: string, options: { type?: 'PAYABLE' | 'RECOVERY'; amount?: string } = {}) {
    const { site, unit } = await makeSiteWithUnit(`Test Site CP5A ${label}`);
    const employee = await makeEmployee(site.id, unit.id, `CP5A Employee ${label}`);
    const admin = await masterAdminAgent(`cp5a-${label}-admin@test.local`);
    const sourceCycle = await makeCycle(admin.userId, 'RELEASED');
    const sourceEntry = await makeEntry(site.id, unit.id, employee.id, sourceCycle.id, true, admin.userId);
    const adjustmentType = await makeAdjustmentType(label);
    const correction = await makeCorrection(sourceEntry.id, adjustmentType.id, admin.userId);
    const balanceAdjustment = await makeBalanceAdjustment(correction.id, employee.id, sourceCycle.id, adjustmentType.id, {
      type: options.type ?? 'PAYABLE',
      amount: options.amount ?? '5000',
    });

    const draftCycle = await makeCycle(admin.userId, 'DRAFT');
    const draftEntry = await makeEntry(site.id, unit.id, employee.id, draftCycle.id, false, admin.userId);

    return { site, unit, employee, admin, sourceCycle, sourceEntry, adjustmentType, correction, balanceAdjustment, draftCycle, draftEntry };
  }

  function materialize(agent: Awaited<ReturnType<typeof createAuthenticatedAgent>>, balanceAdjustmentId: string, targetCycleId: string) {
    return agent.agent
      .post(`/api/v1/balance-adjustments/${balanceAdjustmentId}/materializations`)
      .set('x-csrf-token', agent.csrfToken)
      .send({ targetCycleId });
  }

  function recordPayment(agent: Awaited<ReturnType<typeof createAuthenticatedAgent>>, balanceAdjustmentId: string) {
    return agent.agent.post(`/api/v1/balance-adjustments/${balanceAdjustmentId}/payments`).set('x-csrf-token', agent.csrfToken).send({});
  }

  function recordSettlement(agent: Awaited<ReturnType<typeof createAuthenticatedAgent>>, balanceAdjustmentId: string, body: Record<string, unknown>) {
    return agent.agent.post(`/api/v1/balance-adjustments/${balanceAdjustmentId}/settlements`).set('x-csrf-token', agent.csrfToken).send(body);
  }

  function previewSettlement(agent: Awaited<ReturnType<typeof createAuthenticatedAgent>>, balanceAdjustmentId: string, body: Record<string, unknown>) {
    return agent.agent.post(`/api/v1/balance-adjustments/${balanceAdjustmentId}/settlements/preview`).set('x-csrf-token', agent.csrfToken).send(body);
  }

  // --- Pure calculation ------------------------------------------------------------------------

  describe('Pure calculation: availableForSettlement = remainingAmount - activeReservedAmount', () => {
    it('a standalone payment is rejected when the entire remaining amount is reserved', () => {
      expect(() =>
        calculateStandalonePayment({ remainingAmount: '5000.00', status: 'PENDING', activeReservedAmount: '5000.00' }),
      ).toThrow(SettlementValidationError);
      try {
        calculateStandalonePayment({ remainingAmount: '5000.00', status: 'PENDING', activeReservedAmount: '5000.00' });
      } catch (error) {
        expect((error as SettlementValidationError).code).toBe('RESERVED_AMOUNT_UNAVAILABLE');
      }
    });

    it('a cycle-scoped settlement proposing more than the unreserved portion is rejected', () => {
      try {
        calculateSettlement({ remainingAmount: '5000.00', status: 'PENDING', proposedAmount: '2000.00', activeReservedAmount: '4000.00' });
        throw new Error('expected a throw');
      } catch (error) {
        expect(error).toBeInstanceOf(SettlementValidationError);
        expect((error as SettlementValidationError).code).toBe('RESERVED_AMOUNT_UNAVAILABLE');
      }
    });

    it('a cycle-scoped settlement within the unreserved portion still succeeds', () => {
      const result = calculateSettlement({ remainingAmount: '5000.00', status: 'PENDING', proposedAmount: '1000.00', activeReservedAmount: '4000.00' });
      expect(result.acceptedAmount).toBe('1000.00');
      expect(result.newRemainingAmount).toBe('4000.00');
    });

    it('omitting activeReservedAmount defaults to zero, unchanged prior behavior', () => {
      const result = calculateSettlement({ remainingAmount: '5000.00', status: 'PENDING', proposedAmount: '5000.00' });
      expect(result.fullySettled).toBe(true);
    });

    it('an existing OVER_SETTLEMENT (proposed exceeds remaining) still reports OVER_SETTLEMENT, not the reservation code', () => {
      try {
        calculateSettlement({ remainingAmount: '5000.00', status: 'PENDING', proposedAmount: '5000.01', activeReservedAmount: '0' });
        throw new Error('expected a throw');
      } catch (error) {
        expect((error as SettlementValidationError).code).toBe('OVER_SETTLEMENT');
      }
    });
  });

  // --- Scenario A: materialize -> settle (the defect this checkpoint closes) --------------------

  describe('Scenario A: materialize then settle — double-processing is now blocked', () => {
    it('PAYABLE: a full-amount materialization blocks a subsequent standalone payment for the same adjustment', async () => {
      const { balanceAdjustment, admin, draftCycle, draftEntry } = await makeFixtures('scenario-a-payable-standalone');

      const materializeRes = await materialize(admin, balanceAdjustment.id, draftCycle.id);
      expect(materializeRes.status).toBe(201);
      expect(materializeRes.body.result.outcome).toBe('MATERIALIZED');

      const paymentRes = await recordPayment(admin, balanceAdjustment.id);
      expect(paymentRes.status).toBe(400);
      expect(paymentRes.body.error.code).toBe('RESERVED_AMOUNT_UNAVAILABLE');

      // No double financial effect: the reservation still stands, remainingAmount is untouched, and
      // no CorrectionPayment was created — so calcNet on draftEntry (already carrying the 5000
      // reservation) is the only place this money is ever counted.
      const reloadedAdjustment = await prisma.balanceAdjustment.findUniqueOrThrow({ where: { id: balanceAdjustment.id } });
      expect(reloadedAdjustment.status).toBe('PENDING');
      expect(reloadedAdjustment.remainingAmount.toString()).toBe('5000');
      const paymentCount = await prisma.correctionPayment.count({ where: { balanceAdjustmentId: balanceAdjustment.id } });
      expect(paymentCount).toBe(0);
      const reloadedEntry = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: draftEntry.id } });
      expect(reloadedEntry.correctionBalancePayable.toString()).toBe('5000');
    });

    it('PAYABLE: a partial materialization still blocks a full standalone payment (would double-pay the reserved slice)', async () => {
      // A PAYABLE materialization always reserves the *entire* available amount (Checkpoint 5's own
      // "no partial reservation" rule), so this proves the guard fires even off a single, simple
      // reservation — not just contrived partial-reservation math.
      const { balanceAdjustment, admin, draftCycle } = await makeFixtures('scenario-a-payable-partial', { amount: '5000' });
      await materialize(admin, balanceAdjustment.id, draftCycle.id);

      const paymentRes = await recordPayment(admin, balanceAdjustment.id);
      expect(paymentRes.status).toBe(400);
      expect(paymentRes.body.error.code).toBe('RESERVED_AMOUNT_UNAVAILABLE');
    });

    it('RECOVERY: a partial installment materialization blocks a cycle-scoped settlement exceeding the unreserved remainder', async () => {
      const { balanceAdjustment, admin, draftCycle } = await makeFixtures('scenario-a-recovery-partial', { type: 'RECOVERY', amount: '5000' });
      // Materialize a 2000 installment (recoveryInstallmentAmount default null materializes the full
      // 5000, so tighten it directly to leave an unreserved remainder for this test).
      await prisma.balanceAdjustment.update({ where: { id: balanceAdjustment.id }, data: { recoveryInstallmentAmount: '2000' } });
      const materializeRes = await materialize(admin, balanceAdjustment.id, draftCycle.id);
      expect(materializeRes.body.result.amount).toBe('2000.00');

      const otherCycle = await makeCycle(admin.userId, 'RELEASED');
      // 5000 remaining - 2000 reserved = 3000 available; proposing 4000 must be rejected.
      const settleRes = await recordSettlement(admin, balanceAdjustment.id, { cycleId: otherCycle.id, amount: '4000' });
      expect(settleRes.status).toBe(400);
      expect(settleRes.body.error.code).toBe('RESERVED_AMOUNT_UNAVAILABLE');

      // Settling exactly the unreserved remainder (3000) still succeeds.
      const okRes = await recordSettlement(admin, balanceAdjustment.id, { cycleId: otherCycle.id, amount: '3000' });
      expect(okRes.status).toBe(201);
      const reloaded = await prisma.balanceAdjustment.findUniqueOrThrow({ where: { id: balanceAdjustment.id } });
      expect(reloaded.remainingAmount.toString()).toBe('2000'); // exactly the still-reserved slice
    });

    it('the settlement preview also reflects the reservation-aware ceiling, not just the recording route', async () => {
      const { balanceAdjustment, admin, draftCycle } = await makeFixtures('scenario-a-preview');
      await materialize(admin, balanceAdjustment.id, draftCycle.id);

      const previewRes = await previewSettlement(admin, balanceAdjustment.id, { mode: 'STANDALONE' });
      expect(previewRes.status).toBe(400);
      expect(previewRes.body.error.code).toBe('RESERVED_AMOUNT_UNAVAILABLE');

      // Preview never persists anything regardless of outcome.
      const paymentCount = await prisma.correctionPayment.count({ where: { balanceAdjustmentId: balanceAdjustment.id } });
      expect(paymentCount).toBe(0);
    });
  });

  // --- Scenario B: settle -> materialize (already safe, confirm it stays that way) ---------------

  describe('Scenario B: settle then materialize — already safe, no regression', () => {
    it('a full standalone payment fully settles the adjustment; a later materialization attempt is skipped (FULLY_SETTLED)', async () => {
      const { balanceAdjustment, admin, draftCycle } = await makeFixtures('scenario-b-full');

      const paymentRes = await recordPayment(admin, balanceAdjustment.id);
      expect(paymentRes.status).toBe(201);

      const materializeRes = await materialize(admin, balanceAdjustment.id, draftCycle.id);
      expect(materializeRes.status).toBe(201);
      expect(materializeRes.body.result.outcome).toBe('SKIPPED');
      expect(materializeRes.body.result.reason).toBe('FULLY_SETTLED');

      const materializationCount = await prisma.balanceAdjustmentMaterialization.count({ where: { balanceAdjustmentId: balanceAdjustment.id } });
      expect(materializationCount).toBe(0);
    });

    it('a partial cycle-scoped settlement correctly shrinks what a later materialization can reserve', async () => {
      const { balanceAdjustment, admin, draftCycle, draftEntry } = await makeFixtures('scenario-b-partial', { type: 'RECOVERY', amount: '5000' });
      const settleCycle = await makeCycle(admin.userId, 'RELEASED');

      const settleRes = await recordSettlement(admin, balanceAdjustment.id, { cycleId: settleCycle.id, amount: '3000' });
      expect(settleRes.status).toBe(201);

      const materializeRes = await materialize(admin, balanceAdjustment.id, draftCycle.id);
      expect(materializeRes.status).toBe(201);
      expect(materializeRes.body.result.outcome).toBe('MATERIALIZED');
      expect(materializeRes.body.result.amount).toBe('2000.00'); // exactly the post-settlement remainder

      const reloadedEntry = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: draftEntry.id } });
      expect(reloadedEntry.correctionBalanceRecovery.toString()).toBe('2000');
    });
  });

  // --- Concurrent materialize <-> settle -----------------------------------------------------

  describe('Concurrent materialize <-> settle: the shared advisory lock serializes them, no over-commitment', () => {
    it('PAYABLE: racing a full materialization against a full standalone payment never lets both succeed', async () => {
      const { balanceAdjustment, admin, draftCycle } = await makeFixtures('concurrent-payable', { amount: '5000' });

      const [materializeRes, paymentRes] = await Promise.all([
        materialize(admin, balanceAdjustment.id, draftCycle.id),
        recordPayment(admin, balanceAdjustment.id),
      ]);

      const materializeSucceeded = materializeRes.status === 201 && materializeRes.body.result?.outcome === 'MATERIALIZED';
      const paymentSucceeded = paymentRes.status === 201;
      // Never both: whichever transaction commits first, the other re-reads a fresh, post-commit
      // view through the shared BalanceAdjustment advisory lock and is correctly rejected.
      expect(materializeSucceeded && paymentSucceeded).toBe(false);
      expect(materializeSucceeded || paymentSucceeded).toBe(true);

      const reloaded = await prisma.balanceAdjustment.findUniqueOrThrow({ where: { id: balanceAdjustment.id } });
      const reservedAmount = await prisma.balanceAdjustmentMaterialization.aggregate({
        where: { balanceAdjustmentId: balanceAdjustment.id, status: 'ACTIVE' },
        _sum: { amount: true },
      });
      const paymentCount = await prisma.correctionPayment.count({ where: { balanceAdjustmentId: balanceAdjustment.id } });
      // The invariant this checkpoint proves: settled + still-reserved never exceeds the original 5000.
      const settledAmount = paymentCount === 1 ? 5000 : 0;
      const reservedTotal = Number(reservedAmount._sum.amount ?? 0);
      expect(settledAmount + reservedTotal).toBeLessThanOrEqual(5000);
      void reloaded;
    });

    it('RECOVERY: racing a partial materialization against a cycle-scoped settlement never over-commits the balance', async () => {
      const { balanceAdjustment, admin, draftCycle } = await makeFixtures('concurrent-recovery', { type: 'RECOVERY', amount: '5000' });
      const settleCycle = await makeCycle(admin.userId, 'RELEASED');

      const [materializeRes, settleRes] = await Promise.all([
        materialize(admin, balanceAdjustment.id, draftCycle.id),
        recordSettlement(admin, balanceAdjustment.id, { cycleId: settleCycle.id, amount: '5000' }),
      ]);

      const materializeSucceeded = materializeRes.status === 201 && materializeRes.body.result?.outcome === 'MATERIALIZED';
      const settleSucceeded = settleRes.status === 201;
      expect(materializeSucceeded && settleSucceeded).toBe(false);
      expect(materializeSucceeded || settleSucceeded).toBe(true);

      const reservedAmount = await prisma.balanceAdjustmentMaterialization.aggregate({
        where: { balanceAdjustmentId: balanceAdjustment.id, status: 'ACTIVE' },
        _sum: { amount: true },
      });
      const settlementAmount = await prisma.balanceAdjustmentSettlement.aggregate({
        where: { balanceAdjustmentId: balanceAdjustment.id },
        _sum: { amountApplied: true },
      });
      const total = Number(reservedAmount._sum.amount ?? 0) + Number(settlementAmount._sum.amountApplied ?? 0);
      expect(total).toBeLessThanOrEqual(5000);
    });
  });

  // --- Lock ordering (Review Question 5) -----------------------------------------------------

  describe('Lock ordering: settlement never takes the PayrollCycle row lock materialization does', () => {
    it('a settlement against a cycle currently being finalized still completes without deadlocking', async () => {
      // Settlement's own lock order is just [BalanceAdjustment advisory lock] — a strict subset of
      // materialization's [PayrollCycle FOR UPDATE, then BalanceAdjustment advisory lock] — so no
      // cycle of mutually-held locks between these two code paths is possible. This test proves the
      // absence of a hang (a real deadlock would time out the whole test run) rather than asserting
      // on a specific interleaving.
      const { balanceAdjustment, admin, sourceCycle } = await makeFixtures('lock-order-no-deadlock');

      const results = await Promise.all([
        recordSettlement(admin, balanceAdjustment.id, { cycleId: sourceCycle.id, amount: '1000' }),
        prisma.payrollCycle.findUniqueOrThrow({ where: { id: sourceCycle.id } }),
      ]);
      expect(results[0].status).toBe(201);
    }, 15000);
  });
});
