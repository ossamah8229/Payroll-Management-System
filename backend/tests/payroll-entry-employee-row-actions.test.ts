import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

/**
 * Payroll Entry Row Actions — RBAC + Draft-payroll-membership checkpoint (UAT 2026-08-11,
 * corrected 2026-08-12 — independent-permission revision).
 *
 * Two business requirements this suite proves at the backend, the real security boundary
 * (`employees.routes.ts`, `employees.service.ts`, `payroll-processing.service.ts`):
 *
 * 1. `Edit Employee` and `Mark as Left` are governed by two entirely independent permissions,
 *    never an any-of gate between them: `Edit Employee` stays `EMPLOYEES_EDIT`-only; `Mark as
 *    Left` is governed solely by `PAYROLL_ENTRY` (Payroll Staff's day-to-day Payroll Entry
 *    operational permission) — no new lifecycle permission, no widened `PATCH /employees/:id` or
 *    `/reactivate`. An earlier revision of this checkpoint accepted `EMPLOYEES_EDIT` OR
 *    `PAYROLL_ENTRY` for Mark as Left — a confirmed defect (an employee-edit-only caller with no
 *    Payroll Entry access could mark an employee left) — now corrected and covered below by an
 *    explicit denial case.
 * 2. Marking an employee Left removes their `PayrollEntry` from the *current Draft* cycle only
 *    (`removeEmployeeFromCurrentDraftCycle`) — historical Released/Archived `PayrollEntry` rows are
 *    never touched, regardless of which cycle the caller happened to be viewing.
 */

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

