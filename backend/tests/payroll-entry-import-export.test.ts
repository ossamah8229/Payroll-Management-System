import ExcelJS from 'exceljs';
import { stringify as stringifyCsvSync } from 'csv-stringify/sync';
import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { PAYROLL_ENTRY_TEMPLATE_HEADERS } from '../src/modules/payroll-entry/payroll-entry-import-export.service';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

describe('Phase 3 Checkpoint 5 — Payroll Entry CSV/Excel import/export', () => {
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
      permissionKeys: [PERMISSIONS.PAYROLL_CYCLE_MANAGE, PERMISSIONS.PAYROLL_ENTRY],
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
    const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} Unit`, code: 'U-1' } });
    return { site, unit };
  }

  async function makeEmployee(
    siteId: string,
    unitId: string,
    name: string,
    overrides: { cnic?: string; employeeCode?: string; grossPay?: string } = {},
  ) {
    return prisma.employee.create({
      data: {
        name,
        designation: 'Guard',
        siteId,
        unitId,
        grossPay: overrides.grossPay ?? '30000',
        cnic: overrides.cnic,
        employeeCode: overrides.employeeCode,
      },
    });
  }

  async function makeDraftCycle(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, month: number) {
    const res = await admin.agent
      .post('/api/v1/payroll-cycles')
      .set('x-csrf-token', admin.csrfToken)
      .send({ year: 2900, month });
    return res.body.cycle as { id: string; status: string };
  }

  function templateRow(overrides: Partial<Record<(typeof PAYROLL_ENTRY_TEMPLATE_HEADERS)[number], string>>) {
    const base: Record<(typeof PAYROLL_ENTRY_TEMPLATE_HEADERS)[number], string> = {
      CNIC: '',
      'Employee Code': '',
      Name: '',
      Site: '',
      Designation: '',
      'Gross Pay': '',
      Days: '',
      'OT Hrs': '',
      'OT Rate': '',
      Allowance: '',
      Leave: '',
      'Leave Rate': '',
      'Cycle Days': '',
      'EOBI Amount': '',
      'EOBI On': '',
      Advance: '',
      'Eid Advance': '',
      Fine: '',
      Hold: '',
      Released: '',
    };
    return { ...base, ...overrides };
  }

  function toCsv(rows: Record<string, string>[]): Buffer {
    const csv = stringifyCsvSync([
      PAYROLL_ENTRY_TEMPLATE_HEADERS as unknown as string[],
      ...rows.map((row) => PAYROLL_ENTRY_TEMPLATE_HEADERS.map((header) => row[header] ?? '')),
    ]);
    return Buffer.from(csv, 'utf-8');
  }

  async function toXlsx(rows: Record<string, string>[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Payroll Entry');
    sheet.addRow(PAYROLL_ENTRY_TEMPLATE_HEADERS as unknown as string[]);
    for (const row of rows) sheet.addRow(PAYROLL_ENTRY_TEMPLATE_HEADERS.map((header) => row[header] ?? ''));
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  // findFirstOrThrow scoped by employeeId — every test below has exactly one entry per employee
  // per cycle (the (cycleId, employeeId) unique constraint), so this is unambiguous.
  async function entryForEmployee(cycleId: string, employeeId: string) {
    return prisma.payrollEntry.findFirstOrThrow({
      where: { cycleId, employeeId },
      include: { workLines: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  it('imports a CSV file, updating an existing entry matched by CNIC', async () => {
    const admin = await masterAdminAgent('import-csv-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Import CSV');
    const employee = await makeEmployee(site.id, unit.id, 'CSV Import Employee', { cnic: '1112223334445' });
    const cycle = await makeDraftCycle(admin, 1);

    const csv = toCsv([
      templateRow({
        CNIC: '1112223334445',
        'Gross Pay': '35000',
        Days: '22',
        'OT Hrs': '3',
        Allowance: '1500',
        Fine: '200',
        Hold: 'Yes',
        'EOBI On': 'No',
      }),
    ]);

    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries/import`)
      .set('x-csrf-token', admin.csrfToken)
      .attach('file', csv, 'payroll.csv');

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
    expect(res.body.skipped).toHaveLength(0);

    const entry = await entryForEmployee(cycle.id, employee.id);
    expect(Number(entry.grossPay)).toBe(35000);
    expect(Number(entry.allowance)).toBe(1500);
    expect(Number(entry.fine)).toBe(200);
    expect(entry.hold).toBe(true);
    expect(entry.eobiApplicable).toBe(false);
    expect(Number(entry.workLines[0]!.days)).toBe(22);
    expect(Number(entry.workLines[0]!.otHours)).toBe(3);
  });

  it('imports an XLSX file, updating an existing entry', async () => {
    const admin = await masterAdminAgent('import-xlsx-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Import XLSX');
    const employee = await makeEmployee(site.id, unit.id, 'XLSX Import Employee', { cnic: '2223334445556' });
    const cycle = await makeDraftCycle(admin, 2);

    const xlsx = await toXlsx([templateRow({ CNIC: '2223334445556', 'Gross Pay': '40000', Days: '25' })]);

    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries/import`)
      .set('x-csrf-token', admin.csrfToken)
      .attach('file', xlsx, 'payroll.xlsx');

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);

    const entry = await entryForEmployee(cycle.id, employee.id);
    expect(Number(entry.grossPay)).toBe(40000);
    expect(Number(entry.workLines[0]!.days)).toBe(25);
  });

  it('exports with the exact template header row, and round-trips (export then re-import changes nothing unintended)', async () => {
    const admin = await masterAdminAgent('export-roundtrip-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Export Roundtrip');
    const employee = await makeEmployee(site.id, unit.id, 'Roundtrip Employee', {
      cnic: '3334445556667',
      grossPay: '32000',
    });
    const cycle = await makeDraftCycle(admin, 3);

    const exportRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries/export?format=csv`);
    expect(exportRes.status).toBe(200);
    const firstLine = exportRes.text.split('\n')[0]!.trim();
    expect(firstLine).toBe(PAYROLL_ENTRY_TEMPLATE_HEADERS.join(','));

    const before = await entryForEmployee(cycle.id, employee.id);

    const importRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries/import`)
      .set('x-csrf-token', admin.csrfToken)
      .attach('file', Buffer.from(exportRes.text, 'utf-8'), 'payroll-entry.csv');

    expect(importRes.status).toBe(200);
    expect(importRes.body.updated).toBe(1);
    expect(importRes.body.skipped).toHaveLength(0);

    const after = await entryForEmployee(cycle.id, employee.id);
    expect(after.grossPay.toString()).toBe(before.grossPay.toString());
    expect(after.workLines[0]!.days.toString()).toBe(before.workLines[0]!.days.toString());
    // The re-import is still a real write (version increments even when values are unchanged —
    // Checkpoint 4's administrative-bulk-operation precedent, not a per-row version check).
    expect(after.version).toBe(before.version + 1);
  });

  it('matches an existing entry by Employee Code alone (no CNIC on file)', async () => {
    const admin = await masterAdminAgent('import-code-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Import Code');
    const employee = await makeEmployee(site.id, unit.id, 'Code-Only Employee', { employeeCode: 'EMP-500' });
    const cycle = await makeDraftCycle(admin, 4);

    const csv = toCsv([templateRow({ 'Employee Code': 'EMP-500', 'Gross Pay': '27000' })]);

    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries/import`)
      .set('x-csrf-token', admin.csrfToken)
      .attach('file', csv, 'payroll.csv');

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);

    const entry = await entryForEmployee(cycle.id, employee.id);
    expect(Number(entry.grossPay)).toBe(27000);
  });

  it('matches an existing entry by CNIC alone (no Employee Code on file)', async () => {
    const admin = await masterAdminAgent('import-cnic-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Import Cnic');
    const employee = await makeEmployee(site.id, unit.id, 'CNIC-Only Employee', { cnic: '4445556667778' });
    const cycle = await makeDraftCycle(admin, 5);

    // A dashed CNIC in the file — normalizeCnic() strips it before comparing, same as every other
    // CNIC match in this codebase.
    const csv = toCsv([templateRow({ CNIC: '444-555-666-7778', 'Gross Pay': '26500' })]);

    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries/import`)
      .set('x-csrf-token', admin.csrfToken)
      .attach('file', csv, 'payroll.csv');

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);

    const entry = await entryForEmployee(cycle.id, employee.id);
    expect(Number(entry.grossPay)).toBe(26500);
  });

  it('skips a row for an already-released entry, reusing assertEntryEditable — never modifies it', async () => {
    const admin = await masterAdminAgent('import-released-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Import Released');
    const employee = await makeEmployee(site.id, unit.id, 'Released Employee', { cnic: '5556667778889' });
    const cycle = await makeDraftCycle(admin, 6);

    const entryBefore = await entryForEmployee(cycle.id, employee.id);
    await prisma.payrollEntry.update({
      where: { id: entryBefore.id },
      data: { released: true, releasedAt: new Date(), releasedBy: admin.userId },
    });

    const csv = toCsv([templateRow({ CNIC: '5556667778889', 'Gross Pay': '99999' })]);

    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries/import`)
      .set('x-csrf-token', admin.csrfToken)
      .attach('file', csv, 'payroll.csv');

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(0);
    expect(res.body.skipped).toHaveLength(1);
    expect(res.body.skipped[0].reason).toMatch(/locked/i);

    const entryAfter = await entryForEmployee(cycle.id, employee.id);
    expect(Number(entryAfter.grossPay)).not.toBe(99999);
    expect(entryAfter.released).toBe(true);
  });

  it('still imports into an unreleased entry after its cycle leaves Draft — editability is driven by PayrollEntry.released, not cycle status', async () => {
    const admin = await masterAdminAgent('import-nondraft-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Import NonDraft');
    const employee = await makeEmployee(site.id, unit.id, 'NonDraft Employee', { cnic: '6667778889990' });
    const cycle = await makeDraftCycle(admin, 7);
    // Simulate the cycle having finalized (Phase 5 Checkpoint 1) — corrected 2026-07-14 final
    // review: this must NOT block the whole import. An unreleased entry stays reachable by every
    // mutation surface, including the importer, once its cycle leaves Draft; only
    // `released = true` ever locks a row.
    await prisma.payrollCycle.update({ where: { id: cycle.id }, data: { status: 'RELEASED' } });

    const csv = toCsv([templateRow({ CNIC: '6667778889990', 'Gross Pay': '31000' })]);

    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries/import`)
      .set('x-csrf-token', admin.csrfToken)
      .attach('file', csv, 'payroll.csv');

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
    expect(res.body.skipped).toHaveLength(0);

    const entry = await entryForEmployee(cycle.id, employee.id);
    expect(Number(entry.grossPay)).toBe(31000);
  });

  it('site-scopes Payroll Staff — a row for an out-of-assignment site is skipped, never updated, via a direct API call', async () => {
    const admin = await masterAdminAgent('import-scope-admin@test.local');
    const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site Import Scope A');
    const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site Import Scope B');
    const employeeA = await makeEmployee(siteA.id, unitA.id, 'Scope Employee A', { cnic: '7778889990001' });
    const employeeB = await makeEmployee(siteB.id, unitB.id, 'Scope Employee B', { cnic: '8889990001112' });
    const cycle = await makeDraftCycle(admin, 8);

    const staffA = await payrollStaffAgent('import-staffA@test.local', [siteA.id]);

    const csv = toCsv([
      templateRow({ CNIC: '7778889990001', 'Gross Pay': '29000' }),
      templateRow({ CNIC: '8889990001112', 'Gross Pay': '29000' }),
    ]);

    const res = await staffA.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries/import`)
      .set('x-csrf-token', staffA.csrfToken)
      .attach('file', csv, 'payroll.csv');

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
    expect(res.body.skipped).toHaveLength(1);
    expect(res.body.skipped[0].reason).toMatch(/do not have access/i);

    const entryA = await entryForEmployee(cycle.id, employeeA.id);
    expect(Number(entryA.grossPay)).toBe(29000);
    const entryB = await entryForEmployee(cycle.id, employeeB.id);
    expect(Number(entryB.grossPay)).not.toBe(29000);
  });

  it('skips a row identifying no known employee, and a row identifying an employee with no entry in this cycle', async () => {
    const admin = await masterAdminAgent('import-unknown-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Import Unknown');
    // Created AFTER the cycle, so the bootstrap sweep never seeded an entry for them.
    const cycle = await makeDraftCycle(admin, 9);
    const lateHire = await makeEmployee(site.id, unit.id, 'Late Hire No Entry', { cnic: '9990001112223' });

    const csv = toCsv([
      templateRow({ CNIC: '0000000000000', 'Gross Pay': '10000' }),
      templateRow({ CNIC: '9990001112223', 'Gross Pay': '10000' }),
      templateRow({ 'Gross Pay': '10000' }), // no Employee Code or CNIC at all
    ]);

    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries/import`)
      .set('x-csrf-token', admin.csrfToken)
      .attach('file', csv, 'payroll.csv');

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(0);
    expect(res.body.skipped).toHaveLength(3);
    expect(lateHire).toBeDefined();
  });

  it('writes exactly one summary AuditLog entry per import and per export operation', async () => {
    const admin = await masterAdminAgent('import-audit-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Import Audit');
    await makeEmployee(site.id, unit.id, 'Audit Employee', { cnic: '1231231231231' });
    const cycle = await makeDraftCycle(admin, 10);

    const exportRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries/export?format=csv`);
    expect(exportRes.status).toBe(200);

    const exportAuditEntries = await prisma.auditLog.findMany({ where: { action: 'payroll_entry.export' } });
    const exportAudit = exportAuditEntries.filter(
      (entry) => (entry.metadata as { cycleId?: string })?.cycleId === cycle.id,
    );
    expect(exportAudit).toHaveLength(1);

    const csv = toCsv([templateRow({ CNIC: '1231231231231', 'Gross Pay': '28500' })]);
    const importRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries/import`)
      .set('x-csrf-token', admin.csrfToken)
      .attach('file', csv, 'payroll.csv');
    expect(importRes.status).toBe(200);

    const importAuditEntries = await prisma.auditLog.findMany({ where: { action: 'payroll_entry.import' } });
    const importAudit = importAuditEntries.filter(
      (entry) => (entry.metadata as { cycleId?: string })?.cycleId === cycle.id,
    );
    expect(importAudit).toHaveLength(1);
    expect((importAudit[0]!.metadata as { updated: number }).updated).toBe(1);
  });
});
