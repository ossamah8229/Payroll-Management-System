import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

describe('Phase 3 Checkpoint 1 — Payroll Cycle bootstrap/creation', () => {
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
      permissionKeys: [PERMISSIONS.PAYROLL_CYCLE_MANAGE, PERMISSIONS.PAYROLL_ENTRY],
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

  async function makeSiteWithUnit(name: string) {
    const site = await prisma.projectSite.create({ data: { name } });
    const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} Unit`, code: 'U-1' } });
    return { site, unit };
  }

  async function makeEmployee(
    siteId: string,
    unitId: string,
    name: string,
    overrides: { grossPay?: string; dateOfLeaving?: Date | null } = {},
  ) {
    return prisma.employee.create({
      data: {
        name,
        designation: 'Guard',
        siteId,
        unitId,
        grossPay: overrides.grossPay ?? '30000',
        dateOfLeaving: overrides.dateOfLeaving ?? null,
      },
    });
  }

  it('bootstraps the very first payroll cycle, seeding an entry for every active employee', async () => {
    const { agent, csrfToken } = await masterAdminAgent('cycle-bootstrap@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Cycle Bootstrap');
    const active = await makeEmployee(site.id, unit.id, 'Active Employee');
    await makeEmployee(site.id, unit.id, 'Departed Employee', { dateOfLeaving: new Date('2026-01-01T00:00:00.000Z') });

    const res = await agent
      .post('/api/v1/payroll-cycles')
      .set('x-csrf-token', csrfToken)
      .send({ year: 2900, month: 1 });

    expect(res.status).toBe(201);
    expect(res.body.cycle.status).toBe('DRAFT');
    expect(res.body.cycle.sourceCycleId).toBeNull();

    const entries = await prisma.payrollEntry.findMany({
      where: { cycleId: res.body.cycle.id },
      include: { workLines: true },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.employeeId).toBe(active.id);
    expect(entries[0]?.workLines).toHaveLength(1);
    expect(entries[0]?.workLines[0]?.unitId).toBe(unit.id);

    const auditEntry = await prisma.auditLog.findFirst({
      where: { action: 'payroll_cycle.created', entityId: res.body.cycle.id },
    });
    expect(auditEntry).not.toBeNull();
  });

  it('rejects a non-Master-User attempting to create a payroll cycle', async () => {
    const { site } = await makeSiteWithUnit('Test Site Cycle RBAC');
    const { agent, csrfToken } = await payrollStaffAgent('cycle-rbac@test.local', [site.id]);

    const res = await agent
      .post('/api/v1/payroll-cycles')
      .set('x-csrf-token', csrfToken)
      .send({ year: 2900, month: 2 });

    expect(res.status).toBe(403);
  });

  it('rejects creating a second cycle while a Draft cycle already exists', async () => {
    const { agent, csrfToken } = await masterAdminAgent('cycle-only-one-draft@test.local');
    await makeSiteWithUnit('Test Site Cycle Only One Draft');

    const first = await agent
      .post('/api/v1/payroll-cycles')
      .set('x-csrf-token', csrfToken)
      .send({ year: 2900, month: 3 });
    expect(first.status).toBe(201);

    const second = await agent
      .post('/api/v1/payroll-cycles')
      .set('x-csrf-token', csrfToken)
      .send({ year: 2900, month: 4 });
    expect(second.status).toBe(409);
    expect(second.body.error.message).toMatch(/draft/i);
  });

  it('rejects a second cycle via the plain create route once any cycle exists, regardless of its status (Phase 5 Checkpoint 3)', async () => {
    const { agent, csrfToken } = await masterAdminAgent('cycle-plain-route-restricted@test.local');
    await makeSiteWithUnit('Test Site Cycle Plain Route Restricted');

    const first = await agent
      .post('/api/v1/payroll-cycles')
      .set('x-csrf-token', csrfToken)
      .send({ year: 2900, month: 5 });
    expect(first.status).toBe(201);

    // Move the cycle past Draft — the plain route must still reject a second create, now with a
    // message pointing at the rollover endpoint rather than the "Draft already exists" message
    // (that message is specific to the still-Draft case, tested separately above).
    await prisma.payrollCycle.update({ where: { id: first.body.cycle.id }, data: { status: 'RELEASED' } });

    const second = await agent
      .post('/api/v1/payroll-cycles')
      .set('x-csrf-token', csrfToken)
      .send({ year: 2900, month: 6 });
    expect(second.status).toBe(409);
    expect(second.body.error.message).toMatch(/archive-and-create-next/i);
  });

  it('carries forward grossPay/EOBI/leaveRate/cycleDays/otRate from a continuing employee\'s prior entry, not from Employee\'s own defaults, via rollover', async () => {
    const { agent, csrfToken } = await masterAdminAgent('cycle-carry-forward@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Carry Forward');
    const employee = await makeEmployee(site.id, unit.id, 'Continuing Employee', { grossPay: '30000' });

    const cycle1 = await agent
      .post('/api/v1/payroll-cycles')
      .set('x-csrf-token', csrfToken)
      .send({ year: 2900, month: 6 });
    expect(cycle1.status).toBe(201);

    const entry1 = await prisma.payrollEntry.findFirstOrThrow({
      where: { cycleId: cycle1.body.cycle.id, employeeId: employee.id },
      include: { workLines: true },
    });

    // Adjust cycle 1's entry directly (a Payroll-Entry-level edit, as if made before release) to a
    // figure that deliberately differs from Employee.grossPay — this is exactly the kind of
    // adjustment §9 says Employee.grossPay ("template value only") would NOT reflect.
    const patchRes = await agent
      .patch(`/api/v1/payroll-entries/${entry1.id}`)
      .set('x-csrf-token', csrfToken)
      // hold: true — Finalize's precondition requires every entry be released or held; this test
      // doesn't exercise per-Unit release, so it holds the one entry instead.
      .send({ version: entry1.version, grossPay: '35000.50', eobiAmount: '450', eobiApplicable: false, hold: true });
    expect(patchRes.status).toBe(200);

    await prisma.payrollEntryWorkLine.update({
      where: { id: entry1.workLines[0]!.id },
      data: { cycleDays: 26, otRate: '111.11' },
    });

    // Finalize (real transition, not a simulated status write — Finalize/Release exist as of
    // Phase 5 Checkpoint 1) then roll over — the real Checkpoint 3 path to a second cycle.
    const finalizeRes = await agent
      .post(`/api/v1/payroll-cycles/${cycle1.body.cycle.id}/finalize`)
      .set('x-csrf-token', csrfToken)
      .send({});
    expect(finalizeRes.status).toBe(200);

    const cycle2 = await agent
      .post(`/api/v1/payroll-cycles/${cycle1.body.cycle.id}/archive-and-create-next`)
      .set('x-csrf-token', csrfToken)
      .send({});
    expect(cycle2.status).toBe(201);
    expect(cycle2.body.newCycle.sourceCycleId).toBe(cycle1.body.cycle.id);

    const entry2 = await prisma.payrollEntry.findFirstOrThrow({
      where: { cycleId: cycle2.body.newCycle.id, employeeId: employee.id },
      include: { workLines: true },
    });

    expect(Number(entry2.grossPay)).toBe(35000.5);
    expect(Number(entry2.eobiAmount)).toBe(450);
    expect(entry2.eobiApplicable).toBe(false);
    expect(entry2.workLines).toHaveLength(1);
    expect(entry2.workLines[0]?.cycleDays).toBe(26);
    expect(Number(entry2.workLines[0]?.otRate)).toBe(111.11);
    // Attendance always resets, even though the rate basis carried forward.
    expect(Number(entry2.workLines[0]?.days)).toBe(0);
    // The new line still uses the employee's current default unit, not whatever unit(s) the
    // prior cycle happened to record.
    expect(entry2.workLines[0]?.unitId).toBe(unit.id);
  });

  it('seeds a genuinely new employee (no prior entry) fresh from Employee defaults in a subsequent cycle created via rollover', async () => {
    const { agent, csrfToken } = await masterAdminAgent('cycle-new-employee@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site New Employee Mid Cycle');

    const cycle1 = await agent
      .post('/api/v1/payroll-cycles')
      .set('x-csrf-token', csrfToken)
      .send({ year: 2900, month: 8 });
    expect(cycle1.status).toBe(201);

    const finalizeRes = await agent
      .post(`/api/v1/payroll-cycles/${cycle1.body.cycle.id}/finalize`)
      .set('x-csrf-token', csrfToken)
      .send({});
    expect(finalizeRes.status).toBe(200);

    // Hired after cycle 1 was created — has no entry in cycle 1 at all.
    const newHire = await makeEmployee(site.id, unit.id, 'New Hire', { grossPay: '42000' });

    const cycle2 = await agent
      .post(`/api/v1/payroll-cycles/${cycle1.body.cycle.id}/archive-and-create-next`)
      .set('x-csrf-token', csrfToken)
      .send({});
    expect(cycle2.status).toBe(201);

    const entry2 = await prisma.payrollEntry.findFirstOrThrow({
      where: { cycleId: cycle2.body.newCycle.id, employeeId: newHire.id },
      include: { workLines: true },
    });
    expect(Number(entry2.grossPay)).toBe(42000);
    expect(entry2.workLines[0]?.cycleDays).toBe(30); // schema default, no prior line to inherit from
  });

  it('lists and fetches payroll cycles', async () => {
    const { agent, csrfToken } = await masterAdminAgent('cycle-list-get@test.local');
    await makeSiteWithUnit('Test Site Cycle List');

    const created = await agent
      .post('/api/v1/payroll-cycles')
      .set('x-csrf-token', csrfToken)
      .send({ year: 2900, month: 10 });
    expect(created.status).toBe(201);

    const list = await agent.get('/api/v1/payroll-cycles');
    expect(list.status).toBe(200);
    expect(list.body.cycles.some((c: { id: string }) => c.id === created.body.cycle.id)).toBe(true);

    const single = await agent.get(`/api/v1/payroll-cycles/${created.body.cycle.id}`);
    expect(single.status).toBe(200);
    expect(single.body.cycle.id).toBe(created.body.cycle.id);
  });
});
