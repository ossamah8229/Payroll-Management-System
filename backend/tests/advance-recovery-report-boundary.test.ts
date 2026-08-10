import { randomUUID } from 'node:crypto';
import { ADVANCE_RECOVERY_REPORT_EXPORT_MAX_ROWS, PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

/**
 * Phase 7 Reports, Advance Recovery Report Checkpoint 1A — an explicit, real-data proof of the
 * exact `ADVANCE_RECOVERY_REPORT_EXPORT_MAX_ROWS` (20,000) export boundary — 19,999 succeeds,
 * 20,000 (the boundary itself) succeeds, 20,001 is rejected — mirroring
 * `deduction-report-boundary.test.ts`'s own established methodology and its efficient
 * three-site-bucket fixture strategy (rather than seeding three full ~20,000-row datasets).
 *
 * **Totals have no ceiling at all (frozen decision — Totals section)**: unlike Deduction Report's
 * own `totalsComputed` gate, every Advance Recovery Report total is a true DB aggregate — this
 * file's own Totals section proves that directly, by showing every total stays a real, non-null,
 * correctly-summed figure at all three boundary counts, including one row past the export ceiling.
 * The 20,000-row ceiling in this report exists solely to bound CSV/XLSX export generation cost.
 *
 * **Efficient fixture**: one Advance per employee (default `ACTIVE` status, no
 * `PayrollCycle`/`PayrollEntry` involved at all — this report's own grain is `Advance`, so no
 * payroll-cycle machinery is needed to reach real row counts) — Site A (19,999), Site B (1), Site
 * C (1) — reached via the report's own real `siteIds` filter, exactly as
 * `deduction-report-boundary.test.ts` reaches its own three exact counts.
 */

jest.setTimeout(5 * 60 * 1000);

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';
const SITE_A_COUNT = ADVANCE_RECOVERY_REPORT_EXPORT_MAX_ROWS - 1; // 19,999
const SITE_B_COUNT = 1; // + this = 20,000 (the boundary itself)
const SITE_C_COUNT = 1; // + this = 20,001 (one past the boundary)

describe('Phase 7 Reports — Advance Recovery Report Checkpoint 1A — 19,999/20,000/20,001 export ceiling boundary proof', () => {
  let admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>;
  let siteAId: string;
  let siteBId: string;
  let siteCId: string;

  beforeAll(async () => {
    await cleanTestData();

    admin = await createAuthenticatedAgent(app, {
      email: 'arr-boundary-admin@test.local',
      password: PASSWORD,
      roleCode: ROLE_CODES.MASTER_ADMIN,
      permissionKeys: [PERMISSIONS.REPORTS_VIEW],
    });

    const siteA = await prisma.projectSite.create({ data: { name: 'Test Site ARR Boundary A' } });
    const unitA = await prisma.projectUnit.create({ data: { siteId: siteA.id, name: 'ARR Boundary Unit A', code: 'ARRBA' } });
    const siteB = await prisma.projectSite.create({ data: { name: 'Test Site ARR Boundary B' } });
    const unitB = await prisma.projectUnit.create({ data: { siteId: siteB.id, name: 'ARR Boundary Unit B', code: 'ARRBB' } });
    const siteC = await prisma.projectSite.create({ data: { name: 'Test Site ARR Boundary C' } });
    const unitC = await prisma.projectUnit.create({ data: { siteId: siteC.id, name: 'ARR Boundary Unit C', code: 'ARRBC' } });
    siteAId = siteA.id;
    siteBId = siteB.id;
    siteCId = siteC.id;

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
            employeeCode: `ARR-BOUND-${label}-${String(i).padStart(6, '0')}`,
            name: `ARR Boundary ${label} Employee ${i}`,
            designation: 'Guard',
            siteId,
            unitId,
            grossPay: '30000',
          });
        }
        await prisma.employee.createMany({ data: batch });
      }

      const advanceRows = employeeIds.map((employeeId) => ({
        id: randomUUID(),
        employeeId,
        type: 'LOAN' as const,
        totalAmount: '10000',
        outstandingBalance: '6000',
        dateGiven: new Date('2026-01-01'),
        repaymentType: 'FULL_DEDUCTION' as const,
        status: 'ACTIVE' as const,
      }));
      for (let start = 0; start < advanceRows.length; start += CHUNK) {
        await prisma.advance.createMany({ data: advanceRows.slice(start, start + CHUNK) });
      }
    }

    await seedSite(siteAId, unitA.id, SITE_A_COUNT, 'A');
    await seedSite(siteBId, unitB.id, SITE_B_COUNT, 'B');
    await seedSite(siteCId, unitC.id, SITE_C_COUNT, 'C');

    const totalAdvances = await prisma.advance.count();
    // eslint-disable-next-line no-console
    console.log(`[boundary] seeded ${totalAdvances} Advance rows across 3 sites (${SITE_A_COUNT}/${SITE_B_COUNT}/${SITE_C_COUNT})`);
    expect(totalAdvances).toBe(ADVANCE_RECOVERY_REPORT_EXPORT_MAX_ROWS + 1);
  }, 5 * 60 * 1000);

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  function listUrl(siteIds: string[]): string {
    return `/api/v1/reports/advance-recovery?${new URLSearchParams({ siteIds: siteIds.join(','), pageSize: '1' }).toString()}`;
  }
  function exportUrl(siteIds: string[]): string {
    return `/api/v1/reports/advance-recovery/export?${new URLSearchParams({ siteIds: siteIds.join(','), format: 'csv' }).toString()}`;
  }

  describe('Totals: true DB aggregates at every exact count, no ceiling', () => {
    it('19,999 matching rows: totals are real, non-null, correctly summed', async () => {
      const start = Date.now();
      const res = await admin.agent.get(listUrl([siteAId]));
      // eslint-disable-next-line no-console
      console.log(`[boundary] totals @ 19,999 rows: ${Date.now() - start}ms`);
      expect(res.status).toBe(200);
      expect(res.body.totals.matchingAdvanceCount).toBe(SITE_A_COUNT);
      expect(res.body.totals.loan.originalAmountTotal).toBe((SITE_A_COUNT * 10000).toFixed(2));
      expect(res.body.totals.loan.currentOutstandingBalanceTotal).toBe((SITE_A_COUNT * 6000).toFixed(2));
    });

    it('20,000 matching rows (exactly the ceiling): totals remain real and correctly summed — no fallback exists to trigger', async () => {
      const start = Date.now();
      const res = await admin.agent.get(listUrl([siteAId, siteBId]));
      // eslint-disable-next-line no-console
      console.log(`[boundary] totals @ 20,000 rows (the boundary itself): ${Date.now() - start}ms`);
      expect(res.status).toBe(200);
      expect(res.body.totals.matchingAdvanceCount).toBe(ADVANCE_RECOVERY_REPORT_EXPORT_MAX_ROWS);
      expect(res.body.totals.loan.originalAmountTotal).toBe((ADVANCE_RECOVERY_REPORT_EXPORT_MAX_ROWS * 10000).toFixed(2));
    });

    it('20,001 matching rows (one past the export ceiling): totals are STILL real, non-null, and correctly summed — this report has no totalsComputed gate at all', async () => {
      const start = Date.now();
      const res = await admin.agent.get(listUrl([siteAId, siteBId, siteCId]));
      // eslint-disable-next-line no-console
      console.log(`[boundary] totals @ 20,001 rows (one past the boundary): ${Date.now() - start}ms`);
      expect(res.status).toBe(200);
      const totalCount = ADVANCE_RECOVERY_REPORT_EXPORT_MAX_ROWS + 1;
      expect(res.body.totals.matchingAdvanceCount).toBe(totalCount);
      expect(res.body.totals.employeesWithAdvanceCount).toBe(totalCount);
      expect(res.body.totals.loan.originalAmountTotal).toBe((totalCount * 10000).toFixed(2));
      expect(res.body.totals.loan.currentOutstandingBalanceTotal).toBe((totalCount * 6000).toFixed(2));
      expect(res.body.totals.loan.recoveredToDateTotal).toBe((totalCount * 4000).toFixed(2));
      expect(res.body.totals.activeCount).toBe(totalCount);
      expect(res.body.totals.totalsComputed).toBeUndefined();
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
      expect(lines.length).toBe(ADVANCE_RECOVERY_REPORT_EXPORT_MAX_ROWS + 1); // header + every matching row
    });

    it('20,001 matching rows (one past the ceiling): export is rejected with a structured 413 before any row is fetched', async () => {
      const start = Date.now();
      const res = await admin.agent.get(exportUrl([siteAId, siteBId, siteCId]));
      // eslint-disable-next-line no-console
      console.log(`[boundary] export rejection @ 20,001 rows: ${Date.now() - start}ms`);
      expect(res.status).toBe(413);
      expect(res.body.error).toEqual({
        code: 'EXPORT_ROW_LIMIT_EXCEEDED',
        matchingCount: ADVANCE_RECOVERY_REPORT_EXPORT_MAX_ROWS + 1,
        maxRows: ADVANCE_RECOVERY_REPORT_EXPORT_MAX_ROWS,
        message: expect.stringContaining(`${ADVANCE_RECOVERY_REPORT_EXPORT_MAX_ROWS + 1} rows`),
      });
      // The preflight COUNT rejects before any row is fetched/mapped/formatted — the 413 case
      // must be dramatically cheaper than the 200 cases above, not merely correct.
      expect(Date.now() - start).toBeLessThan(3_000);
    });
  });
});
