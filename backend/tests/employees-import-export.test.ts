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

describe('Employee Registry import/export', () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  async function makeSite(name: string) {
    return prisma.projectSite.create({ data: { name } });
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
      data: { name: 'Export Test Employee', designation: 'Guard', siteId: site.id, grossPay: '25000' },
    });

    const { agent } = await masterAdminAgent('import-export-headers@test.local');
    const res = await agent.get('/api/v1/employees/export?format=csv');

    expect(res.status).toBe(200);
    const firstLine = res.text.split('\n')[0]!.trim();
    expect(firstLine).toBe(EMPLOYEE_TEMPLATE_HEADERS.join(','));
  });

  it('round-trips: exporting then re-importing the same data updates the existing employee rather than duplicating it', async () => {
    const site = await makeSite('Test Site Roundtrip');
    const { agent, csrfToken } = await masterAdminAgent('import-export-roundtrip@test.local');

    const createRes = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Roundtrip Employee', designation: 'Guard', siteId: site.id, grossPay: '25000.00', cnic: '1112223334445' });
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
      templateRow({ Project: site.name, Name: 'Good Row Employee', Designation: 'Guard', 'Basic/Gross Pay': '20000' }),
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
        templateRow({ Project: site.name, Name: 'Xlsx Employee', Designation: 'Guard', 'Basic/Gross Pay': '18000' }),
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
});
