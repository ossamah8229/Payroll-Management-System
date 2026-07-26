import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { EMPLOYEE_TEMPLATE_HEADERS } from '../src/modules/employees/employees-import-export.service';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

/**
 * Operational Stabilization Checkpoint (2026-07-24) — Defect B regression coverage.
 *
 * Root cause: `bootstrapPayrollEntries` (payroll-processing.service.ts) only ever runs once per
 * cycle, at that cycle's own creation or rollover. An employee created (or reactivated) *after*
 * the current Draft cycle already exists had no automatic path into that cycle's Payroll Entry
 * grid — the only other entry point, `createPayrollEntry` ("add this employee to the cycle"), was
 * a real, working, RBAC-checked endpoint the frontend never called. This was never an RBAC bug:
 * every user, Master Admin included, would see the same absence, because the row simply never
 * existed. `syncEmployeeIntoCurrentDraftCycle` (payroll-processing.service.ts) closes this gap by
 * running inside the same transaction as employee creation/reactivation/import.
 *
 * These tests cover both halves together — the lifecycle sync itself, and (already-correct, now
 * re-confirmed unbroken) RBAC scoping over the resulting rows — since the reported symptom
 * ("Payroll Manager doesn't see expected data") is only fully explained by both.
 */

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

const EMPLOYEE_PERMISSIONS = [PERMISSIONS.EMPLOYEES_VIEW, PERMISSIONS.EMPLOYEES_EDIT, PERMISSIONS.EMPLOYEES_CREATE];
const VIEW_PERMISSIONS = [...EMPLOYEE_PERMISSIONS, PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.PAYROLL_CYCLE_MANAGE];
// Exactly what the real, seeded PAYROLL_STAFF role already carries (shared/src/constants/
// permissions.ts's own ROLE_PERMISSIONS map) — no more. `createTestUser` (helpers.ts) upserts
// permissions onto a role by *code*, additively, and never resets them; granting a real role a
// permission it doesn't already have would permanently pollute that shared role for every other
// test file in the same full-suite run (this is exactly why `payroll-entry.test.ts`'s own
// `noPayrollPermissionAgent` uses a bespoke `TEST_`-prefixed role code instead of a real one — see
// its doc comment). Only a bespoke `TEST_`-prefixed role code below is ever granted anything beyond
// this set.
const PAYROLL_MANAGER_PERMISSIONS = [...EMPLOYEE_PERMISSIONS, PERMISSIONS.PAYROLL_ENTRY];

