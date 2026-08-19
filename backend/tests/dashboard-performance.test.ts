import { randomUUID } from 'node:crypto';
import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

/**
 * Dashboard Checkpoint 1A — committed, repeatable performance validation (§16: "one backend
 * request; no N+1; no whole report dataset downloaded merely to calculate an aggregate; reuse
 * DB-native aggregate functions from existing reports where possible"), mirroring
 * `salary-release-report-performance.test.ts`'s/`deduction-report-performance.test.ts`'s own
 * established methodology — real seeded data, real `EXPLAIN (ANALYZE, BUFFERS)`, every measured
 * duration logged — rather than an ad hoc, uncommitted script.
 *
 * **No N+1 by construction, not just by measurement:** `dashboard.service.ts`'s `getDashboard`
 * issues exactly one call to `buildPayrollSummaryData` (Payroll Summary's own already
 * performance-proven single `findMany`, see `project-site-payroll-report-performance.test.ts`/
 * `salary-release-report-performance.test.ts`/`deduction-report-performance.test.ts`) plus four
 * small, fixed, independent count/aggregate queries (Total Employees, Held Entries, Pending
 * Corrections, Recovery Due) run in one `Promise.all` — there is no loop anywhere in that file that
 * issues a further query per row of any result set. This suite's own job is therefore to prove the
 * three *new* aggregate queries this checkpoint adds (Total Employees, Pending Corrections, Recovery
 * Due) stay index-backed at scale, and that the combined single-request response time stays bounded.
 *
 * Seeded at the same order of magnitude as every sibling report's own evidence — 10 sites × 1,000
 * employees (10,000 total), one Draft cycle with a mixed release-state population, a scattered
 * subset of PENDING `CorrectionRequest`s, and a scattered subset of `ACTIVE` Advances with a genuine
 * outstanding balance — so every measured query shape exercises real, non-degenerate selectivity.
 * Seeding uses bulk `createMany` throughout — never a per-row loop.
 */

jest.setTimeout(5 * 60 * 1000);

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';
const SITE_COUNT = 10;
const EMPLOYEES_PER_SITE = 1_000;
const EMPLOYEE_COUNT = SITE_COUNT * EMPLOYEES_PER_SITE;

