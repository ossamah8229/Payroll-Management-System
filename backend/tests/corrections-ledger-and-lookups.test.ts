import request from 'supertest';
import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

/**
 * Phase 6 Checkpoint 6 — the two minimal, read-only backend additions this checkpoint's own
 * "Backend changes policy" permits: `GET /adjustment-types` (the request-creation form's dropdown
 * source — no route listed these before this checkpoint) and `GET /balance-adjustments` (the
 * Corrections Ledger's own data source — Checkpoint 4's own module comment explicitly deferred
 * "list all BalanceAdjustments" as "the Corrections Ledger, explicitly out of this checkpoint's
 * scope"). Both reuse existing repository shapes verbatim; neither adds a lifecycle, a migration,
 * or a new permission key.
 */
describe('Phase 6 Checkpoint 6 — Corrections Ledger list route and Adjustment Type lookup', () => {
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
      permissionKeys: [PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.CORRECTIONS_APPROVE],
    });
  }

  async function payrollStaffAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.PAYROLL_STAFF,
      permissionKeys: [PERMISSIONS.PAYROLL_ENTRY],
      siteIds,
    });
  }

  async function financeAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.FINANCE,
      permissionKeys: [PERMISSIONS.PAYROLL_VIEW],
      siteIds,
    });
  }

  let cycleCounter = 0;
  function nextCycleYearMonth(): { year: number; month: number } {
    cycleCounter += 1;
    return { year: 2980 + Math.floor(cycleCounter / 12), month: (cycleCounter % 12) + 1 };
  }

  async function makeSiteWithUnit(name: string) {
    const site = await prisma.projectSite.create({ data: { name } });
    const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} Unit`, code: 'U-1' } });
    return { site, unit };
  }

  async function makeEmployee(siteId: string, unitId: string, name: string) {
    return prisma.employee.create({ data: { name, designation: 'Guard', siteId, unitId, grossPay: '30000' } });
  }

  async function makeAdjustmentType(code: string) {
    return prisma.adjustmentType.create({ data: { code: `TEST_${code}`, label: code } });
  }

  async function makeCycle(createdBy: string) {
    const { year, month } = nextCycleYearMonth();
    return prisma.payrollCycle.create({ data: { year, month, createdBy, status: 'RELEASED' } });
  }

  async function makeReleasedEntry(siteId: string, unitId: string, employeeId: string, cycleId: string, releasedBy: string) {
    return prisma.payrollEntry.create({
      data: {
        cycleId,
        employeeId,
        siteId,
        designation: 'Guard',
        grossPay: '30000',
        released: true,
        releasedAt: new Date(),
        releasedBy,
        workLines: { create: [{ siteId, unitId, days: '30', cycleDays: 30, otHours: '0' }] },
      },
    });
  }

  async function makeCorrection(payrollEntryId: string, adjustmentTypeId: string, approvedById: string) {
    return prisma.correction.create({
      data: {
        payrollEntryId,
        field: 'GROSS_PAY',
        oldValue: '30000',
        newValue: '35000',
        oldNetSalary: '30000',
        newNetSalary: '35000',
        adjustmentTypeId,
        reason: 'Attendance miscounted for this period',
        approvedById,
      },
    });
  }

  async function makeBalanceAdjustment(
    correctionId: string,
    employeeId: string,
    sourceCycleId: string,
    adjustmentTypeId: string,
    overrides: Partial<{ amount: string; type: 'PAYABLE' | 'RECOVERY'; status: 'PENDING' | 'SETTLED' }> = {},
  ) {
    const amount = overrides.amount ?? '5000';
    return prisma.balanceAdjustment.create({
      data: {
        correctionId,
        employeeId,
        sourceCycleId,
        adjustmentTypeId,
        amount,
        type: overrides.type ?? 'PAYABLE',
        remainingAmount: overrides.status === 'SETTLED' ? '0' : amount,
        status: overrides.status ?? 'PENDING',
        remark: 'Balance from a correction',
      },
    });
  }

  async function makeFixtures(label: string, siteName: string, options: { type?: 'PAYABLE' | 'RECOVERY'; status?: 'PENDING' | 'SETTLED' } = {}) {
    const { site, unit } = await makeSiteWithUnit(siteName);
    const employee = await makeEmployee(site.id, unit.id, `Employee ${label}`);
    const admin = await masterAdminAgent(`ledger-${label}-admin@test.local`);
    const cycle = await makeCycle(admin.userId);
    const entry = await makeReleasedEntry(site.id, unit.id, employee.id, cycle.id, admin.userId);
    const adjustmentType = await makeAdjustmentType(label);
    const correction = await makeCorrection(entry.id, adjustmentType.id, admin.userId);
    const balanceAdjustment = await makeBalanceAdjustment(correction.id, employee.id, cycle.id, adjustmentType.id, options);
    return { site, unit, employee, admin, cycle, entry, adjustmentType, correction, balanceAdjustment };
  }

  // --- GET /adjustment-types -----------------------------------------------------------------

  describe('GET /adjustment-types', () => {
    it('returns every active AdjustmentType, ordered by label', async () => {
      const admin = await masterAdminAgent('lookup-active-admin@test.local');
      await prisma.adjustmentType.create({ data: { code: 'TEST_ZZZ_LAST', label: 'ZZZ Last' } });
      await prisma.adjustmentType.create({ data: { code: 'TEST_AAA_FIRST', label: 'AAA First' } });

      const res = await admin.agent.get('/api/v1/adjustment-types');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.adjustmentTypes)).toBe(true);
      const labels = res.body.adjustmentTypes.map((t: { label: string }) => t.label);
      expect(labels.indexOf('AAA First')).toBeLessThan(labels.indexOf('ZZZ Last'));
    });

    it('excludes inactive AdjustmentTypes', async () => {
      const admin = await masterAdminAgent('lookup-inactive-admin@test.local');
      await prisma.adjustmentType.create({ data: { code: 'TEST_RETIRED', label: 'Retired Type', isActive: false } });

      const res = await admin.agent.get('/api/v1/adjustment-types');
      expect(res.status).toBe(200);
      const codes = res.body.adjustmentTypes.map((t: { code: string }) => t.code);
      expect(codes).not.toContain('TEST_RETIRED');
    });

    it('rejects an unauthenticated request', async () => {
      const res = await request(app).get('/api/v1/adjustment-types');
      expect(res.status).toBe(401);
    });

    it('rejects a caller lacking both payroll:entry and corrections:approve (Finance)', async () => {
      const { site } = await makeSiteWithUnit('Test Site CP6 Lookup Forbidden');
      const finance = await financeAgent('lookup-forbidden-finance@test.local', [site.id]);
      const res = await finance.agent.get('/api/v1/adjustment-types');
      expect(res.status).toBe(403);
    });

    it('a Payroll Staff caller (payroll:entry only) can list them', async () => {
      const { site } = await makeSiteWithUnit('Test Site CP6 Lookup Staff');
      const staff = await payrollStaffAgent('lookup-staff@test.local', [site.id]);
      const res = await staff.agent.get('/api/v1/adjustment-types');
      expect(res.status).toBe(200);
    });
  });

  // --- GET /balance-adjustments (list) --------------------------------------------------------

  describe('GET /balance-adjustments (Corrections Ledger list)', () => {
    it('lists every BalanceAdjustment for a Master Admin, unrestricted by site', async () => {
      const a = await makeFixtures('ledger-list-a', 'Test Site CP6 Ledger A');
      const b = await makeFixtures('ledger-list-b', 'Test Site CP6 Ledger B');

      const res = await a.admin.agent.get('/api/v1/balance-adjustments');
      expect(res.status).toBe(200);
      const ids = res.body.balanceAdjustments.map((row: { id: string }) => row.id);
      expect(ids).toEqual(expect.arrayContaining([a.balanceAdjustment.id, b.balanceAdjustment.id]));
    });

    it('site-scopes a non-Master caller to their own assigned sites', async () => {
      const inScope = await makeFixtures('ledger-scope-in', 'Test Site CP6 Ledger Scope In');
      const outOfScope = await makeFixtures('ledger-scope-out', 'Test Site CP6 Ledger Scope Out');
      const staff = await payrollStaffAgent('ledger-scope-staff@test.local', [inScope.site.id]);

      const res = await staff.agent.get('/api/v1/balance-adjustments');
      expect(res.status).toBe(200);
      const ids = res.body.balanceAdjustments.map((row: { id: string }) => row.id);
      expect(ids).toContain(inScope.balanceAdjustment.id);
      expect(ids).not.toContain(outOfScope.balanceAdjustment.id);
    });

    it('filters by status', async () => {
      const pending = await makeFixtures('ledger-filter-pending', 'Test Site CP6 Ledger Filter Pending', { status: 'PENDING' });
      const settled = await makeFixtures('ledger-filter-settled', 'Test Site CP6 Ledger Filter Settled', { status: 'SETTLED' });

      const res = await pending.admin.agent.get('/api/v1/balance-adjustments?status=SETTLED');
      expect(res.status).toBe(200);
      const ids = res.body.balanceAdjustments.map((row: { id: string }) => row.id);
      expect(ids).toContain(settled.balanceAdjustment.id);
      expect(ids).not.toContain(pending.balanceAdjustment.id);
    });

    it('filters by type', async () => {
      const payable = await makeFixtures('ledger-filter-payable', 'Test Site CP6 Ledger Filter Payable', { type: 'PAYABLE' });
      const recovery = await makeFixtures('ledger-filter-recovery', 'Test Site CP6 Ledger Filter Recovery', { type: 'RECOVERY' });

      const res = await payable.admin.agent.get('/api/v1/balance-adjustments?type=RECOVERY');
      expect(res.status).toBe(200);
      const ids = res.body.balanceAdjustments.map((row: { id: string }) => row.id);
      expect(ids).toContain(recovery.balanceAdjustment.id);
      expect(ids).not.toContain(payable.balanceAdjustment.id);
    });

    it('each returned row carries the same detail shape as the single-record GET (employee, adjustmentType, sourceCycle)', async () => {
      const fixture = await makeFixtures('ledger-shape', 'Test Site CP6 Ledger Shape');
      const res = await fixture.admin.agent.get('/api/v1/balance-adjustments');
      expect(res.status).toBe(200);
      const row = res.body.balanceAdjustments.find((r: { id: string }) => r.id === fixture.balanceAdjustment.id);
      expect(row).toBeDefined();
      expect(row.employee.name).toBe(fixture.employee.name);
      expect(row.adjustmentType.id).toBe(fixture.adjustmentType.id);
      expect(row.sourceCycle.id).toBe(fixture.cycle.id);
      expect(row.remainingAmount).toBe('5000');
    });

    it('rejects an unauthenticated request', async () => {
      const res = await request(app).get('/api/v1/balance-adjustments');
      expect(res.status).toBe(401);
    });

    it('rejects a caller lacking both payroll:entry and corrections:approve (Finance)', async () => {
      const { site } = await makeSiteWithUnit('Test Site CP6 Ledger Forbidden');
      const finance = await financeAgent('ledger-forbidden-finance@test.local', [site.id]);
      const res = await finance.agent.get('/api/v1/balance-adjustments');
      expect(res.status).toBe(403);
    });
  });
});
