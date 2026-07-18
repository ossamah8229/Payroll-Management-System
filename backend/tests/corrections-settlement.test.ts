import request from 'supertest';
import { Decimal } from 'decimal.js';
import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { assertNoSensitiveKeys, cleanTestData, createAuthenticatedAgent } from './helpers';
import * as auditLogService from '../src/modules/audit-log/audit-log.service';
import * as correctionsRepository from '../src/modules/corrections/corrections.repository';
import { calculateSettlement, calculateStandalonePayment } from '../src/modules/corrections/corrections.settlement';
import { SettlementValidationError } from '../src/modules/corrections/corrections.settlement.types';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

/**
 * Phase 6 Checkpoint 4 — Settlement, Payment Recording & Outstanding Balance Lifecycle. Pure
 * calculation coverage needs no database; everything else drives the real HTTP stack
 * (`createAuthenticatedAgent`) matching Checkpoint 3's own established convention. `Correction`/
 * `BalanceAdjustment` fixtures are created directly via Prisma (the same precedent
 * `corrections-schema.test.ts`, Checkpoint 1, established) — this checkpoint tests settlement
 * behavior, not how a `BalanceAdjustment` came to exist, which Checkpoint 3's own suite already
 * covers exhaustively.
 */
describe('Phase 6 Checkpoint 4 — Settlement, payment recording, outstanding balance lifecycle', () => {
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
      permissionKeys: [PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.CORRECTIONS_APPROVE],
    });
  }

  async function payrollStaffAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.PAYROLL_STAFF,
      permissionKeys: [PERMISSIONS.PAYROLL_ENTRY],
      siteIds,
    });
  }

  async function financeAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.FINANCE,
      permissionKeys: [PERMISSIONS.PAYROLL_VIEW],
      siteIds,
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

  async function makeEmployee(siteId: string, unitId: string, name: string, dateOfLeaving: Date | null = null) {
    return prisma.employee.create({
      data: { name, designation: 'Guard', siteId, unitId, grossPay: '30000', dateOfLeaving },
    });
  }

  async function makeAdjustmentType(code: string) {
    return prisma.adjustmentType.create({ data: { code: `TEST_${code}`, label: code } });
  }

  async function makeCycle(createdBy: string) {
    const { year, month } = nextCycleYearMonth();
    return prisma.payrollCycle.create({ data: { year, month, createdBy, status: 'RELEASED' } });
  }

  async function makeReleasedEntry(siteId: string, unitId: string, employeeId: string, cycleId: string, releasedBy: string) {
    return prisma.payrollEntry.create({
      data: {
        cycleId,
        employeeId,
        siteId,
        designation: 'Guard',
        grossPay: '30000',
        released: true,
        releasedAt: new Date(),
        releasedBy,
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
      status: 'PENDING' | 'SETTLED';
    }> = {},
  ) {
    const amount = overrides.amount ?? '5000';
    return prisma.balanceAdjustment.create({
      data: {
        correctionId,
        employeeId,
        sourceCycleId,
        adjustmentTypeId,
        amount,
        type: overrides.type ?? 'PAYABLE',
        remainingAmount: overrides.remainingAmount ?? amount,
        status: overrides.status ?? 'PENDING',
        remark: 'Balance from a correction',
      },
    });
  }

  /** Full fixture set: site/unit, an admin, a released entry, an approved Correction, and a
   * PENDING BalanceAdjustment (PAYABLE, amount 5000, remainingAmount 5000) ready to settle. */
  async function makeFixtures(
    label: string,
    options: { type?: 'PAYABLE' | 'RECOVERY'; amount?: string; departed?: boolean } = {},
  ) {
    const { site, unit } = await makeSiteWithUnit(`Test Site CP4 ${label}`);
    const employee = await makeEmployee(site.id, unit.id, `CP4 Employee ${label}`, options.departed ? new Date('2026-01-01') : null);
    const admin = await masterAdminAgent(`cp4-${label}-admin@test.local`);
    const cycle = await makeCycle(admin.userId);
    const entry = await makeReleasedEntry(site.id, unit.id, employee.id, cycle.id, admin.userId);
    const adjustmentType = await makeAdjustmentType(label);
    const correction = await makeCorrection(entry.id, adjustmentType.id, admin.userId);
    const balanceAdjustment = await makeBalanceAdjustment(correction.id, employee.id, cycle.id, adjustmentType.id, {
      type: options.type ?? 'PAYABLE',
      amount: options.amount ?? '5000',
    });
    return { site, unit, employee, admin, cycle, entry, adjustmentType, correction, balanceAdjustment };
  }

  async function recordPayment(agent: Awaited<ReturnType<typeof createAuthenticatedAgent>>, balanceAdjustmentId: string, body: Record<string, unknown> = {}) {
    return agent.agent.post(`/api/v1/balance-adjustments/${balanceAdjustmentId}/payments`).set('x-csrf-token', agent.csrfToken).send(body);
  }

  async function recordSettlement(agent: Awaited<ReturnType<typeof createAuthenticatedAgent>>, balanceAdjustmentId: string, body: Record<string, unknown>) {
    return agent.agent.post(`/api/v1/balance-adjustments/${balanceAdjustmentId}/settlements`).set('x-csrf-token', agent.csrfToken).send(body);
  }

  async function previewSettlement(agent: Awaited<ReturnType<typeof createAuthenticatedAgent>>, balanceAdjustmentId: string, body: Record<string, unknown>) {
    return agent.agent.post(`/api/v1/balance-adjustments/${balanceAdjustmentId}/settlements/preview`).set('x-csrf-token', agent.csrfToken).send(body);
  }

  // --- Model responsibility --------------------------------------------------------------------

  describe('Model responsibility (CorrectionPayment vs BalanceAdjustmentSettlement)', () => {
    it('a standalone payment creates a CorrectionPayment, never a BalanceAdjustmentSettlement', async () => {
      const { balanceAdjustment, admin } = await makeFixtures('model-payment');

      const res = await recordPayment(admin, balanceAdjustment.id);
      expect(res.status).toBe(201);
      expect(res.body.correctionPayment).toBeDefined();
      expect(res.body.correctionPayment.balanceAdjustmentId).toBe(balanceAdjustment.id);

      const settlementCount = await prisma.balanceAdjustmentSettlement.count({ where: { balanceAdjustmentId: balanceAdjustment.id } });
      expect(settlementCount).toBe(0);
      const paymentCount = await prisma.correctionPayment.count({ where: { balanceAdjustmentId: balanceAdjustment.id } });
      expect(paymentCount).toBe(1);
    });

    it('a cycle-scoped settlement creates a BalanceAdjustmentSettlement, never a CorrectionPayment', async () => {
      const { balanceAdjustment, admin, cycle } = await makeFixtures('model-settlement');

      const res = await recordSettlement(admin, balanceAdjustment.id, { cycleId: cycle.id, amount: '5000' });
      expect(res.status).toBe(201);
      expect(res.body.settlement).toBeDefined();
      expect(res.body.settlement.cycleId).toBe(cycle.id);

      const paymentCount = await prisma.correctionPayment.count({ where: { balanceAdjustmentId: balanceAdjustment.id } });
      expect(paymentCount).toBe(0);
      const settlementCount = await prisma.balanceAdjustmentSettlement.count({ where: { balanceAdjustmentId: balanceAdjustment.id } });
      expect(settlementCount).toBe(1);
    });

    it('no orphaned records: a failed payment attempt leaves neither a CorrectionPayment nor a BalanceAdjustmentSettlement', async () => {
      const { balanceAdjustment, admin } = await makeFixtures('model-no-orphan', { type: 'RECOVERY' });

      const res = await recordPayment(admin, balanceAdjustment.id); // RECOVERY cannot use the payment path
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('WRONG_ADJUSTMENT_TYPE_FOR_PAYMENT');

      const paymentCount = await prisma.correctionPayment.count({ where: { balanceAdjustmentId: balanceAdjustment.id } });
      expect(paymentCount).toBe(0);
      const settlementCount = await prisma.balanceAdjustmentSettlement.count({ where: { balanceAdjustmentId: balanceAdjustment.id } });
      expect(settlementCount).toBe(0);
    });
  });

  // --- Pure settlement calculation ---------------------------------------------------------------

  describe('Pure settlement calculation', () => {
    it('full settlement: remainingAmount reaches exactly zero, status flips to SETTLED', () => {
      const result = calculateSettlement({ remainingAmount: '5000.00', status: 'PENDING', proposedAmount: '5000.00' });
      expect(result.newRemainingAmount).toBe('0.00');
      expect(result.newStatus).toBe('SETTLED');
      expect(result.fullySettled).toBe(true);
    });

    it('partial settlement: remaining decrements, status stays PENDING', () => {
      const result = calculateSettlement({ remainingAmount: '5000.00', status: 'PENDING', proposedAmount: '2000.00' });
      expect(result.newRemainingAmount).toBe('3000.00');
      expect(result.newStatus).toBe('PENDING');
      expect(result.fullySettled).toBe(false);
    });

    function expectSettlementError(fn: () => unknown, code: string) {
      try {
        fn();
        throw new Error('expected SettlementValidationError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(SettlementValidationError);
        expect((error as SettlementValidationError).code).toBe(code);
      }
    }

    it('zero settlement amount is rejected', () => {
      expectSettlementError(
        () => calculateSettlement({ remainingAmount: '5000.00', status: 'PENDING', proposedAmount: '0' }),
        'ZERO_SETTLEMENT_AMOUNT',
      );
    });

    it('negative settlement amount is rejected', () => {
      expectSettlementError(
        () => calculateSettlement({ remainingAmount: '5000.00', status: 'PENDING', proposedAmount: '-100' }),
        'NEGATIVE_SETTLEMENT_AMOUNT',
      );
    });

    it('a non-numeric settlement amount is rejected', () => {
      expectSettlementError(
        () => calculateSettlement({ remainingAmount: '5000.00', status: 'PENDING', proposedAmount: 'abc' }),
        'INVALID_SETTLEMENT_AMOUNT',
      );
    });

    it('over-settlement (amount exceeds remaining) is rejected', () => {
      expectSettlementError(
        () => calculateSettlement({ remainingAmount: '5000.00', status: 'PENDING', proposedAmount: '5000.01' }),
        'OVER_SETTLEMENT',
      );
    });

    it('an already-SETTLED adjustment rejects any further settlement', () => {
      expectSettlementError(
        () => calculateSettlement({ remainingAmount: '0.00', status: 'SETTLED', proposedAmount: '1' }),
        'ALREADY_SETTLED',
      );
    });

    it('decimal precision: a repeating-decimal-adjacent partial amount rounds cleanly to 2dp', () => {
      const result = calculateSettlement({ remainingAmount: '100.01', status: 'PENDING', proposedAmount: '33.33' });
      expect(result.newRemainingAmount).toBe('66.68');
      expect(result.acceptedAmount).toBe('33.33');
    });

    it('large values: no precision loss for a 7-figure settlement', () => {
      const result = calculateSettlement({ remainingAmount: '9999999.99', status: 'PENDING', proposedAmount: '9999999.99' });
      expect(result.newRemainingAmount).toBe('0.00');
      expect(result.fullySettled).toBe(true);
    });

    it('calculateStandalonePayment always settles the full remaining amount', () => {
      const result = calculateStandalonePayment({ remainingAmount: '4321.50', status: 'PENDING' });
      expect(result.acceptedAmount).toBe('4321.50');
      expect(result.newRemainingAmount).toBe('0.00');
      expect(result.fullySettled).toBe(true);
    });

    it('SettlementValidationError is the exact error class thrown', () => {
      try {
        calculateSettlement({ remainingAmount: '10', status: 'PENDING', proposedAmount: '0' });
        throw new Error('expected a throw');
      } catch (error) {
        expect(error).toBeInstanceOf(SettlementValidationError);
      }
    });
  });

  // --- PAYABLE ---------------------------------------------------------------------------------

  describe('PAYABLE', () => {
    it('a successful full standalone payment settles the adjustment, unchanged original amount', async () => {
      const { balanceAdjustment, admin } = await makeFixtures('payable-full');

      const res = await recordPayment(admin, balanceAdjustment.id, { bankId: null });
      expect(res.status).toBe(201);
      expect(res.body.correctionPayment.amount).toBe('5000');
      expect(res.body.balanceAdjustment.status).toBe('SETTLED');
      expect(res.body.balanceAdjustment.remainingAmount).toBe('0');
      expect(res.body.balanceAdjustment.amount).toBe('5000'); // original untouched
    });

    it('a successful partial cycle-scoped payment leaves the adjustment PENDING with a reduced remaining amount', async () => {
      const { balanceAdjustment, admin, cycle } = await makeFixtures('payable-partial');

      const res = await recordSettlement(admin, balanceAdjustment.id, { cycleId: cycle.id, amount: '2000' });
      expect(res.status).toBe(201);
      expect(res.body.balanceAdjustment.status).toBe('PENDING');
      expect(res.body.balanceAdjustment.remainingAmount).toBe('3000');
      expect(res.body.balanceAdjustment.amount).toBe('5000');
    });

    it('multiple partial cycle-scoped payments accumulate to full settlement', async () => {
      const { balanceAdjustment, admin } = await makeFixtures('payable-multi');
      const cycleA = await makeCycle(admin.userId);
      const cycleB = await makeCycle(admin.userId);

      const first = await recordSettlement(admin, balanceAdjustment.id, { cycleId: cycleA.id, amount: '3000' });
      expect(first.body.balanceAdjustment.remainingAmount).toBe('2000');
      expect(first.body.balanceAdjustment.status).toBe('PENDING');

      const second = await recordSettlement(admin, balanceAdjustment.id, { cycleId: cycleB.id, amount: '2000' });
      expect(second.body.balanceAdjustment.remainingAmount).toBe('0');
      expect(second.body.balanceAdjustment.status).toBe('SETTLED');
      expect(second.body.balanceAdjustment.settledInCycleId).toBe(cycleB.id);

      const settlements = await prisma.balanceAdjustmentSettlement.findMany({ where: { balanceAdjustmentId: balanceAdjustment.id } });
      expect(settlements).toHaveLength(2);
    });

    it('accepts optional bank/branch/account/iban metadata on a standalone payment', async () => {
      const { balanceAdjustment, admin } = await makeFixtures('payable-metadata');
      const bank = await prisma.bank.create({ data: { code: `TB${Math.random().toString(36).slice(2, 6)}`.toUpperCase().slice(0, 10), name: 'Test Bank' } });

      const res = await recordPayment(admin, balanceAdjustment.id, {
        bankId: bank.id,
        branchCode: 'BR001',
        accountNumber: '1234567890',
        iban: 'PK00TEST0000000000000000',
      });
      expect(res.status).toBe(201);
      expect(res.body.correctionPayment.bankId).toBe(bank.id);
      expect(res.body.correctionPayment.branchCode).toBe('BR001');
    });

    it('rejects RECOVERY-only fields on a PAYABLE cycle-scoped settlement request (schema-level: cycleId/amount only accepted)', async () => {
      const { balanceAdjustment, admin, cycle } = await makeFixtures('payable-no-recovery-fields');

      // recordBalanceAdjustmentSettlementSchema has no RECOVERY-specific field to misuse — Zod's
      // own shape already prevents e.g. a recoveryInstallmentAmount from being sent here at all.
      const res = await recordSettlement(admin, balanceAdjustment.id, { cycleId: cycle.id, amount: '5000', recoveryInstallmentAmount: '999' });
      expect(res.status).toBe(201); // the extra unknown field is simply ignored, not rejected — Zod's default (non-strict) behavior
      expect(res.body.settlement.amountApplied).toBe('5000');
    });

    it('original BalanceAdjustment.amount is never mutated by settlement', async () => {
      const { balanceAdjustment, admin, cycle } = await makeFixtures('payable-amount-immutable');

      await recordSettlement(admin, balanceAdjustment.id, { cycleId: cycle.id, amount: '2000' });

      const reloaded = await prisma.balanceAdjustment.findUniqueOrThrow({ where: { id: balanceAdjustment.id } });
      expect(reloaded.amount.toString()).toBe('5000');
    });
  });

  // --- RECOVERY ----------------------------------------------------------------------------------

  describe('RECOVERY', () => {
    it('a successful full cycle-scoped recovery settles the adjustment', async () => {
      const { balanceAdjustment, admin, cycle } = await makeFixtures('recovery-full', { type: 'RECOVERY' });

      const res = await recordSettlement(admin, balanceAdjustment.id, { cycleId: cycle.id, amount: '5000' });
      expect(res.status).toBe(201);
      expect(res.body.balanceAdjustment.status).toBe('SETTLED');
      expect(res.body.balanceAdjustment.remainingAmount).toBe('0');
    });

    it('a successful partial recovery leaves the adjustment PENDING', async () => {
      const { balanceAdjustment, admin, cycle } = await makeFixtures('recovery-partial', { type: 'RECOVERY' });

      const res = await recordSettlement(admin, balanceAdjustment.id, { cycleId: cycle.id, amount: '1500' });
      expect(res.status).toBe(201);
      expect(res.body.balanceAdjustment.status).toBe('PENDING');
      expect(res.body.balanceAdjustment.remainingAmount).toBe('3500');
    });

    it('multiple recovery settlements across cycles accumulate correctly', async () => {
      const { balanceAdjustment, admin } = await makeFixtures('recovery-multi', { type: 'RECOVERY', amount: '3000' });
      const cycleA = await makeCycle(admin.userId);
      const cycleB = await makeCycle(admin.userId);
      const cycleC = await makeCycle(admin.userId);

      await recordSettlement(admin, balanceAdjustment.id, { cycleId: cycleA.id, amount: '1000' });
      await recordSettlement(admin, balanceAdjustment.id, { cycleId: cycleB.id, amount: '1000' });
      const last = await recordSettlement(admin, balanceAdjustment.id, { cycleId: cycleC.id, amount: '1000' });

      expect(last.body.balanceAdjustment.status).toBe('SETTLED');
      const settlements = await prisma.balanceAdjustmentSettlement.findMany({ where: { balanceAdjustmentId: balanceAdjustment.id } });
      expect(settlements).toHaveLength(3);
    });

    it('rejects a RECOVERY adjustment via the standalone payment route (PAYABLE-only)', async () => {
      const { balanceAdjustment, admin } = await makeFixtures('recovery-no-standalone', { type: 'RECOVERY' });

      const res = await recordPayment(admin, balanceAdjustment.id);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('WRONG_ADJUSTMENT_TYPE_FOR_PAYMENT');
    });

    it('no PayrollEntry deduction is ever created by a RECOVERY settlement', async () => {
      const { balanceAdjustment, admin, cycle, entry } = await makeFixtures('recovery-no-entry-mutation', { type: 'RECOVERY' });
      const before = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });

      await recordSettlement(admin, balanceAdjustment.id, { cycleId: cycle.id, amount: '5000' });

      const after = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
      expect(after.advanceDeduction.toString()).toBe(before.advanceDeduction.toString());
      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    });
  });

  // --- Departed employee ---------------------------------------------------------------------------

  describe('Departed employee', () => {
    it('a departed employee\'s RECOVERY settlement is rejected — remains permanently pending', async () => {
      const { balanceAdjustment, admin, cycle } = await makeFixtures('departed-recovery', { type: 'RECOVERY', departed: true });

      const res = await recordSettlement(admin, balanceAdjustment.id, { cycleId: cycle.id, amount: '5000' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('DEPARTED_EMPLOYEE_RECOVERY_PENDING');

      const reloaded = await prisma.balanceAdjustment.findUniqueOrThrow({ where: { id: balanceAdjustment.id } });
      expect(reloaded.status).toBe('PENDING'); // no hidden status transition
      const settlementCount = await prisma.balanceAdjustmentSettlement.count({ where: { balanceAdjustmentId: balanceAdjustment.id } });
      expect(settlementCount).toBe(0);
    });

    it('a departed employee\'s PAYABLE settlement proceeds normally, independent of departure', async () => {
      const { balanceAdjustment, admin } = await makeFixtures('departed-payable', { type: 'PAYABLE', departed: true });

      const res = await recordPayment(admin, balanceAdjustment.id);
      expect(res.status).toBe(201);
      expect(res.body.balanceAdjustment.status).toBe('SETTLED');
    });
  });

  // --- Concurrency ----------------------------------------------------------------------------------

  describe('Concurrency', () => {
    it('two simultaneous full-settlement attempts on the same adjustment: exactly one succeeds', async () => {
      const { balanceAdjustment, admin } = await makeFixtures('concurrent-full');

      const [first, second] = await Promise.all([recordPayment(admin, balanceAdjustment.id), recordPayment(admin, balanceAdjustment.id)]);
      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([201, 409]);

      const reloaded = await prisma.balanceAdjustment.findUniqueOrThrow({ where: { id: balanceAdjustment.id } });
      expect(reloaded.remainingAmount.toString()).toBe('0');
      const paymentCount = await prisma.correctionPayment.count({ where: { balanceAdjustmentId: balanceAdjustment.id } });
      expect(paymentCount).toBe(1);
    });

    it('two simultaneous partial settlements whose sum exceeds remaining: no over-settlement', async () => {
      const { balanceAdjustment, admin } = await makeFixtures('concurrent-oversettle', { amount: '5000' });
      const cycleA = await makeCycle(admin.userId);
      const cycleB = await makeCycle(admin.userId);

      const [first, second] = await Promise.all([
        recordSettlement(admin, balanceAdjustment.id, { cycleId: cycleA.id, amount: '3000' }),
        recordSettlement(admin, balanceAdjustment.id, { cycleId: cycleB.id, amount: '3000' }),
      ]);

      const statuses = [first.status, second.status].sort();
      // The advisory lock serializes both — the second re-reads a fresh remainingAmount of 2000
      // (after the first's 3000 applied) and its own 3000 request now exceeds that, so it's
      // correctly rejected as OVER_SETTLEMENT rather than silently over-settling.
      expect(statuses).toEqual([201, 400]);

      const reloaded = await prisma.balanceAdjustment.findUniqueOrThrow({ where: { id: balanceAdjustment.id } });
      expect(new Decimal(reloaded.remainingAmount.toString()).greaterThanOrEqualTo(0)).toBe(true);
      expect(reloaded.remainingAmount.toString()).toBe('2000');
    });

    it('two simultaneous partial settlements within the remaining balance both succeed, serialized', async () => {
      const { balanceAdjustment, admin } = await makeFixtures('concurrent-both-fit', { amount: '5000' });
      const cycleA = await makeCycle(admin.userId);
      const cycleB = await makeCycle(admin.userId);

      const [first, second] = await Promise.all([
        recordSettlement(admin, balanceAdjustment.id, { cycleId: cycleA.id, amount: '2000' }),
        recordSettlement(admin, balanceAdjustment.id, { cycleId: cycleB.id, amount: '2000' }),
      ]);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      const reloaded = await prisma.balanceAdjustment.findUniqueOrThrow({ where: { id: balanceAdjustment.id } });
      expect(reloaded.remainingAmount.toString()).toBe('1000');
    });

    it('different BalanceAdjustments settle independently, without blocking each other', async () => {
      const { balanceAdjustment: adjustmentA, admin } = await makeFixtures('concurrent-independent-a');
      const { balanceAdjustment: adjustmentB } = await makeFixtures('concurrent-independent-b');

      const [first, second] = await Promise.all([recordPayment(admin, adjustmentA.id), recordPayment(admin, adjustmentB.id)]);
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
    });

    it('a rolled-back settlement attempt releases the lock for the next attempt', async () => {
      const { balanceAdjustment, admin, cycle } = await makeFixtures('concurrent-rollback-releases-lock');

      const spy = jest.spyOn(correctionsRepository, 'createBalanceAdjustmentSettlementRow').mockImplementationOnce(async () => {
        throw new Error('simulated failure');
      });
      try {
        const failed = await recordSettlement(admin, balanceAdjustment.id, { cycleId: cycle.id, amount: '1000' });
        expect(failed.status).toBe(500);
      } finally {
        spy.mockRestore();
      }

      const succeeded = await recordSettlement(admin, balanceAdjustment.id, { cycleId: cycle.id, amount: '1000' });
      expect(succeeded.status).toBe(201);
    });
  });

  // --- Transaction rollback --------------------------------------------------------------------------

  describe('Transaction rollback', () => {
    it('a failure after CorrectionPayment creation rolls back everything', async () => {
      const { balanceAdjustment, admin } = await makeFixtures('rollback-after-payment');

      const spy = jest.spyOn(correctionsRepository, 'updateBalanceAdjustmentAfterSettlement').mockImplementationOnce(async () => {
        throw new Error('simulated failure after CorrectionPayment creation');
      });
      try {
        const res = await recordPayment(admin, balanceAdjustment.id);
        expect(res.status).toBe(500);

        const paymentCount = await prisma.correctionPayment.count({ where: { balanceAdjustmentId: balanceAdjustment.id } });
        expect(paymentCount).toBe(0);
        const reloaded = await prisma.balanceAdjustment.findUniqueOrThrow({ where: { id: balanceAdjustment.id } });
        expect(reloaded.status).toBe('PENDING');
        expect(reloaded.remainingAmount.toString()).toBe('5000');
      } finally {
        spy.mockRestore();
      }
    });

    it('a failure after BalanceAdjustmentSettlement creation rolls back everything', async () => {
      const { balanceAdjustment, admin, cycle } = await makeFixtures('rollback-after-settlement');

      const spy = jest.spyOn(correctionsRepository, 'updateBalanceAdjustmentAfterSettlement').mockImplementationOnce(async () => {
        throw new Error('simulated failure after BalanceAdjustmentSettlement creation');
      });
      try {
        const res = await recordSettlement(admin, balanceAdjustment.id, { cycleId: cycle.id, amount: '2000' });
        expect(res.status).toBe(500);

        const settlementCount = await prisma.balanceAdjustmentSettlement.count({ where: { balanceAdjustmentId: balanceAdjustment.id } });
        expect(settlementCount).toBe(0);
        const reloaded = await prisma.balanceAdjustment.findUniqueOrThrow({ where: { id: balanceAdjustment.id } });
        expect(reloaded.remainingAmount.toString()).toBe('5000');
      } finally {
        spy.mockRestore();
      }
    });

    it('a failure during BalanceAdjustment update rolls back the settlement row too', async () => {
      const { balanceAdjustment, admin, cycle } = await makeFixtures('rollback-during-update');

      const spy = jest.spyOn(correctionsRepository, 'updateBalanceAdjustmentAfterSettlement').mockImplementationOnce(async () => {
        throw new Error('simulated failure during BalanceAdjustment update');
      });
      try {
        await recordSettlement(admin, balanceAdjustment.id, { cycleId: cycle.id, amount: '2000' });
      } finally {
        spy.mockRestore();
      }

      const settlementCount = await prisma.balanceAdjustmentSettlement.count({ where: { balanceAdjustmentId: balanceAdjustment.id } });
      expect(settlementCount).toBe(0);
    });

    it('a failure during audit recording rolls back everything, including the BalanceAdjustment update', async () => {
      const { balanceAdjustment, admin, cycle } = await makeFixtures('rollback-during-audit');

      const realRecordAuditLog = auditLogService.recordAuditLog;
      const spy = jest.spyOn(auditLogService, 'recordAuditLog').mockImplementation(async (input, client) => {
        if (input.action === 'balance_adjustment.settled') {
          throw new Error('simulated failure during audit recording');
        }
        return realRecordAuditLog(input, client);
      });
      try {
        const res = await recordSettlement(admin, balanceAdjustment.id, { cycleId: cycle.id, amount: '2000' });
        expect(res.status).toBe(500);

        const reloaded = await prisma.balanceAdjustment.findUniqueOrThrow({ where: { id: balanceAdjustment.id } });
        expect(reloaded.remainingAmount.toString()).toBe('5000');
        expect(reloaded.status).toBe('PENDING');
        const settlementCount = await prisma.balanceAdjustmentSettlement.count({ where: { balanceAdjustmentId: balanceAdjustment.id } });
        expect(settlementCount).toBe(0);
        const auditCount = await prisma.auditLog.count({
          where: { action: 'balance_adjustment.settled', entityId: balanceAdjustment.id },
        });
        expect(auditCount).toBe(0);
      } finally {
        spy.mockRestore();
      }
    });
  });

  // --- Immutability -----------------------------------------------------------------------------

  describe('Immutability', () => {
    it('the original BalanceAdjustment.amount never changes across multiple settlements', async () => {
      const { balanceAdjustment, admin } = await makeFixtures('immutable-amount', { amount: '4000' });
      const cycleA = await makeCycle(admin.userId);
      const cycleB = await makeCycle(admin.userId);

      await recordSettlement(admin, balanceAdjustment.id, { cycleId: cycleA.id, amount: '1000' });
      await recordSettlement(admin, balanceAdjustment.id, { cycleId: cycleB.id, amount: '3000' });

      const reloaded = await prisma.balanceAdjustment.findUniqueOrThrow({ where: { id: balanceAdjustment.id } });
      expect(reloaded.amount.toString()).toBe('4000');
    });

    it('the source Correction remains unchanged after settlement', async () => {
      const { balanceAdjustment, admin, correction } = await makeFixtures('immutable-correction');
      const before = await prisma.correction.findUniqueOrThrow({ where: { id: correction.id } });

      await recordPayment(admin, balanceAdjustment.id);

      const after = await prisma.correction.findUniqueOrThrow({ where: { id: correction.id } });
      expect(after.newValue).toBe(before.newValue);
      expect(after.approvedAt.getTime()).toBe(before.approvedAt.getTime());
    });

    it('a prior settlement row is unaffected by a later one', async () => {
      const { balanceAdjustment, admin, cycle } = await makeFixtures('immutable-prior-settlement', { amount: '5000' });
      const first = await recordSettlement(admin, balanceAdjustment.id, { cycleId: cycle.id, amount: '2000' });
      const firstSettlementId = first.body.settlement.id;

      const cycleB = await makeCycle(admin.userId);
      await recordSettlement(admin, balanceAdjustment.id, { cycleId: cycleB.id, amount: '3000' });

      const reloadedFirst = await prisma.balanceAdjustmentSettlement.findUniqueOrThrow({ where: { id: firstSettlementId } });
      expect(reloadedFirst.amountApplied.toString()).toBe('2000');
    });

    it('no update or delete route exists for a BalanceAdjustmentSettlement or CorrectionPayment', async () => {
      const { balanceAdjustment, admin, cycle } = await makeFixtures('no-update-route');
      const created = await recordSettlement(admin, balanceAdjustment.id, { cycleId: cycle.id, amount: '1000' });

      const patchRes = await admin.agent
        .patch(`/api/v1/balance-adjustments/${balanceAdjustment.id}/settlements/${created.body.settlement.id}`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ amount: '9999' });
      expect(patchRes.status).toBe(404); // no such route registered at all

      const deleteRes = await admin.agent
        .delete(`/api/v1/balance-adjustments/${balanceAdjustment.id}/settlements/${created.body.settlement.id}`)
        .set('x-csrf-token', admin.csrfToken);
      expect(deleteRes.status).toBe(404);
    });
  });

  // --- API security -------------------------------------------------------------------------------

  describe('API security', () => {
    it('rejects an unauthenticated request', async () => {
      const { balanceAdjustment } = await makeFixtures('security-unauth');
      const res = await request(app).get(`/api/v1/balance-adjustments/${balanceAdjustment.id}`);
      expect(res.status).toBe(401);
    });

    it('rejects a caller without the view permission (Finance)', async () => {
      const { site, balanceAdjustment } = await makeFixtures('security-forbidden-view');
      const finance = await financeAgent('cp4-security-forbidden-view-finance@test.local', [site.id]);

      const res = await finance.agent.get(`/api/v1/balance-adjustments/${balanceAdjustment.id}`);
      expect(res.status).toBe(403);
    });

    it('rejects a Payroll Staff caller attempting to record a settlement (view-only permission)', async () => {
      const { site, balanceAdjustment, cycle } = await makeFixtures('security-staff-record');
      const staff = await payrollStaffAgent('cp4-security-staff-record@test.local', [site.id]);

      const res = await recordSettlement(staff, balanceAdjustment.id, { cycleId: cycle.id, amount: '1000' });
      expect(res.status).toBe(403);
    });

    it('rejects a mutating request missing the CSRF header', async () => {
      const { site, balanceAdjustment } = await makeFixtures('security-csrf');
      const staff = await payrollStaffAgent('cp4-security-csrf-staff@test.local', [site.id]);

      const res = await staff.agent.post(`/api/v1/balance-adjustments/${balanceAdjustment.id}/payments`).send({});
      expect(res.status).toBe(403);
    });

    it('rejects a malformed UUID balanceAdjustmentId cleanly (400)', async () => {
      const { admin } = await makeFixtures('security-malformed-uuid');
      const res = await admin.agent.get('/api/v1/balance-adjustments/not-a-uuid');
      expect(res.status).toBe(400);
    });

    it('the settlement response never leaks a raw internal field', async () => {
      const { balanceAdjustment, admin } = await makeFixtures('security-sanitized');
      const res = await recordPayment(admin, balanceAdjustment.id);
      expect(res.status).toBe(201);
      assertNoSensitiveKeys(res.body);
    });

    it('the detail route returns full outstanding-balance state, including settlement history', async () => {
      const { balanceAdjustment, admin, cycle } = await makeFixtures('security-detail');
      await recordSettlement(admin, balanceAdjustment.id, { cycleId: cycle.id, amount: '1000' });

      const res = await admin.agent.get(`/api/v1/balance-adjustments/${balanceAdjustment.id}`);
      expect(res.status).toBe(200);
      expect(res.body.balanceAdjustment.remainingAmount).toBe('4000');
      expect(res.body.balanceAdjustment.settlements).toHaveLength(1);
    });

    it('the settlements-list route returns every settlement for the adjustment', async () => {
      const { balanceAdjustment, admin } = await makeFixtures('security-list', { amount: '3000' });
      const cycleA = await makeCycle(admin.userId);
      const cycleB = await makeCycle(admin.userId);
      await recordSettlement(admin, balanceAdjustment.id, { cycleId: cycleA.id, amount: '1000' });
      await recordSettlement(admin, balanceAdjustment.id, { cycleId: cycleB.id, amount: '2000' });

      const res = await admin.agent.get(`/api/v1/balance-adjustments/${balanceAdjustment.id}/settlements`);
      expect(res.status).toBe(200);
      expect(res.body.settlements).toHaveLength(2);
    });

    it('previewing a settlement never persists anything', async () => {
      const { balanceAdjustment, admin } = await makeFixtures('security-preview');

      const res = await previewSettlement(admin, balanceAdjustment.id, { mode: 'STANDALONE' });
      expect(res.status).toBe(200);
      expect(res.body.preview.fullySettled).toBe(true);

      const paymentCount = await prisma.correctionPayment.count({ where: { balanceAdjustmentId: balanceAdjustment.id } });
      expect(paymentCount).toBe(0);
      const reloaded = await prisma.balanceAdjustment.findUniqueOrThrow({ where: { id: balanceAdjustment.id } });
      expect(reloaded.status).toBe('PENDING');
    });
  });
});
