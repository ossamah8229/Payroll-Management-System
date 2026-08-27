import request from 'supertest';
import ExcelJS from 'exceljs';
import { parse as parseCsvSync } from 'csv-parse/sync';
import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent, assertNoSensitiveKeys } from './helpers';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

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

const EXPECTED_EXPORT_HEADERS = [
  'Employee Code',
  'Employee Name',
  'Project Site',
  'Advance Type',
  'Status',
  'Repayment Type',
  'Date Given',
  'Original Amount',
  'Recovered To Date',
  'Current Outstanding Balance',
  'Recovered This Cycle',
];

/** Substrings that must never appear anywhere in this report's JSON/CSV/XLSX output, on top of
 * `assertNoSensitiveKeys`'s own defaults — CNIC, every banking field, audit-actor identity, and
 * any Correction/BalanceAdjustment field (frozen decisions — Columns/Export sections). */
const EXPORT_FORBIDDEN_KEYS = [
  'cnic',
  'accountnumber',
  'iban',
  'bank',
  'branchcode',
  'correctionbalancerecovery',
  'correctionbalancepayable',
  'remainingamount',
  'changedbypasswordhash',
];

/**
 * Phase 7 Reports, Advance Recovery Report Checkpoint 1A (approved Checkpoint 0 architecture
 * review). Every fixture is created directly via Prisma — this suite is about the report's own
 * aggregation/authorization/scoping/filtering correctness, not Advance's/Payroll Entry's own
 * creation workflow (mirroring every sibling report's own established test convention).
 */
