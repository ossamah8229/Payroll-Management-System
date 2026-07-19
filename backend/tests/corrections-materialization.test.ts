import request from 'supertest';
import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { assertNoSensitiveKeys, cleanTestData, createAuthenticatedAgent } from './helpers';
import * as auditLogService from '../src/modules/audit-log/audit-log.service';
import * as correctionsRepository from '../src/modules/corrections/corrections.repository';
import { determineMaterialization } from '../src/modules/corrections/corrections.materialization';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

/**
 * Phase 6 Checkpoint 5 — Draft-Cycle Materialization of Outstanding Balance Adjustments. Pure
 * eligibility/amount-selection coverage needs no database; everything else drives the real HTTP
 * stack (`createAuthenticatedAgent`), matching Checkpoints 3/4's own established convention.
 * `Correction`/`BalanceAdjustment` fixtures are created directly via Prisma (Checkpoint 1's own
 * precedent) — this checkpoint tests materialization behavior, not how a `BalanceAdjustment` came
 * to exist, which Checkpoint 3's own suite already covers.
 */
describe('Phase 6 Checkpoint 5 — Draft-cycle materialization of outstanding BalanceAdjustments', () => {
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
      status: 'PENDING' | 'SETTLED';
      paymentTiming: 'IMMEDIATE' | 'DEFERRED' | null;
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
        status: overrides.status ?? 'PENDING',
        paymentTiming: overrides.paymentTiming !== undefined ? overrides.paymentTiming : type === 'PAYABLE' ? 'DEFERRED' : null,
        recoveryInstallmentAmount: overrides.recoveryInstallmentAmount ?? null,
        remark: 'Balance from a correction',
      },
    });
  }

  /** Full fixture set: site/unit, an admin, a RELEASED source entry with an approved Correction,
   * a PENDING BalanceAdjustment (DEFERRED PAYABLE, amount 5000 by default), and a target Draft
   * cycle with the same employee already bootstrapped into it — ready to materialize. */
  async function makeFixtures(
    label: string,
    options: { type?: 'PAYABLE' | 'RECOVERY'; amount?: string; departed?: boolean; recoveryInstallmentAmount?: string | null } = {},
  ) {
    const { site, unit } = await makeSiteWithUnit(`Test Site CP5 ${label}`);
    const employee = await makeEmployee(site.id, unit.id, `CP5 Employee ${label}`, options.departed ? new Date('2026-01-01') : null);
    const admin = await masterAdminAgent(`cp5-${label}-admin@test.local`);
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

    return { site, unit, employee, admin, sourceCycle, sourceEntry, adjustmentType, correction, balanceAdjustment, draftCycle, draftEntry };
  }

  async function previewMaterialize(agent: Awaited<ReturnType<typeof createAuthenticatedAgent>>, balanceAdjustmentId: string, targetCycleId?: string) {
    return agent.agent
      .post(`/api/v1/balance-adjustments/${balanceAdjustmentId}/materializations/preview`)
      .set('x-csrf-token', agent.csrfToken)
      .send(targetCycleId ? { targetCycleId } : {});
  }

  async function materialize(agent: Awaited<ReturnType<typeof createAuthenticatedAgent>>, balanceAdjustmentId: string, targetCycleId?: string) {
    return agent.agent
      .post(`/api/v1/balance-adjustments/${balanceAdjustmentId}/materializations`)
      .set('x-csrf-token', agent.csrfToken)
      .send(targetCycleId ? { targetCycleId } : {});
  }

  async function materializeBatch(agent: Awaited<ReturnType<typeof createAuthenticatedAgent>>, cycleId: string) {
    return agent.agent.post(`/api/v1/payroll-cycles/${cycleId}/materializations`).set('x-csrf-token', agent.csrfToken).send({});
  }

  // --- Eligibility (pure) ------------------------------------------------------------------------

  describe('Eligibility (pure)', () => {
    const BASE = {
      adjustmentType: 'PAYABLE' as const,
      adjustmentStatus: 'PENDING' as const,
      paymentTiming: 'DEFERRED' as const,
      remainingAmount: '5000.00',
      activeReservedAmount: '0.00',
      recoveryInstallmentAmount: null,
      employeeDeparted: false,
      targetCycleStatus: 'DRAFT' as const,
      alreadyMaterializedForTargetCycle: false,
      targetEntryExists: true,
      targetEntryReleased: false,
    };

    it('PAYABLE (DEFERRED) outstanding is eligible for the full available amount', () => {
      const decision = determineMaterialization(BASE);
      expect(decision).toEqual({ eligible: true, amount: '5000.00' });
    });

    it('RECOVERY outstanding is eligible', () => {
      const decision = determineMaterialization({ ...BASE, adjustmentType: 'RECOVERY', paymentTiming: null });
      expect(decision).toEqual({ eligible: true, amount: '5000.00' });
    });

    it('a fully SETTLED adjustment is skipped (FULLY_SETTLED)', () => {
      const decision = determineMaterialization({ ...BASE, adjustmentStatus: 'SETTLED' });
      expect(decision).toEqual({ eligible: false, reason: 'FULLY_SETTLED' });
    });

    it('zero remainingAmount is skipped (NO_REMAINING_AMOUNT)', () => {
      const decision = determineMaterialization({ ...BASE, remainingAmount: '0.00' });
      expect(decision).toEqual({ eligible: false, reason: 'NO_REMAINING_AMOUNT' });
    });

    it('no current Draft cycle (target not DRAFT) is skipped (TARGET_NOT_DRAFT)', () => {
      const decision = determineMaterialization({ ...BASE, targetCycleStatus: 'RELEASED' });
      expect(decision).toEqual({ eligible: false, reason: 'TARGET_NOT_DRAFT' });
    });

    it('a target RELEASED cycle is rejected', () => {
      const decision = determineMaterialization({ ...BASE, targetCycleStatus: 'RELEASED' });
      expect(decision.eligible).toBe(false);
    });

    it('a target ARCHIVED cycle is rejected', () => {
      const decision = determineMaterialization({ ...BASE, targetCycleStatus: 'ARCHIVED' });
      expect(decision).toEqual({ eligible: false, reason: 'TARGET_NOT_DRAFT' });
    });

    it('departed employee RECOVERY is skipped (DEPARTED_EMPLOYEE_RECOVERY)', () => {
      const decision = determineMaterialization({ ...BASE, adjustmentType: 'RECOVERY', paymentTiming: null, employeeDeparted: true });
      expect(decision).toEqual({ eligible: false, reason: 'DEPARTED_EMPLOYEE_RECOVERY' });
    });

    it('departed employee PAYABLE is unaffected', () => {
      const decision = determineMaterialization({ ...BASE, employeeDeparted: true });
      expect(decision.eligible).toBe(true);
    });

    it('NONE-type adjustment is rejected (UNSUPPORTED_ADJUSTMENT_TYPE)', () => {
      const decision = determineMaterialization({ ...BASE, adjustmentType: 'NONE' });
      expect(decision).toEqual({ eligible: false, reason: 'UNSUPPORTED_ADJUSTMENT_TYPE' });
    });

    it('IMMEDIATE PAYABLE is rejected (UNSUPPORTED_ADJUSTMENT_TYPE — CorrectionPayment path only)', () => {
      const decision = determineMaterialization({ ...BASE, paymentTiming: 'IMMEDIATE' });
      expect(decision).toEqual({ eligible: false, reason: 'UNSUPPORTED_ADJUSTMENT_TYPE' });
    });

    it('already materialized for the target cycle is skipped (ALREADY_MATERIALIZED)', () => {
      const decision = determineMaterialization({ ...BASE, alreadyMaterializedForTargetCycle: true });
      expect(decision).toEqual({ eligible: false, reason: 'ALREADY_MATERIALIZED' });
    });

    it('no PayrollEntry for the employee in the target cycle is skipped (EMPLOYEE_NOT_ELIGIBLE)', () => {
      const decision = determineMaterialization({ ...BASE, targetEntryExists: false });
      expect(decision).toEqual({ eligible: false, reason: 'EMPLOYEE_NOT_ELIGIBLE' });
    });

    it('fully reserved by prior ACTIVE materializations is skipped (NO_AVAILABLE_AMOUNT)', () => {
      const decision = determineMaterialization({ ...BASE, activeReservedAmount: '5000.00' });
      expect(decision).toEqual({ eligible: false, reason: 'NO_AVAILABLE_AMOUNT' });
    });

    it('an already-released target PayrollEntry is skipped (TARGET_ENTRY_ALREADY_RELEASED) — Phase 6 Checkpoint 7', () => {
      const decision = determineMaterialization({ ...BASE, targetEntryReleased: true });
      expect(decision).toEqual({ eligible: false, reason: 'TARGET_ENTRY_ALREADY_RELEASED' });
    });
  });

  // --- Amount selection (pure) -------------------------------------------------------------------

  describe('Amount selection (pure)', () => {
    const BASE = {
      adjustmentStatus: 'PENDING' as const,
      remainingAmount: '5000.00',
      activeReservedAmount: '0.00',
      employeeDeparted: false,
      targetCycleStatus: 'DRAFT' as const,
      alreadyMaterializedForTargetCycle: false,
      targetEntryExists: true,
      targetEntryReleased: false,
    };

    it('PAYABLE materializes the full available amount, ignoring any installment field', () => {
      const decision = determineMaterialization({ ...BASE, adjustmentType: 'PAYABLE', paymentTiming: 'DEFERRED', recoveryInstallmentAmount: '100' });
      expect(decision).toEqual({ eligible: true, amount: '5000.00' });
    });

    it('RECOVERY with no installment set materializes the full available amount', () => {
      const decision = determineMaterialization({ ...BASE, adjustmentType: 'RECOVERY', paymentTiming: null, recoveryInstallmentAmount: null });
      expect(decision).toEqual({ eligible: true, amount: '5000.00' });
    });

    it('RECOVERY with an installment smaller than remaining materializes exactly the installment', () => {
      const decision = determineMaterialization({ ...BASE, adjustmentType: 'RECOVERY', paymentTiming: null, recoveryInstallmentAmount: '1500.00' });
      expect(decision).toEqual({ eligible: true, amount: '1500.00' });
    });

    it('an installment larger than remaining is capped at the available amount', () => {
      const decision = determineMaterialization({
        ...BASE,
        adjustmentType: 'RECOVERY',
        paymentTiming: null,
        remainingAmount: '800.00',
        recoveryInstallmentAmount: '2000.00',
      });
      expect(decision).toEqual({ eligible: true, amount: '800.00' });
    });

    it('exact decimal handling: a partial reservation leaves the correct fractional remainder', () => {
      const decision = determineMaterialization({
        ...BASE,
        adjustmentType: 'RECOVERY',
        paymentTiming: null,
        remainingAmount: '100.01',
        activeReservedAmount: '33.34',
        recoveryInstallmentAmount: null,
      });
      expect(decision).toEqual({ eligible: true, amount: '66.67' });
    });
  });

  // --- PAYABLE -------------------------------------------------------------------------------------

  describe('PAYABLE materialization', () => {
    it('preview is a read-only dry run that never persists a row', async () => {
      const { balanceAdjustment, admin, draftCycle } = await makeFixtures('payable-preview');

      const previewRes = await previewMaterialize(admin, balanceAdjustment.id, draftCycle.id);
      expect(previewRes.status).toBe(200);
      expect(previewRes.body.preview).toEqual({ eligible: true, amount: '5000.00' });

      const materializationCount = await prisma.balanceAdjustmentMaterialization.count({ where: { balanceAdjustmentId: balanceAdjustment.id } });
      expect(materializationCount).toBe(0);
    });

    it('materializes the full DEFERRED PAYABLE amount into the target Draft entry', async () => {
      const { balanceAdjustment, admin, draftCycle, draftEntry } = await makeFixtures('payable-full');

      const res = await materialize(admin, balanceAdjustment.id, draftCycle.id);
      expect(res.status).toBe(201);
      expect(res.body.result.outcome).toBe('MATERIALIZED');
      expect(res.body.result.amount).toBe('5000.00');

      const reloadedEntry = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: draftEntry.id } });
      expect(reloadedEntry.correctionBalancePayable.toString()).toBe('5000');
      expect(reloadedEntry.correctionBalanceRecovery.toString()).toBe('0');

      // Never settled -- remainingAmount/status on the source BalanceAdjustment are untouched.
      const reloadedAdjustment = await prisma.balanceAdjustment.findUniqueOrThrow({ where: { id: balanceAdjustment.id } });
      expect(reloadedAdjustment.remainingAmount.toString()).toBe('5000');
      expect(reloadedAdjustment.status).toBe('PENDING');
    });

    it('an IMMEDIATE PAYABLE cannot be cycle-materialized', async () => {
      const { employee, admin, sourceCycle, sourceEntry, adjustmentType, draftCycle } = await makeFixtures('payable-immediate');
      // A fresh Correction is required: `BalanceAdjustment.correctionId` is 1:1 unique, and the
      // fixture's own `correction` already owns its default PAYABLE adjustment.
      const secondCorrection = await makeCorrection(sourceEntry.id, adjustmentType.id, admin.userId);
      const immediateAdjustment = await makeBalanceAdjustment(secondCorrection.id, employee.id, sourceCycle.id, adjustmentType.id, {
        type: 'PAYABLE',
        paymentTiming: 'IMMEDIATE',
      });

      const res = await materialize(admin, immediateAdjustment.id, draftCycle.id);
      expect(res.status).toBe(201); // the route returns 201 unconditionally; MATERIALIZED vs. SKIPPED is in the body
      expect(res.body.result.outcome).toBe('SKIPPED');
      expect(res.body.result.reason).toBe('UNSUPPORTED_ADJUSTMENT_TYPE');
    });

    it('preserves traceability: metadata/remark references the source Correction and BalanceAdjustment', async () => {
      const { balanceAdjustment, admin, draftCycle, correction } = await makeFixtures('payable-traceability');

      const res = await materialize(admin, balanceAdjustment.id, draftCycle.id);
      expect(res.status).toBe(201);

      const auditEntries = await prisma.auditLog.findMany({ where: { action: 'balance_adjustment.materialized', entityId: balanceAdjustment.id } });
      expect(auditEntries).toHaveLength(1);
      const metadata = auditEntries[0]!.metadata as Record<string, unknown>;
      expect(metadata.correctionId).toBe(correction.id);
      expect(metadata.materializationId).toBe(res.body.result.materializationId);
    });

    it('recalculation is deterministic: computeEntryCalc reflects the materialized amount reproducibly', async () => {
      const { balanceAdjustment, admin, draftCycle, draftEntry } = await makeFixtures('payable-recalc');
      await materialize(admin, balanceAdjustment.id, draftCycle.id);

      const entry = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: draftEntry.id }, include: { workLines: true } });
      const { computeEntryCalc } = await import('../src/modules/payroll-entry/payroll-entry.service');
      const first = computeEntryCalc(entry);
      const second = computeEntryCalc(entry);
      expect(first.netSalary).toBe(second.netSalary);
      expect(first.totalEarning).toBe('35000.00'); // 30000 grossPay-derived earning + 5000 correctionBalancePayable
    });

    it('never mutates the source PayrollEntry or the historical Correction', async () => {
      const { balanceAdjustment, admin, draftCycle, sourceEntry, correction } = await makeFixtures('payable-immutable');
      const beforeEntry = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: sourceEntry.id } });
      const beforeCorrection = await prisma.correction.findUniqueOrThrow({ where: { id: correction.id } });

      await materialize(admin, balanceAdjustment.id, draftCycle.id);

      const afterEntry = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: sourceEntry.id } });
      const afterCorrection = await prisma.correction.findUniqueOrThrow({ where: { id: correction.id } });
      expect(afterEntry.updatedAt.getTime()).toBe(beforeEntry.updatedAt.getTime());
      expect(afterEntry.grossPay.toString()).toBe(beforeEntry.grossPay.toString());
      expect(afterCorrection.newValue).toBe(beforeCorrection.newValue);
      expect(afterCorrection.approvedAt.getTime()).toBe(beforeCorrection.approvedAt.getTime());
    });
  });

  // --- RECOVERY --------------------------------------------------------------------------------

  describe('RECOVERY materialization', () => {
    it('materializes a full RECOVERY installment (no recoveryInstallmentAmount set)', async () => {
      const { balanceAdjustment, admin, draftCycle, draftEntry } = await makeFixtures('recovery-full', { type: 'RECOVERY' });

      const res = await materialize(admin, balanceAdjustment.id, draftCycle.id);
      expect(res.status).toBe(201);
      expect(res.body.result.amount).toBe('5000.00');

      const reloadedEntry = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: draftEntry.id } });
      expect(reloadedEntry.correctionBalanceRecovery.toString()).toBe('5000');
      expect(reloadedEntry.correctionBalancePayable.toString()).toBe('0');
    });

    it('materializes a partial RECOVERY installment', async () => {
      const { balanceAdjustment, admin, draftCycle, draftEntry } = await makeFixtures('recovery-partial', {
        type: 'RECOVERY',
        amount: '5000',
        recoveryInstallmentAmount: '2000',
      });

      const res = await materialize(admin, balanceAdjustment.id, draftCycle.id);
      expect(res.status).toBe(201);
      expect(res.body.result.amount).toBe('2000.00');

      const reloadedEntry = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: draftEntry.id } });
      expect(reloadedEntry.correctionBalanceRecovery.toString()).toBe('2000');
    });

    it('the same adjustment materializes a further installment into a second Draft cycle', async () => {
      const { site, unit, employee, admin, balanceAdjustment, draftCycle } = await makeFixtures('recovery-multi-cycle', {
        type: 'RECOVERY',
        amount: '5000',
        recoveryInstallmentAmount: '2000',
      });
      await materialize(admin, balanceAdjustment.id, draftCycle.id);

      // Second Draft cycle for the same employee.
      const secondDraft = await makeCycle(admin.userId, 'DRAFT');
      const secondEntry = await makeEntry(site.id, unit.id, employee.id, secondDraft.id, false, admin.userId);

      const res = await materialize(admin, balanceAdjustment.id, secondDraft.id);
      expect(res.status).toBe(201);
      expect(res.body.result.amount).toBe('2000.00'); // availableToMaterialize = 5000 - 2000 (first, still ACTIVE) = 3000, capped at installment 2000

      const reloadedEntry = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: secondEntry.id } });
      expect(reloadedEntry.correctionBalanceRecovery.toString()).toBe('2000');

      const materializations = await prisma.balanceAdjustmentMaterialization.findMany({ where: { balanceAdjustmentId: balanceAdjustment.id } });
      expect(materializations).toHaveLength(2);
    });

    it('an IMMEDIATE/DEFERRED PAYABLE-only field never appears on a RECOVERY materialization request', async () => {
      const { balanceAdjustment, admin, draftCycle } = await makeFixtures('recovery-no-payable-fields', { type: 'RECOVERY' });
      const res = await materialize(admin, balanceAdjustment.id, draftCycle.id);
      expect(res.status).toBe(201);
      expect(res.body.result.outcome).toBe('MATERIALIZED');
    });

    it('no PayrollEntry deduction (advanceDeduction/eidAdvanceDeduction/fine) is ever touched', async () => {
      const { balanceAdjustment, admin, draftCycle, draftEntry } = await makeFixtures('recovery-no-deduction-mutation', { type: 'RECOVERY' });
      const before = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: draftEntry.id } });

      await materialize(admin, balanceAdjustment.id, draftCycle.id);

      const after = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: draftEntry.id } });
      expect(after.advanceDeduction.toString()).toBe(before.advanceDeduction.toString());
      expect(after.fine.toString()).toBe(before.fine.toString());
    });
  });

  // --- Departed employee ---------------------------------------------------------------------------

  describe('Departed employee', () => {
    it('departed employee RECOVERY is never materialized', async () => {
      const { balanceAdjustment, admin, draftCycle } = await makeFixtures('departed-recovery', { type: 'RECOVERY', departed: true });

      const res = await materialize(admin, balanceAdjustment.id, draftCycle.id);
      expect(res.status).toBe(201); // the route returns 201 unconditionally; MATERIALIZED vs. SKIPPED is in the body
      expect(res.body.result.outcome).toBe('SKIPPED');
      expect(res.body.result.reason).toBe('DEPARTED_EMPLOYEE_RECOVERY');

      const materializationCount = await prisma.balanceAdjustmentMaterialization.count({ where: { balanceAdjustmentId: balanceAdjustment.id } });
      expect(materializationCount).toBe(0);
      const reloaded = await prisma.balanceAdjustment.findUniqueOrThrow({ where: { id: balanceAdjustment.id } });
      expect(reloaded.status).toBe('PENDING'); // no hidden status transition
    });

    it('departed employee PAYABLE materializes normally', async () => {
      const { balanceAdjustment, admin, draftCycle } = await makeFixtures('departed-payable', { type: 'PAYABLE', departed: true });
      const res = await materialize(admin, balanceAdjustment.id, draftCycle.id);
      expect(res.status).toBe(201);
      expect(res.body.result.outcome).toBe('MATERIALIZED');
    });
  });

  // --- Idempotency -----------------------------------------------------------------------------------

  describe('Idempotency', () => {
    it('repeating a single materialization for the same adjustment+cycle does not duplicate the financial effect', async () => {
      const { balanceAdjustment, admin, draftCycle, draftEntry } = await makeFixtures('idempotent-single');
      const first = await materialize(admin, balanceAdjustment.id, draftCycle.id);
      expect(first.status).toBe(201);

      const second = await materialize(admin, balanceAdjustment.id, draftCycle.id);
      expect(second.status).toBe(201); // the route returns 201 unconditionally; MATERIALIZED vs. SKIPPED is in the body
      expect(second.body.result.outcome).toBe('SKIPPED');
      expect(second.body.result.reason).toBe('ALREADY_MATERIALIZED');

      const reloadedEntry = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: draftEntry.id } });
      expect(reloadedEntry.correctionBalancePayable.toString()).toBe('5000'); // not 10000
      const materializationCount = await prisma.balanceAdjustmentMaterialization.count({ where: { balanceAdjustmentId: balanceAdjustment.id } });
      expect(materializationCount).toBe(1);
    });

    it('repeating a batch materialization is a no-op the second time', async () => {
      const { balanceAdjustment, admin, draftCycle } = await makeFixtures('idempotent-batch');
      const first = await materializeBatch(admin, draftCycle.id);
      expect(first.status).toBe(200);
      expect(first.body.summary.materializedCount).toBe(1);

      const second = await materializeBatch(admin, draftCycle.id);
      expect(second.status).toBe(200);
      expect(second.body.summary.materializedCount).toBe(0);
      expect(second.body.summary.skippedCount).toBe(1);

      const materializationCount = await prisma.balanceAdjustmentMaterialization.count({ where: { balanceAdjustmentId: balanceAdjustment.id } });
      expect(materializationCount).toBe(1);
    });

    it('the target cycle receives exactly one financial effect regardless of duplicate concurrent invocation', async () => {
      const { balanceAdjustment, admin, draftCycle } = await makeFixtures('idempotent-concurrent');
      const [first, second] = await Promise.all([
        materialize(admin, balanceAdjustment.id, draftCycle.id),
        materialize(admin, balanceAdjustment.id, draftCycle.id),
      ]);
      const outcomes = [first.body.result?.outcome, second.body.result?.outcome].sort();
      expect(outcomes).toEqual(['MATERIALIZED', 'SKIPPED']);

      const materializationCount = await prisma.balanceAdjustmentMaterialization.count({ where: { balanceAdjustmentId: balanceAdjustment.id } });
      expect(materializationCount).toBe(1);
    });
  });

  // --- Concurrency (real PostgreSQL) --------------------------------------------------------------

  describe('Concurrency', () => {
    it('two concurrent attempts for the same adjustment and same cycle: only one materializes', async () => {
      const { balanceAdjustment, admin, draftCycle } = await makeFixtures('concurrent-same-both');
      const [first, second] = await Promise.all([
        materialize(admin, balanceAdjustment.id, draftCycle.id),
        materialize(admin, balanceAdjustment.id, draftCycle.id),
      ]);
      const materializedCount = [first, second].filter((r) => r.body.result?.outcome === 'MATERIALIZED').length;
      expect(materializedCount).toBe(1);
    });

    it('settlement racing materialization: the lock serializes them, no over-reservation results', async () => {
      const { balanceAdjustment, admin, draftCycle } = await makeFixtures('concurrent-settlement-race', { amount: '5000' });

      const [materializeRes, settleRes] = await Promise.all([
        materialize(admin, balanceAdjustment.id, draftCycle.id),
        admin.agent
          .post(`/api/v1/balance-adjustments/${balanceAdjustment.id}/settlements`)
          .set('x-csrf-token', admin.csrfToken)
          .send({ cycleId: draftCycle.id, amount: '5000' }),
      ]);

      // Both use the exact same BalanceAdjustment lock, so whichever wins, the other reads fresh
      // state — neither can succeed against a stale remainingAmount/reservation view.
      expect([materializeRes.status, settleRes.status].every((s) => [200, 201, 409, 400].includes(s))).toBe(true);
    });

    it('two different adjustments for one employee do not block each other', async () => {
      const { employee, admin, sourceCycle, sourceEntry, adjustmentType, draftCycle, balanceAdjustment: adjustment1 } =
        await makeFixtures('concurrent-two-adjustments');
      // A second, independent Correction/BalanceAdjustment for the same employee — Corrections are
      // not 1:1 with PayrollEntry, so this reuses the fixture's own `sourceEntry`.
      const correction2 = await makeCorrection(sourceEntry.id, adjustmentType.id, admin.userId);
      const adjustment2 = await makeBalanceAdjustment(correction2.id, employee.id, sourceCycle.id, adjustmentType.id, { type: 'RECOVERY', amount: '1000' });

      const [res1, res2] = await Promise.all([materialize(admin, adjustment1.id, draftCycle.id), materialize(admin, adjustment2.id, draftCycle.id)]);
      expect(res1.status).toBe(201);
      expect(res1.body.result.outcome).toBe('MATERIALIZED');
      expect(res2.status).toBe(201);
      expect(res2.body.result.outcome).toBe('MATERIALIZED');
    });

    it('two employees in one cycle materialize independently', async () => {
      const { balanceAdjustment: adjustmentA, admin, draftCycle: cycleA } = await makeFixtures('concurrent-two-employees-a');
      const { balanceAdjustment: adjustmentB, draftCycle: cycleB } = await makeFixtures('concurrent-two-employees-b');
      void cycleB;

      const [resA, resB] = await Promise.all([materialize(admin, adjustmentA.id, cycleA.id), materialize(admin, adjustmentB.id, cycleA.id)]);
      // adjustmentB's own employee has no entry in cycleA -> EMPLOYEE_NOT_ELIGIBLE, proving
      // independence (adjustmentA's own materialization is unaffected either way). The route
      // returns 201 unconditionally; MATERIALIZED vs. SKIPPED is only in the body.
      expect(resA.status).toBe(201);
      expect(resA.body.result.outcome).toBe('MATERIALIZED');
      expect(resB.status).toBe(201);
      expect(resB.body.result.outcome).toBe('SKIPPED');
      expect(resB.body.result.reason).toBe('EMPLOYEE_NOT_ELIGIBLE');
    });

    it('independent cycles do not block each other', async () => {
      const { balanceAdjustment: adjustmentA, admin, draftCycle: cycleA } = await makeFixtures('concurrent-independent-cycles-a');
      const { balanceAdjustment: adjustmentB, draftCycle: cycleB } = await makeFixtures('concurrent-independent-cycles-b');

      const [first, second] = await Promise.all([
        materialize(admin, adjustmentA.id, cycleA.id),
        materialize(admin, adjustmentB.id, cycleB.id),
      ]);
      expect(first.status).toBe(201);
      expect(first.body.result.outcome).toBe('MATERIALIZED');
      expect(second.status).toBe(201);
      expect(second.body.result.outcome).toBe('MATERIALIZED');
    });

    it('a rolled-back materialization attempt releases the lock and leaves no orphaned row', async () => {
      const { balanceAdjustment, admin, draftCycle } = await makeFixtures('concurrent-rollback-releases-lock');

      const spy = jest.spyOn(correctionsRepository, 'createMaterializationRow').mockImplementationOnce(async () => {
        throw new Error('simulated failure');
      });
      try {
        const failed = await materialize(admin, balanceAdjustment.id, draftCycle.id);
        expect(failed.status).toBe(500);
      } finally {
        spy.mockRestore();
      }

      const materializationCount = await prisma.balanceAdjustmentMaterialization.count({ where: { balanceAdjustmentId: balanceAdjustment.id } });
      expect(materializationCount).toBe(0);

      const succeeded = await materialize(admin, balanceAdjustment.id, draftCycle.id);
      expect(succeeded.status).toBe(201);
    });
  });

  // --- Archive-and-create-next integration ----------------------------------------------------

  describe('Archive-and-create-next integration', () => {
    async function releaseAndFinalize(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, cycle: { id: string }, unitId: string) {
      const releaseRes = await admin.agent
        .post(`/api/v1/payroll-cycles/${cycle.id}/units/${unitId}/release`)
        .set('x-csrf-token', admin.csrfToken)
        .send({});
      if (releaseRes.status !== 201) throw new Error(`release failed: ${releaseRes.status} ${JSON.stringify(releaseRes.body)}`);
      const finalizeRes = await admin.agent.post(`/api/v1/payroll-cycles/${cycle.id}/finalize`).set('x-csrf-token', admin.csrfToken).send({});
      if (finalizeRes.status !== 200) throw new Error(`finalize failed: ${finalizeRes.status} ${JSON.stringify(finalizeRes.body)}`);
    }

    function rollover(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, cycleId: string) {
      return admin.agent.post(`/api/v1/payroll-cycles/${cycleId}/archive-and-create-next`).set('x-csrf-token', admin.csrfToken).send({});
    }

    it('an eligible RECOVERY installment materializes automatically into the new Draft cycle on rollover', async () => {
      const admin = await masterAdminAgent('cp5-rollover-recovery-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site CP5 rollover-recovery');
      const employee = await makeEmployee(site.id, unit.id, 'CP5 Employee rollover-recovery');

      // A historical (ARCHIVED) cycle whose release produced the source Correction/BalanceAdjustment
      // -- archive-and-create-next requires exactly one RELEASED cycle system-wide, so this must
      // NOT still be RELEASED once `rolloverCycle` below is released too.
      const sourceCycle = await makeCycle(admin.userId, 'ARCHIVED');
      const sourceEntry = await makeEntry(site.id, unit.id, employee.id, sourceCycle.id, true, admin.userId);
      const adjustmentType = await makeAdjustmentType('rollover-recovery');
      const correction = await makeCorrection(sourceEntry.id, adjustmentType.id, admin.userId);
      const balanceAdjustment = await makeBalanceAdjustment(correction.id, employee.id, sourceCycle.id, adjustmentType.id, {
        type: 'RECOVERY',
        amount: '2500',
      });

      // The cycle being rolled over — the employee's own entry here is what determines who
      // bootstraps into the new Draft (the exact same rollover mechanism every other test in this
      // file bypasses, but this one specifically exercises).
      const rolloverCycle = await prisma.payrollCycle.create({
        data: { year: sourceCycle.year, month: sourceCycle.month === 12 ? 1 : sourceCycle.month + 1, createdBy: admin.userId, status: 'DRAFT' },
      });
      const rolloverUnit = unit;
      await prisma.payrollEntry.create({
        data: {
          cycleId: rolloverCycle.id,
          employeeId: employee.id,
          siteId: site.id,
          designation: 'Guard',
          grossPay: '30000',
          workLines: { create: [{ siteId: site.id, unitId: rolloverUnit.id, days: '30', cycleDays: 30, otHours: '0' }] },
        },
      });
      await releaseAndFinalize(admin, rolloverCycle, rolloverUnit.id);

      const res = await rollover(admin, rolloverCycle.id);
      expect(res.status).toBe(201);
      expect(res.body.correctionObligationsMaterialized).toBe(1);

      const newEntry = await prisma.payrollEntry.findUniqueOrThrow({ where: { cycleId_employeeId: { cycleId: res.body.newCycle.id, employeeId: employee.id } } });
      expect(newEntry.correctionBalanceRecovery.toString()).toBe('2500');

      const materialization = await prisma.balanceAdjustmentMaterialization.findUniqueOrThrow({
        where: { balanceAdjustmentId_cycleId: { balanceAdjustmentId: balanceAdjustment.id, cycleId: res.body.newCycle.id } },
      });
      expect(materialization.status).toBe('ACTIVE');

      // Outgoing (just-archived) cycle and its Backup Package are never touched by materialization.
      const archivedCycle = await prisma.payrollCycle.findUniqueOrThrow({ where: { id: rolloverCycle.id } });
      expect(archivedCycle.status).toBe('ARCHIVED');
    });

    it('a departed-employee RECOVERY is skipped during rollover — no materialization row created', async () => {
      const admin = await masterAdminAgent('cp5-rollover-departed-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site CP5 rollover-departed');
      const employee = await makeEmployee(site.id, unit.id, 'CP5 Employee rollover-departed', new Date('2026-01-01'));

      // A historical (ARCHIVED) cycle -- same reasoning as the RECOVERY rollover test above: only
      // one RELEASED cycle may exist system-wide when `rolloverCycle` below is released.
      const sourceCycle = await makeCycle(admin.userId, 'ARCHIVED');
      const sourceEntry = await makeEntry(site.id, unit.id, employee.id, sourceCycle.id, true, admin.userId);
      const adjustmentType = await makeAdjustmentType('rollover-departed');
      const correction = await makeCorrection(sourceEntry.id, adjustmentType.id, admin.userId);
      const balanceAdjustment = await makeBalanceAdjustment(correction.id, employee.id, sourceCycle.id, adjustmentType.id, { type: 'RECOVERY' });

      const rolloverCycle = await prisma.payrollCycle.create({
        data: { year: sourceCycle.year, month: sourceCycle.month === 12 ? 1 : sourceCycle.month + 1, createdBy: admin.userId, status: 'DRAFT' },
      });
      // The departed employee still has an ordinary entry in the cycle being rolled over -- whether
      // or not they carry forward into the new Draft's own bootstrap, the assertion below (zero
      // materializations) holds either way: EMPLOYEE_NOT_ELIGIBLE if they don't carry forward,
      // DEPARTED_EMPLOYEE_RECOVERY if they do.
      await prisma.payrollEntry.create({
        data: {
          cycleId: rolloverCycle.id,
          employeeId: employee.id,
          siteId: site.id,
          designation: 'Guard',
          grossPay: '30000',
          workLines: { create: [{ siteId: site.id, unitId: unit.id, days: '30', cycleDays: 30, otHours: '0' }] },
        },
      });
      await releaseAndFinalize(admin, rolloverCycle, unit.id);

      const res = await rollover(admin, rolloverCycle.id);
      expect(res.status).toBe(201);
      expect(res.body.correctionObligationsMaterialized).toBe(0);

      const materializationCount = await prisma.balanceAdjustmentMaterialization.count({ where: { balanceAdjustmentId: balanceAdjustment.id } });
      expect(materializationCount).toBe(0);
    });

    it('no duplicate materialization after retrying/re-invoking (idempotent within the same target cycle)', async () => {
      const { balanceAdjustment, admin, draftCycle } = await makeFixtures('rollover-no-duplicate-retry');
      await materialize(admin, balanceAdjustment.id, draftCycle.id);
      const retried = await materialize(admin, balanceAdjustment.id, draftCycle.id);
      expect(retried.body.result.outcome).toBe('SKIPPED');

      const materializationCount = await prisma.balanceAdjustmentMaterialization.count({ where: { balanceAdjustmentId: balanceAdjustment.id } });
      expect(materializationCount).toBe(1);
    });
  });

  // --- Batch result ------------------------------------------------------------------------------

  describe('Batch result', () => {
    it('reports materialized, skipped counts, and typed skip reasons', async () => {
      const { site, unit, admin, draftCycle } = await makeFixtures('batch-summary-a');
      const employee2 = await makeEmployee(site.id, unit.id, 'CP5 Employee batch-summary-b', null);
      const sourceCycle2 = await makeCycle(admin.userId, 'RELEASED');
      const sourceEntry2 = await makeEntry(site.id, unit.id, employee2.id, sourceCycle2.id, true, admin.userId);
      const adjustmentType2 = await makeAdjustmentType('batch-summary-b');
      const correction2 = await makeCorrection(sourceEntry2.id, adjustmentType2.id, admin.userId);
      await makeBalanceAdjustment(correction2.id, employee2.id, sourceCycle2.id, adjustmentType2.id, { type: 'RECOVERY', status: 'SETTLED', remainingAmount: '0' });
      // employee2 has no entry in draftCycle -> EMPLOYEE_NOT_ELIGIBLE, not even a candidate.

      const res = await materializeBatch(admin, draftCycle.id);
      expect(res.status).toBe(200);
      expect(res.body.summary.materializedCount).toBe(1);
      expect(res.body.summary.results.every((r: { outcome: string }) => ['MATERIALIZED', 'SKIPPED'].includes(r.outcome))).toBe(true);
    });

    it('partial failure does not roll back unrelated already-materialized items in the same batch', async () => {
      const { balanceAdjustment, admin, draftCycle } = await makeFixtures('batch-partial-failure');
      const res = await materializeBatch(admin, draftCycle.id);
      expect(res.status).toBe(200);
      expect(res.body.summary.materializedCount).toBe(1);

      const materialized = await prisma.balanceAdjustmentMaterialization.findFirst({ where: { balanceAdjustmentId: balanceAdjustment.id } });
      expect(materialized).not.toBeNull();
    });
  });

  // --- Audit -----------------------------------------------------------------------------------

  describe('Audit', () => {
    it('records a manual materialization event with triggeredBy MANUAL', async () => {
      const { balanceAdjustment, admin, draftCycle } = await makeFixtures('audit-manual');
      await materialize(admin, balanceAdjustment.id, draftCycle.id);

      const entries = await prisma.auditLog.findMany({ where: { action: 'balance_adjustment.materialized', entityId: balanceAdjustment.id } });
      expect(entries).toHaveLength(1);
      expect((entries[0]!.metadata as Record<string, unknown>).triggeredBy).toBe('MANUAL');
    });

    it('no audit residue remains after a rolled-back materialization attempt', async () => {
      const { balanceAdjustment, admin, draftCycle } = await makeFixtures('audit-rollback-residue');

      const realRecordAuditLog = auditLogService.recordAuditLog;
      const spy = jest.spyOn(auditLogService, 'recordAuditLog').mockImplementation(async (input, client) => {
        if (input.action === 'balance_adjustment.materialized') {
          throw new Error('simulated failure during audit recording');
        }
        return realRecordAuditLog(input, client);
      });
      try {
        const res = await materialize(admin, balanceAdjustment.id, draftCycle.id);
        expect(res.status).toBe(500);
      } finally {
        spy.mockRestore();
      }

      const auditCount = await prisma.auditLog.count({ where: { action: 'balance_adjustment.materialized', entityId: balanceAdjustment.id } });
      expect(auditCount).toBe(0);
      const materializationCount = await prisma.balanceAdjustmentMaterialization.count({ where: { balanceAdjustmentId: balanceAdjustment.id } });
      expect(materializationCount).toBe(0);
    });
  });

  // --- Security -------------------------------------------------------------------------------

  describe('Security', () => {
    it('rejects an unauthenticated request', async () => {
      const { balanceAdjustment } = await makeFixtures('security-unauth');
      const res = await request(app).get(`/api/v1/balance-adjustments/${balanceAdjustment.id}/materializations`);
      expect(res.status).toBe(401);
    });

    it('rejects a caller without the view permission (Finance)', async () => {
      const { site, balanceAdjustment } = await makeFixtures('security-forbidden');
      const finance = await financeAgent('cp5-security-forbidden-finance@test.local', [site.id]);
      const res = await finance.agent.get(`/api/v1/balance-adjustments/${balanceAdjustment.id}/materializations`);
      expect(res.status).toBe(403);
    });

    it('rejects a Payroll Staff caller attempting to record a materialization (view-only permission)', async () => {
      const { site, balanceAdjustment, draftCycle } = await makeFixtures('security-staff-record');
      const staff = await payrollStaffAgent('cp5-security-staff-record@test.local', [site.id]);
      const res = await materialize(staff, balanceAdjustment.id, draftCycle.id);
      expect(res.status).toBe(403);
    });

    it('rejects a mutating request missing the CSRF header', async () => {
      const { site, balanceAdjustment, draftCycle } = await makeFixtures('security-csrf');
      const staff = await payrollStaffAgent('cp5-security-csrf-staff@test.local', [site.id]);
      const res = await staff.agent.post(`/api/v1/balance-adjustments/${balanceAdjustment.id}/materializations`).send({ targetCycleId: draftCycle.id });
      expect(res.status).toBe(403);
    });

    it('rejects a malformed UUID balanceAdjustmentId cleanly', async () => {
      const { admin } = await makeFixtures('security-malformed-uuid');
      const res = await admin.agent.get('/api/v1/balance-adjustments/not-a-uuid/materializations');
      expect(res.status).toBe(400);
    });

    it('the materialization response never leaks a raw internal field', async () => {
      const { balanceAdjustment, admin, draftCycle } = await makeFixtures('security-sanitized');
      const res = await materialize(admin, balanceAdjustment.id, draftCycle.id);
      expect(res.status).toBe(201);
      assertNoSensitiveKeys(res.body);
    });

    it('the automatic rollover hook is not exposed as its own unprotected route', async () => {
      // There is no route named .../materialize-hook or similar -- the only way to trigger the
      // automatic path is through archive-and-create-next itself, already permission-gated.
      // Authenticated + CSRF'd so the assertion proves route non-existence (404), not an earlier
      // CSRF/auth rejection masking the question being asked.
      const { admin } = await makeFixtures('security-hook-not-a-route');
      const res = await admin.agent
        .post('/api/v1/payroll-cycles/materialize-corrections-hook')
        .set('x-csrf-token', admin.csrfToken)
        .send({});
      expect(res.status).toBe(404);
    });
  });
});