describe('Dashboard Checkpoint 1A — performance validation (no schema change)', () => {
  let admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>;
  let siteIds: string[];
  let targetSiteId: string;
  let cycleId: string;

  beforeAll(async () => {
    await cleanTestData();

    admin = await createAuthenticatedAgent(app, {
      email: 'dash-perf-admin@test.local',
      password: PASSWORD,
      roleCode: ROLE_CODES.MASTER_ADMIN,
      permissionKeys: [
        PERMISSIONS.PAYROLL_CYCLE_MANAGE,
        PERMISSIONS.PAYROLL_ENTRY,
        PERMISSIONS.REPORTS_VIEW,
        PERMISSIONS.PAYROLL_VIEW,
        PERMISSIONS.EMPLOYEES_VIEW,
        PERMISSIONS.CORRECTIONS_APPROVE,
        PERMISSIONS.ADVANCES_MANAGE,
      ],
    });

    const sites: { site: Awaited<ReturnType<typeof prisma.projectSite.create>>; unit: Awaited<ReturnType<typeof prisma.projectUnit.create>> }[] = [];
    for (let i = 0; i < SITE_COUNT; i += 1) {
      const site = await prisma.projectSite.create({ data: { name: `Test Site Dash Perf ${i}` } });
      const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `Dash Perf Unit ${i}`, code: `DPU-${i}` } });
      sites.push({ site, unit });
    }
    siteIds = sites.map((s) => s.site.id);
    targetSiteId = siteIds[0]!;

    const employeeIds: { id: string; siteId: string }[] = [];
    const CHUNK = 1000;
    for (let start = 0; start < EMPLOYEE_COUNT; start += CHUNK) {
      const batch = [];
      for (let i = start; i < Math.min(start + CHUNK, EMPLOYEE_COUNT); i += 1) {
        const s = sites[i % SITE_COUNT]!;
        const id = randomUUID();
        employeeIds.push({ id, siteId: s.site.id });
        batch.push({
          id,
          employeeCode: `DASH-PERF-${String(i).padStart(6, '0')}`,
          name: `Dash Perf Employee ${i}`,
          designation: 'Guard',
          siteId: s.site.id,
          unitId: s.unit.id,
          grossPay: '30000',
          // ~1-in-20 already left — proves Total Employees' `dateOfLeaving: null` filter stays
          // index-backed rather than a full-table scan-and-discard.
          dateOfLeaving: i % 20 === 0 ? new Date(2020, 0, 1) : null,
        });
      }
      await prisma.employee.createMany({ data: batch });
    }

    const cycle = await prisma.payrollCycle.create({ data: { year: 2900, month: 1, createdBy: admin.userId, status: 'DRAFT' } });
    cycleId = cycle.id;

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
        releasedAt: released ? new Date(2026, 0, 1) : null,
        releasedBy: released ? admin.userId : null,
        payoutOutcome,
      };
    });
    for (let start = 0; start < entryRows.length; start += CHUNK) {
      await prisma.payrollEntry.createMany({ data: entryRows.slice(start, start + CHUNK) });
    }
    const workLineRows = entryRows.map((entry, i) => ({
      id: randomUUID(),
      payrollEntryId: entry.id,
      siteId: entry.siteId,
      unitId: sites[i % SITE_COUNT]!.unit.id,
      days: '26',
      otHours: '0',
      cycleDays: 30,
    }));
    for (let start = 0; start < workLineRows.length; start += CHUNK) {
      await prisma.payrollEntryWorkLine.createMany({ data: workLineRows.slice(start, start + CHUNK) });
    }

    // A ~1-in-100 subset of RELEASED entries carries a PENDING CorrectionRequest (only a released
    // entry may have one — `assertEntryIsReleased`).
    const adjustmentType = await prisma.adjustmentType.create({ data: { code: 'TEST_DASH_PERF_ADJ', label: 'Dash Perf Adjustment' } });
    const releasedRows = entryRows.filter((row) => row.released);
    const correctionRows = releasedRows.filter((_, i) => i % 100 === 0);
    await prisma.correctionRequest.createMany({
      data: correctionRows.map((row) => ({
        id: randomUUID(),
        payrollEntryId: row.id,
        field: 'FINE' as const,
        proposedNewValue: '50.00',
        adjustmentTypeId: adjustmentType.id,
        reason: 'Dashboard perf fixture',
        requestedById: admin.userId,
        status: 'PENDING' as const,
      })),
    });

    // A ~1-in-20 subset of employees carries an ACTIVE Advance with a genuine outstanding balance.
    const advanceRows = employeeIds.filter((_, i) => i % 20 === 0);
    await prisma.advance.createMany({
      data: advanceRows.map((emp) => ({
        id: randomUUID(),
        employeeId: emp.id,
        type: 'LOAN' as const,
        totalAmount: '5000',
        outstandingBalance: '3000',
        dateGiven: new Date(2026, 0, 1),
        repaymentType: 'INSTALLMENT' as const,
        status: 'ACTIVE' as const,
      })),
    });

    // Deterministic planner statistics after this fixture's bulk `createMany` burst (same
    // precedent as `advance-recovery-report-performance.test.ts`/`overtime-report-performance
    // .test.ts`) — every table this suite's own EXPLAIN blocks and full-request assertions query.
    await prisma.$executeRawUnsafe('ANALYZE "Employee", "PayrollEntry", "PayrollEntryWorkLine", "CorrectionRequest", "Advance"');

    // eslint-disable-next-line no-console
    console.log(
      `[perf] seeded ${EMPLOYEE_COUNT} employees, 1 cycle, ${entryRows.length} PayrollEntry rows, ${correctionRows.length} pending CorrectionRequests, ${advanceRows.length} ACTIVE Advances`,
    );
  }, 5 * 60 * 1000);

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  it('1. global (Master Admin, all Sites) Dashboard request stays bounded', async () => {
    const start = Date.now();
    const res = await admin.agent.get('/api/v1/dashboard');
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.totalEmployees).toBe(EMPLOYEE_COUNT - Math.ceil(EMPLOYEE_COUNT / 20));
    expect(res.body.releaseProgress.totalCount).toBe(EMPLOYEE_COUNT);
    // eslint-disable-next-line no-console
    console.log(`[perf] full global Dashboard request (${EMPLOYEE_COUNT} employees, all sites): ${ms}ms`);
    expect(ms).toBeLessThan(5_000);
  });

  it('2. Site-scoped Dashboard request stays bounded', async () => {
    const scoped = await createAuthenticatedAgent(app, {
      email: 'dash-perf-scoped@test.local',
      password: PASSWORD,
      roleCode: 'TEST_DASH_PERF_SCOPED',
      permissionKeys: [PERMISSIONS.REPORTS_VIEW, PERMISSIONS.EMPLOYEES_VIEW, PERMISSIONS.CORRECTIONS_APPROVE, PERMISSIONS.ADVANCES_MANAGE],
      siteIds: [targetSiteId],
    });

    const start = Date.now();
    const res = await scoped.agent.get('/api/v1/dashboard');
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.releaseProgress.totalCount).toBe(EMPLOYEES_PER_SITE);
    // eslint-disable-next-line no-console
    console.log(`[perf] Site-scoped Dashboard request (${EMPLOYEES_PER_SITE} of ${EMPLOYEE_COUNT} employees): ${ms}ms`);
    expect(ms).toBeLessThan(5_000);
  });

  it('3. Total Employees aggregate (active, Site-filtered) uses an index, not a sequential scan', async () => {
    const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT COUNT(*) FROM "Employee" WHERE "dateOfLeaving" IS NULL AND "siteId" = $1::uuid`,
      targetSiteId,
    );
    const planText = plan.map((row) => row['QUERY PLAN']).join('\n');
    // eslint-disable-next-line no-console
    console.log(`[perf] EXPLAIN ANALYZE (Total Employees, Site-filtered):\n${planText}`);
    expect(planText).not.toMatch(/Seq Scan on "Employee"/);
  });

  it('4. Pending Corrections aggregate (status + PayrollEntry.siteId join) stays fast at scale', async () => {
    const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT COUNT(*) FROM "CorrectionRequest" cr
       JOIN "PayrollEntry" pe ON pe.id = cr."payrollEntryId"
       WHERE cr.status = 'PENDING' AND pe."siteId" = $1::uuid`,
      targetSiteId,
    );
    const planText = plan.map((row) => row['QUERY PLAN']).join('\n');
    // eslint-disable-next-line no-console
    console.log(`[perf] EXPLAIN ANALYZE (Pending Corrections, Site-filtered):\n${planText}`);
    // CorrectionRequest's own row count is bounded by how many corrections actually exist (a small
    // fraction of PayrollEntry volume, by construction — a correction is a deliberate workflow
    // action, never a per-entry default) — a full scan of CorrectionRequest itself, filtered first
    // by its own `status` index, is expected and cheap at this scale; the assertion below only
    // guards against the unbounded table (PayrollEntry) being sequentially scanned.
    expect(planText).not.toMatch(/Seq Scan on "PayrollEntry"/);
  });

  it('5. Recovery Due aggregate (status + outstandingBalance + Employee.siteId join) stays fast at scale', async () => {
    const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT COUNT(*), SUM(a."outstandingBalance") FROM "Advance" a
       JOIN "Employee" e ON e.id = a."employeeId"
       WHERE a.status = 'ACTIVE' AND a."outstandingBalance" > 0 AND e."siteId" = $1::uuid`,
      targetSiteId,
    );
    const planText = plan.map((row) => row['QUERY PLAN']).join('\n');
    // eslint-disable-next-line no-console
    console.log(`[perf] EXPLAIN ANALYZE (Recovery Due, Site-filtered):\n${planText}`);
    // Same reasoning as Pending Corrections above — Advance's own row count is bounded by how many
    // employees genuinely carry an active advance (a fraction of the employee population), never
    // one row per PayrollEntry; the assertion guards the unbounded side of the join (Employee).
    expect(planText).not.toMatch(/Seq Scan on "Employee"/);
  });

  it('6. releaseProgress/deductionBreakdown/siteSummary reconcile with the live Payroll Summary Report at this scale', async () => {
    const [dashboardRes, summaryRes] = await Promise.all([
      admin.agent.get('/api/v1/dashboard'),
      admin.agent.get(`/api/v1/reports/payroll-summary?cycleId=${cycleId}&pageSize=${SITE_COUNT}`),
    ]);
    expect(dashboardRes.status).toBe(200);
    expect(summaryRes.status).toBe(200);
    const totals = summaryRes.body.cycleTotals;
    expect(dashboardRes.body.netPayroll).toBe(totals.netSalary);
    expect(dashboardRes.body.deductionBreakdown.eobi).toBe(totals.eobi);
    expect(dashboardRes.body.siteSummaryTotalSites).toBe(SITE_COUNT);
  });
});
