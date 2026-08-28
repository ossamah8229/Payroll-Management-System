import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

/**
 * CalcNet Precision Rounding Fix (2026-08-28) — remediation checkpoint Step 9. Exercises the real
 * HTTP/service create and update paths (not fixture-only insertion) against the local test database,
 * using the exact `grossPay`/`days`/`cycleDays` combination this checkpoint's own audit reproduced
 * the precision defect with (190221.91 / 14 / 28 → earnedAmount 95110.96). Confirms a brand-new
 * `PayrollEntry` created with these values directly, and an existing entry that starts from a
 * different work-line shape and is then edited (via `PATCH /api/v1/work-lines/:id`) to reach the same
 * final state, compute byte-identical financial output — and that both reflect the FIXED formula, not
 * the pre-2026-08-28 one. Also re-confirms the underlying architectural assumption this checkpoint's
 * original audit relied on: `netSalary`/`earnedAmount` are computed fresh on every read (`calc` in the
 * response), never persisted, so there is nothing for a "new" and "existing" record to desync on.
 */
describe('CalcNet Precision Rounding Fix — new-vs-existing PayrollEntry regression (Step 9)', () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  async function masterAdminAgent(email: string) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.MASTER_ADMIN,
      permissionKeys: [PERMISSIONS.PAYROLL_CYCLE_MANAGE, PERMISSIONS.PAYROLL_ENTRY],
    });
  }

  async function makeSiteWithUnit(name: string) {
    const site = await prisma.projectSite.create({ data: { name } });
    const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} Unit`, code: 'U-1' } });
    return { site, unit };
  }

  async function makeDraftCycle(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, month: number) {
    const res = await admin.agent
      .post('/api/v1/payroll-cycles')
      .set('x-csrf-token', admin.csrfToken)
      .send({ year: 2901, month });
    return res.body.cycle as { id: string };
  }

  const KNOWN_BOUNDARY_GROSS_PAY = '190221.91';
  const EXPECTED_FIXED_EARNED_AMOUNT = '95110.96'; // was '95110.95' before the 2026-08-28 fix

  it('a NEW entry created directly with the boundary-triggering values computes the fixed (correct) earnedAmount', async () => {
    const admin = await masterAdminAgent('precision-new@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Precision New');
    const cycle = await makeDraftCycle(admin, 1);
    const employee = await prisma.employee.create({
      data: { name: 'Precision New Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: KNOWN_BOUNDARY_GROSS_PAY },
    });

    const created = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employee.id, workLines: [{ unitId: unit.id, days: '14', cycleDays: 28 }] });

    expect(created.status).toBe(201);
    expect(created.body.entry.calc.earnedAmount).toBe(EXPECTED_FIXED_EARNED_AMOUNT);

    // Re-read via the ordinary GET path too — confirms the figure is computed fresh on read
    // (`computeEntryCalc`), not merely returned once at creation time from some other code path.
    const fetched = await admin.agent.get(`/api/v1/payroll-entries/${created.body.entry.id}`).set('x-csrf-token', admin.csrfToken);
    expect(fetched.status).toBe(200);
    expect(fetched.body.entry.calc.earnedAmount).toBe(EXPECTED_FIXED_EARNED_AMOUNT);
  });

  it('an EXISTING entry, created with different values and then edited via the real update path to reach the identical final state, computes byte-identical financial output to the freshly-created equivalent', async () => {
    const admin = await masterAdminAgent('precision-existing@test.local');

    // "New" reference entry, as above.
    const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site Precision Existing New');
    const cycle = await makeDraftCycle(admin, 2);
    const employeeA = await prisma.employee.create({
      data: { name: 'Precision Reference Employee', designation: 'Guard', siteId: siteA.id, unitId: unitA.id, grossPay: KNOWN_BOUNDARY_GROSS_PAY },
    });
    const reference = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employeeA.id, workLines: [{ unitId: unitA.id, days: '14', cycleDays: 28 }] });
    expect(reference.status).toBe(201);

    // "Existing" entry: created with a deliberately different work line (default cycleDays 30, 0
    // days), matching how a real Draft entry starts life, then edited via the ordinary work-line
    // PATCH path to reach the exact same grossPay/days/cycleDays as the reference above — the
    // scenario this checkpoint's brief specifically asks about ("recalculated" existing records).
    const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site Precision Existing Recalc');
    const employeeB = await prisma.employee.create({
      data: { name: 'Precision Recalculated Employee', designation: 'Guard', siteId: siteB.id, unitId: unitB.id, grossPay: KNOWN_BOUNDARY_GROSS_PAY },
    });
    const existing = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId: employeeB.id });
    expect(existing.status).toBe(201);
    // Sanity: the default work line does NOT yet match the boundary case (0 days, cycleDays 30) —
    // this genuinely starts from a different state, not a disguised copy of the reference.
    expect(existing.body.entry.calc.earnedAmount).toBe('0.00');

    const workLineId = existing.body.entry.workLines[0].id;
    const recalculated = await admin.agent
      .patch(`/api/v1/work-lines/${workLineId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: existing.body.entry.version, days: '14', cycleDays: 28 });
    expect(recalculated.status).toBe(200);

    // The two entries are distinct rows for distinct employees/units, but their financial inputs are
    // now identical — the checkpoint's central claim is that calculated output must therefore also be
    // identical, since nothing is ever persisted and both go through the exact same `computeEntryCalc`.
    expect(recalculated.body.entry.calc.earnedAmount).toBe(reference.body.entry.calc.earnedAmount);
    expect(recalculated.body.entry.calc.earnedAmount).toBe(EXPECTED_FIXED_EARNED_AMOUNT);
    expect(recalculated.body.entry.calc.netSalary).toBe(reference.body.entry.calc.netSalary);

    // Confirms the "computed fresh, never persisted" assumption survives the fix: no `netSalary` or
    // `earnedAmount` column exists on the stored row at all.
    const storedColumns = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'PayrollEntry'`,
    );
    const columnNames = storedColumns.map((c) => c.column_name);
    expect(columnNames).not.toContain('netSalary');
    expect(columnNames).not.toContain('earnedAmount');
  });
});
