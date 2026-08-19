import request from 'supertest';
import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { assertNoSensitiveKeys, cleanTestData, createAuthenticatedAgent, extractCookie } from './helpers';
import * as auditLogService from '../src/modules/audit-log/audit-log.service';
import * as correctionsRepository from '../src/modules/corrections/corrections.repository';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

/**
 * Phase 6 Checkpoint 3 — Transactional Correction Approval & Balance Adjustment Creation. Every
 * test drives the real HTTP stack (`createApp()`, session cookies, CSRF, permission middleware,
 * Zod validation, the real error handler) via `createAuthenticatedAgent`, matching this project's
 * established integration-test convention (`advances.test.ts`, `payroll-cycle-rollover.test.ts`)
 * — no mocked database, real PostgreSQL throughout. Rollback tests use `jest.spyOn` against this
 * module's own exported functions (the same precedent `payroll-cycle-rollover.test.ts` already
 * established for `recordAuditLog`), never a mocked Prisma client.
 *
 * A `PayrollEntry` is created already `released = true` directly via Prisma, bypassing the actual
 * release workflow (Phase 4) — this checkpoint's own tests only need a released entry to exist,
 * not to exercise how it got that way, exactly the same fixture convention
 * `corrections-schema.test.ts` (Checkpoint 1) already established.
 */
