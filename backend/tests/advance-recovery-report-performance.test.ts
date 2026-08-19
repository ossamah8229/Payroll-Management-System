import { randomUUID } from 'node:crypto';
import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

/**
 * Phase 7 Reports, Advance Recovery Report Checkpoint 1A — committed, repeatable performance
 * validation (frozen decision — Performance/Index Evidence section: "no migration expected...
 * prove this with EXPLAIN ANALYZE"), mirroring `deduction-report-performance.test.ts`'s own
 * established methodology (real seeded data, real `EXPLAIN (ANALYZE, BUFFERS)`, every measured
 * duration logged, assertions scoped to what the evidence actually shows) rather than an ad hoc,
 * uncommitted script.
 *
 * Seeded at the design-floor population named in the authorizing instruction — 10 sites × 1,000
 * employees (10,000 employees) — with every employee getting a LOAN Advance (varied status/
 * outstanding balance) and roughly half also getting an EID_ADVANCE, across a multi-year
 * `dateGiven` spread, for ~15,000 total Advance rows. Two Payroll Cycles carry real recovery
 * history (`PayrollEntry.advanceId`/`.eidAdvanceId`) for a subset of Advances, so the selected-
 * Cycle recovery-context shape (aggregate §7) and the detail recovery-history lookup (§8) both
 * measure a real, non-trivial join, not a degenerate empty case. Seeding uses bulk `createMany`
 * throughout — never a per-row loop.
 *
 * **On index assertions**: `Advance` itself carries only `@@index([employeeId])` and
 * `@@index([currentScheduledPeriodId])` — no index on `type`/`status`, and no `siteId` column at
 * all (site scoping always joins through `Employee.siteId`, which does have its own
 * `@@index([siteId])`). This file asserts "not a sequential scan" only for the two shapes with a
 * genuine supporting index chain (employee-filtered via `Advance_employeeId_idx`, and the detail
 * lookup via `PayrollEntry_advanceId_idx`/`PayrollEntry_eidAdvanceId_idx`/
 * `AdvanceScheduleChange_advanceId_changedAt_idx`) — every other shape's actual planner behavior is
 * measured and logged honestly, per the frozen instruction's own "do not assert a specific index
 * when Postgres legitimately chooses a sequential scan" rule. No migration is proposed by this
 * file — see the Checkpoint 1A report's own §16/§18 write-up for the full evidence-based reasoning.
 */

jest.setTimeout(5 * 60 * 1000);

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';
const SITE_COUNT = 10;
const EMPLOYEES_PER_SITE = 1_000;
const EMPLOYEE_COUNT = SITE_COUNT * EMPLOYEES_PER_SITE;

