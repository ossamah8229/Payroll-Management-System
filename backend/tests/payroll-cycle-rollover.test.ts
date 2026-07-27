import request from 'supertest';
import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { storageProvider } from '../src/lib/storage';
import * as auditLogService from '../src/modules/audit-log/audit-log.service';
import { cleanTestData, createAuthenticatedAgent, extractCookie } from './helpers';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

describe('Phase 5 Checkpoint 3 — Cycle Archiving, Automatic Backup Generation, and New-Cycle Rollover', () => {
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
      permissionKeys: [
        PERMISSIONS.PAYROLL_CYCLE_MANAGE,
        PERMISSIONS.PAYROLL_ENTRY,
        PERMISSIONS.PAYROLL_RELEASE,
        PERMISSIONS.ADVANCES_MANAGE,
      ],
    });
  }

  async function payrollStaffAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.PAYROLL_STAFF,
      permissionKeys: [PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.ADVANCES_MANAGE],
      siteIds,
    });
  }

  async function financeAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.FINANCE,
      permissionKeys: [PERMISSIONS.PAYROLL_VIEW, PERMISSIONS.PAYROLL_RELEASE],
      siteIds,
    });
  }

  async function makeSiteWithUnit(name: string) {
    const site = await prisma.projectSite.create({ data: { name } });
    const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} Unit` } });
    return { site, unit };
  }

  async function makeEmployee(
    siteId: string,
    unitId: string,
    name: string,
    overrides: { grossPay?: string; dateOfLeaving?: Date | null } = {},
  ) {
    return prisma.employee.create({
      data: {
        name,
        designation: 'Guard',
        siteId,
        unitId,
        grossPay: overrides.grossPay ?? '30000',
        dateOfLeaving: overrides.dateOfLeaving ?? null,
      },
    });
  }

  async function makeDraftCycle(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, month: number, year = 2900) {
    const res = await admin.agent
      .post('/api/v1/payroll-cycles')
      .set('x-csrf-token', admin.csrfToken)
      .send({ year, month });
    if (res.status !== 201) throw new Error(`cycle create failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.cycle as { id: string; year: number; month: number; status: string };
  }

  async function getEntry(
    admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>,
    cycleId: string,
    employeeId: string,
  ) {
    const res = await admin.agent.get(`/api/v1/payroll-cycles/${cycleId}/entries?employeeId=${employeeId}`);
    if (res.status !== 200 || !res.body.entries?.length) {
      throw new Error(`entry not found: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body.entries[0] as { id: string; version: number; hold: boolean; released: boolean };
  }

  async function releaseUnit(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, cycleId: string, unitId: string) {
    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycleId}/units/${unitId}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    if (res.status !== 201) throw new Error(`release failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  async function holdEntry(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, entryId: string, version: number) {
    const res = await admin.agent
      .patch(`/api/v1/payroll-entries/${entryId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version, hold: true });
    if (res.status !== 200) throw new Error(`hold failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.entry as { id: string; version: number };
  }

  async function finalizeCycle(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, cycleId: string) {
    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycleId}/finalize`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    if (res.status !== 200) throw new Error(`finalize failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.cycle as { id: string; status: string };
  }

  function rollover(agent: { agent: ReturnType<typeof request.agent>; csrfToken: string }, cycleId: string) {
    return agent.agent
      .post(`/api/v1/payroll-cycles/${cycleId}/archive-and-create-next`)
      .set('x-csrf-token', agent.csrfToken)
      .send({});
  }

  function generateBackup(agent: { agent: ReturnType<typeof request.agent>; csrfToken: string }, cycleId: string) {
    return agent.agent
      .post(`/api/v1/payroll-cycles/${cycleId}/backup-packages`)
      .set('x-csrf-token', agent.csrfToken)
      .send({});
  }

  function createAdvance(agent: { agent: ReturnType<typeof request.agent>; csrfToken: string }, body: Record<string, unknown>) {
    return agent.agent.post('/api/v1/advances').set('x-csrf-token', agent.csrfToken).send(body);
  }

  /** One active employee, released, cycle finalized — the minimal RELEASED cycle every rollover
   * test starts from. */
  async function makeReleasedCycle(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, month: number) {
    const { site, unit } = await makeSiteWithUnit(`Test Site Rollover ${month}`);
    const employee = await makeEmployee(site.id, unit.id, `Rollover Employee ${month}`);
    const cycle = await makeDraftCycle(admin, month);
    // Negative Payroll Recovery checkpoint (2026-07-26) — the employee's entry is auto-bootstrapped
    // by cycle creation with 0 work days, netting -400 (the default 400 EOBI deduction), which now
    // correctly resolves to RECOVERY_DUE rather than releasing for payment. This suite is about
    // rollover mechanics, not net-salary sign, so the auto-created entry is patched to a positive
    // net salary before release.
    const bootstrapped = await getEntry(admin, cycle.id, employee.id);
    await admin.agent
      .patch(`/api/v1/payroll-entries/${bootstrapped.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: bootstrapped.version, eobiApplicable: false, allowance: '5000' });
    await releaseUnit(admin, cycle.id, unit.id);
    const finalized = await finalizeCycle(admin, cycle.id);
    return { site, unit, employee, cycle: finalized };
  }

  // --- Lifecycle ----------------------------------------------------------------------------

  it('rolls over a Released cycle: archives the outgoing cycle and creates the next Draft', async () => {
    const admin = await masterAdminAgent('rollover-lifecycle-admin@test.local');
    const { cycle } = await makeReleasedCycle(admin, 1);

    const res = await rollover(admin, cycle.id);
    expect(res.status).toBe(201);
    expect(res.body.outgoingCycle.id).toBe(cycle.id);
    expect(res.body.outgoingCycle.status).toBe('ARCHIVED');
    expect(res.body.newCycle.status).toBe('DRAFT');
    expect(res.body.newCycle.year).toBe(2900);
    expect(res.body.newCycle.month).toBe(2);
    expect(res.body.newCycle.sourceCycleId).toBe(cycle.id);

    const archived = await prisma.payrollCycle.findUniqueOrThrow({ where: { id: cycle.id } });
    expect(archived.status).toBe('ARCHIVED');
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.archivedBy).toBe(admin.userId);
    expect(archived.archivedWithBackupPackageId).toBe(res.body.backupPackageId);
    // releasedAt/releasedBy from Finalize are preserved, untouched by archiving.
    expect(archived.releasedAt).not.toBeNull();
    expect(archived.releasedBy).toBe(admin.userId);
  });

  it('rejects rolling over a Draft cycle', async () => {
    const admin = await masterAdminAgent('rollover-draft-admin@test.local');
    const cycle = await makeDraftCycle(admin, 2);

    const res = await rollover(admin, cycle.id);
    expect(res.status).toBe(400);

    const count = await prisma.payrollCycle.count({ where: { year: 2900 } });
    expect(count).toBe(1);
  });

  it('rejects rolling over an already-Archived cycle — a second rollover attempt on the same outgoing cycle fails cleanly', async () => {
    const admin = await masterAdminAgent('rollover-archived-admin@test.local');
    const { cycle } = await makeReleasedCycle(admin, 3);

    const first = await rollover(admin, cycle.id);
    expect(first.status).toBe(201);

    const second = await rollover(admin, cycle.id);
    expect(second.status).toBe(400);

    // Exactly one Draft, exactly one Archived — no duplicate next cycle from the failed retry.
    const cycles = await prisma.payrollCycle.findMany({ where: { year: { in: [2900, 2901] } }, orderBy: { month: 'asc' } });
    expect(cycles.filter((c) => c.status === 'DRAFT')).toHaveLength(1);
    expect(cycles.filter((c) => c.status === 'ARCHIVED')).toHaveLength(1);
  });

  it('never alters the outgoing cycle\'s own historical PayrollEntry values', async () => {
    const admin = await masterAdminAgent('rollover-immutable-admin@test.local');
    const { cycle, employee } = await makeReleasedCycle(admin, 4);
    const before = await getEntry(admin, cycle.id, employee.id);

    const res = await rollover(admin, cycle.id);
    expect(res.status).toBe(201);

    const after = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.version).toBe(before.version);
    expect(after.released).toBe(true);
  });

  it('derives the next period automatically — December rolls the year, with no request body override', async () => {
    const admin = await masterAdminAgent('rollover-december-admin@test.local');
    const { cycle } = await makeReleasedCycle(admin, 12);

    const res = await rollover(admin, cycle.id);
    expect(res.status).toBe(201);
    expect(res.body.newCycle.year).toBe(2901);
    expect(res.body.newCycle.month).toBe(1);
  });

  it('rejects when more than one Released cycle exists (defensive invariant check)', async () => {
    const admin = await masterAdminAgent('rollover-multi-released-admin@test.local');
    const { cycle } = await makeReleasedCycle(admin, 5);

    // Can only arise from a direct database write — the API itself can never produce two RELEASED
    // cycles simultaneously once this checkpoint ships. Simulates the defensive backstop firing.
    const rogue = await prisma.payrollCycle.create({
      data: { year: 2900, month: 6, status: 'RELEASED', createdBy: admin.userId, releasedAt: new Date(), releasedBy: admin.userId },
    });

    const res = await rollover(admin, cycle.id);
    expect(res.status).toBe(409);

    await prisma.payrollCycle.delete({ where: { id: rogue.id } });
  });

  // --- Backup Package -------------------------------------------------------------------------

  it('always generates a fresh Backup Package version at rollover, reflecting a held-entry edit made after Finalize — never reusing an earlier manually-generated READY package', async () => {
    const admin = await masterAdminAgent('rollover-backup-fresh-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Rollover Backup Fresh');
    const employee = await makeEmployee(site.id, unit.id, 'Backup Fresh Employee');
    const cycle = await makeDraftCycle(admin, 7);
    const entry = await getEntry(admin, cycle.id, employee.id);
    await holdEntry(admin, entry.id, entry.version); // held, never released
    const finalized = await finalizeCycle(admin, cycle.id);

    // Manual v1 generated right after Finalize.
    const manual = await generateBackup(admin, finalized.id);
    expect(manual.status).toBe(201);
    expect(manual.body.backupPackage.version).toBe(1);

    // The held entry is still editable after Finalize (Checkpoint 1's own approved rule) — change
    // its grossPay, which v1 does NOT reflect.
    const heldAfterFinalize = await getEntry(admin, finalized.id, employee.id);
    await admin.agent
      .patch(`/api/v1/payroll-entries/${heldAfterFinalize.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: heldAfterFinalize.version, grossPay: '99999.99' });

    const res = await rollover(admin, finalized.id);
    expect(res.status).toBe(201);
    expect(res.body.backupPackageVersion).toBe(2); // fresh version, not a reuse of v1

    const v2Files = await prisma.backupPackageFile.findMany({
      where: { backupPackageId: res.body.backupPackageId, fileType: 'PAYROLL_ENTRY_CSV' },
    });
    const v2Csv = await storageProvider.read(v2Files[0]!.storageKey);
    expect(v2Csv.toString('utf-8')).toContain('99999.99');

    const v1Files = await prisma.backupPackageFile.findMany({
      where: { backupPackageId: manual.body.backupPackage.id, fileType: 'PAYROLL_ENTRY_CSV' },
    });
    const v1Csv = await storageProvider.read(v1Files[0]!.storageKey);
    expect(v1Csv.toString('utf-8')).not.toContain('99999.99'); // v1 stays byte-identical to when it was generated

    // v1's own row is immutable — rollover's fresh generation never touches a prior version's record.
    const v1After = await prisma.backupPackage.findUniqueOrThrow({ where: { id: manual.body.backupPackage.id } });
    expect(v1After.status).toBe('READY');
    expect(v1After.updatedAt.getTime()).toBe(new Date(manual.body.backupPackage.updatedAt).getTime());
  });

  it('on a storage write failure: outgoing cycle stays Released, no Draft is created, the reserved BackupPackage is marked FAILED, and its own storage objects are cleaned up', async () => {
    const admin = await masterAdminAgent('rollover-storage-fail-admin@test.local');
    const { cycle } = await makeReleasedCycle(admin, 8);

    let writeCount = 0;
    const realWrite = storageProvider.write.bind(storageProvider);
    const spy = jest.spyOn(storageProvider, 'write').mockImplementation(async (key, data, options) => {
      writeCount += 1;
      if (writeCount === 2) {
        throw new Error('simulated storage failure');
      }
      return realWrite(key, data, options);
    });

    try {
      const res = await rollover(admin, cycle.id);
      expect(res.status).toBe(500);

      const outgoingAfter = await prisma.payrollCycle.findUniqueOrThrow({ where: { id: cycle.id } });
      expect(outgoingAfter.status).toBe('RELEASED');
      expect(outgoingAfter.archivedAt).toBeNull();

      const draftCount = await prisma.payrollCycle.count({ where: { year: 2900, month: 9 } });
      expect(draftCount).toBe(0);

      const failedPkg = await prisma.backupPackage.findFirstOrThrow({ where: { cycleId: cycle.id } });
      expect(failedPkg.status).toBe('FAILED');

      expect(await storageProvider.exists(`backups/${cycle.id}/v1/manifest.json`)).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('on a failure deep inside the transaction (post-storage-write): the entire transaction rolls back — no archive, no Draft, no bootstrap — and the BackupPackage is still marked FAILED', async () => {
    const admin = await masterAdminAgent('rollover-tx-fail-admin@test.local');
    const { cycle } = await makeReleasedCycle(admin, 9);

    // The rollover transaction writes audit entries in order: backup_package.generated (inside
    // commitBackupPackageReady), payroll_cycle.archived, payroll_cycle.created,
    // payroll_cycle.rollover_completed. Throwing on payroll_cycle.created simulates a failure
    // after the backup-commit/archive/new-cycle/bootstrap steps have already run inside the
    // (still uncommitted) transaction — proving they all roll back together.
    const realRecordAuditLog = auditLogService.recordAuditLog;
    const spy = jest.spyOn(auditLogService, 'recordAuditLog').mockImplementation(async (input, client) => {
      if (input.action === 'payroll_cycle.created') {
        throw new Error('simulated mid-transaction failure');
      }
      return realRecordAuditLog(input, client);
    });

    try {
      const res = await rollover(admin, cycle.id);
      expect(res.status).toBe(500);

      const outgoingAfter = await prisma.payrollCycle.findUniqueOrThrow({ where: { id: cycle.id } });
      expect(outgoingAfter.status).toBe('RELEASED'); // archive rolled back
      expect(outgoingAfter.archivedWithBackupPackageId).toBeNull();

      const draftCount = await prisma.payrollCycle.count({ where: { year: 2900, month: 10 } });
      expect(draftCount).toBe(0); // new cycle rolled back

      const pkg = await prisma.backupPackage.findFirstOrThrow({ where: { cycleId: cycle.id } });
      expect(pkg.status).toBe('FAILED'); // the READY flip rolled back to GENERATING, then marked FAILED
    } finally {
      spy.mockRestore();
    }
  });

  // --- Bootstrap ------------------------------------------------------------------------------

  it('bootstraps every currently active employee into the new Draft cycle', async () => {
    const admin = await masterAdminAgent('rollover-active-admin@test.local');
    const { cycle, employee } = await makeReleasedCycle(admin, 10);

    const res = await rollover(admin, cycle.id);
    expect(res.status).toBe(201);
    expect(res.body.entriesCreated).toBe(1);
    expect(res.body.departedObligationEntries).toBe(0);

    const newEntry = await prisma.payrollEntry.findFirst({ where: { cycleId: res.body.newCycle.id, employeeId: employee.id } });
    expect(newEntry).not.toBeNull();
    expect(newEntry!.hold).toBe(false);
  });

  it('excludes a departed employee who has no outstanding obligation', async () => {
    const admin = await masterAdminAgent('rollover-departed-no-obligation-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Rollover Departed No Obligation');
    const staying = await makeEmployee(site.id, unit.id, 'Staying Employee');
    const departing = await makeEmployee(site.id, unit.id, 'Departing No Obligation');
    const cycle = await makeDraftCycle(admin, 11);
    await releaseUnit(admin, cycle.id, unit.id);
    const finalized = await finalizeCycle(admin, cycle.id);

    await prisma.employee.update({ where: { id: departing.id }, data: { dateOfLeaving: new Date('2900-11-15') } });

    const res = await rollover(admin, finalized.id);
    expect(res.status).toBe(201);
    expect(res.body.departedObligationEntries).toBe(0);

    const departedEntry = await prisma.payrollEntry.findFirst({
      where: { cycleId: res.body.newCycle.id, employeeId: departing.id },
    });
    expect(departedEntry).toBeNull();

    const stayingEntry = await prisma.payrollEntry.findFirst({
      where: { cycleId: res.body.newCycle.id, employeeId: staying.id },
    });
    expect(stayingEntry).not.toBeNull();
  });

  it('includes a departed employee with a due ACTIVE Advance — zero salary fields, held, and materializes the deduction exactly once', async () => {
    const admin = await masterAdminAgent('rollover-departed-obligation-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Rollover Departed Obligation');
    const departing = await makeEmployee(site.id, unit.id, 'Departing With Advance', { grossPay: '50000' });
    const cycle = await makeDraftCycle(admin, 12);
    await releaseUnit(admin, cycle.id, unit.id);
    const finalized = await finalizeCycle(admin, cycle.id);

    // Scheduled directly against the period rollover will derive (year 2900, month 12 -> 2901/1).
    const advanceRes = await createAdvance(admin, {
      employeeId: departing.id,
      type: 'LOAN',
      totalAmount: '5000',
      dateGiven: '2026-01-05',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2901, month: 1 },
    });
    expect(advanceRes.status).toBe(201);

    await prisma.employee.update({ where: { id: departing.id }, data: { dateOfLeaving: new Date('2900-12-20') } });

    const res = await rollover(admin, finalized.id);
    expect(res.status).toBe(201);
    expect(res.body.departedObligationEntries).toBe(1);
    expect(res.body.advancesMaterialized).toBe(1);

    const departedEntryCount = await prisma.payrollEntry.count({
      where: { cycleId: res.body.newCycle.id, employeeId: departing.id },
    });
    expect(departedEntryCount).toBe(1); // no duplicate entry

    const departedEntry = await prisma.payrollEntry.findFirstOrThrow({
      where: { cycleId: res.body.newCycle.id, employeeId: departing.id },
      include: { workLines: true },
    });
    expect(Number(departedEntry.grossPay)).toBe(0);
    expect(Number(departedEntry.eobiAmount)).toBe(0);
    expect(departedEntry.eobiApplicable).toBe(false);
    expect(departedEntry.hold).toBe(true);
    expect(departedEntry.released).toBe(false);
    expect(Number(departedEntry.advanceDeduction)).toBe(5000);
    expect(departedEntry.advanceId).toBe(advanceRes.body.advance.id);
    // Attendance/worked days are zero (no work performed) while cycleDays — the cycle's own
    // day-count basis, not an attendance figure — still satisfies the schema's 1-31 check
    // constraint (schema default, 30), never the invalid 0 an earlier version of this checkpoint
    // used.
    expect(departedEntry.workLines).toHaveLength(1);
    expect(Number(departedEntry.workLines[0]!.days)).toBe(0);
    expect(Number(departedEntry.workLines[0]!.otHours)).toBe(0);
    expect(departedEntry.workLines[0]!.cycleDays).toBe(30);
    expect(departedEntry.workLines[0]!.cycleDays).toBeGreaterThanOrEqual(1);
    expect(departedEntry.workLines[0]!.cycleDays).toBeLessThanOrEqual(31);

    const advanceAfter = await prisma.advance.findUniqueOrThrow({ where: { id: advanceRes.body.advance.id } });
    // FULL_DEDUCTION reserves the whole balance in one shot, but this new cycle's entry has not
    // been released yet — RESERVED, not PAID_OFF (Presentation & Workflow Stabilization
    // Checkpoint, 2026-07-25, Issue 5).
    expect(advanceAfter.status).toBe('RESERVED');
    expect(Number(advanceAfter.outstandingBalance)).toBe(0);

    const materializedAudits = await prisma.auditLog.findMany({
      where: { action: 'advance.schedule_materialized', entityId: advanceRes.body.advance.id },
    });
    expect(materializedAudits).toHaveLength(1);
  });

  it('a departed employee whose advance is paid off by one rollover is excluded from the following rollover', async () => {
    const admin = await masterAdminAgent('rollover-paid-off-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Rollover Paid Off');
    const departing = await makeEmployee(site.id, unit.id, 'Paid Off Employee');
    const cycle1 = await makeDraftCycle(admin, 1, 2901);
    await releaseUnit(admin, cycle1.id, unit.id);
    const finalized1 = await finalizeCycle(admin, cycle1.id);

    const advanceRes = await createAdvance(admin, {
      employeeId: departing.id,
      type: 'LOAN',
      totalAmount: '3000',
      dateGiven: '2026-01-05',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2901, month: 2 },
    });
    expect(advanceRes.status).toBe(201);
    await prisma.employee.update({ where: { id: departing.id }, data: { dateOfLeaving: new Date('2901-01-20') } });

    const rollover1 = await rollover(admin, finalized1.id);
    expect(rollover1.status).toBe(201);
    expect(rollover1.body.departedObligationEntries).toBe(1);

    // Finalize the new Draft (empty precondition aside from the departed entry, which is held) and
    // roll over again — the now-paid-off advance must not resurrect a second entry.
    const secondEntry = await getEntry(admin, rollover1.body.newCycle.id, departing.id);
    expect(secondEntry.hold).toBe(true);
    const finalized2 = await finalizeCycle(admin, rollover1.body.newCycle.id);

    const rollover2 = await rollover(admin, finalized2.id);
    expect(rollover2.status).toBe(201);
    expect(rollover2.body.departedObligationEntries).toBe(0);

    const thirdEntry = await prisma.payrollEntry.findFirst({
      where: { cycleId: rollover2.body.newCycle.id, employeeId: departing.id },
    });
    expect(thirdEntry).toBeNull();
  });

  // --- Audit ------------------------------------------------------------------------------------

  it('writes payroll_cycle.archived, payroll_cycle.created, payroll_cycle.rollover_completed, and backup_package.generated audit entries with correct metadata', async () => {
    const admin = await masterAdminAgent('rollover-audit-admin@test.local');
    const { cycle, employee } = await makeReleasedCycle(admin, 2);

    const res = await rollover(admin, cycle.id);
    expect(res.status).toBe(201);

    const archivedAudit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'payroll_cycle.archived', entityId: cycle.id },
    });
    const archivedMeta = archivedAudit.metadata as Record<string, unknown>;
    expect(archivedMeta.outgoingCycleId).toBe(cycle.id);
    expect(archivedMeta.newCycleId).toBe(res.body.newCycle.id);
    expect(archivedMeta.backupPackageId).toBe(res.body.backupPackageId);
    expect(archivedMeta.backupVersion).toBe(1);
    expect(archivedMeta.entryCount).toBe(1);

    const createdAudit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'payroll_cycle.created', entityId: res.body.newCycle.id },
    });
    expect((createdAudit.metadata as Record<string, unknown>).sourceCycleId).toBe(cycle.id);

    const rolloverAudit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'payroll_cycle.rollover_completed', entityId: res.body.newCycle.id },
    });
    const rolloverMeta = rolloverAudit.metadata as Record<string, unknown>;
    expect(rolloverMeta.outgoingCycleId).toBe(cycle.id);
    expect(rolloverMeta.entriesCreated).toBe(1);

    const backupAudit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'backup_package.generated', entityId: res.body.backupPackageId },
    });
    expect((backupAudit.metadata as Record<string, unknown>).cycleId).toBe(cycle.id);

    void employee;
  });

  // --- Concurrency --------------------------------------------------------------------------------

  it('two simultaneous rollover attempts on the same outgoing cycle: exactly one succeeds, no duplicate archive, no duplicate Draft, no duplicate ScheduledPayrollPeriod, no duplicate Payroll Entry per employee, and no duplicate Advance materialization', async () => {
    const admin = await masterAdminAgent('rollover-concurrency-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Rollover Concurrency');
    const active = await makeEmployee(site.id, unit.id, 'Concurrency Active Employee');
    const departing = await makeEmployee(site.id, unit.id, 'Concurrency Departing Employee', { grossPay: '20000' });
    const cycle = await makeDraftCycle(admin, 6);
    await releaseUnit(admin, cycle.id, unit.id);
    const finalized = await finalizeCycle(admin, cycle.id);

    const advanceRes = await createAdvance(admin, {
      employeeId: departing.id,
      type: 'LOAN',
      totalAmount: '2000',
      dateGiven: '2026-01-05',
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2900, month: 7 },
    });
    expect(advanceRes.status).toBe(201);
    await prisma.employee.update({ where: { id: departing.id }, data: { dateOfLeaving: new Date('2900-06-20') } });

    const [first, second] = await Promise.all([rollover(admin, finalized.id), rollover(admin, finalized.id)]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, expect.any(Number)]);
    // Exactly one success; the other is a clean conflict/failure, never a second 201.
    expect([first.status, second.status].filter((s) => s === 201)).toHaveLength(1);
    const winner = first.status === 201 ? first : second;

    const archivedCount = await prisma.payrollCycle.count({ where: { id: finalized.id, status: 'ARCHIVED' } });
    expect(archivedCount).toBe(1);

    const draftCount = await prisma.payrollCycle.count({ where: { sourceCycleId: finalized.id } });
    expect(draftCount).toBe(1);

    const periodCount = await prisma.scheduledPayrollPeriod.count({ where: { year: 2900, month: 7 } });
    expect(periodCount).toBe(1);

    const activeEntryCount = await prisma.payrollEntry.count({
      where: { cycleId: winner.body.newCycle.id, employeeId: active.id },
    });
    expect(activeEntryCount).toBe(1);

    const departedEntryCount = await prisma.payrollEntry.count({
      where: { cycleId: winner.body.newCycle.id, employeeId: departing.id },
    });
    expect(departedEntryCount).toBe(1);

    const advanceAfter = await prisma.advance.findUniqueOrThrow({ where: { id: advanceRes.body.advance.id } });
    // materialized exactly once, not twice — RESERVED (not PAID_OFF) since this new cycle's entry
    // has not been released yet (Presentation & Workflow Stabilization Checkpoint, 2026-07-25).
    expect(advanceAfter.status).toBe('RESERVED');
    expect(Number(advanceAfter.outstandingBalance)).toBe(0);

    const materializedAudits = await prisma.auditLog.findMany({
      where: { action: 'advance.schedule_materialized', entityId: advanceRes.body.advance.id },
    });
    expect(materializedAudits).toHaveLength(1);

    const rolloverCompletedAudits = await prisma.auditLog.findMany({
      where: { action: 'payroll_cycle.rollover_completed', entityId: winner.body.newCycle.id },
    });
    expect(rolloverCompletedAudits).toHaveLength(1);
  });

  // --- Security and RBAC ---------------------------------------------------------------------

  it('allows Master Admin, forbids Payroll Staff and Finance, rejects unauthenticated, enforces CSRF', async () => {
    const admin = await masterAdminAgent('rollover-rbac-admin@test.local');
    const { site } = await makeSiteWithUnit('Test Site Rollover RBAC');
    const { cycle } = await makeReleasedCycle(admin, 3);
    const staff = await payrollStaffAgent('rollover-rbac-staff@test.local', [site.id]);
    const finance = await financeAgent('rollover-rbac-finance@test.local', [site.id]);

    const staffRes = await rollover(staff, cycle.id);
    expect(staffRes.status).toBe(403);

    const financeRes = await rollover(finance, cycle.id);
    expect(financeRes.status).toBe(403);

    const anon = request.agent(app);
    const primeRes = await anon.get('/health');
    const anonCsrfToken = extractCookie(primeRes, 'csrf_token');
    if (!anonCsrfToken) throw new Error('Expected /health to issue a csrf_token cookie');
    const unauth = await anon
      .post(`/api/v1/payroll-cycles/${cycle.id}/archive-and-create-next`)
      .set('x-csrf-token', anonCsrfToken)
      .send({});
    expect(unauth.status).toBe(401);

    const noCsrf = await admin.agent.post(`/api/v1/payroll-cycles/${cycle.id}/archive-and-create-next`).send({});
    expect(noCsrf.status).toBe(403);

    const badCsrf = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/archive-and-create-next`)
      .set('x-csrf-token', 'not-the-real-token')
      .send({});
    expect(badCsrf.status).toBe(403);

    // None of the rejected attempts touched cycle state.
    const stillReleased = await prisma.payrollCycle.findUniqueOrThrow({ where: { id: cycle.id } });
    expect(stillReleased.status).toBe('RELEASED');

    const res = await rollover(admin, cycle.id);
    expect(res.status).toBe(201);
  });

  it('never exposes a raw storage key, filesystem path, or internal temporary identifier — in the rollover response or the rollover-generated package\'s own list/detail serializers', async () => {
    const admin = await masterAdminAgent('rollover-no-leak-admin@test.local');
    const { cycle } = await makeReleasedCycle(admin, 4);

    const res = await rollover(admin, cycle.id);
    expect(res.status).toBe(201);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/storageKey/i);
    expect(serialized).not.toMatch(/\/backups\//);
    expect(serialized).not.toMatch(/GENERATING/); // the rollover-generated package is always READY by response time

    const detail = await admin.agent.get(`/api/v1/backup-packages/${res.body.backupPackageId}`);
    expect(detail.status).toBe(200);
    const detailSerialized = JSON.stringify(detail.body);
    expect(detailSerialized).not.toMatch(/storageKey/i);
    expect(detailSerialized).not.toMatch(/\/backups\//);

    const list = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/backup-packages`);
    expect(list.status).toBe(200);
    const listSerialized = JSON.stringify(list.body);
    expect(listSerialized).not.toMatch(/storageKey/i);
    expect(listSerialized).not.toMatch(/\/backups\//);
  });
});