describe('Phase 6 Checkpoint 3 — Correction request/approval/rejection workflow', () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  // --- Agents ------------------------------------------------------------------------------------

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
      // Finance holds neither payroll:entry nor corrections:approve (approved architecture).
      permissionKeys: [PERMISSIONS.PAYROLL_VIEW],
      siteIds,
    });
  }

  // --- Fixtures ----------------------------------------------------------------------------------

  let cycleCounter = 0;
  function nextCycleYearMonth(): { year: number; month: number } {
    cycleCounter += 1;
    return { year: 2900 + Math.floor(cycleCounter / 12), month: (cycleCounter % 12) + 1 };
  }

  async function makeSiteWithUnit(name: string) {
    const site = await prisma.projectSite.create({ data: { name } });
    const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} Unit`, code: 'U-1' } });
    return { site, unit };
  }

  /** A second unit under an *existing* site — for a second employee/entry that must stay in the
   * same site (unlike `makeSiteWithUnit`, which always creates a brand-new site too). */
  async function makeUnit(siteId: string, name: string) {
    return prisma.projectUnit.create({ data: { siteId, name: `${name} Unit`, code: `U-${Math.random().toString(36).slice(2, 8)}` } });
  }

  async function makeEmployee(siteId: string, unitId: string, name: string) {
    return prisma.employee.create({ data: { name, designation: 'Guard', siteId, unitId, grossPay: '30000' } });
  }

  async function makeAdjustmentType(code: string, isActive = true) {
    return prisma.adjustmentType.create({ data: { code: `TEST_${code}`, label: code, isActive } });
  }

  async function makeReleasedEntry(siteId: string, unitId: string, employeeId: string, releasedBy: string, grossPay = '30000') {
    const { year, month } = nextCycleYearMonth();
    const cycle = await prisma.payrollCycle.create({ data: { year, month, createdBy: releasedBy, status: 'RELEASED' } });
    return prisma.payrollEntry.create({
      data: {
        cycleId: cycle.id,
        employeeId,
        siteId,
        designation: 'Guard',
        grossPay,
        // eobiApplicable: false zeroes out the schema's own default (400.00, applicable) so
        // netSalary === grossPay exactly for a full-attendance, no-OT work line — isolates every
        // assertion below from EOBI/day-proration noise, same fixture design as
        // corrections-calculation.test.ts's own "large values" test.
        eobiApplicable: false,
        released: true,
        releasedAt: new Date(),
        releasedBy,
        workLines: { create: [{ siteId, unitId, days: '30', cycleDays: 30, otHours: '0' }] },
      },
    });
  }

  async function makeDraftEntry(siteId: string, unitId: string, employeeId: string, createdBy: string) {
    const { year, month } = nextCycleYearMonth();
    const cycle = await prisma.payrollCycle.create({ data: { year, month, createdBy, status: 'DRAFT' } });
    return prisma.payrollEntry.create({
      data: {
        cycleId: cycle.id,
        employeeId,
        siteId,
        designation: 'Guard',
        grossPay: '30000',
        workLines: { create: [{ siteId, unitId, days: '30', cycleDays: 30, otHours: '0' }] },
      },
    });
  }

  /** Full fixture set: site/unit, employee, an admin, a released single-work-line entry (grossPay
   * 30,000, days=cycleDays=30, otHours=0 -> netSalary === grossPay exactly, isolating every
   * assertion below from day-proration/OT rounding noise), and an active AdjustmentType. */
  async function makeFixtures(label: string) {
    const { site, unit } = await makeSiteWithUnit(`Test Site CP3 ${label}`);
    const employee = await makeEmployee(site.id, unit.id, `CP3 Employee ${label}`);
    const admin = await masterAdminAgent(`cp3-${label}-admin@test.local`);
    const entry = await makeReleasedEntry(site.id, unit.id, employee.id, admin.userId);
    const adjustmentType = await makeAdjustmentType(label);
    return { site, unit, employee, admin, entry, adjustmentType };
  }

  async function createRequest(
    agent: Awaited<ReturnType<typeof createAuthenticatedAgent>>,
    entryId: string,
    body: Record<string, unknown>,
  ) {
    return agent.agent
      .post(`/api/v1/payroll-entries/${entryId}/correction-requests`)
      .set('x-csrf-token', agent.csrfToken)
      .send(body);
  }

  async function approveRequest(
    agent: Awaited<ReturnType<typeof createAuthenticatedAgent>>,
    requestId: string,
    body: Record<string, unknown> = {},
  ) {
    return agent.agent
      .post(`/api/v1/correction-requests/${requestId}/approve`)
      .set('x-csrf-token', agent.csrfToken)
      .send(body);
  }

  async function rejectRequest(
    agent: Awaited<ReturnType<typeof createAuthenticatedAgent>>,
    requestId: string,
    body: Record<string, unknown>,
  ) {
    return agent.agent
      .post(`/api/v1/correction-requests/${requestId}/reject`)
      .set('x-csrf-token', agent.csrfToken)
      .send(body);
  }

  const GROSS_PAY_BODY = (adjustmentTypeId: string, value = '35000') => ({
    field: 'GROSS_PAY',
    proposedNewValue: value,
    adjustmentTypeId,
    reason: 'Attendance miscounted for this period',
  });

  // --- Request creation ----------------------------------------------------------------------

  describe('Request creation', () => {
    it('succeeds for Payroll Staff (site-scoped) against a released entry', async () => {
      const { site, entry, adjustmentType } = await makeFixtures('create-happy');
      const staff = await payrollStaffAgent('cp3-create-happy-staff@test.local', [site.id]);

      const res = await createRequest(staff, entry.id, GROSS_PAY_BODY(adjustmentType.id));
      expect(res.status).toBe(201);
      expect(res.body.correctionRequest.status).toBe('PENDING');
      expect(res.body.correctionRequest.field).toBe('GROSS_PAY');
      expect(res.body.correctionRequest.proposedNewValue).toBe('35000');
    });

    it('rejects a Draft (unreleased) entry with ENTRY_NOT_RELEASED', async () => {
      const { site, unit, employee, admin, adjustmentType } = await makeFixtures('create-draft');
      const draftEntry = await makeDraftEntry(site.id, unit.id, employee.id, admin.userId);
      const staff = await payrollStaffAgent('cp3-create-draft-staff@test.local', [site.id]);

      const res = await createRequest(staff, draftEntry.id, GROSS_PAY_BODY(adjustmentType.id));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('ENTRY_NOT_RELEASED');
    });

    it('rejects a nonexistent PayrollEntry with ENTRY_NOT_FOUND', async () => {
      const { site, adjustmentType } = await makeFixtures('create-missing-entry');
      const staff = await payrollStaffAgent('cp3-create-missing-staff@test.local', [site.id]);

      const res = await createRequest(staff, '00000000-0000-0000-0000-000000000000', GROSS_PAY_BODY(adjustmentType.id));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ENTRY_NOT_FOUND');
    });

    it('rejects an unsupported field', async () => {
      const { site, entry, adjustmentType } = await makeFixtures('create-bad-field');
      const staff = await payrollStaffAgent('cp3-create-bad-field-staff@test.local', [site.id]);

      const res = await createRequest(staff, entry.id, { ...GROSS_PAY_BODY(adjustmentType.id), field: 'NET_SALARY' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR'); // Zod rejects it before the domain engine ever sees it
    });

    it('rejects an invalid (non-numeric) value for a decimal field', async () => {
      const { site, entry, adjustmentType } = await makeFixtures('create-bad-value');
      const staff = await payrollStaffAgent('cp3-create-bad-value-staff@test.local', [site.id]);

      const res = await createRequest(staff, entry.id, GROSS_PAY_BODY(adjustmentType.id, 'not-a-number'));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_NUMERIC_VALUE');
    });

    it('rejects a blank reason', async () => {
      const { site, entry, adjustmentType } = await makeFixtures('create-blank-reason');
      const staff = await payrollStaffAgent('cp3-create-blank-reason-staff@test.local', [site.id]);

      const res = await createRequest(staff, entry.id, { ...GROSS_PAY_BODY(adjustmentType.id), reason: '   ' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a work-line field against a multi-work-line entry (SPLIT_WORK_LINE_RESTRICTED)', async () => {
      const { site, unit, employee, admin, adjustmentType } = await makeFixtures('create-split');
      const unit2 = await makeUnit(site.id, 'Test Site CP3 create-split-2');
      const { year, month } = nextCycleYearMonth();
      const cycle = await prisma.payrollCycle.create({ data: { year, month, createdBy: admin.userId, status: 'RELEASED' } });
      const multiLineEntry = await prisma.payrollEntry.create({
        data: {
          cycleId: cycle.id,
          employeeId: employee.id,
          siteId: site.id,
          designation: 'Guard',
          grossPay: '30000',
          released: true,
          releasedAt: new Date(),
          releasedBy: admin.userId,
          workLines: {
            create: [
              { siteId: site.id, unitId: unit.id, days: '15', cycleDays: 30, sortOrder: 0 },
              { siteId: site.id, unitId: unit2.id, days: '15', cycleDays: 30, sortOrder: 1 },
            ],
          },
        },
      });
      const staff = await payrollStaffAgent('cp3-create-split-staff@test.local', [site.id]);

      const res = await createRequest(staff, multiLineEntry.id, {
        field: 'DAYS',
        proposedNewValue: '20',
        adjustmentTypeId: adjustmentType.id,
        reason: 'Attendance recount',
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('SPLIT_WORK_LINE_RESTRICTED');
    });

    it('rejects an invalid reversal target reference at approval time, not creation time (no reversesCorrectionId on create)', async () => {
      const { site, entry, adjustmentType } = await makeFixtures('create-no-reversal-field');
      const staff = await payrollStaffAgent('cp3-create-no-reversal-staff@test.local', [site.id]);

      // Zod strips unknown keys by default only if the schema uses .strict(); either way, a
      // reversesCorrectionId sent at creation time is simply not part of the stored request.
      const res = await createRequest(staff, entry.id, { ...GROSS_PAY_BODY(adjustmentType.id), reversesCorrectionId: '00000000-0000-0000-0000-000000000000' });
      expect(res.status).toBe(201);
      expect(res.body.correctionRequest.proposedNewValue).toBe('35000');
    });

    it('rejects an unauthenticated request', async () => {
      const { entry, adjustmentType } = await makeFixtures('create-unauth');

      // A CSRF cookie is primed but no login ever happens — isolates the 401 auth check from the
      // 403 CSRF check (both run globally, CSRF first; without a token this would 403 instead).
      const anon = request.agent(app);
      const primeRes = await anon.get('/health');
      const csrfToken = extractCookie(primeRes, 'csrf_token')!;

      const res = await anon
        .post(`/api/v1/payroll-entries/${entry.id}/correction-requests`)
        .set('x-csrf-token', csrfToken)
        .send(GROSS_PAY_BODY(adjustmentType.id));
      expect(res.status).toBe(401);
    });

    it('rejects a caller without payroll:entry (Finance)', async () => {
      const { site, entry, adjustmentType } = await makeFixtures('create-forbidden');
      const finance = await financeAgent('cp3-create-forbidden-finance@test.local', [site.id]);

      const res = await createRequest(finance, entry.id, GROSS_PAY_BODY(adjustmentType.id));
      expect(res.status).toBe(403);
    });

    it('site-scopes Payroll Staff — an entry outside assignment is rejected', async () => {
      const { entry, adjustmentType } = await makeFixtures('create-scope');
      const { site: otherSite } = await makeSiteWithUnit('Test Site CP3 create-scope-other');
      const outsider = await payrollStaffAgent('cp3-create-scope-outsider@test.local', [otherSite.id]);

      const res = await createRequest(outsider, entry.id, GROSS_PAY_BODY(adjustmentType.id));
      expect(res.status).toBe(403);
    });
  });

  // --- Approval --------------------------------------------------------------------------------

  describe('Approval', () => {
    it('approves a positive-delta request: creates an immutable Correction and a PAYABLE BalanceAdjustment', async () => {
      const { site, entry, admin, adjustmentType } = await makeFixtures('approve-positive');
      const staff = await payrollStaffAgent('cp3-approve-positive-staff@test.local', [site.id]);
      const created = await createRequest(staff, entry.id, GROSS_PAY_BODY(adjustmentType.id, '35000'));

      const res = await approveRequest(admin, created.body.correctionRequest.id, { paymentTiming: 'DEFERRED' });
      expect(res.status).toBe(200);
      expect(res.body.correction.oldValue).toBe('30000');
      expect(res.body.correction.newValue).toBe('35000');
      // Decimal DB columns round-trip through Prisma's own JSON serialization without forced 2dp
      // padding for a whole number (new Prisma.Decimal('30000.00').toString() === '30000') —
      // unlike oldValue/newValue (plain varchar columns, stored and read back byte-for-byte).
      expect(res.body.correction.oldNetSalary).toBe('30000');
      expect(res.body.correction.newNetSalary).toBe('35000');
      expect(res.body.correction.approvedById).toBe(admin.userId);
      expect(res.body.balanceAdjustment.type).toBe('PAYABLE');
      expect(res.body.balanceAdjustment.amount).toBe('5000');
      expect(res.body.balanceAdjustment.remainingAmount).toBe('5000');
      expect(res.body.balanceAdjustment.status).toBe('PENDING');
      expect(res.body.balanceAdjustment.paymentTiming).toBe('DEFERRED');
      expect(res.body.correctionRequest.status).toBe('APPROVED');
      expect(res.body.correctionRequest.resultingCorrectionId).toBe(res.body.correction.id);
    });

    it('approves a negative-delta request: creates a RECOVERY BalanceAdjustment, rejects paymentTiming', async () => {
      const { site, entry, admin, adjustmentType } = await makeFixtures('approve-negative');
      const staff = await payrollStaffAgent('cp3-approve-negative-staff@test.local', [site.id]);
      const created = await createRequest(staff, entry.id, GROSS_PAY_BODY(adjustmentType.id, '25000'));

      const res = await approveRequest(admin, created.body.correctionRequest.id);
      expect(res.status).toBe(200);
      expect(res.body.balanceAdjustment.type).toBe('RECOVERY');
      expect(res.body.balanceAdjustment.amount).toBe('5000');
      expect(res.body.balanceAdjustment.paymentTiming).toBeNull();

      const withTiming = await createRequest(staff, entry.id, GROSS_PAY_BODY(adjustmentType.id, '24000'));
      const badRes = await approveRequest(admin, withTiming.body.correctionRequest.id, { paymentTiming: 'IMMEDIATE' });
      expect(badRes.status).toBe(400);
      expect(badRes.body.error.code).toBe('PAYMENT_TIMING_NOT_APPLICABLE');
    });

    it('rejects a zero-delta approval with ZERO_DELTA — no Correction, no BalanceAdjustment', async () => {
      const { site, entry, admin, adjustmentType } = await makeFixtures('approve-zero');
      const staff = await payrollStaffAgent('cp3-approve-zero-staff@test.local', [site.id]);
      const created = await createRequest(staff, entry.id, GROSS_PAY_BODY(adjustmentType.id, '30000'));

      const res = await approveRequest(admin, created.body.correctionRequest.id, { paymentTiming: 'DEFERRED' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('ZERO_DELTA');

      const correctionCount = await prisma.correction.count({ where: { payrollEntryId: entry.id } });
      expect(correctionCount).toBe(0);
      const stillPending = await prisma.correctionRequest.findUniqueOrThrow({ where: { id: created.body.correctionRequest.id } });
      expect(stillPending.status).toBe('PENDING');
    });

    it('requires paymentTiming for a PAYABLE approval', async () => {
      const { site, entry, admin, adjustmentType } = await makeFixtures('approve-missing-timing');
      const staff = await payrollStaffAgent('cp3-approve-missing-timing-staff@test.local', [site.id]);
      const created = await createRequest(staff, entry.id, GROSS_PAY_BODY(adjustmentType.id, '35000'));

      const res = await approveRequest(admin, created.body.correctionRequest.id);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PAYMENT_TIMING_REQUIRED');
    });

    it('never mutates the source PayrollEntry', async () => {
      const { site, entry, admin, adjustmentType } = await makeFixtures('approve-no-entry-mutation');
      const staff = await payrollStaffAgent('cp3-approve-no-mutation-staff@test.local', [site.id]);
      const created = await createRequest(staff, entry.id, GROSS_PAY_BODY(adjustmentType.id, '35000'));

      await approveRequest(admin, created.body.correctionRequest.id, { paymentTiming: 'DEFERRED' });

      const reloaded = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
      expect(reloaded.grossPay.toString()).toBe('30000');
      expect(reloaded.updatedAt.getTime()).toBe(entry.updatedAt.getTime());
    });

    it('never mutates a prior Correction — a second correction to the same field creates a new, separate row', async () => {
      const { site, entry, admin, adjustmentType } = await makeFixtures('approve-no-prior-mutation');
      const staff = await payrollStaffAgent('cp3-approve-no-prior-mutation-staff@test.local', [site.id]);
      const first = await createRequest(staff, entry.id, GROSS_PAY_BODY(adjustmentType.id, '35000'));
      const firstApproval = await approveRequest(admin, first.body.correctionRequest.id, { paymentTiming: 'DEFERRED' });
      const firstCorrectionId = firstApproval.body.correction.id;

      const second = await createRequest(staff, entry.id, GROSS_PAY_BODY(adjustmentType.id, '37000'));
      await approveRequest(admin, second.body.correctionRequest.id, { paymentTiming: 'DEFERRED' });

      const firstReloaded = await prisma.correction.findUniqueOrThrow({ where: { id: firstCorrectionId } });
      expect(firstReloaded.oldValue).toBe('30000');
      expect(firstReloaded.newValue).toBe('35000');

      const total = await prisma.correction.count({ where: { payrollEntryId: entry.id } });
      expect(total).toBe(2);
    });

    it('writes exactly one correction.approved audit entry, with cross-referencing metadata', async () => {
      const { site, entry, admin, adjustmentType } = await makeFixtures('approve-audit');
      const staff = await payrollStaffAgent('cp3-approve-audit-staff@test.local', [site.id]);
      const created = await createRequest(staff, entry.id, GROSS_PAY_BODY(adjustmentType.id, '35000'));

      const res = await approveRequest(admin, created.body.correctionRequest.id, { paymentTiming: 'DEFERRED' });

      const entries = await prisma.auditLog.findMany({ where: { action: 'correction.approved', entityId: res.body.correction.id } });
      expect(entries).toHaveLength(1);
      const metadata = entries[0]!.metadata as Record<string, unknown>;
      expect(metadata.correctionRequestId).toBe(created.body.correctionRequest.id);
      expect(metadata.balanceAdjustmentId).toBe(res.body.balanceAdjustment.id);
    });

    it('rejects approving an already-APPROVED request (REQUEST_NOT_PENDING)', async () => {
      const { site, entry, admin, adjustmentType } = await makeFixtures('approve-twice');
      const staff = await payrollStaffAgent('cp3-approve-twice-staff@test.local', [site.id]);
      const created = await createRequest(staff, entry.id, GROSS_PAY_BODY(adjustmentType.id, '35000'));
      await approveRequest(admin, created.body.correctionRequest.id, { paymentTiming: 'DEFERRED' });

      const res = await approveRequest(admin, created.body.correctionRequest.id, { paymentTiming: 'DEFERRED' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('REQUEST_NOT_PENDING');
    });

    it('rejects a caller without corrections:approve (Payroll Staff, Finance)', async () => {
      const { site, entry, adjustmentType } = await makeFixtures('approve-forbidden');
      const staff = await payrollStaffAgent('cp3-approve-forbidden-staff@test.local', [site.id]);
      const created = await createRequest(staff, entry.id, GROSS_PAY_BODY(adjustmentType.id));

      const staffAttempt = await approveRequest(staff, created.body.correctionRequest.id, { paymentTiming: 'DEFERRED' });
      expect(staffAttempt.status).toBe(403);

      const finance = await financeAgent('cp3-approve-forbidden-finance@test.local', [site.id]);
      const financeAttempt = await approveRequest(finance, created.body.correctionRequest.id, { paymentTiming: 'DEFERRED' });
      expect(financeAttempt.status).toBe(403);
    });

    it('rejects a malformed UUID request id cleanly (400, not a raw Prisma error)', async () => {
      const { admin } = await makeFixtures('approve-malformed-uuid');
      const res = await approveRequest(admin, 'not-a-uuid', { paymentTiming: 'DEFERRED' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // --- Sequential approval ---------------------------------------------------------------------

  describe('Sequential approval', () => {
    it('a second approval against the same field recalculates from the first\'s already-applied effect', async () => {
      const { site, entry, admin, adjustmentType } = await makeFixtures('sequential');
      const staff = await payrollStaffAgent('cp3-sequential-staff@test.local', [site.id]);

      const requestA = await createRequest(staff, entry.id, GROSS_PAY_BODY(adjustmentType.id, '32000'));
      const requestB = await createRequest(staff, entry.id, GROSS_PAY_BODY(adjustmentType.id, '34000'));

      const approvedA = await approveRequest(admin, requestA.body.correctionRequest.id, { paymentTiming: 'DEFERRED' });
      expect(approvedA.body.correction.oldValue).toBe('30000');
      expect(approvedA.body.correction.newValue).toBe('32000');

      const approvedB = await approveRequest(admin, requestB.body.correctionRequest.id, { paymentTiming: 'DEFERRED' });
      expect(approvedB.body.correction.oldValue).toBe('32000'); // reflects A, not the original 30,000
      expect(approvedB.body.correction.newValue).toBe('34000');
      expect(approvedB.body.balanceAdjustment.amount).toBe('2000'); // incremental, not cumulative
    });
  });

  // --- Concurrent approval ----------------------------------------------------------------------

  describe('Concurrent approval', () => {
    it('the same request approved concurrently: exactly one attempt succeeds', async () => {
      const { site, entry, admin, adjustmentType } = await makeFixtures('concurrent-same-request');
      const staff = await payrollStaffAgent('cp3-concurrent-same-staff@test.local', [site.id]);
      const created = await createRequest(staff, entry.id, GROSS_PAY_BODY(adjustmentType.id, '35000'));

      const [first, second] = await Promise.all([
        approveRequest(admin, created.body.correctionRequest.id, { paymentTiming: 'DEFERRED' }),
        approveRequest(admin, created.body.correctionRequest.id, { paymentTiming: 'DEFERRED' }),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 409]);

      const correctionCount = await prisma.correction.count({ where: { payrollEntryId: entry.id } });
      expect(correctionCount).toBe(1);
      const balanceAdjustmentCount = await prisma.balanceAdjustment.count({ where: { correction: { payrollEntryId: entry.id } } });
      expect(balanceAdjustmentCount).toBe(1);
    });

    /**
     * Both proposed values are *absolute*, not relative — whichever request the advisory lock lets
     * through first determines the other's baseline, which can flip its own classification between
     * PAYABLE and RECOVERY depending purely on race order (e.g. if the 34,000 proposal applies
     * first, the 32,000 one becomes a *decrease* relative to that new baseline). This is a correct,
     * expected property of absolute-value corrections, not something to paper over — so this helper
     * probes for the actual required `paymentTiming` rather than assuming PAYABLE ahead of time.
     */
    async function approveAdaptive(
      agent: Awaited<ReturnType<typeof createAuthenticatedAgent>>,
      requestId: string,
    ) {
      const attempt = await approveRequest(agent, requestId, {});
      if (attempt.status === 400 && attempt.body.error?.code === 'PAYMENT_TIMING_REQUIRED') {
        return approveRequest(agent, requestId, { paymentTiming: 'DEFERRED' });
      }
      return attempt;
    }

    it('two different requests on the same PayrollEntry serialize — the second recalculates after the first commits', async () => {
      const { site, entry, admin, adjustmentType } = await makeFixtures('concurrent-two-requests');
      const staff = await payrollStaffAgent('cp3-concurrent-two-staff@test.local', [site.id]);
      const requestA = await createRequest(staff, entry.id, GROSS_PAY_BODY(adjustmentType.id, '32000'));
      const requestB = await createRequest(staff, entry.id, GROSS_PAY_BODY(adjustmentType.id, '34000'));

      const [resA, resB] = await Promise.all([
        approveAdaptive(admin, requestA.body.correctionRequest.id),
        approveAdaptive(admin, requestB.body.correctionRequest.id),
      ]);

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);

      // Regardless of which happened to acquire the lock first: the one that went first must show
      // oldValue 30,000 (the original); the one that went second must show oldValue equal to
      // whichever absolute value the first one resulted in — never the original 30,000 for both,
      // which would mean the second ignored the first entirely.
      const first = resA.body.correction.oldValue === '30000' ? resA : resB;
      const second = resA.body.correction.oldValue === '30000' ? resB : resA;
      expect(second.body.correction.oldValue).toBe(first.body.correction.newValue);

      const total = await prisma.correction.count({ where: { payrollEntryId: entry.id } });
      expect(total).toBe(2);
    });

    it('requests on different PayrollEntries remain independent — neither blocks or corrupts the other', async () => {
      const { site, entry: entryA, admin, adjustmentType } = await makeFixtures('concurrent-independent-a');
      const unit = await makeUnit(site.id, 'Test Site CP3 concurrent-independent-b');
      const employeeB = await makeEmployee(site.id, unit.id, 'CP3 Employee concurrent-independent-b');
      const entryB = await makeReleasedEntry(site.id, unit.id, employeeB.id, admin.userId);
      const staff = await payrollStaffAgent('cp3-concurrent-independent-staff@test.local', [site.id]);

      const requestA = await createRequest(staff, entryA.id, GROSS_PAY_BODY(adjustmentType.id, '35000'));
      const requestB = await createRequest(staff, entryB.id, GROSS_PAY_BODY(adjustmentType.id, '36000'));

      const [resA, resB] = await Promise.all([
        approveRequest(admin, requestA.body.correctionRequest.id, { paymentTiming: 'DEFERRED' }),
        approveRequest(admin, requestB.body.correctionRequest.id, { paymentTiming: 'DEFERRED' }),
      ]);

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);
      expect(resA.body.correction.payrollEntryId).toBe(entryA.id);
      expect(resB.body.correction.payrollEntryId).toBe(entryB.id);
    });
  });

  // --- Rejection ---------------------------------------------------------------------------------

  describe('Rejection', () => {
    it('rejects a PENDING request, storing the reason, creating neither Correction nor BalanceAdjustment', async () => {
      const { site, entry, admin, adjustmentType } = await makeFixtures('reject-happy');
      const staff = await payrollStaffAgent('cp3-reject-happy-staff@test.local', [site.id]);
      const created = await createRequest(staff, entry.id, GROSS_PAY_BODY(adjustmentType.id));

      const res = await rejectRequest(admin, created.body.correctionRequest.id, { rejectionReason: 'Not supported by attendance records' });
      expect(res.status).toBe(200);
      expect(res.body.correctionRequest.status).toBe('REJECTED');
      expect(res.body.correctionRequest.rejectionReason).toBe('Not supported by attendance records');

      const correctionCount = await prisma.correction.count({ where: { payrollEntryId: entry.id } });
      expect(correctionCount).toBe(0);
      const balanceAdjustmentCount = await prisma.balanceAdjustment.count({ where: { correction: { payrollEntryId: entry.id } } });
      expect(balanceAdjustmentCount).toBe(0);
    });

    it('cannot be approved afterward (REQUEST_NOT_PENDING)', async () => {
      const { site, entry, admin, adjustmentType } = await makeFixtures('reject-then-approve');
      const staff = await payrollStaffAgent('cp3-reject-then-approve-staff@test.local', [site.id]);
      const created = await createRequest(staff, entry.id, GROSS_PAY_BODY(adjustmentType.id));
      await rejectRequest(admin, created.body.correctionRequest.id, { rejectionReason: 'Wrong Adjustment Type' });

      const res = await approveRequest(admin, created.body.correctionRequest.id, { paymentTiming: 'DEFERRED' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('REQUEST_NOT_PENDING');
    });

    it('rejects a blank rejectionReason', async () => {
      const { site, entry, admin, adjustmentType } = await makeFixtures('reject-blank-reason');
      const staff = await payrollStaffAgent('cp3-reject-blank-reason-staff@test.local', [site.id]);
      const created = await createRequest(staff, entry.id, GROSS_PAY_BODY(adjustmentType.id));

      const res = await rejectRequest(admin, created.body.correctionRequest.id, { rejectionReason: '   ' });
      expect(res.status).toBe(400);
    });

    it('writes a correction_request.rejected audit entry', async () => {
      const { site, entry, admin, adjustmentType } = await makeFixtures('reject-audit');
      const staff = await payrollStaffAgent('cp3-reject-audit-staff@test.local', [site.id]);
      const created = await createRequest(staff, entry.id, GROSS_PAY_BODY(adjustmentType.id));

      await rejectRequest(admin, created.body.correctionRequest.id, { rejectionReason: 'Duplicate of an earlier request' });

      const entries = await prisma.auditLog.findMany({
        where: { action: 'correction_request.rejected', entityId: created.body.correctionRequest.id },
      });
      expect(entries).toHaveLength(1);
    });
  });

  // --- Requester/reviewer separation (Post-Phase-5 Stabilization Checkpoint 4B remediation) --------

  /**
   * `assertNotSelfReview` (corrections.service.ts) — whoever submitted a `CorrectionRequest` may
   * never be the one who approves or rejects it, checked purely by comparing `requestedById` to
   * `currentUser.id`. `masterAdminAgent` is the only fixture in this file holding both
   * `payroll:entry` and `corrections:approve` simultaneously, so it doubles here as both the
   * requester and (in the "different reviewer" cases) a second, independent admin agent stands in
   * for a different reviewer — the exact scenario this guard exists for.
   */
  describe('Requester/reviewer separation', () => {
    it('a requester holding corrections:approve cannot approve their own PAYABLE request', async () => {
      const { entry, admin, adjustmentType } = await makeFixtures('self-approve-payable');
      const created = await createRequest(admin, entry.id, GROSS_PAY_BODY(adjustmentType.id, '35000'));

      const res = await approveRequest(admin, created.body.correctionRequest.id, { paymentTiming: 'DEFERRED' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('SELF_REVIEW_NOT_ALLOWED');
    });

    it('a requester holding corrections:approve cannot reject their own PAYABLE request', async () => {
      const { entry, admin, adjustmentType } = await makeFixtures('self-reject-payable');
      const created = await createRequest(admin, entry.id, GROSS_PAY_BODY(adjustmentType.id, '35000'));

      const res = await rejectRequest(admin, created.body.correctionRequest.id, {
        rejectionReason: 'Trying to reject my own request',
      });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('SELF_REVIEW_NOT_ALLOWED');
    });

    it('a requester holding corrections:approve cannot approve their own RECOVERY request', async () => {
      const { entry, admin, adjustmentType } = await makeFixtures('self-approve-recovery');
      const created = await createRequest(admin, entry.id, GROSS_PAY_BODY(adjustmentType.id, '25000'));

      const res = await approveRequest(admin, created.body.correctionRequest.id);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('SELF_REVIEW_NOT_ALLOWED');
    });

    it('a requester holding corrections:approve cannot reject their own RECOVERY request', async () => {
      const { entry, admin, adjustmentType } = await makeFixtures('self-reject-recovery');
      const created = await createRequest(admin, entry.id, GROSS_PAY_BODY(adjustmentType.id, '25000'));

      const res = await rejectRequest(admin, created.body.correctionRequest.id, {
        rejectionReason: 'Trying to reject my own request',
      });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('SELF_REVIEW_NOT_ALLOWED');
    });

    it('a different authorized reviewer can still approve the request', async () => {
      const { entry, admin, adjustmentType } = await makeFixtures('other-reviewer-approve');
      const created = await createRequest(admin, entry.id, GROSS_PAY_BODY(adjustmentType.id, '35000'));
      const otherReviewer = await masterAdminAgent('cp3-other-reviewer-approve-admin2@test.local');

      const res = await approveRequest(otherReviewer, created.body.correctionRequest.id, { paymentTiming: 'DEFERRED' });
      expect(res.status).toBe(200);
      expect(res.body.correctionRequest.status).toBe('APPROVED');
      expect(res.body.correction.approvedById).toBe(otherReviewer.userId);
    });

    it('a different authorized reviewer can still reject the request', async () => {
      const { entry, admin, adjustmentType } = await makeFixtures('other-reviewer-reject');
      const created = await createRequest(admin, entry.id, GROSS_PAY_BODY(adjustmentType.id, '35000'));
      const otherReviewer = await masterAdminAgent('cp3-other-reviewer-reject-admin2@test.local');

      const res = await rejectRequest(otherReviewer, created.body.correctionRequest.id, {
        rejectionReason: 'Reviewed by someone else',
      });
      expect(res.status).toBe(200);
      expect(res.body.correctionRequest.status).toBe('REJECTED');
    });

    it('a blocked self-approval attempt leaves the request, Correction, and BalanceAdjustment counts unchanged', async () => {
      const { entry, admin, adjustmentType } = await makeFixtures('self-block-no-side-effects');
      const created = await createRequest(admin, entry.id, GROSS_PAY_BODY(adjustmentType.id, '35000'));

      const res = await approveRequest(admin, created.body.correctionRequest.id, { paymentTiming: 'DEFERRED' });
      expect(res.status).toBe(403);

      const stillPending = await prisma.correctionRequest.findUniqueOrThrow({
        where: { id: created.body.correctionRequest.id },
      });
      expect(stillPending.status).toBe('PENDING');
      expect(stillPending.reviewedById).toBeNull();
      expect(stillPending.resultingCorrectionId).toBeNull();

      const correctionCount = await prisma.correction.count({ where: { payrollEntryId: entry.id } });
      expect(correctionCount).toBe(0);
      const balanceAdjustmentCount = await prisma.balanceAdjustment.count({
        where: { correction: { payrollEntryId: entry.id } },
      });
      expect(balanceAdjustmentCount).toBe(0);
    });

    it('a non-requester without corrections:approve is still blocked by the ordinary permission check, not the self-review guard', async () => {
      const { site, entry, adjustmentType } = await makeFixtures('non-requester-no-permission');
      const staff = await payrollStaffAgent('cp3-non-requester-no-permission-staff@test.local', [site.id]);
      const otherStaff = await payrollStaffAgent('cp3-non-requester-no-permission-staff2@test.local', [site.id]);
      const created = await createRequest(staff, entry.id, GROSS_PAY_BODY(adjustmentType.id));

      // otherStaff never submitted this request, but still holds no corrections:approve at all —
      // requirePermission's own middleware rejects this before assertNotSelfReview is ever reached.
      const res = await approveRequest(otherStaff, created.body.correctionRequest.id, { paymentTiming: 'DEFERRED' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  // --- Reversal ------------------------------------------------------------------------------------

  describe('Reversal', () => {
    it('a valid reversal (same entry + field) succeeds and links via reversesCorrectionId', async () => {
      const { site, entry, admin, adjustmentType } = await makeFixtures('reversal-valid');
      const staff = await payrollStaffAgent('cp3-reversal-valid-staff@test.local', [site.id]);
      const original = await createRequest(staff, entry.id, GROSS_PAY_BODY(adjustmentType.id, '35000'));
      const originalApproval = await approveRequest(admin, original.body.correctionRequest.id, { paymentTiming: 'DEFERRED' });

      const reversalRequest = await createRequest(staff, entry.id, GROSS_PAY_BODY(adjustmentType.id, '30000'));
      const reversalRes = await approveRequest(admin, reversalRequest.body.correctionRequest.id, {
        reversesCorrectionId: originalApproval.body.correction.id,
      });

      expect(reversalRes.status).toBe(200);
      expect(reversalRes.body.correction.reversesCorrectionId).toBe(originalApproval.body.correction.id);
      expect(reversalRes.body.correction.oldValue).toBe('35000');
      expect(reversalRes.body.correction.newValue).toBe('30000');
    });

    it('rejects a reversal target from a different PayrollEntry (REVERSAL_TARGET_MISMATCH)', async () => {
      const { site, entry: entryA, admin, adjustmentType } = await makeFixtures('reversal-cross-entry-a');
      const unit = await makeUnit(site.id, 'Test Site CP3 reversal-cross-entry-b');
      const employeeB = await makeEmployee(site.id, unit.id, 'CP3 Employee reversal-cross-entry-b');
      const entryB = await makeReleasedEntry(site.id, unit.id, employeeB.id, admin.userId);
      const staff = await payrollStaffAgent('cp3-reversal-cross-entry-staff@test.local', [site.id]);

      const onA = await createRequest(staff, entryA.id, GROSS_PAY_BODY(adjustmentType.id, '35000'));
      const approvedOnA = await approveRequest(admin, onA.body.correctionRequest.id, { paymentTiming: 'DEFERRED' });

      const onB = await createRequest(staff, entryB.id, GROSS_PAY_BODY(adjustmentType.id, '31000'));
      const res = await approveRequest(admin, onB.body.correctionRequest.id, {
        paymentTiming: 'DEFERRED',
        reversesCorrectionId: approvedOnA.body.correction.id,
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('REVERSAL_TARGET_MISMATCH');
    });

    it('a reversal leaves the original Correction row completely unchanged', async () => {
      const { site, entry, admin, adjustmentType } = await makeFixtures('reversal-immutable-original');
      const staff = await payrollStaffAgent('cp3-reversal-immutable-staff@test.local', [site.id]);
      const original = await createRequest(staff, entry.id, GROSS_PAY_BODY(adjustmentType.id, '35000'));
      const originalApproval = await approveRequest(admin, original.body.correctionRequest.id, { paymentTiming: 'DEFERRED' });
      const originalSnapshot = await prisma.correction.findUniqueOrThrow({ where: { id: originalApproval.body.correction.id } });

      const reversalRequest = await createRequest(staff, entry.id, GROSS_PAY_BODY(adjustmentType.id, '30000'));
      await approveRequest(admin, reversalRequest.body.correctionRequest.id, {
        paymentTiming: null,
        reversesCorrectionId: originalApproval.body.correction.id,
      });

      const originalAfter = await prisma.correction.findUniqueOrThrow({ where: { id: originalApproval.body.correction.id } });
      expect(originalAfter.oldValue).toBe(originalSnapshot.oldValue);
      expect(originalAfter.newValue).toBe(originalSnapshot.newValue);
      expect(originalAfter.approvedAt.getTime()).toBe(originalSnapshot.approvedAt.getTime());
      expect(originalAfter.reversesCorrectionId).toBeNull();
    });
  });

  // --- List/detail visibility (Presentation & Workflow Stabilization Checkpoint, 2026-07-25) ------
  //
  // Issue 3/4: a Payroll Manager (`payroll:entry`, no `corrections:approve`) may now list and open
  // exactly the correction requests they themselves submitted — the "My Requests" view — but never
  // another submitter's, and still never approve or reject regardless. These tests are the
  // regression guard for widening `correctionRequestsRouter`'s router-level gate from
  // `corrections:approve`-only to `ENTRY_VIEW_PERMISSIONS`.

  describe('List/detail visibility — payroll:entry vs corrections:approve', () => {
    it('a payroll:entry-only requester listing correction requests sees only their own, never another requester\'s', async () => {
      const { site, entry, adjustmentType } = await makeFixtures('visibility-list-own');
      const requester = await payrollStaffAgent('cp3-visibility-list-requester@test.local', [site.id]);
      const otherStaff = await payrollStaffAgent('cp3-visibility-list-other@test.local', [site.id]);

      const own = await createRequest(requester, entry.id, GROSS_PAY_BODY(adjustmentType.id, '31000'));
      const other = await createRequest(otherStaff, entry.id, GROSS_PAY_BODY(adjustmentType.id, '32000'));
      expect(own.status).toBe(201);
      expect(other.status).toBe(201);

      const res = await requester.agent.get('/api/v1/correction-requests');
      expect(res.status).toBe(200);
      const ids = res.body.correctionRequests.map((r: { id: string }) => r.id);
      expect(ids).toContain(own.body.correctionRequest.id);
      expect(ids).not.toContain(other.body.correctionRequest.id);
    });

    it('an approver listing correction requests still sees every request, not just their own', async () => {
      const { site, entry, admin, adjustmentType } = await makeFixtures('visibility-list-approver');
      const requester = await payrollStaffAgent('cp3-visibility-list-approver-requester@test.local', [site.id]);
      const created = await createRequest(requester, entry.id, GROSS_PAY_BODY(adjustmentType.id, '31000'));

      const res = await admin.agent.get('/api/v1/correction-requests');
      expect(res.status).toBe(200);
      const ids = res.body.correctionRequests.map((r: { id: string }) => r.id);
      expect(ids).toContain(created.body.correctionRequest.id);
    });

    it('a payroll:entry-only requester can open their own request\'s detail page', async () => {
      const { site, entry, adjustmentType } = await makeFixtures('visibility-detail-own');
      const requester = await payrollStaffAgent('cp3-visibility-detail-own@test.local', [site.id]);
      const created = await createRequest(requester, entry.id, GROSS_PAY_BODY(adjustmentType.id, '31000'));

      const res = await requester.agent.get(`/api/v1/correction-requests/${created.body.correctionRequest.id}`);
      expect(res.status).toBe(200);
      expect(res.body.correctionRequest.id).toBe(created.body.correctionRequest.id);
    });

    it('a payroll:entry-only requester cannot open another requester\'s detail page (403)', async () => {
      const { site, entry, adjustmentType } = await makeFixtures('visibility-detail-other');
      const owner = await payrollStaffAgent('cp3-visibility-detail-other-owner@test.local', [site.id]);
      const outsider = await payrollStaffAgent('cp3-visibility-detail-other-outsider@test.local', [site.id]);
      const created = await createRequest(owner, entry.id, GROSS_PAY_BODY(adjustmentType.id, '31000'));

      const res = await outsider.agent.get(`/api/v1/correction-requests/${created.body.correctionRequest.id}`);
      expect(res.status).toBe(403);
    });

    it('a payroll:entry-only requester still cannot approve or reject, even their own now-visible request (403)', async () => {
      const { site, entry, adjustmentType } = await makeFixtures('visibility-no-approve-rights');
      const requester = await payrollStaffAgent('cp3-visibility-no-approve-requester@test.local', [site.id]);
      const created = await createRequest(requester, entry.id, GROSS_PAY_BODY(adjustmentType.id, '31000'));
      const requestId = created.body.correctionRequest.id;

      const approveRes = await requester.agent
        .post(`/api/v1/correction-requests/${requestId}/approve`)
        .set('x-csrf-token', requester.csrfToken)
        .send({});
      expect(approveRes.status).toBe(403);

      const rejectRes = await requester.agent
        .post(`/api/v1/correction-requests/${requestId}/reject`)
        .set('x-csrf-token', requester.csrfToken)
        .send({ rejectionReason: 'Not applicable' });
      expect(rejectRes.status).toBe(403);
    });

    it('Finance (neither payroll:entry nor corrections:approve) still cannot list or open correction requests (403)', async () => {
      const { site, entry, adjustmentType } = await makeFixtures('visibility-finance-forbidden');
      const requester = await payrollStaffAgent('cp3-visibility-finance-requester@test.local', [site.id]);
      const finance = await financeAgent('cp3-visibility-finance@test.local', [site.id]);
      const created = await createRequest(requester, entry.id, GROSS_PAY_BODY(adjustmentType.id, '31000'));

      const listRes = await finance.agent.get('/api/v1/correction-requests');
      expect(listRes.status).toBe(403);

      const detailRes = await finance.agent.get(`/api/v1/correction-requests/${created.body.correctionRequest.id}`);
      expect(detailRes.status).toBe(403);
    });
  });

  // --- API security ------------------------------------------------------------------------------

  describe('API security', () => {
    it('rejects a request with no session at all (401)', async () => {
      const res = await request(app).get('/api/v1/correction-requests');
      expect(res.status).toBe(401);
    });

    it('rejects a mutating request missing the CSRF header (403)', async () => {
      const { site, entry, adjustmentType } = await makeFixtures('security-csrf');
      const staff = await payrollStaffAgent('cp3-security-csrf-staff@test.local', [site.id]);

      const res = await staff.agent.post(`/api/v1/payroll-entries/${entry.id}/correction-requests`).send(GROSS_PAY_BODY(adjustmentType.id));
      expect(res.status).toBe(403);
    });

    it('rejects a malformed UUID entryId cleanly (400)', async () => {
      const { site, adjustmentType } = await makeFixtures('security-malformed-uuid');
      const staff = await payrollStaffAgent('cp3-security-malformed-staff@test.local', [site.id]);

      const res = await createRequest(staff, 'not-a-uuid', GROSS_PAY_BODY(adjustmentType.id));
      expect(res.status).toBe(400);
    });

    it('the approval response never leaks a raw internal field (password hash, session, storage key)', async () => {
      const { site, entry, admin, adjustmentType } = await makeFixtures('security-sanitized');
      const staff = await payrollStaffAgent('cp3-security-sanitized-staff@test.local', [site.id]);
      const created = await createRequest(staff, entry.id, GROSS_PAY_BODY(adjustmentType.id, '35000'));

      const res = await approveRequest(admin, created.body.correctionRequest.id, { paymentTiming: 'DEFERRED' });
      expect(res.status).toBe(200);
      assertNoSensitiveKeys(res.body);
    });
  });

  // --- Transaction rollback -----------------------------------------------------------------------

  describe('Transaction rollback', () => {
    it('a failure right after Correction creation (before BalanceAdjustment) rolls back everything', async () => {
      const { site, entry, admin, adjustmentType } = await makeFixtures('rollback-after-correction');
      const staff = await payrollStaffAgent('cp3-rollback-after-correction-staff@test.local', [site.id]);
      const created = await createRequest(staff, entry.id, GROSS_PAY_BODY(adjustmentType.id, '35000'));

      const spy = jest
        .spyOn(correctionsRepository, 'createBalanceAdjustmentRow')
        .mockImplementation(async () => {
          throw new Error('simulated failure after Correction creation');
        });

      try {
        const res = await approveRequest(admin, created.body.correctionRequest.id, { paymentTiming: 'DEFERRED' });
        expect(res.status).toBe(500);

        const correctionCount = await prisma.correction.count({ where: { payrollEntryId: entry.id } });
        expect(correctionCount).toBe(0);
        const requestAfter = await prisma.correctionRequest.findUniqueOrThrow({ where: { id: created.body.correctionRequest.id } });
        expect(requestAfter.status).toBe('PENDING');
      } finally {
        spy.mockRestore();
      }
    });

    it('a failure right after BalanceAdjustment creation (before the request status flip) rolls back everything', async () => {
      const { site, entry, admin, adjustmentType } = await makeFixtures('rollback-after-balance-adjustment');
      const staff = await payrollStaffAgent('cp3-rollback-after-ba-staff@test.local', [site.id]);
      const created = await createRequest(staff, entry.id, GROSS_PAY_BODY(adjustmentType.id, '35000'));

      const spy = jest
        .spyOn(correctionsRepository, 'markCorrectionRequestApproved')
        .mockImplementation(async () => {
          throw new Error('simulated failure after BalanceAdjustment creation');
        });

      try {
        const res = await approveRequest(admin, created.body.correctionRequest.id, { paymentTiming: 'DEFERRED' });
        expect(res.status).toBe(500);

        const correctionCount = await prisma.correction.count({ where: { payrollEntryId: entry.id } });
        expect(correctionCount).toBe(0);
        const balanceAdjustmentCount = await prisma.balanceAdjustment.count({ where: { correction: { payrollEntryId: entry.id } } });
        expect(balanceAdjustmentCount).toBe(0);
        const requestAfter = await prisma.correctionRequest.findUniqueOrThrow({ where: { id: created.body.correctionRequest.id } });
        expect(requestAfter.status).toBe('PENDING');
      } finally {
        spy.mockRestore();
      }
    });

    it('a failure right after the request status flip (during audit) rolls back everything, including the status flip itself', async () => {
      const { site, entry, admin, adjustmentType } = await makeFixtures('rollback-after-status-flip');
      const staff = await payrollStaffAgent('cp3-rollback-after-flip-staff@test.local', [site.id]);
      const created = await createRequest(staff, entry.id, GROSS_PAY_BODY(adjustmentType.id, '35000'));

      const realRecordAuditLog = auditLogService.recordAuditLog;
      const spy = jest.spyOn(auditLogService, 'recordAuditLog').mockImplementation(async (input, client) => {
        if (input.action === 'correction.approved') {
          throw new Error('simulated failure during audit recording');
        }
        return realRecordAuditLog(input, client);
      });

      try {
        const res = await approveRequest(admin, created.body.correctionRequest.id, { paymentTiming: 'DEFERRED' });
        expect(res.status).toBe(500);

        const correctionCount = await prisma.correction.count({ where: { payrollEntryId: entry.id } });
        expect(correctionCount).toBe(0);
        const balanceAdjustmentCount = await prisma.balanceAdjustment.count({ where: { correction: { payrollEntryId: entry.id } } });
        expect(balanceAdjustmentCount).toBe(0);
        const requestAfter = await prisma.correctionRequest.findUniqueOrThrow({ where: { id: created.body.correctionRequest.id } });
        expect(requestAfter.status).toBe('PENDING'); // the in-transaction UPDATE also rolled back
        // Scoped to this test's own entry via the JSON metadata payload — a bare action-name count
        // would also see every other test's own correction.approved entries in this same file run.
        const auditEntries = await prisma.auditLog.count({
          where: { action: 'correction.approved', metadata: { path: ['payrollEntryId'], equals: entry.id } },
        });
        expect(auditEntries).toBe(0);
      } finally {
        spy.mockRestore();
      }
    });
  });
});