describe('Phase 7 Reports — Advance Recovery Report Checkpoint 1A — performance validation (no schema change)', () => {
  let admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>;
  let siteIds: string[];
  let targetSiteId: string;
  let targetEmployeeId: string;
  let cycleAId: string;
  let cycleBId: string;
  let advanceWithHistoryId: string;

  beforeAll(async () => {
    await cleanTestData();

    admin = await createAuthenticatedAgent(app, {
      email: 'arr-perf-admin@test.local',
      password: PASSWORD,
      roleCode: ROLE_CODES.MASTER_ADMIN,
      permissionKeys: [PERMISSIONS.REPORTS_VIEW, PERMISSIONS.PAYROLL_CYCLE_MANAGE],
    });

    const sites = [];
    for (let i = 0; i < SITE_COUNT; i += 1) {
      const site = await prisma.projectSite.create({ data: { name: `Test Site ARR Perf ${i}` } });
      const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `ARR Perf Unit ${i}`, code: `ARRPU-${i}` } });
      sites.push({ site, unit });
    }
    siteIds = sites.map((s) => s.site.id);
    targetSiteId = siteIds[0]!;

    const EMP_CHUNK = 1000;
    const employeeIds: { id: string; siteId: string }[] = [];
    for (let start = 0; start < EMPLOYEE_COUNT; start += EMP_CHUNK) {
      const batch = [];
      for (let i = start; i < Math.min(start + EMP_CHUNK, EMPLOYEE_COUNT); i += 1) {
        const s = sites[i % SITE_COUNT]!;
        const id = randomUUID();
        employeeIds.push({ id, siteId: s.site.id });
        batch.push({
          id,
          employeeCode: `ARR-PERF-${String(i).padStart(6, '0')}`,
          name: `ARR Perf Employee ${i}`,
          designation: 'Guard',
          siteId: s.site.id,
          unitId: s.unit.id,
          grossPay: '30000',
        });
      }
      await prisma.employee.createMany({ data: batch });
    }
    targetEmployeeId = employeeIds[0]!.id;

    // Every employee gets a LOAN Advance; status/outstanding balance vary by index so the
    // status/hasOutstandingBalance filter shapes measure real, non-degenerate selectivity.
    // Roughly half also get an EID_ADVANCE — a multi-year dateGiven spread (2020-2026).
    const STATUS_CYCLE: Array<'ACTIVE' | 'PAID_OFF' | 'CANCELLED'> = ['ACTIVE', 'PAID_OFF', 'CANCELLED'];
    const advanceRows: {
      id: string;
      employeeId: string;
      type: 'LOAN' | 'EID_ADVANCE';
      totalAmount: string;
      outstandingBalance: string;
      status: 'ACTIVE' | 'PAID_OFF' | 'CANCELLED';
      dateGiven: Date;
    }[] = [];
    employeeIds.forEach(({ id }, i) => {
      const status = STATUS_CYCLE[i % 3]!;
      const outstanding = status === 'ACTIVE' ? '6000' : '0';
      const year = 2020 + (i % 6);
      advanceRows.push({
        id: randomUUID(),
        employeeId: id,
        type: 'LOAN',
        totalAmount: '10000',
        outstandingBalance: outstanding,
        status,
        dateGiven: new Date(Date.UTC(year, i % 12, 1)),
      });
      if (i % 2 === 0) {
        const eidStatus = STATUS_CYCLE[(i + 1) % 3]!;
        advanceRows.push({
          id: randomUUID(),
          employeeId: id,
          type: 'EID_ADVANCE',
          totalAmount: '4000',
          outstandingBalance: eidStatus === 'ACTIVE' ? '1500' : '0',
          status: eidStatus,
          dateGiven: new Date(Date.UTC(year, (i + 3) % 12, 1)),
        });
      }
    });
    for (let start = 0; start < advanceRows.length; start += EMP_CHUNK) {
      await prisma.advance.createMany({
        data: advanceRows.slice(start, start + EMP_CHUNK).map((row) => ({ ...row, repaymentType: 'FULL_DEDUCTION' as const })),
      });
    }
    advanceWithHistoryId = advanceRows[0]!.id;

    const cycleA = await prisma.payrollCycle.create({ data: { year: 2900, month: 1, createdBy: admin.userId, status: 'DRAFT' } });
    const cycleB = await prisma.payrollCycle.create({ data: { year: 2900, month: 2, createdBy: admin.userId, status: 'DRAFT' } });
    cycleAId = cycleA.id;
    cycleBId = cycleB.id;

    // Recovery history: every 4th LOAN Advance gets one linked PayrollEntry in Cycle A, and the
    // very first Advance additionally gets a second one in Cycle B (so the detail lookup measures
    // a real multi-row join, not just a single row).
    const loanAdvances = advanceRows.filter((a) => a.type === 'LOAN');
    const entryRowsA = loanAdvances
      .filter((_, i) => i % 4 === 0)
      .map((advance) => ({
        id: randomUUID(),
        cycleId: cycleAId,
        employeeId: advance.employeeId,
        siteId: employeeIds.find((e) => e.id === advance.employeeId)!.siteId,
        designation: 'Guard',
        grossPay: '30000',
        allowance: '0',
        leaveDays: '0',
        eobiAmount: '400',
        eobiApplicable: true,
        advanceDeduction: '1000',
        advanceId: advance.id,
      }));
    for (let start = 0; start < entryRowsA.length; start += EMP_CHUNK) {
      await prisma.payrollEntry.createMany({ data: entryRowsA.slice(start, start + EMP_CHUNK) });
    }
    await prisma.payrollEntry.create({
      data: {
        cycleId: cycleBId,
        employeeId: loanAdvances[0]!.employeeId,
        siteId: employeeIds.find((e) => e.id === loanAdvances[0]!.employeeId)!.siteId,
        designation: 'Guard',
        grossPay: '30000',
        allowance: '0',
        leaveDays: '0',
        eobiAmount: '400',
        eobiApplicable: true,
        advanceDeduction: '1000',
        advanceId: loanAdvances[0]!.id,
      },
    });

    // ANALYZE-d immediately after seeding, deliberately (mirroring `overtime-report-performance
    // .test.ts`'s own precedent) — a bulk `createMany` load leaves Postgres without real statistics
    // until autovacuum catches up, which a real production table already has by the time anyone
    // queries it. Without this, the planner guesses cardinality from defaults instead of real
    // statistics, which was confirmed (by direct, repeated measurement) to produce a pathological
    // plan under full-suite conditions.
    await prisma.$executeRawUnsafe('ANALYZE "Advance", "PayrollEntry", "Employee"');

    const totalAdvances = await prisma.advance.count();
    // eslint-disable-next-line no-console
    console.log(`[perf] seeded ${EMPLOYEE_COUNT} employees, ${totalAdvances} total Advance rows, ${entryRowsA.length + 1} recovery PayrollEntry rows`);
  }, 5 * 60 * 1000);

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  // 1. Broad Advance roster ------------------------------------------------------------------------

  it('broad Advance roster (no filter, default sort) completes within a generous bound', async () => {
    const start = Date.now();
    const res = await admin.agent.get('/api/v1/reports/advance-recovery?pageSize=25');
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(EMPLOYEE_COUNT);
    // eslint-disable-next-line no-console
    console.log(`[perf] broad roster, no filter (${res.body.total} matching), page of 25: ${ms}ms`);
    expect(ms).toBeLessThan(5_000);

    const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT a.* FROM "Advance" a
       JOIN "Employee" e ON e.id = a."employeeId"
       ORDER BY e.name ASC, a.id ASC
       LIMIT 25`,
    );
    // eslint-disable-next-line no-console
    console.log(`[perf] EXPLAIN ANALYZE (broad roster, no filter):\n${plan.map((r) => r['QUERY PLAN']).join('\n')}`);
  });

  // 2. Site-filtered --------------------------------------------------------------------------------

  it('Site-filtered roster completes within a generous bound', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/advance-recovery?siteIds=${targetSiteId}&pageSize=25`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`[perf] site-filtered (${res.body.total} of ~${EMPLOYEE_COUNT * 1.5} matching), page of 25: ${ms}ms`);
    expect(ms).toBeLessThan(5_000);

    const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT a.* FROM "Advance" a
       JOIN "Employee" e ON e.id = a."employeeId"
       WHERE e."siteId" = $1::uuid
       ORDER BY e.name ASC, a.id ASC
       LIMIT 25`,
      targetSiteId,
    );
    // eslint-disable-next-line no-console
    console.log(`[perf] EXPLAIN ANALYZE (site-filtered):\n${plan.map((r) => r['QUERY PLAN']).join('\n')}`);
  });

  // 3. Status-filtered --------------------------------------------------------------------------------

  it('status-filtered roster (status=ACTIVE) completes within a generous bound', async () => {
    const start = Date.now();
    const res = await admin.agent.get('/api/v1/reports/advance-recovery?status=ACTIVE&pageSize=25');
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`[perf] status=ACTIVE (${res.body.total} matching), page of 25: ${ms}ms`);
    expect(ms).toBeLessThan(5_000);

    const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT a.* FROM "Advance" a WHERE a."status" = 'ACTIVE'
       ORDER BY a.id ASC
       LIMIT 25`,
    );
    // eslint-disable-next-line no-console
    console.log(`[perf] EXPLAIN ANALYZE (status=ACTIVE, no supporting index on Advance.status):\n${plan.map((r) => r['QUERY PLAN']).join('\n')}`);
  });

  // 4. Advance-Type-filtered --------------------------------------------------------------------------

  it('advanceType-filtered roster (LOAN) completes within a generous bound', async () => {
    const start = Date.now();
    const res = await admin.agent.get('/api/v1/reports/advance-recovery?advanceType=LOAN&pageSize=25');
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(EMPLOYEE_COUNT);
    // eslint-disable-next-line no-console
    console.log(`[perf] advanceType=LOAN (${res.body.total} matching), page of 25: ${ms}ms`);
    expect(ms).toBeLessThan(5_000);
  });

  // 5. hasOutstandingBalance --------------------------------------------------------------------------

  it('hasOutstandingBalance=true completes within a generous bound', async () => {
    const start = Date.now();
    const res = await admin.agent.get('/api/v1/reports/advance-recovery?hasOutstandingBalance=true&pageSize=25');
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`[perf] hasOutstandingBalance=true (${res.body.total} matching), page of 25: ${ms}ms`);
    expect(ms).toBeLessThan(5_000);
  });

  // 6. Employee-filtered — genuine supporting index (Advance_employeeId_idx) ---------------------------

  it('employee-filtered lookup uses Advance_employeeId_idx, not a sequential scan', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/advance-recovery?employeeId=${targetEmployeeId}`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    // eslint-disable-next-line no-console
    console.log(`[perf] employeeId-filtered (${res.body.total} matching): ${ms}ms`);
    expect(ms).toBeLessThan(3_000);

    const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT * FROM "Advance" WHERE "employeeId" = $1::uuid`,
      targetEmployeeId,
    );
    const planText = plan.map((r) => r['QUERY PLAN']).join('\n');
    // eslint-disable-next-line no-console
    console.log(`[perf] EXPLAIN ANALYZE (employeeId-filtered):\n${planText}`);
    expect(planText).not.toMatch(/Seq Scan on "Advance"/);
    expect(planText).toMatch(/(Index Scan|Index Only Scan|Bitmap Index Scan).*Advance_employeeId/);
  });

  // 7. Selected-Cycle recovery context (totals aggregate) ------------------------------------------------

  it('selected-Cycle recovery context (recoveredThisCycleTotal aggregate join) completes within a generous bound', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/advance-recovery?siteIds=${targetSiteId}&cycleId=${cycleAId}&pageSize=25`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.cycle.id).toBe(cycleAId);
    expect(res.body.totals.recoveredThisCycleTotal).not.toBeNull();
    // eslint-disable-next-line no-console
    console.log(`[perf] site + selected-cycle recovery context (${res.body.total} matching Advances): ${ms}ms`);
    expect(ms).toBeLessThan(5_000);

    const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT SUM(pe."advanceDeduction") FROM "PayrollEntry" pe
       JOIN "Advance" a ON a.id = pe."advanceId"
       JOIN "Employee" e ON e.id = a."employeeId"
       WHERE pe."cycleId" = $1::uuid AND e."siteId" = $2::uuid AND a."type" = 'LOAN'`,
      cycleAId,
      targetSiteId,
    );
    // eslint-disable-next-line no-console
    console.log(`[perf] EXPLAIN ANALYZE (selected-cycle recovery aggregate):\n${plan.map((r) => r['QUERY PLAN']).join('\n')}`);
    // Honest finding: this hand-written PayrollEntry→Advance→Employee join order is an
    // approximation of the real Prisma-generated query (a nested relation filter, not a literal
    // three-table JOIN), and the planner handles this specific join order worse than Prisma's own
    // (a Nested Loop re-scanning `Employee_siteId_idx` once per PayrollEntry row, ~634ms in
    // isolation) — yet the real HTTP request above, which runs the actual Prisma query twice (once
    // per Advance type split) plus every other totals aggregate, completed in well under half that
    // time. The real end-to-end measurement is authoritative here; this EXPLAIN is supplementary
    // evidence for the underlying index behavior, not a literal reproduction of the served query.
  });

  // 8. Detail recovery-history lookup — genuine supporting indexes ----------------------------------------

  it('detail recovery-history lookup uses PayrollEntry_advanceId_idx, not a sequential scan', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/advance-recovery/${advanceWithHistoryId}`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.recoveryHistory.length).toBeGreaterThanOrEqual(2);
    // eslint-disable-next-line no-console
    console.log(`[perf] detail recovery-history lookup (${res.body.recoveryHistory.length} events): ${ms}ms`);
    expect(ms).toBeLessThan(3_000);

    const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT * FROM "PayrollEntry" WHERE "advanceId" = $1::uuid`,
      advanceWithHistoryId,
    );
    const planText = plan.map((r) => r['QUERY PLAN']).join('\n');
    // eslint-disable-next-line no-console
    console.log(`[perf] EXPLAIN ANALYZE (detail recovery-history lookup):\n${planText}`);
    expect(planText).not.toMatch(/Seq Scan on "PayrollEntry"/);
    expect(planText).toMatch(/(Index Scan|Index Only Scan|Bitmap Index Scan).*PayrollEntry_advanceId/);
  });

  // Export ------------------------------------------------------------------------------------------

  it('export of a site-filtered subset completes correctly and quickly', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/advance-recovery/export?siteIds=${targetSiteId}&format=csv`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    const lines = res.text.trim().split('\n');
    expect(lines.length).toBeGreaterThan(1);
    // eslint-disable-next-line no-console
    console.log(`[perf] export of ${lines.length - 1} rows (one site) to CSV: ${ms}ms`);
    expect(ms).toBeLessThan(10_000);
  });
});
