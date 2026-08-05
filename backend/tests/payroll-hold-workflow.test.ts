import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { closePdfRenderer } from '../src/lib/pdf/render-pdf';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

/**
 * Hold Workflow Verification — Phase 7F Checkpoint (2026-08-04).
 *
 * End-to-end audit of the exact workflow the checkpoint describes:
 *
 *   Employee → Draft Payroll → Hold OFF → appears in Salary Release → Hold ON → disappears from
 *   releasable → Release remaining employees → Site status Released/Partially Released → Later,
 *   Hold OFF → employee appears again → only that employee may now be released → Site status
 *   updates correctly.
 *
 * Investigation found the mechanics already correct for every step up to "Release remaining" —
 * `releaseProjectUnit`'s candidate query already excludes `hold: true`, and a held entry stays
 * ordinarily editable right up until it locks. Two real gaps were found and fixed as part of this
 * checkpoint:
 *
 * 1. `getUnitReleaseStatus`'s `willReleaseCount` included Held entries (never excluded them),
 *    overstating "will release now" in the Release confirmation dialog.
 * 2. The final step — un-Hold *after* the Unit has already released — had no path back to being
 *    released at all: `releaseProjectUnit` unconditionally rejected a second call against an
 *    already-released Unit with a 409, regardless of whether something had since become newly
 *    eligible. This is the "Late Entry" release path every prior checkpoint's own doc comments
 *    documented as explicitly deferred — this checkpoint closes it as a Late/Straggler Sweep: a
 *    second call against an already-released Unit is now accepted specifically when there's a
 *    newly-eligible straggler, and still rejected (same 409) when there genuinely isn't.
 *
 * **Phase 7F Refinement (2026-08-04)** — the Release Remaining idempotency test added by this
 * refinement generates two real Payslip PDFs (a genuine Puppeteer/Chrome render, same mechanism
 * `payslips.test.ts` uses), so this file inherits that exact suite's own documented, measured
 * resource-contention fragility under a full-suite run (`payslips.test.ts`'s own file-level
 * comment on its identical `jest.setTimeout(45000)` — real, measured host memory contention from
 * processes outside this suite's control, not a leak or a logic defect; reproduced there via 10
 * consecutive full-suite runs). Same proportionate response applied here, for the same reason.
 *
 * **Phase 7G remediation (2026-08-04)** — this file rendered real Puppeteer PDFs from the start
 * but never called `closeBrowser()`, unlike every other real-PDF-rendering suite
 * (`payslips.test.ts`, `statements.test.ts`). Confirmed directly (not just theorized) to matter:
 * isolated runs of this file left a live, `ESTABLISHED` Chrome DevTools-Protocol WebSocket open
 * after all 5 tests had already passed, which is exactly why Jest never exited on its own
 * afterward. `afterAll` below now closes the shared browser, matching the established pattern.
 *
 * **Phase 7H (2026-08-04)** — the PDF 500 this file's "Release Remaining idempotency" test hit
 * intermittently under full-suite load was root-caused to Jest's own `--experimental-vm-modules`
 * VM-realm teardown racing `browser.ts`'s dynamic `import('puppeteer')` under concurrent load
 * (`"Test environment has been torn down"`, thrown by `jest-util`'s own module registry, not
 * application code — reproduced deterministically, fixed by moving real rendering to a persistent
 * worker process outside any Jest VM realm; see `docs/architecture/testing.md`). `closeBrowser()`
 * became `closePdfRenderer()` (`render-pdf.ts`) as part of that fix — it recycles whichever
 * browser is actually rendering (the shared worker's, in `NODE_ENV=test`), not this file's own
 * in-process singleton, which the worker delegation means is no longer used at all in tests.
 */
jest.setTimeout(45000);

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

