import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

/**
 * Regression coverage for the malformed-UUID-route-param security correction (docs/
 * PROJECT_PROGRESS.md, Post-Phase-5 Stabilization Checkpoint 1). Every id column in this schema is
 * `@db.Uuid` (backend/prisma/schema.prisma), so a route param that isn't a well-formed UUID never
 * reaches a business-logic branch — it fails at the Postgres driver itself, which Prisma surfaces
 * as `P2023`. Before this correction that fell through `error-handler.ts`'s generic 500 branch,
 * returning `INTERNAL_ERROR` and, in non-production, the raw Prisma error message (including
 * absolute filesystem paths). The fix lives once in `error-handler.ts` (P2023 → 400
 * VALIDATION_ERROR) rather than duplicated as UUID-shape validation in every module's own
 * `requireIdParam` helper, so this file deliberately exercises several unrelated modules to prove
 * the single shared fix, not a per-route one.
 */
describe('Malformed UUID route params return 400, not 500', () => {
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
      permissionKeys: [
        PERMISSIONS.EMPLOYEES_VIEW,
        PERMISSIONS.SITES_MANAGE,
        PERMISSIONS.USERS_MANAGE,
        PERMISSIONS.PAYROLL_CYCLE_MANAGE,
        PERMISSIONS.PAYROLL_ENTRY,
      ],
    });
  }

  it.each([
    ['GET', '/api/v1/employees/not-a-uuid'],
    ['GET', '/api/v1/sites/not-a-uuid'],
    ['GET', '/api/v1/users/not-a-uuid'],
    ['GET', '/api/v1/payroll-cycles/not-a-uuid'],
    ['GET', '/api/v1/backup-packages/not-a-uuid'],
  ])('%s %s responds 400 VALIDATION_ERROR, never 500', async (method, path) => {
    const { agent } = await masterAdminAgent(`malformed-uuid-${path.replace(/\W/g, '-')}@test.local`);

    const res = await (method === 'GET' ? agent.get(path) : agent.post(path));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('never leaks a raw Prisma error message or a filesystem path in the response body', async () => {
    const { agent } = await masterAdminAgent('malformed-uuid-leak-check@test.local');

    const res = await agent.get('/api/v1/employees/not-a-uuid');

    const body = JSON.stringify(res.body);
    expect(body).not.toContain('PrismaClientKnownRequestError');
    expect(body).not.toContain('/backend/src');
    expect(body).not.toMatch(/\/Users\/|\/var\/|\/home\//);
  });
});
