import { randomUUID } from 'node:crypto';
import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

/**
 * Phase 7 Reports, Salary Release Report Checkpoint 1A — committed, repeatable performance
 * validation (frozen decision: "no migration expected... prove this with EXPLAIN ANALYZE"),
 * mirroring `deduction-report-performance.test.ts`'s/`project-site-payroll-report-performance.test.ts`'s
 * own established methodology (real seeded data, real `EXPLAIN (ANALYZE, BUFFERS)`, assertions that
 * no `Seq Scan` occurs on `PayrollEntry` in the measured shapes, every measured duration logged)
 * rather than an ad hoc, uncommitted script.
 *
 * Seeded at the same order of magnitude as every sibling report's own evidence — 10 sites × 1,000
 * employees, across 3 cycles (30,000 total `PayrollEntry` rows) — with the target cycle's own
 * population deliberately varied across every release-state bucket (RELEASED/PENDING/HELD/
 * NO_PAY_DUE/RECOVERY_DUE), a subset of multi-Unit employees, and a subset carrying an approved
 * Correction, so every measured query shape exercises real, non-degenerate selectivity rather than
 * an all-one-status fixture. Seeding uses bulk `createMany` throughout — never a per-row loop.
 */

jest.setTimeout(5 * 60 * 1000);

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';
const SITE_COUNT = 10;
const EMPLOYEES_PER_SITE = 1_000;
const CYCLE_COUNT = 3;
const EMPLOYEE_COUNT = SITE_COUNT * EMPLOYEES_PER_SITE;

