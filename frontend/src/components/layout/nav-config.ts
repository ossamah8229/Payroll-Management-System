import type { LucideIcon } from 'lucide-react';
import { Banknote, Building2, ClipboardList, Landmark, LayoutDashboard, UserCog, Users } from 'lucide-react';
import type { PermissionKey } from '@payroll/shared';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Hidden from the sidebar (and, separately, still enforced server-side) unless present. */
  requiredPermission?: PermissionKey;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

/**
 * The navigation shell's data (docs/design-system.md §2.1: sidebar "grouped into labeled sections
 * — Overview / Payroll / Employees / Admin"). Each later phase appends its own items to the
 * relevant section here as it's built, rather than the shell being rebuilt per phase. Hiding a nav
 * item by `requiredPermission` is a UX convenience only — the same permission is independently
 * enforced server-side on every route (Sidebar never being the actual access control).
 */
export const navSections: NavSection[] = [
  {
    label: 'Overview',
    items: [{ label: 'Dashboard', to: '/', icon: LayoutDashboard }],
  },
  {
    label: 'Payroll',
    items: [
      { label: 'Payroll Entry', to: '/payroll-entry', icon: ClipboardList, requiredPermission: 'payroll:entry' },
      { label: 'Salary Release', to: '/release', icon: Banknote, requiredPermission: 'payroll:view' },
      { label: 'Bank Sheet', to: '/bank-sheet', icon: Landmark, requiredPermission: 'bank-sheets:view' },
    ],
  },
  {
    label: 'Employees',
    items: [
      { label: 'Employee Registry', to: '/employees', icon: Users, requiredPermission: 'employees:view' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { label: 'Project Sites', to: '/sites', icon: Building2, requiredPermission: 'sites:manage' },
      { label: 'Users', to: '/users', icon: UserCog, requiredPermission: 'users:manage' },
    ],
  },
];
