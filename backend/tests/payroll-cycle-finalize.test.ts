import request from 'supertest';
import { stringify as stringifyCsvSync } from 'csv-stringify/sync';
import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { PAYROLL_ENTRY_TEMPLATE_HEADERS } from '../src/modules/payroll-entry/payroll-entry-import-export.service';
import { cleanTestData, createAuthenticatedAgent, extractCookie } from './helpers';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

describe('Phase 5 Checkpoint 1 — Finalize Payroll Cycle', () => {
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
      permissionKeys: [PERMISSIONS.PAYROLL_VIEW, PERMISSIONS.PAYROLL_RELEASE],
      siteIds,
    });
  }

  async function makeSiteWithUnits(name: string, unitNames: string[]) {
    const site = await prisma.projectSite.create({ data: { name } });
    const units = [];
    for (const unitName of unitNames) {
      units.push(
        await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} ${unitName}` } }),
      );
    }
    return { site, units };
  }

  async function makeEmployee(siteId: string, unitId: string, name: string, grossPay = '30000') {
    return prisma.employee.create({ data: { name, designation: 'Guard', siteId, unitId, grossPay } });
  }

  async function makeEmployeeWithCnic(siteId: string, unitId: string, name: string, cnic: string, grossPay = '30000') {
    return prisma.employee.create({ data: { name, designation: 'Guard', siteId, unitId, grossPay, cnic } });
  }

  function templateRow(overrides: Partial<Record<(typeof PAYROLL_ENTRY_TEMPLATE_HEADERS)[number], string>>) {
    const base: Record<(typeof PAYROLL_ENTRY_TEMPLATE_HEADERS)[number], string> = {
      CNIC: '',
      'Employee Code': '',
      Name: '',
      Site: '',
      Designation: '',
      'Gross Pay': '',
      Days: '',
      'OT Hrs': '',
      'OT Rate': '',
      Allowance: '',
      Leave: '',
      'Leave Rate': '',
      'Cycle Days': '',
      'EOBI Amount': '',
      'EOBI On': '',
      Advance: '',
      'Eid Advance': '',
      Fine: '',
      Hold: '',
      Released: '',
    };
    return { ...base, ...overrides };
  }

  function toCsv(rows: Record<string, string>[]): Buffer {
    const csv = stringifyCsvSync([
      PAYROLL_ENTRY_TEMPLATE_HEADERS as unknown as string[],
      ...rows.map((row) => PAYROLL_ENTRY_TEMPLATE_HEADERS.map((header) => row[header] ?? '')),
    ]);
    return Buffer.from(csv, 'utf-8');
  }

  async function makeDraftCycle(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, month: number) {
    const res = await admin.agent
      .post('/api/v1/payroll-cycles')
      .set('x-csrf-token', admin.csrfToken)
      .send({ year: 2900, month });
    if (res.status !== 201) throw new Error(`cycle create failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.cycle as { id: string; year: number; month: number; status: string };
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
    if (res.status !== 201) throw new Error(`entry create failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.entry as { id: string; version: number };
  }

  async function releaseUnit(
    admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>,
    cycleId: string,
    unitId: string,
  ) {
    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycleId}/units/${unitId}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    if (res.status !== 201) throw new Error(`release failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  async function holdEntry(
    admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>,
    entryId: string,
    version: number,
  ) {
    const res = await admin.agent
      .patch(`/api/v1/payroll-entries/${entryId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version, hold: true });
    if (res.status !== 200) throw new Error(`hold failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.entry as { id: string; version: number; hold: boolean };
  }

  async function finalize(
    agent: { agent: ReturnType<typeof request.agent>; csrfToken: string },
    cycleId: string,
    body: Record<string, unknown> = {},
  ) {
    return agent.agent
      .post(`/api/v1/payroll-cycles/${cycleId}/finalize`)
      .set('x-csrf-token', agent.csrfToken)
      .send(body);
  }

  // --- Finalization precondition -----------------------------------------------------------------

  it('rejects finalizing while one entry is neither released nor held', async () => {
    const admin = await masterAdminAgent('finalize-precond-block-admin@test.local');
    const { site, units } = await makeSiteWithUnits('Test Site Finalize Precond Block', ['Alpha']);
    const cycle = await makeDraftCycle(admin, 1);
    const employee = await makeEmployee(site.id, units[0]!.id, 'Straggler Employee');
    await createEntry(admin, cycle.id, employee.id);

    const res = await finalize(admin, cycle.id);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/neither released nor held/i);

    const stillDraft = await prisma.payrollCycle.findUniqueOrThrow({ where: { id: cycle.id } });
    expect(stillDraft.status).toBe('DRAFT');
    expect(stillDraft.releasedAt).toBeNull();
    expect(stillDraft.releasedBy).toBeNull();
  });

  it('succeeds finalizing when every entry is released', async () => {
    const admin = await masterAdminAgent('finalize-precond-released-admin@test.local');
    const { site, units } = await makeSiteWithUnits('Test Site Finalize Precond Released', ['Alpha']);
    const cycle = await makeDraftCycle(admin, 2);
    const employee = await makeEmployee(site.id, units[0]!.id, 'Released Employee');
    await createEntry(admin, cycle.id, employee.id);
    await releaseUnit(admin, cycle.id, units[0]!.id);

    const res = await finalize(admin, cycle.id);
    expect(res.status).toBe(200);
    expect(res.body.cycle.status).toBe('RELEASED');
  });

  it('succeeds finalizing when every remaining unreleased entry is held', async () => {
    const admin = await masterAdminAgent('finalize-precond-held-admin@test.local');
    const { site, units } = await makeSiteWithUnits('Test Site Finalize Precond Held', ['Alpha']);
    const cycle = await makeDraftCycle(admin, 3);
    const employee = await makeEmployee(site.id, units[0]!.id, 'Held Employee');
    const entry = await createEntry(admin, cycle.id, employee.id);
    await holdEntry(admin, entry.id, entry.version);

    const res = await finalize(admin, cycle.id);
    expect(res.status).toBe(200);
    expect(res.body.cycle.status).toBe('RELEASED');
  });

  it('succeeds finalizing a mix of released and held entries, blocked correctly by a lone straggler', async () => {
    const admin = await masterAdminAgent('finalize-precond-mixed-admin@test.local');
    const { site, units } = await makeSiteWithUnits('Test Site Finalize Precond Mixed', ['Alpha', 'Beta']);
    const cycle = await makeDraftCycle(admin, 4);
    const releasedEmployee = await makeEmployee(site.id, units[0]!.id, 'Mixed Released');
    const heldEmployee = await makeEmployee(site.id, units[0]!.id, 'Mixed Held');
    const stragglerEmployee = await makeEmployee(site.id, units[1]!.id, 'Mixed Straggler');
    await createEntry(admin, cycle.id, releasedEmployee.id);
    const heldEntry = await createEntry(admin, cycle.id, heldEmployee.id);
    await createEntry(admin, cycle.id, stragglerEmployee.id);
    await holdEntry(admin, heldEntry.id, heldEntry.version);
    await releaseUnit(admin, cycle.id, units[0]!.id);

    // Beta (the straggler's own Unit) never released — must still block.
    const blocked = await finalize(admin, cycle.id);
    expect(blocked.status).toBe(400);

    await releaseUnit(admin, cycle.id, units[1]!.id);

    const res = await finalize(admin, cycle.id);
    expect(res.status).toBe(200);
    expect(res.body.cycle.status).toBe('RELEASED');
  });

  it('succeeds finalizing an empty cycle', async () => {
    const admin = await masterAdminAgent('finalize-precond-empty-admin@test.local');
    // Deliberately no site/unit/employee created before this cycle — createPayrollCycle seeds an
    // entry per currently-active employee, so a cycle created with none yet in existence is
    // genuinely empty (approved business decision: "Empty cycles may be finalized").
    const cycle = await makeDraftCycle(admin, 5);

    const res = await finalize(admin, cycle.id);
    expect(res.status).toBe(200);
    expect(res.body.cycle.status).toBe('RELEASED');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'payroll_cycle.released', entityId: cycle.id },
    });
    expect((audit?.metadata as { entryCount?: number })?.entryCount).toBe(0);
  });

  it('no override field, hidden bypass, or alternate mechanism can skip the precondition', async () => {
    const admin = await masterAdminAgent('finalize-precond-nooverride-admin@test.local');
    const { site, units } = await makeSiteWithUnits('Test Site Finalize No Override', ['Alpha']);
    const cycle = await makeDraftCycle(admin, 6);
    const employee = await makeEmployee(site.id, units[0]!.id, 'No Override Employee');
    await createEntry(admin, cycle.id, employee.id);

    // Every plausible bypass shape a caller might try — all must be ignored, not honored.
    const res = await finalize(admin, cycle.id, {
      override: true,
      force: true,
      skipPrecondition: true,
      cycleId: cycle.id,
    });
    expect(res.status).toBe(400);

    const stillDraft = await prisma.payrollCycle.findUniqueOrThrow({ where: { id: cycle.id } });
    expect(stillDraft.status).toBe('DRAFT');
  });

  // --- Lifecycle state -----------------------------------------------------------------------------

  it('sets releasedAt/releasedBy on the DRAFT -> RELEASED transition and leaves individual entry release flags untouched', async () => {
    const admin = await masterAdminAgent('finalize-lifecycle-admin@test.local');
    const { site, units } = await makeSiteWithUnits('Test Site Finalize Lifecycle', ['Alpha']);
    const cycle = await makeDraftCycle(admin, 7);
    const employee = await makeEmployee(site.id, units[0]!.id, 'Lifecycle Employee');
    const entry = await createEntry(admin, cycle.id, employee.id);
    const held = await holdEntry(admin, entry.id, entry.version);

    const before = new Date();
    const res = await finalize(admin, cycle.id);
    expect(res.status).toBe(200);
    expect(res.body.cycle.status).toBe('RELEASED');

    const updatedCycle = await prisma.payrollCycle.findUniqueOrThrow({ where: { id: cycle.id } });
    expect(updatedCycle.status).toBe('RELEASED');
    expect(updatedCycle.releasedAt).not.toBeNull();
    expect(updatedCycle.releasedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(updatedCycle.releasedBy).toBe(admin.userId);

    // Finalize never touches PayrollEntry.released/hold directly — the held entry stays exactly
    // as it was (approved decision: "Finalization does not... release held entries").
    const entryAfter = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(entryAfter.released).toBe(false);
    expect(entryAfter.hold).toBe(true);
    expect(entryAfter.version).toBe(held.version);
  });

  it('rejects a second finalization cleanly', async () => {
    const admin = await masterAdminAgent('finalize-double-admin@test.local');
    const cycle = await makeDraftCycle(admin, 8);

    const first = await finalize(admin, cycle.id);
    expect(first.status).toBe(200);

    const second = await finalize(admin, cycle.id);
    expect(second.status).toBe(400);
    expect(second.body.error.message).toMatch(/draft/i);

    const auditCount = await prisma.auditLog.count({
      where: { action: 'payroll_cycle.released', entityId: cycle.id },
    });
    expect(auditCount).toBe(1);
  });

  it('rejects a concurrent double-finalize race cleanly — exactly one successful transition, one audit row', async () => {
    const admin = await masterAdminAgent('finalize-race-admin@test.local');
    const cycle = await makeDraftCycle(admin, 9);
    // Two independent sessions (two separate logins, two separate connections) racing the same
    // cycle — deliberately not the same agent instance, so the two requests aren't serialized over
    // one connection and can genuinely interleave at the database level.
    const rival = await masterAdminAgent('finalize-race-rival@test.local');

    const [first, second] = await Promise.all([finalize(admin, cycle.id), finalize(rival, cycle.id)]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    // Whichever request's own precondition check loses the race is rejected cleanly either way —
    // via the atomic conditional update's own conflict (409, a genuine DB-level interleave) if both
    // requests passed the initial `status === 'DRAFT'` check before either committed, or via the
    // ordinary upfront precondition check (400) if one fully committed before the other's initial
    // check ran. Both are typed, clean rejections; what must never happen is two 200s or two audit
    // rows — the properties this test actually verifies below.
    expect(statuses[0]).toBe(200);
    expect([400, 409]).toContain(statuses[1]);
    const loser = first.status === 200 ? second : first;
    expect(['BAD_REQUEST', 'CONFLICT']).toContain(loser.body.error.code);

    const updatedCycle = await prisma.payrollCycle.findUniqueOrThrow({ where: { id: cycle.id } });
    expect(updatedCycle.status).toBe('RELEASED');

    const auditCount = await prisma.auditLog.count({
      where: { action: 'payroll_cycle.released', entityId: cycle.id },
    });
    expect(auditCount).toBe(1);
  });

  it('atomic conditional update rejects a true database-level race (both requests pass the initial precondition check)', async () => {
    // Exercises the atomic-`updateMany`-scoped-to-`status:'DRAFT'` backstop specifically, by
    // racing the service function directly rather than over HTTP — two concurrent calls that both
    // start executing in the same tick, guaranteeing genuine interleaving at the transaction level
    // (an HTTP-level race can sometimes have one request's transaction fully commit before the
    // other's own initial precondition check even runs, which the test above already covers).
    const admin = await masterAdminAgent('finalize-race-direct-admin@test.local');
    const cycle = await makeDraftCycle(admin, 10);

    const { finalizePayrollCycle } = await import('../src/modules/payroll-processing/payroll-processing.service');
    const sessionUser = { id: admin.userId } as Parameters<typeof finalizePayrollCycle>[0];
    const requestMeta = { ipAddress: null, userAgent: null };

    const results = await Promise.allSettled([
      finalizePayrollCycle(sessionUser, cycle.id, requestMeta),
      finalizePayrollCycle(sessionUser, cycle.id, requestMeta),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.statusCode).toBe(409);

    const auditCount = await prisma.auditLog.count({
      where: { action: 'payroll_cycle.released', entityId: cycle.id },
    });
    expect(auditCount).toBe(1);
  });

  // --- RBAC and security ---------------------------------------------------------------------------

  it('allows Master Admin to finalize', async () => {
    const admin = await masterAdminAgent('finalize-rbac-admin@test.local');
    const cycle = await makeDraftCycle(admin, 10);

    const res = await finalize(admin, cycle.id);
    expect(res.status).toBe(200);
  });

  it('rejects Payroll Staff with 403 — Payroll Staff never holds payroll-cycle:manage', async () => {
    const admin = await masterAdminAgent('finalize-rbac-staff-admin@test.local');
    const { site } = await makeSiteWithUnits('Test Site Finalize RBAC Staff', ['Alpha']);
    const cycle = await makeDraftCycle(admin, 11);
    const staff = await payrollStaffAgent('finalize-rbac-staff@test.local', [site.id]);

    const res = await finalize(staff, cycle.id);
    expect(res.status).toBe(403);

    const stillDraft = await prisma.payrollCycle.findUniqueOrThrow({ where: { id: cycle.id } });
    expect(stillDraft.status).toBe('DRAFT');
  });

  it('rejects Finance with 403 — Finance never holds payroll-cycle:manage', async () => {
    const admin = await masterAdminAgent('finalize-rbac-finance-admin@test.local');
    const { site } = await makeSiteWithUnits('Test Site Finalize RBAC Finance', ['Alpha']);
    const cycle = await makeDraftCycle(admin, 12);
    const finance = await financeAgent('finalize-rbac-finance@test.local', [site.id]);

    const res = await finalize(finance, cycle.id);
    expect(res.status).toBe(403);
  });

  it('rejects an unauthenticated request with 401', async () => {
    const admin = await masterAdminAgent('finalize-rbac-unauth-admin@test.local');
    const cycle = await makeDraftCycle(admin, 1);

    const anon = request.agent(app);
    const primeRes = await anon.get('/health');
    const csrfToken = extractCookie(primeRes, 'csrf_token');
    if (!csrfToken) throw new Error('Expected /health to issue a csrf_token cookie');

    const res = await anon.post(`/api/v1/payroll-cycles/${cycle.id}/finalize`).set('x-csrf-token', csrfToken).send({});
    expect(res.status).toBe(401);
  });

  it('rejects a request with a missing CSRF header', async () => {
    const admin = await masterAdminAgent('finalize-rbac-csrf-admin@test.local');
    const cycle = await makeDraftCycle(admin, 2);

    const res = await admin.agent.post(`/api/v1/payroll-cycles/${cycle.id}/finalize`).send({});
    expect(res.status).toBe(403);

    const stillDraft = await prisma.payrollCycle.findUniqueOrThrow({ where: { id: cycle.id } });
    expect(stillDraft.status).toBe('DRAFT');
  });

  it('rejects a request with an invalid CSRF token', async () => {
    const admin = await masterAdminAgent('finalize-rbac-badcsrf-admin@test.local');
    const cycle = await makeDraftCycle(admin, 3);

    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/finalize`)
      .set('x-csrf-token', 'not-the-real-token')
      .send({});
    expect(res.status).toBe(403);
  });

  it('returns a generic not-found response for a nonexistent or inaccessible cycle', async () => {
    const admin = await masterAdminAgent('finalize-notfound-admin@test.local');
    const res = await finalize(admin, '00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });

  // --- Audit ----------------------------------------------------------------------------------------

  it('writes exactly one payroll_cycle.released audit entry with correct metadata, atomically with the status update', async () => {
    const admin = await masterAdminAgent('finalize-audit-admin@test.local');
    const { site, units } = await makeSiteWithUnits('Test Site Finalize Audit', ['Alpha']);
    const cycle = await makeDraftCycle(admin, 4);
    const releasedEmployee = await makeEmployee(site.id, units[0]!.id, 'Audit Released');
    const heldEmployee = await makeEmployee(site.id, units[0]!.id, 'Audit Held');
    await createEntry(admin, cycle.id, releasedEmployee.id);
    const heldEntry = await createEntry(admin, cycle.id, heldEmployee.id);
    await holdEntry(admin, heldEntry.id, heldEntry.version);
    await releaseUnit(admin, cycle.id, units[0]!.id);

    const res = await finalize(admin, cycle.id);
    expect(res.status).toBe(200);

    const auditRows = await prisma.auditLog.findMany({
      where: { action: 'payroll_cycle.released', entityId: cycle.id },
    });
    expect(auditRows).toHaveLength(1);

    const metadata = auditRows[0]!.metadata as {
      cycleId: string;
      year: number;
      month: number;
      entryCount: number;
      releasedCount: number;
      heldCount: number;
    };
    expect(metadata.cycleId).toBe(cycle.id);
    expect(metadata.year).toBe(cycle.year);
    expect(metadata.month).toBe(cycle.month);
    expect(metadata.entryCount).toBe(2);
    expect(metadata.releasedCount).toBe(1);
    expect(metadata.heldCount).toBe(1);
    expect(auditRows[0]!.actorUserId).toBe(admin.userId);
  });

  it('writes no audit row and leaves the cycle Draft when the precondition blocks finalization', async () => {
    const admin = await masterAdminAgent('finalize-audit-blocked-admin@test.local');
    const { site, units } = await makeSiteWithUnits('Test Site Finalize Audit Blocked', ['Alpha']);
    const cycle = await makeDraftCycle(admin, 5);
    const employee = await makeEmployee(site.id, units[0]!.id, 'Audit Blocked Employee');
    await createEntry(admin, cycle.id, employee.id);

    const res = await finalize(admin, cycle.id);
    expect(res.status).toBe(400);

    const auditRows = await prisma.auditLog.findMany({
      where: { action: 'payroll_cycle.released', entityId: cycle.id },
    });
    expect(auditRows).toHaveLength(0);

    const stillDraft = await prisma.payrollCycle.findUniqueOrThrow({ where: { id: cycle.id } });
    expect(stillDraft.status).toBe('DRAFT');
  });

  // --- Regression: held-entry editability correction -------------------------------------------------

  it('regression: a held, unreleased entry remains editable after cycle finalization', async () => {
    const admin = await masterAdminAgent('finalize-regress-editable-admin@test.local');
    const { site, units } = await makeSiteWithUnits('Test Site Finalize Regress Editable', ['Alpha']);
    const cycle = await makeDraftCycle(admin, 6);
    const employee = await makeEmployee(site.id, units[0]!.id, 'Regress Editable Employee');
    const entry = await createEntry(admin, cycle.id, employee.id);
    const held = await holdEntry(admin, entry.id, entry.version);

    const finalizeRes = await finalize(admin, cycle.id);
    expect(finalizeRes.status).toBe(200);

    // The dormant conflict this checkpoint fixes: a held, unreleased entry must stay ordinarily
    // editable once its parent cycle finalizes — immutability is driven by
    // PayrollEntry.released alone, never PayrollCycle.status.
    const editRes = await admin.agent
      .patch(`/api/v1/payroll-entries/${entry.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: held.version, fine: '250' });
    expect(editRes.status).toBe(200);
    expect(editRes.body.entry.fine).toBe('250');

    const entryAfter = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(entryAfter.released).toBe(false);
    expect(entryAfter.hold).toBe(true);
  });

  it('regression: a released entry remains locked after cycle finalization', async () => {
    const admin = await masterAdminAgent('finalize-regress-locked-admin@test.local');
    const { site, units } = await makeSiteWithUnits('Test Site Finalize Regress Locked', ['Alpha', 'Beta']);
    const cycle = await makeDraftCycle(admin, 7);
    const releasedEmployee = await makeEmployee(site.id, units[0]!.id, 'Regress Locked Released');
    const heldEmployee = await makeEmployee(site.id, units[1]!.id, 'Regress Locked Held');
    const releasedEntry = await createEntry(admin, cycle.id, releasedEmployee.id);
    const heldEntry = await createEntry(admin, cycle.id, heldEmployee.id);
    await holdEntry(admin, heldEntry.id, heldEntry.version);
    await releaseUnit(admin, cycle.id, units[0]!.id);
    await releaseUnit(admin, cycle.id, units[1]!.id); // Beta has only the held entry — releases zero.

    const finalizeRes = await finalize(admin, cycle.id);
    expect(finalizeRes.status).toBe(200);

    const releasedAfter = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: releasedEntry.id } });
    expect(releasedAfter.released).toBe(true);

    const editRes = await admin.agent
      .patch(`/api/v1/payroll-entries/${releasedEntry.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: releasedAfter.version, fine: '999' });
    expect(editRes.status).toBe(400);

    const delRes = await admin.agent
      .delete(`/api/v1/payroll-entries/${releasedEntry.id}?version=${releasedAfter.version}`)
      .set('x-csrf-token', admin.csrfToken);
    expect(delRes.status).toBe(400);
  });

  it('regression: per-Unit release rejects a finalized cycle', async () => {
    const admin = await masterAdminAgent('finalize-regress-release-admin@test.local');
    const { site, units } = await makeSiteWithUnits('Test Site Finalize Regress Release', ['Alpha', 'Beta']);
    const cycle = await makeDraftCycle(admin, 8);
    const releasedEmployee = await makeEmployee(site.id, units[0]!.id, 'Regress Release Released');
    const heldEmployee = await makeEmployee(site.id, units[1]!.id, 'Regress Release Held');
    await createEntry(admin, cycle.id, releasedEmployee.id);
    const heldEntry = await createEntry(admin, cycle.id, heldEmployee.id);
    await holdEntry(admin, heldEntry.id, heldEntry.version);
    await releaseUnit(admin, cycle.id, units[0]!.id);

    const finalizeRes = await finalize(admin, cycle.id);
    expect(finalizeRes.status).toBe(200);

    // Beta never released before finalization (its only entry was held) — attempting to release
    // it now must be rejected because the cycle itself is no longer Draft, not silently allowed.
    const releaseAfter = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/units/${units[1]!.id}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(releaseAfter.status).toBe(400);
  });

  it('regression: Advance deferral still rejects a target period whose cycle already exists and is not Draft', async () => {
    const admin = await masterAdminAgent('finalize-regress-advance-admin@test.local');
    const { site, units } = await makeSiteWithUnits('Test Site Finalize Regress Advance', ['Alpha']);
    const employee = await makeEmployee(site.id, units[0]!.id, 'Regress Advance Employee', '40000');

    const createdAdvance = await admin.agent
      .post('/api/v1/advances')
      .set('x-csrf-token', admin.csrfToken)
      .send({
        employeeId: employee.id,
        type: 'LOAN',
        totalAmount: '9000',
        dateGiven: '2026-01-01',
        repaymentType: 'FULL_DEDUCTION',
        originalPeriod: { year: 2900, month: 9 },
      });
    expect(createdAdvance.status).toBe(201);
    const advanceId = createdAdvance.body.advance.id as string;

    const cycle = await makeDraftCycle(admin, 9);
    const entryRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries?employeeId=${employee.id}`);
    const entry = entryRes.body.entries[0];

    // Seed a target-period PayrollCycle that has already been finalized — deferAdvanceSchedule's
    // own conflictingCycle guard (unrelated to this checkpoint's own changes) must still reject
    // deferring into it after Checkpoint 1 ships.
    await prisma.payrollCycle.create({
      data: {
        year: 2900,
        month: 10,
        status: 'RELEASED',
        createdBy: admin.userId,
        releasedAt: new Date(),
        releasedBy: admin.userId,
      },
    });

    const deferRes = await admin.agent
      .post(`/api/v1/advances/${advanceId}/defer`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ payrollEntryId: entry.id, toPeriod: { year: 2900, month: 10 }, reason: 'Target already finalized' });

    expect(deferRes.status).toBe(400);
    expect(deferRes.body.error.message).toMatch(/already been released or archived/i);
  });

  it('regression: Bank Sheets and Cash Receiving Sheets remain entry-release-driven after finalization — a held entry never appears', async () => {
    const admin = await masterAdminAgent('finalize-regress-sheets-admin@test.local');
    const { site, units } = await makeSiteWithUnits('Test Site Finalize Regress Sheets', ['Alpha']);
    const cycle = await makeDraftCycle(admin, 10);
    const releasedEmployee = await makeEmployee(site.id, units[0]!.id, 'Sheets Released');
    const heldEmployee = await makeEmployee(site.id, units[0]!.id, 'Sheets Held');
    await createEntry(admin, cycle.id, releasedEmployee.id);
    const heldEntry = await createEntry(admin, cycle.id, heldEmployee.id);
    await holdEntry(admin, heldEntry.id, heldEntry.version);
    await releaseUnit(admin, cycle.id, units[0]!.id);

    const finalizeRes = await finalize(admin, cycle.id);
    expect(finalizeRes.status).toBe(200);

    const bankSheet = await admin.agent.get(
      `/api/v1/payroll-cycles/${cycle.id}/bank-sheet?bankId=cash&siteIds=${site.id}`,
    );
    expect(bankSheet.status).toBe(200);
    expect(bankSheet.body.rows).toHaveLength(1);
    expect(bankSheet.body.rows[0].employeeName).toBe('Sheets Released');

    const cashSheet = await admin.agent.get(
      `/api/v1/payroll-cycles/${cycle.id}/cash-receiving?siteIds=${site.id}`,
    );
    expect(cashSheet.status).toBe(200);
    expect(cashSheet.body.rows).toHaveLength(1);
    expect(cashSheet.body.rows[0].employeeName).toBe('Sheets Released');
  });

  it('regression: cycle finalization does not silently set released = true on any entry', async () => {
    const admin = await masterAdminAgent('finalize-regress-noflip-admin@test.local');
    const { site, units } = await makeSiteWithUnits('Test Site Finalize Regress NoFlip', ['Alpha']);
    const cycle = await makeDraftCycle(admin, 11);
    const employee = await makeEmployee(site.id, units[0]!.id, 'NoFlip Employee');
    const entry = await createEntry(admin, cycle.id, employee.id);
    const held = await holdEntry(admin, entry.id, entry.version);

    const finalizeRes = await finalize(admin, cycle.id);
    expect(finalizeRes.status).toBe(200);

    const entryAfter = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(entryAfter.released).toBe(false);
    expect(entryAfter.releasedAt).toBeNull();
    expect(entryAfter.releasedBy).toBeNull();
    expect(entryAfter.version).toBe(held.version);
  });

  // --- Regression: editability invariant holds across every mutation surface (final review, 2026-07-14) ---

  it('regression: a held, unreleased entry remains editable via bulk update ("Copy to All") after cycle finalization; a released entry stays permanently skipped', async () => {
    const admin = await masterAdminAgent('finalize-regress-bulk-admin@test.local');
    const { site, units } = await makeSiteWithUnits('Test Site Finalize Regress Bulk', ['Alpha']);
    const cycle = await makeDraftCycle(admin, 12);
    const releasedEmployee = await makeEmployee(site.id, units[0]!.id, 'Bulk Regress Released');
    const heldEmployee = await makeEmployee(site.id, units[0]!.id, 'Bulk Regress Held');
    const releasedEntry = await createEntry(admin, cycle.id, releasedEmployee.id);
    const heldEntry = await createEntry(admin, cycle.id, heldEmployee.id);
    await holdEntry(admin, heldEntry.id, heldEntry.version);
    await releaseUnit(admin, cycle.id, units[0]!.id);

    const finalizeRes = await finalize(admin, cycle.id);
    expect(finalizeRes.status).toBe(200);

    const bulkRes = await admin.agent
      .patch(`/api/v1/payroll-cycles/${cycle.id}/entries/bulk`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ siteIds: [site.id], field: 'leaveRate', value: '500.00' });
    expect(bulkRes.status).toBe(200);
    // Both entries match the site filter — only the still-unreleased (held) one is actually
    // editable, cycle status notwithstanding.
    expect(bulkRes.body).toEqual({ matchedCount: 2, appliedCount: 1 });

    const heldAfter = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: heldEntry.id } });
    expect(Number(heldAfter.leaveRate)).toBe(500);
    expect(heldAfter.hold).toBe(true);
    expect(heldAfter.released).toBe(false);

    const releasedAfter = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: releasedEntry.id } });
    expect(releasedAfter.leaveRate).toBeNull();
    expect(releasedAfter.released).toBe(true);
  });

  it('regression: a held, unreleased entry remains importable (CSV) after cycle finalization; a released entry stays permanently skipped', async () => {
    const admin = await masterAdminAgent('finalize-regress-import-admin@test.local');
    const { site, units } = await makeSiteWithUnits('Test Site Finalize Regress Import', ['Alpha']);
    const cycle = await makeDraftCycle(admin, 1);
    const releasedEmployee = await makeEmployeeWithCnic(
      site.id,
      units[0]!.id,
      'Import Regress Released',
      '1111122222333',
    );
    const heldEmployee = await makeEmployeeWithCnic(site.id, units[0]!.id, 'Import Regress Held', '4444455555666');
    await createEntry(admin, cycle.id, releasedEmployee.id);
    const heldEntry = await createEntry(admin, cycle.id, heldEmployee.id);
    await holdEntry(admin, heldEntry.id, heldEntry.version);
    await releaseUnit(admin, cycle.id, units[0]!.id);

    const finalizeRes = await finalize(admin, cycle.id);
    expect(finalizeRes.status).toBe(200);

    const csv = toCsv([
      templateRow({ CNIC: '1111122222333', 'Gross Pay': '99999' }),
      templateRow({ CNIC: '4444455555666', 'Gross Pay': '45000' }),
    ]);

    const importRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries/import`)
      .set('x-csrf-token', admin.csrfToken)
      .attach('file', csv, 'payroll.csv');

    expect(importRes.status).toBe(200);
    expect(importRes.body.updated).toBe(1);
    expect(importRes.body.skipped).toHaveLength(1);
    expect(importRes.body.skipped[0].reason).toMatch(/locked/i);

    const heldAfter = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: heldEntry.id } });
    expect(Number(heldAfter.grossPay)).toBe(45000);
    expect(heldAfter.hold).toBe(true);
    expect(heldAfter.released).toBe(false);

    const releasedAfter = await prisma.payrollEntry.findFirstOrThrow({
      where: { cycleId: cycle.id, employeeId: releasedEmployee.id },
    });
    expect(Number(releasedAfter.grossPay)).not.toBe(99999);
    expect(releasedAfter.released).toBe(true);
  });
});
