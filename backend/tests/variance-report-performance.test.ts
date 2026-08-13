import { randomUUID } from 'node:crypto';
import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

/**
 * Phase 7 Reports, Variance / Month-on-Month Report Checkpoint 1A — committed, repeatable
 * performance validation (frozen decision: "no migration expected... Checkpoint 1A must prove
 * this with EXPLAIN ANALYZE"), mirroring `deduction-report-performance.test.ts`'s/`project-site-
 * payroll-report-performance.test.ts`'s own established methodology (real seeded data, real
 * `EXPLAIN (ANALYZE, BUFFERS)`, every measured duration logged) rather than an ad hoc,
 * uncommitted script.
 *
 * **Seed shape** (~10,000 employees per cycle, per the Checkpoint 1A brief): 10 Sites × ~1,000
 * employees. 9,000 employees are `CONTINUED` (present in both cycles) — of those, ~1/3 increased,
 * ~1/3 decreased, ~1/3 unchanged (grossPay varied by index, not a flat fixture), ~1/7 carry a
 * Correction (real, varied selectivity, not an all-or-nothing predicate), a further small subset
 * transferred Site or changed Unit between the two cycles. 500 employees are genuinely `NEW`
 * (current cycle only); 500 are genuinely `DEPARTED` (comparison cycle only) — proving this
 * report's own two-sided pairing/existence-check machinery stays fast with a real, non-trivial
 * population mix, not just an all-`CONTINUED` fixture. Seeding uses bulk `createMany` throughout —
 * never a per-row loop.
 */

jest.setTimeout(5 * 60 * 1000);

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';
const SITE_COUNT = 10;
const CONTINUED_COUNT = 9_000;
const NEW_ONLY_COUNT = 500;
const DEPARTED_ONLY_COUNT = 500;
const CHUNK = 1000;

