import { prisma } from '../src/lib/prisma';
import { cleanTestData, createTestUser } from './helpers';

/**
 * Phase 3 Checkpoint 0 — schema/migration-level tests only. There is no service or route layer
 * yet for PayrollCycle/PayrollEntry/PayrollEntryWorkLine (that's Checkpoint 1), so every test here
 * writes directly via Prisma, the same way Phase 2.5's composite-FK boundary test
 * (employees-import-export.test.ts, "layer 3") exercises the database constraint alone, bypassing
 * any application layer deliberately.
 *
 * Test PayrollCycle rows use `year: 2900` (a fake but valid smallint year) so `cleanTestData()`
 * can scope cleanup without a text column to prefix, per helpers.ts's comment.
 */
describe('Phase 3 Checkpoint 0 — PayrollCycle/PayrollEntry/PayrollEntryWorkLine schema', () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  async function makeSiteWithUnit(name: string) {
    const site = await prisma.projectSite.create({ data: { name } });
    const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} Unit`, code: 'U-1' } });
    return { site, unit };
  }

  async function makeEmployee(siteId: string, unitId: string, name: string) {
    return prisma.employee.create({
      data: { name, designation: 'Guard', siteId, unitId, grossPay: '30000' },
    });
  }

  async function makeCreatedByUser() {
    return createTestUser({
      email: 'payroll-schema-fixture@test.local',
      password: 'CorrectHorseBattery1!',
      roleCode: 'TEST_MASTER',
    });
  }

  async function makeCycle(userId: string, month = 1) {
    return prisma.payrollCycle.create({
      data: { year: 2900, month, createdBy: userId },
    });
  }

  it('creates a valid PayrollCycle + PayrollEntry + PayrollEntryWorkLine and reads back the relations', async () => {
    const { site, unit } = await makeSiteWithUnit('Test Site Payroll Happy Path');
    const employee = await makeEmployee(site.id, unit.id, 'Happy Path Employee');
    const user = await makeCreatedByUser();
    const cycle = await makeCycle(user.id);

    const entry = await prisma.payrollEntry.create({
      data: {
        cycleId: cycle.id,
        employeeId: employee.id,
        siteId: site.id,
        designation: employee.designation,
        grossPay: employee.grossPay,
        workLines: {
          create: [{ siteId: site.id, unitId: unit.id, days: '20', otHours: '2', cycleDays: 30 }],
        },
      },
      include: { workLines: true },
    });

    expect(entry.workLines).toHaveLength(1);
    expect(entry.workLines[0]?.unitId).toBe(unit.id);
  });

  it('enforces PayrollCycle unique(year, month)', async () => {
    const user = await makeCreatedByUser();
    await makeCycle(user.id, 3);
    await expect(makeCycle(user.id, 3)).rejects.toThrow(/unique constraint/i);
  });

  it.each([0, 13, -1])('rejects PayrollCycle.month = %i via the check constraint', async (month) => {
    const user = await makeCreatedByUser();
    await expect(
      prisma.payrollCycle.create({ data: { year: 2900, month, createdBy: user.id } }),
    ).rejects.toThrow(/check constraint|violates check/i);
  });

  it('rejects a PayrollEntryWorkLine whose unit belongs to a different site than the row itself (composite-FK boundary)', async () => {
    const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site Workline A');
    const { site: siteB } = await makeSiteWithUnit('Test Site Workline B');
    const unitB = await prisma.projectUnit.findFirstOrThrow({ where: { siteId: siteB.id } });
    const employee = await makeEmployee(siteA.id, unitA.id, 'Cross Site Employee');
    const user = await makeCreatedByUser();
    const cycle = await makeCycle(user.id);

    const entry = await prisma.payrollEntry.create({
      data: {
        cycleId: cycle.id,
        employeeId: employee.id,
        siteId: siteA.id,
        designation: employee.designation,
        grossPay: employee.grossPay,
        workLines: { create: [{ siteId: siteA.id, unitId: unitA.id, days: '10', cycleDays: 30 }] },
      },
    });

    // Bypasses any application-layer validation deliberately — the database must catch this
    // alone, per §12a's "enforced at two independent layers" requirement (this test covers the
    // database layer; the application-layer assertion is Checkpoint 1's concern).
    await expect(
      prisma.payrollEntryWorkLine.create({
        data: { payrollEntryId: entry.id, siteId: siteA.id, unitId: unitB.id, days: '5', cycleDays: 30 },
      }),
    ).rejects.toThrow(/foreign key|constraint/i);
  });

  it.each([0, 32, -1])('rejects PayrollEntryWorkLine.cycleDays = %i via the check constraint', async (cycleDays) => {
    const { site, unit } = await makeSiteWithUnit(`Test Site CycleDays ${cycleDays}`);
    const employee = await makeEmployee(site.id, unit.id, 'CycleDays Employee');
    const user = await makeCreatedByUser();
    const cycle = await makeCycle(user.id);

    await expect(
      prisma.payrollEntry.create({
        data: {
          cycleId: cycle.id,
          employeeId: employee.id,
          siteId: site.id,
          designation: employee.designation,
          grossPay: employee.grossPay,
          workLines: { create: [{ siteId: site.id, unitId: unit.id, days: '1', cycleDays }] },
        },
      }),
    ).rejects.toThrow(/check constraint|violates check/i);
  });

  it.each([1, 31])('accepts PayrollEntryWorkLine.cycleDays at its boundary value %i', async (cycleDays) => {
    const { site, unit } = await makeSiteWithUnit(`Test Site CycleDays Boundary ${cycleDays}`);
    const employee = await makeEmployee(site.id, unit.id, 'CycleDays Boundary Employee');
    const user = await makeCreatedByUser();
    const cycle = await makeCycle(user.id);

    const entry = await prisma.payrollEntry.create({
      data: {
        cycleId: cycle.id,
        employeeId: employee.id,
        siteId: site.id,
        designation: employee.designation,
        grossPay: employee.grossPay,
        workLines: { create: [{ siteId: site.id, unitId: unit.id, days: '1', cycleDays }] },
      },
      include: { workLines: true },
    });
    expect(entry.workLines[0]?.cycleDays).toBe(cycleDays);
  });

  it.each([
    ['days', '-1'],
    ['otHours', '-1'],
  ] as const)('rejects PayrollEntryWorkLine.%s = %s via the check constraint', async (field, value) => {
    const { site, unit } = await makeSiteWithUnit(`Test Site WorkLine Negative ${field}`);
    const employee = await makeEmployee(site.id, unit.id, 'Negative WorkLine Employee');
    const user = await makeCreatedByUser();
    const cycle = await makeCycle(user.id);

    await expect(
      prisma.payrollEntry.create({
        data: {
          cycleId: cycle.id,
          employeeId: employee.id,
          siteId: site.id,
          designation: employee.designation,
          grossPay: employee.grossPay,
          workLines: { create: [{ siteId: site.id, unitId: unit.id, cycleDays: 30, [field]: value }] },
        },
      }),
    ).rejects.toThrow(/check constraint|violates check/i);
  });

  it.each(['grossPay', 'allowance', 'leaveDays', 'eobiAmount', 'advanceDeduction', 'eidAdvanceDeduction', 'fine'])(
    'rejects PayrollEntry.%s = -1 via the check constraint',
    async (field) => {
      const { site, unit } = await makeSiteWithUnit(`Test Site Negative ${field}`);
      const employee = await makeEmployee(site.id, unit.id, 'Negative Field Employee');
      const user = await makeCreatedByUser();
      const cycle = await makeCycle(user.id);

      await expect(
        prisma.payrollEntry.create({
          data: {
            cycleId: cycle.id,
            employeeId: employee.id,
            siteId: site.id,
            designation: employee.designation,
            grossPay: '30000',
            [field]: '-1',
            workLines: { create: [{ siteId: site.id, unitId: unit.id, days: '1', cycleDays: 30 }] },
          },
        }),
      ).rejects.toThrow(/check constraint|violates check/i);
    },
  );

  it('rejects released = true without releasedAt/releasedBy populated', async () => {
    const { site, unit } = await makeSiteWithUnit('Test Site Released Fields');
    const employee = await makeEmployee(site.id, unit.id, 'Released Fields Employee');
    const user = await makeCreatedByUser();
    const cycle = await makeCycle(user.id);

    await expect(
      prisma.payrollEntry.create({
        data: {
          cycleId: cycle.id,
          employeeId: employee.id,
          siteId: site.id,
          designation: employee.designation,
          grossPay: '30000',
          released: true,
          workLines: { create: [{ siteId: site.id, unitId: unit.id, days: '1', cycleDays: 30 }] },
        },
      }),
    ).rejects.toThrow(/check constraint|violates check/i);
  });

  it('accepts released = true when releasedAt/releasedBy are both populated', async () => {
    const { site, unit } = await makeSiteWithUnit('Test Site Released Fields Valid');
    const employee = await makeEmployee(site.id, unit.id, 'Released Fields Valid Employee');
    const user = await makeCreatedByUser();
    const cycle = await makeCycle(user.id);

    const entry = await prisma.payrollEntry.create({
      data: {
        cycleId: cycle.id,
        employeeId: employee.id,
        siteId: site.id,
        designation: employee.designation,
        grossPay: '30000',
        released: true,
        releasedAt: new Date(),
        releasedBy: user.id,
        workLines: { create: [{ siteId: site.id, unitId: unit.id, days: '1', cycleDays: 30 }] },
      },
    });
    expect(entry.released).toBe(true);
  });

  it('rejects a populated lateReason when released is false', async () => {
    const { site, unit } = await makeSiteWithUnit('Test Site Late Reason');
    const employee = await makeEmployee(site.id, unit.id, 'Late Reason Employee');
    const user = await makeCreatedByUser();
    const cycle = await makeCycle(user.id);

    await expect(
      prisma.payrollEntry.create({
        data: {
          cycleId: cycle.id,
          employeeId: employee.id,
          siteId: site.id,
          designation: employee.designation,
          grossPay: '30000',
          lateReason: 'New hire added after Unit release',
          workLines: { create: [{ siteId: site.id, unitId: unit.id, days: '1', cycleDays: 30 }] },
        },
      }),
    ).rejects.toThrow(/check constraint|violates check/i);
  });

  it('enforces PayrollEntry unique(cycleId, employeeId) — exactly one entry per employee per cycle', async () => {
    const { site, unit } = await makeSiteWithUnit('Test Site One Entry Per Cycle');
    const employee = await makeEmployee(site.id, unit.id, 'One Entry Employee');
    const user = await makeCreatedByUser();
    const cycle = await makeCycle(user.id);

    const create = () =>
      prisma.payrollEntry.create({
        data: {
          cycleId: cycle.id,
          employeeId: employee.id,
          siteId: site.id,
          designation: employee.designation,
          grossPay: '30000',
          workLines: { create: [{ siteId: site.id, unitId: unit.id, days: '1', cycleDays: 30 }] },
        },
      });

    await create();
    await expect(create()).rejects.toThrow(/unique constraint/i);
  });

  it('enforces PayrollEntryWorkLine unique(payrollEntryId, unitId) — one line per unit per entry', async () => {
    const { site, unit } = await makeSiteWithUnit('Test Site One Line Per Unit');
    const employee = await makeEmployee(site.id, unit.id, 'One Line Per Unit Employee');
    const user = await makeCreatedByUser();
    const cycle = await makeCycle(user.id);

    const entry = await prisma.payrollEntry.create({
      data: {
        cycleId: cycle.id,
        employeeId: employee.id,
        siteId: site.id,
        designation: employee.designation,
        grossPay: '30000',
        workLines: { create: [{ siteId: site.id, unitId: unit.id, days: '1', cycleDays: 30 }] },
      },
    });

    await expect(
      prisma.payrollEntryWorkLine.create({
        data: { payrollEntryId: entry.id, siteId: site.id, unitId: unit.id, days: '5', cycleDays: 30 },
      }),
    ).rejects.toThrow(/unique constraint/i);
  });

  it('cascades: deleting a PayrollEntry deletes its PayrollEntryWorkLine rows, leaving no orphan', async () => {
    const { site, unit } = await makeSiteWithUnit('Test Site Cascade Delete');
    const employee = await makeEmployee(site.id, unit.id, 'Cascade Delete Employee');
    const user = await makeCreatedByUser();
    const cycle = await makeCycle(user.id);

    const entry = await prisma.payrollEntry.create({
      data: {
        cycleId: cycle.id,
        employeeId: employee.id,
        siteId: site.id,
        designation: employee.designation,
        grossPay: '30000',
        workLines: { create: [{ siteId: site.id, unitId: unit.id, days: '1', cycleDays: 30 }] },
      },
    });

    await prisma.payrollEntry.delete({ where: { id: entry.id } });

    const orphanLines = await prisma.payrollEntryWorkLine.findMany({ where: { payrollEntryId: entry.id } });
    expect(orphanLines).toHaveLength(0);
  });
});
