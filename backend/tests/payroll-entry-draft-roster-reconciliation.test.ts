import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

/**
 * Draft Payroll Roster Reconciliation checkpoint (2026-07-24) — regression coverage.
 *
 * Closes the residual gap `syncEmployeeIntoCurrentDraftCycle` (Operational Stabilization
 * Checkpoint) cannot: an employee who was already active *before* that fix was deployed never
 * passed through the create/reactivate/import hooks it lives on, so stays permanently missing from
 * an already-open Draft cycle. `reconcileDraftCycleRoster` (payroll-processing.service.ts) closes
 * it as its own explicit, `PAYROLL_CYCLE_MANAGE`-gated cycle-lifecycle action — reusing
 * `syncEmployeeIntoCurrentDraftCycle` verbatim per missing employee, never a second
 * PayrollEntry-creation implementation.
 *
 * These tests create their "predates the sync feature" fixture employees via raw `prisma.employee.
 * create()` (bypassing `employees.service.ts`'s own create/reactivate hooks entirely) — the direct
 * simulation of "this employee's row exists, but nothing ever ran the sync logic for it," which is
 * exactly the state a pre-fix-deployment employee is in.
 */

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

const EMPLOYEE_PERMISSIONS = [PERMISSIONS.EMPLOYEES_VIEW, PERMISSIONS.EMPLOYEES_EDIT, PERMISSIONS.EMPLOYEES_CREATE];
const MASTER_ADMIN_PERMISSIONS = [...EMPLOYEE_PERMISSIONS, PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.PAYROLL_CYCLE_MANAGE, PERMISSIONS.PAYROLL_RELEASE];
// Exactly what the real, seeded PAYROLL_STAFF role already carries — no more. Never granted
// PAYROLL_CYCLE_MANAGE, so the RBAC-boundary test below actually proves something (see
// payroll-entry-draft-cycle-sync.test.ts's own identical note on why this matters for shared-role
// test isolation).
const PAYROLL_MANAGER_PERMISSIONS = [...EMPLOYEE_PERMISSIONS, PERMISSIONS.PAYROLL_ENTRY];

