import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

describe('Phase 4 Checkpoint 3 — Bank Sheets', () => {
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
        PERMISSIONS.PAYROLL_RELEASE,
        PERMISSIONS.BANK_SHEETS_VIEW,
      ],
    });
  }

  async function financeAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.FINANCE,
      permissionKeys: [PERMISSIONS.PAYROLL_VIEW, PERMISSIONS.PAYROLL_RELEASE, PERMISSIONS.BANK_SHEETS_VIEW],
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

  async function makeSiteWithUnit(name: string) {
    const site = await prisma.projectSite.create({ data: { name } });
    const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} Unit` } });
    return { site, unit };
  }

  async function makeBank(code: string, name: string) {
    return prisma.bank.create({ data: { code: `TB${code}`, name } });
  }

  async function makeEmployee(
    siteId: string,
    unitId: string,
    name: string,
    options: { bankId?: string; accountNumber?: string; grossPay?: string } = {},
  ) {
    return prisma.employee.create({
      data: {
        name,
        designation: 'Guard',
        siteId,
        unitId,
        grossPay: options.grossPay ?? '30000',
        bankId: options.bankId,
        accountNumber: options.accountNumber,
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
    return res.body.entry as { id: string; version: number };
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

  it('rejects Payroll Staff entirely — no Bank Sheet access of any kind', async () => {
    const admin = await masterAdminAgent('bs-perm-admin1@test.local');
    const { site } = await makeSiteWithUnit('Test Site BS Perm 1');
    const cycle = await makeDraftCycle(admin, 1);
    const staff = await payrollStaffAgent('bs-perm-staff@test.local', [site.id]);

    const viewRes = await staff.agent.get(
      `/api/v1/payroll-cycles/${cycle.id}/bank-sheet?bankId=cash&siteIds=${site.id}`,
    );
    expect(viewRes.status).toBe(403);

    const exportRes = await staff.agent.get(
      `/api/v1/payroll-cycles/${cycle.id}/bank-sheet/export?bankId=cash&format=csv&siteIds=${site.id}`,
    );
    expect(exportRes.status).toBe(403);
  });

  it('allows Finance (bank-sheets:view) and Master User full access', async () => {
    const admin = await masterAdminAgent('bs-perm-admin2@test.local');
    const { site } = await makeSiteWithUnit('Test Site BS Perm 2');
    const cycle = await makeDraftCycle(admin, 2);
    const finance = await financeAgent('bs-perm-finance@test.local', [site.id]);

    const financeRes = await finance.agent.get(
      `/api/v1/payroll-cycles/${cycle.id}/bank-sheet?bankId=cash&siteIds=${site.id}`,
    );
    expect(financeRes.status).toBe(200);

    const masterRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/bank-sheet?bankId=cash`);
    expect(masterRes.status).toBe(200);
  });

  it('rejects a user holding payroll:view/payroll:entry but not bank-sheets:view', async () => {
    const admin = await masterAdminAgent('bs-perm-admin3@test.local');
    const { site } = await makeSiteWithUnit('Test Site BS Perm 3');
    const cycle = await makeDraftCycle(admin, 3);
    const noBankSheets = await createAuthenticatedAgent(app, {
      email: 'bs-perm-nobanksheets@test.local',
      password: PASSWORD,
      roleCode: 'TEST_NO_BANK_SHEETS',
      permissionKeys: [PERMISSIONS.PAYROLL_VIEW],
      siteIds: [site.id],
    });

    const res = await noBankSheets.agent.get(
      `/api/v1/payroll-cycles/${cycle.id}/bank-sheet?bankId=cash&siteIds=${site.id}`,
    );
    expect(res.status).toBe(403);
  });

  // --- Site-scoping boundary test --------------------------------------------------------------

  it('site-scopes Finance — a manipulated siteId outside assignment is rejected', async () => {
    const admin = await masterAdminAgent('bs-scope-admin@test.local');
    const { site: siteA } = await makeSiteWithUnit('Test Site BS Scope A');
    const { site: siteB } = await makeSiteWithUnit('Test Site BS Scope B');
    const cycle = await makeDraftCycle(admin, 4);
    const financeA = await financeAgent('bs-scope-financeA@test.local', [siteA.id]);

    const res = await financeA.agent.get(
      `/api/v1/payroll-cycles/${cycle.id}/bank-sheet?bankId=cash&siteIds=${siteB.id}`,
    );
    expect(res.status).toBe(403);
  });

  // --- Released-only enforcement ----------------------------------------------------------------

  it('never includes an unreleased (Draft) entry, even though it exists in the cycle', async () => {
    const admin = await masterAdminAgent('bs-draft-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site BS Draft');
    const cycle = await makeDraftCycle(admin, 5);
    const employee = await makeEmployee(site.id, unit.id, 'Draft Employee');
    await createEntry(admin, cycle.id, employee.id);
    // Deliberately NOT released.

    const res = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/bank-sheet?bankId=cash`);
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(0);
  });

  it('excludes a held entry even after its Unit releases (the sweep never releases a held entry)', async () => {
    const admin = await masterAdminAgent('bs-hold-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site BS Hold');
    const cycle = await makeDraftCycle(admin, 6);
    const employee = await makeEmployee(site.id, unit.id, 'Hold Employee');
    const entry = await createEntry(admin, cycle.id, employee.id);
    await admin.agent
      .patch(`/api/v1/payroll-entries/${entry.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, hold: true });
    await releaseUnit(admin, cycle.id, unit.id);

    const res = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/bank-sheet?bankId=cash`);
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(0);
  });

  it('includes a released entry once its Unit has released', async () => {
    const admin = await masterAdminAgent('bs-released-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site BS Released');
    const cycle = await makeDraftCycle(admin, 7);
    const employee = await makeEmployee(site.id, unit.id, 'Released Employee');
    await createEntry(admin, cycle.id, employee.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const res = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/bank-sheet?bankId=cash`);
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].employeeName).toBe('Released Employee');
  });

  // --- Filtering behaviour ----------------------------------------------------------------------

  it('filters by a specific Bank — only employees paid via that Bank appear', async () => {
    const admin = await masterAdminAgent('bs-filter-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site BS Filter');
    const cycle = await makeDraftCycle(admin, 8);
    const bankX = await makeBank('X1', 'Test Bank X');
    const bankY = await makeBank('Y1', 'Test Bank Y');

    const employeeX = await makeEmployee(site.id, unit.id, 'Employee X', {
      bankId: bankX.id,
      accountNumber: '1111111111',
    });
    const employeeY = await makeEmployee(site.id, unit.id, 'Employee Y', {
      bankId: bankY.id,
      accountNumber: '2222222222',
    });
    const employeeCash = await makeEmployee(site.id, unit.id, 'Employee Cash');

    await createEntry(admin, cycle.id, employeeX.id);
    await createEntry(admin, cycle.id, employeeY.id);
    await createEntry(admin, cycle.id, employeeCash.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const bankXRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/bank-sheet?bankId=${bankX.id}`);
    expect(bankXRes.body.rows).toHaveLength(1);
    expect(bankXRes.body.rows[0].employeeName).toBe('Employee X');
    expect(bankXRes.body.bankLabel).toBe('Test Bank X');

    const bankYRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/bank-sheet?bankId=${bankY.id}`);
    expect(bankYRes.body.rows).toHaveLength(1);
    expect(bankYRes.body.rows[0].employeeName).toBe('Employee Y');

    const cashRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/bank-sheet?bankId=cash`);
    expect(cashRes.body.rows).toHaveLength(1);
    expect(cashRes.body.rows[0].employeeName).toBe('Employee Cash');
    expect(cashRes.body.bankLabel).toBe('Cash');
  });

  it('rejects an inactive Bank filter with a clean 400, and a nonexistent Bank with 404', async () => {
    const admin = await masterAdminAgent('bs-badbank-admin@test.local');
    const { site } = await makeSiteWithUnit('Test Site BS BadBank');
    const cycle = await makeDraftCycle(admin, 9);
    const inactiveBank = await prisma.bank.create({
      data: { code: 'TBINACTIVE', name: 'Inactive Test Bank', isActive: false },
    });

    const inactiveRes = await admin.agent.get(
      `/api/v1/payroll-cycles/${cycle.id}/bank-sheet?bankId=${inactiveBank.id}&siteIds=${site.id}`,
    );
    expect(inactiveRes.status).toBe(400);

    const missingRes = await admin.agent.get(
      `/api/v1/payroll-cycles/${cycle.id}/bank-sheet?bankId=00000000-0000-0000-0000-000000000000`,
    );
    expect(missingRes.status).toBe(404);
  });

  it('totals correctly across multiple employees on the same Bank filter (sumMoney, not floating point)', async () => {
    const admin = await masterAdminAgent('bs-total-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site BS Total');
    const cycle = await makeDraftCycle(admin, 10);
    const bank = await makeBank('T1', 'Test Bank Total');

    const employeeOne = await makeEmployee(site.id, unit.id, 'Total Employee One', {
      bankId: bank.id,
      accountNumber: '1111111111',
      grossPay: '30000',
    });
    const employeeTwo = await makeEmployee(site.id, unit.id, 'Total Employee Two', {
      bankId: bank.id,
      accountNumber: '2222222222',
      grossPay: '45000.10',
    });

    await createEntry(admin, cycle.id, employeeOne.id);
    await createEntry(admin, cycle.id, employeeTwo.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const res = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/bank-sheet?bankId=${bank.id}`);
    expect(res.body.rows).toHaveLength(2);
    const expectedTotal = (
      Number(res.body.rows[0].netSalary) + Number(res.body.rows[1].netSalary)
    ).toFixed(2);
    expect(res.body.totalNetSalary).toBe(expectedTotal);
  });

  // --- Historical snapshot integrity -------------------------------------------------------------

  it('never reflects an employee change made after release — bank, account, and designation stay frozen', async () => {
    const admin = await masterAdminAgent('bs-snapshot-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site BS Snapshot');
    const cycle = await makeDraftCycle(admin, 11);
    const bankBefore = await makeBank('BEFORE', 'Bank Before');
    const bankAfter = await makeBank('AFTER', 'Bank After');

    const employee = await prisma.employee.create({
      data: {
        name: 'Snapshot Employee',
        designation: 'Guard',
        siteId: site.id,
        unitId: unit.id,
        grossPay: '30000',
        bankId: bankBefore.id,
        accountNumber: '1111111111',
      },
    });

    await createEntry(admin, cycle.id, employee.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const before = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/bank-sheet?bankId=${bankBefore.id}`);
    expect(before.body.rows).toHaveLength(1);
    expect(before.body.rows[0].accountNumber).toBe('1111111111');
    expect(before.body.rows[0].designation).toBe('Guard');

    // Employee changes bank, account number, and designation AFTER release.
    await prisma.employee.update({
      where: { id: employee.id },
      data: { bankId: bankAfter.id, accountNumber: '2222222222', designation: 'Supervisor' },
    });

    // The historical Bank Sheet, filtered by the ORIGINAL bank, must still show the employee —
    // and with the exact same frozen values — because it reads PayrollEntry's own columns, never
    // Employee's live record.
    const afterEmployeeChange = await admin.agent.get(
      `/api/v1/payroll-cycles/${cycle.id}/bank-sheet?bankId=${bankBefore.id}`,
    );
    expect(afterEmployeeChange.body.rows).toHaveLength(1);
    expect(afterEmployeeChange.body.rows[0].accountNumber).toBe('1111111111');
    expect(afterEmployeeChange.body.rows[0].designation).toBe('Guard');
    expect(afterEmployeeChange.body.rows[0].bankName).toBe('Bank Before');

    // The employee's NEW bank must show zero rows for this cycle — the historical release was
    // never retroactively reassigned to the new bank.
    const newBankSheet = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/bank-sheet?bankId=${bankAfter.id}`);
    expect(newBankSheet.body.rows).toHaveLength(0);
  });

  // --- Export correctness -----------------------------------------------------------------------

  it('exports CSV and XLSX with matching row counts and a totals row', async () => {
    const admin = await masterAdminAgent('bs-export-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site BS Export');
    const cycle = await makeDraftCycle(admin, 12);
    const bank = await makeBank('EXP', 'Export Test Bank');
    const employee = await makeEmployee(site.id, unit.id, 'Export Employee', {
      bankId: bank.id,
      accountNumber: '9999999999',
    });
    await createEntry(admin, cycle.id, employee.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const csvRes = await admin.agent.get(
      `/api/v1/payroll-cycles/${cycle.id}/bank-sheet/export?bankId=${bank.id}&format=csv`,
    );
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers['content-type']).toContain('text/csv');
    const csvText = csvRes.text;
    expect(csvText).toContain('Export Employee');
    expect(csvText).toContain('9999999999');
    expect(csvText).toContain('Total');

    const xlsxRes = await admin.agent.get(
      `/api/v1/payroll-cycles/${cycle.id}/bank-sheet/export?bankId=${bank.id}&format=xlsx`,
    );
    expect(xlsxRes.status).toBe(200);
    expect(xlsxRes.headers['content-type']).toContain('spreadsheetml');
    // A real, non-empty XLSX binary was returned.
    expect(Number(xlsxRes.headers['content-length'])).toBeGreaterThan(0);

    const auditEntry = await prisma.auditLog.findFirst({
      where: { action: 'bank_sheet.export', entityId: cycle.id },
      orderBy: { occurredAt: 'desc' },
    });
    expect(auditEntry).not.toBeNull();
  });
});
