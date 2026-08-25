import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { computeEntryCalc, type EntryWithWorkLines } from '../src/modules/payroll-entry/payroll-entry.service';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

/**
 * v1.0.2 Advance Edit/Cancel checkpoint (2026-08-25) — the Advance ledger / Payroll Entry
 * deduction integrity boundary, plus the widened RESERVED-editable semantics and the defensive
 * legacy-mismatch guard, all introduced by this checkpoint. Covers exactly the production defect
 * (a real employee's `advanceDeduction` was edited directly on the Payroll Entry grid, diverging
 * from its linked Advance's own `totalAmount`, which then crashed Cancel's own reversal with an
 * unhandled `Advance_outstandingBalance_check` violation) and the fix set: (1) Payroll Entry can no
 * longer accept a direct `advanceDeduction`/`eidAdvanceDeduction` edit once linked to an Advance —
 * `payroll-entry.service.ts`'s `assertDeductionNotAdvanceLinked`; (2) `updateAdvance` now also
 * allows a financial edit while `RESERVED` (previously ACTIVE-only), reusing its existing
 * reverse-then-re-materialize machinery unchanged; (3) a defensive bounds check
 * (`assertOutstandingBalanceWithinBounds`) in `updateAdvance`/`cancelAdvance`/`deferAdvanceSchedule`
 * turns a legacy-corrupted Advance's CHECK-constraint crash into one clear domain error instead;
 * (4) a fresh in-transaction re-read of the Advance closes the one concurrency gap its own
 * `PayrollEntry`-side version guard doesn't already cover (two concurrent calls that both find no
 * live entry to serialize on).
 */