describe('Phase 7 Reports — Variance / Month-on-Month Report Checkpoint 1A — performance validation (no schema change)', () => {
  let admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>;
  let siteIds: string[];
  let primaryUnitIdBySite: Map<string, string>;
  let secondaryUnitSite0: string;
  let comparisonCycleId: string;
  let currentCycleId: string;
  let targetSiteId: string;

  beforeAll(async () => {
    await cleanTestData();

    admin = await createAuthenticatedAgent(app, {
      email: 'vr-perf-admin@test.local',
      password: PASSWORD,
      roleCode: ROLE_CODES.MASTER_ADMIN,
      permissionKeys: [PERMISSIONS.PAYROLL_CYCLE_MANAGE, PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.REPORTS_VIEW],
    });

    const sites: { site: { id: string }; unit: { id: string } }[] = [];
    for (let i = 0; i < SITE_COUNT; i += 1) {
      const site = await prisma.projectSite.create({ data: { name: `Test Site VR Perf ${i}` } });
      const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `VR Perf Unit ${i}`, code: `VRPU-${i}` } });
      sites.push({ site, unit });
    }
    siteIds = sites.map((s) => s.site.id);
    primaryUnitIdBySite = new Map(sites.map((s) => [s.site.id, s.unit.id]));
    targetSiteId = siteIds[0]!;
    const secondUnitAtSite0 = await prisma.projectUnit.create({ data: { siteId: targetSiteId, name: 'VR Perf Unit 0B', code: 'VRPU-0B' } });
    secondaryUnitSite0 = secondUnitAtSite0.id;

    const comparisonCycle = await prisma.payrollCycle.create({ data: { year: 2970, month: 1, createdBy: admin.userId, status: 'DRAFT' } });
    const currentCycle = await prisma.payrollCycle.create({ data: { year: 2970, month: 2, createdBy: admin.userId, status: 'DRAFT' } });
    comparisonCycleId = comparisonCycle.id;
    currentCycleId = currentCycle.id;

    const totalEmployees = CONTINUED_COUNT + NEW_ONLY_COUNT + DEPARTED_ONLY_COUNT;
    const employeeRecords: { id: string; siteId: string; unitId: string; index: number; kind: 'CONTINUED' | 'NEW' | 'DEPARTED' }[] = [];
    for (let i = 0; i < totalEmployees; i += 1) {
      const s = sites[i % SITE_COUNT]!;
      const kind: 'CONTINUED' | 'NEW' | 'DEPARTED' =
        i < CONTINUED_COUNT ? 'CONTINUED' : i < CONTINUED_COUNT + NEW_ONLY_COUNT ? 'NEW' : 'DEPARTED';
      employeeRecords.push({ id: randomUUID(), siteId: s.site.id, unitId: s.unit.id, index: i, kind });
    }

    for (let start = 0; start < employeeRecords.length; start += CHUNK) {
      const batch = employeeRecords.slice(start, start + CHUNK).map((e) => ({
        id: e.id,
        employeeCode: `VR-PERF-${String(e.index).padStart(6, '0')}`,
        name: `VR Perf Employee ${e.index}`,
        designation: 'Guard',
        siteId: e.siteId,
        unitId: e.unitId,
        grossPay: '30000',
      }));
      await prisma.employee.createMany({ data: batch });
    }

    async function makeEntriesForCycle(
      cycleId: string,
      records: typeof employeeRecords,
      grossPayFor: (e: (typeof employeeRecords)[number]) => string,
      siteFor: (e: (typeof employeeRecords)[number]) => string,
      unitFor: (e: (typeof employeeRecords)[number]) => string,
    ): Promise<void> {
      const entryRows = records.map((e) => ({
        id: randomUUID(),
        cycleId,
        employeeId: e.id,
        siteId: siteFor(e),
        designation: 'Guard',
        grossPay: grossPayFor(e),
        allowance: '0',
        leaveDays: '0',
        eobiAmount: '400',
        eobiApplicable: e.index % 3 !== 0,
        advanceDeduction: e.index % 5 === 0 ? '1000' : '0',
        eidAdvanceDeduction: '0',
        fine: e.index % 11 === 0 ? '200' : '0',
        correctionBalancePayable: '0',
        correctionBalanceRecovery: '0',
        hold: false,
        released: false,
      }));
      for (let start = 0; start < entryRows.length; start += CHUNK) {
        await prisma.payrollEntry.createMany({ data: entryRows.slice(start, start + CHUNK) });
      }
      const workLineRows = records.map((e, idx) => ({
        id: randomUUID(),
        payrollEntryId: entryRows[idx]!.id,
        siteId: siteFor(e),
        unitId: unitFor(e),
        days: '30',
        otHours: e.index % 4 === 0 ? '5' : '0',
        cycleDays: 30,
      }));
      for (let start = 0; start < workLineRows.length; start += CHUNK) {
        await prisma.payrollEntryWorkLine.createMany({ data: workLineRows.slice(start, start + CHUNK) });
      }
    }

    const continuedRecords = employeeRecords.filter((e) => e.kind === 'CONTINUED');
    const newRecords = employeeRecords.filter((e) => e.kind === 'NEW');
    const departedRecords = employeeRecords.filter((e) => e.kind === 'DEPARTED');

    // Comparison-side: every CONTINUED and DEPARTED employee, at their original site/unit,
    // uniform gross pay (the "before" figure every direction bucket is measured against).
    await makeEntriesForCycle(
      comparisonCycleId,
      [...continuedRecords, ...departedRecords],
      () => '30000',
      (e) => e.siteId,
      (e) => e.unitId,
    );

    // Current-side: every CONTINUED and NEW employee. CONTINUED gross pay varies by index
    // (~1/3 increased, ~1/3 decreased, ~1/3 unchanged) — real, non-degenerate direction
    // selectivity. A small subset (index % 97 === 0, within Site 0) transfers to Site 1; a
    // further small subset (index % 89 === 0, within Site 0) changes Unit within Site 0.
    await makeEntriesForCycle(
      currentCycleId,
      [...continuedRecords, ...newRecords],
      (e) => (e.kind === 'NEW' ? '25000' : e.index % 3 === 0 ? '30000' : e.index % 3 === 1 ? '33000' : '27000'),
      (e) => (e.kind === 'CONTINUED' && e.siteId === targetSiteId && e.index % 97 === 0 ? siteIds[1]! : e.siteId),
      (e) => {
        // The composite (unitId, siteId) FK requires the work line's own Unit to belong to
        // whichever Site this same current-side entry resolves to (`siteFor`, above) — a
        // transferred employee's Unit must resolve to the *destination* Site's own Unit, never
        // their original Site's Unit.
        if (e.kind === 'CONTINUED' && e.siteId === targetSiteId && e.index % 97 === 0) {
          return primaryUnitIdBySite.get(siteIds[1]!)!;
        }
        if (e.kind === 'CONTINUED' && e.siteId === targetSiteId && e.index % 89 === 0) {
          return secondaryUnitSite0;
        }
        return e.unitId;
      },
    );

    // Corrections against ~1/7 of CONTINUED employees' comparison-side entries — real, varied
    // selectivity, exercising the chunked `fetchCorrectedEntryIds` batching at real volume.
    const adjustmentType = await prisma.adjustmentType.create({ data: { code: 'TEST_VR_PERF_CORR', label: 'VR Perf Correction' } });
    const comparisonEntries = await prisma.payrollEntry.findMany({
      where: { cycleId: comparisonCycleId, employeeId: { in: continuedRecords.filter((e) => e.index % 7 === 0).map((e) => e.id) } },
      select: { id: true },
    });
    const correctionRows = comparisonEntries.map((entry) => ({
      payrollEntryId: entry.id,
      field: 'GROSS_PAY' as const,
      oldValue: '30000',
      newValue: '31000',
      oldNetSalary: '29600',
      newNetSalary: '30600',
      adjustmentTypeId: adjustmentType.id,
      reason: 'Perf fixture correction',
      approvedById: admin.userId,
    }));
    for (let start = 0; start < correctionRows.length; start += CHUNK) {
      await prisma.correction.createMany({ data: correctionRows.slice(start, start + CHUNK) });
    }

    const comparisonTotal = await prisma.payrollEntry.count({ where: { cycleId: comparisonCycleId } });
    const currentTotal = await prisma.payrollEntry.count({ where: { cycleId: currentCycleId } });
    // eslint-disable-next-line no-console
    console.log(
      `[perf] seeded ${totalEmployees} employees (${CONTINUED_COUNT} continued, ${NEW_ONLY_COUNT} new, ${DEPARTED_ONLY_COUNT} departed); ` +
        `${comparisonTotal} comparison-cycle entries, ${currentTotal} current-cycle entries; ${correctionRows.length} corrections`,
    );
  }, 5 * 60 * 1000);

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  function listUrl(params: Record<string, string>): string {
    return `/api/v1/reports/variance?${new URLSearchParams({ comparisonCycleId, currentCycleId, pageSize: '25', ...params }).toString()}`;
  }

  it('1. broad two-cycle comparison (no filters) — the underlying per-cycle fetch uses an index, not a sequential scan', async () => {
    const start = Date.now();
    const res = await admin.agent.get(listUrl({}));
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(CONTINUED_COUNT + NEW_ONLY_COUNT + DEPARTED_ONLY_COUNT);
    // eslint-disable-next-line no-console
    console.log(`[perf] broad two-cycle comparison (${res.body.total} matching): ${ms}ms`);
    expect(ms).toBeLessThan(15_000);

    const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT pe.* FROM "PayrollEntry" pe
       WHERE pe."cycleId" = $1::uuid`,
      comparisonCycleId,
    );
    const planText = plan.map((row) => row['QUERY PLAN']).join('\n');
    // eslint-disable-next-line no-console
    console.log(`[perf] EXPLAIN ANALYZE (one side's own bounded per-cycle fetch):\n${planText}`);
    expect(planText).not.toMatch(/Seq Scan on "PayrollEntry"/);
  });

  it('2. two-cycle + Site filter — matches on either side, underlying authorization fetch stays index-backed', async () => {
    const start = Date.now();
    const res = await admin.agent.get(listUrl({ siteIds: targetSiteId }));
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`[perf] two-cycle + Site filter (${res.body.total} matching): ${ms}ms`);
    expect(ms).toBeLessThan(15_000);

    const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT pe.* FROM "PayrollEntry" pe
       WHERE pe."cycleId" = $1::uuid AND pe."siteId" = $2::uuid`,
      comparisonCycleId,
      targetSiteId,
    );
    const planText = plan.map((row) => row['QUERY PLAN']).join('\n');
    // eslint-disable-next-line no-console
    console.log(`[perf] EXPLAIN ANALYZE (cycle+site-filtered per-side fetch):\n${planText}`);
    expect(planText).not.toMatch(/Seq Scan on "PayrollEntry"/);
  });

  it('3. two-cycle + Unit filter (single-Site-scoped) stays fast', async () => {
    const unitId = primaryUnitIdBySite.get(targetSiteId)!;
    const start = Date.now();
    const res = await admin.agent.get(listUrl({ siteIds: targetSiteId, unitId }));
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`[perf] two-cycle + Site + Unit filter (${res.body.total} matching): ${ms}ms`);
    expect(ms).toBeLessThan(15_000);
  });

  it('4. employee search (the shared historical-payroll lookup) stays fast', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/reports/variance/employees?search=${encodeURIComponent('VR Perf Employee 1')}&pageSize=25`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    // eslint-disable-next-line no-console
    console.log(`[perf] employee search (${res.body.total} matching): ${ms}ms`);
    expect(ms).toBeLessThan(5_000);
  });

  it('5. direction filter (requires calcNet over every CONTINUED candidate before pagination) stays within a generous bound', async () => {
    const start = Date.now();
    const res = await admin.agent.get(listUrl({ direction: 'INCREASED' }));
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`[perf] direction=INCREASED filter (${res.body.total} matching, full-candidate calcNet pass): ${ms}ms`);
    expect(ms).toBeLessThan(15_000);
  });

  it('6. hasCorrection filter (chunked correction-existence batching at ~19,000 candidate entry ids) stays fast', async () => {
    const start = Date.now();
    const res = await admin.agent.get(listUrl({ hasCorrection: 'true' }));
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`[perf] hasCorrection=true filter (${res.body.total} matching): ${ms}ms`);
    expect(ms).toBeLessThan(15_000);
  });

  it('7. DB-native-equivalent structural sort (employeeName) stays fast', async () => {
    const start = Date.now();
    const res = await admin.agent.get(listUrl({ sortBy: 'employeeName', sortDir: 'desc' }));
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(25);
    // eslint-disable-next-line no-console
    console.log(`[perf] structural sort (employeeName desc): ${ms}ms`);
    expect(ms).toBeLessThan(15_000);
  });

  it('8. bounded calcNet-derived sort (varianceAmount) stays within a generous bound, well under the 20,000-row ceiling', async () => {
    const start = Date.now();
    const res = await admin.agent.get(listUrl({ sortBy: 'varianceAmount', sortDir: 'desc' }));
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(25);
    // eslint-disable-next-line no-console
    console.log(`[perf] bounded calcNet sort (varianceAmount desc): ${ms}ms`);
    expect(ms).toBeLessThan(15_000);
  });

  it('9. totals computation (bounded calcNet pass over every matching candidate) completes within a generous bound', async () => {
    const start = Date.now();
    const res = await admin.agent.get(listUrl({}));
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.totals.totalsComputed).toBe(true);
    expect(res.body.totals.matchingCount).toBe(CONTINUED_COUNT + NEW_ONLY_COUNT + DEPARTED_ONLY_COUNT);
    // eslint-disable-next-line no-console
    console.log(`[perf] full request (list page + totals over all ${res.body.totals.matchingCount} matching rows): ${ms}ms`);
    expect(ms).toBeLessThan(15_000);
  });

  it('10. export preflight + full CSV export of the whole matching set completes correctly, with duration on record', async () => {
    const start = Date.now();
    const res = await admin.agent.get(
      `/api/v1/reports/variance/export?${new URLSearchParams({ comparisonCycleId, currentCycleId, format: 'csv' }).toString()}`,
    );
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    const lines = res.text.trim().split('\n');
    expect(lines.length).toBe(CONTINUED_COUNT + NEW_ONLY_COUNT + DEPARTED_ONLY_COUNT + 1); // header + every matching row
    // eslint-disable-next-line no-console
    console.log(`[perf] export of ${lines.length - 1} rows (whole matching set) to CSV: ${ms}ms`);
    expect(ms).toBeLessThan(20_000);
  });

  it('correction existence lookup issues a small, bounded number of chunked queries — never one per row', async () => {
    const groupBySpy = jest.spyOn(prisma.correction, 'groupBy');
    const res = await admin.agent.get(listUrl({}));
    expect(res.status).toBe(200);
    // ~19,000 total candidate entry ids at this fixture's scale, chunked at 5,000 per
    // `CORRECTION_LOOKUP_CHUNK_SIZE` — a handful of calls, nowhere near one per row.
    expect(groupBySpy.mock.calls.length).toBeGreaterThan(0);
    expect(groupBySpy.mock.calls.length).toBeLessThan(10);
    groupBySpy.mockRestore();
  });
});
