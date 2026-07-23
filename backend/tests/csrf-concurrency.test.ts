import request from 'supertest';
import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent, createTestUser, extractCookie } from './helpers';

const app = createApp();

const PASSWORD = 'CorrectHorseBattery1!';

/**
 * Checkpoint 4D regression coverage — the concurrent first-contact CSRF race root-caused in
 * Checkpoint 4C (docs/architecture/authentication.md) and fixed in `backend/src/common/middleware/
 * csrf.ts` (`firstContactToken`'s short-lived per-client coalescing map) plus the token-rotation
 * lifecycle added alongside it (`rotateCsrfCookie`, called from login/logout/change-password/
 * self-password-reset).
 */
describe('CSRF: concurrent first-contact race and token rotation (Checkpoint 4D)', () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  describe('1. Fresh client, single request', () => {
    it('mints a token whose cookie and echoed header match', async () => {
      const res = await request(app).get('/health');
      const cookieToken = extractCookie(res, 'csrf_token');
      expect(cookieToken).toBeTruthy();
      expect(res.headers['x-csrf-token']).toBe(cookieToken);
    });
  });

  describe('2. Two concurrent first requests', () => {
    it('no longer diverge — both responses mint the identical token', async () => {
      const [resA, resB] = await Promise.all([request(app).get('/health'), request(app).get('/health')]);

      const cookieA = extractCookie(resA, 'csrf_token');
      const cookieB = extractCookie(resB, 'csrf_token');

      expect(cookieA).toBeTruthy();
      expect(cookieB).toBeTruthy();
      expect(cookieA).toBe(cookieB);
      expect(resA.headers['x-csrf-token']).toBe(cookieA);
      expect(resB.headers['x-csrf-token']).toBe(cookieB);
    });

    it('remains correct under a larger concurrent burst (simulating several parallel first-load requests)', async () => {
      const responses = await Promise.all(Array.from({ length: 8 }, () => request(app).get('/health')));
      const tokens = new Set(responses.map((res) => extractCookie(res, 'csrf_token')));
      expect(tokens.size).toBe(1);
      for (const res of responses) {
        expect(res.headers['x-csrf-token']).toBe([...tokens][0]);
      }
    });
  });

  describe('3. Rapid page refresh', () => {
    it('keeps returning the same token across repeated GETs once a cookie is established (no needless rotation)', async () => {
      const agent = request.agent(app);
      const first = await agent.get('/health');
      const token = extractCookie(first, 'csrf_token')!;

      for (let i = 0; i < 5; i += 1) {
        const res = await agent.get('/health');
        expect(res.headers['x-csrf-token']).toBe(token);
        expect(extractCookie(res, 'csrf_token') ?? token).toBe(token);
      }
    });
  });

  describe('4. Multiple tabs', () => {
    it('two independent "tabs" (separate cookie jars, same client) converge on one token, so either tab can log in', async () => {
      // Two separate supertest agents = two separate cookie jars, exactly like two browser tabs
      // each holding their own in-memory api-client.ts token but sharing one underlying browser —
      // the scenario Checkpoint 4C reproduced. Fired concurrently, before either has a cookie.
      const tabA = request.agent(app);
      const tabB = request.agent(app);

      const [resA, resB] = await Promise.all([tabA.get('/health'), tabB.get('/health')]);
      const tokenA = extractCookie(resA, 'csrf_token');
      const tokenB = extractCookie(resB, 'csrf_token');

      expect(tokenA).toBe(tokenB);

      await createTestUser({ email: 'tabs@test.local', password: PASSWORD, roleCode: 'TEST_ROLE_CSRF' });

      // Tab A logs in using the token it captured from its own priming response — this is exactly
      // the request that used to intermittently 403 when the two tabs' tokens diverged.
      const loginRes = await tabA
        .post('/api/v1/auth/login')
        .set('x-csrf-token', tokenA!)
        .send({ email: 'tabs@test.local', password: PASSWORD });

      expect(loginRes.status).toBe(200);
    });

    it('repeats cleanly across many iterations (the original bug was intermittent, not deterministic)', async () => {
      for (let i = 0; i < 10; i += 1) {
        const tabA = request.agent(app);
        const tabB = request.agent(app);
        const [resA, resB] = await Promise.all([tabA.get('/health'), tabB.get('/health')]);
        expect(extractCookie(resA, 'csrf_token')).toBe(extractCookie(resB, 'csrf_token'));
      }
    });
  });

  describe('5. Login rotates the CSRF token', () => {
    it('issues a new token on successful login, different from the pre-login token, and the old one no longer validates', async () => {
      await createTestUser({ email: 'rotate-login@test.local', password: PASSWORD, roleCode: 'TEST_ROLE_CSRF' });

      const agent = request.agent(app);
      const preLoginRes = await agent.get('/health');
      const preLoginToken = extractCookie(preLoginRes, 'csrf_token')!;

      const loginRes = await agent
        .post('/api/v1/auth/login')
        .set('x-csrf-token', preLoginToken)
        .send({ email: 'rotate-login@test.local', password: PASSWORD });
      expect(loginRes.status).toBe(200);

      const postLoginToken = extractCookie(loginRes, 'csrf_token');
      expect(postLoginToken).toBeTruthy();
      expect(postLoginToken).not.toBe(preLoginToken);
      expect(loginRes.headers['x-csrf-token']).toBe(postLoginToken);

      // The pre-login token is now stale — the cookie jar holds the rotated value, so replaying
      // the old header no longer matches it.
      const staleRes = await agent
        .patch('/api/v1/auth/me')
        .set('x-csrf-token', preLoginToken)
        .send({ name: 'Should Not Apply' });
      expect(staleRes.status).toBe(403);

      // The rotated token works normally.
      const freshRes = await agent
        .patch('/api/v1/auth/me')
        .set('x-csrf-token', postLoginToken!)
        .send({ name: 'Rotated Token Works' });
      expect(freshRes.status).toBe(200);
    });
  });

  describe('6. Logout rotates the CSRF token', () => {
    it('issues a new token on the logout response itself', async () => {
      const { agent, csrfToken } = await createAuthenticatedAgent(app, {
        email: 'rotate-logout@test.local',
        password: PASSWORD,
        roleCode: ROLE_CODES.PAYROLL_STAFF,
        permissionKeys: [],
      });

      const logoutRes = await agent.post('/api/v1/auth/logout').set('x-csrf-token', csrfToken);
      expect(logoutRes.status).toBe(204);

      const rotatedToken = extractCookie(logoutRes, 'csrf_token');
      expect(rotatedToken).toBeTruthy();
      expect(rotatedToken).not.toBe(csrfToken);
      expect(logoutRes.headers['x-csrf-token']).toBe(rotatedToken);
    });
  });

  describe('7. Password reset rotates the CSRF token', () => {
    it('self-service change-password rotates the token on the response that destroys the session', async () => {
      const { agent, csrfToken } = await createAuthenticatedAgent(app, {
        email: 'rotate-change-pw@test.local',
        password: PASSWORD,
        roleCode: ROLE_CODES.PAYROLL_STAFF,
        permissionKeys: [],
      });

      const changeRes = await agent
        .post('/api/v1/auth/change-password')
        .set('x-csrf-token', csrfToken)
        .send({ currentPassword: PASSWORD, newPassword: 'BrandNewPassword1!' });

      expect(changeRes.status).toBe(204);
      const rotatedToken = extractCookie(changeRes, 'csrf_token');
      expect(rotatedToken).toBeTruthy();
      expect(rotatedToken).not.toBe(csrfToken);
    });

    it("admin-triggered reset of the admin's own password rotates the token", async () => {
      const { agent, csrfToken, userId } = await createAuthenticatedAgent(app, {
        email: 'rotate-self-reset@test.local',
        password: PASSWORD,
        roleCode: ROLE_CODES.MASTER_ADMIN,
        permissionKeys: [PERMISSIONS.USERS_MANAGE],
      });

      const resetRes = await agent
        .post(`/api/v1/users/${userId}/reset-password`)
        .set('x-csrf-token', csrfToken)
        .send({ newPassword: 'BrandNewSelfPassword1!' });

      expect(resetRes.status).toBe(204);
      const rotatedToken = extractCookie(resetRes, 'csrf_token');
      expect(rotatedToken).toBeTruthy();
      expect(rotatedToken).not.toBe(csrfToken);
    });

    it("admin resetting someone else's password does not rotate the admin's own token", async () => {
      const { agent, csrfToken } = await createAuthenticatedAgent(app, {
        email: 'reset-other-admin@test.local',
        password: PASSWORD,
        roleCode: ROLE_CODES.MASTER_ADMIN,
        permissionKeys: [PERMISSIONS.USERS_MANAGE],
      });

      const target = await createTestUser({
        email: 'reset-other-target@test.local',
        password: PASSWORD,
        roleCode: 'TEST_ROLE_CSRF',
      });

      const resetRes = await agent
        .post(`/api/v1/users/${target.id}/reset-password`)
        .set('x-csrf-token', csrfToken)
        .send({ newPassword: 'BrandNewPassword1!' });
      expect(resetRes.status).toBe(204);
      expect(resetRes.headers['x-csrf-token']).toBeUndefined();

      // The admin's original token still works for a further authenticated request.
      const followUpRes = await agent.get('/api/v1/users').set('x-csrf-token', csrfToken);
      expect(followUpRes.status).toBe(200);
    });
  });

  describe('8. Token rotation is enforced, not just advisory', () => {
    it('rejects the pre-logout token on any state-changing request made after logout', async () => {
      const { agent, csrfToken } = await createAuthenticatedAgent(app, {
        email: 'rotate-enforced@test.local',
        password: PASSWORD,
        roleCode: ROLE_CODES.PAYROLL_STAFF,
        permissionKeys: [],
      });

      await agent.post('/api/v1/auth/logout').set('x-csrf-token', csrfToken);

      const res = await agent
        .patch('/api/v1/auth/me')
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Should Not Apply' });

      // Rejected — either by the now-mismatched CSRF token or by the destroyed session, but never
      // treated as a valid, authenticated mutation.
      expect([401, 403]).toContain(res.status);
    });
  });

  describe('9. CSRF mismatch still correctly returns 403', () => {
    it('rejects a state-changing request with a header that does not match the cookie', async () => {
      const agent = request.agent(app);
      await agent.get('/health');

      const res = await agent
        .post('/api/v1/auth/login')
        .set('x-csrf-token', 'not-the-real-token')
        .send({ email: 'nobody@test.local', password: PASSWORD });

      expect(res.status).toBe(403);
    });

    it('rejects a state-changing request with no CSRF header at all', async () => {
      const agent = request.agent(app);
      await agent.get('/health');

      const res = await agent.post('/api/v1/auth/login').send({ email: 'nobody@test.local', password: PASSWORD });

      expect(res.status).toBe(403);
    });
  });

  describe('10. Unauthenticated requests still behave correctly', () => {
    it('still issues a token pair to an unauthenticated client on a safe request', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
      expect(res.headers['x-csrf-token']).toBeTruthy();
    });

    it('still rejects an unauthenticated state-changing request lacking a valid CSRF pair', async () => {
      const res = await request(app).post('/api/v1/auth/logout');
      expect(res.status).toBe(403);
    });

    it('applies CSRF before authentication — a valid CSRF pair with no session still fails with 401, not a CSRF error', async () => {
      const agent = request.agent(app);
      const primeRes = await agent.get('/health');
      const token = extractCookie(primeRes, 'csrf_token')!;

      const res = await agent.patch('/api/v1/auth/me').set('x-csrf-token', token).send({ name: 'Nope' });
      expect(res.status).toBe(401);
    });
  });
});
