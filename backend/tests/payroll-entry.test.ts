import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

describe('Phase 3 Checkpoint 1 — Payroll Entry / Work Line CRUD', () => {
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

  /** A user with no payroll:entry permission at all — the RBAC-missing-permission boundary case.
   * Uses a bespoke TEST_-prefixed role rather than the real PAYROLL_STAFF role code: that real
   * role is upserted (never reset) by `createTestUser`, so it already carries every permission
   * the Phase 1 seed script granted it (including `payroll:entry`) — there is no way to test
   * "lacks this permission" against a role the seed itself already granted it to. */
  async function noPayrollPermissionAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_NO_PAYROLL_ENTRY',
      permissionKeys: [PERMISSIONS.EMPLOYEES_VIEW],
      siteIds,
    });
  }

  async function makeSiteWithUnit(name: string) {
    const site = await prisma.projectSite.create({ data: { name } });
    const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} Unit`, code: 'U-1' } });
    return { site, unit };
  }

  async function makeEmployee(siteId: string, unitId: string, name: string, grossPay = '30000') {
    return prisma.employee.create({ data: { name, designation: 'Guard', siteId, unitId, grossPay } });
  }

  async function makeDraftCycle(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, month: number) {
    const res = await admin.agent
      .post('/api/v1/payroll-cycles')
      .set('x-csrf-token', admin.csrfToken)
      .send({ year: 2900, month });
    return res.body.cycle as { id: string };
  }

  // Every test below deliberately creates its cycle BEFORE its employee(s) — creating the cycle
  // bootstraps/seeds an entry automatically for every *already-existing* active employee
  // (correct, tested separately in payroll-cycle.test.ts), so an employee created afterward is
  // the one genuine "not yet enrolled" case the manual POST /entries endpoint under test here is
  // actually for (a late hire mid-cycle). Creating the employee first would mean the cycle
  // bootstrap auto-enrolls them, and the test's own "create an entry" call would then find one
  // already exists — a real ordering bug caught while first running these tests.

  it('creates a payroll entry for an employee, seeding fields from Employee and one default work line', async () => {
    const admin = await masterAdminAgent('entry-create@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Entry Create');
    const cycle = await makeDraftCycle(admin, 1);
    const employee = await makeEmployee(site.id, unit.id, 'Entry Create Employee', '28000');

    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id });

    expect(res.status).toBe(201);
    expect(Number(res.body.entry.grossPay)).toBe(28000);
    expect(res.body.entry.workLines).toHaveLength(1);
    expect(res.body.entry.workLines[0].unitId).toBe(unit.id);
    expect(res.body.entry.calc.netSalary).toBeDefined();

    const auditEntry = await prisma.auditLog.findFirst({
      where: { action: 'payroll_entry.created', entityId: res.body.entry.id },
    });
    expect(auditEntry).not.toBeNull();
  });

  it('rejects a second entry for the same employee in the same cycle', async () => {
    const admin = await masterAdminAgent('entry-duplicate@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Entry Duplicate');
    const cycle = await makeDraftCycle(admin, 2);
    const employee = await makeEmployee(site.id, unit.id, 'Duplicate Employee');

    const first = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id });
    expect(first.status).toBe(201);

    const second = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id });
    expect(second.status).toBe(409);
  });

  it('site-scopes Payroll Staff on create/read — outside-assignment rejected, in-assignment allowed', async () => {
    const admin = await masterAdminAgent('entry-siteA-admin@test.local');
    const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site Entry Scope A');
    const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site Entry Scope B');
    const cycle = await makeDraftCycle(admin, 3);
    const employeeA = await makeEmployee(siteA.id, unitA.id, 'Employee A');
    const employeeB = await makeEmployee(siteB.id, unitB.id, 'Employee B');

    const staffA = await payrollStaffAgent('entry-staffA@test.local', [siteA.id]);

    // Staff assigned only to Site A can create/read an entry for Employee A...
    const createA = await staffA.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', staffA.csrfToken)
      .send({ employeeId: employeeA.id });
    expect(createA.status).toBe(201);

    // ...but not for Employee B (a different, unassigned site) — direct API call with a
    // manipulated employeeId, not just the intended UI path (the C11 boundary-test pattern).
    const createB = await staffA.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', staffA.csrfToken)
      .send({ employeeId: employeeB.id });
    expect(createB.status).toBe(403);

    const readA = await staffA.agent.get(`/api/v1/payroll-entries/${createA.body.entry.id}`);
    expect(readA.status).toBe(200);

    // Directly created by Master Admin, then Staff A attempts to read it — still 403.
    const entryBByAdmin = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employeeB.id });
    expect(entryBByAdmin.status).toBe(201);

    const readB = await staffA.agent.get(`/api/v1/payroll-entries/${entryBByAdmin.body.entry.id}`);
    expect(readB.status).toBe(403);

    // Listing scoped to the cycle: Staff A only ever sees Site A's entries, even without an
    // explicit siteId filter.
    const list = await staffA.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries`);
    expect(list.status).toBe(200);
    expect(list.body.entries.every((e: { siteId: string }) => e.siteId === siteA.id)).toBe(true);

    // Master Admin sees both.
    const listAdmin = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries`);
    expect(listAdmin.body.entries).toHaveLength(2);
  });

  it('rejects a user with no payroll:entry permission entirely', async () => {
    const admin = await masterAdminAgent('entry-no-perm-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site No Perm');
    const cycle = await makeDraftCycle(admin, 4);
    const employee = await makeEmployee(site.id, unit.id, 'No Perm Employee');
    const noPerm = await noPayrollPermissionAgent('entry-no-perm@test.local', [site.id]);

    const res = await noPerm.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', noPerm.csrfToken)
      .send({ employeeId: employee.id });
    expect(res.status).toBe(403);
  });

  it('updates entry fields with optimistic locking — stale version is rejected with 409', async () => {
    const admin = await masterAdminAgent('entry-update@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Entry Update');
    const cycle = await makeDraftCycle(admin, 5);
    const employee = await makeEmployee(site.id, unit.id, 'Update Employee');

    const created = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id });
    const entryId = created.body.entry.id;
    const originalVersion = created.body.entry.version;

    const update1 = await admin.agent
      .patch(`/api/v1/payroll-entries/${entryId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: originalVersion, allowance: '1500', remarks: 'On temporary deputation' });
    expect(update1.status).toBe(200);
    expect(Number(update1.body.entry.allowance)).toBe(1500);
    expect(update1.body.entry.remarks).toBe('On temporary deputation');
    expect(update1.body.entry.version).toBe(originalVersion + 1);

    // Reusing the now-stale original version must be rejected, not silently applied.
    const staleUpdate = await admin.agent
      .patch(`/api/v1/payroll-entries/${entryId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: originalVersion, fine: '200' });
    expect(staleUpdate.status).toBe(409);

    const auditEntries = await prisma.auditLog.findMany({
      where: { action: 'payroll_entry.updated', entityId: entryId },
    });
    expect(auditEntries.length).toBeGreaterThanOrEqual(1);
    const metadata = auditEntries[0]!.metadata as { changes: Record<string, unknown> };
    expect(metadata.changes).toHaveProperty('allowance');
  });

  it('rejects editing an entry whose cycle is no longer Draft — released payroll is immutable', async () => {
    const admin = await masterAdminAgent('entry-immutable@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Entry Immutable');
    const cycle = await makeDraftCycle(admin, 6);
    const employee = await makeEmployee(site.id, unit.id, 'Immutable Employee');

    const created = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id });

    // No Finalize/Release exists yet in this checkpoint — simulate the cycle having moved past
    // Draft directly, exactly as the carry-forward cycle tests do.
    await prisma.payrollCycle.update({ where: { id: cycle.id }, data: { status: 'RELEASED' } });

    const update = await admin.agent
      .patch(`/api/v1/payroll-entries/${created.body.entry.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: created.body.entry.version, fine: '100' });
    expect(update.status).toBe(400);

    const del = await admin.agent
      .delete(`/api/v1/payroll-entries/${created.body.entry.id}?version=${created.body.entry.version}`)
      .set('x-csrf-token', admin.csrfToken);
    expect(del.status).toBe(400);
  });

  it('deletes an unreleased Draft entry, cascading its work lines, and rejects a stale-version delete', async () => {
    const admin = await masterAdminAgent('entry-delete@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Entry Delete');
    const cycle = await makeDraftCycle(admin, 7);
    const employee = await makeEmployee(site.id, unit.id, 'Delete Employee');

    const created = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id });
    const entryId = created.body.entry.id;

    const staleDelete = await admin.agent
      .delete(`/api/v1/payroll-entries/${entryId}?version=999`)
      .set('x-csrf-token', admin.csrfToken);
    expect(staleDelete.status).toBe(409);

    const del = await admin.agent
      .delete(`/api/v1/payroll-entries/${entryId}?version=${created.body.entry.version}`)
      .set('x-csrf-token', admin.csrfToken);
    expect(del.status).toBe(204);

    const gone = await prisma.payrollEntry.findUnique({ where: { id: entryId } });
    expect(gone).toBeNull();
    const orphanLines = await prisma.payrollEntryWorkLine.findMany({ where: { payrollEntryId: entryId } });
    expect(orphanLines).toHaveLength(0);
  });

  it('adds, updates, and deletes work lines — rejecting a cross-site unit and the last-remaining-line delete', async () => {
    const admin = await masterAdminAgent('workline-crud@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site WorkLine CRUD');
    const otherUnit = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'Second Unit', code: 'U-2' } });
    const { site: otherSite } = await makeSiteWithUnit('Test Site WorkLine CRUD Other');
    const otherSiteUnit = await prisma.projectUnit.findFirstOrThrow({ where: { siteId: otherSite.id } });
    const cycle = await makeDraftCycle(admin, 8);
    const employee = await makeEmployee(site.id, unit.id, 'WorkLine Employee');

    const created = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id });
    const entryId = created.body.entry.id;
    let version = created.body.entry.version;

    // Cross-site unit rejected (application-layer companion to the composite FK).
    const crossSite = await admin.agent
      .post(`/api/v1/payroll-entries/${entryId}/work-lines`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version, unitId: otherSiteUnit.id, days: '5', cycleDays: 30 });
    expect(crossSite.status).toBe(400);

    // Add a second, same-site line — Split by Unit's backend capability.
    const added = await admin.agent
      .post(`/api/v1/payroll-entries/${entryId}/work-lines`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version, unitId: otherUnit.id, days: '10', otHours: '2', cycleDays: 30 });
    expect(added.status).toBe(201);
    expect(added.body.entry.workLines).toHaveLength(2);
    version = added.body.entry.version;

    const secondLine = added.body.entry.workLines.find((l: { unitId: string }) => l.unitId === otherUnit.id);

    const updated = await admin.agent
      .patch(`/api/v1/work-lines/${secondLine.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version, days: '15' });
    expect(updated.status).toBe(200);
    version = updated.body.entry.version;

    const firstLine = updated.body.entry.workLines.find((l: { unitId: string }) => l.unitId === unit.id);

    // Delete the second line back down to one — allowed.
    const deleteSecond = await admin.agent
      .delete(`/api/v1/work-lines/${secondLine.id}?version=${version}`)
      .set('x-csrf-token', admin.csrfToken);
    expect(deleteSecond.status).toBe(200);
    expect(deleteSecond.body.entry.workLines).toHaveLength(1);
    version = deleteSecond.body.entry.version;

    // Deleting the last remaining line is rejected — an entry must always have at least one.
    const deleteLast = await admin.agent
      .delete(`/api/v1/work-lines/${firstLine.id}?version=${version}`)
      .set('x-csrf-token', admin.csrfToken);
    expect(deleteLast.status).toBe(400);

    const finalCount = await prisma.payrollEntryWorkLine.count({ where: { payrollEntryId: entryId } });
    expect(finalCount).toBe(1);
  });
});
