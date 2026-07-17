import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createTestUser, extractCookie } from './helpers';

const app = createApp();

const PASSWORD = 'CorrectHorseBattery1!';

describe('Authentication', () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  /**
   * Every state-changing request needs a CSRF cookie/header pair first
   * (src/common/middleware/csrf.ts). A GET request is enough to receive the cookie — this
   * mirrors exactly what a real frontend does on first load.
   */
  async function primeCsrf(agent: ReturnType<typeof request.agent>) {
    const res = await agent.get('/health');
    const csrfToken = extractCookie(res, 'csrf_token');
    if (!csrfToken) throw new Error('Expected /health to issue a csrf_token cookie');
    return csrfToken;
  }

  it('rejects login for a nonexistent user without revealing that it was the email that was wrong', async () => {
    const agent = request.agent(app);
    const csrfToken = await primeCsrf(agent);

    const res = await agent
      .post('/api/v1/auth/login')
      .set('x-csrf-token', csrfToken)
      .send({ email: 'nobody@test.local', password: PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects a POST without a matching CSRF header', async () => {
    const agent = request.agent(app);
    await primeCsrf(agent);

    const res = await agent
      .post('/api/v1/auth/login')
      .send({ email: 'someone@test.local', password: PASSWORD });

    expect(res.status).toBe(403);
  });

  it('logs a failed login attempt to the audit log', async () => {
    await createTestUser({ email: 'known@test.local', password: PASSWORD, roleCode: 'TEST_ROLE_AUTH' });

    const agent = request.agent(app);
    const csrfToken = await primeCsrf(agent);

    await agent
      .post('/api/v1/auth/login')
      .set('x-csrf-token', csrfToken)
      .send({ email: 'known@test.local', password: 'wrong-password' });

    const entries = await prisma.auditLog.findMany({ where: { action: 'auth.login.failed' } });
    expect(entries.some((entry) => (entry.metadata as { email?: string })?.email === 'known@test.local')).toBe(
      true,
    );
  });

  it('logs in successfully with correct credentials and establishes a session', async () => {
    await createTestUser({ email: 'valid@test.local', password: PASSWORD, roleCode: 'TEST_ROLE_AUTH' });

    const agent = request.agent(app);
    const csrfToken = await primeCsrf(agent);

    const loginRes = await agent
      .post('/api/v1/auth/login')
      .set('x-csrf-token', csrfToken)
      .send({ email: 'valid@test.local', password: PASSWORD });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.email).toBe('valid@test.local');

    const meRes = await agent.get('/api/v1/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe('valid@test.local');
  });

  it('rejects GET /me without a session', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('ends the session on logout, so a subsequent /me fails', async () => {
    await createTestUser({ email: 'logout@test.local', password: PASSWORD, roleCode: 'TEST_ROLE_AUTH' });

    const agent = request.agent(app);
    const csrfToken = await primeCsrf(agent);

    await agent
      .post('/api/v1/auth/login')
      .set('x-csrf-token', csrfToken)
      .send({ email: 'logout@test.local', password: PASSWORD });

    const logoutRes = await agent.post('/api/v1/auth/logout').set('x-csrf-token', csrfToken);
    expect(logoutRes.status).toBe(204);

    const meRes = await agent.get('/api/v1/auth/me');
    expect(meRes.status).toBe(401);
  });

  it(
    'invalidates an existing session immediately when the user is deactivated — ' +
      'the specific reason server-side sessions were chosen over stateless JWTs',
    async () => {
      const user = await createTestUser({
        email: 'deactivate@test.local',
        password: PASSWORD,
        roleCode: 'TEST_ROLE_AUTH',
      });

      const agent = request.agent(app);
      const csrfToken = await primeCsrf(agent);

      await agent
        .post('/api/v1/auth/login')
        .set('x-csrf-token', csrfToken)
        .send({ email: 'deactivate@test.local', password: PASSWORD });

      expect((await agent.get('/api/v1/auth/me')).status).toBe(200);

      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

      const meRes = await agent.get('/api/v1/auth/me');
      expect(meRes.status).toBe(401);
    },
  );

  describe('AUD-009: session revocation on self-service password change', () => {
    async function loginAgent(email: string, password: string) {
      const agent = request.agent(app);
      const csrfToken = await primeCsrf(agent);
      const res = await agent
        .post('/api/v1/auth/login')
        .set('x-csrf-token', csrfToken)
        .send({ email, password });
      if (res.status !== 200) {
        throw new Error(`Test login failed with status ${res.status}: ${JSON.stringify(res.body)}`);
      }
      return { agent, csrfToken };
    }

    it(
      'invalidates the current session, a second browser session for the same user, ' +
        'leaves other users authenticated, and requires the new password to log back in',
      async () => {
        await createTestUser({ email: 'reset-self@test.local', password: PASSWORD, roleCode: 'TEST_ROLE_AUTH' });
        await createTestUser({ email: 'unrelated@test.local', password: PASSWORD, roleCode: 'TEST_ROLE_AUTH' });

        // Two independent "browser" sessions for the same user, plus one for an unrelated user.
        const sessionA = await loginAgent('reset-self@test.local', PASSWORD);
        const sessionB = await loginAgent('reset-self@test.local', PASSWORD);
        const unrelated = await loginAgent('unrelated@test.local', PASSWORD);

        expect((await sessionA.agent.get('/api/v1/auth/me')).status).toBe(200);
        expect((await sessionB.agent.get('/api/v1/auth/me')).status).toBe(200);
        expect((await unrelated.agent.get('/api/v1/auth/me')).status).toBe(200);

        const changeRes = await sessionA.agent
          .post('/api/v1/auth/change-password')
          .set('x-csrf-token', sessionA.csrfToken)
          .send({ currentPassword: PASSWORD, newPassword: 'BrandNewPassword1!' });
        expect(changeRes.status).toBe(204);

        // Current session (the one that made the change-password request) is invalidated.
        expect((await sessionA.agent.get('/api/v1/auth/me')).status).toBe(401);
        // A second, independent browser session for the same user is also invalidated.
        expect((await sessionB.agent.get('/api/v1/auth/me')).status).toBe(401);
        // An unrelated user's session is untouched.
        expect((await unrelated.agent.get('/api/v1/auth/me')).status).toBe(200);

        // Old password no longer works.
        const oldPasswordAgent = request.agent(app);
        const oldPasswordCsrf = await primeCsrf(oldPasswordAgent);
        const oldLoginRes = await oldPasswordAgent
          .post('/api/v1/auth/login')
          .set('x-csrf-token', oldPasswordCsrf)
          .send({ email: 'reset-self@test.local', password: PASSWORD });
        expect(oldLoginRes.status).toBe(401);

        // New password logs in successfully.
        const freshAgent = request.agent(app);
        const freshCsrf = await primeCsrf(freshAgent);
        const newLoginRes = await freshAgent
          .post('/api/v1/auth/login')
          .set('x-csrf-token', freshCsrf)
          .send({ email: 'reset-self@test.local', password: 'BrandNewPassword1!' });
        expect(newLoginRes.status).toBe(200);

        // Audit behavior unchanged: exactly one password-changed entry for this user.
        const user = await prisma.user.findUniqueOrThrow({ where: { email: 'reset-self@test.local' } });
        const entries = await prisma.auditLog.findMany({
          where: { action: 'user.password-changed', entityId: user.id },
        });
        expect(entries).toHaveLength(1);
        expect(entries[0]!.actorUserId).toBe(user.id);
      },
    );
  });
});
