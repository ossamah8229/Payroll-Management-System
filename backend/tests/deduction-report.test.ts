import request from 'supertest';
import ExcelJS from 'exceljs';
import { parse as parseCsvSync } from 'csv-parse/sync';
import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent, assertNoSensitiveKeys } from './helpers';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

/** Mirrors `project-site-payroll-report.test.ts`'s own `binaryParser` exactly — supertest needs an
 * explicit binary parser to receive an XLSX response body as a real `Buffer`. */
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

/** The declared export header order (`DEDUCTION_REPORT_EXPORT_HEADERS`,
 * `deduction-report.service.ts`) — duplicated here as a literal, not imported, so a test asserting
 * against it stays a genuine independent check. */
const EXPECTED_EXPORT_HEADERS = [
  'Employee Code',
  'Employee Name',
  'Project Site',
  'Primary Unit',
  'Additional Unit Count',
  'Designation',
  'EOBI',
  'Advance Deduction',
  'EID Advance Deduction',
  'Fine',
  'Correction Balance Recovery',
  'Total Deductions',
  'Row Status',
  'Correction Count',
  'Released Date',
];

/** Substrings that must never appear as an export column header or a parsed-row object key, on top
 * of `assertNoSensitiveKeys`'s own defaults — CNIC, every banking field, Gross Pay, Net Salary,
 * Correction Balance Payable, release-actor identity, correction-reason detail, and any live
 * BalanceAdjustment figure are all deliberately excluded from this report's flat vocabulary (frozen
 * decisions — Columns/Export sections). */
const EXPORT_FORBIDDEN_KEYS = [
  'cnic',
  'accountnumber',
  'iban',
  'bank',
  'branchcode',
  'releasedby',
  'reason',
  'grosspay',
  'netsalary',
  'totalearnings',
  'correctionbalancepayable',
  'remainingamount',
];

/**
 * Phase 7 Reports, Deduction Report Checkpoint 1A (approved Checkpoint 0 architecture review,
 * 2026-08-07). Every fixture entry is created directly via Prisma, mirroring
 * `project-site-payroll-report.test.ts`'s own established pattern: this suite is about the report's
 * own aggregation/authorization/scoping/filtering correctness, not Payroll Entry's own
 * creation/edit workflow. Release transitions that must be *real* (to prove the report reads real
 * release state, not a simulated one) go through the actual HTTP endpoint.
 */
