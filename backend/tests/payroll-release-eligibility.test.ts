import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

/**
 * Negative Payroll Recovery & Employee Identity/Banking Uniqueness checkpoint (2026-07-26) —
 * Part D items 30-33: `payroll-release-eligibility.ts`'s defensive release gate. A blocked entry
 * is excluded from the release sweep entirely (same tier as `hold`) — it stays
 * `released: false, hold: false, payoutOutcome: null`.
 *
 * Every test creates its Draft cycle BEFORE its employee(s) — a Draft cycle's own creation
 * bootstraps entries for every already-existing active employee at its sites, so an employee
 * created first would already have an auto-created entry by the time this file's explicit
 * `createEntry()` call runs, and that second call would 409 (`payroll-release.test.ts`/
 * `bank-sheets.test.ts` follow the same ordering for the same reason).
 */
describe('Payroll Release — identity/payment-destination eligibility gate', () => {
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
      permissionKeys: [PERMISSIONS.PAYROLL_CYCLE_MANAGE, PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.PAYROLL_RELEASE],
    });
  }

  async function makeSiteWithUnit(name: string) {
    const site = await prisma.projectSite.create({ data: { name } });
    const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} Unit` } });
    return { site, unit };
  }

  async function makeDraftCycle(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, month: number) {
    const res = await admin.agent
      .post('/api/v1/payroll-cycles')
      .set('x-csrf-token', admin.csrfToken)
      .send({ year: 2900, month });
    return res.body.cycle as { id: string };
  }

  async function createEntry(
    admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>,
    cycleId: string,
    employeeId: string,
  ) {
    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycleId}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId });
    if (res.status !== 201) throw new Error(`createEntry failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.entry as { id: string; version: number };
  }

  /** A freshly created entry defaults to `netSalary = -400` (0 work days, the default 400 EOBI
   * deduction) — a real, deliberate reminder of the exact production bug this checkpoint fixes,
   * but not what these eligibility-gate tests are about. Forces a positive net salary so
   * `releasedEntryCount`/`blockedCount` isolate the eligibility gate's own behavior. */
  async function makePositive(
    admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>,
    entryId: string,
    version: number,
  ) {
    const res = await admin.agent
      .patch(`/api/v1/payroll-entries/${entryId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version, eobiApplicable: false, allowance: '5000' });
    if (res.status !== 200) throw new Error(`makePositive failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  async function releaseUnit(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, cycleId: string, unitId: string) {
    return admin.agent
      .post(`/api/v1/payroll-cycles/${cycleId}/units/${unitId}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
  }

  // --- Item 31: an ordinary valid employee remains releasable -------------------------------------

  it('releases a valid bank-paid employee normally', async () => {
    const admin = await masterAdminAgent('elig-valid-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Elig Valid');
    const bank = await prisma.bank.create({ data: { code: 'TBELIG1', name: 'Test Bank Elig 1' } });
    const cycle = await makeDraftCycle(admin, 1);
    const employee = await prisma.employee.create({
      data: { name: 'Valid Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000', bankId: bank.id, accountNumber: '123456' },
    });
    const entry = await createEntry(admin, cycle.id, employee.id);
    await makePositive(admin, entry.id, entry.version);

    const res = await releaseUnit(admin, cycle.id, unit.id);
    expect(res.status).toBe(201);
    expect(res.body.blockedCount).toBe(0);
    expect(res.body.releasedEntryCount).toBe(1);
  });

  // --- Item 32: a Cash employee with no bank account remains valid --------------------------------

  it('releases a Cash employee (no bank account) normally — never blocked for missing banking details', async () => {
    const admin = await masterAdminAgent('elig-cash-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Elig Cash');
    const cycle = await makeDraftCycle(admin, 2);
    const employee = await prisma.employee.create({
      data: { name: 'Cash Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });
    const entry = await createEntry(admin, cycle.id, employee.id);
    await makePositive(admin, entry.id, entry.version);

    const res = await releaseUnit(admin, cycle.id, unit.id);
    expect(res.status).toBe(201);
    expect(res.body.blockedCount).toBe(0);
    expect(res.body.releasedEntryCount).toBe(1);
  });

  // --- Item 33: a bank-paid employee with a missing Account Number is blocked ---------------------

  it('blocks a bank-paid entry whose own Account Number is missing, leaving it unresolved for the operator to fix', async () => {
    const admin = await masterAdminAgent('elig-missing-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Elig Missing');
    const bank = await prisma.bank.create({ data: { code: 'TBELIG2', name: 'Test Bank Elig 2' } });
    const cycle = await makeDraftCycle(admin, 3);
    const employee = await prisma.employee.create({
      data: { name: 'Missing Account Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000', bankId: bank.id, accountNumber: '999' },
    });
    const entry = await createEntry(admin, cycle.id, employee.id);

    // Simulate a bank-paid entry whose own frozen Account Number was cleared (e.g. a Draft edit
    // left it blank) while its bankId is still set — the exact "required bank data missing" case
    // the release gate must catch, independent of the Employee record's own (valid) data.
    await prisma.payrollEntry.update({ where: { id: entry.id }, data: { accountNumber: null } });

    const res = await releaseUnit(admin, cycle.id, unit.id);
    expect(res.status).toBe(201);
    expect(res.body.blockedCount).toBe(1);
    expect(res.body.releasedEntryCount).toBe(0);

    const final = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(final.released).toBe(false);
    expect(final.hold).toBe(false);
    expect(final.payoutOutcome).toBeNull();

    const auditEntry = await prisma.auditLog.findFirst({
      where: { action: 'payroll_entry.release_blocked', entityId: entry.id },
    });
    expect(auditEntry).not.toBeNull();
    expect((auditEntry!.metadata as { blockReasons: string[] }).blockReasons).toContain('Missing Account Number');
  });

  // --- Item 30: duplicate payment identity cannot be released -------------------------------------

  it('blocks an entry whose own frozen Account Number now collides with a different, currently-valid employee', async () => {
    const admin = await masterAdminAgent('elig-dup-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Elig Dup');
    const bank = await prisma.bank.create({ data: { code: 'TBELIG3', name: 'Test Bank Elig 3' } });
    const cycle = await makeDraftCycle(admin, 4);

    // Employee A is created with account "SHARED-ACC", gets an entry (freezing that snapshot),
    // then legitimately changes to a new account — the DB's own uniqueness constraint never
    // objects to any of this, since at every step only one Employee row ever holds "SHARED-ACC".
    // `accountNumberCanonical` is app-maintained, not DB-generated (docs/architecture/database/
    // employee.md §9) — a raw `prisma.employee.create` bypassing `employees.service.ts` must set
    // it explicitly itself, exactly as `createEmployee` would.
    const employeeA = await prisma.employee.create({
      data: {
        name: 'Elig Dup A',
        designation: 'Guard',
        siteId: site.id,
        unitId: unit.id,
        grossPay: '30000',
        bankId: bank.id,
        accountNumber: 'SHARED-ACC',
        accountNumberCanonical: 'SHAREDACC',
      },
    });
    const entryA = await createEntry(admin, cycle.id, employeeA.id);
    await makePositive(admin, entryA.id, entryA.version);

    await admin.agent
      .patch(`/api/v1/employees/${employeeA.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ accountNumber: 'A-NEW-ACC' });

    // Employee B now legitimately takes "SHARED-ACC" — allowed, since A no longer holds it.
    const employeeB = await prisma.employee.create({
      data: {
        name: 'Elig Dup B',
        designation: 'Guard',
        siteId: site.id,
        unitId: unit.id,
        grossPay: '30000',
        bankId: bank.id,
        accountNumber: 'SHARED-ACC',
        accountNumberCanonical: 'SHAREDACC',
      },
    });
    const entryB = await createEntry(admin, cycle.id, employeeB.id);
    await makePositive(admin, entryB.id, entryB.version);

    // Entry A's own frozen snapshot ("copied, not linked") still reads "SHARED-ACC" — unaffected by
    // A's own later Employee-record change — and now collides with B's current, valid record. The
    // release gate must catch this even though the Employee table itself has no live duplicate.
    const freshEntryA = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entryA.id } });
    expect(freshEntryA.accountNumber).toBe('SHARED-ACC');

    const res = await releaseUnit(admin, cycle.id, unit.id);
    expect(res.status).toBe(201);
    expect(res.body.blockedCount).toBe(1);
    expect(res.body.releasedEntryCount).toBe(1); // Employee B's entry releases fine

    const finalA = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entryA.id } });
    expect(finalA.released).toBe(false);
    expect(finalA.payoutOutcome).toBeNull();

    const auditEntry = await prisma.auditLog.findFirst({
      where: { action: 'payroll_entry.release_blocked', entityId: entryA.id },
    });
    expect((auditEntry!.metadata as { blockReasons: string[] }).blockReasons).toContain('Duplicate Account Number');
  });
});
