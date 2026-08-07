import { FileBarChart } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PERMISSIONS, type PermissionKey, type SessionUser } from '@payroll/shared';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ReportCatalogueEntry {
  title: string;
  description: string;
  to: string;
  available: boolean;
  /** Additive, optional (Employee Payroll History Checkpoint 1B) — most catalogue entries need no
   * permission beyond this page's own `reports:view` gate, since they reuse that same permission
   * for their own route. Employee Payroll History is gated on `statements:view` instead (approved
   * decision 1, `docs/architecture/workflows/reports.md` §15.1.1), a materially more sensitive
   * disclosure than a company-wide aggregate — so its own card must independently check for it
   * rather than assume `reports:view` alone is enough. Absent for every other entry. */
  requiredPermission?: PermissionKey;
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
  { title: 'Advance Recovery Report', description: 'Not yet available.', to: '', available: false },
  { title: 'Salary Release Report', description: 'Not yet available.', to: '', available: false },
];

export function ReportsPage({ user }: { user: SessionUser }) {
  const canView = user.permissions.includes(PERMISSIONS.REPORTS_VIEW);

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
          {REPORT_CATALOGUE.filter(
            (entry) => !entry.requiredPermission || user.permissions.includes(entry.requiredPermission),
          ).map((entry) =>
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
