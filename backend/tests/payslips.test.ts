import { PERMISSIONS, ROLE_CODES, calcNet } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { closeBrowser } from '../src/lib/pdf/browser';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

/** supertest/superagent only auto-buffers `res.body` for content-types it recognizes as binary —
 * `application/pdf` isn't reliably one of them, so without this, `res.body` can come back empty/
 * corrupted rather than a real PDF buffer. Same pattern as `bank-sheets.test.ts`'s own
 * `binaryParser`, duplicated locally rather than shared — each export test file already does
 * this independently. */
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

describe('Phase 4 Checkpoint 6.1 — Payslips backend foundation', () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
    await closeBrowser();
  });

  async function masterAdminAgent(email: string) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.MASTER_ADMIN,
      permissionKeys: [PERMISSIONS.PAYROLL_CYCLE_MANAGE, PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.PAYROLL_RELEASE],
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

  async function financeAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.FINANCE,
      permissionKeys: [PERMISSIONS.PAYROLL_VIEW, PERMISSIONS.PAYROLL_RELEASE],
      siteIds,
    });
  }

  /** A bespoke role deliberately never granted `payslips:view` — the real Payroll Staff/Finance
   * roles already carry it (this checkpoint's seed grant), so there is no way to test "lacks this
   * permission" against either real role, same reasoning as `payroll-entry.test.ts`'s own
   * `noPayrollPermissionAgent`. */
  async function noPayslipsPermissionAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_NO_PAYSLIPS_VIEW',
      permissionKeys: [PERMISSIONS.PAYROLL_VIEW, PERMISSIONS.PAYROLL_ENTRY],
      siteIds,
    });
  }

  async function makeSiteWithUnit(name: string) {
    const site = await prisma.projectSite.create({ data: { name } });
    const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} Unit`, code: 'U-1' } });
    return { site, unit };
  }

  async function makeBank(code: string, name: string) {
    return prisma.bank.create({ data: { code: `TB${code}`, name } });
  }

  async function makeEmployee(
    siteId: string,
    unitId: string,
    name: string,
    options: {
      fatherName?: string;
      cnic?: string;
      employeeCode?: string;
      bankId?: string;
      branchCode?: string;
      accountNumber?: string;
      iban?: string;
      grossPay?: string;
    } = {},
  ) {
    return prisma.employee.create({
      data: {
        name,
        fatherName: options.fatherName,
        cnic: options.cnic,
        employeeCode: options.employeeCode,
        designation: 'Guard',
        siteId,
        unitId,
        grossPay: options.grossPay ?? '30000',
        bankId: options.bankId,
        branchCode: options.branchCode,
        accountNumber: options.accountNumber,
        iban: options.iban,
      },
    });
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
      .send({ employeeId });
    return res.body.entry as { id: string; version: number; workLines: { id: string; unitId: string }[] };
  }

  async function releaseUnit(
    admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>,
    cycleId: string,
    unitId: string,
  ) {
    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycleId}/units/${unitId}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(res.status).toBe(201);
  }

  // --- Permission tests -----------------------------------------------------------------------

  it('allows Master User, Payroll Staff (assigned site), and Finance (assigned site) access', async () => {
    const admin = await masterAdminAgent('ps-perm-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS Perm');
    const cycle = await makeDraftCycle(admin, 1);
    const employee = await makeEmployee(site.id, unit.id, 'Perm Employee');
    await createEntry(admin, cycle.id, employee.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const staff = await payrollStaffAgent('ps-perm-staff@test.local', [site.id]);
    const finance = await financeAgent('ps-perm-finance@test.local', [site.id]);

    const adminList = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips`);
    expect(adminList.status).toBe(200);
    const staffList = await staff.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips`);
    expect(staffList.status).toBe(200);
    const financeList = await finance.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips`);
    expect(financeList.status).toBe(200);

    const adminDetail = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips/${employee.id}`);
    expect(adminDetail.status).toBe(200);
    const staffDetail = await staff.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips/${employee.id}`);
    expect(staffDetail.status).toBe(200);
    const financeDetail = await finance.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips/${employee.id}`);
    expect(financeDetail.status).toBe(200);
  });

  it('rejects a user without payslips:view entirely — list and detail both 403', async () => {
    const admin = await masterAdminAgent('ps-noperm-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS NoPerm');
    const cycle = await makeDraftCycle(admin, 2);
    const employee = await makeEmployee(site.id, unit.id, 'NoPerm Employee');
    await createEntry(admin, cycle.id, employee.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const noPerm = await noPayslipsPermissionAgent('ps-noperm-user@test.local', [site.id]);

    const listRes = await noPerm.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips`);
    expect(listRes.status).toBe(403);

    const detailRes = await noPerm.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips/${employee.id}`);
    expect(detailRes.status).toBe(403);
  });

  // --- Site-scoping boundary tests -------------------------------------------------------------

  it('site-scopes Payroll Staff/Finance — a manipulated siteId filter outside assignment is rejected', async () => {
    const admin = await masterAdminAgent('ps-scope-admin@test.local');
    const { site: siteA } = await makeSiteWithUnit('Test Site PS Scope A');
    const { site: siteB } = await makeSiteWithUnit('Test Site PS Scope B');
    const cycle = await makeDraftCycle(admin, 3);
    const staffA = await payrollStaffAgent('ps-scope-staffA@test.local', [siteA.id]);

    const res = await staffA.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips?siteIds=${siteB.id}`);
    expect(res.status).toBe(403);
  });

  it('detail endpoint rejects an employee outside the caller\'s assigned sites', async () => {
    const admin = await masterAdminAgent('ps-scope-detail-admin@test.local');
    const { site: siteA } = await makeSiteWithUnit('Test Site PS Scope Detail A');
    const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site PS Scope Detail B');
    const cycle = await makeDraftCycle(admin, 4);
    const employeeB = await makeEmployee(siteB.id, unitB.id, 'Scope Detail Employee B');
    await createEntry(admin, cycle.id, employeeB.id);
    await releaseUnit(admin, cycle.id, unitB.id);

    const staffA = await payrollStaffAgent('ps-scope-detail-staffA@test.local', [siteA.id]);
    const res = await staffA.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips/${employeeB.id}`);
    expect(res.status).toBe(403);
  });

  it('detail endpoint 404s for a genuinely nonexistent employee/cycle combination, same as an unauthorized one leaks no distinguishing detail', async () => {
    const admin = await masterAdminAgent('ps-404-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS 404');
    const cycle = await makeDraftCycle(admin, 5);
    const employee = await makeEmployee(site.id, unit.id, '404 Employee');
    // Deliberately never given a PayrollEntry in this cycle.

    const res = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips/${employee.id}`);
    expect(res.status).toBe(404);
  });

  // --- Released/non-held enforcement ------------------------------------------------------------

  it('excludes an unreleased (Draft) entry from both the list and the detail endpoint', async () => {
    const admin = await masterAdminAgent('ps-draft-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS Draft');
    const cycle = await makeDraftCycle(admin, 6);
    const employee = await makeEmployee(site.id, unit.id, 'Draft Employee');
    await createEntry(admin, cycle.id, employee.id);
    // Deliberately NOT released.

    const listRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.employees).toHaveLength(0);

    const detailRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips/${employee.id}`);
    expect(detailRes.status).toBe(404);
  });

  it('excludes a held entry even after its Unit releases, from both list and detail', async () => {
    const admin = await masterAdminAgent('ps-hold-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS Hold');
    const cycle = await makeDraftCycle(admin, 7);
    const employee = await makeEmployee(site.id, unit.id, 'Hold Employee');
    const entry = await createEntry(admin, cycle.id, employee.id);
    await admin.agent
      .patch(`/api/v1/payroll-entries/${entry.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, hold: true });
    await releaseUnit(admin, cycle.id, unit.id);

    const listRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.employees).toHaveLength(0);

    const detailRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips/${employee.id}`);
    expect(detailRes.status).toBe(404);
  });

  it('includes a released, non-held entry in both the list and the detail endpoint', async () => {
    const admin = await masterAdminAgent('ps-released-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS Released');
    const cycle = await makeDraftCycle(admin, 8);
    const employee = await makeEmployee(site.id, unit.id, 'Released Employee');
    await createEntry(admin, cycle.id, employee.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const listRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.employees).toHaveLength(1);
    expect(listRes.body.employees[0].employeeName).toBe('Released Employee');

    const detailRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips/${employee.id}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.identity.employeeName).toBe('Released Employee');
    expect(detailRes.body.releasedAt).not.toBeNull();
  });

  // --- Calculation correctness -------------------------------------------------------------------

  it('matches calcNet exactly for a single-work-line entry', async () => {
    const admin = await masterAdminAgent('ps-calc-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS Calc');
    const cycle = await makeDraftCycle(admin, 9);
    const employee = await makeEmployee(site.id, unit.id, 'Calc Employee', { grossPay: '45000.10' });
    const entry = await createEntry(admin, cycle.id, employee.id);

    await admin.agent
      .patch(`/api/v1/payroll-entries/${entry.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, allowance: '1500', fine: '200' });

    const line = entry.workLines[0]!;
    await admin.agent
      .patch(`/api/v1/work-lines/${line.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version + 1, days: '25', otHours: '3' });

    await releaseUnit(admin, cycle.id, unit.id);

    const res = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips/${employee.id}`);
    expect(res.status).toBe(200);

    const stored = await prisma.payrollEntry.findUniqueOrThrow({
      where: { id: entry.id },
      include: { workLines: { orderBy: { sortOrder: 'asc' } } },
    });
    const expected = calcNet({
      grossPay: stored.grossPay.toString(),
      allowance: stored.allowance.toString(),
      leaveDays: stored.leaveDays.toString(),
      leaveRate: stored.leaveRate?.toString() ?? null,
      eobiAmount: stored.eobiAmount.toString(),
      eobiApplicable: stored.eobiApplicable,
      advanceDeduction: stored.advanceDeduction.toString(),
      eidAdvanceDeduction: stored.eidAdvanceDeduction.toString(),
      fine: stored.fine.toString(),
      workLines: stored.workLines.map((l) => ({
        sortOrder: l.sortOrder,
        days: l.days.toString(),
        otHours: l.otHours.toString(),
        otRate: l.otRate?.toString() ?? null,
        cycleDays: l.cycleDays,
      })),
    });

    expect(res.body.netSalary).toBe(expected.netSalary);
    expect(res.body.earnings.totalEarning).toBe(expected.totalEarning);
    expect(res.body.deductions.totalDeduction).toBe(expected.totalDeduction);
    expect(res.body.earnings.earnedAmount).toBe(expected.earnedAmount);
    expect(res.body.earnings.overtimeAmount).toBe(expected.otEarned);
    expect(res.body.earnings.leaveEarned).toBe(expected.leaveEarned);
    expect(res.body.deductions.eobiDeduction).toBe(expected.eobiDeduction);
  });

  it('calculates a split-by-unit (multi-work-line) entry correctly, matching calcNet\'s per-line and total figures', async () => {
    const admin = await masterAdminAgent('ps-split-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS Split');
    const secondUnit = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'Second Split Unit', code: 'U-2' } });
    const cycle = await makeDraftCycle(admin, 10);
    const employee = await makeEmployee(site.id, unit.id, 'Split Employee', { grossPay: '36000' });
    const entry = await createEntry(admin, cycle.id, employee.id);

    const firstLine = entry.workLines[0]!;
    await admin.agent
      .patch(`/api/v1/work-lines/${firstLine.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, days: '12', otHours: '1' });

    const added = await admin.agent
      .post(`/api/v1/payroll-entries/${entry.id}/work-lines`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version + 1, unitId: secondUnit.id, days: '15', otHours: '2', cycleDays: 30 });
    expect(added.status).toBe(201);

    // A split entry only flips to `released` once EVERY unit its work lines touch has released
    // (`payroll-release.service.ts`'s `willReleaseCount`) — both units must release here.
    await releaseUnit(admin, cycle.id, unit.id);
    await releaseUnit(admin, cycle.id, secondUnit.id);

    const res = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips/${employee.id}`);
    expect(res.status).toBe(200);
    expect(res.body.workLines).toHaveLength(2);
    expect(res.body.earnings.workingDays).toBe('27.00'); // 12 + 15
    expect(res.body.earnings.overtimeHours).toBe('3.00'); // 1 + 2

    const stored = await prisma.payrollEntry.findUniqueOrThrow({
      where: { id: entry.id },
      include: { workLines: { orderBy: { sortOrder: 'asc' } } },
    });
    const expected = calcNet({
      grossPay: stored.grossPay.toString(),
      allowance: stored.allowance.toString(),
      leaveDays: stored.leaveDays.toString(),
      leaveRate: stored.leaveRate?.toString() ?? null,
      eobiAmount: stored.eobiAmount.toString(),
      eobiApplicable: stored.eobiApplicable,
      advanceDeduction: stored.advanceDeduction.toString(),
      eidAdvanceDeduction: stored.eidAdvanceDeduction.toString(),
      fine: stored.fine.toString(),
      workLines: stored.workLines.map((l) => ({
        sortOrder: l.sortOrder,
        days: l.days.toString(),
        otHours: l.otHours.toString(),
        otRate: l.otRate?.toString() ?? null,
        cycleDays: l.cycleDays,
      })),
    });

    expect(res.body.netSalary).toBe(expected.netSalary);
    expect(res.body.earnings.earnedAmount).toBe(expected.earnedAmount);
    expect(res.body.earnings.overtimeAmount).toBe(expected.otEarned);
    // Per-line breakdown matches calcNet's own, in the same order.
    expect(res.body.workLines[0].earnedAmount).toBe(expected.workLines[0]!.earnedAmount);
    expect(res.body.workLines[1].earnedAmount).toBe(expected.workLines[1]!.earnedAmount);
    expect(res.body.workLines[1].unitId).toBe(secondUnit.id);
  });

  // --- Historical snapshot integrity ---------------------------------------------------------

  it('freezes employee name and father name at the moment of release — a later Employee rename never changes the Payslip', async () => {
    const admin = await masterAdminAgent('ps-name-snap-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS Name Snapshot');
    const cycle = await makeDraftCycle(admin, 11);
    const employee = await makeEmployee(site.id, unit.id, 'Original Name', { fatherName: 'Original Father' });
    await createEntry(admin, cycle.id, employee.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const before = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips/${employee.id}`);
    expect(before.body.identity.employeeName).toBe('Original Name');
    expect(before.body.identity.fatherName).toBe('Original Father');

    await prisma.employee.update({
      where: { id: employee.id },
      data: { name: 'Renamed Employee', fatherName: 'Renamed Father' },
    });

    const after = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips/${employee.id}`);
    expect(after.status).toBe(200);
    expect(after.body.identity.employeeName).toBe('Original Name');
    expect(after.body.identity.fatherName).toBe('Original Father');

    // The picker/list also reflects the frozen snapshot, not the live rename.
    const list = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips`);
    expect(list.body.employees[0].employeeName).toBe('Original Name');
  });

  it('freezes designation and banking (bankId/branchCode/accountNumber/iban) — never reflects a post-release Employee edit', async () => {
    const admin = await masterAdminAgent('ps-bank-snap-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS Bank Snapshot');
    const cycle = await makeDraftCycle(admin, 12);
    const bankOriginal = await makeBank('ORIG', 'Original Bank');
    const bankNew = await makeBank('NEW', 'New Bank');
    const employee = await makeEmployee(site.id, unit.id, 'Bank Snapshot Employee', {
      bankId: bankOriginal.id,
      branchCode: '001',
      accountNumber: '1111111111',
      iban: 'PK36SCBL0000001123456701',
    });
    await createEntry(admin, cycle.id, employee.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const before = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips/${employee.id}`);
    expect(before.body.banking.bankCode).toBe(bankOriginal.code);
    expect(before.body.banking.accountNumber).toBe('1111111111');
    expect(before.body.banking.iban).toBe('PK36SCBL0000001123456701');
    expect(before.body.identity.designation).toBe('Guard');

    await prisma.employee.update({
      where: { id: employee.id },
      data: {
        bankId: bankNew.id,
        branchCode: '002',
        accountNumber: '2222222222',
        iban: 'PK36SCBL0000001123456702',
        designation: 'Supervisor',
      },
    });

    const after = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips/${employee.id}`);
    expect(after.body.banking.bankCode).toBe(bankOriginal.code);
    expect(after.body.banking.accountNumber).toBe('1111111111');
    expect(after.body.banking.iban).toBe('PK36SCBL0000001123456701');
    expect(after.body.identity.designation).toBe('Guard');
  });

  it('never recalculates a released deduction from a later change to Advance.outstandingBalance', async () => {
    const admin = await masterAdminAgent('ps-advance-snap-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS Advance Snapshot');
    const cycle = await makeDraftCycle(admin, 1);
    const employee = await makeEmployee(site.id, unit.id, 'Advance Snapshot Employee');
    const advance = await prisma.advance.create({
      data: {
        employeeId: employee.id,
        type: 'LOAN',
        totalAmount: '5000',
        outstandingBalance: '5000',
        dateGiven: new Date('2026-01-01'),
        repaymentType: 'FULL_DEDUCTION',
      },
    });
    const entry = await createEntry(admin, cycle.id, employee.id);

    // `advanceId` itself is not a client-settable field on this endpoint (it is populated only by
    // Advances' own scheduled-deduction materialization, `advances.service.ts`) — this test targets
    // `advanceDeduction`, the actual frozen deduction figure a Payslip reads, which IS Draft-editable.
    await admin.agent
      .patch(`/api/v1/payroll-entries/${entry.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, advanceDeduction: '1000' });

    await releaseUnit(admin, cycle.id, unit.id);

    const before = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips/${employee.id}`);
    expect(before.body.deductions.advanceDeduction).toBe('1000');

    // Outstanding balance changes later (e.g. a subsequent cycle's own deduction) — must never
    // retroactively change this already-released Payslip's frozen figure.
    await prisma.advance.update({ where: { id: advance.id }, data: { outstandingBalance: '2500' } });

    const after = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips/${employee.id}`);
    expect(after.body.deductions.advanceDeduction).toBe('1000');
  });

  it('remains viewable for an older, non-current cycle', async () => {
    const admin = await masterAdminAgent('ps-historical-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS Historical');
    const oldCycle = await makeDraftCycle(admin, 1);
    const employee = await makeEmployee(site.id, unit.id, 'Historical Employee');
    await createEntry(admin, oldCycle.id, employee.id);
    await releaseUnit(admin, oldCycle.id, unit.id);

    // Only one PayrollCycle may ever be Draft at a time (`createPayrollCycle`'s own invariant) —
    // there is no Finalize Cycle endpoint yet (Phase 5), so this directly flips the old cycle's
    // status the way that future endpoint eventually will, purely to create a second, newer cycle
    // for this test. Never touches PayrollEntry itself — the release boundary this module reads
    // is `PayrollEntry.released`, not `PayrollCycle.status` (this checkpoint's own frozen decision).
    await prisma.payrollCycle.update({ where: { id: oldCycle.id }, data: { status: 'RELEASED' } });

    // A newer cycle now exists (bootstrap carries the employee forward) — the older cycle's own
    // Payslip must still resolve correctly.
    const newCycle = await makeDraftCycle(admin, 2);
    expect(newCycle.id).not.toBe(oldCycle.id);

    const res = await admin.agent.get(`/api/v1/payroll-cycles/${oldCycle.id}/payslips/${employee.id}`);
    expect(res.status).toBe(200);
    expect(res.body.cycleId).toBe(oldCycle.id);
  });

  // --- Audit logging ---------------------------------------------------------------------------

  it('writes exactly one payslip.viewed AuditLog entry per detail request, and none for the list endpoint', async () => {
    const admin = await masterAdminAgent('ps-audit-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS Audit');
    const cycle = await makeDraftCycle(admin, 4);
    const employee = await makeEmployee(site.id, unit.id, 'Audit Employee');
    const entry = await createEntry(admin, cycle.id, employee.id);
    await releaseUnit(admin, cycle.id, unit.id);

    // Scoped to this test's own entry — AuditLog is append-only and never cleaned between tests
    // (`helpers.ts`'s own documented convention), so a global count would pick up every other
    // test's `payslip.viewed` rows in this same file.
    await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips`);
    const afterList = await prisma.auditLog.count({ where: { action: 'payslip.viewed', entityId: entry.id } });
    expect(afterList).toBe(0);

    const detailRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips/${employee.id}`);
    expect(detailRes.status).toBe(200);

    const entries = await prisma.auditLog.findMany({ where: { action: 'payslip.viewed', entityId: detailRes.body.entryId } });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.actorUserId).toBe(admin.userId);
    expect(entries[0]!.entityType).toBe('PayrollEntry');
    const metadata = entries[0]!.metadata as { cycleId: string; employeeId: string };
    expect(metadata.cycleId).toBe(cycle.id);
    expect(metadata.employeeId).toBe(employee.id);
  });

  // --- Response headers and payload shape -------------------------------------------------------

  it('sets Cache-Control: no-store on the detail response', async () => {
    const admin = await masterAdminAgent('ps-cache-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS Cache');
    const cycle = await makeDraftCycle(admin, 5);
    const employee = await makeEmployee(site.id, unit.id, 'Cache Employee');
    await createEntry(admin, cycle.id, employee.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const res = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips/${employee.id}`);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('never leaks an unrelated Employee/User field (e.g. no raw employee object, no password hash, no religion/mobile/DOB)', async () => {
    const admin = await masterAdminAgent('ps-leak-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS Leak');
    const cycle = await makeDraftCycle(admin, 6);
    const employee = await makeEmployee(site.id, unit.id, 'Leak Employee', { cnic: '1234512345671', employeeCode: 'EMP-1' });
    await createEntry(admin, cycle.id, employee.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const res = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips/${employee.id}`);
    expect(res.status).toBe(200);

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain('religion');
    expect(serialized).not.toContain('mobileNumber');
    expect(serialized).not.toContain('dateOfBirth');
    expect(res.body.employee).toBeUndefined();
    expect(res.body.identity.employeeCode).toBe('EMP-1');
    expect(res.body.identity.cnic).toBe('1234512345671');

    const listRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips`);
    const listSerialized = JSON.stringify(listRes.body);
    expect(listSerialized).not.toContain('passwordHash');
    expect(listSerialized).not.toContain('religion');
  });

  // ================================================================================================
  // Phase 4 Checkpoint 6.2 — Payslip PDF Engine
  // ================================================================================================

  it('generates a valid, non-empty PDF for a released employee, inline by default', async () => {
    const admin = await masterAdminAgent('ps-pdf-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS PDF');
    const cycle = await makeDraftCycle(admin, 1);
    const employee = await makeEmployee(site.id, unit.id, 'PDF Employee');
    await createEntry(admin, cycle.id, employee.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const res = await admin.agent
      .get(`/api/v1/payroll-cycles/${cycle.id}/payslips/${employee.id}/pdf`)
      .buffer(true)
      .parse(binaryParser);

    expect(res.status).toBe(200);
    const buffer = res.body as Buffer;
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(0);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-disposition']).toContain('inline');
    expect(res.headers['content-disposition']).toContain('.pdf');
  });

  it('sets Content-Disposition: attachment when ?disposition=attachment is requested', async () => {
    const admin = await masterAdminAgent('ps-pdf-attach-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS PDF Attach');
    const cycle = await makeDraftCycle(admin, 2);
    const employee = await makeEmployee(site.id, unit.id, 'PDF Attach Employee');
    await createEntry(admin, cycle.id, employee.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const res = await admin.agent
      .get(`/api/v1/payroll-cycles/${cycle.id}/payslips/${employee.id}/pdf?disposition=attachment`)
      .buffer(true)
      .parse(binaryParser);

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
  });

  it('rejects PDF generation for a user without payslips:view', async () => {
    const admin = await masterAdminAgent('ps-pdf-noperm-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS PDF NoPerm');
    const cycle = await makeDraftCycle(admin, 3);
    const employee = await makeEmployee(site.id, unit.id, 'PDF NoPerm Employee');
    await createEntry(admin, cycle.id, employee.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const noPerm = await noPayslipsPermissionAgent('ps-pdf-noperm-user@test.local', [site.id]);
    const res = await noPerm.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips/${employee.id}/pdf`);
    expect(res.status).toBe(403);
  });

  it('site-scopes the PDF endpoint — an out-of-scope employee 403s', async () => {
    const admin = await masterAdminAgent('ps-pdf-scope-admin@test.local');
    const { site: siteA } = await makeSiteWithUnit('Test Site PS PDF Scope A');
    const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site PS PDF Scope B');
    const cycle = await makeDraftCycle(admin, 4);
    const employeeB = await makeEmployee(siteB.id, unitB.id, 'PDF Scope Employee B');
    await createEntry(admin, cycle.id, employeeB.id);
    await releaseUnit(admin, cycle.id, unitB.id);

    const staffA = await payrollStaffAgent('ps-pdf-scope-staffA@test.local', [siteA.id]);
    const res = await staffA.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips/${employeeB.id}/pdf`);
    expect(res.status).toBe(403);
  });

  it('PDF endpoint 404s for an unreleased (Draft) entry', async () => {
    const admin = await masterAdminAgent('ps-pdf-draft-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS PDF Draft');
    const cycle = await makeDraftCycle(admin, 5);
    const employee = await makeEmployee(site.id, unit.id, 'PDF Draft Employee');
    await createEntry(admin, cycle.id, employee.id);
    // Deliberately NOT released.

    const res = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips/${employee.id}/pdf`);
    expect(res.status).toBe(404);
  });

  it('PDF endpoint 404s for a held entry, even after its Unit releases', async () => {
    const admin = await masterAdminAgent('ps-pdf-hold-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS PDF Hold');
    const cycle = await makeDraftCycle(admin, 6);
    const employee = await makeEmployee(site.id, unit.id, 'PDF Hold Employee');
    const entry = await createEntry(admin, cycle.id, employee.id);
    await admin.agent
      .patch(`/api/v1/payroll-entries/${entry.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, hold: true });
    await releaseUnit(admin, cycle.id, unit.id);

    const res = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips/${employee.id}/pdf`);
    expect(res.status).toBe(404);
  });

  it('writes exactly one payslip.exported audit entry per PDF request, and never payslip.viewed', async () => {
    const admin = await masterAdminAgent('ps-pdf-audit-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS PDF Audit');
    const cycle = await makeDraftCycle(admin, 7);
    const employee = await makeEmployee(site.id, unit.id, 'PDF Audit Employee');
    const entry = await createEntry(admin, cycle.id, employee.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const res = await admin.agent
      .get(`/api/v1/payroll-cycles/${cycle.id}/payslips/${employee.id}/pdf?disposition=attachment`)
      .buffer(true)
      .parse(binaryParser);
    expect(res.status).toBe(200);

    const exportedEntries = await prisma.auditLog.findMany({
      where: { action: 'payslip.exported', entityId: entry.id },
    });
    expect(exportedEntries).toHaveLength(1);
    expect(exportedEntries[0]!.actorUserId).toBe(admin.userId);
    expect(exportedEntries[0]!.entityType).toBe('PayrollEntry');
    const metadata = exportedEntries[0]!.metadata as { cycleId: string; employeeId: string; disposition: string };
    expect(metadata.cycleId).toBe(cycle.id);
    expect(metadata.employeeId).toBe(employee.id);
    expect(metadata.disposition).toBe('attachment');

    // The PDF endpoint must never also log payslip.viewed — that action is reserved for the JSON
    // detail route, which this request never touched.
    const viewedEntries = await prisma.auditLog.findMany({
      where: { action: 'payslip.viewed', entityId: entry.id },
    });
    expect(viewedEntries).toHaveLength(0);
  });

  it('generates a valid PDF even for an employee with a hostile (script-injection) name, via the real HTTP path', async () => {
    const admin = await masterAdminAgent('ps-pdf-hostile-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS PDF Hostile');
    const cycle = await makeDraftCycle(admin, 8);
    const employee = await makeEmployee(site.id, unit.id, '<script>alert(document.cookie)</script>', {
      fatherName: '"><img src=x onerror=alert(1)>',
    });
    await createEntry(admin, cycle.id, employee.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const res = await admin.agent
      .get(`/api/v1/payroll-cycles/${cycle.id}/payslips/${employee.id}/pdf`)
      .buffer(true)
      .parse(binaryParser);

    expect(res.status).toBe(200);
    const buffer = res.body as Buffer;
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('the PDF and JSON endpoints resolve to the exact same PayrollEntry for the same employee', async () => {
    const admin = await masterAdminAgent('ps-pdf-parity-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS PDF Parity');
    const cycle = await makeDraftCycle(admin, 9);
    const employee = await makeEmployee(site.id, unit.id, 'Parity Employee', { grossPay: '41000' });
    await createEntry(admin, cycle.id, employee.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const jsonRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/payslips/${employee.id}`);
    expect(jsonRes.status).toBe(200);

    const pdfRes = await admin.agent
      .get(`/api/v1/payroll-cycles/${cycle.id}/payslips/${employee.id}/pdf`)
      .buffer(true)
      .parse(binaryParser);
    expect(pdfRes.status).toBe(200);

    // Both routes call the same `getPayslip()` (Checkpoint 6.2's own "no independent Prisma
    // query" requirement) — their respective audit entries must reference the identical
    // `entryId`, proving both resolved to the same underlying PayrollEntry, not two different
    // reads that happened to both succeed.
    const viewedEntry = await prisma.auditLog.findFirst({
      where: { action: 'payslip.viewed', entityId: jsonRes.body.entryId },
      orderBy: { occurredAt: 'desc' },
    });
    const exportedEntry = await prisma.auditLog.findFirst({
      where: { action: 'payslip.exported' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(viewedEntry).not.toBeNull();
    expect(exportedEntry).not.toBeNull();
    expect(exportedEntry!.entityId).toBe(viewedEntry!.entityId);
    expect(exportedEntry!.entityId).toBe(jsonRes.body.entryId);
  });
});
