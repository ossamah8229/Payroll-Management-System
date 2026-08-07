import { randomUUID } from 'node:crypto';
import { OVERTIME_REPORT_EXPORT_MAX_ROWS, PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

/**
 * Phase 7 Reports, Overtime Report Checkpoint 1A — an explicit, real-data proof of the exact
 * `OVERTIME_REPORT_EXPORT_MAX_ROWS` (20,000) boundary — 19,999 succeeds, 20,000 (the boundary
 * itself) succeeds, 20,001 is rejected — for both the totals computation (`totalsComputed`) and the
 * export endpoint (200 vs structured 413). This is the literal `>`, not `>=`, comparison in
 * `overtime-report.service.ts`'s `computeOvertimeReportTotals`/`buildOvertimeReportExportData` and
 * `reports.routes.ts`'s own `data.totalMatching > OVERTIME_REPORT_EXPORT_MAX_ROWS` check, exercised
 * at real volume — mirroring `deduction-report-boundary.test.ts`'s own established methodology.
 *
 * Every seeded `PayrollEntry` has exactly one `PayrollEntryWorkLine` (the documented common case),
 * so `PayrollEntry` count and `PayrollEntryWorkLine` (this report's own grain) count are identical
 * at this fixture — the three exact boundary counts are reached via the same "one cycle, split
 * across three sites" trick `deduction-report-boundary.test.ts` uses: Site A (19,999 rows), Site B
 * (1 row), Site C (1 row).
 */

jest.setTimeout(5 * 60 * 1000);

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';
const SITE_A_COUNT = OVERTIME_REPORT_EXPORT_MAX_ROWS - 1; // 19,999
const SITE_B_COUNT = 1; // + this = 20,000 (the boundary itself)
const SITE_C_COUNT = 1; // + this = 20,001 (one past the boundary)

describe('Phase 7 Reports — Overtime Report Checkpoint 1A — 19,999/20,000/20,001 ceiling boundary proof', () => {
  let admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>;
  let siteAId: string;
  let siteBId: string;
  let siteCId: string;
  let cycleId: string;

  beforeAll(async () => {
    await cleanTestData();

    admin = await createAuthenticatedAgent(app, {
      email: 'ot-boundary-admin@test.local',
      password: PASSWORD,
      roleCode: ROLE_CODES.MASTER_ADMIN,
      permissionKeys: [PERMISSIONS.PAYROLL_CYCLE_MANAGE, PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.REPORTS_VIEW],
    });

    const siteA = await prisma.projectSite.create({ data: { name: 'Test Site OT Boundary A' } });
    const unitA = await prisma.projectUnit.create({ data: { siteId: siteA.id, name: 'OT Boundary Unit A', code: 'OTBA' } });
    const siteB = await prisma.projectSite.create({ data: { name: 'Test Site OT Boundary B' } });
    const unitB = await prisma.projectUnit.create({ data: { siteId: siteB.id, name: 'OT Boundary Unit B', code: 'OTBB' } });
    const siteC = await prisma.projectSite.create({ data: { name: 'Test Site OT Boundary C' } });
    const unitC = await prisma.projectUnit.create({ data: { siteId: siteC.id, name: 'OT Boundary Unit C', code: 'OTBC' } });
    siteAId = siteA.id;
    siteBId = siteB.id;
    siteCId = siteC.id;

    const cycle = await prisma.payrollCycle.create({ data: { year: 2950, month: 2, createdBy: admin.userId, status: 'DRAFT' } });
    cycleId = cycle.id;

    const CHUNK = 1000;

    async function seedSite(siteId: string, unitId: string, count: number, label: string): Promise<void> {
      const employeeIds: string[] = [];
      for (let start = 0; start < count; start += CHUNK) {
        const batch = [];
        for (let i = start; i < Math.min(start + CHUNK, count); i += 1) {
          const id = randomUUID();
          employeeIds.push(id);
          batch.push({
            id,
            employeeCode: `OT-BOUND-${label}-${String(i).padStart(6, '0')}`,
            name: `OT Boundary ${label} Employee ${i}`,
            designation: 'Guard',
            siteId,
            unitId,
            grossPay: '30000',
          });
        }
        await prisma.employee.createMany({ data: batch });
      }

      const entryRows = employeeIds.map((employeeId) => ({
        id: randomUUID(),
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
        hold: false,
        released: false,
      }));
      for (let start = 0; start < entryRows.length; start += CHUNK) {
        await prisma.payrollEntry.createMany({ data: entryRows.slice(start, start + CHUNK) });
      }

      const workLineRows = entryRows.map((entry) => ({
        id: randomUUID(),
        payrollEntryId: entry.id,
        siteId: entry.siteId,
        unitId,
        days: '26',
        otHours: '4',
        otRate: null,
        cycleDays: 30,
      }));
      for (let start = 0; start < workLineRows.length; start += CHUNK) {
        await prisma.payrollEntryWorkLine.createMany({ data: workLineRows.slice(start, start + CHUNK) });
      }
    }

    await seedSite(siteAId, unitA.id, SITE_A_COUNT, 'A');
    await seedSite(siteBId, unitB.id, SITE_B_COUNT, 'B');
    await seedSite(siteCId, unitC.id, SITE_C_COUNT, 'C');

    const totalWorkLines = await prisma.payrollEntryWorkLine.count({ where: { payrollEntry: { cycleId } } });
    // eslint-disable-next-line no-console
    console.log(`[boundary] seeded ${totalWorkLines} PayrollEntryWorkLine rows in one cycle across 3 sites (${SITE_A_COUNT}/${SITE_B_COUNT}/${SITE_C_COUNT})`);
    expect(totalWorkLines).toBe(OVERTIME_REPORT_EXPORT_MAX_ROWS + 1);
  }, 5 * 60 * 1000);

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  function listUrl(siteIds: string[]): string {
    return `/api/v1/reports/overtime-report?${new URLSearchParams({ cycleId, siteIds: siteIds.join(','), pageSize: '1' }).toString()}`;
  }
  function exportUrl(siteIds: string[]): string {
    return `/api/v1/reports/overtime-report/export?${new URLSearchParams({ cycleId, siteIds: siteIds.join(','), format: 'csv' }).toString()}`;
  }

  describe('Totals: totalsComputed at each exact count', () => {
    it('19,999 matching rows (one below the ceiling): totalsComputed is true', async () => {
      const start = Date.now();
      const res = await admin.agent.get(listUrl([siteAId]));
      // eslint-disable-next-line no-console
      console.log(`[boundary] totals @ 19,999 rows: ${Date.now() - start}ms`);
      expect(res.status).toBe(200);
      expect(res.body.totals.matchingCount).toBe(SITE_A_COUNT);
      expect(res.body.totals.totalsComputed).toBe(true);
      expect(res.body.totals.totalOtHours).not.toBeNull();
      expect(res.body.totals.totalOtEarnings).not.toBeNull();
    });

    it('20,000 matching rows (exactly the ceiling): totalsComputed is still true — the comparison is >, not >=', async () => {
      const start = Date.now();
      const res = await admin.agent.get(listUrl([siteAId, siteBId]));
      // eslint-disable-next-line no-console
      console.log(`[boundary] totals @ 20,000 rows (the boundary itself): ${Date.now() - start}ms`);
      expect(res.status).toBe(200);
      expect(res.body.totals.matchingCount).toBe(OVERTIME_REPORT_EXPORT_MAX_ROWS);
      expect(res.body.totals.totalsComputed).toBe(true);
      expect(res.body.totals.totalOtHours).not.toBeNull();
    });

    it('20,001 matching rows (one past the ceiling): totalsComputed is false, every bounded total is null', async () => {
      const start = Date.now();
      const res = await admin.agent.get(listUrl([siteAId, siteBId, siteCId]));
      // eslint-disable-next-line no-console
      console.log(`[boundary] totals @ 20,001 rows (one past the boundary): ${Date.now() - start}ms`);
      expect(res.status).toBe(200);
      expect(res.body.totals.matchingCount).toBe(OVERTIME_REPORT_EXPORT_MAX_ROWS + 1);
      expect(res.body.totals.totalsComputed).toBe(false);
      expect(res.body.totals.totalOtHours).toBeNull();
      expect(res.body.totals.totalOtEarnings).toBeNull();
      expect(res.body.totals.employeesWithOvertimeCount).toBeNull();
      expect(res.body.totals.sitesWithOvertimeCount).toBeNull();
      expect(res.body.totals.unitsWithOvertimeCount).toBeNull();
      // The three always-exact status counts are plain DB aggregates, independent of
      // totalsComputed (frozen decision — they never gate on the same ceiling as the bounded
      // totals). All seeded entries are PENDING (never released/held), so pendingCount alone
      // should equal the full matching population.
      expect(res.body.totals.pendingCount).toBe(OVERTIME_REPORT_EXPORT_MAX_ROWS + 1);
    });
  });

  describe('Export: 200/200/413 at each exact count', () => {
    it('19,999 matching rows: export succeeds with every row present', async () => {
      const start = Date.now();
      const res = await admin.agent.get(exportUrl([siteAId]));
      // eslint-disable-next-line no-console
      console.log(`[boundary] export @ 19,999 rows: ${Date.now() - start}ms`);
      expect(res.status).toBe(200);
      const lines = res.text.trim().split('\n');
      expect(lines.length).toBe(SITE_A_COUNT + 1); // header + every matching row
    });

    it('20,000 matching rows (exactly the ceiling): export still succeeds — the comparison is >, not >=', async () => {
      const start = Date.now();
      const res = await admin.agent.get(exportUrl([siteAId, siteBId]));
      // eslint-disable-next-line no-console
      console.log(`[boundary] export @ 20,000 rows (the boundary itself): ${Date.now() - start}ms`);
      expect(res.status).toBe(200);
      const lines = res.text.trim().split('\n');
      expect(lines.length).toBe(OVERTIME_REPORT_EXPORT_MAX_ROWS + 1); // header + every matching row
    });

    it('20,001 matching rows (one past the ceiling): export is rejected with a structured 413 before any row is fetched', async () => {
      const start = Date.now();
      const res = await admin.agent.get(exportUrl([siteAId, siteBId, siteCId]));
      // eslint-disable-next-line no-console
      console.log(`[boundary] export rejection @ 20,001 rows: ${Date.now() - start}ms`);
      expect(res.status).toBe(413);
      expect(res.body.error).toEqual({
        code: 'EXPORT_ROW_LIMIT_EXCEEDED',
        matchingCount: OVERTIME_REPORT_EXPORT_MAX_ROWS + 1,
        maxRows: OVERTIME_REPORT_EXPORT_MAX_ROWS,
        message: expect.stringContaining(`${OVERTIME_REPORT_EXPORT_MAX_ROWS + 1} rows`),
      });
      // The preflight COUNT rejects before any row is fetched/mapped/formatted — the 413 case
      // must be dramatically cheaper than the 200 cases above, not merely correct.
      expect(Date.now() - start).toBeLessThan(3_000);
    });
  });
});
