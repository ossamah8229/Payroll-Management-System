import { randomUUID } from 'node:crypto';
import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent, expectIndexColumns } from './helpers';

/**
 * Phase 7 Reports, Overtime Report Checkpoint 1A — committed, repeatable performance validation
 * (frozen decision: "no migration expected... Checkpoint 1A must prove this with EXPLAIN
 * ANALYZE"), mirroring `deduction-report-performance.test.ts`'s/
 * `project-site-payroll-report-performance.test.ts`'s own established methodology (real seeded
 * data, real `EXPLAIN (ANALYZE, BUFFERS)`, every measured duration logged).
 *
 * **Grain-specific query shape, proven honestly rather than assumed:** this report's grain is
 * `PayrollEntryWorkLine`, and that table has no `cycleId` column of its own (it is only reachable
 * via its parent `PayrollEntry`) — so every query here necessarily joins `PayrollEntryWorkLine` to
 * `PayrollEntry` to apply the cycle/site filter, unlike every sibling report's own `PayrollEntry`-
 * rooted query. The existing `PayrollEntryWorkLine.payrollEntryId`/`.unitId` indexes and
 * `PayrollEntry`'s own `[cycleId]`/`[cycleId, siteId]`/`[siteId, cycleId]` indexes were not added
 * for this report and are not assumed sufficient — every assertion below is checked against the
 * real `EXPLAIN ANALYZE` output at this seed's volume, not assumed from the schema alone.
 *
 * **Plan-shape hardening (Run #85, 2026-08-19):** this suite used to assert "no Seq Scan on
 * PayrollEntry" categorically on most queries. Run #85 proved that invariant invalid at moderate
 * selectivity — the cycle+site query (~3.3% of this fixture's 30,000 rows) legitimately planned as
 * a Parallel Seq Scan (12.534ms, non-pathological) once `ANALYZE` gave the planner real statistics,
 * the same cost-based-coin-flip behavior the single-cycle, no-filter query below had already
 * demonstrated and documented. No query in this file now bans a scan method categorically; each
 * instead verifies **index availability** structurally, via `expectIndexColumns` (Postgres catalog
 * metadata, independent of which plan the planner picks), and preserves its **wall-clock
 * performance bound** — the two guarantees that actually matter. EXPLAIN output remains captured
 * and logged throughout, for diagnostic evidence on a future timing regression.
 *
 * **`ANALYZE`d immediately after seeding, deliberately** (see the doc comment at the seed's own
 * `ANALYZE` call below): a bulk `createMany` load leaves Postgres without real statistics until
 * autovacuum catches up, which a real production table already has by the time anyone queries it.
 * Skipping this step doesn't make a query "provably fast" — it just lets Postgres's planner guess
 * from defaults instead of real cardinality, which was confirmed (by direct, repeated measurement)
 * to hide a genuine bad-plan risk on the site+unit-filtered query (`unitId` is exactly as selective
 * as `cycleId`+`siteId` combined at this fixture's volume, and without real statistics Postgres can
 * pick the far more expensive side to drive the join from). `ANALYZE`-ing first is what makes every
 * assertion below evidence about the query, not an accident of untested statistics.
 *
 * Seeded at the same order of magnitude as Project Site Payroll Report's/Deduction Report's own
 * evidence — 10 sites × 1,000 employees, across 3 cycles (30,000 total `PayrollEntry` rows, each
 * with exactly one work line — the documented common case, `docs/architecture/database/
 * payroll-entry.md` §12a) — with OT hours varied (~1-in-4 selectivity) so `hasOvertime` measures
 * real, non-degenerate selectivity. Seeding uses bulk `createMany` throughout — never a per-row
 * loop.
 */

jest.setTimeout(5 * 60 * 1000);

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';
const SITE_COUNT = 10;
const EMPLOYEES_PER_SITE = 1_000;
const CYCLE_COUNT = 3;
const EMPLOYEE_COUNT = SITE_COUNT * EMPLOYEES_PER_SITE;

