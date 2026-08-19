import { randomUUID } from 'node:crypto';
import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

/**
 * Phase 7 Reports, Project Site Payroll Report Checkpoint 1A — committed, repeatable performance
 * validation (frozen decision 7: "no schema changes... Checkpoint 1A must prove this with EXPLAIN
 * ANALYZE"), mirroring `payroll-entry-performance.test.ts`'s own established methodology
 * (real seeded data, real `EXPLAIN (ANALYZE, BUFFERS)`, assertions that no `Seq Scan` occurs on
 * `PayrollEntry`, every measured duration logged) and Employee Payroll History's own §15.9
 * methodology (`docs/architecture/workflows/reports.md`) rather than an ad hoc, uncommitted script.
 *
 * Seeded at the same order of magnitude EPH's own §15.9 evidence used — 10 sites × 1,000
 * employees, across 3 cycles (30,000 total `PayrollEntry` rows) — so this report's single-cycle,
 * site-filtered query is measured against real cross-cycle noise in the table, not an
 * artificially small dataset. Seeding uses bulk `createMany` (never a per-row loop), matching
 * this codebase's own established bulk-write discipline for test fixtures at this scale.
 */

jest.setTimeout(5 * 60 * 1000);

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';
const SITE_COUNT = 10;
const EMPLOYEES_PER_SITE = 1_000;
const CYCLE_COUNT = 3;
const EMPLOYEE_COUNT = SITE_COUNT * EMPLOYEES_PER_SITE;

