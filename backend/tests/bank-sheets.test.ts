import ExcelJS from 'exceljs';
import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

/** supertest/superagent only auto-buffers `res.body` for content-types it recognizes as binary —
 * `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` isn't one of them, so without
 * this, `res.body` comes back empty/corrupted rather than a real XLSX buffer. Reads the response as
 * raw binary and hands back a genuine `Buffer`, the only way to actually parse the exported workbook
 * and prove a cell's value is complete rather than just asserting "some bytes came back." */
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
      // Negative Payroll Recovery checkpoint (2026-07-26) — a default 0-work-day entry nets -400
      // (the default 400 EOBI deduction) and correctly resolves to RECOVERY_DUE rather than
      // releasing for payment; this suite is about Bank Sheet generation, not net-salary sign, so
      // every entry gets enough worked days to net positive by default.
      .send({ employeeId, workLines: [{ days: '26' }] });
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
    expect(afterEmployeeChange.body.rows[0].bankCode).toBe('TBBEFORE');

    // The employee's NEW bank must show zero rows for this cycle — the historical release was
    // never retroactively reassigned to the new bank.
    const newBankSheet = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/bank-sheet?bankId=${bankAfter.id}`);
    expect(newBankSheet.body.rows).toHaveLength(0);
  });

  // --- Banking refinement (2026-07-11): derived Account Title, IBAN --------------------------------

  it('derives Account Title from the employee name, live — unlike bank/account/IBAN, it is NOT frozen at release', async () => {
    const admin = await masterAdminAgent('bs-derived-title-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site BS Derived Title');
    // Month must be 1–12; reusing 1 here is safe since cleanTestData() clears every fake
    // year>=2900 cycle before each test runs (full isolation, see tests/helpers.ts).
    const cycle = await makeDraftCycle(admin, 1);
    const bank = await makeBank('DERV', 'Derived Title Bank');

    const employee = await prisma.employee.create({
      data: {
        name: 'Original Name',
        designation: 'Guard',
        siteId: site.id,
        unitId: unit.id,
        grossPay: '30000',
        bankId: bank.id,
        accountNumber: '5551234567',
      },
    });
    await createEntry(admin, cycle.id, employee.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const before = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/bank-sheet?bankId=${bank.id}`);
    expect(before.body.rows[0].accountTitle).toBe('Original Name');

    // A later name correction (e.g. a spelling fix) — unlike bank/account/IBAN — DOES reach a
    // previously generated Bank Sheet's Account Title, since it is derived from the employee's
    // current name at generation time, not copied onto PayrollEntry the way banking fields are.
    await prisma.employee.update({ where: { id: employee.id }, data: { name: 'Corrected Name' } });

    const after = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/bank-sheet?bankId=${bank.id}`);
    expect(after.body.rows[0].accountTitle).toBe('Corrected Name');
    // Account Number/bank stayed frozen throughout, exactly as the snapshot test above verifies.
    expect(after.body.rows[0].accountNumber).toBe('5551234567');
  });

  it('derives Account Title from the employee name for a Cash employee too — never blank just because there is no bank', async () => {
    const admin = await masterAdminAgent('bs-derived-title-cash-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site BS Derived Title Cash');
    const cycle = await makeDraftCycle(admin, 2);
    const employee = await makeEmployee(site.id, unit.id, 'Cash Title Employee');
    await createEntry(admin, cycle.id, employee.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const res = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/bank-sheet?bankId=cash`);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].accountTitle).toBe('Cash Title Employee');
    expect(res.body.rows[0].accountNumber).toBeNull();
    expect(res.body.rows[0].iban).toBeNull();
  });

  // --- Export correctness -----------------------------------------------------------------------

  it('exports CSV and XLSX with matching row counts and a totals row', async () => {
    const admin = await masterAdminAgent('bs-export-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site BS Export');
    const cycle = await makeDraftCycle(admin, 12);
    const bank = await makeBank('EXP', 'Export Test Bank');
    const employee = await prisma.employee.create({
      data: {
        name: 'Export Employee',
        designation: 'Guard',
        siteId: site.id,
        unitId: unit.id,
        grossPay: '30000',
        bankId: bank.id,
        accountNumber: '9999999999',
        iban: 'PK36SCBL0000001123456702',
      },
    });
    await createEntry(admin, cycle.id, employee.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const csvRes = await admin.agent.get(
      `/api/v1/payroll-cycles/${cycle.id}/bank-sheet/export?bankId=${bank.id}&format=csv`,
    );
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers['content-type']).toContain('text/csv');
    // Period-aware filename (Phase 5 Checkpoint 4) — the payroll period is embedded so two
    // different historical cycles' exports are never indistinguishable on disk.
    expect(csvRes.headers['content-disposition']).toBe(
      'attachment; filename="bank-sheet-export-test-bank-2900-12.csv"',
    );
    const csvText = csvRes.text;
    expect(csvText).toContain('Export Employee');
    expect(csvText).toContain('9999999999');
    // Banking refinement (2026-07-11): IBAN is a real export column; Account Title is derived from
    // the employee's own name, never a separately stored/exported field.
    expect(csvText).toContain('IBAN');
    expect(csvText).toContain('PK36SCBL0000001123456702');
    expect(csvText).toContain('Account Title');
    expect(csvText).not.toContain('accountTitle');
    // Bank display rule (2026-07-13): the exported Bank column is the Code, never the Name.
    expect(csvText).toContain('TBEXP');
    expect(csvText).not.toContain('Export Test Bank');
    expect(csvText).toContain('Total');

    const xlsxRes = await admin.agent
      .get(`/api/v1/payroll-cycles/${cycle.id}/bank-sheet/export?bankId=${bank.id}&format=xlsx`)
      .buffer()
      .parse(binaryParser);
    expect(xlsxRes.status).toBe(200);
    expect(xlsxRes.headers['content-type']).toContain('spreadsheetml');
    // Parse the real binary and read the actual IBAN cell — "a non-empty buffer was returned" does
    // not prove the value inside it is complete; only reading the cell does (2026-07-12).
    const workbook = new ExcelJS.Workbook();
    // `exceljs`'s bundled type defs pin an older, incompatible `Buffer` generic than this
    // workspace's @types/node — a real cross-package type-version mismatch, not a bug in this
    // test; `any` here is the correct, narrow escape hatch, not a mask for a genuine type error.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(xlsxRes.body as any);
    const worksheet = workbook.worksheets[0]!;
    const ibanColumnIndex = (worksheet.getRow(1).values as unknown[]).findIndex((v) => v === 'IBAN');
    const ibanCellValue = worksheet.getRow(2).getCell(ibanColumnIndex).value;
    expect(ibanCellValue).toBe('PK36SCBL0000001123456702');
    // Dynamic Width Rule (2026-07-13): the column width is computed from this export's own actual
    // content (`excelColumnWidth`), not a manually guessed number — for this 24-character IBAN
    // (longer than the 4-character "IBAN" header), that's exactly length + margin, never a fixed
    // constant regardless of what's actually in the sheet.
    expect(worksheet.getColumn(ibanColumnIndex).width).toBe('PK36SCBL0000001123456702'.length + 3);

    const auditEntry = await prisma.auditLog.findFirst({
      where: { action: 'bank_sheet.export', entityId: cycle.id },
      orderBy: { occurredAt: 'desc' },
    });
    expect(auditEntry).not.toBeNull();
  });

  it('the Bank Sheet API response carries the Bank Code (not the Bank Name) and a realistic long account number, untruncated', async () => {
    const admin = await masterAdminAgent('bs-long-values-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site BS Long Values');
    // Month must be 1–12; reusing 3 here is safe since cleanTestData() clears every fake
    // year>=2900 cycle before each test runs (full isolation, see tests/helpers.ts).
    const cycle = await makeDraftCycle(admin, 3);
    // A realistic long configured Bank Code (not just a short one like "MCB") — the approved
    // Bank display rule (2026-07-13): dense tables show the Code, never the Name, so a genuinely
    // long code is the class of value that actually exercises the dynamic-width calculation.
    // `Bank.code` is `varchar(10)` — "HABIBMETRO" (10 characters) is the realistic *maximum*
    // this schema allows, not an arbitrary example, so created directly (not via `makeBank`,
    // whose "TB" cleanup prefix would push it over that limit) and cleaned up explicitly below.
    const bank = await prisma.bank.create({ data: { code: 'HABIBMETRO', name: 'Habib Metropolitan Bank' } });
    const employee = await prisma.employee.create({
      data: {
        name: 'Long Values Employee',
        designation: 'Guard',
        siteId: site.id,
        unitId: unit.id,
        grossPay: '30000',
        bankId: bank.id,
        accountNumber: '00330011002233445566', // 20 digits — a realistic long account number
        iban: 'PK36SCBL0000001123456702',
      },
    });
    await createEntry(admin, cycle.id, employee.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const res = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/bank-sheet?bankId=${bank.id}`);
    expect(res.status).toBe(200);
    const row = res.body.rows[0];
    expect(row.bankCode).toBe('HABIBMETRO');
    expect(row.bankCode).not.toContain('Habib Metropolitan Bank');
    expect(row.accountNumber).toBe('00330011002233445566');
    expect(row.accountNumber).toHaveLength(20);
    expect(row.iban).toBe('PK36SCBL0000001123456702');
    expect(row.iban).toHaveLength(24);

    // Manual cleanup — this bank's code deliberately doesn't carry the "TB" prefix
    // cleanTestData() relies on (see the creation comment above), so it must be removed here,
    // after every RESTRICT reference to it (the PayrollEntry snapshot and the Employee's own
    // current bankId) is gone.
    await prisma.payrollUnitRelease.deleteMany({ where: { cycleId: cycle.id } });
    await prisma.payrollEntryReleaseSnapshot.deleteMany({ where: { payrollEntry: { cycleId: cycle.id } } });
    await prisma.payrollEntry.deleteMany({ where: { cycleId: cycle.id } });
    await prisma.employee.delete({ where: { id: employee.id } });
    await prisma.bank.delete({ where: { id: bank.id } });
  });

  it('also renders a full 34-character IBAN-like value completely — the schema maximum, not just the Pakistani 24-character case', async () => {
    const admin = await masterAdminAgent('bs-iban34-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site BS IBAN34');
    const cycle = await makeDraftCycle(admin, 4);
    const bank = await makeBank('IBAN34', 'IBAN 34 Test Bank');
    const iban34 = 'PK36ABCD12345678901234567890123456';
    expect(iban34).toHaveLength(34);
    const employee = await prisma.employee.create({
      data: {
        name: 'IBAN34 Employee',
        designation: 'Guard',
        siteId: site.id,
        unitId: unit.id,
        grossPay: '30000',
        bankId: bank.id,
        accountNumber: '5551234567',
        iban: iban34,
      },
    });
    await createEntry(admin, cycle.id, employee.id);
    await releaseUnit(admin, cycle.id, unit.id);

    const res = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/bank-sheet?bankId=${bank.id}`);
    expect(res.body.rows[0].iban).toBe(iban34);
    expect(res.body.rows[0].iban).toHaveLength(34);
  });
});
