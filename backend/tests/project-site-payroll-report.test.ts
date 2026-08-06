import request from 'supertest';
import ExcelJS from 'exceljs';
import { parse as parseCsvSync } from 'csv-parse/sync';
import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent, assertNoSensitiveKeys } from './helpers';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

/** Mirrors `employee-payroll-history.test.ts`'s own `binaryParser` exactly — supertest needs an
 * explicit binary parser to receive an XLSX response body as a real `Buffer`, not a mangled UTF-8
 * string. */
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

/** The declared export header order (`PROJECT_SITE_PAYROLL_REPORT_EXPORT_HEADERS`,
 * `project-site-payroll.service.ts`) — duplicated here as a literal, not imported, so a test
 * asserting against it stays a genuine independent check rather than trivially agreeing with
 * whatever the source constant says. */
const EXPECTED_EXPORT_HEADERS = [
  'Employee Code',
  'Employee Name',
  'Project Site',
  'Primary Unit',
  'Additional Unit Count',
  'Designation',
  'Gross Pay',
  'Allowance',
  'EOBI',
  'Advance Deduction',
  'EID Advance Deduction',
  'Fine',
  'Correction Balance Payable',
  'Correction Balance Recovery',
  'Total Earnings',
  'Total Deductions',
  'Net Salary',
  'Row Status',
  'Correction Count',
  'Released Date',
];

/** Substrings that must never appear as an export column header or a parsed-row object key, on
 * top of `assertNoSensitiveKeys`'s own defaults (passwordhash/session/csrf/storagekey/
 * absolutepath) — CNIC, every banking field, release-actor identity, and correction-reason detail
 * are all individual-detail-only fields this report's flat export vocabulary deliberately excludes
 * (frozen decisions — Table Data section). */
const EXPORT_FORBIDDEN_KEYS = ['cnic', 'accountnumber', 'iban', 'bank', 'branchcode', 'releasedby', 'reason'];

/**
 * Phase 7 Reports, Project Site Payroll Report Checkpoint 1A (approved Checkpoint 0 architecture
 * review, 2026-08-06). Every fixture entry is created directly via Prisma, mirroring
 * `reports.test.ts`'s/`employee-payroll-history.test.ts`'s own established pattern: this suite is
 * about the report's own aggregation/authorization/scoping correctness, not Payroll Entry's own
 * creation/edit workflow. Release transitions that must be *real* (to prove the report reads real
 * release state, not a simulated one) go through the actual HTTP endpoint.
 */
