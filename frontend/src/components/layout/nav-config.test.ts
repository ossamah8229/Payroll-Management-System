import { describe, expect, it } from 'vitest';
import type { SessionUser } from '@payroll/shared';
import { isNavItemVisible, navSections, type NavItem } from './nav-config';

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

function correctionsNavItem(): NavItem {
  const item = navSections.flatMap((section) => section.items).find((navItem) => navItem.to === '/corrections');
  if (!item) throw new Error('Corrections nav item not found in navSections');
  return item;
}

describe('isNavItemVisible', () => {
  it('is always visible when no permission is required', () => {
    expect(isNavItemVisible({ label: 'Dashboard', to: '/', icon: navSections[0]!.items[0]!.icon }, fakeUser([]))).toBe(
      true,
    );
  });

  it('is visible when the user holds a single required permission', () => {
    const item: NavItem = { label: 'X', to: '/x', icon: navSections[0]!.items[0]!.icon, requiredPermission: 'sites:manage' };
    expect(isNavItemVisible(item, fakeUser(['sites:manage']))).toBe(true);
  });

  it('is hidden when the user lacks a single required permission', () => {
    const item: NavItem = { label: 'X', to: '/x', icon: navSections[0]!.items[0]!.icon, requiredPermission: 'sites:manage' };
    expect(isNavItemVisible(item, fakeUser(['payroll:entry']))).toBe(false);
  });

  // --- Corrections sidebar entry (Phase 6 Checkpoint 6A regression coverage) ------------------
  // Checkpoint 6 originally gated this item on `payroll:entry` alone, hiding it from a reviewer
  // holding only `corrections:approve` even though the Review Queue itself is authorized for
  // exactly that permission. These four cases pin the corrected OR rule.

  describe('the Corrections sidebar item', () => {
    it('is visible for payroll:entry only', () => {
      expect(isNavItemVisible(correctionsNavItem(), fakeUser(['payroll:entry']))).toBe(true);
    });

    it('is visible for corrections:approve only', () => {
      expect(isNavItemVisible(correctionsNavItem(), fakeUser(['corrections:approve']))).toBe(true);
    });

    it('is visible when both permissions are held', () => {
      expect(isNavItemVisible(correctionsNavItem(), fakeUser(['payroll:entry', 'corrections:approve']))).toBe(true);
    });

    it('is hidden when neither permission is held', () => {
      expect(isNavItemVisible(correctionsNavItem(), fakeUser(['payslips:view']))).toBe(false);
    });
  });
});
