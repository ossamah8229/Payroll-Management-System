import request from 'supertest';
import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { assertNoSensitiveKeys, cleanTestData, createAuthenticatedAgent } from './helpers';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

/**
 * Phase 5 Checkpoint 4 security correction (2026-07-16) — the narrow response-safety review
 * requested alongside the `passwordHash` leak fix (which turned out to live in the Users module,
 * `users.service.ts`, not anywhere in Payroll Cycle/Backup Package/Salary Release responses — see
 * `docs/PROJECT_PROGRESS.md`'s Checkpoint 4 security-correction entry for the full investigation).
 * These tests pin the *negative* finding for the Phase 5 lifecycle surfaces the review covered:
 * none of them return a raw Prisma relation object or a sensitive field, and this file exists so
 * that stays true going forward, not just true today.
 */
describe('Phase 5 lifecycle response-safety review (Checkpoint 4 security correction)', () => {
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

  async function makeEmployee(siteId: string, unitId: string, name: string) {
    return prisma.employee.create({
      data: { name, designation: 'Guard', siteId, unitId, grossPay: '30000' },
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

  async function releaseUnit(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, cycleId: string, unitId: string) {
    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycleId}/units/${unitId}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    if (res.status !== 201) throw new Error(`release failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  }

  async function finalizeCycle(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, cycleId: string) {
    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycleId}/finalize`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    if (res.status !== 200) throw new Error(`finalize failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  }

  function rollover(agent: { agent: ReturnType<typeof request.agent>; csrfToken: string }, cycleId: string) {
    return agent.agent
      .post(`/api/v1/payroll-cycles/${cycleId}/archive-and-create-next`)
      .set('x-csrf-token', agent.csrfToken)
      .send({});
  }

  /** Builds one full lifecycle: Draft -> (unit released) -> Released -> (rollover) -> Archived, with
   * a fresh Draft created alongside. Returns every intermediate response body so each test can
   * assert on whichever stage it needs without re-deriving the sequence. */
  async function buildFullLifecycle(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, month: number) {
    const { site, unit } = await makeSiteWithUnit(`Test Site Response Security ${month}`);
    await makeEmployee(site.id, unit.id, `Response Security Employee ${month}`);
    const draftCycle = await makeDraftCycle(admin, month);
    const releaseBody = await releaseUnit(admin, draftCycle.id, unit.id);
    const finalizeBody = await finalizeCycle(admin, draftCycle.id);
    const rolloverRes = await rollover(admin, draftCycle.id);
    if (rolloverRes.status !== 201) {
      throw new Error(`rollover failed: ${rolloverRes.status} ${JSON.stringify(rolloverRes.body)}`);
    }
    return { site, unit, draftCycle, releaseBody, finalizeBody, rolloverBody: rolloverRes.body };
  }

  it('cycle list contains no sensitive keys and correct isCurrentDraft for a Draft cycle (pre-rollover, RELEASED state)', async () => {
    const admin = await masterAdminAgent('cycle-list-security-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Response Security List');
    await makeEmployee(site.id, unit.id, 'Response Security List Employee');
    const cycle = await makeDraftCycle(admin, 1);
    await releaseUnit(admin, cycle.id, unit.id);
    await finalizeCycle(admin, cycle.id);

    const listRes = await admin.agent.get('/api/v1/payroll-cycles');
    expect(listRes.status).toBe(200);
    expect(() => assertNoSensitiveKeys(listRes.body)).not.toThrow();

    const releasedEntry = listRes.body.cycles.find((c: { id: string }) => c.id === cycle.id);
    expect(releasedEntry.status).toBe('RELEASED');
    expect(releasedEntry.isCurrentDraft).toBe(false);
  });

  it('cycle list and detail contain no sensitive keys for Draft/Archived cycles after rollover, with correct isCurrentDraft', async () => {
    const admin = await masterAdminAgent('cycle-list-archived-security-admin@test.local');
    const { draftCycle, rolloverBody } = await buildFullLifecycle(admin, 2);

    const listRes = await admin.agent.get('/api/v1/payroll-cycles');
    expect(listRes.status).toBe(200);
    expect(() => assertNoSensitiveKeys(listRes.body)).not.toThrow();

    const archived = listRes.body.cycles.find((c: { id: string }) => c.id === draftCycle.id);
    const newDraft = listRes.body.cycles.find((c: { id: string }) => c.id === rolloverBody.newCycle.id);
    expect(archived.status).toBe('ARCHIVED');
    expect(archived.isCurrentDraft).toBe(false);
    expect(newDraft.status).toBe('DRAFT');
    expect(newDraft.isCurrentDraft).toBe(true);

    const detailRes = await admin.agent.get(`/api/v1/payroll-cycles/${draftCycle.id}`);
    expect(detailRes.status).toBe(200);
    expect(() => assertNoSensitiveKeys(detailRes.body)).not.toThrow();
    expect(detailRes.body.cycle.status).toBe('ARCHIVED');
  });

  it('Finalize response contains no authentication fields anywhere', async () => {
    const admin = await masterAdminAgent('finalize-security-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Response Security Finalize');
    await makeEmployee(site.id, unit.id, 'Response Security Finalize Employee');
    const cycle = await makeDraftCycle(admin, 3);
    await releaseUnit(admin, cycle.id, unit.id);

    const finalizeRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/finalize`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});

    expect(finalizeRes.status).toBe(200);
    expect(() => assertNoSensitiveKeys(finalizeRes.body)).not.toThrow();
  });

  it('rollover (archive-and-create-next) response contains no authentication fields anywhere, including nested outgoing/new cycle objects', async () => {
    const admin = await masterAdminAgent('rollover-security-admin@test.local');
    const { rolloverBody } = await buildFullLifecycle(admin, 4);

    expect(() => assertNoSensitiveKeys(rolloverBody)).not.toThrow();
    expect(rolloverBody.outgoingCycle.status).toBe('ARCHIVED');
    expect(rolloverBody.newCycle.status).toBe('DRAFT');
  });

  it('Salary Release unit-status payload exposes only {id, name} for the nested releasedBy actor, never raw User fields', async () => {
    const admin = await masterAdminAgent('release-status-security-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Response Security Release');
    await makeEmployee(site.id, unit.id, 'Response Security Release Employee');
    const cycle = await makeDraftCycle(admin, 5);
    await releaseUnit(admin, cycle.id, unit.id);

    const statusRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/units?siteId=${site.id}`);
    expect(statusRes.status).toBe(200);
    expect(() => assertNoSensitiveKeys(statusRes.body)).not.toThrow();

    const releasedUnit = statusRes.body.units.find((u: { unit: { id: string } }) => u.unit.id === unit.id);
    expect(releasedUnit.released).toBe(true);
    expect(Object.keys(releasedUnit.releasedBy).sort()).toEqual(['id', 'name']);
  });

  it('Backup Package list/detail responses contain no storageKey or passwordHash anywhere', async () => {
    const admin = await masterAdminAgent('backup-package-security-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Response Security Backup');
    await makeEmployee(site.id, unit.id, 'Response Security Backup Employee');
    const cycle = await makeDraftCycle(admin, 6);
    await releaseUnit(admin, cycle.id, unit.id);
    await finalizeCycle(admin, cycle.id);

    const generateRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/backup-packages`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(generateRes.status).toBe(201);
    expect(() => assertNoSensitiveKeys(generateRes.body)).not.toThrow();

    const listRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/backup-packages`);
    expect(listRes.status).toBe(200);
    expect(() => assertNoSensitiveKeys(listRes.body)).not.toThrow();

    const detailRes = await admin.agent.get(`/api/v1/backup-packages/${generateRes.body.backupPackage.id}`);
    expect(detailRes.status).toBe(200);
    expect(() => assertNoSensitiveKeys(detailRes.body)).not.toThrow();
  });
});
