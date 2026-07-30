import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import * as auditLogService from '../src/modules/audit-log/audit-log.service';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

/**
 * EOBI Bidirectional Synchronisation (Phase 7D refinement, 2026-07-30; permissions/audit revision
 * the same day).
 *
 * `Employee.defaultEobiApplicable` is the source of truth for an employee's current/default EOBI
 * applicability; the current Draft Payroll Entry may operate on it day to day, but the client
 * requires both locations to stay consistent, so a change on either side now writes to the other
 * too — enforced entirely by `eobi-sync.service.ts`'s `syncEobiApplicability`, called from inside
 * `payroll-entry.service.ts`'s `updatePayrollEntry` and `employees.service.ts`'s `updateEmployee`,
 * always inside the same database transaction as the primary write.
 *
 * **Permission model (revised)**: the synchronised write is an *internal system synchronisation*,
 * not a second user edit — a `payroll:entry` holder changing EOBI applicability via Payroll Entry
 * needs no `employees:edit`, and an `employees:edit` holder changing it via Employee Registry needs
 * no `payroll:entry`. This is not a permission bypass: a user still cannot reach the *opposite*
 * route directly (any field on it) without that route's own permission — proved explicitly below.
 *
 * **Audit (revised)**: every EOBI applicability change on either entity is recorded under one
 * consistent action per entity — `employee.eobi_updated` / `payroll_entry.eobi_updated` — tagged
 * with `metadata.origin` (`'employee_registry'` or `'payroll_entry'`) identifying which screen
 * triggered the operation, whether this particular entity was the one directly edited or the one
 * synchronised as a result. Never folded into, or duplicated alongside, the generic
 * `payroll_entry.updated`/`employee.updated` bundle.
 *
 * Every test (except #7, which is deliberately about the "no Draft cycle yet" case) creates its
 * Draft cycle BEFORE its employee — creating the cycle bootstraps/seeds an entry automatically for
 * every already-existing active employee, so an employee created afterward is the one genuine "not
 * yet enrolled" case the manual POST /entries endpoint is for (matching every other test file in
 * this suite, e.g. `payroll-entry.test.ts`'s own identical convention and rationale).
 */

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

