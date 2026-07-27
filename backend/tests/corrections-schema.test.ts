import type { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createTestUser } from './helpers';

/**
 * Phase 6 Checkpoint 1 — schema/domain-level tests only. There is no service, calculation, or
 * route layer yet for `Correction`/`CorrectionRequest`/`BalanceAdjustment`/`CorrectionPayment`/
 * `BalanceAdjustmentSettlement` (that's Checkpoints 2–4) — every test here writes directly via
 * Prisma, the same convention `payroll-schema.test.ts` established for Phase 3 Checkpoint 0's own
 * schema-only checkpoint. No calculation, approval, or settlement behavior is exercised — only
 * that the migration applied correctly and every constraint documented in `docs/architecture/
 * database/corrections.md` (§13/§13a) and `docs/architecture/database/balance-adjustments.md`
 * (§14/§14a/§14b) actually holds at the database level.
 *
 * Test `PayrollCycle` rows use `year: 2900` (a fake but valid smallint year), matching
 * `payroll-schema.test.ts`'s own convention, so `cleanTestData()` can scope cleanup without a text
 * column to prefix.
 */
describe('Phase 6 Checkpoint 1 — Corrections & Balance Adjustments schema', () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  async function makeSiteWithUnit(name: string) {
    const site = await prisma.projectSite.create({ data: { name } });
    const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} Unit`, code: 'U-1' } });
    return { site, unit };
  }

  async function makeEmployee(siteId: string, unitId: string, name: string) {
    return prisma.employee.create({
      data: { name, designation: 'Guard', siteId, unitId, grossPay: '30000' },
    });
  }

  async function makeUser(email: string) {
    return createTestUser({ email, password: 'CorrectHorseBattery1!', roleCode: 'TEST_MASTER' });
  }

  async function makeAdjustmentType(code: string) {
    return prisma.adjustmentType.create({ data: { code: `TEST_${code}`, label: code } });
  }

  async function makeCycle(userId: string, month: number, status: 'DRAFT' | 'RELEASED' | 'ARCHIVED' = 'RELEASED') {
    return prisma.payrollCycle.create({ data: { year: 2900, month, createdBy: userId, status } });
  }

  /** A released `PayrollEntry` — the only kind a `Correction`/`CorrectionRequest` ever targets
   * (the trigger condition, `docs/architecture/workflows/payroll-lifecycle.md §4`), though this
   * checkpoint's own schema has no application-layer enforcement of that trigger yet — that's
   * Checkpoint 2+. Released here purely so fixtures read naturally; no test below depends on the
   * entry's own `released` flag being enforced at this layer. */
  async function makeReleasedEntry(cycleId: string, employeeId: string, siteId: string, unitId: string, releasedBy: string) {
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
        workLines: { create: [{ siteId, unitId, days: '20', cycleDays: 30 }] },
      },
    });
  }

  /** Full fixture set for a single test: site/unit, employee, a Master User, a Released cycle, and
   * one released entry — everything a `Correction`/`CorrectionRequest`/`BalanceAdjustment` fixture
   * needs, assembled once so individual tests stay focused on the one constraint under test. */
  async function makeFixtures(label: string) {
    const { site, unit } = await makeSiteWithUnit(`Test Site Corrections ${label}`);
    const employee = await makeEmployee(site.id, unit.id, `Corrections Employee ${label}`);
    const user = await makeUser(`corrections-schema-${label}@test.local`);
    const cycle = await makeCycle(user.id, Math.floor(Math.random() * 12) + 1);
    const entry = await makeReleasedEntry(cycle.id, employee.id, site.id, unit.id, user.id);
    const adjustmentType = await makeAdjustmentType(label);
    return { site, unit, employee, user, cycle, entry, adjustmentType };
  }

  async function makeCorrection(
    entryId: string,
    adjustmentTypeId: string,
    approvedById: string,
    overrides: Partial<Prisma.CorrectionUncheckedCreateInput> = {},
  ) {
    return prisma.correction.create({
      data: {
        payrollEntryId: entryId,
        field: 'GROSS_PAY',
        oldValue: '30000',
        newValue: '32000',
        oldNetSalary: '30000',
        newNetSalary: '32000',
        adjustmentTypeId,
        reason: 'Attendance miscounted for this period',
        approvedById,
        ...overrides,
      },
    });
  }

  // --- Correction ---------------------------------------------------------------------------------

  it('creates a valid Correction and reads back its PayrollEntry/AdjustmentType/approver relations', async () => {
    const { entry, adjustmentType, user } = await makeFixtures('happy-path');

    const correction = await prisma.correction.findUniqueOrThrow({
      where: { id: (await makeCorrection(entry.id, adjustmentType.id, user.id)).id },
      include: { payrollEntry: true, adjustmentType: true, approvedBy: true },
    });

    expect(correction.payrollEntry.id).toBe(entry.id);
    expect(correction.adjustmentType.id).toBe(adjustmentType.id);
    expect(correction.approvedBy.id).toBe(user.id);
    expect(correction.reversesCorrectionId).toBeNull();
  });

  it('rejects a Correction with a blank/whitespace-only reason via the check constraint', async () => {
    const { entry, adjustmentType, user } = await makeFixtures('blank-reason');

    await expect(makeCorrection(entry.id, adjustmentType.id, user.id, { reason: '   ' })).rejects.toThrow(
      /check constraint|violates check/i,
    );
  });

  it('creates a reversing Correction linked via reversesCorrectionId', async () => {
    const { entry, adjustmentType, user } = await makeFixtures('reversal');

    const original = await makeCorrection(entry.id, adjustmentType.id, user.id);
    const reversal = await makeCorrection(entry.id, adjustmentType.id, user.id, {
      newValue: '30000',
      reason: 'Reverses the earlier correction — wrong Adjustment Type selected',
      reversesCorrectionId: original.id,
    });

    const reloadedOriginal = await prisma.correction.findUniqueOrThrow({
      where: { id: original.id },
      include: { reversedByCorrections: true },
    });
    expect(reloadedOriginal.reversedByCorrections.map((c) => c.id)).toEqual([reversal.id]);
  });

  it('rejects a Correction whose reversesCorrectionId points at itself', async () => {
    const { entry, adjustmentType, user } = await makeFixtures('self-reverse');
    const correction = await makeCorrection(entry.id, adjustmentType.id, user.id);

    await expect(
      prisma.correction.update({ where: { id: correction.id }, data: { reversesCorrectionId: correction.id } }),
    ).rejects.toThrow(/check constraint|violates check/i);
  });

  it('rejects a Correction referencing a nonexistent PayrollEntry (foreign key)', async () => {
    const { adjustmentType, user } = await makeFixtures('bad-entry-fk');

    await expect(
      makeCorrection('00000000-0000-0000-0000-000000000000', adjustmentType.id, user.id),
    ).rejects.toThrow(/foreign key|constraint/i);
  });

  it('blocks deleting a PayrollEntry that still has a Correction (RESTRICT)', async () => {
    const { entry, adjustmentType, user } = await makeFixtures('restrict-entry');
    await makeCorrection(entry.id, adjustmentType.id, user.id);

    await expect(prisma.payrollEntry.delete({ where: { id: entry.id } })).rejects.toThrow(/foreign key|constraint/i);
  });

  // --- CorrectionRequest ---------------------------------------------------------------------------

  async function makeCorrectionRequest(
    entryId: string,
    adjustmentTypeId: string,
    requestedById: string,
    overrides: Partial<Prisma.CorrectionRequestUncheckedCreateInput> = {},
  ) {
    return prisma.correctionRequest.create({
      data: {
        payrollEntryId: entryId,
        field: 'GROSS_PAY',
        proposedNewValue: '32000',
        adjustmentTypeId,
        reason: 'Attendance miscounted for this period',
        requestedById,
        ...overrides,
      },
    });
  }

  it('creates a CorrectionRequest defaulting to PENDING with no reviewer', async () => {
    const { entry, adjustmentType, user } = await makeFixtures('request-default');
    const request = await makeCorrectionRequest(entry.id, adjustmentType.id, user.id);

    expect(request.status).toBe('PENDING');
    expect(request.reviewedById).toBeNull();
    expect(request.reviewedAt).toBeNull();
    expect(request.resultingCorrectionId).toBeNull();
  });

  it('rejects a CorrectionRequest with a blank reason via the check constraint', async () => {
    const { entry, adjustmentType, user } = await makeFixtures('request-blank-reason');

    await expect(
      makeCorrectionRequest(entry.id, adjustmentType.id, user.id, { reason: '' }),
    ).rejects.toThrow(/check constraint|violates check/i);
  });

  it('rejects a PENDING CorrectionRequest with a reviewer already set (pending-state check)', async () => {
    const { entry, adjustmentType, user } = await makeFixtures('request-pending-invariant');

    await expect(
      makeCorrectionRequest(entry.id, adjustmentType.id, user.id, { reviewedById: user.id }),
    ).rejects.toThrow(/check constraint|violates check/i);
  });

  it('accepts a REJECTED CorrectionRequest with reviewer, reviewedAt, and rejectionReason all set', async () => {
    const { entry, adjustmentType, user } = await makeFixtures('request-rejected-valid');
    const reviewer = await makeUser('request-rejected-reviewer@test.local');

    const request = await makeCorrectionRequest(entry.id, adjustmentType.id, user.id, {
      status: 'REJECTED',
      reviewedById: reviewer.id,
      reviewedAt: new Date(),
      rejectionReason: 'Not enough evidence for this claim',
    });
    expect(request.status).toBe('REJECTED');
  });

  it('rejects a REJECTED CorrectionRequest missing rejectionReason (rejected-state check)', async () => {
    const { entry, adjustmentType, user } = await makeFixtures('request-rejected-missing-reason');
    const reviewer = await makeUser('request-rejected-missing-reason-reviewer@test.local');

    await expect(
      makeCorrectionRequest(entry.id, adjustmentType.id, user.id, {
        status: 'REJECTED',
        reviewedById: reviewer.id,
        reviewedAt: new Date(),
      }),
    ).rejects.toThrow(/check constraint|violates check/i);
  });

  it('rejects an APPROVED CorrectionRequest missing resultingCorrectionId (approved-state check)', async () => {
    const { entry, adjustmentType, user } = await makeFixtures('request-approved-missing-correction');
    const reviewer = await makeUser('request-approved-missing-correction-reviewer@test.local');

    await expect(
      makeCorrectionRequest(entry.id, adjustmentType.id, user.id, {
        status: 'APPROVED',
        reviewedById: reviewer.id,
        reviewedAt: new Date(),
      }),
    ).rejects.toThrow(/check constraint|violates check/i);
  });

  it('accepts an APPROVED CorrectionRequest linked to its resulting Correction, and enforces the link is unique', async () => {
    const { entry, adjustmentType, user } = await makeFixtures('request-approved-valid');
    const reviewer = await makeUser('request-approved-valid-reviewer@test.local');
    const correction = await makeCorrection(entry.id, adjustmentType.id, reviewer.id);

    const request = await makeCorrectionRequest(entry.id, adjustmentType.id, user.id, {
      status: 'APPROVED',
      reviewedById: reviewer.id,
      reviewedAt: new Date(),
      resultingCorrectionId: correction.id,
    });
    expect(request.resultingCorrectionId).toBe(correction.id);

    // A second CorrectionRequest can never claim the same resulting Correction (unique 1:1).
    await expect(
      makeCorrectionRequest(entry.id, adjustmentType.id, user.id, {
        status: 'APPROVED',
        reviewedById: reviewer.id,
        reviewedAt: new Date(),
        resultingCorrectionId: correction.id,
      }),
    ).rejects.toThrow(/unique constraint/i);
  });

  // --- BalanceAdjustment ----------------------------------------------------------------------------

  async function makeBalanceAdjustment(
    correctionId: string,
    employeeId: string,
    sourceCycleId: string,
    adjustmentTypeId: string,
    overrides: Partial<Prisma.BalanceAdjustmentUncheckedCreateInput> = {},
  ) {
    return prisma.balanceAdjustment.create({
      data: {
        correctionId,
        employeeId,
        sourceCycleId,
        adjustmentTypeId,
        amount: '2000',
        type: 'PAYABLE',
        remainingAmount: '2000',
        remark: 'Balance payable from a correction',
        ...overrides,
      },
    });
  }

  it('creates a PENDING PAYABLE BalanceAdjustment for an approved Correction and reads back its relations', async () => {
    const { entry, employee, cycle, adjustmentType, user } = await makeFixtures('balance-happy-path');
    const correction = await makeCorrection(entry.id, adjustmentType.id, user.id);

    const adjustment = await prisma.balanceAdjustment.findUniqueOrThrow({
      where: { id: (await makeBalanceAdjustment(correction.id, employee.id, cycle.id, adjustmentType.id)).id },
      include: { correction: true, employee: true, sourceCycle: true, adjustmentType: true },
    });

    expect(adjustment.correction!.id).toBe(correction.id);
    expect(adjustment.employee.id).toBe(employee.id);
    expect(adjustment.sourceCycle.id).toBe(cycle.id);
    expect(adjustment.status).toBe('PENDING');
  });

  it('enforces at most one BalanceAdjustment per Correction (unique correctionId)', async () => {
    const { entry, employee, cycle, adjustmentType, user } = await makeFixtures('balance-unique-correction');
    const correction = await makeCorrection(entry.id, adjustmentType.id, user.id);
    await makeBalanceAdjustment(correction.id, employee.id, cycle.id, adjustmentType.id);

    await expect(makeBalanceAdjustment(correction.id, employee.id, cycle.id, adjustmentType.id)).rejects.toThrow(
      /unique constraint/i,
    );
  });

  it('creates a NONE-type BalanceAdjustment already SETTLED at zero amount', async () => {
    const { entry, employee, cycle, adjustmentType, user } = await makeFixtures('balance-none-type');
    const correction = await makeCorrection(entry.id, adjustmentType.id, user.id, { newValue: '30000' });

    const adjustment = await makeBalanceAdjustment(correction.id, employee.id, cycle.id, adjustmentType.id, {
      amount: '0',
      type: 'NONE',
      status: 'SETTLED',
      remainingAmount: '0',
      remark: 'No net change from this correction',
      settledAt: new Date(),
    });
    expect(adjustment.type).toBe('NONE');
    expect(adjustment.status).toBe('SETTLED');
  });

  it('rejects a NONE-type BalanceAdjustment with a nonzero amount (type/amount/status check)', async () => {
    const { entry, employee, cycle, adjustmentType, user } = await makeFixtures('balance-none-nonzero');
    const correction = await makeCorrection(entry.id, adjustmentType.id, user.id);

    await expect(
      makeBalanceAdjustment(correction.id, employee.id, cycle.id, adjustmentType.id, {
        amount: '100',
        type: 'NONE',
        status: 'SETTLED',
        remainingAmount: '0',
      }),
    ).rejects.toThrow(/check constraint|violates check/i);
  });

  it('rejects a PAYABLE/RECOVERY BalanceAdjustment with a zero amount (type/amount/status check)', async () => {
    const { entry, employee, cycle, adjustmentType, user } = await makeFixtures('balance-nonzero-required');
    const correction = await makeCorrection(entry.id, adjustmentType.id, user.id);

    await expect(
      makeBalanceAdjustment(correction.id, employee.id, cycle.id, adjustmentType.id, {
        amount: '0',
        type: 'PAYABLE',
        remainingAmount: '0',
      }),
    ).rejects.toThrow(/check constraint|violates check/i);
  });

  it('rejects a PENDING BalanceAdjustment with settledAt already populated (pending-state check)', async () => {
    const { entry, employee, cycle, adjustmentType, user } = await makeFixtures('balance-pending-invariant');
    const correction = await makeCorrection(entry.id, adjustmentType.id, user.id);

    await expect(
      makeBalanceAdjustment(correction.id, employee.id, cycle.id, adjustmentType.id, {
        status: 'PENDING',
        settledAt: new Date(),
      }),
    ).rejects.toThrow(/check constraint|violates check/i);
  });

  it.each(['-1', '2500'])(
    'rejects remainingAmount = %s outside [0, amount] (remainingAmount check)',
    async (remainingAmount) => {
      const { entry, employee, cycle, adjustmentType, user } = await makeFixtures(`balance-bounds-${remainingAmount}`);
      const correction = await makeCorrection(entry.id, adjustmentType.id, user.id);

      await expect(
        makeBalanceAdjustment(correction.id, employee.id, cycle.id, adjustmentType.id, { amount: '2000', remainingAmount }),
      ).rejects.toThrow(/check constraint|violates check/i);
    },
  );

  it('rejects a SETTLED BalanceAdjustment whose remainingAmount is not zero (settled-remaining-zero check)', async () => {
    const { entry, employee, cycle, adjustmentType, user } = await makeFixtures('balance-settled-nonzero');
    const correction = await makeCorrection(entry.id, adjustmentType.id, user.id);

    await expect(
      makeBalanceAdjustment(correction.id, employee.id, cycle.id, adjustmentType.id, {
        status: 'SETTLED',
        remainingAmount: '500',
        settledAt: new Date(),
      }),
    ).rejects.toThrow(/check constraint|violates check/i);
  });

  it('accepts a SETTLED BalanceAdjustment once remainingAmount reaches exactly zero', async () => {
    const { entry, employee, cycle, adjustmentType, user } = await makeFixtures('balance-settled-valid');
    const correction = await makeCorrection(entry.id, adjustmentType.id, user.id);

    const adjustment = await makeBalanceAdjustment(correction.id, employee.id, cycle.id, adjustmentType.id, {
      status: 'SETTLED',
      remainingAmount: '0',
      settledAt: new Date(),
      settledInCycleId: cycle.id,
    });
    expect(adjustment.status).toBe('SETTLED');
  });

  it('rejects paymentTiming set on a RECOVERY-type BalanceAdjustment (paymentTiming-type check)', async () => {
    const { entry, employee, cycle, adjustmentType, user } = await makeFixtures('balance-timing-wrong-type');
    const correction = await makeCorrection(entry.id, adjustmentType.id, user.id, { newValue: '28000' });

    await expect(
      makeBalanceAdjustment(correction.id, employee.id, cycle.id, adjustmentType.id, {
        type: 'RECOVERY',
        paymentTiming: 'DEFERRED',
      }),
    ).rejects.toThrow(/check constraint|violates check/i);
  });

  it('accepts paymentTiming on a PAYABLE BalanceAdjustment', async () => {
    const { entry, employee, cycle, adjustmentType, user } = await makeFixtures('balance-timing-valid');
    const correction = await makeCorrection(entry.id, adjustmentType.id, user.id);

    const adjustment = await makeBalanceAdjustment(correction.id, employee.id, cycle.id, adjustmentType.id, {
      paymentTiming: 'IMMEDIATE',
    });
    expect(adjustment.paymentTiming).toBe('IMMEDIATE');
  });

  it('rejects recoveryInstallmentAmount set on a PAYABLE-type BalanceAdjustment (installment-type check)', async () => {
    const { entry, employee, cycle, adjustmentType, user } = await makeFixtures('balance-installment-wrong-type');
    const correction = await makeCorrection(entry.id, adjustmentType.id, user.id);

    await expect(
      makeBalanceAdjustment(correction.id, employee.id, cycle.id, adjustmentType.id, {
        type: 'PAYABLE',
        recoveryInstallmentAmount: '500',
      }),
    ).rejects.toThrow(/check constraint|violates check/i);
  });

  it('rejects a zero/negative recoveryInstallmentAmount on a RECOVERY BalanceAdjustment (installment-positive check)', async () => {
    const { entry, employee, cycle, adjustmentType, user } = await makeFixtures('balance-installment-nonpositive');
    const correction = await makeCorrection(entry.id, adjustmentType.id, user.id, { newValue: '28000' });

    await expect(
      makeBalanceAdjustment(correction.id, employee.id, cycle.id, adjustmentType.id, {
        type: 'RECOVERY',
        recoveryInstallmentAmount: '0',
      }),
    ).rejects.toThrow(/check constraint|violates check/i);
  });

  it('accepts a positive recoveryInstallmentAmount on a RECOVERY BalanceAdjustment', async () => {
    const { entry, employee, cycle, adjustmentType, user } = await makeFixtures('balance-installment-valid');
    const correction = await makeCorrection(entry.id, adjustmentType.id, user.id, { newValue: '28000' });

    const adjustment = await makeBalanceAdjustment(correction.id, employee.id, cycle.id, adjustmentType.id, {
      type: 'RECOVERY',
      recoveryInstallmentAmount: '500',
    });
    expect(adjustment.recoveryInstallmentAmount?.toString()).toBe('500');
  });

  // --- CorrectionPayment ----------------------------------------------------------------------------

  it('creates a valid CorrectionPayment for a settled IMMEDIATE PAYABLE BalanceAdjustment', async () => {
    const { entry, employee, cycle, adjustmentType, user } = await makeFixtures('payment-happy-path');
    const correction = await makeCorrection(entry.id, adjustmentType.id, user.id);
    const adjustment = await makeBalanceAdjustment(correction.id, employee.id, cycle.id, adjustmentType.id, {
      paymentTiming: 'IMMEDIATE',
      status: 'SETTLED',
      remainingAmount: '0',
      settledAt: new Date(),
    });

    const payment = await prisma.correctionPayment.create({
      data: {
        balanceAdjustmentId: adjustment.id,
        employeeId: employee.id,
        amount: '2000',
        paidById: user.id,
      },
    });
    expect(payment.amount.toString()).toBe('2000');
  });

  it('rejects a CorrectionPayment with a zero/negative amount (amount check)', async () => {
    const { entry, employee, cycle, adjustmentType, user } = await makeFixtures('payment-nonpositive');
    const correction = await makeCorrection(entry.id, adjustmentType.id, user.id);
    const adjustment = await makeBalanceAdjustment(correction.id, employee.id, cycle.id, adjustmentType.id);

    await expect(
      prisma.correctionPayment.create({
        data: { balanceAdjustmentId: adjustment.id, employeeId: employee.id, amount: '0', paidById: user.id },
      }),
    ).rejects.toThrow(/check constraint|violates check/i);
  });

  it('enforces at most one CorrectionPayment per BalanceAdjustment (unique balanceAdjustmentId)', async () => {
    const { entry, employee, cycle, adjustmentType, user } = await makeFixtures('payment-unique');
    const correction = await makeCorrection(entry.id, adjustmentType.id, user.id);
    const adjustment = await makeBalanceAdjustment(correction.id, employee.id, cycle.id, adjustmentType.id);

    const create = () =>
      prisma.correctionPayment.create({
        data: { balanceAdjustmentId: adjustment.id, employeeId: employee.id, amount: '2000', paidById: user.id },
      });
    await create();
    await expect(create()).rejects.toThrow(/unique constraint/i);
  });

  // --- BalanceAdjustmentSettlement --------------------------------------------------------------

  it('creates a valid BalanceAdjustmentSettlement for one cycle against a RECOVERY BalanceAdjustment', async () => {
    const { entry, employee, cycle, adjustmentType, user } = await makeFixtures('settlement-happy-path');
    const correction = await makeCorrection(entry.id, adjustmentType.id, user.id, { newValue: '28000' });
    const adjustment = await makeBalanceAdjustment(correction.id, employee.id, cycle.id, adjustmentType.id, {
      type: 'RECOVERY',
      amount: '2000',
      remainingAmount: '2000',
    });
    const nextCycle = await makeCycle(user.id, cycle.month === 12 ? 1 : cycle.month + 1, 'DRAFT');

    const settlement = await prisma.balanceAdjustmentSettlement.create({
      data: { balanceAdjustmentId: adjustment.id, cycleId: nextCycle.id, amountApplied: '500' },
    });
    expect(settlement.amountApplied.toString()).toBe('500');
  });

  it('rejects a BalanceAdjustmentSettlement with a zero/negative amountApplied (amountApplied check)', async () => {
    const { entry, employee, cycle, adjustmentType, user } = await makeFixtures('settlement-nonpositive');
    const correction = await makeCorrection(entry.id, adjustmentType.id, user.id, { newValue: '28000' });
    const adjustment = await makeBalanceAdjustment(correction.id, employee.id, cycle.id, adjustmentType.id, {
      type: 'RECOVERY',
      amount: '2000',
      remainingAmount: '2000',
    });

    await expect(
      prisma.balanceAdjustmentSettlement.create({
        data: { balanceAdjustmentId: adjustment.id, cycleId: cycle.id, amountApplied: '0' },
      }),
    ).rejects.toThrow(/check constraint|violates check/i);
  });

  it('enforces at most one BalanceAdjustmentSettlement per (balanceAdjustmentId, cycleId)', async () => {
    const { entry, employee, cycle, adjustmentType, user } = await makeFixtures('settlement-unique');
    const correction = await makeCorrection(entry.id, adjustmentType.id, user.id, { newValue: '28000' });
    const adjustment = await makeBalanceAdjustment(correction.id, employee.id, cycle.id, adjustmentType.id, {
      type: 'RECOVERY',
      amount: '2000',
      remainingAmount: '2000',
    });

    const create = () =>
      prisma.balanceAdjustmentSettlement.create({
        data: { balanceAdjustmentId: adjustment.id, cycleId: cycle.id, amountApplied: '500' },
      });
    await create();
    await expect(create()).rejects.toThrow(/unique constraint/i);
  });
});