describe('Draft-cycle employee population lifecycle and RBAC visibility', () => {
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

  async function masterAdminAgent(email: string) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.MASTER_ADMIN,
      permissionKeys: [...VIEW_PERMISSIONS, PERMISSIONS.SITES_MANAGE],
    });
  }

  /** "Payroll Manager" in the report — this system's real role for that persona is the seeded
   * PAYROLL_STAFF role, scoped to specific sites via UserSiteAssignment (matches every other
   * RBAC test in this codebase, e.g. payroll-entry.test.ts's own `payrollStaffAgent`). */
  async function payrollManagerAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.PAYROLL_STAFF,
      permissionKeys: PAYROLL_MANAGER_PERMISSIONS,
      siteIds,
    });
  }

  async function makeDraftCycle(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, month: number) {
    const res = await admin.agent
      .post('/api/v1/payroll-cycles')
      .set('x-csrf-token', admin.csrfToken)
      .send({ year: 2900, month });
    expect(res.status).toBe(201);
    return res.body.cycle as { id: string };
  }

  function employeePayload(siteId: string, unitId: string, overrides: Record<string, unknown> = {}) {
    return {
      name: 'Draft Sync Employee',
      designation: 'Guard',
      siteId,
      unitId,
      grossPay: '32000.00',
      ...overrides,
    };
  }

  async function createEmployeeViaApi(
    admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>,
    siteId: string,
    unitId: string,
    overrides: Record<string, unknown> = {},
  ) {
    const res = await admin.agent
      .post('/api/v1/employees')
      .set('x-csrf-token', admin.csrfToken)
      .send(employeePayload(siteId, unitId, overrides));
    expect(res.status).toBe(201);
    return res.body.employee as { id: string; siteId: string };
  }

  async function entriesForCycle(
    agent: Awaited<ReturnType<typeof createAuthenticatedAgent>>,
    cycleId: string,
    siteId?: string,
  ) {
    const res = await agent.agent
      .get(`/api/v1/payroll-cycles/${cycleId}/entries${siteId ? `?siteId=${siteId}` : ''}`)
      .set('x-csrf-token', agent.csrfToken);
    expect(res.status).toBe(200);
    return res.body.entries as { id: string; employeeId: string; siteId: string }[];
  }

  it(
    'the critical lifecycle case: an employee created at an accessible site after Draft cycle ' +
      'creation appears in that Draft cycle, with no duplicate row',
    async () => {
      const admin = await masterAdminAgent('sync-lifecycle@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site Sync Lifecycle');
      const cycle = await makeDraftCycle(admin, 1);

      // The cycle already exists with zero entries (no pre-existing employees at this site).
      const beforeEntries = await entriesForCycle(admin, cycle.id, site.id);
      expect(beforeEntries).toHaveLength(0);

      const employee = await createEmployeeViaApi(admin, site.id, unit.id);

      const afterEntries = await entriesForCycle(admin, cycle.id, site.id);
      expect(afterEntries).toHaveLength(1);
      expect(afterEntries[0]!.employeeId).toBe(employee.id);

      // No duplicate row — exactly one PayrollEntry for this (cycle, employee) pair.
      const rows = await prisma.payrollEntry.findMany({ where: { cycleId: cycle.id, employeeId: employee.id } });
      expect(rows).toHaveLength(1);
    },
  );

  it('does nothing (no error, no row) when no Draft cycle currently exists', async () => {
    const admin = await masterAdminAgent('sync-no-draft@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Sync No Draft');

    const employee = await createEmployeeViaApi(admin, site.id, unit.id);

    const rows = await prisma.payrollEntry.findMany({ where: { employeeId: employee.id } });
    expect(rows).toHaveLength(0);
  });

  it('a reactivated (rehired) employee is synced into the current Draft cycle the same way a new employee is', async () => {
    const admin = await masterAdminAgent('sync-reactivate@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Sync Reactivate');
    const employee = await createEmployeeViaApi(admin, site.id, unit.id);

    // Depart, then create the Draft cycle (bootstrap excludes departed employees), then reactivate.
    const leftRes = await admin.agent
      .post(`/api/v1/employees/${employee.id}/leave`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ dateOfLeaving: '2026-01-01' });
    expect(leftRes.status).toBe(200);

    const cycle = await makeDraftCycle(admin, 2);
    const beforeReactivate = await prisma.payrollEntry.findMany({ where: { cycleId: cycle.id, employeeId: employee.id } });
    expect(beforeReactivate).toHaveLength(0);

    const reactivateRes = await admin.agent
      .post(`/api/v1/employees/${employee.id}/reactivate`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(reactivateRes.status).toBe(200);

    const afterReactivate = await prisma.payrollEntry.findMany({ where: { cycleId: cycle.id, employeeId: employee.id } });
    expect(afterReactivate).toHaveLength(1);
  });

  it('Master User sees every eligible Draft-cycle employee across every site', async () => {
    const admin = await masterAdminAgent('sync-master-sees-all@test.local');
    const siteA = await makeSiteWithUnit('Test Site Sync Master A');
    const siteB = await makeSiteWithUnit('Test Site Sync Master B');
    const cycle = await makeDraftCycle(admin, 3);
    const empA = await createEmployeeViaApi(admin, siteA.site.id, siteA.unit.id, { name: 'Master Sees A' });
    const empB = await createEmployeeViaApi(admin, siteB.site.id, siteB.unit.id, { name: 'Master Sees B' });

    const entries = await entriesForCycle(admin, cycle.id);
    const employeeIds = entries.map((e) => e.employeeId);
    expect(employeeIds).toEqual(expect.arrayContaining([empA.id, empB.id]));
  });

  it(
    'Payroll Manager assigned to Site A sees an employee newly created at Site A after Draft ' +
      'cycle creation, and never sees an employee exclusively at inaccessible Site B',
    async () => {
      const admin = await masterAdminAgent('sync-manager-a@test.local');
      const siteA = await makeSiteWithUnit('Test Site Sync Manager A');
      const siteB = await makeSiteWithUnit('Test Site Sync Manager B');
      const cycle = await makeDraftCycle(admin, 4);

      const empA = await createEmployeeViaApi(admin, siteA.site.id, siteA.unit.id, { name: 'Manager Sees A' });
      const empB = await createEmployeeViaApi(admin, siteB.site.id, siteB.unit.id, { name: 'Manager Excluded B' });

      const manager = await payrollManagerAgent('sync-manager-a-user@test.local', [siteA.site.id]);
      const entries = await entriesForCycle(manager, cycle.id);
      const employeeIds = entries.map((e) => e.employeeId);

      expect(employeeIds).toContain(empA.id);
      expect(employeeIds).not.toContain(empB.id);
    },
  );

  it('a Payroll Manager assigned to multiple sites sees the union of eligible employees from both', async () => {
    const admin = await masterAdminAgent('sync-manager-union@test.local');
    const siteA = await makeSiteWithUnit('Test Site Sync Union A');
    const siteB = await makeSiteWithUnit('Test Site Sync Union B');
    const siteC = await makeSiteWithUnit('Test Site Sync Union C');
    const cycle = await makeDraftCycle(admin, 5);

    const empA = await createEmployeeViaApi(admin, siteA.site.id, siteA.unit.id, { name: 'Union A' });
    const empB = await createEmployeeViaApi(admin, siteB.site.id, siteB.unit.id, { name: 'Union B' });
    const empC = await createEmployeeViaApi(admin, siteC.site.id, siteC.unit.id, { name: 'Union C' });

    const manager = await payrollManagerAgent('sync-manager-union-user@test.local', [siteA.site.id, siteB.site.id]);
    const entries = await entriesForCycle(manager, cycle.id);
    const employeeIds = entries.map((e) => e.employeeId);

    expect(employeeIds).toEqual(expect.arrayContaining([empA.id, empB.id]));
    expect(employeeIds).not.toContain(empC.id);
  });

  it(
    "sites:manage alone (no employees:view scope, no site assignment) never grants payroll-entry " +
      'visibility beyond assignment — a global permission from a different domain must not widen this one',
    async () => {
      const admin = await masterAdminAgent('sync-sites-manage-scope@test.local');
      const site = await makeSiteWithUnit('Test Site Sync Sites Manage Scope');
      const cycle = await makeDraftCycle(admin, 6);
      await createEmployeeViaApi(admin, site.site.id, site.unit.id, { name: 'Scope Guard' });

      // Holds sites:manage (global for Sites/Units) and payroll:entry, but is assigned to zero
      // sites. A bespoke TEST_-prefixed role code, not the real PAYROLL_STAFF one — sites:manage
      // is not part of that real role's seeded permission set, and granting it there would
      // permanently pollute the shared role for every other test file in the same full-suite run
      // (see PAYROLL_MANAGER_PERMISSIONS's own doc comment above).
      const holder = await createAuthenticatedAgent(app, {
        email: 'sync-sites-manage-holder@test.local',
        password: PASSWORD,
        roleCode: 'TEST_SITES_MANAGE_HOLDER',
        permissionKeys: [PERMISSIONS.SITES_MANAGE, PERMISSIONS.PAYROLL_ENTRY],
        siteIds: [],
      });

      const entries = await entriesForCycle(holder, cycle.id);
      expect(entries).toHaveLength(0);
    },
  );

  it(
    'an employee created at an inaccessible site does not appear for a Payroll Manager, even ' +
      'when they explicitly request that site by id',
    async () => {
      const admin = await masterAdminAgent('sync-inaccessible@test.local');
      const siteA = await makeSiteWithUnit('Test Site Sync Inaccessible A');
      const siteB = await makeSiteWithUnit('Test Site Sync Inaccessible B');
      const cycle = await makeDraftCycle(admin, 7);
      await createEmployeeViaApi(admin, siteB.site.id, siteB.unit.id, { name: 'Inaccessible Employee' });

      const manager = await payrollManagerAgent('sync-inaccessible-user@test.local', [siteA.site.id]);
      const res = await manager.agent
        .get(`/api/v1/payroll-cycles/${cycle.id}/entries?siteId=${siteB.site.id}`)
        .set('x-csrf-token', manager.csrfToken);

      expect(res.status).toBe(403);
    },
  );

  it(
    'a released entry stays unaffected by a later site reassignment — moving an employee between ' +
      "sites never rewrites an already-existing entry's own siteId",
    async () => {
      const admin = await masterAdminAgent('sync-immutability@test.local');
      const siteA = await makeSiteWithUnit('Test Site Sync Immutability A');
      const siteB = await makeSiteWithUnit('Test Site Sync Immutability B');
      const employee = await createEmployeeViaApi(admin, siteA.site.id, siteA.unit.id, { name: 'Transfer Employee' });
      const cycle = await makeDraftCycle(admin, 8);

      const entryBefore = await prisma.payrollEntry.findFirstOrThrow({
        where: { cycleId: cycle.id, employeeId: employee.id },
      });
      expect(entryBefore.siteId).toBe(siteA.site.id);

      // Transfer the employee to Site B — an ordinary edit, not a release/archive event.
      const updateRes = await admin.agent
        .patch(`/api/v1/employees/${employee.id}`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ siteId: siteB.site.id, unitId: siteB.unit.id, transferReason: 'Test transfer' });
      expect(updateRes.status).toBe(200);

      const entryAfter = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entryBefore.id } });
      expect(entryAfter.siteId).toBe(siteA.site.id);
    },
  );

  it('an employee created via the CSV/Excel import path is also synced into the current Draft cycle', async () => {
    const admin = await masterAdminAgent('sync-import@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Sync Import');
    const cycle = await makeDraftCycle(admin, 9);

    // Built from the importer's own canonical header set (rather than a hand-typed copy) so this
    // test can't silently go stale — as a hardcoded 19-column copy previously did — the moment the
    // Employee Registry template contract gains/loses a column (Import Templates checkpoint).
    const row: Record<string, string> = Object.fromEntries(EMPLOYEE_TEMPLATE_HEADERS.map((header) => [header, '']));
    Object.assign(row, {
      'Sr. No': '1',
      Project: site.name,
      Name: 'Import Sync Employee',
      DOJ: '2026-01-01',
      Designation: 'Guard',
      Area: unit.name,
      'Area/Location': unit.name,
      'Basic/Gross Pay': '30000',
      // Required as of the Employee Bank final refinement — a blank cell is now a validation error.
      'Employee Bank': 'Cash',
    });
    const csv = [
      EMPLOYEE_TEMPLATE_HEADERS.join(','),
      EMPLOYEE_TEMPLATE_HEADERS.map((header) => (header === 'Name' ? `"${row[header]}"` : row[header])).join(','),
    ].join('\n');

    const res = await admin.agent
      .post('/api/v1/employees/import')
      .set('x-csrf-token', admin.csrfToken)
      .attach('file', Buffer.from(csv, 'utf-8'), 'employees.csv');

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);

    const employee = await prisma.employee.findFirstOrThrow({ where: { name: 'Import Sync Employee' } });
    const entries = await prisma.payrollEntry.findMany({ where: { cycleId: cycle.id, employeeId: employee.id } });
    expect(entries).toHaveLength(1);
  });
});