describe('Phase 7 Reports — Advance Recovery Report (Checkpoint 1A)', () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  // --- Agents --------------------------------------------------------------------------------

  async function masterAdminAgent(email: string) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.MASTER_ADMIN,
      permissionKeys: [PERMISSIONS.REPORTS_VIEW],
    });
  }

  async function reportsViewerAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_ARR_REPORTS_VIEWER',
      permissionKeys: [PERMISSIONS.REPORTS_VIEW],
      siteIds,
    });
  }

  /** Holds `statements:view` but deliberately NOT `reports:view` — proves this report is gated by
   * the latter, not the former (frozen decision §4). */
  async function statementsOnlyAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_ARR_STATEMENTS_ONLY',
      permissionKeys: [PERMISSIONS.STATEMENTS_VIEW],
      siteIds,
    });
  }

  async function noPermissionAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_ARR_NO_PERM',
      permissionKeys: [PERMISSIONS.ADVANCES_MANAGE],
      siteIds,
    });
  }

  // --- Fixtures --------------------------------------------------------------------------------

  let cycleCounter = 0;
  function nextCycleYearMonth(): { year: number; month: number } {
    cycleCounter += 1;
    return { year: 2900 + Math.floor(cycleCounter / 12), month: (cycleCounter % 12) + 1 };
  }

  async function makeSiteWithUnit(name: string) {
    const site = await prisma.projectSite.create({ data: { name } });
    const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} Unit`, code: 'U-1' } });
    return { site, unit };
  }

  async function makeEmployee(siteId: string, unitId: string, name: string, extra: Record<string, unknown> = {}) {
    return prisma.employee.create({
      data: { name, employeeCode: extra.employeeCode as string | undefined, designation: 'Guard', siteId, unitId, grossPay: '30000', ...extra },
    });
  }

  async function makeCycle(createdBy: string, status: 'DRAFT' | 'RELEASED' | 'ARCHIVED' = 'DRAFT') {
    const { year, month } = nextCycleYearMonth();
    return prisma.payrollCycle.create({ data: { year, month, createdBy, status } });
  }

  interface AdvanceOverrides {
    totalAmount?: string;
    outstandingBalance?: string;
    status?: 'ACTIVE' | 'RESERVED' | 'PAID_OFF' | 'CANCELLED';
    repaymentType?: 'FULL_DEDUCTION' | 'INSTALLMENT';
    dateGiven?: Date;
    scheduledInstallmentAmount?: string;
    paidOffAt?: Date;
  }

  async function makeAdvance(employeeId: string, type: 'LOAN' | 'EID_ADVANCE', overrides: AdvanceOverrides = {}) {
    const totalAmount = overrides.totalAmount ?? '10000';
    return prisma.advance.create({
      data: {
        employeeId,
        type,
        totalAmount,
        outstandingBalance: overrides.outstandingBalance ?? totalAmount,
        dateGiven: overrides.dateGiven ?? new Date('2026-01-01'),
        repaymentType: overrides.repaymentType ?? 'FULL_DEDUCTION',
        status: overrides.status ?? 'ACTIVE',
        scheduledInstallmentAmount: overrides.scheduledInstallmentAmount ?? null,
        paidOffAt: overrides.paidOffAt ?? null,
      },
    });
  }

  interface EntryOverrides {
    advanceId?: string;
    advanceDeduction?: string;
    eidAdvanceId?: string;
    eidAdvanceDeduction?: string;
    released?: boolean;
    releasedAt?: Date;
    releasedBy?: string;
    hold?: boolean;
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
        advanceDeduction: overrides.advanceDeduction ?? '0',
        advanceId: overrides.advanceId ?? null,
        eidAdvanceDeduction: overrides.eidAdvanceDeduction ?? '0',
        eidAdvanceId: overrides.eidAdvanceId ?? null,
        fine: '0',
        correctionBalancePayable: '0',
        correctionBalanceRecovery: '0',
        hold: overrides.hold ?? false,
        released: overrides.released ?? false,
        releasedAt: overrides.releasedAt ?? null,
        releasedBy: overrides.releasedBy ?? null,
        workLines: { create: [{ siteId, unitId, days: '26', otHours: '0', otRate: null, cycleDays: 30 }] },
      },
    });
  }

  async function makeScheduledPeriod(year: number, month: number) {
    return prisma.scheduledPayrollPeriod.upsert({
      where: { year_month: { year, month } },
      update: {},
      create: { year, month },
    });
  }

  async function makeScheduleChange(
    advanceId: string,
    payrollEntryId: string,
    fromPeriodId: string,
    toPeriodId: string,
    changedById: string,
    reason = 'Employee requested deferral',
  ) {
    return prisma.advanceScheduleChange.create({
      data: { advanceId, payrollEntryId, fromPeriodId, toPeriodId, reason, changedById },
    });
  }

  function listUrl(params: Record<string, string> = {}) {
    return `/api/v1/reports/advance-recovery?${new URLSearchParams(params).toString()}`;
  }
  function exportUrl(format: 'csv' | 'xlsx', params: Record<string, string> = {}) {
    return `/api/v1/reports/advance-recovery/export?${new URLSearchParams({ format, ...params }).toString()}`;
  }

  // ================================================================================================
  // Authorization
  // ================================================================================================

  describe('Authorization', () => {
    it('rejects a request with no session with 401', async () => {
      const res = await request(app).get('/api/v1/reports/advance-recovery');
      expect(res.status).toBe(401);
    });

    it('rejects a user lacking reports:view with 403', async () => {
      const { site } = await makeSiteWithUnit('Test Site ARR Auth 1');
      const noPerm = await noPermissionAgent('arr-auth-noperm@test.local', [site.id]);
      const res = await noPerm.agent.get(listUrl());
      expect(res.status).toBe(403);
    });

    it('a user with statements:view but not reports:view is denied', async () => {
      const { site } = await makeSiteWithUnit('Test Site ARR Auth 2');
      const statementsOnly = await statementsOnlyAgent('arr-auth-statements@test.local', [site.id]);
      const res = await statementsOnly.agent.get(listUrl());
      expect(res.status).toBe(403);
    });

    it('Master Admin (global authority) sees Advances with no site restriction', async () => {
      const admin = await masterAdminAgent('arr-auth-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Auth 3');
      const employee = await makeEmployee(site.id, unit.id, 'Auth Employee 3');
      await makeAdvance(employee.id, 'LOAN');

      const res = await admin.agent.get(listUrl());
      expect(res.status).toBe(200);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
    });

    it('a site-scoped reports:view user only sees Advances for employees currently at their accessible sites', async () => {
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site ARR Auth Scope A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site ARR Auth Scope B');
      const empA = await makeEmployee(siteA.id, unitA.id, 'Scope Employee A');
      const empB = await makeEmployee(siteB.id, unitB.id, 'Scope Employee B');
      await makeAdvance(empA.id, 'LOAN');
      await makeAdvance(empB.id, 'LOAN');

      const viewer = await reportsViewerAgent('arr-auth-scope@test.local', [siteA.id]);
      const res = await viewer.agent.get(listUrl());
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.rows[0].employeeId).toBe(empA.id);
    });

    it('an explicit siteIds filter naming an inaccessible site is rejected with 403, never silently narrowed', async () => {
      const { site: siteA } = await makeSiteWithUnit('Test Site ARR Auth Explicit A');
      const { site: siteB } = await makeSiteWithUnit('Test Site ARR Auth Explicit B');
      const viewer = await reportsViewerAgent('arr-auth-explicit@test.local', [siteA.id]);
      const res = await viewer.agent.get(listUrl({ siteIds: siteB.id }));
      expect(res.status).toBe(403);
    });

    it('transferred employee: authorization follows CURRENT Employee.siteId, never the site the Advance originated at (frozen V1 limitation)', async () => {
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site ARR Transfer A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site ARR Transfer B');
      const employee = await makeEmployee(siteA.id, unitA.id, 'Transfer Employee');
      const advance = await makeAdvance(employee.id, 'LOAN');

      const viewerA = await reportsViewerAgent('arr-transfer-a@test.local', [siteA.id]);
      const viewerB = await reportsViewerAgent('arr-transfer-b@test.local', [siteB.id]);

      // Before transfer: Site A can see it, Site B cannot.
      const beforeA = await viewerA.agent.get(listUrl());
      expect(beforeA.body.total).toBe(1);
      const beforeB = await viewerB.agent.get(listUrl());
      expect(beforeB.body.total).toBe(0);

      // Simulate the employee transferring to Site B (direct current-site update, per the
      // frozen decision — Advance has no historical siteId to react to; only Employee.siteId
      // drives this report's authorization).
      await prisma.employee.update({ where: { id: employee.id }, data: { siteId: siteB.id, unitId: unitB.id } });

      const afterA = await viewerA.agent.get(listUrl());
      expect(afterA.body.total).toBe(0);
      const afterB = await viewerB.agent.get(listUrl());
      expect(afterB.body.total).toBe(1);
      expect(afterB.body.rows[0].advanceId).toBe(advance.id);
    });

    it('detail endpoint follows the same current-site rule, with a 403 (not 404) for an inaccessible Advance — mirroring advances.service.ts getAdvance', async () => {
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site ARR Detail Auth A');
      const { site: siteB } = await makeSiteWithUnit('Test Site ARR Detail Auth B');
      const employee = await makeEmployee(siteA.id, unitA.id, 'Detail Auth Employee');
      const advance = await makeAdvance(employee.id, 'LOAN');

      const viewerA = await reportsViewerAgent('arr-detail-auth-a@test.local', [siteA.id]);
      const viewerB = await reportsViewerAgent('arr-detail-auth-b@test.local', [siteB.id]);

      const okRes = await viewerA.agent.get(`/api/v1/reports/advance-recovery/${advance.id}`);
      expect(okRes.status).toBe(200);
      expect(okRes.body.advanceId).toBe(advance.id);

      const deniedRes = await viewerB.agent.get(`/api/v1/reports/advance-recovery/${advance.id}`);
      expect(deniedRes.status).toBe(403);
    });

    it('detail endpoint for a nonexistent Advance returns 404', async () => {
      const admin = await masterAdminAgent('arr-detail-404@test.local');
      const res = await admin.agent.get('/api/v1/reports/advance-recovery/00000000-0000-0000-0000-000000000000');
      expect(res.status).toBe(404);
    });

    it('detail endpoint rejects a malformed advanceId with 400, never passed through to Prisma', async () => {
      const admin = await masterAdminAgent('arr-detail-malformed@test.local');
      const res = await admin.agent.get('/api/v1/reports/advance-recovery/not-a-uuid');
      expect(res.status).toBe(400);
    });

    it('detail endpoint: a live transfer moves access exactly like the list endpoint — Site A loses it (403), Site B gains it (200)', async () => {
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site ARR Detail Transfer A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site ARR Detail Transfer B');
      const employee = await makeEmployee(siteA.id, unitA.id, 'Detail Transfer Employee');
      const advance = await makeAdvance(employee.id, 'LOAN');

      const viewerA = await reportsViewerAgent('arr-detail-transfer-a@test.local', [siteA.id]);
      const viewerB = await reportsViewerAgent('arr-detail-transfer-b@test.local', [siteB.id]);

      const beforeA = await viewerA.agent.get(`/api/v1/reports/advance-recovery/${advance.id}`);
      expect(beforeA.status).toBe(200);
      const beforeB = await viewerB.agent.get(`/api/v1/reports/advance-recovery/${advance.id}`);
      expect(beforeB.status).toBe(403);

      await prisma.employee.update({ where: { id: employee.id }, data: { siteId: siteB.id, unitId: unitB.id } });

      const afterA = await viewerA.agent.get(`/api/v1/reports/advance-recovery/${advance.id}`);
      expect(afterA.status).toBe(403);
      const afterB = await viewerB.agent.get(`/api/v1/reports/advance-recovery/${advance.id}`);
      expect(afterB.status).toBe(200);
      expect(afterB.body.advanceId).toBe(advance.id);
    });
  });

  // ================================================================================================
  // Contracts
  // ================================================================================================

  describe('Contracts', () => {
    it('cycleId is optional — omitting it succeeds with cycle: null', async () => {
      const admin = await masterAdminAgent('arr-contract-nocycle@test.local');
      const res = await admin.agent.get(listUrl());
      expect(res.status).toBe(200);
      expect(res.body.cycle).toBeNull();
    });

    it('rejects a nonexistent cycleId with 404', async () => {
      const admin = await masterAdminAgent('arr-contract-badcycle@test.local');
      const res = await admin.agent.get(listUrl({ cycleId: '00000000-0000-0000-0000-000000000000' }));
      expect(res.status).toBe(404);
    });

    it('rejects a malformed siteIds UUID with 400', async () => {
      const admin = await masterAdminAgent('arr-contract-badsite@test.local');
      const res = await admin.agent.get(listUrl({ siteIds: 'not-a-uuid' }));
      expect(res.status).toBe(400);
    });

    it('rejects an out-of-range pageSize with 400, never silently clamped', async () => {
      const admin = await masterAdminAgent('arr-contract-badpagesize@test.local');
      const res = await admin.agent.get(listUrl({ pageSize: '1000' }));
      expect(res.status).toBe(400);
    });

    it('rejects an invalid sortBy value', async () => {
      const admin = await masterAdminAgent('arr-contract-badsort@test.local');
      const res = await admin.agent.get(listUrl({ sortBy: 'recoveredThisCycle' }));
      expect(res.status).toBe(400);
    });

    it('default sort is employeeName ascending', async () => {
      const admin = await masterAdminAgent('arr-contract-defaultsort@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Contract Sort');
      const empB = await makeEmployee(site.id, unit.id, 'B Employee');
      const empA = await makeEmployee(site.id, unit.id, 'A Employee');
      await makeAdvance(empB.id, 'LOAN');
      await makeAdvance(empA.id, 'LOAN');

      const res = await admin.agent.get(listUrl());
      expect(res.body.rows.map((r: { employeeName: string }) => r.employeeName)).toEqual(['A Employee', 'B Employee']);
    });

    it('export accepts no page/pageSize — always the complete filtered result', async () => {
      const admin = await masterAdminAgent('arr-contract-exportnopage@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Contract Export');
      const employee = await makeEmployee(site.id, unit.id, 'Export Contract Employee');
      await makeAdvance(employee.id, 'LOAN');

      const res = await admin.agent.get(exportUrl('csv', { page: '1', pageSize: '1' }));
      expect(res.status).toBe(200);
      const lines = res.text.trim().split('\n');
      expect(lines.length).toBe(2); // header + 1 row (page/pageSize are silently inert on export)
    });
  });

  // ================================================================================================
  // Grain
  // ================================================================================================

  describe('Report grain', () => {
    it('one row per Advance', async () => {
      const admin = await masterAdminAgent('arr-grain-basic@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Grain Basic');
      const employee = await makeEmployee(site.id, unit.id, 'Grain Employee');
      await makeAdvance(employee.id, 'LOAN');

      const res = await admin.agent.get(listUrl());
      expect(res.body.total).toBe(1);
      expect(res.body.rows).toHaveLength(1);
    });

    it('the same employee can have multiple historical Advances, each its own row', async () => {
      const admin = await masterAdminAgent('arr-grain-multi@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Grain Multi');
      const employee = await makeEmployee(site.id, unit.id, 'Multi Advance Employee');
      const paidOff = await makeAdvance(employee.id, 'LOAN', { status: 'PAID_OFF', outstandingBalance: '0', paidOffAt: new Date('2026-02-01') });
      // A new LOAN can only be recorded once the prior one is fully settled — this fixture
      // reflects that lifecycle directly (paid off, then a fresh one), matching production
      // reality; the report's own grain is what's under test, not Advances' own creation rules.
      const active = await makeAdvance(employee.id, 'LOAN', { status: 'ACTIVE' });

      const res = await admin.agent.get(listUrl({ employeeId: employee.id }));
      expect(res.body.total).toBe(2);
      const ids = res.body.rows.map((r: { advanceId: string }) => r.advanceId).sort();
      expect(ids).toEqual([paidOff.id, active.id].sort());
    });

    it('LOAN and EID_ADVANCE for the same employee remain separate rows, one report', async () => {
      const admin = await masterAdminAgent('arr-grain-types@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Grain Types');
      const employee = await makeEmployee(site.id, unit.id, 'Both Types Employee');
      const loan = await makeAdvance(employee.id, 'LOAN');
      const eid = await makeAdvance(employee.id, 'EID_ADVANCE');

      const res = await admin.agent.get(listUrl({ employeeId: employee.id }));
      expect(res.body.total).toBe(2);
      const types = res.body.rows.map((r: { advanceType: string }) => r.advanceType).sort();
      expect(types).toEqual(['EID_ADVANCE', 'LOAN']);
      expect(res.body.rows.map((r: { advanceId: string }) => r.advanceId).sort()).toEqual([loan.id, eid.id].sort());
    });

    it('an Advance with multiple recovery PayrollEntry rows across cycles still produces exactly one list row', async () => {
      const admin = await masterAdminAgent('arr-grain-nomultiply@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Grain NoMultiply');
      const employee = await makeEmployee(site.id, unit.id, 'Installment Employee');
      const advance = await makeAdvance(employee.id, 'LOAN', { repaymentType: 'INSTALLMENT', outstandingBalance: '6000' });
      const cycle1 = await makeCycle(admin.userId);
      const cycle2 = await makeCycle(admin.userId);
      await makeEntry(cycle1.id, employee.id, site.id, unit.id, { advanceId: advance.id, advanceDeduction: '2000', released: true, releasedAt: new Date(), releasedBy: admin.userId });
      await makeEntry(cycle2.id, employee.id, site.id, unit.id, { advanceId: advance.id, advanceDeduction: '2000', released: true, releasedAt: new Date(), releasedBy: admin.userId });

      const res = await admin.agent.get(listUrl({ employeeId: employee.id }));
      expect(res.body.total).toBe(1);
      expect(res.body.rows).toHaveLength(1);
    });
  });

  // ================================================================================================
  // Financial semantics
  // ================================================================================================

  describe('Financial semantics', () => {
    it('currentOutstandingBalance is Advance.outstandingBalance verbatim, never replayed from PayrollEntry history', async () => {
      const admin = await masterAdminAgent('arr-fin-outstanding@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Fin Outstanding');
      const employee = await makeEmployee(site.id, unit.id, 'Outstanding Employee');
      await makeAdvance(employee.id, 'LOAN', { totalAmount: '10000', outstandingBalance: '3500' });

      const res = await admin.agent.get(listUrl({ employeeId: employee.id }));
      expect(res.body.rows[0].currentOutstandingBalance).toBe('3500.00');
    });

    it('recoveredToDate = totalAmount - outstandingBalance', async () => {
      const admin = await masterAdminAgent('arr-fin-recovered@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Fin Recovered');
      const employee = await makeEmployee(site.id, unit.id, 'Recovered Employee');
      await makeAdvance(employee.id, 'LOAN', { totalAmount: '10000', outstandingBalance: '3500' });

      const res = await admin.agent.get(listUrl({ employeeId: employee.id }));
      expect(res.body.rows[0].recoveredToDate).toBe('6500.00');
      expect(res.body.rows[0].originalAmount).toBe('10000.00');
    });

    it('recoveredThisCycle for LOAN reads PayrollEntry.advanceDeduction via advanceId, for the selected cycle only', async () => {
      const admin = await masterAdminAgent('arr-fin-loan-cycle@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Fin Loan Cycle');
      const employee = await makeEmployee(site.id, unit.id, 'Loan Cycle Employee');
      const advance = await makeAdvance(employee.id, 'LOAN', { outstandingBalance: '8000' });
      const targetCycle = await makeCycle(admin.userId);
      const otherCycle = await makeCycle(admin.userId);
      await makeEntry(targetCycle.id, employee.id, site.id, unit.id, { advanceId: advance.id, advanceDeduction: '2000' });
      await makeEntry(otherCycle.id, employee.id, site.id, unit.id, { advanceId: advance.id, advanceDeduction: '9999' });

      const res = await admin.agent.get(listUrl({ employeeId: employee.id, cycleId: targetCycle.id }));
      expect(res.body.rows[0].recoveredThisCycle).toBe('2000.00');
    });

    it('recoveredThisCycle for EID_ADVANCE reads PayrollEntry.eidAdvanceDeduction via eidAdvanceId, never the LOAN column', async () => {
      const admin = await masterAdminAgent('arr-fin-eid-cycle@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Fin EID Cycle');
      const employee = await makeEmployee(site.id, unit.id, 'EID Cycle Employee');
      const advance = await makeAdvance(employee.id, 'EID_ADVANCE', { outstandingBalance: '4000' });
      const cycle = await makeCycle(admin.userId);
      await makeEntry(cycle.id, employee.id, site.id, unit.id, { eidAdvanceId: advance.id, eidAdvanceDeduction: '1000' });

      const res = await admin.agent.get(listUrl({ employeeId: employee.id, cycleId: cycle.id }));
      expect(res.body.rows[0].recoveredThisCycle).toBe('1000.00');
      expect(res.body.rows[0].advanceType).toBe('EID_ADVANCE');
    });

    it('correctionBalanceRecovery on a linked PayrollEntry never contaminates this report — recoveredThisCycle stays exactly the advance deduction column', async () => {
      const admin = await masterAdminAgent('arr-fin-no-correction@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Fin No Correction');
      const employee = await makeEmployee(site.id, unit.id, 'No Correction Employee');
      const advance = await makeAdvance(employee.id, 'LOAN', { outstandingBalance: '5000' });
      const cycle = await makeCycle(admin.userId);
      await prisma.payrollEntry.create({
        data: {
          cycleId: cycle.id,
          employeeId: employee.id,
          siteId: site.id,
          designation: 'Guard',
          grossPay: '30000',
          allowance: '0',
          leaveDays: '0',
          eobiAmount: '400',
          eobiApplicable: true,
          advanceDeduction: '1500',
          advanceId: advance.id,
          correctionBalanceRecovery: '9999', // deliberately large, must never leak into this report
          workLines: { create: [{ siteId: site.id, unitId: unit.id, days: '26', otHours: '0', cycleDays: 30 }] },
        },
      });

      const res = await admin.agent.get(listUrl({ employeeId: employee.id, cycleId: cycle.id }));
      expect(res.body.rows[0].recoveredThisCycle).toBe('1500.00');
      assertNoSensitiveKeys(res.body, EXPORT_FORBIDDEN_KEYS);
    });
  });

  // ================================================================================================
  // Cycle behavior
  // ================================================================================================

  describe('Cycle behavior', () => {
    it('no Cycle: recoveredThisCycle is null on every row, cycle is null on the response', async () => {
      const admin = await masterAdminAgent('arr-cycle-none@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Cycle None');
      const employee = await makeEmployee(site.id, unit.id, 'Cycle None Employee');
      await makeAdvance(employee.id, 'LOAN');

      const res = await admin.agent.get(listUrl({ employeeId: employee.id }));
      expect(res.body.cycle).toBeNull();
      expect(res.body.rows[0].recoveredThisCycle).toBeNull();
    });

    it('an Advance with no recovery in the selected Cycle remains in the roster, with recoveredThisCycle "0.00" — never excluded, never null', async () => {
      const admin = await masterAdminAgent('arr-cycle-zero@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Cycle Zero');
      const employee = await makeEmployee(site.id, unit.id, 'Cycle Zero Employee');
      await makeAdvance(employee.id, 'LOAN');
      const cycle = await makeCycle(admin.userId);

      const res = await admin.agent.get(listUrl({ employeeId: employee.id, cycleId: cycle.id }));
      expect(res.body.total).toBe(1);
      expect(res.body.rows[0].recoveredThisCycle).toBe('0.00');
    });

    it('selecting a Cycle never changes currentOutstandingBalance/recoveredToDate — both stay the same LIVE CURRENT figures regardless of which cycle (or none) is selected', async () => {
      const admin = await masterAdminAgent('arr-cycle-liveonly@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Cycle LiveOnly');
      const employee = await makeEmployee(site.id, unit.id, 'Cycle LiveOnly Employee');
      const advance = await makeAdvance(employee.id, 'LOAN', { outstandingBalance: '7000' });
      const cycleOld = await makeCycle(admin.userId);
      const cycleNew = await makeCycle(admin.userId);
      await makeEntry(cycleOld.id, employee.id, site.id, unit.id, { advanceId: advance.id, advanceDeduction: '3000', released: true, releasedAt: new Date(), releasedBy: admin.userId });

      const noCycle = await admin.agent.get(listUrl({ employeeId: employee.id }));
      const withOld = await admin.agent.get(listUrl({ employeeId: employee.id, cycleId: cycleOld.id }));
      const withNew = await admin.agent.get(listUrl({ employeeId: employee.id, cycleId: cycleNew.id }));

      for (const res of [noCycle, withOld, withNew]) {
        expect(res.body.rows[0].currentOutstandingBalance).toBe('7000.00');
        expect(res.body.rows[0].recoveredToDate).toBe('3000.00');
      }
      expect(withOld.body.rows[0].recoveredThisCycle).toBe('3000.00');
      expect(withNew.body.rows[0].recoveredThisCycle).toBe('0.00');
    });
  });

  // ================================================================================================
  // Filters
  // ================================================================================================

  describe('Filters', () => {
    it('advanceType filters correctly', async () => {
      const admin = await masterAdminAgent('arr-filter-type@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Filter Type');
      const employee = await makeEmployee(site.id, unit.id, 'Filter Type Employee');
      await makeAdvance(employee.id, 'LOAN');
      await makeAdvance(employee.id, 'EID_ADVANCE');

      const loanRes = await admin.agent.get(listUrl({ employeeId: employee.id, advanceType: 'LOAN' }));
      expect(loanRes.body.total).toBe(1);
      expect(loanRes.body.rows[0].advanceType).toBe('LOAN');

      const eidRes = await admin.agent.get(listUrl({ employeeId: employee.id, advanceType: 'EID_ADVANCE' }));
      expect(eidRes.body.total).toBe(1);
      expect(eidRes.body.rows[0].advanceType).toBe('EID_ADVANCE');
    });

    it('status filters correctly', async () => {
      const admin = await masterAdminAgent('arr-filter-status@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Filter Status');
      const employee = await makeEmployee(site.id, unit.id, 'Filter Status Employee');
      await makeAdvance(employee.id, 'LOAN', { status: 'CANCELLED' });

      const res = await admin.agent.get(listUrl({ employeeId: employee.id, status: 'CANCELLED' }));
      expect(res.body.total).toBe(1);
      const noneRes = await admin.agent.get(listUrl({ employeeId: employee.id, status: 'ACTIVE' }));
      expect(noneRes.body.total).toBe(0);
    });

    it('hasOutstandingBalance tri-state: omitted = all, true = >0, false = <=0', async () => {
      const admin = await masterAdminAgent('arr-filter-outstanding@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Filter Outstanding');
      const employee = await makeEmployee(site.id, unit.id, 'Filter Outstanding Employee');
      await makeAdvance(employee.id, 'LOAN', { outstandingBalance: '5000' });
      await makeAdvance(employee.id, 'EID_ADVANCE', { outstandingBalance: '0', status: 'PAID_OFF' });

      const allRes = await admin.agent.get(listUrl({ employeeId: employee.id }));
      expect(allRes.body.total).toBe(2);

      const trueRes = await admin.agent.get(listUrl({ employeeId: employee.id, hasOutstandingBalance: 'true' }));
      expect(trueRes.body.total).toBe(1);
      expect(trueRes.body.rows[0].currentOutstandingBalance).toBe('5000.00');

      const falseRes = await admin.agent.get(listUrl({ employeeId: employee.id, hasOutstandingBalance: 'false' }));
      expect(falseRes.body.total).toBe(1);
      expect(falseRes.body.rows[0].currentOutstandingBalance).toBe('0.00');
    });

    it('employeeId filters to exactly that employee', async () => {
      const admin = await masterAdminAgent('arr-filter-employee@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Filter Employee');
      const empA = await makeEmployee(site.id, unit.id, 'Filter Employee A');
      const empB = await makeEmployee(site.id, unit.id, 'Filter Employee B');
      await makeAdvance(empA.id, 'LOAN');
      await makeAdvance(empB.id, 'LOAN');

      const res = await admin.agent.get(listUrl({ employeeId: empA.id }));
      expect(res.body.total).toBe(1);
      expect(res.body.rows[0].employeeId).toBe(empA.id);
    });

    it('siteIds filters by current Employee.siteId', async () => {
      const admin = await masterAdminAgent('arr-filter-site@test.local');
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site ARR Filter Site A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site ARR Filter Site B');
      const empA = await makeEmployee(siteA.id, unitA.id, 'Filter Site Employee A');
      const empB = await makeEmployee(siteB.id, unitB.id, 'Filter Site Employee B');
      await makeAdvance(empA.id, 'LOAN');
      await makeAdvance(empB.id, 'LOAN');

      const res = await admin.agent.get(listUrl({ siteIds: siteA.id }));
      expect(res.body.total).toBe(1);
      expect(res.body.rows[0].employeeId).toBe(empA.id);
    });

    it('employeeId cannot be used to bypass site scoping — an explicit employeeId outside the caller\'s accessible sites returns zero rows, never that employee\'s Advance', async () => {
      const { site: siteA } = await makeSiteWithUnit('Test Site ARR Filter Bypass A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site ARR Filter Bypass B');
      const empB = await makeEmployee(siteB.id, unitB.id, 'Bypass Employee B');
      await makeAdvance(empB.id, 'LOAN');

      const viewerA = await reportsViewerAgent('arr-filter-bypass@test.local', [siteA.id]);
      const res = await viewerA.agent.get(listUrl({ employeeId: empB.id }));
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
      expect(res.body.rows).toHaveLength(0);
    });

    it('no Unit filter exists — an unrecognized unitId query parameter is silently inert', async () => {
      const admin = await masterAdminAgent('arr-filter-nounit@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Filter NoUnit');
      const employee = await makeEmployee(site.id, unit.id, 'NoUnit Employee');
      await makeAdvance(employee.id, 'LOAN');

      const res = await admin.agent.get(listUrl({ employeeId: employee.id, unitId: '00000000-0000-0000-0000-000000000000' }));
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
    });
  });

  // ================================================================================================
  // Totals
  // ================================================================================================

  describe('Totals', () => {
    it('totals are computed over the complete filtered scope, unaffected by pagination', async () => {
      const admin = await masterAdminAgent('arr-totals-complete@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Totals Complete');
      const employee = await makeEmployee(site.id, unit.id, 'Totals Complete Employee');
      await makeAdvance(employee.id, 'LOAN', { totalAmount: '1000' });
      await makeAdvance(employee.id, 'EID_ADVANCE', { totalAmount: '2000' });

      const res = await admin.agent.get(listUrl({ employeeId: employee.id, pageSize: '1' }));
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.totals.matchingAdvanceCount).toBe(2);
    });

    it('type-split totals (loan/eidAdvance) sum correctly and independently', async () => {
      const admin = await masterAdminAgent('arr-totals-typesplit@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Totals TypeSplit');
      const employee = await makeEmployee(site.id, unit.id, 'TypeSplit Employee');
      await makeAdvance(employee.id, 'LOAN', { totalAmount: '10000', outstandingBalance: '4000' });
      // CANCELLED — a second ACTIVE/RESERVED LOAN for the same employee would violate the
      // partial unique index; this test only needs a second LOAN row to sum, not a second live one.
      // v1.0.4 Cancel Business Semantics: its stored outstandingBalance (5000, the true
      // never-recovered/now-waived remainder) is deliberately left unzeroed by `cancelAdvance` —
      // that is what keeps `recoveredToDateTotal` correct below — but it must NOT contribute to
      // `currentOutstandingBalanceTotal` (a cancelled Advance's remaining balance is waived, not
      // still owed/outstanding).
      await makeAdvance(employee.id, 'LOAN', { totalAmount: '5000', outstandingBalance: '5000', status: 'CANCELLED' });
      await makeAdvance(employee.id, 'EID_ADVANCE', { totalAmount: '2000', outstandingBalance: '500' });

      const res = await admin.agent.get(listUrl({ employeeId: employee.id }));
      expect(res.body.totals.loan.originalAmountTotal).toBe('15000.00');
      // Only the non-cancelled LOAN's 4000 contributes — the cancelled one's 5000 is excluded.
      expect(res.body.totals.loan.currentOutstandingBalanceTotal).toBe('4000.00');
      // Unaffected by the cancel carve-out: totalAmount(15000) - rawOutstanding(4000+5000=9000) = 6000,
      // still the true amount actually recovered across both LOAN Advances.
      expect(res.body.totals.loan.recoveredToDateTotal).toBe('6000.00');
      expect(res.body.totals.eidAdvance.originalAmountTotal).toBe('2000.00');
      expect(res.body.totals.eidAdvance.currentOutstandingBalanceTotal).toBe('500.00');
      expect(res.body.totals.eidAdvance.recoveredToDateTotal).toBe('1500.00');
    });

    it('type-split totals respect an explicit advanceType filter — the excluded type reads zero, never the unfiltered full-dataset figure', async () => {
      const admin = await masterAdminAgent('arr-totals-typefilter@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Totals TypeFilter');
      const employee = await makeEmployee(site.id, unit.id, 'TypeFilter Employee');
      await makeAdvance(employee.id, 'LOAN', { totalAmount: '1000' });
      await makeAdvance(employee.id, 'EID_ADVANCE', { totalAmount: '99999' });

      const res = await admin.agent.get(listUrl({ employeeId: employee.id, advanceType: 'LOAN' }));
      expect(res.body.totals.loan.originalAmountTotal).toBe('1000.00');
      expect(res.body.totals.eidAdvance.originalAmountTotal).toBe('0.00');
      expect(res.body.totals.eidAdvance.currentOutstandingBalanceTotal).toBe('0.00');
    });

    it('status counts (active/reserved/paidOff/cancelled) are correct and sum to matchingAdvanceCount', async () => {
      const admin = await masterAdminAgent('arr-totals-status@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Totals Status');
      const employee = await makeEmployee(site.id, unit.id, 'Totals Status Employee');
      await makeAdvance(employee.id, 'LOAN', { status: 'ACTIVE' });
      await makeAdvance(employee.id, 'EID_ADVANCE', { status: 'RESERVED', outstandingBalance: '0' });
      const paid = await makeAdvance(employee.id, 'LOAN', { status: 'PAID_OFF', outstandingBalance: '0' });
      await prisma.advance.update({ where: { id: paid.id }, data: { paidOffAt: new Date() } });
      await makeAdvance(employee.id, 'EID_ADVANCE', { status: 'CANCELLED' });

      const res = await admin.agent.get(listUrl({ employeeId: employee.id }));
      const totals = res.body.totals;
      expect(totals.activeCount).toBe(1);
      expect(totals.reservedCount).toBe(1);
      expect(totals.paidOffCount).toBe(1);
      expect(totals.cancelledCount).toBe(1);
      expect(totals.activeCount + totals.reservedCount + totals.paidOffCount + totals.cancelledCount).toBe(totals.matchingAdvanceCount);
    });

    it('employeesWithAdvanceCount is a distinct employee count, not a raw Advance count', async () => {
      const admin = await masterAdminAgent('arr-totals-distinct@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Totals Distinct');
      const employee = await makeEmployee(site.id, unit.id, 'Distinct Employee');
      await makeAdvance(employee.id, 'LOAN');
      await makeAdvance(employee.id, 'EID_ADVANCE');

      const res = await admin.agent.get(listUrl({ employeeId: employee.id }));
      expect(res.body.totals.matchingAdvanceCount).toBe(2);
      expect(res.body.totals.employeesWithAdvanceCount).toBe(1);
    });

    it('recoveredThisCycleTotal is null when no Cycle is selected, and a real, correctly-split figure when one is', async () => {
      const admin = await masterAdminAgent('arr-totals-cycle@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Totals Cycle');
      const employee = await makeEmployee(site.id, unit.id, 'Totals Cycle Employee');
      const loan = await makeAdvance(employee.id, 'LOAN', { outstandingBalance: '8000' });
      const eid = await makeAdvance(employee.id, 'EID_ADVANCE', { outstandingBalance: '3000' });
      const cycle = await makeCycle(admin.userId);
      await makeEntry(cycle.id, employee.id, site.id, unit.id, { advanceId: loan.id, advanceDeduction: '2000' });

      const empB = await makeEmployee(site.id, unit.id, 'Totals Cycle Employee B');
      const eidB = await makeAdvance(empB.id, 'EID_ADVANCE', { outstandingBalance: '1000' });
      await makeEntry(cycle.id, empB.id, site.id, unit.id, { eidAdvanceId: eidB.id, eidAdvanceDeduction: '500' });

      const noCycleRes = await admin.agent.get(listUrl({ employeeId: employee.id }));
      expect(noCycleRes.body.totals.recoveredThisCycleTotal).toBeNull();
      expect(noCycleRes.body.totals.recoveredThisCycleTotalByType).toBeNull();

      const cycleRes = await admin.agent.get(listUrl({ siteIds: site.id, cycleId: cycle.id }));
      expect(cycleRes.body.totals.recoveredThisCycleTotal).toBe('2500.00');
      expect(cycleRes.body.totals.recoveredThisCycleTotalByType.loan).toBe('2000.00');
      expect(cycleRes.body.totals.recoveredThisCycleTotalByType.eidAdvance).toBe('500.00');
      void eid;
    });

    it('totals contain no totalsComputed flag — every figure is a true DB aggregate, no bounded-fetch fallback', async () => {
      const admin = await masterAdminAgent('arr-totals-noflag@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Totals NoFlag');
      const employee = await makeEmployee(site.id, unit.id, 'NoFlag Employee');
      await makeAdvance(employee.id, 'LOAN');

      const res = await admin.agent.get(listUrl({ employeeId: employee.id }));
      expect(res.body.totals.totalsComputed).toBeUndefined();
    });
  });

  // ================================================================================================
  // Detail / recovery history
  // ================================================================================================

  describe('Detail / recovery history', () => {
    it('returns complete linked recovery history, newest cycle first, separate from schedule changes', async () => {
      const admin = await masterAdminAgent('arr-detail-history@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Detail History');
      const employee = await makeEmployee(site.id, unit.id, 'Detail History Employee');
      const advance = await makeAdvance(employee.id, 'LOAN', { repaymentType: 'INSTALLMENT', outstandingBalance: '6000' });
      const cycle1 = await makeCycle(admin.userId);
      const cycle2 = await makeCycle(admin.userId);
      const entry1 = await makeEntry(cycle1.id, employee.id, site.id, unit.id, { advanceId: advance.id, advanceDeduction: '2000', released: true, releasedAt: new Date(), releasedBy: admin.userId });
      const entry2 = await makeEntry(cycle2.id, employee.id, site.id, unit.id, { advanceId: advance.id, advanceDeduction: '2000' });

      const period1 = await makeScheduledPeriod(cycle1.year, cycle1.month);
      const period2 = await makeScheduledPeriod(cycle2.year, cycle2.month);
      await makeScheduleChange(advance.id, entry1.id, period1.id, period2.id, admin.userId);

      const res = await admin.agent.get(`/api/v1/reports/advance-recovery/${advance.id}`);
      expect(res.status).toBe(200);
      expect(res.body.recoveryHistory).toHaveLength(2);
      expect(res.body.recoveryHistory[0].cycleId).toBe(cycle2.id); // newest first
      expect(res.body.recoveryHistory[1].cycleId).toBe(cycle1.id);
      expect(res.body.recoveryHistory[1].payrollEntryId).toBe(entry1.id);
      expect(res.body.recoveryHistory[1].amountRecovered).toBe('2000.00');
      expect(res.body.recoveryHistory[1].releasedAt).not.toBeNull();
      expect(res.body.recoveryHistory[0].releasedAt).toBeNull();

      expect(res.body.scheduleChanges).toHaveLength(1);
      expect(res.body.scheduleChanges[0].fromPeriod).toEqual({ year: cycle1.year, month: cycle1.month });
      expect(res.body.scheduleChanges[0].toPeriod).toEqual({ year: cycle2.year, month: cycle2.month });
      expect(res.body.scheduleChanges[0].changedBy.id).toBe(admin.userId);

      void entry2;
    });

    it('recovery history siteId/siteName come from the linked PayrollEntry.siteId (historical), not the employee current site', async () => {
      const admin = await masterAdminAgent('arr-detail-historicalsite@test.local');
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site ARR Detail Hist A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site ARR Detail Hist B');
      const employee = await makeEmployee(siteA.id, unitA.id, 'Detail Historical Site Employee');
      const advance = await makeAdvance(employee.id, 'LOAN', { outstandingBalance: '2000' });
      const cycle = await makeCycle(admin.userId);
      await makeEntry(cycle.id, employee.id, siteA.id, unitA.id, { advanceId: advance.id, advanceDeduction: '2000', released: true, releasedAt: new Date(), releasedBy: admin.userId });

      // Employee now transfers to Site B — the report's own top-level `employee.siteId` reflects
      // this (current), but the recovery event's own `siteId` must still read Site A (historical).
      await prisma.employee.update({ where: { id: employee.id }, data: { siteId: siteB.id, unitId: unitB.id } });

      const res = await admin.agent.get(`/api/v1/reports/advance-recovery/${advance.id}`);
      expect(res.body.employee.siteId).toBe(siteB.id);
      expect(res.body.recoveryHistory[0].siteId).toBe(siteA.id);
      expect(res.body.recoveryHistory[0].siteName).toBe(siteA.name);
    });

    it('a CANCELLED Advance is still viewable, with whatever recovery history it accrued before cancellation', async () => {
      const admin = await masterAdminAgent('arr-detail-cancelled@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Detail Cancelled');
      const employee = await makeEmployee(site.id, unit.id, 'Cancelled Advance Employee');
      const advance = await makeAdvance(employee.id, 'LOAN', { status: 'CANCELLED', outstandingBalance: '4000' });
      const cycle = await makeCycle(admin.userId);
      await makeEntry(cycle.id, employee.id, site.id, unit.id, { advanceId: advance.id, advanceDeduction: '1000', released: true, releasedAt: new Date(), releasedBy: admin.userId });

      const res = await admin.agent.get(`/api/v1/reports/advance-recovery/${advance.id}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CANCELLED');
      expect(res.body.recoveryHistory).toHaveLength(1);
      // v1.0.4 Cancel Business Semantics: the stored outstandingBalance (4000, the true waived
      // remainder — never zeroed by cancelAdvance) must NOT display as still-owed Outstanding...
      expect(res.body.currentOutstandingBalance).toBe('0.00');
      // ...but Recovered To Date must still correctly reflect the real, unmasked history
      // (totalAmount 10000 - outstandingBalance 4000 = 6000 actually recovered before cancellation)
      // — it must NOT report the full 10000 as recovered just because Outstanding now reads 0.
      expect(res.body.recoveredToDate).toBe('6000.00');
      expect(res.body.originalAmount).toBe('10000.00');
    });

    it('a PAID_OFF Advance is viewable with paidOffAt populated and outstanding balance zero', async () => {
      const admin = await masterAdminAgent('arr-detail-paidoff@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Detail PaidOff');
      const employee = await makeEmployee(site.id, unit.id, 'PaidOff Advance Employee');
      const paidOffAt = new Date('2026-03-15');
      const advance = await makeAdvance(employee.id, 'LOAN', { status: 'PAID_OFF', outstandingBalance: '0', paidOffAt });

      const res = await admin.agent.get(`/api/v1/reports/advance-recovery/${advance.id}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('PAID_OFF');
      expect(res.body.currentOutstandingBalance).toBe('0.00');
      expect(res.body.paidOffAt).toBe(paidOffAt.toISOString());
    });

    it('never leaks an unrelated employee\'s Advance or PayrollEntry recovery events', async () => {
      const admin = await masterAdminAgent('arr-detail-noleak@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Detail NoLeak');
      const employeeA = await makeEmployee(site.id, unit.id, 'NoLeak Employee A');
      const employeeB = await makeEmployee(site.id, unit.id, 'NoLeak Employee B');
      const advanceA = await makeAdvance(employeeA.id, 'LOAN', { outstandingBalance: '3000' });
      const advanceB = await makeAdvance(employeeB.id, 'LOAN', { outstandingBalance: '3000' });
      const cycle = await makeCycle(admin.userId);
      await makeEntry(cycle.id, employeeA.id, site.id, unit.id, { advanceId: advanceA.id, advanceDeduction: '500' });
      await makeEntry(cycle.id, employeeB.id, site.id, unit.id, { advanceId: advanceB.id, advanceDeduction: '700' });

      const res = await admin.agent.get(`/api/v1/reports/advance-recovery/${advanceA.id}`);
      expect(res.body.recoveryHistory).toHaveLength(1);
      expect(res.body.recoveryHistory[0].amountRecovered).toBe('500.00');
    });
  });

  // ================================================================================================
  // Export
  // ================================================================================================

  describe('Export', () => {
    it('CSV export: exact header order, and every row matches the list endpoint verbatim', async () => {
      const admin = await masterAdminAgent('arr-export-csv@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Export CSV');
      const employee = await makeEmployee(site.id, unit.id, 'Export CSV Employee', { employeeCode: 'EC-001' });
      await makeAdvance(employee.id, 'LOAN', { totalAmount: '5000', outstandingBalance: '2000' });

      const listRes = await admin.agent.get(listUrl({ employeeId: employee.id }));
      const csvRes = await admin.agent.get(exportUrl('csv', { employeeId: employee.id }));
      expect(csvRes.status).toBe(200);

      const records: Record<string, string>[] = parseCsvSync(csvRes.text, { columns: true });
      expect(Object.keys(records[0]!)).toEqual(EXPECTED_EXPORT_HEADERS);

      const row = listRes.body.rows[0];
      const record = records[0]!;
      expect(record['Employee Code']).toBe(row.employeeCode);
      expect(record['Employee Name']).toBe(row.employeeName);
      expect(record['Project Site']).toBe(row.siteName);
      expect(record['Advance Type']).toBe(row.advanceType);
      expect(record['Status']).toBe(row.status);
      expect(record['Original Amount']).toBe(row.originalAmount);
      expect(record['Recovered To Date']).toBe(row.recoveredToDate);
      expect(record['Current Outstanding Balance']).toBe(row.currentOutstandingBalance);
      expect(record['Recovered This Cycle']).toBe('—');
    });

    it('XLSX export: correct worksheet name, exact header order, and row parity with the list endpoint', async () => {
      const admin = await masterAdminAgent('arr-export-xlsx@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Export XLSX');
      const employee = await makeEmployee(site.id, unit.id, 'Export XLSX Employee');
      await makeAdvance(employee.id, 'EID_ADVANCE', { totalAmount: '3000', outstandingBalance: '1000' });

      const listRes = await admin.agent.get(listUrl({ employeeId: employee.id }));
      const xlsxRes = await admin.agent.get(exportUrl('xlsx', { employeeId: employee.id })).buffer(true).parse(binaryParser);
      expect(xlsxRes.status).toBe(200);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(xlsxRes.body as Buffer);
      const worksheet = workbook.getWorksheet('Advance Recovery Report');
      expect(worksheet).toBeDefined();

      const headerRow = worksheet!.getRow(4).values as unknown[];
      const headers = headerRow.slice(1).map((v) => String(v));
      expect(headers).toEqual(EXPECTED_EXPORT_HEADERS);

      const titleRow = worksheet!.getRow(1).values as unknown[];
      expect(String(titleRow[1])).toBe('Advance Recovery Report');
      const asOfRow = worksheet!.getRow(2).values as unknown[];
      expect(String(asOfRow[1])).toMatch(/^As of/);

      const dataRow = worksheet!.getRow(5).values as unknown[];
      const row = listRes.body.rows[0];
      expect(String(dataRow[8])).toBe(row.originalAmount);
      expect(String(dataRow[9])).toBe(row.recoveredToDate);
      expect(String(dataRow[10])).toBe(row.currentOutstandingBalance);
    });

    it('export ignores page/pageSize and applies the same filters as the list endpoint', async () => {
      const admin = await masterAdminAgent('arr-export-filterparity@test.local');
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site ARR Export Filter A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site ARR Export Filter B');
      const empA = await makeEmployee(siteA.id, unitA.id, 'Export Filter Employee A');
      const empB = await makeEmployee(siteB.id, unitB.id, 'Export Filter Employee B');
      await makeAdvance(empA.id, 'LOAN');
      await makeAdvance(empB.id, 'LOAN');

      const res = await admin.agent.get(exportUrl('csv', { siteIds: siteA.id, pageSize: '1' }));
      const records: Record<string, string>[] = parseCsvSync(res.text, { columns: true });
      expect(records).toHaveLength(1);
      expect(records[0]!['Employee Name']).toBe('Export Filter Employee A');
    });

    it('export row order matches the list endpoint\'s own sort order', async () => {
      const admin = await masterAdminAgent('arr-export-sortparity@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Export SortParity');
      const employee = await makeEmployee(site.id, unit.id, 'Export SortParity Employee');
      await makeAdvance(employee.id, 'LOAN', { totalAmount: '1000' });
      await makeAdvance(employee.id, 'EID_ADVANCE', { totalAmount: '5000' });

      const res = await admin.agent.get(exportUrl('csv', { employeeId: employee.id, sortBy: 'originalAmount', sortDir: 'desc' }));
      const records: Record<string, string>[] = parseCsvSync(res.text, { columns: true });
      expect(records.map((r) => r['Original Amount'])).toEqual(['5000.00', '1000.00']);
    });

    it('a 401/403 caller is rejected before any export work happens', async () => {
      const { site } = await makeSiteWithUnit('Test Site ARR Export Perm');
      const noPerm = await noPermissionAgent('arr-export-perm@test.local', [site.id]);
      const res = await noPerm.agent.get(exportUrl('csv'));
      expect(res.status).toBe(403);
    });

    it('export excludes every sensitive field — recursive sweep, CSV and XLSX', async () => {
      const admin = await masterAdminAgent('arr-export-sweep@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Export Sweep');
      const employee = await makeEmployee(site.id, unit.id, 'Export Sweep Employee', { cnic: '1234512345671', accountNumber: 'ACC-999', iban: 'PK00TEST0000000000000000' });
      await makeAdvance(employee.id, 'LOAN');

      const csvRes = await admin.agent.get(exportUrl('csv', { employeeId: employee.id }));
      const records: Record<string, string>[] = parseCsvSync(csvRes.text, { columns: true });
      assertNoSensitiveKeys(records, EXPORT_FORBIDDEN_KEYS);
      expect(csvRes.text).not.toMatch(/12345-1234567-1/);
      expect(csvRes.text).not.toMatch(/ACC-999/);

      const xlsxRes = await admin.agent.get(exportUrl('xlsx', { employeeId: employee.id })).buffer(true).parse(binaryParser);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(xlsxRes.body as Buffer);
      const worksheet = workbook.getWorksheet('Advance Recovery Report')!;
      const cellStrings: string[] = [];
      worksheet.eachRow((row) => row.eachCell((cell) => cellStrings.push(String(cell.value ?? ''))));
      expect(cellStrings.join(' ')).not.toMatch(/12345-1234567-1/);
      expect(cellStrings.join(' ')).not.toMatch(/ACC-999/);
    });

    it('the JSON list response also excludes every sensitive field — recursive sweep', async () => {
      const admin = await masterAdminAgent('arr-list-sweep@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR List Sweep');
      const employee = await makeEmployee(site.id, unit.id, 'List Sweep Employee', { cnic: '1234512345671' });
      await makeAdvance(employee.id, 'LOAN');

      const res = await admin.agent.get(listUrl({ employeeId: employee.id }));
      assertNoSensitiveKeys(res.body, EXPORT_FORBIDDEN_KEYS);
    });
  });

  // ================================================================================================
  // Employee lookup
  // ================================================================================================

  describe('Employee lookup', () => {
    it('is authorized against CURRENT Employee.siteId, gated by reports:view', async () => {
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site ARR Lookup A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site ARR Lookup B');
      const empA = await makeEmployee(siteA.id, unitA.id, 'Lookup Employee A');
      await makeEmployee(siteB.id, unitB.id, 'Lookup Employee B');

      const viewer = await reportsViewerAgent('arr-lookup-scope@test.local', [siteA.id]);
      const res = await viewer.agent.get('/api/v1/reports/advance-recovery/employees');
      expect(res.status).toBe(200);
      expect(res.body.employees.map((e: { employeeId: string }) => e.employeeId)).toEqual([empA.id]);
    });

    it('search matches employeeCode and name', async () => {
      const admin = await masterAdminAgent('arr-lookup-search@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Lookup Search');
      await makeEmployee(site.id, unit.id, 'Zebra Employee', { employeeCode: 'ZEB-01' });
      await makeEmployee(site.id, unit.id, 'Yak Employee', { employeeCode: 'YAK-01' });

      const res = await admin.agent.get('/api/v1/reports/advance-recovery/employees?search=Zebra');
      expect(res.body.employees).toHaveLength(1);
      expect(res.body.employees[0].name).toBe('Zebra Employee');
    });

    it('an explicit siteId naming an inaccessible site is rejected with 403', async () => {
      const { site: siteA } = await makeSiteWithUnit('Test Site ARR Lookup Explicit A');
      const { site: siteB } = await makeSiteWithUnit('Test Site ARR Lookup Explicit B');
      const viewer = await reportsViewerAgent('arr-lookup-explicit@test.local', [siteA.id]);
      const res = await viewer.agent.get(`/api/v1/reports/advance-recovery/employees?siteId=${siteB.id}`);
      expect(res.status).toBe(403);
    });

    it('never exposes CNIC in the lookup response', async () => {
      const admin = await masterAdminAgent('arr-lookup-nocnic@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Lookup NoCnic');
      await makeEmployee(site.id, unit.id, 'NoCnic Lookup Employee', { cnic: '1234512345671' });

      const res = await admin.agent.get('/api/v1/reports/advance-recovery/employees?search=NoCnic');
      assertNoSensitiveKeys(res.body, EXPORT_FORBIDDEN_KEYS);
      expect(JSON.stringify(res.body)).not.toMatch(/12345-1234567-1/);
    });
  });

  // ================================================================================================
  // Pagination
  // ================================================================================================

  describe('Pagination', () => {
    it('paginates at the database level — page 2 never re-shows page 1 rows, with a stable id tie-break', async () => {
      const admin = await masterAdminAgent('arr-page@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site ARR Page');
      const employee = await makeEmployee(site.id, unit.id, 'Page Employee');
      // CANCELLED status avoids the partial "one ACTIVE/RESERVED per (employeeId, type)" unique
      // index — this test only needs 5 distinct Advance rows to paginate over, not a particular
      // lifecycle state.
      for (let i = 0; i < 5; i += 1) {
        await makeAdvance(employee.id, i % 2 === 0 ? 'LOAN' : 'EID_ADVANCE', { totalAmount: `${1000 + i}`, status: 'CANCELLED' });
      }

      const page1 = await admin.agent.get(listUrl({ employeeId: employee.id, pageSize: '2', page: '1' }));
      const page2 = await admin.agent.get(listUrl({ employeeId: employee.id, pageSize: '2', page: '2' }));
      expect(page1.body.rows).toHaveLength(2);
      expect(page2.body.rows).toHaveLength(2);
      const page1Ids = page1.body.rows.map((r: { advanceId: string }) => r.advanceId);
      const page2Ids = page2.body.rows.map((r: { advanceId: string }) => r.advanceId);
      expect(page1Ids.filter((id: string) => page2Ids.includes(id))).toHaveLength(0);
    });
  });
});
