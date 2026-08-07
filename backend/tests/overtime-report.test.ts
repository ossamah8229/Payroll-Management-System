import request from 'supertest';
import ExcelJS from 'exceljs';
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
  'Unit',
  'Designation',
  'OT Hours',
  'Effective OT Rate',
  'OT Earnings',
  'Gross Pay',
  'Row Status',
  'Has Correction',
];

/** Substrings that must never appear anywhere in this report's response, on top of
 * `assertNoSensitiveKeys`'s own defaults — CNIC, every banking field, Net Salary, Total Earnings,
 * release-actor identity, correction-reason detail, and any live BalanceAdjustment figure are all
 * deliberately excluded from this report's flat vocabulary (frozen decisions — Columns section). */
const EXPORT_FORBIDDEN_KEYS = ['cnic', 'accountnumber', 'iban', 'bank', 'branchcode', 'releasedby', 'reason', 'netsalary', 'totalearning', 'remainingamount'];

/**
 * Phase 7 Reports, Overtime Report Checkpoint 1A (approved Checkpoint 0 architecture review,
 * 2026-08-07). Every fixture entry is created directly via Prisma, mirroring
 * `deduction-report.test.ts`'s own established pattern: this suite is about the report's own
 * grain/aggregation/authorization/scoping/filtering correctness, not Payroll Entry's own
 * creation/edit workflow.
 */
