import { randomUUID } from 'node:crypto';
import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

/**
 * Phase 7 Reports, Deduction Report Checkpoint 1A — committed, repeatable performance validation
 * (frozen decision: "no migration expected... Checkpoint 1A must prove this with EXPLAIN
 * ANALYZE"), mirroring `project-site-payroll-report-performance.test.ts`'s own established
 * methodology (real seeded data, real `EXPLAIN (ANALYZE, BUFFERS)`, assertions that no `Seq Scan`
 * occurs on `PayrollEntry` in the measured shapes, every measured duration logged) rather than an
 * ad hoc, uncommitted script.
 *
 * Seeded at the same order of magnitude as Project Site Payroll Report's own §16.6 evidence — 10
 * sites × 1,000 employees, across 3 cycles (30,000 total `PayrollEntry` rows) — with deliberately
 * *varied* deduction values/applicability across employees (not a flat, identical fixture), so the
 * five deduction-type filter shapes actually exercise real selectivity rather than an all-or-
 * nothing predicate. Seeding uses bulk `createMany` throughout — never a per-row loop.
 */

jest.setTimeout(5 * 60 * 1000);

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';
const SITE_COUNT = 10;
const EMPLOYEES_PER_SITE = 1_000;
const CYCLE_COUNT = 3;
const EMPLOYEE_COUNT = SITE_COUNT * EMPLOYEES_PER_SITE;

