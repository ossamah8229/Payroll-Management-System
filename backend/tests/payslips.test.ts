import AdmZip from 'adm-zip';
import { PERMISSIONS, ROLE_CODES, MAX_BATCH_PAYSLIPS_PER_REQUEST, calcNet } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { closeBrowser } from '../src/lib/pdf/browser';
import * as payslipsService from '../src/modules/payslips/payslips.service';
import { getPayslip, getPayslipsBulk } from '../src/modules/payslips/payslips.service';
import { buildArchiveEntryName, slugify } from '../src/modules/payslips/payslips.routes';
import { loadSessionUser } from '../src/modules/auth/auth.service';
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

  // ================================================================================================
  // Phase 4 Checkpoint 6.3.1 — Bulk Payslip assembly
  // ================================================================================================

  it('issues a constant number of queries regardless of batch size (no N+1)', async () => {
    const admin = await masterAdminAgent('ps-bulk-n1-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS Bulk N1');
    const cycle = await makeDraftCycle(admin, 1);

    const employees: { id: string }[] = [];
    for (let i = 0; i < 10; i += 1) {
      const employee = await makeEmployee(site.id, unit.id, `Bulk N1 Employee ${i}`);
      await createEntry(admin, cycle.id, employee.id);
      employees.push(employee);
    }
    await releaseUnit(admin, cycle.id, unit.id);

    const sessionUser = await loadSessionUser(admin.userId);
    if (!sessionUser) throw new Error('expected a loadable session user');

    let queryCount = 0;
    const listener = () => {
      queryCount += 1;
    };
    // Prisma's typed client exposes no $off() — acceptable here since this is the only test in the
    // suite that installs a listener, and it reads the count immediately after each call.
    prisma.$on('query', listener);

    // Warm the connection/prepared-statement cache with a throwaway call before measuring. The
    // very first query on a given connection can carry extra one-off setup cost that has nothing
    // to do with N+1 shape, which otherwise makes the two measured counts flaky by +/-1.
    await getPayslipsBulk(sessionUser, cycle.id, { employeeIds: [employees[0]!.id] });

    queryCount = 0;
    const small = await getPayslipsBulk(sessionUser, cycle.id, {
      employeeIds: [employees[0]!.id, employees[1]!.id],
    });
    const smallBatchQueries = queryCount;

    queryCount = 0;
    const large = await getPayslipsBulk(sessionUser, cycle.id, {
      employeeIds: employees.map((e) => e.id),
    });
    const largeBatchQueries = queryCount;

    expect(small).toHaveLength(2);
    expect(large).toHaveLength(10);
    expect(smallBatchQueries).toBeGreaterThan(0);
    // The fixed cost (cycle lookup + one findMany + one CompanySettings read) must not grow with
    // row count — a real N+1 would make the 10-employee call issue roughly 5x as many queries as
    // the 2-employee call; this asserts they are exactly equal instead.
    expect(largeBatchQueries).toBe(smallBatchQueries);
    // A generous, non-tight upper bound — Prisma's query engine can split one logical `findMany`
    // with several relational `include`s into more than one SQL statement; what matters is that
    // this fixed cost never scales with row count, which the equality assertion above already
    // proves. 20 is comfortably above the actual observed cost (~8) while still ruling out any
    // per-row query.
    expect(largeBatchQueries).toBeLessThanOrEqual(20);
  });

  it('individual getPayslip() and bulk getPayslipsBulk() produce identical Payslip DTOs for the same employee', async () => {
    const admin = await masterAdminAgent('ps-bulk-parity-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS Bulk Parity');
    const cycle = await makeDraftCycle(admin, 2);
    const employeeA = await makeEmployee(site.id, unit.id, 'Bulk Parity Employee A', { grossPay: '32000' });
    const employeeB = await makeEmployee(site.id, unit.id, 'Bulk Parity Employee B', { grossPay: '47000.50' });
    await createEntry(admin, cycle.id, employeeA.id);
    await createEntry(admin, cycle.id, employeeB.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const sessionUser = await loadSessionUser(admin.userId);
    if (!sessionUser) throw new Error('expected a loadable session user');

    const individualA = await getPayslip(sessionUser, cycle.id, employeeA.id);
    const individualB = await getPayslip(sessionUser, cycle.id, employeeB.id);

    const bulk = await getPayslipsBulk(sessionUser, cycle.id, {
      employeeIds: [employeeA.id, employeeB.id],
    });
    expect(bulk).toHaveLength(2);
    const bulkA = bulk.find((p) => p.employeeId === employeeA.id);
    const bulkB = bulk.find((p) => p.employeeId === employeeB.id);

    expect(bulkA).toEqual(individualA);
    expect(bulkB).toEqual(individualB);
  });

  it('bulk assembly returns only released, non-held entries — Draft and held excluded', async () => {
    const admin = await masterAdminAgent('ps-bulk-gate-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS Bulk Gate');
    const cycle = await makeDraftCycle(admin, 3);

    const releasedEmployee = await makeEmployee(site.id, unit.id, 'Bulk Gate Released');
    const heldEmployee = await makeEmployee(site.id, unit.id, 'Bulk Gate Held');

    await createEntry(admin, cycle.id, releasedEmployee.id);
    const heldEntry = await createEntry(admin, cycle.id, heldEmployee.id);
    await admin.agent
      .patch(`/api/v1/payroll-entries/${heldEntry.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: heldEntry.version, hold: true });

    // The release sweep releases every non-held entry touching this unit at the time it runs —
    // both releasedEmployee's and (were it not held) heldEmployee's. A genuinely Draft entry
    // requires being created AFTER the unit has already released (the Late Entry case), same
    // pattern already used elsewhere in this file.
    await releaseUnit(admin, cycle.id, unit.id);
    const draftEmployee = await makeEmployee(site.id, unit.id, 'Bulk Gate Draft');
    await createEntry(admin, cycle.id, draftEmployee.id);

    const sessionUser = await loadSessionUser(admin.userId);
    if (!sessionUser) throw new Error('expected a loadable session user');

    const bulk = await getPayslipsBulk(sessionUser, cycle.id, {
      employeeIds: [releasedEmployee.id, heldEmployee.id, draftEmployee.id],
    });

    expect(bulk).toHaveLength(1);
    expect(bulk[0]!.employeeId).toBe(releasedEmployee.id);
  });

  it('bulk assembly enforces site scope server-side — an out-of-scope employeeId is silently excluded, not processed', async () => {
    const admin = await masterAdminAgent('ps-bulk-scope-admin@test.local');
    const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site PS Bulk Scope A');
    const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site PS Bulk Scope B');
    const cycle = await makeDraftCycle(admin, 4);

    const employeeA = await makeEmployee(siteA.id, unitA.id, 'Bulk Scope Employee A');
    const employeeB = await makeEmployee(siteB.id, unitB.id, 'Bulk Scope Employee B');
    await createEntry(admin, cycle.id, employeeA.id);
    await createEntry(admin, cycle.id, employeeB.id);
    await releaseUnit(admin, cycle.id, unitA.id);
    await releaseUnit(admin, cycle.id, unitB.id);

    const staffA = await payrollStaffAgent('ps-bulk-scope-staffA@test.local', [siteA.id]);
    const staffASession = await loadSessionUser(staffA.userId);
    if (!staffASession) throw new Error('expected a loadable session user');

    const bulk = await getPayslipsBulk(staffASession, cycle.id, {
      employeeIds: [employeeA.id, employeeB.id],
    });

    expect(bulk).toHaveLength(1);
    expect(bulk[0]!.employeeId).toBe(employeeA.id);

    // An explicitly out-of-scope siteId, rather than an implicit one via employeeIds, throws —
    // matching listPayslips'/getPayslip's own `resolveSiteIdFilter`/`assertSiteAccess` behavior.
    await expect(
      getPayslipsBulk(staffASession, cycle.id, { siteIds: [siteB.id] }),
    ).rejects.toThrow();
  });

  it('never leaks an unrelated Employee/User field in the bulk representation', async () => {
    const admin = await masterAdminAgent('ps-bulk-leak-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS Bulk Leak');
    const cycle = await makeDraftCycle(admin, 5);
    const employee = await makeEmployee(site.id, unit.id, 'Bulk Leak Employee', {
      cnic: '1234512345671',
      employeeCode: 'EMP-BULK-1',
    });
    await createEntry(admin, cycle.id, employee.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const sessionUser = await loadSessionUser(admin.userId);
    if (!sessionUser) throw new Error('expected a loadable session user');

    const bulk = await getPayslipsBulk(sessionUser, cycle.id, { employeeIds: [employee.id] });
    expect(bulk).toHaveLength(1);

    const serialized = JSON.stringify(bulk);
    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain('religion');
    expect(serialized).not.toContain('mobileNumber');
    expect(serialized).not.toContain('dateOfBirth');
    expect((bulk[0] as unknown as { employee?: unknown }).employee).toBeUndefined();
  });

  // ================================================================================================
  // Phase 4 Checkpoint 6.3.2 — Batch PDF/ZIP endpoint
  // ================================================================================================

  function fakeUuid(seed: number): string {
    const hex = seed.toString(16).padStart(12, '0');
    return `00000000-0000-4000-8000-${hex}`;
  }

  it('rejects a batch of 301 employeeIds before touching the database (schema-level, before streaming)', async () => {
    const admin = await masterAdminAgent('ps-batch-301-admin@test.local');
    // No site/employee/release setup needed — batchPayslipsSchema's own `.max(300)` rejects an
    // over-sized request body before any Prisma query runs, so even a cycle with zero eligible
    // employees (or, as here, entirely fabricated employeeIds) still proves the boundary.
    const cycle = await makeDraftCycle(admin, 1);

    const tooMany = Array.from({ length: MAX_BATCH_PAYSLIPS_PER_REQUEST + 1 }, (_, i) => fakeUuid(i));
    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/payslips/batch`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeIds: tooMany });

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).not.toContain('application/zip');
  });

  it(
    'accepts and correctly processes a batch of exactly 300 eligible employees',
    async () => {
      const admin = await masterAdminAgent('ps-batch-300-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site PS Batch 300');

      const employeeRows = Array.from({ length: MAX_BATCH_PAYSLIPS_PER_REQUEST }, (_, i) => ({
        name: `Batch300 Employee ${i}`,
        designation: 'Guard',
        siteId: site.id,
        unitId: unit.id,
        grossPay: '30000',
      }));
      await prisma.employee.createMany({ data: employeeRows });
      const employees = await prisma.employee.findMany({ where: { siteId: site.id } });
      expect(employees).toHaveLength(MAX_BATCH_PAYSLIPS_PER_REQUEST);

      const cycle = await makeDraftCycle(admin, 2); // bootstraps one PayrollEntry per active employee
      await releaseUnit(admin, cycle.id, unit.id);

      const res = await admin.agent
        .post(`/api/v1/payroll-cycles/${cycle.id}/payslips/batch`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ employeeIds: employees.map((e) => e.id) })
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/zip');
      expect(res.headers['cache-control']).toBe('no-store');

      const zip = new AdmZip(res.body as Buffer);
      const entries = zip.getEntries();
      expect(entries).toHaveLength(MAX_BATCH_PAYSLIPS_PER_REQUEST);
      expect(entries.every((e) => e.entryName.endsWith('.pdf'))).toBe(true);
      // No _summary.txt should exist — a fully successful batch has nothing to report.
      expect(entries.some((e) => e.entryName === '_summary.txt')).toBe(false);

      const auditEntry = await prisma.auditLog.findFirst({
        where: { action: 'payslip.batch_exported', entityId: cycle.id },
        orderBy: { occurredAt: 'desc' },
      });
      expect(auditEntry).not.toBeNull();
      const metadata = auditEntry!.metadata as { successCount: number; failureCount: number; eligibleCount: number };
      expect(metadata.eligibleCount).toBe(MAX_BATCH_PAYSLIPS_PER_REQUEST);
      expect(metadata.successCount).toBe(MAX_BATCH_PAYSLIPS_PER_REQUEST);
      expect(metadata.failureCount).toBe(0);
    },
    120_000, // 300 real Puppeteer renders — generous, test-specific timeout (default is 15s)
  );

  it('rejects batch generation for a user without payslips:view', async () => {
    const admin = await masterAdminAgent('ps-batch-noperm-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS Batch NoPerm');
    const cycle = await makeDraftCycle(admin, 3);
    const employee = await makeEmployee(site.id, unit.id, 'Batch NoPerm Employee');
    await createEntry(admin, cycle.id, employee.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const noPerm = await noPayslipsPermissionAgent('ps-batch-noperm-user@test.local', [site.id]);
    const res = await noPerm.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/payslips/batch`)
      .set('x-csrf-token', noPerm.csrfToken)
      .send({ employeeIds: [employee.id] });
    expect(res.status).toBe(403);
  });

  it('site-scopes the batch endpoint — an out-of-scope employee is silently excluded, not an error, as long as an eligible one remains', async () => {
    const admin = await masterAdminAgent('ps-batch-scope-admin@test.local');
    const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site PS Batch Scope A');
    const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site PS Batch Scope B');
    const cycle = await makeDraftCycle(admin, 4);

    const employeeA = await makeEmployee(siteA.id, unitA.id, 'Batch Scope Employee A');
    const employeeB = await makeEmployee(siteB.id, unitB.id, 'Batch Scope Employee B');
    await createEntry(admin, cycle.id, employeeA.id);
    await createEntry(admin, cycle.id, employeeB.id);
    await releaseUnit(admin, cycle.id, unitA.id);
    await releaseUnit(admin, cycle.id, unitB.id);

    const staffA = await payrollStaffAgent('ps-batch-scope-staffA@test.local', [siteA.id]);
    const res = await staffA.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/payslips/batch`)
      .set('x-csrf-token', staffA.csrfToken)
      .send({ employeeIds: [employeeA.id, employeeB.id] })
      .buffer(true)
      .parse(binaryParser);

    expect(res.status).toBe(200);
    const zip = new AdmZip(res.body as Buffer);
    expect(zip.getEntries()).toHaveLength(1);
  });

  it('rejects the batch request cleanly when every requested employee is ineligible (none released, none in scope)', async () => {
    const admin = await masterAdminAgent('ps-batch-zero-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS Batch Zero');
    const cycle = await makeDraftCycle(admin, 5);
    const draftEmployee = await makeEmployee(site.id, unit.id, 'Batch Zero Draft Employee');
    await createEntry(admin, cycle.id, draftEmployee.id);
    // Deliberately never released.

    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/payslips/batch`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeIds: [draftEmployee.id] });

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).not.toContain('application/zip');
  });

  it('excludes Draft and held entries from the batch, including only released non-held ones', async () => {
    const admin = await masterAdminAgent('ps-batch-gate-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS Batch Gate');
    const cycle = await makeDraftCycle(admin, 6);

    const releasedEmployee = await makeEmployee(site.id, unit.id, 'Batch Gate Released');
    const heldEmployee = await makeEmployee(site.id, unit.id, 'Batch Gate Held');
    await createEntry(admin, cycle.id, releasedEmployee.id);
    const heldEntry = await createEntry(admin, cycle.id, heldEmployee.id);
    await admin.agent
      .patch(`/api/v1/payroll-entries/${heldEntry.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: heldEntry.version, hold: true });
    await releaseUnit(admin, cycle.id, unit.id);

    const draftEmployee = await makeEmployee(site.id, unit.id, 'Batch Gate Draft');
    await createEntry(admin, cycle.id, draftEmployee.id);

    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/payslips/batch`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeIds: [releasedEmployee.id, heldEmployee.id, draftEmployee.id] })
      .buffer(true)
      .parse(binaryParser);

    expect(res.status).toBe(200);
    const zip = new AdmZip(res.body as Buffer);
    const entries = zip.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.entryName).toContain(slugify('Batch Gate Released'));
  });

  it('produces two distinct, valid archive entries for two employees sharing the exact same name', async () => {
    const admin = await masterAdminAgent('ps-batch-dupname-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS Batch DupName');
    const cycle = await makeDraftCycle(admin, 7);

    const employeeA = await makeEmployee(site.id, unit.id, 'Identical Name Employee');
    const employeeB = await makeEmployee(site.id, unit.id, 'Identical Name Employee');
    await createEntry(admin, cycle.id, employeeA.id);
    await createEntry(admin, cycle.id, employeeB.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/payslips/batch`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeIds: [employeeA.id, employeeB.id] })
      .buffer(true)
      .parse(binaryParser);

    expect(res.status).toBe(200);
    const zip = new AdmZip(res.body as Buffer);
    const entries = zip.getEntries();
    expect(entries).toHaveLength(2);
    // Distinct filenames — no silent overwrite inside the archive.
    expect(new Set(entries.map((e) => e.entryName)).size).toBe(2);
    // Each entry decompresses to a real, non-empty PDF.
    for (const entry of entries) {
      const data = entry.getData();
      expect(data.subarray(0, 5).toString()).toBe('%PDF-');
    }
  });

  it('continues past a single employee\'s render failure, includes a safe _summary.txt, and never leaks internal error detail', async () => {
    const admin = await masterAdminAgent('ps-batch-partial-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS Batch Partial');
    const cycle = await makeDraftCycle(admin, 8);

    const goodEmployee = await makeEmployee(site.id, unit.id, 'AAA First Good Employee'); // sorts first (site name asc, sortOrder asc) so it survives as the canary
    const failingEmployee = await makeEmployee(site.id, unit.id, 'ZZZ Failing Employee', { employeeCode: 'FAIL-001' });
    await createEntry(admin, cycle.id, goodEmployee.id);
    await createEntry(admin, cycle.id, failingEmployee.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const original = payslipsService.renderPayslipPdfBuffer;
    const spy = jest
      .spyOn(payslipsService, 'renderPayslipPdfBuffer')
      .mockImplementation(async (payslip, meta) => {
        if (payslip.employeeId === failingEmployee.id) {
          throw new Error(
            'SENSITIVE_TEST_MARKER: /etc/secret/path SELECT * FROM users password=hunter2 at /internal/stack/trace.ts:42',
          );
        }
        return original(payslip, meta);
      });

    try {
      const res = await admin.agent
        .post(`/api/v1/payroll-cycles/${cycle.id}/payslips/batch`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ employeeIds: [goodEmployee.id, failingEmployee.id] })
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(200);
      const zip = new AdmZip(res.body as Buffer);
      const entries = zip.getEntries();
      const names = entries.map((e) => e.entryName);
      expect(names).toContain('_summary.txt');
      expect(names.filter((n) => n.endsWith('.pdf'))).toHaveLength(1);

      const summary = zip.getEntry('_summary.txt')!.getData().toString('utf-8');
      expect(summary).toContain('FAIL-001');
      expect(summary).toContain('Succeeded: 1');
      expect(summary).toContain('Failed: 1');
      // The generic failure line, never the underlying error's own message/stack/paths/SQL.
      expect(summary).not.toContain('SENSITIVE_TEST_MARKER');
      expect(summary).not.toContain('/etc/secret/path');
      expect(summary).not.toContain('SELECT * FROM');
      expect(summary).not.toContain('hunter2');
      expect(summary).not.toContain('.ts:42');

      const auditEntry = await prisma.auditLog.findFirst({
        where: { action: 'payslip.batch_exported', entityId: cycle.id },
        orderBy: { occurredAt: 'desc' },
      });
      const metadata = auditEntry!.metadata as {
        successCount: number;
        failureCount: number;
        failedEmployeeIds: string[];
      };
      expect(metadata.successCount).toBe(1);
      expect(metadata.failureCount).toBe(1);
      expect(metadata.failedEmployeeIds).toEqual([failingEmployee.id]);
    } finally {
      spy.mockRestore();
    }
  });

  it('fails cleanly with no ZIP ever started when the sole (first/canary) employee\'s render fails', async () => {
    const admin = await masterAdminAgent('ps-batch-allfail-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS Batch AllFail');
    const cycle = await makeDraftCycle(admin, 9);
    const employee = await makeEmployee(site.id, unit.id, 'Batch AllFail Employee');
    await createEntry(admin, cycle.id, employee.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const spy = jest.spyOn(payslipsService, 'renderPayslipPdfBuffer').mockImplementation(async () => {
      throw new Error('simulated total Puppeteer failure');
    });

    try {
      const res = await admin.agent
        .post(`/api/v1/payroll-cycles/${cycle.id}/payslips/batch`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ employeeIds: [employee.id] });

      // Deliberate behavior (documented): a canary failure — the only way "every employee fails"
      // can occur — always yields a clean error response, never a ZIP with zero usable content.
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.headers['content-type']).not.toContain('application/zip');

      const auditEntry = await prisma.auditLog.findFirst({
        where: { action: 'payslip.batch_exported', entityId: cycle.id },
      });
      // No batch audit entry either — the request never reached the point of having anything to
      // summarize (this is the same "validation-stage rejection" class as the 301/zero-eligible
      // cases above, not a completed-but-empty batch).
      expect(auditEntry).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('writes exactly one payslip.batch_exported entry and never payslip.exported for any individual employee in the batch', async () => {
    const admin = await masterAdminAgent('ps-batch-audit-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS Batch Audit');
    const cycle = await makeDraftCycle(admin, 10);
    const employeeA = await makeEmployee(site.id, unit.id, 'Batch Audit Employee A');
    const employeeB = await makeEmployee(site.id, unit.id, 'Batch Audit Employee B');
    await createEntry(admin, cycle.id, employeeA.id);
    await createEntry(admin, cycle.id, employeeB.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/payslips/batch`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeIds: [employeeA.id, employeeB.id] })
      .buffer(true)
      .parse(binaryParser);
    expect(res.status).toBe(200);

    const batchEntries = await prisma.auditLog.findMany({
      where: { action: 'payslip.batch_exported', entityId: cycle.id },
    });
    expect(batchEntries).toHaveLength(1);
    const metadata = batchEntries[0]!.metadata as {
      requestedCount: number;
      eligibleCount: number;
      successCount: number;
      cancelled: boolean;
      siteIds: string[];
    };
    expect(metadata.requestedCount).toBe(2);
    expect(metadata.eligibleCount).toBe(2);
    expect(metadata.successCount).toBe(2);
    expect(metadata.cancelled).toBe(false);
    expect(metadata.siteIds).toEqual([site.id]);

    const individualExportEntries = await prisma.auditLog.findMany({
      where: { action: 'payslip.exported', entityId: { in: [employeeA.id, employeeB.id] } },
    });
    expect(individualExportEntries).toHaveLength(0);
  });

  it('records cancelled: true and stops scheduling further renders when the client disconnects mid-batch', async () => {
    const admin = await masterAdminAgent('ps-batch-cancel-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site PS Batch Cancel');
    const cycle = await makeDraftCycle(admin, 11);

    const employeeRows = Array.from({ length: 20 }, (_, i) => ({
      name: `Batch Cancel Employee ${i}`,
      designation: 'Guard',
      siteId: site.id,
      unitId: unit.id,
      grossPay: '30000',
    }));
    await prisma.employee.createMany({ data: employeeRows });
    const employees = await prisma.employee.findMany({ where: { siteId: site.id } });

    const cycleForBatch = cycle.id;
    for (const employee of employees) {
      await createEntry(admin, cycleForBatch, employee.id);
    }
    await releaseUnit(admin, cycleForBatch, unit.id);

    // Real Puppeteer render timing is too variable (system load, cold vs. warm page) to land an
    // abort reliably "mid-stream" — this test isn't about PDF rendering (covered elsewhere), only
    // about the cancellation *mechanism* itself, so every render is replaced with a small,
    // deterministic, artificially-delayed fake buffer instead.
    const spy = jest.spyOn(payslipsService, 'renderPayslipPdfBuffer').mockImplementation(async (payslip) => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return Buffer.from(`%PDF-fake-${payslip.employeeId}`);
    });

    try {
      const request = admin.agent
        .post(`/api/v1/payroll-cycles/${cycleForBatch}/payslips/batch`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ employeeIds: employees.map((e) => e.id) });

      // The canary (200ms) plus the first concurrency chunk (also ~200ms, rendered together) puts
      // streaming underway well before 500ms; the full batch (20 employees / concurrency 4 ≈ 5
      // chunks × 200ms ≈ 1000ms+) has not yet finished — landing the abort deterministically
      // inside the active streaming window this test targets.
      setTimeout(() => request.abort(), 500);

      await request.catch(() => {
        // superagent rejects an aborted request — expected, not a test failure.
      });

      // The server-side handler keeps running after the client aborts; give it time to reach its
      // own audit write before asserting.
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const auditEntry = await prisma.auditLog.findFirst({
        where: { action: 'payslip.batch_exported', entityId: cycleForBatch },
        orderBy: { occurredAt: 'desc' },
      });
      expect(auditEntry).not.toBeNull();
      const metadata = auditEntry!.metadata as { cancelled: boolean; successCount: number; eligibleCount: number };
      expect(metadata.eligibleCount).toBe(20);
      expect(metadata.cancelled).toBe(true);
      // Cancelled before the full batch completed — strictly fewer successes than eligible.
      expect(metadata.successCount).toBeLessThan(20);
    } finally {
      spy.mockRestore();
    }
  }, 30_000);
});

describe('buildArchiveEntryName / slugify — pure (Phase 4 Checkpoint 6.3.2)', () => {
  function fakePayslip(overrides: {
    employeeId?: string;
    employeeCode?: string | null;
    employeeName?: string;
  }): payslipsService.Payslip {
    return {
      employeeId: overrides.employeeId ?? 'aaaaaaaa-0000-0000-0000-000000000000',
      identity: {
        employeeCode: overrides.employeeCode ?? null,
        employeeName: overrides.employeeName ?? 'Test Employee',
      },
    } as unknown as payslipsService.Payslip;
  }

  it('strips path traversal, slashes, backslashes, quotes, CR, and LF entirely', () => {
    const hostile = '../../etc/passwd\\windows\\path"quoted"\r\nCRLF-injected';
    const result = slugify(hostile);
    expect(result).toMatch(/^[a-z0-9-]*$/);
    expect(result).not.toContain('/');
    expect(result).not.toContain('\\');
    expect(result).not.toContain('"');
    expect(result).not.toContain('\r');
    expect(result).not.toContain('\n');
    expect(result).not.toContain('..');
  });

  it('falls back to a literal "payslip" base when nothing survives slugification', () => {
    const usedNames = new Set<string>();
    const name = buildArchiveEntryName(fakePayslip({ employeeCode: '???', employeeName: '🎉🎉🎉' }), usedNames);
    expect(name).toBe('payslip.pdf');
  });

  it('never produces an empty filename — an empty employeeCode falls back to the (always non-blank) employeeId prefix', () => {
    const usedNames = new Set<string>();
    const name = buildArchiveEntryName(
      fakePayslip({ employeeId: 'aaaaaaaa-0000-0000-0000-000000000000', employeeCode: '', employeeName: '' }),
      usedNames,
    );
    // `employeeCode: ''` is falsy, so `codeOrShortId` falls through to `employeeId.slice(0, 8)` —
    // a real `employeeId` is a UUID and is never itself blank, so this path can never actually
    // degenerate to the literal `'payslip'` fallback the way a fully-unslugifiable employeeCode
    // (tested above) can.
    expect(name).toBe('aaaaaaaa.pdf');
    expect(name.length).toBeGreaterThan(4);
  });

  it('produces distinct, deterministically suffixed names for two genuinely colliding entries', () => {
    const usedNames = new Set<string>();
    const payslipA = fakePayslip({ employeeId: 'same', employeeCode: 'DUP', employeeName: 'Same Name' });
    const payslipB = fakePayslip({ employeeId: 'same', employeeCode: 'DUP', employeeName: 'Same Name' });
    const payslipC = fakePayslip({ employeeId: 'same', employeeCode: 'DUP', employeeName: 'Same Name' });

    const nameA = buildArchiveEntryName(payslipA, usedNames);
    const nameB = buildArchiveEntryName(payslipB, usedNames);
    const nameC = buildArchiveEntryName(payslipC, usedNames);

    expect(nameA).toBe('dup-same-name.pdf');
    expect(nameB).toBe('dup-same-name-2.pdf');
    expect(nameC).toBe('dup-same-name-3.pdf');
    expect(new Set([nameA, nameB, nameC]).size).toBe(3);
  });

  it('prefers employeeCode over the id fallback when present', () => {
    const usedNames = new Set<string>();
    const name = buildArchiveEntryName(
      fakePayslip({ employeeId: 'aaaaaaaa-1111-1111-1111-111111111111', employeeCode: 'EMP-42', employeeName: 'Jane Doe' }),
      usedNames,
    );
    expect(name).toBe('emp-42-jane-doe.pdf');
    expect(name).not.toContain('aaaaaaaa');
  });
});
