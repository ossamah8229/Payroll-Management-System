import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import * as auditLogService from '../src/modules/audit-log/audit-log.service';
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

  it('Master Data Boundary (Phase 7D, 2026-07-30): banking/designation are seeded from Employee at creation, but a PATCH attempting to edit them has no effect — Employee Registry is the sole editable source', async () => {
    const admin = await masterAdminAgent('entry-banking@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Entry Banking');
    const cycle = await makeDraftCycle(admin, 6);
    // "TB" prefix matches cleanTestData()'s own cleanup filter (tests/helpers.ts).
    const bank = await prisma.bank.create({ data: { code: 'TBENTB', name: 'Entry Banking Test Bank' } });
    const employee = await prisma.employee.create({
      data: {
        name: 'Banking Entry Employee',
        designation: 'Guard',
        siteId: site.id,
        unitId: unit.id,
        grossPay: '30000',
        bankId: bank.id,
        accountNumber: '5551234567',
      },
    });

    const created = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id });
    const entryId = created.body.entry.id;
    expect(created.body.entry.bankId).toBe(bank.id);
    expect(created.body.entry.accountNumber).toBe('5551234567');

    // A PATCH that also includes banking/designation/grossPay fields (as an old client, or a
    // hostile request, might still send) is silently ignored for those specific fields — the
    // schema no longer recognizes them — while any legitimate financial field in the same request
    // still applies normally. This is the checkpoint's "Payroll Entry APIs must not accept or
    // persist changes to employee banking fields" requirement, extended to `grossPay` by Phase 7F
    // (2026-08-04).
    const attempted = await admin.agent
      .patch(`/api/v1/payroll-entries/${entryId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({
        version: created.body.entry.version,
        allowance: '1500',
        iban: 'PK36SCBL0000001123456702',
        bankId: null,
        branchCode: 'HACKED',
        accountNumber: '0000000000',
        designation: 'Hacked Designation',
        grossPay: '999999',
      });
    expect(attempted.status).toBe(200);
    expect(Number(attempted.body.entry.allowance)).toBe(1500);
    // Untouched — still Employee Registry's live values, exactly as before the attempted edit.
    expect(attempted.body.entry.bankId).toBe(bank.id);
    expect(attempted.body.entry.accountNumber).toBe('5551234567');
    expect(attempted.body.entry.iban).toBeNull();
    expect(attempted.body.entry.designation).toBe('Guard');
    expect(Number(attempted.body.entry.grossPay)).toBe(30000);

    const persisted = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entryId } });
    expect(persisted.bankId).toBe(bank.id);
    expect(persisted.accountNumber).toBe('5551234567');
    expect(Number(persisted.grossPay)).toBe(30000);
    expect(persisted.iban).toBeNull();
    expect(persisted.designation).toBe('Guard');
  });

  it('rejects editing a released entry — released payroll is immutable (driven by PayrollEntry.released, not cycle status)', async () => {
    const admin = await masterAdminAgent('entry-immutable@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Entry Immutable');
    const cycle = await makeDraftCycle(admin, 6);
    const employee = await makeEmployee(site.id, unit.id, 'Immutable Employee');

    const created = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id });

    // No dedicated single-entry release action is exercised by this suite — directly mark the
    // entry released, the same pattern the bulk-update immutability test below uses. Immutability
    // is driven by PayrollEntry.released alone (corrected Phase 5 Checkpoint 1 architecture
    // review) — deliberately NOT simulated via cycle.status here, since a held/unreleased entry in
    // a RELEASED cycle must remain editable (see payroll-cycle-finalize.test.ts's own regression
    // coverage for that case).
    await prisma.payrollEntry.update({
      where: { id: created.body.entry.id },
      data: { released: true, releasedAt: new Date(), releasedBy: admin.userId },
    });

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

  describe('"Copy to All" bulk update (Phase 3 Checkpoint 4)', () => {
    it('bulk-applies leaveRate (entry-level) only to entries within the selected sites, in one summary audit entry', async () => {
      const admin = await masterAdminAgent('bulk-leave-rate@test.local');
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site Bulk A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site Bulk B');
      const cycle = await makeDraftCycle(admin, 9);
      const employeeA = await makeEmployee(siteA.id, unitA.id, 'Bulk Employee A');
      const employeeB = await makeEmployee(siteB.id, unitB.id, 'Bulk Employee B');

      const entryA = await admin.agent
        .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ employeeId: employeeA.id });
      const entryB = await admin.agent
        .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ employeeId: employeeB.id });

      const auditCountBefore = await prisma.auditLog.count({ where: { action: 'payroll_entry.bulk_updated' } });

      const bulk = await admin.agent
        .patch(`/api/v1/payroll-cycles/${cycle.id}/entries/bulk`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ siteIds: [siteA.id], field: 'leaveRate', value: '1200.00' });

      expect(bulk.status).toBe(200);
      expect(bulk.body).toEqual({ matchedCount: 1, appliedCount: 1 });

      const refreshedA = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entryA.body.entry.id } });
      const refreshedB = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entryB.body.entry.id } });
      expect(refreshedA.leaveRate?.toString()).toBe('1200');
      expect(refreshedA.version).toBe(entryA.body.entry.version + 1);
      // The other site was never included in `siteIds` — must be completely untouched.
      expect(refreshedB.leaveRate).toBeNull();
      expect(refreshedB.version).toBe(entryB.body.entry.version);

      // Exactly one summary audit entry for the whole bulk action — never one per affected entry.
      const auditCountAfter = await prisma.auditLog.count({ where: { action: 'payroll_entry.bulk_updated' } });
      expect(auditCountAfter - auditCountBefore).toBe(1);
      const auditEntry = await prisma.auditLog.findFirst({
        where: { action: 'payroll_entry.bulk_updated' },
        orderBy: { occurredAt: 'desc' },
      });
      expect(auditEntry?.entityId).toBeNull();
      expect(auditEntry?.metadata).toMatchObject({ appliedCount: 1, matchedCount: 1, field: 'leaveRate' });
    });

    it('bulk-applies cycleDays/otRate only to each entry\'s primary work line, never a split entry\'s secondary line', async () => {
      const admin = await masterAdminAgent('bulk-primary-line@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site Bulk Split');
      const secondUnit = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'Bulk Second Unit', code: 'U-2' } });
      const cycle = await makeDraftCycle(admin, 10);
      const employee = await makeEmployee(site.id, unit.id, 'Bulk Split Employee');

      const created = await admin.agent
        .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ employeeId: employee.id });
      const entryId = created.body.entry.id;

      // Split this entry across a second unit, matching Checkpoint 3's own backend capability.
      const split = await admin.agent
        .post(`/api/v1/payroll-entries/${entryId}/work-lines`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ version: created.body.entry.version, unitId: secondUnit.id, cycleDays: 30 });
      expect(split.status).toBe(201);
      const primaryLineId = split.body.entry.workLines[0].id;
      const secondaryLineId = split.body.entry.workLines[1].id;

      const bulk = await admin.agent
        .patch(`/api/v1/payroll-cycles/${cycle.id}/entries/bulk`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ siteIds: [site.id], field: 'cycleDays', value: 26 });

      expect(bulk.status).toBe(200);
      expect(bulk.body).toEqual({ matchedCount: 1, appliedCount: 1 });

      const primaryLine = await prisma.payrollEntryWorkLine.findUniqueOrThrow({ where: { id: primaryLineId } });
      const secondaryLine = await prisma.payrollEntryWorkLine.findUniqueOrThrow({ where: { id: secondaryLineId } });
      expect(primaryLine.cycleDays).toBe(26);
      // The non-primary line — only ever reachable through the Split by Unit modal — must be
      // completely untouched by the bulk action.
      expect(secondaryLine.cycleDays).toBe(30);
    });

    it('site-scopes the bulk endpoint — a site outside the caller\'s assignment is rejected before any write', async () => {
      const admin = await masterAdminAgent('bulk-rbac-admin@test.local');
      const { site: assignedSite } = await makeSiteWithUnit('Test Site Bulk RBAC Assigned');
      const { site: otherSite, unit: otherUnit } = await makeSiteWithUnit('Test Site Bulk RBAC Other');
      const cycle = await makeDraftCycle(admin, 11);
      const employee = await makeEmployee(otherSite.id, otherUnit.id, 'Bulk RBAC Employee');
      const entry = await admin.agent
        .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ employeeId: employee.id });

      const staff = await payrollStaffAgent('bulk-rbac-staff@test.local', [assignedSite.id]);
      const bulk = await staff.agent
        .patch(`/api/v1/payroll-cycles/${cycle.id}/entries/bulk`)
        .set('x-csrf-token', staff.csrfToken)
        .send({ siteIds: [otherSite.id], field: 'leaveRate', value: '500.00' });

      expect(bulk.status).toBe(403);
      const untouched = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.body.entry.id } });
      expect(untouched.leaveRate).toBeNull();
      expect(untouched.version).toBe(entry.body.entry.version);
    });

    it('skips a released entry regardless of cycle status, but keeps applying to an unreleased entry even after the cycle leaves Draft', async () => {
      const admin = await masterAdminAgent('bulk-locked@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site Bulk Locked');
      const cycle = await makeDraftCycle(admin, 12);
      const employeeReleased = await makeEmployee(site.id, unit.id, 'Bulk Released Employee');
      const employeeOpen = await makeEmployee(site.id, unit.id, 'Bulk Open Employee');

      const releasedEntry = await admin.agent
        .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ employeeId: employeeReleased.id });
      const openEntry = await admin.agent
        .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ employeeId: employeeOpen.id });

      // No Release workflow exists yet — simulate one entry already released directly, the same
      // pattern the single-entity immutability test above uses.
      await prisma.payrollEntry.update({
        where: { id: releasedEntry.body.entry.id },
        data: { released: true, releasedAt: new Date(), releasedBy: admin.userId },
      });

      const bulkWhileOpen = await admin.agent
        .patch(`/api/v1/payroll-cycles/${cycle.id}/entries/bulk`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ siteIds: [site.id], field: 'otRate', value: '150.00' });
      expect(bulkWhileOpen.status).toBe(200);
      // Both entries match the site filter, but only the still-open one is actually editable.
      expect(bulkWhileOpen.body).toEqual({ matchedCount: 2, appliedCount: 1 });

      const stillReleased = await prisma.payrollEntry.findUniqueOrThrow({
        where: { id: releasedEntry.body.entry.id },
      });
      expect(stillReleased.version).toBe(releasedEntry.body.entry.version);

      // Simulate the cycle having finalized (Phase 5 Checkpoint 1) — the corrected rule (final
      // review, 2026-07-14) is that this must NOT block the bulk action outright: an unreleased
      // entry (the still-open one here) stays editable via every mutation surface, including this
      // one, once its cycle leaves Draft. Only `released = true` locks a row, never cycle status.
      await prisma.payrollCycle.update({ where: { id: cycle.id }, data: { status: 'RELEASED' } });
      const bulkAfterFinalize = await admin.agent
        .patch(`/api/v1/payroll-cycles/${cycle.id}/entries/bulk`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ siteIds: [site.id], field: 'otRate', value: '175.00' });
      expect(bulkAfterFinalize.status).toBe(200);
      // Still only the open entry is editable — the released one remains permanently skipped,
      // cycle status notwithstanding.
      expect(bulkAfterFinalize.body).toEqual({ matchedCount: 2, appliedCount: 1 });

      const updatedOpenLine = await prisma.payrollEntryWorkLine.findFirstOrThrow({
        where: { payrollEntryId: openEntry.body.entry.id },
      });
      expect(updatedOpenLine.otRate?.toString()).toBe('175');

      const stillReleasedAfterFinalize = await prisma.payrollEntry.findUniqueOrThrow({
        where: { id: releasedEntry.body.entry.id },
      });
      expect(stillReleasedAfterFinalize.version).toBe(releasedEntry.body.entry.version);
    });

    it('rejects a bulk request with no payroll:entry permission', async () => {
      const admin = await masterAdminAgent('bulk-no-perm-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site Bulk No Perm');
      const cycle = await makeDraftCycle(admin, 1);
      await makeEmployee(site.id, unit.id, 'Bulk No Perm Employee');

      const noPerm = await noPayrollPermissionAgent('bulk-no-perm-staff@test.local', [site.id]);
      const bulk = await noPerm.agent
        .patch(`/api/v1/payroll-cycles/${cycle.id}/entries/bulk`)
        .set('x-csrf-token', noPerm.csrfToken)
        .send({ siteIds: [site.id], field: 'leaveRate', value: '500.00' });

      expect(bulk.status).toBe(403);
    });

    describe('eobiAmount (Post-Checkpoint-1A UAT Stabilization)', () => {
      it('applies the new amount to every matched entry regardless of its own eobiApplicable, without touching applicability anywhere, scoped to selected sites, with an audit record', async () => {
        const admin = await masterAdminAgent('bulk-eobi-amount@test.local');
        const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site Bulk EOBI A');
        const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site Bulk EOBI B');
        const cycle = await makeDraftCycle(admin, 8);
        const employeeApplicable = await makeEmployee(siteA.id, unitA.id, 'Bulk EOBI Applicable');
        const employeeDisabled = await makeEmployee(siteA.id, unitA.id, 'Bulk EOBI Disabled');
        const employeeOtherSite = await makeEmployee(siteB.id, unitB.id, 'Bulk EOBI Other Site');

        const entryApplicable = await admin.agent
          .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
          .set('x-csrf-token', admin.csrfToken)
          .send({ employeeId: employeeApplicable.id });
        const entryDisabled = await admin.agent
          .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
          .set('x-csrf-token', admin.csrfToken)
          .send({ employeeId: employeeDisabled.id });
        const entryOtherSite = await admin.agent
          .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
          .set('x-csrf-token', admin.csrfToken)
          .send({ employeeId: employeeOtherSite.id });

        // Both start at the schema default (400.00, applicable=true) — disable one directly, the
        // same pattern this file already uses for simulating pre-existing state (e.g. the
        // released-entry test above).
        await prisma.payrollEntry.update({
          where: { id: entryDisabled.body.entry.id },
          data: { eobiApplicable: false },
        });

        const bulk = await admin.agent
          .patch(`/api/v1/payroll-cycles/${cycle.id}/entries/bulk`)
          .set('x-csrf-token', admin.csrfToken)
          .send({ siteIds: [siteA.id], field: 'eobiAmount', value: '550.00' });

        expect(bulk.status).toBe(200);
        expect(bulk.body).toEqual({ matchedCount: 2, appliedCount: 2 });

        const refreshedApplicable = await prisma.payrollEntry.findUniqueOrThrow({
          where: { id: entryApplicable.body.entry.id },
        });
        const refreshedDisabled = await prisma.payrollEntry.findUniqueOrThrow({
          where: { id: entryDisabled.body.entry.id },
        });
        const refreshedOtherSite = await prisma.payrollEntry.findUniqueOrThrow({
          where: { id: entryOtherSite.body.entry.id },
        });

        // Amount updated for both matched entries, applicable or not — a disabled row still
        // receives the statutory amount, ready for if/when applicability is re-enabled.
        expect(refreshedApplicable.eobiAmount.toString()).toBe('550');
        expect(refreshedDisabled.eobiAmount.toString()).toBe('550');
        // Applicability itself — on both entries — is completely untouched by this field.
        expect(refreshedApplicable.eobiApplicable).toBe(true);
        expect(refreshedDisabled.eobiApplicable).toBe(false);
        // The other site was never in scope — completely untouched.
        expect(refreshedOtherSite.eobiAmount.toString()).toBe('400');
        expect(refreshedOtherSite.version).toBe(entryOtherSite.body.entry.version);

        // Employee master-data applicability defaults are equally untouched — this is a
        // cycle-specific amount change only, never a master-data write.
        const employeeApplicableAfter = await prisma.employee.findUniqueOrThrow({ where: { id: employeeApplicable.id } });
        const employeeDisabledAfter = await prisma.employee.findUniqueOrThrow({ where: { id: employeeDisabled.id } });
        expect(employeeApplicableAfter.defaultEobiApplicable).toBe(true);
        expect(employeeDisabledAfter.defaultEobiApplicable).toBe(true);

        const auditEntry = await prisma.auditLog.findFirst({
          where: { action: 'payroll_entry.bulk_updated' },
          orderBy: { occurredAt: 'desc' },
        });
        expect(auditEntry?.metadata).toMatchObject({
          field: 'eobiAmount',
          value: '550.00',
          matchedCount: 2,
          appliedCount: 2,
          siteIds: [siteA.id],
          // Both matched entries shared the same schema-default previous amount (400) — a truthful
          // single-value summary, not a fabricated one.
          previousValues: { kind: 'single', value: '400' },
        });
      });

      it('records a truthful "mixed" previous-value summary — never a single fabricated value — when matched entries had different amounts, and "single" when they already agreed', async () => {
        const admin = await masterAdminAgent('bulk-eobi-prevvalues@test.local');
        const { site, unit } = await makeSiteWithUnit('Test Site Bulk EOBI Prev Values');
        // Cycle created BEFORE the employees below (this file's own established convention, see the
        // top-of-file comment) — an employee created afterward is the one case not auto-enrolled by
        // the cycle's own bootstrap, so the explicit POST /entries calls below are each creating the
        // one-and-only entry for that employee, not colliding with an already-bootstrapped one.
        const cycle = await makeDraftCycle(admin, 9);
        const employeeA = await makeEmployee(site.id, unit.id, 'Bulk EOBI Prev A');
        const employeeB = await makeEmployee(site.id, unit.id, 'Bulk EOBI Prev B');
        const employeeC = await makeEmployee(site.id, unit.id, 'Bulk EOBI Prev C');

        const entryA = await admin.agent
          .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
          .set('x-csrf-token', admin.csrfToken)
          .send({ employeeId: employeeA.id });
        const entryB = await admin.agent
          .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
          .set('x-csrf-token', admin.csrfToken)
          .send({ employeeId: employeeB.id });
        const entryC = await admin.agent
          .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
          .set('x-csrf-token', admin.csrfToken)
          .send({ employeeId: employeeC.id });

        // Three genuinely different starting amounts (the realistic case: employees onboarded at
        // different times against whatever the statutory amount was then).
        await prisma.payrollEntry.update({ where: { id: entryA.body.entry.id }, data: { eobiAmount: '300.00' } });
        await prisma.payrollEntry.update({ where: { id: entryB.body.entry.id }, data: { eobiAmount: '400.00' } });
        await prisma.payrollEntry.update({ where: { id: entryC.body.entry.id }, data: { eobiAmount: '450.50' } });

        const bulk = await admin.agent
          .patch(`/api/v1/payroll-cycles/${cycle.id}/entries/bulk`)
          .set('x-csrf-token', admin.csrfToken)
          .send({ siteIds: [site.id], field: 'eobiAmount', value: '600.00' });
        expect(bulk.status).toBe(200);
        expect(bulk.body).toEqual({ matchedCount: 3, appliedCount: 3 });

        const mixedAudit = await prisma.auditLog.findFirst({
          where: { action: 'payroll_entry.bulk_updated' },
          orderBy: { occurredAt: 'desc' },
        });
        // Truthful mixed summary — never a single fabricated "previous value" — bounded (no
        // per-employee breakdown), regardless of how many rows were actually matched.
        expect(mixedAudit?.metadata).toMatchObject({
          previousValues: { kind: 'mixed', distinctCount: 3, minimum: 300, maximum: 450.5 },
        });

        // A second bulk apply now that every row agrees again (all just set to 600) must report
        // "single", not "mixed" — the summary reflects the *current* matched population each time,
        // never a stale record of the first bulk apply.
        const secondBulk = await admin.agent
          .patch(`/api/v1/payroll-cycles/${cycle.id}/entries/bulk`)
          .set('x-csrf-token', admin.csrfToken)
          .send({ siteIds: [site.id], field: 'eobiAmount', value: '650.00' });
        expect(secondBulk.status).toBe(200);
        const singleAgainAudit = await prisma.auditLog.findFirst({
          where: { action: 'payroll_entry.bulk_updated' },
          orderBy: { occurredAt: 'desc' },
        });
        expect(singleAgainAudit?.metadata).toMatchObject({
          previousValues: { kind: 'single', value: '600' },
        });
      });

      it('forces a failure inside the audit insert and proves the whole bulk update rolls back — no partial write, applicability and Employee defaults untouched', async () => {
        const admin = await masterAdminAgent('bulk-eobi-audit-rollback@test.local');
        const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site Bulk EOBI Rollback A');
        const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site Bulk EOBI Rollback B');
        // Cycle created BEFORE the employees below — see the identical note in the previous test.
        const cycle = await makeDraftCycle(admin, 10);
        const employeeApplicable = await makeEmployee(siteA.id, unitA.id, 'Rollback Applicable');
        const employeeDisabled = await makeEmployee(siteA.id, unitA.id, 'Rollback Disabled');
        const employeeOtherSite = await makeEmployee(siteB.id, unitB.id, 'Rollback Other Site');

        const entryApplicable = await admin.agent
          .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
          .set('x-csrf-token', admin.csrfToken)
          .send({ employeeId: employeeApplicable.id });
        const entryDisabled = await admin.agent
          .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
          .set('x-csrf-token', admin.csrfToken)
          .send({ employeeId: employeeDisabled.id });
        const entryOtherSite = await admin.agent
          .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
          .set('x-csrf-token', admin.csrfToken)
          .send({ employeeId: employeeOtherSite.id });
        await prisma.payrollEntry.update({ where: { id: entryDisabled.body.entry.id }, data: { eobiApplicable: false } });

        // Forces the bulk action's own summary audit write to fail, inside the same transaction as
        // the `updateMany` — the established pattern (`eobi-bidirectional-sync.test.ts`). Captured
        // BEFORE `jest.spyOn` replaces the export, or `actual` would resolve to the spy itself.
        const actual = auditLogService.recordAuditLog;
        const spy = jest.spyOn(auditLogService, 'recordAuditLog');
        spy.mockImplementation(async (input, client) => {
          if (input.action === 'payroll_entry.bulk_updated') {
            throw new Error('Simulated failure during bulk EOBI amount audit insert');
          }
          return actual(input, client);
        });

        try {
          const bulk = await admin.agent
            .patch(`/api/v1/payroll-cycles/${cycle.id}/entries/bulk`)
            .set('x-csrf-token', admin.csrfToken)
            .send({ siteIds: [siteA.id], field: 'eobiAmount', value: '999.00' });
          expect(bulk.status).toBe(500);
        } finally {
          spy.mockRestore();
        }

        // Every matched entry retains its original EOBI amount — no partial update survived the
        // forced rollback.
        const refreshedApplicable = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entryApplicable.body.entry.id } });
        const refreshedDisabled = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entryDisabled.body.entry.id } });
        expect(refreshedApplicable.eobiAmount.toString()).toBe('400');
        expect(refreshedApplicable.version).toBe(entryApplicable.body.entry.version);
        expect(refreshedDisabled.eobiAmount.toString()).toBe('400');
        expect(refreshedDisabled.version).toBe(entryDisabled.body.entry.version);
        // Applicability flags are unchanged (this field never touches them anyway, but the rollback
        // must not have disturbed them either).
        expect(refreshedApplicable.eobiApplicable).toBe(true);
        expect(refreshedDisabled.eobiApplicable).toBe(false);

        // The unmatched, out-of-scope site's entry is equally untouched.
        const refreshedOtherSite = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entryOtherSite.body.entry.id } });
        expect(refreshedOtherSite.eobiAmount.toString()).toBe('400');
        expect(refreshedOtherSite.version).toBe(entryOtherSite.body.entry.version);

        // Employee Registry defaults are untouched — this field never writes to Employee at all.
        const employeeApplicableAfter = await prisma.employee.findUniqueOrThrow({ where: { id: employeeApplicable.id } });
        const employeeDisabledAfter = await prisma.employee.findUniqueOrThrow({ where: { id: employeeDisabled.id } });
        expect(employeeApplicableAfter.defaultEobiApplicable).toBe(true);
        expect(employeeDisabledAfter.defaultEobiApplicable).toBe(true);

        // No audit entry survived either — the forced failure happened inside the same transaction
        // as the `updateMany`, so both roll back together, not just the update.
        const auditAfter = await prisma.auditLog.findFirst({
          where: { action: 'payroll_entry.bulk_updated', metadata: { path: ['value'], equals: '999.00' } },
        });
        expect(auditAfter).toBeNull();
      });

      it('rejects a negative or malformed eobiAmount before any write', async () => {
        const admin = await masterAdminAgent('bulk-eobi-invalid@test.local');
        const { site, unit } = await makeSiteWithUnit('Test Site Bulk EOBI Invalid');
        const cycle = await makeDraftCycle(admin, 7);
        const employee = await makeEmployee(site.id, unit.id, 'Bulk EOBI Invalid Employee');
        const entry = await admin.agent
          .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
          .set('x-csrf-token', admin.csrfToken)
          .send({ employeeId: employee.id });

        const bulk = await admin.agent
          .patch(`/api/v1/payroll-cycles/${cycle.id}/entries/bulk`)
          .set('x-csrf-token', admin.csrfToken)
          .send({ siteIds: [site.id], field: 'eobiAmount', value: '-50.00' });

        expect(bulk.status).toBe(400);
        const untouched = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.body.entry.id } });
        expect(untouched.eobiAmount.toString()).toBe('400');
        expect(untouched.version).toBe(entry.body.entry.version);
      });
    });
  });
});