describe('Payroll Entry Row Actions — Mark as Left RBAC and Draft-payroll removal', () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  async function makeSiteWithUnit(name: string) {
    const site = await prisma.projectSite.create({ data: { name } });
    const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} Unit` } });
    return { site, unit };
  }

  async function masterAdminAgent(email: string) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.MASTER_ADMIN,
      permissionKeys: [
        PERMISSIONS.EMPLOYEES_VIEW,
        PERMISSIONS.EMPLOYEES_EDIT,
        PERMISSIONS.EMPLOYEES_CREATE,
        PERMISSIONS.PAYROLL_ENTRY,
        PERMISSIONS.PAYROLL_CYCLE_MANAGE,
        PERMISSIONS.PAYROLL_RELEASE,
        PERMISSIONS.SITES_MANAGE,
      ],
    });
  }

  /** A bespoke `TEST_`-prefixed role code for every non-admin RBAC scenario below — never the real
   * seeded `PAYROLL_STAFF`/`FINANCE` role codes, which would permanently pollute their shared
   * permission grants for every other test file in the same full-suite run (established convention,
   * see `payroll-entry-draft-cycle-sync.test.ts`'s own `PAYROLL_MANAGER_PERMISSIONS` doc comment). */
  async function scopedAgent(email: string, roleCode: string, permissionKeys: string[], siteIds: string[]) {
    return createAuthenticatedAgent(app, { email, password: PASSWORD, roleCode, permissionKeys, siteIds });
  }

  async function makeDraftCycle(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, month: number) {
    const res = await admin.agent
      .post('/api/v1/payroll-cycles')
      .set('x-csrf-token', admin.csrfToken)
      .send({ year: 2901, month });
    expect(res.status).toBe(201);
    return res.body.cycle as { id: string; status: string };
  }

  async function createEmployee(
    admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>,
    siteId: string,
    unitId: string,
    overrides: Record<string, unknown> = {},
  ) {
    const res = await admin.agent
      .post('/api/v1/employees')
      .set('x-csrf-token', admin.csrfToken)
      .send({ name: 'Row Actions Employee', designation: 'Guard', siteId, unitId, grossPay: '32000.00', ...overrides });
    expect(res.status).toBe(201);
    return res.body.employee as { id: string };
  }

  // ---------------------------------------------------------------------------------------------
  // RBAC matrix
  // ---------------------------------------------------------------------------------------------

  describe('RBAC matrix', () => {
    it('Payroll Entry permission only: Mark as Left is allowed, Edit Employee is denied (403)', async () => {
      const admin = await masterAdminAgent('rbac-pe-only-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site RBAC PE Only');
      const employee = await createEmployee(admin, site.id, unit.id);

      const peOnly = await scopedAgent(
        'rbac-pe-only-user@test.local',
        'TEST_PE_ONLY',
        [PERMISSIONS.EMPLOYEES_VIEW, PERMISSIONS.PAYROLL_ENTRY],
        [site.id],
      );

      const editRes = await peOnly.agent
        .patch(`/api/v1/employees/${employee.id}`)
        .set('x-csrf-token', peOnly.csrfToken)
        .send({ designation: 'Senior Guard' });
      expect(editRes.status).toBe(403);

      const leaveRes = await peOnly.agent
        .post(`/api/v1/employees/${employee.id}/leave`)
        .set('x-csrf-token', peOnly.csrfToken)
        .send({ dateOfLeaving: '2901-01-15' });
      expect(leaveRes.status).toBe(200);
      expect(leaveRes.body.employee.dateOfLeaving).toContain('2901-01-15');
    });

    it('employees:edit only: Edit Employee is allowed, Mark as Left is denied (403) — employees:edit alone must never grant Mark as Left', async () => {
      const admin = await masterAdminAgent('rbac-edit-only-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site RBAC Edit Only');
      const employee = await createEmployee(admin, site.id, unit.id);

      const editOnly = await scopedAgent(
        'rbac-edit-only-user@test.local',
        'TEST_EDIT_ONLY',
        [PERMISSIONS.EMPLOYEES_VIEW, PERMISSIONS.EMPLOYEES_EDIT],
        [site.id],
      );

      const editRes = await editOnly.agent
        .patch(`/api/v1/employees/${employee.id}`)
        .set('x-csrf-token', editOnly.csrfToken)
        .send({ designation: 'Senior Guard' });
      expect(editRes.status).toBe(200);

      const leaveRes = await editOnly.agent
        .post(`/api/v1/employees/${employee.id}/leave`)
        .set('x-csrf-token', editOnly.csrfToken)
        .send({ dateOfLeaving: '2901-01-16' });
      expect(leaveRes.status).toBe(403);
    });

    it('both permissions: both actions are allowed', async () => {
      const admin = await masterAdminAgent('rbac-both-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site RBAC Both');
      const employee = await createEmployee(admin, site.id, unit.id);

      const both = await scopedAgent(
        'rbac-both-user@test.local',
        'TEST_BOTH',
        [PERMISSIONS.EMPLOYEES_VIEW, PERMISSIONS.EMPLOYEES_EDIT, PERMISSIONS.PAYROLL_ENTRY],
        [site.id],
      );

      const editRes = await both.agent
        .patch(`/api/v1/employees/${employee.id}`)
        .set('x-csrf-token', both.csrfToken)
        .send({ designation: 'Senior Guard' });
      expect(editRes.status).toBe(200);

      const leaveRes = await both.agent
        .post(`/api/v1/employees/${employee.id}/leave`)
        .set('x-csrf-token', both.csrfToken)
        .send({ dateOfLeaving: '2901-01-17' });
      expect(leaveRes.status).toBe(200);
    });

    it('neither permission: both actions are denied (403)', async () => {
      const admin = await masterAdminAgent('rbac-neither-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site RBAC Neither');
      const employee = await createEmployee(admin, site.id, unit.id);

      const neither = await scopedAgent(
        'rbac-neither-user@test.local',
        'TEST_NEITHER',
        [PERMISSIONS.EMPLOYEES_VIEW],
        [site.id],
      );

      const editRes = await neither.agent
        .patch(`/api/v1/employees/${employee.id}`)
        .set('x-csrf-token', neither.csrfToken)
        .send({ designation: 'Senior Guard' });
      expect(editRes.status).toBe(403);

      const leaveRes = await neither.agent
        .post(`/api/v1/employees/${employee.id}/leave`)
        .set('x-csrf-token', neither.csrfToken)
        .send({ dateOfLeaving: '2901-01-18' });
      expect(leaveRes.status).toBe(403);
    });

    it('Reactivate stays employees:edit-only — a Payroll Entry-only caller is denied (403)', async () => {
      const admin = await masterAdminAgent('rbac-reactivate-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site RBAC Reactivate');
      const employee = await createEmployee(admin, site.id, unit.id);
      const leaveRes = await admin.agent
        .post(`/api/v1/employees/${employee.id}/leave`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ dateOfLeaving: '2901-01-10' });
      expect(leaveRes.status).toBe(200);

      const peOnly = await scopedAgent(
        'rbac-reactivate-pe-user@test.local',
        'TEST_REACTIVATE_PE_ONLY',
        [PERMISSIONS.EMPLOYEES_VIEW, PERMISSIONS.PAYROLL_ENTRY],
        [site.id],
      );

      const reactivateRes = await peOnly.agent
        .post(`/api/v1/employees/${employee.id}/reactivate`)
        .set('x-csrf-token', peOnly.csrfToken)
        .send({});
      expect(reactivateRes.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Draft-payroll membership removal
  // ---------------------------------------------------------------------------------------------

  describe('Draft-payroll membership removal', () => {
    it('removes the employee\'s PayrollEntry from the current Draft cycle, in the same transaction as dateOfLeaving', async () => {
      const admin = await masterAdminAgent('draft-removal-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site Draft Removal');
      const employee = await createEmployee(admin, site.id, unit.id);
      const cycle = await makeDraftCycle(admin, 1);

      const beforeEntry = await prisma.payrollEntry.findFirst({ where: { cycleId: cycle.id, employeeId: employee.id } });
      expect(beforeEntry).not.toBeNull();

      const leaveRes = await admin.agent
        .post(`/api/v1/employees/${employee.id}/leave`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ dateOfLeaving: '2901-01-20' });
      expect(leaveRes.status).toBe(200);

      const afterEntry = await prisma.payrollEntry.findFirst({ where: { cycleId: cycle.id, employeeId: employee.id } });
      expect(afterEntry).toBeNull();

      const employeeRow = await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } });
      expect(employeeRow.dateOfLeaving).not.toBeNull();

      const auditEntries = await prisma.auditLog.findMany({ where: { action: 'payroll_entry.deleted' } });
      expect(auditEntries.some((entry) => entry.metadata && (entry.metadata as { employeeId?: string }).employeeId === employee.id)).toBe(true);
    });

    it('does nothing to Draft membership when no Draft cycle currently exists (no error)', async () => {
      const admin = await masterAdminAgent('draft-removal-no-draft-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site Draft Removal No Draft');
      const employee = await createEmployee(admin, site.id, unit.id);

      const leaveRes = await admin.agent
        .post(`/api/v1/employees/${employee.id}/leave`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ dateOfLeaving: '2901-01-21' });
      expect(leaveRes.status).toBe(200);
    });

    it(
      'historical preservation: a Released/Archived cycle\'s PayrollEntry survives Mark as Left byte-for-byte; ' +
        'only the current Draft cycle\'s membership is removed',
      async () => {
        const admin = await masterAdminAgent('draft-removal-historical-admin@test.local');
        const { site, unit } = await makeSiteWithUnit('Test Site Draft Removal Historical');
        const employee = await createEmployee(admin, site.id, unit.id);

        // Cycle 1: bootstrap, add attendance so release doesn't resolve to a zero-net outcome, then
        // finalize (Draft -> Released) and archive-and-create-next (Released -> Archived, + a fresh
        // Draft cycle 2 the still-active employee is bootstrapped into again).
        const cycle1 = await makeDraftCycle(admin, 2);
        const entry1Seed = await prisma.payrollEntry.findFirstOrThrow({
          where: { cycleId: cycle1.id, employeeId: employee.id },
        });
        // Non-zero worked days — a zero-day entry nets negative (the flat EOBI deduction with no
        // earned Gross Pay), which would resolve to RECOVERY_DUE rather than an ordinary
        // released=true PAID outcome (same reasoning `payroll-release-all.test.ts`'s own
        // `createEntry` doc comment documents), defeating this test's own `released` assertions
        // below. Set directly via Prisma — this is test setup, not the behavior under test.
        await prisma.payrollEntryWorkLine.updateMany({ where: { payrollEntryId: entry1Seed.id }, data: { days: '26' } });

        const releaseRes = await admin.agent
          .post(`/api/v1/payroll-cycles/${cycle1.id}/units/${unit.id}/release`)
          .set('x-csrf-token', admin.csrfToken)
          .send({});
        expect(releaseRes.status).toBe(201);
        const entry1Before = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry1Seed.id } });
        expect(entry1Before.released).toBe(true);

        // `createPayrollCycle` bootstraps every active Employee system-wide (Phase 3 architecture),
        // not just this test's own — this shared local dev database can carry other, unrelated
        // active employees at other sites (pre-existing seed data, or another test file's rows this
        // one's own `beforeEach` cleanup never touches, since they aren't "Test Site "-prefixed).
        // Finalize requires every entry in the cycle to be resolved (released, held, or a payout
        // outcome), so any such entry is held here purely to let this test's own Finalize proceed —
        // held, never deleted, and every entry in this fake year>=2900 cycle is removed by this
        // file's own `cleanTestData` regardless of which employee it belongs to.
        const blockingEntries = await prisma.payrollEntry.findMany({
          where: { cycleId: cycle1.id, id: { not: entry1Before.id }, released: false, hold: false, payoutOutcome: null },
        });
        for (const blocking of blockingEntries) {
          await prisma.payrollEntry.update({ where: { id: blocking.id }, data: { hold: true } });
        }

        const finalizeRes = await admin.agent
          .post(`/api/v1/payroll-cycles/${cycle1.id}/finalize`)
          .set('x-csrf-token', admin.csrfToken)
          .send({});
        expect(finalizeRes.status).toBe(200);

        const archiveRes = await admin.agent
          .post(`/api/v1/payroll-cycles/${cycle1.id}/archive-and-create-next`)
          .set('x-csrf-token', admin.csrfToken)
          .send({});
        expect(archiveRes.status).toBe(201);
        const cycle2 = archiveRes.body.newCycle as { id: string };

        const entry1AfterArchive = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry1Before.id } });
        expect(entry1AfterArchive.released).toBe(true);

        const entry2Before = await prisma.payrollEntry.findFirst({ where: { cycleId: cycle2.id, employeeId: employee.id } });
        expect(entry2Before).not.toBeNull();

        // Mark as Left while nothing is even viewing cycle1 or cycle2 in particular — the backend
        // must resolve the actual current Draft cycle (cycle2) itself, never assume any cycle a
        // caller happens to be looking at.
        const leaveRes = await admin.agent
          .post(`/api/v1/employees/${employee.id}/leave`)
          .set('x-csrf-token', admin.csrfToken)
          .send({ dateOfLeaving: '2901-03-01' });
        expect(leaveRes.status).toBe(200);

        // Cycle 1 (Archived) — untouched, byte-for-byte.
        const entry1AfterLeave = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry1Before.id } });
        expect(entry1AfterLeave).toEqual(entry1AfterArchive);

        // Cycle 2 (Draft) — the employee's membership is gone.
        const entry2After = await prisma.payrollEntry.findFirst({ where: { cycleId: cycle2.id, employeeId: employee.id } });
        expect(entry2After).toBeNull();
      },
    );

    it(
      'never deletes an individual entry that has already resolved (released, or a payout outcome) even though its cycle is still nominally Draft',
      async () => {
        const admin = await masterAdminAgent('draft-removal-late-release-admin@test.local');
        const { site, unit } = await makeSiteWithUnit('Test Site Draft Removal Late Release');
        const employee = await createEmployee(admin, site.id, unit.id);
        const cycle = await makeDraftCycle(admin, 3);

        const entrySeed = await prisma.payrollEntry.findFirstOrThrow({
          where: { cycleId: cycle.id, employeeId: employee.id },
        });
        // Non-zero worked days — see the historical-preservation test's identical comment above.
        await prisma.payrollEntryWorkLine.updateMany({ where: { payrollEntryId: entrySeed.id }, data: { days: '26' } });
        const entryBefore = entrySeed;

        // Per-Unit "Late Entry" release of this employee's own Unit — resolves this one entry to
        // released=true while the cycle as a whole stays DRAFT.
        const releaseRes = await admin.agent
          .post(`/api/v1/payroll-cycles/${cycle.id}/units/${unit.id}/release`)
          .set('x-csrf-token', admin.csrfToken)
          .send({});
        expect(releaseRes.status).toBe(201);

        const cycleAfterRelease = await prisma.payrollCycle.findUniqueOrThrow({ where: { id: cycle.id } });
        expect(cycleAfterRelease.status).toBe('DRAFT');
        const entryAfterRelease = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entryBefore.id } });
        expect(entryAfterRelease.released).toBe(true);

        const leaveRes = await admin.agent
          .post(`/api/v1/employees/${employee.id}/leave`)
          .set('x-csrf-token', admin.csrfToken)
          .send({ dateOfLeaving: '2901-03-05' });
        expect(leaveRes.status).toBe(200);

        const entryAfterLeave = await prisma.payrollEntry.findUnique({ where: { id: entryBefore.id } });
        expect(entryAfterLeave).not.toBeNull();
        expect(entryAfterLeave!.released).toBe(true);
      },
    );

    it(
      'retains (holds, never deletes) a Draft entry a real financial obligation already points at — an AdvanceScheduleChange',
      async () => {
        const admin = await masterAdminAgent('draft-removal-linkage-admin@test.local');
        const { site, unit } = await makeSiteWithUnit('Test Site Draft Removal Linkage');
        const employee = await createEmployee(admin, site.id, unit.id);
        const cycle = await makeDraftCycle(admin, 4);

        const entry = await prisma.payrollEntry.findFirstOrThrow({
          where: { cycleId: cycle.id, employeeId: employee.id },
        });

        const fromPeriod = await prisma.scheduledPayrollPeriod.create({ data: { year: 2901, month: 4, payrollCycleId: cycle.id } });
        const toPeriod = await prisma.scheduledPayrollPeriod.create({ data: { year: 2901, month: 5 } });
        const advance = await prisma.advance.create({
          data: {
            employeeId: employee.id,
            type: 'LOAN',
            totalAmount: '5000',
            outstandingBalance: '5000',
            dateGiven: new Date('2901-04-01'),
            repaymentType: 'INSTALLMENT',
            scheduledInstallmentAmount: '1000',
            currentScheduledPeriodId: toPeriod.id,
          },
        });
        await prisma.advanceScheduleChange.create({
          data: {
            advanceId: advance.id,
            payrollEntryId: entry.id,
            fromPeriodId: fromPeriod.id,
            toPeriodId: toPeriod.id,
            reason: 'Test deferral — employee requested next-cycle deduction',
            changedById: admin.userId,
          },
        });

        const leaveRes = await admin.agent
          .post(`/api/v1/employees/${employee.id}/leave`)
          .set('x-csrf-token', admin.csrfToken)
          .send({ dateOfLeaving: '2901-04-10' });
        expect(leaveRes.status).toBe(200);

        const entryAfterLeave = await prisma.payrollEntry.findUnique({ where: { id: entry.id } });
        expect(entryAfterLeave).not.toBeNull();
        expect(entryAfterLeave!.hold).toBe(true);
      },
    );

    it('Reactivate restores current-Draft payroll eligibility after Mark as Left removed it', async () => {
      const admin = await masterAdminAgent('draft-removal-reactivate-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site Draft Removal Reactivate');
      const employee = await createEmployee(admin, site.id, unit.id);
      const cycle = await makeDraftCycle(admin, 5);

      const leaveRes = await admin.agent
        .post(`/api/v1/employees/${employee.id}/leave`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ dateOfLeaving: '2901-05-01' });
      expect(leaveRes.status).toBe(200);

      const afterLeave = await prisma.payrollEntry.findFirst({ where: { cycleId: cycle.id, employeeId: employee.id } });
      expect(afterLeave).toBeNull();

      const reactivateRes = await admin.agent
        .post(`/api/v1/employees/${employee.id}/reactivate`)
        .set('x-csrf-token', admin.csrfToken)
        .send({});
      expect(reactivateRes.status).toBe(200);

      const afterReactivate = await prisma.payrollEntry.findFirst({ where: { cycleId: cycle.id, employeeId: employee.id } });
      expect(afterReactivate).not.toBeNull();
    });
  });
});
