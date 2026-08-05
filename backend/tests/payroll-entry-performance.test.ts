import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { PAYROLL_ENTRY_TEMPLATE_HEADERS } from '../src/modules/payroll-entry/payroll-entry-import-export.service';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

/**
 * Phase 3 Checkpoint 6 — Performance/concurrency validation at Principle 10's 10,000-employee
 * design floor (docs/PROJECT_PRINCIPLES.md §10, docs/IMPLEMENTATION_PLAN.md's Checkpoint 6 entry).
 *
 * This is the first *committed, repeatable* test at this scale — Checkpoint 1's own 3,000-employee
 * bootstrap timing was an informal, uncommitted smoke test (docs/IMPLEMENTATION_PLAN.md's
 * Checkpoint 1 entry), never run at 10,000 and never made part of the automated suite. This file
 * closes that gap.
 *
 * Per the frozen Checkpoint 6 decisions: these are *engineering targets*, not hard contractual
 * SLAs — assertions below use generous bounds so the suite doesn't flake on slower CI hardware,
 * while every measured duration is also logged so the real number is always on record, not just a
 * pass/fail. Methodology is deliberately the existing backend test suite (supertest) plus parallel
 * `Promise.all` requests — no dedicated load-testing framework (k6/Locust/Artillery/JMeter), per
 * the approved Concurrency Methodology.
 *
 * The 10,000-employee dataset and its Draft cycle are seeded once in `beforeAll` and reused/
 * progressively mutated across the tests below (never re-seeded per test) — seeding alone is not
 * free, and Checkpoint 6 is validating the *existing* architecture, not paying its setup cost
 * ten times over. Tests are ordered so a later test's mutations never invalidate an earlier test's
 * assertions: read-only/measurement tests first, then Copy to All (bulk-mutates one field for
 * every entry), then export last (reads current state). Payroll Entry import was removed (Payroll
 * Entry usability checkpoint, 2026-07-24) — payroll data must never be imported — so its own
 * 10,000-row perf case was removed with it.
 */

jest.setTimeout(10 * 60 * 1000);

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';
const EMPLOYEE_COUNT = 10_000;
const SITE_COUNT = 10;
// The frontend's own page size (frontend/src/hooks/use-payroll-entries.ts PAGE_SIZE) — mirrored
// here as a literal, not imported, since this is a backend-only test measuring the same shape of
// request the frontend actually issues.
const FRONTEND_PAGE_SIZE = 200;

