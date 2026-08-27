import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { computeEntryCalc, type EntryWithWorkLines } from '../src/modules/payroll-entry/payroll-entry.service';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

describe('Phase 4 Checkpoint 5 — Advances', () => {
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
      permissionKeys: [PERMISSIONS.PAYROLL_CYCLE_MANAGE, PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.ADVANCES_MANAGE],
    });
  }

  async function payrollStaffAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.PAYROLL_STAFF,
      permissionKeys: [PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.ADVANCES_MANAGE],
      siteIds,
    });
  }

  async function financeAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.FINANCE,
      // Finance receives no Advances permission at all (approved architecture decision).
      permissionKeys: [PERMISSIONS.PAYROLL_VIEW, PERMISSIONS.PAYROLL_RELEASE, PERMISSIONS.BANK_SHEETS_VIEW],
      siteIds,
    });
  }

  async function makeSiteWithUnit(name: string) {
    const site = await prisma.projectSite.create({ data: { name } });
    const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} Unit` } });
    return { site, unit };
  }

  async function makeEmployee(siteId: string, unitId: string, name: string, grossPay = '30000') {
    return prisma.employee.create({
      data: { name, designation: 'Guard', siteId, unitId, grossPay },
    });
  }

  async function makeDraftCycle(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, year: number, month: number) {
    const res = await admin.agent
      .post('/api/v1/payroll-cycles')
      .set('x-csrf-token', admin.csrfToken)
      .send({ year, month });
    if (res.status !== 201) throw new Error(`cycle create failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.cycle as { id: string; year: number; month: number };
  }

  async function releaseUnit(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, cycleId: string, unitId: string) {
    // Negative Payroll Recovery checkpoint (2026-07-26) — a heavy Advance/EID Advance deduction is
    // exactly the kind of input that can legitimately push netSalary negative, which now correctly
    // resolves to RECOVERY_DUE (no payment, no settlement) instead of releasing regardless of sign.
    // This file's own tests are about Advance materialization/settlement mechanics, not net-salary
    // sign, so any entry this Unit's sweep would otherwise touch gets just enough extra allowance
    // to stay positive first — entries already positive are left untouched.
    const candidates = await prisma.payrollEntry.findMany({
      where: { cycleId, released: false, hold: false, payoutOutcome: null, workLines: { some: { unitId } } },
      include: { workLines: true },
    });
    for (const entry of candidates) {
      const calc = computeEntryCalc(entry as EntryWithWorkLines);
      const net = Number(calc.netSalary);
      if (net <= 0) {
        const topUp = (Number(entry.allowance) + Math.abs(net) + 100).toFixed(2);
        await prisma.payrollEntry.update({ where: { id: entry.id }, data: { allowance: topUp } });
      }
    }

    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycleId}/units/${unitId}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(res.status).toBe(201);
  }

  async function createAdvance(
    agent: Awaited<ReturnType<typeof createAuthenticatedAgent>>,
    body: Record<string, unknown>,
  ) {
    return agent.agent.post('/api/v1/advances').set('x-csrf-token', agent.csrfToken).send(body);
  }

  // --- Permission tests -----------------------------------------------------------------------

  it('allows Payroll Staff (site-scoped) and Master Admin, rejects Finance entirely', async () => {
    const admin = await masterAdminAgent('adv-perm-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Perm');
    const employee = await makeEmployee(site.id, unit.id, 'Perm Employee');
    const staff = await payrollStaffAgent('adv-perm-staff@test.local', [site.id]);
    const finance = await financeAgent('adv-perm-finance@test.local', [site.id]);

    const staffRes = await createAdvance(staff, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '15000',
      dateGiven: '2026-01-05',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2900, month: 1 },
    });
    expect(staffRes.status).toBe(201);

    const listRes = await admin.agent.get('/api/v1/advances');
    expect(listRes.status).toBe(200);

    const financeRes = await createAdvance(finance, {
      employeeId: employee.id,
      type: 'EID_ADVANCE',
      totalAmount: '5000',
      dateGiven: '2026-01-05',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2900, month: 1 },
    });
    expect(financeRes.status).toBe(403);

    const financeListRes = await finance.agent.get('/api/v1/advances');
    expect(financeListRes.status).toBe(403);
  });

  it('site-scopes Payroll Staff — an employee outside assignment is rejected', async () => {
    const { site: siteA } = await makeSiteWithUnit('Test Site ADV Scope A');
    const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site ADV Scope B');
    const employeeB = await makeEmployee(siteB.id, unitB.id, 'Scope Employee B');
    const staffA = await payrollStaffAgent('adv-scope-staffA@test.local', [siteA.id]);

    const res = await createAdvance(staffA, {
      employeeId: employeeB.id,
      type: 'LOAN',
      totalAmount: '10000',
      dateGiven: '2026-01-05',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2900, month: 1 },
    });
    expect(res.status).toBe(403);
  });

  // --- At-most-one-ACTIVE-per-type -------------------------------------------------------------

  it('rejects a second ACTIVE advance of the same type, allows a different type, and allows a new one once PAID_OFF', async () => {
    const admin = await masterAdminAgent('adv-single-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Single');
    const employee = await makeEmployee(site.id, unit.id, 'Single Advance Employee');

    const first = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '10000',
      dateGiven: '2026-01-05',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2900, month: 1 },
    });
    expect(first.status).toBe(201);

    const secondSameType = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '5000',
      dateGiven: '2026-01-06',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2900, month: 2 },
    });
    expect(secondSameType.status).toBe(409);

    const differentType = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'EID_ADVANCE',
      totalAmount: '5000',
      dateGiven: '2026-01-06',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2900, month: 2 },
    });
    expect(differentType.status).toBe(201);

    // RESERVED blocks a new one too (2026-07-25, Issue 5) — reserved-but-unreleased is not yet
    // final, so it must still be treated as "live" for the at-most-one-per-type rule.
    await prisma.advance.update({
      where: { id: first.body.advance.id },
      data: { status: 'RESERVED', outstandingBalance: '0', currentScheduledPeriodId: null },
    });
    const whileReserved = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '5000',
      dateGiven: '2026-02-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2900, month: 3 },
    });
    expect(whileReserved.status).toBe(409);

    // Pay off the first advance directly (simulating an actual Release settling it) so a new LOAN
    // becomes legal.
    await prisma.advance.update({
      where: { id: first.body.advance.id },
      data: { status: 'PAID_OFF', outstandingBalance: '0', currentScheduledPeriodId: null, paidOffAt: new Date() },
    });

    const afterPaidOff = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '8000',
      dateGiven: '2026-02-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2900, month: 3 },
    });
    expect(afterPaidOff.status).toBe(201);
  });

  // --- Automatic materialization at cycle bootstrap --------------------------------------------

  it('materializes a FULL_DEDUCTION advance automatically when its scheduled cycle is created, and reserves it — not yet Paid Off until the entry actually Releases', async () => {
    const admin = await masterAdminAgent('adv-full-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Full');
    const employee = await makeEmployee(site.id, unit.id, 'Full Dedn Employee', '40000');

    const created = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '12000',
      dateGiven: '2026-01-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2900, month: 5 },
    });
    expect(created.status).toBe(201);
    const advanceId = created.body.advance.id as string;

    const cycle = await makeDraftCycle(admin, 2900, 5);

    const entryRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries?employeeId=${employee.id}`);
    expect(entryRes.status).toBe(200);
    const entry = entryRes.body.entries[0];
    expect(entry.advanceId).toBe(advanceId);
    expect(Number(entry.advanceDeduction)).toBeCloseTo(12000, 2);

    // Presentation & Workflow Stabilization Checkpoint, 2026-07-25 (Issue 5): a Draft deduction
    // that zeroes the balance is only RESERVED, never PAID_OFF — the employee's payroll has not
    // actually been paid to anyone yet.
    const advanceAfter = await admin.agent.get(`/api/v1/advances/${advanceId}`);
    expect(Number(advanceAfter.body.advance.outstandingBalance)).toBeCloseTo(0, 2);
    expect(advanceAfter.body.advance.status).toBe('RESERVED');
    expect(advanceAfter.body.advance.paidOffAt).toBeNull();
    expect(advanceAfter.body.advance.currentScheduledPeriodId).toBeNull();

    const auditEntry = await prisma.auditLog.findFirst({
      where: { action: 'advance.schedule_materialized', entityId: advanceId },
    });
    expect(auditEntry).not.toBeNull();

    // Only once the entry carrying that reservation actually Releases does the Advance become
    // truly PAID_OFF (`settleAdvancesForReleasedEntries`, called from `releaseProjectUnit`).
    await releaseUnit(admin, cycle.id, unit.id);

    const advanceAfterRelease = await admin.agent.get(`/api/v1/advances/${advanceId}`);
    expect(advanceAfterRelease.body.advance.status).toBe('PAID_OFF');
    expect(advanceAfterRelease.body.advance.paidOffAt).not.toBeNull();
    expect(Number(advanceAfterRelease.body.advance.outstandingBalance)).toBeCloseTo(0, 2);

    const paidOffAudit = await prisma.auditLog.findFirst({
      where: { action: 'advance.paid_off', entityId: advanceId },
    });
    expect(paidOffAudit).not.toBeNull();
  });

  it('a RESERVED advance that is never released stays RESERVED — settlement only ever happens via an actual release', async () => {
    const admin = await masterAdminAgent('adv-reserved-unreleased-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Reserved Unreleased');
    const employee = await makeEmployee(site.id, unit.id, 'Reserved Unreleased Employee', '40000');

    const created = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '9000',
      dateGiven: '2026-01-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2900, month: 6 },
    });
    expect(created.status).toBe(201);
    const advanceId = created.body.advance.id as string;

    await makeDraftCycle(admin, 2900, 6);

    const advanceAfter = await admin.agent.get(`/api/v1/advances/${advanceId}`);
    expect(advanceAfter.body.advance.status).toBe('RESERVED');
    expect(advanceAfter.body.advance.paidOffAt).toBeNull();
    // Never released in this test — status must not have advanced on its own.
  });

  it('materializes only an installment amount for an INSTALLMENT advance with a standing schedule, and advances the pointer', async () => {
    const admin = await masterAdminAgent('adv-inst-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Installment');
    const employee = await makeEmployee(site.id, unit.id, 'Installment Employee', '40000');

    const created = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '12000',
      dateGiven: '2026-01-01',
      repaymentType: 'INSTALLMENT',
      scheduledInstallmentAmount: '5000',
      originalPeriod: { year: 2900, month: 6 },
    });
    expect(created.status).toBe(201);
    const advanceId = created.body.advance.id as string;

    const cycle = await makeDraftCycle(admin, 2900, 6);
    const entryRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries?employeeId=${employee.id}`);
    const entry = entryRes.body.entries[0];
    expect(entry.advanceId).toBe(advanceId);
    expect(Number(entry.advanceDeduction)).toBeCloseTo(5000, 2);

    const advanceAfter = (await admin.agent.get(`/api/v1/advances/${advanceId}`)).body.advance;
    expect(Number(advanceAfter.outstandingBalance)).toBeCloseTo(7000, 2);
    expect(advanceAfter.status).toBe('ACTIVE');
    expect(advanceAfter.currentScheduledPeriodId).not.toBeNull();
  });

  it('never auto-materializes an INSTALLMENT advance with no standing schedule set', async () => {
    const admin = await masterAdminAgent('adv-noschedule-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV NoSchedule');
    const employee = await makeEmployee(site.id, unit.id, 'No Schedule Employee', '40000');

    const created = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '12000',
      dateGiven: '2026-01-01',
      repaymentType: 'INSTALLMENT',
      originalPeriod: { year: 2900, month: 7 },
    });
    expect(created.status).toBe(201);

    const cycle = await makeDraftCycle(admin, 2900, 7);
    const entryRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries?employeeId=${employee.id}`);
    const entry = entryRes.body.entries[0];
    expect(entry.advanceId).toBeNull();
    expect(Number(entry.advanceDeduction)).toBe(0);
  });

  // --- Deferral ---------------------------------------------------------------------------------

  it('defers a materialized FULL_DEDUCTION deduction, reversing its RESERVED status back to ACTIVE', async () => {
    const admin = await masterAdminAgent('adv-defer-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Defer');
    const employee = await makeEmployee(site.id, unit.id, 'Defer Employee', '40000');

    const created = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '9000',
      dateGiven: '2026-01-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2900, month: 8 },
    });
    const advanceId = created.body.advance.id as string;

    const cycle = await makeDraftCycle(admin, 2900, 8);
    const entryRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries?employeeId=${employee.id}`);
    const entry = entryRes.body.entries[0];
    expect(entry.advanceId).toBe(advanceId);

    // FULL_DEDUCTION materialization already marked the advance RESERVED (2026-07-25: not PAID_OFF
    // — nothing is final until release) — deferral must still be able to undo this, since the
    // entry itself hasn't released yet.
    const reservedAdvance = (await admin.agent.get(`/api/v1/advances/${advanceId}`)).body.advance;
    expect(reservedAdvance.status).toBe('RESERVED');
    expect(Number(reservedAdvance.outstandingBalance)).toBeCloseTo(0, 2);

    const deferRes = await admin.agent
      .post(`/api/v1/advances/${advanceId}/defer`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ payrollEntryId: entry.id, toPeriod: { year: 2900, month: 10 }, reason: 'Employee had a difficult month' });
    expect(deferRes.status).toBe(200);
    expect(deferRes.body.advance.status).toBe('ACTIVE');
    expect(Number(deferRes.body.advance.outstandingBalance)).toBeCloseTo(9000, 2);

    const entryAfter = (
      await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries?employeeId=${employee.id}`)
    ).body.entries[0];
    expect(entryAfter.advanceId).toBeNull();
    expect(Number(entryAfter.advanceDeduction)).toBe(0);
    expect(entryAfter.version).toBe(entry.version + 1);

    const historyCount = await prisma.advanceScheduleChange.count({ where: { advanceId } });
    expect(historyCount).toBe(1);

    const deferredAudit = await prisma.auditLog.findFirst({ where: { action: 'advance.deferred', entityId: advanceId } });
    expect(deferredAudit).not.toBeNull();
    const entryAudit = await prisma.auditLog.findFirst({
      where: { action: 'payroll_entry.advance_deferred', entityId: entry.id },
    });
    expect(entryAudit).not.toBeNull();
  });

  /**
   * Final Verification, RESERVED-lifecycle Case 4 — "RESERVED → Defer → Deduction moves correctly.
   * No duplicate deduction. No stale deduction." The test above proves the *source* cycle's copy is
   * cleared; this is the distinct, previously-unverified other half — that the deferred deduction
   * actually *arrives* at the target period once that cycle is later created, and arrives exactly
   * once (not duplicated), with the source cycle staying cleared throughout (not stale).
   */
  it('a deferred deduction actually materializes in the target period once that cycle is created, exactly once — Case 4', async () => {
    const admin = await masterAdminAgent('adv-defer-arrives-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Defer Arrives');
    const employee = await makeEmployee(site.id, unit.id, 'Defer Arrives Employee', '40000');

    // Holds an entry (so it satisfies the finalization precondition while unreleased, same pattern
    // as `'permits deferring a held, unreleased entry's...'` above) and finalizes+rolls its cycle
    // over to the immediately-following calendar month — this app's cycles are calendar-month-only
    // (docs/architecture/database/schema-invariants.md §26 item 5), so reaching a target two months
    // out requires two rollovers, never a direct jump.
    async function holdFinalizeAndRollover(cycleId: string, employeeId: string) {
      const entry = (
        await admin.agent.get(`/api/v1/payroll-cycles/${cycleId}/entries?employeeId=${employeeId}`)
      ).body.entries[0];
      const holdRes = await admin.agent
        .patch(`/api/v1/payroll-entries/${entry.id}`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ version: entry.version, hold: true });
      expect(holdRes.status).toBe(200);
      const finalizeRes = await admin.agent
        .post(`/api/v1/payroll-cycles/${cycleId}/finalize`)
        .set('x-csrf-token', admin.csrfToken)
        .send({});
      expect(finalizeRes.status).toBe(200);
      const rolloverRes = await admin.agent
        .post(`/api/v1/payroll-cycles/${cycleId}/archive-and-create-next`)
        .set('x-csrf-token', admin.csrfToken)
        .send({});
      expect(rolloverRes.status).toBe(201);
      return rolloverRes.body.newCycle as { id: string; year: number; month: number };
    }

    const created = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '7000',
      dateGiven: '2026-01-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2905, month: 3 },
    });
    const advanceId = created.body.advance.id as string;

    const sourceCycle = await makeDraftCycle(admin, 2905, 3);
    const sourceEntry = (
      await admin.agent.get(`/api/v1/payroll-cycles/${sourceCycle.id}/entries?employeeId=${employee.id}`)
    ).body.entries[0];
    expect(sourceEntry.advanceId).toBe(advanceId); // RESERVED — fully deducted in the source cycle

    const deferRes = await admin.agent
      .post(`/api/v1/advances/${advanceId}/defer`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ payrollEntryId: sourceEntry.id, toPeriod: { year: 2905, month: 5 }, reason: 'Push to a later month' });
    expect(deferRes.status).toBe(200);
    expect(deferRes.body.advance.status).toBe('ACTIVE');
    expect(deferRes.body.advance.currentScheduledPeriodId).not.toBeNull();

    // Source cycle stays cleared — never stale.
    const sourceEntryAfterDefer = (
      await admin.agent.get(`/api/v1/payroll-cycles/${sourceCycle.id}/entries?employeeId=${employee.id}`)
    ).body.entries[0];
    expect(sourceEntryAfterDefer.advanceId).toBeNull();
    expect(Number(sourceEntryAfterDefer.advanceDeduction)).toBe(0);

    // Roll month 3 -> month 4. An intervening cycle the deferred target does NOT name must not pick
    // it up either — proves the deduction lands only at its actual named target, never an
    // intermediate stale copy.
    const month4Cycle = await holdFinalizeAndRollover(sourceCycle.id, employee.id);
    expect(month4Cycle.month).toBe(4);
    const interveningEntry = (
      await admin.agent.get(`/api/v1/payroll-cycles/${month4Cycle.id}/entries?employeeId=${employee.id}`)
    ).body.entries[0];
    expect(interveningEntry.advanceId).toBeNull();

    // Roll month 4 -> month 5 — the target period finally arrives. The deferred deduction
    // materializes there, exactly once, for the full remaining balance (7000, untouched since the
    // source cycle never actually released it).
    const targetCycle = await holdFinalizeAndRollover(month4Cycle.id, employee.id);
    expect(targetCycle.month).toBe(5);
    const targetEntry = (
      await admin.agent.get(`/api/v1/payroll-cycles/${targetCycle.id}/entries?employeeId=${employee.id}`)
    ).body.entries[0];
    expect(targetEntry.advanceId).toBe(advanceId);
    expect(Number(targetEntry.advanceDeduction)).toBeCloseTo(7000, 2);

    const advanceAfterArrival = (await admin.agent.get(`/api/v1/advances/${advanceId}`)).body.advance;
    expect(advanceAfterArrival.status).toBe('RESERVED'); // fully deducted again, now in the target cycle
    expect(Number(advanceAfterArrival.outstandingBalance)).toBeCloseTo(0, 2);

    // Exactly two materializations total for this Advance's whole life — the original (source) and
    // this one (target) — never a duplicate landing in both, or a third phantom one.
    const materializationCount = await prisma.auditLog.count({
      where: { action: 'advance.schedule_materialized', entityId: advanceId },
    });
    expect(materializationCount).toBe(2);
  });

  it('rejects deferring to a past or current period', async () => {
    const admin = await masterAdminAgent('adv-defer-past-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Defer Past');
    const employee = await makeEmployee(site.id, unit.id, 'Defer Past Employee', '40000');

    const created = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '9000',
      dateGiven: '2026-01-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2900, month: 9 },
    });
    const advanceId = created.body.advance.id as string;
    const cycle = await makeDraftCycle(admin, 2900, 9);
    const entry = (
      await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries?employeeId=${employee.id}`)
    ).body.entries[0];

    const res = await admin.agent
      .post(`/api/v1/advances/${advanceId}/defer`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ payrollEntryId: entry.id, toPeriod: { year: 2900, month: 9 }, reason: 'Same period' });
    expect(res.status).toBe(400);
  });

  it('rejects a blank deferral reason', async () => {
    const admin = await masterAdminAgent('adv-defer-blank-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Defer Blank');
    const employee = await makeEmployee(site.id, unit.id, 'Defer Blank Employee', '40000');

    const created = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '9000',
      dateGiven: '2026-01-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2900, month: 11 },
    });
    const advanceId = created.body.advance.id as string;
    const cycle = await makeDraftCycle(admin, 2900, 11);
    const entry = (
      await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries?employeeId=${employee.id}`)
    ).body.entries[0];

    const res = await admin.agent
      .post(`/api/v1/advances/${advanceId}/defer`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ payrollEntryId: entry.id, toPeriod: { year: 2900, month: 12 }, reason: '   ' });
    expect(res.status).toBe(400);
  });

  it('rejects deferring a released entry — historical integrity', async () => {
    const admin = await masterAdminAgent('adv-defer-released-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Defer Released');
    const employee = await makeEmployee(site.id, unit.id, 'Defer Released Employee', '40000');

    const created = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '9000',
      dateGiven: '2026-01-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2901, month: 1 },
    });
    const advanceId = created.body.advance.id as string;
    const cycle = await makeDraftCycle(admin, 2901, 1);
    const entry = (
      await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries?employeeId=${employee.id}`)
    ).body.entries[0];
    expect(entry.advanceId).toBe(advanceId);

    await releaseUnit(admin, cycle.id, unit.id);

    const res = await admin.agent
      .post(`/api/v1/advances/${advanceId}/defer`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ payrollEntryId: entry.id, toPeriod: { year: 2901, month: 3 }, reason: 'Too late' });
    expect(res.status).toBe(400);

    // The released entry's deduction/linkage must remain exactly as it was — never rewritten.
    const entryAfter = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(entryAfter.advanceId).toBe(advanceId);
    expect(Number(entryAfter.advanceDeduction)).toBeCloseTo(9000, 2);
  });

  it('permits deferring a held, unreleased entry\'s Advance deduction even after its own cycle has finalized — the entry itself stays editable (Phase 5 Checkpoint 1 final review)', async () => {
    const admin = await masterAdminAgent('adv-defer-held-finalized-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Defer Held Finalized');
    const employee = await makeEmployee(site.id, unit.id, 'Defer Held Finalized Employee', '40000');

    const created = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '9000',
      dateGiven: '2026-01-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2902, month: 1 },
    });
    const advanceId = created.body.advance.id as string;
    const cycle = await makeDraftCycle(admin, 2902, 1);
    const entry = (
      await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries?employeeId=${employee.id}`)
    ).body.entries[0];
    expect(entry.advanceId).toBe(advanceId);

    // Hold the entry (so it satisfies the finalization precondition unreleased), then finalize the
    // whole cycle — the entry stays released = false, hold = true throughout.
    const holdRes = await admin.agent
      .patch(`/api/v1/payroll-entries/${entry.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, hold: true });
    expect(holdRes.status).toBe(200);

    const finalizeRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/finalize`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(finalizeRes.status).toBe(200);
    expect(finalizeRes.body.cycle.status).toBe('RELEASED');

    // The entry's own cycle is now RELEASED, but the entry itself never released — per the
    // corrected editability rule, it remains ordinarily editable, so its permitted Advance schedule
    // change (deferral) must still be reachable, exactly as before finalization. This is not a new
    // Advance workflow — deferAdvanceSchedule's own logic is unchanged; only assertEntryEditable's
    // cycle-status clause (removed, Checkpoint 1) previously would have wrongly blocked this.
    const deferRes = await admin.agent
      .post(`/api/v1/advances/${advanceId}/defer`)
      .set('x-csrf-token', admin.csrfToken)
      .send({
        payrollEntryId: entry.id,
        toPeriod: { year: 2902, month: 3 },
        reason: 'Deferred after cycle finalization — entry stayed held, not released',
      });
    expect(deferRes.status).toBe(200);
    expect(deferRes.body.advance.status).toBe('ACTIVE');

    const entryAfter = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(entryAfter.advanceId).toBeNull();
    expect(Number(entryAfter.advanceDeduction)).toBe(0);
    expect(entryAfter.hold).toBe(true);
    expect(entryAfter.released).toBe(false);
  });

  // --- Historical integrity: editing an Advance never touches released payroll -------------------

  it('never modifies a released PayrollEntry when the Advance is edited afterward', async () => {
    const admin = await masterAdminAgent('adv-snapshot-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Snapshot');
    const employee = await makeEmployee(site.id, unit.id, 'Snapshot Advance Employee', '40000');

    const created = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '6000',
      dateGiven: '2026-01-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2901, month: 2 },
    });
    const advanceId = created.body.advance.id as string;
    const cycle = await makeDraftCycle(admin, 2901, 2);
    const entry = (
      await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries?employeeId=${employee.id}`)
    ).body.entries[0];
    expect(Number(entry.advanceDeduction)).toBeCloseTo(6000, 2);

    await releaseUnit(admin, cycle.id, unit.id);

    // Edit the Advance's notes after release.
    const updateRes = await admin.agent
      .patch(`/api/v1/advances/${advanceId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ notes: 'Updated after release' });
    expect(updateRes.status).toBe(200);

    const entryAfter = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(Number(entryAfter.advanceDeduction)).toBeCloseTo(6000, 2);
    expect(entryAfter.advanceId).toBe(advanceId);
    expect(entryAfter.released).toBe(true);
  });

  // --- Update -------------------------------------------------------------------------------------

  it('updates dateGiven/notes and audits the change — repaymentType/scheduledInstallmentAmount are fixed at creation and no longer accepted by Edit (v1.0.2)', async () => {
    const admin = await masterAdminAgent('adv-update-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Update');
    const employee = await makeEmployee(site.id, unit.id, 'Update Employee');

    const created = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '9000',
      dateGiven: '2026-01-01',
      repaymentType: 'INSTALLMENT',
      scheduledInstallmentAmount: '2500',
      originalPeriod: { year: 2900, month: 1 },
    });
    const advanceId = created.body.advance.id as string;

    const res = await admin.agent
      .patch(`/api/v1/advances/${advanceId}`)
      .set('x-csrf-token', admin.csrfToken)
      // repaymentType/scheduledInstallmentAmount are sent alongside dateGiven/notes on purpose —
      // the schema silently strips them (they're no longer part of `updateAdvanceSchema`), proving
      // they can never be changed through this endpoint any more, not just that the UI stopped
      // offering them.
      .send({ dateGiven: '2026-01-15', notes: 'Corrected the date entered at creation', scheduledInstallmentAmount: '3000' });
    expect(res.status).toBe(200);
    expect(res.body.advance.dateGiven.slice(0, 10)).toBe('2026-01-15');
    expect(res.body.advance.notes).toBe('Corrected the date entered at creation');
    expect(Number(res.body.advance.scheduledInstallmentAmount)).toBeCloseTo(2500, 2); // unchanged

    const auditEntry = await prisma.auditLog.findFirst({ where: { action: 'advance.updated', entityId: advanceId } });
    expect(auditEntry).not.toBeNull();
    const changes = (auditEntry?.metadata as { changes: Record<string, unknown> }).changes;
    expect(Object.keys(changes)).toEqual(expect.arrayContaining(['dateGiven', 'notes']));
    expect(changes.scheduledInstallmentAmount).toBeUndefined();
  });

  it('allows editing dateGiven at any lifecycle stage, including once CANCELLED — never requires Cancel-and-recreate merely to fix a mistyped date', async () => {
    const admin = await masterAdminAgent('adv-update-date-cancelled-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Update Date Cancelled');
    const employee = await makeEmployee(site.id, unit.id, 'Update Date Cancelled Employee');

    const created = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '9000',
      dateGiven: '2026-01-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2900, month: 1 },
    });
    const advanceId = created.body.advance.id as string;

    const cancelRes = await admin.agent
      .post(`/api/v1/advances/${advanceId}/cancel`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ reason: 'Wrong employee — voiding' });
    expect(cancelRes.status).toBe(200);

    const dateEditRes = await admin.agent
      .patch(`/api/v1/advances/${advanceId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ dateGiven: '2026-02-10' });
    expect(dateEditRes.status).toBe(200);
    expect(dateEditRes.body.advance.dateGiven.slice(0, 10)).toBe('2026-02-10');
    expect(dateEditRes.body.advance.status).toBe('CANCELLED'); // date-only edit never touches status

    // A financial edit is still correctly rejected once CANCELLED — dateGiven's free editability is
    // not a loophole that reopens the amount too.
    const amountEditRes = await admin.agent
      .patch(`/api/v1/advances/${advanceId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ totalAmount: '5000' });
    expect(amountEditRes.status).toBe(400);
  });

  // --- Operational Stabilization Checkpoint (2026-07-24) — Defect D/E: immediate materialization
  // into an ALREADY-OPEN Draft cycle, and the earliest-eligible-period floor. ------------------------

  it('materializes an Advance immediately when the current Draft cycle already exists at creation time (root-cause fix)', async () => {
    const admin = await masterAdminAgent('adv-immediate-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Immediate');
    const employee = await makeEmployee(site.id, unit.id, 'Immediate Employee', '40000');

    // The Draft cycle already exists BEFORE the Advance is recorded — the exact production scenario
    // (`materializeScheduledAdvanceDeductions` only runs at cycle bootstrap, which already happened).
    const cycle = await makeDraftCycle(admin, 2903, 1);

    const created = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '9000',
      dateGiven: '2026-01-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2903, month: 1 },
    });
    expect(created.status).toBe(201);
    const advanceId = created.body.advance.id as string;
    // No separate materialization call, no cycle recreation, no refetch delay — the create response
    // itself already reflects the materialized state.
    expect(Number(created.body.advance.outstandingBalance)).toBeCloseTo(0, 2);
    // RESERVED, not PAID_OFF (2026-07-25, Issue 5) — this Draft entry has not released yet.
    expect(created.body.advance.status).toBe('RESERVED');

    const entry = (
      await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries?employeeId=${employee.id}`)
    ).body.entries[0];
    expect(entry.advanceId).toBe(advanceId);
    expect(Number(entry.advanceDeduction)).toBeCloseTo(9000, 2);

    const auditEntry = await prisma.auditLog.findFirst({
      where: { action: 'advance.schedule_materialized', entityId: advanceId },
    });
    expect(auditEntry).not.toBeNull();
  });

  it('does NOT materialize an Advance scheduled for a future period even when a Draft cycle already exists for an earlier period', async () => {
    const admin = await masterAdminAgent('adv-future-noimmediate-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Future NoImmediate');
    const employee = await makeEmployee(site.id, unit.id, 'Future NoImmediate Employee', '40000');

    await makeDraftCycle(admin, 2903, 2);

    const created = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '9000',
      dateGiven: '2026-01-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2903, month: 3 },
    });
    expect(created.status).toBe(201);
    expect(created.body.advance.status).toBe('ACTIVE');
    expect(Number(created.body.advance.outstandingBalance)).toBeCloseTo(9000, 2);
  });

  it('rejects an Advance whose deduction start cycle is earlier than the current Draft cycle', async () => {
    const admin = await masterAdminAgent('adv-floor-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Floor');
    const employee = await makeEmployee(site.id, unit.id, 'Floor Employee', '40000');

    await makeDraftCycle(admin, 2903, 6);

    const res = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '9000',
      dateGiven: '2026-01-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2903, month: 5 },
    });
    expect(res.status).toBe(400);
  });

  it('rejects a past deduction start cycle when no Draft cycle currently exists', async () => {
    const admin = await masterAdminAgent('adv-floor-nocycle-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Floor No Cycle');
    const employee = await makeEmployee(site.id, unit.id, 'Floor No Cycle Employee', '40000');

    const res = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '9000',
      dateGiven: '2026-01-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2020, month: 1 },
    });
    expect(res.status).toBe(400);
  });

  it('does not materialize into an already individually-released entry within a nominally Draft cycle', async () => {
    const admin = await masterAdminAgent('adv-released-immediate-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Released Immediate');
    const employee = await makeEmployee(site.id, unit.id, 'Released Immediate Employee', '40000');

    const cycle = await makeDraftCycle(admin, 2903, 7);
    await releaseUnit(admin, cycle.id, unit.id);

    const created = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '9000',
      dateGiven: '2026-01-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2903, month: 7 },
    });
    expect(created.status).toBe(201);
    // Not materialized — the entry it would have targeted is already released, so it stays
    // untouched (Principle 9); the Advance itself still exists, unmaterialized, for manual
    // attention rather than either erroring out or silently rewriting released payroll.
    expect(created.body.advance.status).toBe('ACTIVE');
    expect(Number(created.body.advance.outstandingBalance)).toBeCloseTo(9000, 2);

    const entryAfter = await prisma.payrollEntry.findFirst({ where: { cycleId: cycle.id, employeeId: employee.id } });
    expect(entryAfter?.advanceId).toBeNull();
    expect(Number(entryAfter?.advanceDeduction)).toBe(0);
  });

  // --- Lifecycle-aware Edit (Section F) --------------------------------------------------------

  it('allows editing totalAmount on an untouched ACTIVE Advance, adjusting outstandingBalance in lockstep', async () => {
    const admin = await masterAdminAgent('adv-edit-total-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Edit Total');
    const employee = await makeEmployee(site.id, unit.id, 'Edit Total Employee');

    const created = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '9000',
      dateGiven: '2026-01-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2900, month: 1 },
    });
    const advanceId = created.body.advance.id as string;

    const res = await admin.agent
      .patch(`/api/v1/advances/${advanceId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ totalAmount: '12000' });
    expect(res.status).toBe(200);
    expect(Number(res.body.advance.totalAmount)).toBeCloseTo(12000, 2);
    expect(Number(res.body.advance.outstandingBalance)).toBeCloseTo(12000, 2);
  });

  it('rejects reducing totalAmount below what has been RELEASED — a still-Draft (unreleased) deduction is not a floor', async () => {
    const admin = await masterAdminAgent('adv-edit-total-floor-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Edit Total Floor');
    const employee = await makeEmployee(site.id, unit.id, 'Edit Total Floor Employee', '40000');

    const created = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '9000',
      dateGiven: '2026-01-01',
      repaymentType: 'INSTALLMENT',
      scheduledInstallmentAmount: '4000',
      originalPeriod: { year: 2903, month: 8 },
    });
    const advanceId = created.body.advance.id as string;
    const cycle = await makeDraftCycle(admin, 2903, 8); // materializes 4000 immediately (Defect D/E fix)

    const advanceAfter = (await admin.agent.get(`/api/v1/advances/${advanceId}`)).body.advance;
    expect(Number(advanceAfter.outstandingBalance)).toBeCloseTo(5000, 2); // 9000 - 4000

    // Now release the unit — the live 4000 deduction becomes permanent/released. (The separate
    // "while still Draft/unreleased, that same 4000 is NOT a floor" behavior is covered by its own
    // dedicated test below, which also verifies the live recalculation itself — kept as two focused
    // tests rather than one that both edits a live figure and then re-edits after release.)
    await releaseUnit(admin, cycle.id, unit.id);

    const tooLow = await admin.agent
      .patch(`/api/v1/advances/${advanceId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ totalAmount: '3000' }); // below the 4000 now-released amount
    expect(tooLow.status).toBe(400);

    const ok = await admin.agent
      .patch(`/api/v1/advances/${advanceId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ totalAmount: '10000' });
    expect(ok.status).toBe(200);
    expect(Number(ok.body.advance.outstandingBalance)).toBeCloseTo(6000, 2); // 10000 - 4000 released

    // The released entry itself is never touched by this edit.
    const releasedEntry = await prisma.payrollEntry.findFirst({ where: { cycleId: cycle.id, employeeId: employee.id } });
    expect(releasedEntry?.released).toBe(true);
    expect(Number(releasedEntry?.advanceDeduction)).toBeCloseTo(4000, 2);
  });

  it('editing totalAmount (v1.0.2: the only remaining live-recalc trigger) on an ACTIVE Advance already materialized into the current Draft recalculates the Draft deduction correctly and exactly once, while a prior Released deduction stays untouched', async () => {
    const admin = await masterAdminAgent('adv-edit-live-recalc-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Edit Live Recalc');
    const employee = await makeEmployee(site.id, unit.id, 'Edit Live Recalc Employee', '40000');

    const created = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '12000',
      dateGiven: '2026-01-01',
      repaymentType: 'INSTALLMENT',
      scheduledInstallmentAmount: '4000',
      originalPeriod: { year: 2903, month: 12 },
    });
    const advanceId = created.body.advance.id as string;

    // Cycle 1 — materializes 4000 immediately (Defect D/E fix), then release it (permanent history).
    const cycle1 = await makeDraftCycle(admin, 2903, 12);
    const cycle1EntryPreRelease = (
      await admin.agent.get(`/api/v1/payroll-cycles/${cycle1.id}/entries?employeeId=${employee.id}`)
    ).body.entries[0];
    expect(Number(cycle1EntryPreRelease.advanceDeduction)).toBeCloseTo(4000, 2);
    await releaseUnit(admin, cycle1.id, unit.id);

    // Captured AFTER release (which itself writes the entry, bumping its version) — this is the
    // "already released, now immutable" snapshot the edit below must never change.
    const cycle1EntryBefore = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: cycle1EntryPreRelease.id } });

    const finalize1 = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle1.id}/finalize`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(finalize1.status).toBe(200);

    // Cycle 2 — rollover materializes the next installment (4000) automatically, still Draft/unreleased.
    const cycle2Res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle1.id}/archive-and-create-next`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(cycle2Res.status).toBe(201);
    const cycle2 = cycle2Res.body.newCycle as { id: string };

    const cycle2EntryBefore = (
      await admin.agent.get(`/api/v1/payroll-cycles/${cycle2.id}/entries?employeeId=${employee.id}`)
    ).body.entries[0];
    expect(Number(cycle2EntryBefore.advanceDeduction)).toBeCloseTo(4000, 2);
    expect(cycle2EntryBefore.advanceId).toBe(advanceId);

    const materializationCountBefore = await prisma.auditLog.count({
      where: { action: 'advance.schedule_materialized', entityId: advanceId },
    });

    // Edit totalAmount (12000 -> 6000) while Cycle 2's 4000 deduction is still live (unreleased).
    // scheduledInstallmentAmount stays fixed at 4000 (no longer editable, v1.0.2) — the new,
    // lower total still forces a genuinely different recalculated deduction because the standing
    // 4000 installment now exceeds what remains outstanding once the 4000 already-released amount
    // is excluded (6000 - 4000 released = 2000 left, capped below the 4000 installment).
    const editRes = await admin.agent
      .patch(`/api/v1/advances/${advanceId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ totalAmount: '6000' });
    expect(editRes.status).toBe(200);

    // Cycle 2's Draft deduction recalculates to the new amount — exactly once, not additive/doubled.
    const cycle2EntryAfter = (
      await admin.agent.get(`/api/v1/payroll-cycles/${cycle2.id}/entries?employeeId=${employee.id}`)
    ).body.entries[0];
    expect(Number(cycle2EntryAfter.advanceDeduction)).toBeCloseTo(2000, 2);
    expect(cycle2EntryAfter.advanceId).toBe(advanceId);
    expect(cycle2EntryAfter.version).toBe(cycle2EntryBefore.version + 2); // one reversal + one re-materialization

    const advanceAfter = (await admin.agent.get(`/api/v1/advances/${advanceId}`)).body.advance;
    // 6000 total - 4000 released (cycle 1) - 2000 newly recalculated (cycle 2) = 0 — fully reserved.
    expect(Number(advanceAfter.outstandingBalance)).toBeCloseTo(0, 2);
    expect(advanceAfter.status).toBe('RESERVED');

    // Exactly one new materialization audit entry was recorded for this recalculation.
    const materializationCountAfter = await prisma.auditLog.count({
      where: { action: 'advance.schedule_materialized', entityId: advanceId },
    });
    expect(materializationCountAfter).toBe(materializationCountBefore + 1);

    const reversalAudit = await prisma.auditLog.findFirst({
      where: { action: 'payroll_entry.advance_edit_reversed', entityId: cycle2EntryBefore.id },
    });
    expect(reversalAudit).not.toBeNull();

    // Cycle 1's RELEASED entry is completely untouched by this edit.
    const cycle1EntryAfter = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: cycle1EntryBefore.id } });
    expect(cycle1EntryAfter.released).toBe(true);
    expect(Number(cycle1EntryAfter.advanceDeduction)).toBeCloseTo(4000, 2);
    expect(cycle1EntryAfter.advanceId).toBe(advanceId);
    expect(cycle1EntryAfter.version).toBe(cycle1EntryBefore.version);
  });

  /**
   * Final Verification, RESERVED-lifecycle Case 1 — "Record Advance → Draft deduction created →
   * Edit Total Amount → Draft Payroll Entry recalculates correctly. No duplicate deductions. No
   * stale values." Distinct from the test above (which edits `scheduledInstallmentAmount`) and from
   * `'allows editing totalAmount on an untouched ACTIVE Advance...'` (which has no live Draft
   * deduction to recalculate at all) — this is the one test that edits `totalAmount` specifically
   * while a real, unreleased Draft deduction already exists, and checks the entry itself, not just
   * the Advance record's own balance bookkeeping.
   */
  it('editing totalAmount while a live Draft deduction exists recalculates the Draft entry correctly, exactly once — Case 1', async () => {
    const admin = await masterAdminAgent('adv-edit-total-live-recalc-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Edit Total Live Recalc');
    const employee = await makeEmployee(site.id, unit.id, 'Edit Total Live Recalc Employee', '40000');

    const created = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '10000',
      dateGiven: '2026-01-01',
      repaymentType: 'INSTALLMENT',
      scheduledInstallmentAmount: '3000',
      originalPeriod: { year: 2904, month: 1 },
    });
    const advanceId = created.body.advance.id as string;

    // Draft deduction created — an INSTALLMENT advance materializes only the standing installment
    // (3000), leaving the Advance ACTIVE (not RESERVED) with balance still outstanding, so it stays
    // editable — the precondition Case 1 describes ("Draft deduction created", not yet fully reserved).
    const cycle = await makeDraftCycle(admin, 2904, 1);
    const entryBefore = (
      await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries?employeeId=${employee.id}`)
    ).body.entries[0];
    expect(Number(entryBefore.advanceDeduction)).toBeCloseTo(3000, 2);
    expect(entryBefore.advanceId).toBe(advanceId);

    const advanceBeforeEdit = (await admin.agent.get(`/api/v1/advances/${advanceId}`)).body.advance;
    expect(advanceBeforeEdit.status).toBe('ACTIVE');
    expect(Number(advanceBeforeEdit.outstandingBalance)).toBeCloseTo(7000, 2); // 10000 - 3000

    const materializationCountBefore = await prisma.auditLog.count({
      where: { action: 'advance.schedule_materialized', entityId: advanceId },
    });

    // Edit Total Amount (not the installment schedule) while the Draft deduction is still live.
    const editRes = await admin.agent
      .patch(`/api/v1/advances/${advanceId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ totalAmount: '8000' });
    expect(editRes.status).toBe(200);

    // The Draft Payroll Entry recalculates: the same 3000 installment re-applies against the new
    // 8000 total (8000 - 0 already-repaid = 8000 outstanding pre-reapply), landing on the correct
    // new outstandingBalance — never a duplicated or stale deduction left over from before the edit.
    const entryAfter = (
      await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries?employeeId=${employee.id}`)
    ).body.entries[0];
    expect(Number(entryAfter.advanceDeduction)).toBeCloseTo(3000, 2); // no duplicate — still one installment's worth
    expect(entryAfter.advanceId).toBe(advanceId);
    expect(entryAfter.version).toBe(entryBefore.version + 2); // exactly one reversal + one re-materialization — no extra, no stale

    const advanceAfterEdit = (await admin.agent.get(`/api/v1/advances/${advanceId}`)).body.advance;
    expect(Number(advanceAfterEdit.totalAmount)).toBeCloseTo(8000, 2);
    expect(Number(advanceAfterEdit.outstandingBalance)).toBeCloseTo(5000, 2); // 8000 - 3000, not stale at the old 7000
    expect(advanceAfterEdit.status).toBe('ACTIVE');

    // Exactly one new materialization — never a duplicate.
    const materializationCountAfter = await prisma.auditLog.count({
      where: { action: 'advance.schedule_materialized', entityId: advanceId },
    });
    expect(materializationCountAfter).toBe(materializationCountBefore + 1);
  });

  it('a no-op edit (notes only) does not reverse or re-version an already-correct live Draft deduction', async () => {
    const admin = await masterAdminAgent('adv-edit-noop-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Edit NoOp');
    const employee = await makeEmployee(site.id, unit.id, 'Edit NoOp Employee', '40000');

    const created = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '9000',
      dateGiven: '2026-01-01',
      repaymentType: 'INSTALLMENT',
      scheduledInstallmentAmount: '4000',
      originalPeriod: { year: 2903, month: 9 },
    });
    const advanceId = created.body.advance.id as string;
    const cycle = await makeDraftCycle(admin, 2903, 9);
    const entryBefore = (
      await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries?employeeId=${employee.id}`)
    ).body.entries[0];

    const res = await admin.agent
      .patch(`/api/v1/advances/${advanceId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ totalAmount: '9000', dateGiven: '2026-01-01', notes: 'just a note' });
    expect(res.status).toBe(200);

    const entryAfter = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entryBefore.id } });
    expect(entryAfter.version).toBe(entryBefore.version); // untouched — no reversal/re-materialization
    expect(Number(entryAfter.advanceDeduction)).toBeCloseTo(4000, 2);
  });

  /**
   * v1.0.2 Advance Edit/Cancel checkpoint (2026-08-25) — supersedes this test's own prior
   * assertion. RESERVED financial edits are now deliberately *allowed* (Phase D of that
   * checkpoint's own brief): a fully-materialized-but-unreleased Advance still has a live,
   * reversible Draft deduction, and Finance needs to correct a mis-entered amount without having
   * to Cancel and re-record it. Full end-to-end coverage of this new path (exact atomic
   * Advance/Draft-deduction synchronization, the floor/negative/zero rejections, the legacy-
   * mismatch defensive guard, concurrency) lives in `advance-payroll-entry-integrity.test.ts`; this
   * test now only re-confirms notes remain editable alongside a financial edit at this status.
   */
  it('allows a financial-field edit while an Advance is RESERVED, and notes remain editable too', async () => {
    const admin = await masterAdminAgent('adv-edit-paidoff-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Edit PaidOff');
    const employee = await makeEmployee(site.id, unit.id, 'Edit PaidOff Employee', '40000');

    const created = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '9000',
      dateGiven: '2026-01-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2903, month: 9 },
    });
    const advanceId = created.body.advance.id as string;
    await makeDraftCycle(admin, 2903, 9); // fully materializes and reserves immediately (2026-07-25)

    const allowed = await admin.agent
      .patch(`/api/v1/advances/${advanceId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ totalAmount: '15000' });
    expect(allowed.status).toBe(200);
    expect(allowed.body.advance.status).toBe('RESERVED');
    expect(Number(allowed.body.advance.totalAmount)).toBeCloseTo(15000, 2);
    expect(Number(allowed.body.advance.outstandingBalance)).toBe(0); // still fully reserved

    const notesOk = await admin.agent
      .patch(`/api/v1/advances/${advanceId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ notes: 'closed out' });
    expect(notesOk.status).toBe(200);
    expect(notesOk.body.advance.notes).toBe('closed out');
  });

  /**
   * Final Verification, RESERVED-lifecycle Case 3 — "RESERVED → Payroll Release → PAID_OFF →
   * Editing correctly blocked. No further lifecycle regression." The test above now proves editing
   * is *allowed* while still `RESERVED` (pre-release, v1.0.2 checkpoint); this is the distinct case
   * of editing an Advance that has gone all the way through an actual Release and is genuinely
   * `PAID_OFF` — proving the guard (`advance.status !== 'ACTIVE' && !== 'RESERVED'`) still holds
   * once release has actually settled it, the one lifecycle stage editing must never reach.
   */
  it('rejects any financial-field edit once an Advance is genuinely PAID_OFF via release, but still allows notes — Case 3', async () => {
    const admin = await masterAdminAgent('adv-edit-real-paidoff-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Edit Real PaidOff');
    const employee = await makeEmployee(site.id, unit.id, 'Edit Real PaidOff Employee', '40000');

    const created = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '9000',
      dateGiven: '2026-01-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2904, month: 2 },
    });
    const advanceId = created.body.advance.id as string;
    const cycle = await makeDraftCycle(admin, 2904, 2); // materializes and reserves immediately

    const reserved = (await admin.agent.get(`/api/v1/advances/${advanceId}`)).body.advance;
    expect(reserved.status).toBe('RESERVED');

    await releaseUnit(admin, cycle.id, unit.id);

    const paidOff = (await admin.agent.get(`/api/v1/advances/${advanceId}`)).body.advance;
    expect(paidOff.status).toBe('PAID_OFF');
    expect(paidOff.paidOffAt).not.toBeNull();

    const rejected = await admin.agent
      .patch(`/api/v1/advances/${advanceId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ totalAmount: '15000' });
    expect(rejected.status).toBe(400);

    // No lifecycle regression — the rejected edit above must not have moved status backwards.
    const stillPaidOff = (await admin.agent.get(`/api/v1/advances/${advanceId}`)).body.advance;
    expect(stillPaidOff.status).toBe('PAID_OFF');
    expect(Number(stillPaidOff.totalAmount)).toBeCloseTo(9000, 2);

    const notesOk = await admin.agent
      .patch(`/api/v1/advances/${advanceId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ notes: 'fully settled' });
    expect(notesOk.status).toBe(200);
    expect(notesOk.body.advance.notes).toBe('fully settled');
    expect(notesOk.body.advance.status).toBe('PAID_OFF'); // notes-only edit never touches status
  });

  // --- Cancel/Void (Section G) ------------------------------------------------------------------

  it('cancels an untouched Advance and immediately allows a fresh one of the same type', async () => {
    const admin = await masterAdminAgent('adv-cancel-untouched-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Cancel Untouched');
    const employee = await makeEmployee(site.id, unit.id, 'Cancel Untouched Employee');

    const created = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '9000',
      dateGiven: '2026-01-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2900, month: 1 },
    });
    const advanceId = created.body.advance.id as string;

    const blockedSecond = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '5000',
      dateGiven: '2026-01-02',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2900, month: 2 },
    });
    expect(blockedSecond.status).toBe(409);

    const cancelRes = await admin.agent
      .post(`/api/v1/advances/${advanceId}/cancel`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ reason: 'Entered against the wrong employee' });
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.advance.status).toBe('CANCELLED');
    expect(cancelRes.body.advance.currentScheduledPeriodId).toBeNull();

    const freshOne = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '5000',
      dateGiven: '2026-01-02',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2900, month: 2 },
    });
    expect(freshOne.status).toBe(201);

    const auditEntry = await prisma.auditLog.findFirst({ where: { action: 'advance.cancelled', entityId: advanceId } });
    expect(auditEntry).not.toBeNull();
  });

  it('cancelling an Advance with a live Draft deduction reverses it and restores the outstanding balance', async () => {
    const admin = await masterAdminAgent('adv-cancel-live-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Cancel Live');
    const employee = await makeEmployee(site.id, unit.id, 'Cancel Live Employee', '40000');

    const created = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '9000',
      dateGiven: '2026-01-01',
      repaymentType: 'INSTALLMENT',
      scheduledInstallmentAmount: '3500',
      originalPeriod: { year: 2903, month: 10 },
    });
    const advanceId = created.body.advance.id as string;
    const cycle = await makeDraftCycle(admin, 2903, 10); // materializes 3500 immediately, stays ACTIVE

    const entryBefore = (
      await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries?employeeId=${employee.id}`)
    ).body.entries[0];
    expect(Number(entryBefore.advanceDeduction)).toBeCloseTo(3500, 2);

    const advanceBefore = (await admin.agent.get(`/api/v1/advances/${advanceId}`)).body.advance;
    expect(advanceBefore.status).toBe('ACTIVE');
    expect(Number(advanceBefore.outstandingBalance)).toBeCloseTo(5500, 2);

    // Cancel must first reverse the still-Draft (unreleased) materialization — nothing about it is
    // final yet — the same reasoning `deferAdvanceSchedule` already established.
    const cancelRes = await admin.agent
      .post(`/api/v1/advances/${advanceId}/cancel`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ reason: 'Advance amount was wrong' });
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.advance.status).toBe('CANCELLED');
    expect(Number(cancelRes.body.advance.outstandingBalance)).toBeCloseTo(9000, 2); // fully restored

    const entryAfter = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entryBefore.id } });
    expect(entryAfter.advanceId).toBeNull();
    expect(Number(entryAfter.advanceDeduction)).toBe(0);

    const entryAudit = await prisma.auditLog.findFirst({
      where: { action: 'payroll_entry.advance_cancelled', entityId: entryBefore.id },
    });
    expect(entryAudit).not.toBeNull();
  });

  it('cancelling an Advance whose only deduction is already released preserves that released entry untouched', async () => {
    const admin = await masterAdminAgent('adv-cancel-released-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Cancel Released');
    const employee = await makeEmployee(site.id, unit.id, 'Cancel Released Employee', '40000');

    const created = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '9000',
      dateGiven: '2026-01-01',
      repaymentType: 'INSTALLMENT',
      scheduledInstallmentAmount: '3000',
      originalPeriod: { year: 2903, month: 11 },
    });
    const advanceId = created.body.advance.id as string;
    const cycle = await makeDraftCycle(admin, 2903, 11); // materializes 3000 immediately, stays ACTIVE

    await releaseUnit(admin, cycle.id, unit.id);

    const cancelRes = await admin.agent
      .post(`/api/v1/advances/${advanceId}/cancel`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ reason: 'No further installments needed' });
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.advance.status).toBe('CANCELLED');
    // The released deduction is preserved exactly as it was — never reversed.
    expect(Number(cancelRes.body.advance.outstandingBalance)).toBeCloseTo(6000, 2);

    const entry = await prisma.payrollEntry.findFirst({ where: { cycleId: cycle.id, employeeId: employee.id } });
    expect(entry?.released).toBe(true);
    expect(entry?.advanceId).toBe(advanceId);
    expect(Number(entry?.advanceDeduction)).toBeCloseTo(3000, 2);
  });

  it('rejects cancelling an Advance that is already PAID_OFF or already CANCELLED', async () => {
    const admin = await masterAdminAgent('adv-cancel-twice-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Cancel Twice');
    const employee = await makeEmployee(site.id, unit.id, 'Cancel Twice Employee');

    const created = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '9000',
      dateGiven: '2026-01-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2900, month: 1 },
    });
    const advanceId = created.body.advance.id as string;

    const first = await admin.agent
      .post(`/api/v1/advances/${advanceId}/cancel`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ reason: 'Mistake' });
    expect(first.status).toBe(200);

    const second = await admin.agent
      .post(`/api/v1/advances/${advanceId}/cancel`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ reason: 'Again' });
    expect(second.status).toBe(400);
  });

  it('allows cancelling a RESERVED advance (reverses the live Draft deduction), but rejects cancelling once actually PAID_OFF via release — Case 2', async () => {
    const admin = await masterAdminAgent('adv-cancel-reserved-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Cancel Reserved');
    const employee = await makeEmployee(site.id, unit.id, 'Cancel Reserved Employee', '40000');

    const created = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '9000',
      dateGiven: '2026-01-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2900, month: 4 },
    });
    const advanceId = created.body.advance.id as string;
    const cycle = await makeDraftCycle(admin, 2900, 4);

    const reserved = (await admin.agent.get(`/api/v1/advances/${advanceId}`)).body.advance;
    expect(reserved.status).toBe('RESERVED');

    const cancelWhileReserved = await admin.agent
      .post(`/api/v1/advances/${advanceId}/cancel`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ reason: 'Employee left before deduction was actually settled' });
    expect(cancelWhileReserved.status).toBe(200);
    expect(cancelWhileReserved.body.advance.status).toBe('CANCELLED');
    expect(Number(cancelWhileReserved.body.advance.outstandingBalance)).toBeCloseTo(9000, 2);
    // No orphan materialization risk (Final Verification, Case 2): `currentScheduledPeriodId`
    // cleared means no future cycle-bootstrap sweep (`materializeScheduledAdvanceDeductions`, which
    // filters `status: 'ACTIVE'` anyway) could ever re-materialize a deduction for this cancelled
    // Advance against a stale scheduled period.
    expect(cancelWhileReserved.body.advance.currentScheduledPeriodId).toBeNull();

    const entryAfterCancel = (
      await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries?employeeId=${employee.id}`)
    ).body.entries[0];
    // No orphan link back to the cancelled Advance from the Draft entry it used to occupy.
    expect(entryAfterCancel.advanceId).toBeNull();
    expect(Number(entryAfterCancel.advanceDeduction)).toBe(0);

    // A second, separate advance that actually gets released must reject cancellation once PAID_OFF.
    const second = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'EID_ADVANCE',
      totalAmount: '4000',
      dateGiven: '2026-01-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2900, month: 4 },
    });
    const secondAdvanceId = second.body.advance.id as string;
    await releaseUnit(admin, cycle.id, unit.id);

    const secondAfterRelease = (await admin.agent.get(`/api/v1/advances/${secondAdvanceId}`)).body.advance;
    expect(secondAfterRelease.status).toBe('PAID_OFF');

    const cancelWhilePaidOff = await admin.agent
      .post(`/api/v1/advances/${secondAdvanceId}/cancel`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ reason: 'Too late' });
    expect(cancelWhilePaidOff.status).toBe(400);
  });

  it('rejects a blank cancel reason', async () => {
    const admin = await masterAdminAgent('adv-cancel-blank-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Cancel Blank');
    const employee = await makeEmployee(site.id, unit.id, 'Cancel Blank Employee');

    const created = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '9000',
      dateGiven: '2026-01-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2900, month: 1 },
    });
    const advanceId = created.body.advance.id as string;

    const res = await admin.agent
      .post(`/api/v1/advances/${advanceId}/cancel`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ reason: '   ' });
    expect(res.status).toBe(400);
  });

  // --- Numeric lifecycle reconciliation (Section H) ----------------------------------------------

  it('reconciles Original − Released deductions = Outstanding Balance across three cycles, decimal-safe, release-once, no double-decrement on refetch', async () => {
    const admin = await masterAdminAgent('adv-reconcile-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Reconcile');
    const employee = await makeEmployee(site.id, unit.id, 'Reconcile Employee', '40000');

    const originalAmount = 10000.5;
    const installment = 3333.5; // deliberately not evenly divisible, to exercise decimal handling

    const created = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: originalAmount.toFixed(2),
      dateGiven: '2026-01-01',
      repaymentType: 'INSTALLMENT',
      scheduledInstallmentAmount: installment.toFixed(2),
      originalPeriod: { year: 2904, month: 1 },
    });
    const advanceId = created.body.advance.id as string;

    let releasedTotal = 0;

    // Cycle 1 — materializes immediately at creation-time (Draft cycle doesn't exist yet here, so
    // it materializes at bootstrap instead), then release it.
    const cycle1 = await makeDraftCycle(admin, 2904, 1);
    let advance = (await admin.agent.get(`/api/v1/advances/${advanceId}`)).body.advance;
    expect(Number(advance.outstandingBalance)).toBeCloseTo(originalAmount - installment, 2);
    await releaseUnit(admin, cycle1.id, unit.id);
    releasedTotal += installment;

    // Re-fetching after release must not double-decrement — outstandingBalance already reflects
    // the one and only materialization for this cycle.
    let refetched = (await admin.agent.get(`/api/v1/advances/${advanceId}`)).body.advance;
    expect(Number(refetched.outstandingBalance)).toBeCloseTo(originalAmount - releasedTotal, 2);

    const finalize1 = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle1.id}/finalize`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(finalize1.status).toBe(200);

    // Cycle 2 — rollover materializes the next installment automatically.
    const cycle2Res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle1.id}/archive-and-create-next`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(cycle2Res.status).toBe(201);
    const cycle2 = cycle2Res.body.newCycle as { id: string; year: number; month: number };
    advance = (await admin.agent.get(`/api/v1/advances/${advanceId}`)).body.advance;
    expect(Number(advance.outstandingBalance)).toBeCloseTo(originalAmount - releasedTotal - installment, 2);
    await releaseUnit(admin, cycle2.id, unit.id);
    releasedTotal += installment;

    refetched = (await admin.agent.get(`/api/v1/advances/${advanceId}`)).body.advance;
    expect(Number(refetched.outstandingBalance)).toBeCloseTo(originalAmount - releasedTotal, 2);
    expect(refetched.status).toBe('ACTIVE');

    const finalize2 = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle2.id}/finalize`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(finalize2.status).toBe(200);

    // Cycle 3 — the remainder (10000.50 − 2×3333.50 = 3333.50) is still a full installment; the
    // `min(installment, outstanding)` cap is exercised explicitly by computing the expected
    // deduction the same way, independently, rather than assuming it always equals `installment`.
    const remainderBeforeCycle3 = originalAmount - releasedTotal;
    const cycle3Res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle2.id}/archive-and-create-next`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(cycle3Res.status).toBe(201);
    const cycle3 = cycle3Res.body.newCycle as { id: string; year: number; month: number };
    advance = (await admin.agent.get(`/api/v1/advances/${advanceId}`)).body.advance;
    const expectedCycle3Deduction = Math.min(installment, remainderBeforeCycle3);
    expect(Number(advance.outstandingBalance)).toBeCloseTo(remainderBeforeCycle3 - expectedCycle3Deduction, 2);
    await releaseUnit(admin, cycle3.id, unit.id);
    releasedTotal += expectedCycle3Deduction;

    // Independent reconciliation: Original − Released deductions = Outstanding Balance, exactly.
    const final = (await admin.agent.get(`/api/v1/advances/${advanceId}`)).body.advance;
    expect(Number(final.outstandingBalance)).toBeCloseTo(originalAmount - releasedTotal, 2);
    expect(Number(final.outstandingBalance)).toBeCloseTo(0, 2);
    expect(final.status).toBe('PAID_OFF');

    // Sum every materialization audit entry independently and cross-check against the same total.
    const materializations = await prisma.auditLog.findMany({
      where: { action: 'advance.schedule_materialized', entityId: advanceId },
    });
    const sumFromAudit = materializations.reduce((sum, entry) => {
      const metadata = entry.metadata as { amount: string };
      return sum + Number(metadata.amount);
    }, 0);
    expect(sumFromAudit).toBeCloseTo(releasedTotal, 2);
    expect(originalAmount - sumFromAudit).toBeCloseTo(Number(final.outstandingBalance), 2);
  });

  // ================================================================================================
  // v1.0.4 — Pagination, Filters, Deputation (Advances Usability + Employee Deputation checkpoint)
  // ================================================================================================

  describe('v1.0.4 — Pagination, Filters, Deputation', () => {
    /** Bulk-seeds Advance rows directly (bypassing `createAdvance`'s HTTP flow and its
     * one-ACTIVE/RESERVED-per-employee-per-type constraint) — CANCELLED by default, exactly the
     * same bulk-seeding convention `advance-recovery-report.test.ts`'s own pagination test already
     * uses, since these tests only need many distinct rows to page/filter over, not a particular
     * live lifecycle state. */
    async function makeAdvanceDirect(
      employeeId: string,
      type: 'LOAN' | 'EID_ADVANCE',
      overrides: { totalAmount?: string; outstandingBalance?: string; status?: 'ACTIVE' | 'RESERVED' | 'PAID_OFF' | 'CANCELLED'; createdAt?: Date } = {},
    ) {
      const totalAmount = overrides.totalAmount ?? '1000';
      return prisma.advance.create({
        data: {
          employeeId,
          type,
          totalAmount,
          outstandingBalance: overrides.outstandingBalance ?? totalAmount,
          dateGiven: new Date('2026-01-01'),
          repaymentType: 'FULL_DEDUCTION',
          status: overrides.status ?? 'CANCELLED',
          ...(overrides.createdAt && { createdAt: overrides.createdAt }),
        },
      });
    }

    it('paginates server-side: correct count/order per page, no duplicate/missing rows across pages, newest-first default', async () => {
      const admin = await masterAdminAgent('adv-page-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ADV Page');
      const employee = await makeEmployee(site.id, unit.id, 'Page Employee');

      // 30 distinct Advances — materially larger than one 25-row page — each with a distinct,
      // strictly increasing createdAt so "newest first" is meaningfully exercised, not a same-
      // instant tie broken only by the id tie-break.
      const createdIds: string[] = [];
      const base = Date.now();
      for (let i = 0; i < 30; i += 1) {
        const advance = await makeAdvanceDirect(employee.id, i % 2 === 0 ? 'LOAN' : 'EID_ADVANCE', {
          totalAmount: `${1000 + i}`,
          createdAt: new Date(base + i * 1000),
        });
        createdIds.push(advance.id);
      }

      const page1 = await admin.agent.get(`/api/v1/advances?employeeId=${employee.id}&pageSize=25&page=1`);
      const page2 = await admin.agent.get(`/api/v1/advances?employeeId=${employee.id}&pageSize=25&page=2`);

      expect(page1.status).toBe(200);
      expect(page1.body.total).toBe(30);
      expect(page1.body.page).toBe(1);
      expect(page1.body.pageSize).toBe(25);
      expect(page1.body.advances).toHaveLength(25);
      expect(page2.body.page).toBe(2);
      expect(page2.body.advances).toHaveLength(5);

      const page1Ids = page1.body.advances.map((a: { id: string }) => a.id);
      const page2Ids = page2.body.advances.map((a: { id: string }) => a.id);
      // Deterministic sort (createdAt desc, id asc tie-break) — no row ever duplicated or skipped
      // across pages.
      expect(page1Ids.filter((id: string) => page2Ids.includes(id))).toHaveLength(0);
      expect(new Set([...page1Ids, ...page2Ids]).size).toBe(30);

      // Newest-first default: the last-seeded row (i=29, latest createdAt) is first on page 1.
      expect(page1Ids[0]).toBe(createdIds[29]);
      expect(page2Ids[4]).toBe(createdIds[0]);
    });

    it('composes a status filter with pagination correctly', async () => {
      const admin = await masterAdminAgent('adv-page-status-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ADV Page Status');
      const employee = await makeEmployee(site.id, unit.id, 'Page Status Employee');

      for (let i = 0; i < 6; i += 1) {
        await makeAdvanceDirect(employee.id, 'LOAN', { status: i < 4 ? 'CANCELLED' : 'PAID_OFF', createdAt: new Date(Date.now() + i * 1000) });
      }

      const cancelledRes = await admin.agent.get(`/api/v1/advances?employeeId=${employee.id}&status=CANCELLED&pageSize=25&page=1`);
      expect(cancelledRes.body.total).toBe(4);
      expect(cancelledRes.body.advances.every((a: { status: string }) => a.status === 'CANCELLED')).toBe(true);

      const paidOffRes = await admin.agent.get(`/api/v1/advances?employeeId=${employee.id}&status=PAID_OFF&pageSize=25&page=1`);
      expect(paidOffRes.body.total).toBe(2);
    });

    it('the existing Advance type filter composes with pagination unchanged', async () => {
      const admin = await masterAdminAgent('adv-page-type-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ADV Page Type');
      const employee = await makeEmployee(site.id, unit.id, 'Page Type Employee');

      for (let i = 0; i < 3; i += 1) await makeAdvanceDirect(employee.id, 'LOAN');
      for (let i = 0; i < 2; i += 1) await makeAdvanceDirect(employee.id, 'EID_ADVANCE');

      const loanRes = await admin.agent.get(`/api/v1/advances?employeeId=${employee.id}&type=LOAN&pageSize=25&page=1`);
      expect(loanRes.body.total).toBe(3);
      const eidRes = await admin.agent.get(`/api/v1/advances?employeeId=${employee.id}&type=EID_ADVANCE&pageSize=25&page=1`);
      expect(eidRes.body.total).toBe(2);
    });

    it('Cancelled history remains fully reachable — never hidden, just one filter selection away', async () => {
      const admin = await masterAdminAgent('adv-page-cancelled-visible-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ADV Page Cancelled Visible');
      const employee = await makeEmployee(site.id, unit.id, 'Cancelled Visible Employee');
      await makeAdvanceDirect(employee.id, 'LOAN', { status: 'CANCELLED' });

      // No status filter at all ("All") — the pre-existing default this page has always used —
      // still surfaces the Cancelled row; the checkpoint must not narrow this default.
      const allRes = await admin.agent.get(`/api/v1/advances?employeeId=${employee.id}&pageSize=25&page=1`);
      expect(allRes.body.total).toBe(1);
      expect(allRes.body.advances[0].status).toBe('CANCELLED');
    });

    it('filters by multiple selected sites server-side — no longer requires an unbounded client-side fetch', async () => {
      const admin = await masterAdminAgent('adv-page-multisite-admin@test.local');
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site ADV MultiSite A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site ADV MultiSite B');
      const { site: siteC, unit: unitC } = await makeSiteWithUnit('Test Site ADV MultiSite C');
      const empA = await makeEmployee(siteA.id, unitA.id, 'MultiSite Employee A');
      const empB = await makeEmployee(siteB.id, unitB.id, 'MultiSite Employee B');
      const empC = await makeEmployee(siteC.id, unitC.id, 'MultiSite Employee C');
      await makeAdvanceDirect(empA.id, 'LOAN');
      await makeAdvanceDirect(empB.id, 'LOAN');
      await makeAdvanceDirect(empC.id, 'LOAN');

      const res = await admin.agent.get(`/api/v1/advances?siteId=${siteA.id}&siteId=${siteB.id}&pageSize=25&page=1`);
      expect(res.body.total).toBe(2);
      const returnedSiteIds = res.body.advances.map((a: { employee: { siteId: string } }) => a.employee.siteId).sort();
      expect(returnedSiteIds).toEqual([siteA.id, siteB.id].sort());
    });

    it('the new [status, createdAt] and [createdAt] indexes exist on Advance', async () => {
      const rows = await prisma.$queryRaw<Array<{ indexname: string }>>`
        SELECT indexname FROM pg_indexes WHERE tablename = 'Advance' AND indexname IN ('Advance_status_createdAt_idx', 'Advance_createdAt_idx')
      `;
      expect(rows.map((r) => r.indexname).sort()).toEqual(['Advance_createdAt_idx', 'Advance_status_createdAt_idx']);
    });

    it('includes current Site/Unit deputation on every row and distinguishes same-named employees, with no N+1 query growth as row count increases', async () => {
      const admin = await masterAdminAgent('adv-deputation-admin@test.local');
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site ADV Deputation A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site ADV Deputation B');
      // Two employees sharing the exact same name, deputed to different sites/units — only
      // Code/Father Name/CNIC/Site/Unit context (v1.0.1 + v1.0.4 identity blocks combined) can tell
      // them apart in a flat grid.
      const empA = await makeEmployee(siteA.id, unitA.id, 'Muhammad Talha');
      const empB = await makeEmployee(siteB.id, unitB.id, 'Muhammad Talha');
      await makeAdvanceDirect(empA.id, 'LOAN');
      await makeAdvanceDirect(empB.id, 'LOAN');

      const res = await admin.agent.get('/api/v1/advances?pageSize=25&page=1');
      expect(res.status).toBe(200);
      const rowA = res.body.advances.find((a: { employeeId: string }) => a.employeeId === empA.id);
      const rowB = res.body.advances.find((a: { employeeId: string }) => a.employeeId === empB.id);
      expect(rowA.employee.site.name).toBe(siteA.name);
      expect(rowA.employee.unit.name).toBe(unitA.name);
      expect(rowB.employee.site.name).toBe(siteB.name);
      expect(rowB.employee.unit.name).toBe(unitB.name);
      // Same name, genuinely distinguishable only via Site/Unit (Code/CNIC/FatherName are all null
      // here, exactly the "Employee Code remains intentionally incomplete" case).
      expect(rowA.employee.name).toBe(rowB.employee.name);
      expect(rowA.employee.site.name).not.toBe(rowB.employee.site.name);

      // No N+1: the joined `employee`/`site`/`unit` include (all to-one relations) must issue a
      // constant number of queries regardless of how many rows are actually returned — a real N+1
      // would show query count growing with page size, not staying flat.
      const queries: string[] = [];
      const listener = (e: { query: string }) => queries.push(e.query);
      prisma.$on('query', listener);
      try {
        const before1 = queries.length;
        await admin.agent.get('/api/v1/advances?pageSize=1&page=1');
        const queriesForOneRow = queries.length - before1;

        const before2 = queries.length;
        await admin.agent.get('/api/v1/advances?pageSize=25&page=1');
        const queriesForManyRows = queries.length - before2;

        expect(queriesForManyRows).toBe(queriesForOneRow);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (prisma as any).$off?.('query', listener);
      }
    });
  });
});