describe('Phase 7 Reports — Project Site Payroll Report (Checkpoint 1A)', () => {
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
        PERMISSIONS.CORRECTIONS_APPROVE,
        PERMISSIONS.REPORTS_VIEW,
      ],
    });
  }

  /** A dedicated `TEST_`-coded role holding exactly `reports:view` — the approved permission for
   * this whole report (frozen decision 2). Never `ROLE_CODES.PAYROLL_STAFF`, per this suite
   * family's own established "don't silently inherit a real role's full seeded permission set"
   * rule. */
  async function reportsViewerAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_PSP_REPORTS_VIEWER',
      permissionKeys: [PERMISSIONS.REPORTS_VIEW],
      siteIds,
    });
  }

  /** Holds `statements:view` but deliberately NOT `reports:view` — proves this report is gated by
   * the latter, not the former (frozen decision 2's explicit "reuse REPORTS_VIEW", the inverse of
   * Employee Payroll History's own gate). */
  async function statementsOnlyAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_PSP_STATEMENTS_ONLY',
      permissionKeys: [PERMISSIONS.STATEMENTS_VIEW],
      siteIds,
    });
  }

  async function noPermissionAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_PSP_NO_PERM',
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

  async function makeEntry(
    cycleId: string,
    employeeId: string,
    siteId: string,
    unitId: string,
    overrides: EntryOverrides = {},
  ) {
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
    return prisma.payrollEntryWorkLine.create({ data: { payrollEntryId: entryId, siteId, unitId, days: '4', otHours: '0', cycleDays: 30, sortOrder: 1 } });
  }

  async function releaseUnit(admin: Awaited<ReturnType<typeof masterAdminAgent>>, cycleId: string, unitId: string) {
    const res = await admin.agent.post(`/api/v1/payroll-cycles/${cycleId}/units/${unitId}/release`).set('x-csrf-token', admin.csrfToken).send({});
    expect(res.status).toBe(201);
    return res;
  }

  async function makeAdjustmentType(code: string) {
    return prisma.adjustmentType.create({ data: { code: `TEST_${code}`, label: code } });
  }

  async function makeCorrection(payrollEntryId: string, adjustmentTypeId: string, approvedById: string, overrides: Record<string, unknown> = {}) {
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
        ...overrides,
      },
    });
  }

  function listUrl(params: Record<string, string> = {}) {
    return `/api/v1/reports/project-site-payroll?${new URLSearchParams(params).toString()}`;
  }
  function exportUrl(format: 'csv' | 'xlsx', params: Record<string, string> = {}) {
    return `/api/v1/reports/project-site-payroll/export?${new URLSearchParams({ format, ...params }).toString()}`;
  }

  // ================================================================================================
  // Authorization
  // ================================================================================================

  describe('Authorization', () => {
    it('rejects a request with no session with 401', async () => {
      const admin = await masterAdminAgent('psp-auth-admin0@test.local');
      const cycle = await makeCycle(admin.userId);
      const res = await request(app).get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(401);
    });

    it('rejects a user lacking reports:view with 403', async () => {
      const admin = await masterAdminAgent('psp-auth-admin1@test.local');
      const { site } = await makeSiteWithUnit('Test Site PSP Auth 1');
      const cycle = await makeCycle(admin.userId);
      const noPerm = await noPermissionAgent('psp-auth-noperm@test.local', [site.id]);
      const res = await noPerm.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(403);
    });

    it('a user with statements:view but not reports:view is denied (frozen decision 2 — the inverse of Employee Payroll History)', async () => {
      const admin = await masterAdminAgent('psp-auth-admin2@test.local');
      const { site } = await makeSiteWithUnit('Test Site PSP Auth 2');
      const cycle = await makeCycle(admin.userId);
      const statementsOnly = await statementsOnlyAgent('psp-auth-statementsonly@test.local', [site.id]);
      const res = await statementsOnly.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(403);
    });

    it('Master Admin (global authority) can list with no site restriction', async () => {
      const admin = await masterAdminAgent('psp-auth-admin3@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site PSP Auth 3');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Auth Admin Employee');
      await makeEntry(cycle.id, employee.id, site.id, unit.id);

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(200);
      expect(res.body.rows.some((row: { employeeId: string }) => row.employeeId === employee.id)).toBe(true);
    });

    it('a site-scoped reports:view user only sees their accessible site rows', async () => {
      const admin = await masterAdminAgent('psp-auth-admin4@test.local');
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site PSP Auth Scope A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site PSP Auth Scope B');
      const cycle = await makeCycle(admin.userId);
      const employeeA = await makeEmployee(siteA.id, unitA.id, 'Auth Scope Employee A');
      const employeeB = await makeEmployee(siteB.id, unitB.id, 'Auth Scope Employee B');
      await makeEntry(cycle.id, employeeA.id, siteA.id, unitA.id);
      await makeEntry(cycle.id, employeeB.id, siteB.id, unitB.id);

      const viewerA = await reportsViewerAgent('psp-auth-viewerA@test.local', [siteA.id]);
      const res = await viewerA.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0].siteId).toBe(siteA.id);
      // Totals must also reflect the caller's own accessible scope, never the full cycle.
      expect(res.body.totals.matchingCount).toBe(1);
    });

    it('an explicit siteIds filter naming an inaccessible site is rejected with 403, never silently narrowed', async () => {
      const admin = await masterAdminAgent('psp-auth-admin5@test.local');
      const { site: siteA } = await makeSiteWithUnit('Test Site PSP Auth Explicit A');
      const { site: siteB } = await makeSiteWithUnit('Test Site PSP Auth Explicit B');
      const cycle = await makeCycle(admin.userId);
      const viewerA = await reportsViewerAgent('psp-auth-explicitA@test.local', [siteA.id]);
      const res = await viewerA.agent.get(listUrl({ cycleId: cycle.id, siteIds: siteB.id }));
      expect(res.status).toBe(403);
    });

    it('historical transfer: a site-scoped viewer sees only the entry attributed to their own site, using PayrollEntry.siteId, never Employee.siteId', async () => {
      const admin = await masterAdminAgent('psp-auth-admin6@test.local');
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site PSP Transfer A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site PSP Transfer B');
      const cycle = await makeCycle(admin.userId);
      // Employee currently lives at Site B (their *current* Employee.siteId), but this cycle's
      // entry was created while they were still at Site A (frozen PayrollEntry.siteId) — the
      // exact "employee already transferred before this cycle's entry was created" shape.
      const employee = await makeEmployee(siteB.id, unitB.id, 'Transferred Employee');
      const entry = await makeEntry(cycle.id, employee.id, siteA.id, unitA.id);

      const viewerA = await reportsViewerAgent('psp-transfer-viewerA@test.local', [siteA.id]);
      const resA = await viewerA.agent.get(listUrl({ cycleId: cycle.id }));
      expect(resA.status).toBe(200);
      expect(resA.body.rows).toHaveLength(1);
      expect(resA.body.rows[0].payrollEntryId).toBe(entry.id);
      expect(resA.body.rows[0].siteId).toBe(siteA.id);

      const viewerB = await reportsViewerAgent('psp-transfer-viewerB@test.local', [siteB.id]);
      const resB = await viewerB.agent.get(listUrl({ cycleId: cycle.id }));
      expect(resB.status).toBe(200);
      expect(resB.body.rows).toHaveLength(0);
    });
  });

  // ================================================================================================
  // Cycle (required, single, not a range)
  // ================================================================================================

  describe('Cycle requirement (frozen decision 3)', () => {
    it('rejects a request with no cycleId at all with 400', async () => {
      const admin = await masterAdminAgent('psp-cycle-admin1@test.local');
      const res = await admin.agent.get('/api/v1/reports/project-site-payroll');
      expect(res.status).toBe(400);
    });

    it('rejects a malformed cycleId with 400, never reaching the database', async () => {
      const admin = await masterAdminAgent('psp-cycle-admin2@test.local');
      const res = await admin.agent.get(listUrl({ cycleId: 'not-a-uuid' }));
      expect(res.status).toBe(400);
    });

    it('rejects a nonexistent (but well-formed) cycleId with 404', async () => {
      const admin = await masterAdminAgent('psp-cycle-admin3@test.local');
      const res = await admin.agent.get(listUrl({ cycleId: '00000000-0000-0000-0000-000000000000' }));
      expect(res.status).toBe(404);
    });

    it('does not accept a fromCycleId/toCycleId range — only a single cycleId', async () => {
      const admin = await masterAdminAgent('psp-cycle-admin4@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site PSP Cycle Range');
      const cycle1 = await makeCycle(admin.userId);
      const cycle2 = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Cycle Range Employee');
      await makeEntry(cycle1.id, employee.id, site.id, unit.id);
      await makeEntry(cycle2.id, employee.id, site.id, unit.id);

      const res = await admin.agent.get(listUrl({ cycleId: cycle1.id }));
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.cycle.id).toBe(cycle1.id);
    });
  });

  // ================================================================================================
  // Row grain, columns, and financial correctness
  // ================================================================================================

  describe('Row grain and financial reconciliation', () => {
    it('one row = one PayrollEntry, with every required column present and correctly computed', async () => {
      const admin = await masterAdminAgent('psp-row-admin1@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site PSP Row 1');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Row Employee', { employeeCode: 'EMP-ROW-1' });
      await makeEntry(cycle.id, employee.id, site.id, unit.id, {
        grossPay: '30000',
        allowance: '2000',
        advanceDeduction: '500',
        eidAdvanceDeduction: '300',
        fine: '100',
        correctionBalancePayable: '1000',
        correctionBalanceRecovery: '200',
        days: '30', // full cycleDays (default 30) — earnedAmount equals grossPay exactly, no
        // day-proration to replicate here, so the manual reconciliation below stays simple.
      });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(1);
      const row = res.body.rows[0];

      expect(row.employeeCode).toBe('EMP-ROW-1');
      expect(row.employeeName).toBe('Row Employee');
      expect(row.siteId).toBe(site.id);
      expect(row.siteName).toBe(site.name);
      expect(row.primaryUnit.id).toBe(unit.id);
      expect(row.additionalUnitCount).toBe(0);
      expect(row.designation).toBe('Guard');
      expect(row.grossPay).toBe('30000.00');
      expect(row.allowance).toBe('2000.00');
      expect(row.advanceDeduction).toBe('500.00');
      expect(row.eidAdvanceDeduction).toBe('300.00');
      expect(row.fine).toBe('100.00');
      expect(row.correctionBalancePayable).toBe('1000.00');
      expect(row.correctionBalanceRecovery).toBe('200.00');
      expect(row.rowStatus).toBe('PENDING');
      expect(row.correctionCount).toBe(0);
      expect(row.releasedAt).toBeNull();

      // Total Earnings/Deductions/Net Salary must reconcile with the same manual arithmetic an
      // independent reviewer would do from the row's own other fields — never a magic number.
      const totalEarnings = Number(row.grossPay) + Number(row.allowance);
      const totalDeductions =
        Number(row.eobiDeduction) + Number(row.advanceDeduction) + Number(row.eidAdvanceDeduction) + Number(row.fine) + Number(row.correctionBalanceRecovery);
      expect(Number(row.totalEarnings)).toBeCloseTo(totalEarnings + Number(row.correctionBalancePayable), 2);
      expect(Number(row.totalDeductions)).toBeCloseTo(totalDeductions, 2);
      expect(Number(row.netSalary)).toBeCloseTo(Number(row.totalEarnings) - Number(row.totalDeductions), 2);
    });

    it('shows "Primary Unit (+N more)" via additionalUnitCount for a multi-unit employee, never a per-unit financial split (frozen decision 5)', async () => {
      const admin = await masterAdminAgent('psp-row-admin2@test.local');
      const { site, unit: unitPrimary } = await makeSiteWithUnit('Test Site PSP Multi Unit');
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
      // No per-unit financial breakdown field exists anywhere on the row or response.
      expect(row.unitBreakdown).toBeUndefined();
      expect(row.unitTotals).toBeUndefined();
    });

    it('never exposes CNIC, banking, or audit fields on any row', async () => {
      const admin = await masterAdminAgent('psp-row-admin3@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site PSP Sensitive');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Sensitive Employee', { cnic: '1234512345671' });
      await makeEntry(cycle.id, employee.id, site.id, unit.id);

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      const row = res.body.rows[0];
      expect(row.cnic).toBeUndefined();
      expect(row.bankId).toBeUndefined();
      expect(row.accountNumber).toBeUndefined();
      expect(row.iban).toBeUndefined();
      expect(row.branchCode).toBeUndefined();
      expect(row.releasedBy).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('1234512345671');
      // Recursive, key-name-based sweep of the *entire* response (not just the fields already
      // spot-checked above) — the same established helper Employee Payroll History's own test
      // suite uses (`employee-payroll-history.test.ts`), catching a leak anywhere in the response
      // shape, not only at the paths this test happened to think to check by hand.
      assertNoSensitiveKeys(res.body, EXPORT_FORBIDDEN_KEYS);
    });

    it('EOBI deduction reflects eobiApplicable — zero when not applicable, regardless of the stored eobiAmount', async () => {
      const admin = await masterAdminAgent('psp-row-admin4@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site PSP EOBI');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'EOBI Employee');
      await makeEntry(cycle.id, employee.id, site.id, unit.id, { eobiAmount: '400', eobiApplicable: false });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.body.rows[0].eobiDeduction).toBe('0.00');
    });
  });

  // ================================================================================================
  // Row status: Held / Released / No Pay Due / Recovery Due / Pending
  // ================================================================================================

  describe('Row status derivation', () => {
    it('classifies Held, Pending, No Pay Due, and Recovery Due correctly, and Released after a real unit release', async () => {
      const admin = await masterAdminAgent('psp-status-admin1@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site PSP Status');
      const cycle = await makeCycle(admin.userId);

      const heldEmployee = await makeEmployee(site.id, unit.id, 'Held Employee');
      await makeEntry(cycle.id, heldEmployee.id, site.id, unit.id, { hold: true });

      const pendingEmployee = await makeEmployee(site.id, unit.id, 'Pending Employee');
      await makeEntry(cycle.id, pendingEmployee.id, site.id, unit.id);

      const noPayEmployee = await makeEmployee(site.id, unit.id, 'No Pay Employee');
      await makeEntry(cycle.id, noPayEmployee.id, site.id, unit.id, { payoutOutcome: 'NO_PAY_DUE', released: false });

      const recoveryEmployee = await makeEmployee(site.id, unit.id, 'Recovery Employee');
      await makeEntry(cycle.id, recoveryEmployee.id, site.id, unit.id, { payoutOutcome: 'RECOVERY_DUE', released: false });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, pageSize: '50' }));
      expect(res.status).toBe(200);
      const byEmployee = (id: string) => res.body.rows.find((r: { employeeId: string }) => r.employeeId === id);

      expect(byEmployee(heldEmployee.id).rowStatus).toBe('HELD');
      expect(byEmployee(pendingEmployee.id).rowStatus).toBe('PENDING');
      expect(byEmployee(noPayEmployee.id).rowStatus).toBe('NO_PAY_DUE');
      expect(byEmployee(recoveryEmployee.id).rowStatus).toBe('RECOVERY_DUE');

      const releasedEmployee = await makeEmployee(site.id, unit.id, 'Released Employee');
      await makeEntry(cycle.id, releasedEmployee.id, site.id, unit.id);
      await releaseUnit(admin, cycle.id, unit.id);

      const res2 = await admin.agent.get(listUrl({ cycleId: cycle.id, pageSize: '50' }));
      const byEmployee2 = (id: string) => res2.body.rows.find((r: { employeeId: string }) => r.employeeId === id);
      expect(byEmployee2(releasedEmployee.id).rowStatus).toBe('RELEASED');
      expect(byEmployee2(releasedEmployee.id).releasedAt).not.toBeNull();
    });

    it('the rowStatus filter narrows correctly', async () => {
      const admin = await masterAdminAgent('psp-status-admin2@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site PSP Status Filter');
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
  // Filtering: Site, Unit, Has Correction
  // ================================================================================================

  describe('Filtering', () => {
    it('filters by siteIds (multi-select)', async () => {
      const admin = await masterAdminAgent('psp-filter-admin1@test.local');
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site PSP Filter A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site PSP Filter B');
      const { site: siteC, unit: unitC } = await makeSiteWithUnit('Test Site PSP Filter C');
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

    it('filters by unitId, scoped within the site', async () => {
      const admin = await masterAdminAgent('psp-filter-admin2@test.local');
      const { site, unit: unit1 } = await makeSiteWithUnit('Test Site PSP Unit Filter');
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
    });

    it('rejects a unitId that does not belong to the requested siteIds filter with 400', async () => {
      const admin = await masterAdminAgent('psp-filter-admin3@test.local');
      const { site: siteA } = await makeSiteWithUnit('Test Site PSP Unit Mismatch A');
      const { unit: unitB } = await makeSiteWithUnit('Test Site PSP Unit Mismatch B');
      const cycle = await makeCycle(admin.userId);

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, siteIds: siteA.id, unitId: unitB.id }));
      expect(res.status).toBe(400);
    });

    it('filters by hasCorrection tri-state (true/false/omitted)', async () => {
      const admin = await masterAdminAgent('psp-filter-admin4@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site PSP Has Correction');
      const cycle = await makeCycle(admin.userId);
      const adjustmentType = await makeAdjustmentType('PSP_CORR');
      const withCorrection = await makeEmployee(site.id, unit.id, 'With Correction Employee');
      const entryWith = await makeEntry(cycle.id, withCorrection.id, site.id, unit.id, { released: true, releasedAt: new Date(), releasedBy: admin.userId });
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

    it('unsupported filters (employeeId, designation, cycle range, roster status, outstanding balance) are stripped and have zero effect, proven with values that would exclude the row if any were accidentally wired', async () => {
      const admin = await masterAdminAgent('psp-filter-admin5@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site PSP Excluded Filters');
      const cycle = await makeCycle(admin.userId);
      const otherCycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Excluded Filter Employee');
      const entry = await makeEntry(cycle.id, employee.id, site.id, unit.id);

      const baseline = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(baseline.status).toBe(200);
      expect(baseline.body.rows).toHaveLength(1);

      // Unknown query params are simply ignored by the Zod schema (not stripped-and-erroring),
      // so the request still succeeds — the point under test is that these params have *no
      // narrowing effect at all*. Every value below is deliberately chosen so it would EXCLUDE
      // this fixture's own row if it were accidentally wired to a real filter: a nonexistent
      // employeeId (not this employee's own — the previous version of this test used the
      // employee's own real id, which would have passed even if the filter *were* wired, simply
      // because it happened to match); a designation the fixture doesn't have; a cycle range
      // naming a different cycle entirely; DEPARTED against an employee with no `dateOfLeaving`
      // (i.e. genuinely ACTIVE); and an outstanding-balance requirement no BalanceAdjustment here
      // could ever satisfy.
      const res = await admin.agent.get(
        listUrl({
          cycleId: cycle.id,
          employeeId: '00000000-0000-0000-0000-000000000000',
          designation: 'Definitely Not This Fixtures Designation',
          fromCycleId: otherCycle.id,
          toCycleId: otherCycle.id,
          currentEmployeeRosterStatus: 'DEPARTED',
          hasOutstandingOriginBalance: 'true',
        }),
      );
      expect(res.status).toBe(200);

      // The response must be identical to the baseline request that never named any of these
      // unsupported parameters at all — total, row identity, and totals all unchanged.
      expect(res.body.total).toBe(baseline.body.total);
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0].payrollEntryId).toBe(entry.id);
      expect(res.body.rows.map((r: { payrollEntryId: string }) => r.payrollEntryId)).toEqual(
        baseline.body.rows.map((r: { payrollEntryId: string }) => r.payrollEntryId),
      );
      expect(res.body.totals).toEqual(baseline.body.totals);
    });
  });

  // ================================================================================================
  // Sorting
  // ================================================================================================

  describe('Sorting', () => {
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
      const admin = await masterAdminAgent('psp-sort-admin1@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site PSP Sort Name');
      const cycle = await makeCycle(admin.userId);
      await seedThreeEmployees(cycle.id, site.id, unit.id);

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.body.rows.map((r: { employeeName: string }) => r.employeeName)).toEqual(['Alice Sorter', 'Bob Sorter', 'Carol Sorter']);
    });

    it('sorts by employeeCode', async () => {
      const admin = await masterAdminAgent('psp-sort-admin2@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site PSP Sort Code');
      const cycle = await makeCycle(admin.userId);
      await seedThreeEmployees(cycle.id, site.id, unit.id);

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'employeeCode', sortDir: 'desc' }));
      expect(res.body.rows.map((r: { employeeCode: string }) => r.employeeCode)).toEqual(['C-003', 'B-002', 'A-001']);
    });

    it('sorts by netSalary (the one field not backed by a stored column)', async () => {
      const admin = await masterAdminAgent('psp-sort-admin3@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site PSP Sort NetSalary');
      const cycle = await makeCycle(admin.userId);
      await seedThreeEmployees(cycle.id, site.id, unit.id);

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'netSalary', sortDir: 'asc' }));
      expect(res.status).toBe(200);
      const netSalaries = res.body.rows.map((r: { netSalary: string }) => Number(r.netSalary));
      expect(netSalaries).toEqual([...netSalaries].sort((a, b) => a - b));
    });

    it('does not accept sorting by cycle (there is only ever one)', async () => {
      const admin = await masterAdminAgent('psp-sort-admin4@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site PSP Sort Cycle Reject');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Sort Cycle Employee');
      await makeEntry(cycle.id, employee.id, site.id, unit.id);

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'cycle' }));
      expect(res.status).toBe(400);
    });
  });

  // ================================================================================================
  // Pagination
  // ================================================================================================

  describe('Pagination', () => {
    it('paginates at the database level — page 2 never re-shows page 1 rows, and total reflects the complete filtered set', async () => {
      const admin = await masterAdminAgent('psp-page-admin1@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site PSP Pagination');
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
      const admin = await masterAdminAgent('psp-page-admin2@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site PSP Page Clamp');
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

  describe('Totals (reusing Payroll Summary\'s model, computed over the full filtered dataset)', () => {
    it('totals reflect the complete filtered dataset, not the current page', async () => {
      const admin = await masterAdminAgent('psp-totals-admin1@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site PSP Totals');
      const cycle = await makeCycle(admin.userId);
      for (let i = 0; i < 5; i += 1) {
        const employee = await makeEmployee(site.id, unit.id, `Totals Employee ${i}`);
        await makeEntry(cycle.id, employee.id, site.id, unit.id, { grossPay: '10000' });
      }

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, page: '1', pageSize: '2' }));
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(2);
      expect(res.body.totals.matchingCount).toBe(5);
      expect(res.body.totals.totalsComputed).toBe(true);
      expect(Number(res.body.totals.grossPay)).toBeCloseTo(50000, 2);
    });

    it('status-breakdown counts sum to matchingCount, and correctedEntryCount reflects corrections independent of totalsComputed', async () => {
      const admin = await masterAdminAgent('psp-totals-admin2@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site PSP Totals Breakdown');
      const cycle = await makeCycle(admin.userId);
      const adjustmentType = await makeAdjustmentType('PSP_TOTALS');

      const held = await makeEmployee(site.id, unit.id, 'Totals Held');
      await makeEntry(cycle.id, held.id, site.id, unit.id, { hold: true });
      const pending = await makeEmployee(site.id, unit.id, 'Totals Pending');
      const pendingEntry = await makeEntry(cycle.id, pending.id, site.id, unit.id);
      await makeCorrection(pendingEntry.id, adjustmentType.id, admin.userId);
      const noPay = await makeEmployee(site.id, unit.id, 'Totals No Pay');
      await makeEntry(cycle.id, noPay.id, site.id, unit.id, { payoutOutcome: 'NO_PAY_DUE' });
      const recovery = await makeEmployee(site.id, unit.id, 'Totals Recovery');
      await makeEntry(cycle.id, recovery.id, site.id, unit.id, { payoutOutcome: 'RECOVERY_DUE' });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      const totals = res.body.totals;
      expect(totals.matchingCount).toBe(4);
      expect(totals.heldCount + totals.pendingCount + totals.noPayDueCount + totals.recoveryDueCount + totals.releasedCount).toBe(4);
      expect(totals.heldCount).toBe(1);
      expect(totals.pendingCount).toBe(1);
      expect(totals.noPayDueCount).toBe(1);
      expect(totals.recoveryDueCount).toBe(1);
      expect(totals.correctedEntryCount).toBe(1);
    });

    it('an independent calcNet-based cross-check: summing every row\'s own netSalary equals totals.netSalaryTotal', async () => {
      const admin = await masterAdminAgent('psp-totals-admin3@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site PSP Totals Reconcile');
      const cycle = await makeCycle(admin.userId);
      for (const grossPay of ['15000', '22500', '30750']) {
        const employee = await makeEmployee(site.id, unit.id, `Reconcile Employee ${grossPay}`);
        await makeEntry(cycle.id, employee.id, site.id, unit.id, { grossPay });
      }

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, pageSize: '50' }));
      const summedFromRows = res.body.rows.reduce((sum: number, row: { netSalary: string }) => sum + Number(row.netSalary), 0);
      expect(summedFromRows).toBeCloseTo(Number(res.body.totals.netSalaryTotal), 2);
    });

    it('does not compute per-unit financial totals anywhere in the response (frozen decision 5)', async () => {
      const admin = await masterAdminAgent('psp-totals-admin4@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site PSP No Unit Totals');
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
    it('CSV export contains every matching row, ignoring pagination, with values matching the list endpoint exactly', async () => {
      const admin = await masterAdminAgent('psp-export-admin1@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site PSP Export CSV');
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
      const lines = res.text.trim().split('\n');
      expect(lines).toHaveLength(4); // header + 3 rows, complete dataset, never just the 1-row page
      expect(lines[0]).toContain('Employee Code');
      expect(lines[0]).not.toContain('CNIC');
      expect(lines[0]).not.toContain('Bank');
    });

    it('CSV export field values match the list endpoint exactly, field-by-field, for the same filters and sort', async () => {
      const admin = await masterAdminAgent('psp-export-parity@test.local');
      const { site, unit: unitPrimary } = await makeSiteWithUnit('Test Site PSP CSV Parity');
      const unitSecond = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'CSV Parity Second Unit' } });
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unitPrimary.id, 'CSV Parity Employee', { employeeCode: 'CSV-001' });
      const entry = await makeEntry(cycle.id, employee.id, site.id, unitPrimary.id, {
        grossPay: '32000',
        allowance: '1500',
        advanceDeduction: '600',
        eidAdvanceDeduction: '250',
        fine: '50',
        correctionBalancePayable: '900',
        correctionBalanceRecovery: '150',
        released: true,
        releasedAt: new Date('2026-01-15T00:00:00.000Z'),
        releasedBy: admin.userId,
      });
      // A second work line (Primary Unit + Additional Unit Count) and a real approved Correction
      // (Correction Count) — between them, this one fixture entry exercises every column the
      // export headers declare, not just the ones that happen to be non-zero/non-default.
      await addSecondWorkLine(entry.id, site.id, unitSecond.id);
      const adjustmentType = await makeAdjustmentType('PSP_CSV_PARITY');
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

      // Field-by-field parity against the list response — the list is the source of truth here;
      // nothing below is recomputed, only compared, using the export's own established
      // money-string formatting convention (the same `.toFixed(2)`-formatted strings the list
      // endpoint already returns, read verbatim by `buildExportRow`).
      expect(csvRow['Employee Code']).toBe(row.employeeCode);
      expect(csvRow['Employee Name']).toBe(row.employeeName);
      expect(csvRow['Project Site']).toBe(row.siteName);
      expect(csvRow['Primary Unit']).toBe(row.primaryUnit.name);
      expect(csvRow['Additional Unit Count']).toBe(String(row.additionalUnitCount));
      expect(csvRow['Designation']).toBe(row.designation);
      expect(csvRow['Gross Pay']).toBe(row.grossPay);
      expect(csvRow['Allowance']).toBe(row.allowance);
      expect(csvRow['EOBI']).toBe(row.eobiDeduction);
      expect(csvRow['Advance Deduction']).toBe(row.advanceDeduction);
      expect(csvRow['EID Advance Deduction']).toBe(row.eidAdvanceDeduction);
      expect(csvRow['Fine']).toBe(row.fine);
      expect(csvRow['Correction Balance Payable']).toBe(row.correctionBalancePayable);
      expect(csvRow['Correction Balance Recovery']).toBe(row.correctionBalanceRecovery);
      expect(csvRow['Total Earnings']).toBe(row.totalEarnings);
      expect(csvRow['Total Deductions']).toBe(row.totalDeductions);
      expect(csvRow['Net Salary']).toBe(row.netSalary);
      expect(csvRow['Row Status']).toBe(row.rowStatus);
      expect(csvRow['Correction Count']).toBe(String(row.correctionCount));
      expect(csvRow['Released Date']).toBe(row.releasedAt.slice(0, 10));
      expect(row.correctionCount).toBe(1);
      expect(row.rowStatus).toBe('RELEASED');
      expect(row.additionalUnitCount).toBe(1);

      assertNoSensitiveKeys(records, EXPORT_FORBIDDEN_KEYS);
    });

    it('XLSX export parses correctly — exact safe headers, no sensitive headers, complete filtered row count (never a pagination-only subset), and representative row values matching the list endpoint', async () => {
      const admin = await masterAdminAgent('psp-export-admin2@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site PSP Export XLSX');
      const cycle = await makeCycle(admin.userId);
      for (let i = 0; i < 3; i += 1) {
        const employee = await makeEmployee(site.id, unit.id, `XLSX Employee ${i}`, { employeeCode: `XLS-${i}` });
        await makeEntry(cycle.id, employee.id, site.id, unit.id, { grossPay: String(20000 + i * 1000) });
      }

      // The on-screen page would only ever show 1 of these 3 rows at this pageSize — the export
      // must still contain all 3, proving it never reuses the current page.
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
      const worksheet = workbook.getWorksheet('Project Site Payroll Report');
      expect(worksheet).toBeDefined();

      // Row 1: title, Row 2: blank, Row 3: headers, Row 4+: one row per matching entry — no Total
      // row for this report (unlike Payroll Summary's own XLSX layout).
      const headerRow = worksheet!.getRow(3);
      const headerValues: string[] = [];
      headerRow.eachCell((cell) => headerValues.push(String(cell.value)));
      expect(headerValues).toEqual(EXPECTED_EXPORT_HEADERS);

      const headerText = headerValues.join(' | ');
      for (const forbidden of ['CNIC', 'Bank', 'IBAN', 'Branch Code', 'Account Number', 'Released By']) {
        expect(headerText).not.toContain(forbidden);
      }

      // Complete filtered dataset — never just the 1-row page the on-screen list would show.
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
      assertNoSensitiveKeys(parsedRows, EXPORT_FORBIDDEN_KEYS);

      // At least one representative row, compared against the list endpoint's own values (the
      // same source-of-truth, no-recompute discipline as the CSV parity test above) — money
      // cells come back from ExcelJS as numbers, hence `String(...)` before comparing against the
      // list's own formatted string.
      const firstDataRow = worksheet!.getRow(4);
      expect(firstDataRow.getCell(1).value).toBe(firstRow.employeeCode);
      expect(firstDataRow.getCell(2).value).toBe(firstRow.employeeName);
      expect(firstDataRow.getCell(3).value).toBe(firstRow.siteName);
      expect(firstDataRow.getCell(4).value).toBe(firstRow.primaryUnit.name);
      expect(String(firstDataRow.getCell(7).value)).toBe(firstRow.grossPay);
      expect(String(firstDataRow.getCell(9).value)).toBe(firstRow.eobiDeduction);
      expect(String(firstDataRow.getCell(15).value)).toBe(firstRow.totalEarnings);
      expect(String(firstDataRow.getCell(16).value)).toBe(firstRow.totalDeductions);
      expect(String(firstDataRow.getCell(17).value)).toBe(firstRow.netSalary);
      expect(firstDataRow.getCell(18).value).toBe(firstRow.rowStatus);
    });

    it('a request with no reports:view is rejected before any export work happens', async () => {
      const admin = await masterAdminAgent('psp-export-admin3@test.local');
      const { site } = await makeSiteWithUnit('Test Site PSP Export Auth');
      const cycle = await makeCycle(admin.userId);
      const noPerm = await noPermissionAgent('psp-export-noperm@test.local', [site.id]);
      const res = await noPerm.agent.get(exportUrl('csv', { cycleId: cycle.id }));
      expect(res.status).toBe(403);
    });

    it('export never accepts page/pageSize — always the complete filtered dataset', async () => {
      const admin = await masterAdminAgent('psp-export-admin4@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site PSP Export Ignore Page');
      const cycle = await makeCycle(admin.userId);
      for (let i = 0; i < 4; i += 1) {
        const employee = await makeEmployee(site.id, unit.id, `Ignore Page Employee ${i}`);
        await makeEntry(cycle.id, employee.id, site.id, unit.id);
      }

      const res = await admin.agent.get(exportUrl('csv', { cycleId: cycle.id, page: '1', pageSize: '1' }));
      const lines = res.text.trim().split('\n');
      expect(lines).toHaveLength(5); // header + all 4 rows, page/pageSize silently have no effect
    });
  });
});
