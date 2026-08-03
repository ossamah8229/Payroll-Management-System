import ExcelJS from 'exceljs';
import request from 'supertest';
import { PERMISSIONS, ROLE_CODES, calcNet } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent, assertNoSensitiveKeys } from './helpers';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

/** Same binary-response workaround `bank-sheets.test.ts`/`statement-export.test.ts` already use —
 * supertest doesn't auto-buffer an XLSX content-type as binary. */
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

/**
 * Phase 8B Checkpoint 1 — Reports: Payroll Summary Report.
 *
 * Every fixture entry is created directly via Prisma (mirroring `corrections-release-consumption
 * .test.ts`'s own established pattern) so each test can set exactly the financial columns it needs
 * to prove — this suite is about the Report's own aggregation/reconciliation, not about Payroll
 * Entry's creation/edit workflow, which is already covered by `payroll-entry.test.ts`. Release/
 * finalize *transitions* are still exercised through the real HTTP endpoints wherever the test cares
 * about release-state bucketing, so those buckets are proven against real production release logic,
 * not simulated.
 */
describe('Phase 8B Checkpoint 1 — Reports: Payroll Summary', () => {
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

  /** A dedicated `TEST_`-coded role holding exactly `reports:view` and nothing else — never
   * `ROLE_CODES.PAYROLL_STAFF` (see `noReportsAgent`'s own doc comment for why reusing a real
   * system role code would silently inherit its full seeded permission set). */
  async function reportsViewerAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_REPORTS_VIEWER',
      permissionKeys: [PERMISSIONS.REPORTS_VIEW],
      siteIds,
    });
  }

  /** A dedicated `TEST_`-coded role, never `ROLE_CODES.PAYROLL_STAFF` — `createTestUser`
   * (`tests/helpers.ts`) upserts a role by its `code`, so reusing a real system role code would
   * attach to the *actual* seeded Payroll Staff role, which already grants `reports:view` by
   * default (Phase 8A investigation report §11) — exactly the permission this agent exists to
   * *not* have. Matches `bank-sheets.test.ts`'s own `'TEST_NO_BANK_SHEETS'` precedent for the
   * identical reason. */
  async function noReportsAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_NO_REPORTS',
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

  async function makeSiteWithUnit(name: string, unitCount = 1) {
    const site = await prisma.projectSite.create({ data: { name } });
    const units = [];
    for (let i = 0; i < unitCount; i += 1) {
      units.push(await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} Unit ${i + 1}`, code: `U-${i + 1}` } }));
    }
    return { site, units, unit: units[0]! };
  }

  async function makeEmployee(siteId: string, unitId: string, name: string) {
    return prisma.employee.create({ data: { name, designation: 'Guard', siteId, unitId, grossPay: '30000' } });
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
    days?: string;
    otHours?: string;
    otRate?: string | null;
    cycleDays?: number;
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
        grossPay: overrides.grossPay ?? '30000',
        allowance: overrides.allowance ?? '0',
        eobiAmount: overrides.eobiAmount ?? '400',
        eobiApplicable: overrides.eobiApplicable ?? true,
        advanceDeduction: overrides.advanceDeduction ?? '0',
        eidAdvanceDeduction: overrides.eidAdvanceDeduction ?? '0',
        fine: overrides.fine ?? '0',
        correctionBalancePayable: overrides.correctionBalancePayable ?? '0',
        correctionBalanceRecovery: overrides.correctionBalanceRecovery ?? '0',
        hold: overrides.hold ?? false,
        workLines: {
          create: [
            {
              siteId,
              unitId,
              days: overrides.days ?? '26',
              otHours: overrides.otHours ?? '0',
              otRate: overrides.otRate ?? null,
              cycleDays: overrides.cycleDays ?? 30,
            },
          ],
        },
      },
      include: { workLines: true },
    });
  }

  async function releaseUnit(admin: Awaited<ReturnType<typeof masterAdminAgent>>, cycleId: string, unitId: string) {
    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycleId}/units/${unitId}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(res.status).toBe(201);
    return res;
  }

  async function finalizeCycle(admin: Awaited<ReturnType<typeof masterAdminAgent>>, cycleId: string) {
    const res = await admin.agent.post(`/api/v1/payroll-cycles/${cycleId}/finalize`).set('x-csrf-token', admin.csrfToken).send({});
    expect(res.status).toBe(200);
    return res;
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
        oldNetSalary: '30000',
        newNetSalary: '35000',
        adjustmentTypeId,
        reason: 'Attendance miscounted for this period',
        approvedById,
      },
    });
  }

  async function makeBalanceAdjustment(
    correctionId: string,
    employeeId: string,
    sourceCycleId: string,
    adjustmentTypeId: string,
    type: 'PAYABLE' | 'RECOVERY',
    amount: string,
  ) {
    return prisma.balanceAdjustment.create({
      data: {
        correctionId,
        employeeId,
        sourceCycleId,
        adjustmentTypeId,
        amount,
        type,
        remainingAmount: amount,
        status: 'PENDING',
        paymentTiming: type === 'PAYABLE' ? 'DEFERRED' : null,
        remark: 'Balance from a correction',
      },
    });
  }

  async function materialize(admin: Awaited<ReturnType<typeof masterAdminAgent>>, balanceAdjustmentId: string, targetCycleId: string) {
    const res = await admin.agent
      .post(`/api/v1/balance-adjustments/${balanceAdjustmentId}/materializations`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ targetCycleId });
    expect(res.status).toBe(201);
    return res;
  }

  function reportUrl(cycleId: string, extra: Record<string, string> = {}) {
    const params = new URLSearchParams({ cycleId, ...extra });
    return `/api/v1/reports/payroll-summary?${params.toString()}`;
  }

  function exportUrl(cycleId: string, format: 'csv' | 'xlsx', extra: Record<string, string> = {}) {
    const params = new URLSearchParams({ cycleId, format, ...extra });
    return `/api/v1/reports/payroll-summary/export?${params.toString()}`;
  }

  // ================================================================================================
  // Group A — Access & Security
  // ================================================================================================

  it('rejects an unauthenticated request with 401', async () => {
    const admin = await masterAdminAgent('rpt-sec-admin1@test.local');
    const { site } = await makeSiteWithUnit('Test Site RPT Sec 1');
    const cycle = await makeCycle(admin.userId);
    const res = await request(app).get(reportUrl(cycle.id));
    expect(res.status).toBe(401);
    void site;
  });

  it('rejects an authenticated user without reports:view with 403', async () => {
    const admin = await masterAdminAgent('rpt-sec-admin2@test.local');
    const { site } = await makeSiteWithUnit('Test Site RPT Sec 2');
    const cycle = await makeCycle(admin.userId);
    const noReports = await noReportsAgent('rpt-sec-noview@test.local', [site.id]);

    const res = await noReports.agent.get(reportUrl(cycle.id));
    expect(res.status).toBe(403);
  });

  it('allows a user holding reports:view (200)', async () => {
    const admin = await masterAdminAgent('rpt-sec-admin3@test.local');
    const { site } = await makeSiteWithUnit('Test Site RPT Sec 3');
    const cycle = await makeCycle(admin.userId);
    const viewer = await reportsViewerAgent('rpt-sec-viewer@test.local', [site.id]);

    const res = await viewer.agent.get(reportUrl(cycle.id));
    expect(res.status).toBe(200);
  });

  it('a restricted-site user sees only their accessible sites when no explicit filter is given', async () => {
    const admin = await masterAdminAgent('rpt-sec-admin4@test.local');
    const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site RPT Sec Scope A');
    const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site RPT Sec Scope B');
    const cycle = await makeCycle(admin.userId);
    const employeeA = await makeEmployee(siteA.id, unitA.id, 'Scoped Employee A');
    const employeeB = await makeEmployee(siteB.id, unitB.id, 'Scoped Employee B');
    await makeEntry(cycle.id, employeeA.id, siteA.id, unitA.id);
    await makeEntry(cycle.id, employeeB.id, siteB.id, unitB.id);

    const viewerA = await reportsViewerAgent('rpt-sec-viewerA@test.local', [siteA.id]);
    const res = await viewerA.agent.get(reportUrl(cycle.id));
    expect(res.status).toBe(200);
    expect(res.body.siteRows).toHaveLength(1);
    expect(res.body.siteRows[0].siteId).toBe(siteA.id);
    expect(res.body.cycleTotals.employeeCount).toBe(1);
  });

  it('an explicit inaccessible site filter is rejected with 403, never silently narrowed', async () => {
    const admin = await masterAdminAgent('rpt-sec-admin5@test.local');
    const { site: siteA } = await makeSiteWithUnit('Test Site RPT Sec Explicit A');
    const { site: siteB } = await makeSiteWithUnit('Test Site RPT Sec Explicit B');
    const cycle = await makeCycle(admin.userId);
    const viewerA = await reportsViewerAgent('rpt-sec-explicitA@test.local', [siteA.id]);

    const res = await viewerA.agent.get(reportUrl(cycle.id, { siteIds: siteB.id }));
    expect(res.status).toBe(403);
  });

  it('the export endpoint is gated by the same reports:view permission (403 without it)', async () => {
    const admin = await masterAdminAgent('rpt-sec-admin6@test.local');
    const { site } = await makeSiteWithUnit('Test Site RPT Sec Export Perm');
    const cycle = await makeCycle(admin.userId);
    const noReports = await noReportsAgent('rpt-sec-export-noview@test.local', [site.id]);

    const res = await noReports.agent.get(exportUrl(cycle.id, 'csv'));
    expect(res.status).toBe(403);
  });

  it('exports obey the identical site-scoping restriction as the on-screen report', async () => {
    const admin = await masterAdminAgent('rpt-sec-admin7@test.local');
    const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site RPT Sec Export Scope A');
    const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site RPT Sec Export Scope B');
    const cycle = await makeCycle(admin.userId);
    const employeeA = await makeEmployee(siteA.id, unitA.id, 'Export Scope Employee A');
    const employeeB = await makeEmployee(siteB.id, unitB.id, 'Export Scope Employee B');
    await makeEntry(cycle.id, employeeA.id, siteA.id, unitA.id);
    await makeEntry(cycle.id, employeeB.id, siteB.id, unitB.id);

    const viewerA = await reportsViewerAgent('rpt-sec-export-viewerA@test.local', [siteA.id]);

    // An explicit filter naming the inaccessible site is rejected outright.
    const forbidden = await viewerA.agent.get(exportUrl(cycle.id, 'csv', { siteIds: siteB.id }));
    expect(forbidden.status).toBe(403);

    // No filter at all resolves to the caller's own accessible scope only.
    const res = await viewerA.agent.get(exportUrl(cycle.id, 'csv'));
    expect(res.status).toBe(200);
    const csvText = res.text as string;
    expect(csvText).toContain(siteA.name);
    expect(csvText).not.toContain(siteB.name);
  });

  it('never leaks employee identity or banking details — aggregate-only response', async () => {
    const admin = await masterAdminAgent('rpt-sec-admin8@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site RPT Sec NoLeak');
    const cycle = await makeCycle(admin.userId);
    const bank = await prisma.bank.create({ data: { code: 'TBRPTLEAK', name: 'Leak Test Bank' } });
    const employee = await prisma.employee.create({
      data: {
        name: 'Sensitive Employee',
        designation: 'Guard',
        siteId: site.id,
        unitId: unit.id,
        grossPay: '30000',
        cnic: '1234567890123',
        bankId: bank.id,
        accountNumber: '9999999999',
      },
    });
    await makeEntry(cycle.id, employee.id, site.id, unit.id);

    const res = await admin.agent.get(reportUrl(cycle.id));
    expect(res.status).toBe(200);
    assertNoSensitiveKeys(res.body, [
      'cnic',
      'accountnumber',
      'iban',
      'employeename',
      'employeecode',
      'fathername',
      'branchcode',
      'bankid',
    ]);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('Sensitive Employee');
    expect(serialized).not.toContain('9999999999');
    expect(serialized).not.toContain('1234567890123');
  });

  it('rejects a missing cycleId with 400, and a nonexistent cycleId with 404', async () => {
    const admin = await masterAdminAgent('rpt-sec-admin9@test.local');
    const missingRes = await admin.agent.get('/api/v1/reports/payroll-summary');
    expect(missingRes.status).toBe(400);

    const notFoundRes = await admin.agent.get(reportUrl('00000000-0000-0000-0000-000000000000'));
    expect(notFoundRes.status).toBe(404);
  });

  // ================================================================================================
  // Group B — Financial reconciliation
  // ================================================================================================

  it('reconciles a normal employee salary (no OT/allowance/deductions)', async () => {
    const admin = await masterAdminAgent('rpt-fin-admin1@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site RPT Fin Normal');
    const cycle = await makeCycle(admin.userId);
    const employee = await makeEmployee(site.id, unit.id, 'Normal Employee');
    await makeEntry(cycle.id, employee.id, site.id, unit.id, { grossPay: '30000', days: '30', cycleDays: 30 });

    const res = await admin.agent.get(reportUrl(cycle.id));
    expect(res.status).toBe(200);
    const row = res.body.siteRows[0];
    expect(row.employeeCount).toBe(1);
    expect(row.grossPay).toBe('30000.00');
    // 30 days worked out of a 30-day cycle at 30000 gross, no allowance/OT/deductions except the
    // default EOBI (400): earnedAmount = 30000, EOBI deduction = 400 -> net = 29600.
    expect(row.netSalary).toBe('29600.00');
    expect(row.pendingReleaseAmount).toBe('29600.00');
    expect(row.releasedAmount).toBe('0.00');
  });

  it('reconciles overtime — otHours × otRate feeds overtimeAmount and netSalary', async () => {
    const admin = await masterAdminAgent('rpt-fin-admin2@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site RPT Fin OT');
    const cycle = await makeCycle(admin.userId);
    const employee = await makeEmployee(site.id, unit.id, 'OT Employee');
    await makeEntry(cycle.id, employee.id, site.id, unit.id, {
      grossPay: '30000',
      days: '0',
      otHours: '10',
      otRate: '100',
      eobiApplicable: false,
    });

    const res = await admin.agent.get(reportUrl(cycle.id));
    const row = res.body.siteRows[0];
    expect(row.overtimeAmount).toBe('1000.00');
    expect(row.netSalary).toBe('1000.00');
  });

  it('reconciles allowance', async () => {
    const admin = await masterAdminAgent('rpt-fin-admin3@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site RPT Fin Allowance');
    const cycle = await makeCycle(admin.userId);
    const employee = await makeEmployee(site.id, unit.id, 'Allowance Employee');
    await makeEntry(cycle.id, employee.id, site.id, unit.id, {
      grossPay: '30000',
      days: '0',
      allowance: '2500',
      eobiApplicable: false,
    });

    const res = await admin.agent.get(reportUrl(cycle.id));
    const row = res.body.siteRows[0];
    expect(row.allowances).toBe('2500.00');
    expect(row.netSalary).toBe('2500.00');
  });

  it('reconciles EOBI — only entries with eobiApplicable=true are deducted', async () => {
    const admin = await masterAdminAgent('rpt-fin-admin4@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site RPT Fin EOBI');
    const cycle = await makeCycle(admin.userId);
    const employeeOn = await makeEmployee(site.id, unit.id, 'EOBI On Employee');
    const employeeOff = await makeEmployee(site.id, unit.id, 'EOBI Off Employee');
    await makeEntry(cycle.id, employeeOn.id, site.id, unit.id, { grossPay: '0', days: '0', eobiAmount: '400', eobiApplicable: true });
    await makeEntry(cycle.id, employeeOff.id, site.id, unit.id, { grossPay: '0', days: '0', eobiAmount: '400', eobiApplicable: false });

    const res = await admin.agent.get(reportUrl(cycle.id));
    const row = res.body.siteRows[0];
    expect(row.eobi).toBe('400.00');
  });

  it('reconciles advance deduction', async () => {
    const admin = await masterAdminAgent('rpt-fin-admin5@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site RPT Fin Advance');
    const cycle = await makeCycle(admin.userId);
    const employee = await makeEmployee(site.id, unit.id, 'Advance Employee');
    await makeEntry(cycle.id, employee.id, site.id, unit.id, {
      grossPay: '30000',
      days: '0',
      advanceDeduction: '5000',
      eobiApplicable: false,
    });

    const res = await admin.agent.get(reportUrl(cycle.id));
    const row = res.body.siteRows[0];
    expect(row.advanceDeductions).toBe('5000.00');
    expect(row.netSalary).toBe('-5000.00');
  });

  it('reconciles Eid Advance deduction', async () => {
    const admin = await masterAdminAgent('rpt-fin-admin6@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site RPT Fin EidAdvance');
    const cycle = await makeCycle(admin.userId);
    const employee = await makeEmployee(site.id, unit.id, 'Eid Advance Employee');
    await makeEntry(cycle.id, employee.id, site.id, unit.id, {
      grossPay: '0',
      days: '0',
      eidAdvanceDeduction: '1500',
      eobiApplicable: false,
    });

    const res = await admin.agent.get(reportUrl(cycle.id));
    const row = res.body.siteRows[0];
    expect(row.eidAdvanceDeductions).toBe('1500.00');
    expect(row.netSalary).toBe('-1500.00');
  });

  it('reconciles a fine', async () => {
    const admin = await masterAdminAgent('rpt-fin-admin7@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site RPT Fin Fine');
    const cycle = await makeCycle(admin.userId);
    const employee = await makeEmployee(site.id, unit.id, 'Fine Employee');
    await makeEntry(cycle.id, employee.id, site.id, unit.id, { grossPay: '0', days: '0', fine: '750', eobiApplicable: false });

    const res = await admin.agent.get(reportUrl(cycle.id));
    const row = res.body.siteRows[0];
    expect(row.fines).toBe('750.00');
    expect(row.netSalary).toBe('-750.00');
  });

  it('a held employee is always counted, never silently dropped, and excluded from pending/released amounts', async () => {
    const admin = await masterAdminAgent('rpt-fin-admin8@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site RPT Fin Hold');
    const cycle = await makeCycle(admin.userId);
    const heldEmployee = await makeEmployee(site.id, unit.id, 'Held Employee');
    const ordinaryEmployee = await makeEmployee(site.id, unit.id, 'Ordinary Employee');
    await makeEntry(cycle.id, heldEmployee.id, site.id, unit.id, { hold: true, grossPay: '30000' });
    await makeEntry(cycle.id, ordinaryEmployee.id, site.id, unit.id, { grossPay: '30000' });

    const res = await admin.agent.get(reportUrl(cycle.id));
    const row = res.body.siteRows[0];
    expect(row.employeeCount).toBe(2);
    expect(row.heldCount).toBe(1);
    expect(row.pendingReleaseCount).toBe(1);
    // Only the ordinary (non-held) employee's net salary counts toward Pending Release Amount.
    expect(row.pendingReleaseAmount).toBe('25600.00');
  });

  it('a released employee is counted as released, with Released Amount reflecting only released entries', async () => {
    const admin = await masterAdminAgent('rpt-fin-admin9@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site RPT Fin Released');
    const cycle = await makeCycle(admin.userId);
    const employee = await makeEmployee(site.id, unit.id, 'Released Employee');
    await makeEntry(cycle.id, employee.id, site.id, unit.id, { grossPay: '30000' });
    await releaseUnit(admin, cycle.id, unit.id);

    const res = await admin.agent.get(reportUrl(cycle.id));
    const row = res.body.siteRows[0];
    expect(row.releasedCount).toBe(1);
    expect(row.pendingReleaseCount).toBe(0);
    expect(row.releasedAmount).toBe('25600.00');
    expect(row.pendingReleaseAmount).toBe('0.00');
  });

  it('a partial (unit-level) release splits a site into released and pending buckets correctly', async () => {
    const admin = await masterAdminAgent('rpt-fin-admin10@test.local');
    const { site, units } = await makeSiteWithUnit('Test Site RPT Fin Partial', 2);
    const cycle = await makeCycle(admin.userId);
    const employeeReleased = await makeEmployee(site.id, units[0]!.id, 'Partial Released Employee');
    const employeePending = await makeEmployee(site.id, units[1]!.id, 'Partial Pending Employee');
    await makeEntry(cycle.id, employeeReleased.id, site.id, units[0]!.id, { grossPay: '30000' });
    await makeEntry(cycle.id, employeePending.id, site.id, units[1]!.id, { grossPay: '30000' });

    // Release only the first unit — the second stays pending.
    await releaseUnit(admin, cycle.id, units[0]!.id);

    const res = await admin.agent.get(reportUrl(cycle.id));
    const row = res.body.siteRows[0];
    expect(row.employeeCount).toBe(2);
    expect(row.releasedCount).toBe(1);
    expect(row.pendingReleaseCount).toBe(1);
    expect(row.releasedAmount).toBe('25600.00');
    expect(row.pendingReleaseAmount).toBe('25600.00');
    // Cycle status stays DRAFT — a unit can release while the cycle as a whole has not finalized.
    expect(res.body.cycle.status).toBe('DRAFT');
  });

  it('post-release Balance Salary Payable — a materialized PAYABLE adjustment appears as Balance Payable Included', async () => {
    const admin = await masterAdminAgent('rpt-fin-admin11@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site RPT Fin Payable');
    const employee = await makeEmployee(site.id, unit.id, 'Payable Employee');
    const sourceCycle = await makeCycle(admin.userId, 'RELEASED');
    const sourceEntry = await makeEntry(sourceCycle.id, employee.id, site.id, unit.id, { grossPay: '30000' });
    const adjustmentType = await makeAdjustmentType('PAYABLE_RPT');
    const correction = await makeCorrection(sourceEntry.id, adjustmentType.id, admin.userId);
    const balanceAdjustment = await makeBalanceAdjustment(correction.id, employee.id, sourceCycle.id, adjustmentType.id, 'PAYABLE', '4000');

    const draftCycle = await makeCycle(admin.userId, 'DRAFT');
    await makeEntry(draftCycle.id, employee.id, site.id, unit.id, { grossPay: '30000' });
    await materialize(admin, balanceAdjustment.id, draftCycle.id);

    const res = await admin.agent.get(reportUrl(draftCycle.id));
    const row = res.body.siteRows[0];
    expect(row.balancePayableIncluded).toBe('4000.00');
    // Net salary now includes the materialized Balance Payable on top of ordinary earnings.
    expect(row.netSalary).toBe('29600.00');
  });

  it('Salary Recovery / Overpayment Adjustment — a materialized RECOVERY adjustment appears as Recovery Deducted', async () => {
    const admin = await masterAdminAgent('rpt-fin-admin12@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site RPT Fin Recovery');
    const employee = await makeEmployee(site.id, unit.id, 'Recovery Employee');
    const sourceCycle = await makeCycle(admin.userId, 'RELEASED');
    const sourceEntry = await makeEntry(sourceCycle.id, employee.id, site.id, unit.id, { grossPay: '30000' });
    const adjustmentType = await makeAdjustmentType('RECOVERY_RPT');
    const correction = await makeCorrection(sourceEntry.id, adjustmentType.id, admin.userId);
    const balanceAdjustment = await makeBalanceAdjustment(correction.id, employee.id, sourceCycle.id, adjustmentType.id, 'RECOVERY', '3000');

    const draftCycle = await makeCycle(admin.userId, 'DRAFT');
    await makeEntry(draftCycle.id, employee.id, site.id, unit.id, { grossPay: '30000' });
    await materialize(admin, balanceAdjustment.id, draftCycle.id);

    const res = await admin.agent.get(reportUrl(draftCycle.id));
    const row = res.body.siteRows[0];
    expect(row.recoveryDeducted).toBe('3000.00');
    expect(row.netSalary).toBe('22600.00');
  });

  it('aggregates correctly across multiple sites, and cycleTotals equals the sum of every site row', async () => {
    const admin = await masterAdminAgent('rpt-fin-admin13@test.local');
    const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site RPT Fin Multi A');
    const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site RPT Fin Multi B');
    const cycle = await makeCycle(admin.userId);
    const employeeA = await makeEmployee(siteA.id, unitA.id, 'Multi Employee A');
    const employeeB1 = await makeEmployee(siteB.id, unitB.id, 'Multi Employee B1');
    const employeeB2 = await makeEmployee(siteB.id, unitB.id, 'Multi Employee B2');
    await makeEntry(cycle.id, employeeA.id, siteA.id, unitA.id, { grossPay: '30000' });
    await makeEntry(cycle.id, employeeB1.id, siteB.id, unitB.id, { grossPay: '20000' });
    await makeEntry(cycle.id, employeeB2.id, siteB.id, unitB.id, { grossPay: '25000' });

    const res = await admin.agent.get(reportUrl(cycle.id));
    expect(res.body.siteRows).toHaveLength(2);
    const rowA = res.body.siteRows.find((r: { siteId: string }) => r.siteId === siteA.id);
    const rowB = res.body.siteRows.find((r: { siteId: string }) => r.siteId === siteB.id);
    expect(rowA.employeeCount).toBe(1);
    expect(rowB.employeeCount).toBe(2);
    expect(res.body.cycleTotals.employeeCount).toBe(3);
    const expectedTotalGross = (Number(rowA.grossPay) + Number(rowB.grossPay)).toFixed(2);
    expect(res.body.cycleTotals.grossPay).toBe(expectedTotalGross);
    const expectedTotalNet = (Number(rowA.netSalary) + Number(rowB.netSalary)).toFixed(2);
    expect(res.body.cycleTotals.netSalary).toBe(expectedTotalNet);
  });

  it('a Draft cycle reflects the current, editable payroll state and is clearly labeled as such', async () => {
    const admin = await masterAdminAgent('rpt-fin-admin14@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site RPT Fin Draft');
    const cycle = await makeCycle(admin.userId, 'DRAFT');
    const employee = await makeEmployee(site.id, unit.id, 'Draft State Employee');
    await makeEntry(cycle.id, employee.id, site.id, unit.id, { grossPay: '30000' });

    const res = await admin.agent.get(reportUrl(cycle.id));
    expect(res.body.cycle.status).toBe('DRAFT');
    expect(res.body.siteRows[0].pendingReleaseAmount).toBe('25600.00');
  });

  it('a Released cycle (finalized) reports the released payroll correctly', async () => {
    const admin = await masterAdminAgent('rpt-fin-admin15@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site RPT Fin Released Cycle');
    const cycle = await makeCycle(admin.userId, 'DRAFT');
    const employee = await makeEmployee(site.id, unit.id, 'Released Cycle Employee');
    await makeEntry(cycle.id, employee.id, site.id, unit.id, { grossPay: '30000' });
    await releaseUnit(admin, cycle.id, unit.id);
    await finalizeCycle(admin, cycle.id);

    const res = await admin.agent.get(reportUrl(cycle.id));
    expect(res.body.cycle.status).toBe('RELEASED');
    expect(res.body.siteRows[0].releasedAmount).toBe('25600.00');
  });

  it('an Archived cycle remains historically stable and reports correctly', async () => {
    const admin = await masterAdminAgent('rpt-fin-admin16@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site RPT Fin Archived');
    const cycle = await makeCycle(admin.userId, 'ARCHIVED');
    const employee = await makeEmployee(site.id, unit.id, 'Archived Employee');
    await prisma.payrollEntry.create({
      data: {
        cycleId: cycle.id,
        employeeId: employee.id,
        siteId: site.id,
        designation: 'Guard',
        grossPay: '30000',
        released: true,
        releasedAt: new Date(),
        releasedBy: admin.userId,
        workLines: { create: [{ siteId: site.id, unitId: unit.id, days: '30', cycleDays: 30, otHours: '0' }] },
      },
    });

    const res = await admin.agent.get(reportUrl(cycle.id));
    expect(res.status).toBe(200);
    expect(res.body.cycle.status).toBe('ARCHIVED');
    expect(res.body.siteRows[0].releasedAmount).toBe('29600.00');
    expect(res.body.siteRows[0].releasedCount).toBe(1);
  });

  it('cycleTotals.netSalary reconciles exactly against an independent calcNet-based recomputation from raw PayrollEntry rows', async () => {
    const admin = await masterAdminAgent('rpt-fin-admin17@test.local');
    const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site RPT Fin Reconcile A');
    const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site RPT Fin Reconcile B');
    const cycle = await makeCycle(admin.userId);
    const e1 = await makeEmployee(siteA.id, unitA.id, 'Reconcile Employee 1');
    const e2 = await makeEmployee(siteB.id, unitB.id, 'Reconcile Employee 2');
    const e3 = await makeEmployee(siteB.id, unitB.id, 'Reconcile Employee 3');
    await makeEntry(cycle.id, e1.id, siteA.id, unitA.id, { grossPay: '30000', otHours: '5', otRate: '150', fine: '200' });
    await makeEntry(cycle.id, e2.id, siteB.id, unitB.id, { grossPay: '22000', allowance: '1000', advanceDeduction: '500' });
    await makeEntry(cycle.id, e3.id, siteB.id, unitB.id, { grossPay: '18500', eidAdvanceDeduction: '750' });

    const res = await admin.agent.get(reportUrl(cycle.id));
    expect(res.status).toBe(200);

    // Independently re-fetch the raw entries and recompute their net salary using the same
    // canonical `calcNet` the production service uses — this is a reconciliation check against the
    // authoritative calculation function itself, never a hand-rolled duplicate formula.
    const rawEntries = await prisma.payrollEntry.findMany({ where: { cycleId: cycle.id }, include: { workLines: true } });
    const expectedTotalNet = rawEntries
      .map((entry) =>
        calcNet({
          grossPay: entry.grossPay.toString(),
          allowance: entry.allowance.toString(),
          leaveDays: entry.leaveDays.toString(),
          leaveRate: entry.leaveRate?.toString() ?? null,
          eobiAmount: entry.eobiAmount.toString(),
          eobiApplicable: entry.eobiApplicable,
          advanceDeduction: entry.advanceDeduction.toString(),
          eidAdvanceDeduction: entry.eidAdvanceDeduction.toString(),
          fine: entry.fine.toString(),
          correctionBalancePayable: entry.correctionBalancePayable.toString(),
          correctionBalanceRecovery: entry.correctionBalanceRecovery.toString(),
          workLines: entry.workLines.map((line) => ({
            sortOrder: line.sortOrder,
            days: line.days.toString(),
            otHours: line.otHours.toString(),
            otRate: line.otRate?.toString() ?? null,
            cycleDays: line.cycleDays,
          })),
        }).netSalary,
      )
      .reduce((sum, value) => (Number(sum) + Number(value)).toFixed(2), '0.00');

    expect(res.body.cycleTotals.netSalary).toBe(expectedTotalNet);
  });

  // ================================================================================================
  // Group C — Pagination
  // ================================================================================================

  it('paginates site rows server-side, and cycleTotals still reflects the complete filtered scope', async () => {
    const admin = await masterAdminAgent('rpt-page-admin1@test.local');
    const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site RPT Page A');
    const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site RPT Page B');
    const cycle = await makeCycle(admin.userId);
    const employeeA = await makeEmployee(siteA.id, unitA.id, 'Page Employee A');
    const employeeB = await makeEmployee(siteB.id, unitB.id, 'Page Employee B');
    await makeEntry(cycle.id, employeeA.id, siteA.id, unitA.id, { grossPay: '30000' });
    await makeEntry(cycle.id, employeeB.id, siteB.id, unitB.id, { grossPay: '30000' });

    const page1 = await admin.agent.get(reportUrl(cycle.id, { pageSize: '1', page: '1' }));
    expect(page1.body.total).toBe(2);
    expect(page1.body.siteRows).toHaveLength(1);
    expect(page1.body.cycleTotals.employeeCount).toBe(2); // never a partial total

    const page2 = await admin.agent.get(reportUrl(cycle.id, { pageSize: '1', page: '2' }));
    expect(page2.body.siteRows).toHaveLength(1);
    expect(page2.body.siteRows[0].siteId).not.toBe(page1.body.siteRows[0].siteId);
  });

  it('clamps an out-of-range page/pageSize to a safe bound rather than erroring', async () => {
    const admin = await masterAdminAgent('rpt-page-admin2@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site RPT Page Clamp');
    const cycle = await makeCycle(admin.userId);
    const employee = await makeEmployee(site.id, unit.id, 'Clamp Employee');
    await makeEntry(cycle.id, employee.id, site.id, unit.id);

    const res = await admin.agent.get(reportUrl(cycle.id, { page: '0', pageSize: '99999' }));
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(100);
  });

  // ================================================================================================
  // Group D — Exports
  // ================================================================================================

  it('CSV export contains every filtered site row and a Total row matching the on-screen cycleTotals', async () => {
    const admin = await masterAdminAgent('rpt-export-admin1@test.local');
    const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site RPT Export CSV A');
    const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site RPT Export CSV B');
    const cycle = await makeCycle(admin.userId);
    const employeeA = await makeEmployee(siteA.id, unitA.id, 'CSV Employee A');
    const employeeB = await makeEmployee(siteB.id, unitB.id, 'CSV Employee B');
    await makeEntry(cycle.id, employeeA.id, siteA.id, unitA.id, { grossPay: '30000' });
    await makeEntry(cycle.id, employeeB.id, siteB.id, unitB.id, { grossPay: '25000' });

    const jsonRes = await admin.agent.get(reportUrl(cycle.id));
    const csvRes = await admin.agent.get(exportUrl(cycle.id, 'csv'));
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers['content-type']).toContain('text/csv');
    expect(csvRes.headers['content-disposition']).toContain('attachment');

    const csvText = csvRes.text as string;
    expect(csvText).toContain(siteA.name);
    expect(csvText).toContain(siteB.name);
    expect(csvText).toContain('Total');
    expect(csvText).toContain(jsonRes.body.cycleTotals.netSalary);
  });

  it('XLSX export parses to the correct row count and total, matching the on-screen report', async () => {
    const admin = await masterAdminAgent('rpt-export-admin2@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site RPT Export XLSX');
    const cycle = await makeCycle(admin.userId);
    const employee = await makeEmployee(site.id, unit.id, 'XLSX Employee');
    await makeEntry(cycle.id, employee.id, site.id, unit.id, { grossPay: '30000' });

    const jsonRes = await admin.agent.get(reportUrl(cycle.id));

    const xlsxRes = await admin.agent
      .get(exportUrl(cycle.id, 'xlsx'))
      .buffer(true)
      .parse(binaryParser);
    expect(xlsxRes.status).toBe(200);
    expect(xlsxRes.headers['content-type']).toContain('spreadsheetml');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsxRes.body as Buffer);
    const worksheet = workbook.getWorksheet('Payroll Summary')!;
    // Row 1: title, Row 2: blank, Row 3: headers, Row 4: the one data row, Row 5: Total.
    expect(worksheet.getRow(4).getCell(1).value).toBe(site.name);
    const totalRow = worksheet.getRow(5);
    expect(totalRow.getCell(1).value).toBe('Total');
    expect(String(totalRow.getCell(19).value)).toBe(jsonRes.body.cycleTotals.netSalary);
  });

  it('exports the complete filtered report regardless of pagination — never just one page', async () => {
    const admin = await masterAdminAgent('rpt-export-admin3@test.local');
    const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site RPT Export Full A');
    const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site RPT Export Full B');
    const cycle = await makeCycle(admin.userId);
    const employeeA = await makeEmployee(siteA.id, unitA.id, 'Export Full Employee A');
    const employeeB = await makeEmployee(siteB.id, unitB.id, 'Export Full Employee B');
    await makeEntry(cycle.id, employeeA.id, siteA.id, unitA.id);
    await makeEntry(cycle.id, employeeB.id, siteB.id, unitB.id);

    // The export endpoint accepts no page/pageSize at all — confirm both sites appear even though
    // the on-screen report would only show one per page at pageSize=1.
    const csvRes = await admin.agent.get(exportUrl(cycle.id, 'csv'));
    const csvText = csvRes.text as string;
    expect(csvText).toContain(siteA.name);
    expect(csvText).toContain(siteB.name);
  });

  it('audits both the view and the export as distinct, summary (not per-row) AuditLog entries', async () => {
    const admin = await masterAdminAgent('rpt-audit-admin1@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site RPT Audit');
    const cycle = await makeCycle(admin.userId);
    const employee = await makeEmployee(site.id, unit.id, 'Audit Employee');
    await makeEntry(cycle.id, employee.id, site.id, unit.id);

    await admin.agent.get(reportUrl(cycle.id));
    await admin.agent.get(exportUrl(cycle.id, 'csv'));

    const viewedLogs = await prisma.auditLog.findMany({ where: { action: 'report.viewed', entityId: cycle.id } });
    const exportedLogs = await prisma.auditLog.findMany({ where: { action: 'report.exported', entityId: cycle.id } });
    expect(viewedLogs).toHaveLength(1);
    expect(exportedLogs).toHaveLength(1);
    expect((viewedLogs[0]!.metadata as Record<string, unknown>).reportType).toBe('payroll_summary');
    expect((exportedLogs[0]!.metadata as Record<string, unknown>).format).toBe('csv');
  });
});