describe('Draft Payroll Roster Reconciliation', () => {
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
      permissionKeys: MASTER_ADMIN_PERMISSIONS,
    });
  }

  async function payrollManagerAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.PAYROLL_STAFF,
      permissionKeys: PAYROLL_MANAGER_PERMISSIONS,
      siteIds,
    });
  }

  async function makeSiteWithUnit(name: string) {
    const site = await prisma.projectSite.create({ data: { name } });
    const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} Unit`, code: 'U-1' } });
    return { site, unit };
  }

  async function makeDraftCycle(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, month: number) {
    const res = await admin.agent
      .post('/api/v1/payroll-cycles')
      .set('x-csrf-token', admin.csrfToken)
      .send({ year: 2900, month });
    expect(res.status).toBe(201);
    return res.body.cycle as { id: string };
  }

  /** Simulates an employee who predates the synchronization feature entirely — a raw row with no
   * sync hook ever having run for it, the exact state a real pre-deployment employee is in. */
  async function makePreExistingEmployee(siteId: string, unitId: string, overrides: Record<string, unknown> = {}) {
    return prisma.employee.create({
      data: {
        name: 'Pre-Existing Employee',
        designation: 'Guard',
        siteId,
        unitId,
        grossPay: '30000',
        ...overrides,
      },
    });
  }

  async function reconcile(
    admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>,
    cycleId: string,
  ) {
    return admin.agent
      .post(`/api/v1/payroll-cycles/${cycleId}/reconcile-roster`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
  }

  it('1. adds an active employee that predates the sync feature and is missing from the current Draft', async () => {
    const admin = await masterAdminAgent('recon-basic@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Recon Basic');
    const cycle = await makeDraftCycle(admin, 1);
    const employee = await makePreExistingEmployee(site.id, unit.id, { name: 'Predates Sync' });

    const before = await prisma.payrollEntry.findMany({ where: { cycleId: cycle.id, employeeId: employee.id } });
    expect(before).toHaveLength(0);

    const res = await reconcile(admin, cycle.id);
    expect(res.status).toBe(200);
    expect(res.body.reconciledCount).toBe(1);
    expect(res.body.reconciledEmployeeIds).toEqual([employee.id]);

    const after = await prisma.payrollEntry.findMany({ where: { cycleId: cycle.id, employeeId: employee.id } });
    expect(after).toHaveLength(1);
    expect(after[0]!.siteId).toBe(site.id);
    expect(after[0]!.grossPay.toString()).toBe('30000');
  });

  it('2. leaves existing Draft PayrollEntry rows completely unchanged, field for field', async () => {
    const admin = await masterAdminAgent('recon-untouched@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Recon Untouched');
    const existingEmployee = await makePreExistingEmployee(site.id, unit.id, { name: 'Already Present' });
    const cycle = await makeDraftCycle(admin, 2);
    // This employee already exists before the cycle, so bootstrap covers it — confirm it already
    // has an entry, then capture that entry's complete field set before reconciliation runs.
    const existingBefore = await prisma.payrollEntry.findFirstOrThrow({
      where: { cycleId: cycle.id, employeeId: existingEmployee.id },
    });

    // A second, genuinely missing employee to give reconciliation something real to do.
    const missingEmployee = await makePreExistingEmployee(site.id, unit.id, { name: 'Missing One' });
    const res = await reconcile(admin, cycle.id);
    expect(res.status).toBe(200);
    expect(res.body.reconciledCount).toBe(1);
    expect(res.body.reconciledEmployeeIds).toEqual([missingEmployee.id]);

    const existingAfter = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: existingBefore.id } });
    expect(existingAfter).toEqual(existingBefore);
  });

  it('3. is idempotent — a second reconciliation of the same cycle reports zero and changes nothing', async () => {
    const admin = await masterAdminAgent('recon-idempotent@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Recon Idempotent');
    const cycle = await makeDraftCycle(admin, 3);
    await makePreExistingEmployee(site.id, unit.id, { name: 'Idempotent Target' });

    const first = await reconcile(admin, cycle.id);
    expect(first.status).toBe(200);
    expect(first.body.reconciledCount).toBe(1);

    const countAfterFirst = await prisma.payrollEntry.count({ where: { cycleId: cycle.id } });

    const second = await reconcile(admin, cycle.id);
    expect(second.status).toBe(200);
    expect(second.body.reconciledCount).toBe(0);
    expect(second.body.reconciledEmployeeIds).toEqual([]);

    const countAfterSecond = await prisma.payrollEntry.count({ where: { cycleId: cycle.id } });
    expect(countAfterSecond).toBe(countAfterFirst);
  });

  it('4. repeated/concurrent reconciliation creates no duplicate PayrollEntry rows', async () => {
    const admin = await masterAdminAgent('recon-no-dup@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Recon No Dup');
    const cycle = await makeDraftCycle(admin, 4);
    const employee = await makePreExistingEmployee(site.id, unit.id, { name: 'No Duplicate Target' });

    // Two reconciliation requests fired concurrently against the same cycle.
    const [resA, resB] = await Promise.all([reconcile(admin, cycle.id), reconcile(admin, cycle.id)]);
    expect([resA.status, resB.status]).toEqual([200, 200]);

    const rows = await prisma.payrollEntry.findMany({ where: { cycleId: cycle.id, employeeId: employee.id } });
    expect(rows).toHaveLength(1);

    // A third, later call confirms the steady state is exactly one row, no duplicate slipped in.
    const third = await reconcile(admin, cycle.id);
    expect(third.body.reconciledCount).toBe(0);
    const rowsAfter = await prisma.payrollEntry.findMany({ where: { cycleId: cycle.id, employeeId: employee.id } });
    expect(rowsAfter).toHaveLength(1);
  });

  it('5. does not modify an already-released entry within an otherwise-Draft cycle', async () => {
    const admin = await masterAdminAgent('recon-released-entry@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Recon Released Entry');
    const releasedEmployee = await makePreExistingEmployee(site.id, unit.id, { name: 'Released Employee' });
    const cycle = await makeDraftCycle(admin, 5);

    const releaseRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${unit.id}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(releaseRes.status).toBe(201);

    const releasedBefore = await prisma.payrollEntry.findFirstOrThrow({
      where: { cycleId: cycle.id, employeeId: releasedEmployee.id },
    });
    expect(releasedBefore.released).toBe(true);

    // A missing employee at a different, still-unreleased unit gives reconciliation real work.
    const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site Recon Released Entry B');
    const missingEmployee = await makePreExistingEmployee(siteB.id, unitB.id, { name: 'Still Missing' });

    const res = await reconcile(admin, cycle.id);
    expect(res.status).toBe(200);
    expect(res.body.reconciledEmployeeIds).toEqual([missingEmployee.id]);

    const releasedAfter = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: releasedBefore.id } });
    expect(releasedAfter).toEqual(releasedBefore);
  });

  it('6. rejects reconciliation against a cycle that is no longer Draft (Released or Archived), creating nothing', async () => {
    const admin = await masterAdminAgent('recon-not-draft@test.local');
    const { unit } = await makeSiteWithUnit('Test Site Recon Not Draft');
    const cycle = await makeDraftCycle(admin, 6);

    const releaseRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${unit.id}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(releaseRes.status).toBe(201);

    const finalizeRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/finalize`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(finalizeRes.status).toBe(200);

    // Now inject a "predates the fix" employee at that same site — as if reconciliation were
    // attempted against this now-Released cycle instead of whatever the real current Draft is.
    const releasedCycleReconcile = await reconcile(admin, cycle.id);
    expect(releasedCycleReconcile.status).toBe(400);
    expect(await prisma.auditLog.count({ where: { action: 'payroll_cycle.roster_reconciled', entityId: cycle.id } })).toBe(0);

    // Roll over to Archive this cycle and create the next Draft, then re-confirm against the now-
    // Archived cycle id specifically (not the new Draft it created).
    const rolloverRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/archive-and-create-next`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(rolloverRes.status).toBe(201);

    const archivedCycleReconcile = await reconcile(admin, cycle.id);
    expect(archivedCycleReconcile.status).toBe(400);
    expect(await prisma.auditLog.count({ where: { action: 'payroll_cycle.roster_reconciled', entityId: cycle.id } })).toBe(0);
  });

  it('7. never introduces an inactive/departed employee, matching the existing eligibility rule', async () => {
    const admin = await masterAdminAgent('recon-inactive@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Recon Inactive');
    const cycle = await makeDraftCycle(admin, 7);
    const departedEmployee = await makePreExistingEmployee(site.id, unit.id, {
      name: 'Departed Employee',
      dateOfLeaving: new Date('2026-01-01T00:00:00.000Z'),
    });

    const res = await reconcile(admin, cycle.id);
    expect(res.status).toBe(200);
    expect(res.body.reconciledCount).toBe(0);

    const rows = await prisma.payrollEntry.findMany({ where: { cycleId: cycle.id, employeeId: departedEmployee.id } });
    expect(rows).toHaveLength(0);
  });

  it("8. does not rewrite an existing entry's own siteId after the employee later transfers sites", async () => {
    const admin = await masterAdminAgent('recon-transfer@test.local');
    const siteA = await makeSiteWithUnit('Test Site Recon Transfer A');
    const siteB = await makeSiteWithUnit('Test Site Recon Transfer B');
    const employee = await makePreExistingEmployee(siteA.site.id, siteA.unit.id, { name: 'Transfer Target' });
    const cycle = await makeDraftCycle(admin, 8);

    const entryBefore = await prisma.payrollEntry.findFirstOrThrow({
      where: { cycleId: cycle.id, employeeId: employee.id },
    });
    expect(entryBefore.siteId).toBe(siteA.site.id);

    const updateRes = await admin.agent
      .patch(`/api/v1/employees/${employee.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ siteId: siteB.site.id, unitId: siteB.unit.id, transferReason: 'Test transfer' });
    expect(updateRes.status).toBe(200);

    const res = await reconcile(admin, cycle.id);
    expect(res.status).toBe(200);
    expect(res.body.reconciledCount).toBe(0);

    const entryAfter = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entryBefore.id } });
    expect(entryAfter.siteId).toBe(siteA.site.id);
  });

  it('9. reconciles multiple missing eligible employees in one pass, correctly', async () => {
    const admin = await masterAdminAgent('recon-multiple@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Recon Multiple');
    const cycle = await makeDraftCycle(admin, 9);
    const empA = await makePreExistingEmployee(site.id, unit.id, { name: 'Multi A', grossPay: '31000' });
    const empB = await makePreExistingEmployee(site.id, unit.id, { name: 'Multi B', grossPay: '32000' });
    const empC = await makePreExistingEmployee(site.id, unit.id, { name: 'Multi C', grossPay: '33000' });

    const res = await reconcile(admin, cycle.id);
    expect(res.status).toBe(200);
    expect(res.body.reconciledCount).toBe(3);
    expect(new Set(res.body.reconciledEmployeeIds)).toEqual(new Set([empA.id, empB.id, empC.id]));

    const rows = await prisma.payrollEntry.findMany({ where: { cycleId: cycle.id }, orderBy: { grossPay: 'asc' } });
    expect(rows.map((r) => r.grossPay.toString())).toEqual(['31000', '32000', '33000']);
  });

  it("10. does not broaden a site-scoped Payroll Manager's own read visibility after a cycle-wide reconciliation", async () => {
    const admin = await masterAdminAgent('recon-rbac-visibility@test.local');
    const siteA = await makeSiteWithUnit('Test Site Recon RBAC A');
    const siteB = await makeSiteWithUnit('Test Site Recon RBAC B');
    const cycle = await makeDraftCycle(admin, 10);
    const empA = await makePreExistingEmployee(siteA.site.id, siteA.unit.id, { name: 'RBAC Visible' });
    const empB = await makePreExistingEmployee(siteB.site.id, siteB.unit.id, { name: 'RBAC Invisible' });

    const res = await reconcile(admin, cycle.id);
    expect(res.status).toBe(200);
    expect(res.body.reconciledCount).toBe(2);

    const manager = await payrollManagerAgent('recon-rbac-visibility-user@test.local', [siteA.site.id]);
    const entriesRes = await manager.agent
      .get(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', manager.csrfToken);
    expect(entriesRes.status).toBe(200);
    const employeeIds = entriesRes.body.entries.map((e: { employeeId: string }) => e.employeeId);
    expect(employeeIds).toContain(empA.id);
    expect(employeeIds).not.toContain(empB.id);
  });

  it('11. rejects a Payroll Manager (holding payroll:entry but not payroll-cycle:manage) from triggering reconciliation at all', async () => {
    const admin = await masterAdminAgent('recon-endpoint-rbac@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Recon Endpoint RBAC');
    const cycle = await makeDraftCycle(admin, 11);
    const employee = await makePreExistingEmployee(site.id, unit.id, { name: 'Endpoint RBAC Target' });

    const manager = await payrollManagerAgent('recon-endpoint-rbac-user@test.local', [site.id]);
    const res = await reconcile(manager, cycle.id);
    expect(res.status).toBe(403);

    const rows = await prisma.payrollEntry.findMany({ where: { cycleId: cycle.id, employeeId: employee.id } });
    expect(rows).toHaveLength(0);
  });
});
