import { Decimal } from 'decimal.js';
import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

/**
 * Negative Payroll Recovery checkpoint (2026-07-26) — accounting verification pass, Part D items
 * H/I/J/K. Verifies a carried-forward `RECOVERY` `BalanceAdjustment` is never double-counted: when
 * a future cycle's own earnings can't fully absorb the materialized recovery deduction, the
 * shortfall floors the entry to exactly `NO_PAY_DUE` (never a *new* `RECOVERY_DUE`), only the
 * actually-affordable amount settles against the *original* obligation, and the remainder carries
 * forward again — never fabricated as a second, independent recovery.
 */
describe('Negative Payroll Recovery — multi-cycle recovery accounting', () => {
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

  async function makeDraftCycle(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, month: number, year = 2900) {
    const res = await admin.agent
      .post('/api/v1/payroll-cycles')
      .set('x-csrf-token', admin.csrfToken)
      .send({ year, month });
    if (res.status !== 201) throw new Error(`cycle create failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.cycle as { id: string; year: number; month: number };
  }

  async function getEntry(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, cycleId: string, employeeId: string) {
    const res = await admin.agent.get(`/api/v1/payroll-cycles/${cycleId}/entries?employeeId=${employeeId}`);
    if (res.status !== 200 || !res.body.entries?.length) {
      throw new Error(`entry not found: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body.entries[0] as { id: string; version: number; calc: { netSalary: string; correctionBalanceRecovery: string } };
  }

  /** Sets `allowance` (a pure additive earning) and `eobiApplicable: false` (zeroing the only
   * deduction a default 0-work-day entry would otherwise carry) so this entry's earnings *before*
   * any recovery deduction equal exactly `beforeRecoveryAmount` — deterministic, independent of
   * work-line days/rate math. */
  async function setEarningsBeforeRecovery(
    admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>,
    entryId: string,
    version: number,
    beforeRecoveryAmount: string,
  ) {
    const res = await admin.agent
      .patch(`/api/v1/payroll-entries/${entryId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version, eobiApplicable: false, allowance: beforeRecoveryAmount });
    if (res.status !== 200) throw new Error(`setEarningsBeforeRecovery failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.entry as { id: string; version: number; calc: { netSalary: string; correctionBalanceRecovery: string } };
  }

  /** Sets `allowance` (earnings before deductions), `fine` (a genuinely new, non-recovery
   * deduction), and `eobiApplicable: false` (zeroing the only deduction a default 0-work-day entry
   * would otherwise carry) — the "Case 3" fixture: earnings and other current-cycle deductions
   * that, by themselves, already exceed earnings, independent of any carried-forward recovery. */
  async function setEarningsAndOtherDeduction(
    admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>,
    entryId: string,
    version: number,
    earnings: string,
    otherDeduction: string,
  ) {
    const res = await admin.agent
      .patch(`/api/v1/payroll-entries/${entryId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version, eobiApplicable: false, allowance: earnings, fine: otherDeduction });
    if (res.status !== 200) throw new Error(`setEarningsAndOtherDeduction failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.entry as { id: string; version: number; calc: { netSalary: string; correctionBalanceRecovery: string } };
  }

  async function releaseUnit(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, cycleId: string, unitId: string) {
    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycleId}/units/${unitId}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    if (res.status !== 201) throw new Error(`release failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as {
      releasedEntryCount: number;
      noPayDueCount: number;
      recoveryDueCount: number;
      blockedCount: number;
    };
  }

  async function finalizeCycle(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, cycleId: string) {
    const res = await admin.agent.post(`/api/v1/payroll-cycles/${cycleId}/finalize`).set('x-csrf-token', admin.csrfToken).send({});
    if (res.status !== 200) throw new Error(`finalize failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  async function rollover(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, cycleId: string) {
    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycleId}/archive-and-create-next`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    if (res.status !== 201) throw new Error(`rollover failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.newCycle as { id: string };
  }

  // --- Items H/I: -400 recovery -> +300 partial -> +500 full settlement, no double-counting ------

  it('carries a -400 recovery through a 300 partial-absorption cycle to full settlement, with no new/duplicate recovery ever created', async () => {
    const admin = await masterAdminAgent('recovery-math-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Recovery Math');
    const employee = await prisma.employee.create({
      data: { name: 'Recovery Math Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });
    const cycle1 = await makeDraftCycle(admin, 1);

    // --- Cycle 1: default 0-work-day entry nets exactly -400 (0 earning, 400 EOBI deduction). ---
    const entry1 = await getEntry(admin, cycle1.id, employee.id);
    expect(entry1.calc.netSalary).toBe('-400.00');

    const release1 = await releaseUnit(admin, cycle1.id, unit.id);
    expect(release1.recoveryDueCount).toBe(1);
    expect(release1.releasedEntryCount).toBe(0);

    const afterCycle1 = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry1.id } });
    expect(afterCycle1.released).toBe(false);
    expect(afterCycle1.payoutOutcome).toBe('RECOVERY_DUE');

    const adjustment = await prisma.balanceAdjustment.findFirstOrThrow({ where: { originPayrollEntryId: entry1.id } });
    expect(adjustment.type).toBe('RECOVERY');
    expect(adjustment.amount.toFixed(2)).toBe('400.00');
    expect(adjustment.remainingAmount.toFixed(2)).toBe('400.00');
    expect(adjustment.status).toBe('PENDING');

    await finalizeCycle(admin, cycle1.id);
    const cycle2 = await rollover(admin, cycle1.id);

    // --- Cycle 2: materialized recovery = 400 (full remaining); earnings before recovery = 300. ---
    const bootstrapped2 = await getEntry(admin, cycle2.id, employee.id);
    expect(bootstrapped2.calc.correctionBalanceRecovery).toBe('400.00');

    const entry2 = await setEarningsBeforeRecovery(admin, bootstrapped2.id, bootstrapped2.version, '300');
    // Raw calcNet (unadjusted) reads -100 here — 300 earnings minus the full 400 materialized
    // recovery deduction. This is the exact figure the release sweep must NOT treat as a fresh,
    // independent recovery — see the release assertions immediately below.
    expect(entry2.calc.netSalary).toBe('-100.00');

    const release2 = await releaseUnit(admin, cycle2.id, unit.id);
    expect(release2.recoveryDueCount).toBe(0); // no NEW recovery created
    expect(release2.noPayDueCount).toBe(1);
    expect(release2.releasedEntryCount).toBe(0);

    const afterCycle2 = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry2.id } });
    expect(afterCycle2.released).toBe(false);
    expect(afterCycle2.payoutOutcome).toBe('NO_PAY_DUE');

    // Still exactly one BalanceAdjustment for this employee/origin — no second one was created.
    const adjustmentsForEmployee = await prisma.balanceAdjustment.findMany({ where: { employeeId: employee.id } });
    expect(adjustmentsForEmployee).toHaveLength(1);

    const afterCycle2Adjustment = await prisma.balanceAdjustment.findUniqueOrThrow({ where: { id: adjustment.id } });
    expect(afterCycle2Adjustment.remainingAmount.toFixed(2)).toBe('100.00'); // 400 - 300
    expect(afterCycle2Adjustment.status).toBe('PENDING');

    const cycle2Settlement = await prisma.balanceAdjustmentSettlement.findFirstOrThrow({
      where: { balanceAdjustmentId: adjustment.id, cycleId: cycle2.id },
    });
    expect(cycle2Settlement.amountApplied.toFixed(2)).toBe('300.00');

    // Bank Sheet/Cash Receiving must never show any payment for this NO_PAY_DUE cycle-2 entry.
    const cashSheetCycle2 = await admin.agent.get(`/api/v1/payroll-cycles/${cycle2.id}/cash-receiving`);
    expect(cashSheetCycle2.body.rows).toHaveLength(0);

    await finalizeCycle(admin, cycle2.id);
    const cycle3 = await rollover(admin, cycle2.id);

    // --- Cycle 3: materialized recovery = 100 (the true remainder); earnings before recovery = 500. ---
    const bootstrapped3 = await getEntry(admin, cycle3.id, employee.id);
    expect(bootstrapped3.calc.correctionBalanceRecovery).toBe('100.00');

    const entry3 = await setEarningsBeforeRecovery(admin, bootstrapped3.id, bootstrapped3.version, '500');
    expect(entry3.calc.netSalary).toBe('400.00'); // 500 - 100, employee payable

    const release3 = await releaseUnit(admin, cycle3.id, unit.id);
    expect(release3.releasedEntryCount).toBe(1);
    expect(release3.recoveryDueCount).toBe(0);
    expect(release3.noPayDueCount).toBe(0);

    const afterCycle3 = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry3.id } });
    expect(afterCycle3.released).toBe(true);
    expect(afterCycle3.payoutOutcome).toBeNull();

    const finalAdjustment = await prisma.balanceAdjustment.findUniqueOrThrow({ where: { id: adjustment.id } });
    expect(finalAdjustment.remainingAmount.toFixed(2)).toBe('0.00');
    expect(finalAdjustment.status).toBe('SETTLED');
    expect(finalAdjustment.settledInCycleId).toBe(cycle3.id);

    const cycle3Settlement = await prisma.balanceAdjustmentSettlement.findFirstOrThrow({
      where: { balanceAdjustmentId: adjustment.id, cycleId: cycle3.id },
    });
    expect(cycle3Settlement.amountApplied.toFixed(2)).toBe('100.00');

    // Cash Receiving for cycle 3 shows exactly the 400 payable — never the 500 gross, never 100.
    const cashSheetCycle3 = await admin.agent.get(`/api/v1/payroll-cycles/${cycle3.id}/cash-receiving`);
    expect(cashSheetCycle3.body.rows).toHaveLength(1);
    expect(cashSheetCycle3.body.rows[0].netSalary).toBe('400.00');

    // Still exactly one BalanceAdjustment across the whole employee's history.
    const finalAdjustmentsForEmployee = await prisma.balanceAdjustment.findMany({ where: { employeeId: employee.id } });
    expect(finalAdjustmentsForEmployee).toHaveLength(1);
  });

  // --- Item J: recovery exactly consumes available salary — boundary case ------------------------

  it('resolves an exact-zero boundary (recovery deduction exactly equals available salary) as NO_PAY_DUE, settles the recovery in full, and creates no new recovery', async () => {
    const admin = await masterAdminAgent('recovery-boundary-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Recovery Boundary');
    const employee = await prisma.employee.create({
      data: { name: 'Recovery Boundary Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });
    const cycle1 = await makeDraftCycle(admin, 2);

    const entry1 = await getEntry(admin, cycle1.id, employee.id);
    expect(entry1.calc.netSalary).toBe('-400.00');
    await releaseUnit(admin, cycle1.id, unit.id);

    const adjustment = await prisma.balanceAdjustment.findFirstOrThrow({ where: { originPayrollEntryId: entry1.id } });
    expect(adjustment.remainingAmount.toFixed(2)).toBe('400.00');

    await finalizeCycle(admin, cycle1.id);
    const cycle2 = await rollover(admin, cycle1.id);

    const bootstrapped2 = await getEntry(admin, cycle2.id, employee.id);
    expect(bootstrapped2.calc.correctionBalanceRecovery).toBe('400.00');

    // Earnings before recovery = exactly 400 — the boundary.
    const entry2 = await setEarningsBeforeRecovery(admin, bootstrapped2.id, bootstrapped2.version, '400');
    expect(entry2.calc.netSalary).toBe('0.00');

    const release2 = await releaseUnit(admin, cycle2.id, unit.id);
    expect(release2.noPayDueCount).toBe(1);
    expect(release2.recoveryDueCount).toBe(0);
    expect(release2.releasedEntryCount).toBe(0);

    const afterCycle2 = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry2.id } });
    expect(afterCycle2.released).toBe(false);
    expect(afterCycle2.payoutOutcome).toBe('NO_PAY_DUE');

    const finalAdjustment = await prisma.balanceAdjustment.findUniqueOrThrow({ where: { id: adjustment.id } });
    expect(finalAdjustment.remainingAmount.toFixed(2)).toBe('0.00');
    expect(finalAdjustment.status).toBe('SETTLED');
    expect(finalAdjustment.settledInCycleId).toBe(cycle2.id);

    const adjustmentsForEmployee = await prisma.balanceAdjustment.findMany({ where: { employeeId: employee.id } });
    expect(adjustmentsForEmployee).toHaveLength(1); // no new recovery created

    // No bank/cash payment for this exact-zero cycle.
    const cashSheet = await admin.agent.get(`/api/v1/payroll-cycles/${cycle2.id}/cash-receiving`);
    expect(cashSheet.body.rows).toHaveLength(0);
  });

  // --- Case 3: old carried-forward recovery cannot be absorbed at all this cycle, even after ------
  // --- excluding it, AND this cycle independently generates a genuinely new shortfall -------------
  //
  // Traced accounting (not fitted to the implementation): `computeReleaseRecoveryAdjustment` defines
  // `baseNet = netSalary + materializedRecovery` — i.e. netSalary with the old recovery's own
  // deduction added back, exposing what this cycle would net *without* that carried-forward
  // obligation. Case 3 is `netSalary < 0 AND baseNet < 0`: even excluding the old recovery entirely,
  // this cycle is independently negative. The correct invariant: the old recovery is not touched by
  // an unrelated shortfall it didn't cause — it settles 0 this cycle (deferred, not lost, not
  // shrunk), and `baseNet` itself (already net of the old recovery) becomes the basis for a *new*,
  // distinct `BalanceAdjustment` representing exactly the genuinely-new negative amount. The two
  // obligations must never merge into one number and never double-create from the same old balance.
  //
  // Scenario: opening recovery (from Cycle 1) = 400. Cycle 2: earnings = 300, a new non-recovery
  // deduction (fine) = 500, materialized old recovery = 400. Raw netSalary = 300 - 500 - 400 = -600.
  // baseNet (excluding the old recovery) = 300 - 500 = -200 — negative on its own, independent of the
  // carried-forward 400. Correct outcome: old 400 settles 0 (stays PENDING at 400), a new 200
  // recovery is created from this cycle's own entry, payoutOutcome = RECOVERY_DUE, payout = 0.

  it('Case 3 — old recovery independently unaffordable this cycle: old balance settles 0 (deferred, unchanged), a distinct new recovery is created for exactly the new shortfall, and the conservation invariant holds', async () => {
    const admin = await masterAdminAgent('recovery-case3-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Recovery Case3');
    const employee = await prisma.employee.create({
      data: { name: 'Recovery Case3 Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });
    const cycle1 = await makeDraftCycle(admin, 3);

    // --- Cycle 1: default 0-work-day entry nets exactly -400 -> opening recovery. -------------------
    const entry1 = await getEntry(admin, cycle1.id, employee.id);
    expect(entry1.calc.netSalary).toBe('-400.00');

    const release1 = await releaseUnit(admin, cycle1.id, unit.id);
    expect(release1.recoveryDueCount).toBe(1);
    expect(release1.releasedEntryCount).toBe(0);

    const openingAdjustment = await prisma.balanceAdjustment.findFirstOrThrow({ where: { originPayrollEntryId: entry1.id } });
    expect(openingAdjustment.amount.toFixed(2)).toBe('400.00');
    expect(openingAdjustment.remainingAmount.toFixed(2)).toBe('400.00');
    expect(openingAdjustment.status).toBe('PENDING');
    const OPENING_RECOVERY = new Decimal('400.00');

    await finalizeCycle(admin, cycle1.id);
    const cycle2 = await rollover(admin, cycle1.id);

    // --- Cycle 2: earnings = 300, new deduction (fine) = 500, materialized old recovery = 400. -----
    const bootstrapped2 = await getEntry(admin, cycle2.id, employee.id);
    expect(bootstrapped2.calc.correctionBalanceRecovery).toBe('400.00');

    const entry2 = await setEarningsAndOtherDeduction(admin, bootstrapped2.id, bootstrapped2.version, '300', '500');
    // Raw calcNet = 300 - 500 - 400 = -600. This is the figure the release sweep must never pay out
    // directly — the assertions below prove it splits correctly into "0 of the old 400" + "a new,
    // distinct 200", never a single fabricated -600/600 recovery.
    expect(entry2.calc.netSalary).toBe('-600.00');

    const release2 = await releaseUnit(admin, cycle2.id, unit.id);
    expect(release2.blockedCount).toBe(0);
    expect(release2.releasedEntryCount).toBe(0);
    expect(release2.noPayDueCount).toBe(0);
    expect(release2.recoveryDueCount).toBe(1); // exactly one NEW recovery this cycle — not the old one re-fired

    const afterCycle2 = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry2.id } });
    expect(afterCycle2.released).toBe(false);
    expect(afterCycle2.payoutOutcome).toBe('RECOVERY_DUE');

    // --- The old 400 recovery: untouched by this cycle's unrelated shortfall -----------------------
    // — no settlement recorded against it, remainingAmount unchanged, still PENDING.
    const openingAfterCycle2 = await prisma.balanceAdjustment.findUniqueOrThrow({ where: { id: openingAdjustment.id } });
    expect(openingAfterCycle2.remainingAmount.toFixed(2)).toBe('400.00');
    expect(openingAfterCycle2.status).toBe('PENDING');
    expect(openingAfterCycle2.settledInCycleId).toBeNull();

    const openingSettlementCycle2 = await prisma.balanceAdjustmentSettlement.findFirst({
      where: { balanceAdjustmentId: openingAdjustment.id, cycleId: cycle2.id },
    });
    expect(openingSettlementCycle2).toBeNull(); // zero capacity this cycle -> cancelled, never a 0.00 settlement row

    const cancelledMaterialization = await prisma.balanceAdjustmentMaterialization.findFirstOrThrow({
      where: { balanceAdjustmentId: openingAdjustment.id, cycleId: cycle2.id },
    });
    expect(cancelledMaterialization.status).toBe('CANCELLED');

    // --- The genuinely new 200 shortfall: exactly one new, distinct BalanceAdjustment ---------------
    // (never merged with the old one, never a second row against the old one's originPayrollEntryId).
    const adjustmentsAfterCycle2 = await prisma.balanceAdjustment.findMany({ where: { employeeId: employee.id } });
    expect(adjustmentsAfterCycle2).toHaveLength(2);
    const newAdjustment = adjustmentsAfterCycle2.find((a) => a.id !== openingAdjustment.id)!;
    expect(newAdjustment.originPayrollEntryId).toBe(entry2.id);
    expect(newAdjustment.type).toBe('RECOVERY');
    expect(newAdjustment.amount.toFixed(2)).toBe('200.00');
    expect(newAdjustment.remainingAmount.toFixed(2)).toBe('200.00');
    expect(newAdjustment.status).toBe('PENDING');
    const NEW_RECOVERY_GENERATED = new Decimal(newAdjustment.amount.toString());
    expect(NEW_RECOVERY_GENERATED.toFixed(2)).toBe('200.00'); // = |baseNet| = |300 - 500|, independent of the old 400

    // --- Employee payment: never negative, nothing paid out this cycle. ----------------------------
    const cashSheetCycle2 = await admin.agent.get(`/api/v1/payroll-cycles/${cycle2.id}/cash-receiving`);
    expect(cashSheetCycle2.body.rows).toHaveLength(0);

    // --- Recovery conservation invariant: opening + newly generated - settled = closing. -----------
    const SETTLED_THIS_CYCLE = new Decimal(0);
    const closingTotal = new Decimal(openingAfterCycle2.remainingAmount.toString()).plus(newAdjustment.remainingAmount.toString());
    expect(OPENING_RECOVERY.plus(NEW_RECOVERY_GENERATED).minus(SETTLED_THIS_CYCLE).toFixed(2)).toBe(closingTotal.toFixed(2));
    expect(closingTotal.toFixed(2)).toBe('600.00');

    // --- Finalize/release state stays internally consistent: a resolved RECOVERY_DUE entry ----------
    // does not block Finalize (it is resolved, not "blocked" like an identity/banking issue).
    await finalizeCycle(admin, cycle2.id);
    const cycle3 = await rollover(admin, cycle2.id);

    // --- Cycle 3: both the old 400 and the new 200 carry forward and materialize together (600). ---
    const bootstrapped3 = await getEntry(admin, cycle3.id, employee.id);
    expect(bootstrapped3.calc.correctionBalanceRecovery).toBe('600.00');

    // Earnings sufficient to fully settle both this cycle: 700 - 600 = 100 payable.
    const entry3 = await setEarningsBeforeRecovery(admin, bootstrapped3.id, bootstrapped3.version, '700');
    expect(entry3.calc.netSalary).toBe('100.00');

    const release3 = await releaseUnit(admin, cycle3.id, unit.id);
    expect(release3.releasedEntryCount).toBe(1);
    expect(release3.recoveryDueCount).toBe(0);
    expect(release3.noPayDueCount).toBe(0);
    expect(release3.blockedCount).toBe(0);

    const afterCycle3 = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry3.id } });
    expect(afterCycle3.released).toBe(true);
    expect(afterCycle3.payoutOutcome).toBeNull();

    const finalOpening = await prisma.balanceAdjustment.findUniqueOrThrow({ where: { id: openingAdjustment.id } });
    expect(finalOpening.remainingAmount.toFixed(2)).toBe('0.00');
    expect(finalOpening.status).toBe('SETTLED');
    expect(finalOpening.settledInCycleId).toBe(cycle3.id);

    const finalNew = await prisma.balanceAdjustment.findUniqueOrThrow({ where: { id: newAdjustment.id } });
    expect(finalNew.remainingAmount.toFixed(2)).toBe('0.00');
    expect(finalNew.status).toBe('SETTLED');
    expect(finalNew.settledInCycleId).toBe(cycle3.id);

    // Both settlements this cycle reconcile exactly to what was consumed (400 + 200 = 600).
    const cycle3Settlements = await prisma.balanceAdjustmentSettlement.findMany({
      where: { cycleId: cycle3.id, balanceAdjustmentId: { in: [openingAdjustment.id, newAdjustment.id] } },
    });
    const totalSettledCycle3 = cycle3Settlements.reduce((sum, s) => sum.plus(s.amountApplied.toString()), new Decimal(0));
    expect(totalSettledCycle3.toFixed(2)).toBe('600.00');

    const cashSheetCycle3 = await admin.agent.get(`/api/v1/payroll-cycles/${cycle3.id}/cash-receiving`);
    expect(cashSheetCycle3.body.rows).toHaveLength(1);
    expect(cashSheetCycle3.body.rows[0].netSalary).toBe('100.00');

    // Still exactly the two adjustments across this employee's whole history — no third ever created.
    const finalAdjustmentsForEmployee = await prisma.balanceAdjustment.findMany({ where: { employeeId: employee.id } });
    expect(finalAdjustmentsForEmployee).toHaveLength(2);
  });
});