describe('Phase 7 Reports — Deduction Report Checkpoint 1A — performance validation (no schema change)', () => {
  let admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>;
  let siteIds: string[];
  let unitIdBySite: Map<string, string>;
  let cycleIds: string[];
  let targetCycleId: string;
  let targetSiteId: string;

  beforeAll(async () => {
    await cleanTestData();

    admin = await createAuthenticatedAgent(app, {
      email: 'dr-perf-admin@test.local',
      password: PASSWORD,
      roleCode: ROLE_CODES.MASTER_ADMIN,
      permissionKeys: [PERMISSIONS.PAYROLL_CYCLE_MANAGE, PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.REPORTS_VIEW],
    });

    const sites = [];
    for (let i = 0; i < SITE_COUNT; i += 1) {
      const site = await prisma.projectSite.create({ data: { name: `Test Site DR Perf ${i}` } });
      const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `DR Perf Unit ${i}`, code: `DRPU-${i}` } });
      sites.push({ site, unit });
    }
    siteIds = sites.map((s) => s.site.id);
    unitIdBySite = new Map(sites.map((s) => [s.site.id, s.unit.id]));
    targetSiteId = siteIds[0]!;

    // 10,000 employees, bulk-inserted (chunked createMany).
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
          employeeCode: `DR-PERF-${String(i).padStart(6, '0')}`,
          name: `DR Perf Employee ${i}`,
          designation: 'Guard',
          siteId: s.site.id,
          unitId: s.unit.id,
          grossPay: '30000',
        });
      }
      await prisma.employee.createMany({ data: batch });
    }

    // 3 cycles × 10,000 entries = 30,000 PayrollEntry rows, each with one work line. Deduction
    // values are deliberately varied by index (roughly a 1-in-4/1-in-5 selectivity per deduction
    // type) so the tri-state filter query shapes below measure real, non-degenerate selectivity —
    // not an all-rows-match or zero-rows-match degenerate case.
    cycleIds = [];
    for (let c = 0; c < CYCLE_COUNT; c += 1) {
      const cycle = await prisma.payrollCycle.create({ data: { year: 2900 + c, month: 1, createdBy: admin.userId, status: 'DRAFT' } });
      cycleIds.push(cycle.id);

      const entryRows = employeeIds.map(({ id, siteId }, i) => ({
        id: randomUUID(),
        cycleId: cycle.id,
        employeeId: id,
        siteId,
        designation: 'Guard',
        grossPay: '30000',
        allowance: '0',
        leaveDays: '0',
        eobiAmount: '400',
        eobiApplicable: i % 3 !== 0, // ~2/3 applicable
        advanceDeduction: i % 4 === 0 ? '2000' : '0', // 1/4 have an advance
        eidAdvanceDeduction: i % 5 === 0 ? '1000' : '0', // 1/5 have an EID advance
        fine: i % 10 === 0 ? '500' : '0', // 1/10 have a fine
        correctionBalancePayable: '0',
        correctionBalanceRecovery: i % 7 === 0 ? '750' : '0', // ~1/7 have a recovery
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
    targetCycleId = cycleIds[cycleIds.length - 1]!;

    // Deterministic planner statistics after this fixture's bulk `createMany` burst (same
    // precedent as `advance-recovery-report-performance.test.ts`/`overtime-report-performance
    // .test.ts`) — every table this suite's own EXPLAIN blocks and list-query assertions query.
    await prisma.$executeRawUnsafe('ANALYZE "Employee", "PayrollEntry", "PayrollEntryWorkLine"');

    const totalEntries = await prisma.payrollEntry.count();
    // eslint-disable-next-line no-console
    console.log(`[perf] seeded ${EMPLOYEE_COUNT} employees, ${CYCLE_COUNT} cycles, ${totalEntries} total PayrollEntry rows`);
  }, 5 * 60 * 1000);

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  it('list query (one cycle, default sort, no filter) uses an index, not a sequential scan', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/deduction-report?cycleId=${targetCycleId}&pageSize=25`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(EMPLOYEE_COUNT);
    // eslint-disable-next-line no-console
    console.log(`[perf] list, one cycle only (all ${EMPLOYEE_COUNT} matching), page of 25: ${ms}ms`);

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

  it('list query (one cycle, one site) uses an index', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/deduction-report?cycleId=${targetCycleId}&siteIds=${targetSiteId}&pageSize=25`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(EMPLOYEES_PER_SITE);
    // eslint-disable-next-line no-console
    console.log(`[perf] list, one cycle + one site (${EMPLOYEES_PER_SITE} of ${EMPLOYEE_COUNT} matching), page of 25: ${ms}ms`);

    // Captured before the timing assertion below so a threshold failure still leaves the query
    // plan on record.
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
    console.log(`[perf] EXPLAIN ANALYZE (cycle+site-filtered list query):\n${planText}`);
    expect(planText).not.toMatch(/Seq Scan on "PayrollEntry"/);
    // Honest finding, not assumed: at this seed's data volume the planner chose a Bitmap Index
    // Scan (via the composite `PayrollEntry_siteId_cycleId_idx`) rather than a plain Index Scan —
    // both are legitimate non-sequential access methods; the regex accepts either rather than
    // asserting one specific scan sub-type the evidence doesn't consistently show.
    expect(planText).toMatch(/(Index Scan|Index Only Scan|Bitmap Index Scan).*"PayrollEntry_/);

    expect(ms).toBeLessThan(3_000);
  });

  it('hasFine=true (a ~10% selectivity predicate on a plain stored column) stays fast', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/deduction-report?cycleId=${targetCycleId}&hasFine=true&pageSize=25`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`[perf] list, one cycle + hasFine=true (${res.body.total} of ${EMPLOYEE_COUNT} matching): ${ms}ms`);

    // Captured before the timing assertion below so a threshold failure still leaves the query
    // plan on record.
    const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT pe.* FROM "PayrollEntry" pe
       WHERE pe."cycleId" = $1::uuid AND pe."fine" > 0
       ORDER BY pe.id ASC
       LIMIT 25`,
      targetCycleId,
    );
    const planText = plan.map((row) => row['QUERY PLAN']).join('\n');
    // eslint-disable-next-line no-console
    console.log(`[perf] EXPLAIN ANALYZE (cycle + fine>0 filter):\n${planText}`);
    expect(planText).not.toMatch(/Seq Scan on "PayrollEntry"/);

    expect(ms).toBeLessThan(3_000);
  });

  it('hasAdvanceDeduction=true stays fast', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/deduction-report?cycleId=${targetCycleId}&hasAdvanceDeduction=true&pageSize=25`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`[perf] list, one cycle + hasAdvanceDeduction=true (${res.body.total} of ${EMPLOYEE_COUNT} matching): ${ms}ms`);
    expect(ms).toBeLessThan(3_000);
  });

  it('hasCorrectionRecovery=true (the two-column-adjacent effective-EOBI sibling shape) stays fast', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/deduction-report?cycleId=${targetCycleId}&hasCorrectionRecovery=true&pageSize=25`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`[perf] list, one cycle + hasCorrectionRecovery=true (${res.body.total} of ${EMPLOYEE_COUNT} matching): ${ms}ms`);
    expect(ms).toBeLessThan(3_000);
  });

  it('hasEobi=true (the applicability + amount two-column predicate) stays fast', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/deduction-report?cycleId=${targetCycleId}&hasEobi=true&pageSize=25`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`[perf] list, one cycle + hasEobi=true (${res.body.total} of ${EMPLOYEE_COUNT} matching): ${ms}ms`);

    // Captured before the timing assertion below so a threshold failure still leaves the query
    // plan on record.
    const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT pe.* FROM "PayrollEntry" pe
       WHERE pe."cycleId" = $1::uuid AND pe."eobiApplicable" = true AND pe."eobiAmount" > 0
       ORDER BY pe.id ASC
       LIMIT 25`,
      targetCycleId,
    );
    const planText = plan.map((row) => row['QUERY PLAN']).join('\n');
    // eslint-disable-next-line no-console
    console.log(`[perf] EXPLAIN ANALYZE (cycle + effective-EOBI filter):\n${planText}`);
    expect(planText).not.toMatch(/Seq Scan on "PayrollEntry"/);

    expect(ms).toBeLessThan(3_000);
  });

  it('sorting by a plain stored monetary column (advanceDeduction) uses database-level ORDER BY and stays fast', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/deduction-report?cycleId=${targetCycleId}&sortBy=advanceDeduction&sortDir=desc&pageSize=25`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(25);
    // eslint-disable-next-line no-console
    console.log(`[perf] list, one cycle, sortBy=advanceDeduction desc: ${ms}ms`);

    // Captured before the timing assertion below so a threshold failure still leaves the query
    // plan on record.
    const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT pe.* FROM "PayrollEntry" pe
       WHERE pe."cycleId" = $1::uuid
       ORDER BY pe."advanceDeduction" DESC, pe.id ASC
       LIMIT 25`,
      targetCycleId,
    );
    const planText = plan.map((row) => row['QUERY PLAN']).join('\n');
    // eslint-disable-next-line no-console
    console.log(`[perf] EXPLAIN ANALYZE (cycle-scoped sort by advanceDeduction):\n${planText}`);
    expect(planText).not.toMatch(/Seq Scan on "PayrollEntry"/);

    expect(ms).toBeLessThan(3_000);
  });

  it('unit-filtered query (join through PayrollEntryWorkLine, already bounded by cycle+site) stays fast', async () => {
    const unitId = unitIdBySite.get(targetSiteId)!;
    const start = Date.now();
    const res = await admin.agent.get(
      `/api/v1/reports/deduction-report?cycleId=${targetCycleId}&siteIds=${targetSiteId}&unitId=${unitId}&pageSize=25`,
    );
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(EMPLOYEES_PER_SITE);
    // eslint-disable-next-line no-console
    console.log(`[perf] list, one cycle + one site + one unit (work-line join, bounded candidate set): ${ms}ms`);
    expect(ms).toBeLessThan(3_000);
  });

  it('totals computation (bounded calcNet/sumMoney pass over every matching row) completes within a generous bound for a full-cycle result, well under the 20,000-row ceiling', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/deduction-report?cycleId=${targetCycleId}&pageSize=25`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.totals.totalsComputed).toBe(true);
    expect(res.body.totals.matchingCount).toBe(EMPLOYEE_COUNT);
    // eslint-disable-next-line no-console
    console.log(
      `[perf] full request (list page + totals over all ${EMPLOYEE_COUNT} matching rows, well under the ` +
        `20,000-row ceiling): ${ms}ms`,
    );
    expect(ms).toBeLessThan(5_000);
  });

  it('export produces every matching row for one cycle+site, correctly, with duration on record', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/deduction-report/export?cycleId=${targetCycleId}&siteIds=${targetSiteId}&format=csv`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    const lines = res.text.trim().split('\n');
    expect(lines.length).toBe(EMPLOYEES_PER_SITE + 1); // header + every row for this site
    // eslint-disable-next-line no-console
    console.log(`[perf] export of ${EMPLOYEES_PER_SITE} rows (one cycle + one site) to CSV: ${ms}ms`);
    expect(ms).toBeLessThan(5_000);
  });

  it('correction-count lookup stays a single batched query regardless of row count (no per-row N+1)', async () => {
    const groupBySpy = jest.spyOn(prisma.correction, 'groupBy');
    const res = await admin.agent.get(`/api/v1/reports/deduction-report?cycleId=${targetCycleId}&siteIds=${targetSiteId}&pageSize=25`);
    expect(res.status).toBe(200);
    expect(groupBySpy).toHaveBeenCalledTimes(1);
    groupBySpy.mockRestore();
  });

  it('a whole-cycle export (10,000 rows, well under the 20,000-row ceiling) completes correctly and quickly', async () => {
    // This suite's own 10,000-per-cycle scale is sized for its own purpose (measuring real
    // query-plan behavior at realistic volume), not the literal 19,999/20,000/20,001 boundary — that
    // boundary is proven directly, at real volume (one seeded cycle of 20,001 real `PayrollEntry`
    // rows, exact counts reached via `siteIds` filtering), by the dedicated
    // `deduction-report-boundary.test.ts` (M3, added in this checkpoint's review-hardening pass;
    // an earlier version of this comment claimed that proof already existed in
    // `deduction-report.test.ts`'s own "contract-level coverage" — it did not, and has been
    // superseded by the dedicated file). This test's own job remains proving the *complete,
    // correctly-filtered* export still performs well at 10,000 real rows, under realistic
    // cross-cycle noise.
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/deduction-report/export?cycleId=${targetCycleId}&format=csv`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    const lines = res.text.trim().split('\n');
    expect(lines.length).toBe(EMPLOYEE_COUNT + 1); // header + every one of the 10,000 matching rows
    // eslint-disable-next-line no-console
    console.log(`[perf] whole-cycle export (${EMPLOYEE_COUNT} rows, under the 20,000-row ceiling) to CSV: ${ms}ms`);
    expect(ms).toBeLessThan(10_000);
  });
});
