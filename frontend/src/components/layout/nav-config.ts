import type { LucideIcon } from 'lucide-react';
import { LayoutDashboard } from 'lucide-react';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

/**
 * The navigation shell's data (docs/design-system.md §2.1: sidebar "grouped into labeled sections
 * — Overview / Payroll / Employees / Admin"). Phase 1 seeds only the one route that actually
 * exists; each later phase appends its own items to the relevant section here as it's built,
 * rather than the shell being rebuilt per phase.
 */
export const navSections: NavSection[] = [
  {
    label: 'Overview',
    items: [{ label: 'Dashboard', to: '/', icon: LayoutDashboard }],
  },
];
