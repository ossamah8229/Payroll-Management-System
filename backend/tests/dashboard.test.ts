import request from 'supertest';
import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent, assertNoSensitiveKeys } from './helpers';

/**
 * Dashboard Checkpoint 1A — backend foundation. Verifies: route-level outer gate
 * (`reports:view OR payroll:view`); independent per-widget permission enforcement regardless of
 * what the outer gate happens to guarantee; Site authorization/scoping consistency across every
 * widget in one response; no sensitive-field leakage; empty/cycle-state handling; and exact
 * reconciliation against the authoritative Payroll Summary Report for every shared financial figure
 * (Net Payroll, Pending Release, Release Progress, Deduction Breakdown, Site Summary) — never a
 * manually copied expected value, always compared against that report's own live output.
 */

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

const FORBIDDEN_KEYS = [
  'cnic',
  'accountnumber',
  'iban',
  'bank',
  'branchcode',
  'releasedby',
  'reason',
  'employeename',
  'employeecode',
  'actorid',
  'requestedby',
  'reviewedby',
  'correctionreason',
  'grosspay',
];

describe('Dashboard Checkpoint 1A', () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  // --- Agents --------------------------------------------------------------------------------

  async function masterAdminAgent(email: string) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.MASTER_ADMIN,
      permissionKeys: [
        PERMISSIONS.PAYROLL_CYCLE_MANAGE,
        PERMISSIONS.PAYROLL_ENTRY,
        PERMISSIONS.PAYROLL_VIEW,
        PERMISSIONS.PAYROLL_RELEASE,
        PERMISSIONS.REPORTS_VIEW,
        PERMISSIONS.EMPLOYEES_VIEW,
        PERMISSIONS.CORRECTIONS_APPROVE,
        PERMISSIONS.ADVANCES_MANAGE,
      ],
    });
  }

  /** Holds exactly `reports:view` — one of the two approved outer-gate OR permissions, and none of
   * the three independent widget permissions (`employees:view`, `corrections:approve`,
   * `advances:manage`). */
  async function reportsOnlyAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_DASH_REPORTS_ONLY',
      permissionKeys: [PERMISSIONS.REPORTS_VIEW],
      siteIds,
    });
  }

  /** A real `FINANCE`-role-coded agent — `payroll:view` but deliberately no `reports:view`,
   * `employees:view`, `corrections:approve`, or `advances:manage` — proves the OR-gate's other half
   * grants route access while every `reports:view`-only widget stays `null`. */
  async function financeAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.FINANCE,
      permissionKeys: [PERMISSIONS.PAYROLL_VIEW, PERMISSIONS.PAYROLL_RELEASE, PERMISSIONS.BANK_SHEETS_VIEW],
      siteIds,
    });
  }

  async function reportsPlusEmployeesAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_DASH_REPORTS_EMP',
      permissionKeys: [PERMISSIONS.REPORTS_VIEW, PERMISSIONS.EMPLOYEES_VIEW],
      siteIds,
    });
  }

  async function reportsPlusCorrectionsAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_DASH_REPORTS_CORR',
      permissionKeys: [PERMISSIONS.REPORTS_VIEW, PERMISSIONS.CORRECTIONS_APPROVE],
      siteIds,
    });
  }

  async function reportsPlusAdvancesAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_DASH_REPORTS_ADV',
      permissionKeys: [PERMISSIONS.REPORTS_VIEW, PERMISSIONS.ADVANCES_MANAGE],
      siteIds,
    });
  }

  /** Holds `statements:view` only — proves this endpoint is never reachable through Statements'/
   * Employee Payroll History's own, more sensitive permission. */
  async function statementsOnlyAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_DASH_STATEMENTS_ONLY',
      permissionKeys: [PERMISSIONS.STATEMENTS_VIEW],
      siteIds,
    });
  }

  async function noPermissionAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_DASH_NO_PERMS',
      permissionKeys: [],
      siteIds,
    });
  }

  // --- Fixture ---------------------------------------------------------------------------------

  interface Fixture {
    adminUserId: string;
    siteAId: string;
    siteBId: string;
    unitAId: string;
    unitBId: string;
    cycleId: string;
    entryA1Id: string; // siteA, released, positive net
    entryA2Id: string; // siteA, held
    entryB1Id: string; // siteB, pending
  }

  /** One Draft cycle, two Sites (A: released + held entries; B: one pending entry), one PENDING
   * `CorrectionRequest` against the released Site-A entry, and one `ACTIVE` Advance with a genuine
   * outstanding balance for a Site-A employee. Deliberately mixed release-state buckets and a
   * cross-site split so every widget/site-scope assertion below has real, non-degenerate data to
   * check against. */
  async function seedFixture(adminUserId: string): Promise<Fixture> {
    const siteA = await prisma.projectSite.create({ data: { name: 'Test Site Dashboard A' } });
    const siteB = await prisma.projectSite.create({ data: { name: 'Test Site Dashboard B' } });
    const unitA = await prisma.projectUnit.create({ data: { siteId: siteA.id, name: 'Dash Unit A', code: 'DASH-A' } });
    const unitB = await prisma.projectUnit.create({ data: { siteId: siteB.id, name: 'Dash Unit B', code: 'DASH-B' } });

    const empA1 = await prisma.employee.create({
      data: { employeeCode: 'DASH-A1', name: 'Dash Employee A1', designation: 'Guard', siteId: siteA.id, unitId: unitA.id, grossPay: '30000' },
    });
    // Excluded from Total Employees (dateOfLeaving set) — proves the widget filters to the active
    // roster, not a blanket site headcount.
    await prisma.employee.create({
      data: {
        employeeCode: 'DASH-A2',
        name: 'Dash Employee A2 (Left)',
        designation: 'Guard',
        siteId: siteA.id,
        unitId: unitA.id,
        grossPay: '30000',
        dateOfLeaving: new Date(2020, 0, 1),
      },
    });
    const empB1 = await prisma.employee.create({
      data: { employeeCode: 'DASH-B1', name: 'Dash Employee B1', designation: 'Guard', siteId: siteB.id, unitId: unitB.id, grossPay: '25000' },
    });

    const cycle = await prisma.payrollCycle.create({ data: { year: 2999, month: 1, createdBy: adminUserId, status: 'DRAFT' } });

    const entryA1 = await prisma.payrollEntry.create({
      data: {
        cycleId: cycle.id,
        employeeId: empA1.id,
        siteId: siteA.id,
        designation: 'Guard',
        grossPay: '30000',
        eobiAmount: '400',
        eobiApplicable: true,
        advanceDeduction: '500',
        fine: '100',
        hold: false,
        released: true,
        releasedAt: new Date(),
        releasedBy: adminUserId,
        payoutOutcome: null,
      },
    });
    await prisma.payrollEntryWorkLine.create({
      data: { payrollEntryId: entryA1.id, siteId: siteA.id, unitId: unitA.id, days: '26', otHours: '0', cycleDays: 30 },
    });

    // A dedicated third Site-A employee for the held entry — `(cycleId, employeeId)` is unique, so
    // this cannot reuse empA1's own id (already entryA1's employee), and empB1 belongs to Site B.
    const empA3 = await prisma.employee.create({
      data: { employeeCode: 'DASH-A3', name: 'Dash Employee A3', designation: 'Guard', siteId: siteA.id, unitId: unitA.id, grossPay: '28000' },
    });
    const entryA2 = await prisma.payrollEntry.create({
      data: {
        cycleId: cycle.id,
        employeeId: empA3.id,
        siteId: siteA.id,
        designation: 'Guard',
        grossPay: '30000',
        hold: true,
        released: false,
        payoutOutcome: null,
      },
    });
    await prisma.payrollEntryWorkLine.create({
      data: { payrollEntryId: entryA2.id, siteId: siteA.id, unitId: unitA.id, days: '26', otHours: '0', cycleDays: 30 },
    });

    const entryB1 = await prisma.payrollEntry.create({
      data: {
        cycleId: cycle.id,
        employeeId: empB1.id,
        siteId: siteB.id,
        designation: 'Guard',
        grossPay: '25000',
        hold: false,
        released: false,
        payoutOutcome: null,
      },
    });
    await prisma.payrollEntryWorkLine.create({
      data: { payrollEntryId: entryB1.id, siteId: siteB.id, unitId: unitB.id, days: '26', otHours: '0', cycleDays: 30 },
    });

    const adjustmentType = await prisma.adjustmentType.create({ data: { code: 'TEST_DASH_ADJ', label: 'Test Dashboard Adjustment' } });
    await prisma.correctionRequest.create({
      data: {
        payrollEntryId: entryA1.id,
        field: 'FINE',
        proposedNewValue: '150.00',
        adjustmentTypeId: adjustmentType.id,
        reason: 'Test correction reason',
        requestedById: adminUserId,
        status: 'PENDING',
      },
    });

    await prisma.advance.create({
      data: {
        employeeId: empA1.id,
        type: 'LOAN',
        totalAmount: '5000',
        outstandingBalance: '3000',
        dateGiven: new Date(2026, 0, 1),
        repaymentType: 'INSTALLMENT',
        status: 'ACTIVE',
      },
    });

    return {
      adminUserId,
      siteAId: siteA.id,
      siteBId: siteB.id,
      unitAId: unitA.id,
      unitBId: unitB.id,
      cycleId: cycle.id,
      entryA1Id: entryA1.id,
      entryA2Id: entryA2.id,
      entryB1Id: entryB1.id,
    };
  }

  // --- Route authorization ----------------------------------------------------------------------

  describe('route authorization', () => {
    it('rejects an unauthenticated request with 401', async () => {
      const res = await request(app).get('/api/v1/dashboard');
      expect(res.status).toBe(401);
    });

    it('rejects statements:view alone with 403', async () => {
      const admin = await masterAdminAgent('dash-route-admin1@test.local');
      const fixture = await seedFixture(admin.userId);
      const agent = await statementsOnlyAgent('dash-route-stmt@test.local', [fixture.siteAId]);
      const res = await agent.agent.get('/api/v1/dashboard');
      expect(res.status).toBe(403);
    });

    it('rejects a user with no relevant permission with 403', async () => {
      const admin = await masterAdminAgent('dash-route-admin2@test.local');
      const fixture = await seedFixture(admin.userId);
      const agent = await noPermissionAgent('dash-route-none@test.local', [fixture.siteAId]);
      const res = await agent.agent.get('/api/v1/dashboard');
      expect(res.status).toBe(403);
    });

    it('allows reports:view alone', async () => {
      const admin = await masterAdminAgent('dash-route-admin3@test.local');
      const fixture = await seedFixture(admin.userId);
      const agent = await reportsOnlyAgent('dash-route-reports@test.local', [fixture.siteAId]);
      const res = await agent.agent.get('/api/v1/dashboard');
      expect(res.status).toBe(200);
    });

    it('allows payroll:view alone', async () => {
      const admin = await masterAdminAgent('dash-route-admin4@test.local');
      const fixture = await seedFixture(admin.userId);
      const agent = await financeAgent('dash-route-finance@test.local', [fixture.siteAId]);
      const res = await agent.agent.get('/api/v1/dashboard');
      expect(res.status).toBe(200);
    });

    it('allows a user holding both', async () => {
      const admin = await masterAdminAgent('dash-route-admin5@test.local');
      await seedFixture(admin.userId);
      const res = await admin.agent.get('/api/v1/dashboard');
      expect(res.status).toBe(200);
    });
  });

  // --- Widget-level permissions ------------------------------------------------------------------

  describe('widget-level permissions', () => {
    it('a reports:view-only user sees reports-owned widgets, but totalEmployees/attention items requiring a separate permission are null', async () => {
      const admin = await masterAdminAgent('dash-widget-admin1@test.local');
      const fixture = await seedFixture(admin.userId);
      const agent = await reportsOnlyAgent('dash-widget-reports@test.local', [fixture.siteAId, fixture.siteBId]);

      const res = await agent.agent.get('/api/v1/dashboard');
      expect(res.status).toBe(200);
      expect(res.body.netPayroll).not.toBeNull();
      expect(res.body.deductionBreakdown).not.toBeNull();
      expect(res.body.siteSummary).not.toBeNull();
      expect(res.body.pendingRelease).not.toBeNull();
      expect(res.body.releaseProgress).not.toBeNull();
      expect(res.body.totalEmployees).toBeNull();
      expect(res.body.attention.pendingCorrections).toBeNull();
      expect(res.body.attention.recoveryDue).toBeNull();
      // Held Entries is never permission-gated to null (§ doc comment) — always present.
      expect(res.body.attention.heldEntries).not.toBeNull();
    });

    it('a payroll:view-only (Finance) user sees payroll-operational widgets, but reports:view-only widgets are null', async () => {
      const admin = await masterAdminAgent('dash-widget-admin2@test.local');
      const fixture = await seedFixture(admin.userId);
      const agent = await financeAgent('dash-widget-finance@test.local', [fixture.siteAId, fixture.siteBId]);

      const res = await agent.agent.get('/api/v1/dashboard');
      expect(res.status).toBe(200);
      expect(res.body.pendingRelease).not.toBeNull();
      expect(res.body.releaseProgress).not.toBeNull();
      expect(res.body.netPayroll).toBeNull();
      expect(res.body.deductionBreakdown).toBeNull();
      expect(res.body.siteSummary).toBeNull();
      expect(res.body.siteSummaryTotalSites).toBeNull();
      expect(res.body.totalEmployees).toBeNull();
      expect(res.body.attention.pendingCorrections).toBeNull();
      expect(res.body.attention.recoveryDue).toBeNull();
    });

    it('totalEmployees is populated only when employees:view is held', async () => {
      const admin = await masterAdminAgent('dash-widget-admin3@test.local');
      const fixture = await seedFixture(admin.userId);
      const agent = await reportsPlusEmployeesAgent('dash-widget-emp@test.local', [fixture.siteAId, fixture.siteBId]);

      const res = await agent.agent.get('/api/v1/dashboard');
      expect(res.status).toBe(200);
      expect(res.body.totalEmployees).toBe(3); // A1, A3, B1 — A2 excluded (dateOfLeaving set)
    });

    it('pendingCorrections is populated only when corrections:approve is held', async () => {
      const admin = await masterAdminAgent('dash-widget-admin4@test.local');
      const fixture = await seedFixture(admin.userId);
      const agent = await reportsPlusCorrectionsAgent('dash-widget-corr@test.local', [fixture.siteAId, fixture.siteBId]);

      const res = await agent.agent.get('/api/v1/dashboard');
      expect(res.status).toBe(200);
      expect(res.body.attention.pendingCorrections).toEqual({ count: 1 });
    });

    it('recoveryDue is populated only when advances:manage is held, and includes an outstanding-balance amount', async () => {
      const admin = await masterAdminAgent('dash-widget-admin5@test.local');
      const fixture = await seedFixture(admin.userId);
      const agent = await reportsPlusAdvancesAgent('dash-widget-adv@test.local', [fixture.siteAId, fixture.siteBId]);

      const res = await agent.agent.get('/api/v1/dashboard');
      expect(res.status).toBe(200);
      expect(res.body.attention.recoveryDue).toEqual({ count: 1, amount: '3000.00' });
    });

    it('Master Admin sees every widget populated', async () => {
      const admin = await masterAdminAgent('dash-widget-admin6@test.local');
      await seedFixture(admin.userId);

      const res = await admin.agent.get('/api/v1/dashboard');
      expect(res.status).toBe(200);
      for (const key of ['netPayroll', 'pendingRelease', 'releaseProgress', 'deductionBreakdown', 'siteSummary', 'totalEmployees']) {
        expect(res.body[key]).not.toBeNull();
      }
      expect(res.body.attention.heldEntries).not.toBeNull();
      expect(res.body.attention.pendingCorrections).not.toBeNull();
      expect(res.body.attention.recoveryDue).not.toBeNull();
    });
  });

  // --- Site scope ----------------------------------------------------------------------------

  describe('Site scope', () => {
    it('a Site-scoped user only sees their assigned Site in siteSummary/totals, never the other Site', async () => {
      const admin = await masterAdminAgent('dash-site-admin1@test.local');
      const fixture = await seedFixture(admin.userId);
      const agent = await reportsPlusEmployeesAgent('dash-site-scoped@test.local', [fixture.siteAId]);

      const res = await agent.agent.get('/api/v1/dashboard');
      expect(res.status).toBe(200);
      expect(res.body.siteScope.siteIds).toEqual([fixture.siteAId]);
      const siteIdsInSummary = res.body.siteSummary.map((row: { siteId: string }) => row.siteId);
      expect(siteIdsInSummary).toContain(fixture.siteAId);
      expect(siteIdsInSummary).not.toContain(fixture.siteBId);
      // A1 + A3 only (A2 has left) — Site B's employee never counted for a Site-A-only scope.
      expect(res.body.totalEmployees).toBe(2);
      // releaseProgress.totalCount must reflect only Site A's 2 entries (A1 released, A2 held),
      // never Site B's own entry.
      expect(res.body.releaseProgress.totalCount).toBe(2);
    });

    it('a global (Master Admin) user sees every accessible Site', async () => {
      const admin = await masterAdminAgent('dash-site-admin2@test.local');
      const fixture = await seedFixture(admin.userId);

      const res = await admin.agent.get('/api/v1/dashboard');
      expect(res.status).toBe(200);
      expect(res.body.siteScope.siteIds).toBeNull();
      const siteIdsInSummary = res.body.siteSummary.map((row: { siteId: string }) => row.siteId);
      expect(siteIdsInSummary).toEqual(expect.arrayContaining([fixture.siteAId, fixture.siteBId]));
      expect(res.body.releaseProgress.totalCount).toBe(3);
    });

    /** Hostile-review §4: `totalEmployees`/`recoveryDue` scope by *current* `Employee.siteId`;
     * every historical payroll widget scopes by `PayrollEntry.siteId` instead. Simulates a real
     * Site transfer — the entry/Advance stay attached to the employee's original Site (A) while
     * `Employee.siteId` itself moves to Site B — then proves a Site-B-only-scoped viewer sees the
     * employee (current roster) and their Recovery Due (current Employee.siteId), but never the
     * Site-A-scoped historical `PayrollEntry` amount merely because the employee's current
     * `Employee.siteId` happens to be accessible. */
    it('a transferred employee cannot leak an inaccessible historical PayrollEntry amount via their current, accessible Employee.siteId', async () => {
      const admin = await masterAdminAgent('dash-xfer-admin@test.local');
      const siteA = await prisma.projectSite.create({ data: { name: 'Test Site Dash Xfer A' } });
      const siteB = await prisma.projectSite.create({ data: { name: 'Test Site Dash Xfer B' } });
      const unitA = await prisma.projectUnit.create({ data: { siteId: siteA.id, name: 'Dash Xfer Unit A', code: 'DASH-XFER-A' } });
      const unitB = await prisma.projectUnit.create({ data: { siteId: siteB.id, name: 'Dash Xfer Unit B', code: 'DASH-XFER-B' } });

      const emp = await prisma.employee.create({
        data: { employeeCode: 'DASH-XFER-1', name: 'Dash Transfer Employee', designation: 'Guard', siteId: siteA.id, unitId: unitA.id, grossPay: '30000' },
      });
      const cycle = await prisma.payrollCycle.create({ data: { year: 2993, month: 1, createdBy: admin.userId, status: 'DRAFT' } });
      const entry = await prisma.payrollEntry.create({
        data: { cycleId: cycle.id, employeeId: emp.id, siteId: siteA.id, designation: 'Guard', grossPay: '30000', hold: false, released: true, releasedAt: new Date(), releasedBy: admin.userId, payoutOutcome: null },
      });
      await prisma.payrollEntryWorkLine.create({
        data: { payrollEntryId: entry.id, siteId: siteA.id, unitId: unitA.id, days: '26', otHours: '0', cycleDays: 30 },
      });
      await prisma.advance.create({
        data: { employeeId: emp.id, type: 'LOAN', totalAmount: '2000', outstandingBalance: '1200', dateGiven: new Date(2026, 0, 1), repaymentType: 'INSTALLMENT', status: 'ACTIVE' },
      });

      // The transfer: current Employee.siteId (and its required matching unitId) moves to Site B;
      // the already-created PayrollEntry (and its site-A work line/site) is deliberately left
      // untouched — the historical fact never moves with the employee.
      await prisma.employee.update({ where: { id: emp.id }, data: { siteId: siteB.id, unitId: unitB.id } });

      const agent = await createAuthenticatedAgent(app, {
        email: 'dash-xfer-scoped@test.local',
        password: PASSWORD,
        roleCode: 'TEST_DASH_XFER_SCOPED',
        permissionKeys: [PERMISSIONS.REPORTS_VIEW, PERMISSIONS.EMPLOYEES_VIEW, PERMISSIONS.ADVANCES_MANAGE],
        siteIds: [siteB.id],
      });

      const res = await agent.agent.get('/api/v1/dashboard');
      expect(res.status).toBe(200);
      // Current roster: the employee's current Employee.siteId (B) is accessible.
      expect(res.body.totalEmployees).toBe(1);
      // Recovery Due follows the same current Employee.siteId — accessible.
      expect(res.body.attention.recoveryDue).toEqual({ count: 1, amount: '1200.00' });
      // Historical PayrollEntry.siteId (A) is NOT accessible to this Site-B-only viewer — the
      // released entry must not surface through any cycle-scoped widget merely because the
      // employee who owns it currently sits in an accessible Site.
      expect(res.body.netPayroll).toBe('0.00');
      expect(res.body.releaseProgress.totalCount).toBe(0);
      expect(res.body.releaseProgress.releasedAmount).toBe('0.00');
      expect(res.body.siteSummary).toEqual([]);
      const siteIdsInSummary = res.body.siteSummary.map((row: { siteId: string }) => row.siteId);
      expect(siteIdsInSummary).not.toContain(siteA.id);
    });

    /** Hostile-review §9: a Site-scoped user assigned to zero Sites must see a safe empty state on
     * every Site-scoped widget — never a global total computed and then filtered. */
    it('a Site-scoped user assigned to zero Sites sees a safe empty state, never a global total', async () => {
      const admin = await masterAdminAgent('dash-zero-site-admin@test.local');
      await seedFixture(admin.userId); // real cross-site data exists in the system

      const agent = await createAuthenticatedAgent(app, {
        email: 'dash-zero-site@test.local',
        password: PASSWORD,
        roleCode: 'TEST_DASH_ZERO_SITE',
        permissionKeys: [PERMISSIONS.REPORTS_VIEW, PERMISSIONS.EMPLOYEES_VIEW, PERMISSIONS.ADVANCES_MANAGE],
        siteIds: [],
      });

      const res = await agent.agent.get('/api/v1/dashboard');
      expect(res.status).toBe(200);
      expect(res.body.siteScope.siteIds).toEqual([]);
      expect(res.body.totalEmployees).toBe(0);
      expect(res.body.netPayroll).toBe('0.00');
      expect(res.body.releaseProgress.totalCount).toBe(0);
      expect(res.body.siteSummary).toEqual([]);
      expect(res.body.siteSummaryTotalSites).toBe(0);
      expect(res.body.attention.recoveryDue).toEqual({ count: 0, amount: '0.00' });
    });
  });

  // --- Sensitive data --------------------------------------------------------------------------

  it('never leaks CNIC, banking, actor identity, correction reason, or employee names', async () => {
    const admin = await masterAdminAgent('dash-sensitive-admin@test.local');
    await seedFixture(admin.userId);

    const res = await admin.agent.get('/api/v1/dashboard');
    expect(res.status).toBe(200);
    assertNoSensitiveKeys(res.body, FORBIDDEN_KEYS);
  });

  // --- Empty states ----------------------------------------------------------------------------

  describe('empty states', () => {
    it('no PayrollCycle at all → cycle: null, cycle-scoped widgets null, non-cycle-scoped widgets still populated', async () => {
      const admin = await masterAdminAgent('dash-empty-admin1@test.local');
      // No seedFixture call — genuinely zero cycles/sites/employees exist for this test.
      const res = await admin.agent.get('/api/v1/dashboard');
      expect(res.status).toBe(200);
      expect(res.body.cycle).toBeNull();
      expect(res.body.netPayroll).toBeNull();
      expect(res.body.pendingRelease).toBeNull();
      expect(res.body.releaseProgress).toBeNull();
      expect(res.body.deductionBreakdown).toBeNull();
      expect(res.body.siteSummary).toEqual([]);
      expect(res.body.siteSummaryTotalSites).toBe(0);
      expect(res.body.attention.heldEntries).toEqual({ count: 0 });
      expect(res.body.attention.pendingCorrections).toEqual({ count: 0 });
      expect(res.body.attention.recoveryDue).toEqual({ count: 0, amount: '0.00' });
      expect(res.body.totalEmployees).toBe(0);
    });

    it('an Archived-only cycle is used normally, not treated as an error', async () => {
      const admin = await masterAdminAgent('dash-empty-admin2@test.local');
      const fixture = await seedFixture(admin.userId);
      await prisma.payrollCycle.update({
        where: { id: fixture.cycleId },
        data: { status: 'ARCHIVED', archivedBy: admin.userId, archivedAt: new Date() },
      });

      const res = await admin.agent.get('/api/v1/dashboard');
      expect(res.status).toBe(200);
      expect(res.body.cycle.id).toBe(fixture.cycleId);
      expect(res.body.cycle.status).toBe('ARCHIVED');
      expect(res.body.netPayroll).not.toBeNull();
    });
  });

  // --- Reconciliation against the authoritative Payroll Summary Report ---------------------------

  describe('source reconciliation', () => {
    it('netPayroll/pendingRelease/deductionBreakdown/siteSummary exactly reconcile with the live Payroll Summary Report for the same cycle/site scope', async () => {
      const admin = await masterAdminAgent('dash-recon-admin@test.local');
      const fixture = await seedFixture(admin.userId);

      const [dashboardRes, summaryRes] = await Promise.all([
        admin.agent.get('/api/v1/dashboard'),
        admin.agent.get(`/api/v1/reports/payroll-summary?cycleId=${fixture.cycleId}&pageSize=100`),
      ]);
      expect(dashboardRes.status).toBe(200);
      expect(summaryRes.status).toBe(200);

      const totals = summaryRes.body.cycleTotals;
      expect(dashboardRes.body.netPayroll).toBe(totals.netSalary);
      expect(dashboardRes.body.pendingRelease).toEqual({ count: totals.pendingReleaseCount, amount: totals.pendingReleaseAmount });
      expect(dashboardRes.body.releaseProgress).toEqual({
        totalCount: totals.employeeCount,
        releasedCount: totals.releasedCount,
        pendingCount: totals.pendingReleaseCount,
        heldCount: totals.heldCount,
        noPayDueCount: totals.noPayDueCount,
        recoveryDueCount: totals.recoveryDueCount,
        releasedAmount: totals.releasedAmount,
        pendingAmount: totals.pendingReleaseAmount,
      });
      expect(dashboardRes.body.deductionBreakdown).toEqual({
        eobi: totals.eobi,
        advance: totals.advanceDeductions,
        eidAdvance: totals.eidAdvanceDeductions,
        fine: totals.fines,
      });

      const summarySiteRowsByName = new Map(summaryRes.body.siteRows.map((row: { siteName: string }) => [row.siteName, row]));
      for (const row of dashboardRes.body.siteSummary) {
        const summaryRow = summarySiteRowsByName.get(row.siteName) as { employeeCount: number; netSalary: string; releasedAmount: string; pendingReleaseAmount: string };
        expect(summaryRow).toBeDefined();
        expect(row.employeeCount).toBe(summaryRow.employeeCount);
        expect(row.netPayroll).toBe(summaryRow.netSalary);
        expect(row.releasedAmount).toBe(summaryRow.releasedAmount);
        expect(row.pendingReleaseAmount).toBe(summaryRow.pendingReleaseAmount);
      }
    });

    it('attention.heldEntries reconciles with the count of hold=true, unresolved entries in the current cycle/site scope', async () => {
      const admin = await masterAdminAgent('dash-recon-held-admin@test.local');
      const fixture = await seedFixture(admin.userId);

      const res = await admin.agent.get('/api/v1/dashboard');
      const expectedHeld = await prisma.payrollEntry.count({
        where: { cycleId: fixture.cycleId, hold: true, released: false, payoutOutcome: null },
      });
      expect(res.body.attention.heldEntries).toEqual({ count: expectedHeld });
      expect(expectedHeld).toBe(1);
    });

    /** Hostile-review question 18 (§22): deductionBreakdown must reconcile not only with Payroll
     * Summary's own totals (proven above) but specifically with the Deduction Report — the module
     * that owns this exact four-line vocabulary. Both ultimately read the same `PayrollEntry`
     * columns/`calcNet` output, but this proves the *values*, not just the formula, are identical,
     * by comparing against that report's own live output rather than a manually copied number. */
    it('deductionBreakdown exactly reconciles with the live Deduction Report totals for the same cycle/site scope', async () => {
      const admin = await masterAdminAgent('dash-recon-dedreport-admin@test.local');
      const fixture = await seedFixture(admin.userId);

      const [dashboardRes, deductionRes] = await Promise.all([
        admin.agent.get('/api/v1/dashboard'),
        admin.agent.get(`/api/v1/reports/deduction-report?cycleId=${fixture.cycleId}&pageSize=100`),
      ]);
      expect(dashboardRes.status).toBe(200);
      expect(deductionRes.status).toBe(200);
      expect(deductionRes.body.totals.totalsComputed).toBe(true);

      expect(dashboardRes.body.deductionBreakdown).toEqual({
        eobi: deductionRes.body.totals.eobiTotal,
        advance: deductionRes.body.totals.advanceDeductionTotal,
        eidAdvance: deductionRes.body.totals.eidAdvanceDeductionTotal,
        fine: deductionRes.body.totals.fineTotal,
      });
    });

    /** Hostile-review question 17 (§22): releaseProgress/pendingRelease/heldEntries must reconcile
     * with the Salary Release Report's own release-state totals, not merely with Payroll Summary.
     * Both read the identical `PayrollEntry.released`/`.hold`/`.payoutOutcome` columns Release
     * Salary's own write path (`payroll-release.service.ts`) sets — this proves the counts/amounts
     * this Dashboard surfaces are numerically identical to that report's own live output, confirming
     * the deliberate architecture choice documented in `dashboard.service.ts`'s own doc comment
     * (computing this from the already-fetched Payroll Summary aggregation rather than issuing a
     * second, redundant PayrollEntry fetch via `salary-release-report.service.ts` in the same
     * request) introduces no numeric drift. */
    it('releaseProgress/pendingRelease/heldEntries exactly reconcile with the live Salary Release Report totals for the same cycle/site scope', async () => {
      const admin = await masterAdminAgent('dash-recon-srr-admin@test.local');
      const fixture = await seedFixture(admin.userId);

      const [dashboardRes, srrRes] = await Promise.all([
        admin.agent.get('/api/v1/dashboard'),
        admin.agent.get(`/api/v1/reports/salary-release?cycleId=${fixture.cycleId}&pageSize=100`),
      ]);
      expect(dashboardRes.status).toBe(200);
      expect(srrRes.status).toBe(200);
      expect(srrRes.body.totals.totalsComputed).toBe(true);

      const srrTotals = srrRes.body.totals;
      expect(dashboardRes.body.releaseProgress.totalCount).toBe(srrTotals.matchingCount);
      expect(dashboardRes.body.releaseProgress.releasedCount).toBe(srrTotals.releasedCount);
      expect(dashboardRes.body.releaseProgress.pendingCount).toBe(srrTotals.pendingCount);
      expect(dashboardRes.body.releaseProgress.heldCount).toBe(srrTotals.heldCount);
      expect(dashboardRes.body.releaseProgress.noPayDueCount).toBe(srrTotals.noPayDueCount);
      expect(dashboardRes.body.releaseProgress.recoveryDueCount).toBe(srrTotals.recoveryDueCount);
      expect(dashboardRes.body.releaseProgress.releasedAmount).toBe(srrTotals.releasedAmount);
      expect(dashboardRes.body.pendingRelease).toEqual({ count: srrTotals.pendingCount, amount: srrTotals.pendingReleaseAmount });
      expect(dashboardRes.body.attention.heldEntries).toEqual({ count: srrTotals.heldCount });
    });
  });

  // --- Cycle resolution ------------------------------------------------------------------------

  describe('current-cycle resolution', () => {
    it('prefers Draft over Released/Archived', async () => {
      const admin = await masterAdminAgent('dash-cycle-admin1@test.local');
      const draft = await prisma.payrollCycle.create({ data: { year: 2998, month: 3, createdBy: admin.userId, status: 'DRAFT' } });
      await prisma.payrollCycle.create({ data: { year: 2998, month: 2, createdBy: admin.userId, status: 'RELEASED', releasedAt: new Date(), releasedBy: admin.userId } });
      await prisma.payrollCycle.create({ data: { year: 2998, month: 1, createdBy: admin.userId, status: 'ARCHIVED', archivedAt: new Date(), archivedBy: admin.userId } });

      const res = await admin.agent.get('/api/v1/dashboard');
      expect(res.body.cycle.id).toBe(draft.id);
    });

    it('falls back to the newest Released cycle when no Draft exists', async () => {
      const admin = await masterAdminAgent('dash-cycle-admin2@test.local');
      await prisma.payrollCycle.create({ data: { year: 2997, month: 1, createdBy: admin.userId, status: 'RELEASED', releasedAt: new Date(), releasedBy: admin.userId } });
      const newerReleased = await prisma.payrollCycle.create({ data: { year: 2997, month: 2, createdBy: admin.userId, status: 'RELEASED', releasedAt: new Date(), releasedBy: admin.userId } });
      await prisma.payrollCycle.create({ data: { year: 2996, month: 12, createdBy: admin.userId, status: 'ARCHIVED', archivedAt: new Date(), archivedBy: admin.userId } });

      const res = await admin.agent.get('/api/v1/dashboard');
      expect(res.body.cycle.id).toBe(newerReleased.id);
    });

    it('falls back to the newest Archived cycle when neither Draft nor Released exists', async () => {
      const admin = await masterAdminAgent('dash-cycle-admin3@test.local');
      await prisma.payrollCycle.create({ data: { year: 2995, month: 1, createdBy: admin.userId, status: 'ARCHIVED', archivedAt: new Date(), archivedBy: admin.userId } });
      const newerArchived = await prisma.payrollCycle.create({ data: { year: 2995, month: 2, createdBy: admin.userId, status: 'ARCHIVED', archivedAt: new Date(), archivedBy: admin.userId } });

      const res = await admin.agent.get('/api/v1/dashboard');
      expect(res.body.cycle.id).toBe(newerArchived.id);
    });
  });

  // --- Snapshot / no N+1 sanity (single response shape) -------------------------------------------

  it('returns one coherent snapshot with a single generatedAt timestamp for the whole response', async () => {
    const admin = await masterAdminAgent('dash-snapshot-admin@test.local');
    await seedFixture(admin.userId);

    const res = await admin.agent.get('/api/v1/dashboard');
    expect(res.status).toBe(200);
    expect(typeof res.body.generatedAt).toBe('string');
    expect(new Date(res.body.generatedAt).toString()).not.toBe('Invalid Date');
  });
});
