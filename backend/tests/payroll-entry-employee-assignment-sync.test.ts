import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

/**
 * Payroll Deputation Sync — "Apply current assignment" (2026-09-01 business decision).
 *
 * Covers the two halves of the approved design in one suite:
 * (1) the pre-existing "Employee update never cascades into PayrollEntry" rule stays exactly as
 *     frozen — an Employee Registry transfer alone must never touch an existing PayrollEntry;
 * (2) the new, explicit, opt-in `POST /payroll-entries/:id/apply-employee-assignment` action that
 *     lets a Payroll Staff/Master Admin user deliberately copy the employee's current Site/Unit
 *     onto a Draft entry, gated by eligibility (single line, zero attendance, unreleased) and by
 *     site-access on *both* sides of the move.
 */
describe('Payroll Deputation Sync — Apply current assignment to Draft payroll entry', () => {
  const app = createApp();
  const PASSWORD = 'CorrectHorseBattery1!';

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
      permissionKeys: [PERMISSIONS.PAYROLL_CYCLE_MANAGE, PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.EMPLOYEES_EDIT, PERMISSIONS.PAYROLL_RELEASE],
    });
  }

  async function payrollStaffAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.PAYROLL_STAFF,
      permissionKeys: [PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.EMPLOYEES_EDIT],
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
      .send({ year: 2901, month });
    return res.body.cycle as { id: string };
  }

  /** Employee created at Site A, a Draft cycle created afterward (so the cycle bootstrap seeds
   * this employee's own entry, exactly one work line, zero attendance — the ordinary starting
   * shape), then transferred to Site B via the real Employee Registry PATCH path. Returns every
   * id the test bodies need. */
  async function setUpTransferredEmployeeWithDraftEntry(
    admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>,
    month: number,
  ) {
    const { site: siteA, unit: unitA } = await makeSiteWithUnit(`Test Site A m${month}`);
    const { site: siteB, unit: unitB } = await makeSiteWithUnit(`Test Site B m${month}`);
    const employee = await prisma.employee.create({
      data: { name: `Deputation Employee m${month}`, designation: 'Guard', siteId: siteA.id, unitId: unitA.id, grossPay: '30000' },
    });
    const cycle = await makeDraftCycle(admin, month);
    const entry = await prisma.payrollEntry.findFirstOrThrow({ where: { cycleId: cycle.id, employeeId: employee.id } });

    const transferRes = await admin.agent
      .patch(`/api/v1/employees/${employee.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ siteId: siteB.id, unitId: unitB.id, transferReason: 'Client request' });
    expect(transferRes.status).toBe(200);

    return { siteA, unitA, siteB, unitB, employee, cycle, entry };
  }

  it('an Employee Registry transfer alone never mutates the current Draft PayrollEntry — the frozen no-cascade rule still holds', async () => {
    const admin = await masterAdminAgent('sync-no-cascade-admin@test.local');
    const { siteA, unitA, siteB, unitB, employee, entry } = await setUpTransferredEmployeeWithDraftEntry(admin, 1);

    // Immediate read-after-save (no reload workaround): Employee Registry reflects Site B...
    const employeeRes = await admin.agent.get(`/api/v1/employees/${employee.id}`);
    expect(employeeRes.body.employee.siteId).toBe(siteB.id);
    expect(employeeRes.body.employee.unitId).toBe(unitB.id);

    // ...while the Draft entry — read fresh, not from any stale cache — still carries Site A,
    // and the mismatch is visible in the same response (entry.siteId vs entry.employee.siteId).
    const entryRes = await admin.agent.get(`/api/v1/payroll-entries/${entry.id}`);
    expect(entryRes.status).toBe(200);
    expect(entryRes.body.entry.siteId).toBe(siteA.id);
    expect(entryRes.body.entry.workLines).toHaveLength(1);
    expect(entryRes.body.entry.workLines[0].unitId).toBe(unitA.id);
    expect(entryRes.body.entry.employee.siteId).toBe(siteB.id);
    expect(entryRes.body.entry.employee.unitId).toBe(unitB.id);

    // Reporting (Payroll Entry list, the same source Payroll Summary/Dashboard/etc. build on)
    // also still attributes the entry to Site A, never Site B.
    const listRes = await admin.agent.get(`/api/v1/payroll-cycles/${entryRes.body.entry.cycleId}/entries?siteId=${siteA.id}`);
    expect(listRes.body.entries.map((e: { id: string }) => e.id)).toContain(entry.id);
  });

  it('applies the employee’s current assignment to a simple single-line, zero-attendance Draft entry, and reports reflect it immediately', async () => {
    const admin = await masterAdminAgent('sync-apply-admin@test.local');
    const { siteB, unitB, entry } = await setUpTransferredEmployeeWithDraftEntry(admin, 2);

    const applyRes = await admin.agent
      .post(`/api/v1/payroll-entries/${entry.id}/apply-employee-assignment`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version });

    expect(applyRes.status).toBe(200);
    expect(applyRes.body.entry.siteId).toBe(siteB.id);
    expect(applyRes.body.entry.workLines).toHaveLength(1);
    expect(applyRes.body.entry.workLines[0].unitId).toBe(unitB.id);
    expect(applyRes.body.entry.version).toBe(entry.version + 1);

    const auditEntry = await prisma.auditLog.findFirst({
      where: { action: 'payroll_entry.assignment_synced', entityId: entry.id },
    });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry?.metadata).toMatchObject({
      previousSiteId: entry.siteId,
      newSiteId: siteB.id,
      newUnitId: unitB.id,
      origin: 'employee_registry_transfer_sync',
    });

    // Read-after-write, and the report source-of-truth (PayrollEntry.siteId) now agrees with
    // Employee's current assignment, without any report-specific fix — Reports/Dashboard already
    // source PayrollEntry.siteId, per the frozen "reports never read Employee.siteId" rule.
    const listRes = await admin.agent.get(`/api/v1/payroll-cycles/${entry.cycleId}/entries?siteId=${siteB.id}`);
    expect(listRes.body.entries.map((e: { id: string }) => e.id)).toContain(entry.id);

    // Idempotence / already-matching guard — calling it again is rejected, not a silent no-op.
    const secondApply = await admin.agent
      .post(`/api/v1/payroll-entries/${entry.id}/apply-employee-assignment`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version + 1 });
    expect(secondApply.status).toBe(400);
  });

  it('applies a same-site, different-unit transfer just as correctly as a cross-site one', async () => {
    const admin = await masterAdminAgent('sync-same-site-admin@test.local');
    const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site Same-Site A m2b');
    const otherUnit = await prisma.projectUnit.create({ data: { siteId: siteA.id, name: 'Test Site Same-Site A m2b Unit 2', code: 'U-2' } });
    const employee = await prisma.employee.create({
      data: { name: 'Same-Site Unit Transfer Employee', designation: 'Guard', siteId: siteA.id, unitId: unitA.id, grossPay: '30000' },
    });
    const cycle = await makeDraftCycle(admin, 11);
    const entry = await prisma.payrollEntry.findFirstOrThrow({ where: { cycleId: cycle.id, employeeId: employee.id } });

    const transferRes = await admin.agent
      .patch(`/api/v1/employees/${employee.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ unitId: otherUnit.id, transferReason: 'Department change, same site' });
    expect(transferRes.status).toBe(200);

    const applyRes = await admin.agent
      .post(`/api/v1/payroll-entries/${entry.id}/apply-employee-assignment`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version });

    expect(applyRes.status).toBe(200);
    expect(applyRes.body.entry.siteId).toBe(siteA.id);
    expect(applyRes.body.entry.workLines[0].unitId).toBe(otherUnit.id);
  });

  it('rejects the sync when the entry has more than one work line — a split allocation is never silently collapsed', async () => {
    const admin = await masterAdminAgent('sync-split-admin@test.local');
    const { unitB, entry } = await setUpTransferredEmployeeWithDraftEntry(admin, 3);

    // A second, genuinely different unit under the entry's *current* site (Split by Unit), so the
    // split itself is legitimate and must survive this action untouched.
    const secondUnit = await prisma.projectUnit.create({
      data: { siteId: entry.siteId, name: 'Test Site Second Legit Unit m3', code: 'U-2' },
    });
    const splitRes = await admin.agent
      .post(`/api/v1/payroll-entries/${entry.id}/work-lines`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, unitId: secondUnit.id, days: '5' });
    expect(splitRes.status).toBe(201);

    const applyRes = await admin.agent
      .post(`/api/v1/payroll-entries/${entry.id}/apply-employee-assignment`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: splitRes.body.entry.version });
    expect(applyRes.status).toBe(400);
    expect(applyRes.body.error.message).toMatch(/more than one work line/i);

    // Untouched — still two lines, still under the original site, no silent reassignment.
    const untouched = await prisma.payrollEntry.findUniqueOrThrow({
      where: { id: entry.id },
      include: { workLines: true },
    });
    expect(untouched.workLines).toHaveLength(2);
    expect(untouched.siteId).toBe(entry.siteId);
    void unitB;
  });

  it('rejects the sync when the sole work line already carries attendance — genuine days/OT are never silently moved', async () => {
    const admin = await masterAdminAgent('sync-attendance-admin@test.local');
    const { entry } = await setUpTransferredEmployeeWithDraftEntry(admin, 4);

    const withDays = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id }, include: { workLines: true } });
    const lineId = withDays.workLines[0]!.id;
    const daysRes = await admin.agent
      .patch(`/api/v1/work-lines/${lineId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, days: '12' });
    expect(daysRes.status).toBe(200);

    const applyRes = await admin.agent
      .post(`/api/v1/payroll-entries/${entry.id}/apply-employee-assignment`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: daysRes.body.entry.version });
    expect(applyRes.status).toBe(400);
    expect(applyRes.body.error.message).toMatch(/attendance/i);

    const untouched = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id }, include: { workLines: true } });
    expect(untouched.siteId).toBe(entry.siteId);
    expect(untouched.workLines[0]!.unitId).toBe(withDays.workLines[0]!.unitId);
  });

  it('rejects the sync outright on a released entry — historical attribution is immutable, no exception', async () => {
    const admin = await masterAdminAgent('sync-released-admin@test.local');
    const { unitA, entry } = await setUpTransferredEmployeeWithDraftEntry(admin, 5);

    // A normal positive-net entry (attendance recorded), so the release sweep resolves it as
    // ordinarily `released = true`, not the Negative Payroll Recovery `payoutOutcome` path a
    // zero-attendance entry would otherwise take — either way this action must reject it, but this
    // proves the specific "released historical payroll is immutable" branch.
    const withLine = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id }, include: { workLines: true } });
    const attendanceRes = await admin.agent
      .patch(`/api/v1/work-lines/${withLine.workLines[0]!.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, days: '20' });
    expect(attendanceRes.status).toBe(200);

    const releaseRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${entry.cycleId}/units/${unitA.id}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(releaseRes.status).toBe(201);
    expect(releaseRes.body.blockedCount).toBe(0);

    const applyRes = await admin.agent
      .post(`/api/v1/payroll-entries/${entry.id}/apply-employee-assignment`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version });
    expect(applyRes.status).toBe(400);

    const stillA = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(stillA.siteId).toBe(entry.siteId);
    expect(stillA.released).toBe(true);
  });

  it('rejects a stale version — concurrent edits never produce a silent partial sync', async () => {
    const admin = await masterAdminAgent('sync-conflict-admin@test.local');
    const { entry } = await setUpTransferredEmployeeWithDraftEntry(admin, 6);

    // Someone else edits the entry first, bumping its version out from under this caller.
    const otherEdit = await admin.agent
      .patch(`/api/v1/payroll-entries/${entry.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, remarks: 'Concurrent edit' });
    expect(otherEdit.status).toBe(200);

    const staleApply = await admin.agent
      .post(`/api/v1/payroll-entries/${entry.id}/apply-employee-assignment`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version });
    expect(staleApply.status).toBe(409);
  });

  describe('RBAC — both the old and the new site must be authorized, never just one', () => {
    it('allows a Payroll Staff user assigned to both the old and new site', async () => {
      const admin = await masterAdminAgent('sync-rbac-both-admin@test.local');
      const { siteA, siteB, entry } = await setUpTransferredEmployeeWithDraftEntry(admin, 7);
      const staff = await payrollStaffAgent('sync-rbac-both@test.local', [siteA.id, siteB.id]);

      const applyRes = await staff.agent
        .post(`/api/v1/payroll-entries/${entry.id}/apply-employee-assignment`)
        .set('x-csrf-token', staff.csrfToken)
        .send({ version: entry.version });
      expect(applyRes.status).toBe(200);
    });

    it('denies a Payroll Staff user assigned only to the old site (cannot move payroll into a site they cannot manage)', async () => {
      const admin = await masterAdminAgent('sync-rbac-old-admin@test.local');
      const { siteA, entry } = await setUpTransferredEmployeeWithDraftEntry(admin, 8);
      const staff = await payrollStaffAgent('sync-rbac-old@test.local', [siteA.id]);

      const applyRes = await staff.agent
        .post(`/api/v1/payroll-entries/${entry.id}/apply-employee-assignment`)
        .set('x-csrf-token', staff.csrfToken)
        .send({ version: entry.version });
      expect(applyRes.status).toBe(403);
    });

    it('denies a Payroll Staff user assigned only to the new site (cannot reach an entry outside their current access)', async () => {
      const admin = await masterAdminAgent('sync-rbac-new-admin@test.local');
      const { siteB, entry } = await setUpTransferredEmployeeWithDraftEntry(admin, 9);
      const staff = await payrollStaffAgent('sync-rbac-new@test.local', [siteB.id]);

      const applyRes = await staff.agent
        .post(`/api/v1/payroll-entries/${entry.id}/apply-employee-assignment`)
        .set('x-csrf-token', staff.csrfToken)
        .send({ version: entry.version });
      expect(applyRes.status).toBe(403);
    });

    it('denies a Payroll Staff user assigned to neither site', async () => {
      const admin = await masterAdminAgent('sync-rbac-neither-admin@test.local');
      const { entry } = await setUpTransferredEmployeeWithDraftEntry(admin, 10);
      const { site: unrelatedSite } = await makeSiteWithUnit('Test Site Unrelated m10');
      const staff = await payrollStaffAgent('sync-rbac-neither@test.local', [unrelatedSite.id]);

      const applyRes = await staff.agent
        .post(`/api/v1/payroll-entries/${entry.id}/apply-employee-assignment`)
        .set('x-csrf-token', staff.csrfToken)
        .send({ version: entry.version });
      expect(applyRes.status).toBe(403);
    });

    // Hostile-review finding (PR #22 qualification gate) — the outer `assertSiteAccess` check
    // that runs before the transaction is authorized against whatever the employee's site
    // happens to be at the *start* of this request; the transaction then re-reads the employee a
    // second time and writes *that* (freshest) site. If a second, independent transfer commits in
    // the narrow window between those two reads, the outer check alone would have authorized
    // access to a site that is no longer the one actually being written. Forces that exact
    // interleaving deterministically (rather than relying on real concurrency/timing) by making
    // the transaction's own `employee.findUniqueOrThrow` re-read trigger the second transfer as a
    // side effect, so it always lands strictly after the route's own outer RBAC check has already
    // run and strictly before the write. Proves the fix: `assertSiteAccess` re-checked *inside*
    // the transaction against the freshly re-read employee, not just the outer one.
    it('re-validates site access against the freshest employee state read inside the transaction, not just the outer pre-transaction read', async () => {
      const admin = await masterAdminAgent('sync-rbac-toctou-admin@test.local');
      const { siteA, siteB, entry } = await setUpTransferredEmployeeWithDraftEntry(admin, 12);
      const { site: siteC, unit: unitC } = await makeSiteWithUnit('Test Site TOCTOU C m12');
      const staff = await payrollStaffAgent('sync-rbac-toctou@test.local', [siteA.id, siteB.id]);

      const originalFindUniqueOrThrow = prisma.employee.findUniqueOrThrow.bind(prisma.employee);
      const spy = jest.spyOn(prisma.employee, 'findUniqueOrThrow');
      let sawFirstCall = false;
      spy.mockImplementation(async (...args: Parameters<typeof prisma.employee.findUniqueOrThrow>) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (originalFindUniqueOrThrow as any)(...args);
        if (!sawFirstCall) {
          // This is the route's own outer, pre-transaction read (staff has access to siteB, the
          // site this result still reflects) — immediately after it resolves, a second transfer
          // (to a site staff has no access to) is committed directly, so the transaction's own
          // re-read below is guaranteed to see siteC, never siteB.
          sawFirstCall = true;
          await prisma.employee.update({ where: { id: entry.employeeId }, data: { siteId: siteC.id, unitId: unitC.id } });
        }
        return result;
      });

      try {
        const applyRes = await staff.agent
          .post(`/api/v1/payroll-entries/${entry.id}/apply-employee-assignment`)
          .set('x-csrf-token', staff.csrfToken)
          .send({ version: entry.version });

        // Must be rejected — staff was never granted access to siteC, the site actually being
        // written by the time the transaction runs, even though the outer check (against the
        // stale siteB read) would have allowed it.
        expect(applyRes.status).toBe(403);
      } finally {
        spy.mockRestore();
      }

      const untouched = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
      expect(untouched.siteId).toBe(entry.siteId);
    });
  });
});