describe('EOBI Bidirectional Synchronisation', () => {
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
      permissionKeys: [PERMISSIONS.PAYROLL_CYCLE_MANAGE, PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.PAYROLL_RELEASE, PERMISSIONS.EMPLOYEES_EDIT],
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

  async function createEntry(
    admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>,
    cycleId: string,
    employeeId: string,
  ) {
    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycleId}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      // Enough worked days to net positive — this suite is about EOBI sync, not net-salary sign.
      .send({ employeeId, workLines: [{ days: '26' }] });
    expect(res.status).toBe(201);
    return res.body.entry as { id: string; version: number; eobiApplicable: boolean };
  }

  it('1. enabling EOBI in a Draft Payroll Entry enables it in Employee Registry, with matching origin-tagged audit entries on both entities', async () => {
    const admin = await masterAdminAgent('eobi-entry-enable-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site EOBI Entry Enable');
    const cycle = await makeDraftCycle(admin, 1);
    const employee = await prisma.employee.create({
      data: { name: 'Entry Enable Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000', defaultEobiApplicable: false },
    });
    const entry = await createEntry(admin, cycle.id, employee.id);
    expect(entry.eobiApplicable).toBe(false);

    const patchRes = await admin.agent
      .patch(`/api/v1/payroll-entries/${entry.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, eobiApplicable: true });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.entry.eobiApplicable).toBe(true);

    const employeeAfter = await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } });
    expect(employeeAfter.defaultEobiApplicable).toBe(true);

    // The entity directly edited (PayrollEntry) gets its own eobi_updated entry, origin: payroll_entry.
    const ownAudit = await prisma.auditLog.findFirst({ where: { action: 'payroll_entry.eobi_updated', entityId: entry.id } });
    expect(ownAudit).not.toBeNull();
    expect(ownAudit!.metadata).toEqual({ previousValue: false, newValue: true, origin: 'payroll_entry' });

    // The synchronised entity (Employee) gets the same action name, same origin, on its own row.
    const syncAudit = await prisma.auditLog.findFirst({ where: { action: 'employee.eobi_updated', entityId: employee.id } });
    expect(syncAudit).not.toBeNull();
    const metadata = syncAudit!.metadata as { previousValue: boolean; newValue: boolean; origin: string; sourcePayrollEntryId: string };
    expect(metadata).toEqual({ previousValue: false, newValue: true, origin: 'payroll_entry', sourcePayrollEntryId: entry.id });

    // Never folded into (or duplicated alongside) the generic bundle.
    const genericAudit = await prisma.auditLog.findFirst({ where: { action: 'employee.updated', entityId: employee.id } });
    expect(genericAudit).toBeNull();
  });

  it('2. disabling EOBI in a Draft Payroll Entry disables it in Employee Registry', async () => {
    const admin = await masterAdminAgent('eobi-entry-disable-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site EOBI Entry Disable');
    const cycle = await makeDraftCycle(admin, 2);
    const employee = await prisma.employee.create({
      data: { name: 'Entry Disable Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000', defaultEobiApplicable: true },
    });
    const entry = await createEntry(admin, cycle.id, employee.id);
    expect(entry.eobiApplicable).toBe(true);

    const patchRes = await admin.agent
      .patch(`/api/v1/payroll-entries/${entry.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, eobiApplicable: false });
    expect(patchRes.status).toBe(200);

    const employeeAfter = await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } });
    expect(employeeAfter.defaultEobiApplicable).toBe(false);
  });

  it('3. enabling EOBI in Employee Registry updates the current Draft Payroll Entry, with matching origin-tagged audit entries on both entities', async () => {
    const admin = await masterAdminAgent('eobi-registry-enable-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site EOBI Registry Enable');
    const cycle = await makeDraftCycle(admin, 3);
    const employee = await prisma.employee.create({
      data: { name: 'Registry Enable Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000', defaultEobiApplicable: false },
    });
    const entry = await createEntry(admin, cycle.id, employee.id);
    expect(entry.eobiApplicable).toBe(false);

    const patchRes = await admin.agent
      .patch(`/api/v1/employees/${employee.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ defaultEobiApplicable: true });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.employee.defaultEobiApplicable).toBe(true);

    const entryAfter = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(entryAfter.eobiApplicable).toBe(true);
    // version bumped — the entry was genuinely written, not silently skipped, and a subsequent
    // client PATCH using a stale version would correctly 409 rather than clobbering this sync.
    expect(entryAfter.version).toBe(entry.version + 1);

    const ownAudit = await prisma.auditLog.findFirst({ where: { action: 'employee.eobi_updated', entityId: employee.id } });
    expect(ownAudit).not.toBeNull();
    expect(ownAudit!.metadata).toEqual({ previousValue: false, newValue: true, origin: 'employee_registry' });

    const syncAudit = await prisma.auditLog.findFirst({ where: { action: 'payroll_entry.eobi_updated', entityId: entry.id } });
    expect(syncAudit).not.toBeNull();
    const metadata = syncAudit!.metadata as { previousValue: boolean; newValue: boolean; origin: string; employeeId: string; cycleId: string };
    expect(metadata).toEqual({ previousValue: false, newValue: true, origin: 'employee_registry', employeeId: employee.id, cycleId: cycle.id });

    const genericAudit = await prisma.auditLog.findFirst({ where: { action: 'payroll_entry.updated', entityId: entry.id } });
    expect(genericAudit).toBeNull();
  });

  it('4. disabling EOBI in Employee Registry updates the current Draft Payroll Entry', async () => {
    const admin = await masterAdminAgent('eobi-registry-disable-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site EOBI Registry Disable');
    const cycle = await makeDraftCycle(admin, 4);
    const employee = await prisma.employee.create({
      data: { name: 'Registry Disable Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000', defaultEobiApplicable: true },
    });
    const entry = await createEntry(admin, cycle.id, employee.id);
    expect(entry.eobiApplicable).toBe(true);

    const patchRes = await admin.agent
      .patch(`/api/v1/employees/${employee.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ defaultEobiApplicable: false });
    expect(patchRes.status).toBe(200);

    const entryAfter = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(entryAfter.eobiApplicable).toBe(false);
  });

  it('5. Employee Registry changes do not modify a Released payroll entry', async () => {
    const admin = await masterAdminAgent('eobi-released-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site EOBI Released');
    const cycle = await makeDraftCycle(admin, 5);
    const employee = await prisma.employee.create({
      data: { name: 'Released Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000', defaultEobiApplicable: true },
    });
    const entry = await createEntry(admin, cycle.id, employee.id);

    const releaseRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${unit.id}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(releaseRes.status).toBe(201);
    expect(releaseRes.body.releasedEntryCount).toBe(1);

    const releasedBefore = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(releasedBefore.released).toBe(true);
    expect(releasedBefore.eobiApplicable).toBe(true);

    // The cycle itself is still nominally `DRAFT` at this point (Finalize hasn't run) — this
    // proves the guard is the *entry's own* released flag, not merely "cycle is not Draft."
    const patchRes = await admin.agent
      .patch(`/api/v1/employees/${employee.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ defaultEobiApplicable: false });
    expect(patchRes.status).toBe(200);

    const releasedAfter = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(releasedAfter.eobiApplicable).toBe(true);
    expect(releasedAfter.version).toBe(releasedBefore.version);

    const syncAudit = await prisma.auditLog.findFirst({ where: { action: 'payroll_entry.eobi_updated', entityId: entry.id } });
    expect(syncAudit).toBeNull();
  });

  it('6. Employee Registry changes do not modify an Archived payroll entry, but do reach the new Draft cycle created by rollover', async () => {
    const admin = await masterAdminAgent('eobi-archived-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site EOBI Archived');
    const cycle = await makeDraftCycle(admin, 6);
    const employee = await prisma.employee.create({
      data: { name: 'Archived Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000', defaultEobiApplicable: true },
    });
    const entry = await createEntry(admin, cycle.id, employee.id);

    await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${unit.id}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});

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
    const newCycleId = rolloverRes.body.newCycle.id as string;
    expect(newCycleId).not.toBe(cycle.id);

    const newEntry = await prisma.payrollEntry.findUniqueOrThrow({
      where: { cycleId_employeeId: { cycleId: newCycleId, employeeId: employee.id } },
    });
    expect(newEntry.eobiApplicable).toBe(true); // carried forward from the archived entry

    const patchRes = await admin.agent
      .patch(`/api/v1/employees/${employee.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ defaultEobiApplicable: false });
    expect(patchRes.status).toBe(200);

    // The archived cycle's own entry is untouched — historical data was never rewritten.
    const archivedEntryAfter = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(archivedEntryAfter.eobiApplicable).toBe(true);
    const archivedCycleAfter = await prisma.payrollCycle.findUniqueOrThrow({ where: { id: cycle.id } });
    expect(archivedCycleAfter.status).toBe('ARCHIVED');

    // The new Draft cycle's own entry, however, is exactly where the checkpoint's synchronisation
    // rule says it should be reached.
    const newEntryAfter = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: newEntry.id } });
    expect(newEntryAfter.eobiApplicable).toBe(false);
  });

  it('7. if no Draft payroll entry exists, an Employee Registry change succeeds and is used as the default when a Draft entry is later created', async () => {
    const admin = await masterAdminAgent('eobi-no-draft-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site EOBI No Draft');
    const employee = await prisma.employee.create({
      data: { name: 'No Draft Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000', defaultEobiApplicable: true },
    });
    // No Draft cycle exists yet at all.
    const noDraftCycle = await prisma.payrollCycle.findFirst({ where: { status: 'DRAFT' } });
    expect(noDraftCycle).toBeNull();

    const patchRes = await admin.agent
      .patch(`/api/v1/employees/${employee.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ defaultEobiApplicable: false });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.employee.defaultEobiApplicable).toBe(false);

    // No incomplete/unintended PayrollEntry was created solely for this synchronisation.
    const entries = await prisma.payrollEntry.findMany({ where: { employeeId: employee.id } });
    expect(entries).toHaveLength(0);

    // A Draft cycle created afterward picks up the retained Employee Registry value as the new
    // entry's default, the same bootstrap path every other Employee field already uses.
    const cycle = await makeDraftCycle(admin, 7);
    const bootstrapped = await prisma.payrollEntry.findUniqueOrThrow({
      where: { cycleId_employeeId: { cycleId: cycle.id, employeeId: employee.id } },
    });
    expect(bootstrapped.eobiApplicable).toBe(false);
  });

  it('8. a failure partway through the synchronised write rolls back the entire operation — neither record, and neither audit entry, ends up changed', async () => {
    const admin = await masterAdminAgent('eobi-rollback-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site EOBI Rollback');
    const cycle = await makeDraftCycle(admin, 8);
    const employee = await prisma.employee.create({
      data: { name: 'Rollback Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000', defaultEobiApplicable: false },
    });
    const entry = await createEntry(admin, cycle.id, employee.id);

    // Forces the *sync's own* audit write to fail, without touching the primary entity's own audit
    // call — a real, reachable failure inside the same transaction as both field writes. Captured
    // BEFORE `jest.spyOn` replaces the export, or `actual` would resolve to the spy itself and
    // recurse infinitely.
    const actual = auditLogService.recordAuditLog;
    const spy = jest.spyOn(auditLogService, 'recordAuditLog');
    spy.mockImplementation(async (input, client) => {
      if (input.action === 'employee.eobi_updated') {
        throw new Error('Simulated failure during EOBI sync');
      }
      return actual(input, client);
    });

    try {
      const patchRes = await admin.agent
        .patch(`/api/v1/payroll-entries/${entry.id}`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ version: entry.version, eobiApplicable: true });
      expect(patchRes.status).toBe(500);
    } finally {
      spy.mockRestore();
    }

    // Neither the entry nor the employee changed — the whole transaction rolled back, including
    // the entry's own `payroll_entry.eobi_updated` entry, which was written *before* the forced
    // failure but still inside the same transaction.
    const entryAfter = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(entryAfter.eobiApplicable).toBe(false);
    expect(entryAfter.version).toBe(entry.version);
    const employeeAfter = await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } });
    expect(employeeAfter.defaultEobiApplicable).toBe(false);

    const ownAudit = await prisma.auditLog.findFirst({ where: { action: 'payroll_entry.eobi_updated', entityId: entry.id } });
    expect(ownAudit).toBeNull();
    const syncAudit = await prisma.auditLog.findFirst({ where: { action: 'employee.eobi_updated', entityId: employee.id } });
    expect(syncAudit).toBeNull();
  });

  it('9a. a user holding only payroll:entry (no employees:edit) can change EOBI applicability via Payroll Entry — the sync is an internal operation, not a second user edit', async () => {
    const admin = await masterAdminAgent('eobi-perm-a-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site EOBI Perm A');
    const cycle = await makeDraftCycle(admin, 9);
    const employee = await prisma.employee.create({
      data: { name: 'Perm A Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000', defaultEobiApplicable: false },
    });
    const entry = await createEntry(admin, cycle.id, employee.id);

    // A bespoke TEST_-prefixed role holding *only* payroll:entry — the real PAYROLL_STAFF role
    // already carries both permissions (upserted, never reset by `createTestUser`), so it can't be
    // used to prove "lacks employees:edit and still succeeds" the way this test needs.
    const holder = await createAuthenticatedAgent(app, {
      email: 'eobi-perm-a-holder@test.local',
      password: PASSWORD,
      roleCode: 'TEST_PAYROLL_ENTRY_ONLY',
      permissionKeys: [PERMISSIONS.PAYROLL_ENTRY],
      siteIds: [site.id],
    });

    const patchRes = await holder.agent
      .patch(`/api/v1/payroll-entries/${entry.id}`)
      .set('x-csrf-token', holder.csrfToken)
      .send({ version: entry.version, eobiApplicable: true });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.entry.eobiApplicable).toBe(true);

    // The sync to Employee Registry still happened, performed by the backend, not by this user
    // directly editing Employee Registry.
    const employeeAfter = await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } });
    expect(employeeAfter.defaultEobiApplicable).toBe(true);
    const syncAudit = await prisma.auditLog.findFirst({ where: { action: 'employee.eobi_updated', entityId: employee.id } });
    expect((syncAudit!.metadata as { origin: string }).origin).toBe('payroll_entry');
  });

  it('9b. a user holding only employees:edit (no payroll:entry) can change EOBI applicability via Employee Registry — the sync is an internal operation, not a second user edit', async () => {
    const admin = await masterAdminAgent('eobi-perm-b-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site EOBI Perm B');
    const cycle = await makeDraftCycle(admin, 10);
    const employee = await prisma.employee.create({
      data: { name: 'Perm B Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000', defaultEobiApplicable: false },
    });
    const entry = await createEntry(admin, cycle.id, employee.id);

    const holder = await createAuthenticatedAgent(app, {
      email: 'eobi-perm-b-holder@test.local',
      password: PASSWORD,
      roleCode: 'TEST_EMPLOYEES_EDIT_ONLY',
      permissionKeys: [PERMISSIONS.EMPLOYEES_EDIT, PERMISSIONS.EMPLOYEES_VIEW],
      siteIds: [site.id],
    });

    const patchRes = await holder.agent
      .patch(`/api/v1/employees/${employee.id}`)
      .set('x-csrf-token', holder.csrfToken)
      .send({ defaultEobiApplicable: true });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.employee.defaultEobiApplicable).toBe(true);

    const entryAfter = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(entryAfter.eobiApplicable).toBe(true);
    const syncAudit = await prisma.auditLog.findFirst({ where: { action: 'payroll_entry.eobi_updated', entityId: entry.id } });
    expect((syncAudit!.metadata as { origin: string }).origin).toBe('employee_registry');
  });

  it('9c. a user without payroll:entry still cannot edit Payroll Entry directly at all — the relaxed EOBI rule never widens this route\'s own permission gate', async () => {
    const admin = await masterAdminAgent('eobi-perm-c-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site EOBI Perm C');
    const cycle = await makeDraftCycle(admin, 11);
    const employee = await prisma.employee.create({
      data: { name: 'Perm C Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000', defaultEobiApplicable: false },
    });
    const entry = await createEntry(admin, cycle.id, employee.id);

    const holder = await createAuthenticatedAgent(app, {
      email: 'eobi-perm-c-holder@test.local',
      password: PASSWORD,
      roleCode: 'TEST_EMPLOYEES_EDIT_ONLY_2',
      permissionKeys: [PERMISSIONS.EMPLOYEES_EDIT],
      siteIds: [site.id],
    });

    // Neither an EOBI change nor an ordinary financial-field edit reaches Payroll Entry without
    // payroll:entry — the route's own existing gate, completely untouched by this refinement.
    const eobiPatch = await holder.agent
      .patch(`/api/v1/payroll-entries/${entry.id}`)
      .set('x-csrf-token', holder.csrfToken)
      .send({ version: entry.version, eobiApplicable: true });
    expect(eobiPatch.status).toBe(403);

    const financialPatch = await holder.agent
      .patch(`/api/v1/payroll-entries/${entry.id}`)
      .set('x-csrf-token', holder.csrfToken)
      .send({ version: entry.version, allowance: '1000' });
    expect(financialPatch.status).toBe(403);

    const entryAfter = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(entryAfter.eobiApplicable).toBe(false);
  });

  it('9d. a user without employees:edit still cannot edit Employee Registry directly at all — the relaxed EOBI rule never widens this route\'s own permission gate', async () => {
    const admin = await masterAdminAgent('eobi-perm-d-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site EOBI Perm D');
    const cycle = await makeDraftCycle(admin, 12);
    const employee = await prisma.employee.create({
      data: { name: 'Perm D Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000', defaultEobiApplicable: false },
    });
    await createEntry(admin, cycle.id, employee.id);

    const holder = await createAuthenticatedAgent(app, {
      email: 'eobi-perm-d-holder@test.local',
      password: PASSWORD,
      roleCode: 'TEST_PAYROLL_ENTRY_ONLY_2',
      permissionKeys: [PERMISSIONS.PAYROLL_ENTRY],
      siteIds: [site.id],
    });

    // Neither an EOBI change nor an ordinary field edit reaches Employee Registry without
    // employees:edit — the route's own existing gate, completely untouched by this refinement.
    const eobiPatch = await holder.agent
      .patch(`/api/v1/employees/${employee.id}`)
      .set('x-csrf-token', holder.csrfToken)
      .send({ defaultEobiApplicable: true });
    expect(eobiPatch.status).toBe(403);

    const namePatch = await holder.agent
      .patch(`/api/v1/employees/${employee.id}`)
      .set('x-csrf-token', holder.csrfToken)
      .send({ designation: 'Senior Guard' });
    expect(namePatch.status).toBe(403);

    const employeeAfter = await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } });
    expect(employeeAfter.defaultEobiApplicable).toBe(false);
  });

  it('10. refreshing either screen after a sync shows the same value in both places', async () => {
    const admin = await masterAdminAgent('eobi-refresh-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site EOBI Refresh');
    const cycle = await makeDraftCycle(admin, 1);
    const employee = await prisma.employee.create({
      data: { name: 'Refresh Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000', defaultEobiApplicable: false },
    });
    const entry = await createEntry(admin, cycle.id, employee.id);

    await admin.agent
      .patch(`/api/v1/payroll-entries/${entry.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, eobiApplicable: true });

    // A fresh GET on each screen — not a cached response, not chained off the write above —
    // both reflect the synced value.
    const employeeGet = await admin.agent.get(`/api/v1/employees/${employee.id}`);
    expect(employeeGet.status).toBe(200);
    expect(employeeGet.body.employee.defaultEobiApplicable).toBe(true);

    const entryGet = await admin.agent.get(`/api/v1/payroll-entries/${entry.id}`);
    expect(entryGet.status).toBe(200);
    expect(entryGet.body.entry.eobiApplicable).toBe(true);

    const listGet = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries?siteId=${site.id}`);
    expect(listGet.status).toBe(200);
    const listedEntry = listGet.body.entries.find((e: { id: string }) => e.id === entry.id);
    expect(listedEntry.eobiApplicable).toBe(true);
  });

  it('11. existing EOBI deduction calculations remain unchanged by the synchronisation mechanism', async () => {
    const admin = await masterAdminAgent('eobi-calc-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site EOBI Calc');
    const cycle = await makeDraftCycle(admin, 2);
    const employee = await prisma.employee.create({
      data: {
        name: 'Calc Employee',
        designation: 'Guard',
        siteId: site.id,
        unitId: unit.id,
        grossPay: '30000',
        defaultEobiApplicable: true,
        defaultEobiAmount: '400.00',
      },
    });
    const entry = await createEntry(admin, cycle.id, employee.id);

    const beforeGet = await admin.agent.get(`/api/v1/payroll-entries/${entry.id}`);
    const netBefore = Number(beforeGet.body.entry.calc.netSalary);
    const eobiDeductionBefore = Number(beforeGet.body.entry.calc.eobiDeduction);
    expect(eobiDeductionBefore).toBe(400);

    // Toggled off via Employee Registry — the sync path, not a direct Payroll Entry edit.
    await admin.agent
      .patch(`/api/v1/employees/${employee.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ defaultEobiApplicable: false });

    const afterGet = await admin.agent.get(`/api/v1/payroll-entries/${entry.id}`);
    expect(afterGet.body.entry.eobiApplicable).toBe(false);
    // eobiAmount itself is untouched by this checkpoint (only applicability synchronises) — the
    // deduction calculation correctly drops to zero because eobiApplicable is now false, using
    // the exact same calcNet formula as before, not a special-cased recalculation.
    expect(Number(afterGet.body.entry.calc.eobiDeduction)).toBe(0);
    expect(Number(afterGet.body.entry.calc.netSalary))
      .toBe(netBefore + eobiDeductionBefore);
  });

  it('12. Payroll release freezes the final EOBI value historically — a later Employee Registry change never reaches it', async () => {
    const admin = await masterAdminAgent('eobi-release-freeze-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site EOBI Release Freeze');
    const cycle = await makeDraftCycle(admin, 3);
    const employee = await prisma.employee.create({
      data: { name: 'Release Freeze Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000', defaultEobiApplicable: true },
    });
    const entry = await createEntry(admin, cycle.id, employee.id);

    // One final Draft-time change, synced correctly right up to the moment of release.
    await admin.agent
      .patch(`/api/v1/payroll-entries/${entry.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, eobiApplicable: false });

    const releaseRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${unit.id}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(releaseRes.status).toBe(201);

    const releasedEntry = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(releasedEntry.released).toBe(true);
    expect(releasedEntry.eobiApplicable).toBe(false);

    // Employee Registry is then changed again, after release.
    await admin.agent
      .patch(`/api/v1/employees/${employee.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ defaultEobiApplicable: true });

    const stillFrozen = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(stillFrozen.eobiApplicable).toBe(false);
    expect(stillFrozen.version).toBe(releasedEntry.version);
  });
});
