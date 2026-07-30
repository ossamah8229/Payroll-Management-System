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

  it(
    'Master Data Boundary (Phase 7D, 2026-07-30): a stale entry-column snapshot no longer produces a ' +
      'false "Duplicate Account Number" warning in the Payroll Entry list — the check now reads Employee ' +
      "Registry's current, live value",
    async () => {
      const admin = await masterAdminAgent('readiness-list-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site Readiness List');
      const bank = await prisma.bank.create({ data: { code: 'TBREADY1', name: 'Test Bank Readiness 1' } });

      // Both employees created (and given an entry via the cycle bootstrap) BEFORE the account
      // number is ever shuffled, so entryA's own *stored* column captures "SHARED-ACC" at the
      // moment it's still legitimately A's own value.
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

      // employeeA legitimately moves to a new account afterward. Before Phase 7D, entryA's own
      // stored column was unaffected by this (nothing re-synced it until a manual PATCH or the
      // next cycle's bootstrap) — that PATCH path no longer exists, so the stored column is simply
      // never consulted for display/eligibility purposes while the entry is unreleased.
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
      // The list itself already reflects Employee A's live account ("A-NEW-ACC"), which collides
      // with no one — no false-positive duplicate warning, and the entry's own stored column
      // (still "SHARED-ACC" on disk) is provably never what the list actually displayed.
      expect(listedA.accountNumber).toBe('A-NEW-ACC');
      expect(listedA.releaseBlockReasons).toEqual([]);

      const detailRes = await admin.agent.get(`/api/v1/payroll-entries/${entryA.id}`);
      expect(detailRes.status).toBe(200);
      expect(detailRes.body.entry.accountNumber).toBe('A-NEW-ACC');
      expect(detailRes.body.entry.releaseBlockReasons).toEqual([]);

      // The unaffected employee shows no reasons either, as before.
      const listedC = listRes.body.entries.find((e: { id: string }) => e.id === entryC.id);
      expect(listedC.releaseBlockReasons).toEqual([]);
    },
  );

  // --- Items F/G: a blocked entry remains unresolved after release, and blocks Finalize ----------

  it('leaves a duplicate-identity-blocked entry unresolved after Unit release, and that entry alone blocks Finalize', async () => {
    const admin = await masterAdminAgent('readiness-finalize-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Readiness Finalize');
    const bank = await prisma.bank.create({ data: { code: 'TBREADY2', name: 'Test Bank Readiness 2' } });

    // Employee Code/CNIC duplicates are already prevented by the database's own partial unique
    // indexes (pre-dating this checkpoint) — there is no way to construct two employees sharing
    // one live. A duplicate Account Number is *also* no longer constructible this way as of Phase
    // 7D (2026-07-30, `payroll-release-eligibility.test.ts`'s own rewritten coverage): the release
    // gate now evaluates Employee Registry's live value, never an entry's own possibly-stale
    // column, so "A's frozen snapshot outlives A's own later account change" can no longer produce
    // a false collision. This test instead exercises the release gate's other still-fully-live
    // rule — a bank-paid employee with no Account Number on file (simulated via a direct Prisma
    // write to Employee, bypassing `employees.service.ts`'s own `applyBankingInvariant`, which
    // would otherwise reject this state at the ordinary API boundary) — to prove a genuinely
    // blocked entry still blocks Finalize exactly as before.
    const employeeA = await prisma.employee.create({
      data: {
        name: 'Finalize Employee A',
        designation: 'Guard',
        siteId: site.id,
        unitId: unit.id,
        grossPay: '30000',
        bankId: bank.id,
        accountNumber: 'FINALIZE-ACC',
        accountNumberCanonical: 'FINALIZEACC',
      },
    });
    const cycle = await makeDraftCycle(admin, 2);
    const entryA = await prisma.payrollEntry.findFirstOrThrow({ where: { cycleId: cycle.id, employeeId: employeeA.id } });

    await prisma.employee.update({
      where: { id: employeeA.id },
      data: { accountNumber: null, accountNumberCanonical: null },
    });

    // A positive net salary, so the *only* thing blocking A is the missing Account Number, not
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
      { id: entryA.id, employeeId: employeeA.id, employeeName: 'Finalize Employee A', blockReasons: ['Missing Account Number'] },
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
