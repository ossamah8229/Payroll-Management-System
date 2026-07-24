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
    expect(created.body.advance.status).toBe('PAID_OFF');

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

  it('editing an ACTIVE Advance already materialized into the current Draft recalculates the Draft deduction correctly and exactly once, while a prior Released deduction stays untouched', async () => {
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

    // Edit the standing installment schedule while Cycle 2's deduction is still live (unreleased).
    const editRes = await admin.agent
      .patch(`/api/v1/advances/${advanceId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ scheduledInstallmentAmount: '1500' });
    expect(editRes.status).toBe(200);

    // Cycle 2's Draft deduction recalculates to the new amount — exactly once, not additive/doubled.
    const cycle2EntryAfter = (
      await admin.agent.get(`/api/v1/payroll-cycles/${cycle2.id}/entries?employeeId=${employee.id}`)
    ).body.entries[0];
    expect(Number(cycle2EntryAfter.advanceDeduction)).toBeCloseTo(1500, 2);
    expect(cycle2EntryAfter.advanceId).toBe(advanceId);
    expect(cycle2EntryAfter.version).toBe(cycle2EntryBefore.version + 2); // one reversal + one re-materialization

    const advanceAfter = (await admin.agent.get(`/api/v1/advances/${advanceId}`)).body.advance;
    // 12000 total - 4000 released (cycle 1) - 1500 newly recalculated (cycle 2) = 6500.
    expect(Number(advanceAfter.outstandingBalance)).toBeCloseTo(6500, 2);
    expect(advanceAfter.status).toBe('ACTIVE');

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
      .send({ totalAmount: '9000', repaymentType: 'INSTALLMENT', scheduledInstallmentAmount: '4000', notes: 'just a note' });
    expect(res.status).toBe(200);

    const entryAfter = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entryBefore.id } });
    expect(entryAfter.version).toBe(entryBefore.version); // untouched — no reversal/re-materialization
    expect(Number(entryAfter.advanceDeduction)).toBeCloseTo(4000, 2);
  });

  it('rejects any financial-field edit once an Advance is PAID_OFF, but still allows notes', async () => {
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
    await makeDraftCycle(admin, 2903, 9); // fully materializes and pays off immediately

    const rejected = await admin.agent
      .patch(`/api/v1/advances/${advanceId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ totalAmount: '15000' });
    expect(rejected.status).toBe(400);

    const notesOk = await admin.agent
      .patch(`/api/v1/advances/${advanceId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ notes: 'closed out' });
    expect(notesOk.status).toBe(200);
    expect(notesOk.body.advance.notes).toBe('closed out');
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
});
