import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

/**
 * Bulk Assignment-Mismatch Readiness Audit (approved 2026-09-28 architecture review) —
 * `GET /api/v1/reports/assignment-mismatch-readiness` and its `/export` sibling. Strictly
 * read-only: every test here only ever asserts on what the endpoint *returns*, never triggers a
 * mutation from it (no Apply, no classification write — none exist on this surface).
 */
describe('Bulk Assignment-Mismatch Readiness Audit', () => {
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
      permissionKeys: [
        PERMISSIONS.PAYROLL_CYCLE_MANAGE,
        PERMISSIONS.PAYROLL_ENTRY,
        PERMISSIONS.PAYROLL_VIEW,
        PERMISSIONS.PAYROLL_RELEASE,
        PERMISSIONS.EMPLOYEES_EDIT,
      ],
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

  /** A user with neither `payroll:entry` nor `payroll:view` — used for the RBAC-gate test. Uses a
   * dedicated `TEST_`-prefixed role code (cleaned every `cleanTestData()` run), never the real,
   * shared `ROLE_CODES.PAYROLL_STAFF` — that role is genuine seed data whose granted permissions
   * accumulate across every test file's own history in a shared local Postgres instance and are
   * never revoked by cleanup (`helpers.ts`'s own `cleanTestData` doc comment), so it can never be
   * relied on to still hold zero permissions by the time this test runs. */
  async function noAccessAgent(email: string) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_AMR_NO_ACCESS',
      permissionKeys: [],
      siteIds: [],
    });
  }

  /** A site-scoped user holding `payroll:view` alone (Finance's read-only grant), never
   * `payroll:entry` — dedicated `TEST_`-prefixed role for the same reason as `noAccessAgent`. */
  async function viewOnlyAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_AMR_VIEW_ONLY',
      permissionKeys: [PERMISSIONS.PAYROLL_VIEW],
      siteIds,
    });
  }

  async function makeSiteWithUnit(name: string) {
    const site = await prisma.projectSite.create({ data: { name } });
    const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} Unit`, code: 'U-1' } });
    return { site, unit };
  }

  async function makeDraftCycle(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, month: number, year = 2902) {
    const res = await admin.agent
      .post('/api/v1/payroll-cycles')
      .set('x-csrf-token', admin.csrfToken)
      .send({ year, month });
    return res.body.cycle as { id: string; year: number; month: number };
  }

  async function transferEmployee(
    admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>,
    employeeId: string,
    siteId: string,
    unitId: string,
  ) {
    const res = await admin.agent
      .patch(`/api/v1/employees/${employeeId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ siteId, unitId, transferReason: 'Client request' });
    expect(res.status).toBe(200);
    return res.body.employee;
  }

  async function fetchAudit(
    agent: Awaited<ReturnType<typeof createAuthenticatedAgent>>,
    cycleId: string,
    extraQuery: Record<string, string> = {},
  ) {
    const query = new URLSearchParams({ cycleId, ...extraQuery }).toString();
    return agent.agent.get(`/api/v1/reports/assignment-mismatch-readiness?${query}`);
  }

  /** Employee created at Site A/Unit A, a Draft cycle created afterward (auto-seeding this
   * employee's own single-line, zero-attendance entry) — the ordinary starting shape every
   * mismatch scenario below builds on. */
  async function setUpDraftEntry(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, month: number, siteName: string) {
    const { site, unit } = await makeSiteWithUnit(siteName);
    const employee = await prisma.employee.create({
      data: { name: `Employee ${siteName}`, designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });
    const cycle = await makeDraftCycle(admin, month);
    const entry = await prisma.payrollEntry.findFirstOrThrow({ where: { cycleId: cycle.id, employeeId: employee.id } });
    return { site, unit, employee, cycle, entry };
  }

  // --- Predicate coverage -----------------------------------------------------------------------

  it('flags the Site mismatch predicate correctly when the employee moves to a different Site', async () => {
    // A `ProjectUnit` always belongs to exactly one Site (composite FK), so any genuine Site
    // change necessarily also changes the Unit id — this test isolates and asserts the
    // `siteMismatch` flag's own correctness; the Unit-only branch is isolated separately below
    // (same Site, different Unit) and both branches together in the "combined" test.
    const admin = await masterAdminAgent('amr-site-only-admin@test.local');
    const { site, employee, cycle, entry } = await setUpDraftEntry(admin, 1, 'Test Site AMR Site Only');
    const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site AMR Site Only B');
    await transferEmployee(admin, employee.id, siteB.id, unitB.id);

    const res = await fetchAudit(admin, cycle.id);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    const row = res.body.rows[0];
    expect(row.payrollEntryId).toBe(entry.id);
    expect(row.siteMismatch).toBe(true);
    expect(row.payrollSiteId).toBe(site.id);
    expect(row.currentEmployeeSiteId).toBe(siteB.id);
  });

  it('flags a Unit-only mismatch when the Site is unchanged', async () => {
    const admin = await masterAdminAgent('amr-unit-only-admin@test.local');
    const { site, unit, employee, cycle, entry } = await setUpDraftEntry(admin, 2, 'Test Site AMR Unit Only');
    const otherUnit = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'Second Unit', code: 'U-2' } });

    await transferEmployee(admin, employee.id, site.id, otherUnit.id);

    const res = await fetchAudit(admin, cycle.id);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    const row = res.body.rows[0];
    expect(row.payrollEntryId).toBe(entry.id);
    expect(row.siteMismatch).toBe(false);
    expect(row.unitMismatch).toBe(true);
    expect(row.payrollSiteId).toBe(site.id);
    expect(row.currentEmployeeSiteId).toBe(site.id);
    expect(row.workLines).toHaveLength(1);
    expect(row.workLines[0].unit.id).toBe(unit.id);
    expect(row.workLines[0].unitMismatch).toBe(true);
    expect(row.currentEmployeeUnit.id).toBe(otherUnit.id);
    expect(row.shape).toBe('SINGLE_LINE');
    expect(row.safeOneClickShape).toBe(true);
  });

  it('flags a combined Site + Unit mismatch', async () => {
    const admin = await masterAdminAgent('amr-combined-admin@test.local');
    const { cycle, entry, employee } = await setUpDraftEntry(admin, 3, 'Test Site AMR Combined');
    const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site AMR Combined B');

    await transferEmployee(admin, employee.id, siteB.id, unitB.id);

    const res = await fetchAudit(admin, cycle.id);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    const row = res.body.rows[0];
    expect(row.payrollEntryId).toBe(entry.id);
    expect(row.siteMismatch).toBe(true);
    expect(row.unitMismatch).toBe(true);
  });

  it('does not flag an entry whose payroll attribution already matches the employee', async () => {
    const admin = await masterAdminAgent('amr-no-mismatch-admin@test.local');
    const { cycle } = await setUpDraftEntry(admin, 4, 'Test Site AMR No Mismatch');

    const res = await fetchAudit(admin, cycle.id);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.rows).toEqual([]);
  });

  it('REGRESSION: a split entry whose primary line matches the employee Unit but a secondary line diverges must still appear', async () => {
    const admin = await masterAdminAgent('amr-split-regression-admin@test.local');
    const { site, unit, cycle, entry } = await setUpDraftEntry(admin, 5, 'Test Site AMR Split Regression');
    const secondUnit = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'Second Unit', code: 'U-2' } });

    // Split by Unit — second work line at a Unit the employee is NOT currently assigned to, while
    // the primary line (sortOrder 0) stays exactly the employee's own current Unit. A predicate
    // that only ever inspects the primary line (the pre-existing per-row indicator's own
    // simplification) would wrongly report no mismatch here.
    const splitRes = await admin.agent
      .post(`/api/v1/payroll-entries/${entry.id}/work-lines`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, unitId: secondUnit.id, days: '0' });
    expect(splitRes.status).toBe(201);

    const res = await fetchAudit(admin, cycle.id);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    const row = res.body.rows[0];
    expect(row.payrollEntryId).toBe(entry.id);
    expect(row.shape).toBe('SPLIT');
    expect(row.workLineCount).toBe(2);
    expect(row.siteMismatch).toBe(false);
    expect(row.unitMismatch).toBe(true);
    expect(row.safeOneClickShape).toBe(false); // split entries are never one-click eligible

    const primaryLine = row.workLines.find((l: { isPrimary: boolean }) => l.isPrimary);
    const secondaryLine = row.workLines.find((l: { isPrimary: boolean }) => !l.isPrimary);
    expect(primaryLine.unit.id).toBe(unit.id);
    expect(primaryLine.unitMismatch).toBe(false);
    expect(secondaryLine.unit.id).toBe(secondUnit.id);
    expect(secondaryLine.unitMismatch).toBe(true);
  });

  it('includes a Held mismatched entry, flagged held:true', async () => {
    const admin = await masterAdminAgent('amr-held-admin@test.local');
    const { cycle, entry, employee } = await setUpDraftEntry(admin, 6, 'Test Site AMR Held');
    const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site AMR Held B');
    await transferEmployee(admin, employee.id, siteB.id, unitB.id);

    const holdRes = await admin.agent
      .patch(`/api/v1/payroll-entries/${entry.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, hold: true });
    expect(holdRes.status).toBe(200);

    const res = await fetchAudit(admin, cycle.id);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.rows[0].held).toBe(true);
    expect(res.body.totals.heldCount).toBe(1);

    // held=true never excludes a genuine mismatch — a plain hold-state filter must still surface it
    const heldOnly = await fetchAudit(admin, cycle.id, { held: 'true' });
    expect(heldOnly.body.total).toBe(1);
    const notHeld = await fetchAudit(admin, cycle.id, { held: 'false' });
    expect(notHeld.body.total).toBe(0);
  });

  it('excludes a released entry outright, even though its attribution genuinely still diverges', async () => {
    const admin = await masterAdminAgent('amr-released-admin@test.local');
    const { site, unit, cycle, entry, employee } = await setUpDraftEntry(admin, 7, 'Test Site AMR Released');
    const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site AMR Released B');

    // Positive net so the release sweep resolves it as ordinarily released=true.
    const patchRes = await admin.agent
      .patch(`/api/v1/payroll-entries/${entry.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, eobiApplicable: false, allowance: '5000' });
    expect(patchRes.status).toBe(200);

    await transferEmployee(admin, employee.id, siteB.id, unitB.id);

    const releaseRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${unit.id}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(releaseRes.status).toBe(201);
    expect(releaseRes.body.releasedEntryCount).toBe(1);

    const released = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(released.released).toBe(true);
    expect(released.siteId).toBe(site.id); // still genuinely mismatched vs. the employee's Site B

    const res = await fetchAudit(admin, cycle.id);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.rows).toEqual([]);
  });

  it('excludes a payoutOutcome-resolved entry (RECOVERY_DUE), even though it never released', async () => {
    const admin = await masterAdminAgent('amr-payout-admin@test.local');
    const { unit, cycle, entry, employee } = await setUpDraftEntry(admin, 8, 'Test Site AMR Payout');
    const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site AMR Payout B');
    await transferEmployee(admin, employee.id, siteB.id, unitB.id);

    // Default entry (0 work days, EOBI applicable) nets negative — the release sweep resolves it
    // as RECOVERY_DUE, never `released`.
    const releaseRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${unit.id}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(releaseRes.status).toBe(201);
    expect(releaseRes.body.recoveryDueCount).toBe(1);

    const resolved = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(resolved.released).toBe(false);
    expect(resolved.payoutOutcome).toBe('RECOVERY_DUE');

    const res = await fetchAudit(admin, cycle.id);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it('rejects a non-Draft cycle (RELEASED) with 400 — this audit only ever supports the current Draft cycle', async () => {
    const admin = await masterAdminAgent('amr-nondraft-admin@test.local');
    const { unit, cycle } = await setUpDraftEntry(admin, 9, 'Test Site AMR NonDraft');

    // Resolve the sole entry (release the one Unit) then finalize the cycle to RELEASED.
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
    expect(finalizeRes.body.cycle.status).toBe('RELEASED');

    const res = await fetchAudit(admin, cycle.id);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Draft/i);
  });

  it('rejects an ARCHIVED cycle with 400 and returns no rows — even one that held a genuine mismatch while Draft', async () => {
    const admin = await masterAdminAgent('amr-archived-admin@test.local');
    const { unit, employee, cycle } = await setUpDraftEntry(admin, 10, 'Test Site AMR Archived');
    const { site: siteElsewhere, unit: unitElsewhere } = await makeSiteWithUnit('Test Site AMR Archived Elsewhere');
    await transferEmployee(admin, employee.id, siteElsewhere.id, unitElsewhere.id);

    // Positive control: while Draft, the mismatch is surfaced.
    const draftRes = await fetchAudit(admin, cycle.id);
    expect(draftRes.status).toBe(200);
    expect(draftRes.body.total).toBe(1);

    // Draft -> Released -> Archived through the real lifecycle endpoints.
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
    const rolloverRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/archive-and-create-next`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(rolloverRes.status).toBe(201);

    const cyclesRes = await admin.agent.get('/api/v1/payroll-cycles');
    const archived = (cyclesRes.body.cycles as { id: string; status: string }[]).find((c) => c.id === cycle.id);
    expect(archived?.status).toBe('ARCHIVED');

    const res = await fetchAudit(admin, cycle.id);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Draft/i);
    expect(res.body.rows).toBeUndefined();
    expect(res.body.total).toBeUndefined();
  });

  // --- RBAC / site-scoping -------------------------------------------------------------------

  it('403s a user holding neither payroll:entry nor payroll:view', async () => {
    const noAccess = await noAccessAgent('amr-no-access@test.local');
    const admin = await masterAdminAgent('amr-no-access-setup-admin@test.local');
    const { cycle } = await setUpDraftEntry(admin, 10, 'Test Site AMR No Access');

    const res = await fetchAudit(noAccess, cycle.id);
    expect(res.status).toBe(403);
  });

  it('scopes results to the caller\'s own assigned Sites — a mismatch at an inaccessible Site never appears', async () => {
    const admin = await masterAdminAgent('amr-scope-admin@test.local');
    const { site: siteA, cycle, employee: employeeA } = await setUpDraftEntry(admin, 11, 'Test Site AMR Scope A');
    const { site: siteAElsewhere } = await makeSiteWithUnit('Test Site AMR Scope A Elsewhere');
    await transferEmployee(admin, employeeA.id, siteAElsewhere.id, (await prisma.projectUnit.findFirstOrThrow({ where: { siteId: siteAElsewhere.id } })).id);

    // A second mismatched employee/entry at an entirely different Site B, same cycle.
    const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site AMR Scope B');
    const employeeB = await prisma.employee.create({
      data: { name: 'Scope Employee B', designation: 'Guard', siteId: siteB.id, unitId: unitB.id, grossPay: '30000' },
    });
    await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employeeB.id });
    const { site: siteBElsewhere } = await makeSiteWithUnit('Test Site AMR Scope B Elsewhere');
    await transferEmployee(admin, employeeB.id, siteBElsewhere.id, (await prisma.projectUnit.findFirstOrThrow({ where: { siteId: siteBElsewhere.id } })).id);

    const staffA = await payrollStaffAgent('amr-staff-a@test.local', [siteA.id]);
    const resA = await fetchAudit(staffA, cycle.id);
    expect(resA.status).toBe(200);
    expect(resA.body.total).toBe(1);
    expect(resA.body.rows[0].payrollSiteId).toBe(siteA.id);

    const masterRes = await fetchAudit(admin, cycle.id);
    expect(masterRes.status).toBe(200);
    expect(masterRes.body.total).toBe(2);
  });

  it('rejects an explicit siteIds filter naming a Site the caller cannot access', async () => {
    const { site: siteA } = await makeSiteWithUnit('Test Site AMR Filter Forbidden A');
    const admin = await masterAdminAgent('amr-filter-forbidden-admin@test.local');
    const cycle = await makeDraftCycle(admin, 12);
    const staffA = await payrollStaffAgent('amr-filter-forbidden-staff@test.local', []);

    const res = await fetchAudit(staffA, cycle.id, { siteIds: siteA.id });
    expect(res.status).toBe(403);
  });

  it('REGRESSION: scopes on PayrollEntry.siteId only — an entry still at Site B whose employee moved INTO Site A never reaches a Site-A-only user, in the list or the export', async () => {
    const admin = await masterAdminAgent('amr-inbound-scope-admin@test.local');
    const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site AMR Inbound A');
    const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site AMR Inbound B');
    const employee = await prisma.employee.create({
      data: { name: 'AMR Inbound Transfer Employee', designation: 'Guard', siteId: siteB.id, unitId: unitB.id, grossPay: '30000' },
    });
    const cycle = await makeDraftCycle(admin, 1, 2905);
    const entry = await prisma.payrollEntry.findFirstOrThrow({ where: { cycleId: cycle.id, employeeId: employee.id } });
    expect(entry.siteId).toBe(siteB.id);

    // The employee's *current* assignment is now Site A; the Draft entry stays attributed to Site B.
    await transferEmployee(admin, employee.id, siteA.id, unitA.id);
    const unchanged = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(unchanged.siteId).toBe(siteB.id);

    // Positive control: it is a genuine mismatch candidate the report does surface.
    const masterRes = await fetchAudit(admin, cycle.id);
    expect(masterRes.body.total).toBe(1);
    expect(masterRes.body.rows[0].payrollSiteId).toBe(siteB.id);
    expect(masterRes.body.rows[0].currentEmployeeSiteId).toBe(siteA.id);

    // Site-A-only: never visible — neither Employee.siteId nor "either site" grants access.
    const staffA = await payrollStaffAgent('amr-inbound-staff-a@test.local', [siteA.id]);
    const listA = await fetchAudit(staffA, cycle.id);
    expect(listA.status).toBe(200);
    expect(listA.body.total).toBe(0);
    expect(listA.body.rows).toEqual([]);
    expect(listA.body.totals.matchingCount).toBe(0);

    const filteredA = await fetchAudit(staffA, cycle.id, { siteIds: siteA.id });
    expect(filteredA.status).toBe(200);
    expect(filteredA.body.total).toBe(0);

    const exportA = await staffA.agent.get(`/api/v1/reports/assignment-mismatch-readiness/export?cycleId=${cycle.id}&format=csv`);
    expect(exportA.status).toBe(200);
    expect(exportA.text.trim().split('\n')).toHaveLength(1); // header row only
    expect(exportA.text).not.toContain('AMR Inbound Transfer Employee');

    // Site-B-only: sees it — access follows the entry's own payroll Site.
    const staffB = await payrollStaffAgent('amr-inbound-staff-b@test.local', [siteB.id]);
    const listB = await fetchAudit(staffB, cycle.id);
    expect(listB.body.total).toBe(1);
    expect(listB.body.rows[0].payrollEntryId).toBe(entry.id);

    const exportB = await staffB.agent.get(`/api/v1/reports/assignment-mismatch-readiness/export?cycleId=${cycle.id}&format=csv`);
    expect(exportB.status).toBe(200);
    expect(exportB.text).toContain('AMR Inbound Transfer Employee');
  });

  it('admits a payroll:view-only user (no payroll:entry), still site-scoped, for both list and export', async () => {
    const admin = await masterAdminAgent('amr-view-only-admin@test.local');
    const { site, cycle, entry, employee } = await setUpDraftEntry(admin, 1, 'Test Site AMR View Only');
    const { site: siteElsewhere, unit: unitElsewhere } = await makeSiteWithUnit('Test Site AMR View Only Elsewhere');
    await transferEmployee(admin, employee.id, siteElsewhere.id, unitElsewhere.id);

    const viewer = await viewOnlyAgent('amr-view-only@test.local', [site.id]);
    const list = await fetchAudit(viewer, cycle.id);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.rows[0].payrollEntryId).toBe(entry.id);

    const exportRes = await viewer.agent.get(`/api/v1/reports/assignment-mismatch-readiness/export?cycleId=${cycle.id}&format=csv`);
    expect(exportRes.status).toBe(200);
    expect(exportRes.text.trim().split('\n')).toHaveLength(2);

    const otherSiteViewer = await viewOnlyAgent('amr-view-only-other@test.local', [siteElsewhere.id]);
    const otherList = await fetchAudit(otherSiteViewer, cycle.id);
    expect(otherList.status).toBe(200);
    expect(otherList.body.total).toBe(0);
  });

  // --- Pagination / export parity -----------------------------------------------------------

  it('paginates the mismatch list and exports (CSV) exactly the same full filtered row count', async () => {
    const admin = await masterAdminAgent('amr-paginate-admin@test.local');
    const cycle = await makeDraftCycle(admin, 1, 2903);

    const rowCount = 5;

    // `setUpDraftEntry` creates its own cycle per call (auto-seeding an entry against *that*
    // cycle), which doesn't fit a shared-cycle pagination fixture — build entries directly against
    // the one shared `cycle` above instead.
    const entries: { employeeId: string; siteId: string }[] = [];
    for (let i = 0; i < rowCount; i += 1) {
      const { site, unit } = await makeSiteWithUnit(`Test Site AMR Paginate Direct ${i}`);
      const employee = await prisma.employee.create({
        data: { name: `Paginate Employee ${i}`, designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
      });
      const createRes = await admin.agent
        .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ employeeId: employee.id });
      expect(createRes.status).toBe(201);
      const { site: siteElsewhere, unit: unitElsewhere } = await makeSiteWithUnit(`Test Site AMR Paginate Elsewhere ${i}`);
      await transferEmployee(admin, employee.id, siteElsewhere.id, unitElsewhere.id);
      entries.push({ employeeId: employee.id, siteId: site.id });
    }

    const page1 = await fetchAudit(admin, cycle.id, { page: '1', pageSize: '2', sortBy: 'employeeName', sortDir: 'asc' });
    expect(page1.status).toBe(200);
    expect(page1.body.total).toBe(rowCount);
    expect(page1.body.rows).toHaveLength(2);
    expect(page1.body.page).toBe(1);
    expect(page1.body.pageSize).toBe(2);

    const page3 = await fetchAudit(admin, cycle.id, { page: '3', pageSize: '2', sortBy: 'employeeName', sortDir: 'asc' });
    expect(page3.body.rows).toHaveLength(1); // 5 rows, page size 2 -> last page has 1

    const exportRes = await admin.agent.get(
      `/api/v1/reports/assignment-mismatch-readiness/export?cycleId=${cycle.id}&format=csv`,
    );
    expect(exportRes.status).toBe(200);
    const csvLines = exportRes.text.trim().split('\n');
    // header row + one row per matching entry
    expect(csvLines).toHaveLength(rowCount + 1);
  });

  it('filters by shape (single vs split) and by safeShapeOnly', async () => {
    const admin = await masterAdminAgent('amr-shape-filter-admin@test.local');
    const cycle = await makeDraftCycle(admin, 1, 2904);

    // Single-line mismatch (safe one-click shape).
    const { site: siteSingle, unit: unitSingle } = await makeSiteWithUnit('Test Site AMR Shape Single');
    const employeeSingle = await prisma.employee.create({
      data: { name: 'Shape Single Employee', designation: 'Guard', siteId: siteSingle.id, unitId: unitSingle.id, grossPay: '30000' },
    });
    await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employeeSingle.id });
    const { site: siteSingleElsewhere, unit: unitSingleElsewhere } = await makeSiteWithUnit('Test Site AMR Shape Single Elsewhere');
    await transferEmployee(admin, employeeSingle.id, siteSingleElsewhere.id, unitSingleElsewhere.id);

    // Split mismatch (never safe one-click).
    const { site: siteSplit, unit: unitSplit } = await makeSiteWithUnit('Test Site AMR Shape Split');
    const employeeSplit = await prisma.employee.create({
      data: { name: 'Shape Split Employee', designation: 'Guard', siteId: siteSplit.id, unitId: unitSplit.id, grossPay: '30000' },
    });
    const splitEntryRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employeeSplit.id });
    const secondUnit = await prisma.projectUnit.create({ data: { siteId: siteSplit.id, name: 'Shape Split Second Unit' } });
    await admin.agent
      .post(`/api/v1/payroll-entries/${splitEntryRes.body.entry.id}/work-lines`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: splitEntryRes.body.entry.version, unitId: secondUnit.id, days: '0' });
    const { site: siteSplitElsewhere, unit: unitSplitElsewhere } = await makeSiteWithUnit('Test Site AMR Shape Split Elsewhere');
    await transferEmployee(admin, employeeSplit.id, siteSplitElsewhere.id, unitSplitElsewhere.id);

    const all = await fetchAudit(admin, cycle.id);
    expect(all.body.total).toBe(2);

    const singleOnly = await fetchAudit(admin, cycle.id, { shape: 'SINGLE_LINE' });
    expect(singleOnly.body.total).toBe(1);
    expect(singleOnly.body.rows[0].employeeId).toBe(employeeSingle.id);

    const splitOnly = await fetchAudit(admin, cycle.id, { shape: 'SPLIT' });
    expect(splitOnly.body.total).toBe(1);
    expect(splitOnly.body.rows[0].employeeId).toBe(employeeSplit.id);

    const safeShapeOnly = await fetchAudit(admin, cycle.id, { safeShapeOnly: 'true' });
    expect(safeShapeOnly.body.total).toBe(1);
    expect(safeShapeOnly.body.rows[0].employeeId).toBe(employeeSingle.id);
  });
});
