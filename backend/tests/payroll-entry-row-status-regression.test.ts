import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

/**
 * Phase 7 Reports, Deduction Report Checkpoint 1A — targeted review hardening pass (M4); extended by
 * Salary Release Report Checkpoint 1A's own independent review to add that report as a fourth
 * consumer — an explicit, end-to-end regression proof for the third/fourth-consumer extraction of
 * `derivePayrollEntryRowStatus`/`payrollEntryRowStatusWhereClause` out of Employee Payroll
 * History's own module into the neutral `payroll-entry-row-status.ts`
 * (`backend/src/modules/reports/payroll-entry-row-status.ts`).
 *
 * `payroll-entry-row-status.test.ts` already proves the extracted *function* itself is
 * behavior-preserving in isolation. Each report's own test suite (`employee-payroll-history.test.ts`
 * "Row status", `project-site-payroll-report.test.ts` "Row status derivation",
 * `deduction-report.test.ts` "Row status", `salary-release-report.test.ts` "Row status derivation")
 * already proves each report *individually* derives the correct status for its own fixtures. What
 * none of those prove — and what this file adds — is that all four real HTTP endpoints, for the exact
 * same underlying `PayrollEntry` rows, agree with each other. That cross-consumer identity is the one
 * property a per-report literal-expectation test cannot catch: if the extraction had left one
 * consumer still importing a stale/duplicated derivation (or had introduced a subtle per-report
 * `select`/mapping divergence upstream of the shared function), each report's own suite would still
 * pass — only a same-fixture, same-status, cross-report comparison surfaces that class of regression.
 * This is observable-behavior evidence (real API responses), not merely proof the shared module
 * exists or is imported.
 */
