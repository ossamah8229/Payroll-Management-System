import { FileBarChart } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PERMISSIONS, type PermissionKey, type SessionUser } from '@payroll/shared';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { hasAnyPermission } from '@/lib/permissions';

interface ReportCatalogueEntry {
  title: string;
  description: string;
  to: string;
  available: boolean;
  /**
   * Every entry's own real permission requirement, checked independently of this page's own
   * top-level gate (Checkpoint 1B, Salary Release Report — the page-level gate widened to `reports:
   * view OR payroll:view`, so an absent value can no longer be read as "no requirement beyond
   * whatever let the user onto this page"). Absent means "the ordinary `reports:view` requirement
   * every ordinary report shares" (`isCatalogueEntryVisible`'s own default) — every entry before
   * Salary Release Report reuses that default rather than repeating `PERMISSIONS.REPORTS_VIEW`
   * explicitly. Employee Payroll History is the one pre-existing exception, requiring
   * `statements:view` instead (approved decision 1, `docs/architecture/workflows/reports.md`
   * §15.1.1) — a materially more sensitive disclosure than a company-wide aggregate. Salary Release
   * Report is the first entry needing an any-of array — mirrors its own route's identical OR gate
   * (`App.tsx`, `docs/architecture/workflows/reports.md` §20.1) so the catalogue and the route can
   * never silently disagree about who may open it.
   */
  requiredPermission?: PermissionKey | PermissionKey[];
}

/** True if `entry` should render as a real link for `user` — absent `requiredPermission` means the
 * ordinary `reports:view` requirement every report before Salary Release Report already assumed
 * (never "no requirement," which would have let a payroll:view-only Finance user see every other
 * report's own card as a live link that still 403s on its own reports:view-only route). */
function isCatalogueEntryVisible(user: SessionUser, entry: ReportCatalogueEntry): boolean {
  const required = entry.requiredPermission ?? PERMISSIONS.REPORTS_VIEW;
  return hasAnyPermission(user, Array.isArray(required) ? required : [required]);
}

/**
 * Phase 8B Checkpoint 1 — Reports landing page (Phase 8A investigation report §9: "a report
 * catalogue/selector, not a dashboard" — no charts, no KPI-tile decoration, an information-dense list
 * only). Payroll Summary is the only report built this checkpoint; the remaining catalogue entries
 * from the Phase 8A investigation report are listed as "Not yet available" placeholders so the page's
 * own structure doesn't need to be rebuilt as later checkpoints add reports — they are not links, and
 * clicking them does nothing (deliberately not routed anywhere, per the checkpoint's own scope
 * boundary: "do NOT implement the remaining report catalogue yet").
 */
const REPORT_CATALOGUE: ReportCatalogueEntry[] = [
  {
    title: 'Payroll Summary',
    description: 'Payroll totals by Project Site for one payroll cycle — gross pay, overtime, deductions, net salary, release status.',
    to: '/reports/payroll-summary',
    available: true,
  },
  {
    title: 'Employee Payroll History',
    description: "One employee's cross-cycle original payroll results, with corrections and settlements available as drill-down detail.",
    to: '/reports/employee-payroll-history',
    available: true,
    requiredPermission: PERMISSIONS.STATEMENTS_VIEW,
  },
  {
    title: 'Project Site Payroll Report',
    description: 'Employee payroll detail for selected Project Site(s) within one payroll cycle — row-level figures, corrections shown as counts only.',
    to: '/reports/project-site-payroll',
    available: true,
  },
  {
    title: 'Deduction Report',
    description: 'Which employees had which deduction(s) applied this cycle, how much, and what each type totals to company-wide — filterable and sortable by deduction type.',
    to: '/reports/deduction-report',
    available: true,
  },
  {
    title: 'Overtime Report',
    description: 'Operational overtime analysis by employee, site, and unit for one payroll cycle — hours, rate, and cost, filterable by Has Overtime.',
    to: '/reports/overtime-report',
    available: true,
  },
  {
    title: 'Advance Recovery Report',
    description: 'Current Advance balances (Loan/Eid Advance) and recovery history, with optional payroll-cycle recovery context.',
    to: '/reports/advance-recovery',
    available: true,
  },
  {
    title: 'Salary Release Report',
    description: 'Release reconciliation for one payroll cycle — released, pending, held, and resolved entries, with corrections shown separately.',
    to: '/reports/salary-release',
    available: true,
    // The first Reports-module report on an any-of gate — mirrors its own route's identical OR
    // permission (`App.tsx`, frozen Checkpoint 1A backend decision, reports.md §20.1). Never
    // narrowed to `reports:view` alone, which would hide this card from the Finance role that
    // actually executes the releases this report reconciles.
    requiredPermission: [PERMISSIONS.REPORTS_VIEW, PERMISSIONS.PAYROLL_VIEW],
  },
  {
    title: 'Variance / Month-on-Month Report',
    description: 'Employee-level Net Salary comparison between two payroll cycles — New/Departed/Continued, transfers, and correction context.',
    to: '/reports/variance',
    available: true,
    // reports:view alone (frozen Checkpoint 1A backend decision) — no OR gate, unlike Salary
    // Release Report's own entry immediately above.
  },
];

export function ReportsPage({ user }: { user: SessionUser }) {
  // Widened from `reports:view` alone (Checkpoint 1B, Salary Release Report) so a payroll:view-only
  // Finance user can reach the catalogue shell itself — every individual card below still
  // independently gates on its own real requirement via `isCatalogueEntryVisible`, so this widened
  // top-level check alone can never expose a card such a user isn't actually authorized to open.
  const canView = hasAnyPermission(user, [PERMISSIONS.REPORTS_VIEW, PERMISSIONS.PAYROLL_VIEW]);

  if (!canView) {
    return (
      <AppShell user={user} title="Reports">
        <Card>
          <CardContent className="flex flex-col items-center gap-1 py-14 text-center">
            <p className="text-xs font-medium text-text">You don&apos;t have access to Reports</p>
            <p className="text-xs text-text-muted">Contact a Master User if you believe this is a mistake.</p>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell user={user} title="Reports" subtitle="Analyse historical and current payroll information">
      <Card>
        <CardHeader>
          <CardTitle>Report Catalogue</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {REPORT_CATALOGUE.filter((entry) => isCatalogueEntryVisible(user, entry)).map((entry) =>
            entry.available ? (
              <Link
                key={entry.title}
                to={entry.to}
                className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface px-4 py-3.5 transition-colors hover:border-accent-mid hover:bg-accent-light"
              >
                <div className="flex items-center gap-2">
                  <FileBarChart className="h-4 w-4 text-accent" aria-hidden />
                  <span className="text-xs font-semibold text-text">{entry.title}</span>
                </div>
                <p className="text-[11px] text-text-muted">{entry.description}</p>
              </Link>
            ) : (
              <div
                key={entry.title}
                className="flex flex-col gap-1.5 rounded-lg border border-dashed border-border px-4 py-3.5 opacity-60"
              >
                <div className="flex items-center gap-2">
                  <FileBarChart className="h-4 w-4 text-text-faint" aria-hidden />
                  <span className="text-xs font-semibold text-text-muted">{entry.title}</span>
                </div>
                <p className="text-[11px] text-text-faint">{entry.description}</p>
              </div>
            ),
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
