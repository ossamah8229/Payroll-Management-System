import { CASH_BANK_CODE, PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

const app = createApp();

const PASSWORD = 'CorrectHorseBattery1!';

describe('Bank Registry', () => {
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
      permissionKeys: [PERMISSIONS.BANKS_MANAGE],
    });
  }

  async function payrollStaffAgent(email: string) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.PAYROLL_STAFF,
      permissionKeys: [],
    });
  }

  describe('GET /api/v1/banks', () => {
    it('returns active banks to any authenticated user without banks:manage', async () => {
      const { agent } = await payrollStaffAgent('banks-list-staff@test.local');

      const res = await agent.get('/api/v1/banks');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.banks)).toBe(true);
      expect(res.body.banks.every((bank: { isActive: boolean }) => bank.isActive)).toBe(true);
    });

    it('excludes the reserved Cash record from the default (active) list', async () => {
      const { agent } = await payrollStaffAgent('banks-list-cash-excluded@test.local');

      const res = await agent.get('/api/v1/banks');

      expect(res.status).toBe(200);
      expect(res.body.banks.some((bank: { code: string }) => bank.code === CASH_BANK_CODE)).toBe(false);
    });

    it('rejects includeInactive=true from a user without banks:manage', async () => {
      const { agent } = await payrollStaffAgent('banks-list-inactive-unauthorized@test.local');

      const res = await agent.get('/api/v1/banks?includeInactive=true');

      expect(res.status).toBe(403);
    });

    it('returns every bank including Cash and inactive ones to a banks:manage holder', async () => {
      const { agent, csrfToken } = await masterAdminAgent('banks-list-inactive-admin@test.local');

      await agent
        .post('/api/v1/banks')
        .set('x-csrf-token', csrfToken)
        .send({ code: 'TB1', name: 'Test Bank Inactive' });
      await agent
        .patch(`/api/v1/banks/${(await prisma.bank.findUniqueOrThrow({ where: { code: 'TB1' } })).id}`)
        .set('x-csrf-token', csrfToken)
        .send({ isActive: false });

      const res = await agent.get('/api/v1/banks?includeInactive=true');

      expect(res.status).toBe(200);
      const codes = res.body.banks.map((bank: { code: string }) => bank.code);
      expect(codes).toContain(CASH_BANK_CODE);
      expect(codes).toContain('TB1');
      const cashRow = res.body.banks.find((bank: { code: string }) => bank.code === CASH_BANK_CODE);
      expect(cashRow.isActive).toBe(true);
    });
  });

  describe('POST /api/v1/banks', () => {
    it('lets a banks:manage holder create a bank', async () => {
      const { agent, csrfToken } = await masterAdminAgent('banks-create@test.local');

      const res = await agent
        .post('/api/v1/banks')
        .set('x-csrf-token', csrfToken)
        .send({ code: 'TB2', name: 'Test Bank Alpha' });

      expect(res.status).toBe(201);
      expect(res.body.bank.code).toBe('TB2');
      expect(res.body.bank.name).toBe('Test Bank Alpha');
      expect(res.body.bank.isActive).toBe(true);

      const entries = await prisma.auditLog.findMany({ where: { action: 'bank.created' } });
      expect(entries.some((entry) => entry.entityId === res.body.bank.id)).toBe(true);
    });

    it('rejects bank creation from a user without banks:manage', async () => {
      const { agent, csrfToken } = await payrollStaffAgent('banks-create-unauthorized@test.local');

      const res = await agent
        .post('/api/v1/banks')
        .set('x-csrf-token', csrfToken)
        .send({ code: 'TB3', name: 'Test Bank Should Not Exist' });

      expect(res.status).toBe(403);
    });

    it('rejects a duplicate bank code with 409', async () => {
      const { agent, csrfToken } = await masterAdminAgent('banks-create-dup@test.local');

      await agent.post('/api/v1/banks').set('x-csrf-token', csrfToken).send({ code: 'TB4', name: 'Test Bank Beta' });
      const res = await agent
        .post('/api/v1/banks')
        .set('x-csrf-token', csrfToken)
        .send({ code: 'TB4', name: 'Test Bank Beta Duplicate' });

      expect(res.status).toBe(409);
    });

    it('rejects creating a bank with the reserved Cash code, case-insensitively', async () => {
      const { agent, csrfToken } = await masterAdminAgent('banks-create-reserved@test.local');

      const res = await agent
        .post('/api/v1/banks')
        .set('x-csrf-token', csrfToken)
        .send({ code: 'cash', name: 'Impostor Cash' });

      expect(res.status).toBe(400);
    });

    it('rejects an empty code or name', async () => {
      const { agent, csrfToken } = await masterAdminAgent('banks-create-invalid@test.local');

      const res = await agent.post('/api/v1/banks').set('x-csrf-token', csrfToken).send({ code: '', name: '' });

      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /api/v1/banks/:id', () => {
    it('lets a banks:manage holder edit name and toggle isActive on an unreferenced bank', async () => {
      const { agent, csrfToken } = await masterAdminAgent('banks-update@test.local');

      const createRes = await agent
        .post('/api/v1/banks')
        .set('x-csrf-token', csrfToken)
        .send({ code: 'TB5', name: 'Test Bank Gamma' });

      const updateRes = await agent
        .patch(`/api/v1/banks/${createRes.body.bank.id}`)
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Test Bank Gamma Renamed', isActive: false });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.bank.name).toBe('Test Bank Gamma Renamed');
      expect(updateRes.body.bank.isActive).toBe(false);

      const entries = await prisma.auditLog.findMany({ where: { action: 'bank.updated' } });
      expect(entries.some((entry) => entry.entityId === createRes.body.bank.id)).toBe(true);
    });

    it('lets an unreferenced bank change its own code', async () => {
      const { agent, csrfToken } = await masterAdminAgent('banks-update-code@test.local');

      const createRes = await agent
        .post('/api/v1/banks')
        .set('x-csrf-token', csrfToken)
        .send({ code: 'TB6', name: 'Test Bank Delta' });

      const updateRes = await agent
        .patch(`/api/v1/banks/${createRes.body.bank.id}`)
        .set('x-csrf-token', csrfToken)
        .send({ code: 'TB6B' });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.bank.code).toBe('TB6B');
    });

    it('rejects changing a referenced bank\'s code, but still allows name/isActive edits', async () => {
      const { agent, csrfToken } = await masterAdminAgent('banks-update-locked@test.local');

      const createRes = await agent
        .post('/api/v1/banks')
        .set('x-csrf-token', csrfToken)
        .send({ code: 'TB7', name: 'Test Bank Epsilon' });
      const bankId = createRes.body.bank.id;

      const site = await prisma.projectSite.create({ data: { name: 'Test Site Bank Reference' } });
      const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'Bank Reference Unit' } });
      await prisma.employee.create({
        data: {
          name: 'Test Employee Bank Reference',
          designation: 'Guard',
          siteId: site.id,
          unitId: unit.id,
          grossPay: '30000.00',
          bankId,
        },
      });

      const codeChangeRes = await agent
        .patch(`/api/v1/banks/${bankId}`)
        .set('x-csrf-token', csrfToken)
        .send({ code: 'TB7B' });
      expect(codeChangeRes.status).toBe(400);

      const nameChangeRes = await agent
        .patch(`/api/v1/banks/${bankId}`)
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Test Bank Epsilon Renamed', isActive: false });
      expect(nameChangeRes.status).toBe(200);
      expect(nameChangeRes.body.bank.name).toBe('Test Bank Epsilon Renamed');
      expect(nameChangeRes.body.bank.isActive).toBe(false);
      expect(nameChangeRes.body.bank.code).toBe('TB7');
    });

    it('rejects any edit to the reserved Cash record', async () => {
      const { agent, csrfToken } = await masterAdminAgent('banks-update-cash@test.local');
      const cashBank = await prisma.bank.findUniqueOrThrow({ where: { code: CASH_BANK_CODE } });

      const nameRes = await agent
        .patch(`/api/v1/banks/${cashBank.id}`)
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Renamed Cash' });
      expect(nameRes.status).toBe(400);

      const codeRes = await agent
        .patch(`/api/v1/banks/${cashBank.id}`)
        .set('x-csrf-token', csrfToken)
        .send({ code: 'CASHX' });
      expect(codeRes.status).toBe(400);

      const activeRes = await agent
        .patch(`/api/v1/banks/${cashBank.id}`)
        .set('x-csrf-token', csrfToken)
        .send({ isActive: false });
      expect(activeRes.status).toBe(400);

      const unchanged = await prisma.bank.findUniqueOrThrow({ where: { id: cashBank.id } });
      expect(unchanged.code).toBe(CASH_BANK_CODE);
      expect(unchanged.name).toBe('Cash');
      expect(unchanged.isActive).toBe(true);
    });

    it('rejects bank edits from a user without banks:manage', async () => {
      const admin = await masterAdminAgent('banks-update-unauthorized-admin@test.local');
      const createRes = await admin.agent
        .post('/api/v1/banks')
        .set('x-csrf-token', admin.csrfToken)
        .send({ code: 'TB8', name: 'Test Bank Zeta' });

      const { agent, csrfToken } = await payrollStaffAgent('banks-update-unauthorized-staff@test.local');
      const res = await agent
        .patch(`/api/v1/banks/${createRes.body.bank.id}`)
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Should Not Change' });

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /api/v1/banks/:id', () => {
    it('deletes an unreferenced bank', async () => {
      const { agent, csrfToken } = await masterAdminAgent('banks-delete@test.local');

      const createRes = await agent
        .post('/api/v1/banks')
        .set('x-csrf-token', csrfToken)
        .send({ code: 'TB9', name: 'Test Bank Eta' });

      const deleteRes = await agent.delete(`/api/v1/banks/${createRes.body.bank.id}`).set('x-csrf-token', csrfToken);

      expect(deleteRes.status).toBe(204);
      const found = await prisma.bank.findUnique({ where: { id: createRes.body.bank.id } });
      expect(found).toBeNull();

      const entries = await prisma.auditLog.findMany({ where: { action: 'bank.deleted' } });
      expect(entries.some((entry) => entry.entityId === createRes.body.bank.id)).toBe(true);
    });

    it('blocks deleting a bank while an employee still references it', async () => {
      const { agent, csrfToken } = await masterAdminAgent('banks-delete-blocked@test.local');

      const createRes = await agent
        .post('/api/v1/banks')
        .set('x-csrf-token', csrfToken)
        .send({ code: 'TB10', name: 'Test Bank Theta' });
      const bankId = createRes.body.bank.id;

      const site = await prisma.projectSite.create({ data: { name: 'Test Site Bank Delete Block' } });
      const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'Delete Block Unit' } });
      await prisma.employee.create({
        data: {
          name: 'Test Employee Bank Delete Block',
          designation: 'Guard',
          siteId: site.id,
          unitId: unit.id,
          grossPay: '30000.00',
          bankId,
        },
      });

      const deleteRes = await agent.delete(`/api/v1/banks/${bankId}`).set('x-csrf-token', csrfToken);

      expect(deleteRes.status).toBe(400);
      const stillThere = await prisma.bank.findUnique({ where: { id: bankId } });
      expect(stillThere).not.toBeNull();
    });

    it('rejects deleting the reserved Cash record even though it is unreferenced', async () => {
      const { agent, csrfToken } = await masterAdminAgent('banks-delete-cash@test.local');
      const cashBank = await prisma.bank.findUniqueOrThrow({ where: { code: CASH_BANK_CODE } });

      const res = await agent.delete(`/api/v1/banks/${cashBank.id}`).set('x-csrf-token', csrfToken);

      expect(res.status).toBe(400);
      const stillThere = await prisma.bank.findUnique({ where: { id: cashBank.id } });
      expect(stillThere).not.toBeNull();
    });

    it('rejects bank deletion from a user without banks:manage', async () => {
      const admin = await masterAdminAgent('banks-delete-unauthorized-admin@test.local');
      const createRes = await admin.agent
        .post('/api/v1/banks')
        .set('x-csrf-token', admin.csrfToken)
        .send({ code: 'TB11', name: 'Test Bank Iota' });

      const { agent, csrfToken } = await payrollStaffAgent('banks-delete-unauthorized-staff@test.local');
      const res = await agent.delete(`/api/v1/banks/${createRes.body.bank.id}`).set('x-csrf-token', csrfToken);

      expect(res.status).toBe(403);
    });
  });
});
