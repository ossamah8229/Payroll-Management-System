import ExcelJS from 'exceljs';
import request from 'supertest';
import { stringify as stringifyCsvSync } from 'csv-stringify/sync';
import {
  EMPLOYEE_FIELD_LIMITS,
  EMPLOYEE_EOBI_AMOUNT_MAX,
  EMPLOYEE_GROSS_PAY_MAX,
  PAY_TYPE_LABELS,
  PAY_TYPE_VALUES,
  PERMISSIONS,
  ROLE_CODES,
} from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import {
  EMPLOYEE_TEMPLATE_HEADERS,
  EMPLOYEE_TEMPLATE_VERSION,
  EXAMPLE_SHEET_NAME,
  IMPORT_DATA_SHEET_NAME,
  INSTRUCTIONS_SHEET_NAME,
} from '../src/modules/employees/employees-import-export.service';
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

  /** Base row for every column in `EMPLOYEE_TEMPLATE_HEADERS`, including the four fields added by
   * the Import Templates checkpoint (Pay Type, IBAN, Default EOBI Amount, Default EOBI
   * Applicable) — all blank/default so a test only needs to override what it's actually testing. */
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
      'Pay Type': '',
      IBAN: '',
      'Default EOBI Amount': '',
      'Default EOBI Applicable': '',
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

  async function downloadTemplateWorkbook(agent: ReturnType<typeof request.agent>) {
    const res = await agent.get('/api/v1/employees/import-template').buffer(true).parse(binaryParser);
    expect(res.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body as Buffer);
    return { res, workbook };
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

  // ---------------------------------------------------------------------------------------------
  // Import Templates checkpoint — TEMPLATE tests (Part K items 1-8)
  // ---------------------------------------------------------------------------------------------

  it('serves a workbook with Instructions, Import Data, and Example sheets, each with the correct header row', async () => {
    const { agent } = await masterAdminAgent('import-template@test.local');
    const { res, workbook } = await downloadTemplateWorkbook(agent);

    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('employee-import-template.xlsx');
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(
      expect.arrayContaining([INSTRUCTIONS_SHEET_NAME, IMPORT_DATA_SHEET_NAME, EXAMPLE_SHEET_NAME]),
    );

    const importDataSheet = workbook.getWorksheet(IMPORT_DATA_SHEET_NAME)!;
    const importHeaderRow = importDataSheet.getRow(1).values as unknown[];
    expect(importHeaderRow.slice(1)).toEqual(EMPLOYEE_TEMPLATE_HEADERS);
    // No sample/example data on the real data-entry sheet — row 2 onward carries only Excel
    // validation/text-formatting (so `rowCount` legitimately extends well past 1), never an actual
    // value (Part B3: an un-deleted example row must never be a thing that can happen here).
    expect(importDataSheet.getRow(2).values).toEqual([]);

    const exampleSheet = workbook.getWorksheet(EXAMPLE_SHEET_NAME)!;
    const exampleHeaderRow = exampleSheet.getRow(1).values as unknown[];
    expect(exampleHeaderRow.slice(1)).toEqual(EMPLOYEE_TEMPLATE_HEADERS);
    expect(exampleSheet.rowCount).toBe(2); // header + exactly one sample row

    const instructionsSheet = workbook.getWorksheet(INSTRUCTIONS_SHEET_NAME)!;
    expect(instructionsSheet).toBeDefined();
  });

  it("Instructions sheet documents the template version and every column's Required/Optional status", async () => {
    const { agent } = await masterAdminAgent('import-template-instructions@test.local');
    const { workbook } = await downloadTemplateWorkbook(agent);

    const instructionsSheet = workbook.getWorksheet(INSTRUCTIONS_SHEET_NAME)!;
    const allText = instructionsSheet
      .getSheetValues()
      .flat()
      .filter((value): value is string => typeof value === 'string')
      .join('\n');

    expect(allText).toContain(`Template Version: ${EMPLOYEE_TEMPLATE_VERSION}`);
    for (const header of EMPLOYEE_TEMPLATE_HEADERS) {
      expect(allText).toContain(header);
    }
    expect(allText).toContain('Required');
    expect(allText).toContain('Optional');
    expect(allText).toContain('Conditional');
  });

  it("Example sheet's sample row satisfies every application validation rule and imports successfully", async () => {
    // Site/bank names follow this suite's own `cleanTestData()` cleanup convention ("Test Site "
    // prefix / "TB" bank-code prefix, see tests/helpers.ts) rather than reusing the template's own
    // "Downtown Regional Office"/"Acme Commercial Bank" example text verbatim — this test's own
    // Project/Project Bank column values are overridden below to match, same as Area/Branch Code.
    const site = await makeSite('Test Site Example Sheet');
    const bank = await prisma.bank.create({ data: { code: 'TB-EXAMPLE', name: 'Test Bank Example Sheet' } });
    const { agent, csrfToken } = await masterAdminAgent('import-template-example@test.local');

    const { workbook } = await downloadTemplateWorkbook(agent);
    const exampleSheet = workbook.getWorksheet(EXAMPLE_SHEET_NAME)!;
    const exampleRow = (exampleSheet.getRow(2).values as unknown[]).slice(1).map((v) => (v === undefined || v === null ? '' : String(v)));

    // The Example sheet references neutral placeholder Project Site/Bank names (Part B3) — this
    // test creates matching real records first so the sample row can actually be imported and
    // exercise every validation rule it claims to satisfy (Site, Unit, Bank, CNIC, dates, decimal
    // amounts, Pay Type, EOBI fields), rather than merely asserting the cell values look plausible.
    const csv = stringifyCsvSync([
      EMPLOYEE_TEMPLATE_HEADERS as unknown as string[],
      exampleRow.map((value, index) => {
        const header = EMPLOYEE_TEMPLATE_HEADERS[index];
        if (header === 'Project') return site.name;
        if (header === 'Area' || header === 'Area/Location') return `${site.name} Unit`;
        if (header === 'Branch Code') return 'U-1';
        if (header === 'Project Bank') return bank.name;
        return value;
      }),
    ]);

    const importRes = await agent
      .post('/api/v1/employees/import')
      .set('x-csrf-token', csrfToken)
      .attach('file', Buffer.from(csv, 'utf-8'), 'example.csv');

    expect(importRes.status).toBe(200);
    expect(importRes.body.skipped).toHaveLength(0);
    expect(importRes.body.created).toBe(1);

    const created = await prisma.employee.findFirstOrThrow({ where: { siteId: site.id } });
    expect(created.bankId).toBe(bank.id);
    expect(created.payType).toBe('DAILY_WAGE');
    expect(Number(created.defaultEobiAmount)).toBeCloseTo(400);
    expect(created.defaultEobiApplicable).toBe(true);
  });

  it('ignores the Instructions and Example sheets on import even when the Example sheet contains invalid data', async () => {
    const site = await makeSite('Test Site Ignore Example');
    const { agent, csrfToken } = await masterAdminAgent('import-ignore-example@test.local');

    const workbook = new ExcelJS.Workbook();
    const instructions = workbook.addWorksheet(INSTRUCTIONS_SHEET_NAME);
    instructions.addRow(['This is not employee data']);
    const example = workbook.addWorksheet(EXAMPLE_SHEET_NAME);
    example.addRow(EMPLOYEE_TEMPLATE_HEADERS as unknown as string[]);
    example.addRow(Object.values(templateRow({ Project: 'Nonexistent Site', Name: '', Designation: '' }))); // deliberately invalid
    const importData = workbook.addWorksheet(IMPORT_DATA_SHEET_NAME);
    importData.addRow(EMPLOYEE_TEMPLATE_HEADERS as unknown as string[]);
    importData.addRow(
      Object.values(
        templateRow({ Project: site.name, Area: `${site.name} Unit`, Name: 'Real Row Employee', Designation: 'Guard', 'Basic/Gross Pay': '20000' }),
      ),
    );
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const importRes = await agent
      .post('/api/v1/employees/import')
      .set('x-csrf-token', csrfToken)
      .attach('file', buffer, 'employees.xlsx');

    expect(importRes.status).toBe(200);
    expect(importRes.body.created).toBe(1);
    expect(importRes.body.skipped).toHaveLength(0); // the invalid Example row was never read at all

    const all = await prisma.employee.findMany();
    expect(all).toHaveLength(1);
    expect(all[0]?.name).toBe('Real Row Employee');
  });

  it("a column marked Required in the template is actually enforced by the importer, and Optional columns aren't", async () => {
    const site = await makeSite('Test Site Required Contract');
    const { agent, csrfToken } = await masterAdminAgent('import-required-contract@test.local');

    // Name is Required — blank Name must be rejected.
    const missingName = toCsv([
      templateRow({ Project: site.name, Area: `${site.name} Unit`, Name: '', Designation: 'Guard', 'Basic/Gross Pay': '20000' }),
    ]);
    const missingNameRes = await agent.post('/api/v1/employees/import').set('x-csrf-token', csrfToken).attach('file', missingName, 'a.csv');
    expect(missingNameRes.body.created).toBe(0);
    expect(missingNameRes.body.skipped).toHaveLength(1);
    expect(missingNameRes.body.skipped[0].reason).toMatch(/Name/);

    // Religion is Optional — a blank Religion must succeed.
    const missingReligion = toCsv([
      templateRow({ Project: site.name, Area: `${site.name} Unit`, Name: 'Optional Field Employee', Designation: 'Guard', 'Basic/Gross Pay': '20000', Religion: '' }),
    ]);
    const missingReligionRes = await agent.post('/api/v1/employees/import').set('x-csrf-token', csrfToken).attach('file', missingReligion, 'b.csv');
    expect(missingReligionRes.body.skipped).toHaveLength(0);
    expect(missingReligionRes.body.created).toBe(1);
  });

  it('Import Data sheet max-length Excel validation matches the shared EMPLOYEE_FIELD_LIMITS constants', async () => {
    const { agent } = await masterAdminAgent('import-template-lengths@test.local');
    const { workbook } = await downloadTemplateWorkbook(agent);
    const importDataSheet = workbook.getWorksheet(IMPORT_DATA_SHEET_NAME)!;

    // Designation (required, column L / 12): textLength between [1, max].
    const designationCell = importDataSheet.getCell(2, 12);
    expect(designationCell.dataValidation?.type).toBe('textLength');
    expect(designationCell.dataValidation?.formulae).toEqual([1, EMPLOYEE_FIELD_LIMITS.designation]);

    // Employee Number/Code (optional, column C / 3): textLength <= max.
    const codeCell = importDataSheet.getCell(2, 3);
    expect(codeCell.dataValidation?.type).toBe('textLength');
    expect(codeCell.dataValidation?.operator).toBe('lessThanOrEqual');
    expect(codeCell.dataValidation?.formulae).toEqual([EMPLOYEE_FIELD_LIMITS.employeeCode]);

    // IBAN (optional, column U / 21).
    const ibanCell = importDataSheet.getCell(2, 21);
    expect(ibanCell.dataValidation?.formulae).toEqual([EMPLOYEE_FIELD_LIMITS.iban]);
  });

  it('Import Data sheet numeric validation matches EMPLOYEE_GROSS_PAY_MAX / EMPLOYEE_EOBI_AMOUNT_MAX', async () => {
    const { agent } = await masterAdminAgent('import-template-numeric@test.local');
    const { workbook } = await downloadTemplateWorkbook(agent);
    const importDataSheet = workbook.getWorksheet(IMPORT_DATA_SHEET_NAME)!;

    const grossPayCell = importDataSheet.getCell(2, 19); // Basic/Gross Pay
    expect(grossPayCell.dataValidation?.type).toBe('decimal');
    expect(grossPayCell.dataValidation?.formulae).toEqual([0, EMPLOYEE_GROSS_PAY_MAX]);

    const eobiAmountCell = importDataSheet.getCell(2, 22); // Default EOBI Amount
    expect(eobiAmountCell.dataValidation?.type).toBe('decimal');
    expect(eobiAmountCell.dataValidation?.formulae).toEqual([0, EMPLOYEE_EOBI_AMOUNT_MAX]);
  });

  it('Import Data sheet enum dropdowns match the application\'s allowed Pay Type / EOBI values', async () => {
    const { agent } = await masterAdminAgent('import-template-enums@test.local');
    const { workbook } = await downloadTemplateWorkbook(agent);
    const importDataSheet = workbook.getWorksheet(IMPORT_DATA_SHEET_NAME)!;

    const payTypeCell = importDataSheet.getCell(2, 20); // Pay Type
    expect(payTypeCell.dataValidation?.type).toBe('list');
    expect(String(payTypeCell.dataValidation?.formulae?.[0])).toBe(
      `"${PAY_TYPE_VALUES.map((value) => PAY_TYPE_LABELS[value]).join(',')}"`,
    );

    const eobiApplicableCell = importDataSheet.getCell(2, 23); // Default EOBI Applicable
    expect(eobiApplicableCell.dataValidation?.type).toBe('list');
    expect(eobiApplicableCell.dataValidation?.formulae).toEqual(['"Yes,No"']);
  });

  it("Project column's dropdown only lists Project Sites the requesting user can access (RBAC)", async () => {
    const assignedSite = await makeSite('Test Site RBAC Template Assigned');
    const outsideSite = await makeSite('Test Site RBAC Template Outside');

    const { agent } = await createAuthenticatedAgent(app, {
      email: 'import-template-rbac@test.local',
      password: PASSWORD,
      roleCode: ROLE_CODES.PAYROLL_STAFF,
      permissionKeys: EMPLOYEE_PERMISSIONS,
      siteIds: [assignedSite.id],
    });

    const { workbook } = await downloadTemplateWorkbook(agent);
    const listsSheet = workbook.worksheets.find((sheet) => sheet.state === 'veryHidden');
    expect(listsSheet).toBeDefined();
    const siteNames = listsSheet!
      .getColumn(1)
      .values.slice(2) // skip the undefined index-0 slot and the "Project Sites" header
      .filter((value): value is string => typeof value === 'string');

    expect(siteNames).toContain(assignedSite.name);
    expect(siteNames).not.toContain(outsideSite.name);
  });

  it('preserves leading zeros on code-like columns by formatting them as Excel text', async () => {
    const { agent } = await masterAdminAgent('import-template-leading-zeros@test.local');
    const { workbook } = await downloadTemplateWorkbook(agent);
    const importDataSheet = workbook.getWorksheet(IMPORT_DATA_SHEET_NAME)!;

    // Employee Number/Code (3), CNIC (7), Branch Code (14), Bank Branch Code (17), Account Number (18).
    for (const columnIndex of [3, 7, 14, 17, 18]) {
      expect(importDataSheet.getColumn(columnIndex).numFmt).toBe('@');
    }
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

  // ---------------------------------------------------------------------------------------------
  // Header structural validation (Part G)
  // ---------------------------------------------------------------------------------------------

  it('rejects a file missing a required column with a message naming exactly what is missing', async () => {
    const { agent, csrfToken } = await masterAdminAgent('import-header-missing@test.local');
    const headers = (EMPLOYEE_TEMPLATE_HEADERS as unknown as string[]).filter((h) => h !== 'Pay Type');
    const csv = stringifyCsvSync([headers]);

    const res = await agent.post('/api/v1/employees/import').set('x-csrf-token', csrfToken).attach('file', Buffer.from(csv, 'utf-8'), 'bad.csv');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/missing column\(s\).*"Pay Type"/i);
  });

  it('rejects a file with an unexpected extra column with a message naming exactly what is unexpected', async () => {
    const { agent, csrfToken } = await masterAdminAgent('import-header-extra@test.local');
    const headers = [...(EMPLOYEE_TEMPLATE_HEADERS as unknown as string[]), 'Favorite Color'];
    const csv = stringifyCsvSync([headers]);

    const res = await agent.post('/api/v1/employees/import').set('x-csrf-token', csrfToken).attach('file', Buffer.from(csv, 'utf-8'), 'bad.csv');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/unexpected column\(s\).*"Favorite Color"/i);
  });

  it('rejects a file whose columns are all present but reordered', async () => {
    const { agent, csrfToken } = await masterAdminAgent('import-header-reordered@test.local');
    const headers = [...(EMPLOYEE_TEMPLATE_HEADERS as unknown as string[])];
    [headers[0], headers[1]] = [headers[1]!, headers[0]!]; // swap "Sr. No" and "Project"
    const csv = stringifyCsvSync([headers]);

    const res = await agent.post('/api/v1/employees/import').set('x-csrf-token', csrfToken).attach('file', Buffer.from(csv, 'utf-8'), 'bad.csv');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/wrong order/i);
  });

  it('a structurally invalid workbook imports nothing at all (rejected before any row is processed)', async () => {
    const { agent, csrfToken } = await masterAdminAgent('import-header-no-partial@test.local');
    const csv = stringifyCsvSync([['Completely', 'Wrong', 'Headers']]);

    const res = await agent.post('/api/v1/employees/import').set('x-csrf-token', csrfToken).attach('file', Buffer.from(csv, 'utf-8'), 'bad.csv');
    expect(res.status).toBe(400);
    expect(await prisma.employee.count()).toBe(0);
  });

  // ---------------------------------------------------------------------------------------------
  // Readable row-error messages (Part F)
  // ---------------------------------------------------------------------------------------------

  it('reports an over-length value with a clean, readable message rather than a raw Zod error', async () => {
    const site = await makeSite('Test Site Over Length');
    const { agent, csrfToken } = await masterAdminAgent('import-over-length@test.local');

    const overlongDesignation = 'D'.repeat(EMPLOYEE_FIELD_LIMITS.designation + 1);
    const csv = toCsv([
      templateRow({ Project: site.name, Area: `${site.name} Unit`, Name: 'Overlong Employee', Designation: overlongDesignation, 'Basic/Gross Pay': '20000' }),
    ]);

    const res = await agent.post('/api/v1/employees/import').set('x-csrf-token', csrfToken).attach('file', csv, 'employees.csv');
    expect(res.status).toBe(200);
    expect(res.body.skipped).toHaveLength(1);
    const reason: string = res.body.skipped[0].reason;
    expect(reason).toContain('Designation');
    expect(reason).not.toContain('{"code"'); // never a raw ZodError JSON dump
    expect(reason).not.toContain('[{');
  });

  it('reports the Account-Number-required-when-Bank-set cross-field rule with a clean message', async () => {
    const site = await makeSite('Test Site Bank Cross Field');
    await prisma.bank.create({ data: { code: 'TB-XCFB', name: 'Cross Field Bank' } });
    const { agent, csrfToken } = await masterAdminAgent('import-cross-field@test.local');

    const csv = toCsv([
      templateRow({
        Project: site.name,
        Area: `${site.name} Unit`,
        Name: 'No Account Number Employee',
        Designation: 'Guard',
        'Basic/Gross Pay': '20000',
        'Project Bank': 'Cross Field Bank',
        'Account Number': '',
      }),
    ]);

    const res = await agent.post('/api/v1/employees/import').set('x-csrf-token', csrfToken).attach('file', csv, 'employees.csv');
    expect(res.status).toBe(200);
    expect(res.body.skipped).toHaveLength(1);
    const reason: string = res.body.skipped[0].reason;
    expect(reason).toContain('Account Number');
    expect(reason).not.toContain('{"code"');
  });

  it('rejects an invalid Pay Type value with a clear message listing the allowed values', async () => {
    const site = await makeSite('Test Site Invalid Pay Type');
    const { agent, csrfToken } = await masterAdminAgent('import-invalid-paytype@test.local');

    const csv = toCsv([
      templateRow({
        Project: site.name,
        Area: `${site.name} Unit`,
        Name: 'Bad Pay Type Employee',
        Designation: 'Guard',
        'Basic/Gross Pay': '20000',
        'Pay Type': 'Weekly',
      }),
    ]);

    const res = await agent.post('/api/v1/employees/import').set('x-csrf-token', csrfToken).attach('file', csv, 'employees.csv');
    expect(res.status).toBe(200);
    expect(res.body.skipped).toHaveLength(1);
    expect(res.body.skipped[0].reason).toMatch(/Pay Type/);
    expect(res.body.skipped[0].reason).toContain('Daily Wage');
  });

  it('rejects an unrecognized date with a clear message', async () => {
    const site = await makeSite('Test Site Bad Date');
    const { agent, csrfToken } = await masterAdminAgent('import-bad-date@test.local');

    const csv = toCsv([
      templateRow({ Project: site.name, Area: `${site.name} Unit`, Name: 'Bad Date Employee', Designation: 'Guard', 'Basic/Gross Pay': '20000', DOB: 'not-a-date' }),
    ]);

    const res = await agent.post('/api/v1/employees/import').set('x-csrf-token', csrfToken).attach('file', csv, 'employees.csv');
    expect(res.status).toBe(200);
    expect(res.body.skipped).toHaveLength(1);
    expect(res.body.skipped[0].reason).toMatch(/date/i);
  });

  it('rejects an unknown bank name with a clear message', async () => {
    const site = await makeSite('Test Site Unknown Bank');
    const { agent, csrfToken } = await masterAdminAgent('import-unknown-bank@test.local');

    const csv = toCsv([
      templateRow({
        Project: site.name,
        Area: `${site.name} Unit`,
        Name: 'Unknown Bank Employee',
        Designation: 'Guard',
        'Basic/Gross Pay': '20000',
        'Project Bank': 'Totally Fictional Bank',
        'Account Number': '12345',
      }),
    ]);

    const res = await agent.post('/api/v1/employees/import').set('x-csrf-token', csrfToken).attach('file', csv, 'employees.csv');
    expect(res.status).toBe(200);
    expect(res.body.skipped).toHaveLength(1);
    expect(res.body.skipped[0].reason).toMatch(/Unknown bank/i);
  });

  // ---------------------------------------------------------------------------------------------
  // Duplicate handling (Part K items 15-16)
  // ---------------------------------------------------------------------------------------------

  it('two rows in the same workbook sharing a CNIC are treated as create-then-update, never two creates', async () => {
    const site = await makeSite('Test Site Duplicate In Workbook');
    const { agent, csrfToken } = await masterAdminAgent('import-duplicate-in-file@test.local');

    const csv = toCsv([
      templateRow({ Project: site.name, Area: `${site.name} Unit`, CNIC: '1112223334455', Name: 'First Pass', Designation: 'Guard', 'Basic/Gross Pay': '20000' }),
      templateRow({ Project: site.name, Area: `${site.name} Unit`, CNIC: '1112223334455', Name: 'Second Pass', Designation: 'Senior Guard', 'Basic/Gross Pay': '21000' }),
    ]);

    const res = await agent.post('/api/v1/employees/import').set('x-csrf-token', csrfToken).attach('file', csv, 'employees.csv');
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    expect(res.body.updated).toBe(1);
    expect(res.body.skipped).toHaveLength(0);

    const all = await prisma.employee.findMany({ where: { cnic: '1112223334455' } });
    expect(all).toHaveLength(1);
    expect(all[0]?.name).toBe('Second Pass');
  });

  // ---------------------------------------------------------------------------------------------
  // New fields: Pay Type / IBAN / EOBI round-trip (Part A/D contract-gap fix)
  // ---------------------------------------------------------------------------------------------

  it('imports and re-exports Pay Type, IBAN, and Default EOBI fields without loss', async () => {
    const site = await makeSite('Test Site New Fields Roundtrip');
    const { agent, csrfToken } = await masterAdminAgent('import-new-fields@test.local');

    const csv = toCsv([
      templateRow({
        Project: site.name,
        Area: `${site.name} Unit`,
        Name: 'Monthly IBAN Employee',
        Designation: 'Supervisor',
        'Basic/Gross Pay': '50000',
        'Pay Type': 'Monthly',
        IBAN: 'pk00test0000001234567890',
        'Default EOBI Amount': '500',
        'Default EOBI Applicable': 'no',
      }),
    ]);

    const importRes = await agent.post('/api/v1/employees/import').set('x-csrf-token', csrfToken).attach('file', csv, 'employees.csv');
    expect(importRes.status).toBe(200);
    expect(importRes.body.skipped).toHaveLength(0);
    expect(importRes.body.created).toBe(1);

    const created = await prisma.employee.findFirstOrThrow({ where: { name: 'Monthly IBAN Employee' } });
    expect(created.payType).toBe('MONTHLY');
    expect(created.iban).toBe('PK00TEST0000001234567890'); // stored uppercase
    expect(Number(created.defaultEobiAmount)).toBeCloseTo(500);
    expect(created.defaultEobiApplicable).toBe(false);

    const exportRes = await agent.get('/api/v1/employees/export?format=csv');
    expect(exportRes.text).toContain('Monthly');
    expect(exportRes.text).toContain('PK00TEST0000001234567890');
    expect(exportRes.text).toContain('No');
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
