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
});
