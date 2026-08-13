import { randomUUID } from 'node:crypto';
import { VARIANCE_REPORT_EXPORT_MAX_ROWS, PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

/**
 * Phase 7 Reports, Variance / Month-on-Month Report Checkpoint 1A — an explicit, real-data proof
 * of the exact `VARIANCE_REPORT_EXPORT_MAX_ROWS` (20,000) boundary — 19,999 succeeds, 20,000 (the
 * boundary itself) succeeds, 20,001 is rejected — for both the aggregate monetary totals
 * (`totalsComputed`) and the export endpoint (200 vs structured 413), mirroring every sibling
 * report's own `*-report-boundary.test.ts` methodology exactly (`deduction-report-boundary.test.ts`).
 *
 * **Efficient fixture, not 3×20,000 employees.** One CONTINUED employee (both sides present, same
 * Site on both sides) per matching row, seeded across three Sites — Site A (19,999), Site B (1),
 * Site C (1) — and reached via the report's own real `siteIds` filter (`siteIds=[A]` → 19,999;
 * `siteIds=[A,B]` → 20,000; `siteIds=[A,B,C]` → 20,001). Every row still goes through the real
 * endpoint, the real two-sided authorization/pairing, and (below the ceiling) the real
 * `calcNet`-over-every-row totals pass.
 */

jest.setTimeout(5 * 60 * 1000);

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';
const SITE_A_COUNT = VARIANCE_REPORT_EXPORT_MAX_ROWS - 1; // 19,999
const SITE_B_COUNT = 1; // + this = 20,000 (the boundary itself)
const SITE_C_COUNT = 1; // + this = 20,001 (one past the boundary)

describe('Phase 7 Reports — Variance / Month-on-Month Report Checkpoint 1A — 19,999/20,000/20,001 ceiling boundary proof', () => {
  let admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>;
  let siteAId: string;
  let siteBId: string;
  let siteCId: string;
  let comparisonCycleId: string;
  let currentCycleId: string;

  beforeAll(async () => {
    await cleanTestData();

    admin = await createAuthenticatedAgent(app, {
      email: 'vr-boundary-admin@test.local',
      password: PASSWORD,
      roleCode: ROLE_CODES.MASTER_ADMIN,
      permissionKeys: [PERMISSIONS.PAYROLL_CYCLE_MANAGE, PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.REPORTS_VIEW],
    });

    const siteA = await prisma.projectSite.create({ data: { name: 'Test Site VR Boundary A' } });
    const unitA = await prisma.projectUnit.create({ data: { siteId: siteA.id, name: 'VR Boundary Unit A', code: 'VRBA' } });
    const siteB = await prisma.projectSite.create({ data: { name: 'Test Site VR Boundary B' } });
    const unitB = await prisma.projectUnit.create({ data: { siteId: siteB.id, name: 'VR Boundary Unit B', code: 'VRBB' } });
    const siteC = await prisma.projectSite.create({ data: { name: 'Test Site VR Boundary C' } });
    const unitC = await prisma.projectUnit.create({ data: { siteId: siteC.id, name: 'VR Boundary Unit C', code: 'VRBC' } });
    siteAId = siteA.id;
    siteBId = siteB.id;
    siteCId = siteC.id;

    const comparisonCycle = await prisma.payrollCycle.create({ data: { year: 2960, month: 1, createdBy: admin.userId, status: 'DRAFT' } });
    const currentCycle = await prisma.payrollCycle.create({ data: { year: 2960, month: 2, createdBy: admin.userId, status: 'DRAFT' } });
    comparisonCycleId = comparisonCycle.id;
    currentCycleId = currentCycle.id;

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
            employeeCode: `VR-BOUND-${label}-${String(i).padStart(6, '0')}`,
            name: `VR Boundary ${label} Employee ${i}`,
            designation: 'Guard',
            siteId,
            unitId,
            grossPay: '30000',
          });
        }
        await prisma.employee.createMany({ data: batch });
      }

      for (const cycleId of [comparisonCycleId, currentCycleId]) {
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
          days: '30',
          otHours: '0',
          cycleDays: 30,
        }));
        for (let start = 0; start < workLineRows.length; start += CHUNK) {
          await prisma.payrollEntryWorkLine.createMany({ data: workLineRows.slice(start, start + CHUNK) });
        }
      }
    }

    await seedSite(siteAId, unitA.id, SITE_A_COUNT, 'A');
    await seedSite(siteBId, unitB.id, SITE_B_COUNT, 'B');
    await seedSite(siteCId, unitC.id, SITE_C_COUNT, 'C');

    const totalComparisonEntries = await prisma.payrollEntry.count({ where: { cycleId: comparisonCycleId } });
    // eslint-disable-next-line no-console
    console.log(
      `[boundary] seeded ${totalComparisonEntries} PayrollEntry rows per cycle across 3 sites (${SITE_A_COUNT}/${SITE_B_COUNT}/${SITE_C_COUNT}), both cycles`,
    );
    expect(totalComparisonEntries).toBe(VARIANCE_REPORT_EXPORT_MAX_ROWS + 1);
  }, 5 * 60 * 1000);

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  function listUrl(siteIds: string[]): string {
    return `/api/v1/reports/variance?${new URLSearchParams({
      comparisonCycleId,
      currentCycleId,
      siteIds: siteIds.join(','),
      pageSize: '1',
    }).toString()}`;
  }
  function exportUrl(siteIds: string[]): string {
    return `/api/v1/reports/variance/export?${new URLSearchParams({
      comparisonCycleId,
      currentCycleId,
      siteIds: siteIds.join(','),
      format: 'csv',
    }).toString()}`;
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
      expect(res.body.totals.comparisonTotalNet).not.toBeNull();
    });

    it('20,000 matching rows (exactly the ceiling): totalsComputed is still true — the comparison is >, not >=', async () => {
      const start = Date.now();
      const res = await admin.agent.get(listUrl([siteAId, siteBId]));
      // eslint-disable-next-line no-console
      console.log(`[boundary] totals @ 20,000 rows (the boundary itself): ${Date.now() - start}ms`);
      expect(res.status).toBe(200);
      expect(res.body.totals.matchingCount).toBe(VARIANCE_REPORT_EXPORT_MAX_ROWS);
      expect(res.body.totals.totalsComputed).toBe(true);
      expect(res.body.totals.comparisonTotalNet).not.toBeNull();
    });

    it('20,001 matching rows (one past the ceiling): totalsComputed is false, every monetary total is null, but population counts remain exact', async () => {
      const start = Date.now();
      const res = await admin.agent.get(listUrl([siteAId, siteBId, siteCId]));
      // eslint-disable-next-line no-console
      console.log(`[boundary] totals @ 20,001 rows (one past the boundary): ${Date.now() - start}ms`);
      expect(res.status).toBe(200);
      expect(res.body.totals.matchingCount).toBe(VARIANCE_REPORT_EXPORT_MAX_ROWS + 1);
      expect(res.body.totals.totalsComputed).toBe(false);
      expect(res.body.totals.comparisonTotalNet).toBeNull();
      expect(res.body.totals.currentTotalNet).toBeNull();
      expect(res.body.totals.aggregateVarianceAmount).toBeNull();
      expect(res.body.totals.aggregateVariancePercent).toBeNull();
      // Population/direction/transfer/correction counts are never gated by this ceiling (see
      // VarianceReportTotals's own doc comment) — every fixture row here is CONTINUED/UNCHANGED.
      expect(res.body.totals.continuedEmployeeCount).toBe(VARIANCE_REPORT_EXPORT_MAX_ROWS + 1);
      expect(res.body.totals.unchangedCount).toBe(VARIANCE_REPORT_EXPORT_MAX_ROWS + 1);
      expect(res.body.totals.newEmployeeCount).toBe(0);
      expect(res.body.totals.departedEmployeeCount).toBe(0);
    });
  });

  describe('Sorting: calcNet-derived sort rejected beyond the ceiling', () => {
    it('sortBy=varianceAmount succeeds at 20,000 (the boundary itself)', async () => {
      const res = await admin.agent.get(
        `/api/v1/reports/variance?${new URLSearchParams({
          comparisonCycleId,
          currentCycleId,
          siteIds: [siteAId, siteBId].join(','),
          sortBy: 'varianceAmount',
          pageSize: '1',
        }).toString()}`,
      );
      expect(res.status).toBe(200);
    });

    it('sortBy=varianceAmount is rejected with 400 at 20,001 (one past the ceiling)', async () => {
      const res = await admin.agent.get(
        `/api/v1/reports/variance?${new URLSearchParams({
          comparisonCycleId,
          currentCycleId,
          siteIds: [siteAId, siteBId, siteCId].join(','),
          sortBy: 'varianceAmount',
          pageSize: '1',
        }).toString()}`,
      );
      expect(res.status).toBe(400);
    });
  });

  describe('Export: 200/200/413 at each exact count', () => {
    it('19,999 rows: export succeeds', async () => {
      const start = Date.now();
      const res = await admin.agent.get(exportUrl([siteAId]));
      // eslint-disable-next-line no-console
      console.log(`[boundary] export @ 19,999 rows: ${Date.now() - start}ms`);
      expect(res.status).toBe(200);
      const lines = res.text.trim().split('\n');
      expect(lines.length).toBe(SITE_A_COUNT + 1); // header + every row
    });

    it('20,000 rows (exactly the ceiling): export succeeds — the comparison is >, not >=', async () => {
      const start = Date.now();
      const res = await admin.agent.get(exportUrl([siteAId, siteBId]));
      // eslint-disable-next-line no-console
      console.log(`[boundary] export @ 20,000 rows (the boundary itself): ${Date.now() - start}ms`);
      expect(res.status).toBe(200);
      const lines = res.text.trim().split('\n');
      expect(lines.length).toBe(VARIANCE_REPORT_EXPORT_MAX_ROWS + 1);
    });

    it('20,001 rows (one past the ceiling): export is rejected with a structured 413, before any row is rendered', async () => {
      const start = Date.now();
      const res = await admin.agent.get(exportUrl([siteAId, siteBId, siteCId]));
      // eslint-disable-next-line no-console
      console.log(`[boundary] export @ 20,001 rows (one past the boundary): ${Date.now() - start}ms`);
      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe('EXPORT_ROW_LIMIT_EXCEEDED');
      expect(res.body.error.matchingCount).toBe(VARIANCE_REPORT_EXPORT_MAX_ROWS + 1);
      expect(res.body.error.maxRows).toBe(VARIANCE_REPORT_EXPORT_MAX_ROWS);
    });
  });
});
