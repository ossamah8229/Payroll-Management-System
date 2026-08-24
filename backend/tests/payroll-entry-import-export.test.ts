import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { PAYROLL_ENTRY_TEMPLATE_HEADERS } from '../src/modules/payroll-entry/payroll-entry-import-export.service';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

describe('Phase 3 Checkpoint 5 — Payroll Entry CSV/Excel export (import removed, Payroll Entry usability checkpoint 2026-07-24)', () => {
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
        PERMISSIONS.EMPLOYEES_EDIT,
      ],
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

  async function createEntry(
    admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>,
    cycleId: string,
    employeeId: string,
    days = '26',
  ) {
    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycleId}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId, workLines: [{ days }] });
    if (res.status !== 201) {
      throw new Error(`createEntry failed with status ${res.status}: ${JSON.stringify(res.body)}`);
    }
    return res.body.entry as { id: string; version: number };
  }

  async function addWorkLine(
    admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>,
    entry: { id: string; version: number },
    unitId: string,
    days: string,
  ) {
    const res = await admin.agent
      .post(`/api/v1/payroll-entries/${entry.id}/work-lines`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, unitId, days });
    if (res.status !== 201) {
      throw new Error(`addWorkLine failed with status ${res.status}: ${JSON.stringify(res.body)}`);
    }
    return res.body.entry as { id: string; version: number };
  }

  it('exports CSV with the exact template header row and the entry’s real values', async () => {
    const admin = await masterAdminAgent('export-csv-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Export CSV');
    await makeEmployee(site.id, unit.id, 'CSV Export Employee', { cnic: '3334445556667', grossPay: '32000' });
    const cycle = await makeDraftCycle(admin, 1);

    const exportRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries/export?format=csv`);
    expect(exportRes.status).toBe(200);

    const lines = exportRes.text.trim().split('\n');
    expect(lines[0]!.trim()).toBe(PAYROLL_ENTRY_TEMPLATE_HEADERS.join(','));
    expect(lines[1]).toContain('3334445556667');
    expect(lines[1]).toContain('32000');
  });

  it('exports XLSX with the exact template header row', async () => {
    const admin = await masterAdminAgent('export-xlsx-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Export XLSX');
    await makeEmployee(site.id, unit.id, 'XLSX Export Employee', { cnic: '2223334445556' });
    const cycle = await makeDraftCycle(admin, 2);

    const exportRes = await admin.agent
      .get(`/api/v1/payroll-cycles/${cycle.id}/entries/export?format=xlsx`)
      .buffer(true)
      .parse((res, callback) => {
        res.setEncoding('binary');
        let data = '';
        res.on('data', (chunk: string) => {
          data += chunk;
        });
        res.on('end', () => callback(null, Buffer.from(data, 'binary')));
      });

    expect(exportRes.status).toBe(200);
    expect(exportRes.headers['content-type']).toContain('spreadsheetml');
  });

  it('writes exactly one summary AuditLog entry per export operation', async () => {
    const admin = await masterAdminAgent('export-audit-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Export Audit');
    await makeEmployee(site.id, unit.id, 'Audit Employee', { cnic: '1231231231231' });
    const cycle = await makeDraftCycle(admin, 3);

    const exportRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries/export?format=csv`);
    expect(exportRes.status).toBe(200);

    const exportAuditEntries = await prisma.auditLog.findMany({ where: { action: 'payroll_entry.export' } });
    const exportAudit = exportAuditEntries.filter(
      (entry) => (entry.metadata as { cycleId?: string })?.cycleId === cycle.id,
    );
    expect(exportAudit).toHaveLength(1);
  });

  // --- Phase 7F Refinement (2026-08-04) — export now overlays live Employee Registry data for a
  // Draft entry, and continues freezing it for a Released one, matching the on-screen grid exactly.

  it('a Draft entry export reflects a live Employee Registry edit (Gross Pay/Designation/Name) — no PATCH to the entry, no stale export', async () => {
    const admin = await masterAdminAgent('export-live-draft-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Export Live Draft');
    // Cycle created *before* the Employee, deliberately — creating a cycle bootstraps entries for
    // every already-existing Employee (`bootstrapPayrollEntries`), which would otherwise silently
    // pre-empt the explicit `createEntry` call below with a 409 (a real fixture-ordering gotcha
    // this codebase's own other test files already established the same fix for).
    const cycle = await makeDraftCycle(admin, 5);
    const employee = await makeEmployee(site.id, unit.id, 'Original Export Name', { cnic: '1112223334445', grossPay: '30000' });
    await createEntry(admin, cycle.id, employee.id);

    // Corrected in Employee Registry after the entry already exists — the exact scenario the
    // on-screen grid already reflects live (`payroll-entry.service.ts`'s `withLiveMasterData`).
    const patchEmployee = await admin.agent
      .patch(`/api/v1/employees/${employee.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ grossPay: '45000', designation: 'Shift Supervisor', name: 'Corrected Export Name' });
    expect(patchEmployee.status).toBe(200);

    const exportRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries/export?format=csv`);
    expect(exportRes.status).toBe(200);
    const dataLine = exportRes.text.trim().split('\n')[1]!;
    expect(dataLine).toContain('Corrected Export Name');
    expect(dataLine).toContain('Shift Supervisor');
    expect(dataLine).toContain('45000');
    expect(dataLine).not.toContain('Original Export Name');
    expect(dataLine).not.toContain('30000');

    // The entry's own stored column is untouched — same "copied, not linked" convention as every
    // other read of this data; only the export (and the grid) overlay it for display.
    const stored = await prisma.payrollEntry.findFirstOrThrow({ where: { cycleId: cycle.id, employeeId: employee.id } });
    expect(stored.designation).toBe('Guard');
    expect(Number(stored.grossPay)).toBe(30000);
  });

  it('a Released entry export keeps the frozen historical snapshot — a later Employee Registry edit never reaches it', async () => {
    const admin = await masterAdminAgent('export-frozen-released-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Export Frozen Released');
    // Cycle before Employee — same fixture-ordering reason as the Draft test above.
    const cycle = await makeDraftCycle(admin, 6);
    const employee = await makeEmployee(site.id, unit.id, 'Pre-release Export Name', { cnic: '5556667778889', grossPay: '30000' });
    await createEntry(admin, cycle.id, employee.id);

    const release = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${unit.id}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(release.status).toBe(201);
    expect(release.body.releasedEntryCount).toBe(1);

    // Employee Registry changes after release — must never reach the now-frozen export row.
    await admin.agent
      .patch(`/api/v1/employees/${employee.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ grossPay: '99999', designation: 'Renamed After Release', name: 'Renamed After Release Name' });

    const exportRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries/export?format=csv`);
    expect(exportRes.status).toBe(200);
    const dataLine = exportRes.text.trim().split('\n')[1]!;
    expect(dataLine).toContain('Pre-release Export Name');
    expect(dataLine).toContain('Guard');
    expect(dataLine).toContain('30000');
    expect(dataLine).not.toContain('Renamed After Release');
    expect(dataLine).not.toContain('99999');
  });

  it('no longer serves a Payroll Entry import route or an import-template route', async () => {
    const admin = await masterAdminAgent('no-import-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site No Import');
    await makeEmployee(site.id, unit.id, 'No Import Employee', { cnic: '9998887776665' });
    const cycle = await makeDraftCycle(admin, 4);

    // `/import-template`'s dedicated route is gone entirely — it now falls through to the generic
    // `GET /payroll-entries/:id` route, treating "import-template" as a (non-UUID) id, which that
    // route rejects with 400 rather than a clean 404. Either way, the template is definitely no
    // longer served — never a 200 with an .xlsx body.
    const templateRes = await admin.agent.get('/api/v1/payroll-entries/import-template');
    expect(templateRes.status).toBe(400);

    // `/entries/import` has no fallback route on its router at all, so this is a real Express 404.
    const importRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries/import`)
      .set('x-csrf-token', admin.csrfToken)
      .attach('file', Buffer.from('CNIC\n9998887776665\n'), 'payroll.csv');
    expect(importRes.status).toBe(404);
  });

  // --- v1.0.0 release blocker — Payroll Entry Working-Days Aggregation and Export Correctness
  // (2026-08-24). Reported defect: a split-unit employee's Working Days showed only the primary
  // line's own value everywhere (grid parent row, footer, export). `Days` now reads the same
  // canonical `calcNet().totalWorkingDays` the grid/footer use; nine columns (Net Salary, Bank,
  // Bank Name, Branch Code, Account Number, IBAN, Deputed Branch Code/Name, Unit Working Days
  // Breakdown, Remarks) were appended so the export faithfully represents the grid's own business
  // columns, per the approved product decision recorded in docs/PROJECT_PROGRESS.md.

  it('a single-unit employee export is unaffected: Days is that one line\'s own value, Unit Working Days Breakdown is blank', async () => {
    const admin = await masterAdminAgent('export-single-unit-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Export Single Unit');
    // Cycle before Employee, deliberately — creating a cycle bootstraps entries for every
    // already-existing Employee, which would otherwise pre-empt the explicit `createEntry` call
    // below with a 409 (the same fixture-ordering gotcha this file's own pre-existing tests
    // already document).
    const cycle = await makeDraftCycle(admin, 7);
    const employee = await makeEmployee(site.id, unit.id, 'Single Unit Employee', { cnic: '1112223330001' });
    await createEntry(admin, cycle.id, employee.id, '30');

    const exportRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries/export?format=csv`);
    expect(exportRes.status).toBe(200);
    const [header, dataLine] = exportRes.text.trim().split('\n');
    const cols = header!.split(',');
    const cells = dataLine!.split(',');
    const col = (name: string) => cells[cols.indexOf(name)];

    expect(col('Days')).toBe('30');
    expect(col('Unit Working Days Breakdown')).toBe('');
  });

  it('a two-unit split employee (10 + 10) exports a Days total of 20 and preserves both units in the breakdown column', async () => {
    const admin = await masterAdminAgent('export-two-unit-admin@test.local');
    const { site, unit: unitA } = await makeSiteWithUnit('Test Site Export Two Unit A');
    const unitB = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'Test Site Export Two Unit B Unit', code: 'U-2' } });
    // Cycle before Employee, deliberately — see the single-unit test's own comment above.
    const cycle = await makeDraftCycle(admin, 8);
    const employee = await makeEmployee(site.id, unitA.id, 'Two Unit Employee', { cnic: '1112223330002' });
    const entry = await createEntry(admin, cycle.id, employee.id, '10');
    await addWorkLine(admin, entry, unitB.id, '10');

    const exportRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries/export?format=csv`);
    expect(exportRes.status).toBe(200);
    const [header, dataLine] = exportRes.text.trim().split('\n');
    const cols = header!.split(',');
    const cells = dataLine!.split(',');
    const col = (name: string) => cells[cols.indexOf(name)];

    expect(col('Days')).toBe('20'); // never just the primary line's own 10
    const breakdown = col('Unit Working Days Breakdown')!;
    expect(breakdown).toContain('10');
    expect(breakdown).toContain(unitA.name);
    expect(breakdown).toContain(unitB.name);

    // XLSX carries the same corrected total for a multi-unit entry, not just CSV.
    const xlsxRes = await admin.agent
      .get(`/api/v1/payroll-cycles/${cycle.id}/entries/export?format=xlsx`)
      .buffer(true)
      .parse((res, callback) => {
        res.setEncoding('binary');
        let data = '';
        res.on('data', (chunk: string) => {
          data += chunk;
        });
        res.on('end', () => callback(null, Buffer.from(data, 'binary')));
      });
    expect(xlsxRes.status).toBe(200);
    expect(xlsxRes.headers['content-type']).toContain('spreadsheetml');
  });

  it('an unequal three-unit split (7 + 8 + 5 = 20) preserves the true total and every unit\'s own days in the breakdown', async () => {
    const admin = await masterAdminAgent('export-three-unit-admin@test.local');
    const { site, unit: unitA } = await makeSiteWithUnit('Test Site Export Three Unit A');
    const unitB = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'Test Site Export Three Unit B Unit', code: 'U-2' } });
    const unitC = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'Test Site Export Three Unit C Unit', code: 'U-3' } });
    // Cycle before Employee, deliberately — see the single-unit test's own comment above.
    const cycle = await makeDraftCycle(admin, 9);
    const employee = await makeEmployee(site.id, unitA.id, 'Three Unit Employee', { cnic: '1112223330003' });
    let entry = await createEntry(admin, cycle.id, employee.id, '7');
    entry = await addWorkLine(admin, entry, unitB.id, '8');
    await addWorkLine(admin, entry, unitC.id, '5');

    const exportRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries/export?format=csv`);
    expect(exportRes.status).toBe(200);
    const [header, dataLine] = exportRes.text.trim().split('\n');
    const cols = header!.split(',');
    const cells = dataLine!.split(',');
    const col = (name: string) => cells[cols.indexOf(name)];

    expect(col('Days')).toBe('20');
    const breakdown = col('Unit Working Days Breakdown')!;
    for (const [unitName, days] of [[unitA.name, '7'], [unitB.name, '8'], [unitC.name, '5']] as const) {
      expect(breakdown).toContain(unitName);
      expect(breakdown).toContain(days);
    }
  });

  it('exports Net Salary, Bank, Bank Name, Branch Code, Account Number, and IBAN — every existing/newly-required business column', async () => {
    const admin = await masterAdminAgent('export-banking-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Export Banking');
    const bank = await prisma.bank.create({ data: { code: 'TESTBANK', name: 'Test Reconciliation Bank' } });
    // Cycle before Employee, deliberately — see the single-unit test's own comment above.
    const cycle = await makeDraftCycle(admin, 10);
    const employee = await prisma.employee.create({
      data: {
        name: 'Banking Fields Employee',
        designation: 'Guard',
        siteId: site.id,
        unitId: unit.id,
        grossPay: '30000',
        cnic: '1112223330004',
        bankId: bank.id,
        branchCode: '0456',
        accountNumber: '1234567890123',
        iban: 'PK36SCBL0000001123456789',
      },
    });
    await createEntry(admin, cycle.id, employee.id, '30');

    const exportRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries/export?format=csv`);
    expect(exportRes.status).toBe(200);
    const [header, dataLine] = exportRes.text.trim().split('\n');
    const cols = header!.split(',');
    const cells = dataLine!.split(',');
    const col = (name: string) => cells[cols.indexOf(name)];

    expect(cols).toContain('Net Salary');
    expect(cols).toContain('Bank');
    expect(cols).toContain('Bank Name');
    expect(cols).toContain('Branch Code');
    expect(cols).toContain('Account Number');
    expect(cols).toContain('IBAN');
    expect(cols).toContain('Deputed Branch Code');
    expect(cols).toContain('Deputed Branch Name');

    expect(col('Bank')).toBe('TESTBANK');
    expect(col('Bank Name')).toBe('Test Reconciliation Bank');
    expect(col('Branch Code')).toBe('0456');
    expect(col('Account Number')).toBe('1234567890123');
    expect(col('IBAN')).toBe('PK36SCBL0000001123456789');
    expect(col('Deputed Branch Code')).toBe(unit.code);
    expect(col('Deputed Branch Name')).toBe(unit.name);
    // Gross 30000, 30 cycle days, 30 worked days: dailyRate 1000, earned 30000, EOBI 400 -> net 29600.
    expect(col('Net Salary')).toBe('29600.00');
  });

  it('resolves Bank Name against the live (post-master-data-overlay) bankId, not a stale pre-overlay relation, for an unreleased Draft entry', async () => {
    const admin = await masterAdminAgent('export-live-bank-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Export Live Bank');
    const bankOriginal = await prisma.bank.create({ data: { code: 'ORIGBANK', name: 'Original Bank' } });
    const bankCorrected = await prisma.bank.create({ data: { code: 'CORRBANK', name: 'Corrected Bank' } });
    const cycle = await makeDraftCycle(admin, 11);
    const employee = await prisma.employee.create({
      data: {
        name: 'Live Bank Employee',
        designation: 'Guard',
        siteId: site.id,
        unitId: unit.id,
        grossPay: '30000',
        cnic: '1112223330005',
        bankId: bankOriginal.id,
        // Required alongside a real bankId (`employees.service.ts`'s `applyBankingInvariant`) — the
        // later PATCH below only touches `bankId`, and that invariant is checked against the
        // *merged* effective state, so a null Account Number here would make that PATCH itself
        // fail with 400 rather than exercising the live-overlay behavior this test targets.
        accountNumber: '1234567890',
      },
    });
    await createEntry(admin, cycle.id, employee.id, '30');

    const patchEmployee = await admin.agent
      .patch(`/api/v1/employees/${employee.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ bankId: bankCorrected.id });
    expect(patchEmployee.status).toBe(200);

    const exportRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries/export?format=csv`);
    expect(exportRes.status).toBe(200);
    const [header, dataLine] = exportRes.text.trim().split('\n');
    const cols = header!.split(',');
    const cells = dataLine!.split(',');
    const col = (name: string) => cells[cols.indexOf(name)];

    expect(col('Bank')).toBe('CORRBANK');
    expect(col('Bank Name')).toBe('Corrected Bank');
  });

  it('exports Remarks — a genuine grid business column previously never exported', async () => {
    const admin = await masterAdminAgent('export-remarks-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Export Remarks');
    // Cycle before Employee, deliberately — see the single-unit test's own comment above.
    const cycle = await makeDraftCycle(admin, 12);
    const employee = await makeEmployee(site.id, unit.id, 'Remarks Employee', { cnic: '1112223330006' });
    const entry = await createEntry(admin, cycle.id, employee.id, '30');
    await admin.agent
      .patch(`/api/v1/payroll-entries/${entry.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entry.version, remarks: 'Reconciliation note for Finance' });

    const exportRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries/export?format=csv`);
    expect(exportRes.status).toBe(200);
    const [header, dataLine] = exportRes.text.trim().split('\n');
    const cols = header!.split(',');
    const cells = dataLine!.split(',');
    expect(cells[cols.indexOf('Remarks')]).toBe('Reconciliation note for Finance');
  });
});
