import type { Request, Response } from 'express';
import type { SessionUser } from '@payroll/shared';
import { requirePermission } from '../src/common/middleware/require-permission';
import { requireSiteAccess } from '../src/common/middleware/require-site-access';
import { HttpError } from '../src/common/http-error';

function fakeUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: 'user-1',
    name: 'Test',
    email: 'test@test.local',
    roleId: 'role-1',
    roleCode: 'PAYROLL_STAFF',
    roleName: 'Payroll Staff',
    permissions: [],
    siteIds: [],
    themeAccentColor: '#1B4F72',
    ...overrides,
  };
}

function fakeRequest(currentUser?: SessionUser): Request {
  return { currentUser } as unknown as Request;
}

/**
 * Pure unit tests, no database or HTTP server involved — these exercise exactly the two RBAC
 * decision points documented in docs/architecture/authentication.md: "does this route check the
 * right permission" and "is this site one the user is assigned to."
 */
describe('requirePermission', () => {
  it('rejects an unauthenticated request with 401, before checking any permission', () => {
    const middleware = requirePermission('payroll:release');
    const next = jest.fn();

    middleware(fakeRequest(undefined), {} as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(HttpError));
    expect((next.mock.calls[0]?.[0] as HttpError).statusCode).toBe(401);
  });

  it('rejects an authenticated user who lacks the required permission with 403', () => {
    const middleware = requirePermission('payroll:release');
    const next = jest.fn();

    middleware(fakeRequest(fakeUser({ permissions: ['payroll:entry'] })), {} as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(HttpError));
    expect((next.mock.calls[0]?.[0] as HttpError).statusCode).toBe(403);
  });

  it('allows a user who holds the required permission through with no error', () => {
    const middleware = requirePermission('payroll:release');
    const next = jest.fn();

    middleware(fakeRequest(fakeUser({ permissions: ['payroll:release'] })), {} as Response, next);

    expect(next).toHaveBeenCalledWith();
  });
});

describe('requireSiteAccess', () => {
  const getSiteId = (req: Request) => (req as unknown as { params: { siteId?: string } }).params.siteId;

  function fakeRequestWithSite(currentUser: SessionUser | undefined, siteId?: string): Request {
    return { currentUser, params: { siteId } } as unknown as Request;
  }

  it('rejects an unauthenticated request', () => {
    const middleware = requireSiteAccess(getSiteId);
    const next = jest.fn();

    middleware(fakeRequestWithSite(undefined, 'site-1'), {} as Response, next);

    expect((next.mock.calls[0]?.[0] as HttpError).statusCode).toBe(401);
  });

  it('allows Master Admin through regardless of site assignments', () => {
    const middleware = requireSiteAccess(getSiteId);
    const next = jest.fn();
    const admin = fakeUser({ roleCode: 'MASTER_ADMIN', siteIds: [] });

    middleware(fakeRequestWithSite(admin, 'any-site-id'), {} as Response, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('rejects Payroll Staff for a site outside their assignment', () => {
    const middleware = requireSiteAccess(getSiteId);
    const next = jest.fn();
    const staff = fakeUser({ siteIds: ['site-a'] });

    middleware(fakeRequestWithSite(staff, 'site-b'), {} as Response, next);

    expect((next.mock.calls[0]?.[0] as HttpError).statusCode).toBe(403);
  });

  it('rejects Payroll Staff with no site assignments at all — empty siteIds never means "all sites"', () => {
    const middleware = requireSiteAccess(getSiteId);
    const next = jest.fn();
    const staff = fakeUser({ siteIds: [] });

    middleware(fakeRequestWithSite(staff, 'site-a'), {} as Response, next);

    expect((next.mock.calls[0]?.[0] as HttpError).statusCode).toBe(403);
  });

  it('allows Payroll Staff for a site they are assigned to', () => {
    const middleware = requireSiteAccess(getSiteId);
    const next = jest.fn();
    const staff = fakeUser({ siteIds: ['site-a', 'site-b'] });

    middleware(fakeRequestWithSite(staff, 'site-b'), {} as Response, next);

    expect(next).toHaveBeenCalledWith();
  });
});
