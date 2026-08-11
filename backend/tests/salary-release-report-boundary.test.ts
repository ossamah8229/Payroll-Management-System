import { randomUUID } from 'node:crypto';
import { SALARY_RELEASE_REPORT_EXPORT_MAX_ROWS, PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

/**
 * Phase 7 Reports, Salary Release Report Checkpoint 1A — an explicit, real-data proof of the exact
 * `SALARY_RELEASE_REPORT_EXPORT_MAX_ROWS` (20,000) boundary — 19,999 succeeds, 20,000 (the boundary
 * itself) succeeds, 20,001 is rejected — for both the totals computation (`totalsComputed`) and the
 * export endpoint (200 vs structured 413). This is the literal `>`, not `>=`, comparison in
 * `salary-release-report.service.ts`'s `computeSalaryReleaseReportTotals`/
 * `buildSalaryReleaseReportExportData` and `reports.routes.ts`'s own
 * `data.totalMatching > SALARY_RELEASE_REPORT_EXPORT_MAX_ROWS` check, exercised at real volume — not
 * assumed from the constant's own doc comment. Mirrors `deduction-report-boundary.test.ts`'s own
 * established, efficient bucket strategy: one cycle, 20,001 real `PayrollEntry` rows split
 * 19,999/1/1 across three sites, each boundary count reached via the report's own real `siteIds`
 * filter rather than seeding three full ~20,000-row cycles.
 */

jest.setTimeout(5 * 60 * 1000);

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';
const SITE_A_COUNT = SALARY_RELEASE_REPORT_EXPORT_MAX_ROWS - 1; // 19,999
const SITE_B_COUNT = 1; // + this = 20,000 (the boundary itself)
const SITE_C_COUNT = 1; // + this = 20,001 (one past the boundary)

describe('Phase 7 Reports — Salary Release Report Checkpoint 1A — 19,999/20,000/20,001 ceiling boundary proof', () => {
  let admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>;
  let siteAId: string;
  let siteBId: string;
  let siteCId: string;
  let cycleId: string;

  beforeAll(async () => {
    await cleanTestData();

    admin = await createAuthenticatedAgent(app, {
      email: 'srr-boundary-admin@test.local',
      password: PASSWORD,
      roleCode: ROLE_CODES.MASTER_ADMIN,
      permissionKeys: [PERMISSIONS.PAYROLL_CYCLE_MANAGE, PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.REPORTS_VIEW],
    });

    const siteA = await prisma.projectSite.create({ data: { name: 'Test Site SRR Boundary A' } });
    const unitA = await prisma.projectUnit.create({ data: { siteId: siteA.id, name: 'SRR Boundary Unit A', code: 'SRRBA' } });
    const siteB = await prisma.projectSite.create({ data: { name: 'Test Site SRR Boundary B' } });
    const unitB = await prisma.projectUnit.create({ data: { siteId: siteB.id, name: 'SRR Boundary Unit B', code: 'SRRBB' } });
    const siteC = await prisma.projectSite.create({ data: { name: 'Test Site SRR Boundary C' } });
    const unitC = await prisma.projectUnit.create({ data: { siteId: siteC.id, name: 'SRR Boundary Unit C', code: 'SRRBC' } });
    siteAId = siteA.id;
    siteBId = siteB.id;
    siteCId = siteC.id;

    const cycle = await prisma.payrollCycle.create({ data: { year: 2951, month: 1, createdBy: admin.userId, status: 'DRAFT' } });
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
            employeeCode: `SRR-BOUND-${label}-${String(i).padStart(6, '0')}`,
            name: `SRR Boundary ${label} Employee ${i}`,
            designation: 'Guard',
            siteId,
            unitId,
            grossPay: '30000',
          });
        }
        await prisma.employee.createMany({ data: batch });
      }

      // A mix of RELEASED and PENDING rows — the boundary proof itself is status-agnostic, but a
      // real mix avoids an artificially degenerate all-one-status fixture.
      const entryRows = employeeIds.map((employeeId, i) => {
        const released = i % 2 === 0;
        return {
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
          released,
          releasedAt: released ? new Date() : null,
          releasedBy: released ? admin.userId : null,
        };
      });
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
    expect(totalEntries).toBe(SALARY_RELEASE_REPORT_EXPORT_MAX_ROWS + 1);
  }, 5 * 60 * 1000);

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  function listUrl(siteIds: string[]): string {
    return `/api/v1/reports/salary-release?${new URLSearchParams({ cycleId, siteIds: siteIds.join(','), pageSize: '1' }).toString()}`;
  }
  function exportUrl(siteIds: string[]): string {
    return `/api/v1/reports/salary-release/export?${new URLSearchParams({ cycleId, siteIds: siteIds.join(','), format: 'csv' }).toString()}`;
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
      expect(res.body.totals.releasedAmount).not.toBeNull();
      expect(res.body.totals.pendingReleaseAmount).not.toBeNull();
    });

    it('20,000 matching rows (exactly the ceiling): totalsComputed is still true — the comparison is >, not >=', async () => {
      const start = Date.now();
      const res = await admin.agent.get(listUrl([siteAId, siteBId]));
      // eslint-disable-next-line no-console
      console.log(`[boundary] totals @ 20,000 rows (the boundary itself): ${Date.now() - start}ms`);
      expect(res.status).toBe(200);
      expect(res.body.totals.matchingCount).toBe(SALARY_RELEASE_REPORT_EXPORT_MAX_ROWS);
      expect(res.body.totals.totalsComputed).toBe(true);
      expect(res.body.totals.releasedAmount).not.toBeNull();
    });

    it('20,001 matching rows (one past the ceiling): totalsComputed is false, every monetary total is null, status counts remain exact', async () => {
      const start = Date.now();
      const res = await admin.agent.get(listUrl([siteAId, siteBId, siteCId]));
      // eslint-disable-next-line no-console
      console.log(`[boundary] totals @ 20,001 rows (one past the boundary): ${Date.now() - start}ms`);
      expect(res.status).toBe(200);
      expect(res.body.totals.matchingCount).toBe(SALARY_RELEASE_REPORT_EXPORT_MAX_ROWS + 1);
      expect(res.body.totals.totalsComputed).toBe(false);
      expect(res.body.totals.releasedAmount).toBeNull();
      expect(res.body.totals.pendingReleaseAmount).toBeNull();
      expect(res.body.totals.correctionBalancePayableTotal).toBeNull();
      expect(res.body.totals.correctionBalanceRecoveryTotal).toBeNull();
      // Status-breakdown counts are plain DB aggregates, independent of totalsComputed.
      expect(
        res.body.totals.heldCount +
          res.body.totals.pendingCount +
          res.body.totals.noPayDueCount +
          res.body.totals.recoveryDueCount +
          res.body.totals.releasedCount,
      ).toBe(SALARY_RELEASE_REPORT_EXPORT_MAX_ROWS + 1);
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
      expect(lines.length).toBe(SALARY_RELEASE_REPORT_EXPORT_MAX_ROWS + 1); // header + every matching row
    });

    it('20,001 matching rows (one past the ceiling): export is rejected with a structured 413 before any row is fetched', async () => {
      const start = Date.now();
      const res = await admin.agent.get(exportUrl([siteAId, siteBId, siteCId]));
      // eslint-disable-next-line no-console
      console.log(`[boundary] export rejection @ 20,001 rows: ${Date.now() - start}ms`);
      expect(res.status).toBe(413);
      expect(res.body.error).toEqual({
        code: 'EXPORT_ROW_LIMIT_EXCEEDED',
        matchingCount: SALARY_RELEASE_REPORT_EXPORT_MAX_ROWS + 1,
        maxRows: SALARY_RELEASE_REPORT_EXPORT_MAX_ROWS,
        message: expect.stringContaining(`${SALARY_RELEASE_REPORT_EXPORT_MAX_ROWS + 1} rows`),
      });
      // The preflight COUNT rejects before any row is fetched/mapped/formatted — the 413 case
      // must be dramatically cheaper than the 200 cases above, not merely correct.
      expect(Date.now() - start).toBeLessThan(3_000);
    });
  });
});