describe('Phase 7 Reports — Deduction Report (Checkpoint 1A)', () => {
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
   * this whole report. Never `ROLE_CODES.PAYROLL_STAFF`, per this suite family's own established
   * "don't silently inherit a real role's full seeded permission set" rule. */
  async function reportsViewerAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_DR_REPORTS_VIEWER',
      permissionKeys: [PERMISSIONS.REPORTS_VIEW],
      siteIds,
    });
  }

  /** Holds `statements:view` but deliberately NOT `reports:view` — proves this report is gated by
   * the latter, not the former. */
  async function statementsOnlyAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_DR_STATEMENTS_ONLY',
      permissionKeys: [PERMISSIONS.STATEMENTS_VIEW],
      siteIds,
    });
  }

  async function noPermissionAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_DR_NO_PERM',
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
    return `/api/v1/reports/deduction-report?${new URLSearchParams(params).toString()}`;
  }
  function exportUrl(format: 'csv' | 'xlsx', params: Record<string, string> = {}) {
    return `/api/v1/reports/deduction-report/export?${new URLSearchParams({ format, ...params }).toString()}`;
  }

  // ================================================================================================
  // Authorization
  // ================================================================================================

  describe('Authorization', () => {
    it('rejects a request with no session with 401', async () => {
      const admin = await masterAdminAgent('dr-auth-admin0@test.local');
      const cycle = await makeCycle(admin.userId);
      const res = await request(app).get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(401);
    });

    it('rejects a user lacking reports:view with 403', async () => {
      const admin = await masterAdminAgent('dr-auth-admin1@test.local');
      const { site } = await makeSiteWithUnit('Test Site DR Auth 1');
      const cycle = await makeCycle(admin.userId);
      const noPerm = await noPermissionAgent('dr-auth-noperm@test.local', [site.id]);
      const res = await noPerm.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(403);
    });

    it('a user with statements:view but not reports:view is denied', async () => {
      const admin = await masterAdminAgent('dr-auth-admin2@test.local');
      const { site } = await makeSiteWithUnit('Test Site DR Auth 2');
      const cycle = await makeCycle(admin.userId);
      const statementsOnly = await statementsOnlyAgent('dr-auth-statementsonly@test.local', [site.id]);
      const res = await statementsOnly.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(403);
    });

    it('Master Admin (global authority) can list with no site restriction', async () => {
      const admin = await masterAdminAgent('dr-auth-admin3@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site DR Auth 3');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Auth Admin Employee');
      await makeEntry(cycle.id, employee.id, site.id, unit.id);

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(200);
      expect(res.body.rows.some((row: { employeeId: string }) => row.employeeId === employee.id)).toBe(true);
    });

    it('a site-scoped reports:view user only sees their accessible site rows', async () => {
      const admin = await masterAdminAgent('dr-auth-admin4@test.local');
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site DR Auth Scope A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site DR Auth Scope B');
      const cycle = await makeCycle(admin.userId);
      const employeeA = await makeEmployee(siteA.id, unitA.id, 'Auth Scope Employee A');
      const employeeB = await makeEmployee(siteB.id, unitB.id, 'Auth Scope Employee B');
      await makeEntry(cycle.id, employeeA.id, siteA.id, unitA.id);
      await makeEntry(cycle.id, employeeB.id, siteB.id, unitB.id);

      const viewerA = await reportsViewerAgent('dr-auth-viewerA@test.local', [siteA.id]);
      const res = await viewerA.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0].siteId).toBe(siteA.id);
      expect(res.body.totals.matchingCount).toBe(1);
    });

    it('an explicit siteIds filter naming an inaccessible site is rejected with 403, never silently narrowed', async () => {
      const admin = await masterAdminAgent('dr-auth-admin5@test.local');
      const { site: siteA } = await makeSiteWithUnit('Test Site DR Auth Explicit A');
      const { site: siteB } = await makeSiteWithUnit('Test Site DR Auth Explicit B');
      const cycle = await makeCycle(admin.userId);
      const viewerA = await reportsViewerAgent('dr-auth-explicitA@test.local', [siteA.id]);
      const res = await viewerA.agent.get(listUrl({ cycleId: cycle.id, siteIds: siteB.id }));
      expect(res.status).toBe(403);
    });

    it('historical transfer: a site-scoped viewer sees only the entry attributed to their own site, using PayrollEntry.siteId, never Employee.siteId', async () => {
      const admin = await masterAdminAgent('dr-auth-admin6@test.local');
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site DR Transfer A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site DR Transfer B');
      const cycle = await makeCycle(admin.userId);
      // Employee currently lives at Site B (current Employee.siteId), but this cycle's entry was
      // created while they were still at Site A (frozen PayrollEntry.siteId).
      const employee = await makeEmployee(siteB.id, unitB.id, 'Transferred Employee');
      const entry = await makeEntry(cycle.id, employee.id, siteA.id, unitA.id);

      const viewerA = await reportsViewerAgent('dr-transfer-viewerA@test.local', [siteA.id]);
      const resA = await viewerA.agent.get(listUrl({ cycleId: cycle.id }));
      expect(resA.status).toBe(200);
      expect(resA.body.rows).toHaveLength(1);
      expect(resA.body.rows[0].payrollEntryId).toBe(entry.id);
      expect(resA.body.rows[0].siteId).toBe(siteA.id);

      const viewerB = await reportsViewerAgent('dr-transfer-viewerB@test.local', [siteB.id]);
      const resB = await viewerB.agent.get(listUrl({ cycleId: cycle.id }));
      expect(resB.status).toBe(200);
      expect(resB.body.rows).toHaveLength(0);
    });

    it('a Unit belonging to an inaccessible Site is rejected with 403 — Unit cannot widen access', async () => {
      const admin = await masterAdminAgent('dr-auth-admin7@test.local');
      const { site: siteA } = await makeSiteWithUnit('Test Site DR Unit Widen A');
      const { unit: unitB } = await makeSiteWithUnit('Test Site DR Unit Widen B');
      const cycle = await makeCycle(admin.userId);
      const viewerA = await reportsViewerAgent('dr-unit-widen-viewerA@test.local', [siteA.id]);
      const res = await viewerA.agent.get(listUrl({ cycleId: cycle.id, unitId: unitB.id }));
      expect(res.status).toBe(403);
    });
  });

  // ================================================================================================
  // Contracts
  // ================================================================================================

  describe('Contracts', () => {
    it('rejects a request with no cycleId', async () => {
      const admin = await masterAdminAgent('dr-contract-admin1@test.local');
      const res = await admin.agent.get('/api/v1/reports/deduction-report');
      expect(res.status).toBe(400);
    });

    it('rejects a malformed cycleId UUID', async () => {
      const admin = await masterAdminAgent('dr-contract-admin2@test.local');
      const res = await admin.agent.get(listUrl({ cycleId: 'not-a-uuid' }));
      expect(res.status).toBe(400);
    });

    it('rejects a nonexistent cycleId with 404', async () => {
      const admin = await masterAdminAgent('dr-contract-admin3@test.local');
      const res = await admin.agent.get(listUrl({ cycleId: '00000000-0000-0000-0000-000000000000' }));
      expect(res.status).toBe(404);
    });

    it('rejects a malformed siteIds UUID', async () => {
      const admin = await masterAdminAgent('dr-contract-admin4@test.local');
      const cycle = await makeCycle(admin.userId);
      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, siteIds: 'not-a-uuid' }));
      expect(res.status).toBe(400);
    });

    it('rejects an out-of-range pageSize with 400, never silently clamped', async () => {
      const admin = await masterAdminAgent('dr-contract-admin5@test.local');
      const cycle = await makeCycle(admin.userId);
      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, pageSize: '500' }));
      expect(res.status).toBe(400);
    });

    it('rejects an invalid sortBy value', async () => {
      const admin = await masterAdminAgent('dr-contract-admin6@test.local');
      const cycle = await makeCycle(admin.userId);
      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'netSalary' }));
      expect(res.status).toBe(400);
    });

    it('rejects sortBy=eobi and sortBy=totalDeductions — explicitly not approved sort fields', async () => {
      const admin = await masterAdminAgent('dr-contract-admin7@test.local');
      const cycle = await makeCycle(admin.userId);
      const resEobi = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'eobi' }));
      expect(resEobi.status).toBe(400);
      const resTotal = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'totalDeductions' }));
      expect(resTotal.status).toBe(400);
    });

    it('export accepts no page/pageSize — always the complete filtered result', async () => {
      const admin = await masterAdminAgent('dr-contract-admin8@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site DR Contract Export');
      const cycle = await makeCycle(admin.userId);
      for (let i = 0; i < 3; i += 1) {
        const employee = await makeEmployee(site.id, unit.id, `Export Contract Employee ${i}`);
        await makeEntry(cycle.id, employee.id, site.id, unit.id, { fine: '500' });
      }
      const res = await admin.agent.get(exportUrl('csv', { cycleId: cycle.id, page: '1', pageSize: '1' }));
      expect(res.status).toBe(200);
      const lines = res.text.trim().split('\n');
      expect(lines.length).toBe(4); // header + all 3 rows, ignoring page/pageSize entirely
    });

    it('an unrecognized query parameter (e.g. employeeId, a filter this report never supports) is silently inert', async () => {
      const admin = await masterAdminAgent('dr-contract-admin9@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site DR Contract Inert');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Inert Filter Employee');
      await makeEntry(cycle.id, employee.id, site.id, unit.id);

      const baseline = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      const withExtra = await admin.agent.get(listUrl({ cycleId: cycle.id, employeeId: '11111111-1111-1111-1111-111111111111', designation: 'Nonexistent', fromCycleId: '22222222-2222-2222-2222-222222222222' }));
      expect(withExtra.status).toBe(200);
      expect(withExtra.body.total).toBe(baseline.body.total);
      expect(withExtra.body.rows).toEqual(baseline.body.rows);
    });
  });

  // ================================================================================================
  // Deduction correctness
  // ================================================================================================

  describe('Deduction correctness', () => {
    it('effective EOBI is the configured amount when applicable', async () => {
      const admin = await masterAdminAgent('dr-ded-admin1@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site DR Ded EOBI On');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'EOBI On Employee');
      await makeEntry(cycle.id, employee.id, site.id, unit.id, { eobiApplicable: true, eobiAmount: '450' });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(200);
      expect(res.body.rows[0].eobi).toBe('450.00');
    });

    it('effective EOBI is zero when not applicable, even with a positive configured amount — never a raw sum of eobiAmount', async () => {
      const admin = await masterAdminAgent('dr-ded-admin2@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site DR Ded EOBI Off');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'EOBI Off Employee');
      await makeEntry(cycle.id, employee.id, site.id, unit.id, { eobiApplicable: false, eobiAmount: '400' });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(200);
      expect(res.body.rows[0].eobi).toBe('0.00');
    });

    it('Advance Deduction, EID Advance Deduction, and Fine are read verbatim from stored columns', async () => {
      const admin = await masterAdminAgent('dr-ded-admin3@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site DR Ded Raw Cols');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Raw Columns Employee');
      await makeEntry(cycle.id, employee.id, site.id, unit.id, { advanceDeduction: '2000', eidAdvanceDeduction: '1000', fine: '300' });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(200);
      const row = res.body.rows[0];
      expect(row.advanceDeduction).toBe('2000.00');
      expect(row.eidAdvanceDeduction).toBe('1000.00');
      expect(row.fine).toBe('300.00');
    });

    it('Correction Balance Recovery is read verbatim — the per-cycle materialized settlement, never a live BalanceAdjustment figure', async () => {
      const admin = await masterAdminAgent('dr-ded-admin4@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site DR Ded Recovery');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Recovery Employee');
      await makeEntry(cycle.id, employee.id, site.id, unit.id, { correctionBalanceRecovery: '1500' });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(200);
      expect(res.body.rows[0].correctionBalanceRecovery).toBe('1500.00');
    });

    it('mixed deductions sum correctly into Total Deductions (canonical calcNet parity)', async () => {
      const admin = await masterAdminAgent('dr-ded-admin5@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site DR Ded Mixed');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Mixed Deductions Employee');
      await makeEntry(cycle.id, employee.id, site.id, unit.id, {
        eobiApplicable: true,
        eobiAmount: '400',
        advanceDeduction: '2000',
        eidAdvanceDeduction: '1000',
        fine: '300',
        correctionBalanceRecovery: '1500',
      });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(200);
      const row = res.body.rows[0];
      const independentSum = Number(row.eobi) + Number(row.advanceDeduction) + Number(row.eidAdvanceDeduction) + Number(row.fine) + Number(row.correctionBalanceRecovery);
      expect(Number(row.totalDeductions)).toBeCloseTo(independentSum, 2);
      expect(row.totalDeductions).toBe('5200.00');
    });

    it('zero deductions produce zero Total Deductions, not an absent/null field', async () => {
      const admin = await masterAdminAgent('dr-ded-admin6@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site DR Ded Zero');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Zero Deductions Employee');
      await makeEntry(cycle.id, employee.id, site.id, unit.id, { eobiApplicable: false, eobiAmount: '0' });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(200);
      const row = res.body.rows[0];
      expect(row.eobi).toBe('0.00');
      expect(row.advanceDeduction).toBe('0.00');
      expect(row.eidAdvanceDeduction).toBe('0.00');
      expect(row.fine).toBe('0.00');
      expect(row.correctionBalanceRecovery).toBe('0.00');
      expect(row.totalDeductions).toBe('0.00');
    });

    it('a correction against this entry never replays into this row — the original stored deduction figures are unaffected, only correctionCount changes', async () => {
      const admin = await masterAdminAgent('dr-ded-admin7@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site DR Ded Correction');
      const cycle = await makeCycle(admin.userId);
      const adjustmentType = await makeAdjustmentType('DR_CORRECTION_REPLAY');
      const employee = await makeEmployee(site.id, unit.id, 'Correction Replay Employee');
      const entry = await makeEntry(cycle.id, employee.id, site.id, unit.id, { fine: '250' });

      const before = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(before.body.rows[0].fine).toBe('250.00');
      expect(before.body.rows[0].correctionCount).toBe(0);

      await makeCorrection(entry.id, adjustmentType.id, admin.userId);

      const after = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(after.body.rows[0].fine).toBe('250.00'); // unchanged — never replayed
      expect(after.body.rows[0].correctionCount).toBe(1);
    });

    it('no live BalanceAdjustment.remainingAmount or any correction-reason detail appears anywhere in the response', async () => {
      const admin = await masterAdminAgent('dr-ded-admin8@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site DR Ded No Sensitive');
      const cycle = await makeCycle(admin.userId);
      const adjustmentType = await makeAdjustmentType('DR_NO_SENSITIVE');
      const employee = await makeEmployee(site.id, unit.id, 'No Sensitive Detail Employee');
      const entry = await makeEntry(cycle.id, employee.id, site.id, unit.id, { correctionBalanceRecovery: '900' });
      await makeCorrection(entry.id, adjustmentType.id, admin.userId);

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(200);
      assertNoSensitiveKeys(res.body, EXPORT_FORBIDDEN_KEYS);
      const raw = JSON.stringify(res.body).toLowerCase();
      expect(raw).not.toContain('remainingamount');
      expect(raw).not.toContain('attendance miscounted'); // the correction's own reason text
    });
  });

  // ================================================================================================
  // Filters
  // ================================================================================================

  describe('Filters — deduction tri-states', () => {
    async function makeFilterFixtures() {
      const admin = await masterAdminAgent(`dr-filt-admin-${Math.random()}@test.local`);
      const { site, unit } = await makeSiteWithUnit(`Test Site DR Filters ${Math.random()}`);
      const cycle = await makeCycle(admin.userId);

      const eobiOnly = await makeEmployee(site.id, unit.id, 'Filter EOBI Only');
      await makeEntry(cycle.id, eobiOnly.id, site.id, unit.id, { eobiApplicable: true, eobiAmount: '400' });

      const fineOnly = await makeEmployee(site.id, unit.id, 'Filter Fine Only');
      await makeEntry(cycle.id, fineOnly.id, site.id, unit.id, { eobiApplicable: false, eobiAmount: '400', fine: '500' });

      const advanceAndEid = await makeEmployee(site.id, unit.id, 'Filter Advance And EID');
      await makeEntry(cycle.id, advanceAndEid.id, site.id, unit.id, {
        eobiApplicable: false,
        eobiAmount: '0',
        advanceDeduction: '1000',
        eidAdvanceDeduction: '500',
      });

      const recoveryOnly = await makeEmployee(site.id, unit.id, 'Filter Recovery Only');
      await makeEntry(cycle.id, recoveryOnly.id, site.id, unit.id, { eobiApplicable: false, eobiAmount: '0', correctionBalanceRecovery: '700' });

      const noDeductions = await makeEmployee(site.id, unit.id, 'Filter No Deductions');
      await makeEntry(cycle.id, noDeductions.id, site.id, unit.id, { eobiApplicable: false, eobiAmount: '0' });

      return { admin, site, unit, cycle, eobiOnly, fineOnly, advanceAndEid, recoveryOnly, noDeductions };
    }

    it('hasEobi=true matches only the effectively-EOBI-applicable row; hasEobi=false matches the rest', async () => {
      const { admin, cycle, eobiOnly } = await makeFilterFixtures();
      const yes = await admin.agent.get(listUrl({ cycleId: cycle.id, hasEobi: 'true' }));
      expect(yes.body.total).toBe(1);
      expect(yes.body.rows[0].employeeId).toBe(eobiOnly.id);

      const no = await admin.agent.get(listUrl({ cycleId: cycle.id, hasEobi: 'false' }));
      expect(no.body.total).toBe(4);
      expect(no.body.rows.every((r: { employeeId: string }) => r.employeeId !== eobiOnly.id)).toBe(true);
    });

    it('hasFine=true/false partitions correctly', async () => {
      const { admin, cycle, fineOnly } = await makeFilterFixtures();
      const yes = await admin.agent.get(listUrl({ cycleId: cycle.id, hasFine: 'true' }));
      expect(yes.body.total).toBe(1);
      expect(yes.body.rows[0].employeeId).toBe(fineOnly.id);

      const no = await admin.agent.get(listUrl({ cycleId: cycle.id, hasFine: 'false' }));
      expect(no.body.total).toBe(4);
    });

    it('hasAdvanceDeduction=true/false partitions correctly', async () => {
      const { admin, cycle, advanceAndEid } = await makeFilterFixtures();
      const yes = await admin.agent.get(listUrl({ cycleId: cycle.id, hasAdvanceDeduction: 'true' }));
      expect(yes.body.total).toBe(1);
      expect(yes.body.rows[0].employeeId).toBe(advanceAndEid.id);
    });

    it('hasEidAdvanceDeduction=true/false partitions correctly', async () => {
      const { admin, cycle, advanceAndEid } = await makeFilterFixtures();
      const yes = await admin.agent.get(listUrl({ cycleId: cycle.id, hasEidAdvanceDeduction: 'true' }));
      expect(yes.body.total).toBe(1);
      expect(yes.body.rows[0].employeeId).toBe(advanceAndEid.id);
    });

    it('hasCorrectionRecovery=true/false partitions correctly', async () => {
      const { admin, cycle, recoveryOnly } = await makeFilterFixtures();
      const yes = await admin.agent.get(listUrl({ cycleId: cycle.id, hasCorrectionRecovery: 'true' }));
      expect(yes.body.total).toBe(1);
      expect(yes.body.rows[0].employeeId).toBe(recoveryOnly.id);
    });

    it('hasEobi/hasFine/hasAdvanceDeduction/hasEidAdvanceDeduction/hasCorrectionRecovery all omitted ("All") returns every row, unfiltered', async () => {
      const { admin, cycle } = await makeFilterFixtures();
      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.body.total).toBe(5);
    });

    it('combined filters compose with AND semantics — hasAdvanceDeduction=true AND hasEidAdvanceDeduction=true matches only the row with both', async () => {
      const { admin, cycle, advanceAndEid } = await makeFilterFixtures();
      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, hasAdvanceDeduction: 'true', hasEidAdvanceDeduction: 'true' }));
      expect(res.body.total).toBe(1);
      expect(res.body.rows[0].employeeId).toBe(advanceAndEid.id);
    });

    it('combined filters with AND semantics correctly yield zero matches when no row satisfies both', async () => {
      const { admin, cycle } = await makeFilterFixtures();
      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, hasFine: 'true', hasCorrectionRecovery: 'true' }));
      expect(res.body.total).toBe(0);
    });

    it('hasCorrection tri-state (reused) still works alongside the new deduction filters', async () => {
      const admin = await masterAdminAgent('dr-filt-correction@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site DR Filt Correction');
      const cycle = await makeCycle(admin.userId);
      const adjustmentType = await makeAdjustmentType('DR_FILTER_CORRECTION');
      const withCorrection = await makeEmployee(site.id, unit.id, 'With Correction');
      const entryWith = await makeEntry(cycle.id, withCorrection.id, site.id, unit.id, { fine: '100' });
      await makeCorrection(entryWith.id, adjustmentType.id, admin.userId);
      const withoutCorrection = await makeEmployee(site.id, unit.id, 'Without Correction');
      await makeEntry(cycle.id, withoutCorrection.id, site.id, unit.id, { fine: '100' });

      const yes = await admin.agent.get(listUrl({ cycleId: cycle.id, hasCorrection: 'true' }));
      expect(yes.body.total).toBe(1);
      expect(yes.body.rows[0].employeeId).toBe(withCorrection.id);

      const no = await admin.agent.get(listUrl({ cycleId: cycle.id, hasCorrection: 'false' }));
      expect(no.body.total).toBe(1);
      expect(no.body.rows[0].employeeId).toBe(withoutCorrection.id);
    });

    it('Site multi-select and Row Status filters (reused) still work', async () => {
      const admin = await masterAdminAgent('dr-filt-site-status@test.local');
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site DR Filt Site A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site DR Filt Site B');
      const cycle = await makeCycle(admin.userId);
      const empA = await makeEmployee(siteA.id, unitA.id, 'Site Status A');
      await makeEntry(cycle.id, empA.id, siteA.id, unitA.id, { hold: true });
      const empB = await makeEmployee(siteB.id, unitB.id, 'Site Status B');
      await makeEntry(cycle.id, empB.id, siteB.id, unitB.id);

      const bothSites = await admin.agent.get(listUrl({ cycleId: cycle.id, siteIds: `${siteA.id},${siteB.id}` }));
      expect(bothSites.body.total).toBe(2);

      const held = await admin.agent.get(listUrl({ cycleId: cycle.id, rowStatus: 'HELD' }));
      expect(held.body.total).toBe(1);
      expect(held.body.rows[0].employeeId).toBe(empA.id);
    });
  });

  // ================================================================================================
  // Row status
  // ================================================================================================

  describe('Row status', () => {
    it('derives all five statuses correctly through the extracted generic implementation', async () => {
      const admin = await masterAdminAgent('dr-status-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site DR Status');
      const cycle = await makeCycle(admin.userId);

      const released = await makeEmployee(site.id, unit.id, 'Status Released');
      await makeEntry(cycle.id, released.id, site.id, unit.id, { released: true, releasedAt: new Date(), releasedBy: admin.userId });
      const held = await makeEmployee(site.id, unit.id, 'Status Held');
      await makeEntry(cycle.id, held.id, site.id, unit.id, { hold: true });
      const noPay = await makeEmployee(site.id, unit.id, 'Status No Pay');
      await makeEntry(cycle.id, noPay.id, site.id, unit.id, { payoutOutcome: 'NO_PAY_DUE' });
      const recovery = await makeEmployee(site.id, unit.id, 'Status Recovery');
      await makeEntry(cycle.id, recovery.id, site.id, unit.id, { payoutOutcome: 'RECOVERY_DUE' });
      const pending = await makeEmployee(site.id, unit.id, 'Status Pending');
      await makeEntry(cycle.id, pending.id, site.id, unit.id);

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      const byEmployee = new Map(res.body.rows.map((r: { employeeId: string; rowStatus: string }) => [r.employeeId, r.rowStatus]));
      expect(byEmployee.get(released.id)).toBe('RELEASED');
      expect(byEmployee.get(held.id)).toBe('HELD');
      expect(byEmployee.get(noPay.id)).toBe('NO_PAY_DUE');
      expect(byEmployee.get(recovery.id)).toBe('RECOVERY_DUE');
      expect(byEmployee.get(pending.id)).toBe('PENDING');
    });

    it('a genuine Unit release transitions an entry to RELEASED via the real release endpoint', async () => {
      const admin = await masterAdminAgent('dr-status-release@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site DR Status Release');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Real Release Employee');
      await makeEntry(cycle.id, employee.id, site.id, unit.id, { days: '30' });

      await releaseUnit(admin, cycle.id, unit.id);

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.body.rows[0].rowStatus).toBe('RELEASED');
      expect(res.body.rows[0].releasedAt).not.toBeNull();
    });
  });

  // ================================================================================================
  // Pagination / sorting
  // ================================================================================================

  describe('Pagination and sorting', () => {
    async function makeSortFixtures() {
      const admin = await masterAdminAgent(`dr-sort-admin-${Math.random()}@test.local`);
      const { site, unit } = await makeSiteWithUnit(`Test Site DR Sort ${Math.random()}`);
      const cycle = await makeCycle(admin.userId);
      const alice = await makeEmployee(site.id, unit.id, 'Alice Sort', { employeeCode: 'DR-A' });
      await makeEntry(cycle.id, alice.id, site.id, unit.id, { advanceDeduction: '3000', eidAdvanceDeduction: '100', fine: '10', correctionBalanceRecovery: '1' });
      const bob = await makeEmployee(site.id, unit.id, 'Bob Sort', { employeeCode: 'DR-B' });
      await makeEntry(cycle.id, bob.id, site.id, unit.id, { advanceDeduction: '1000', eidAdvanceDeduction: '300', fine: '30', correctionBalanceRecovery: '3' });
      const carol = await makeEmployee(site.id, unit.id, 'Carol Sort', { employeeCode: 'DR-C' });
      await makeEntry(cycle.id, carol.id, site.id, unit.id, { advanceDeduction: '2000', eidAdvanceDeduction: '200', fine: '20', correctionBalanceRecovery: '2' });
      return { admin, site, unit, cycle, alice, bob, carol };
    }

    it.each([
      ['employeeCode', ['DR-A', 'DR-B', 'DR-C']],
      ['employeeName', ['Alice Sort', 'Bob Sort', 'Carol Sort']],
    ])('sorts by %s ascending', async (sortBy, expectedOrder) => {
      const { admin, cycle } = await makeSortFixtures();
      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy, sortDir: 'asc', pageSize: '10' }));
      const actual = res.body.rows.map((r: { employeeCode?: string; employeeName: string }) => (sortBy === 'employeeCode' ? r.employeeCode : r.employeeName));
      expect(actual).toEqual(expectedOrder);
    });

    it('sorts by advanceDeduction descending', async () => {
      const { admin, cycle, alice, bob, carol } = await makeSortFixtures();
      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'advanceDeduction', sortDir: 'desc', pageSize: '10' }));
      expect(res.body.rows.map((r: { employeeId: string }) => r.employeeId)).toEqual([alice.id, carol.id, bob.id]);
    });

    it('sorts by eidAdvanceDeduction ascending', async () => {
      const { admin, cycle, alice, bob, carol } = await makeSortFixtures();
      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'eidAdvanceDeduction', sortDir: 'asc', pageSize: '10' }));
      expect(res.body.rows.map((r: { employeeId: string }) => r.employeeId)).toEqual([alice.id, carol.id, bob.id]);
    });

    it('sorts by fine descending', async () => {
      const { admin, cycle, alice, bob, carol } = await makeSortFixtures();
      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'fine', sortDir: 'desc', pageSize: '10' }));
      expect(res.body.rows.map((r: { employeeId: string }) => r.employeeId)).toEqual([bob.id, carol.id, alice.id]);
    });

    it('sorts by correctionBalanceRecovery ascending', async () => {
      const { admin, cycle, alice, bob, carol } = await makeSortFixtures();
      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'correctionBalanceRecovery', sortDir: 'asc', pageSize: '10' }));
      expect(res.body.rows.map((r: { employeeId: string }) => r.employeeId)).toEqual([alice.id, carol.id, bob.id]);
    });

    it('sorts by site ascending', async () => {
      const { admin, cycle } = await makeSortFixtures();
      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'site', sortDir: 'asc', pageSize: '10' }));
      expect(res.body.rows).toHaveLength(3);
    });

    it('sorts by rowStatus using the shared, disclosed released/hold/payoutOutcome ordering approximation', async () => {
      const admin = await masterAdminAgent('dr-sort-status@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site DR Sort Status');
      const cycle = await makeCycle(admin.userId);
      const held = await makeEmployee(site.id, unit.id, 'Sort Status Held');
      await makeEntry(cycle.id, held.id, site.id, unit.id, { hold: true });
      const pending = await makeEmployee(site.id, unit.id, 'Sort Status Pending');
      await makeEntry(cycle.id, pending.id, site.id, unit.id);
      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'rowStatus', pageSize: '10' }));
      expect(res.body.rows).toHaveLength(2);
    });

    it('default sort is employeeName ascending', async () => {
      const { admin, cycle } = await makeSortFixtures();
      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, pageSize: '10' }));
      expect(res.body.rows.map((r: { employeeName: string }) => r.employeeName)).toEqual(['Alice Sort', 'Bob Sort', 'Carol Sort']);
    });

    it('paginates at the database level — page 2 never re-shows page 1 rows, with a stable id tie-break', async () => {
      const admin = await masterAdminAgent('dr-page-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site DR Page');
      const cycle = await makeCycle(admin.userId);
      for (let i = 0; i < 5; i += 1) {
        const employee = await makeEmployee(site.id, unit.id, `Page Employee ${i}`);
        await makeEntry(cycle.id, employee.id, site.id, unit.id, { fine: String(100 + i) });
      }

      const page1 = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'fine', sortDir: 'asc', page: '1', pageSize: '2' }));
      const page2 = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'fine', sortDir: 'asc', page: '2', pageSize: '2' }));
      const page3 = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'fine', sortDir: 'asc', page: '3', pageSize: '2' }));

      expect(page1.body.total).toBe(5);
      const allIds = [...page1.body.rows, ...page2.body.rows, ...page3.body.rows].map((r: { payrollEntryId: string }) => r.payrollEntryId);
      expect(new Set(allIds).size).toBe(5); // no overlap across pages
      expect(page3.body.rows).toHaveLength(1);
    });
  });

  // ================================================================================================
  // Totals
  // ================================================================================================

  describe('Totals', () => {
    it('computed over the complete filtered scope, unaffected by pagination', async () => {
      const admin = await masterAdminAgent('dr-totals-admin1@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site DR Totals Complete');
      const cycle = await makeCycle(admin.userId);
      for (let i = 0; i < 5; i += 1) {
        const employee = await makeEmployee(site.id, unit.id, `Totals Complete Employee ${i}`);
        await makeEntry(cycle.id, employee.id, site.id, unit.id, { fine: '100' });
      }

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, page: '1', pageSize: '2' }));
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(2);
      expect(res.body.totals.matchingCount).toBe(5);
      expect(res.body.totals.totalsComputed).toBe(true);
      expect(Number(res.body.totals.fineTotal)).toBeCloseTo(500, 2);
    });

    it('every deduction total sums correctly across a mixed set', async () => {
      const admin = await masterAdminAgent('dr-totals-admin2@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site DR Totals Mixed');
      const cycle = await makeCycle(admin.userId);
      const e1 = await makeEmployee(site.id, unit.id, 'Totals Mixed 1');
      await makeEntry(cycle.id, e1.id, site.id, unit.id, { eobiApplicable: true, eobiAmount: '400', advanceDeduction: '1000', eidAdvanceDeduction: '200', fine: '50', correctionBalanceRecovery: '100' });
      const e2 = await makeEmployee(site.id, unit.id, 'Totals Mixed 2');
      await makeEntry(cycle.id, e2.id, site.id, unit.id, { eobiApplicable: false, eobiAmount: '400', advanceDeduction: '500', eidAdvanceDeduction: '0', fine: '0', correctionBalanceRecovery: '0' });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      const totals = res.body.totals;
      expect(Number(totals.eobiTotal)).toBeCloseTo(400, 2); // e2's eobiApplicable=false contributes 0
      expect(Number(totals.advanceDeductionTotal)).toBeCloseTo(1500, 2);
      expect(Number(totals.eidAdvanceDeductionTotal)).toBeCloseTo(200, 2);
      expect(Number(totals.fineTotal)).toBeCloseTo(50, 2);
      expect(Number(totals.correctionRecoveryTotal)).toBeCloseTo(100, 2);
      expect(Number(totals.totalDeductions)).toBeCloseTo(400 + 1500 + 200 + 50 + 100, 2);
    });

    it('employeesWithAnyDeduction counts only rows with at least one effective deduction', async () => {
      const admin = await masterAdminAgent('dr-totals-admin3@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site DR Totals AnyDeduction');
      const cycle = await makeCycle(admin.userId);
      const withDeduction = await makeEmployee(site.id, unit.id, 'Any Deduction Yes');
      await makeEntry(cycle.id, withDeduction.id, site.id, unit.id, { eobiApplicable: false, eobiAmount: '0', fine: '50' });
      const withoutDeduction = await makeEmployee(site.id, unit.id, 'Any Deduction No');
      await makeEntry(cycle.id, withoutDeduction.id, site.id, unit.id, { eobiApplicable: false, eobiAmount: '0' });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.body.totals.matchingCount).toBe(2);
      expect(res.body.totals.employeesWithAnyDeduction).toBe(1);
    });

    it('status-breakdown counts sum to matchingCount, and correctedEntryCount reflects corrections independent of totalsComputed', async () => {
      const admin = await masterAdminAgent('dr-totals-admin4@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site DR Totals Breakdown');
      const cycle = await makeCycle(admin.userId);
      const adjustmentType = await makeAdjustmentType('DR_TOTALS');

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
      expect(totals.correctedEntryCount).toBe(1);
    });

    it('no per-Unit total exists anywhere in the response', async () => {
      const admin = await masterAdminAgent('dr-totals-admin5@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site DR Totals NoUnit');
      const secondUnit = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'Totals NoUnit Second Unit' } });
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'No Unit Total Employee');
      const entry = await makeEntry(cycle.id, employee.id, site.id, unit.id, { fine: '100' });
      await addSecondWorkLine(entry.id, site.id, secondUnit.id);

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      const raw = JSON.stringify(res.body).toLowerCase();
      expect(raw).not.toContain('unittotal');
      expect(raw).not.toContain('perunit');
      expect(res.body.rows[0].additionalUnitCount).toBe(1);
    });
  });

  // ================================================================================================
  // Export
  // ================================================================================================

  /**
   * The one canonical header-keyed reconstruction every M1 parity test below shares — a pure
   * *structural* mapping from a list-endpoint row's own field names to the export's header
   * vocabulary (frozen in `DEDUCTION_REPORT_EXPORT_HEADERS`), never a recomputation of any value.
   * Every value on the right-hand side is read verbatim off the list endpoint's own row (the
   * canonical truth this whole suite compares exports against), exactly mirroring
   * `deduction-report.service.ts`'s own `buildExportRow` — duplicated here, not imported, so this
   * remains a genuine independent check rather than testing the implementation against itself.
   */
  interface DeductionReportListRow {
    employeeCode?: string | null;
    employeeName: string;
    siteName: string;
    primaryUnit: { name: string } | null;
    additionalUnitCount: number;
    designation: string;
    eobi: string;
    advanceDeduction: string;
    eidAdvanceDeduction: string;
    fine: string;
    correctionBalanceRecovery: string;
    totalDeductions: string;
    rowStatus: string;
    correctionCount: number;
    releasedAt: string | null;
  }

  function expectedExportRecord(row: DeductionReportListRow): Record<string, string> {
    return {
      'Employee Code': row.employeeCode ?? '—',
      'Employee Name': row.employeeName,
      'Project Site': row.siteName,
      'Primary Unit': row.primaryUnit?.name ?? '—',
      'Additional Unit Count': String(row.additionalUnitCount),
      Designation: row.designation,
      EOBI: row.eobi,
      'Advance Deduction': row.advanceDeduction,
      'EID Advance Deduction': row.eidAdvanceDeduction,
      Fine: row.fine,
      'Correction Balance Recovery': row.correctionBalanceRecovery,
      'Total Deductions': row.totalDeductions,
      'Row Status': row.rowStatus,
      'Correction Count': String(row.correctionCount),
      'Released Date': row.releasedAt ? row.releasedAt.slice(0, 10) : '—',
    };
  }

  /** Reads the title/blank/header/data-row XLSX layout every sibling report's own export uses into
   * an array of header-keyed row objects — the XLSX equivalent of `csv-parse`'s `columns: true`,
   * built directly on top of the real `ExcelJS` worksheet API rather than positional cell indices. */
  function readXlsxDataRecords(worksheet: ExcelJS.Worksheet): Record<string, string>[] {
    const headerRow = worksheet.getRow(3);
    const headers: string[] = [];
    headerRow.eachCell((cell) => headers.push(String(cell.value)));

    const records: Record<string, string>[] = [];
    for (let rowNumber = 4; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const dataRow = worksheet.getRow(rowNumber);
      if (dataRow.cellCount === 0) continue;
      const record: Record<string, string> = {};
      headers.forEach((header, index) => {
        record[header] = String(dataRow.getCell(index + 1).value ?? '');
      });
      records.push(record);
    }
    return records;
  }

  async function loadXlsxWorksheet(buffer: Buffer): Promise<ExcelJS.Worksheet> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet('Deduction Report');
    if (!worksheet) throw new Error('Deduction Report worksheet not found');
    return worksheet;
  }

  describe('Export', () => {
    it('CSV export: exact header order, and every field of a header-keyed reconstructed record matches the list endpoint row verbatim (canonical truth, no recomputation)', async () => {
      const admin = await masterAdminAgent('dr-export-csv@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site DR Export CSV');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'CSV Export Employee', { employeeCode: 'DR-CSV-1' });
      await makeEntry(cycle.id, employee.id, site.id, unit.id, {
        eobiApplicable: true,
        eobiAmount: '400',
        advanceDeduction: '1000',
        eidAdvanceDeduction: '200',
        fine: '50',
        correctionBalanceRecovery: '100',
      });

      const listRes = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      const row = listRes.body.rows[0] as DeductionReportListRow;

      const csvRes = await admin.agent.get(exportUrl('csv', { cycleId: cycle.id }));
      expect(csvRes.status).toBe(200);

      // Exact header order, verified independently of the header-keyed parse below (columns:true
      // discards row ordering by construction, so this is not otherwise redundant with it).
      const positionalRecords: string[][] = parseCsvSync(csvRes.text, { skip_empty_lines: true });
      expect(positionalRecords[0]).toEqual(EXPECTED_EXPORT_HEADERS);

      // Header-keyed reconstruction (M1): parse with `columns: true` so each record is a real
      // object keyed by the CSV's own header row, then compare it directly against the list
      // endpoint's row, field by field, via one `toEqual` over the whole record — not a spot check.
      const keyedRecords = parseCsvSync(csvRes.text, { columns: true, skip_empty_lines: true }) as Record<string, string>[];
      expect(keyedRecords).toHaveLength(1);
      expect(keyedRecords[0]).toEqual(expectedExportRecord(row));
    });

    it('CSV export never includes a sensitive field', async () => {
      const admin = await masterAdminAgent('dr-export-csv-sensitive@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site DR Export CSV Sensitive');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'CSV Sensitive Employee', { cnic: '1234512345671' });
      await makeEntry(cycle.id, employee.id, site.id, unit.id, { fine: '10' });

      const res = await admin.agent.get(exportUrl('csv', { cycleId: cycle.id }));
      expect(res.status).toBe(200);
      const lowerText = res.text.toLowerCase();
      for (const forbidden of EXPORT_FORBIDDEN_KEYS) {
        expect(lowerText).not.toContain(forbidden);
      }
      expect(res.text).not.toContain('1234512345671');
    });

    it('XLSX export: worksheet exists with the correct name, exact safe header order, and every field of a header-keyed reconstructed record matches the list endpoint row verbatim', async () => {
      const admin = await masterAdminAgent('dr-export-xlsx@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site DR Export XLSX');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'XLSX Export Employee', { employeeCode: 'DR-XLSX-1' });
      await makeEntry(cycle.id, employee.id, site.id, unit.id, { fine: '75', advanceDeduction: '25' });

      const listRes = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      const row = listRes.body.rows[0] as DeductionReportListRow;

      const res = await admin.agent
        .get(exportUrl('xlsx', { cycleId: cycle.id }))
        .buffer(true)
        .parse(binaryParser);
      expect(res.status).toBe(200);

      const worksheet = await loadXlsxWorksheet(res.body as Buffer);
      expect(worksheet.name).toBe('Deduction Report');

      // Row 1: title, Row 2: blank, Row 3: headers, Row 4+: one row per matching entry.
      const headerRow = worksheet.getRow(3);
      const headerValues: string[] = [];
      headerRow.eachCell((cell) => headerValues.push(String(cell.value)));
      expect(headerValues).toEqual(EXPECTED_EXPORT_HEADERS);

      const headerText = headerValues.join(' | ');
      for (const forbidden of ['CNIC', 'Bank', 'IBAN', 'Branch Code', 'Account Number', 'Released By', 'Gross Pay', 'Net Salary', 'Correction Balance Payable']) {
        expect(headerText).not.toContain(forbidden);
      }

      // Header-keyed reconstruction (M1) — the ExcelJS equivalent of `csv-parse`'s `columns: true`,
      // compared field-by-field against the list endpoint's own row via one `toEqual`, not a
      // handful of spot-checked cells.
      const keyedRecords = readXlsxDataRecords(worksheet);
      expect(keyedRecords).toHaveLength(1);
      expect(keyedRecords[0]).toEqual(expectedExportRecord(row));
    });

    it('CSV and XLSX export row counts both equal the complete filtered dataset, entirely ignoring page/pageSize', async () => {
      const admin = await masterAdminAgent('dr-export-rowcount@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site DR Export RowCount');
      const cycle = await makeCycle(admin.userId);
      for (let i = 0; i < 7; i += 1) {
        const employee = await makeEmployee(site.id, unit.id, `RowCount Employee ${i}`);
        await makeEntry(cycle.id, employee.id, site.id, unit.id, { fine: String(10 + i) });
      }

      const listRes = await admin.agent.get(listUrl({ cycleId: cycle.id, pageSize: '2' }));
      expect(listRes.body.total).toBe(7);

      const csvRes = await admin.agent.get(exportUrl('csv', { cycleId: cycle.id, page: '3', pageSize: '2' }));
      const csvRecords = parseCsvSync(csvRes.text, { columns: true, skip_empty_lines: true }) as Record<string, string>[];
      expect(csvRecords).toHaveLength(7);

      const xlsxRes = await admin.agent
        .get(exportUrl('xlsx', { cycleId: cycle.id, page: '3', pageSize: '2' }))
        .buffer(true)
        .parse(binaryParser);
      const worksheet = await loadXlsxWorksheet(xlsxRes.body as Buffer);
      expect(readXlsxDataRecords(worksheet)).toHaveLength(7);
    });

    it('CSV and XLSX export row order both match the list endpoint\'s own sort order (sortBy=fine desc), not the export\'s independent order', async () => {
      const admin = await masterAdminAgent('dr-export-sortorder@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site DR Export SortOrder');
      const cycle = await makeCycle(admin.userId);
      const alice = await makeEmployee(site.id, unit.id, 'SortOrder Alice');
      await makeEntry(cycle.id, alice.id, site.id, unit.id, { fine: '10' });
      const bob = await makeEmployee(site.id, unit.id, 'SortOrder Bob');
      await makeEntry(cycle.id, bob.id, site.id, unit.id, { fine: '30' });
      const carol = await makeEmployee(site.id, unit.id, 'SortOrder Carol');
      await makeEntry(cycle.id, carol.id, site.id, unit.id, { fine: '20' });

      const listRes = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'fine', sortDir: 'desc', pageSize: '10' }));
      const expectedOrder = listRes.body.rows.map((r: { employeeName: string }) => r.employeeName);
      expect(expectedOrder).toEqual(['SortOrder Bob', 'SortOrder Carol', 'SortOrder Alice']);

      const csvRes = await admin.agent.get(exportUrl('csv', { cycleId: cycle.id, sortBy: 'fine', sortDir: 'desc' }));
      const csvRecords = parseCsvSync(csvRes.text, { columns: true, skip_empty_lines: true }) as Record<string, string>[];
      expect(csvRecords.map((r) => r['Employee Name'])).toEqual(expectedOrder);

      const xlsxRes = await admin.agent
        .get(exportUrl('xlsx', { cycleId: cycle.id, sortBy: 'fine', sortDir: 'desc' }))
        .buffer(true)
        .parse(binaryParser);
      const worksheet = await loadXlsxWorksheet(xlsxRes.body as Buffer);
      expect(readXlsxDataRecords(worksheet).map((r) => r['Employee Name'])).toEqual(expectedOrder);
    });

    it('export excludes CNIC/banking/Gross Pay/Net Salary/Correction Balance Payable — a recursive sensitive-key sweep, CSV records', async () => {
      const admin = await masterAdminAgent('dr-export-sweep@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site DR Export Sweep');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Sweep Export Employee');
      await makeEntry(cycle.id, employee.id, site.id, unit.id, { correctionBalancePayable: '999', fine: '20' });

      const res = await admin.agent.get(exportUrl('csv', { cycleId: cycle.id }));
      expect(res.status).toBe(200);
      const records = parseCsvSync(res.text, { columns: true, skip_empty_lines: true }) as Record<string, string>[];
      assertNoSensitiveKeys(records, EXPORT_FORBIDDEN_KEYS);
      expect(res.text).not.toContain('999.00'); // Correction Balance Payable's own value never appears
    });

    it('export excludes CNIC/banking/Gross Pay/Net Salary/Correction Balance Payable — a recursive sensitive-key sweep, XLSX reconstructed rows (M2, the third surface)', async () => {
      const admin = await masterAdminAgent('dr-export-sweep-xlsx@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site DR Export Sweep XLSX');
      const cycle = await makeCycle(admin.userId);
      const bank = await prisma.bank.create({ data: { code: 'TBDRSWEEP', name: 'Sweep Test Bank' } });
      const employee = await makeEmployee(site.id, unit.id, 'Sweep XLSX Employee', {
        cnic: '1234598765432',
        bankId: bank.id,
        accountNumber: '9988776655',
      });
      await makeEntry(cycle.id, employee.id, site.id, unit.id, { correctionBalancePayable: '999', fine: '20' });

      const res = await admin.agent
        .get(exportUrl('xlsx', { cycleId: cycle.id }))
        .buffer(true)
        .parse(binaryParser);
      expect(res.status).toBe(200);
      const worksheet = await loadXlsxWorksheet(res.body as Buffer);
      const records = readXlsxDataRecords(worksheet);
      assertNoSensitiveKeys(records, EXPORT_FORBIDDEN_KEYS);

      // Not just header/key absence — the raw sensitive values themselves never appear anywhere in
      // the workbook's own serialized cell content either.
      const allValues = records.flatMap((record) => Object.values(record)).join(' | ');
      expect(allValues).not.toContain('1234598765432'); // CNIC
      expect(allValues).not.toContain('9988776655'); // account number
      expect(allValues).not.toContain('999.00'); // Correction Balance Payable's own value
    });

    it('export applies filters identically to the list endpoint — complete filtered result, never a pagination-only subset (CSV and XLSX)', async () => {
      const admin = await masterAdminAgent('dr-export-filtered@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site DR Export Filtered');
      const cycle = await makeCycle(admin.userId);
      const withFine = await makeEmployee(site.id, unit.id, 'Export Filtered With Fine');
      await makeEntry(cycle.id, withFine.id, site.id, unit.id, { fine: '100' });
      const withoutFine = await makeEmployee(site.id, unit.id, 'Export Filtered Without Fine');
      await makeEntry(cycle.id, withoutFine.id, site.id, unit.id);

      const listRes = await admin.agent.get(listUrl({ cycleId: cycle.id, hasFine: 'true' }));
      expect(listRes.body.total).toBe(1);
      expect(listRes.body.rows[0].employeeName).toBe('Export Filtered With Fine');

      const csvRes = await admin.agent.get(exportUrl('csv', { cycleId: cycle.id, hasFine: 'true' }));
      const csvRecords = parseCsvSync(csvRes.text, { columns: true, skip_empty_lines: true }) as Record<string, string>[];
      expect(csvRecords).toHaveLength(1);
      expect(csvRecords[0]!['Employee Name']).toBe('Export Filtered With Fine');

      const xlsxRes = await admin.agent
        .get(exportUrl('xlsx', { cycleId: cycle.id, hasFine: 'true' }))
        .buffer(true)
        .parse(binaryParser);
      const worksheet = await loadXlsxWorksheet(xlsxRes.body as Buffer);
      const xlsxRecords = readXlsxDataRecords(worksheet);
      expect(xlsxRecords).toHaveLength(1);
      expect(xlsxRecords[0]!['Employee Name']).toBe('Export Filtered With Fine');
    });

    it('permission is enforced before any export work happens', async () => {
      const admin = await masterAdminAgent('dr-export-perm-admin@test.local');
      const { site } = await makeSiteWithUnit('Test Site DR Export Perm');
      const cycle = await makeCycle(admin.userId);
      const noPerm = await noPermissionAgent('dr-export-perm-noperm@test.local', [site.id]);
      const res = await noPerm.agent.get(exportUrl('csv', { cycleId: cycle.id }));
      expect(res.status).toBe(403);
    });
  });

  // ================================================================================================
  // Query discipline
  // ================================================================================================

  describe('Query discipline', () => {
    it('correction counts are batched — one query regardless of row count, never one query per row', async () => {
      const admin = await masterAdminAgent('dr-query-correction@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site DR Query Correction');
      const cycle = await makeCycle(admin.userId);
      const adjustmentType = await makeAdjustmentType('DR_QUERY_DISCIPLINE');
      for (let i = 0; i < 6; i += 1) {
        const employee = await makeEmployee(site.id, unit.id, `Query Correction Employee ${i}`);
        const entry = await makeEntry(cycle.id, employee.id, site.id, unit.id);
        if (i % 2 === 0) await makeCorrection(entry.id, adjustmentType.id, admin.userId);
      }

      const groupBySpy = jest.spyOn(prisma.correction, 'groupBy');
      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, pageSize: '10' }));
      expect(res.status).toBe(200);
      expect(groupBySpy).toHaveBeenCalledTimes(1);
      const correctedCount = res.body.rows.filter((r: { correctionCount: number }) => r.correctionCount > 0).length;
      expect(correctedCount).toBe(3);
      groupBySpy.mockRestore();
    });

    it('a multi-unit entry does not multiply row count — one PayrollEntry row regardless of work-line count', async () => {
      const admin = await masterAdminAgent('dr-query-multiunit@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site DR Query MultiUnit');
      const secondUnit = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'Query MultiUnit Second Unit' } });
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Multi Unit Query Employee');
      const entry = await makeEntry(cycle.id, employee.id, site.id, unit.id, { fine: '10' });
      await addSecondWorkLine(entry.id, site.id, secondUnit.id);

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0].additionalUnitCount).toBe(1);
    });
  });
});
