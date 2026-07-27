import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

describe('Phase 4 Checkpoint 2 — Finance Role and Salary Release foundation', () => {
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

  async function payrollStaffAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.PAYROLL_STAFF,
      permissionKeys: [PERMISSIONS.PAYROLL_ENTRY],
      siteIds,
    });
  }

  async function makeSiteWithUnits(name: string, unitNames: string[]) {
    const site = await prisma.projectSite.create({ data: { name } });
    const units = [];
    for (const unitName of unitNames) {
      units.push(
        await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} ${unitName}` } }),
      );
    }
    return { site, units };
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

  async function createEntry(
    admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>,
    cycleId: string,
    employeeId: string,
  ) {
    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycleId}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      // Negative Payroll Recovery checkpoint (2026-07-26) — a default 0-work-day entry now nets
      // -400 (0 earning, the default 400 EOBI deduction) and correctly resolves to RECOVERY_DUE
      // rather than releasing for payment. This suite's tests are about release/lock mechanics,
      // not net-salary sign, so every entry gets enough worked days to net positive by default.
      .send({ employeeId, workLines: [{ days: '26' }] });
    return res.body.entry as { id: string; version: number; workLines: { id: string; unitId: string }[] };
  }

  async function addSecondWorkLine(
    admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>,
    entryId: string,
    version: number,
    unitId: string,
  ) {
    const res = await admin.agent
      .post(`/api/v1/payroll-entries/${entryId}/work-lines`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version, unitId });
    return res.body.entry as { id: string; version: number; workLines: { id: string; unitId: string }[] };
  }

  // --- Permission tests -----------------------------------------------------------------------

  it('rejects Payroll Staff releasing a Unit — Payroll Staff never holds payroll:release', async () => {
    const admin = await masterAdminAgent('release-perm-admin1@test.local');
    const { site, units } = await makeSiteWithUnits('Test Site Release Perm 1', ['Alpha']);
    const cycle = await makeDraftCycle(admin, 1);
    const staff = await payrollStaffAgent('release-perm-staff@test.local', [site.id]);

    const res = await staff.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${units[0]!.id}/release`)
      .set('x-csrf-token', staff.csrfToken)
      .send({});

    expect(res.status).toBe(403);
  });

  it('allows Finance (holding payroll:release) to release a Unit', async () => {
    const admin = await masterAdminAgent('release-perm-admin2@test.local');
    const { site, units } = await makeSiteWithUnits('Test Site Release Perm 2', ['Alpha']);
    const cycle = await makeDraftCycle(admin, 2);
    const finance = await financeAgent('release-perm-finance@test.local', [site.id]);

    const res = await finance.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${units[0]!.id}/release`)
      .set('x-csrf-token', finance.csrfToken)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.release.unitId).toBe(units[0]!.id);
  });

  it('allows Master User to release a Unit — unrestricted access on top of every other role', async () => {
    const admin = await masterAdminAgent('release-perm-admin3@test.local');
    const { units } = await makeSiteWithUnits('Test Site Release Perm 3', ['Alpha']);
    const cycle = await makeDraftCycle(admin, 3);

    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${units[0]!.id}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});

    expect(res.status).toBe(201);
  });

  it('allows both Finance (payroll:view) and Payroll Staff (payroll:entry) to view release status, but rejects a user with neither', async () => {
    const admin = await masterAdminAgent('release-perm-admin4@test.local');
    const { site } = await makeSiteWithUnits('Test Site Release Perm 4', ['Alpha']);
    const cycle = await makeDraftCycle(admin, 4);
    const finance = await financeAgent('release-perm-finance4@test.local', [site.id]);
    const staff = await payrollStaffAgent('release-perm-staff4@test.local', [site.id]);
    const outsider = await createAuthenticatedAgent(app, {
      email: 'release-perm-outsider4@test.local',
      password: PASSWORD,
      roleCode: 'TEST_NO_PAYROLL_VIEW',
      permissionKeys: [PERMISSIONS.EMPLOYEES_VIEW],
      siteIds: [site.id],
    });

    const financeRes = await finance.agent.get(`/api/v1/payroll-cycles/${cycle.id}/units?siteId=${site.id}`);
    const staffRes = await staff.agent.get(`/api/v1/payroll-cycles/${cycle.id}/units?siteId=${site.id}`);
    const outsiderRes = await outsider.agent.get(`/api/v1/payroll-cycles/${cycle.id}/units?siteId=${site.id}`);

    expect(financeRes.status).toBe(200);
    expect(staffRes.status).toBe(200);
    expect(outsiderRes.status).toBe(403);
  });

  // --- Site-scoping boundary tests -------------------------------------------------------------

  it('site-scopes Finance release — a manipulated unitId outside assignment is rejected, in-assignment allowed', async () => {
    const admin = await masterAdminAgent('release-scope-admin@test.local');
    const { site: siteA, units: unitsA } = await makeSiteWithUnits('Test Site Release Scope A', ['Alpha']);
    const { units: unitsB } = await makeSiteWithUnits('Test Site Release Scope B', ['Alpha']);
    const cycle = await makeDraftCycle(admin, 5);
    const financeA = await financeAgent('release-scope-financeA@test.local', [siteA.id]);

    // Direct API call with a unitId outside the Finance user's site assignment — the C11
    // boundary-test pattern this project applies to every site-scoped resource.
    const outOfScope = await financeA.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${unitsB[0]!.id}/release`)
      .set('x-csrf-token', financeA.csrfToken)
      .send({});
    expect(outOfScope.status).toBe(403);

    const inScope = await financeA.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${unitsA[0]!.id}/release`)
      .set('x-csrf-token', financeA.csrfToken)
      .send({});
    expect(inScope.status).toBe(201);
  });

  it('site-scopes Finance viewing release status — outside-assignment siteId is rejected', async () => {
    const admin = await masterAdminAgent('release-scope-view-admin@test.local');
    const { site: siteA } = await makeSiteWithUnits('Test Site Release Scope View A', ['Alpha']);
    const { site: siteB } = await makeSiteWithUnits('Test Site Release Scope View B', ['Alpha']);
    const cycle = await makeDraftCycle(admin, 6);
    const financeA = await financeAgent('release-scope-view-financeA@test.local', [siteA.id]);

    const res = await financeA.agent.get(`/api/v1/payroll-cycles/${cycle.id}/units?siteId=${siteB.id}`);
    expect(res.status).toBe(403);
  });

  // --- Release workflow tests ------------------------------------------------------------------

  it('releases a single-unit entry: sets released/releasedAt/releasedBy and writes both audit entries', async () => {
    const admin = await masterAdminAgent('release-flow-admin@test.local');
    const { site, units } = await makeSiteWithUnits('Test Site Release Flow', ['Alpha']);
    const cycle = await makeDraftCycle(admin, 7);
    const employee = await makeEmployee(site.id, units[0]!.id, 'Flow Employee');
    const entry = await createEntry(admin, cycle.id, employee.id);
    const finance = await financeAgent('release-flow-finance@test.local', [site.id]);

    const res = await finance.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${units[0]!.id}/release`)
      .set('x-csrf-token', finance.csrfToken)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.releasedEntryCount).toBe(1);

    const updated = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(updated.released).toBe(true);
    expect(updated.releasedAt).not.toBeNull();
    expect(updated.releasedBy).toBe(finance.userId);
    expect(updated.version).toBe(entry.version + 1);

    const unitAudit = await prisma.auditLog.findFirst({
      where: { action: 'payroll_unit.released', entityId: res.body.release.id },
    });
    expect(unitAudit).not.toBeNull();

    const entryAudit = await prisma.auditLog.findFirst({
      where: { action: 'payroll_entry.released', entityId: entry.id },
    });
    expect(entryAudit).not.toBeNull();
  });

  it('rejects releasing an already-released Unit cleanly — a service-level guard, not a bare DB constraint failure', async () => {
    const admin = await masterAdminAgent('release-dup-admin@test.local');
    const { units } = await makeSiteWithUnits('Test Site Release Dup', ['Alpha']);
    const cycle = await makeDraftCycle(admin, 8);

    const first = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${units[0]!.id}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(first.status).toBe(201);
    const releaseCountAfterFirst = await prisma.payrollUnitRelease.count({
      where: { cycleId: cycle.id, unitId: units[0]!.id },
    });
    expect(releaseCountAfterFirst).toBe(1);

    // The second call must be rejected by releaseProjectUnit()'s own pre-check
    // (`payroll-release.service.ts`'s existing-row lookup before ever attempting an insert) — a
    // clean, typed `HttpError` (409 CONFLICT, the project's standard business-error shape via
    // `common/http-error.ts`'s `conflict()`), not a raw Postgres unique-constraint violation
    // surfacing as an opaque 500, and not a silent no-op success.
    const second = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${units[0]!.id}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('CONFLICT');
    expect(second.body.error.message).toBe('This Project Unit has already been released for this cycle');

    // No second row was ever inserted — confirms the guard rejected the request before any write,
    // not merely that the HTTP response looked clean while a duplicate row slipped through.
    const releaseCountAfterSecond = await prisma.payrollUnitRelease.count({
      where: { cycleId: cycle.id, unitId: units[0]!.id },
    });
    expect(releaseCountAfterSecond).toBe(1);
  });

  it('rejects a concurrent double-release race cleanly too — the database constraint is a backstop, translated to the same standard error shape, never a raw 500 or a silent duplicate', async () => {
    const admin = await masterAdminAgent('release-race-admin@test.local');
    const { units } = await makeSiteWithUnits('Test Site Release Race', ['Alpha']);
    const cycle = await makeDraftCycle(admin, 9);

    // Two concurrent requests racing the same pre-check-then-insert window — at most one may
    // succeed; the loser must still get the project's standard business-error shape (via the
    // global error handler's P2002 -> 409 translation, `common/middleware/error-handler.ts`), not
    // an unhandled 500.
    const [first, second] = await Promise.all([
      admin.agent
        .post(`/api/v1/payroll-cycles/${cycle.id}/units/${units[0]!.id}/release`)
        .set('x-csrf-token', admin.csrfToken)
        .send({}),
      admin.agent
        .post(`/api/v1/payroll-cycles/${cycle.id}/units/${units[0]!.id}/release`)
        .set('x-csrf-token', admin.csrfToken)
        .send({}),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    const loser = first.status === 409 ? first : second;
    expect(['CONFLICT', 'DUPLICATE']).toContain(loser.body.error.code);

    const releaseCount = await prisma.payrollUnitRelease.count({
      where: { cycleId: cycle.id, unitId: units[0]!.id },
    });
    expect(releaseCount).toBe(1);
  });

  it('holds a multi-unit split entry unreleased until every touched Unit has released', async () => {
    const admin = await masterAdminAgent('release-split-admin@test.local');
    const { site, units } = await makeSiteWithUnits('Test Site Release Split', ['Alpha', 'Beta']);
    const cycle = await makeDraftCycle(admin, 9);
    const employee = await makeEmployee(site.id, units[0]!.id, 'Split Employee');
    const created = await createEntry(admin, cycle.id, employee.id);
    const withSecondLine = await addSecondWorkLine(admin, created.id, created.version, units[1]!.id);
    expect(withSecondLine.workLines).toHaveLength(2);

    const finance = await financeAgent('release-split-finance@test.local', [site.id]);

    // Releasing only Alpha (the first touched Unit) must NOT release the entry — Beta is also
    // touched and hasn't released yet.
    const releaseAlpha = await finance.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${units[0]!.id}/release`)
      .set('x-csrf-token', finance.csrfToken)
      .send({});
    expect(releaseAlpha.status).toBe(201);
    expect(releaseAlpha.body.releasedEntryCount).toBe(0);

    const afterAlpha = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: created.id } });
    expect(afterAlpha.released).toBe(false);

    // Releasing Beta (the last remaining touched Unit) must now release the entry — one entry,
    // one net salary, one downstream document, even though it's split across two Units.
    const releaseBeta = await finance.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${units[1]!.id}/release`)
      .set('x-csrf-token', finance.csrfToken)
      .send({});
    expect(releaseBeta.status).toBe(201);
    expect(releaseBeta.body.releasedEntryCount).toBe(1);

    const afterBeta = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: created.id } });
    expect(afterBeta.released).toBe(true);
  });

  it('never releases a held entry, even after its Unit releases', async () => {
    const admin = await masterAdminAgent('release-hold-admin@test.local');
    const { site, units } = await makeSiteWithUnits('Test Site Release Hold', ['Alpha']);
    const cycle = await makeDraftCycle(admin, 10);
    const employee = await makeEmployee(site.id, units[0]!.id, 'Hold Employee');
    const entry = await createEntry(admin, cycle.id, employee.id);

    const holdRes = await admin.agent
      .patch(`/api/v1/payroll-entries/${entry.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, hold: true });
    expect(holdRes.status).toBe(200);

    const release = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${units[0]!.id}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(release.status).toBe(201);
    expect(release.body.releasedEntryCount).toBe(0);

    const stillDraft = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(stillDraft.released).toBe(false);
    expect(stillDraft.hold).toBe(true);
  });

  it('rejects releasing a Unit whose cycle is not Draft', async () => {
    const admin = await masterAdminAgent('release-nondraft-admin@test.local');
    const { units } = await makeSiteWithUnits('Test Site Release NonDraft', ['Alpha']);
    const cycle = await makeDraftCycle(admin, 11);
    await prisma.payrollCycle.update({ where: { id: cycle.id }, data: { status: 'ARCHIVED' } });

    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${units[0]!.id}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});

    expect(res.status).toBe(400);
  });

  // --- Snapshot integrity tests -----------------------------------------------------------------

  it('freezes a released entry — an ordinary edit is rejected once released', async () => {
    const admin = await masterAdminAgent('release-freeze-admin@test.local');
    const { site, units } = await makeSiteWithUnits('Test Site Release Freeze', ['Alpha']);
    const cycle = await makeDraftCycle(admin, 12);
    const employee = await makeEmployee(site.id, units[0]!.id, 'Freeze Employee');
    const entry = await createEntry(admin, cycle.id, employee.id);

    await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${units[0]!.id}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});

    const released = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });

    const editAttempt = await admin.agent
      .patch(`/api/v1/payroll-entries/${entry.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: released.version, grossPay: '99999' });

    expect(editAttempt.status).toBe(400);
  });

  it('preserves the exact released snapshot even after the employee later changes bank, account, and designation', async () => {
    const admin = await masterAdminAgent('release-snapshot-admin@test.local');
    const { site, units } = await makeSiteWithUnits('Test Site Release Snapshot', ['Alpha']);
    const cycle = await makeDraftCycle(admin, 1);
    const bankBefore = await prisma.bank.create({ data: { code: 'TB1', name: 'Test Bank Before' } });
    const bankAfter = await prisma.bank.create({ data: { code: 'TB2', name: 'Test Bank After' } });
    const employee = await prisma.employee.create({
      data: {
        name: 'Snapshot Employee',
        designation: 'Guard',
        siteId: site.id,
        unitId: units[0]!.id,
        grossPay: '30000',
        bankId: bankBefore.id,
        accountNumber: '1111111111',
        iban: 'PK36SCBL0000001123456702',
      },
    });
    const entry = await createEntry(admin, cycle.id, employee.id);
    const beforeRelease = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(beforeRelease.bankId).toBe(bankBefore.id);
    expect(beforeRelease.accountNumber).toBe('1111111111');
    expect(beforeRelease.iban).toBe('PK36SCBL0000001123456702');
    expect(beforeRelease.designation).toBe('Guard');

    await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${units[0]!.id}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});

    // The employee changes bank, account number, IBAN, and designation AFTER release.
    await prisma.employee.update({
      where: { id: employee.id },
      data: {
        bankId: bankAfter.id,
        accountNumber: '2222222222',
        iban: 'PK99AFTR0000009999999999',
        designation: 'Supervisor',
      },
    });

    // The already-released PayrollEntry must still reflect exactly what it did at release time —
    // Employee changes never cascade into an existing PayrollEntry, released or not
    // (docs/architecture/database/payroll-entry.md §12; banking refinement 2026-07-11: iban
    // snapshots exactly the same way bankId/accountNumber always have).
    const afterEmployeeChange = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(afterEmployeeChange.bankId).toBe(bankBefore.id);
    expect(afterEmployeeChange.accountNumber).toBe('1111111111');
    expect(afterEmployeeChange.iban).toBe('PK36SCBL0000001123456702');
    expect(afterEmployeeChange.designation).toBe('Guard');
    expect(afterEmployeeChange.released).toBe(true);
  });

  // --- Release status summary tests -------------------------------------------------------------

  it('reports entryCount and willReleaseCount correctly before and after a partial release', async () => {
    const admin = await masterAdminAgent('release-status-admin@test.local');
    const { site, units } = await makeSiteWithUnits('Test Site Release Status', ['Alpha', 'Beta']);
    const cycle = await makeDraftCycle(admin, 2);
    const singleUnitEmployee = await makeEmployee(site.id, units[0]!.id, 'Status Single');
    const splitEmployee = await makeEmployee(site.id, units[0]!.id, 'Status Split');
    await createEntry(admin, cycle.id, singleUnitEmployee.id);
    const splitEntry = await createEntry(admin, cycle.id, splitEmployee.id);
    await addSecondWorkLine(admin, splitEntry.id, splitEntry.version, units[1]!.id);

    const finance = await financeAgent('release-status-finance@test.local', [site.id]);

    const before = await finance.agent.get(`/api/v1/payroll-cycles/${cycle.id}/units?siteId=${site.id}`);
    expect(before.status).toBe(200);
    const alphaBefore = before.body.units.find((u: { unit: { id: string } }) => u.unit.id === units[0]!.id);
    expect(alphaBefore.released).toBe(false);
    expect(alphaBefore.entryCount).toBe(2); // single-unit + split entry both touch Alpha
    expect(alphaBefore.willReleaseCount).toBe(1); // only the single-unit entry would release now

    await finance.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${units[0]!.id}/release`)
      .set('x-csrf-token', finance.csrfToken)
      .send({});

    const after = await finance.agent.get(`/api/v1/payroll-cycles/${cycle.id}/units?siteId=${site.id}`);
    const alphaAfter = after.body.units.find((u: { unit: { id: string } }) => u.unit.id === units[0]!.id);
    expect(alphaAfter.released).toBe(true);
    expect(alphaAfter.willReleaseCount).toBe(0);
    const betaAfter = after.body.units.find((u: { unit: { id: string } }) => u.unit.id === units[1]!.id);
    expect(betaAfter.released).toBe(false);
    expect(betaAfter.entryCount).toBe(1); // only the split entry touches Beta
    expect(betaAfter.willReleaseCount).toBe(1); // its only remaining Unit is Beta now
  });
});
