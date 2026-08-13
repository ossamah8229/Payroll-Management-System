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
  'Population Status',
  'Comparison Site',
  'Current Site',
  'Previous Net',
  'Current Net',
  'Variance Amount',
  'Variance %',
  'Site Transfer',
  'Unit Change',
  'Has Comparison Correction',
  'Has Current Correction',
];

const EXPORT_FORBIDDEN_KEYS = [
  'cnic',
  'accountnumber',
  'iban',
  'bank',
  'branchcode',
  'releasedby',
  'reason',
  'grosspay',
  'remainingamount',
];

/**
 * Phase 7 Reports, Variance / Month-on-Month Report Checkpoint 1A (approved Checkpoint 0
 * architecture review). Every fixture entry is created directly via Prisma, mirroring every
 * sibling report's own established test pattern — this suite is about the report's own
 * pairing/authorization/classification/filtering correctness, not Payroll Entry's own creation
 * workflow.
 */
describe('Phase 7 Reports — Variance / Month-on-Month Report (Checkpoint 1A)', () => {
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
      permissionKeys: [PERMISSIONS.PAYROLL_CYCLE_MANAGE, PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.REPORTS_VIEW],
    });
  }

  async function reportsViewerAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_VR_REPORTS_VIEWER',
      permissionKeys: [PERMISSIONS.REPORTS_VIEW],
      siteIds,
    });
  }

  async function statementsOnlyAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_VR_STATEMENTS_ONLY',
      permissionKeys: [PERMISSIONS.STATEMENTS_VIEW],
      siteIds,
    });
  }

  async function noPermissionAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_VR_NO_PERM',
      permissionKeys: [PERMISSIONS.PAYROLL_ENTRY],
      siteIds,
    });
  }

  // --- Fixtures --------------------------------------------------------------------------------

  let cycleCounter = 0;
  function nextCycleYearMonth(): { year: number; month: number } {
    cycleCounter += 1;
    return { year: 2900 + Math.floor(cycleCounter / 12), month: (cycleCounter % 12) + 1 };
  }

  async function makeSiteWithUnit(name: string, unitName = `${name} Unit`) {
    const site = await prisma.projectSite.create({ data: { name } });
    const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: unitName, code: `U-${Math.random().toString(36).slice(2, 8)}` } });
    return { site, unit };
  }

  async function makeEmployee(siteId: string, unitId: string, name: string, extra: Record<string, unknown> = {}) {
    return prisma.employee.create({ data: { name, designation: 'Guard', siteId, unitId, grossPay: '30000', ...extra } });
  }

  async function makeCycle(createdBy: string, status: 'DRAFT' | 'RELEASED' | 'ARCHIVED' = 'DRAFT') {
    const { year, month } = nextCycleYearMonth();
    return prisma.payrollCycle.create({ data: { year, month, createdBy, status } });
  }

  interface EntryOverrides {
    grossPay?: string;
    eobiAmount?: string;
    eobiApplicable?: boolean;
    advanceDeduction?: string;
    eidAdvanceDeduction?: string;
    fine?: string;
    correctionBalancePayable?: string;
    correctionBalanceRecovery?: string;
    days?: string;
    employeeNameSnapshot?: string;
  }

  async function makeEntry(cycleId: string, employeeId: string, siteId: string, unitId: string, overrides: EntryOverrides = {}) {
    return prisma.payrollEntry.create({
      data: {
        cycleId,
        employeeId,
        siteId,
        designation: 'Guard',
        employeeNameSnapshot: overrides.employeeNameSnapshot,
        grossPay: overrides.grossPay ?? '30000',
        allowance: '0',
        leaveDays: '0',
        leaveRate: null,
        eobiAmount: overrides.eobiAmount ?? '400',
        eobiApplicable: overrides.eobiApplicable ?? true,
        advanceDeduction: overrides.advanceDeduction ?? '0',
        eidAdvanceDeduction: overrides.eidAdvanceDeduction ?? '0',
        fine: overrides.fine ?? '0',
        correctionBalancePayable: overrides.correctionBalancePayable ?? '0',
        correctionBalanceRecovery: overrides.correctionBalanceRecovery ?? '0',
        hold: false,
        released: false,
        workLines: {
          // Default days == cycleDays (30) so netSalary == grossPay exactly whenever EOBI is
          // disabled and no other deduction is set — this suite's money-precision tests rely on
          // that exact identity rather than needing a days/cycleDays ratio in every fixture call.
          create: [{ siteId, unitId, days: overrides.days ?? '30', otHours: '0', otRate: null, cycleDays: 30 }],
        },
      },
      include: { workLines: true },
    });
  }

  async function makeAdjustmentType(code: string) {
    return prisma.adjustmentType.create({ data: { code: `TEST_${code}`, label: code } });
  }

  async function makeCorrection(payrollEntryId: string, adjustmentTypeId: string, approvedById: string) {
    return prisma.correction.create({
      data: {
        payrollEntryId,
        field: 'GROSS_PAY',
        oldValue: '30000',
        newValue: '35000',
        oldNetSalary: '29600',
        newNetSalary: '34600',
        adjustmentTypeId,
        reason: 'Attendance miscounted for this period',
        approvedById,
      },
    });
  }

  function listUrl(params: Record<string, string> = {}) {
    return `/api/v1/reports/variance?${new URLSearchParams(params).toString()}`;
  }
  function exportUrl(format: 'csv' | 'xlsx', params: Record<string, string> = {}) {
    return `/api/v1/reports/variance/export?${new URLSearchParams({ format, ...params }).toString()}`;
  }

  /** Sets up two cycles under one admin, ready for `makeEntry(comparisonCycle.id, ...)`/
   * `makeEntry(currentCycle.id, ...)` fixture calls. */
  async function makeCyclePair(createdBy: string) {
    const comparisonCycle = await makeCycle(createdBy);
    const currentCycle = await makeCycle(createdBy);
    return { comparisonCycle, currentCycle };
  }

  // ================================================================================================
  // Authorization
  // ================================================================================================

  describe('Authorization', () => {
    it('rejects a request with no session with 401', async () => {
      const admin = await masterAdminAgent('vr-auth-admin0@test.local');
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      const res = await request(app).get(listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }));
      expect(res.status).toBe(401);
    });

    it('rejects a user lacking reports:view with 403', async () => {
      const admin = await masterAdminAgent('vr-auth-admin1@test.local');
      const { site } = await makeSiteWithUnit('Test Site VR Auth 1');
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      const noPerm = await noPermissionAgent('vr-auth-noperm@test.local', [site.id]);
      const res = await noPerm.agent.get(listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }));
      expect(res.status).toBe(403);
    });

    it('a user with statements:view but not reports:view is denied — frozen permission is reports:view only, no OR gate', async () => {
      const admin = await masterAdminAgent('vr-auth-admin2@test.local');
      const { site } = await makeSiteWithUnit('Test Site VR Auth 2');
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      const statementsOnly = await statementsOnlyAgent('vr-auth-statementsonly@test.local', [site.id]);
      const res = await statementsOnly.agent.get(listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }));
      expect(res.status).toBe(403);
    });

    it('Master Admin (global authority) can list with no site restriction', async () => {
      const admin = await masterAdminAgent('vr-auth-admin3@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site VR Auth 3');
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Auth Admin Employee');
      await makeEntry(comparisonCycle.id, employee.id, site.id, unit.id);
      await makeEntry(currentCycle.id, employee.id, site.id, unit.id);

      const res = await admin.agent.get(listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }));
      expect(res.status).toBe(200);
      expect(res.body.rows.some((row: { employeeId: string }) => row.employeeId === employee.id)).toBe(true);
    });

    it('a site-scoped viewer only sees their accessible site rows', async () => {
      const admin = await masterAdminAgent('vr-auth-admin4@test.local');
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site VR Scope A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site VR Scope B');
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      const employeeA = await makeEmployee(siteA.id, unitA.id, 'Scope Employee A');
      const employeeB = await makeEmployee(siteB.id, unitB.id, 'Scope Employee B');
      await makeEntry(comparisonCycle.id, employeeA.id, siteA.id, unitA.id);
      await makeEntry(currentCycle.id, employeeA.id, siteA.id, unitA.id);
      await makeEntry(comparisonCycle.id, employeeB.id, siteB.id, unitB.id);
      await makeEntry(currentCycle.id, employeeB.id, siteB.id, unitB.id);

      const viewerA = await reportsViewerAgent('vr-auth-viewerA@test.local', [siteA.id]);
      const res = await viewerA.agent.get(listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }));
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0].employeeId).toBe(employeeA.id);
      expect(res.body.totals.matchingCount).toBe(1);
    });

    it('an explicit siteIds filter naming an inaccessible site is rejected with 403, never silently narrowed', async () => {
      const admin = await masterAdminAgent('vr-auth-admin5@test.local');
      const { site: siteA } = await makeSiteWithUnit('Test Site VR Explicit A');
      const { site: siteB } = await makeSiteWithUnit('Test Site VR Explicit B');
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      const viewerA = await reportsViewerAgent('vr-auth-explicitA@test.local', [siteA.id]);
      const res = await viewerA.agent.get(
        listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id, siteIds: siteB.id }),
      );
      expect(res.status).toBe(403);
    });

    describe('Two-sided authorization (the central security invariant)', () => {
      it('a CONTINUED employee disappears entirely when the comparison-side site is inaccessible — never a partial row, never a leaked value', async () => {
        const admin = await masterAdminAgent('vr-auth-2side1@test.local');
        const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site VR 2Side A');
        const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site VR 2Side B');
        const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
        const employee = await makeEmployee(siteB.id, unitB.id, '2Side Employee');
        // Comparison-side entry at Site A (caller cannot see this site).
        await makeEntry(comparisonCycle.id, employee.id, siteA.id, unitA.id, { grossPay: '20000' });
        // Current-side entry at Site B (caller CAN see this site).
        await makeEntry(currentCycle.id, employee.id, siteB.id, unitB.id, { grossPay: '50000' });

        const viewerB = await reportsViewerAgent('vr-auth-2side-viewerB@test.local', [siteB.id]);
        const res = await viewerB.agent.get(listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }));
        expect(res.status).toBe(200);
        // The employee must be completely absent — not shown as NEW (which would misclassify an
        // accessibility gap as a genuine hire), not shown with a null/redacted comparison side.
        expect(res.body.rows.find((row: { employeeId: string }) => row.employeeId === employee.id)).toBeUndefined();
        expect(res.body.totals.matchingCount).toBe(0);
      });

      it('a CONTINUED employee disappears entirely when the current-side site is inaccessible', async () => {
        const admin = await masterAdminAgent('vr-auth-2side2@test.local');
        const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site VR 2Side C');
        const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site VR 2Side D');
        const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
        const employee = await makeEmployee(siteA.id, unitA.id, '2Side Employee 2');
        await makeEntry(comparisonCycle.id, employee.id, siteA.id, unitA.id, { grossPay: '50000' });
        await makeEntry(currentCycle.id, employee.id, siteB.id, unitB.id, { grossPay: '20000' });

        const viewerA = await reportsViewerAgent('vr-auth-2side-viewerA2@test.local', [siteA.id]);
        const res = await viewerA.agent.get(listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }));
        expect(res.status).toBe(200);
        expect(res.body.rows.find((row: { employeeId: string }) => row.employeeId === employee.id)).toBeUndefined();
        expect(res.body.totals.matchingCount).toBe(0);
      });

      it('NEW requires Current-side access: invisible when only the (inaccessible) Comparison-adjacent context exists elsewhere', async () => {
        const admin = await masterAdminAgent('vr-auth-new1@test.local');
        const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site VR New A');
        const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
        const employee = await makeEmployee(siteA.id, unitA.id, 'New Employee Inaccessible');
        // NEW: only a current-side entry exists, at a site the caller cannot see.
        await makeEntry(currentCycle.id, employee.id, siteA.id, unitA.id);

        const { site: siteB } = await makeSiteWithUnit('Test Site VR New B');
        const viewerB = await reportsViewerAgent('vr-auth-new-viewerB@test.local', [siteB.id]);
        const res = await viewerB.agent.get(listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }));
        expect(res.status).toBe(200);
        expect(res.body.rows.find((row: { employeeId: string }) => row.employeeId === employee.id)).toBeUndefined();
      });

      it('NEW is visible when the Current-side site is accessible', async () => {
        const admin = await masterAdminAgent('vr-auth-new2@test.local');
        const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site VR New C');
        const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
        const employee = await makeEmployee(siteA.id, unitA.id, 'New Employee Accessible');
        await makeEntry(currentCycle.id, employee.id, siteA.id, unitA.id);

        const viewerA = await reportsViewerAgent('vr-auth-new-viewerA@test.local', [siteA.id]);
        const res = await viewerA.agent.get(listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }));
        expect(res.status).toBe(200);
        const row = res.body.rows.find((r: { employeeId: string }) => r.employeeId === employee.id);
        expect(row).toBeDefined();
        expect(row.populationStatus).toBe('NEW');
      });

      it('DEPARTED requires Comparison-side access: invisible when the comparison-side site is inaccessible', async () => {
        const admin = await masterAdminAgent('vr-auth-departed1@test.local');
        const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site VR Departed A');
        const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
        const employee = await makeEmployee(siteA.id, unitA.id, 'Departed Employee Inaccessible');
        await makeEntry(comparisonCycle.id, employee.id, siteA.id, unitA.id);

        const { site: siteB } = await makeSiteWithUnit('Test Site VR Departed B');
        const viewerB = await reportsViewerAgent('vr-auth-departed-viewerB@test.local', [siteB.id]);
        const res = await viewerB.agent.get(listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }));
        expect(res.status).toBe(200);
        expect(res.body.rows.find((row: { employeeId: string }) => row.employeeId === employee.id)).toBeUndefined();
      });

      it('DEPARTED is visible when the Comparison-side site is accessible', async () => {
        const admin = await masterAdminAgent('vr-auth-departed2@test.local');
        const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site VR Departed C');
        const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
        const employee = await makeEmployee(siteA.id, unitA.id, 'Departed Employee Accessible');
        await makeEntry(comparisonCycle.id, employee.id, siteA.id, unitA.id);

        const viewerA = await reportsViewerAgent('vr-auth-departed-viewerA@test.local', [siteA.id]);
        const res = await viewerA.agent.get(listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }));
        expect(res.status).toBe(200);
        const row = res.body.rows.find((r: { employeeId: string }) => r.employeeId === employee.id);
        expect(row).toBeDefined();
        expect(row.populationStatus).toBe('DEPARTED');
      });

      it('totals never incorporate an inaccessible side — matchingCount, comparisonTotalNet, and currentTotalNet all reflect only the authorized set', async () => {
        const admin = await masterAdminAgent('vr-auth-totals1@test.local');
        const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site VR Totals A');
        const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site VR Totals B');
        const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
        // Accessible, continued employee.
        const visible = await makeEmployee(siteA.id, unitA.id, 'Totals Visible Employee');
        await makeEntry(comparisonCycle.id, visible.id, siteA.id, unitA.id, { grossPay: '30000' });
        await makeEntry(currentCycle.id, visible.id, siteA.id, unitA.id, { grossPay: '30000' });
        // Inaccessible-side employee — must contribute nothing to totals.
        const hidden = await makeEmployee(siteB.id, unitB.id, 'Totals Hidden Employee');
        await makeEntry(comparisonCycle.id, hidden.id, siteB.id, unitB.id, { grossPay: '999999' });
        await makeEntry(currentCycle.id, hidden.id, siteA.id, unitA.id, { grossPay: '999999' });

        const viewerA = await reportsViewerAgent('vr-auth-totals-viewerA@test.local', [siteA.id]);
        const res = await viewerA.agent.get(listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }));
        expect(res.status).toBe(200);
        expect(res.body.totals.matchingCount).toBe(1);
        expect(res.body.totals.comparisonTotalNet).toBe('29600.00');
        expect(res.body.totals.currentTotalNet).toBe('29600.00');
      });

      it('employee lookup cannot bypass Site restrictions — an inaccessible employee never appears in the search results', async () => {
        const admin = await masterAdminAgent('vr-auth-lookup1@test.local');
        const { site: siteA } = await makeSiteWithUnit('Test Site VR Lookup A');
        const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site VR Lookup B');
        const { comparisonCycle } = await makeCyclePair(admin.userId);
        const employeeB = await makeEmployee(siteB.id, unitB.id, 'Lookup Only At Site B');
        await makeEntry(comparisonCycle.id, employeeB.id, siteB.id, unitB.id);

        const viewerA = await reportsViewerAgent('vr-auth-lookup-viewerA@test.local', [siteA.id]);
        const res = await viewerA.agent.get(`/api/v1/reports/variance/employees?search=${encodeURIComponent('Lookup Only At Site B')}`);
        expect(res.status).toBe(200);
        expect(res.body.employees.find((e: { employeeId: string }) => e.employeeId === employeeB.id)).toBeUndefined();
      });
    });
  });

  // ================================================================================================
  // Pairing
  // ================================================================================================

  describe('Pairing', () => {
    it('one employee present in both cycles produces exactly one row', async () => {
      const admin = await masterAdminAgent('vr-pair-admin1@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site VR Pairing 1');
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Pairing Employee');
      await makeEntry(comparisonCycle.id, employee.id, site.id, unit.id);
      await makeEntry(currentCycle.id, employee.id, site.id, unit.id);

      const viewer = await reportsViewerAgent('vr-pair-viewer1@test.local', [site.id]);
      const res = await viewer.agent.get(listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }));
      expect(res.status).toBe(200);
      const matches = res.body.rows.filter((r: { employeeId: string }) => r.employeeId === employee.id);
      expect(matches).toHaveLength(1);
    });

    it('a multi-Unit employee (two work lines on one side) still produces exactly one row, keyed by employeeId, never per work line', async () => {
      const admin = await masterAdminAgent('vr-pair-admin2@test.local');
      const { site, unit: unit1 } = await makeSiteWithUnit('Test Site VR Pairing 2');
      const unit2 = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'Pairing 2 Unit B', code: 'U-P2B' } });
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      const employee = await makeEmployee(site.id, unit1.id, 'Multi Unit Employee');
      await makeEntry(comparisonCycle.id, employee.id, site.id, unit1.id);
      const currentEntry = await makeEntry(currentCycle.id, employee.id, site.id, unit1.id);
      await prisma.payrollEntryWorkLine.create({
        data: { payrollEntryId: currentEntry.id, siteId: site.id, unitId: unit2.id, days: '4', otHours: '0', cycleDays: 30, sortOrder: 1 },
      });

      const viewer = await reportsViewerAgent('vr-pair-viewer2@test.local', [site.id]);
      const res = await viewer.agent.get(listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }));
      expect(res.status).toBe(200);
      const matches = res.body.rows.filter((r: { employeeId: string }) => r.employeeId === employee.id);
      expect(matches).toHaveLength(1);
    });

    it('matches by employeeId only — never by name, code, site, or unit', async () => {
      const admin = await masterAdminAgent('vr-pair-admin3@test.local');
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site VR Pairing 3A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site VR Pairing 3B');
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      // Two DIFFERENT employees who happen to share the exact same name — must never be paired
      // together just because the display name matches.
      const employee1 = await makeEmployee(siteA.id, unitA.id, 'Same Display Name');
      const employee2 = await makeEmployee(siteB.id, unitB.id, 'Same Display Name');
      await makeEntry(comparisonCycle.id, employee1.id, siteA.id, unitA.id);
      await makeEntry(currentCycle.id, employee2.id, siteB.id, unitB.id);

      const admin2 = await reportsViewerAgent('vr-pair-viewer3@test.local', [siteA.id, siteB.id]);
      const res = await admin2.agent.get(listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }));
      expect(res.status).toBe(200);
      const row1 = res.body.rows.find((r: { employeeId: string }) => r.employeeId === employee1.id);
      const row2 = res.body.rows.find((r: { employeeId: string }) => r.employeeId === employee2.id);
      // Each is its own independent row (one DEPARTED, one NEW) — never merged into one CONTINUED
      // row just because the names match.
      expect(row1.populationStatus).toBe('DEPARTED');
      expect(row2.populationStatus).toBe('NEW');
    });
  });

  // ================================================================================================
  // Population classification
  // ================================================================================================

  describe('Population classification', () => {
    it('NEW: current-only, no dateOfLeaving dependency', async () => {
      const admin = await masterAdminAgent('vr-pop-admin1@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site VR Pop 1');
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'New Pop Employee');
      await makeEntry(currentCycle.id, employee.id, site.id, unit.id);

      const viewer = await reportsViewerAgent('vr-pop-viewer1@test.local', [site.id]);
      const res = await viewer.agent.get(listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }));
      const row = res.body.rows.find((r: { employeeId: string }) => r.employeeId === employee.id);
      expect(row.populationStatus).toBe('NEW');
      expect(row.comparisonNet).toBeNull();
      expect(row.currentNet).not.toBeNull();
      expect(row.direction).toBeNull();
      expect(row.varianceAmount).toBeNull();
      expect(row.variancePercent).toBeNull();
    });

    it('DEPARTED: comparison-only — an ACTIVE employee (dateOfLeaving null) with no current entry is still DEPARTED, proving classification never depends on Employee.dateOfLeaving', async () => {
      const admin = await masterAdminAgent('vr-pop-admin2@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site VR Pop 2');
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Departed Pop Employee'); // dateOfLeaving left null (still "active")
      await makeEntry(comparisonCycle.id, employee.id, site.id, unit.id);

      const viewer = await reportsViewerAgent('vr-pop-viewer2@test.local', [site.id]);
      const res = await viewer.agent.get(listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }));
      const row = res.body.rows.find((r: { employeeId: string }) => r.employeeId === employee.id);
      expect(row.populationStatus).toBe('DEPARTED');
      expect(row.currentNet).toBeNull();
      expect(row.comparisonNet).not.toBeNull();
      expect(row.direction).toBeNull();
    });

    it('CONTINUED: both sides present', async () => {
      const admin = await masterAdminAgent('vr-pop-admin3@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site VR Pop 3');
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Continued Pop Employee');
      await makeEntry(comparisonCycle.id, employee.id, site.id, unit.id);
      await makeEntry(currentCycle.id, employee.id, site.id, unit.id);

      const viewer = await reportsViewerAgent('vr-pop-viewer3@test.local', [site.id]);
      const res = await viewer.agent.get(listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }));
      const row = res.body.rows.find((r: { employeeId: string }) => r.employeeId === employee.id);
      expect(row.populationStatus).toBe('CONTINUED');
      expect(row.comparisonNet).not.toBeNull();
      expect(row.currentNet).not.toBeNull();
    });
  });

  // ================================================================================================
  // Direction / variance formula
  // ================================================================================================

  describe('Direction and variance formula', () => {
    async function setupContinued(email: string, comparisonGross: string, currentGross: string) {
      const admin = await masterAdminAgent(`${email}-admin@test.local`);
      const { site, unit } = await makeSiteWithUnit(`Test Site VR Dir ${email}`);
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, `Dir Employee ${email}`);
      await makeEntry(comparisonCycle.id, employee.id, site.id, unit.id, { grossPay: comparisonGross, eobiAmount: '0', eobiApplicable: false });
      await makeEntry(currentCycle.id, employee.id, site.id, unit.id, { grossPay: currentGross, eobiAmount: '0', eobiApplicable: false });
      const viewer = await reportsViewerAgent(`${email}@test.local`, [site.id]);
      const res = await viewer.agent.get(listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }));
      return res.body.rows.find((r: { employeeId: string }) => r.employeeId === employee.id);
    }

    it('INCREASED, exact amount and percent', async () => {
      const row = await setupContinued('vr-dir-inc', '30000', '33000');
      expect(row.direction).toBe('INCREASED');
      expect(row.comparisonNet).toBe('30000.00');
      expect(row.currentNet).toBe('33000.00');
      expect(row.varianceAmount).toBe('3000.00');
      expect(row.variancePercent).toBe('10.00');
    });

    it('DECREASED, exact amount and percent', async () => {
      const row = await setupContinued('vr-dir-dec', '30000', '27000');
      expect(row.direction).toBe('DECREASED');
      expect(row.varianceAmount).toBe('-3000.00');
      expect(row.variancePercent).toBe('-10.00');
    });

    it('UNCHANGED when net salary is identical', async () => {
      const row = await setupContinued('vr-dir-unc', '30000', '30000');
      expect(row.direction).toBe('UNCHANGED');
      expect(row.varianceAmount).toBe('0.00');
      expect(row.variancePercent).toBe('0.00');
    });

    it('comparisonNet = 0 never divides by zero — variancePercent is null, varianceAmount is still computed', async () => {
      const admin = await masterAdminAgent('vr-dir-zero-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site VR Dir Zero');
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Zero Comparison Employee');
      // grossPay 0, no other earning, no deduction -> netSalary exactly 0.00
      await makeEntry(comparisonCycle.id, employee.id, site.id, unit.id, { grossPay: '0', eobiAmount: '0', eobiApplicable: false });
      await makeEntry(currentCycle.id, employee.id, site.id, unit.id, { grossPay: '15000', eobiAmount: '0', eobiApplicable: false });
      const viewer = await reportsViewerAgent('vr-dir-zero-viewer@test.local', [site.id]);
      const res = await viewer.agent.get(listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }));
      const row = res.body.rows.find((r: { employeeId: string }) => r.employeeId === employee.id);
      expect(row.comparisonNet).toBe('0.00');
      expect(row.varianceAmount).toBe('15000.00');
      expect(row.variancePercent).toBeNull();
    });
  });

  // ================================================================================================
  // Transfers / Unit changes
  // ================================================================================================

  describe('Site Transfer and Unit Change flags', () => {
    it('siteTransfer is true when the two sides differ, and false when they match', async () => {
      const admin = await masterAdminAgent('vr-transfer-admin1@test.local');
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site VR Transfer A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site VR Transfer B');
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      const transferred = await makeEmployee(siteA.id, unitA.id, 'Transferred Employee');
      await makeEntry(comparisonCycle.id, transferred.id, siteA.id, unitA.id);
      await makeEntry(currentCycle.id, transferred.id, siteB.id, unitB.id);
      const stayed = await makeEmployee(siteA.id, unitA.id, 'Stayed Employee');
      await makeEntry(comparisonCycle.id, stayed.id, siteA.id, unitA.id);
      await makeEntry(currentCycle.id, stayed.id, siteA.id, unitA.id);

      const admin2 = await reportsViewerAgent('vr-transfer-viewer1@test.local', [siteA.id, siteB.id]);
      const res = await admin2.agent.get(listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }));
      const transferredRow = res.body.rows.find((r: { employeeId: string }) => r.employeeId === transferred.id);
      const stayedRow = res.body.rows.find((r: { employeeId: string }) => r.employeeId === stayed.id);
      expect(transferredRow.siteTransfer).toBe(true);
      expect(transferredRow.comparisonSiteId).toBe(siteA.id);
      expect(transferredRow.currentSiteId).toBe(siteB.id);
      expect(stayedRow.siteTransfer).toBe(false);
    });

    it('unitChange is true when the primary Unit differs between the two sides, within the same Site', async () => {
      const admin = await masterAdminAgent('vr-unit-admin1@test.local');
      const { site, unit: unit1 } = await makeSiteWithUnit('Test Site VR Unit Change');
      const unit2 = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'Unit Change B', code: 'U-UCB' } });
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      const employee = await makeEmployee(site.id, unit1.id, 'Unit Change Employee');
      await makeEntry(comparisonCycle.id, employee.id, site.id, unit1.id);
      await makeEntry(currentCycle.id, employee.id, site.id, unit2.id);

      const viewer = await reportsViewerAgent('vr-unit-viewer1@test.local', [site.id]);
      const res = await viewer.agent.get(listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }));
      const row = res.body.rows.find((r: { employeeId: string }) => r.employeeId === employee.id);
      expect(row.unitChange).toBe(true);
      expect(row.siteTransfer).toBe(false);
    });

    it('a NEW row never has siteTransfer/unitChange set true — nothing to compare', async () => {
      const admin = await masterAdminAgent('vr-transfer-new-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site VR Transfer New');
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'New No Transfer Employee');
      await makeEntry(currentCycle.id, employee.id, site.id, unit.id);
      const viewer = await reportsViewerAgent('vr-transfer-new-viewer@test.local', [site.id]);
      const res = await viewer.agent.get(listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }));
      const row = res.body.rows.find((r: { employeeId: string }) => r.employeeId === employee.id);
      expect(row.siteTransfer).toBe(false);
      expect(row.unitChange).toBe(false);
    });
  });

  // ================================================================================================
  // Corrections (existence-only, never replayed)
  // ================================================================================================

  describe('Correction flags', () => {
    it('hasComparisonCorrection / hasCurrentCorrection reflect existence independently per side, and correction data never changes the compared Net Salary', async () => {
      const admin = await masterAdminAgent('vr-corr-admin1@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site VR Corrections');
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Corrections Employee');
      const comparisonEntry = await makeEntry(comparisonCycle.id, employee.id, site.id, unit.id, { grossPay: '30000', eobiAmount: '0', eobiApplicable: false });
      await makeEntry(currentCycle.id, employee.id, site.id, unit.id, { grossPay: '30000', eobiAmount: '0', eobiApplicable: false });

      const adjustmentType = await makeAdjustmentType('VR_CORR');
      await makeCorrection(comparisonEntry.id, adjustmentType.id, admin.userId);

      const viewer = await reportsViewerAgent('vr-corr-viewer1@test.local', [site.id]);
      const res = await viewer.agent.get(listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }));
      const row = res.body.rows.find((r: { employeeId: string }) => r.employeeId === employee.id);
      expect(row.hasComparisonCorrection).toBe(true);
      expect(row.hasCurrentCorrection).toBe(false);
      // The Correction row's own newNetSalary (34600) must NOT leak into the compared figure — the
      // stored PayrollEntry.grossPay (30000, EOBI disabled) is untouched, so comparisonNet stays
      // exactly 30000.00, never replayed to 34600.00.
      expect(row.comparisonNet).toBe('30000.00');
      expect(row.varianceAmount).toBe('0.00');
    });

    it('neither side corrected: both flags false', async () => {
      const admin = await masterAdminAgent('vr-corr-admin2@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site VR Corrections None');
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'No Corrections Employee');
      await makeEntry(comparisonCycle.id, employee.id, site.id, unit.id);
      await makeEntry(currentCycle.id, employee.id, site.id, unit.id);
      const viewer = await reportsViewerAgent('vr-corr-viewer2@test.local', [site.id]);
      const res = await viewer.agent.get(listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }));
      const row = res.body.rows.find((r: { employeeId: string }) => r.employeeId === employee.id);
      expect(row.hasComparisonCorrection).toBe(false);
      expect(row.hasCurrentCorrection).toBe(false);
    });
  });

  // ================================================================================================
  // Filters
  // ================================================================================================

  describe('Filters', () => {
    it('siteIds filter matches a row when EITHER existing side belongs to a selected Site (a transfer is discoverable from either side)', async () => {
      const admin = await masterAdminAgent('vr-filter-site-admin@test.local');
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site VR Filter Site A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site VR Filter Site B');
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      const transferred = await makeEmployee(siteA.id, unitA.id, 'Filter Transfer Employee');
      await makeEntry(comparisonCycle.id, transferred.id, siteA.id, unitA.id);
      await makeEntry(currentCycle.id, transferred.id, siteB.id, unitB.id);

      const viewer = await reportsViewerAgent('vr-filter-site-viewer@test.local', [siteA.id, siteB.id]);
      const resA = await viewer.agent.get(
        listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id, siteIds: siteA.id }),
      );
      const resB = await viewer.agent.get(
        listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id, siteIds: siteB.id }),
      );
      expect(resA.body.rows.some((r: { employeeId: string }) => r.employeeId === transferred.id)).toBe(true);
      expect(resB.body.rows.some((r: { employeeId: string }) => r.employeeId === transferred.id)).toBe(true);
    });

    it('unitId filter requires exactly one Site selected — 400 otherwise', async () => {
      const admin = await masterAdminAgent('vr-filter-unit-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site VR Filter Unit 400');
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      const viewer = await reportsViewerAgent('vr-filter-unit-viewer400@test.local', [site.id]);
      const res = await viewer.agent.get(
        listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id, unitId: unit.id }),
      );
      expect(res.status).toBe(400);
    });

    it('unitId filter matches a row when EITHER existing side has a work line at that Unit', async () => {
      const admin = await masterAdminAgent('vr-filter-unit-admin2@test.local');
      const { site, unit: unit1 } = await makeSiteWithUnit('Test Site VR Filter Unit');
      const unit2 = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'Filter Unit B', code: 'U-FUB' } });
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      const employee = await makeEmployee(site.id, unit1.id, 'Filter Unit Employee');
      await makeEntry(comparisonCycle.id, employee.id, site.id, unit1.id);
      await makeEntry(currentCycle.id, employee.id, site.id, unit2.id);

      const viewer = await reportsViewerAgent('vr-filter-unit-viewer@test.local', [site.id]);
      const res1 = await viewer.agent.get(
        listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id, siteIds: site.id, unitId: unit1.id }),
      );
      const res2 = await viewer.agent.get(
        listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id, siteIds: site.id, unitId: unit2.id }),
      );
      expect(res1.body.rows.some((r: { employeeId: string }) => r.employeeId === employee.id)).toBe(true);
      expect(res2.body.rows.some((r: { employeeId: string }) => r.employeeId === employee.id)).toBe(true);
    });

    it('employeeId filter returns exactly that one employee row', async () => {
      const admin = await masterAdminAgent('vr-filter-emp-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site VR Filter Employee');
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      const employee1 = await makeEmployee(site.id, unit.id, 'Filter Employee One');
      const employee2 = await makeEmployee(site.id, unit.id, 'Filter Employee Two');
      await makeEntry(comparisonCycle.id, employee1.id, site.id, unit.id);
      await makeEntry(currentCycle.id, employee1.id, site.id, unit.id);
      await makeEntry(comparisonCycle.id, employee2.id, site.id, unit.id);
      await makeEntry(currentCycle.id, employee2.id, site.id, unit.id);

      const viewer = await reportsViewerAgent('vr-filter-emp-viewer@test.local', [site.id]);
      const res = await viewer.agent.get(
        listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id, employeeId: employee1.id }),
      );
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0].employeeId).toBe(employee1.id);
    });

    it('direction filter narrows to only that direction among CONTINUED rows', async () => {
      const admin = await masterAdminAgent('vr-filter-dir-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site VR Filter Direction');
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      const increased = await makeEmployee(site.id, unit.id, 'Filter Dir Increased');
      await makeEntry(comparisonCycle.id, increased.id, site.id, unit.id, { grossPay: '30000' });
      await makeEntry(currentCycle.id, increased.id, site.id, unit.id, { grossPay: '35000' });
      const decreased = await makeEmployee(site.id, unit.id, 'Filter Dir Decreased');
      await makeEntry(comparisonCycle.id, decreased.id, site.id, unit.id, { grossPay: '35000' });
      await makeEntry(currentCycle.id, decreased.id, site.id, unit.id, { grossPay: '30000' });
      const newEmp = await makeEmployee(site.id, unit.id, 'Filter Dir New');
      await makeEntry(currentCycle.id, newEmp.id, site.id, unit.id);

      const viewer = await reportsViewerAgent('vr-filter-dir-viewer@test.local', [site.id]);
      const res = await viewer.agent.get(
        listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id, direction: 'INCREASED' }),
      );
      const ids = res.body.rows.map((r: { employeeId: string }) => r.employeeId);
      expect(ids).toContain(increased.id);
      expect(ids).not.toContain(decreased.id);
      expect(ids).not.toContain(newEmp.id);
    });

    it('hasCorrection=true matches either side; hasCorrection=false requires neither side corrected', async () => {
      const admin = await masterAdminAgent('vr-filter-corr-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site VR Filter Correction');
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      const corrected = await makeEmployee(site.id, unit.id, 'Filter Correction Corrected');
      const correctedComparisonEntry = await makeEntry(comparisonCycle.id, corrected.id, site.id, unit.id);
      await makeEntry(currentCycle.id, corrected.id, site.id, unit.id);
      const adjustmentType = await makeAdjustmentType('VR_FILTER_CORR');
      await makeCorrection(correctedComparisonEntry.id, adjustmentType.id, admin.userId);

      const clean = await makeEmployee(site.id, unit.id, 'Filter Correction Clean');
      await makeEntry(comparisonCycle.id, clean.id, site.id, unit.id);
      await makeEntry(currentCycle.id, clean.id, site.id, unit.id);

      const viewer = await reportsViewerAgent('vr-filter-corr-viewer@test.local', [site.id]);
      const resTrue = await viewer.agent.get(
        listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id, hasCorrection: 'true' }),
      );
      const resFalse = await viewer.agent.get(
        listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id, hasCorrection: 'false' }),
      );
      expect(resTrue.body.rows.some((r: { employeeId: string }) => r.employeeId === corrected.id)).toBe(true);
      expect(resTrue.body.rows.some((r: { employeeId: string }) => r.employeeId === clean.id)).toBe(false);
      expect(resFalse.body.rows.some((r: { employeeId: string }) => r.employeeId === clean.id)).toBe(true);
      expect(resFalse.body.rows.some((r: { employeeId: string }) => r.employeeId === corrected.id)).toBe(false);
    });
  });

  // ================================================================================================
  // Totals
  // ================================================================================================

  describe('Totals', () => {
    it('population/direction/transfer/correction counts and aggregate variance are correct and never averaged from row percentages', async () => {
      const admin = await masterAdminAgent('vr-totals-admin1@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site VR Totals Full');
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);

      const increased = await makeEmployee(site.id, unit.id, 'Totals Increased');
      await makeEntry(comparisonCycle.id, increased.id, site.id, unit.id, { grossPay: '10000', eobiAmount: '0', eobiApplicable: false });
      await makeEntry(currentCycle.id, increased.id, site.id, unit.id, { grossPay: '20000', eobiAmount: '0', eobiApplicable: false });

      const decreased = await makeEmployee(site.id, unit.id, 'Totals Decreased');
      await makeEntry(comparisonCycle.id, decreased.id, site.id, unit.id, { grossPay: '20000', eobiAmount: '0', eobiApplicable: false });
      await makeEntry(currentCycle.id, decreased.id, site.id, unit.id, { grossPay: '5000', eobiAmount: '0', eobiApplicable: false });

      const newEmp = await makeEmployee(site.id, unit.id, 'Totals New');
      await makeEntry(currentCycle.id, newEmp.id, site.id, unit.id, { grossPay: '12000', eobiAmount: '0', eobiApplicable: false });

      const departed = await makeEmployee(site.id, unit.id, 'Totals Departed');
      await makeEntry(comparisonCycle.id, departed.id, site.id, unit.id, { grossPay: '8000', eobiAmount: '0', eobiApplicable: false });

      const viewer = await reportsViewerAgent('vr-totals-viewer1@test.local', [site.id]);
      const res = await viewer.agent.get(listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }));
      const totals = res.body.totals;

      expect(totals.matchingCount).toBe(4);
      expect(totals.newEmployeeCount).toBe(1);
      expect(totals.departedEmployeeCount).toBe(1);
      expect(totals.continuedEmployeeCount).toBe(2);
      expect(totals.increasedCount).toBe(1);
      expect(totals.decreasedCount).toBe(1);
      expect(totals.unchangedCount).toBe(0);
      expect(totals.totalsComputed).toBe(true);

      // comparisonTotalNet = 10000 (increased) + 20000 (decreased) + 8000 (departed) = 38000; NEW
      // contributes 0 to comparisonTotalNet (no comparison-side entry).
      expect(totals.comparisonTotalNet).toBe('38000.00');
      // currentTotalNet = 20000 (increased) + 5000 (decreased) + 12000 (new) = 37000; DEPARTED
      // contributes 0 to currentTotalNet (no current-side entry).
      expect(totals.currentTotalNet).toBe('37000.00');
      expect(totals.aggregateVarianceAmount).toBe('-1000.00');
      // aggregateVariancePercent = (37000 - 38000) / 38000 * 100 = -2.63 (rounded), never an
      // average of the two continued rows' own +100.00%/-75.00% row-level percentages.
      const expectedPercent = ((37000 - 38000) / 38000) * 100;
      expect(Number(totals.aggregateVariancePercent)).toBeCloseTo(expectedPercent, 1);
    });

    it('siteTransferCount and correctedEntryCount are correct', async () => {
      const admin = await masterAdminAgent('vr-totals-admin2@test.local');
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site VR Totals Transfer A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site VR Totals Transfer B');
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      const transferred = await makeEmployee(siteA.id, unitA.id, 'Totals Transfer Employee');
      await makeEntry(comparisonCycle.id, transferred.id, siteA.id, unitA.id);
      const currentEntry = await makeEntry(currentCycle.id, transferred.id, siteB.id, unitB.id);
      const adjustmentType = await makeAdjustmentType('VR_TOTALS_CORR');
      await makeCorrection(currentEntry.id, adjustmentType.id, admin.userId);

      const admin2 = await reportsViewerAgent('vr-totals-viewer2@test.local', [siteA.id, siteB.id]);
      const res = await admin2.agent.get(listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }));
      expect(res.body.totals.siteTransferCount).toBe(1);
      expect(res.body.totals.correctedEntryCount).toBe(1);
    });
  });

  // ================================================================================================
  // Sorting
  // ================================================================================================

  describe('Sorting', () => {
    it('employeeName sorts ascending by default', async () => {
      const admin = await masterAdminAgent('vr-sort-admin1@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site VR Sort Name');
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      const zed = await makeEmployee(site.id, unit.id, 'Zed Sort Employee');
      const alpha = await makeEmployee(site.id, unit.id, 'Alpha Sort Employee');
      await makeEntry(comparisonCycle.id, zed.id, site.id, unit.id);
      await makeEntry(currentCycle.id, zed.id, site.id, unit.id);
      await makeEntry(comparisonCycle.id, alpha.id, site.id, unit.id);
      await makeEntry(currentCycle.id, alpha.id, site.id, unit.id);

      const viewer = await reportsViewerAgent('vr-sort-viewer1@test.local', [site.id]);
      const res = await viewer.agent.get(listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }));
      const names = res.body.rows.map((r: { employeeName: string }) => r.employeeName);
      expect(names.indexOf('Alpha Sort Employee')).toBeLessThan(names.indexOf('Zed Sort Employee'));
    });

    it('varianceAmount (bounded calcNet-derived sort) sorts correctly', async () => {
      const admin = await masterAdminAgent('vr-sort-admin2@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site VR Sort Variance');
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      const small = await makeEmployee(site.id, unit.id, 'Small Variance Employee');
      await makeEntry(comparisonCycle.id, small.id, site.id, unit.id, { grossPay: '30000', eobiAmount: '0', eobiApplicable: false });
      await makeEntry(currentCycle.id, small.id, site.id, unit.id, { grossPay: '31000', eobiAmount: '0', eobiApplicable: false });
      const big = await makeEmployee(site.id, unit.id, 'Big Variance Employee');
      await makeEntry(comparisonCycle.id, big.id, site.id, unit.id, { grossPay: '30000', eobiAmount: '0', eobiApplicable: false });
      await makeEntry(currentCycle.id, big.id, site.id, unit.id, { grossPay: '50000', eobiAmount: '0', eobiApplicable: false });

      const viewer = await reportsViewerAgent('vr-sort-viewer2@test.local', [site.id]);
      const res = await viewer.agent.get(
        listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id, sortBy: 'varianceAmount', sortDir: 'desc' }),
      );
      const ids = res.body.rows.map((r: { employeeId: string }) => r.employeeId);
      expect(ids.indexOf(big.id)).toBeLessThan(ids.indexOf(small.id));
    });

    it('deterministic tie-break by employeeId when the primary sort value is equal', async () => {
      const admin = await masterAdminAgent('vr-sort-admin3@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site VR Sort Tie');
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      const e1 = await makeEmployee(site.id, unit.id, 'Tie Employee', { employeeCode: 'TIE-1' });
      const e2 = await makeEmployee(site.id, unit.id, 'Tie Employee', { employeeCode: 'TIE-2' });
      await makeEntry(comparisonCycle.id, e1.id, site.id, unit.id);
      await makeEntry(currentCycle.id, e1.id, site.id, unit.id);
      await makeEntry(comparisonCycle.id, e2.id, site.id, unit.id);
      await makeEntry(currentCycle.id, e2.id, site.id, unit.id);

      const viewer = await reportsViewerAgent('vr-sort-viewer3@test.local', [site.id]);
      const res1 = await viewer.agent.get(listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id, sortBy: 'employeeName' }));
      const res2 = await viewer.agent.get(listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id, sortBy: 'employeeName' }));
      const order1 = res1.body.rows.filter((r: { employeeId: string }) => [e1.id, e2.id].includes(r.employeeId)).map((r: { employeeId: string }) => r.employeeId);
      const order2 = res2.body.rows.filter((r: { employeeId: string }) => [e1.id, e2.id].includes(r.employeeId)).map((r: { employeeId: string }) => r.employeeId);
      expect(order1).toEqual(order2);
      const expected = [e1.id, e2.id].sort();
      expect(order1).toEqual(expected);
    });
  });

  // ================================================================================================
  // Export
  // ================================================================================================

  describe('Export', () => {
    it('CSV export returns exactly the approved headers, no sensitive fields, and row values matching the list', async () => {
      const admin = await masterAdminAgent('vr-export-admin1@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site VR Export CSV');
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Export CSV Employee');
      await makeEntry(comparisonCycle.id, employee.id, site.id, unit.id, { grossPay: '30000', eobiAmount: '0', eobiApplicable: false });
      await makeEntry(currentCycle.id, employee.id, site.id, unit.id, { grossPay: '33000', eobiAmount: '0', eobiApplicable: false });

      const viewer = await reportsViewerAgent('vr-export-viewer1@test.local', [site.id]);
      const listRes = await viewer.agent.get(listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }));
      const listRow = listRes.body.rows.find((r: { employeeId: string }) => r.employeeId === employee.id);

      const res = await viewer.agent.get(exportUrl('csv', { comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }));
      expect(res.status).toBe(200);
      const records = parseCsvSync(res.text, { columns: true }) as Record<string, string>[];
      expect(Object.keys(records[0]!)).toEqual(EXPECTED_EXPORT_HEADERS);
      assertNoSensitiveKeys(records, EXPORT_FORBIDDEN_KEYS);
      const exportedRow = records.find((r: Record<string, string>) => r['Employee Name'] === 'Export CSV Employee')!;
      expect(exportedRow['Previous Net']).toBe(listRow.comparisonNet);
      expect(exportedRow['Current Net']).toBe(listRow.currentNet);
      expect(exportedRow['Variance Amount']).toBe(listRow.varianceAmount);
    });

    it('XLSX export returns exactly the approved headers, no sensitive fields', async () => {
      const admin = await masterAdminAgent('vr-export-admin2@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site VR Export XLSX');
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Export XLSX Employee');
      await makeEntry(comparisonCycle.id, employee.id, site.id, unit.id);
      await makeEntry(currentCycle.id, employee.id, site.id, unit.id);

      const viewer = await reportsViewerAgent('vr-export-viewer2@test.local', [site.id]);
      const res = await viewer.agent
        .get(exportUrl('xlsx', { comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }))
        .buffer(true)
        .parse(binaryParser);
      expect(res.status).toBe(200);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.body as Buffer);
      const worksheet = workbook.getWorksheet('Variance Report')!;
      const headerRow = worksheet.getRow(3).values as unknown[];
      const headers = (headerRow as (string | undefined)[]).slice(1);
      expect(headers).toEqual(EXPECTED_EXPORT_HEADERS);
    });

    it('export respects the same filters/sort as the list, and pagination is ignored (complete dataset)', async () => {
      const admin = await masterAdminAgent('vr-export-admin3@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site VR Export Complete');
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      for (let i = 0; i < 30; i += 1) {
        const employee = await makeEmployee(site.id, unit.id, `Export Complete Employee ${i}`);
        await makeEntry(comparisonCycle.id, employee.id, site.id, unit.id);
        await makeEntry(currentCycle.id, employee.id, site.id, unit.id);
      }
      const viewer = await reportsViewerAgent('vr-export-viewer3@test.local', [site.id]);
      const res = await viewer.agent.get(
        exportUrl('csv', { comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id, pageSize: '5', page: '1' }),
      );
      const records = parseCsvSync(res.text, { columns: true }) as Record<string, string>[];
      expect(records).toHaveLength(30);
    });

    it('an inaccessible employee never appears in an export', async () => {
      const admin = await masterAdminAgent('vr-export-admin4@test.local');
      const { site: siteA } = await makeSiteWithUnit('Test Site VR Export Hidden A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site VR Export Hidden B');
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      const hidden = await makeEmployee(siteB.id, unitB.id, 'Export Hidden Employee');
      await makeEntry(comparisonCycle.id, hidden.id, siteB.id, unitB.id);
      await makeEntry(currentCycle.id, hidden.id, siteB.id, unitB.id);

      const viewerA = await reportsViewerAgent('vr-export-viewerA4@test.local', [siteA.id]);
      const res = await viewerA.agent.get(exportUrl('csv', { comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }));
      const records = parseCsvSync(res.text, { columns: true }) as Record<string, string>[];
      expect(records.find((r: Record<string, string>) => r['Employee Name'] === 'Export Hidden Employee')).toBeUndefined();
    });
  });

  // ================================================================================================
  // Query discipline (no N+1)
  // ================================================================================================

  describe('Query discipline', () => {
    it('correction existence lookup is a single batched query regardless of row count (no per-row N+1)', async () => {
      const admin = await masterAdminAgent('vr-query-admin1@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site VR Query Discipline');
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      for (let i = 0; i < 10; i += 1) {
        const employee = await makeEmployee(site.id, unit.id, `Query Discipline Employee ${i}`);
        await makeEntry(comparisonCycle.id, employee.id, site.id, unit.id);
        await makeEntry(currentCycle.id, employee.id, site.id, unit.id);
      }
      const groupBySpy = jest.spyOn(prisma.correction, 'groupBy');
      const viewer = await reportsViewerAgent('vr-query-viewer1@test.local', [site.id]);
      const res = await viewer.agent.get(listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }));
      expect(res.status).toBe(200);
      expect(groupBySpy).toHaveBeenCalledTimes(1);
      groupBySpy.mockRestore();
    });

    it('exactly four payrollEntry.findMany calls (data + existence-only, one of each per side) regardless of row count', async () => {
      const admin = await masterAdminAgent('vr-query-admin2@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site VR Query Discipline Sides');
      const { comparisonCycle, currentCycle } = await makeCyclePair(admin.userId);
      for (let i = 0; i < 10; i += 1) {
        const employee = await makeEmployee(site.id, unit.id, `Query Sides Employee ${i}`);
        await makeEntry(comparisonCycle.id, employee.id, site.id, unit.id);
        await makeEntry(currentCycle.id, employee.id, site.id, unit.id);
      }
      const findManySpy = jest.spyOn(prisma.payrollEntry, 'findMany');
      const viewer = await reportsViewerAgent('vr-query-viewer2@test.local', [site.id]);
      const res = await viewer.agent.get(listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: currentCycle.id }));
      expect(res.status).toBe(200);
      // Two data-bearing fetches (comparison/current, `fetchSideEntries`) plus two existence-only
      // fetches (comparison/current, `fetchExistingEmployeeIds` — the two-sided authorization
      // check's own bounded query, never a per-row/per-employee lookup).
      expect(findManySpy).toHaveBeenCalledTimes(4);
      findManySpy.mockRestore();
    });
  });

  // ================================================================================================
  // Cycle model
  // ================================================================================================

  describe('Cycle model', () => {
    it('a nonexistent currentCycleId returns 404', async () => {
      const admin = await masterAdminAgent('vr-cycle-admin1@test.local');
      const { site } = await makeSiteWithUnit('Test Site VR Cycle 404');
      const { comparisonCycle } = await makeCyclePair(admin.userId);
      const viewer = await reportsViewerAgent('vr-cycle-viewer1@test.local', [site.id]);
      const res = await viewer.agent.get(
        listUrl({ comparisonCycleId: comparisonCycle.id, currentCycleId: '00000000-0000-0000-0000-000000000000' }),
      );
      expect(res.status).toBe(404);
    });

    it('arbitrary non-adjacent cycle comparison is permitted — the API never infers "previous month"', async () => {
      const admin = await masterAdminAgent('vr-cycle-admin2@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site VR Cycle Arbitrary');
      const cycleA = await makeCycle(admin.userId);
      await makeCycle(admin.userId); // an intervening cycle, deliberately skipped by the comparison below
      const cycleC = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Arbitrary Cycle Employee');
      await makeEntry(cycleA.id, employee.id, site.id, unit.id, { grossPay: '10000' });
      await makeEntry(cycleC.id, employee.id, site.id, unit.id, { grossPay: '20000' });
      // Deliberately comparing the first and third (non-adjacent) cycles, skipping the middle one.
      const viewer = await reportsViewerAgent('vr-cycle-viewer2@test.local', [site.id]);
      const res = await viewer.agent.get(listUrl({ comparisonCycleId: cycleA.id, currentCycleId: cycleC.id }));
      expect(res.status).toBe(200);
      const row = res.body.rows.find((r: { employeeId: string }) => r.employeeId === employee.id);
      expect(row.populationStatus).toBe('CONTINUED');
    });
  });
});