describe('Phase 3 Checkpoint 6 — 10,000-employee performance/concurrency validation', () => {
  let admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>;
  let siteIds: string[];
  let cycleId: string;
  let bootstrapMs: number;

  beforeAll(async () => {
    await cleanTestData();

    admin = await createAuthenticatedAgent(app, {
      email: 'perf-admin@test.local',
      password: PASSWORD,
      roleCode: ROLE_CODES.MASTER_ADMIN,
      permissionKeys: [PERMISSIONS.PAYROLL_CYCLE_MANAGE, PERMISSIONS.PAYROLL_ENTRY],
    });

    const sites = [];
    for (let i = 0; i < SITE_COUNT; i += 1) {
      const site = await prisma.projectSite.create({ data: { name: `Test Site Perf ${i}` } });
      const unit = await prisma.projectUnit.create({
        data: { siteId: site.id, name: `Perf Unit ${i}`, code: `PU-${i}` },
      });
      sites.push({ site, unit });
    }
    siteIds = sites.map((s) => s.site.id);

    // Bulk-generate 10,000 employees via chunked createMany — the same bulk-write discipline
    // Checkpoint 1's own cycle bootstrap uses (database/schema-invariants.md §23), not a per-row
    // loop, since employee generation itself is test-fixture setup, not the thing being measured.
    const CHUNK = 1000;
    for (let start = 0; start < EMPLOYEE_COUNT; start += CHUNK) {
      const batch = [];
      for (let i = start; i < Math.min(start + CHUNK, EMPLOYEE_COUNT); i += 1) {
        const s = sites[i % SITE_COUNT]!;
        batch.push({
          employeeCode: `PERF-${String(i).padStart(6, '0')}`,
          name: `Perf Employee ${i}`,
          designation: 'Guard',
          siteId: s.site.id,
          unitId: s.unit.id,
          grossPay: '30000',
        });
      }
      await prisma.employee.createMany({ data: batch });
    }

    const bootstrapStart = Date.now();
    const cycleRes = await admin.agent
      .post('/api/v1/payroll-cycles')
      .set('x-csrf-token', admin.csrfToken)
      .send({ year: 2900, month: 1 });
    bootstrapMs = Date.now() - bootstrapStart;

    if (cycleRes.status !== 201) {
      throw new Error(`Cycle bootstrap failed: ${cycleRes.status} ${JSON.stringify(cycleRes.body)}`);
    }
    cycleId = cycleRes.body.cycle.id as string;

    // eslint-disable-next-line no-console
    console.log(`[perf] cycle bootstrap for ${EMPLOYEE_COUNT} employees: ${bootstrapMs}ms`);
  });

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  it('bootstraps a 10,000-employee Draft cycle correctly, within a generous bound', async () => {
    const count = await prisma.payrollEntry.count({ where: { cycleId } });
    const lineCount = await prisma.payrollEntryWorkLine.count({ where: { payrollEntry: { cycleId } } });
    expect(count).toBe(EMPLOYEE_COUNT);
    expect(lineCount).toBe(EMPLOYEE_COUNT);
    // Generous CI-safe ceiling — the 3,000-employee informal smoke test recorded ~1.3s
    // (docs/IMPLEMENTATION_PLAN.md), so 10,000 on comparable hardware should stay well under this;
    // the transaction's own internal timeout is 30s (payroll-processing.service.ts).
    expect(bootstrapMs).toBeLessThan(30_000);
  });

  it('assigns every bootstrapped entry its own distinct sortOrder (regression: stable pagination)', async () => {
    // Real bug found via this checkpoint's own real-browser measurement (2026-07-10): every
    // bootstrapped entry previously defaulted to sortOrder=0 (the schema column default, never
    // overridden by createPayrollCycle) — `ORDER BY sortOrder ASC LIMIT/OFFSET` pagination over
    // 10,000 rows all tied on the same value is unstable in Postgres (no tiebreaker guarantee),
    // which silently duplicated 23 rows across page boundaries and dropped 23 others entirely.
    // Fixed in payroll-processing.service.ts by assigning each entry its own loop-index sortOrder.
    const distinctSortOrders = await prisma.payrollEntry.findMany({
      where: { cycleId },
      select: { sortOrder: true },
      distinct: ['sortOrder'],
    });
    expect(distinctSortOrders.length).toBe(EMPLOYEE_COUNT);
  });

  it('list query for one page is indexed (not a sequential scan) and fast', async () => {
    const start = Date.now();
    const res = await admin.agent.get(
      `/api/v1/payroll-cycles/${cycleId}/entries?page=1&pageSize=${FRONTEND_PAGE_SIZE}`,
    );
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(FRONTEND_PAGE_SIZE);
    expect(res.body.total).toBe(EMPLOYEE_COUNT);
    // eslint-disable-next-line no-console
    console.log(`[perf] single page (${FRONTEND_PAGE_SIZE} rows) HTTP round trip: ${ms}ms`);
    expect(ms).toBeLessThan(2_000);

    const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN ANALYZE SELECT * FROM "PayrollEntry" WHERE "cycleId" = $1::uuid ORDER BY "sortOrder" ASC LIMIT ${FRONTEND_PAGE_SIZE}`,
      cycleId,
    );
    const planText = plan.map((row) => row['QUERY PLAN']).join('\n');
    // eslint-disable-next-line no-console
    console.log(`[perf] EXPLAIN ANALYZE (unfiltered list query):\n${planText}`);
    expect(planText).not.toMatch(/Seq Scan on "PayrollEntry"/);

    const filteredPlan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN ANALYZE SELECT * FROM "PayrollEntry" WHERE "cycleId" = $1::uuid AND "siteId" = $2::uuid ORDER BY "sortOrder" ASC LIMIT ${FRONTEND_PAGE_SIZE}`,
      cycleId,
      siteIds[0],
    );
    const filteredPlanText = filteredPlan.map((row) => row['QUERY PLAN']).join('\n');
    // eslint-disable-next-line no-console
    console.log(`[perf] EXPLAIN ANALYZE (site-filtered list query):\n${filteredPlanText}`);
    expect(filteredPlanText).not.toMatch(/Seq Scan on "PayrollEntry"/);
  });

  it('measures the current sequential page-to-completion fetch against a parallelized alternative', async () => {
    const totalPages = Math.ceil(EMPLOYEE_COUNT / FRONTEND_PAGE_SIZE);

    // Asserting on *distinct entry IDs seen*, not just the summed row count returned per page —
    // 50 pages of exactly 200 rows always sums to 10,000 by construction even if pagination
    // silently returns some rows twice and others never (this is precisely the class of bug a
    // missing/duplicate `sortOrder` tiebreaker produces, discovered via this checkpoint's own
    // real-browser measurement — see payroll-processing.service.ts's 2026-07-10 fix). A weaker
    // "row count summed across pages" assertion would not have caught it.

    // (1) Exactly frontend/src/hooks/use-payroll-entries.ts's *original* `usePayrollEntries` loop:
    // one page awaited before the next request fires.
    const sequentialStart = Date.now();
    const sequentialIds = new Set<string>();
    for (let page = 1; page <= totalPages; page += 1) {
      const res = await admin.agent.get(
        `/api/v1/payroll-cycles/${cycleId}/entries?page=${page}&pageSize=${FRONTEND_PAGE_SIZE}`,
      );
      expect(res.status).toBe(200);
      for (const entry of res.body.entries as { id: string }[]) sequentialIds.add(entry.id);
    }
    const sequentialMs = Date.now() - sequentialStart;
    expect(sequentialIds.size).toBe(EMPLOYEE_COUNT);

    // (2) The applied fix: fetch page 1 to learn `total`, then fire the remaining pages
    // concurrently, capped so a 10,000-row load doesn't try to open 49 simultaneous connections
    // against an unconfigured Prisma pool in one burst — mirrors frontend/src/hooks/
    // use-payroll-entries.ts's current `usePayrollEntries` exactly.
    const CONCURRENCY = 8;
    const parallelStart = Date.now();
    const first = await admin.agent.get(
      `/api/v1/payroll-cycles/${cycleId}/entries?page=1&pageSize=${FRONTEND_PAGE_SIZE}`,
    );
    const parallelIds = new Set<string>((first.body.entries as { id: string }[]).map((e) => e.id));
    const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
    for (let i = 0; i < remainingPages.length; i += CONCURRENCY) {
      const batch = remainingPages.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map((page) =>
          admin.agent.get(`/api/v1/payroll-cycles/${cycleId}/entries?page=${page}&pageSize=${FRONTEND_PAGE_SIZE}`),
        ),
      );
      for (const res of results) {
        expect(res.status).toBe(200);
        for (const entry of res.body.entries as { id: string }[]) parallelIds.add(entry.id);
      }
    }
    const parallelMs = Date.now() - parallelStart;
    expect(parallelIds.size).toBe(EMPLOYEE_COUNT);

    // eslint-disable-next-line no-console
    console.log(
      `[perf] full-cycle fetch, ${totalPages} pages of ${FRONTEND_PAGE_SIZE}: ` +
        `sequential=${sequentialMs}ms, parallel(x${CONCURRENCY})=${parallelMs}ms, ` +
        `speedup=${(sequentialMs / parallelMs).toFixed(2)}x`,
    );
  });

  it('a distinct-row concurrent edit burst never loses an update', async () => {
    const list = await admin.agent.get(`/api/v1/payroll-cycles/${cycleId}/entries?page=2&pageSize=50`);
    expect(list.status).toBe(200);
    const targets = list.body.entries as { id: string; version: number }[];
    expect(targets.length).toBe(50);

    // Batched, not one giant Promise.all — supertest spins up an ephemeral HTTP listener per
    // request when given a bare Express app, and 50 fully simultaneous listeners is a supertest/
    // Node resource-exhaustion artifact (observed: ECONNRESET), not a signal about the
    // application's own concurrency handling. Batches of 10 still exercise genuine parallel
    // requests reaching the same Prisma pool/Postgres instance concurrently.
    const CONCURRENCY = 10;
    const start = Date.now();
    const results: { status: number }[] = [];
    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      const batch = targets.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map((entry, j) =>
          admin.agent
            // Phase 7F (2026-08-04) — `allowance` stands in for `grossPay` here (which this suite
            // used before `grossPay` became a read-only, Employee-Registry-sourced field); this
            // test exercises the generic concurrent-distinct-row-write path, not anything specific
            // to which field is edited.
            .patch(`/api/v1/payroll-entries/${entry.id}`)
            .set('x-csrf-token', admin.csrfToken)
            .send({ version: entry.version, allowance: String(31000 + i + j) }),
        ),
      );
      results.push(...batchResults);
    }
    const ms = Date.now() - start;
    // eslint-disable-next-line no-console
    console.log(`[perf] 50 concurrent (batches of ${CONCURRENCY}) distinct-row PATCH requests: ${ms}ms`);

    for (const res of results) {
      expect(res.status).toBe(200);
    }

    for (let i = 0; i < targets.length; i += 1) {
      const fresh = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: targets[i]!.id } });
      expect(Number(fresh.allowance)).toBe(31000 + i);
    }
  });

  it('a genuinely concurrent same-row race produces exactly one 409, never a lost update', async () => {
    const list = await admin.agent.get(`/api/v1/payroll-cycles/${cycleId}/entries?page=3&pageSize=1`);
    const entry = list.body.entries[0] as { id: string; version: number };

    // Phase 7F (2026-08-04) — `allowance` stands in for `grossPay` here, same reason as above.
    const [a, b] = await Promise.all([
      admin.agent
        .patch(`/api/v1/payroll-entries/${entry.id}`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ version: entry.version, allowance: '40001' }),
      admin.agent
        .patch(`/api/v1/payroll-entries/${entry.id}`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ version: entry.version, allowance: '40002' }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const fresh = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect([40001, 40002]).toContain(Number(fresh.allowance));
    expect(fresh.version).toBe(entry.version + 1);
  });

  it('Copy to All (bulk update) completes within target at 10,000-row scope', async () => {
    const start = Date.now();
    const res = await admin.agent
      .patch(`/api/v1/payroll-cycles/${cycleId}/entries/bulk`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ siteIds, field: 'leaveRate', value: '123.45' });
    const ms = Date.now() - start;

    expect(res.status).toBe(200);
    expect(res.body.matchedCount).toBe(EMPLOYEE_COUNT);
    expect(res.body.appliedCount).toBe(EMPLOYEE_COUNT);
    // eslint-disable-next-line no-console
    console.log(`[perf] Copy to All across ${EMPLOYEE_COUNT} entries: ${ms}ms (target <=2000ms)`);
    // Generous CI-safe ceiling — the 2s figure is Decision 4's engineering target, not a hard SLA.
    expect(ms).toBeLessThan(10_000);

    const sample = await prisma.payrollEntry.findFirst({ where: { cycleId } });
    expect(sample?.leaveRate?.toString()).toBe('123.45');
  });

  // Post-Checkpoint-1A UAT Stabilization — the new bulk EOBI Amount field shares the exact same
  // single `updateMany` code path `leaveRate` above already measures (no per-row loop, no N+1
  // query growth), so this confirms that guarantee holds for this specific field too rather than
  // relying on "same code path" reasoning alone.
  it('Bulk EOBI Amount completes within target at 10,000-row scope', async () => {
    const start = Date.now();
    const res = await admin.agent
      .patch(`/api/v1/payroll-cycles/${cycleId}/entries/bulk`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ siteIds, field: 'eobiAmount', value: '550.00' });
    const ms = Date.now() - start;

    expect(res.status).toBe(200);
    expect(res.body.matchedCount).toBe(EMPLOYEE_COUNT);
    expect(res.body.appliedCount).toBe(EMPLOYEE_COUNT);
    // eslint-disable-next-line no-console
    console.log(`[perf] Bulk EOBI Amount across ${EMPLOYEE_COUNT} entries: ${ms}ms (target <=2000ms)`);
    expect(ms).toBeLessThan(10_000);

    const sample = await prisma.payrollEntry.findFirst({ where: { cycleId } });
    expect(sample?.eobiAmount.toString()).toBe('550');
  });

  it('export produces all 10,000 rows correctly, with its duration on record', async () => {
    const start = Date.now();
    const res = await admin.agent.get(`/api/v1/payroll-cycles/${cycleId}/entries/export?format=csv`);
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    const lines = res.text.trim().split('\n');
    expect(lines[0]).toBe(PAYROLL_ENTRY_TEMPLATE_HEADERS.join(','));
    expect(lines.length).toBe(EMPLOYEE_COUNT + 1);
    // eslint-disable-next-line no-console
    console.log(`[perf] export of ${EMPLOYEE_COUNT} rows to CSV: ${ms}ms (correctness-first, no strict target)`);
  });

});
