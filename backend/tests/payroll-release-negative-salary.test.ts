import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

/**
 * Negative Payroll Recovery checkpoint (2026-07-26) — Part D items 1-10. Covers the release
 * sweep's classification of positive/zero/negative net salary into PAID/NO_PAY_DUE/RECOVERY_DUE,
 * the recovery `BalanceAdjustment` this creates, Finalize's acceptance of the non-payable
 * outcomes, and Bank Sheet/Cash Receiving's exclusion of zero/negative payable amounts.
 */
describe('Negative Payroll Recovery — release outcome classification', () => {
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
      permissionKeys: [
        PERMISSIONS.PAYROLL_CYCLE_MANAGE,
        PERMISSIONS.PAYROLL_ENTRY,
        PERMISSIONS.PAYROLL_RELEASE,
        PERMISSIONS.BANK_SHEETS_VIEW,
      ],
    });
  }

  async function makeSiteWithUnit(name: string) {
    const site = await prisma.projectSite.create({ data: { name } });
    const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} Unit` } });
    return { site, unit };
  }

  async function makeEmployee(siteId: string, unitId: string, name: string) {
    return prisma.employee.create({ data: { name, designation: 'Guard', siteId, unitId, grossPay: '30000' } });
  }

  async function makeDraftCycle(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, month: number, year = 2900) {
    const res = await admin.agent
      .post('/api/v1/payroll-cycles')
      .set('x-csrf-token', admin.csrfToken)
      .send({ year, month });
    return res.body.cycle as { id: string; year: number; month: number };
  }

  async function createEntry(
    admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>,
    cycleId: string,
    employeeId: string,
  ) {
    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycleId}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId });
    return res.body.entry as { id: string; version: number };
  }

  /** Deterministic net-salary control, independent of work-line days/rate math: `allowance` is a
   * pure additive earning, `eobiApplicable: false` zeroes the only deduction a freshly created
   * entry (0 work days) would otherwise carry. */
  async function setNetSalary(
    admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>,
    entryId: string,
    version: number,
    target: 'positive' | 'zero' | 'negative',
  ) {
    const body =
      target === 'positive'
        ? { version, eobiApplicable: false, allowance: '5000' }
        : target === 'zero'
          ? { version, eobiApplicable: false }
          : { version, eobiApplicable: true, eobiAmount: '400' }; // default entry: 0 earning - 400 EOBI = -400
    const res = await admin.agent
      .patch(`/api/v1/payroll-entries/${entryId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send(body);
    if (res.status !== 200) throw new Error(`setNetSalary failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.entry as { id: string; version: number; calc: { netSalary: string } };
  }

  async function releaseUnit(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, cycleId: string, unitId: string) {
    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycleId}/units/${unitId}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    return res;
  }

  // --- Item 1: positive net salary releases normally --------------------------------------------

  it('releases a positive-net entry normally: released=true, payoutOutcome=null', async () => {
    const admin = await masterAdminAgent('neg-positive-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Neg Positive');
    const cycle = await makeDraftCycle(admin, 1);
    const employee = await makeEmployee(site.id, unit.id, 'Positive Employee');
    const entry = await createEntry(admin, cycle.id, employee.id);
    const updated = await setNetSalary(admin, entry.id, entry.version, 'positive');
    expect(Number(updated.calc.netSalary)).toBeGreaterThan(0);

    const res = await releaseUnit(admin, cycle.id, unit.id);
    expect(res.status).toBe(201);
    expect(res.body.releasedEntryCount).toBe(1);
    expect(res.body.noPayDueCount).toBe(0);
    expect(res.body.recoveryDueCount).toBe(0);
    expect(res.body.blockedCount).toBe(0);

    const final = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(final.released).toBe(true);
    expect(final.payoutOutcome).toBeNull();
  });

  // --- Item 2: zero net salary produces no payment -----------------------------------------------

  it('resolves a zero-net entry as NO_PAY_DUE, never released', async () => {
    const admin = await masterAdminAgent('neg-zero-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Neg Zero');
    const cycle = await makeDraftCycle(admin, 2);
    const employee = await makeEmployee(site.id, unit.id, 'Zero Employee');
    const entry = await createEntry(admin, cycle.id, employee.id);
    const updated = await setNetSalary(admin, entry.id, entry.version, 'zero');
    expect(Number(updated.calc.netSalary)).toBe(0);

    const res = await releaseUnit(admin, cycle.id, unit.id);
    expect(res.status).toBe(201);
    expect(res.body.releasedEntryCount).toBe(0);
    expect(res.body.noPayDueCount).toBe(1);
    expect(res.body.recoveryDueCount).toBe(0);

    const final = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(final.released).toBe(false);
    expect(final.payoutOutcome).toBe('NO_PAY_DUE');
  });

  // --- Items 3, 4, 7: negative net salary produces RECOVERY_DUE + a matching BalanceAdjustment ---

  it('resolves a negative-net entry as RECOVERY_DUE (never released) and creates a RECOVERY BalanceAdjustment for the absolute amount', async () => {
    const admin = await masterAdminAgent('neg-negative-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Neg Negative');
    const cycle = await makeDraftCycle(admin, 3);
    const employee = await makeEmployee(site.id, unit.id, 'Negative Employee');
    const entry = await createEntry(admin, cycle.id, employee.id);
    const updated = await setNetSalary(admin, entry.id, entry.version, 'negative');
    expect(Number(updated.calc.netSalary)).toBeLessThan(0);
    expect(updated.calc.netSalary).toBe('-400.00');

    const res = await releaseUnit(admin, cycle.id, unit.id);
    expect(res.status).toBe(201);
    expect(res.body.releasedEntryCount).toBe(0);
    expect(res.body.recoveryDueCount).toBe(1);

    const final = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    // Item 4: negative salary never gets normal "Released" presentation — released stays false.
    expect(final.released).toBe(false);
    expect(final.payoutOutcome).toBe('RECOVERY_DUE');

    const adjustment = await prisma.balanceAdjustment.findFirstOrThrow({
      where: { originPayrollEntryId: entry.id },
    });
    expect(adjustment.type).toBe('RECOVERY');
    expect(adjustment.status).toBe('PENDING');
    expect(adjustment.correctionId).toBeNull();
    expect(adjustment.amount.toFixed(2)).toBe('400.00');
    expect(adjustment.remainingAmount.toFixed(2)).toBe('400.00');
    expect(adjustment.employeeId).toBe(employee.id);
    expect(adjustment.sourceCycleId).toBe(cycle.id);

    const auditEntry = await prisma.auditLog.findFirst({
      where: { action: 'payroll_entry.recovery_due', entityId: entry.id },
    });
    expect(auditEntry).not.toBeNull();
  });

  // --- Item 5: mixed unit — positive and negative employees in the same Unit release together ---

  it('processes a mixed Unit (positive + negative employees) in one sweep: positive pays, negative resolves to recovery, neither blocks the other', async () => {
    const admin = await masterAdminAgent('neg-mixed-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Neg Mixed');
    const cycle = await makeDraftCycle(admin, 4);
    const positiveEmployee = await makeEmployee(site.id, unit.id, 'Mixed Positive');
    const negativeEmployee = await makeEmployee(site.id, unit.id, 'Mixed Negative');
    const positiveEntry = await createEntry(admin, cycle.id, positiveEmployee.id);
    const negativeEntry = await createEntry(admin, cycle.id, negativeEmployee.id);
    await setNetSalary(admin, positiveEntry.id, positiveEntry.version, 'positive');
    await setNetSalary(admin, negativeEntry.id, negativeEntry.version, 'negative');

    const res = await releaseUnit(admin, cycle.id, unit.id);
    expect(res.status).toBe(201);
    expect(res.body.releasedEntryCount).toBe(1);
    expect(res.body.recoveryDueCount).toBe(1);

    const finalPositive = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: positiveEntry.id } });
    const finalNegative = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: negativeEntry.id } });
    expect(finalPositive.released).toBe(true);
    expect(finalNegative.released).toBe(false);
    expect(finalNegative.payoutOutcome).toBe('RECOVERY_DUE');
  });

  // --- Item 6: Finalize succeeds once every entry is released/held/payoutOutcome-resolved --------

  it('allows Finalize to proceed once zero/negative entries are resolved by release — no manual Hold required', async () => {
    const admin = await masterAdminAgent('neg-finalize-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Neg Finalize');
    const cycle = await makeDraftCycle(admin, 5);
    const zeroEmployee = await makeEmployee(site.id, unit.id, 'Finalize Zero');
    const negativeEmployee = await makeEmployee(site.id, unit.id, 'Finalize Negative');
    const zeroEntry = await createEntry(admin, cycle.id, zeroEmployee.id);
    const negativeEntry = await createEntry(admin, cycle.id, negativeEmployee.id);
    await setNetSalary(admin, zeroEntry.id, zeroEntry.version, 'zero');
    await setNetSalary(admin, negativeEntry.id, negativeEntry.version, 'negative');

    const releaseRes = await releaseUnit(admin, cycle.id, unit.id);
    expect(releaseRes.status).toBe(201);

    const finalizeRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/finalize`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(finalizeRes.status).toBe(200);
    expect(finalizeRes.body.cycle.status).toBe('RELEASED');
  });

  // --- Item 9/10: Bank Sheet / Cash Receiving exclude zero/negative amounts, even defensively ----

  it('excludes a zero/negative entry from Bank Sheet output and totals, even one incorrectly marked released (legacy-bad-data defense)', async () => {
    const admin = await masterAdminAgent('neg-banksheet-admin@test.local');
    const bank = await prisma.bank.create({ data: { code: 'TBNEGBS', name: 'Neg Bank Sheet Test Bank' } });
    const { site, unit } = await makeSiteWithUnit('Test Site Neg Bank Sheet');
    const cycle = await makeDraftCycle(admin, 6);
    const goodEmployee = await prisma.employee.create({
      data: { name: 'Good Payee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000', bankId: bank.id, accountNumber: '111' },
    });
    const badEmployee = await prisma.employee.create({
      data: { name: 'Legacy Bad Payee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000', bankId: bank.id, accountNumber: '222' },
    });
    const goodEntry = await createEntry(admin, cycle.id, goodEmployee.id);
    const badEntry = await createEntry(admin, cycle.id, badEmployee.id);
    await setNetSalary(admin, goodEntry.id, goodEntry.version, 'positive');
    await setNetSalary(admin, badEntry.id, badEntry.version, 'negative');

    await releaseUnit(admin, cycle.id, unit.id);

    // Simulate pre-existing bad data (a negative-net entry marked released before this checkpoint
    // shipped) — this must never resurface as a payable Bank Sheet row, purely as a defensive
    // backstop; it is never mutated automatically by any real code path in this checkpoint.
    await prisma.payrollEntry.update({
      where: { id: badEntry.id },
      data: { released: true, payoutOutcome: null, releasedAt: new Date(), releasedBy: admin.userId },
    });

    const res = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/bank-sheet?bankId=${bank.id}`);
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].employeeName).toBe('Good Payee');
    expect(Number(res.body.totalNetSalary)).toBeGreaterThan(0);
  });

  it('excludes a zero/negative entry from Cash Receiving output and totals, even one incorrectly marked released (legacy-bad-data defense)', async () => {
    const admin = await masterAdminAgent('neg-cashrecv-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Neg Cash Receiving');
    const cycle = await makeDraftCycle(admin, 7);
    const goodEmployee = await makeEmployee(site.id, unit.id, 'Good Cash Payee');
    const badEmployee = await makeEmployee(site.id, unit.id, 'Legacy Bad Cash Payee');
    const goodEntry = await createEntry(admin, cycle.id, goodEmployee.id);
    const badEntry = await createEntry(admin, cycle.id, badEmployee.id);
    await setNetSalary(admin, goodEntry.id, goodEntry.version, 'positive');
    await setNetSalary(admin, badEntry.id, badEntry.version, 'negative');

    await releaseUnit(admin, cycle.id, unit.id);

    await prisma.payrollEntry.update({
      where: { id: badEntry.id },
      data: { released: true, payoutOutcome: null, releasedAt: new Date(), releasedBy: admin.userId },
    });

    const res = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/cash-receiving`);
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].employeeName).toBe('Good Cash Payee');
    expect(Number(res.body.totalNetSalary)).toBeGreaterThan(0);
  });

  // --- Item 8: recovery carries forward to the next Draft cycle via rollover materialization -----

  it('carries a recovery forward to the employee\'s next Draft-cycle entry after rollover', async () => {
    const admin = await masterAdminAgent('neg-carryforward-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Neg Carryforward');
    const cycle = await makeDraftCycle(admin, 8);
    const employee = await makeEmployee(site.id, unit.id, 'Carryforward Employee');
    const entry = await createEntry(admin, cycle.id, employee.id);
    await setNetSalary(admin, entry.id, entry.version, 'negative');

    // Every entry in the cycle must resolve (released/held/payoutOutcome) before Finalize — this
    // cycle has exactly one entry, now RECOVERY_DUE.
    await releaseUnit(admin, cycle.id, unit.id);
    const finalizeRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/finalize`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(finalizeRes.status).toBe(200);

    const rolloverRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/archive-and-create-next`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(rolloverRes.status).toBe(201);
    const nextCycleId = rolloverRes.body.newCycle.id as string;

    const nextEntry = await prisma.payrollEntry.findUniqueOrThrow({
      where: { cycleId_employeeId: { cycleId: nextCycleId, employeeId: employee.id } },
    });
    expect(nextEntry.correctionBalanceRecovery.toFixed(2)).toBe('400.00');

    const adjustment = await prisma.balanceAdjustment.findFirstOrThrow({ where: { originPayrollEntryId: entry.id } });
    const materialization = await prisma.balanceAdjustmentMaterialization.findFirstOrThrow({
      where: { balanceAdjustmentId: adjustment.id },
    });
    expect(materialization.payrollEntryId).toBe(nextEntry.id);
    expect(materialization.amount.toFixed(2)).toBe('400.00');
  });
});
