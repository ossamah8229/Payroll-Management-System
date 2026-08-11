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

/** The declared export header order (`SALARY_RELEASE_REPORT_EXPORT_HEADERS`,
 * `salary-release-report.service.ts`) — duplicated here as a literal, not imported, so a test
 * asserting against it stays a genuine independent check rather than trivially agreeing with
 * whatever the source constant says. */
const EXPECTED_EXPORT_HEADERS = [
  'Employee Code',
  'Employee Name',
  'Project Site',
  'Primary Unit',
  'Additional Unit Count',
  'Designation',
  'Row Status',
  'Original Released Amount',
  'Correction Balance Payable',
  'Correction Balance Recovery',
  'Released Date',
  'Correction Count',
];

/** Substrings that must never appear as an export column header or a parsed-row object key, on top
 * of `assertNoSensitiveKeys`'s own defaults (passwordhash/session/csrf/storagekey/absolutepath) —
 * CNIC, every banking field, release-actor identity, payment method, and correction-reason detail
 * are all fields this report's flat vocabulary deliberately excludes (frozen decisions §9–§13). */
const FORBIDDEN_KEYS = ['cnic', 'accountnumber', 'iban', 'bank', 'branchcode', 'releasedby', 'reason', 'paymentmethod'];

describe('Phase 7 Reports — Salary Release Report (Checkpoint 1A)', () => {
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
      permissionKeys: [
        PERMISSIONS.PAYROLL_CYCLE_MANAGE,
        PERMISSIONS.PAYROLL_ENTRY,
        PERMISSIONS.PAYROLL_RELEASE,
        PERMISSIONS.PAYROLL_VIEW,
        PERMISSIONS.CORRECTIONS_APPROVE,
        PERMISSIONS.REPORTS_VIEW,
      ],
    });
  }

  /** Holds exactly `reports:view` — one of the two approved OR-gate permissions. */
  async function reportsViewerAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_SRR_REPORTS_VIEWER',
      permissionKeys: [PERMISSIONS.REPORTS_VIEW],
      siteIds,
    });
  }

  /** Holds exactly `payroll:view` (no `reports:view`, no `payroll:release`) — the other approved
   * OR-gate permission, proving it alone is sufficient. */
  async function payrollViewOnlyAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_SRR_PAYROLL_VIEW_ONLY',
      permissionKeys: [PERMISSIONS.PAYROLL_VIEW],
      siteIds,
    });
  }

  /** A real `FINANCE`-role-coded agent holding Finance's own established permission set
   * (`payroll:view`, `payroll:release`, `bank-sheets:view`, `payslips:view`) — deliberately no
   * `reports:view` — proving the role that actually executes releases can view this report. */
  async function financeAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.FINANCE,
      permissionKeys: [PERMISSIONS.PAYROLL_VIEW, PERMISSIONS.PAYROLL_RELEASE, PERMISSIONS.BANK_SHEETS_VIEW, PERMISSIONS.PAYSLIPS_VIEW],
      siteIds,
    });
  }

  /** Holds `payroll:release` but deliberately NOT `payroll:view` — proves `payroll:release` alone
   * does not imply access to this view-only report (frozen decision — Permission section). */
  async function payrollReleaseOnlyAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_SRR_RELEASE_ONLY',
      permissionKeys: [PERMISSIONS.PAYROLL_RELEASE],
      siteIds,
    });
  }

  /** Holds `statements:view` but neither `reports:view` nor `payroll:view` — proves this report
   * is never reachable through Employee Payroll History's own, more sensitive permission. */
  async function statementsOnlyAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_SRR_STATEMENTS_ONLY',
      permissionKeys: [PERMISSIONS.STATEMENTS_VIEW],
      siteIds,
    });
  }

  async function noPermissionAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_SRR_NO_PERM',
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

  async function makeSiteWithUnit(name: string) {
    const site = await prisma.projectSite.create({ data: { name } });
    const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} Unit`, code: 'U-1' } });
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
    allowance?: string;
    eobiAmount?: string;
    eobiApplicable?: boolean;
    advanceDeduction?: string;
    eidAdvanceDeduction?: string;
    fine?: string;
    correctionBalancePayable?: string;
    correctionBalanceRecovery?: string;
    hold?: boolean;
    released?: boolean;
    releasedAt?: Date;
    releasedBy?: string;
    payoutOutcome?: 'NO_PAY_DUE' | 'RECOVERY_DUE';
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
        allowance: overrides.allowance ?? '0',
        leaveDays: '0',
        leaveRate: null,
        eobiAmount: overrides.eobiAmount ?? '400',
        eobiApplicable: overrides.eobiApplicable ?? true,
        advanceDeduction: overrides.advanceDeduction ?? '0',
        eidAdvanceDeduction: overrides.eidAdvanceDeduction ?? '0',
        fine: overrides.fine ?? '0',
        correctionBalancePayable: overrides.correctionBalancePayable ?? '0',
        correctionBalanceRecovery: overrides.correctionBalanceRecovery ?? '0',
        hold: overrides.hold ?? false,
        released: overrides.released ?? false,
        releasedAt: overrides.releasedAt ?? null,
        releasedBy: overrides.releasedBy ?? null,
        payoutOutcome: overrides.payoutOutcome ?? null,
        workLines: {
          create: [{ siteId, unitId, days: overrides.days ?? '26', otHours: '0', otRate: null, cycleDays: 30 }],
        },
      },
      include: { workLines: true },
    });
  }

  async function addSecondWorkLine(entryId: string, siteId: string, unitId: string) {
    return prisma.payrollEntryWorkLine.create({
      data: { payrollEntryId: entryId, siteId, unitId, days: '4', otHours: '0', cycleDays: 30, sortOrder: 1 },
    });
  }

  async function releaseUnit(admin: Awaited<ReturnType<typeof masterAdminAgent>>, cycleId: string, unitId: string, expectStatus = 201) {
    const res = await admin.agent.post(`/api/v1/payroll-cycles/${cycleId}/units/${unitId}/release`).set('x-csrf-token', admin.csrfToken).send({});
    expect(res.status).toBe(expectStatus);
    return res;
  }

  async function makeAdjustmentType(code: string) {
    return prisma.adjustmentType.create({ data: { code: `TEST_${code}`, label: code } });
  }

  async function makeCorrection(payrollEntryId: string, adjustmentTypeId: string, approvedById: string, overrides: Record<string, unknown> = {}) {
    return prisma.correction.create({
      data: {
        payrollEntryId,
        field: 'FINE',
        oldValue: '0',
        newValue: '100',
        oldNetSalary: '29600',
        newNetSalary: '29500',
        adjustmentTypeId,
        reason: 'Attendance miscounted for this period',
        approvedById,
        ...overrides,
      },
    });
  }

  function listUrl(params: Record<string, string> = {}) {
    return `/api/v1/reports/salary-release?${new URLSearchParams(params).toString()}`;
  }
  function exportUrl(format: 'csv' | 'xlsx', params: Record<string, string> = {}) {
    return `/api/v1/reports/salary-release/export?${new URLSearchParams({ format, ...params }).toString()}`;
  }

  // ================================================================================================
  // Authorization — the OR permission gate
  // ================================================================================================

  describe('Authorization (OR permission gate: reports:view OR payroll:view)', () => {
    it('rejects a request with no session with 401', async () => {
      const admin = await masterAdminAgent('srr-auth-admin0@test.local');
      const cycle = await makeCycle(admin.userId);
      const res = await request(app).get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(401);
    });

    it('a user with only reports:view is allowed', async () => {
      const admin = await masterAdminAgent('srr-auth-admin1@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site SRR Auth Reports');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Reports Only Employee');
      await makeEntry(cycle.id, employee.id, site.id, unit.id);

      const viewer = await reportsViewerAgent('srr-auth-reportsonly@test.local', [site.id]);
      const res = await viewer.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(1);
    });

    it('a user with only payroll:view is allowed', async () => {
      const admin = await masterAdminAgent('srr-auth-admin2@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site SRR Auth PayrollView');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Payroll View Only Employee');
      await makeEntry(cycle.id, employee.id, site.id, unit.id);

      const viewer = await payrollViewOnlyAgent('srr-auth-payrollviewonly@test.local', [site.id]);
      const res = await viewer.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(1);
    });

    it('a real Finance-role agent (payroll:view + payroll:release, no reports:view) is allowed', async () => {
      const admin = await masterAdminAgent('srr-auth-admin3@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site SRR Auth Finance');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Finance Visible Employee');
      await makeEntry(cycle.id, employee.id, site.id, unit.id);

      const finance = await financeAgent('srr-auth-finance@test.local', [site.id]);
      const res = await finance.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(1);
    });

    it('a user with neither reports:view nor payroll:view is rejected with 403', async () => {
      const admin = await masterAdminAgent('srr-auth-admin4@test.local');
      const { site } = await makeSiteWithUnit('Test Site SRR Auth None');
      const cycle = await makeCycle(admin.userId);
      const noPerm = await noPermissionAgent('srr-auth-noperm@test.local', [site.id]);
      const res = await noPerm.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(403);
    });

    it('a user with only statements:view is rejected with 403 (never reachable via Employee Payroll History\'s own permission)', async () => {
      const admin = await masterAdminAgent('srr-auth-admin5@test.local');
      const { site } = await makeSiteWithUnit('Test Site SRR Auth Statements');
      const cycle = await makeCycle(admin.userId);
      const statementsOnly = await statementsOnlyAgent('srr-auth-statementsonly@test.local', [site.id]);
      const res = await statementsOnly.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(403);
    });

    it('a user holding only payroll:release (no payroll:view, no reports:view) is rejected with 403 — payroll:release alone never implies access', async () => {
      const admin = await masterAdminAgent('srr-auth-admin6@test.local');
      const { site } = await makeSiteWithUnit('Test Site SRR Auth ReleaseOnly');
      const cycle = await makeCycle(admin.userId);
      const releaseOnly = await payrollReleaseOnlyAgent('srr-auth-releaseonly@test.local', [site.id]);
      const res = await releaseOnly.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(403);
    });

    it('Master Admin (global authority) can list with no site restriction', async () => {
      const admin = await masterAdminAgent('srr-auth-admin7@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site SRR Auth Master');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Master Visible Employee');
      await makeEntry(cycle.id, employee.id, site.id, unit.id);

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(200);
      expect(res.body.rows.some((row: { employeeId: string }) => row.employeeId === employee.id)).toBe(true);
    });

    it('site scoping applies identically for a reports:view-admitted caller', async () => {
      const admin = await masterAdminAgent('srr-auth-admin8@test.local');
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site SRR Scope Reports A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site SRR Scope Reports B');
      const cycle = await makeCycle(admin.userId);
      const employeeA = await makeEmployee(siteA.id, unitA.id, 'Scope Reports Employee A');
      const employeeB = await makeEmployee(siteB.id, unitB.id, 'Scope Reports Employee B');
      await makeEntry(cycle.id, employeeA.id, siteA.id, unitA.id);
      await makeEntry(cycle.id, employeeB.id, siteB.id, unitB.id);

      const viewerA = await reportsViewerAgent('srr-scope-reportsA@test.local', [siteA.id]);
      const res = await viewerA.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0].siteId).toBe(siteA.id);
      expect(res.body.totals.matchingCount).toBe(1);
    });

    it('site scoping applies identically for a payroll:view-admitted caller', async () => {
      const admin = await masterAdminAgent('srr-auth-admin9@test.local');
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site SRR Scope Payroll A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site SRR Scope Payroll B');
      const cycle = await makeCycle(admin.userId);
      const employeeA = await makeEmployee(siteA.id, unitA.id, 'Scope Payroll Employee A');
      const employeeB = await makeEmployee(siteB.id, unitB.id, 'Scope Payroll Employee B');
      await makeEntry(cycle.id, employeeA.id, siteA.id, unitA.id);
      await makeEntry(cycle.id, employeeB.id, siteB.id, unitB.id);

      const viewerA = await payrollViewOnlyAgent('srr-scope-payrollA@test.local', [siteA.id]);
      const res = await viewerA.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0].siteId).toBe(siteA.id);
      expect(res.body.totals.matchingCount).toBe(1);
    });

    it('an explicit siteIds filter naming an inaccessible site is rejected with 403, never silently narrowed', async () => {
      const admin = await masterAdminAgent('srr-auth-admin10@test.local');
      const { site: siteA } = await makeSiteWithUnit('Test Site SRR Auth Explicit A');
      const { site: siteB } = await makeSiteWithUnit('Test Site SRR Auth Explicit B');
      const cycle = await makeCycle(admin.userId);
      const viewerA = await reportsViewerAgent('srr-auth-explicitA@test.local', [siteA.id]);
      const res = await viewerA.agent.get(listUrl({ cycleId: cycle.id, siteIds: siteB.id }));
      expect(res.status).toBe(403);
    });

    it('historical transfer: a site-scoped viewer sees only the entry attributed to their own site, using PayrollEntry.siteId, never Employee.siteId', async () => {
      const admin = await masterAdminAgent('srr-auth-admin11@test.local');
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site SRR Transfer A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site SRR Transfer B');
      const cycle = await makeCycle(admin.userId);
      // Employee currently lives at Site B (their *current* Employee.siteId), but this cycle's
      // entry was created while they were still at Site A (frozen PayrollEntry.siteId).
      const employee = await makeEmployee(siteB.id, unitB.id, 'Transferred Employee');
      const entry = await makeEntry(cycle.id, employee.id, siteA.id, unitA.id);

      const viewerA = await reportsViewerAgent('srr-transfer-viewerA@test.local', [siteA.id]);
      const resA = await viewerA.agent.get(listUrl({ cycleId: cycle.id }));
      expect(resA.status).toBe(200);
      expect(resA.body.rows).toHaveLength(1);
      expect(resA.body.rows[0].payrollEntryId).toBe(entry.id);
      expect(resA.body.rows[0].siteId).toBe(siteA.id);

      const viewerB = await reportsViewerAgent('srr-transfer-viewerB@test.local', [siteB.id]);
      const resB = await viewerB.agent.get(listUrl({ cycleId: cycle.id }));
      expect(resB.status).toBe(200);
      expect(resB.body.rows).toHaveLength(0);
    });
  });

  // ================================================================================================
  // Cycle (required, single, not a range)
  // ================================================================================================

  describe('Cycle requirement', () => {
    it('rejects a request with no cycleId at all with 400', async () => {
      const admin = await masterAdminAgent('srr-cycle-admin1@test.local');
      const res = await admin.agent.get('/api/v1/reports/salary-release');
      expect(res.status).toBe(400);
    });

    it('rejects a malformed cycleId with 400, never reaching the database', async () => {
      const admin = await masterAdminAgent('srr-cycle-admin2@test.local');
      const res = await admin.agent.get(listUrl({ cycleId: 'not-a-uuid' }));
      expect(res.status).toBe(400);
    });

    it('rejects a nonexistent (but well-formed) cycleId with 404', async () => {
      const admin = await masterAdminAgent('srr-cycle-admin3@test.local');
      const res = await admin.agent.get(listUrl({ cycleId: '00000000-0000-0000-0000-000000000000' }));
      expect(res.status).toBe(404);
    });

    it('does not accept a fromCycleId/toCycleId range — only a single cycleId', async () => {
      const admin = await masterAdminAgent('srr-cycle-admin4@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site SRR Cycle Range');
      const cycle1 = await makeCycle(admin.userId);
      const cycle2 = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Cycle Range Employee');
      await makeEntry(cycle1.id, employee.id, site.id, unit.id);
      await makeEntry(cycle2.id, employee.id, site.id, unit.id);

      const res = await admin.agent.get(listUrl({ cycleId: cycle1.id, fromCycleId: cycle1.id, toCycleId: cycle2.id }));
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.cycle.id).toBe(cycle1.id);
    });
  });

  // ================================================================================================
  // Row grain, columns, and sensitive-field exclusion
  // ================================================================================================

  describe('Row grain and columns', () => {
    it('one row = one PayrollEntry, with every approved column present', async () => {
      const admin = await masterAdminAgent('srr-row-admin1@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site SRR Row 1');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Row Employee', { employeeCode: 'EMP-ROW-1' });
      await makeEntry(cycle.id, employee.id, site.id, unit.id, { correctionBalancePayable: '1000', correctionBalanceRecovery: '200' });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(1);
      const row = res.body.rows[0];

      expect(row.payrollEntryId).toBeDefined();
      expect(row.employeeId).toBe(employee.id);
      expect(row.employeeCode).toBe('EMP-ROW-1');
      expect(row.employeeName).toBe('Row Employee');
      expect(row.siteId).toBe(site.id);
      expect(row.siteName).toBe(site.name);
      expect(row.primaryUnit.id).toBe(unit.id);
      expect(row.additionalUnitCount).toBe(0);
      expect(row.designation).toBe('Guard');
      expect(row.rowStatus).toBe('PENDING');
      expect(row.originalReleasedAmount).toBeNull();
      expect(row.correctionBalancePayable).toBe('1000.00');
      expect(row.correctionBalanceRecovery).toBe('200.00');
      expect(row.releasedAt).toBeNull();
      expect(row.correctionCount).toBe(0);
    });

    it('shows "Primary Unit (+N more)" via additionalUnitCount for a multi-unit employee, primary chosen by lowest sortOrder with a deterministic id tie-break', async () => {
      const admin = await masterAdminAgent('srr-row-admin2@test.local');
      const { site, unit: unitPrimary } = await makeSiteWithUnit('Test Site SRR Multi Unit');
      const unitSecond = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'Second Unit' } });
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unitPrimary.id, 'Multi Unit Employee');
      const entry = await makeEntry(cycle.id, employee.id, site.id, unitPrimary.id);
      await addSecondWorkLine(entry.id, site.id, unitSecond.id);

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(200);
      const row = res.body.rows[0];
      expect(row.primaryUnit.id).toBe(unitPrimary.id);
      expect(row.additionalUnitCount).toBe(1);
      // No per-unit financial split or release-event grain leaks onto the row.
      expect(row.unitBreakdown).toBeUndefined();
      expect(row.releaseEvents).toBeUndefined();
    });

    it('never exposes Released By, CNIC, banking, or a Payment Method field on any row', async () => {
      const admin = await masterAdminAgent('srr-row-admin3@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site SRR Sensitive');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Sensitive Employee', { cnic: '1234512345671' });
      await makeEntry(cycle.id, employee.id, site.id, unit.id, {
        released: true,
        releasedAt: new Date(),
        releasedBy: admin.userId,
      });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      const row = res.body.rows[0];
      expect(row.releasedBy).toBeUndefined();
      expect(row.releasedById).toBeUndefined();
      expect(row.releasedByName).toBeUndefined();
      expect(row.paymentMethod).toBeUndefined();
      expect(row.cnic).toBeUndefined();
      expect(row.bankId).toBeUndefined();
      expect(row.accountNumber).toBeUndefined();
      expect(row.iban).toBeUndefined();
      expect(row.branchCode).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('1234512345671');
      expect(JSON.stringify(res.body)).not.toContain(admin.userId);
      assertNoSensitiveKeys(res.body, FORBIDDEN_KEYS);
    });
  });

  // ================================================================================================
  // Row status: Held / Released / No Pay Due / Recovery Due / Pending
  // ================================================================================================

  describe('Row status derivation (canonical derivePayrollEntryRowStatus)', () => {
    it('classifies Held, Pending, No Pay Due, Recovery Due correctly, and Released after a real Unit release', async () => {
      const admin = await masterAdminAgent('srr-status-admin1@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site SRR Status');
      const cycle = await makeCycle(admin.userId);

      const heldEmployee = await makeEmployee(site.id, unit.id, 'Held Employee');
      await makeEntry(cycle.id, heldEmployee.id, site.id, unit.id, { hold: true });

      const pendingEmployee = await makeEmployee(site.id, unit.id, 'Pending Employee');
      await makeEntry(cycle.id, pendingEmployee.id, site.id, unit.id);

      const noPayEmployee = await makeEmployee(site.id, unit.id, 'No Pay Employee');
      await makeEntry(cycle.id, noPayEmployee.id, site.id, unit.id, { payoutOutcome: 'NO_PAY_DUE' });

      const recoveryEmployee = await makeEmployee(site.id, unit.id, 'Recovery Employee');
      await makeEntry(cycle.id, recoveryEmployee.id, site.id, unit.id, { payoutOutcome: 'RECOVERY_DUE' });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, pageSize: '50' }));
      expect(res.status).toBe(200);
      const byEmployee = (id: string) => res.body.rows.find((r: { employeeId: string }) => r.employeeId === id);

      expect(byEmployee(heldEmployee.id).rowStatus).toBe('HELD');
      expect(byEmployee(pendingEmployee.id).rowStatus).toBe('PENDING');
      expect(byEmployee(noPayEmployee.id).rowStatus).toBe('NO_PAY_DUE');
      expect(byEmployee(recoveryEmployee.id).rowStatus).toBe('RECOVERY_DUE');
      // Only a genuinely RELEASED row ever carries an amount; a HELD/PENDING/NO_PAY_DUE/
      // RECOVERY_DUE row never has a pending calculated net salary mislabeled as released.
      expect(byEmployee(heldEmployee.id).originalReleasedAmount).toBeNull();
      expect(byEmployee(pendingEmployee.id).originalReleasedAmount).toBeNull();
      expect(byEmployee(noPayEmployee.id).originalReleasedAmount).toBeNull();
      expect(byEmployee(recoveryEmployee.id).originalReleasedAmount).toBeNull();
      // Released At is a plain stored column, never derived — a HELD/PENDING row was never touched
      // by any release sweep, so it must never carry a timestamp.
      expect(byEmployee(heldEmployee.id).releasedAt).toBeNull();
      expect(byEmployee(pendingEmployee.id).releasedAt).toBeNull();

      const releasedEmployee = await makeEmployee(site.id, unit.id, 'Released Employee');
      await makeEntry(cycle.id, releasedEmployee.id, site.id, unit.id);
      await releaseUnit(admin, cycle.id, unit.id);

      const res2 = await admin.agent.get(listUrl({ cycleId: cycle.id, pageSize: '50' }));
      const byEmployee2 = (id: string) => res2.body.rows.find((r: { employeeId: string }) => r.employeeId === id);
      expect(byEmployee2(releasedEmployee.id).rowStatus).toBe('RELEASED');
      expect(byEmployee2(releasedEmployee.id).releasedAt).not.toBeNull();
      expect(byEmployee2(releasedEmployee.id).originalReleasedAmount).not.toBeNull();
      expect(Number(byEmployee2(releasedEmployee.id).originalReleasedAmount)).toBeGreaterThan(0);
    });

    it('the rowStatus filter narrows correctly and is equivalent to the derived status', async () => {
      const admin = await masterAdminAgent('srr-status-admin2@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site SRR Status Filter');
      const cycle = await makeCycle(admin.userId);
      const held = await makeEmployee(site.id, unit.id, 'Held Filter Employee');
      await makeEntry(cycle.id, held.id, site.id, unit.id, { hold: true });
      const pending = await makeEmployee(site.id, unit.id, 'Pending Filter Employee');
      await makeEntry(cycle.id, pending.id, site.id, unit.id);

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, rowStatus: 'HELD' }));
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0].employeeId).toBe(held.id);
    });
  });

  // ================================================================================================
  // Release domain semantics — multi-Unit completion, late/straggler sweep, held exclusion
  // ================================================================================================

  describe('Release semantics (read-only — never mutates or reinterprets release mechanics)', () => {
    it('an entry touching two Units stays non-RELEASED until every touched Unit has released', async () => {
      const admin = await masterAdminAgent('srr-release-admin1@test.local');
      const { site, unit: unitA } = await makeSiteWithUnit('Test Site SRR MultiUnit Release A');
      const unitB = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'MultiUnit Release B' } });
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unitA.id, 'Split Unit Employee');
      const entry = await makeEntry(cycle.id, employee.id, site.id, unitA.id);
      await addSecondWorkLine(entry.id, site.id, unitB.id);

      // Only Unit A releases — the entry touches Unit B too, so it must remain unresolved.
      await releaseUnit(admin, cycle.id, unitA.id);
      const resAfterA = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(resAfterA.body.rows.find((r: { employeeId: string }) => r.employeeId === employee.id).rowStatus).toBe('PENDING');

      // Unit B now also releases — the sweep now resolves the entry, preserving one entry / one
      // net salary / one release outcome even for a genuinely split employee (Principle 1/6).
      await releaseUnit(admin, cycle.id, unitB.id);
      const resAfterB = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      const row = resAfterB.body.rows.find((r: { employeeId: string }) => r.employeeId === employee.id);
      expect(row.rowStatus).toBe('RELEASED');
      expect(row.releasedAt).not.toBeNull();
    });

    it('held entries are excluded from the ordinary release sweep entirely, and a Late/Straggler Sweep releases a newly-eligible entry created after the Unit already released', async () => {
      const admin = await masterAdminAgent('srr-release-admin2@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site SRR Late Sweep');
      const cycle = await makeCycle(admin.userId);

      const earlyEmployee = await makeEmployee(site.id, unit.id, 'Early Employee');
      await makeEntry(cycle.id, earlyEmployee.id, site.id, unit.id);
      await releaseUnit(admin, cycle.id, unit.id);

      // A held entry present at original release time must never be swept — it stays HELD even
      // after the Unit has released.
      const heldEmployee = await makeEmployee(site.id, unit.id, 'Held At Release Employee');
      await makeEntry(cycle.id, heldEmployee.id, site.id, unit.id, { hold: true });

      const res1 = await admin.agent.get(listUrl({ cycleId: cycle.id, pageSize: '50' }));
      expect(res1.body.rows.find((r: { employeeId: string }) => r.employeeId === heldEmployee.id).rowStatus).toBe('HELD');

      // A genuinely new (late) entry, created for this Unit after it already released this
      // cycle — calling release again re-sweeps only newly-eligible entries (the Late/Straggler
      // Sweep), never re-touching the already-resolved early entry, and never rejecting outright
      // the way a plain duplicate "release again" click would.
      const lateEmployee = await makeEmployee(site.id, unit.id, 'Late Employee');
      const lateEntry = await makeEntry(cycle.id, lateEmployee.id, site.id, unit.id);

      const res2 = await admin.agent.get(listUrl({ cycleId: cycle.id, pageSize: '50' }));
      expect(res2.body.rows.find((r: { employeeId: string }) => r.employeeId === lateEmployee.id).rowStatus).toBe('PENDING');

      await releaseUnit(admin, cycle.id, unit.id);

      const res3 = await admin.agent.get(listUrl({ cycleId: cycle.id, pageSize: '50' }));
      const lateRow = res3.body.rows.find((r: { employeeId: string }) => r.employeeId === lateEmployee.id);
      expect(lateRow.rowStatus).toBe('RELEASED');
      expect(lateRow.payrollEntryId).toBe(lateEntry.id);
      // The already-resolved early entry and the still-held entry are untouched by the sweep.
      expect(res3.body.rows.find((r: { employeeId: string }) => r.employeeId === heldEmployee.id).rowStatus).toBe('HELD');
    });

    it('NO_PAY_DUE and RECOVERY_DUE entries resolved by a real release sweep are never shown as RELEASED and never carry an Original Released Amount', async () => {
      const admin = await masterAdminAgent('srr-release-admin3@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site SRR Payout Outcomes');
      const cycle = await makeCycle(admin.userId);

      // Zero worked days, EOBI inapplicable — resolves to exactly netSalary = 0 on release.
      const noPayEmployee = await makeEmployee(site.id, unit.id, 'Real No Pay Employee');
      await makeEntry(cycle.id, noPayEmployee.id, site.id, unit.id, { grossPay: '0', eobiApplicable: false, days: '0', eobiAmount: '0' });

      // A large fine relative to earnings resolves negative on release.
      const recoveryEmployee = await makeEmployee(site.id, unit.id, 'Real Recovery Employee');
      await makeEntry(cycle.id, recoveryEmployee.id, site.id, unit.id, { grossPay: '1000', days: '1', eobiApplicable: false, eobiAmount: '0', fine: '5000' });

      await releaseUnit(admin, cycle.id, unit.id);

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, pageSize: '50' }));
      const noPayRow = res.body.rows.find((r: { employeeId: string }) => r.employeeId === noPayEmployee.id);
      const recoveryRow = res.body.rows.find((r: { employeeId: string }) => r.employeeId === recoveryEmployee.id);

      expect(noPayRow.rowStatus).toBe('NO_PAY_DUE');
      expect(noPayRow.originalReleasedAmount).toBeNull();
      expect(noPayRow.releasedAt).toBeNull();

      expect(recoveryRow.rowStatus).toBe('RECOVERY_DUE');
      expect(recoveryRow.originalReleasedAmount).toBeNull();
      expect(recoveryRow.releasedAt).toBeNull();
    });
  });

  // ================================================================================================
  // Original Released Amount — the financial-correctness-critical regression
  // ================================================================================================

  describe('Original Released Amount — immutability after release (critical regression)', () => {
    it('a released entry\'s Original Released Amount survives a real post-release correction unchanged, and correction/balance-salary context stays separate', async () => {
      const admin = await masterAdminAgent('srr-immutable-admin1@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site SRR Immutable');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Immutable Amount Employee', { employeeCode: 'IMM-1' });
      const entry = await makeEntry(cycle.id, employee.id, site.id, unit.id, { grossPay: '30000', days: '30' });

      // 1. Release the entry for real, through the actual release endpoint.
      await releaseUnit(admin, cycle.id, unit.id);

      const beforeStored = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
      expect(beforeStored.released).toBe(true);
      expect(beforeStored.grossPay.toFixed(2)).toBe('30000.00');

      // 2. Capture the report's own Original Released Amount immediately after release.
      const before = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      const beforeRow = before.body.rows.find((r: { employeeId: string }) => r.employeeId === employee.id);
      expect(beforeRow.rowStatus).toBe('RELEASED');
      expect(beforeRow.originalReleasedAmount).not.toBeNull();
      const capturedAmount = beforeRow.originalReleasedAmount;
      expect(beforeRow.correctionBalancePayable).toBe('0.00');
      expect(beforeRow.correctionBalanceRecovery).toBe('0.00');

      // 3. Perform a permitted post-release correction workflow directly against the append-only
      // Correction/BalanceAdjustment tables — the real, structurally-enforced write path a
      // Correction approval uses (never a direct PayrollEntry mutation; see
      // `salary-release-report.service.ts`'s own top-of-module immutability trace).
      const adjustmentType = await makeAdjustmentType('SRR_IMMUTABLE');
      await makeCorrection(entry.id, adjustmentType.id, admin.userId, {
        field: 'GROSS_PAY',
        oldValue: '30000',
        newValue: '35000',
        oldNetSalary: capturedAmount,
        newNetSalary: '34600',
      });

      // 4. Verify the original released PayrollEntry row itself remains byte-for-byte immutable.
      const afterStored = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
      expect(afterStored.grossPay.toFixed(2)).toBe('30000.00');
      expect(afterStored.correctionBalancePayable.toFixed(2)).toBe('0.00');
      expect(afterStored.correctionBalanceRecovery.toFixed(2)).toBe('0.00');
      expect(afterStored.version).toBe(beforeStored.version);
      expect(afterStored.updatedAt.getTime()).toBe(beforeStored.updatedAt.getTime());

      // 5. Verify the Salary Release Report's own Original Released Amount is unchanged.
      const after = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      const afterRow = after.body.rows.find((r: { employeeId: string }) => r.employeeId === employee.id);
      expect(afterRow.originalReleasedAmount).toBe(capturedAmount);
      expect(afterRow.rowStatus).toBe('RELEASED');

      // 6. Verify correctionCount reflects the new Correction (visible, but never folded into the
      // original release figure), and Correction Balance Payable/Recovery on THIS entry remain
      // untouched — a materialization can never target an already-released entry (structurally
      // enforced by `determineMaterialization`'s `TARGET_ENTRY_ALREADY_RELEASED` gate), so any
      // resulting settlement would land on a later Draft-cycle entry, never back onto this one.
      expect(afterRow.correctionCount).toBe(1);
      expect(afterRow.correctionBalancePayable).toBe('0.00');
      expect(afterRow.correctionBalanceRecovery).toBe('0.00');
    });

    it('a materialized correction settlement on a LATER cycle\'s entry never contaminates the ORIGINATING released entry\'s Original Released Amount', async () => {
      const admin = await masterAdminAgent('srr-immutable-admin2@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site SRR Immutable Later Cycle');
      const cycle1 = await makeCycle(admin.userId);
      const cycle2 = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Later Cycle Employee');
      await makeEntry(cycle1.id, employee.id, site.id, unit.id, { grossPay: '30000', days: '30' });
      await releaseUnit(admin, cycle1.id, unit.id);

      const originBefore = await admin.agent.get(listUrl({ cycleId: cycle1.id }));
      const originRowBefore = originBefore.body.rows.find((r: { employeeId: string }) => r.employeeId === employee.id);
      const capturedAmount = originRowBefore.originalReleasedAmount;

      // A later cycle's own entry receives a materialized correctionBalancePayable directly
      // (simulating the settlement pipeline's own real write target — a still-unreleased,
      // later-cycle entry, never the originating one).
      await makeEntry(cycle2.id, employee.id, site.id, unit.id, { correctionBalancePayable: '2500' });

      const originAfter = await admin.agent.get(listUrl({ cycleId: cycle1.id }));
      const originRowAfter = originAfter.body.rows.find((r: { employeeId: string }) => r.employeeId === employee.id);
      expect(originRowAfter.originalReleasedAmount).toBe(capturedAmount);
      expect(originRowAfter.correctionBalancePayable).toBe('0.00');

      const laterRes = await admin.agent.get(listUrl({ cycleId: cycle2.id }));
      const laterRow = laterRes.body.rows.find((r: { employeeId: string }) => r.employeeId === employee.id);
      expect(laterRow.correctionBalancePayable).toBe('2500.00');
      expect(laterRow.rowStatus).toBe('PENDING');
      expect(laterRow.originalReleasedAmount).toBeNull();
    });
  });

  // ================================================================================================
  // Filtering: Site, Unit, Row Status, Has Correction
  // ================================================================================================

  describe('Filtering', () => {
    it('filters by siteIds (multi-select)', async () => {
      const admin = await masterAdminAgent('srr-filter-admin1@test.local');
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site SRR Filter A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site SRR Filter B');
      const { site: siteC, unit: unitC } = await makeSiteWithUnit('Test Site SRR Filter C');
      const cycle = await makeCycle(admin.userId);
      const empA = await makeEmployee(siteA.id, unitA.id, 'Filter Employee A');
      const empB = await makeEmployee(siteB.id, unitB.id, 'Filter Employee B');
      const empC = await makeEmployee(siteC.id, unitC.id, 'Filter Employee C');
      await makeEntry(cycle.id, empA.id, siteA.id, unitA.id);
      await makeEntry(cycle.id, empB.id, siteB.id, unitB.id);
      await makeEntry(cycle.id, empC.id, siteC.id, unitC.id);

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, siteIds: `${siteA.id},${siteB.id}` }));
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(2);
      const siteIds = res.body.rows.map((r: { siteId: string }) => r.siteId).sort();
      expect(siteIds).toEqual([siteA.id, siteB.id].sort());
    });

    it('filters by unitId, scoped within the site, and rejects a unitId outside the requested siteIds filter with 400', async () => {
      const admin = await masterAdminAgent('srr-filter-admin2@test.local');
      const { site, unit: unit1 } = await makeSiteWithUnit('Test Site SRR Unit Filter');
      const unit2 = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'Unit Filter Second' } });
      const cycle = await makeCycle(admin.userId);
      const emp1 = await makeEmployee(site.id, unit1.id, 'Unit Filter Employee 1');
      const emp2 = await makeEmployee(site.id, unit2.id, 'Unit Filter Employee 2');
      await makeEntry(cycle.id, emp1.id, site.id, unit1.id);
      await makeEntry(cycle.id, emp2.id, site.id, unit2.id);

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, unitId: unit1.id }));
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0].employeeId).toBe(emp1.id);

      const { unit: unitOther } = await makeSiteWithUnit('Test Site SRR Unit Mismatch');
      const mismatchRes = await admin.agent.get(listUrl({ cycleId: cycle.id, siteIds: site.id, unitId: unitOther.id }));
      expect(mismatchRes.status).toBe(400);
    });

    it('filters by hasCorrection tri-state (true/false/omitted)', async () => {
      const admin = await masterAdminAgent('srr-filter-admin3@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site SRR Has Correction');
      const cycle = await makeCycle(admin.userId);
      const adjustmentType = await makeAdjustmentType('SRR_CORR');
      const withCorrection = await makeEmployee(site.id, unit.id, 'With Correction Employee');
      const entryWith = await makeEntry(cycle.id, withCorrection.id, site.id, unit.id, {
        released: true,
        releasedAt: new Date(),
        releasedBy: admin.userId,
      });
      await makeCorrection(entryWith.id, adjustmentType.id, admin.userId);
      const withoutCorrection = await makeEmployee(site.id, unit.id, 'Without Correction Employee');
      await makeEntry(cycle.id, withoutCorrection.id, site.id, unit.id);

      const resTrue = await admin.agent.get(listUrl({ cycleId: cycle.id, hasCorrection: 'true' }));
      expect(resTrue.body.rows).toHaveLength(1);
      expect(resTrue.body.rows[0].employeeId).toBe(withCorrection.id);
      expect(resTrue.body.rows[0].correctionCount).toBe(1);

      const resFalse = await admin.agent.get(listUrl({ cycleId: cycle.id, hasCorrection: 'false' }));
      expect(resFalse.body.rows).toHaveLength(1);
      expect(resFalse.body.rows[0].employeeId).toBe(withoutCorrection.id);

      const resAll = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(resAll.body.rows).toHaveLength(2);
    });

    it('unsupported filters (employee search, designation, release-date range, released by, payment method, a separate Released/Held toggle) are stripped and have zero effect', async () => {
      const admin = await masterAdminAgent('srr-filter-admin4@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site SRR Excluded Filters');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Excluded Filter Employee');
      const entry = await makeEntry(cycle.id, employee.id, site.id, unit.id);

      const baseline = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(baseline.status).toBe(200);
      expect(baseline.body.rows).toHaveLength(1);

      const res = await admin.agent.get(
        listUrl({
          cycleId: cycle.id,
          employeeId: '00000000-0000-0000-0000-000000000000',
          designation: 'Definitely Not This Fixtures Designation',
          releasedFrom: '2000-01-01',
          releasedTo: '2000-01-02',
          releasedBy: admin.userId,
          paymentMethod: 'BANK',
          released: 'true',
        }),
      );
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(baseline.body.total);
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0].payrollEntryId).toBe(entry.id);
      expect(res.body.totals).toEqual(baseline.body.totals);
    });
  });

  // ================================================================================================
  // Sorting
  // ================================================================================================

  describe('Sorting (DB-native only)', () => {
    async function seedThreeEmployees(cycleId: string, siteId: string, unitId: string) {
      const alice = await makeEmployee(siteId, unitId, 'Alice Sorter', { employeeCode: 'A-001' });
      const bob = await makeEmployee(siteId, unitId, 'Bob Sorter', { employeeCode: 'B-002' });
      const carol = await makeEmployee(siteId, unitId, 'Carol Sorter', { employeeCode: 'C-003' });
      await makeEntry(cycleId, alice.id, siteId, unitId, { grossPay: '10000' });
      await makeEntry(cycleId, bob.id, siteId, unitId, { grossPay: '30000' });
      await makeEntry(cycleId, carol.id, siteId, unitId, { grossPay: '20000' });
      return { alice, bob, carol };
    }

    it('sorts by employeeName ascending by default', async () => {
      const admin = await masterAdminAgent('srr-sort-admin1@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site SRR Sort Name');
      const cycle = await makeCycle(admin.userId);
      await seedThreeEmployees(cycle.id, site.id, unit.id);

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.body.rows.map((r: { employeeName: string }) => r.employeeName)).toEqual(['Alice Sorter', 'Bob Sorter', 'Carol Sorter']);
    });

    it('sorts by employeeCode descending', async () => {
      const admin = await masterAdminAgent('srr-sort-admin2@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site SRR Sort Code');
      const cycle = await makeCycle(admin.userId);
      await seedThreeEmployees(cycle.id, site.id, unit.id);

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'employeeCode', sortDir: 'desc' }));
      expect(res.body.rows.map((r: { employeeCode: string }) => r.employeeCode)).toEqual(['C-003', 'B-002', 'A-001']);
    });

    it('sorts by site', async () => {
      const admin = await masterAdminAgent('srr-sort-admin3@test.local');
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site SRR Sort Site AAA');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site SRR Sort Site ZZZ');
      const cycle = await makeCycle(admin.userId);
      const empA = await makeEmployee(siteA.id, unitA.id, 'Sort Site Employee A');
      const empB = await makeEmployee(siteB.id, unitB.id, 'Sort Site Employee B');
      await makeEntry(cycle.id, empA.id, siteA.id, unitA.id);
      await makeEntry(cycle.id, empB.id, siteB.id, unitB.id);

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'site', sortDir: 'asc' }));
      expect(res.body.rows.map((r: { siteName: string }) => r.siteName)).toEqual([siteA.name, siteB.name]);
    });

    it('sorts by releasedAt (a genuine, DB-native stored column)', async () => {
      const admin = await masterAdminAgent('srr-sort-admin4@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site SRR Sort ReleasedAt');
      const cycle = await makeCycle(admin.userId);
      const early = await makeEmployee(site.id, unit.id, 'Early Released Employee');
      const late = await makeEmployee(site.id, unit.id, 'Late Released Employee');
      await makeEntry(cycle.id, early.id, site.id, unit.id, { released: true, releasedAt: new Date('2026-01-01T00:00:00.000Z'), releasedBy: admin.userId });
      await makeEntry(cycle.id, late.id, site.id, unit.id, { released: true, releasedAt: new Date('2026-06-01T00:00:00.000Z'), releasedBy: admin.userId });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'releasedAt', sortDir: 'asc' }));
      expect(res.body.rows.map((r: { employeeId: string }) => r.employeeId)).toEqual([early.id, late.id]);
    });

    it('sorts by rowStatus', async () => {
      const admin = await masterAdminAgent('srr-sort-admin5@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site SRR Sort RowStatus');
      const cycle = await makeCycle(admin.userId);
      const held = await makeEmployee(site.id, unit.id, 'Sort Status Held');
      const pending = await makeEmployee(site.id, unit.id, 'Sort Status Pending');
      await makeEntry(cycle.id, held.id, site.id, unit.id, { hold: true });
      await makeEntry(cycle.id, pending.id, site.id, unit.id);

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'rowStatus', sortDir: 'asc' }));
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(2);
    });

    it('rejects sortBy=originalReleasedAmount and sortBy=cycle — not in the approved sort union', async () => {
      const admin = await masterAdminAgent('srr-sort-admin6@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site SRR Sort Reject');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Sort Reject Employee');
      await makeEntry(cycle.id, employee.id, site.id, unit.id);

      const res1 = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'originalReleasedAmount' }));
      expect(res1.status).toBe(400);
      const res2 = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'cycle' }));
      expect(res2.status).toBe(400);
    });

    it('every sort ends with a deterministic id tie-break — page 2 never re-shows page 1 rows for equally-sorted rows', async () => {
      const admin = await masterAdminAgent('srr-sort-admin7@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site SRR Sort TieBreak');
      const cycle = await makeCycle(admin.userId);
      // Every row shares the identical rowStatus (PENDING) — the tie-break alone must keep
      // pagination stable and non-overlapping.
      for (let i = 0; i < 5; i += 1) {
        const employee = await makeEmployee(site.id, unit.id, `Tie Break Employee ${i}`);
        await makeEntry(cycle.id, employee.id, site.id, unit.id);
      }

      const page1 = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'rowStatus', page: '1', pageSize: '2' }));
      const page2 = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'rowStatus', page: '2', pageSize: '2' }));
      const ids1 = page1.body.rows.map((r: { payrollEntryId: string }) => r.payrollEntryId);
      const ids2 = page2.body.rows.map((r: { payrollEntryId: string }) => r.payrollEntryId);
      expect(ids1.some((id: string) => ids2.includes(id))).toBe(false);
    });
  });

  // ================================================================================================
  // Pagination
  // ================================================================================================

  describe('Pagination', () => {
    it('paginates at the database level — page 2 never re-shows page 1 rows, and total reflects the complete filtered set', async () => {
      const admin = await masterAdminAgent('srr-page-admin1@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site SRR Pagination');
      const cycle = await makeCycle(admin.userId);
      for (let i = 0; i < 5; i += 1) {
        const employee = await makeEmployee(site.id, unit.id, `Page Employee ${String(i).padStart(2, '0')}`);
        await makeEntry(cycle.id, employee.id, site.id, unit.id);
      }

      const page1 = await admin.agent.get(listUrl({ cycleId: cycle.id, page: '1', pageSize: '2' }));
      const page2 = await admin.agent.get(listUrl({ cycleId: cycle.id, page: '2', pageSize: '2' }));
      const page3 = await admin.agent.get(listUrl({ cycleId: cycle.id, page: '3', pageSize: '2' }));

      expect(page1.body.total).toBe(5);
      expect(page1.body.rows).toHaveLength(2);
      expect(page2.body.rows).toHaveLength(2);
      expect(page3.body.rows).toHaveLength(1);

      const page1Ids = page1.body.rows.map((r: { payrollEntryId: string }) => r.payrollEntryId);
      const page2Ids = page2.body.rows.map((r: { payrollEntryId: string }) => r.payrollEntryId);
      expect(page1Ids.some((id: string) => page2Ids.includes(id))).toBe(false);
    });

    it('rejects pageSize above the maximum', async () => {
      const admin = await masterAdminAgent('srr-page-admin2@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site SRR Page Clamp');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Page Clamp Employee');
      await makeEntry(cycle.id, employee.id, site.id, unit.id);

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, pageSize: '99999' }));
      expect(res.status).toBe(400);
    });
  });

  // ================================================================================================
  // Totals
  // ================================================================================================

  describe('Totals', () => {
    it('status-breakdown counts sum to matchingCount, and correctedEntryCount reflects corrections independent of totalsComputed', async () => {
      const admin = await masterAdminAgent('srr-totals-admin1@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site SRR Totals Breakdown');
      const cycle = await makeCycle(admin.userId);
      const adjustmentType = await makeAdjustmentType('SRR_TOTALS');

      const held = await makeEmployee(site.id, unit.id, 'Totals Held');
      await makeEntry(cycle.id, held.id, site.id, unit.id, { hold: true });
      const pending = await makeEmployee(site.id, unit.id, 'Totals Pending');
      const pendingEntry = await makeEntry(cycle.id, pending.id, site.id, unit.id);
      await makeCorrection(pendingEntry.id, adjustmentType.id, admin.userId);
      const noPay = await makeEmployee(site.id, unit.id, 'Totals No Pay');
      await makeEntry(cycle.id, noPay.id, site.id, unit.id, { payoutOutcome: 'NO_PAY_DUE' });
      const recovery = await makeEmployee(site.id, unit.id, 'Totals Recovery');
      await makeEntry(cycle.id, recovery.id, site.id, unit.id, { payoutOutcome: 'RECOVERY_DUE' });
      const released = await makeEmployee(site.id, unit.id, 'Totals Released');
      await makeEntry(cycle.id, released.id, site.id, unit.id, { released: true, releasedAt: new Date(), releasedBy: admin.userId, grossPay: '10000' });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      const totals = res.body.totals;
      expect(totals.matchingCount).toBe(5);
      expect(totals.heldCount + totals.pendingCount + totals.noPayDueCount + totals.recoveryDueCount + totals.releasedCount).toBe(5);
      expect(totals.heldCount).toBe(1);
      expect(totals.pendingCount).toBe(1);
      expect(totals.noPayDueCount).toBe(1);
      expect(totals.recoveryDueCount).toBe(1);
      expect(totals.releasedCount).toBe(1);
      expect(totals.correctedEntryCount).toBe(1);
      expect(totals.totalsComputed).toBe(true);
    });

    it('releasedAmount sums only genuinely RELEASED rows\' netSalary — never HELD/NO_PAY_DUE/RECOVERY_DUE/PENDING, and never a later balance-salary amount', async () => {
      const admin = await masterAdminAgent('srr-totals-admin2@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site SRR Totals ReleasedAmount');
      const cycle = await makeCycle(admin.userId);

      const releasedA = await makeEmployee(site.id, unit.id, 'Released Amount A');
      await makeEntry(cycle.id, releasedA.id, site.id, unit.id, { released: true, releasedAt: new Date(), releasedBy: admin.userId, grossPay: '10000', days: '30' });
      const releasedB = await makeEmployee(site.id, unit.id, 'Released Amount B');
      await makeEntry(cycle.id, releasedB.id, site.id, unit.id, { released: true, releasedAt: new Date(), releasedBy: admin.userId, grossPay: '20000', days: '30' });
      const heldEmp = await makeEmployee(site.id, unit.id, 'Released Amount Held');
      await makeEntry(cycle.id, heldEmp.id, site.id, unit.id, { hold: true, grossPay: '99999' });
      const pendingEmp = await makeEmployee(site.id, unit.id, 'Released Amount Pending');
      await makeEntry(cycle.id, pendingEmp.id, site.id, unit.id, { grossPay: '5000', days: '30' });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      const releasedRows = res.body.rows.filter((r: { rowStatus: string }) => r.rowStatus === 'RELEASED');
      const expectedReleasedSum = releasedRows.reduce((sum: number, r: { originalReleasedAmount: string }) => sum + Number(r.originalReleasedAmount), 0);
      expect(Number(res.body.totals.releasedAmount)).toBeCloseTo(expectedReleasedSum, 2);

      const pendingRows = res.body.rows.filter((r: { rowStatus: string }) => r.rowStatus === 'PENDING');
      expect(pendingRows).toHaveLength(1);
      expect(Number(res.body.totals.pendingReleaseAmount)).toBeCloseTo(4600, 0); // ~5000 gross - EOBI etc, non-zero and positive
      expect(Number(res.body.totals.pendingReleaseAmount)).toBeGreaterThan(0);

      // Held's own huge grossPay (99999) must never leak into either monetary total.
      expect(Number(res.body.totals.releasedAmount)).toBeLessThan(99999);
      expect(Number(res.body.totals.pendingReleaseAmount)).toBeLessThan(99999);
    });

    it('correctionBalancePayableTotal/correctionBalanceRecoveryTotal sum across every matching row regardless of status, and stay separate from releasedAmount', async () => {
      const admin = await masterAdminAgent('srr-totals-admin3@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site SRR Totals Balance');
      const cycle = await makeCycle(admin.userId);

      const empA = await makeEmployee(site.id, unit.id, 'Balance Totals A');
      await makeEntry(cycle.id, empA.id, site.id, unit.id, { correctionBalancePayable: '1000', correctionBalanceRecovery: '200' });
      const empB = await makeEmployee(site.id, unit.id, 'Balance Totals B');
      await makeEntry(cycle.id, empB.id, site.id, unit.id, {
        released: true,
        releasedAt: new Date(),
        releasedBy: admin.userId,
        correctionBalancePayable: '500',
        correctionBalanceRecovery: '300',
      });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(Number(res.body.totals.correctionBalancePayableTotal)).toBeCloseTo(1500, 2);
      expect(Number(res.body.totals.correctionBalanceRecoveryTotal)).toBeCloseTo(500, 2);
    });

    it('never computes a per-Unit financial total anywhere in the response', async () => {
      const admin = await masterAdminAgent('srr-totals-admin4@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site SRR No Unit Totals');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'No Unit Totals Employee');
      await makeEntry(cycle.id, employee.id, site.id, unit.id);

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.body.totals.unitBreakdown).toBeUndefined();
      expect(res.body.unitTotals).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toMatch(/unitBreakdown|perUnit|unitTotals/i);
    });
  });

  // ================================================================================================
  // Export
  // ================================================================================================

  describe('Export', () => {
    it('CSV export contains every matching row, ignoring pagination, with the exact approved header vocabulary', async () => {
      const admin = await masterAdminAgent('srr-export-admin1@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site SRR Export CSV');
      const cycle = await makeCycle(admin.userId);
      for (let i = 0; i < 3; i += 1) {
        const employee = await makeEmployee(site.id, unit.id, `Export Employee ${i}`, { employeeCode: `EXP-${i}` });
        await makeEntry(cycle.id, employee.id, site.id, unit.id, { grossPay: String(10000 + i * 1000) });
      }

      const listRes = await admin.agent.get(listUrl({ cycleId: cycle.id, pageSize: '1' }));
      expect(listRes.body.total).toBe(3);

      const res = await admin.agent.get(exportUrl('csv', { cycleId: cycle.id }));
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      const records = parseCsvSync(res.text, { columns: true, skip_empty_lines: true }) as Record<string, string>[];
      expect(records).toHaveLength(3);
      expect(Object.keys(records[0]!)).toEqual(EXPECTED_EXPORT_HEADERS);
      assertNoSensitiveKeys(records, FORBIDDEN_KEYS);
    });

    it('CSV export field values match the list endpoint exactly, field-by-field, for the same filters and sort', async () => {
      const admin = await masterAdminAgent('srr-export-parity@test.local');
      const { site, unit: unitPrimary } = await makeSiteWithUnit('Test Site SRR CSV Parity');
      const unitSecond = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'CSV Parity Second Unit' } });
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unitPrimary.id, 'CSV Parity Employee', { employeeCode: 'CSV-001' });
      const entry = await makeEntry(cycle.id, employee.id, site.id, unitPrimary.id, {
        grossPay: '32000',
        days: '30',
        correctionBalancePayable: '900',
        correctionBalanceRecovery: '150',
        released: true,
        releasedAt: new Date('2026-01-15T00:00:00.000Z'),
        releasedBy: admin.userId,
      });
      await addSecondWorkLine(entry.id, site.id, unitSecond.id);
      const adjustmentType = await makeAdjustmentType('SRR_CSV_PARITY');
      await makeCorrection(entry.id, adjustmentType.id, admin.userId);

      const params = { cycleId: cycle.id, sortBy: 'employeeName', sortDir: 'asc' };
      const listRes = await admin.agent.get(listUrl(params));
      expect(listRes.status).toBe(200);
      expect(listRes.body.rows).toHaveLength(1);
      const row = listRes.body.rows[0];

      const csvRes = await admin.agent.get(exportUrl('csv', params));
      expect(csvRes.status).toBe(200);
      const records = parseCsvSync(csvRes.text, { columns: true, skip_empty_lines: true }) as Record<string, string>[];
      expect(records).toHaveLength(1);
      const csvRow = records[0]!;

      expect(csvRow['Employee Code']).toBe(row.employeeCode);
      expect(csvRow['Employee Name']).toBe(row.employeeName);
      expect(csvRow['Project Site']).toBe(row.siteName);
      expect(csvRow['Primary Unit']).toBe(row.primaryUnit.name);
      expect(csvRow['Additional Unit Count']).toBe(String(row.additionalUnitCount));
      expect(csvRow['Designation']).toBe(row.designation);
      expect(csvRow['Row Status']).toBe(row.rowStatus);
      expect(csvRow['Original Released Amount']).toBe(row.originalReleasedAmount);
      expect(csvRow['Correction Balance Payable']).toBe(row.correctionBalancePayable);
      expect(csvRow['Correction Balance Recovery']).toBe(row.correctionBalanceRecovery);
      expect(csvRow['Released Date']).toBe(row.releasedAt.slice(0, 10));
      expect(csvRow['Correction Count']).toBe(String(row.correctionCount));
      expect(row.correctionCount).toBe(1);
      expect(row.rowStatus).toBe('RELEASED');
      expect(row.additionalUnitCount).toBe(1);
      expect(row.originalReleasedAmount).not.toBeNull();

      assertNoSensitiveKeys(records, FORBIDDEN_KEYS);
    });

    it('XLSX export parses correctly — exact safe headers, no sensitive headers, complete filtered row count, and representative row values matching the list endpoint', async () => {
      const admin = await masterAdminAgent('srr-export-admin2@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site SRR Export XLSX');
      const cycle = await makeCycle(admin.userId);
      for (let i = 0; i < 3; i += 1) {
        const employee = await makeEmployee(site.id, unit.id, `XLSX Employee ${i}`, { employeeCode: `XLS-${i}` });
        await makeEntry(cycle.id, employee.id, site.id, unit.id, { grossPay: String(20000 + i * 1000) });
      }

      const listRes = await admin.agent.get(listUrl({ cycleId: cycle.id, pageSize: '1' }));
      expect(listRes.status).toBe(200);
      expect(listRes.body.total).toBe(3);
      const firstRow = listRes.body.rows[0];

      const res = await admin.agent.get(exportUrl('xlsx', { cycleId: cycle.id })).buffer(true).parse(binaryParser);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheet');
      expect((res.body as Buffer).length).toBeGreaterThan(0);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.body as Buffer);
      const worksheet = workbook.getWorksheet('Salary Release Report');
      expect(worksheet).toBeDefined();

      const headerRow = worksheet!.getRow(3);
      const headerValues: string[] = [];
      headerRow.eachCell((cell) => headerValues.push(String(cell.value)));
      expect(headerValues).toEqual(EXPECTED_EXPORT_HEADERS);

      const headerText = headerValues.join(' | ');
      for (const forbidden of ['CNIC', 'Bank', 'IBAN', 'Branch Code', 'Account Number', 'Released By', 'Payment Method']) {
        expect(headerText).not.toContain(forbidden);
      }

      const parsedRows: Record<string, unknown>[] = [];
      for (let r = 4; r <= worksheet!.rowCount; r += 1) {
        const dataRow = worksheet!.getRow(r);
        if (!dataRow.getCell(1).value) continue;
        const record: Record<string, unknown> = {};
        headerValues.forEach((header, index) => {
          record[header] = dataRow.getCell(index + 1).value;
        });
        parsedRows.push(record);
      }
      expect(parsedRows).toHaveLength(3);
      assertNoSensitiveKeys(parsedRows, FORBIDDEN_KEYS);

      const firstDataRow = worksheet!.getRow(4);
      expect(firstDataRow.getCell(1).value).toBe(firstRow.employeeCode);
      expect(firstDataRow.getCell(2).value).toBe(firstRow.employeeName);
      expect(firstDataRow.getCell(3).value).toBe(firstRow.siteName);
      expect(firstDataRow.getCell(7).value).toBe(firstRow.rowStatus);
    });

    it('a request with neither approved permission is rejected before any export work happens', async () => {
      const admin = await masterAdminAgent('srr-export-admin3@test.local');
      const { site } = await makeSiteWithUnit('Test Site SRR Export Auth');
      const cycle = await makeCycle(admin.userId);
      const noPerm = await noPermissionAgent('srr-export-noperm@test.local', [site.id]);
      const res = await noPerm.agent.get(exportUrl('csv', { cycleId: cycle.id }));
      expect(res.status).toBe(403);
    });

    it('export never accepts page/pageSize — always the complete filtered dataset', async () => {
      const admin = await masterAdminAgent('srr-export-admin4@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site SRR Export Ignore Page');
      const cycle = await makeCycle(admin.userId);
      for (let i = 0; i < 4; i += 1) {
        const employee = await makeEmployee(site.id, unit.id, `Ignore Page Employee ${i}`);
        await makeEntry(cycle.id, employee.id, site.id, unit.id);
      }

      const res = await admin.agent.get(exportUrl('csv', { cycleId: cycle.id, page: '1', pageSize: '1' }));
      const records = parseCsvSync(res.text, { columns: true, skip_empty_lines: true }) as Record<string, string>[];
      expect(records).toHaveLength(4);
    });

    it('export filter/sort parity matches the list endpoint exactly', async () => {
      const admin = await masterAdminAgent('srr-export-admin5@test.local');
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site SRR Export Parity A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site SRR Export Parity B');
      const cycle = await makeCycle(admin.userId);
      const empA = await makeEmployee(siteA.id, unitA.id, 'Export Parity A');
      const empB = await makeEmployee(siteB.id, unitB.id, 'Export Parity B');
      await makeEntry(cycle.id, empA.id, siteA.id, unitA.id);
      await makeEntry(cycle.id, empB.id, siteB.id, unitB.id);

      const listRes = await admin.agent.get(listUrl({ cycleId: cycle.id, siteIds: siteA.id }));
      const csvRes = await admin.agent.get(exportUrl('csv', { cycleId: cycle.id, siteIds: siteA.id }));
      const records = parseCsvSync(csvRes.text, { columns: true, skip_empty_lines: true }) as Record<string, string>[];
      expect(records).toHaveLength(listRes.body.rows.length);
      expect(records).toHaveLength(1);
      expect(records[0]!['Employee Name']).toBe('Export Parity A');
    });
  });

  // ================================================================================================
  // Query discipline
  // ================================================================================================

  describe('Query discipline', () => {
    it('correction counts are fetched via one batched query, never one query per row', async () => {
      const admin = await masterAdminAgent('srr-query-admin1@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site SRR Query Discipline');
      const cycle = await makeCycle(admin.userId);
      const adjustmentType = await makeAdjustmentType('SRR_QUERY');
      for (let i = 0; i < 5; i += 1) {
        const employee = await makeEmployee(site.id, unit.id, `Query Employee ${i}`);
        const entry = await makeEntry(cycle.id, employee.id, site.id, unit.id);
        await makeCorrection(entry.id, adjustmentType.id, admin.userId);
      }

      const groupBySpy = jest.spyOn(prisma.correction, 'groupBy');
      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, pageSize: '50' }));
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(5);
      expect(res.body.rows.every((r: { correctionCount: number }) => r.correctionCount === 1)).toBe(true);
      // Exactly one batched groupBy call for the whole page, never one per row.
      expect(groupBySpy).toHaveBeenCalledTimes(1);
      groupBySpy.mockRestore();
    });

    it('a multi-unit entry never multiplies row count (grain stays one row per PayrollEntry)', async () => {
      const admin = await masterAdminAgent('srr-query-admin2@test.local');
      const { site, unit: unitA } = await makeSiteWithUnit('Test Site SRR Query MultiUnit');
      const unitB = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'Query MultiUnit B' } });
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unitA.id, 'Query MultiUnit Employee');
      const entry = await makeEntry(cycle.id, employee.id, site.id, unitA.id);
      await addSecondWorkLine(entry.id, site.id, unitB.id);

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.total).toBe(1);
    });

    it('a multi-unit entry matched by its SECOND unit via the unitId filter still returns exactly one row (Prisma `workLines: { some }` never fans out the root row)', async () => {
      const admin = await masterAdminAgent('srr-query-admin3@test.local');
      const { site, unit: unitA } = await makeSiteWithUnit('Test Site SRR Query MultiUnit Filter');
      const unitB = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'Query MultiUnit Filter B' } });
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unitA.id, 'Query MultiUnit Filter Employee');
      const entry = await makeEntry(cycle.id, employee.id, site.id, unitA.id);
      await addSecondWorkLine(entry.id, site.id, unitB.id);

      // Filtering by the primary (first) unit must also still return exactly one row.
      const resA = await admin.agent.get(listUrl({ cycleId: cycle.id, unitId: unitA.id }));
      expect(resA.body.rows).toHaveLength(1);
      expect(resA.body.total).toBe(1);
      expect(resA.body.rows[0].payrollEntryId).toBe(entry.id);
      expect(resA.body.rows[0].additionalUnitCount).toBe(1);

      // Filtering by the SECOND (non-primary) unit this same entry also touches must return the
      // identical single row, never a duplicate fanned out from the workLines join.
      const resB = await admin.agent.get(listUrl({ cycleId: cycle.id, unitId: unitB.id }));
      expect(resB.body.rows).toHaveLength(1);
      expect(resB.body.total).toBe(1);
      expect(resB.body.rows[0].payrollEntryId).toBe(entry.id);
      // The row's own shape is unaffected by which unit the filter matched on — always the primary
      // unit (lowest sortOrder), never the filtered-on unit reinterpreted as primary.
      expect(resB.body.rows[0].primaryUnit.id).toBe(unitA.id);
      expect(resB.body.rows[0].additionalUnitCount).toBe(1);
    });
  });
});
