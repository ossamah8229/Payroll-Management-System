import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { computeEntryCalc, type EntryWithWorkLines } from '../src/modules/payroll-entry/payroll-entry.service';
import { PRE_MIGRATION_SAFE_PAYROLL_ENTRY_SELECT } from '../scripts/find-negative-released-entries';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

/**
 * Negative Payroll Recovery checkpoint (2026-07-27 fix) — regression coverage for the pre-migration
 * P2022 fix in `scripts/find-negative-released-entries.ts`. That diagnostic must run against a
 * database that has NOT yet applied migration `20260726120000_negative_payroll_recovery_schema` (it
 * exists specifically to find bad data before that migration is deployed), so it must never select
 * `PayrollEntry.payoutOutcome` — a column that migration adds. This suite guards two things: (1) the
 * select shape itself never reintroduces that column, and (2) the calculation the script performs
 * with its narrowed select produces the exact same `netSalary` as the full, unrestricted entry would
 * — the fix must never change what counts as "negative," only which columns get fetched.
 */
describe('find-negative-released-entries.ts — pre-migration-safe select', () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  it('never selects payoutOutcome — the one column added by the migration this script must run before', () => {
    expect(Object.prototype.hasOwnProperty.call(PRE_MIGRATION_SAFE_PAYROLL_ENTRY_SELECT, 'payoutOutcome')).toBe(false);
  });

  it('selects every PayrollEntry/PayrollEntryWorkLine field computeEntryCalc actually reads', () => {
    const entryFields = [
      'grossPay',
      'allowance',
      'leaveDays',
      'leaveRate',
      'eobiAmount',
      'eobiApplicable',
      'advanceDeduction',
      'eidAdvanceDeduction',
      'fine',
      'correctionBalancePayable',
      'correctionBalanceRecovery',
    ];
    for (const field of entryFields) {
      expect(Object.prototype.hasOwnProperty.call(PRE_MIGRATION_SAFE_PAYROLL_ENTRY_SELECT, field)).toBe(true);
    }

    const workLineSelect = PRE_MIGRATION_SAFE_PAYROLL_ENTRY_SELECT.workLines.select;
    const workLineFields = ['sortOrder', 'days', 'otHours', 'otRate', 'cycleDays'];
    for (const field of workLineFields) {
      expect(Object.prototype.hasOwnProperty.call(workLineSelect, field)).toBe(true);
    }
  });

  it('produces the exact same netSalary as the full, unrestricted entry fetch (calculation equivalence)', async () => {
    const admin = await createAuthenticatedAgent(app, {
      email: 'negative-script-admin@test.local',
      password: PASSWORD,
      roleCode: ROLE_CODES.MASTER_ADMIN,
      permissionKeys: [PERMISSIONS.PAYROLL_CYCLE_MANAGE, PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.PAYROLL_RELEASE],
    });

    const site = await prisma.projectSite.create({ data: { name: 'Test Site Negative Script Diagnostic' } });
    const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'Diagnostic Unit' } });
    const employee = await prisma.employee.create({
      data: { name: 'Negative Script Diagnostic Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });

    const cycleRes = await admin.agent
      .post('/api/v1/payroll-cycles')
      .set('x-csrf-token', admin.csrfToken)
      .send({ year: 2900, month: 4 });
    expect(cycleRes.status).toBe(201);
    const cycleId = cycleRes.body.cycle.id as string;

    const entriesRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycleId}/entries?employeeId=${employee.id}`);
    const entryId = entriesRes.body.entries[0].id as string;

    // Simulate the exact pre-existing-bad-data pattern this diagnostic exists to find: a row marked
    // released = true with a negative net salary (the default 0-work-day entry already nets -400
    // from its own EOBI deduction) — bypassing the application's own release-time guard directly at
    // the database layer, since that guard is precisely what this checkpoint's fix (not this script)
    // is responsible for; this test only needs the bad row to exist.
    await prisma.payrollEntry.update({
      where: { id: entryId },
      data: { released: true, releasedAt: new Date(), releasedBy: admin.userId },
    });

    const fullEntry = await prisma.payrollEntry.findUniqueOrThrow({
      where: { id: entryId },
      include: { workLines: true },
    });
    const expectedCalc = computeEntryCalc(fullEntry as EntryWithWorkLines);
    expect(expectedCalc.netSalary).toBe('-400.00');

    const narrowEntry = await prisma.payrollEntry.findUniqueOrThrow({
      where: { id: entryId },
      select: PRE_MIGRATION_SAFE_PAYROLL_ENTRY_SELECT,
    });
    const narrowEntryForCalc = { ...narrowEntry, payoutOutcome: null } as unknown as EntryWithWorkLines;
    const actualCalc = computeEntryCalc(narrowEntryForCalc);

    expect(actualCalc.netSalary).toBe(expectedCalc.netSalary);
    expect(Number(actualCalc.netSalary)).toBeLessThan(0);
  });
});