describe('Phase 7 Reports — Salary Release Report Checkpoint 1A — performance validation (no schema change)', () => {
  let admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>;
  let siteIds: string[];
  let unitIdBySite: Map<string, string>;
  let cycleIds: string[];
  let targetCycleId: string;
  let targetSiteId: string;
  let targetUnitId: string;

  beforeAll(async () => {
    await cleanTestData();

    admin = await createAuthenticatedAgent(app, {
      email: 'srr-perf-admin@test.local',
      password: PASSWORD,
      roleCode: ROLE_CODES.MASTER_ADMIN,
      permissionKeys: [PERMISSIONS.PAYROLL_CYCLE_MANAGE, PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.REPORTS_VIEW],
    });

    const sites = [];
    for (let i = 0; i < SITE_COUNT; i += 1) {
      const site = await prisma.projectSite.create({ data: { name: `Test Site SRR Perf ${i}` } });
      const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `SRR Perf Unit ${i}`, code: `SRRPU-${i}` } });
      sites.push({ site, unit });
    }
    siteIds = sites.map((s) => s.site.id);
    unitIdBySite = new Map(sites.map((s) => [s.site.id, s.unit.id]));
    targetSiteId = siteIds[0]!;
    targetUnitId = unitIdBySite.get(targetSiteId)!;

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
          employeeCode: `SRR-PERF-${String(i).padStart(6, '0')}`,
          name: `SRR Perf Employee ${i}`,
          designation: 'Guard',
          siteId: s.site.id,
          unitId: s.unit.id,
          grossPay: '30000',
        });
      }
      await prisma.employee.createMany({ data: batch });
    }

    // 3 cycles × 10,000 entries = 30,000 PayrollEntry rows. Release-state distribution by index
    // (mod 10), deliberately mixed rather than flat: 40% RELEASED, 30% PENDING, 10% HELD, 10%
    // NO_PAY_DUE, 10% RECOVERY_DUE — mutually exclusive per the schema's own CHECK constraint
    // (`payoutOutcome IS NULL OR released = false`).
    cycleIds = [];
    for (let c = 0; c < CYCLE_COUNT; c += 1) {
      const cycle = await prisma.payrollCycle.create({ data: { year: 2900 + c, month: 1, createdBy: admin.userId, status: 'DRAFT' } });
      cycleIds.push(cycle.id);

      const entryRows = employeeIds.map(({ id, siteId }, i) => {
        const bucket = i % 10;
        const released = bucket <= 3;
        const hold = bucket === 7;
        const payoutOutcome: 'NO_PAY_DUE' | 'RECOVERY_DUE' | null = bucket === 8 ? 'NO_PAY_DUE' : bucket === 9 ? 'RECOVERY_DUE' : null;
        return {
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
          hold,
          released,
          releasedAt: released ? new Date(2026, 0, 1 + (i % 28)) : null,
          releasedBy: released ? admin.userId : null,
          payoutOutcome,
        };
      });
      const cleanRows = entryRows;
      for (let start = 0; start < cleanRows.length; start += EMP_CHUNK) {
        await prisma.payrollEntry.createMany({ data: cleanRows.slice(start, start + EMP_CHUNK) });
      }

      const workLineRows = cleanRows.map((entry) => ({
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

      // A ~1-in-50 subset of this cycle's entries also touches a second Unit at the same Site
      // (a genuine multi-Unit employee) — exercises the Unit-filter join shape without dominating
      // the fixture. Only wired for the LAST cycle (the one every test below targets) to keep
      // seeding time bounded — `c === CYCLE_COUNT - 1`, not a `cycleIds[cycleIds.length - 1]`
      // comparison (which is trivially true on every iteration immediately after its own push).
      if (c === CYCLE_COUNT - 1) {
        const secondUnit = await prisma.projectUnit.create({ data: { siteId: targetSiteId, name: `SRR Perf Second Unit`, code: 'SRRPU-2ND' } });
        const targetSiteRows = cleanRows.filter((row, i) => row.siteId === targetSiteId && i % 50 === 0);
        const secondLineRows = targetSiteRows.map((row) => ({
          id: randomUUID(),
          payrollEntryId: row.id,
          siteId: targetSiteId,
          unitId: secondUnit.id,
          days: '4',
          otHours: '0',
          cycleDays: 30,
          sortOrder: 1,
        }));
        if (secondLineRows.length > 0) {
          await prisma.payrollEntryWorkLine.createMany({ data: secondLineRows });
        }

        // A ~1-in-100 subset carries an approved Correction, exercising the Has Correction filter
        // and the batched correction-count lookup at real volume. `TEST_`-prefixed code, matching
        // `cleanTestData()`'s own `adjustmentType.deleteMany({ where: { code: { startsWith: 'TEST_' } } })`
        // scope, so this fixture never survives past this suite's own `afterAll`.
        const adjustmentType = await prisma.adjustmentType.create({ data: { code: 'TEST_SRR_PERF_CORR', label: 'SRR Perf Correction' } });
        const correctedRows = cleanRows.filter((row, i) => row.siteId === targetSiteId && i % 100 === 0);
        await prisma.correction.createMany({
          data: correctedRows.map((row) => ({
            id: randomUUID(),
            payrollEntryId: row.id,
            field: 'FINE',
            oldValue: '0',
            newValue: '100',
            oldNetSalary: '29600',
            newNetSalary: '29500',
            adjustmentTypeId: adjustmentType.id,
            reason: 'Perf fixture correction',
            approvedById: admin.userId,
          })),
        });
      }
    }
    targetCycleId = cycleIds[cycleIds.length - 1]!;

    // Deterministic planner statistics after this fixture's bulk `createMany` burst (same
    // precedent as `advance-recovery-report-performance.test.ts`/`overtime-report-performance
    // .test.ts`) — including `Correction`, which the Has Correction filter/batched lookup queries
    // directly (`prisma.correction.groupBy`), not just fixture noise.
    await prisma.$executeRawUnsafe('ANALYZE "Employee", "PayrollEntry", "PayrollEntryWorkLine", "Correction"');

    const totalEntries = await prisma.payrollEntry.count();
    // eslint-disable-next-line no-console
    console.log(`[perf] seeded ${EMPLOYEE_COUNT} employees, ${CYCLE_COUNT} cycles, ${totalEntries} total PayrollEntry rows`);
  }, 5 * 60 * 1000);

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  it('1. list query (one cycle, default sort, no filter) uses an index, not a sequential scan', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/salary-release?cycleId=${targetCycleId}&pageSize=25`);
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

  it('2. list query (one cycle, one site) uses an index', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/salary-release?cycleId=${targetCycleId}&siteIds=${targetSiteId}&pageSize=25`);
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
    // Honest finding, not asserted as one specific scan sub-type: a legitimate, cost-based planner
    // may choose an Index Scan, Index Only Scan, or Bitmap Index Scan on any composite/single-column
    // index covering (cycleId, siteId) at this data volume — every sibling report's own evidence
    // shows this varies by fixture distribution, never a missing-index defect.
    expect(planText).toMatch(/(Index Scan|Index Only Scan|Bitmap Index Scan).*"PayrollEntry_/);

    expect(ms).toBeLessThan(3_000);
  });

  it('3. list query (one cycle, one site, one unit — join through PayrollEntryWorkLine) stays fast', async () => {
    const start = Date.now();
    const res = await admin.agent.get(
      `/api/v1/reports/salary-release?cycleId=${targetCycleId}&siteIds=${targetSiteId}&unitId=${targetUnitId}&pageSize=25`,
    );
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`[perf] list, one cycle + one site + one unit (work-line join, bounded candidate set, ${res.body.total} matching): ${ms}ms`);
    expect(ms).toBeLessThan(3_000);
  });

  it('4. RELEASED row-status filter (~40% selectivity) stays fast and uses an index', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/salary-release?cycleId=${targetCycleId}&rowStatus=RELEASED&pageSize=25`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`[perf] list, one cycle + rowStatus=RELEASED (${res.body.total} of ${EMPLOYEE_COUNT} matching): ${ms}ms`);

    // Captured before the timing assertion below so a threshold failure still leaves the query
    // plan on record.
    const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT pe.* FROM "PayrollEntry" pe
       WHERE pe."cycleId" = $1::uuid AND pe."released" = true
       ORDER BY pe.id ASC
       LIMIT 25`,
      targetCycleId,
    );
    const planText = plan.map((row) => row['QUERY PLAN']).join('\n');
    // eslint-disable-next-line no-console
    console.log(`[perf] EXPLAIN ANALYZE (cycle + released=true filter):\n${planText}`);
    expect(planText).not.toMatch(/Seq Scan on "PayrollEntry"/);

    expect(ms).toBeLessThan(3_000);
  });

  it('5. HELD row-status filter (~10% selectivity) stays fast', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/salary-release?cycleId=${targetCycleId}&rowStatus=HELD&pageSize=25`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`[perf] list, one cycle + rowStatus=HELD (${res.body.total} of ${EMPLOYEE_COUNT} matching): ${ms}ms`);
    expect(ms).toBeLessThan(3_000);
  });

  it('6. PENDING row-status filter (~30% selectivity) stays fast and uses an index', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/salary-release?cycleId=${targetCycleId}&rowStatus=PENDING&pageSize=25`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`[perf] list, one cycle + rowStatus=PENDING (${res.body.total} of ${EMPLOYEE_COUNT} matching): ${ms}ms`);

    // Captured before the timing assertion below so a threshold failure still leaves the query
    // plan on record.
    const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT pe.* FROM "PayrollEntry" pe
       WHERE pe."cycleId" = $1::uuid AND pe."released" = false AND pe."hold" = false AND pe."payoutOutcome" IS NULL
       ORDER BY pe.id ASC
       LIMIT 25`,
      targetCycleId,
    );
    const planText = plan.map((row) => row['QUERY PLAN']).join('\n');
    // eslint-disable-next-line no-console
    console.log(`[perf] EXPLAIN ANALYZE (cycle + PENDING filter):\n${planText}`);
    expect(planText).not.toMatch(/Seq Scan on "PayrollEntry"/);

    expect(ms).toBeLessThan(3_000);
  });

  it('7. sorting by releasedAt (the one genuine DB-native, non-stored-elsewhere sort field) uses database-level ORDER BY and stays fast', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/salary-release?cycleId=${targetCycleId}&sortBy=releasedAt&sortDir=desc&pageSize=25`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(25);
    // eslint-disable-next-line no-console
    console.log(`[perf] list, one cycle, sortBy=releasedAt desc: ${ms}ms`);

    // Captured before the timing assertion below so a threshold failure still leaves the query
    // plan on record.
    const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT pe.* FROM "PayrollEntry" pe
       WHERE pe."cycleId" = $1::uuid
       ORDER BY pe."releasedAt" DESC, pe.id ASC
       LIMIT 25`,
      targetCycleId,
    );
    const planText = plan.map((row) => row['QUERY PLAN']).join('\n');
    // eslint-disable-next-line no-console
    console.log(`[perf] EXPLAIN ANALYZE (cycle-scoped sort by releasedAt):\n${planText}`);
    expect(planText).not.toMatch(/Seq Scan on "PayrollEntry"/);

    expect(ms).toBeLessThan(3_000);
  });

  it('8a. totals computation (bounded calcNet/sumMoney pass over every matching row) completes within a generous bound for a full-cycle result, well under the 20,000-row ceiling', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/salary-release?cycleId=${targetCycleId}&pageSize=25`);
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

  it('8b. export produces every matching row for one cycle+site, correctly, with duration on record (preflight-COUNT/export-size shape)', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/salary-release/export?cycleId=${targetCycleId}&siteIds=${targetSiteId}&format=csv`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    const lines = res.text.trim().split('\n');
    expect(lines.length).toBe(EMPLOYEES_PER_SITE + 1); // header + every row for this site
    // eslint-disable-next-line no-console
    console.log(`[perf] export of ${EMPLOYEES_PER_SITE} rows (one cycle + one site) to CSV: ${ms}ms`);
    expect(ms).toBeLessThan(5_000);
  });

  it('a whole-cycle export (10,000 rows, well under the 20,000-row ceiling) completes correctly and quickly', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/salary-release/export?cycleId=${targetCycleId}&format=csv`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    const lines = res.text.trim().split('\n');
    expect(lines.length).toBe(EMPLOYEE_COUNT + 1); // header + every one of the 10,000 matching rows
    // eslint-disable-next-line no-console
    console.log(`[perf] whole-cycle export (${EMPLOYEE_COUNT} rows, under the 20,000-row ceiling) to CSV: ${ms}ms`);
    expect(ms).toBeLessThan(10_000);
  });

  it('correction-count lookup stays a single batched query regardless of row count (no per-row N+1)', async () => {
    const groupBySpy = jest.spyOn(prisma.correction, 'groupBy');
    const res = await admin.agent.get(`/api/v1/reports/salary-release?cycleId=${targetCycleId}&siteIds=${targetSiteId}&pageSize=25`);
    expect(res.status).toBe(200);
    expect(groupBySpy).toHaveBeenCalledTimes(1);
    groupBySpy.mockRestore();
  });

  it('Has Correction filter (~1% selectivity subset) stays fast', async () => {
    const start = Date.now();
    const res = await admin.agent.get(
      `/api/v1/reports/salary-release?cycleId=${targetCycleId}&siteIds=${targetSiteId}&hasCorrection=true&pageSize=25`,
    );
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`[perf] list, one cycle + one site + hasCorrection=true (${res.body.total} matching): ${ms}ms`);
    expect(ms).toBeLessThan(3_000);
  });
});
