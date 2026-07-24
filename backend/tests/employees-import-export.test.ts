import ExcelJS from 'exceljs';
import { stringify as stringifyCsvSync } from 'csv-stringify/sync';
import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { EMPLOYEE_TEMPLATE_HEADERS } from '../src/modules/employees/employees-import-export.service';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

const app = createApp();

const PASSWORD = 'CorrectHorseBattery1!';

const EMPLOYEE_PERMISSIONS = [
  PERMISSIONS.EMPLOYEES_VIEW,
  PERMISSIONS.EMPLOYEES_EDIT,
  PERMISSIONS.EMPLOYEES_CREATE,
];

/** supertest/superagent only auto-buffers `res.body` for content-types it recognizes as binary —
 * the xlsx spreadsheetml content-type isn't reliably one of them, so without this, `res.body` can
 * come back empty/corrupted rather than a real workbook buffer. Same pattern as `payslips.test.ts`'s
 * own `binaryParser`, duplicated locally per that file's own established convention. */
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

describe('Employee Registry import/export', () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  /** Every test site gets one named Project Unit (`"<site name> Unit"`, code `U-1`). Since
   * Checkpoint 3, an import row must identify its unit via the `Area`/`Area/Location` (name)
   * and/or `Branch Code` (code) columns — see employees-import-export.service.ts. */
  async function makeSite(name: string) {
    const site = await prisma.projectSite.create({ data: { name } });
    await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} Unit`, code: 'U-1' } });
    return site;
  }

  async function unitIdForSite(siteId: string): Promise<string> {
    const unit = await prisma.projectUnit.findFirstOrThrow({ where: { siteId } });
    return unit.id;
  }

  async function masterAdminAgent(email: string) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.MASTER_ADMIN,
      permissionKeys: [...EMPLOYEE_PERMISSIONS, PERMISSIONS.SITES_MANAGE],
    });
  }

  function templateRow(overrides: Partial<Record<(typeof EMPLOYEE_TEMPLATE_HEADERS)[number], string>>) {
    const base: Record<(typeof EMPLOYEE_TEMPLATE_HEADERS)[number], string> = {
      'Sr. No': '1',
      Project: '',
      'Employee Number/Code': '',
      Religion: '',
      Name: '',
      'Father Name': '',
      CNIC: '',
      DOB: '',
      DOJ: '',
      DOL: '',
      'Mobile Number': '',
      Designation: '',
      Area: '',
      'Branch Code': '',
      'Area/Location': '',
      'Project Bank': '',
      'Bank Branch Code': '',
      'Account Number': '',
      'Basic/Gross Pay': '',
    };
    return { ...base, ...overrides };
  }

  function toCsv(rows: Record<string, string>[]): Buffer {
    const csv = stringifyCsvSync([
      EMPLOYEE_TEMPLATE_HEADERS as unknown as string[],
      ...rows.map((row) => EMPLOYEE_TEMPLATE_HEADERS.map((header) => row[header] ?? '')),
    ]);
    return Buffer.from(csv, 'utf-8');
  }

  it('exports employees with the exact official template header row', async () => {
    const site = await makeSite('Test Site Export Headers');
    await prisma.employee.create({
      data: {
        name: 'Export Test Employee',
        designation: 'Guard',
        siteId: site.id,
        unitId: await unitIdForSite(site.id),
        grossPay: '25000',
      },
    });

    const { agent } = await masterAdminAgent('import-export-headers@test.local');
    const res = await agent.get('/api/v1/employees/export?format=csv');

    expect(res.status).toBe(200);
    const firstLine = res.text.split('\n')[0]!.trim();
    expect(firstLine).toBe(EMPLOYEE_TEMPLATE_HEADERS.join(','));
  });

  // Import Templates checkpoint — the blank, downloadable template a user fills in before ever
  // running a real import. Distinct from /export (which requires real employee data to exist and
  // returns whatever rows match), this endpoint needs no data and no site scope at all.
  it('serves a downloadable import template with the exact header row, one sample row, and an Instructions sheet', async () => {
    const { agent } = await masterAdminAgent('import-template@test.local');
    const res = await agent.get('/api/v1/employees/import-template').buffer(true).parse(binaryParser);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('employee-import-template.xlsx');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body as Buffer);

    const templateSheet = workbook.getWorksheet('Employee Import Template');
    expect(templateSheet).toBeDefined();
    const headerRow = templateSheet!.getRow(1).values as unknown[];
    // ExcelJS rows are 1-indexed with a leading empty slot at index 0.
    expect(headerRow.slice(1)).toEqual(EMPLOYEE_TEMPLATE_HEADERS);
    expect(templateSheet!.rowCount).toBe(2); // header + exactly one sample row

    const instructionsSheet = workbook.getWorksheet('Instructions');
    expect(instructionsSheet).toBeDefined();
    // One instructions row per template column, plus its own header row.
    expect(instructionsSheet!.rowCount).toBe(EMPLOYEE_TEMPLATE_HEADERS.length + 1);
  });

  it('rejects a template download from a user without employees:create', async () => {
    const site = await makeSite('Test Site Template Unauthorized');
    // A custom, non-seeded role code — PAYROLL_STAFF/FINANCE/MASTER_ADMIN are real seeded system
    // roles whose default permission grants already exist in the database, so createTestUser's
    // upsert-by-code would silently reuse (and ignore any narrower permissionKeys against) one of
    // those rather than actually construct an under-permissioned persona.
    const { agent } = await createAuthenticatedAgent(app, {
      email: 'import-template-unauthorized@test.local',
      password: PASSWORD,
      roleCode: 'TEST_EMPLOYEES_VIEW_ONLY',
      permissionKeys: [PERMISSIONS.EMPLOYEES_VIEW],
      siteIds: [site.id],
    });

    const res = await agent.get('/api/v1/employees/import-template');
    expect(res.status).toBe(403);
  });

  it('round-trips: exporting then re-importing the same data updates the existing employee rather than duplicating it', async () => {
    const site = await makeSite('Test Site Roundtrip');
    const { agent, csrfToken } = await masterAdminAgent('import-export-roundtrip@test.local');

    const createRes = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send({
        name: 'Roundtrip Employee',
        designation: 'Guard',
        siteId: site.id,
        unitId: await unitIdForSite(site.id),
        grossPay: '25000.00',
        cnic: '1112223334445',
      });
    expect(createRes.status).toBe(201);

    const exportRes = await agent.get('/api/v1/employees/export?format=csv');
    expect(exportRes.status).toBe(200);

    const importRes = await agent
      .post('/api/v1/employees/import')
      .set('x-csrf-token', csrfToken)
      .attach('file', Buffer.from(exportRes.text, 'utf-8'), 'employee-registry.csv');

    expect(importRes.status).toBe(200);
    expect(importRes.body.created).toBe(0);
    expect(importRes.body.updated).toBe(1);
    expect(importRes.body.skipped).toHaveLength(0);

    const allEmployees = await prisma.employee.findMany({ where: { cnic: '1112223334445' } });
    expect(allEmployees).toHaveLength(1);
  });

  it('skips a row with an unknown project site and reports why, without failing the rest of the file', async () => {
    const site = await makeSite('Test Site Import Valid');
    const { agent, csrfToken } = await masterAdminAgent('import-export-badrow@test.local');

    const csv = toCsv([
      templateRow({ Project: 'Nonexistent Site', Name: 'Bad Row Employee', Designation: 'Guard', 'Basic/Gross Pay': '20000' }),
      templateRow({ Project: site.name, Area: `${site.name} Unit`, Name: 'Good Row Employee', Designation: 'Guard', 'Basic/Gross Pay': '20000' }),
    ]);

    const importRes = await agent
      .post('/api/v1/employees/import')
      .set('x-csrf-token', csrfToken)
      .attach('file', csv, 'employees.csv');

    expect(importRes.status).toBe(200);
    expect(importRes.body.created).toBe(1);
    expect(importRes.body.skipped).toHaveLength(1);
    expect(importRes.body.skipped[0].reason).toMatch(/Unknown project site/);

    const created = await prisma.employee.findFirst({ where: { name: 'Good Row Employee' } });
    expect(created).not.toBeNull();
  });

  it('rejects an import row targeting a site outside a Payroll Staff user\'s assignment', async () => {
    const assignedSite = await makeSite('Test Site Import Assigned');
    const outsideSite = await makeSite('Test Site Import Outside');

    const { agent, csrfToken } = await createAuthenticatedAgent(app, {
      email: 'import-export-scoped@test.local',
      password: PASSWORD,
      roleCode: ROLE_CODES.PAYROLL_STAFF,
      permissionKeys: EMPLOYEE_PERMISSIONS,
      siteIds: [assignedSite.id],
    });

    const csv = toCsv([
      templateRow({ Project: outsideSite.name, Name: 'Outside Site Employee', Designation: 'Guard', 'Basic/Gross Pay': '20000' }),
    ]);

    const importRes = await agent
      .post('/api/v1/employees/import')
      .set('x-csrf-token', csrfToken)
      .attach('file', csv, 'employees.csv');

    expect(importRes.status).toBe(200);
    expect(importRes.body.created).toBe(0);
    expect(importRes.body.skipped).toHaveLength(1);
    expect(importRes.body.skipped[0].reason).toMatch(/access/i);
  });

  it('imports from an .xlsx workbook', async () => {
    const site = await makeSite('Test Site Import Xlsx');
    const { agent, csrfToken } = await masterAdminAgent('import-export-xlsx@test.local');

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(EMPLOYEE_TEMPLATE_HEADERS as unknown as string[]);
    sheet.addRow(
      Object.values(
        templateRow({ Project: site.name, Area: `${site.name} Unit`, Name: 'Xlsx Employee', Designation: 'Guard', 'Basic/Gross Pay': '18000' }),
      ),
    );
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const importRes = await agent
      .post('/api/v1/employees/import')
      .set('x-csrf-token', csrfToken)
      .attach('file', buffer, 'employees.xlsx');

    expect(importRes.status).toBe(200);
    expect(importRes.body.created).toBe(1);

    const created = await prisma.employee.findFirst({ where: { name: 'Xlsx Employee' } });
    expect(created).not.toBeNull();
  });

  it('imports rows into a multi-unit site, resolving each row\'s unit by Area name or by Branch Code (Checkpoint 3)', async () => {
    const site = await makeSite('Test Site Multi Unit'); // "Test Site Multi Unit Unit", code U-1
    const second = await prisma.projectUnit.create({
      data: { siteId: site.id, name: 'Second Unit', code: 'U-2' },
    });
    const { agent, csrfToken } = await masterAdminAgent('import-export-multi-unit@test.local');

    const csv = toCsv([
      templateRow({ Project: site.name, Area: 'Second Unit', Name: 'By Name Employee', Designation: 'Guard', 'Basic/Gross Pay': '20000' }),
      templateRow({ Project: site.name, 'Branch Code': 'u-2', Name: 'By Code Employee', Designation: 'Guard', 'Basic/Gross Pay': '20000' }),
    ]);

    const importRes = await agent
      .post('/api/v1/employees/import')
      .set('x-csrf-token', csrfToken)
      .attach('file', csv, 'employees.csv');

    expect(importRes.status).toBe(200);
    expect(importRes.body.created).toBe(2);
    expect(importRes.body.skipped).toHaveLength(0);

    const byName = await prisma.employee.findFirst({ where: { name: 'By Name Employee' } });
    const byCode = await prisma.employee.findFirst({ where: { name: 'By Code Employee' } });
    expect(byName?.unitId).toBe(second.id);
    expect(byCode?.unitId).toBe(second.id); // matched case-insensitively ("u-2")
  });

  it('exports the employee\'s unit name/code in the Area, Branch Code, and Area/Location columns (Checkpoint 3 remap)', async () => {
    const site = await makeSite('Test Site Export Unit Columns');
    const unitId = await unitIdForSite(site.id);
    await prisma.employee.create({
      data: { name: 'Unit Columns Employee', designation: 'Guard', siteId: site.id, unitId, grossPay: '25000' },
    });

    const { agent } = await masterAdminAgent('import-export-unit-cols@test.local');
    const res = await agent.get('/api/v1/employees/export?format=csv');

    expect(res.status).toBe(200);
    const dataLine = res.text.split('\n')[1]!;
    expect(dataLine).toContain(`${site.name} Unit`); // Area + Area/Location = unit name
    expect(dataLine).toContain('U-1'); // Branch Code = unit code
  });

  it('skips a row that names no unit at all, with a clear reason (interim auto-resolution removed)', async () => {
    const site = await makeSite('Test Site No Unit Given');
    const { agent, csrfToken } = await masterAdminAgent('import-export-no-unit-given@test.local');

    const csv = toCsv([
      templateRow({ Project: site.name, Name: 'No Unit Employee', Designation: 'Guard', 'Basic/Gross Pay': '20000' }),
    ]);

    const importRes = await agent
      .post('/api/v1/employees/import')
      .set('x-csrf-token', csrfToken)
      .attach('file', csv, 'employees.csv');

    expect(importRes.status).toBe(200);
    expect(importRes.body.created).toBe(0);
    expect(importRes.body.skipped).toHaveLength(1);
    expect(importRes.body.skipped[0].reason).toMatch(/does not specify a branch/i);
  });

  it('layer 1: rejects a row whose named unit belongs to a different site than the row\'s own site', async () => {
    const siteA = await makeSite('Test Site Layer1 A');
    const siteB = await makeSite('Test Site Layer1 B');
    await prisma.projectUnit.create({ data: { siteId: siteB.id, name: 'Elsewhere Unit', code: 'ELSE-1' } });
    const { agent, csrfToken } = await masterAdminAgent('import-export-layer1@test.local');

    const csv = toCsv([
      // Names siteA as the Project but a unit that only exists under siteB.
      templateRow({ Project: siteA.name, Area: 'Elsewhere Unit', Name: 'Cross Site Employee', Designation: 'Guard', 'Basic/Gross Pay': '20000' }),
    ]);

    const importRes = await agent
      .post('/api/v1/employees/import')
      .set('x-csrf-token', csrfToken)
      .attach('file', csv, 'employees.csv');

    expect(importRes.status).toBe(200);
    expect(importRes.body.created).toBe(0);
    expect(importRes.body.skipped).toHaveLength(1);
    expect(importRes.body.skipped[0].reason).toMatch(/belongs to a different project site/i);
    expect(await prisma.employee.findFirst({ where: { name: 'Cross Site Employee' } })).toBeNull();
  });

  it('layer 1: rejects a row whose Branch Code and Area point at two different units', async () => {
    const site = await makeSite('Test Site Layer1 Conflict'); // unit "… Unit" with code U-1
    await prisma.projectUnit.create({ data: { siteId: site.id, name: 'Other Unit', code: 'U-9' } });
    const { agent, csrfToken } = await masterAdminAgent('import-export-conflict@test.local');

    const csv = toCsv([
      templateRow({ Project: site.name, Area: 'Other Unit', 'Branch Code': 'U-1', Name: 'Conflicted Employee', Designation: 'Guard', 'Basic/Gross Pay': '20000' }),
    ]);

    const importRes = await agent
      .post('/api/v1/employees/import')
      .set('x-csrf-token', csrfToken)
      .attach('file', csv, 'employees.csv');

    expect(importRes.status).toBe(200);
    expect(importRes.body.skipped).toHaveLength(1);
    expect(importRes.body.skipped[0].reason).toMatch(/two different/i);
  });

  it('layer 3: a raw database write pairing a unit with the wrong site is rejected by the composite foreign key itself', async () => {
    const siteA = await makeSite('Test Site Layer3 A');
    const siteB = await makeSite('Test Site Layer3 B');
    const unitB = await unitIdForSite(siteB.id);

    // Bypasses both the import layer and the service layer deliberately — the database must
    // catch this alone (docs/IMPLEMENTATION_PLAN.md Phase 2.5 testing strategy).
    await expect(
      prisma.employee.create({
        data: { name: 'Raw Write Employee', designation: 'Guard', siteId: siteA.id, unitId: unitB, grossPay: '20000' },
      }),
    ).rejects.toThrow(/foreign key|constraint/i);
  });

  it('records a transfer (history row + employee.transferred audit entry) when an import moves an existing employee to another unit', async () => {
    const site = await makeSite('Test Site Import Transfer');
    const fromUnitId = await unitIdForSite(site.id);
    const toUnit = await prisma.projectUnit.create({
      data: { siteId: site.id, name: 'Transfer Target Unit', code: 'TT-1' },
    });
    const employee = await prisma.employee.create({
      data: {
        name: 'Import Transfer Employee',
        designation: 'Guard',
        siteId: site.id,
        unitId: fromUnitId,
        grossPay: '20000',
        cnic: '9998887776665',
      },
    });
    const { agent, csrfToken } = await masterAdminAgent('import-export-transfer@test.local');

    const csv = toCsv([
      templateRow({
        Project: site.name,
        Area: 'Transfer Target Unit',
        CNIC: '9998887776665',
        Name: 'Import Transfer Employee',
        Designation: 'Guard',
        'Basic/Gross Pay': '20000',
      }),
    ]);

    const importRes = await agent
      .post('/api/v1/employees/import')
      .set('x-csrf-token', csrfToken)
      .attach('file', csv, 'employees.csv');

    expect(importRes.status).toBe(200);
    expect(importRes.body.updated).toBe(1);
    expect(importRes.body.skipped).toHaveLength(0);

    const refreshed = await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } });
    expect(refreshed.unitId).toBe(toUnit.id);

    const history = await prisma.employeeTransferHistory.findMany({ where: { employeeId: employee.id } });
    expect(history).toHaveLength(1);
    expect(history[0]?.fromUnitId).toBe(fromUnitId);
    expect(history[0]?.toUnitId).toBe(toUnit.id);
    expect(history[0]?.reason).toBe('Employee Registry import');

    const transferEntries = await prisma.auditLog.findMany({ where: { action: 'employee.transferred' } });
    expect(transferEntries.some((entry) => entry.entityId === employee.id)).toBe(true);
  });

  it('does not record a transfer when a re-import leaves the employee\'s site/unit unchanged', async () => {
    const site = await makeSite('Test Site Import No Transfer');
    const { agent, csrfToken } = await masterAdminAgent('import-export-no-transfer@test.local');

    const createRes = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send({
        name: 'Stationary Employee',
        designation: 'Guard',
        siteId: site.id,
        unitId: await unitIdForSite(site.id),
        grossPay: '25000.00',
        cnic: '5554443332221',
      });
    expect(createRes.status).toBe(201);

    const exportRes = await agent.get('/api/v1/employees/export?format=csv');
    const importRes = await agent
      .post('/api/v1/employees/import')
      .set('x-csrf-token', csrfToken)
      .attach('file', Buffer.from(exportRes.text, 'utf-8'), 'employee-registry.csv');

    expect(importRes.status).toBe(200);
    expect(importRes.body.updated).toBe(1);

    const history = await prisma.employeeTransferHistory.findMany({
      where: { employee: { cnic: '5554443332221' } },
    });
    expect(history).toHaveLength(0);
  });

  it('matches an existing employee by CNIC even when the import row writes it with dashes (normalization bug fix)', async () => {
    const site = await makeSite('Test Site Import CNIC Dashed');
    const employee = await prisma.employee.create({
      data: {
        name: 'Dashed CNIC Match Employee',
        designation: 'Guard',
        siteId: site.id,
        unitId: await unitIdForSite(site.id),
        grossPay: '20000',
        cnic: '1231231231234',
      },
    });
    const { agent, csrfToken } = await masterAdminAgent('import-export-cnic-dashed@test.local');

    const csv = toCsv([
      templateRow({
        Project: site.name,
        Area: `${site.name} Unit`,
        CNIC: '12312-3123123-4',
        Name: 'Dashed CNIC Match Employee',
        Designation: 'Senior Guard',
        'Basic/Gross Pay': '20000',
      }),
    ]);

    const importRes = await agent
      .post('/api/v1/employees/import')
      .set('x-csrf-token', csrfToken)
      .attach('file', csv, 'employees.csv');

    expect(importRes.status).toBe(200);
    // Before the fix, the raw dashed cell never matched the stored digits-only value, so this row
    // would fall through to "create" and 500/skip on the cnic unique constraint instead of updating.
    expect(importRes.body.created).toBe(0);
    expect(importRes.body.updated).toBe(1);
    expect(importRes.body.skipped).toHaveLength(0);

    const all = await prisma.employee.findMany({ where: { cnic: '1231231231234' } });
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe(employee.id);
    expect(all[0]?.designation).toBe('Senior Guard');
  });

  it('reactivates a departed employee reappearing in an import with a blank DOL column, via the same Reactivate workflow/audit trail as the UI action', async () => {
    const site = await makeSite('Test Site Import Reactivate');
    const unitId = await unitIdForSite(site.id);
    const employee = await prisma.employee.create({
      data: {
        name: 'Import Rehire Employee',
        designation: 'Guard',
        siteId: site.id,
        unitId,
        grossPay: '20000',
        cnic: '1112223334446',
        dateOfLeaving: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const { agent, csrfToken } = await masterAdminAgent('import-export-reactivate@test.local');

    const csv = toCsv([
      templateRow({
        Project: site.name,
        Area: `${site.name} Unit`,
        CNIC: '1112223334446',
        Name: 'Import Rehire Employee',
        Designation: 'Rehired Guard',
        'Basic/Gross Pay': '22000',
        DOL: '', // blank -> this row means the employee is active again
      }),
    ]);

    const importRes = await agent
      .post('/api/v1/employees/import')
      .set('x-csrf-token', csrfToken)
      .attach('file', csv, 'employees.csv');

    expect(importRes.status).toBe(200);
    expect(importRes.body.updated).toBe(1);
    expect(importRes.body.skipped).toHaveLength(0);

    const refreshed = await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } });
    expect(refreshed.dateOfLeaving).toBeNull();
    expect(refreshed.designation).toBe('Rehired Guard');

    // Never a second row for the same CNIC.
    const all = await prisma.employee.findMany({ where: { cnic: '1112223334446' } });
    expect(all).toHaveLength(1);

    const reactivatedEntries = await prisma.auditLog.findMany({ where: { action: 'employee.reactivated' } });
    expect(reactivatedEntries.some((entry) => entry.entityId === employee.id)).toBe(true);

    const updatedEntries = await prisma.auditLog.findMany({ where: { action: 'employee.updated' } });
    expect(updatedEntries.some((entry) => entry.entityId === employee.id)).toBe(false);
  });

  it('reactivating via import into a different unit also writes an EmployeeTransferHistory row and employee.transferred entry, alongside employee.reactivated', async () => {
    const fromSite = await makeSite('Test Site Import Reactivate Transfer From');
    const toSite = await makeSite('Test Site Import Reactivate Transfer To');
    const fromUnitId = await unitIdForSite(fromSite.id);
    const toUnitId = await unitIdForSite(toSite.id);
    const employee = await prisma.employee.create({
      data: {
        name: 'Import Rehire Transfer Employee',
        designation: 'Guard',
        siteId: fromSite.id,
        unitId: fromUnitId,
        grossPay: '20000',
        cnic: '1112223334447',
        dateOfLeaving: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const { agent, csrfToken } = await masterAdminAgent('import-export-reactivate-transfer@test.local');

    const csv = toCsv([
      templateRow({
        Project: toSite.name,
        Area: `${toSite.name} Unit`,
        CNIC: '1112223334447',
        Name: 'Import Rehire Transfer Employee',
        Designation: 'Guard',
        'Basic/Gross Pay': '20000',
        DOL: '',
      }),
    ]);

    const importRes = await agent
      .post('/api/v1/employees/import')
      .set('x-csrf-token', csrfToken)
      .attach('file', csv, 'employees.csv');

    expect(importRes.status).toBe(200);
    expect(importRes.body.updated).toBe(1);

    const refreshed = await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } });
    expect(refreshed.dateOfLeaving).toBeNull();
    expect(refreshed.siteId).toBe(toSite.id);
    expect(refreshed.unitId).toBe(toUnitId);

    const history = await prisma.employeeTransferHistory.findMany({ where: { employeeId: employee.id } });
    expect(history).toHaveLength(1);
    expect(history[0]?.fromSiteId).toBe(fromSite.id);
    expect(history[0]?.toSiteId).toBe(toSite.id);

    const transferEntries = await prisma.auditLog.findMany({ where: { action: 'employee.transferred' } });
    expect(transferEntries.some((entry) => entry.entityId === employee.id)).toBe(true);
    const reactivatedEntries = await prisma.auditLog.findMany({ where: { action: 'employee.reactivated' } });
    expect(reactivatedEntries.some((entry) => entry.entityId === employee.id)).toBe(true);
  });

  it('neutralizes a formula-injection payload in an employee name on CSV export (security correction)', async () => {
    const site = await makeSite('Test Site CSV Injection');
    await prisma.employee.create({
      data: {
        name: '=cmd|\'/C calc\'!A1',
        designation: 'Guard',
        siteId: site.id,
        unitId: await unitIdForSite(site.id),
        grossPay: '25000',
      },
    });

    const { agent } = await masterAdminAgent('csv-injection@test.local');
    const res = await agent.get('/api/v1/employees/export?format=csv');

    expect(res.status).toBe(200);
    // Raw, unneutralized payload must never appear in the export (a bare "=cmd|" immediately after
    // a field-separating comma is exactly what a spreadsheet application would evaluate as a
    // formula) — it must always carry the neutralizing leading apostrophe instead.
    expect(res.text).not.toContain(',=cmd|');
    expect(res.text).toContain(",'=cmd|");
  });
});
