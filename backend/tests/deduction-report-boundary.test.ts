import { randomUUID } from 'node:crypto';
import { DEDUCTION_REPORT_EXPORT_MAX_ROWS, PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

/**
 * Phase 7 Reports, Deduction Report Checkpoint 1A — targeted review hardening pass (M3): an
 * explicit, real-data proof of the exact `DEDUCTION_REPORT_EXPORT_MAX_ROWS` (20,000) boundary —
 * 19,999 succeeds, 20,000 (the boundary itself) succeeds, 20,001 is rejected — for both the totals
 * computation (`totalsComputed`) and the export endpoint (200 vs structured 413). This is the
 * literal `>`, not `>=`, comparison in `deduction-report.service.ts`'s
 * `computeDeductionReportTotals`/`buildDeductionReportExportData` and `reports.routes.ts`'s own
 * `data.totalMatching > DEDUCTION_REPORT_EXPORT_MAX_ROWS` check, exercised at real volume — not
 * assumed from the constant's own doc comment.
 *
 * **Efficient fixture, not 3×20,000 rows**: no reusable boundary-seeding helper exists yet anywhere
 * in this codebase (`project-site-payroll-report-performance.test.ts`'s own §16.6-style comment
 * explicitly disclaims proving this at real volume, deferring to "contract-level coverage" that,
 * on inspection, did not actually exist before this file). Rather than seed three full ~20,000-row
 * cycles (~60,000 rows), this file seeds exactly **one** cycle with exactly 20,001 real
 * `PayrollEntry` rows, split across three sites — Site A (19,999 rows), Site B (1 row), Site C (1
 * row) — and reaches each of the three boundary counts via the report's own real `siteIds` filter
 * (`siteIds=[A]` → 19,999; `siteIds=[A,B]` → 20,000; `siteIds=[A,B,C]` → 20,001). Every row still
 * goes through the real endpoint, the real `where` clause, the real preflight `COUNT`, and (below
 * the ceiling) the real `calcNet`-over-every-row totals pass — this is a genuine end-to-end proof,
 * just a cheaper path to the three exact counts than tripling the seed.
 */

jest.setTimeout(5 * 60 * 1000);

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';
const SITE_A_COUNT = DEDUCTION_REPORT_EXPORT_MAX_ROWS - 1; // 19,999
const SITE_B_COUNT = 1; // + this = 20,000 (the boundary itself)
const SITE_C_COUNT = 1; // + this = 20,001 (one past the boundary)

describe('Phase 7 Reports — Deduction Report Checkpoint 1A — 19,999/20,000/20,001 ceiling boundary proof (M3)', () => {
  let admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>;
  let siteAId: string;
  let siteBId: string;
  let siteCId: string;
  let cycleId: string;

  beforeAll(async () => {
    await cleanTestData();

    admin = await createAuthenticatedAgent(app, {
      email: 'dr-boundary-admin@test.local',
      password: PASSWORD,
      roleCode: ROLE_CODES.MASTER_ADMIN,
      permissionKeys: [PERMISSIONS.PAYROLL_CYCLE_MANAGE, PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.REPORTS_VIEW],
    });

    const siteA = await prisma.projectSite.create({ data: { name: 'Test Site DR Boundary A' } });
    const unitA = await prisma.projectUnit.create({ data: { siteId: siteA.id, name: 'DR Boundary Unit A', code: 'DRBA' } });
    const siteB = await prisma.projectSite.create({ data: { name: 'Test Site DR Boundary B' } });
    const unitB = await prisma.projectUnit.create({ data: { siteId: siteB.id, name: 'DR Boundary Unit B', code: 'DRBB' } });
    const siteC = await prisma.projectSite.create({ data: { name: 'Test Site DR Boundary C' } });
    const unitC = await prisma.projectUnit.create({ data: { siteId: siteC.id, name: 'DR Boundary Unit C', code: 'DRBC' } });
    siteAId = siteA.id;
    siteBId = siteB.id;
    siteCId = siteC.id;

    const cycle = await prisma.payrollCycle.create({ data: { year: 2950, month: 1, createdBy: admin.userId, status: 'DRAFT' } });
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
            employeeCode: `DR-BOUND-${label}-${String(i).padStart(6, '0')}`,
            name: `DR Boundary ${label} Employee ${i}`,
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
        otHours: '0',
        cycleDays: 30,
      }));
      for (let start = 0; start < workLineRows.length; start += CHUNK) {
        await prisma.payrollEntryWorkLine.createMany({ data: workLineRows.slice(start, start + CHUNK) });
      }
    }

    await seedSite(siteAId, unitA.id, SITE_A_COUNT, 'A');
    await seedSite(siteBId, unitB.id, SITE_B_COUNT, 'B');
    await seedSite(siteCId, unitC.id, SITE_C_COUNT, 'C');

    const totalEntries = await prisma.payrollEntry.count({ where: { cycleId } });
    // eslint-disable-next-line no-console
    console.log(`[boundary] seeded ${totalEntries} PayrollEntry rows in one cycle across 3 sites (${SITE_A_COUNT}/${SITE_B_COUNT}/${SITE_C_COUNT})`);
    expect(totalEntries).toBe(DEDUCTION_REPORT_EXPORT_MAX_ROWS + 1);
  }, 5 * 60 * 1000);

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  function listUrl(siteIds: string[]): string {
    return `/api/v1/reports/deduction-report?${new URLSearchParams({ cycleId, siteIds: siteIds.join(','), pageSize: '1' }).toString()}`;
  }
  function exportUrl(siteIds: string[]): string {
    return `/api/v1/reports/deduction-report/export?${new URLSearchParams({ cycleId, siteIds: siteIds.join(','), format: 'csv' }).toString()}`;
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
      expect(res.body.totals.eobiTotal).not.toBeNull();
    });

    it('20,000 matching rows (exactly the ceiling): totalsComputed is still true — the comparison is >, not >=', async () => {
      const start = Date.now();
      const res = await admin.agent.get(listUrl([siteAId, siteBId]));
      // eslint-disable-next-line no-console
      console.log(`[boundary] totals @ 20,000 rows (the boundary itself): ${Date.now() - start}ms`);
      expect(res.status).toBe(200);
      expect(res.body.totals.matchingCount).toBe(DEDUCTION_REPORT_EXPORT_MAX_ROWS);
      expect(res.body.totals.totalsComputed).toBe(true);
      expect(res.body.totals.eobiTotal).not.toBeNull();
    });

    it('20,001 matching rows (one past the ceiling): totalsComputed is false, every monetary total is null', async () => {
      const start = Date.now();
      const res = await admin.agent.get(listUrl([siteAId, siteBId, siteCId]));
      // eslint-disable-next-line no-console
      console.log(`[boundary] totals @ 20,001 rows (one past the boundary): ${Date.now() - start}ms`);
      expect(res.status).toBe(200);
      expect(res.body.totals.matchingCount).toBe(DEDUCTION_REPORT_EXPORT_MAX_ROWS + 1);
      expect(res.body.totals.totalsComputed).toBe(false);
      expect(res.body.totals.eobiTotal).toBeNull();
      expect(res.body.totals.advanceDeductionTotal).toBeNull();
      expect(res.body.totals.eidAdvanceDeductionTotal).toBeNull();
      expect(res.body.totals.fineTotal).toBeNull();
      expect(res.body.totals.correctionRecoveryTotal).toBeNull();
      expect(res.body.totals.totalDeductions).toBeNull();
      expect(res.body.totals.employeesWithAnyDeduction).toBeNull();
      // Status-breakdown counts are plain DB aggregates, independent of totalsComputed (frozen
      // decision — they never gate on the same ceiling as the calcNet-derived monetary totals).
      expect(
        res.body.totals.heldCount +
          res.body.totals.pendingCount +
          res.body.totals.noPayDueCount +
          res.body.totals.recoveryDueCount +
          res.body.totals.releasedCount,
      ).toBe(DEDUCTION_REPORT_EXPORT_MAX_ROWS + 1);
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
      expect(lines.length).toBe(DEDUCTION_REPORT_EXPORT_MAX_ROWS + 1); // header + every matching row
    });

    it('20,001 matching rows (one past the ceiling): export is rejected with a structured 413 before any row is fetched', async () => {
      const start = Date.now();
      const res = await admin.agent.get(exportUrl([siteAId, siteBId, siteCId]));
      // eslint-disable-next-line no-console
      console.log(`[boundary] export rejection @ 20,001 rows: ${Date.now() - start}ms`);
      expect(res.status).toBe(413);
      expect(res.body.error).toEqual({
        code: 'EXPORT_ROW_LIMIT_EXCEEDED',
        matchingCount: DEDUCTION_REPORT_EXPORT_MAX_ROWS + 1,
        maxRows: DEDUCTION_REPORT_EXPORT_MAX_ROWS,
        message: expect.stringContaining(`${DEDUCTION_REPORT_EXPORT_MAX_ROWS + 1} rows`),
      });
      // The preflight COUNT rejects before any row is fetched/mapped/formatted — the 413 case
      // must be dramatically cheaper than the 200 cases above, not merely correct.
      expect(Date.now() - start).toBeLessThan(3_000);
    });
  });
});
