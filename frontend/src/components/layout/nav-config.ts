import type { LucideIcon } from 'lucide-react';
import {
  Banknote,
  BookOpen,
  Building2,
  ClipboardList,
  FileBarChart,
  FileText,
  HandCoins,
  Landmark,
  LayoutDashboard,
  ScrollText,
  ShieldCheck,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react';
import type { PermissionKey, SessionUser } from '@payroll/shared';
import { hasAnyPermission } from '@/lib/permissions';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Hidden from the sidebar (and, separately, still enforced server-side) unless the user holds
   * this permission — or, given an array, at least one of them (OR semantics; e.g. Corrections:
   * payroll:entry OR corrections:approve, Phase 6 Checkpoint 6A). */
  requiredPermission?: PermissionKey | PermissionKey[];
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

/** True if `item` should be shown to `user` — no `requiredPermission` means always visible;
 * otherwise the user must hold it, or (given an array) at least one of them (OR semantics). Purely
 * a UX convenience, per `NavItem.requiredPermission`'s own doc comment above — never the actual
 * access control, which every route enforces independently server-side. */
export function isNavItemVisible(item: NavItem, user: SessionUser): boolean {
  if (!item.requiredPermission) return true;
  const required = Array.isArray(item.requiredPermission) ? item.requiredPermission : [item.requiredPermission];
  return hasAnyPermission(user, required);
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
    items: [
      {
        label: 'Dashboard',
        to: '/',
        icon: LayoutDashboard,
        // Dashboard Checkpoint 1B — gated `reports:view OR payroll:view` (the same any-of gate as
        // the route itself, App.tsx), the frozen Checkpoint 1A backend's own outer route gate
        // (`dashboard.routes.ts`). Widened from "always visible" (Phase 1 placeholder) now that the
        // page performs a real, permission-gated data fetch — a `statements:view`-only user (e.g.
        // no reports/payroll permission at all) must not see a Dashboard link that would 403.
        requiredPermission: ['reports:view', 'payroll:view'],
      },
    ],
  },
  {
    label: 'Payroll',
    items: [
      { label: 'Payroll Entry', to: '/payroll-entry', icon: ClipboardList, requiredPermission: 'payroll:entry' },
      {
        label: 'Advances',
        to: '/advances',
        icon: HandCoins,
        // Phase 4 Checkpoint 5 — Payroll Staff (site-scoped) and Master Admin only; Finance holds
        // no Advances permission (approved architecture decision, unchanged).
        requiredPermission: 'advances:manage',
      },
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
        label: 'Corrections',
        to: '/corrections',
        icon: ScrollText,
        // Phase 6 Checkpoint 6A — corrected from a single payroll:entry check (Checkpoint 6's
        // original gating). That gate assumed corrections:approve's only holder was Master Admin,
        // who already holds payroll:entry too — true today, but it left a reviewer holding
        // corrections:approve without payroll:entry unable to discover Corrections through the
        // sidebar at all, even though the Review Queue itself (and the backend route behind it)
        // is authorized for exactly that permission. Matches the backend's own
        // ENTRY_VIEW_PERMISSIONS/BALANCE_VIEW_PERMISSIONS convention: payroll:entry OR
        // corrections:approve. The page itself still branches its own in-page UI (Review Queue tab
        // hidden without corrections:approve) rather than relying on nav visibility alone.
        requiredPermission: ['payroll:entry', 'corrections:approve'],
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
        label: 'Statements',
        to: '/statements',
        icon: BookOpen,
        // Phase 7A Checkpoint 2 — a dedicated permission (statements:view), not a reuse of
        // payroll:view/payslips:view/corrections:approve: a Statement discloses one employee's
        // full cross-cycle financial history (salary outcomes, Corrections, Balance Adjustments,
        // Advances all together), materially more sensitive than any single-cycle document this
        // app already gates (Phase 7 architecture report, approved decision 8). Default-granted
        // like payslips:view (Master Admin, Payroll Staff, Finance) — see
        // shared/src/constants/permissions.ts.
        requiredPermission: 'statements:view',
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
    label: 'Reports',
    items: [
      {
        label: 'Reports',
        to: '/reports',
        icon: FileBarChart,
        // Phase 8B Checkpoint 1 introduced this item on the existing, previously-unused
        // `reports:view` permission (already seeded, already default-granted to Payroll Staff —
        // Phase 8A investigation report §11). Widened to an any-of gate in Checkpoint 1B (Salary
        // Release Report, `docs/architecture/workflows/reports.md` §20.1): Finance holds
        // `payroll:view` but never `reports:view`, and needs a normal, discoverable navigation path
        // to the one report the catalogue now admits them to (Salary Release Report) rather than
        // requiring knowledge of a direct URL. Mirrors the Corrections item's own established OR
        // pattern above. The catalogue page (`reports-page.tsx`) and every individual card still
        // independently gate on their own real requirement — this sidebar item only ever gets a
        // payroll:view-only user as far as the catalogue shell, exactly like the route itself.
        requiredPermission: ['reports:view', 'payroll:view'],
      },
    ],
  },
  {
    label: 'Admin',
    items: [
      { label: 'Project Sites', to: '/sites', icon: Building2, requiredPermission: 'sites:manage' },
      { label: 'Users', to: '/users', icon: UserCog, requiredPermission: 'users:manage' },
      // Administration & Security Management Phase 1 — role administration reuses users:manage
      // (roles.routes.ts's own documented decision: "who may administer users" and "who may
      // administer the roles those users hold" are the same governance responsibility here).
      { label: 'Roles & Permissions', to: '/roles', icon: ShieldCheck, requiredPermission: 'users:manage' },
    ],
  },
];