describe('Hold Workflow Verification (Phase 7F, 2026-08-04)', () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    // `closePdfRenderer()` runs in `finally` — it must recycle the shared renderer even if
    // `cleanTestData()`/`prisma.$disconnect()` above throws, matching `payslips.test.ts`'s and
    // `statements.test.ts`'s own established lifecycle pattern.
    try {
      await cleanTestData();
      await prisma.$disconnect();
    } finally {
      await closePdfRenderer();
    }
  });

  async function masterAdminAgent(email: string) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.MASTER_ADMIN,
      permissionKeys: [
        PERMISSIONS.PAYROLL_CYCLE_MANAGE,
        PERMISSIONS.PAYROLL_ENTRY,
        PERMISSIONS.PAYROLL_RELEASE,
        PERMISSIONS.BANK_SHEETS_VIEW,
        PERMISSIONS.PAYSLIPS_VIEW,
        PERMISSIONS.STATEMENTS_VIEW,
      ],
    });
  }

  // Matches `payslips.test.ts`'s own identical `binaryParser` helper exactly (duplicated locally
  // rather than shared — each export/PDF test file already does this independently).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function binaryParser(res: any, callback: (err: Error | null, body: unknown) => void) {
    res.setEncoding('binary');
    let data = '';
    res.on('data', (chunk: string) => {
      data += chunk;
    });
    res.on('end', () => {
      callback(null, Buffer.from(data, 'binary'));
    });
  }

  async function makeSiteWithUnit(name: string) {
    const site = await prisma.projectSite.create({ data: { name } });
    const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} Unit` } });
    return { site, unit };
  }

  async function makeDraftCycle(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, month: number) {
    const res = await admin.agent.post('/api/v1/payroll-cycles').set('x-csrf-token', admin.csrfToken).send({ year: 2900, month });
    return res.body.cycle as { id: string };
  }

  async function createEntry(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, cycleId: string, employeeId: string) {
    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycleId}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId, workLines: [{ days: '26' }] }); // non-zero days ⇒ positive net salary
    return res.body.entry as { id: string; version: number };
  }

  async function setHold(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, entryId: string, version: number, hold: boolean) {
    const res = await admin.agent
      .patch(`/api/v1/payroll-entries/${entryId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version, hold });
    expect(res.status).toBe(200);
    return res.body.entry as { id: string; version: number; hold: boolean };
  }

  async function unitStatusFor(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, cycleId: string, siteId: string) {
    const res = await admin.agent.get(`/api/v1/payroll-cycles/${cycleId}/units?siteId=${siteId}`);
    expect(res.status).toBe(200);
    return res.body.units as Array<{ unit: { id: string }; released: boolean; entryCount: number; willReleaseCount: number; heldCount: number }>;
  }

  it('the full documented lifecycle: Hold OFF → releasable → Hold ON → excluded → release remaining → status → Hold OFF → releasable again → status updates', async () => {
    const admin = await masterAdminAgent('hold-lifecycle-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Hold Lifecycle');
    const cycle = await makeDraftCycle(admin, 1);
    const held = await prisma.employee.create({ data: { name: 'Lifecycle Held Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' } });
    const normal = await prisma.employee.create({ data: { name: 'Lifecycle Normal Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' } });

    let heldEntry = await createEntry(admin, cycle.id, held.id);
    const normalEntry = await createEntry(admin, cycle.id, normal.id);

    // Step 1 — Draft Payroll, Hold OFF (default): both employees appear as releasable.
    let status = await unitStatusFor(admin, cycle.id, site.id);
    expect(status[0]!.willReleaseCount).toBe(2);
    expect(status[0]!.heldCount).toBe(0);

    // Step 2 — Hold ON: the held employee disappears from "will release now", surfaces under
    // `heldCount` instead — never silently absent with no explanation.
    heldEntry = await setHold(admin, heldEntry.id, heldEntry.version, true);
    status = await unitStatusFor(admin, cycle.id, site.id);
    expect(status[0]!.willReleaseCount).toBe(1);
    expect(status[0]!.heldCount).toBe(1);

    // Step 3 — Release remaining employees: releasing the Unit pays the normal employee and
    // permanently skips the held one, exactly as `releaseProjectUnit`'s own candidate query
    // (`hold: false`) has always guaranteed.
    const release1 = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${unit.id}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(release1.status).toBe(201);
    expect(release1.body.releasedEntryCount).toBe(1);
    expect(release1.body.isLateSweep).toBe(false);

    const normalAfterRelease = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: normalEntry.id } });
    const heldAfterRelease = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: heldEntry.id } });
    expect(normalAfterRelease.released).toBe(true);
    expect(heldAfterRelease.released).toBe(false);
    expect(heldAfterRelease.hold).toBe(true);

    // Step 4 — Site status: the Unit itself is released (only one Unit at this Site, so "released"
    // here); the held employee's own remaining Held status is still visible.
    status = await unitStatusFor(admin, cycle.id, site.id);
    expect(status[0]!.released).toBe(true);
    expect(status[0]!.heldCount).toBe(1);
    expect(status[0]!.willReleaseCount).toBe(0); // nothing new to sweep while still Held

    // A second Release attempt with nothing new eligible is still cleanly rejected — this must
    // never silently succeed or silently no-op with a 201.
    const releaseAgainTooSoon = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${unit.id}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(releaseAgainTooSoon.status).toBe(409);

    // Step 5 — Later, Hold OFF: the employee becomes eligible again. `willReleaseCount` reflects it
    // even though the Unit itself already shows `released: true` (Late/Straggler Sweep visibility).
    heldEntry = await setHold(admin, heldEntry.id, heldEntry.version, false);
    status = await unitStatusFor(admin, cycle.id, site.id);
    expect(status[0]!.released).toBe(true);
    expect(status[0]!.heldCount).toBe(0);
    expect(status[0]!.willReleaseCount).toBe(1);

    // Step 6 — Only that employee may now be released: the Late/Straggler Sweep releases exactly
    // the one straggler, without creating a second `PayrollUnitRelease` row and without touching
    // the employee already released in Step 3.
    const releaseCountBefore = await prisma.payrollUnitRelease.count({ where: { cycleId: cycle.id, unitId: unit.id } });
    const release2 = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${unit.id}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(release2.status).toBe(201);
    expect(release2.body.releasedEntryCount).toBe(1);
    expect(release2.body.isLateSweep).toBe(true);
    expect(release2.body.release.id).toBe(release1.body.release.id); // same release event, not a new one
    const releaseCountAfter = await prisma.payrollUnitRelease.count({ where: { cycleId: cycle.id, unitId: unit.id } });
    expect(releaseCountAfter).toBe(releaseCountBefore); // still exactly one row — no un-release, no re-release

    const heldEmployeeFinal = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: heldEntry.id } });
    expect(heldEmployeeFinal.released).toBe(true);
    const normalEmployeeStillFine = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: normalEntry.id } });
    expect(normalEmployeeStillFine.released).toBe(true);
    expect(normalEmployeeStillFine.releasedAt!.getTime()).toBe(normalAfterRelease.releasedAt!.getTime()); // untouched by the later sweep

    // Step 7 — Site status updates correctly: fully released, nothing held, nothing pending.
    status = await unitStatusFor(admin, cycle.id, site.id);
    expect(status[0]!.released).toBe(true);
    expect(status[0]!.heldCount).toBe(0);
    expect(status[0]!.willReleaseCount).toBe(0);
    expect(status[0]!.entryCount).toBe(2);

    // The audit trail distinguishes the original release from the later sweep.
    const lateSweepAudit = await prisma.auditLog.findFirst({ where: { action: 'payroll_unit.late_sweep', entityId: release1.body.release.id } });
    expect(lateSweepAudit).not.toBeNull();
    expect((lateSweepAudit!.metadata as { resolvedEntryIds: string[] }).resolvedEntryIds).toEqual([heldEntry.id]);
  });

  it('a Late/Straggler Sweep with genuinely nothing new eligible still rejects with the same 409 as before (no accidental behavior change for the ordinary double-click case)', async () => {
    const admin = await masterAdminAgent('hold-late-sweep-noop-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Hold Late Sweep Noop');
    const cycle = await makeDraftCycle(admin, 2);
    const employee = await prisma.employee.create({ data: { name: 'Noop Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' } });
    await createEntry(admin, cycle.id, employee.id);

    const first = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${unit.id}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(first.status).toBe(201);
    expect(first.body.isLateSweep).toBe(false);

    const second = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${unit.id}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(second.status).toBe(409);
    expect(second.body.error.message).toBe('This Project Unit has already been released for this cycle');
  });

  it('a straggler entry split across two Units only sweeps once every touched Unit is released — Late Sweep respects the same multi-Unit wait rule as a fresh release', async () => {
    const admin = await masterAdminAgent('hold-late-sweep-multiunit-admin@test.local');
    const site = await prisma.projectSite.create({ data: { name: 'Test Site Hold Late Sweep Multiunit' } });
    const unitA = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'Unit A' } });
    const unitB = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'Unit B' } });
    const cycle = await makeDraftCycle(admin, 3);
    const employee = await prisma.employee.create({ data: { name: 'Split Straggler Employee', designation: 'Guard', siteId: site.id, unitId: unitA.id, grossPay: '30000' } });

    const created = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id, workLines: [{ unitId: unitA.id, days: '13' }] });
    let entry = created.body.entry as { id: string; version: number };
    const addLine = await admin.agent
      .post(`/api/v1/payroll-entries/${entry.id}/work-lines`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, unitId: unitB.id, days: '13' });
    entry = addLine.body.entry;
    entry = await setHold(admin, entry.id, entry.version, true);

    // Unit A releases first — the held (still-held) employee is skipped entirely, same as always.
    const releaseA = await admin.agent.post(`/api/v1/payroll-cycles/${cycle.id}/units/${unitA.id}/release`).set('x-csrf-token', admin.csrfToken).send({});
    expect(releaseA.status).toBe(201);
    expect(releaseA.body.releasedEntryCount).toBe(0);

    entry = await setHold(admin, entry.id, entry.version, false);

    // A late sweep on Unit A alone must NOT release the entry yet — Unit B hasn't released.
    const status = await unitStatusFor(admin, cycle.id, site.id);
    const unitAStatus = status.find((s) => s.unit.id === unitA.id)!;
    expect(unitAStatus.willReleaseCount).toBe(0); // Unit B still pending, so not "will release now"

    const lateSweepTooSoon = await admin.agent.post(`/api/v1/payroll-cycles/${cycle.id}/units/${unitA.id}/release`).set('x-csrf-token', admin.csrfToken).send({});
    expect(lateSweepTooSoon.status).toBe(409); // nothing newly eligible at Unit A specifically

    // Unit B releases — this is the sweep that finally resolves the entry (Unit A already released
    // earlier; Unit B is a fresh release, not a late sweep, since Unit B itself was never released).
    const releaseB = await admin.agent.post(`/api/v1/payroll-cycles/${cycle.id}/units/${unitB.id}/release`).set('x-csrf-token', admin.csrfToken).send({});
    expect(releaseB.status).toBe(201);
    expect(releaseB.body.releasedEntryCount).toBe(1);
    expect(releaseB.body.isLateSweep).toBe(false);

    const finalEntry = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(finalEntry.released).toBe(true);
  });

  it('Site Release Status derivation (Partial Release Status audit) reports Draft, Partially Released, Held Remaining, and Released correctly across the lifecycle', async () => {
    const admin = await masterAdminAgent('hold-site-status-admin@test.local');
    const site = await prisma.projectSite.create({ data: { name: 'Test Site Hold Site Status' } });
    const unitA = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'Unit Alpha' } });
    const unitB = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'Unit Beta' } });
    const cycle = await makeDraftCycle(admin, 4);
    const empA = await prisma.employee.create({ data: { name: 'Site Status Employee A', designation: 'Guard', siteId: site.id, unitId: unitA.id, grossPay: '30000' } });
    const empB = await prisma.employee.create({ data: { name: 'Site Status Employee B', designation: 'Guard', siteId: site.id, unitId: unitB.id, grossPay: '30000' } });
    let entryA = await createEntry(admin, cycle.id, empA.id);
    await createEntry(admin, cycle.id, empB.id);

    // Draft: nothing released yet, nothing held — the frontend derives "Draft" from this shape
    // (`SiteReleaseStatusBadge`, `salary-release-page.tsx`): releasedCount 0, totalWillRelease > 0.
    let status = await unitStatusFor(admin, cycle.id, site.id);
    expect(status.every((s) => !s.released)).toBe(true);
    expect(status.reduce((sum, s) => sum + s.willReleaseCount, 0)).toBe(2);

    // Hold Unit Alpha's employee, then release both Units — Alpha resolves nobody (held), Beta
    // resolves its own employee — "Partially Released" is the wrong label here (both Units DID
    // release, one just paid nobody) — the derived badge computes this from released-Unit-count,
    // which is 2 of 2, so this is correctly "Released" at the Unit-action level even though one
    // employee individually remains Held — matches the frontend's own documented tone choice
    // (Held Remaining takes priority display when releasedCount<units.length; here it's fully
    // released as an action, with a residual Held entry surfaced via heldCount separately).
    entryA = await setHold(admin, entryA.id, entryA.version, true);
    await admin.agent.post(`/api/v1/payroll-cycles/${cycle.id}/units/${unitA.id}/release`).set('x-csrf-token', admin.csrfToken).send({});
    await admin.agent.post(`/api/v1/payroll-cycles/${cycle.id}/units/${unitB.id}/release`).set('x-csrf-token', admin.csrfToken).send({});

    status = await unitStatusFor(admin, cycle.id, site.id);
    expect(status.every((s) => s.released)).toBe(true);
    const totalHeld = status.reduce((sum, s) => sum + s.heldCount, 0);
    expect(totalHeld).toBe(1);

    // Hold OFF — the straggler becomes releasable via the Late Sweep; site-level `willReleaseCount`
    // now correctly reflects one employee ready to sweep even though every Unit already released.
    await setHold(admin, entryA.id, entryA.version, false);
    status = await unitStatusFor(admin, cycle.id, site.id);
    expect(status.reduce((sum, s) => sum + s.willReleaseCount, 0)).toBe(1);
    expect(status.reduce((sum, s) => sum + s.heldCount, 0)).toBe(0);

    const lateSweep = await admin.agent.post(`/api/v1/payroll-cycles/${cycle.id}/units/${unitA.id}/release`).set('x-csrf-token', admin.csrfToken).send({});
    expect(lateSweep.status).toBe(201);
    expect(lateSweep.body.isLateSweep).toBe(true);
    expect(lateSweep.body.releasedEntryCount).toBe(1);

    status = await unitStatusFor(admin, cycle.id, site.id);
    expect(status.every((s) => s.released)).toBe(true);
    expect(status.reduce((sum, s) => sum + s.willReleaseCount, 0)).toBe(0);
    expect(status.reduce((sum, s) => sum + s.heldCount, 0)).toBe(0);
  });

  // --- Phase 7F Refinement (2026-08-04) — Release Remaining idempotency ------------------------

  it('Release Remaining idempotency: a second call after nothing new is eligible performs no release, no duplicate audit, no duplicate PayrollUnitRelease, and no duplicate Bank Sheet/Cash Receiving/Payslip/Statement row', async () => {
    const admin = await masterAdminAgent('release-remaining-idempotency-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Release Remaining Idempotency');
    const bank = await prisma.bank.create({ data: { code: 'TBRRIDEM', name: 'Test Bank Release Remaining Idempotency' } });
    // Cycle created before either Employee — the same fixture-ordering reason established
    // elsewhere: creating a cycle bootstraps entries for every already-existing Employee, which
    // would otherwise silently pre-empt the explicit `createEntry` calls below.
    const cycle = await makeDraftCycle(admin, 1);

    // The straggler — bank-paid, so its own eventual release is directly observable in Bank Sheet.
    const stragglerEmployee = await prisma.employee.create({
      data: {
        name: 'Idempotency Straggler',
        designation: 'Guard',
        siteId: site.id,
        unitId: unit.id,
        grossPay: '30000',
        bankId: bank.id,
        accountNumber: '1234500001',
      },
    });
    // The normal employee — cash-paid, so Cash Receiving's own row count is independently
    // observable as stable throughout (unaffected by anything that happens to the straggler).
    const normalEmployee = await prisma.employee.create({ data: { name: 'Idempotency Normal', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' } });

    let stragglerEntry = await createEntry(admin, cycle.id, stragglerEmployee.id);
    const normalEntry = await createEntry(admin, cycle.id, normalEmployee.id);
    stragglerEntry = await setHold(admin, stragglerEntry.id, stragglerEntry.version, true);

    // "remaining employees released" — the Unit releases with the straggler held and excluded.
    const firstRelease = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${unit.id}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(firstRelease.status).toBe(201);
    expect(firstRelease.body.releasedEntryCount).toBe(1);
    expect(firstRelease.body.isLateSweep).toBe(false);
    const releaseId = firstRelease.body.release.id as string;

    // "hold removed"
    stragglerEntry = await setHold(admin, stragglerEntry.id, stragglerEntry.version, false);

    // "Release Remaining executed" — the late sweep resolves the straggler.
    const lateSweep = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${unit.id}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(lateSweep.status).toBe(201);
    expect(lateSweep.body.isLateSweep).toBe(true);
    expect(lateSweep.body.releasedEntryCount).toBe(1);
    expect(lateSweep.body.release.id).toBe(releaseId); // same release event, not a new one

    // --- Snapshot every observable surface after the FIRST (successful) Release Remaining -------
    const unitReleaseCountAfterFirst = await prisma.payrollUnitRelease.count({ where: { cycleId: cycle.id, unitId: unit.id } });
    const lateSweepAuditAfterFirst = await prisma.auditLog.findMany({ where: { action: 'payroll_unit.late_sweep', entityId: releaseId } });
    const entryReleasedAuditAfterFirst = await prisma.auditLog.findMany({ where: { action: 'payroll_entry.released', entityId: stragglerEntry.id } });
    const stragglerRowAfterFirst = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: stragglerEntry.id } });
    expect(stragglerRowAfterFirst.released).toBe(true);

    const bankSheetAfterFirst = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/bank-sheet?bankId=${bank.id}`);
    expect(bankSheetAfterFirst.status).toBe(200);
    expect(bankSheetAfterFirst.body.rows).toHaveLength(1);
    expect(bankSheetAfterFirst.body.rows[0].entryId).toBe(stragglerEntry.id);
    const bankSheetNetSalaryAfterFirst = bankSheetAfterFirst.body.rows[0].netSalary as string;

    const cashReceivingAfterFirst = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/cash-receiving`);
    expect(cashReceivingAfterFirst.status).toBe(200);
    expect(cashReceivingAfterFirst.body.rows).toHaveLength(1);
    expect(cashReceivingAfterFirst.body.rows[0].entryId).toBe(normalEntry.id);

    const payslipAfterFirst = await admin.agent
      .get(`/api/v1/payroll-cycles/${cycle.id}/payslips/${stragglerEmployee.id}/pdf`)
      .buffer(true)
      .parse(binaryParser);
    expect(payslipAfterFirst.status).toBe(200);
    expect((payslipAfterFirst.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    const statementAfterFirst = await admin.agent.get(`/api/v1/employees/${stragglerEmployee.id}/statement`);
    expect(statementAfterFirst.status).toBe(200);
    const statementEntriesAfterFirst = statementAfterFirst.body.entries as unknown[];
    expect(statementEntriesAfterFirst).toHaveLength(1); // exactly one ledger line for this one release

    // --- "Release Remaining executed again" — nothing is newly eligible; must reject cleanly -----
    const secondAttempt = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${unit.id}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(secondAttempt.status).toBe(409);
    expect(secondAttempt.body.error.message).toBe('This Project Unit has already been released for this cycle');
    // The rejected request never even reaches a "releasedEntryCount" outcome — it's an error body,
    // not a success result, so there is nothing to assert as "0 released" beyond the 409 itself.

    // --- Re-snapshot everything — must be byte-for-byte identical to the after-first snapshot ----
    const unitReleaseCountAfterSecond = await prisma.payrollUnitRelease.count({ where: { cycleId: cycle.id, unitId: unit.id } });
    expect(unitReleaseCountAfterSecond).toBe(unitReleaseCountAfterFirst); // no duplicate PayrollUnitRelease
    expect(unitReleaseCountAfterSecond).toBe(1);

    const lateSweepAuditAfterSecond = await prisma.auditLog.findMany({ where: { action: 'payroll_unit.late_sweep', entityId: releaseId } });
    expect(lateSweepAuditAfterSecond).toHaveLength(lateSweepAuditAfterFirst.length); // no duplicate audit
    expect(lateSweepAuditAfterSecond).toHaveLength(1);

    const entryReleasedAuditAfterSecond = await prisma.auditLog.findMany({ where: { action: 'payroll_entry.released', entityId: stragglerEntry.id } });
    expect(entryReleasedAuditAfterSecond).toHaveLength(entryReleasedAuditAfterFirst.length); // no duplicate audit
    expect(entryReleasedAuditAfterSecond).toHaveLength(1);

    const stragglerRowAfterSecond = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: stragglerEntry.id } });
    expect(stragglerRowAfterSecond.version).toBe(stragglerRowAfterFirst.version); // never re-written
    expect(stragglerRowAfterSecond.releasedAt!.getTime()).toBe(stragglerRowAfterFirst.releasedAt!.getTime());

    const bankSheetAfterSecond = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/bank-sheet?bankId=${bank.id}`);
    expect(bankSheetAfterSecond.status).toBe(200);
    expect(bankSheetAfterSecond.body.rows).toHaveLength(1); // no duplicate Bank Sheet row
    expect(bankSheetAfterSecond.body.rows[0].entryId).toBe(stragglerEntry.id);
    expect(bankSheetAfterSecond.body.rows[0].netSalary).toBe(bankSheetNetSalaryAfterFirst); // unchanged amount

    const cashReceivingAfterSecond = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/cash-receiving`);
    expect(cashReceivingAfterSecond.status).toBe(200);
    expect(cashReceivingAfterSecond.body.rows).toHaveLength(1); // no duplicate Cash Receiving row

    const payslipAfterSecond = await admin.agent
      .get(`/api/v1/payroll-cycles/${cycle.id}/payslips/${stragglerEmployee.id}/pdf`)
      .buffer(true)
      .parse(binaryParser);
    expect(payslipAfterSecond.status).toBe(200); // still generates cleanly, no corruption/duplication
    expect((payslipAfterSecond.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    const statementAfterSecond = await admin.agent.get(`/api/v1/employees/${stragglerEmployee.id}/statement`);
    expect(statementAfterSecond.status).toBe(200);
    const statementEntriesAfterSecond = statementAfterSecond.body.entries as unknown[];
    expect(statementEntriesAfterSecond).toHaveLength(1); // still exactly one — no duplicate Statement line
    expect(JSON.stringify(statementEntriesAfterSecond)).toBe(JSON.stringify(statementEntriesAfterFirst));
  });
});
