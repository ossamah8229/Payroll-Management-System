import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

/**
 * Master Data Boundary — Phase 7F Checkpoint (2026-08-04), extending Phase 7D
 * (`payroll-entry-master-data-boundary.test.ts`).
 *
 * Production UAT found a real defect: editing Gross Salary in Employee Registry did not update an
 * unreleased Payroll Entry. Investigation found `grossPay`/`employeeNameSnapshot`/
 * `fatherNameSnapshot` were the three master-data fields Phase 7D's own live-overlay
 * (`withLiveMasterData`) and release-time freeze (`payroll-release.service.ts`'s
 * `liveMasterByEntryId`) missed — `designation`/`bankId`/`branchCode`/`accountNumber`/`iban` were
 * already covered. This file covers exactly those three fields, following the same pattern Phase
 * 7D's own file already established for the banking/designation fields: live Draft display with no
 * PATCH, PATCH-is-silently-ignored, and release-time freeze from the *current* Employee Registry
 * record (not whatever was stored at entry creation).
 *
 * CNIC/Employee Code are deliberately not covered here — they are not, and never have been,
 * `PayrollEntry`-owned columns at all; every read (`entry.employee.cnic`/`.employeeCode`) is
 * already a live join, both before and after this checkpoint, so there is nothing to fix or newly
 * verify for them beyond `payroll-entry-release-readiness.test.ts`'s existing coverage.
 */

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

