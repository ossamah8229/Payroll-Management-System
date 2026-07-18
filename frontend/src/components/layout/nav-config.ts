import type { LucideIcon } from 'lucide-react';
import {
  Banknote,
  Building2,
  ClipboardList,
  FileText,
  HandCoins,
  Landmark,
  LayoutDashboard,
  ScrollText,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react';
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
      {
        label: 'Cash Receiving',
        to: '/cash-receiving',
        icon: Wallet,
        // Reuses bank-sheets:view (approved architecture decision, Phase 4 Checkpoint 4) — Finance
        // and Master User already see both documents; Payroll Staff sees neither.
        requiredPermission: 'bank-sheets:view',
      },
      {
        label: 'Advances',
        to: '/advances',
        icon: HandCoins,
        // Phase 4 Checkpoint 5 — Payroll Staff (site-scoped) and Master Admin only; Finance holds
        // no Advances permission (approved architecture decision, unchanged).
        requiredPermission: 'advances:manage',
      },
      {
        label: 'Payslips',
        to: '/payslips',
        icon: FileText,
        // Phase 4 Checkpoint 6.1 — a dedicated permission, not a reuse of payroll:entry/
        // payroll:view/bank-sheets:view (approved architecture decision): an individual Payslip
        // is a materially more sensitive per-person disclosure than any aggregate sheet those
        // permissions gate. Granted to Master Admin, Payroll Staff, and Finance alike.
        requiredPermission: 'payslips:view',
      },
      {
        label: 'Corrections',
        to: '/corrections',
        icon: ScrollText,
        // Phase 6 Checkpoint 6 — gated on payroll:entry (Payroll Staff's own request/preview/view
        // permission, per the backend's own ENTRY_VIEW_PERMISSIONS/BALANCE_VIEW_PERMISSIONS
        // convention). corrections:approve is Master Admin only today, and Master Admin already
        // holds every permission including payroll:entry, so this single key covers every current
        // holder of either; the page itself still branches its own in-page UI (Review Queue tab
        // hidden without corrections:approve) rather than relying on nav visibility alone.
        requiredPermission: 'payroll:entry',
      },
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
