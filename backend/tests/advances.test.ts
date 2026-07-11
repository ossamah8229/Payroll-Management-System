import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
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

    // Pay off the first advance directly (simulating materialization) so a new LOAN becomes legal.
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

  it('materializes a FULL_DEDUCTION advance automatically when its scheduled cycle is created, and pays it off', async () => {
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

    const advanceAfter = await admin.agent.get(`/api/v1/advances/${advanceId}`);
    expect(Number(advanceAfter.body.advance.outstandingBalance)).toBeCloseTo(0, 2);
    expect(advanceAfter.body.advance.status).toBe('PAID_OFF');
    expect(advanceAfter.body.advance.paidOffAt).not.toBeNull();
    expect(advanceAfter.body.advance.currentScheduledPeriodId).toBeNull();

    const auditEntry = await prisma.auditLog.findFirst({
      where: { action: 'advance.schedule_materialized', entityId: advanceId },
    });
    expect(auditEntry).not.toBeNull();
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

  it('defers a materialized FULL_DEDUCTION deduction, reversing its PAID_OFF status back to ACTIVE', async () => {
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

    // FULL_DEDUCTION materialization already marked the advance PAID_OFF — deferral must still be
    // able to undo this, since the entry itself hasn't released yet (nothing is final).
    const paidOffAdvance = (await admin.agent.get(`/api/v1/advances/${advanceId}`)).body.advance;
    expect(paidOffAdvance.status).toBe('PAID_OFF');
    expect(Number(paidOffAdvance.outstandingBalance)).toBeCloseTo(0, 2);

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

  it('updates notes/repaymentType/scheduledInstallmentAmount and audits the change', async () => {
    const admin = await masterAdminAgent('adv-update-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site ADV Update');
    const employee = await makeEmployee(site.id, unit.id, 'Update Employee');

    const created = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '9000',
      dateGiven: '2026-01-01',
      repaymentType: 'INSTALLMENT',
      originalPeriod: { year: 2900, month: 1 },
    });
    const advanceId = created.body.advance.id as string;

    const res = await admin.agent
      .patch(`/api/v1/advances/${advanceId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ scheduledInstallmentAmount: '3000', notes: 'Standing schedule set' });
    expect(res.status).toBe(200);
    expect(Number(res.body.advance.scheduledInstallmentAmount)).toBeCloseTo(3000, 2);

    const auditEntry = await prisma.auditLog.findFirst({ where: { action: 'advance.updated', entityId: advanceId } });
    expect(auditEntry).not.toBeNull();
  });
});
