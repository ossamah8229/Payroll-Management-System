import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

/**
 * Master Data Boundary — Phase 7D Checkpoint (2026-07-30).
 *
 * Employee Registry is the sole authoritative, editable source for employee identity/banking
 * data; Payroll Entry must display it (never independently edit it) and, while an entry is still
 * unreleased (`released = false` and not otherwise resolved via `payoutOutcome`), must reflect
 * whatever Employee Registry currently says after a refresh — never a stale, entry-owned
 * duplicate. Release (see `payroll-release.test.ts`'s own coverage) is the one moment that copy
 * gets frozen permanently.
 *
 * This file covers the *display/read* half of that contract — a Draft entry picking up a live
 * Employee Registry edit with no PATCH and no new cycle involved — plus confirming EOBI
 * applicability (a deliberate, permanent exception) and ordinary financial fields remain exactly
 * as Draft-editable as before. `payroll-entry.test.ts` covers the PATCH-is-ignored half;
 * `payroll-release.test.ts` covers the release-time freeze.
 */

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

describe('Master Data Boundary — Employee Registry as the authoritative source for Draft Payroll Entry', () => {
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
      permissionKeys: [PERMISSIONS.PAYROLL_CYCLE_MANAGE, PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.EMPLOYEES_EDIT],
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

  it('a Draft entry reflects an Employee Registry bank/account/IBAN edit made after entry creation, with no PATCH to the entry at all', async () => {
    const admin = await masterAdminAgent('boundary-live-banking@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Boundary Live Banking');
    const cycle = await makeDraftCycle(admin, 1);
    const bankOld = await prisma.bank.create({ data: { code: 'TBOLD', name: 'Test Bank Old' } });
    const bankNew = await prisma.bank.create({ data: { code: 'TBNEW', name: 'Test Bank New' } });
    const employee = await prisma.employee.create({
      data: {
        name: 'Live Banking Employee',
        designation: 'Guard',
        siteId: site.id,
        unitId: unit.id,
        grossPay: '30000',
        bankId: bankOld.id,
        accountNumber: '1000000000',
      },
    });

    const created = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id });
    expect(created.status).toBe(201);
    expect(created.body.entry.bankId).toBe(bankOld.id);
    expect(created.body.entry.accountNumber).toBe('1000000000');

    // Corrected directly in Employee Registry — the API a real Employee Registry edit goes
    // through, not a direct DB write, so this exercises the exact same code path a user's edit
    // would (employees.service.ts's updateEmployee, driven by the PATCH /employees/:id route).
    const patchEmployee = await admin.agent
      .patch(`/api/v1/employees/${employee.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ bankId: bankNew.id, accountNumber: '2000000000', iban: 'PK36SCBL0000009999999999' });
    expect(patchEmployee.status).toBe(200);

    // No PATCH to the Payroll Entry itself — just a fresh read — and it already reflects the new
    // Employee Registry values.
    const entryAfter = await getEntry(admin, created.body.entry.id);
    expect(entryAfter.bankId).toBe(bankNew.id);
    expect(entryAfter.accountNumber).toBe('2000000000');
    expect(entryAfter.iban).toBe('PK36SCBL0000009999999999');

    // The list endpoint (the grid's own data source) shows the same live value.
    const list = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries`);
    expect(list.status).toBe(200);
    const listedEntry = list.body.entries.find((e: { id: string }) => e.id === created.body.entry.id);
    expect(listedEntry.bankId).toBe(bankNew.id);
    expect(listedEntry.accountNumber).toBe('2000000000');

    // The database's own stored column on the entry was never touched — the live value is
    // substituted only for display while the entry is unreleased, never written back.
    const stored = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: created.body.entry.id } });
    expect(stored.bankId).toBe(bankOld.id);
    expect(stored.accountNumber).toBe('1000000000');
  });

  it('a Draft entry reflects an Employee Registry designation edit made after entry creation', async () => {
    const admin = await masterAdminAgent('boundary-live-designation@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Boundary Live Designation');
    const cycle = await makeDraftCycle(admin, 2);
    const employee = await prisma.employee.create({
      data: { name: 'Live Designation Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });

    const created = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id });
    expect(created.body.entry.designation).toBe('Guard');

    const patchEmployee = await admin.agent
      .patch(`/api/v1/employees/${employee.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ designation: 'Shift Supervisor' });
    expect(patchEmployee.status).toBe(200);

    const entryAfter = await getEntry(admin, created.body.entry.id);
    expect(entryAfter.designation).toBe('Shift Supervisor');
  });

  it('EOBI applicability stays a Payroll Entry toggle — editable via PATCH (not read-only, not moved to Employee Registry only)', async () => {
    const admin = await masterAdminAgent('boundary-eobi-toggle@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Boundary EOBI');
    const cycle = await makeDraftCycle(admin, 3);
    const employee = await prisma.employee.create({
      data: {
        name: 'EOBI Toggle Employee',
        designation: 'Guard',
        siteId: site.id,
        unitId: unit.id,
        grossPay: '30000',
        defaultEobiApplicable: true,
        defaultEobiAmount: '400.00',
      },
    });

    const created = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id });
    expect(created.body.entry.eobiApplicable).toBe(true);
    expect(Number(created.body.entry.eobiAmount)).toBe(400);

    // Toggled off for this one payroll cycle — still an ordinary Payroll Entry PATCH, never
    // read-only and never relocated exclusively to Employee Registry. `eobiAmount` (the deduction
    // figure) stays entirely Payroll-Entry-owned and untouched by synchronisation; only
    // `eobiApplicable` participates.
    const toggled = await admin.agent
      .patch(`/api/v1/payroll-entries/${created.body.entry.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: created.body.entry.version, eobiApplicable: false, eobiAmount: '0.00' });
    expect(toggled.status).toBe(200);
    expect(toggled.body.entry.eobiApplicable).toBe(false);
    expect(Number(toggled.body.entry.eobiAmount)).toBe(0);

    // Phase 7D refinement (2026-07-30) — EOBI Bidirectional Synchronisation supersedes this
    // checkpoint's original "independent" design: Employee Registry is the source of truth for
    // applicability, and the client requires both locations to agree, so the entry's own toggle
    // now also writes back to Employee Registry (`eobi-sync.service.ts`); full coverage of both
    // sync directions, permission boundaries, and historical-cycle immunity lives in
    // `eobi-bidirectional-sync.test.ts`. This assertion is updated accordingly, not merely relaxed.
    const employeeAfter = await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } });
    expect(employeeAfter.defaultEobiApplicable).toBe(false);

    const entryAfter = await getEntry(admin, created.body.entry.id);
    expect(entryAfter.eobiApplicable).toBe(false);
  });

  it('ordinary payroll-cycle financial fields remain fully Draft-editable — this checkpoint only removes identity/banking fields, nothing else', async () => {
    const admin = await masterAdminAgent('boundary-financial-fields@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Boundary Financial');
    const cycle = await makeDraftCycle(admin, 4);
    const employee = await prisma.employee.create({
      data: { name: 'Financial Fields Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });

    const created = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id });

    const updated = await admin.agent
      .patch(`/api/v1/payroll-entries/${created.body.entry.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({
        version: created.body.entry.version,
        grossPay: '35000',
        allowance: '2000',
        leaveDays: '1',
        leaveRate: '1000',
        advanceDeduction: '500',
        eidAdvanceDeduction: '250',
        fine: '100',
        hold: false,
        remarks: 'Adjusted for overtime coverage',
      });
    expect(updated.status).toBe(200);
    expect(Number(updated.body.entry.grossPay)).toBe(35000);
    expect(Number(updated.body.entry.allowance)).toBe(2000);
    expect(Number(updated.body.entry.leaveDays)).toBe(1);
    expect(Number(updated.body.entry.leaveRate)).toBe(1000);
    expect(Number(updated.body.entry.advanceDeduction)).toBe(500);
    expect(Number(updated.body.entry.eidAdvanceDeduction)).toBe(250);
    expect(Number(updated.body.entry.fine)).toBe(100);
    expect(updated.body.entry.remarks).toBe('Adjusted for overtime coverage');
  });

  it('a released entry never reflects a later Employee Registry designation/bank edit — the display override only applies while unreleased', async () => {
    const admin = await masterAdminAgent('boundary-released-frozen@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Boundary Released Frozen');
    const cycle = await makeDraftCycle(admin, 5);
    const employee = await prisma.employee.create({
      data: { name: 'Released Frozen Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });

    const created = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id });

    await prisma.payrollEntry.update({
      where: { id: created.body.entry.id },
      data: { released: true, releasedAt: new Date(), releasedBy: admin.userId },
    });

    await prisma.employee.update({ where: { id: employee.id }, data: { designation: 'Renamed After Release' } });

    const entryAfter = await getEntry(admin, created.body.entry.id);
    expect(entryAfter.designation).toBe('Guard');
  });
});
