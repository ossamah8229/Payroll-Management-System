import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

/**
 * v1.0.3 M2 checkpoint (2026-08-26) — Working Days vs Cycle Days financial-integrity invariant:
 * `SUM(workLines.days) <= MAX(workLines.cycleDays)` for every `PayrollEntry`. Covers both defense-
 * in-depth layers approved for this checkpoint: Layer 1 (write-time rejection at every real product
 * write path — `createPayrollEntry`, `addWorkLine`, `updateWorkLine`, `deleteWorkLine`, and the
 * bulk `cycleDays` Copy-to-All path) and Layer 2 (the `releaseBlockReasons`
 * `WORKING_DAYS_EXCEED_CYCLE_DAYS` release-time backstop). See `shared/src/lib/calc-net.ts`'s
 * `workingDaysExceedCycleDays` for the full "why MAX, why aggregate not per-line" reasoning this
 * suite exercises end to end.
 */
describe('v1.0.3 M2 — Working Days vs Cycle Days financial-integrity guard', () => {
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
      permissionKeys: [PERMISSIONS.PAYROLL_CYCLE_MANAGE, PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.PAYROLL_RELEASE],
    });
  }

  async function makeSiteWithUnit(name: string, unitName = `${name} Unit`) {
    const site = await prisma.projectSite.create({ data: { name } });
    const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: unitName, code: 'U-1' } });
    return { site, unit };
  }

  async function makeSecondUnit(siteId: string, name: string) {
    return prisma.projectUnit.create({ data: { siteId, name, code: 'U-2' } });
  }

  async function makeEmployee(siteId: string, unitId: string, name: string, grossPay = '26000') {
    return prisma.employee.create({ data: { name, designation: 'Guard', siteId, unitId, grossPay } });
  }

  async function makeDraftCycle(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, month: number) {
    const res = await admin.agent.post('/api/v1/payroll-cycles').set('x-csrf-token', admin.csrfToken).send({ year: 2900, month });
    return res.body.cycle as { id: string };
  }

  async function getEntry(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, cycleId: string, employeeId: string) {
    const res = await admin.agent.get(`/api/v1/payroll-cycles/${cycleId}/entries?employeeId=${employeeId}`);
    return res.body.entries[0];
  }

  // --- Single-line ------------------------------------------------------------------------------

  it('Case 1: cycleDays 26, days 26 — accepted', async () => {
    const admin = await masterAdminAgent('m2-c1-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site M2 C1');
    const cycle = await makeDraftCycle(admin, 1);
    const employee = await makeEmployee(site.id, unit.id, 'C1 Employee');

    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id, workLines: [{ cycleDays: 26, days: '26' }] });
    expect(res.status).toBe(201);
    expect(res.body.entry.calc.totalWorkingDays).toBe('26');
  });

  it('Case 2: cycleDays 26, days 27 — rejected', async () => {
    const admin = await masterAdminAgent('m2-c2-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site M2 C2');
    const cycle = await makeDraftCycle(admin, 1);
    const employee = await makeEmployee(site.id, unit.id, 'C2 Employee');

    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id, workLines: [{ cycleDays: 26, days: '27' }] });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Working Days cannot exceed Cycle Days/);

    // No entry was created at all — the whole creation is rejected, not partially applied.
    const list = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries?employeeId=${employee.id}`);
    expect(list.body.entries).toHaveLength(0);
  });

  it('Case 3: cycleDays 30, days 31 — rejected (via updateWorkLine on an existing valid entry)', async () => {
    const admin = await masterAdminAgent('m2-c3-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site M2 C3');
    const cycle = await makeDraftCycle(admin, 1);
    const employee = await makeEmployee(site.id, unit.id, 'C3 Employee');

    const createRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id, workLines: [{ cycleDays: 30, days: '30' }] });
    const entry = await getEntry(admin, cycle.id, employee.id);
    const workLineId = entry.workLines[0].id as string;

    const editRes = await admin.agent
      .patch(`/api/v1/work-lines/${workLineId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, days: '31' });
    expect(editRes.status).toBe(400);
    expect(editRes.body.error.message).toMatch(/Working Days cannot exceed Cycle Days/);

    // Rolled back cleanly — persisted days/version unchanged.
    const persisted = await prisma.payrollEntryWorkLine.findUniqueOrThrow({ where: { id: workLineId } });
    expect(persisted.days.toString()).toBe('30');
    const persistedEntry = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: createRes.body.entry.id } });
    expect(persistedEntry.version).toBe(entry.version);
  });

  it('Case 4: days 0 — accepted', async () => {
    const admin = await masterAdminAgent('m2-c4-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site M2 C4');
    const cycle = await makeDraftCycle(admin, 1);
    const employee = await makeEmployee(site.id, unit.id, 'C4 Employee');

    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id }); // default seed: days 0, cycleDays 30
    expect(res.status).toBe(201);
    expect(res.body.entry.calc.totalWorkingDays).toBe('0');
  });

  // --- Split-unit ---------------------------------------------------------------------------------

  it('Case 5: split 13 + 13, max cycleDays 26 — accepted', async () => {
    const admin = await masterAdminAgent('m2-c5-admin@test.local');
    const { site, unit: unitA } = await makeSiteWithUnit('Test Site M2 C5');
    const unitB = await makeSecondUnit(site.id, 'Test Site M2 C5 Unit B');
    const cycle = await makeDraftCycle(admin, 1);
    const employee = await makeEmployee(site.id, unitA.id, 'C5 Employee');

    const createRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id, workLines: [{ cycleDays: 26, days: '13' }] });
    const entry = await getEntry(admin, cycle.id, employee.id);

    const splitRes = await admin.agent
      .post(`/api/v1/payroll-entries/${createRes.body.entry.id}/work-lines`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, unitId: unitB.id, cycleDays: 26, days: '13' });
    expect(splitRes.status).toBe(201);
    expect(splitRes.body.entry.calc.totalWorkingDays).toBe('26');
  });

  it('Case 6: split 13 + 14, max cycleDays 26 — rejected, even though every individual line is <= its own cycleDays', async () => {
    const admin = await masterAdminAgent('m2-c6-admin@test.local');
    const { site, unit: unitA } = await makeSiteWithUnit('Test Site M2 C6');
    const unitB = await makeSecondUnit(site.id, 'Test Site M2 C6 Unit B');
    const cycle = await makeDraftCycle(admin, 1);
    const employee = await makeEmployee(site.id, unitA.id, 'C6 Employee');

    const createRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id, workLines: [{ cycleDays: 26, days: '13' }] });
    const entry = await getEntry(admin, cycle.id, employee.id);

    const splitRes = await admin.agent
      .post(`/api/v1/payroll-entries/${createRes.body.entry.id}/work-lines`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, unitId: unitB.id, cycleDays: 26, days: '14' });
    expect(splitRes.status).toBe(400);
    expect(splitRes.body.error.message).toMatch(/Total Working Days across units cannot exceed the applicable Cycle Days/);

    // The second line was never created — still exactly one line.
    const lines = await prisma.payrollEntryWorkLine.findMany({ where: { payrollEntryId: createRes.body.entry.id } });
    expect(lines).toHaveLength(1);
  });

  it('Case 7: 10 days on a 26-day line + 15 days on a 30-day line — aggregate 25 <= max(30) — accepted (different cycleDays bases, legitimate deputation)', async () => {
    const admin = await masterAdminAgent('m2-c7-admin@test.local');
    const { site, unit: unitA } = await makeSiteWithUnit('Test Site M2 C7');
    const unitB = await makeSecondUnit(site.id, 'Test Site M2 C7 Unit B');
    const cycle = await makeDraftCycle(admin, 1);
    const employee = await makeEmployee(site.id, unitA.id, 'C7 Employee');

    const createRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id, workLines: [{ cycleDays: 26, days: '10' }] });
    const entry = await getEntry(admin, cycle.id, employee.id);

    const splitRes = await admin.agent
      .post(`/api/v1/payroll-entries/${createRes.body.entry.id}/work-lines`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, unitId: unitB.id, cycleDays: 30, days: '15' });
    expect(splitRes.status).toBe(201);
    expect(splitRes.body.entry.calc.totalWorkingDays).toBe('25');
  });

  it('Case 8: a sibling-line update that turns a previously-valid aggregate invalid — rejected', async () => {
    const admin = await masterAdminAgent('m2-c8-admin@test.local');
    const { site, unit: unitA } = await makeSiteWithUnit('Test Site M2 C8');
    const unitB = await makeSecondUnit(site.id, 'Test Site M2 C8 Unit B');
    const cycle = await makeDraftCycle(admin, 1);
    const employee = await makeEmployee(site.id, unitA.id, 'C8 Employee');

    const createRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id, workLines: [{ cycleDays: 26, days: '13' }] });
    let entry = await getEntry(admin, cycle.id, employee.id);
    await admin.agent
      .post(`/api/v1/payroll-entries/${createRes.body.entry.id}/work-lines`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, unitId: unitB.id, cycleDays: 26, days: '13' }); // 13+13=26, valid

    entry = await getEntry(admin, cycle.id, employee.id);
    const secondLineId = entry.workLines[1].id as string;

    // Editing the SECOND line's own days from 13 -> 14 (14 <= 26 individually) pushes the
    // AGGREGATE to 27 > 26 — this is the sibling-line-update case: the line being edited never
    // itself exceeds its own cycleDays, only the combined total does.
    const editRes = await admin.agent
      .patch(`/api/v1/work-lines/${secondLineId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, days: '14' });
    expect(editRes.status).toBe(400);
    expect(editRes.body.error.message).toMatch(/Total Working Days across units cannot exceed the applicable Cycle Days/);

    const persisted = await prisma.payrollEntryWorkLine.findUniqueOrThrow({ where: { id: secondLineId } });
    expect(persisted.days.toString()).toBe('13'); // unchanged — rolled back
  });

  // --- Cycle-Days edit -----------------------------------------------------------------------------

  it('Case 9: existing days 26, cycleDays 31 -> change cycleDays to 26 — accepted (26 <= 26)', async () => {
    const admin = await masterAdminAgent('m2-c9-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site M2 C9');
    const cycle = await makeDraftCycle(admin, 1);
    const employee = await makeEmployee(site.id, unit.id, 'C9 Employee');

    await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id, workLines: [{ cycleDays: 31, days: '26' }] });
    const entry = await getEntry(admin, cycle.id, employee.id);
    const workLineId = entry.workLines[0].id as string;

    const editRes = await admin.agent
      .patch(`/api/v1/work-lines/${workLineId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, cycleDays: 26 });
    expect(editRes.status).toBe(200);
    expect(editRes.body.entry.workLines[0].cycleDays).toBe(26);
  });

  it('Case 10: existing days 27, cycleDays 31 -> change cycleDays to 26 — rejected', async () => {
    const admin = await masterAdminAgent('m2-c10-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site M2 C10');
    const cycle = await makeDraftCycle(admin, 1);
    const employee = await makeEmployee(site.id, unit.id, 'C10 Employee');

    await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id, workLines: [{ cycleDays: 31, days: '27' }] });
    const entry = await getEntry(admin, cycle.id, employee.id);
    const workLineId = entry.workLines[0].id as string;

    const editRes = await admin.agent
      .patch(`/api/v1/work-lines/${workLineId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, cycleDays: 26 });
    expect(editRes.status).toBe(400);

    const persisted = await prisma.payrollEntryWorkLine.findUniqueOrThrow({ where: { id: workLineId } });
    expect(persisted.cycleDays).toBe(31); // unchanged
  });

  // --- Bulk Cycle-Days (Copy to All) ---------------------------------------------------------------

  it('Case 11: bulk cycleDays change where every affected entry remains valid — accepted', async () => {
    const admin = await masterAdminAgent('m2-c11-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site M2 C11');
    const cycle = await makeDraftCycle(admin, 1);
    const e1 = await makeEmployee(site.id, unit.id, 'C11 Employee One');
    const e2 = await makeEmployee(site.id, unit.id, 'C11 Employee Two');
    await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: e1.id, workLines: [{ cycleDays: 30, days: '20' }] });
    await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: e2.id, workLines: [{ cycleDays: 30, days: '22' }] });

    const bulkRes = await admin.agent
      .patch(`/api/v1/payroll-cycles/${cycle.id}/entries/bulk`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ siteIds: [site.id], field: 'cycleDays', value: 26 }); // 20<=26, 22<=26 — both fine
    expect(bulkRes.status).toBe(200);
    expect(bulkRes.body.appliedCount).toBe(2);

    const line1 = await prisma.payrollEntryWorkLine.findFirstOrThrow({ where: { payrollEntry: { employeeId: e1.id } } });
    expect(line1.cycleDays).toBe(26);
  });

  it('Case 12: bulk cycleDays change where at least one affected entry would become invalid — rejected atomically, no partial mutation', async () => {
    const admin = await masterAdminAgent('m2-c12-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site M2 C12');
    const cycle = await makeDraftCycle(admin, 1);
    const e1 = await makeEmployee(site.id, unit.id, 'C12 Employee One');
    const e2 = await makeEmployee(site.id, unit.id, 'C12 Employee Two');
    await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: e1.id, workLines: [{ cycleDays: 30, days: '20' }] }); // stays valid at 26
    await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: e2.id, workLines: [{ cycleDays: 30, days: '27' }] }); // 27 > 26 — would become invalid

    const bulkRes = await admin.agent
      .patch(`/api/v1/payroll-cycles/${cycle.id}/entries/bulk`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ siteIds: [site.id], field: 'cycleDays', value: 26 });
    expect(bulkRes.status).toBe(400);
    expect(bulkRes.body.error.message).toMatch(/Working Days exceeding Cycle Days/);

    // Atomic: NEITHER entry's cycleDays changed, not even the one that would have stayed valid.
    const line1 = await prisma.payrollEntryWorkLine.findFirstOrThrow({ where: { payrollEntry: { employeeId: e1.id } } });
    const line2 = await prisma.payrollEntryWorkLine.findFirstOrThrow({ where: { payrollEntry: { employeeId: e2.id } } });
    expect(line1.cycleDays).toBe(30);
    expect(line2.cycleDays).toBe(30);
  });

  // --- Release backstop -----------------------------------------------------------------------------

  it('Case 13/14: a legacy-invalid entry (direct DB fixture only) is caught by releaseBlockReasons and refused at real Salary Release', async () => {
    const admin = await masterAdminAgent('m2-c1314-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site M2 C1314');
    const cycle = await makeDraftCycle(admin, 1);
    const employee = await makeEmployee(site.id, unit.id, 'C1314 Employee');

    const createRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id, workLines: [{ cycleDays: 26, days: '26' }] });
    const entryId = createRes.body.entry.id as string;
    const workLineId = createRes.body.entry.workLines[0].id as string;

    // TEST FIXTURE CREATION ONLY — a direct Prisma write standing in for a legacy/imported record
    // that predates this checkpoint's write-time guards (or any future, unknown write path) —
    // never done through the application's own API, exactly reproducing the "legacy state" this
    // backstop exists for. Local disposable Postgres only.
    await prisma.payrollEntryWorkLine.update({ where: { id: workLineId }, data: { days: '27' } });

    const readEntry = await getEntry(admin, cycle.id, employee.id);
    expect(readEntry.releaseBlockReasons).toContain('Working Days Exceed Cycle Days');

    const releaseRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${unit.id}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(releaseRes.status).toBe(201);
    expect(releaseRes.body.blockedCount).toBe(1);

    const afterRelease = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entryId } });
    expect(afterRelease.released).toBe(false); // refused — no financial release state written
  });

  it('Case 15: a valid entry still releases normally', async () => {
    const admin = await masterAdminAgent('m2-c15-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site M2 C15');
    const cycle = await makeDraftCycle(admin, 1);
    const employee = await makeEmployee(site.id, unit.id, 'C15 Employee');

    const createRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id, workLines: [{ cycleDays: 26, days: '26' }] });
    const entryId = createRes.body.entry.id as string;

    const releaseRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${unit.id}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(releaseRes.status).toBe(201);
    expect(releaseRes.body.blockedCount).toBe(0);

    const afterRelease = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entryId } });
    expect(afterRelease.released).toBe(true);
  });

  // --- Concurrency ------------------------------------------------------------------------------

  it('Case 16: two concurrent sibling-line edits that would together create an invalid aggregate cannot both apply — one is serialized/rejected, DB never ends in the invalid state', async () => {
    const admin = await masterAdminAgent('m2-c16-admin@test.local');
    const { site, unit: unitA } = await makeSiteWithUnit('Test Site M2 C16');
    const unitB = await makeSecondUnit(site.id, 'Test Site M2 C16 Unit B');
    const cycle = await makeDraftCycle(admin, 1);
    const employee = await makeEmployee(site.id, unitA.id, 'C16 Employee');

    const createRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id, workLines: [{ cycleDays: 26, days: '13' }] });
    let entry = await getEntry(admin, cycle.id, employee.id);
    await admin.agent
      .post(`/api/v1/payroll-entries/${createRes.body.entry.id}/work-lines`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, unitId: unitB.id, cycleDays: 26, days: '13' }); // 13+13=26, valid

    entry = await getEntry(admin, cycle.id, employee.id);
    const [line1Id, line2Id] = entry.workLines.map((l: { id: string }) => l.id);
    const sharedVersion = entry.version as number;

    // Both requests race off the SAME (currently-valid) version: line1 13->14 and line2 13->14 —
    // individually each would make the aggregate 27 (14+13, or 13+14) > 26 only if BOTH applied;
    // either one alone (14+13=27) is already over on its own, so this also doubles as proof that
    // whichever one commits first is correctly rejected by the Layer 1 guard, and the loser is
    // rejected by the ordinary version conflict (they share one parent version token) — never a
    // lost update that silently produces 14+14=28.
    const [res1, res2] = await Promise.all([
      admin.agent.patch(`/api/v1/work-lines/${line1Id}`).set('x-csrf-token', admin.csrfToken).send({ version: sharedVersion, days: '14' }),
      admin.agent.patch(`/api/v1/work-lines/${line2Id}`).set('x-csrf-token', admin.csrfToken).send({ version: sharedVersion, days: '14' }),
    ]);

    // Never a 500, never both succeeding (that would be the lost-update/race outcome this guard
    // must prevent).
    expect(res1.status).not.toBe(500);
    expect(res2.status).not.toBe(500);
    expect([res1.status, res2.status].filter((s) => s === 200).length).toBeLessThanOrEqual(1);

    const finalLines = await prisma.payrollEntryWorkLine.findMany({ where: { payrollEntryId: createRes.body.entry.id } });
    const totalDays = finalLines.reduce((sum, l) => sum + Number(l.days), 0);
    const maxCycleDays = Math.max(...finalLines.map((l) => l.cycleDays));
    expect(totalDays).toBeLessThanOrEqual(maxCycleDays); // DB never ends in the invalid state
  });
});
