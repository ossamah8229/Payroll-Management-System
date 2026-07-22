import { describe, expect, it } from 'vitest';
import type { SessionUser } from '@payroll/shared';
import {
  canAccessCorrections,
  canRequestCorrection,
  canReviewCorrectionRequests,
  canViewCorrectionsLedger,
  defaultCorrectionsTab,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  isAuthorizedFor,
} from './permissions';

function fakeUser(permissions: SessionUser['permissions']): SessionUser {
  return {
    id: 'user-1',
    name: 'Test User',
    email: 'test@example.com',
    roleId: 'role-1',
    roleCode: 'PAYROLL_STAFF',
    roleName: 'Payroll Staff',
    permissions,
    siteIds: [],
    themeAccentColor: '#000000',
  };
}

describe('hasPermission', () => {
  it('is true when the user holds the permission', () => {
    expect(hasPermission(fakeUser(['payroll:entry']), 'payroll:entry')).toBe(true);
  });

  it('is false when the user does not hold the permission', () => {
    expect(hasPermission(fakeUser(['payroll:entry']), 'corrections:approve')).toBe(false);
  });
});

describe('hasAnyPermission', () => {
  it('is true when the user holds at least one of the listed permissions', () => {
    expect(hasAnyPermission(fakeUser(['corrections:approve']), ['payroll:entry', 'corrections:approve'])).toBe(true);
  });

  it('is false when the user holds none of the listed permissions', () => {
    expect(hasAnyPermission(fakeUser(['payslips:view']), ['payroll:entry', 'corrections:approve'])).toBe(false);
  });
});

describe('hasAllPermissions', () => {
  it('is true when the user holds every listed permission', () => {
    expect(hasAllPermissions(fakeUser(['payroll:entry', 'corrections:approve']), ['payroll:entry', 'corrections:approve'])).toBe(
      true,
    );
  });

  it('is false when the user is missing even one of the listed permissions', () => {
    expect(hasAllPermissions(fakeUser(['payroll:entry']), ['payroll:entry', 'corrections:approve'])).toBe(false);
  });
});

// --- RequirePermission's own authorization decision (Post-Phase-5 Stabilization Checkpoint 4B
// remediation) — this codebase's established convention is unit-testing the plain decision
// function, never rendering the guard component itself (vitest.config.ts: logic tests only).

describe('isAuthorizedFor', () => {
  it('is true when no requirement is given (session alone is enough), matching isNavItemVisible\'s own convention', () => {
    expect(isAuthorizedFor(fakeUser([]), {})).toBe(true);
  });

  it('is true when the user holds the single required permission', () => {
    expect(isAuthorizedFor(fakeUser(['sites:manage']), { permission: 'sites:manage' })).toBe(true);
  });

  it('is false when the user lacks the single required permission', () => {
    expect(isAuthorizedFor(fakeUser(['payroll:entry']), { permission: 'sites:manage' })).toBe(false);
  });

  it('any-of: is true when the user holds at least one permission in the array', () => {
    expect(
      isAuthorizedFor(fakeUser(['corrections:approve']), { permission: ['payroll:entry', 'corrections:approve'] }),
    ).toBe(true);
  });

  it('any-of: is false when the user holds none of the permissions in the array', () => {
    expect(isAuthorizedFor(fakeUser(['payslips:view']), { permission: ['payroll:entry', 'corrections:approve'] })).toBe(
      false,
    );
  });

  it('all-of: is true only when the user holds every permission in allOf', () => {
    expect(isAuthorizedFor(fakeUser(['payroll:entry', 'sites:manage']), { allOf: ['payroll:entry', 'sites:manage'] })).toBe(
      true,
    );
  });

  it('all-of: is false when the user is missing even one permission in allOf', () => {
    expect(isAuthorizedFor(fakeUser(['payroll:entry']), { allOf: ['payroll:entry', 'sites:manage'] })).toBe(false);
  });

  it('prefers allOf over permission when both are somehow provided', () => {
    expect(
      isAuthorizedFor(fakeUser(['payroll:entry']), { permission: 'payroll:entry', allOf: ['payroll:entry', 'sites:manage'] }),
    ).toBe(false);
  });
});

// --- Corrections domain (Phase 6 Checkpoint 6A) -----------------------------------------------
// A reviewer holding only corrections:approve (no payroll:entry) must resolve identically to a
// requester holding only payroll:entry (no corrections:approve) for every "view" predicate below —
// that parity is the whole point of Checkpoint 6A's fix.

describe('canAccessCorrections', () => {
  it('is true for payroll:entry only', () => {
    expect(canAccessCorrections(fakeUser(['payroll:entry']))).toBe(true);
  });

  it('is true for corrections:approve only', () => {
    expect(canAccessCorrections(fakeUser(['corrections:approve']))).toBe(true);
  });

  it('is true when both permissions are held', () => {
    expect(canAccessCorrections(fakeUser(['payroll:entry', 'corrections:approve']))).toBe(true);
  });

  it('is false when neither permission is held', () => {
    expect(canAccessCorrections(fakeUser(['payslips:view']))).toBe(false);
  });
});

describe('canViewCorrectionsLedger', () => {
  it('is true for payroll:entry only', () => {
    expect(canViewCorrectionsLedger(fakeUser(['payroll:entry']))).toBe(true);
  });

  it('is true for corrections:approve only', () => {
    expect(canViewCorrectionsLedger(fakeUser(['corrections:approve']))).toBe(true);
  });

  it('is false when neither permission is held', () => {
    expect(canViewCorrectionsLedger(fakeUser([]))).toBe(false);
  });
});

describe('canReviewCorrectionRequests', () => {
  it('is true only with corrections:approve', () => {
    expect(canReviewCorrectionRequests(fakeUser(['corrections:approve']))).toBe(true);
  });

  it('is false with payroll:entry alone', () => {
    expect(canReviewCorrectionRequests(fakeUser(['payroll:entry']))).toBe(false);
  });
});

describe('canRequestCorrection', () => {
  it('is true only with payroll:entry', () => {
    expect(canRequestCorrection(fakeUser(['payroll:entry']))).toBe(true);
  });

  it('is false with corrections:approve alone', () => {
    expect(canRequestCorrection(fakeUser(['corrections:approve']))).toBe(false);
  });
});

describe('defaultCorrectionsTab', () => {
  it('lands a reviewer-only user (corrections:approve, no payroll:entry) on the Review Queue', () => {
    expect(defaultCorrectionsTab(fakeUser(['corrections:approve']))).toBe('queue');
  });

  it('lands a payroll-entry-only user on the Corrections Ledger, never the Review Queue', () => {
    expect(defaultCorrectionsTab(fakeUser(['payroll:entry']))).toBe('ledger');
  });

  it('lands a dual-permission user on the Review Queue (existing intended default)', () => {
    expect(defaultCorrectionsTab(fakeUser(['payroll:entry', 'corrections:approve']))).toBe('queue');
  });

  it('is null for a user with neither permission — no hidden or unauthorized default tab', () => {
    expect(defaultCorrectionsTab(fakeUser([]))).toBe(null);
  });
});