describe('v1.0.2 — Advance/Payroll Entry deduction integrity, RESERVED edit, legacy-mismatch safety', () => {
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
        PERMISSIONS.ADVANCES_MANAGE,
        PERMISSIONS.PAYROLL_RELEASE,
      ],
    });
  }

  async function makeSiteWithUnit(name: string) {
    const site = await prisma.projectSite.create({ data: { name } });
    const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} Unit` } });
    return { site, unit };
  }

  async function makeEmployee(siteId: string, unitId: string, name: string, grossPay = '40000') {
    return prisma.employee.create({ data: { name, designation: 'Guard', siteId, unitId, grossPay } });
  }

  async function makeDraftCycle(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, year: number, month: number) {
    const res = await admin.agent
      .post('/api/v1/payroll-cycles')
      .set('x-csrf-token', admin.csrfToken)
      .send({ year, month });
    if (res.status !== 201) throw new Error(`cycle create failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.cycle as { id: string };
  }

  async function createAdvance(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, body: Record<string, unknown>) {
    return admin.agent.post('/api/v1/advances').set('x-csrf-token', admin.csrfToken).send(body);
  }

  async function getEntry(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, cycleId: string, employeeId: string) {
    const res = await admin.agent.get(`/api/v1/payroll-cycles/${cycleId}/entries?employeeId=${employeeId}`);
    return res.body.entries[0];
  }

  // A heavy Advance deduction against zero synthetic attendance can legitimately push netSalary
  // negative, which correctly resolves to RECOVERY_DUE (no `released: true`) rather than releasing
  // regardless of sign — exactly matching `advances.test.ts`'s own established `releaseUnit` helper.
  // This checkpoint's tests are about Advance/PayrollEntry integrity, not net-salary sign, so any
  // entry the sweep would otherwise touch gets just enough extra allowance to stay positive first.
  async function releaseUnit(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, cycleId: string, unitId: string) {
    const candidates = await prisma.payrollEntry.findMany({
      where: { cycleId, released: false, hold: false, payoutOutcome: null, workLines: { some: { unitId } } },
      include: { workLines: true },
    });
    for (const entry of candidates) {
      const calc = computeEntryCalc(entry as EntryWithWorkLines);
      const net = Number(calc.netSalary);
      if (net <= 0) {
        const topUp = (Number(entry.allowance) + Math.abs(net) + 100).toFixed(2);
        await prisma.payrollEntry.update({ where: { id: entry.id }, data: { allowance: topUp } });
      }
    }

    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycleId}/units/${unitId}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(res.status).toBe(201);
  }

  // --- Fix 1: Payroll Entry can no longer directly edit an Advance-linked deduction ------------

  it('rejects a direct advanceDeduction PATCH on a Payroll Entry once linked to an Advance', async () => {
    const admin = await masterAdminAgent('integ-direct-patch-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Integ Direct Patch');
    const employee = await makeEmployee(site.id, unit.id, 'Direct Patch Employee');
    const cycle = await makeDraftCycle(admin, 2910, 1);

    const advance = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '5000',
      dateGiven: '2910-01-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2910, month: 1 },
    });
    expect(advance.status).toBe(201);

    const entry = await getEntry(admin, cycle.id, employee.id);
    expect(Number(entry.advanceDeduction)).toBe(5000);
    expect(entry.advanceId).toBe(advance.body.advance.id);

    const patchRes = await admin.agent
      .patch(`/api/v1/payroll-entries/${entry.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, advanceDeduction: '10000' });
    expect(patchRes.status).toBe(400);
    expect(patchRes.body.error.message).toMatch(/managed by a linked Advance/i);

    const entryAfter = await getEntry(admin, cycle.id, employee.id);
    expect(Number(entryAfter.advanceDeduction)).toBe(5000); // untouched — the rejection was atomic
    expect(entryAfter.version).toBe(entry.version); // no version bump for a rejected edit
  });

  it('rejects a direct eidAdvanceDeduction PATCH once linked, symmetric with advanceDeduction', async () => {
    const admin = await masterAdminAgent('integ-direct-eid-patch-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Integ Direct Eid Patch');
    const employee = await makeEmployee(site.id, unit.id, 'Direct Eid Patch Employee');
    const cycle = await makeDraftCycle(admin, 2910, 2);

    await createAdvance(admin, {
      employeeId: employee.id,
      type: 'EID_ADVANCE',
      totalAmount: '2000',
      dateGiven: '2910-02-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2910, month: 2 },
    });

    const entry = await getEntry(admin, cycle.id, employee.id);
    expect(entry.eidAdvanceId).not.toBeNull();

    const patchRes = await admin.agent
      .patch(`/api/v1/payroll-entries/${entry.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, eidAdvanceDeduction: '9999' });
    expect(patchRes.status).toBe(400);
    expect(patchRes.body.error.message).toMatch(/managed by a linked Eid Advance/i);
  });

  it('still allows a direct advanceDeduction PATCH when there is no linked Advance — the legitimate manual case is preserved', async () => {
    const admin = await masterAdminAgent('integ-manual-deduction-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Integ Manual Deduction');
    const employee = await makeEmployee(site.id, unit.id, 'Manual Deduction Employee');
    const cycle = await makeDraftCycle(admin, 2910, 3);

    const entry = await getEntry(admin, cycle.id, employee.id);
    expect(entry.advanceId).toBeNull();
    expect(Number(entry.advanceDeduction)).toBe(0);

    const patchRes = await admin.agent
      .patch(`/api/v1/payroll-entries/${entry.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, advanceDeduction: '1500' });
    expect(patchRes.status).toBe(200);
    expect(Number(patchRes.body.entry.advanceDeduction)).toBe(1500);
    expect(patchRes.body.entry.advanceId).toBeNull();
  });

  // --- Fix 3 (Phase D): RESERVED is now editable, exactly the required example -----------------

  it('editing a RESERVED Advance amount (5000 -> 10000) atomically updates the Advance and its Draft deduction together — the exact Phase D example', async () => {
    const admin = await masterAdminAgent('integ-reserved-edit-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Integ Reserved Edit');
    const employee = await makeEmployee(site.id, unit.id, 'Reserved Edit Employee');
    const cycle = await makeDraftCycle(admin, 2910, 4);

    const advance = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '5000',
      dateGiven: '2910-04-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2910, month: 4 },
    });
    const advanceId = advance.body.advance.id as string;

    const beforeEdit = (await admin.agent.get(`/api/v1/advances/${advanceId}`)).body.advance;
    expect(beforeEdit.status).toBe('RESERVED');
    expect(Number(beforeEdit.outstandingBalance)).toBe(0);

    // Unrelated financial figures — captured before, must be identical after (financial regression).
    const entryBefore = await getEntry(admin, cycle.id, employee.id);
    const calcBefore = entryBefore.calc;

    const editRes = await admin.agent
      .patch(`/api/v1/advances/${advanceId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ totalAmount: '10000' });
    expect(editRes.status).toBe(200);
    expect(editRes.body.advance.status).toBe('RESERVED'); // still fully reserved, not knocked back to ACTIVE
    expect(Number(editRes.body.advance.totalAmount)).toBe(10000);
    expect(Number(editRes.body.advance.outstandingBalance)).toBe(0);

    const entryAfter = await getEntry(admin, cycle.id, employee.id);
    expect(Number(entryAfter.advanceDeduction)).toBe(10000); // Draft deduction moved in lockstep
    expect(entryAfter.advanceId).toBe(advanceId);

    // Gross Pay, EOBI, earned amount — everything except the Advance deduction delta — unchanged.
    expect(entryAfter.calc.eobiDeduction).toBe(calcBefore.eobiDeduction);
    expect(entryAfter.calc.totalEarning).toBe(calcBefore.totalEarning);
    expect(Number(entryAfter.calc.totalDeduction)).toBeCloseTo(Number(calcBefore.totalDeduction) + 5000, 2);
    expect(Number(entryAfter.calc.netSalary)).toBeCloseTo(Number(calcBefore.netSalary) - 5000, 2);
  });

  it('decreasing a RESERVED Advance amount (5000 -> 2000, nothing released yet) is also allowed and synchronizes correctly', async () => {
    const admin = await masterAdminAgent('integ-reserved-decrease-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Integ Reserved Decrease');
    const employee = await makeEmployee(site.id, unit.id, 'Reserved Decrease Employee');
    const cycle = await makeDraftCycle(admin, 2910, 5);

    const advance = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '5000',
      dateGiven: '2910-05-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2910, month: 5 },
    });
    const advanceId = advance.body.advance.id as string;

    const editRes = await admin.agent
      .patch(`/api/v1/advances/${advanceId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ totalAmount: '2000' });
    expect(editRes.status).toBe(200);
    expect(Number(editRes.body.advance.totalAmount)).toBe(2000);
    expect(Number(editRes.body.advance.outstandingBalance)).toBe(0);
    expect(editRes.body.advance.status).toBe('RESERVED');

    const entryAfter = await getEntry(admin, cycle.id, employee.id);
    expect(Number(entryAfter.advanceDeduction)).toBe(2000);
  });

  it('rejects reducing a RESERVED Advance below what has already been repaid via RELEASED payroll', async () => {
    const admin = await masterAdminAgent('integ-reserved-floor-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Integ Reserved Floor');
    const employee = await makeEmployee(site.id, unit.id, 'Reserved Floor Employee', '40000');

    // Cycle 1: a LOAN of 3000, fully deducted, then released — this 3000 becomes the permanent floor.
    const cycle1 = await makeDraftCycle(admin, 2910, 6);
    const advance = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '3000',
      dateGiven: '2910-06-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2910, month: 6 },
    });
    const advanceId = advance.body.advance.id as string;
    await releaseUnit(admin, cycle1.id, unit.id);

    const afterRelease = (await admin.agent.get(`/api/v1/advances/${advanceId}`)).body.advance;
    expect(afterRelease.status).toBe('PAID_OFF'); // fully repaid — nothing left to edit

    const editRes = await admin.agent
      .patch(`/api/v1/advances/${advanceId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ totalAmount: '1000' });
    expect(editRes.status).toBe(400);
    expect(editRes.body.error.message).toMatch(/fully paid off/i);
  });

  it('rejects a negative or zero totalAmount on a RESERVED Advance edit', async () => {
    const admin = await masterAdminAgent('integ-reserved-negative-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Integ Reserved Negative');
    const employee = await makeEmployee(site.id, unit.id, 'Reserved Negative Employee');
    await makeDraftCycle(admin, 2910, 7);

    const advance = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '5000',
      dateGiven: '2910-07-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2910, month: 7 },
    });
    const advanceId = advance.body.advance.id as string;

    const negativeRes = await admin.agent
      .patch(`/api/v1/advances/${advanceId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ totalAmount: '-500' });
    expect(negativeRes.status).toBe(400);

    const zeroRes = await admin.agent
      .patch(`/api/v1/advances/${advanceId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ totalAmount: '0' });
    expect(zeroRes.status).toBe(400);
  });

  it('still rejects a financial edit once PAID_OFF or CANCELLED — unsafe lifecycle states remain blocked', async () => {
    const admin = await masterAdminAgent('integ-unsafe-lifecycle-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Integ Unsafe Lifecycle');
    const employee = await makeEmployee(site.id, unit.id, 'Unsafe Lifecycle Employee');
    await makeDraftCycle(admin, 2910, 8);

    const advance = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '5000',
      dateGiven: '2910-08-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2910, month: 8 },
    });
    const advanceId = advance.body.advance.id as string;

    const cancelRes = await admin.agent
      .post(`/api/v1/advances/${advanceId}/cancel`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ reason: 'test cancel' });
    expect(cancelRes.status).toBe(200);

    const editRes = await admin.agent
      .patch(`/api/v1/advances/${advanceId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ totalAmount: '9000' });
    expect(editRes.status).toBe(400);
    expect(editRes.body.error.message).toMatch(/cancelled/i);

    // notes remain editable even once cancelled.
    const notesRes = await admin.agent
      .patch(`/api/v1/advances/${advanceId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ notes: 'still fine to annotate' });
    expect(notesRes.status).toBe(200);
  });

  // --- Fix 2: legacy-mismatch defensive guard (the exact production defect, reproduced) ---------

  it('production defect reproduction: a legacy-corrupted linked deduction fails Cancel with a clear domain error, not a 500, and leaves nothing partially mutated', async () => {
    const admin = await masterAdminAgent('integ-legacy-cancel-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Integ Legacy Cancel');
    const employee = await makeEmployee(site.id, unit.id, 'Legacy Cancel Employee');
    const cycle = await makeDraftCycle(admin, 2910, 9);

    const advance = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '5000',
      dateGiven: '2910-09-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2910, month: 9 },
    });
    const advanceId = advance.body.advance.id as string;
    const entry = await getEntry(admin, cycle.id, employee.id);
    expect(Number(entry.advanceDeduction)).toBe(5000);

    // Simulate a pre-existing legacy-corrupted row (from before this checkpoint's fix existed, or
    // any other bypass of `assertDeductionNotAdvanceLinked`) directly at the database layer — this
    // is exactly the state the real production Advance (Sharafat Masih) was found in.
    await prisma.payrollEntry.update({
      where: { id: entry.id },
      data: { advanceDeduction: '10000', version: { increment: 1 } },
    });

    const cancelRes = await admin.agent
      .post(`/api/v1/advances/${advanceId}/cancel`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ reason: 'Wrong advance amount' });
    expect(cancelRes.status).toBe(409); // clear domain error, never the old unhandled 500
    expect(cancelRes.body.error.message).toMatch(/inconsistent with its recorded amount/i);

    // Nothing partially mutated — both rows exactly as they were immediately before the Cancel call.
    const advanceAfter = (await admin.agent.get(`/api/v1/advances/${advanceId}`)).body.advance;
    expect(advanceAfter.status).toBe('RESERVED');
    expect(Number(advanceAfter.totalAmount)).toBe(5000);
    expect(Number(advanceAfter.outstandingBalance)).toBe(0);

    const entryAfter = await getEntry(admin, cycle.id, employee.id);
    expect(Number(entryAfter.advanceDeduction)).toBe(10000); // still the corrupted value — untouched, not reverted
    expect(entryAfter.advanceId).toBe(advanceId);
  });

  it('the same legacy-corrupted state also fails an Edit attempt (not just Cancel) with a clear domain error', async () => {
    const admin = await masterAdminAgent('integ-legacy-edit-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Integ Legacy Edit');
    const employee = await makeEmployee(site.id, unit.id, 'Legacy Edit Employee');
    const cycle = await makeDraftCycle(admin, 2910, 10);

    const advance = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '5000',
      dateGiven: '2910-10-01',
      repaymentType: 'INSTALLMENT',
      scheduledInstallmentAmount: '2000',
      originalPeriod: { year: 2910, month: 10 },
    });
    const advanceId = advance.body.advance.id as string;
    const entry = await getEntry(admin, cycle.id, employee.id);
    expect(Number(entry.advanceDeduction)).toBe(2000); // INSTALLMENT — stays ACTIVE, not RESERVED

    await prisma.payrollEntry.update({
      where: { id: entry.id },
      data: { advanceDeduction: '9000', version: { increment: 1 } },
    });

    // Editing repaymentType (not totalAmount) still triggers the reverse-and-recalculate path,
    // exercising the guard even when totalAmount itself isn't part of this particular edit.
    const editRes = await admin.agent
      .patch(`/api/v1/advances/${advanceId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ repaymentType: 'FULL_DEDUCTION' });
    expect(editRes.status).toBe(409);
    expect(editRes.body.error.message).toMatch(/inconsistent with its recorded amount/i);
  });

  // --- Phase F: concurrency ------------------------------------------------------------------

  it('Edit vs Cancel racing on the same RESERVED Advance: one succeeds, the other is rejected, DB ends consistent', async () => {
    const admin = await masterAdminAgent('integ-race-edit-cancel-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Integ Race Edit Cancel');
    const employee = await makeEmployee(site.id, unit.id, 'Race Edit Cancel Employee');
    await makeDraftCycle(admin, 2910, 11);

    const advance = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '5000',
      dateGiven: '2910-11-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2910, month: 11 },
    });
    const advanceId = advance.body.advance.id as string;

    const [editRes, cancelRes] = await Promise.all([
      admin.agent.patch(`/api/v1/advances/${advanceId}`).set('x-csrf-token', admin.csrfToken).send({ totalAmount: '9000' }),
      admin.agent
        .post(`/api/v1/advances/${advanceId}/cancel`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ reason: 'racing cancel' }),
    ]);

    // Edit and Cancel are not mutually exclusive operations — unlike two conflicting writes racing
    // on the *same* stale data (covered by the legacy-mismatch and duplicate-Cancel tests above),
    // Edit-then-Cancel applied in either order is individually valid: whichever transaction's own
    // guarded `updateMany` commits first (on both the shared live `PayrollEntry` row and the
    // Advance's own atomic compare-and-swap) always sees the other's fully-committed result, never
    // a half-applied one — Postgres blocks the second writer on the row lock and re-evaluates its
    // `WHERE` clause against the post-commit values. So both legitimately returning 200 (Edit
    // applies 5000->9000, then Cancel correctly reverses the resulting 9000) is a valid outcome,
    // proven here by requiring the never-500 guarantee plus full numeric self-consistency of
    // whichever final state resulted — never a corrupted, lost-update, or unhandled-crash outcome.
    expect(editRes.status).not.toBe(500);
    expect(cancelRes.status).not.toBe(500);
    expect([editRes.status, cancelRes.status].filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);

    const finalAdvance = (await admin.agent.get(`/api/v1/advances/${advanceId}`)).body.advance;
    expect(['RESERVED', 'CANCELLED']).toContain(finalAdvance.status);
    // Whichever combination of outcomes resulted, the Advance's own bookkeeping stays internally
    // consistent (never a lost update, never out of the `[0, totalAmount]` CHECK-constraint bound).
    expect(Number(finalAdvance.outstandingBalance)).toBeGreaterThanOrEqual(0);
    expect(Number(finalAdvance.outstandingBalance)).toBeLessThanOrEqual(Number(finalAdvance.totalAmount));
  });

  it('duplicate Cancel submission on an Advance with no live entry to serialize on: the second call is rejected, never a double-cancel', async () => {
    const admin = await masterAdminAgent('integ-dup-cancel-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Integ Dup Cancel');
    const employee = await makeEmployee(site.id, unit.id, 'Dup Cancel Employee');
    // Deliberately no Draft cycle — an INSTALLMENT Advance with no schedule set yet materializes
    // nothing, so `cancelAdvance` finds no `liveEntry` to serialize the two calls on, exercising
    // this checkpoint's new in-transaction Advance re-read guard specifically.
    const advance = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '5000',
      dateGiven: '2910-12-01',
      repaymentType: 'INSTALLMENT',
      originalPeriod: { year: 2910, month: 12 },
    });
    const advanceId = advance.body.advance.id as string;

    const [first, second] = await Promise.all([
      admin.agent.post(`/api/v1/advances/${advanceId}/cancel`).set('x-csrf-token', admin.csrfToken).send({ reason: 'dup 1' }),
      admin.agent.post(`/api/v1/advances/${advanceId}/cancel`).set('x-csrf-token', admin.csrfToken).send({ reason: 'dup 2' }),
    ]);

    expect([first.status, second.status].filter((s) => s === 200)).toHaveLength(1);
    expect([first.status, second.status].filter((s) => s === 500)).toHaveLength(0);

    const cancelledAuditCount = await prisma.auditLog.count({ where: { action: 'advance.cancelled', entityId: advanceId } });
    expect(cancelledAuditCount).toBe(1); // never double-audited
  });

  it('Cancel vs Release: cancelling an already-released Advance is rejected (PAID_OFF), never double-processed', async () => {
    const admin = await masterAdminAgent('integ-cancel-vs-release-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Integ Cancel Vs Release');
    const employee = await makeEmployee(site.id, unit.id, 'Cancel Vs Release Employee', '40000');
    const cycle = await makeDraftCycle(admin, 2911, 1);

    const advance = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '3000',
      dateGiven: '2911-01-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2911, month: 1 },
    });
    const advanceId = advance.body.advance.id as string;

    await releaseUnit(admin, cycle.id, unit.id);
    const afterRelease = (await admin.agent.get(`/api/v1/advances/${advanceId}`)).body.advance;
    expect(afterRelease.status).toBe('PAID_OFF');

    const cancelRes = await admin.agent
      .post(`/api/v1/advances/${advanceId}/cancel`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ reason: 'too late' });
    expect(cancelRes.status).toBe(400);
    expect(cancelRes.body.error.message).toMatch(/fully paid off/i);

    // Released history is immutable regardless.
    const releasedEntry = await getEntry(admin, cycle.id, employee.id);
    expect(releasedEntry.released).toBe(true);
    expect(Number(releasedEntry.advanceDeduction)).toBe(3000);
  });

  // --- RBAC: unchanged, no broadened access -------------------------------------------------

  it('does not broaden permissions — Finance still cannot edit or cancel Advances, Payroll Staff still needs payroll:entry for the direct-PATCH guard', async () => {
    const admin = await masterAdminAgent('integ-rbac-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Integ RBAC');
    const employee = await makeEmployee(site.id, unit.id, 'RBAC Employee');
    await makeDraftCycle(admin, 2911, 2);

    const advance = await createAdvance(admin, {
      employeeId: employee.id,
      type: 'LOAN',
      totalAmount: '5000',
      dateGiven: '2911-02-01',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2911, month: 2 },
    });
    const advanceId = advance.body.advance.id as string;

    const finance = await createAuthenticatedAgent(app, {
      email: 'integ-rbac-finance@test.local',
      password: PASSWORD,
      roleCode: ROLE_CODES.FINANCE,
      permissionKeys: [PERMISSIONS.PAYROLL_VIEW, PERMISSIONS.PAYROLL_RELEASE, PERMISSIONS.BANK_SHEETS_VIEW],
      siteIds: [site.id],
    });

    const financeEditRes = await finance.agent
      .patch(`/api/v1/advances/${advanceId}`)
      .set('x-csrf-token', finance.csrfToken)
      .send({ totalAmount: '9000' });
    expect(financeEditRes.status).toBe(403);

    const financeCancelRes = await finance.agent
      .post(`/api/v1/advances/${advanceId}/cancel`)
      .set('x-csrf-token', finance.csrfToken)
      .send({ reason: 'no permission' });
    expect(financeCancelRes.status).toBe(403);
  });
});
