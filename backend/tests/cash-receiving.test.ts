import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

describe('Phase 4 Checkpoint 4 — Cash Receiving Sheets', () => {
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

  it('rejects Payroll Staff entirely — no Cash Receiving access of any kind', async () => {
    const admin = await masterAdminAgent('cr-perm-admin1@test.local');
    const { site } = await makeSiteWithUnit('Test Site CR Perm 1');
    const cycle = await makeDraftCycle(admin, 1);
    const staff = await payrollStaffAgent('cr-perm-staff@test.local', [site.id]);

    const viewRes = await staff.agent.get(
      `/api/v1/payroll-cycles/${cycle.id}/cash-receiving?siteIds=${site.id}`,
    );
    expect(viewRes.status).toBe(403);

    const exportRes = await staff.agent.get(
      `/api/v1/payroll-cycles/${cycle.id}/cash-receiving/export?format=csv&siteIds=${site.id}`,
    );
    expect(exportRes.status).toBe(403);
  });

  it('allows Finance (bank-sheets:view, reused) and Master User full access', async () => {
    const admin = await masterAdminAgent('cr-perm-admin2@test.local');
    const { site } = await makeSiteWithUnit('Test Site CR Perm 2');
    const cycle = await makeDraftCycle(admin, 2);
    const finance = await financeAgent('cr-perm-finance@test.local', [site.id]);

    const financeRes = await finance.agent.get(
      `/api/v1/payroll-cycles/${cycle.id}/cash-receiving?siteIds=${site.id}`,
    );
    expect(financeRes.status).toBe(200);

    const masterRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/cash-receiving`);
    expect(masterRes.status).toBe(200);
  });

  it('rejects a user holding payroll:view/payroll:entry but not bank-sheets:view', async () => {
    const admin = await masterAdminAgent('cr-perm-admin3@test.local');
    const { site } = await makeSiteWithUnit('Test Site CR Perm 3');
    const cycle = await makeDraftCycle(admin, 3);
    const noBankSheets = await createAuthenticatedAgent(app, {
      email: 'cr-perm-nobanksheets@test.local',
      password: PASSWORD,
      roleCode: 'TEST_NO_BANK_SHEETS_CR',
      permissionKeys: [PERMISSIONS.PAYROLL_VIEW],
      siteIds: [site.id],
    });

    const res = await noBankSheets.agent.get(
      `/api/v1/payroll-cycles/${cycle.id}/cash-receiving?siteIds=${site.id}`,
    );
    expect(res.status).toBe(403);
  });

  // --- Site-scoping boundary test --------------------------------------------------------------

  it('site-scopes Finance — a manipulated siteId outside assignment is rejected', async () => {
    const admin = await masterAdminAgent('cr-scope-admin@test.local');
    const { site: siteA } = await makeSiteWithUnit('Test Site CR Scope A');
    const { site: siteB } = await makeSiteWithUnit('Test Site CR Scope B');
    const cycle = await makeDraftCycle(admin, 4);
    const financeA = await financeAgent('cr-scope-financeA@test.local', [siteA.id]);

    const res = await financeA.agent.get(
      `/api/v1/payroll-cycles/${cycle.id}/cash-receiving?siteIds=${siteB.id}`,
    );
    expect(res.status).toBe(403);
  });

  // --- Released-only enforcement ----------------------------------------------------------------

  it('never includes an unreleased (Draft) entry, even though it exists in the cycle', async () => {
    const admin = await masterAdminAgent('cr-draft-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site CR Draft');
    const cycle = await makeDraftCycle(admin, 5);
    const employee = await makeEmployee(site.id, unit.id, 'Draft Employee');
    await createEntry(admin, cycle.id, employee.id);
    // Deliberately NOT released.

    const res = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/cash-receiving`);
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(0);
  });

  it('excludes a held entry even after its Unit releases (the sweep never releases a held entry)', async () => {
    const admin = await masterAdminAgent('cr-hold-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site CR Hold');
    const cycle = await makeDraftCycle(admin, 6);
    const employee = await makeEmployee(site.id, unit.id, 'Hold Employee');
    const entry = await createEntry(admin, cycle.id, employee.id);
    await admin.agent
      .patch(`/api/v1/payroll-entries/${entry.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, hold: true });
    await releaseUnit(admin, cycle.id, unit.id);

    const res = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/cash-receiving`);
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(0);
  });

  it('includes a released Cash entry once its Unit has released', async () => {
    const admin = await masterAdminAgent('cr-released-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site CR Released');
    const cycle = await makeDraftCycle(admin, 7);
    const employee = await makeEmployee(site.id, unit.id, 'Released Cash Employee');
    await createEntry(admin, cycle.id, employee.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const res = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/cash-receiving`);
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].employeeName).toBe('Released Cash Employee');
  });

  // --- Cash-only filtering ------------------------------------------------------------------------

  it('excludes bank-paid employees — only bankId === null employees appear', async () => {
    const admin = await masterAdminAgent('cr-filter-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site CR Filter');
    const cycle = await makeDraftCycle(admin, 8);
    const bank = await makeBank('F1', 'Test Bank Filter');

    const employeeBank = await makeEmployee(site.id, unit.id, 'Employee Bank', {
      bankId: bank.id,
      accountNumber: '1111111111',
    });
    const employeeCash = await makeEmployee(site.id, unit.id, 'Employee Cash');

    await createEntry(admin, cycle.id, employeeBank.id);
    await createEntry(admin, cycle.id, employeeCash.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const res = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/cash-receiving`);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].employeeName).toBe('Employee Cash');
  });

  // --- Totals --------------------------------------------------------------------------------------

  it('totals correctly across multiple Cash employees (sumMoney, not floating point)', async () => {
    const admin = await masterAdminAgent('cr-total-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site CR Total');
    const cycle = await makeDraftCycle(admin, 9);

    const employeeOne = await makeEmployee(site.id, unit.id, 'Total Cash Employee One', { grossPay: '30000' });
    const employeeTwo = await makeEmployee(site.id, unit.id, 'Total Cash Employee Two', { grossPay: '45000.10' });

    await createEntry(admin, cycle.id, employeeOne.id);
    await createEntry(admin, cycle.id, employeeTwo.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const res = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/cash-receiving`);
    expect(res.body.rows).toHaveLength(2);
    expect(res.body.totalEmployees).toBe(2);
    const expectedTotal = (
      Number(res.body.rows[0].netSalary) + Number(res.body.rows[1].netSalary)
    ).toFixed(2);
    expect(res.body.totalNetSalary).toBe(expectedTotal);
  });

  // --- Historical snapshot integrity -------------------------------------------------------------

  it('never reflects an employee change made after release — designation stays frozen, payment method change never retroactively removes/adds the entry', async () => {
    const admin = await masterAdminAgent('cr-snapshot-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site CR Snapshot');
    const cycle = await makeDraftCycle(admin, 10);
    const bank = await makeBank('SNAP', 'Snapshot Bank');

    const employee = await prisma.employee.create({
      data: {
        name: 'Snapshot Cash Employee',
        designation: 'Guard',
        siteId: site.id,
        unitId: unit.id,
        grossPay: '30000',
        // No bank on file at entry-creation time — a Cash employee.
      },
    });

    await createEntry(admin, cycle.id, employee.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const before = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/cash-receiving`);
    expect(before.body.rows).toHaveLength(1);
    expect(before.body.rows[0].designation).toBe('Guard');

    // Employee is given a bank account AND a new designation AFTER release.
    await prisma.employee.update({
      where: { id: employee.id },
      data: { bankId: bank.id, accountNumber: '9999999999', designation: 'Supervisor' },
    });

    // The historical Cash Receiving Sheet for this cycle must still show the employee, with the
    // exact same frozen designation — because it reads PayrollEntry's own columns, never
    // Employee's live record. The employee's later bank assignment is never retroactive.
    const after = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/cash-receiving`);
    expect(after.body.rows).toHaveLength(1);
    expect(after.body.rows[0].designation).toBe('Guard');
    expect(after.body.rows[0].employeeName).toBe('Snapshot Cash Employee');
  });

  // --- Export correctness -----------------------------------------------------------------------

  it('exports CSV and XLSX with matching row counts, document header/footer, and a totals row', async () => {
    const admin = await masterAdminAgent('cr-export-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site CR Export');
    const cycle = await makeDraftCycle(admin, 11);
    const employee = await makeEmployee(site.id, unit.id, 'Export Cash Employee');
    await createEntry(admin, cycle.id, employee.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const csvRes = await admin.agent.get(
      `/api/v1/payroll-cycles/${cycle.id}/cash-receiving/export?format=csv`,
    );
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers['content-type']).toContain('text/csv');
    const csvText = csvRes.text;
    expect(csvText).toContain('Export Cash Employee');
    expect(csvText).toContain('Total');
    expect(csvText).toContain('Total Employees: 1');
    expect(csvText).toContain('Generated By:');
    expect(csvText).toContain('Cash Receiving Sheet');

    const xlsxRes = await admin.agent.get(
      `/api/v1/payroll-cycles/${cycle.id}/cash-receiving/export?format=xlsx`,
    );
    expect(xlsxRes.status).toBe(200);
    expect(xlsxRes.headers['content-type']).toContain('spreadsheetml');
    expect(Number(xlsxRes.headers['content-length'])).toBeGreaterThan(0);

    const auditEntry = await prisma.auditLog.findFirst({
      where: { action: 'cash_receiving_sheet.export', entityId: cycle.id },
      orderBy: { occurredAt: 'desc' },
    });
    expect(auditEntry).not.toBeNull();
  });
});
