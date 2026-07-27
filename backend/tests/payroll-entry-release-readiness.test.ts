import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

/**
 * Pre-release "Needs Attention" visibility (2026-07-27 refinement) — Part D items A/B/F/G.
 * `listPayrollEntries`/`getPayrollEntry` must surface `releaseBlockReasons` for a still-Draft
 * entry the backend already knows can't release, reusing the exact same
 * `evaluatePayrollEntryReleaseReadiness` function `releaseProjectUnit` enforces with.
 */
describe('Payroll Entry — pre-release readiness visibility', () => {
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

  // --- Items A/B: Needs Attention reasons surfaced, without leaking another employee's data ------

  it('surfaces releaseBlockReasons for a duplicate-account entry in the Payroll Entry list, without revealing the other employee\'s identity', async () => {
    const admin = await masterAdminAgent('readiness-list-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Readiness List');
    const bank = await prisma.bank.create({ data: { code: 'TBREADY1', name: 'Test Bank Readiness 1' } });

    // Both employees created (and given an entry via the cycle bootstrap) BEFORE the account
    // number is ever shuffled, so entryA's own frozen snapshot ("copied, not linked") captures
    // "SHARED-ACC" at the moment it's still legitimately A's own value.
    const employeeA = await prisma.employee.create({
      data: {
        name: 'Readiness Employee A',
        designation: 'Guard',
        siteId: site.id,
        unitId: unit.id,
        grossPay: '30000',
        bankId: bank.id,
        accountNumber: 'SHARED-ACC',
        accountNumberCanonical: 'SHAREDACC',
      },
    });
    const employeeC = await prisma.employee.create({
      data: { name: 'Readiness Employee C', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });

    const cycle = await makeDraftCycle(admin, 1);
    const entryA = await prisma.payrollEntry.findFirstOrThrow({ where: { cycleId: cycle.id, employeeId: employeeA.id } });
    const entryC = await prisma.payrollEntry.findFirstOrThrow({ where: { cycleId: cycle.id, employeeId: employeeC.id } });
    expect(entryA.accountNumber).toBe('SHARED-ACC');

    // employeeA legitimately moves to a new account afterward — its own live record no longer
    // conflicts with anyone, but entryA's frozen snapshot is unaffected by that later change.
    await prisma.employee.update({ where: { id: employeeA.id }, data: { accountNumber: 'A-NEW-ACC', accountNumberCanonical: 'ANEWACC' } });
    // employeeB now legitimately takes "SHARED-ACC" — no entry needed for this test, since the
    // duplicate check compares against the *Employee* table directly, not other entries.
    await prisma.employee.create({
      data: {
        name: 'Readiness Employee B',
        designation: 'Guard',
        siteId: site.id,
        unitId: unit.id,
        grossPay: '30000',
        bankId: bank.id,
        accountNumber: 'SHARED-ACC',
        accountNumberCanonical: 'SHAREDACC',
      },
    });

    const listRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries?siteId=${site.id}`);
    expect(listRes.status).toBe(200);
    const listedA = listRes.body.entries.find((e: { id: string }) => e.id === entryA.id);
    expect(listedA.releaseBlockReasons).toEqual(['Duplicate Account Number']);

    // The reason is a generic, field-named string — never the other employee's name, id, or
    // account number itself.
    const serializedReasons = JSON.stringify(listedA.releaseBlockReasons);
    expect(serializedReasons).not.toContain('Readiness Employee B');
    expect(serializedReasons).not.toContain('SHARED-ACC');

    const detailRes = await admin.agent.get(`/api/v1/payroll-entries/${entryA.id}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.entry.releaseBlockReasons).toEqual(['Duplicate Account Number']);

    // The unaffected employee (no duplicate) shows no reasons at all.
    const listedC = listRes.body.entries.find((e: { id: string }) => e.id === entryC.id);
    expect(listedC.releaseBlockReasons).toEqual([]);
  });

  // --- Items F/G: a blocked entry remains unresolved after release, and blocks Finalize ----------

  it('leaves a duplicate-identity-blocked entry unresolved after Unit release, and that entry alone blocks Finalize', async () => {
    const admin = await masterAdminAgent('readiness-finalize-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Readiness Finalize');
    const bank = await prisma.bank.create({ data: { code: 'TBREADY2', name: 'Test Bank Readiness 2' } });

    // Employee Code/CNIC duplicates are already prevented by the database's own partial unique
    // indexes (pre-dating this checkpoint) — there is no way to construct two employees sharing
    // one live, so this test exercises the actual gap this checkpoint closes instead: a duplicate
    // Account Number, via the same "A's own frozen entry snapshot outlives A's own later account
    // change" mechanism proven in `payroll-release-eligibility.test.ts`.
    const employeeA = await prisma.employee.create({
      data: {
        name: 'Finalize Employee A',
        designation: 'Guard',
        siteId: site.id,
        unitId: unit.id,
        grossPay: '30000',
        bankId: bank.id,
        accountNumber: 'FINALIZE-SHARED',
        accountNumberCanonical: 'FINALIZESHARED',
      },
    });
    const cycle = await makeDraftCycle(admin, 2);
    const entryA = await prisma.payrollEntry.findFirstOrThrow({ where: { cycleId: cycle.id, employeeId: employeeA.id } });

    await prisma.employee.update({
      where: { id: employeeA.id },
      data: { accountNumber: 'FINALIZE-A-NEW', accountNumberCanonical: 'FINALIZEANEW' },
    });
    await prisma.employee.create({
      data: {
        name: 'Finalize Employee B',
        designation: 'Guard',
        siteId: site.id,
        unitId: unit.id,
        grossPay: '30000',
        bankId: bank.id,
        accountNumber: 'FINALIZE-SHARED',
        accountNumberCanonical: 'FINALIZESHARED',
      },
    });

    // A positive net salary, so the *only* thing blocking A is the identity duplicate, not
    // net-salary sign.
    await admin.agent
      .patch(`/api/v1/payroll-entries/${entryA.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: entryA.version, eobiApplicable: false, allowance: '5000' });

    const releaseRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${unit.id}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(releaseRes.status).toBe(201);
    expect(releaseRes.body.blockedCount).toBe(1);
    expect(releaseRes.body.blockedEntries).toEqual([
      { id: entryA.id, employeeId: employeeA.id, employeeName: 'Finalize Employee A', blockReasons: ['Duplicate Account Number'] },
    ]);

    const finalA = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entryA.id } });
    expect(finalA.released).toBe(false);
    expect(finalA.hold).toBe(false);
    expect(finalA.payoutOutcome).toBeNull();

    const finalizeRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/finalize`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(finalizeRes.status).toBe(400);
    expect(finalizeRes.body.error.message).toMatch(/neither released nor held/i);
  });
});