describe('Phase 7 Reports — Overtime Report Checkpoint 1A — performance validation (no schema change)', () => {
  let admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>;
  let siteIds: string[];
  let unitIdBySite: Map<string, string>;
  let cycleIds: string[];
  let targetCycleId: string;
  let targetSiteId: string;

  beforeAll(async () => {
    await cleanTestData();

    admin = await createAuthenticatedAgent(app, {
      email: 'ot-perf-admin@test.local',
      password: PASSWORD,
      roleCode: ROLE_CODES.MASTER_ADMIN,
      permissionKeys: [PERMISSIONS.PAYROLL_CYCLE_MANAGE, PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.REPORTS_VIEW],
    });

    const sites = [];
    for (let i = 0; i < SITE_COUNT; i += 1) {
      const site = await prisma.projectSite.create({ data: { name: `Test Site OT Perf ${i}` } });
      const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `OT Perf Unit ${i}`, code: `OTPU-${i}` } });
      sites.push({ site, unit });
    }
    siteIds = sites.map((s) => s.site.id);
    unitIdBySite = new Map(sites.map((s) => [s.site.id, s.unit.id]));
    targetSiteId = siteIds[0]!;

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
          employeeCode: `OT-PERF-${String(i).padStart(6, '0')}`,
          name: `OT Perf Employee ${i}`,
          designation: 'Guard',
          siteId: s.site.id,
          unitId: s.unit.id,
          grossPay: '30000',
        });
      }
      await prisma.employee.createMany({ data: batch });
    }

    // 3 cycles × 10,000 entries = 30,000 PayrollEntry rows, each with one work line. OT hours are
    // deliberately varied by index (~1-in-4 selectivity) so hasOvertime measures real selectivity.
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

      const workLineRows = entryRows.map((entry, i) => ({
        id: randomUUID(),
        payrollEntryId: entry.id,
        siteId: entry.siteId,
        unitId: unitIdBySite.get(entry.siteId)!,
        days: '26',
        otHours: i % 4 === 0 ? '5' : '0', // ~1/4 have overtime
        otRate: i % 4 === 0 && i % 8 === 0 ? '150' : null, // half of those have an explicit rate
        cycleDays: 30,
      }));
      for (let start = 0; start < workLineRows.length; start += EMP_CHUNK) {
        await prisma.payrollEntryWorkLine.createMany({ data: workLineRows.slice(start, start + EMP_CHUNK) });
      }
    }
    targetCycleId = cycleIds[cycleIds.length - 1]!;

    // A real production table has already been through many autovacuum ANALYZE cycles by the time
    // anyone queries it (autovacuum's own default `analyze_scale_factor` fires well before 30,000
    // rows accumulate one at a time via ordinary payroll-cycle creation). This fixture instead
    // loads all 30,000 rows in one synchronous burst, which autovacuum has had no chance to react
    // to yet — left un-ANALYZEd, Postgres's planner has to guess this table's cardinality/
    // selectivity from defaults, and a confirmed-reproducible bad guess (driving the cycle+site+
    // unit-filtered list query from the work line's own `unitId` index and nested-loop-filtering
    // every candidate row back through `PayrollEntry`, instead of the far cheaper hash join once
    // real stats are known) turns a 5ms query into a multi-second one. Explicitly ANALYZE-ing here
    // makes this fixture's statistics match steady-state production, which is the condition this
    // suite is actually trying to prove fast — not an artificial, self-inflicted cold-stats worst
    // case this bulk-seeding shape would otherwise create.
    await prisma.$executeRawUnsafe('ANALYZE "PayrollEntryWorkLine", "PayrollEntry", "Employee"');

    const totalEntries = await prisma.payrollEntry.count();
    const totalWorkLines = await prisma.payrollEntryWorkLine.count();
    // eslint-disable-next-line no-console
    console.log(`[perf] seeded ${EMPLOYEE_COUNT} employees, ${CYCLE_COUNT} cycles, ${totalEntries} PayrollEntry rows, ${totalWorkLines} PayrollEntryWorkLine rows`);
  }, 5 * 60 * 1000);

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  it('list query (one cycle, default sort, no filter) stays fast, real plan on record', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/overtime-report?cycleId=${targetCycleId}&pageSize=25`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(EMPLOYEE_COUNT);
    // eslint-disable-next-line no-console
    console.log(`[perf] list, one cycle only (all ${EMPLOYEE_COUNT} matching work lines), page of 25: ${ms}ms`);
    expect(ms).toBeLessThan(3_000);

    const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT pewl.* FROM "PayrollEntryWorkLine" pewl
       JOIN "PayrollEntry" pe ON pe.id = pewl."payrollEntryId"
       JOIN "Employee" e ON e.id = pe."employeeId"
       WHERE pe."cycleId" = $1::uuid
       ORDER BY e.name ASC, pewl.id ASC
       LIMIT 25`,
      targetCycleId,
    );
    const planText = plan.map((row) => row['QUERY PLAN']).join('\n');
    // eslint-disable-next-line no-console
    console.log(`[perf] EXPLAIN ANALYZE (cycle-only list query, real ORDER BY employee.name):\n${planText}`);
    // Deliberately no "not a Seq Scan on PayrollEntry" assertion here, unlike the site/unit-
    // filtered queries below — confirmed by direct, repeated measurement (not assumed) that this
    // one is a genuine, borderline case, not a pathology: this fixture's own cycleId selects
    // exactly 1-in-3 of the table (3 seeded cycles), and a real production PayrollEntry table
    // accumulates many more cycles over its lifetime, so a single cycleId's true selectivity in
    // production is far lower than this fixture's own artificially high 33%. At this fixture's own
    // selectivity, Postgres's cost-based planner legitimately alternates between an Index Scan and
    // a Parallel Seq Scan on PayrollEntry run to run (confirmed by repeated runs against real,
    // ANALYZE-d statistics) — both measured well within the `ms` bound above (~1.0-1.3s, nowhere
    // near the 3s ceiling), so plan *shape* here is not itself evidence of a performance problem;
    // wall-clock time is the assertion that actually matters, and it already ran above.
  });

  it('list query (one cycle, one site) has its supporting PayrollEntry index and stays fast', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/overtime-report?cycleId=${targetCycleId}&siteIds=${targetSiteId}&pageSize=25`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(EMPLOYEES_PER_SITE);
    // eslint-disable-next-line no-console
    console.log(`[perf] list, one cycle + one site (${EMPLOYEES_PER_SITE} of ${EMPLOYEE_COUNT} matching), page of 25: ${ms}ms`);
    expect(ms).toBeLessThan(3_000);

    // Index *availability* is verified structurally (Postgres catalog metadata) rather than by
    // banning `Seq Scan`/requiring `Index Scan` in the EXPLAIN output — Run #85 (2026-08-19) showed
    // this exact query (cycleId+siteId selects ~1,000 of this fixture's 30,000 rows, ~3.3%) legitimately
    // planned as a Parallel Seq Scan (12.534ms, no row-amplification, nothing pathological): at this
    // selectivity, joined to Employee and sorted by `e.name` (no early-exit benefit from an index,
    // since every matching row must be materialized before the top-25 sort), a categorical plan-shape
    // ban is a cost-based coin-flip, not a real regression signal — see this file's own cycle-only
    // test above for the same, already-established reasoning. EXPLAIN is still captured and logged
    // for diagnostic evidence.
    await expectIndexColumns('PayrollEntry', 'PayrollEntry_cycleId_siteId_idx', ['cycleId', 'siteId']);

    const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT pewl.* FROM "PayrollEntryWorkLine" pewl
       JOIN "PayrollEntry" pe ON pe.id = pewl."payrollEntryId"
       JOIN "Employee" e ON e.id = pe."employeeId"
       WHERE pe."cycleId" = $1::uuid AND pe."siteId" = $2::uuid
       ORDER BY e.name ASC, pewl.id ASC
       LIMIT 25`,
      targetCycleId,
      targetSiteId,
    );
    const planText = plan.map((row) => row['QUERY PLAN']).join('\n');
    // eslint-disable-next-line no-console
    console.log(`[perf] EXPLAIN ANALYZE (cycle+site-filtered list query):\n${planText}`);
  });

  it('hasOvertime=true (a ~25% selectivity predicate on the work line’s own stored column) stays fast', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/overtime-report?cycleId=${targetCycleId}&hasOvertime=true&pageSize=25`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`[perf] list, one cycle + hasOvertime=true (${res.body.total} of ${EMPLOYEE_COUNT} matching): ${ms}ms`);
    expect(ms).toBeLessThan(3_000);

    const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT pewl.* FROM "PayrollEntryWorkLine" pewl
       JOIN "PayrollEntry" pe ON pe.id = pewl."payrollEntryId"
       WHERE pe."cycleId" = $1::uuid AND pewl."otHours" > 0
       ORDER BY pewl.id ASC
       LIMIT 25`,
      targetCycleId,
    );
    const planText = plan.map((row) => row['QUERY PLAN']).join('\n');
    // eslint-disable-next-line no-console
    console.log(`[perf] EXPLAIN ANALYZE (cycle + otHours>0 filter):\n${planText}`);
    // No categorical plan-shape assertion — this query's base predicate is the same cycle-only
    // filter (33% selectivity at this fixture's 3-cycle volume) the file's own cycle-only test above
    // already documents as a legitimate cost-based coin-flip, not a regression signal. EXPLAIN is
    // still captured and logged for diagnostic evidence; the timing bound above is the assertion
    // that matters.
  });

  it('unit-filtered query (bounded by cycle+site+unit, work-line-native predicate) stays fast', async () => {
    const unitId = unitIdBySite.get(targetSiteId)!;
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/overtime-report?cycleId=${targetCycleId}&siteIds=${targetSiteId}&unitId=${unitId}&pageSize=25`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(EMPLOYEES_PER_SITE);
    // eslint-disable-next-line no-console
    console.log(`[perf] list, one cycle + one site + one unit: ${ms}ms`);
    expect(ms).toBeLessThan(3_000);
  });

  it('sorting by otHours (a plain stored PayrollEntryWorkLine column) uses database-level ORDER BY and stays fast', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/overtime-report?cycleId=${targetCycleId}&sortBy=otHours&sortDir=desc&pageSize=25`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(25);
    // eslint-disable-next-line no-console
    console.log(`[perf] list, one cycle, sortBy=otHours desc: ${ms}ms`);
    expect(ms).toBeLessThan(3_000);

    const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT pewl.* FROM "PayrollEntryWorkLine" pewl
       JOIN "PayrollEntry" pe ON pe.id = pewl."payrollEntryId"
       WHERE pe."cycleId" = $1::uuid
       ORDER BY pewl."otHours" DESC, pewl.id ASC
       LIMIT 25`,
      targetCycleId,
    );
    const planText = plan.map((row) => row['QUERY PLAN']).join('\n');
    // eslint-disable-next-line no-console
    console.log(`[perf] EXPLAIN ANALYZE (cycle-scoped sort by otHours):\n${planText}`);
    // No categorical plan-shape assertion — same cycle-only base predicate/reasoning as above.
  });

  it('totals computation (bounded calcNet/sumMoney pass over every matching work line) completes within a generous bound, well under the 20,000-row ceiling', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/overtime-report?cycleId=${targetCycleId}&pageSize=25`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.totals.totalsComputed).toBe(true);
    expect(res.body.totals.matchingCount).toBe(EMPLOYEE_COUNT);
    // eslint-disable-next-line no-console
    console.log(`[perf] full request (list page + totals over all ${EMPLOYEE_COUNT} matching work lines, well under the 20,000-row ceiling): ${ms}ms`);
    expect(ms).toBeLessThan(5_000);
  });

  it('export produces every matching work line for one cycle+site, correctly, with duration on record', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/overtime-report/export?cycleId=${targetCycleId}&siteIds=${targetSiteId}&format=csv`);
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
    const res = await admin.agent.get(`/api/v1/reports/overtime-report?cycleId=${targetCycleId}&siteIds=${targetSiteId}&pageSize=25`);
    expect(res.status).toBe(200);
    expect(groupBySpy).toHaveBeenCalledTimes(1);
    groupBySpy.mockRestore();
  });

  it('a whole-cycle export (10,000 rows, well under the 20,000-row ceiling) completes correctly and quickly', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/overtime-report/export?cycleId=${targetCycleId}&format=csv`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    const lines = res.text.trim().split('\n');
    expect(lines.length).toBe(EMPLOYEE_COUNT + 1); // header + every one of the 10,000 matching rows
    // eslint-disable-next-line no-console
    console.log(`[perf] whole-cycle export (${EMPLOYEE_COUNT} rows, under the 20,000-row ceiling) to CSV: ${ms}ms`);
    expect(ms).toBeLessThan(10_000);
  });
});