describe('Phase 7 Reports — Project Site Payroll Report Checkpoint 1A — performance validation (no schema change)', () => {
  let admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>;
  let siteIds: string[];
  let unitIdBySite: Map<string, string>;
  let cycleIds: string[];
  let targetCycleId: string;
  let targetSiteId: string;

  beforeAll(async () => {
    await cleanTestData();

    admin = await createAuthenticatedAgent(app, {
      email: 'psp-perf-admin@test.local',
      password: PASSWORD,
      roleCode: ROLE_CODES.MASTER_ADMIN,
      permissionKeys: [PERMISSIONS.PAYROLL_CYCLE_MANAGE, PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.REPORTS_VIEW],
    });

    const sites = [];
    for (let i = 0; i < SITE_COUNT; i += 1) {
      const site = await prisma.projectSite.create({ data: { name: `Test Site PSP Perf ${i}` } });
      const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `PSP Perf Unit ${i}`, code: `PSPU-${i}` } });
      sites.push({ site, unit });
    }
    siteIds = sites.map((s) => s.site.id);
    unitIdBySite = new Map(sites.map((s) => [s.site.id, s.unit.id]));
    targetSiteId = siteIds[0]!;

    // 10,000 employees, bulk-inserted (chunked createMany — never a per-row loop; this is fixture
    // setup, not the thing being measured).
    const employeeIds: { id: string; siteId: string }[] = [];
    const EMP_CHUNK = 1000;
    for (let start = 0; start < EMPLOYEE_COUNT; start += EMP_CHUNK) {
      const batch = [];
      for (let i = start; i < Math.min(start + EMP_CHUNK, EMPLOYEE_COUNT); i += 1) {
        const s = sites[i % SITE_COUNT]!;
        const id = randomUUID();
        employeeIds.push({ id, siteId: s.site.id });
        batch.push({
          id,
          employeeCode: `PSP-PERF-${String(i).padStart(6, '0')}`,
          name: `PSP Perf Employee ${i}`,
          designation: 'Guard',
          siteId: s.site.id,
          unitId: s.unit.id,
          grossPay: '30000',
        });
      }
      await prisma.employee.createMany({ data: batch });
    }

    // 3 cycles × 10,000 entries = 30,000 PayrollEntry rows, each with one work line — bulk
    // `createMany` for both, mirroring `payroll-entry-performance.test.ts`'s own seeding style
    // (real cycle bootstrap is not needed here; this suite measures query plans over realistic
    // *volume*, not the bootstrap transaction itself, which Payroll Entry's own perf suite
    // already covers).
    cycleIds = [];
    for (let c = 0; c < CYCLE_COUNT; c += 1) {
      const cycle = await prisma.payrollCycle.create({ data: { year: 2900 + c, month: 1, createdBy: admin.userId, status: 'DRAFT' } });
      cycleIds.push(cycle.id);

      const entryRows = employeeIds.map(({ id, siteId }) => ({
        id: randomUUID(),
        cycleId: cycle.id,
        employeeId: id,
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
      for (let start = 0; start < entryRows.length; start += EMP_CHUNK) {
        await prisma.payrollEntry.createMany({ data: entryRows.slice(start, start + EMP_CHUNK) });
      }

      const workLineRows = entryRows.map((entry) => ({
        id: randomUUID(),
        payrollEntryId: entry.id,
        siteId: entry.siteId,
        unitId: unitIdBySite.get(entry.siteId)!,
        days: '26',
        otHours: '0',
        cycleDays: 30,
      }));
      for (let start = 0; start < workLineRows.length; start += EMP_CHUNK) {
        await prisma.payrollEntryWorkLine.createMany({ data: workLineRows.slice(start, start + EMP_CHUNK) });
      }
    }
    targetCycleId = cycleIds[cycleIds.length - 1]!; // the most recently seeded cycle — no special treatment, any of the 3 would do

    // Deterministic planner statistics after this fixture's bulk `createMany` burst (same
    // precedent as `advance-recovery-report-performance.test.ts`/`overtime-report-performance
    // .test.ts`) — every table this suite's own EXPLAIN blocks, list queries, and the totals
    // computation's own `count`/`findMany` calls query.
    await prisma.$executeRawUnsafe('ANALYZE "Employee", "PayrollEntry", "PayrollEntryWorkLine"');

    const totalEntries = await prisma.payrollEntry.count();
    // eslint-disable-next-line no-console
    console.log(`[perf] seeded ${EMPLOYEE_COUNT} employees, ${CYCLE_COUNT} cycles, ${totalEntries} total PayrollEntry rows`);
  }, 5 * 60 * 1000);

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  it('list query (one cycle, one site, 1,000 of 30,000 rows matching) uses an index, not a sequential scan', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/project-site-payroll?cycleId=${targetCycleId}&siteIds=${targetSiteId}&pageSize=25`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(EMPLOYEES_PER_SITE);
    expect(res.body.rows).toHaveLength(25);
    // eslint-disable-next-line no-console
    console.log(`[perf] list, one cycle + one site (${EMPLOYEES_PER_SITE} of ${EMPLOYEE_COUNT * CYCLE_COUNT} matching), page of 25: ${ms}ms`);

    // Captured before the timing assertion below (not after) so a threshold failure still leaves
    // the query plan on record — the whole reason this evidence exists. Faithful to the service's
    // own actual default query shape (`buildOrderBy('employeeName', 'asc')` — an ORDER BY through
    // the `employee` relation, not a bare `PayrollEntry` column), not a simplified stand-in.
    const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT pe.* FROM "PayrollEntry" pe
       JOIN "Employee" e ON e.id = pe."employeeId"
       WHERE pe."cycleId" = $1::uuid AND pe."siteId" = $2::uuid
       ORDER BY e.name ASC, pe.id ASC
       LIMIT 25`,
      targetCycleId,
      targetSiteId,
    );
    const planText = plan.map((row) => row['QUERY PLAN']).join('\n');
    // eslint-disable-next-line no-console
    console.log(`[perf] EXPLAIN ANALYZE (cycle+site-filtered list query, real ORDER BY employee.name):\n${planText}`);
    expect(planText).not.toMatch(/Seq Scan on "PayrollEntry"/);
    // Measured, not assumed: at this data shape/volume the planner chose the single-column
    // `PayrollEntry_cycleId_idx` (applying `siteId` as a post-scan Filter, "Rows Removed by
    // Filter: 9000") over either `[cycleId,siteId]` composite index — a valid, cost-based
    // decision (10,000 cycleId-matching rows is cheap enough to filter in-memory), not a
    // regression: still no `Seq Scan`, still 12ms end to end. Documented honestly rather than
    // asserting the composite index specifically, which this evidence does not actually show.
    expect(planText).toMatch(/Index (Scan|Only Scan) using "PayrollEntry_/);

    expect(ms).toBeLessThan(3_000);
  });

  it('list query (one cycle, all accessible sites — the full cycle) still uses an index', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/project-site-payroll?cycleId=${targetCycleId}&pageSize=25`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(EMPLOYEE_COUNT);
    // eslint-disable-next-line no-console
    console.log(`[perf] list, one cycle only (all ${EMPLOYEE_COUNT} of that cycle), page of 25: ${ms}ms`);

    // Captured before the timing assertion below so a threshold failure still leaves the query
    // plan on record.
    const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT pe.* FROM "PayrollEntry" pe
       JOIN "Employee" e ON e.id = pe."employeeId"
       WHERE pe."cycleId" = $1::uuid
       ORDER BY e.name ASC, pe.id ASC
       LIMIT 25`,
      targetCycleId,
    );
    const planText = plan.map((row) => row['QUERY PLAN']).join('\n');
    // eslint-disable-next-line no-console
    console.log(`[perf] EXPLAIN ANALYZE (cycle-only list query, real ORDER BY employee.name):\n${planText}`);
    expect(planText).not.toMatch(/Seq Scan on "PayrollEntry"/);

    expect(ms).toBeLessThan(3_000);
  });

  it('unit-filtered query (join through PayrollEntryWorkLine, already bounded by cycle+site) stays fast', async () => {
    const unitId = unitIdBySite.get(targetSiteId)!;
    const start = Date.now();
    const res = await admin.agent.get(
      `/api/v1/reports/project-site-payroll?cycleId=${targetCycleId}&siteIds=${targetSiteId}&unitId=${unitId}&pageSize=25`,
    );
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(EMPLOYEES_PER_SITE); // every employee at this site works this one unit
    // eslint-disable-next-line no-console
    console.log(`[perf] list, one cycle + one site + one unit (work-line join, bounded candidate set): ${ms}ms`);
    // Generous bound — PayrollEntryWorkLine has only single-column indexes (payrollEntryId,
    // unitId), so this join is not itself composite-indexed; safety here comes from the
    // cycle+site filter already bounding the candidate set to ~1,000 rows before the join runs,
    // not from a dedicated index on the join path. Documented, not assumed.
    expect(ms).toBeLessThan(3_000);
  });

  it('totals computation (calcNet over every matching row) completes within a generous bound for a full-site-scope, single-cycle result', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/project-site-payroll?cycleId=${targetCycleId}&pageSize=25`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.totals.totalsComputed).toBe(true);
    expect(res.body.totals.matchingCount).toBe(EMPLOYEE_COUNT);
    expect(Number(res.body.totals.grossPay)).toBeCloseTo(EMPLOYEE_COUNT * 30000, 2);
    // eslint-disable-next-line no-console
    console.log(
      `[perf] full request (list page + totals over all ${EMPLOYEE_COUNT} matching rows, well under the ` +
        `20,000-row ceiling): ${ms}ms — same order of magnitude as Employee Payroll History's own ` +
        `measured ~680ms for 9,000 rows (docs/architecture/workflows/reports.md §15.9)`,
    );
    expect(ms).toBeLessThan(5_000);
  });

  it('export produces every matching row for one cycle+site, correctly, with duration on record', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/project-site-payroll/export?cycleId=${targetCycleId}&siteIds=${targetSiteId}&format=csv`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    const lines = res.text.trim().split('\n');
    expect(lines.length).toBe(EMPLOYEES_PER_SITE + 1); // header + every row for this site
    // eslint-disable-next-line no-console
    console.log(`[perf] export of ${EMPLOYEES_PER_SITE} rows (one cycle + one site) to CSV: ${ms}ms`);
    expect(ms).toBeLessThan(5_000);
  });
});