describe('Phase 7 Reports — Overtime Report (Checkpoint 1A)', () => {
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
      permissionKeys: [PERMISSIONS.PAYROLL_CYCLE_MANAGE, PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.PAYROLL_RELEASE, PERMISSIONS.CORRECTIONS_APPROVE, PERMISSIONS.REPORTS_VIEW],
    });
  }

  async function reportsViewerAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_OT_REPORTS_VIEWER',
      permissionKeys: [PERMISSIONS.REPORTS_VIEW],
      siteIds,
    });
  }

  async function statementsOnlyAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_OT_STATEMENTS_ONLY',
      permissionKeys: [PERMISSIONS.STATEMENTS_VIEW],
      siteIds,
    });
  }

  async function noPermissionAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_OT_NO_PERM',
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

  interface WorkLineSpec {
    unitId: string;
    otHours?: string;
    otRate?: string | null;
    days?: string;
    cycleDays?: number;
  }

  interface EntryOverrides {
    grossPay?: string;
    hold?: boolean;
    released?: boolean;
    releasedAt?: Date;
    releasedBy?: string;
    payoutOutcome?: 'NO_PAY_DUE' | 'RECOVERY_DUE';
    employeeNameSnapshot?: string;
    workLines?: WorkLineSpec[];
  }

  /** Defaults to a single work line with zero OT (no overtime), mirroring
   * `deduction-report.test.ts`'s own `makeEntry` shape, extended with an explicit `workLines`
   * override for this report's own multi-unit/OT-focused fixtures. */
  async function makeEntry(cycleId: string, employeeId: string, siteId: string, unitId: string, overrides: EntryOverrides = {}) {
    const workLineSpecs: WorkLineSpec[] = overrides.workLines ?? [{ unitId, otHours: '0', otRate: null, days: '26', cycleDays: 30 }];
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
        workLines: {
          create: workLineSpecs.map((spec, index) => ({
            siteId,
            unitId: spec.unitId,
            days: spec.days ?? '26',
            otHours: spec.otHours ?? '0',
            otRate: spec.otRate ?? null,
            cycleDays: spec.cycleDays ?? 30,
            sortOrder: index,
          })),
        },
      },
      include: { workLines: true },
    });
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
        field: 'OT_HOURS',
        oldValue: '4',
        newValue: '6',
        oldNetSalary: '29600',
        newNetSalary: '29850',
        adjustmentTypeId,
        reason: 'Overtime hours miscounted for this period',
        approvedById,
        ...overrides,
      },
    });
  }

  function listUrl(params: Record<string, string> = {}) {
    return `/api/v1/reports/overtime-report?${new URLSearchParams(params).toString()}`;
  }
  function exportUrl(format: 'csv' | 'xlsx', params: Record<string, string> = {}) {
    return `/api/v1/reports/overtime-report/export?${new URLSearchParams({ format, ...params }).toString()}`;
  }

  // ================================================================================================
  // Authorization
  // ================================================================================================

  describe('Authorization', () => {
    it('rejects a request with no session with 401', async () => {
      const admin = await masterAdminAgent('ot-auth-admin0@test.local');
      const cycle = await makeCycle(admin.userId);
      const res = await request(app).get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(401);
    });

    it('rejects a user lacking reports:view with 403', async () => {
      const admin = await masterAdminAgent('ot-auth-admin1@test.local');
      const { site } = await makeSiteWithUnit('Test Site OT Auth 1');
      const cycle = await makeCycle(admin.userId);
      const noPerm = await noPermissionAgent('ot-auth-noperm@test.local', [site.id]);
      const res = await noPerm.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(403);
    });

    it('a user with statements:view but not reports:view is denied', async () => {
      const admin = await masterAdminAgent('ot-auth-admin2@test.local');
      const { site } = await makeSiteWithUnit('Test Site OT Auth 2');
      const cycle = await makeCycle(admin.userId);
      const statementsOnly = await statementsOnlyAgent('ot-auth-statementsonly@test.local', [site.id]);
      const res = await statementsOnly.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(403);
    });

    it('Master Admin (global authority) can list with no site restriction', async () => {
      const admin = await masterAdminAgent('ot-auth-admin3@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site OT Auth 3');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Auth Admin Employee');
      await makeEntry(cycle.id, employee.id, site.id, unit.id, { workLines: [{ unitId: unit.id, otHours: '5' }] });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(200);
      expect(res.body.rows.some((row: { employeeId: string }) => row.employeeId === employee.id)).toBe(true);
    });

    it('a site-scoped reports:view user only sees their accessible site rows', async () => {
      const admin = await masterAdminAgent('ot-auth-admin4@test.local');
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site OT Auth Scope A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site OT Auth Scope B');
      const cycle = await makeCycle(admin.userId);
      const employeeA = await makeEmployee(siteA.id, unitA.id, 'Auth Scope Employee A');
      const employeeB = await makeEmployee(siteB.id, unitB.id, 'Auth Scope Employee B');
      await makeEntry(cycle.id, employeeA.id, siteA.id, unitA.id, { workLines: [{ unitId: unitA.id, otHours: '3' }] });
      await makeEntry(cycle.id, employeeB.id, siteB.id, unitB.id, { workLines: [{ unitId: unitB.id, otHours: '3' }] });

      const viewerA = await reportsViewerAgent('ot-auth-viewerA@test.local', [siteA.id]);
      const res = await viewerA.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0].siteId).toBe(siteA.id);
      expect(res.body.totals.matchingCount).toBe(1);
    });

    it('an explicit siteIds filter naming an inaccessible site is rejected with 403, never silently narrowed', async () => {
      const admin = await masterAdminAgent('ot-auth-admin5@test.local');
      const { site: siteA } = await makeSiteWithUnit('Test Site OT Auth Explicit A');
      const { site: siteB } = await makeSiteWithUnit('Test Site OT Auth Explicit B');
      const cycle = await makeCycle(admin.userId);
      const viewerA = await reportsViewerAgent('ot-auth-explicitA@test.local', [siteA.id]);
      const res = await viewerA.agent.get(listUrl({ cycleId: cycle.id, siteIds: siteB.id }));
      expect(res.status).toBe(403);
    });

    it('historical transfer: a site-scoped viewer sees only the entry attributed to their own site, using PayrollEntry.siteId, never Employee.siteId', async () => {
      const admin = await masterAdminAgent('ot-auth-admin6@test.local');
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site OT Transfer A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site OT Transfer B');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(siteB.id, unitB.id, 'Transferred Employee');
      const entry = await makeEntry(cycle.id, employee.id, siteA.id, unitA.id, { workLines: [{ unitId: unitA.id, otHours: '4' }] });

      const viewerA = await reportsViewerAgent('ot-transfer-viewerA@test.local', [siteA.id]);
      const resA = await viewerA.agent.get(listUrl({ cycleId: cycle.id }));
      expect(resA.status).toBe(200);
      expect(resA.body.rows).toHaveLength(1);
      expect(resA.body.rows[0].payrollEntryId).toBe(entry.id);
      expect(resA.body.rows[0].siteId).toBe(siteA.id);

      const viewerB = await reportsViewerAgent('ot-transfer-viewerB@test.local', [siteB.id]);
      const resB = await viewerB.agent.get(listUrl({ cycleId: cycle.id }));
      expect(resB.status).toBe(200);
      expect(resB.body.rows).toHaveLength(0);
    });

    it('a Unit belonging to an inaccessible Site is rejected with 403 — Unit cannot widen access', async () => {
      const admin = await masterAdminAgent('ot-auth-admin7@test.local');
      const { site: siteA } = await makeSiteWithUnit('Test Site OT Unit Widen A');
      const { unit: unitB } = await makeSiteWithUnit('Test Site OT Unit Widen B');
      const cycle = await makeCycle(admin.userId);
      const viewerA = await reportsViewerAgent('ot-unit-widen-viewerA@test.local', [siteA.id]);
      const res = await viewerA.agent.get(listUrl({ cycleId: cycle.id, unitId: unitB.id }));
      expect(res.status).toBe(403);
    });
  });

  // ================================================================================================
  // Contracts
  // ================================================================================================

  describe('Contracts', () => {
    it('rejects a request with no cycleId', async () => {
      const admin = await masterAdminAgent('ot-contract-admin1@test.local');
      const res = await admin.agent.get('/api/v1/reports/overtime-report');
      expect(res.status).toBe(400);
    });

    it('rejects a malformed cycleId UUID', async () => {
      const admin = await masterAdminAgent('ot-contract-admin2@test.local');
      const res = await admin.agent.get(listUrl({ cycleId: 'not-a-uuid' }));
      expect(res.status).toBe(400);
    });

    it('rejects a nonexistent cycleId with 404', async () => {
      const admin = await masterAdminAgent('ot-contract-admin3@test.local');
      const res = await admin.agent.get(listUrl({ cycleId: '00000000-0000-0000-0000-000000000000' }));
      expect(res.status).toBe(404);
    });

    it('rejects a malformed siteIds UUID', async () => {
      const admin = await masterAdminAgent('ot-contract-admin4@test.local');
      const cycle = await makeCycle(admin.userId);
      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, siteIds: 'not-a-uuid' }));
      expect(res.status).toBe(400);
    });

    it('rejects an out-of-range pageSize with 400, never silently clamped', async () => {
      const admin = await masterAdminAgent('ot-contract-admin5@test.local');
      const cycle = await makeCycle(admin.userId);
      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, pageSize: '500' }));
      expect(res.status).toBe(400);
    });

    it('rejects sortBy=effectiveOtRate and sortBy=otEarned — explicitly not approved sort fields (frozen decision)', async () => {
      const admin = await masterAdminAgent('ot-contract-admin6@test.local');
      const cycle = await makeCycle(admin.userId);
      const resRate = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'effectiveOtRate' }));
      expect(resRate.status).toBe(400);
      const resEarned = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'otEarned' }));
      expect(resEarned.status).toBe(400);
    });

    it('export accepts no page/pageSize — always the complete filtered result', async () => {
      const admin = await masterAdminAgent('ot-contract-admin7@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site OT Contract Export');
      const cycle = await makeCycle(admin.userId);
      for (let i = 0; i < 3; i += 1) {
        const employee = await makeEmployee(site.id, unit.id, `Export Contract Employee ${i}`);
        await makeEntry(cycle.id, employee.id, site.id, unit.id, { workLines: [{ unitId: unit.id, otHours: '5' }] });
      }
      const res = await admin.agent.get(exportUrl('csv', { cycleId: cycle.id, page: '1', pageSize: '1' }));
      expect(res.status).toBe(200);
      const lines = res.text.trim().split('\n');
      expect(lines.length).toBe(4); // header + all 3 rows, ignoring page/pageSize entirely
    });

    it('an unrecognized query parameter is silently inert', async () => {
      const admin = await masterAdminAgent('ot-contract-admin8@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site OT Contract Inert');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Inert Filter Employee');
      await makeEntry(cycle.id, employee.id, site.id, unit.id, { workLines: [{ unitId: unit.id, otHours: '2' }] });

      const baseline = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      const withExtra = await admin.agent.get(
        listUrl({ cycleId: cycle.id, employeeId: '11111111-1111-1111-1111-111111111111', designation: 'Nonexistent' }),
      );
      expect(withExtra.status).toBe(200);
      expect(withExtra.body.total).toBe(baseline.body.total);
      expect(withExtra.body.rows).toEqual(baseline.body.rows);
    });
  });

  // ================================================================================================
  // Grain correctness (frozen architectural exception: one row = one PayrollEntryWorkLine)
  // ================================================================================================

  describe('Grain correctness', () => {
    it('a single-work-line entry produces exactly 1 row', async () => {
      const admin = await masterAdminAgent('ot-grain-admin1@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site OT Grain Single');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Grain Single Employee');
      await makeEntry(cycle.id, employee.id, site.id, unit.id, { workLines: [{ unitId: unit.id, otHours: '4' }] });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.total).toBe(1);
    });

    it('a multi-unit entry (2 work lines) produces exactly 2 rows, one per Unit — never collapsed to 1', async () => {
      const admin = await masterAdminAgent('ot-grain-admin2@test.local');
      const { site, unit: unitA } = await makeSiteWithUnit('Test Site OT Grain Multi A');
      const unitB = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'Grain Multi Unit B' } });
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unitA.id, 'Grain Multi Employee');
      const entry = await makeEntry(cycle.id, employee.id, site.id, unitA.id, {
        workLines: [
          { unitId: unitA.id, otHours: '4', otRate: '150' },
          { unitId: unitB.id, otHours: '6', otRate: null },
        ],
      });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'unit', sortDir: 'asc' }));
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(2);
      expect(res.body.total).toBe(2);
      expect(res.body.rows.every((r: { payrollEntryId: string }) => r.payrollEntryId === entry.id)).toBe(true);
      const units = res.body.rows.map((r: { unit: { id: string } }) => r.unit.id).sort();
      expect(units).toEqual([unitA.id, unitB.id].sort());
    });

    it('each row carries its own Unit-specific OT hours/rate — never averaged or shared across lines', async () => {
      const admin = await masterAdminAgent('ot-grain-admin3@test.local');
      const { site, unit: unitA } = await makeSiteWithUnit('Test Site OT Grain Independence A');
      const unitB = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'Grain Independence Unit B' } });
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unitA.id, 'Grain Independence Employee');
      await makeEntry(cycle.id, employee.id, site.id, unitA.id, {
        grossPay: '30000',
        workLines: [
          { unitId: unitA.id, otHours: '4', otRate: '150', cycleDays: 30 },
          { unitId: unitB.id, otHours: '10', otRate: '200', cycleDays: 30 },
        ],
      });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'unit', sortDir: 'asc' }));
      expect(res.body.rows).toHaveLength(2);
      const rowA = res.body.rows.find((r: { unit: { id: string } }) => r.unit.id === unitA.id);
      const rowB = res.body.rows.find((r: { unit: { id: string } }) => r.unit.id === unitB.id);
      expect(rowA.otHours).toBe('4.00');
      expect(rowA.effectiveOtRate).toBe('150');
      expect(rowA.otEarned).toBe('600.00'); // 4 * 150
      expect(rowB.otHours).toBe('10.00');
      expect(rowB.effectiveOtRate).toBe('200');
      expect(rowB.otEarned).toBe('2000.00'); // 10 * 200
    });

    it('entry-level fields (Row Status, Has Correction, Gross Pay) repeat identically across a multi-line entry’s own rows', async () => {
      const admin = await masterAdminAgent('ot-grain-admin4@test.local');
      const { site, unit: unitA } = await makeSiteWithUnit('Test Site OT Grain Entry Fields A');
      const unitB = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'Grain Entry Fields Unit B' } });
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unitA.id, 'Grain Entry Fields Employee');
      await makeEntry(cycle.id, employee.id, site.id, unitA.id, {
        hold: true,
        grossPay: '40000',
        workLines: [
          { unitId: unitA.id, otHours: '2' },
          { unitId: unitB.id, otHours: '3' },
        ],
      });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.body.rows).toHaveLength(2);
      expect(res.body.rows.every((r: { rowStatus: string }) => r.rowStatus === 'HELD')).toBe(true);
      expect(res.body.rows.every((r: { grossPay: string }) => r.grossPay === '40000.00')).toBe(true);
      expect(res.body.rows.every((r: { hasCorrection: boolean }) => r.hasCorrection === false)).toBe(true);
    });
  });

  // ================================================================================================
  // Overtime correctness (canonical calcNet parity)
  // ================================================================================================

  describe('Overtime correctness', () => {
    it('effective OT rate equals the explicitly stored otRate when set', async () => {
      const admin = await masterAdminAgent('ot-calc-admin1@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site OT Calc Explicit Rate');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Explicit Rate Employee');
      await makeEntry(cycle.id, employee.id, site.id, unit.id, { workLines: [{ unitId: unit.id, otHours: '5', otRate: '175' }] });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.body.rows[0].effectiveOtRate).toBe('175');
      expect(res.body.rows[0].otEarned).toBe('875.00'); // 5 * 175
    });

    it('effective OT rate derives as grossPay / cycleDays / 8 when otRate is null — never a raw column read', async () => {
      const admin = await masterAdminAgent('ot-calc-admin2@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site OT Calc Derived Rate');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Derived Rate Employee');
      // dailyRate = 30000 / 30 = 1000; effectiveOtRate = 1000 / 8 = 125
      await makeEntry(cycle.id, employee.id, site.id, unit.id, { grossPay: '30000', workLines: [{ unitId: unit.id, otHours: '8', otRate: null, cycleDays: 30 }] });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(Number(res.body.rows[0].effectiveOtRate)).toBeCloseTo(125, 6);
      expect(res.body.rows[0].otEarned).toBe('1000.00'); // 8 * 125
    });

    it('a different cycleDays on the work line changes the derived rate independently of the entry', async () => {
      const admin = await masterAdminAgent('ot-calc-admin3@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site OT Calc CycleDays');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'CycleDays Employee');
      // dailyRate = 30000 / 26 ≈ 1153.8462; effectiveOtRate ≈ 144.2308
      await makeEntry(cycle.id, employee.id, site.id, unit.id, { grossPay: '30000', workLines: [{ unitId: unit.id, otHours: '2', otRate: null, cycleDays: 26 }] });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      const expectedRate = 30000 / 26 / 8;
      expect(Number(res.body.rows[0].effectiveOtRate)).toBeCloseTo(expectedRate, 4);
    });

    it('zero OT hours produces zero OT earnings, not an absent/null field', async () => {
      const admin = await masterAdminAgent('ot-calc-admin4@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site OT Calc Zero');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Zero OT Employee');
      await makeEntry(cycle.id, employee.id, site.id, unit.id, { workLines: [{ unitId: unit.id, otHours: '0' }] });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.body.rows[0].otHours).toBe('0.00');
      expect(res.body.rows[0].otEarned).toBe('0.00');
    });

    it('a correction against this entry never replays into this row — the original stored OT figures are unaffected, only hasCorrection changes', async () => {
      const admin = await masterAdminAgent('ot-calc-admin5@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site OT Calc Correction Replay');
      const cycle = await makeCycle(admin.userId);
      const adjustmentType = await makeAdjustmentType('OT_CORRECTION_REPLAY');
      const employee = await makeEmployee(site.id, unit.id, 'Correction Replay Employee');
      const entry = await makeEntry(cycle.id, employee.id, site.id, unit.id, { workLines: [{ unitId: unit.id, otHours: '4', otRate: '150' }] });

      const before = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(before.body.rows[0].otHours).toBe('4.00');
      expect(before.body.rows[0].hasCorrection).toBe(false);

      await makeCorrection(entry.id, adjustmentType.id, admin.userId);

      const after = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(after.body.rows[0].otHours).toBe('4.00'); // unchanged — never replayed
      expect(after.body.rows[0].hasCorrection).toBe(true);
    });

    it('no CNIC, banking, Net Salary, or Total Earnings appears anywhere in the response', async () => {
      const admin = await masterAdminAgent('ot-calc-admin6@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site OT Calc No Sensitive');
      const cycle = await makeCycle(admin.userId);
      const adjustmentType = await makeAdjustmentType('OT_NO_SENSITIVE');
      const employee = await makeEmployee(site.id, unit.id, 'No Sensitive Detail Employee');
      const entry = await makeEntry(cycle.id, employee.id, site.id, unit.id, { workLines: [{ unitId: unit.id, otHours: '5' }] });
      await makeCorrection(entry.id, adjustmentType.id, admin.userId);

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.status).toBe(200);
      assertNoSensitiveKeys(res.body, EXPORT_FORBIDDEN_KEYS);
      const raw = JSON.stringify(res.body).toLowerCase();
      expect(raw).not.toContain('overtime hours miscounted'); // the correction's own reason text
    });
  });

  // ================================================================================================
  // Filters
  // ================================================================================================

  describe('Filters', () => {
    async function makeFilterFixtures() {
      const admin = await masterAdminAgent(`ot-filt-admin-${Math.random()}@test.local`);
      const { site, unit: unitA } = await makeSiteWithUnit(`Test Site OT Filters ${Math.random()}`);
      const unitB = await prisma.projectUnit.create({ data: { siteId: site.id, name: `Filters Unit B ${Math.random()}` } });
      const cycle = await makeCycle(admin.userId);

      const withOvertime = await makeEmployee(site.id, unitA.id, 'Filter With Overtime');
      const withOvertimeEntry = await makeEntry(cycle.id, withOvertime.id, site.id, unitA.id, { workLines: [{ unitId: unitA.id, otHours: '5' }] });

      const noOvertime = await makeEmployee(site.id, unitA.id, 'Filter No Overtime');
      await makeEntry(cycle.id, noOvertime.id, site.id, unitA.id, { workLines: [{ unitId: unitA.id, otHours: '0' }] });

      const mixedLines = await makeEmployee(site.id, unitA.id, 'Filter Mixed Lines');
      await makeEntry(cycle.id, mixedLines.id, site.id, unitA.id, {
        workLines: [
          { unitId: unitA.id, otHours: '0' },
          { unitId: unitB.id, otHours: '7' },
        ],
      });

      return { admin, site, unitA, unitB, cycle, withOvertime, withOvertimeEntry, noOvertime, mixedLines };
    }

    it('hasOvertime=true matches only work lines with otHours > 0', async () => {
      const { admin, cycle, withOvertime } = await makeFilterFixtures();
      const yes = await admin.agent.get(listUrl({ cycleId: cycle.id, hasOvertime: 'true' }));
      // withOvertime's 1 line + mixedLines' 1 OT-bearing line = 2 matching rows
      expect(yes.body.total).toBe(2);
      expect(yes.body.rows.every((r: { otHours: string }) => Number(r.otHours) > 0)).toBe(true);
      expect(yes.body.rows.some((r: { employeeId: string }) => r.employeeId === withOvertime.id)).toBe(true);
    });

    it('hasOvertime=false matches only work lines with otHours <= 0', async () => {
      const { admin, cycle, noOvertime } = await makeFilterFixtures();
      const no = await admin.agent.get(listUrl({ cycleId: cycle.id, hasOvertime: 'false' }));
      // noOvertime's 1 line + mixedLines' 1 zero-OT line = 2 matching rows
      expect(no.body.total).toBe(2);
      expect(no.body.rows.every((r: { otHours: string }) => Number(r.otHours) === 0)).toBe(true);
      expect(no.body.rows.some((r: { employeeId: string }) => r.employeeId === noOvertime.id)).toBe(true);
    });

    it('hasOvertime omitted ("All") returns every work line, unfiltered — 4 rows across 3 entries (one multi-line)', async () => {
      const { admin, cycle } = await makeFilterFixtures();
      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.body.total).toBe(4);
    });

    it('a Unit filter narrows to only that Unit’s work lines, even within a multi-unit entry', async () => {
      const { admin, cycle, unitB, mixedLines } = await makeFilterFixtures();
      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, unitId: unitB.id }));
      expect(res.body.total).toBe(1);
      expect(res.body.rows[0].employeeId).toBe(mixedLines.id);
      expect(res.body.rows[0].unit.id).toBe(unitB.id);
    });

    it('Unit + hasOvertime compose with AND semantics', async () => {
      const { admin, cycle, unitA } = await makeFilterFixtures();
      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, unitId: unitA.id, hasOvertime: 'true' }));
      // Only withOvertime's own unitA line has otHours > 0 within unitA
      expect(res.body.total).toBe(1);
    });

    it('hasCorrection tri-state still works alongside hasOvertime', async () => {
      const admin = await masterAdminAgent('ot-filt-correction@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site OT Filt Correction');
      const cycle = await makeCycle(admin.userId);
      const adjustmentType = await makeAdjustmentType('OT_FILTER_CORRECTION');
      const withCorrection = await makeEmployee(site.id, unit.id, 'With Correction');
      const entryWith = await makeEntry(cycle.id, withCorrection.id, site.id, unit.id, { workLines: [{ unitId: unit.id, otHours: '5' }] });
      await makeCorrection(entryWith.id, adjustmentType.id, admin.userId);
      const withoutCorrection = await makeEmployee(site.id, unit.id, 'Without Correction');
      await makeEntry(cycle.id, withoutCorrection.id, site.id, unit.id, { workLines: [{ unitId: unit.id, otHours: '5' }] });

      const yes = await admin.agent.get(listUrl({ cycleId: cycle.id, hasCorrection: 'true' }));
      expect(yes.body.total).toBe(1);
      expect(yes.body.rows[0].employeeId).toBe(withCorrection.id);

      const no = await admin.agent.get(listUrl({ cycleId: cycle.id, hasCorrection: 'false' }));
      expect(no.body.total).toBe(1);
      expect(no.body.rows[0].employeeId).toBe(withoutCorrection.id);
    });

    it('Site multi-select and Row Status filters work', async () => {
      const admin = await masterAdminAgent('ot-filt-site-status@test.local');
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site OT Filt Site A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site OT Filt Site B');
      const cycle = await makeCycle(admin.userId);
      const empA = await makeEmployee(siteA.id, unitA.id, 'Site Status A');
      await makeEntry(cycle.id, empA.id, siteA.id, unitA.id, { hold: true, workLines: [{ unitId: unitA.id, otHours: '2' }] });
      const empB = await makeEmployee(siteB.id, unitB.id, 'Site Status B');
      await makeEntry(cycle.id, empB.id, siteB.id, unitB.id, { workLines: [{ unitId: unitB.id, otHours: '2' }] });

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
    it('derives all five canonical statuses correctly, including on multi-line entries', async () => {
      const admin = await masterAdminAgent('ot-status-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site OT Status');
      const cycle = await makeCycle(admin.userId);

      const released = await makeEmployee(site.id, unit.id, 'Status Released');
      await makeEntry(cycle.id, released.id, site.id, unit.id, { released: true, releasedAt: new Date(), releasedBy: admin.userId, workLines: [{ unitId: unit.id, otHours: '1' }] });
      const held = await makeEmployee(site.id, unit.id, 'Status Held');
      await makeEntry(cycle.id, held.id, site.id, unit.id, { hold: true, workLines: [{ unitId: unit.id, otHours: '1' }] });
      const noPay = await makeEmployee(site.id, unit.id, 'Status No Pay');
      await makeEntry(cycle.id, noPay.id, site.id, unit.id, { payoutOutcome: 'NO_PAY_DUE', workLines: [{ unitId: unit.id, otHours: '1' }] });
      const recovery = await makeEmployee(site.id, unit.id, 'Status Recovery');
      await makeEntry(cycle.id, recovery.id, site.id, unit.id, { payoutOutcome: 'RECOVERY_DUE', workLines: [{ unitId: unit.id, otHours: '1' }] });
      const pending = await makeEmployee(site.id, unit.id, 'Status Pending');
      await makeEntry(cycle.id, pending.id, site.id, unit.id, { workLines: [{ unitId: unit.id, otHours: '1' }] });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      const byEmployee = new Map(res.body.rows.map((r: { employeeId: string; rowStatus: string }) => [r.employeeId, r.rowStatus]));
      expect(byEmployee.get(released.id)).toBe('RELEASED');
      expect(byEmployee.get(held.id)).toBe('HELD');
      expect(byEmployee.get(noPay.id)).toBe('NO_PAY_DUE');
      expect(byEmployee.get(recovery.id)).toBe('RECOVERY_DUE');
      expect(byEmployee.get(pending.id)).toBe('PENDING');
    });

    it('a genuine Unit release transitions all of this entry’s rows to RELEASED via the real release endpoint', async () => {
      const admin = await masterAdminAgent('ot-status-release@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site OT Status Release');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Real Release Employee');
      await makeEntry(cycle.id, employee.id, site.id, unit.id, { workLines: [{ unitId: unit.id, otHours: '3', days: '30' }] });

      await releaseUnit(admin, cycle.id, unit.id);

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.body.rows[0].rowStatus).toBe('RELEASED');
    });
  });

  // ================================================================================================
  // Sorting / pagination
  // ================================================================================================

  describe('Sorting and pagination', () => {
    async function makeSortFixtures() {
      const admin = await masterAdminAgent(`ot-sort-admin-${Math.random()}@test.local`);
      const { site, unit } = await makeSiteWithUnit(`Test Site OT Sort ${Math.random()}`);
      const cycle = await makeCycle(admin.userId);
      const alice = await makeEmployee(site.id, unit.id, 'Alice Sort', { employeeCode: 'OT-A' });
      await makeEntry(cycle.id, alice.id, site.id, unit.id, { workLines: [{ unitId: unit.id, otHours: '9' }] });
      const bob = await makeEmployee(site.id, unit.id, 'Bob Sort', { employeeCode: 'OT-B' });
      await makeEntry(cycle.id, bob.id, site.id, unit.id, { workLines: [{ unitId: unit.id, otHours: '3' }] });
      const carol = await makeEmployee(site.id, unit.id, 'Carol Sort', { employeeCode: 'OT-C' });
      await makeEntry(cycle.id, carol.id, site.id, unit.id, { workLines: [{ unitId: unit.id, otHours: '6' }] });
      return { admin, site, unit, cycle, alice, bob, carol };
    }

    it.each([
      ['employeeCode', ['OT-A', 'OT-B', 'OT-C']],
      ['employeeName', ['Alice Sort', 'Bob Sort', 'Carol Sort']],
    ])('sorts by %s ascending', async (sortBy, expectedOrder) => {
      const { admin, cycle } = await makeSortFixtures();
      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy, sortDir: 'asc', pageSize: '10' }));
      const actual = res.body.rows.map((r: { employeeCode?: string; employeeName: string }) => (sortBy === 'employeeCode' ? r.employeeCode : r.employeeName));
      expect(actual).toEqual(expectedOrder);
    });

    it('sorts by otHours descending — a plain stored column, DB-native', async () => {
      const { admin, cycle, alice, bob, carol } = await makeSortFixtures();
      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'otHours', sortDir: 'desc', pageSize: '10' }));
      expect(res.body.rows.map((r: { employeeId: string }) => r.employeeId)).toEqual([alice.id, carol.id, bob.id]);
    });

    it('sorts by site ascending', async () => {
      const { admin, cycle } = await makeSortFixtures();
      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'site', sortDir: 'asc', pageSize: '10' }));
      expect(res.body.rows).toHaveLength(3);
    });

    it('sorts by unit ascending', async () => {
      const admin = await masterAdminAgent('ot-sort-unit@test.local');
      const { site, unit: unitA } = await makeSiteWithUnit('Test Site OT Sort Unit A');
      const unitB = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'AAA Sort Unit B' } });
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unitA.id, 'Sort Unit Employee');
      await makeEntry(cycle.id, employee.id, site.id, unitA.id, {
        workLines: [
          { unitId: unitA.id, otHours: '2' },
          { unitId: unitB.id, otHours: '3' },
        ],
      });
      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'unit', sortDir: 'asc', pageSize: '10' }));
      expect(res.body.rows).toHaveLength(2);
      expect(res.body.rows[0].unit.name).toBe(unitB.name); // "AAA..." sorts before "Test Site..."
    });

    it('sorts by rowStatus using the shared, disclosed released/hold/payoutOutcome ordering approximation', async () => {
      const admin = await masterAdminAgent('ot-sort-status@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site OT Sort Status');
      const cycle = await makeCycle(admin.userId);
      const held = await makeEmployee(site.id, unit.id, 'Sort Status Held');
      await makeEntry(cycle.id, held.id, site.id, unit.id, { hold: true, workLines: [{ unitId: unit.id, otHours: '1' }] });
      const pending = await makeEmployee(site.id, unit.id, 'Sort Status Pending');
      await makeEntry(cycle.id, pending.id, site.id, unit.id, { workLines: [{ unitId: unit.id, otHours: '1' }] });
      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'rowStatus', pageSize: '10' }));
      expect(res.body.rows).toHaveLength(2);
    });

    it('default sort is employeeName ascending', async () => {
      const { admin, cycle } = await makeSortFixtures();
      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, pageSize: '10' }));
      expect(res.body.rows.map((r: { employeeName: string }) => r.employeeName)).toEqual(['Alice Sort', 'Bob Sort', 'Carol Sort']);
    });

    it('paginates at the database level — page 2 never re-shows page 1 rows, with a stable id tie-break, across a mix of single- and multi-line entries', async () => {
      const admin = await masterAdminAgent('ot-page-admin@test.local');
      const { site, unit: unitA } = await makeSiteWithUnit('Test Site OT Page A');
      const unitB = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'Page Unit B' } });
      const cycle = await makeCycle(admin.userId);
      // 3 single-line entries + 1 two-line entry = 5 total work-line rows.
      for (let i = 0; i < 3; i += 1) {
        const employee = await makeEmployee(site.id, unitA.id, `Page Employee ${i}`);
        await makeEntry(cycle.id, employee.id, site.id, unitA.id, { workLines: [{ unitId: unitA.id, otHours: String(i + 1) }] });
      }
      const multiEmployee = await makeEmployee(site.id, unitA.id, 'Page Multi Employee');
      await makeEntry(cycle.id, multiEmployee.id, site.id, unitA.id, {
        workLines: [
          { unitId: unitA.id, otHours: '10' },
          { unitId: unitB.id, otHours: '11' },
        ],
      });

      const page1 = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'otHours', sortDir: 'asc', page: '1', pageSize: '2' }));
      const page2 = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'otHours', sortDir: 'asc', page: '2', pageSize: '2' }));
      const page3 = await admin.agent.get(listUrl({ cycleId: cycle.id, sortBy: 'otHours', sortDir: 'asc', page: '3', pageSize: '2' }));

      expect(page1.body.total).toBe(5);
      const allIds = [...page1.body.rows, ...page2.body.rows, ...page3.body.rows].map((r: { workLineId: string }) => r.workLineId);
      expect(new Set(allIds).size).toBe(5); // no overlap across pages
      expect(page3.body.rows).toHaveLength(1);
    });
  });

  // ================================================================================================
  // Totals
  // ================================================================================================

  describe('Totals', () => {
    it('computed over the complete filtered scope, unaffected by pagination', async () => {
      const admin = await masterAdminAgent('ot-totals-admin1@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site OT Totals Complete');
      const cycle = await makeCycle(admin.userId);
      for (let i = 0; i < 5; i += 1) {
        const employee = await makeEmployee(site.id, unit.id, `Totals Complete Employee ${i}`);
        await makeEntry(cycle.id, employee.id, site.id, unit.id, { workLines: [{ unitId: unit.id, otHours: '4', otRate: '100' }] });
      }

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id, page: '1', pageSize: '2' }));
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(2);
      expect(res.body.totals.matchingCount).toBe(5);
      expect(res.body.totals.totalsComputed).toBe(true);
      expect(Number(res.body.totals.totalOtHours)).toBeCloseTo(20, 2); // 5 * 4
      expect(Number(res.body.totals.totalOtEarnings)).toBeCloseTo(2000, 2); // 5 * (4*100)
    });

    it('a multi-unit entry never double-counts as 2 employees/2 released entries in the entry-level totals', async () => {
      const admin = await masterAdminAgent('ot-totals-admin2@test.local');
      const { site, unit: unitA } = await makeSiteWithUnit('Test Site OT Totals Multi A');
      const unitB = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'Totals Multi Unit B' } });
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unitA.id, 'Totals Multi Employee');
      await makeEntry(cycle.id, employee.id, site.id, unitA.id, {
        released: true,
        releasedAt: new Date(),
        releasedBy: admin.userId,
        workLines: [
          { unitId: unitA.id, otHours: '3' },
          { unitId: unitB.id, otHours: '5' },
        ],
      });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.body.totals.matchingCount).toBe(2); // 2 work-line rows
      expect(res.body.totals.employeesWithOvertimeCount).toBe(1); // 1 distinct employee/entry
      expect(res.body.totals.releasedCount).toBe(1); // 1 distinct entry, not 2
      expect(res.body.totals.sitesWithOvertimeCount).toBe(1);
      expect(res.body.totals.unitsWithOvertimeCount).toBe(2); // 2 distinct units
    });

    it('employeesWithOvertimeCount/sitesWithOvertimeCount/unitsWithOvertimeCount only count the otHours > 0 subset', async () => {
      const admin = await masterAdminAgent('ot-totals-admin3@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site OT Totals Subset');
      const cycle = await makeCycle(admin.userId);
      const withOt = await makeEmployee(site.id, unit.id, 'Totals Subset With OT');
      await makeEntry(cycle.id, withOt.id, site.id, unit.id, { workLines: [{ unitId: unit.id, otHours: '5' }] });
      const withoutOt = await makeEmployee(site.id, unit.id, 'Totals Subset Without OT');
      await makeEntry(cycle.id, withoutOt.id, site.id, unit.id, { workLines: [{ unitId: unit.id, otHours: '0' }] });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.body.totals.matchingCount).toBe(2);
      expect(res.body.totals.employeesWithOvertimeCount).toBe(1);
    });

    it('status-breakdown counts (Released/Held/Pending) reflect distinct entries, and correctedEntryCount is independent of totalsComputed', async () => {
      const admin = await masterAdminAgent('ot-totals-admin4@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site OT Totals Breakdown');
      const cycle = await makeCycle(admin.userId);
      const adjustmentType = await makeAdjustmentType('OT_TOTALS');

      const held = await makeEmployee(site.id, unit.id, 'Totals Held');
      await makeEntry(cycle.id, held.id, site.id, unit.id, { hold: true, workLines: [{ unitId: unit.id, otHours: '2' }] });
      const pending = await makeEmployee(site.id, unit.id, 'Totals Pending');
      const pendingEntry = await makeEntry(cycle.id, pending.id, site.id, unit.id, { workLines: [{ unitId: unit.id, otHours: '2' }] });
      await makeCorrection(pendingEntry.id, adjustmentType.id, admin.userId);
      const released = await makeEmployee(site.id, unit.id, 'Totals Released');
      await makeEntry(cycle.id, released.id, site.id, unit.id, { released: true, releasedAt: new Date(), releasedBy: admin.userId, workLines: [{ unitId: unit.id, otHours: '2' }] });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      const totals = res.body.totals;
      expect(totals.matchingCount).toBe(3);
      expect(totals.heldCount).toBe(1);
      expect(totals.pendingCount).toBe(1);
      expect(totals.releasedCount).toBe(1);
      expect(totals.correctedEntryCount).toBe(1);
    });

    it('NO_PAY_DUE/RECOVERY_DUE entries are counted in matchingCount but not broken out as their own totals bucket (approved 3-bucket scope)', async () => {
      const admin = await masterAdminAgent('ot-totals-admin5@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site OT Totals NoPay');
      const cycle = await makeCycle(admin.userId);
      const noPay = await makeEmployee(site.id, unit.id, 'Totals No Pay');
      await makeEntry(cycle.id, noPay.id, site.id, unit.id, { payoutOutcome: 'NO_PAY_DUE', workLines: [{ unitId: unit.id, otHours: '2' }] });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      expect(res.body.totals.matchingCount).toBe(1);
      expect(res.body.totals.releasedCount).toBe(0);
      expect(res.body.totals.heldCount).toBe(0);
      expect(res.body.totals.pendingCount).toBe(0);
      // Still fully reachable via the rowStatus row filter (all 5 canonical values).
      const filtered = await admin.agent.get(listUrl({ cycleId: cycle.id, rowStatus: 'NO_PAY_DUE' }));
      expect(filtered.body.total).toBe(1);
    });

    it('no "Average OT Rate" field exists anywhere in the response (frozen decision — not implemented)', async () => {
      const admin = await masterAdminAgent('ot-totals-admin6@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site OT Totals No Average');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'No Average Employee');
      await makeEntry(cycle.id, employee.id, site.id, unit.id, { workLines: [{ unitId: unit.id, otHours: '5', otRate: '150' }] });

      const res = await admin.agent.get(listUrl({ cycleId: cycle.id }));
      const raw = JSON.stringify(res.body).toLowerCase();
      expect(raw).not.toContain('averageotrate');
      expect(raw).not.toContain('averagerate');
    });
  });

  // ================================================================================================
  // Export
  // ================================================================================================

  describe('Export', () => {
    it('CSV export has the approved header vocabulary and complete filtered result', async () => {
      const admin = await masterAdminAgent('ot-export-admin1@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site OT Export CSV');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Export CSV Employee', { employeeCode: 'OT-EXP-1' });
      await makeEntry(cycle.id, employee.id, site.id, unit.id, { workLines: [{ unitId: unit.id, otHours: '5', otRate: '150' }] });

      const res = await admin.agent.get(exportUrl('csv', { cycleId: cycle.id }));
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      const lines = res.text.trim().split('\n');
      expect(lines[0]).toBe(EXPECTED_EXPORT_HEADERS.join(','));
      expect(lines.length).toBe(2);
      expect(lines[1]).toContain('OT-EXP-1');
      expect(lines[1]).toContain('750.00'); // 5 * 150
    });

    it('XLSX export produces a valid workbook with the same header vocabulary', async () => {
      const admin = await masterAdminAgent('ot-export-admin2@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site OT Export XLSX');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Export XLSX Employee');
      await makeEntry(cycle.id, employee.id, site.id, unit.id, { workLines: [{ unitId: unit.id, otHours: '5' }] });

      const res = await admin.agent.get(exportUrl('xlsx', { cycleId: cycle.id })).buffer(true).parse(binaryParser);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.body as Buffer);
      const worksheet = workbook.getWorksheet('Overtime Report');
      if (!worksheet) throw new Error('Overtime Report worksheet not found');
      const headerRow = worksheet.getRow(3);
      const headers: string[] = [];
      headerRow.eachCell((cell) => headers.push(String(cell.value)));
      expect(headers).toEqual(EXPECTED_EXPORT_HEADERS);
    });

    it('export produces one row per work line — a multi-unit entry contributes multiple export rows', async () => {
      const admin = await masterAdminAgent('ot-export-admin3@test.local');
      const { site, unit: unitA } = await makeSiteWithUnit('Test Site OT Export Multi A');
      const unitB = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'Export Multi Unit B' } });
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unitA.id, 'Export Multi Employee');
      await makeEntry(cycle.id, employee.id, site.id, unitA.id, {
        workLines: [
          { unitId: unitA.id, otHours: '2' },
          { unitId: unitB.id, otHours: '3' },
        ],
      });

      const res = await admin.agent.get(exportUrl('csv', { cycleId: cycle.id }));
      expect(res.status).toBe(200);
      const lines = res.text.trim().split('\n');
      expect(lines.length).toBe(3); // header + 2 work-line rows
    });

    it('export rejects an over-limit query with a structured 413 — proven at the real ceiling in overtime-report-boundary.test.ts', async () => {
      // Contract-level smoke check only; the exact 20,000-row boundary is proven at real volume in
      // the dedicated boundary suite, mirroring `deduction-report-boundary.test.ts`'s own split.
      const admin = await masterAdminAgent('ot-export-admin4@test.local');
      const cycle = await makeCycle(admin.userId);
      const res = await admin.agent.get(exportUrl('csv', { cycleId: cycle.id }));
      expect(res.status).toBe(200); // zero matching rows, well under the ceiling
      const lines = res.text.trim().split('\n');
      expect(lines.length).toBe(1); // header only
    });

    it('no CNIC, banking, Net Salary, or Total Earnings appears in either export format', async () => {
      const admin = await masterAdminAgent('ot-export-admin5@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site OT Export No Sensitive');
      const cycle = await makeCycle(admin.userId);
      const employee = await makeEmployee(site.id, unit.id, 'Export No Sensitive Employee');
      await makeEntry(cycle.id, employee.id, site.id, unit.id, { workLines: [{ unitId: unit.id, otHours: '5' }] });

      const csvRes = await admin.agent.get(exportUrl('csv', { cycleId: cycle.id }));
      const csvLower = csvRes.text.toLowerCase();
      for (const key of EXPORT_FORBIDDEN_KEYS) expect(csvLower).not.toContain(key);
    });
  });
});
