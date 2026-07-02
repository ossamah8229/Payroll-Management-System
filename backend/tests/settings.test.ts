import request from 'supertest';
import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent, extractCookie } from './helpers';

const app = createApp();

const PASSWORD = 'CorrectHorseBattery1!';
const COMPANY_SETTINGS_ID = '00000000-0000-0000-0000-000000000001';

describe('Settings', () => {
  beforeEach(async () => {
    await cleanTestData();
    await prisma.companySettings.upsert({
      where: { id: COMPANY_SETTINGS_ID },
      update: { companyName: 'Test Original Co' },
      create: { id: COMPANY_SETTINGS_ID, companyName: 'Test Original Co' },
    });
  });

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  describe('Company settings', () => {
    it('lets any authenticated user read company settings', async () => {
      const { agent } = await createAuthenticatedAgent(app, {
        email: 'settings-read@test.local',
        password: PASSWORD,
        roleCode: ROLE_CODES.PAYROLL_STAFF,
        permissionKeys: [],
      });

      const res = await agent.get('/api/v1/settings/company');
      expect(res.status).toBe(200);
      expect(res.body.settings.companyName).toBe('Test Original Co');
    });

    it('lets Master Admin (settings:manage) update company settings', async () => {
      const { agent, csrfToken } = await createAuthenticatedAgent(app, {
        email: 'settings-update@test.local',
        password: PASSWORD,
        roleCode: ROLE_CODES.MASTER_ADMIN,
        permissionKeys: [PERMISSIONS.SETTINGS_MANAGE],
      });

      const res = await agent
        .patch('/api/v1/settings/company')
        .set('x-csrf-token', csrfToken)
        .send({ companyName: 'Updated Test Co', phone: '021-1234567' });

      expect(res.status).toBe(200);
      expect(res.body.settings.companyName).toBe('Updated Test Co');

      const entries = await prisma.auditLog.findMany({ where: { action: 'company-settings.updated' } });
      expect(entries.length).toBeGreaterThan(0);
    });

    it('rejects a company settings update from a user without settings:manage', async () => {
      const { agent, csrfToken } = await createAuthenticatedAgent(app, {
        email: 'settings-unauthorized@test.local',
        password: PASSWORD,
        roleCode: ROLE_CODES.PAYROLL_STAFF,
        permissionKeys: [],
      });

      const res = await agent
        .patch('/api/v1/settings/company')
        .set('x-csrf-token', csrfToken)
        .send({ companyName: 'Should Not Apply' });

      expect(res.status).toBe(403);
    });
  });

  describe('My Profile', () => {
    it("updates the current user's name and theme accent color", async () => {
      const { agent, csrfToken } = await createAuthenticatedAgent(app, {
        email: 'profile-update@test.local',
        password: PASSWORD,
        roleCode: ROLE_CODES.PAYROLL_STAFF,
        permissionKeys: [],
      });

      const res = await agent
        .patch('/api/v1/auth/me')
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Renamed Test User', themeAccentColor: '#2E6EA6' });

      expect(res.status).toBe(200);
      expect(res.body.user.name).toBe('Renamed Test User');
      expect(res.body.user.themeAccentColor).toBe('#2E6EA6');
    });

    it('changes the password after verifying the current one, and rejects a wrong current password', async () => {
      const { agent, csrfToken } = await createAuthenticatedAgent(app, {
        email: 'profile-password@test.local',
        password: PASSWORD,
        roleCode: ROLE_CODES.PAYROLL_STAFF,
        permissionKeys: [],
      });

      const wrongAttempt = await agent
        .post('/api/v1/auth/change-password')
        .set('x-csrf-token', csrfToken)
        .send({ currentPassword: 'not-the-real-password', newPassword: 'BrandNewPassword1!' });
      expect(wrongAttempt.status).toBe(400);

      const correctAttempt = await agent
        .post('/api/v1/auth/change-password')
        .set('x-csrf-token', csrfToken)
        .send({ currentPassword: PASSWORD, newPassword: 'BrandNewPassword1!' });
      expect(correctAttempt.status).toBe(204);

      const freshAgent = request.agent(app);
      const freshCsrfRes = await freshAgent.get('/health');
      const freshCsrfToken = extractCookie(freshCsrfRes, 'csrf_token')!;

      const oldPasswordLogin = await freshAgent
        .post('/api/v1/auth/login')
        .set('x-csrf-token', freshCsrfToken)
        .send({ email: 'profile-password@test.local', password: PASSWORD });
      expect(oldPasswordLogin.status).toBe(401);

      const newPasswordLogin = await freshAgent
        .post('/api/v1/auth/login')
        .set('x-csrf-token', freshCsrfToken)
        .send({ email: 'profile-password@test.local', password: 'BrandNewPassword1!' });
      expect(newPasswordLogin.status).toBe(200);
    });
  });
});
