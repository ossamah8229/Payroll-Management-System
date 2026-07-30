import request from 'supertest';
import sharp from 'sharp';
import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { storageProvider } from '../src/lib/storage';
import { StorageNotFoundError } from '../src/lib/storage/errors';
import { companyLogoObjectKeys } from '../src/modules/settings/company-logo-keys';
import { assertNoSensitiveKeys, cleanTestData, createAuthenticatedAgent, extractCookie } from './helpers';

const app = createApp();

const PASSWORD = 'CorrectHorseBattery1!';
const COMPANY_SETTINGS_ID = '00000000-0000-0000-0000-000000000001';

async function pngBuffer(width = 100, height = 100): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { r: 10, g: 90, b: 170, alpha: 1 } } })
    .png()
    .toBuffer();
}

describe('Settings', () => {
  beforeEach(async () => {
    await cleanTestData();
    await prisma.companySettings.upsert({
      where: { id: COMPANY_SETTINGS_ID },
      // `logoStorageKey` is explicitly reset here (not just on `create`) — the Company Logo test
      // suite below mutates this singleton row's logo across tests; without resetting it, a
      // version set by one test would leak into the next test's starting state regardless of
      // execution order.
      update: { companyName: 'Test Original Co', logoStorageKey: null },
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

  describe('Company Logo (Phase 7C)', () => {
    it('returns 404 from the unauthenticated public routes when no logo is set — no session required', async () => {
      const uiRes = await request(app).get('/api/v1/settings/company/logo/ui');
      expect(uiRes.status).toBe(404);

      const printRes = await request(app).get('/api/v1/settings/company/logo/print');
      expect(printRes.status).toBe(404);
    });

    it('lets Master Admin (settings:manage) upload a logo, serves it back unauthenticated, and records an audit entry', async () => {
      const { agent, csrfToken } = await createAuthenticatedAgent(app, {
        email: 'logo-upload@test.local',
        password: PASSWORD,
        roleCode: ROLE_CODES.MASTER_ADMIN,
        permissionKeys: [PERMISSIONS.SETTINGS_MANAGE],
      });

      const uploadRes = await agent
        .post('/api/v1/settings/company/logo')
        .set('x-csrf-token', csrfToken)
        .attach('file', await pngBuffer(), { filename: 'logo.png', contentType: 'image/png' });

      expect(uploadRes.status).toBe(200);
      expect(uploadRes.body.settings.hasLogo).toBe(true);
      // Do not return storage keys to the frontend (Phase 7C's own explicit requirement) — checked
      // recursively, not just at the top level.
      assertNoSensitiveKeys(uploadRes.body);

      const uploadEntries = await prisma.auditLog.findMany({ where: { action: 'company.logo.uploaded' } });
      expect(uploadEntries.length).toBeGreaterThan(0);

      const uiRes = await request(app).get('/api/v1/settings/company/logo/ui');
      expect(uiRes.status).toBe(200);
      expect(uiRes.headers['content-type']).toContain('image/png');
      expect(uiRes.body.length).toBeGreaterThan(0);

      const printRes = await request(app).get('/api/v1/settings/company/logo/print');
      expect(printRes.status).toBe(200);
      expect(printRes.headers['content-type']).toContain('image/png');

      // GET /company/logo/ui also never returns CompanySettings data — image bytes only.
      expect(uiRes.headers['content-type']).not.toContain('application/json');
    });

    it('honors a conditional GET (ETag/If-None-Match) with a 304', async () => {
      const { agent, csrfToken } = await createAuthenticatedAgent(app, {
        email: 'logo-etag@test.local',
        password: PASSWORD,
        roleCode: ROLE_CODES.MASTER_ADMIN,
        permissionKeys: [PERMISSIONS.SETTINGS_MANAGE],
      });
      await agent
        .post('/api/v1/settings/company/logo')
        .set('x-csrf-token', csrfToken)
        .attach('file', await pngBuffer(), { filename: 'logo.png', contentType: 'image/png' });

      const first = await request(app).get('/api/v1/settings/company/logo/ui');
      const etag = first.headers.etag;
      expect(etag).toBeTruthy();

      const second = await request(app).get('/api/v1/settings/company/logo/ui').set('If-None-Match', etag!);
      expect(second.status).toBe(304);
    });

    it('overrides the app-wide same-origin Cross-Origin-Resource-Policy so a cross-origin <img> tag can actually embed it', async () => {
      // Regression: `helmet()`'s app-wide default (`app.ts`) sends `Cross-Origin-Resource-Policy:
      // same-origin` on every response, which real-browser (Playwright) verification caught
      // blocking the Login page's `<img>` load outright (`net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`)
      // — a supertest-only pass never would have caught this, since supertest doesn't enforce
      // fetch-destination CORP the way a real browser does. This route must explicitly override it.
      const { agent, csrfToken } = await createAuthenticatedAgent(app, {
        email: 'logo-corp@test.local',
        password: PASSWORD,
        roleCode: ROLE_CODES.MASTER_ADMIN,
        permissionKeys: [PERMISSIONS.SETTINGS_MANAGE],
      });
      await agent
        .post('/api/v1/settings/company/logo')
        .set('x-csrf-token', csrfToken)
        .attach('file', await pngBuffer(), { filename: 'logo.png', contentType: 'image/png' });

      const res = await request(app).get('/api/v1/settings/company/logo/ui');
      expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    });

    it('replaces an existing logo — old storage objects are deleted only after the new version is committed', async () => {
      const { agent, csrfToken } = await createAuthenticatedAgent(app, {
        email: 'logo-replace@test.local',
        password: PASSWORD,
        roleCode: ROLE_CODES.MASTER_ADMIN,
        permissionKeys: [PERMISSIONS.SETTINGS_MANAGE],
      });

      await agent
        .post('/api/v1/settings/company/logo')
        .set('x-csrf-token', csrfToken)
        .attach('file', await pngBuffer(80, 80), { filename: 'first.png', contentType: 'image/png' });
      const firstVersion = (await prisma.companySettings.findUniqueOrThrow({ where: { id: COMPANY_SETTINGS_ID } }))
        .logoStorageKey!;

      const replaceRes = await agent
        .post('/api/v1/settings/company/logo')
        .set('x-csrf-token', csrfToken)
        .attach('file', await pngBuffer(120, 120), { filename: 'second.png', contentType: 'image/png' });
      expect(replaceRes.status).toBe(200);

      const replacedEntries = await prisma.auditLog.findMany({ where: { action: 'company.logo.replaced' } });
      expect(replacedEntries.length).toBeGreaterThan(0);

      const secondVersion = (await prisma.companySettings.findUniqueOrThrow({ where: { id: COMPANY_SETTINGS_ID } }))
        .logoStorageKey!;
      expect(secondVersion).not.toBe(firstVersion);

      // The old version's objects are gone — deleted only after the new version was already
      // safely written and the DB row committed (this checkpoint's own explicit ordering
      // requirement), never left orphaned indefinitely nor deleted prematurely.
      const oldKeys = companyLogoObjectKeys(firstVersion);
      await expect(storageProvider.read(oldKeys.ui)).rejects.toThrow(StorageNotFoundError);
      await expect(storageProvider.read(oldKeys.print)).rejects.toThrow(StorageNotFoundError);

      // The new version's objects are readable.
      const newKeys = companyLogoObjectKeys(secondVersion);
      await expect(storageProvider.read(newKeys.ui)).resolves.toBeInstanceOf(Buffer);
    });

    it('lets Master Admin remove the logo — audit entry recorded, subsequent retrieval 404s, storage objects deleted', async () => {
      const { agent, csrfToken } = await createAuthenticatedAgent(app, {
        email: 'logo-remove@test.local',
        password: PASSWORD,
        roleCode: ROLE_CODES.MASTER_ADMIN,
        permissionKeys: [PERMISSIONS.SETTINGS_MANAGE],
      });

      await agent
        .post('/api/v1/settings/company/logo')
        .set('x-csrf-token', csrfToken)
        .attach('file', await pngBuffer(), { filename: 'logo.png', contentType: 'image/png' });
      const version = (await prisma.companySettings.findUniqueOrThrow({ where: { id: COMPANY_SETTINGS_ID } }))
        .logoStorageKey!;

      const removeRes = await agent.delete('/api/v1/settings/company/logo').set('x-csrf-token', csrfToken);
      expect(removeRes.status).toBe(200);
      expect(removeRes.body.settings.hasLogo).toBe(false);

      const removedEntries = await prisma.auditLog.findMany({ where: { action: 'company.logo.removed' } });
      expect(removedEntries.length).toBeGreaterThan(0);

      const uiRes = await request(app).get('/api/v1/settings/company/logo/ui');
      expect(uiRes.status).toBe(404);

      const keys = companyLogoObjectKeys(version);
      await expect(storageProvider.read(keys.ui)).rejects.toThrow(StorageNotFoundError);
    });

    it('rejects removal when no logo is currently set', async () => {
      const { agent, csrfToken } = await createAuthenticatedAgent(app, {
        email: 'logo-remove-missing@test.local',
        password: PASSWORD,
        roleCode: ROLE_CODES.MASTER_ADMIN,
        permissionKeys: [PERMISSIONS.SETTINGS_MANAGE],
      });

      const res = await agent.delete('/api/v1/settings/company/logo').set('x-csrf-token', csrfToken);
      expect(res.status).toBe(404);
    });

    it('rejects an upload from a user without settings:manage', async () => {
      const { agent, csrfToken } = await createAuthenticatedAgent(app, {
        email: 'logo-unauthorized@test.local',
        password: PASSWORD,
        roleCode: ROLE_CODES.PAYROLL_STAFF,
        permissionKeys: [],
      });

      const res = await agent
        .post('/api/v1/settings/company/logo')
        .set('x-csrf-token', csrfToken)
        .attach('file', await pngBuffer(), { filename: 'logo.png', contentType: 'image/png' });
      expect(res.status).toBe(403);
    });

    it('rejects an upload with a missing/invalid CSRF token', async () => {
      const { agent } = await createAuthenticatedAgent(app, {
        email: 'logo-csrf@test.local',
        password: PASSWORD,
        roleCode: ROLE_CODES.MASTER_ADMIN,
        permissionKeys: [PERMISSIONS.SETTINGS_MANAGE],
      });

      const res = await agent
        .post('/api/v1/settings/company/logo')
        .set('x-csrf-token', 'not-the-real-token')
        .attach('file', await pngBuffer(), { filename: 'logo.png', contentType: 'image/png' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CSRF_TOKEN_MISMATCH');
    });

    it('rejects an oversized upload (over 2 MB) with a clean 400, not a 500', async () => {
      const { agent, csrfToken } = await createAuthenticatedAgent(app, {
        email: 'logo-oversized@test.local',
        password: PASSWORD,
        roleCode: ROLE_CODES.MASTER_ADMIN,
        permissionKeys: [PERMISSIONS.SETTINGS_MANAGE],
      });

      const oversized = Buffer.alloc(3 * 1024 * 1024, 1);
      const res = await agent
        .post('/api/v1/settings/company/logo')
        .set('x-csrf-token', csrfToken)
        .attach('file', oversized, { filename: 'huge.png', contentType: 'image/png' });
      expect(res.status).toBe(400);
    });

    it('rejects a file that is not a recognizable image', async () => {
      const { agent, csrfToken } = await createAuthenticatedAgent(app, {
        email: 'logo-invalid@test.local',
        password: PASSWORD,
        roleCode: ROLE_CODES.MASTER_ADMIN,
        permissionKeys: [PERMISSIONS.SETTINGS_MANAGE],
      });

      const res = await agent
        .post('/api/v1/settings/company/logo')
        .set('x-csrf-token', csrfToken)
        .attach('file', Buffer.from('not an image'), { filename: 'fake.png', contentType: 'image/png' });
      expect(res.status).toBe(400);
    });

    it('rejects an upload request with no file attached', async () => {
      const { agent, csrfToken } = await createAuthenticatedAgent(app, {
        email: 'logo-no-file@test.local',
        password: PASSWORD,
        roleCode: ROLE_CODES.MASTER_ADMIN,
        permissionKeys: [PERMISSIONS.SETTINGS_MANAGE],
      });

      const res = await agent.post('/api/v1/settings/company/logo').set('x-csrf-token', csrfToken).send();
      expect(res.status).toBe(400);
    });

    it('does not update CompanySettings.logoStorageKey if a storage write fails partway through the upload', async () => {
      const { agent, csrfToken } = await createAuthenticatedAgent(app, {
        email: 'logo-storage-failure@test.local',
        password: PASSWORD,
        roleCode: ROLE_CODES.MASTER_ADMIN,
        permissionKeys: [PERMISSIONS.SETTINGS_MANAGE],
      });

      const writeSpy = jest.spyOn(storageProvider, 'write').mockRejectedValueOnce(new Error('simulated storage outage'));
      try {
        const res = await agent
          .post('/api/v1/settings/company/logo')
          .set('x-csrf-token', csrfToken)
          .attach('file', await pngBuffer(), { filename: 'logo.png', contentType: 'image/png' });
        expect(res.status).toBe(500);
      } finally {
        writeSpy.mockRestore();
      }

      const settings = await prisma.companySettings.findUniqueOrThrow({ where: { id: COMPANY_SETTINGS_ID } });
      expect(settings.logoStorageKey).toBeNull();

      const uiRes = await request(app).get('/api/v1/settings/company/logo/ui');
      expect(uiRes.status).toBe(404);
    });
  });
});
