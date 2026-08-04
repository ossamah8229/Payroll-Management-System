import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

describe('Phase 5 Checkpoint 4 — Archived Cycle Ordinary-Editing Lock', () => {
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

  async function makeSiteWithUnit(name: string) {
    const site = await prisma.projectSite.create({ data: { name } });
    const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} Unit` } });
    return { site, unit };
  }

  async function makeEmployee(siteId: string, unitId: string, name: string) {
    return prisma.employee.create({ data: { name, designation: 'Guard', siteId, unitId, grossPay: '30000' } });
  }

  async function makeDraftCycle(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, month: number) {
    const res = await admin.agent
      .post('/api/v1/payroll-cycles')
      .set('x-csrf-token', admin.csrfToken)
      .send({ year: 2900, month });
    if (res.status !== 201) throw new Error(`cycle create failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.cycle as { id: string; status: string };
  }

  async function getEntry(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, cycleId: string, employeeId: string) {
    const res = await admin.agent.get(`/api/v1/payroll-cycles/${cycleId}/entries?employeeId=${employeeId}`);
    if (res.status !== 200 || !res.body.entries?.length) {
      throw new Error(`entry not found: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body.entries[0] as { id: string; version: number; hold: boolean; released: boolean; workLines: { id: string }[] };
  }

  async function holdEntry(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, entryId: string, version: number) {
    const res = await admin.agent
      .patch(`/api/v1/payroll-entries/${entryId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version, hold: true });
    if (res.status !== 200) throw new Error(`hold failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.entry as { id: string; version: number };
  }

  async function releaseUnit(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, cycleId: string, unitId: string) {
    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycleId}/units/${unitId}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    if (res.status !== 201) throw new Error(`release failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  async function finalizeCycle(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, cycleId: string) {
    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycleId}/finalize`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    if (res.status !== 200) throw new Error(`finalize failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.cycle as { id: string; status: string };
  }

  async function rollover(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, cycleId: string) {
    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycleId}/archive-and-create-next`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    if (res.status !== 201) throw new Error(`rollover failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as { outgoingCycle: { id: string; status: string }; newCycle: { id: string } };
  }

  /** A fully archived cycle carrying both classes of row this checkpoint's own approved rule must
   * distinguish from every other cycle status: a `released = true` entry (already locked before
   * this checkpoint, for an unrelated reason) and a `hold = true, released = false` entry (the one
   * that was still ordinarily editable through `RELEASED` and only becomes locked here, on
   * `ARCHIVED`). */
  async function makeArchivedCycleWithHeldAndReleasedEntries(
    admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>,
    month: number,
  ) {
    const { site, unit } = await makeSiteWithUnit(`Test Site Archived Lock ${month}`);
    const releasedEmployee = await makeEmployee(site.id, unit.id, `Released Employee ${month}`);
    const heldEmployee = await makeEmployee(site.id, unit.id, `Held Employee ${month}`);
    const cycle = await makeDraftCycle(admin, month);

    const heldEntryBefore = await getEntry(admin, cycle.id, heldEmployee.id);
    await holdEntry(admin, heldEntryBefore.id, heldEntryBefore.version);

    // Negative Payroll Recovery checkpoint (2026-07-26) — the auto-bootstrapped entry has 0 work
    // days, netting -400 (the default 400 EOBI deduction), which now correctly resolves to
    // RECOVERY_DUE rather than releasing for payment. This suite is about the Archived-cycle edit
    // lock, not net-salary sign, so the entry expected to actually release is patched to a
    // positive net salary first.
    const releasedEntryBefore = await getEntry(admin, cycle.id, releasedEmployee.id);
    await admin.agent
      .patch(`/api/v1/payroll-entries/${releasedEntryBefore.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: releasedEntryBefore.version, eobiApplicable: false, allowance: '5000' });

    await releaseUnit(admin, cycle.id, unit.id); // releases the non-held entry only

    const finalized = await finalizeCycle(admin, cycle.id);
    const { outgoingCycle } = await rollover(admin, finalized.id);
    expect(outgoingCycle.status).toBe('ARCHIVED');

    const releasedEntry = await getEntry(admin, outgoingCycle.id, releasedEmployee.id);
    const heldEntry = await getEntry(admin, outgoingCycle.id, heldEmployee.id);
    expect(releasedEntry.released).toBe(true);
    expect(heldEntry.released).toBe(false);
    expect(heldEntry.hold).toBe(true);

    return { archivedCycleId: outgoingCycle.id, site, unit, releasedEntry, heldEntry };
  }

  // --- The held/unreleased entry — the actual new-behavior surface ---------------------------

  it('rejects updating a held, unreleased entry once its cycle is Archived (previously still editable through Released)', async () => {
    const admin = await masterAdminAgent('archived-lock-update-admin@test.local');
    const { heldEntry } = await makeArchivedCycleWithHeldAndReleasedEntries(admin, 1);

    const res = await admin.agent
      .patch(`/api/v1/payroll-entries/${heldEntry.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: heldEntry.version, grossPay: '99999' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/archived/i);

    const unchanged = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: heldEntry.id } });
    expect(Number(unchanged.grossPay)).not.toBe(99999);
  });

  it('rejects deleting a held, unreleased entry once its cycle is Archived', async () => {
    const admin = await masterAdminAgent('archived-lock-delete-admin@test.local');
    const { heldEntry } = await makeArchivedCycleWithHeldAndReleasedEntries(admin, 2);

    const res = await admin.agent
      .delete(`/api/v1/payroll-entries/${heldEntry.id}?version=${heldEntry.version}`)
      .set('x-csrf-token', admin.csrfToken);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/archived/i);

    const stillExists = await prisma.payrollEntry.findUnique({ where: { id: heldEntry.id } });
    expect(stillExists).not.toBeNull();
  });

  it('rejects adding, updating, and deleting a work line on a held, unreleased entry once its cycle is Archived', async () => {
    const admin = await masterAdminAgent('archived-lock-workline-admin@test.local');
    const { heldEntry, unit } = await makeArchivedCycleWithHeldAndReleasedEntries(admin, 3);
    const lineId = heldEntry.workLines[0]!.id;

    const addRes = await admin.agent
      .post(`/api/v1/payroll-entries/${heldEntry.id}/work-lines`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: heldEntry.version, unitId: unit.id, days: '1' });
    expect(addRes.status).toBe(400);
    expect(addRes.body.error.message).toMatch(/archived/i);

    const updateRes = await admin.agent
      .patch(`/api/v1/work-lines/${lineId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: heldEntry.version, days: '5' });
    expect(updateRes.status).toBe(400);
    expect(updateRes.body.error.message).toMatch(/archived/i);

    const deleteRes = await admin.agent
      .delete(`/api/v1/work-lines/${lineId}?version=${heldEntry.version}`)
      .set('x-csrf-token', admin.csrfToken);
    expect(deleteRes.status).toBe(400);
    expect(deleteRes.body.error.message).toMatch(/archived/i);
  });

  it('applies to zero rows via bulk update once the cycle is Archived, even for a held, unreleased entry', async () => {
    const admin = await masterAdminAgent('archived-lock-bulk-admin@test.local');
    const { archivedCycleId, site } = await makeArchivedCycleWithHeldAndReleasedEntries(admin, 4);

    const res = await admin.agent
      .patch(`/api/v1/payroll-cycles/${archivedCycleId}/entries/bulk`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ siteIds: [site.id], field: 'otRate', value: '150.00' });

    expect(res.status).toBe(200); // bulk never throws for a locked set — it just applies to nobody
    expect(res.body).toEqual({ matchedCount: 2, appliedCount: 0 });
  });

  // Payroll Entry import was removed entirely (Payroll Entry usability checkpoint, 2026-07-24) —
  // payroll data must never be imported — so its own Archived-cycle lock coverage went with it.

  // --- The already-released entry — confirms no regression in the pre-existing rejection reason ---

  it('still rejects the already-released entry once its cycle is Archived (unchanged reason: released, not archived)', async () => {
    const admin = await masterAdminAgent('archived-lock-released-admin@test.local');
    const { releasedEntry } = await makeArchivedCycleWithHeldAndReleasedEntries(admin, 6);

    const res = await admin.agent
      .patch(`/api/v1/payroll-entries/${releasedEntry.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: releasedEntry.version, grossPay: '99999' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/released/i);
  });

  // --- Released regression — confirms Checkpoint 1's own rule is genuinely unaffected ------------

  it('still allows editing a held, unreleased entry while its cycle is only Released, not yet Archived (Checkpoint 1 regression)', async () => {
    const admin = await masterAdminAgent('archived-lock-released-regression-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Released Regression');
    const employee = await makeEmployee(site.id, unit.id, 'Released Regression Employee');
    const cycle = await makeDraftCycle(admin, 7);

    const entryBefore = await getEntry(admin, cycle.id, employee.id);
    await holdEntry(admin, entryBefore.id, entryBefore.version);
    const finalized = await finalizeCycle(admin, cycle.id);
    expect(finalized.status).toBe('RELEASED');

    const heldAfterFinalize = await getEntry(admin, finalized.id, employee.id);
    // Phase 7F (2026-08-04) — `allowance` stands in for `grossPay` here (which this test used
    // before `grossPay` became a read-only, Employee-Registry-sourced field); this test exercises
    // whether an ordinary field edit is still accepted at all, not anything specific to which field.
    const res = await admin.agent
      .patch(`/api/v1/payroll-entries/${heldAfterFinalize.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: heldAfterFinalize.version, allowance: '35000' });

    expect(res.status).toBe(200);
    expect(Number(res.body.entry.allowance)).toBe(35000);
  });

  // --- isCurrentDraft DTO ---------------------------------------------------------------------

  it('reports isCurrentDraft correctly for Draft, Released, and Archived cycles in the same list', async () => {
    const admin = await masterAdminAgent('is-current-draft-admin@test.local');
    const { unit } = await makeSiteWithUnit('Test Site isCurrentDraft');
    const cycle1 = await makeDraftCycle(admin, 8);
    await releaseUnit(admin, cycle1.id, unit.id);
    const finalized = await finalizeCycle(admin, cycle1.id);
    const { outgoingCycle, newCycle } = await rollover(admin, finalized.id);

    const list = await admin.agent.get('/api/v1/payroll-cycles');
    expect(list.status).toBe(200);
    const byId = new Map<string, { status: string; isCurrentDraft: boolean }>(
      list.body.cycles.map((c: { id: string; status: string; isCurrentDraft: boolean }) => [c.id, c]),
    );

    expect(byId.get(outgoingCycle.id)?.status).toBe('ARCHIVED');
    expect(byId.get(outgoingCycle.id)?.isCurrentDraft).toBe(false);
    expect(byId.get(newCycle.id)?.status).toBe('DRAFT');
    expect(byId.get(newCycle.id)?.isCurrentDraft).toBe(true);
  });
});
