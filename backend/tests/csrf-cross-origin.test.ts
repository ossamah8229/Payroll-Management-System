import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, extractCookie } from './helpers';

const app = createApp();

/**
 * Covers the production-safe CSRF fix: frontend and backend are separate origins in production
 * (docs/architecture/deployment.md), so the frontend cannot read the `csrf_token` cookie via
 * `document.cookie` — the backend instead echoes the token in an `x-csrf-token` response header on
 * safe requests, CORS exposes that header to cross-origin JS, and (in production) the session/CSRF
 * cookies use `SameSite=None` so they actually reach the backend on a cross-*site* Render
 * deployment (docs/release/KNOWN_ISSUES_v1.0.md KI-2). See `docs/architecture/authentication.md`'s
 * CSRF Protection section for the full design this test file verifies.
 */
describe('Cross-origin CSRF token delivery', () => {
  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  it('echoes the CSRF cookie value in an x-csrf-token response header on a safe GET request', async () => {
    const res = await request(app).get('/health');
    const cookieToken = extractCookie(res, 'csrf_token');
    expect(cookieToken).toBeTruthy();
    expect(res.headers['x-csrf-token']).toBe(cookieToken);
  });

  it('still carries the x-csrf-token header on a safe request that itself errors (e.g. an unauthenticated 401)', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.headers['x-csrf-token']).toBeTruthy();
  });

  it('does not set the x-csrf-token header on a state-changing (non-safe) response', async () => {
    const agent = request.agent(app);
    const primeRes = await agent.get('/health');
    const csrfToken = extractCookie(primeRes, 'csrf_token')!;

    const res = await agent
      .post('/api/v1/auth/login')
      .set('x-csrf-token', csrfToken)
      .send({ email: 'nobody@test.local', password: 'irrelevant' });

    expect(res.headers['x-csrf-token']).toBeUndefined();
  });

  it('exposes the x-csrf-token response header to cross-origin frontend JS via CORS', async () => {
    // CORS_ORIGIN is set to http://localhost:5173 in the test environment (tests/env.setup.ts),
    // matching what a real browser sends as the Origin header on a cross-origin request.
    const res = await request(app).get('/health').set('Origin', 'http://localhost:5173');

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-expose-headers']).toContain('x-csrf-token');
  });

  describe('SameSite/Secure cookie attributes by environment', () => {
    const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    });

    it('uses SameSite=Lax without Secure outside production (matches the Vite dev-server proxy, which makes the two origins look same-origin)', async () => {
      const res = await request(app).get('/health');
      const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
      const csrfCookie = setCookie.find((c) => c.startsWith('csrf_token='));
      expect(csrfCookie).toBeTruthy();
      expect(csrfCookie!.toLowerCase()).toContain('samesite=lax');
      expect(csrfCookie!.toLowerCase()).not.toContain('secure');
    });

    it('uses SameSite=None with Secure in production, so the cookie survives a real cross-site Render deployment', async () => {
      let productionApp!: Express;

      jest.isolateModules(() => {
        process.env.NODE_ENV = 'production';
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        productionApp = (require('../src/app') as typeof import('../src/app')).createApp();
      });

      const res = await request(productionApp).get('/health');
      const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
      const csrfCookie = setCookie.find((c) => c.startsWith('csrf_token='));
      expect(csrfCookie).toBeTruthy();
      expect(csrfCookie!.toLowerCase()).toContain('samesite=none');
      expect(csrfCookie!.toLowerCase()).toContain('secure');
    });
  });
});
