import request from 'supertest';
import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent, createTestUser, extractCookie } from './helpers';

const app = createApp();

const PASSWORD = 'CorrectHorseBattery1!';

/**
 * Checkpoint 4D correction — regression coverage for the corrected, stateless CSRF design.
 *
 * The original Checkpoint 4D fix (an in-memory map coalescing concurrent "no cookie yet" requests,
 * keyed by `req.ip`) was rejected on review: `req.ip` is not a browser identity (unrelated clients
 * can share one IP behind a NAT/proxy), and a process-local map cannot guarantee correctness once
 * more than one backend instance exists. The corrected design (`backend/src/common/middleware/
 * csrf.ts`) removes that map entirely — `issueCsrfCookie` is back to the simplest stateless rule
 * (mint if absent, echo on safe methods) — and instead relies on the frontend's own one-shot
 * recovery (`frontend/src/lib/api-client.ts`, covered by `frontend/src/lib/api-client.test.ts`) for
 * the rare case a genuine mismatch occurs. This file proves the backend half: normal validation is
 * unweakened, there is no IP-based coupling of any kind, and the recovery endpoint
 * (`GET /api/v1/csrf-token`) behaves exactly like every other safe request already did.
 */
describe('CSRF: stateless design and token rotation (Checkpoint 4D correction)', () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  describe('1. Normal double-submit validation', () => {
    it('accepts a state-changing request whose header matches its cookie', async () => {
      const agent = request.agent(app);
      const primeRes = await agent.get('/health');
      const token = extractCookie(primeRes, 'csrf_token')!;

      const res = await agent
        .post('/api/v1/auth/login')
        .set('x-csrf-token', token)
        .send({ email: 'nobody@test.local', password: PASSWORD });

      // 401 (invalid credentials), not 403 — proves the CSRF check itself passed.
      expect(res.status).toBe(401);
    });
  });

  describe('2. Mismatch still returns 403 with the CSRF_TOKEN_MISMATCH code', () => {
    it('rejects a header that does not match the cookie', async () => {
      const agent = request.agent(app);
      await agent.get('/health');

      const res = await agent
        .post('/api/v1/auth/login')
        .set('x-csrf-token', 'not-the-real-token')
        .send({ email: 'nobody@test.local', password: PASSWORD });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CSRF_TOKEN_MISMATCH');
    });

    it('rejects a request with no CSRF header at all', async () => {
      const agent = request.agent(app);
      await agent.get('/health');

      const res = await agent.post('/api/v1/auth/login').send({ email: 'nobody@test.local', password: PASSWORD });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CSRF_TOKEN_MISMATCH');
    });

    it('rejects a request with no cookie at all, even with a header', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('x-csrf-token', 'anything')
        .send({ email: 'nobody@test.local', password: PASSWORD });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CSRF_TOKEN_MISMATCH');
    });
  });

  describe('3. GET /api/v1/csrf-token — the frontend recovery endpoint', () => {
    it('echoes the exact token already bound to the request\'s existing cookie, not a new one', async () => {
      const agent = request.agent(app);
      const primeRes = await agent.get('/health');
      const originalToken = extractCookie(primeRes, 'csrf_token')!;

      const res = await agent.get('/api/v1/csrf-token');

      expect(res.status).toBe(204);
      expect(res.headers['x-csrf-token']).toBe(originalToken);
      // No new Set-Cookie — the existing cookie is left exactly as it was.
      expect(extractCookie(res, 'csrf_token')).toBeUndefined();
    });

    it('mints a token normally when the request carries no cookie yet', async () => {
      const res = await request(app).get('/api/v1/csrf-token');

      expect(res.status).toBe(204);
      const mintedCookie = extractCookie(res, 'csrf_token');
      expect(mintedCookie).toBeTruthy();
      expect(res.headers['x-csrf-token']).toBe(mintedCookie);
    });

    it('is a safe, unauthenticated, dependency-free endpoint — behaves the same with or without a session', async () => {
      const res = await request(app).get('/api/v1/csrf-token');
      expect(res.status).toBe(204);
      // No `error` body, no session/auth requirement — this must work on the login page itself,
      // before any credentials exist.
      expect(res.body).toEqual({});
    });
  });

  describe('4. No IP-based sharing exists', () => {
    it('two unrelated cookie-less requests from the same simulated IP mint independent, different tokens', async () => {
      // `app.set('trust proxy', 1)` (app.ts) means req.ip reflects X-Forwarded-For — simulating
      // two different real browsers/users behind one shared NAT/corporate egress, the exact case
      // the rejected IP-keyed design would have incorrectly coupled together.
      const sharedIp = '203.0.113.5';

      const resA = await request(app).get('/health').set('X-Forwarded-For', sharedIp);
      const resB = await request(app).get('/health').set('X-Forwarded-For', sharedIp);

      const tokenA = extractCookie(resA, 'csrf_token');
      const tokenB = extractCookie(resB, 'csrf_token');

      expect(tokenA).toBeTruthy();
      expect(tokenB).toBeTruthy();
      expect(tokenA).not.toBe(tokenB);
    });

    it('remains independent across many sequential cookie-less requests sharing one simulated IP (no map-based reuse over time)', async () => {
      const sharedIp = '198.51.100.9';
      const tokens = new Set<string | undefined>();

      for (let i = 0; i < 5; i += 1) {
        const res = await request(app).get('/health').set('X-Forwarded-For', sharedIp);
        tokens.add(extractCookie(res, 'csrf_token'));
      }

      expect(tokens.size).toBe(5);
    });
  });

  describe('5. Two unrelated clients with the same simulated IP do not become logically coupled', () => {
    it("client A's token never validates against client B's cookie, despite sharing an IP", async () => {
      const sharedIp = '192.0.2.77';

      const clientA = request.agent(app);
      const clientB = request.agent(app);

      const resA = await clientA.get('/health').set('X-Forwarded-For', sharedIp);
      const resB = await clientB.get('/health').set('X-Forwarded-For', sharedIp);
      const tokenA = extractCookie(resA, 'csrf_token')!;
      const tokenB = extractCookie(resB, 'csrf_token')!;
      expect(tokenA).not.toBe(tokenB);

      // Client B's own cookie jar never has tokenA — sending it as the header must fail, even
      // though both clients share the same simulated IP.
      const crossRes = await clientB
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', sharedIp)
        .set('x-csrf-token', tokenA)
        .send({ email: 'nobody@test.local', password: PASSWORD });

      expect(crossRes.status).toBe(403);
      expect(crossRes.body.error.code).toBe('CSRF_TOKEN_MISMATCH');
    });
  });

  describe('6. Behavior is not dependent on one process-local map', () => {
    it('two freshly created app instances (simulating separate backend processes) issue independent tokens with no shared state', async () => {
      // createApp() a second time — as close as a single-process test suite can get to modeling
      // "a second backend instance" — proves nothing module-global is coordinating token values
      // across requests beyond the per-request cookie/header comparison itself.
      const otherApp = createApp();

      const resA = await request(app).get('/health');
      const resB = await request(otherApp).get('/health');

      expect(extractCookie(resA, 'csrf_token')).not.toBe(extractCookie(resB, 'csrf_token'));
    });
  });

  describe('7. Rotation returns the new token consistently', () => {
    it('login rotates the token, and the rotated value is what the response actually echoes', async () => {
      await createTestUser({ email: 'rotate-login@test.local', password: PASSWORD, roleCode: 'TEST_ROLE_CSRF' });

      const agent = request.agent(app);
      const preLoginToken = extractCookie(await agent.get('/health'), 'csrf_token')!;

      const loginRes = await agent
        .post('/api/v1/auth/login')
        .set('x-csrf-token', preLoginToken)
        .send({ email: 'rotate-login@test.local', password: PASSWORD });
      expect(loginRes.status).toBe(200);

      const rotatedCookie = extractCookie(loginRes, 'csrf_token');
      expect(rotatedCookie).toBeTruthy();
      expect(rotatedCookie).not.toBe(preLoginToken);
      // The header on *this same response* is exactly the rotated cookie value — the frontend's
      // captureCsrfToken reads this header on every response, so it can never observe a cookie/
      // header mismatch at the moment of rotation.
      expect(loginRes.headers['x-csrf-token']).toBe(rotatedCookie);

      // And the rotated value actually works for the very next request.
      const nextRes = await agent.patch('/api/v1/auth/me').set('x-csrf-token', rotatedCookie!).send({ name: 'X' });
      expect(nextRes.status).toBe(200);
    });

    it('logout rotates the token', async () => {
      const { agent, csrfToken } = await createAuthenticatedAgent(app, {
        email: 'rotate-logout@test.local',
        password: PASSWORD,
        roleCode: ROLE_CODES.PAYROLL_STAFF,
        permissionKeys: [],
      });

      const logoutRes = await agent.post('/api/v1/auth/logout').set('x-csrf-token', csrfToken);
      expect(logoutRes.status).toBe(204);
      const rotated = extractCookie(logoutRes, 'csrf_token');
      expect(rotated).toBeTruthy();
      expect(rotated).not.toBe(csrfToken);
      expect(logoutRes.headers['x-csrf-token']).toBe(rotated);
    });

    it('self-service change-password rotates the token', async () => {
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
      const rotated = extractCookie(changeRes, 'csrf_token');
      expect(rotated).toBeTruthy();
      expect(rotated).not.toBe(csrfToken);
    });

    it("admin resetting their own password rotates the token; resetting someone else's does not", async () => {
      const { agent, csrfToken, userId } = await createAuthenticatedAgent(app, {
        email: 'rotate-self-reset@test.local',
        password: PASSWORD,
        roleCode: ROLE_CODES.MASTER_ADMIN,
        permissionKeys: [PERMISSIONS.USERS_MANAGE],
      });

      const target = await createTestUser({
        email: 'reset-other-target@test.local',
        password: PASSWORD,
        roleCode: 'TEST_ROLE_CSRF',
      });

      const otherResetRes = await agent
        .post(`/api/v1/users/${target.id}/reset-password`)
        .set('x-csrf-token', csrfToken)
        .send({ newPassword: 'BrandNewPassword1!' });
      expect(otherResetRes.status).toBe(204);
      expect(otherResetRes.headers['x-csrf-token']).toBeUndefined();

      // The admin's own token still works after resetting someone else's password.
      const followUpRes = await agent.get('/api/v1/users').set('x-csrf-token', csrfToken);
      expect(followUpRes.status).toBe(200);

      const selfResetRes = await agent
        .post(`/api/v1/users/${userId}/reset-password`)
        .set('x-csrf-token', csrfToken)
        .send({ newPassword: 'BrandNewSelfPassword1!' });
      expect(selfResetRes.status).toBe(204);
      const rotated = extractCookie(selfResetRes, 'csrf_token');
      expect(rotated).toBeTruthy();
      expect(rotated).not.toBe(csrfToken);
    });
  });

  describe('8. Login/logout/password-change flows remain valid end to end', () => {
    it('logs in, changes password, and logs back in with the new password — all real HTTP calls', async () => {
      await createTestUser({ email: 'flow@test.local', password: PASSWORD, roleCode: 'TEST_ROLE_CSRF' });

      const agent = request.agent(app);
      const token1 = extractCookie(await agent.get('/health'), 'csrf_token')!;
      const loginRes = await agent
        .post('/api/v1/auth/login')
        .set('x-csrf-token', token1)
        .send({ email: 'flow@test.local', password: PASSWORD });
      expect(loginRes.status).toBe(200);

      const token2 = extractCookie(loginRes, 'csrf_token')!;
      const changeRes = await agent
        .post('/api/v1/auth/change-password')
        .set('x-csrf-token', token2)
        .send({ currentPassword: PASSWORD, newPassword: 'BrandNewPassword1!' });
      expect(changeRes.status).toBe(204);

      const freshAgent = request.agent(app);
      const token3 = extractCookie(await freshAgent.get('/health'), 'csrf_token')!;
      const secondLoginRes = await freshAgent
        .post('/api/v1/auth/login')
        .set('x-csrf-token', token3)
        .send({ email: 'flow@test.local', password: 'BrandNewPassword1!' });
      expect(secondLoginRes.status).toBe(200);
    });
  });

  describe('9. No general-purpose automatic retry exists on the backend', () => {
    it('a mismatched request is rejected outright — the backend never itself retries, coalesces, or waits for a matching request', async () => {
      const agent = request.agent(app);
      await agent.get('/health');

      const start = Date.now();
      const res = await agent
        .post('/api/v1/auth/login')
        .set('x-csrf-token', 'definitely-wrong')
        .send({ email: 'nobody@test.local', password: PASSWORD });
      const elapsedMs = Date.now() - start;

      expect(res.status).toBe(403);
      // A generous bound, not a tight timing assertion — this only needs to rule out the backend
      // itself pausing/retrying/waiting on anything before responding.
      expect(elapsedMs).toBeLessThan(2000);
    });

    it('unauthenticated requests still behave correctly', async () => {
      const meRes = await request(app).get('/api/v1/auth/me');
      expect(meRes.status).toBe(401);
      expect(meRes.headers['x-csrf-token']).toBeTruthy();

      const logoutRes = await request(app).post('/api/v1/auth/logout');
      expect(logoutRes.status).toBe(403);
      expect(logoutRes.body.error.code).toBe('CSRF_TOKEN_MISMATCH');
    });

    it('applies CSRF before authentication — a valid CSRF pair with no session still fails with 401, not a CSRF error', async () => {
      const agent = request.agent(app);
      const token = extractCookie(await agent.get('/health'), 'csrf_token')!;

      const res = await agent.patch('/api/v1/auth/me').set('x-csrf-token', token).send({ name: 'Nope' });
      expect(res.status).toBe(401);
    });
  });
});