describe('Master Data Boundary (Phase 7F, 2026-08-04) — Gross Salary / Name / Father Name join the authoritative Employee Registry set', () => {
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

  async function makeDraftCycle(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, month: number) {
    const res = await admin.agent
      .post('/api/v1/payroll-cycles')
      .set('x-csrf-token', admin.csrfToken)
      .send({ year: 2900, month });
    return res.body.cycle as { id: string };
  }

  async function getEntry(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, entryId: string) {
    const res = await admin.agent.get(`/api/v1/payroll-entries/${entryId}`);
    expect(res.status).toBe(200);
    return res.body.entry;
  }

  it('a Draft entry reflects an Employee Registry Gross Salary edit made after entry creation, with no PATCH to the entry at all', async () => {
    const admin = await masterAdminAgent('boundary-live-grosspay@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Boundary Live GrossPay');
    const cycle = await makeDraftCycle(admin, 1);
    const employee = await prisma.employee.create({
      data: { name: 'Live GrossPay Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });

    // `workLines: [{ days: '30' }]` (a full 30-day cycle, matching the schema's own default
    // `cycleDays`) — a real, non-zero worked-days line, deliberately not the schema default of
    // zero. A zero-day work line prorates any Gross Salary to a zero earned contribution
    // (`grossPay * days / cycleDays`), so net salary would be dominated entirely by the flat EOBI
    // deduction regardless of Gross Salary — masking exactly the calculation this test exists to
    // prove (a known project gotcha — the shared Playwright fixture has the same zero-days-by-
    // default trap). A full 30/30 day ratio also keeps the earned-Gross-Salary contribution exactly
    // equal to Gross Salary itself, so a Gross Salary delta below is exactly reflected in the net
    // salary delta, with no proration arithmetic for this test to duplicate.
    const created = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id, workLines: [{ days: '30' }] });
    expect(created.status).toBe(201);
    expect(Number(created.body.entry.grossPay)).toBe(30000);
    // Net salary at creation is computed off the same starting Gross Salary.
    const netBefore = Number(created.body.entry.calc.netSalary);

    // Corrected directly in Employee Registry, exactly as a real edit would (PATCH /employees/:id).
    const patchEmployee = await admin.agent
      .patch(`/api/v1/employees/${employee.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ grossPay: '45000' });
    expect(patchEmployee.status).toBe(200);

    // No PATCH to the Payroll Entry itself — just a fresh read — and it already reflects the new
    // Employee Registry Gross Salary, and its calculated net salary too (the reported production
    // defect: Draft Payroll must reflect the live value, not just display it inertly).
    const entryAfter = await getEntry(admin, created.body.entry.id);
    expect(Number(entryAfter.grossPay)).toBe(45000);
    expect(Number(entryAfter.calc.netSalary)).toBe(netBefore + 15000);

    // The list endpoint (the grid's own data source) shows the same live value.
    const list = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries`);
    expect(list.status).toBe(200);
    const listedEntry = list.body.entries.find((e: { id: string }) => e.id === created.body.entry.id);
    expect(Number(listedEntry.grossPay)).toBe(45000);

    // The database's own stored column on the entry was never touched — the live value is
    // substituted only for display/calculation while the entry is unreleased, never written back
    // (same "copied, not linked" convention Phase 7D already established for designation/banking).
    const stored = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: created.body.entry.id } });
    expect(Number(stored.grossPay)).toBe(30000);
  });

  it('a Draft entry reflects Employee Registry Name/Father Name edits made after entry creation', async () => {
    const admin = await masterAdminAgent('boundary-live-name@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Boundary Live Name');
    const cycle = await makeDraftCycle(admin, 2);
    const employee = await prisma.employee.create({
      data: {
        name: 'Original Name',
        fatherName: 'Original Father Name',
        designation: 'Guard',
        siteId: site.id,
        unitId: unit.id,
        grossPay: '30000',
      },
    });

    const created = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id });
    expect(created.body.entry.employeeNameSnapshot).toBe('Original Name');
    expect(created.body.entry.fatherNameSnapshot).toBe('Original Father Name');

    const patchEmployee = await admin.agent
      .patch(`/api/v1/employees/${employee.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ name: 'Corrected Name', fatherName: 'Corrected Father Name' });
    expect(patchEmployee.status).toBe(200);

    const entryAfter = await getEntry(admin, created.body.entry.id);
    expect(entryAfter.employeeNameSnapshot).toBe('Corrected Name');
    expect(entryAfter.fatherNameSnapshot).toBe('Corrected Father Name');

    const stored = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: created.body.entry.id } });
    expect(stored.employeeNameSnapshot).toBe('Original Name');
    expect(stored.fatherNameSnapshot).toBe('Original Father Name');
  });

  it('CNIC and Employee Code always reflect Employee Registry live — they were never independently stored on Payroll Entry', async () => {
    const admin = await masterAdminAgent('boundary-live-identity@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Boundary Live Identity');
    const cycle = await makeDraftCycle(admin, 3);
    const employee = await prisma.employee.create({
      data: {
        name: 'Identity Employee',
        designation: 'Guard',
        siteId: site.id,
        unitId: unit.id,
        grossPay: '30000',
        cnic: '3520112345671',
        employeeCode: 'EMP-100',
      },
    });

    const created = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id });

    await admin.agent
      .patch(`/api/v1/employees/${employee.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ cnic: '3520187654321', employeeCode: 'EMP-200' });

    const entryAfter = await getEntry(admin, created.body.entry.id);
    expect(entryAfter.employee.cnic).toBe('3520187654321');
    expect(entryAfter.employee.employeeCode).toBe('EMP-200');
  });

  it('a PATCH to the Payroll Entry attempting to set grossPay directly is silently ignored — Employee Registry is the sole editable source', async () => {
    const admin = await masterAdminAgent('boundary-grosspay-patch-ignored@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Boundary GrossPay PATCH');
    const cycle = await makeDraftCycle(admin, 4);
    const employee = await prisma.employee.create({
      data: { name: 'PATCH Ignored Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });

    const created = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id });

    const attempted = await admin.agent
      .patch(`/api/v1/payroll-entries/${created.body.entry.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: created.body.entry.version, grossPay: '999999', allowance: '1500' });
    expect(attempted.status).toBe(200);
    // The one legitimate field in the same request still applies — only grossPay is stripped.
    expect(Number(attempted.body.entry.allowance)).toBe(1500);
    expect(Number(attempted.body.entry.grossPay)).toBe(30000);

    const persisted = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: created.body.entry.id } });
    expect(Number(persisted.grossPay)).toBe(30000);
  });

  it('Release freezes Gross Salary / Name / Father Name from the *current* Employee Registry record, not whatever the entry was created with', async () => {
    const admin = await masterAdminAgent('boundary-grosspay-release-freeze@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Boundary GrossPay Release Freeze');
    const cycle = await makeDraftCycle(admin, 5);
    const employee = await prisma.employee.create({
      data: {
        name: 'Original At Creation',
        fatherName: 'Father At Creation',
        designation: 'Guard',
        siteId: site.id,
        unitId: unit.id,
        grossPay: '30000',
      },
    });

    // Full 30/30 worked days — a positive net salary, so this entry actually releases as PAID
    // rather than the zero-days default's RECOVERY_DUE (see the "live Gross Salary" test above for
    // why a zero-day work line would defeat this test's own purpose).
    const created = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id, workLines: [{ days: '30' }] });
    const entryId = created.body.entry.id as string;

    // A raise and a name correction both land in Employee Registry before release — the exact
    // "weeks pass between entry creation and release" scenario the reported defect covers.
    await admin.agent
      .patch(`/api/v1/employees/${employee.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ grossPay: '50000', name: 'Corrected Before Release', fatherName: 'Father Corrected Before Release' });

    const unitStatus = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/units?siteId=${site.id}`);
    expect(unitStatus.status).toBe(200);

    const release = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${unit.id}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(release.status).toBe(201);
    expect(release.body.releasedEntryCount).toBe(1);

    const released = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entryId } });
    expect(released.released).toBe(true);
    // The frozen snapshot reflects Employee Registry's value *at release*, not at entry creation.
    expect(Number(released.grossPay)).toBe(50000);
    expect(released.employeeNameSnapshot).toBe('Corrected Before Release');
    expect(released.fatherNameSnapshot).toBe('Father Corrected Before Release');

    // A further Employee Registry edit after release must never reach this now-locked entry.
    await admin.agent
      .patch(`/api/v1/employees/${employee.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ grossPay: '99999', name: 'Renamed After Release' });

    const entryAfter = await getEntry(admin, entryId);
    expect(Number(entryAfter.grossPay)).toBe(50000);
    expect(entryAfter.employeeNameSnapshot).toBe('Corrected Before Release');

    const stillFrozen = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entryId } });
    expect(Number(stillFrozen.grossPay)).toBe(50000);
    expect(stillFrozen.employeeNameSnapshot).toBe('Corrected Before Release');
  });

  it('a released entry never reflects a later Employee Registry Gross Salary edit — the live overlay only applies while unreleased', async () => {
    const admin = await masterAdminAgent('boundary-grosspay-released-frozen@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Boundary GrossPay Released Frozen');
    const cycle = await makeDraftCycle(admin, 6);
    const employee = await prisma.employee.create({
      data: { name: 'Released Frozen Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });

    const created = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id });

    // Directly marked released (bypassing the release sweep) to isolate exactly the read-time
    // overlay guard under test, matching Phase 7D's own equivalent test for designation.
    await prisma.payrollEntry.update({
      where: { id: created.body.entry.id },
      data: { released: true, releasedAt: new Date(), releasedBy: admin.userId },
    });

    await prisma.employee.update({ where: { id: employee.id }, data: { grossPay: '80000' } });

    const entryAfter = await getEntry(admin, created.body.entry.id);
    expect(Number(entryAfter.grossPay)).toBe(30000);
  });
});