describe('Phase 7 Reports — row status extraction — cross-consumer regression proof (M4)', () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  const PASSWORD = 'CorrectHorseBattery1!';
  const app = createApp();

  async function reportsAdminAgent(email: string) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.MASTER_ADMIN,
      permissionKeys: [
        PERMISSIONS.PAYROLL_CYCLE_MANAGE,
        PERMISSIONS.PAYROLL_ENTRY,
        PERMISSIONS.PAYROLL_RELEASE,
        PERMISSIONS.CORRECTIONS_APPROVE,
        PERMISSIONS.STATEMENTS_VIEW,
        PERMISSIONS.REPORTS_VIEW,
      ],
    });
  }

  async function makeSiteWithUnit(name: string) {
    const site = await prisma.projectSite.create({ data: { name } });
    const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} Unit`, code: 'U-1' } });
    return { site, unit };
  }

  async function makeEmployee(siteId: string, unitId: string, name: string) {
    return prisma.employee.create({ data: { name, designation: 'Guard', siteId, unitId, grossPay: '30000' } });
  }

  let cycleCounter = 0;
  async function makeCycle(createdBy: string) {
    cycleCounter += 1;
    return prisma.payrollCycle.create({ data: { year: 2960, month: cycleCounter, createdBy, status: 'DRAFT' } });
  }

  interface EntryOverrides {
    hold?: boolean;
    released?: boolean;
    releasedAt?: Date;
    releasedBy?: string;
    payoutOutcome?: 'NO_PAY_DUE' | 'RECOVERY_DUE';
  }

  async function makeEntry(cycleId: string, employeeId: string, siteId: string, unitId: string, overrides: EntryOverrides = {}) {
    return prisma.payrollEntry.create({
      data: {
        cycleId,
        employeeId,
        siteId,
        designation: 'Guard',
        grossPay: '30000',
        allowance: '0',
        leaveDays: '0',
        eobiAmount: '400',
        eobiApplicable: true,
        advanceDeduction: '0',
        eidAdvanceDeduction: '0',
        fine: '0',
        correctionBalancePayable: '0',
        correctionBalanceRecovery: '0',
        hold: overrides.hold ?? false,
        released: overrides.released ?? false,
        releasedAt: overrides.releasedAt ?? null,
        releasedBy: overrides.releasedBy ?? null,
        payoutOutcome: overrides.payoutOutcome ?? null,
        workLines: { create: [{ siteId, unitId, days: '26', otHours: '0', otRate: null, cycleDays: 30 }] },
      },
    });
  }

  it('Employee Payroll History, Project Site Payroll Report, Deduction Report, and Salary Release Report all derive the identical rowStatus for the same PayrollEntry rows, across all five statuses', async () => {
    const admin = await reportsAdminAgent('rowstatus-regression-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Row Status Regression');
    const cycle = await makeCycle(admin.userId);

    const fixtures: Array<{ status: string; employeeName: string; overrides: EntryOverrides }> = [
      { status: 'RELEASED', employeeName: 'Regression Released', overrides: { released: true, releasedAt: new Date(), releasedBy: admin.userId } },
      { status: 'HELD', employeeName: 'Regression Held', overrides: { hold: true } },
      { status: 'NO_PAY_DUE', employeeName: 'Regression No Pay Due', overrides: { payoutOutcome: 'NO_PAY_DUE' } },
      { status: 'RECOVERY_DUE', employeeName: 'Regression Recovery Due', overrides: { payoutOutcome: 'RECOVERY_DUE' } },
      { status: 'PENDING', employeeName: 'Regression Pending', overrides: {} },
    ];

    const employeesByStatus = new Map<string, { employeeId: string }>();
    for (const fixture of fixtures) {
      const employee = await makeEmployee(site.id, unit.id, fixture.employeeName);
      await makeEntry(cycle.id, employee.id, site.id, unit.id, fixture.overrides);
      employeesByStatus.set(fixture.status, { employeeId: employee.id });
    }

    // Project Site Payroll Report and Deduction Report are both single-cycle, one list call each
    // returns every fixture row.
    const pspRes = await admin.agent.get(`/api/v1/reports/project-site-payroll?cycleId=${cycle.id}&pageSize=10`);
    expect(pspRes.status).toBe(200);
    const drRes = await admin.agent.get(`/api/v1/reports/deduction-report?cycleId=${cycle.id}&pageSize=10`);
    expect(drRes.status).toBe(200);
    const srrRes = await admin.agent.get(`/api/v1/reports/salary-release?cycleId=${cycle.id}&pageSize=10`);
    expect(srrRes.status).toBe(200);

    const pspStatusByEmployee = new Map(pspRes.body.rows.map((r: { employeeId: string; rowStatus: string }) => [r.employeeId, r.rowStatus]));
    const drStatusByEmployee = new Map(drRes.body.rows.map((r: { employeeId: string; rowStatus: string }) => [r.employeeId, r.rowStatus]));
    const srrStatusByEmployee = new Map(srrRes.body.rows.map((r: { employeeId: string; rowStatus: string }) => [r.employeeId, r.rowStatus]));

    for (const fixture of fixtures) {
      const { employeeId } = employeesByStatus.get(fixture.status)!;

      // Employee Payroll History is cross-cycle/employee-scoped (no cycleId parameter) — queried
      // per employee, one call each.
      const ephRes = await admin.agent.get(`/api/v1/reports/employee-payroll-history?employeeId=${employeeId}`);
      expect(ephRes.status).toBe(200);
      const ephRow = ephRes.body.rows.find((r: { employeeId: string }) => r.employeeId === employeeId);

      expect(ephRow.rowStatus).toBe(fixture.status);
      expect(pspStatusByEmployee.get(employeeId)).toBe(fixture.status);
      expect(drStatusByEmployee.get(employeeId)).toBe(fixture.status);
      expect(srrStatusByEmployee.get(employeeId)).toBe(fixture.status);

      // The actual cross-consumer identity check, not just each report matching its own expected
      // literal independently.
      expect(ephRow.rowStatus).toBe(pspStatusByEmployee.get(employeeId));
      expect(pspStatusByEmployee.get(employeeId)).toBe(drStatusByEmployee.get(employeeId));
      expect(drStatusByEmployee.get(employeeId)).toBe(srrStatusByEmployee.get(employeeId));
    }
  });

  it('a genuine Unit release (the real release endpoint, not a directly-set field) is observed identically by all four reports', async () => {
    const admin = await reportsAdminAgent('rowstatus-regression-release-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Row Status Regression Release');
    const cycle = await makeCycle(admin.userId);
    const employee = await makeEmployee(site.id, unit.id, 'Regression Real Release');
    await makeEntry(cycle.id, employee.id, site.id, unit.id, {});

    const releaseRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${unit.id}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(releaseRes.status).toBe(201);

    const pspRes = await admin.agent.get(`/api/v1/reports/project-site-payroll?cycleId=${cycle.id}&pageSize=10`);
    const drRes = await admin.agent.get(`/api/v1/reports/deduction-report?cycleId=${cycle.id}&pageSize=10`);
    const ephRes = await admin.agent.get(`/api/v1/reports/employee-payroll-history?employeeId=${employee.id}`);
    const srrRes = await admin.agent.get(`/api/v1/reports/salary-release?cycleId=${cycle.id}&pageSize=10`);

    expect(pspRes.body.rows[0].rowStatus).toBe('RELEASED');
    expect(drRes.body.rows[0].rowStatus).toBe('RELEASED');
    expect(ephRes.body.rows[0].rowStatus).toBe('RELEASED');
    expect(srrRes.body.rows[0].rowStatus).toBe('RELEASED');
  });
});
