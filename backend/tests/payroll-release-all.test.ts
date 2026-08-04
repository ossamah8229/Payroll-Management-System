import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

/**
 * Release All — Phase 7F Checkpoint (2026-08-04).
 *
 * Salary Release previously required releasing every Project Unit one at a time. This adds a bulk
 * "release everything currently eligible" action, scoped to one Site or every accessible Site, that
 * loops the existing, unmodified `releaseProjectUnit` once per not-yet-released Unit — see
 * `payroll-release.service.ts`'s `releaseAllEligible` doc comment for the full transaction-strategy
 * reasoning (one transaction per Unit, sequential, never one giant transaction or one per employee).
 */

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

describe('Release All (Phase 7F, 2026-08-04)', () => {
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
      permissionKeys: [PERMISSIONS.PAYROLL_CYCLE_MANAGE, PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.PAYROLL_RELEASE],
    });
  }

  async function financeAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.FINANCE,
      permissionKeys: [PERMISSIONS.PAYROLL_VIEW, PERMISSIONS.PAYROLL_RELEASE],
      siteIds,
    });
  }

  async function makeSiteWithUnits(name: string, unitNames: string[]) {
    const site = await prisma.projectSite.create({ data: { name } });
    const units = [];
    for (const unitName of unitNames) {
      units.push(await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} ${unitName}` } }));
    }
    return { site, units };
  }

  async function makeEmployee(siteId: string, unitId: string, name: string, grossPay = '30000') {
    return prisma.employee.create({ data: { name, designation: 'Guard', siteId, unitId, grossPay } });
  }

  async function makeDraftCycle(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, month: number) {
    const res = await admin.agent.post('/api/v1/payroll-cycles').set('x-csrf-token', admin.csrfToken).send({ year: 2900, month });
    return res.body.cycle as { id: string };
  }

  async function createEntry(
    admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>,
    cycleId: string,
    employeeId: string,
    days = '26',
  ) {
    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycleId}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      // Non-zero worked days — a zero-day entry nets negative (the flat EOBI deduction with no
      // earned Gross Pay), resolving to RECOVERY_DUE rather than PAID, which would defeat most of
      // this suite's own "released for payment" assertions.
      .send({ employeeId, workLines: [{ days }] });
    return res.body.entry as { id: string; version: number; hold: boolean };
  }

  async function holdEntry(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, entryId: string, version: number) {
    const res = await admin.agent
      .patch(`/api/v1/payroll-entries/${entryId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version, hold: true });
    return res.body.entry;
  }

  function releaseAll(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, cycleId: string, siteId?: string) {
    return admin.agent
      .post(`/api/v1/payroll-cycles/${cycleId}/units/release-all`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ siteId: siteId ?? null });
  }

  // --- Single Site ---------------------------------------------------------------------------

  it('releases every eligible employee across every Unit at one Site, and nothing at another', async () => {
    const admin = await masterAdminAgent('release-all-single-site-admin@test.local');
    const { site: siteA, units: unitsA } = await makeSiteWithUnits('Test Site Release All A', ['Alpha', 'Bravo']);
    const { site: siteB, units: unitsB } = await makeSiteWithUnits('Test Site Release All B', ['Charlie']);
    const cycle = await makeDraftCycle(admin, 1);

    const empA1 = await makeEmployee(siteA.id, unitsA[0]!.id, 'Site A Employee 1');
    const empA2 = await makeEmployee(siteA.id, unitsA[1]!.id, 'Site A Employee 2');
    const empB1 = await makeEmployee(siteB.id, unitsB[0]!.id, 'Site B Employee 1');
    await createEntry(admin, cycle.id, empA1.id);
    await createEntry(admin, cycle.id, empA2.id);
    await createEntry(admin, cycle.id, empB1.id);

    const res = await releaseAll(admin, cycle.id, siteA.id);
    expect(res.status).toBe(201);
    expect(res.body.releasedEntryCount).toBe(2);
    expect(res.body.unitsReleased).toBe(2);

    const releasesA = await prisma.payrollUnitRelease.findMany({ where: { cycleId: cycle.id, unitId: { in: unitsA.map((u) => u.id) } } });
    expect(releasesA).toHaveLength(2);
    const releasesB = await prisma.payrollUnitRelease.findMany({ where: { cycleId: cycle.id, unitId: unitsB[0]!.id } });
    expect(releasesB).toHaveLength(0);

    const entryB = await prisma.payrollEntry.findFirstOrThrow({ where: { cycleId: cycle.id, employeeId: empB1.id } });
    expect(entryB.released).toBe(false);
  });

  // --- All Sites -------------------------------------------------------------------------------

  it('releases every eligible employee across every accessible Site when siteId is omitted ("All Sites")', async () => {
    const admin = await masterAdminAgent('release-all-all-sites-admin@test.local');
    const { site: siteA, units: unitsA } = await makeSiteWithUnits('Test Site Release All Sites A', ['Alpha']);
    const { site: siteB, units: unitsB } = await makeSiteWithUnits('Test Site Release All Sites B', ['Bravo']);
    const cycle = await makeDraftCycle(admin, 2);

    const empA = await makeEmployee(siteA.id, unitsA[0]!.id, 'All Sites Employee A');
    const empB = await makeEmployee(siteB.id, unitsB[0]!.id, 'All Sites Employee B');
    await createEntry(admin, cycle.id, empA.id);
    await createEntry(admin, cycle.id, empB.id);

    const res = await releaseAll(admin, cycle.id);
    expect(res.status).toBe(201);
    expect(res.body.releasedEntryCount).toBe(2);
    expect(res.body.unitsReleased).toBe(2);

    const entryA = await prisma.payrollEntry.findFirstOrThrow({ where: { cycleId: cycle.id, employeeId: empA.id } });
    const entryB = await prisma.payrollEntry.findFirstOrThrow({ where: { cycleId: cycle.id, employeeId: empB.id } });
    expect(entryA.released).toBe(true);
    expect(entryB.released).toBe(true);
  });

  it('"All Sites" for a non-Master-User scopes to exactly their own assigned Sites, never every Site in the system', async () => {
    const admin = await masterAdminAgent('release-all-scope-admin@test.local');
    const { site: assignedSite, units: assignedUnits } = await makeSiteWithUnits('Test Site Release All Scope Assigned', ['Alpha']);
    const { site: otherSite, units: otherUnits } = await makeSiteWithUnits('Test Site Release All Scope Other', ['Bravo']);
    const cycle = await makeDraftCycle(admin, 3);
    const finance = await financeAgent('release-all-scope-finance@test.local', [assignedSite.id]);

    const empAssigned = await makeEmployee(assignedSite.id, assignedUnits[0]!.id, 'Scope Assigned Employee');
    const empOther = await makeEmployee(otherSite.id, otherUnits[0]!.id, 'Scope Other Employee');
    await createEntry(admin, cycle.id, empAssigned.id);
    await createEntry(admin, cycle.id, empOther.id);

    const res = await finance.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/release-all`)
      .set('x-csrf-token', finance.csrfToken)
      .send({ siteId: null });
    expect(res.status).toBe(201);
    expect(res.body.releasedEntryCount).toBe(1);

    const entryAssigned = await prisma.payrollEntry.findFirstOrThrow({ where: { cycleId: cycle.id, employeeId: empAssigned.id } });
    const entryOther = await prisma.payrollEntry.findFirstOrThrow({ where: { cycleId: cycle.id, employeeId: empOther.id } });
    expect(entryAssigned.released).toBe(true);
    expect(entryOther.released).toBe(false); // never touched — outside this Finance user's own scope
  });

  // --- Eligibility skips -------------------------------------------------------------------------

  it('skips Held employees automatically, reports them via heldEntryCount, and never releases them', async () => {
    const admin = await masterAdminAgent('release-all-hold-admin@test.local');
    const { site, units } = await makeSiteWithUnits('Test Site Release All Hold', ['Alpha']);
    const cycle = await makeDraftCycle(admin, 4);
    const heldEmployee = await makeEmployee(site.id, units[0]!.id, 'Held Employee');
    const normalEmployee = await makeEmployee(site.id, units[0]!.id, 'Normal Employee');

    const heldEntry = await createEntry(admin, cycle.id, heldEmployee.id);
    await createEntry(admin, cycle.id, normalEmployee.id);
    await holdEntry(admin, heldEntry.id, heldEntry.version);

    const res = await releaseAll(admin, cycle.id, site.id);
    expect(res.status).toBe(201);
    expect(res.body.releasedEntryCount).toBe(1);
    expect(res.body.heldEntryCount).toBe(1);

    const heldAfter = await prisma.payrollEntry.findFirstOrThrow({ where: { cycleId: cycle.id, employeeId: heldEmployee.id } });
    expect(heldAfter.released).toBe(false);
    expect(heldAfter.hold).toBe(true);
  });

  it('skips an already-Released entry — a second Release All call is idempotent, releasing/counting nothing further', async () => {
    const admin = await masterAdminAgent('release-all-already-released-admin@test.local');
    const { site, units } = await makeSiteWithUnits('Test Site Release All Already Released', ['Alpha']);
    const cycle = await makeDraftCycle(admin, 5);
    const employee = await makeEmployee(site.id, units[0]!.id, 'Already Released Employee');
    await createEntry(admin, cycle.id, employee.id);

    const first = await releaseAll(admin, cycle.id, site.id);
    expect(first.status).toBe(201);
    expect(first.body.releasedEntryCount).toBe(1);
    expect(first.body.unitsReleased).toBe(1);

    const second = await releaseAll(admin, cycle.id, site.id);
    expect(second.status).toBe(201);
    expect(second.body.releasedEntryCount).toBe(0);
    expect(second.body.unitsReleased).toBe(0);
    expect(second.body.unitsAlreadyReleased).toBe(1);
  });

  it('an entry already resolved as NO_PAY_DUE by a prior release is never touched or re-counted by a later Release All in the same scope', async () => {
    const admin = await masterAdminAgent('release-all-no-pay-due-admin@test.local');
    const { site, units } = await makeSiteWithUnits('Test Site Release All No Pay Due', ['Alpha', 'Bravo']);
    const cycle = await makeDraftCycle(admin, 6);
    // Zero worked days ⇒ net salary exactly 0 (no earning, EOBI deduction disabled) ⇒ NO_PAY_DUE.
    const noPayEmployee = await prisma.employee.create({
      data: {
        name: 'No Pay Due Employee',
        designation: 'Guard',
        siteId: site.id,
        unitId: units[0]!.id,
        grossPay: '30000',
        defaultEobiApplicable: false,
      },
    });
    const created = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: noPayEmployee.id, workLines: [{ days: '0' }] });
    const noPayEntry = created.body.entry as { id: string; version: number };
    await admin.agent
      .patch(`/api/v1/payroll-entries/${noPayEntry.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: noPayEntry.version, eobiApplicable: false });

    const normalEmployee = await makeEmployee(site.id, units[1]!.id, 'Normal Employee Bravo Unit');
    await createEntry(admin, cycle.id, normalEmployee.id);

    const first = await releaseAll(admin, cycle.id, site.id);
    expect(first.status).toBe(201);
    expect(first.body.noPayDueCount).toBe(1);
    expect(first.body.releasedEntryCount).toBe(1);
    expect(first.body.unitsReleased).toBe(2);

    const resolvedEntry = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: noPayEntry.id } });
    expect(resolvedEntry.payoutOutcome).toBe('NO_PAY_DUE');

    // Every Unit is now released — a second call has nothing left to do at all.
    const second = await releaseAll(admin, cycle.id, site.id);
    expect(second.status).toBe(201);
    expect(second.body.unitsReleased).toBe(0);
    expect(second.body.unitsAlreadyReleased).toBe(2);
  });

  it('an entry resolving to RECOVERY_DUE creates its BalanceAdjustment exactly once, indistinguishable from a single-Unit release', async () => {
    const admin = await masterAdminAgent('release-all-recovery-due-admin@test.local');
    const { site, units } = await makeSiteWithUnits('Test Site Release All Recovery Due', ['Alpha']);
    const cycle = await makeDraftCycle(admin, 7);
    // Zero worked days, EOBI on (default) ⇒ net salary -400 ⇒ RECOVERY_DUE.
    const employee = await makeEmployee(site.id, units[0]!.id, 'Recovery Due Employee');
    const entry = await createEntry(admin, cycle.id, employee.id, '0');

    const res = await releaseAll(admin, cycle.id, site.id);
    expect(res.status).toBe(201);
    expect(res.body.recoveryDueCount).toBe(1);
    expect(res.body.releasedEntryCount).toBe(0);

    const resolvedEntry = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(resolvedEntry.payoutOutcome).toBe('RECOVERY_DUE');
    const adjustments = await prisma.balanceAdjustment.findMany({ where: { originPayrollEntryId: entry.id } });
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]!.type).toBe('RECOVERY');
  });

  // --- Partial success / rollback isolation -------------------------------------------------------

  it('partial success: continues releasing every remaining Unit after one Unit in scope is a no-op skip (already released by a concurrent action)', async () => {
    const admin = await masterAdminAgent('release-all-partial-admin@test.local');
    const { site, units } = await makeSiteWithUnits('Test Site Release All Partial', ['Alpha', 'Bravo', 'Charlie']);
    const cycle = await makeDraftCycle(admin, 8);
    const emp1 = await makeEmployee(site.id, units[0]!.id, 'Partial Employee 1');
    const emp2 = await makeEmployee(site.id, units[1]!.id, 'Partial Employee 2');
    const emp3 = await makeEmployee(site.id, units[2]!.id, 'Partial Employee 3');
    await createEntry(admin, cycle.id, emp1.id);
    await createEntry(admin, cycle.id, emp2.id);
    await createEntry(admin, cycle.id, emp3.id);

    // Unit Bravo released manually first, simulating a concurrent individual Release that happened
    // moments before this Release All call started.
    await admin.agent.post(`/api/v1/payroll-cycles/${cycle.id}/units/${units[1]!.id}/release`).set('x-csrf-token', admin.csrfToken).send({});

    const res = await releaseAll(admin, cycle.id, site.id);
    expect(res.status).toBe(201);
    expect(res.body.unitsReleased).toBe(2); // Alpha and Charlie
    expect(res.body.unitsAlreadyReleased).toBe(1); // Bravo, skipped not failed
    expect(res.body.unitsFailed).toBe(0);
    // Bravo's own employee was already resolved by the earlier manual release above — this call's
    // own `releasedEntryCount` only counts what *it* resolved (Alpha + Charlie's employees).
    expect(res.body.releasedEntryCount).toBe(2);

    for (const employeeId of [emp1.id, emp2.id, emp3.id]) {
      const entry = await prisma.payrollEntry.findFirstOrThrow({ where: { cycleId: cycle.id, employeeId } });
      expect(entry.released).toBe(true);
    }
  });

  it('rollback isolation: a genuine per-Unit technical failure is reported and skipped, without rolling back or blocking any other, already-succeeded Unit in the same call', async () => {
    const admin = await masterAdminAgent('release-all-failure-admin@test.local');
    const { site, units } = await makeSiteWithUnits('Test Site Release All Failure', ['Alpha', 'Bravo', 'Charlie']);
    const cycle = await makeDraftCycle(admin, 9);
    const emp1 = await makeEmployee(site.id, units[0]!.id, 'Failure Employee 1');
    const failingEmployee = await makeEmployee(site.id, units[1]!.id, 'Failure Employee 2');
    const emp3 = await makeEmployee(site.id, units[2]!.id, 'Failure Employee 3');
    await createEntry(admin, cycle.id, emp1.id);
    await createEntry(admin, cycle.id, failingEmployee.id);
    await createEntry(admin, cycle.id, emp3.id);

    // Forces exactly one Unit's own `releaseProjectUnit` call to throw a genuine, unexpected error
    // (simulating e.g. a transient DB error) — this lookup happens outside `releaseProjectUnit`'s
    // own `$transaction`, on the plain top-level `prisma` client, so it's spyable without
    // intercepting anything inside the transactional client proxy every other Unit still uses
    // untouched.
    const originalFindUnique = prisma.projectUnit.findUnique.bind(prisma.projectUnit);
    const spy = jest.spyOn(prisma.projectUnit, 'findUnique').mockImplementation((async (args: unknown) => {
      const where = (args as { where: { id?: string } }).where;
      if (where.id === units[1]!.id) {
        throw new Error('Simulated transient failure for Unit Bravo');
      }
      return originalFindUnique(args as never);
    }) as typeof prisma.projectUnit.findUnique);

    try {
      const res = await releaseAll(admin, cycle.id, site.id);
      expect(res.status).toBe(201);
      expect(res.body.unitsReleased).toBe(2); // Alpha and Charlie still succeed
      expect(res.body.unitsFailed).toBe(1);
      expect(res.body.failedUnits).toHaveLength(1);
      expect(res.body.failedUnits[0].unitId).toBe(units[1]!.id);
      expect(res.body.failedUnits[0].error).toMatch(/Simulated transient failure/);
      expect(res.body.releasedEntryCount).toBe(2);
    } finally {
      spy.mockRestore();
    }

    // The two successful Units are genuinely, durably released — not rolled back by the third
    // Unit's own failure.
    const entry1 = await prisma.payrollEntry.findFirstOrThrow({ where: { cycleId: cycle.id, employeeId: emp1.id } });
    const entry3 = await prisma.payrollEntry.findFirstOrThrow({ where: { cycleId: cycle.id, employeeId: emp3.id } });
    expect(entry1.released).toBe(true);
    expect(entry3.released).toBe(true);
    const releaseAlpha = await prisma.payrollUnitRelease.findUnique({ where: { cycleId_unitId: { cycleId: cycle.id, unitId: units[0]!.id } } });
    const releaseCharlie = await prisma.payrollUnitRelease.findUnique({ where: { cycleId_unitId: { cycleId: cycle.id, unitId: units[2]!.id } } });
    expect(releaseAlpha).not.toBeNull();
    expect(releaseCharlie).not.toBeNull();

    // The failed Unit itself never got a PayrollUnitRelease row, and its employee stays unresolved
    // (not released, not blocked, not held) — exactly as if it had never been attempted, so a
    // later Release All (or a manual individual release) can still retry it cleanly.
    const releaseBravo = await prisma.payrollUnitRelease.findUnique({ where: { cycleId_unitId: { cycleId: cycle.id, unitId: units[1]!.id } } });
    expect(releaseBravo).toBeNull();
    const failingEntry = await prisma.payrollEntry.findFirstOrThrow({ where: { cycleId: cycle.id, employeeId: failingEmployee.id } });
    expect(failingEntry.released).toBe(false);
    expect(failingEntry.hold).toBe(false);
    expect(failingEntry.payoutOutcome).toBeNull();

    // Retry after the transient failure is fixed — the previously-failed Unit now releases cleanly,
    // and the already-released Units are correctly skipped rather than reprocessed.
    const retry = await releaseAll(admin, cycle.id, site.id);
    expect(retry.status).toBe(201);
    expect(retry.body.unitsReleased).toBe(1);
    expect(retry.body.unitsAlreadyReleased).toBe(2);
    expect(retry.body.unitsFailed).toBe(0);
    const failingEntryAfterRetry = await prisma.payrollEntry.findFirstOrThrow({ where: { cycleId: cycle.id, employeeId: failingEmployee.id } });
    expect(failingEntryAfterRetry.released).toBe(true);
  });

  // --- Blocked entries -----------------------------------------------------------------------

  it('surfaces a blocked entry (missing required banking details) via blockedEntries, tagged with its own Unit and Site, without stopping the rest of the sweep', async () => {
    const admin = await masterAdminAgent('release-all-blocked-admin@test.local');
    const { site, units } = await makeSiteWithUnits('Test Site Release All Blocked', ['Alpha', 'Bravo']);
    const cycle = await makeDraftCycle(admin, 10);
    const bank = await prisma.bank.create({ data: { code: 'TBRALLBLK', name: 'Test Bank Release All Blocked' } });
    // Bank-paid (bankId set) but no Account Number on file — `MISSING_ACCOUNT_NUMBER`, the same
    // deterministic block `payroll-release-eligibility.test.ts` already covers for a single-Unit
    // release (no unique-constraint gymnastics needed, unlike a duplicate-identity scenario).
    const blocked1 = await prisma.employee.create({
      data: { name: 'Blocked Employee 1', designation: 'Guard', siteId: site.id, unitId: units[0]!.id, grossPay: '30000', bankId: bank.id },
    });
    const blocked2 = await prisma.employee.create({
      data: { name: 'Blocked Employee 2', designation: 'Guard', siteId: site.id, unitId: units[0]!.id, grossPay: '30000', bankId: bank.id },
    });
    const cleanEmployee = await makeEmployee(site.id, units[1]!.id, 'Clean Employee');
    await createEntry(admin, cycle.id, blocked1.id);
    await createEntry(admin, cycle.id, blocked2.id);
    await createEntry(admin, cycle.id, cleanEmployee.id);

    const res = await releaseAll(admin, cycle.id, site.id);
    expect(res.status).toBe(201);
    expect(res.body.blockedCount).toBe(2);
    expect(res.body.blockedEntries).toHaveLength(2);
    expect(res.body.blockedEntries.every((entry: { unitId: string }) => entry.unitId === units[0]!.id)).toBe(true);
    // The clean employee at the unaffected Unit still releases normally.
    expect(res.body.releasedEntryCount).toBe(1);
    const cleanEntry = await prisma.payrollEntry.findFirstOrThrow({ where: { cycleId: cycle.id, employeeId: cleanEmployee.id } });
    expect(cleanEntry.released).toBe(true);
  });

  // --- RBAC / cycle status --------------------------------------------------------------------

  it('rejects Release All from a user without payroll:release', async () => {
    const admin = await masterAdminAgent('release-all-rbac-admin@test.local');
    const { site } = await makeSiteWithUnits('Test Site Release All RBAC', ['Alpha']);
    const cycle = await makeDraftCycle(admin, 11);
    const staff = await createAuthenticatedAgent(app, {
      email: 'release-all-rbac-staff@test.local',
      password: PASSWORD,
      roleCode: ROLE_CODES.PAYROLL_STAFF,
      permissionKeys: [PERMISSIONS.PAYROLL_ENTRY],
      siteIds: [site.id],
    });

    const res = await staff.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/release-all`)
      .set('x-csrf-token', staff.csrfToken)
      .send({});
    expect(res.status).toBe(403);
  });

  it('rejects Release All against a cycle that is not the current Draft', async () => {
    const admin = await masterAdminAgent('release-all-not-draft-admin@test.local');
    await makeSiteWithUnits('Test Site Release All Not Draft', ['Alpha']);
    const cycle = await makeDraftCycle(admin, 12);
    await prisma.payrollCycle.update({ where: { id: cycle.id }, data: { status: 'RELEASED' } });

    const res = await releaseAll(admin, cycle.id);
    expect(res.status).toBe(400);
  });

  it('an empty scope (a Site with no Project Units) returns a well-formed all-zero result, not an error', async () => {
    const admin = await masterAdminAgent('release-all-empty-admin@test.local');
    const site = await prisma.projectSite.create({ data: { name: 'Test Site Release All Empty' } });
    const cycle = await makeDraftCycle(admin, 1);

    const res = await releaseAll(admin, cycle.id, site.id);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      releasedEntryCount: 0,
      noPayDueCount: 0,
      recoveryDueCount: 0,
      blockedCount: 0,
      heldEntryCount: 0,
      unitsReleased: 0,
      unitsAlreadyReleased: 0,
      unitsFailed: 0,
    });
  });
});
