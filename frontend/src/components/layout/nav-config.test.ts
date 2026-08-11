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

function statementsNavItem(): NavItem {
  const item = navSections.flatMap((section) => section.items).find((navItem) => navItem.to === '/statements');
  if (!item) throw new Error('Statements nav item not found in navSections');
  return item;
}

function reportsNavItem(): NavItem {
  const item = navSections.flatMap((section) => section.items).find((navItem) => navItem.to === '/reports');
  if (!item) throw new Error('Reports nav item not found in navSections');
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

  // --- Statements sidebar entry (Phase 7A Checkpoint 2) ----------------------------------------
  // Gated on the dedicated statements:view permission, established by Checkpoint 1 — never
  // usable/visible without it, regardless of any other payroll permission held.

  describe('the Statements sidebar item', () => {
    it('requires the statements:view permission', () => {
      expect(statementsNavItem().requiredPermission).toBe('statements:view');
    });

    it('is visible when statements:view is held', () => {
      expect(isNavItemVisible(statementsNavItem(), fakeUser(['statements:view']))).toBe(true);
    });

    it('is hidden without statements:view, even for a user holding related payroll permissions', () => {
      expect(
        isNavItemVisible(statementsNavItem(), fakeUser(['payroll:entry', 'payroll:view', 'payslips:view', 'corrections:approve'])),
      ).toBe(false);
    });

    it('is hidden for a user with no permissions at all', () => {
      expect(isNavItemVisible(statementsNavItem(), fakeUser([]))).toBe(false);
    });
  });

  // --- Reports sidebar entry (Phase 8B Checkpoint 1; widened Checkpoint 1B, Salary Release Report)
  // Phase 8B Checkpoint 1 gated this item on the existing, previously-unused reports:view
  // permission (Phase 8A investigation report §11) alone. Checkpoint 1B widened it to an any-of
  // gate — reports:view OR payroll:view — so a Finance user (holds payroll:view, never
  // reports:view) has a normal, discoverable navigation path to the one report the catalogue now
  // admits them to (Salary Release Report), rather than needing a direct URL. These four cases pin
  // the corrected OR rule, mirroring the Corrections item's own regression coverage above.

  describe('the Reports sidebar item', () => {
    it('requires reports:view OR payroll:view', () => {
      expect(reportsNavItem().requiredPermission).toEqual(['reports:view', 'payroll:view']);
    });

    it('is visible for reports:view only', () => {
      expect(isNavItemVisible(reportsNavItem(), fakeUser(['reports:view']))).toBe(true);
    });

    it('is visible for payroll:view only (the Finance case — never reports:view)', () => {
      expect(isNavItemVisible(reportsNavItem(), fakeUser(['payroll:view']))).toBe(true);
    });

    it('is visible when both permissions are held', () => {
      expect(isNavItemVisible(reportsNavItem(), fakeUser(['reports:view', 'payroll:view']))).toBe(true);
    });

    it('is hidden without either admitting permission, even for a user holding unrelated payroll permissions', () => {
      expect(
        isNavItemVisible(reportsNavItem(), fakeUser(['payroll:entry', 'bank-sheets:view'])),
      ).toBe(false);
    });

    it('is hidden for a user with no permissions at all', () => {
      expect(isNavItemVisible(reportsNavItem(), fakeUser([]))).toBe(false);
    });
  });
});
