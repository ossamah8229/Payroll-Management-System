import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney, formatNumber } from '@payroll/shared';
import type { DashboardResponse, SessionUser } from '@payroll/shared';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApiError } from '@/lib/api-client';
import { useDashboard } from '@/hooks/use-dashboard';
import { formatCycleLabel } from '@/hooks/use-payroll-cycles';
import { PayrollCycleStatusBadge } from '@/components/payroll-cycle/payroll-cycle-selector';
import { DASHBOARD_SITE_SUMMARY_TOP_N } from '@payroll/shared';
import {
  cycleOperationalContext,
  cycleScopedUnavailableReason,
  DASHBOARD_ATTENTION_LABELS,
  dashboardDeepLinks,
  releaseProgressSubtext,
  releaseProgressSummaryText,
  unavailableLabel,
} from '@/components/dashboard/dashboard-labels';

/**
 * Dashboard Checkpoint 1B — the frontend for the frozen Checkpoint 1A backend
 * (`docs/architecture/workflows/dashboard.md`, `GET /api/v1/dashboard`). Route: `/`, gated
 * `reports:view OR payroll:view` (App.tsx), the same any-of gate as the sidebar nav item
 * (`nav-config.ts`) — enforced identically in both places so neither ever admits a user the other
 * would turn away.
 *
 * Every widget renders the backend's own value verbatim — no client-side financial calculation, no
 * derivation of one widget from another, and `null` is never treated as (or displayed as) zero.
 * `null` on a cycle-scoped widget is disambiguated via `cycle` itself (`dashboard-labels.ts`'s
 * `cycleScopedUnavailableReason`) — "no cycle exists yet" and "you lack this widget's own
 * permission" are structurally different facts and are never shown as the same generic message.
 */
export function HomePage({ user }: { user: SessionUser }) {
  const dashboard = useDashboard();

  return (
    <AppShell user={user} title="Dashboard" subtitle="Payroll Management System">
      {dashboard.isLoading && <DashboardLoadingSkeleton />}

      {!dashboard.isLoading && dashboard.isError && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center" role="alert">
            <p className="text-xs font-medium text-danger">Could not load the Dashboard</p>
            <p className="text-xs text-text-muted">
              {dashboard.error instanceof ApiError ? dashboard.error.message : 'Something went wrong'}
            </p>
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => dashboard.refetch()}>
              Try Again
            </Button>
          </CardContent>
        </Card>
      )}

      {!dashboard.isLoading && !dashboard.isError && dashboard.data && <DashboardContent data={dashboard.data} />}
    </AppShell>
  );
}

function DashboardLoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4" data-testid="dashboard-loading">
      <Skeleton className="h-16 w-full" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

function DashboardContent({ data }: { data: DashboardResponse }) {
  const links = dashboardDeepLinks(data.cycle?.id);

  return (
    <div className="flex flex-col gap-4">
      <CurrentCycleCard data={data} />
      <StatRow data={data} links={links} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        <SiteSummaryCard data={data} links={links} />
        <DeductionsCard data={data} links={links} />
      </div>
      <AttentionCard data={data} links={links} />
    </div>
  );
}

// --- Widget 1: Current Cycle Status ------------------------------------------------------------

function CurrentCycleCard({ data }: { data: DashboardResponse }) {
  if (!data.cycle) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-1 py-10 text-center" data-testid="dashboard-empty-cycle">
          <p className="text-xs font-medium text-text">No payroll cycle exists yet</p>
          <p className="text-xs text-text-muted">
            Dashboard data will appear once the first payroll cycle is created.
          </p>
        </CardContent>
      </Card>
    );
  }

  const context = cycleOperationalContext(data.releaseProgress);

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4" data-testid="dashboard-current-cycle">
        <div className="flex items-center gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Current Cycle</p>
            <p className="text-sm font-semibold text-text">{formatCycleLabel(data.cycle)}</p>
          </div>
          <PayrollCycleStatusBadge cycle={data.cycle} />
        </div>
        {context && <p className="text-xs text-text-muted" data-testid="dashboard-cycle-context">{context}</p>}
      </CardContent>
    </Card>
  );
}

// --- Headline KPI row: Total Employees / Net Payroll / Pending Release / Release Progress -------

function StatCard({
  label,
  value,
  subtitle,
  href,
  unavailable,
  testId,
}: {
  label: string;
  value: string;
  subtitle?: string;
  href?: string;
  unavailable?: boolean;
  testId: string;
}) {
  const isLink = Boolean(href) && !unavailable;
  const className =
    'flex flex-col gap-1 rounded border border-border bg-surface px-3.5 py-3' +
    (isLink ? ' transition-colors hover:border-accent-mid focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-mid' : '');

  const body: ReactNode = (
    <>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">{label}</span>
      <span className={unavailable ? 'text-sm font-medium text-text-faint' : 'text-lg font-semibold tabular-nums text-text'}>
        {value}
      </span>
      {subtitle && <span className="text-[11px] text-text-muted">{subtitle}</span>}
    </>
  );

  if (isLink) {
    return (
      <Link to={href!} className={className} data-testid={testId} aria-label={`${label}: ${value}. View details`}>
        {body}
      </Link>
    );
  }

  return (
    <div className={className} data-testid={testId}>
      {body}
    </div>
  );
}

function StatRow({ data, links }: { data: DashboardResponse; links: ReturnType<typeof dashboardDeepLinks> }) {
  const employeesUnavailable = data.totalEmployees === null;
  const netPayrollUnavailable = data.netPayroll === null;
  const pendingReleaseUnavailable = data.pendingRelease === null;
  const releaseProgressUnavailable = data.releaseProgress === null;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="dashboard-stat-row">
      <StatCard
        label="Total Employees"
        value={employeesUnavailable ? unavailableLabel('UNAUTHORIZED') : formatNumber(data.totalEmployees)}
        unavailable={employeesUnavailable}
        href={links.employeeRegistry}
        testId="dashboard-stat-total-employees"
      />
      <StatCard
        label="Net Payroll"
        value={netPayrollUnavailable ? unavailableLabel(cycleScopedUnavailableReason(data.cycle)) : formatMoney(data.netPayroll)}
        unavailable={netPayrollUnavailable}
        href={links.payrollSummary}
        testId="dashboard-stat-net-payroll"
      />
      <StatCard
        label="Pending Release"
        value={
          pendingReleaseUnavailable
            ? unavailableLabel(cycleScopedUnavailableReason(data.cycle))
            : formatNumber(data.pendingRelease!.count)
        }
        subtitle={pendingReleaseUnavailable ? undefined : formatMoney(data.pendingRelease!.amount)}
        unavailable={pendingReleaseUnavailable}
        href={links.salaryRelease}
        testId="dashboard-stat-pending-release"
      />
      <StatCard
        label="Release Progress"
        value={
          releaseProgressUnavailable
            ? unavailableLabel(cycleScopedUnavailableReason(data.cycle))
            : releaseProgressSummaryText(data.releaseProgress!)
        }
        subtitle={releaseProgressUnavailable ? undefined : releaseProgressSubtext(data.releaseProgress!)}
        unavailable={releaseProgressUnavailable}
        href={links.salaryRelease}
        testId="dashboard-stat-release-progress"
      />
    </div>
  );
}

// --- Main content: Site Payroll Summary ----------------------------------------------------------

function SiteSummaryCard({ data, links }: { data: DashboardResponse; links: ReturnType<typeof dashboardDeepLinks> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Site Payroll Summary</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {data.siteSummary === null ? (
          <UnavailablePanel reason={cycleScopedUnavailableReason(data.cycle)} testId="dashboard-site-summary-unavailable" />
        ) : data.siteSummary.length === 0 ? (
          <div className="flex flex-col items-center gap-1 py-10 text-center" data-testid="dashboard-site-summary-empty">
            <p className="text-xs font-medium text-text">No site payroll data for this cycle</p>
          </div>
        ) : (
          <div className="flex flex-col">
            <div className="overflow-x-auto">
              {/* Rows are informational only — Payroll Summary has no per-Site URL/state filter to
                  drill into (Dashboard Checkpoint 1B UAT remediation, Issue B), so a Site name is
                  plain text here, never a Link that would silently land on the unfiltered report. */}
              <Table density="compact" data-testid="dashboard-site-summary-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Site</TableHead>
                    <TableHead className="text-right">Employees</TableHead>
                    <TableHead className="text-right">Net Payroll</TableHead>
                    <TableHead className="text-right">Released</TableHead>
                    <TableHead className="text-right">Pending Release</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.siteSummary.map((row) => (
                    <TableRow key={row.siteId}>
                      <TableCell className="font-medium">{row.siteName}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(row.employeeCount)}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{formatMoney(row.netPayroll)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(row.releasedAmount)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(row.pendingReleaseAmount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {/* The one honest, card-level drill-down: always present, never implying a specific
                Site was selected. Its label reflects the Top-N cap when relevant. */}
            <div className="border-t border-border px-[18px] py-2.5">
              <Link to={links.payrollSummary} className="text-xs font-medium text-accent hover:underline" data-testid="dashboard-site-summary-view-all">
                {data.siteSummaryTotalSites !== null && data.siteSummaryTotalSites > DASHBOARD_SITE_SUMMARY_TOP_N
                  ? `+${data.siteSummaryTotalSites - DASHBOARD_SITE_SUMMARY_TOP_N} more — see full Payroll Summary`
                  : 'View Payroll Summary'}
              </Link>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Main content: Deductions This Cycle ---------------------------------------------------------

function DeductionsCard({ data, links }: { data: DashboardResponse; links: ReturnType<typeof dashboardDeepLinks> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Deductions This Cycle</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {data.deductionBreakdown === null ? (
          <UnavailablePanel reason={cycleScopedUnavailableReason(data.cycle)} testId="dashboard-deductions-unavailable" />
        ) : (
          <dl className="flex flex-col" data-testid="dashboard-deductions-list">
            {(
              [
                ['EOBI', data.deductionBreakdown.eobi],
                ['Advance', data.deductionBreakdown.advance],
                ['EID Advance', data.deductionBreakdown.eidAdvance],
                ['Fine', data.deductionBreakdown.fine],
              ] as const
            ).map(([label, amount]) => (
              <div key={label} className="flex items-center justify-between border-b border-border px-[18px] py-2.5 last:border-0">
                <dt className="text-xs text-text-muted">{label}</dt>
                <dd className="text-xs font-semibold tabular-nums text-text">{formatMoney(amount)}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="border-t border-border px-[18px] py-2.5">
          <Link to={links.deductionReport} className="text-xs font-medium text-accent hover:underline">
            View Deduction Report
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

// --- Secondary: Attention Required ----------------------------------------------------------------

function AttentionCard({ data, links }: { data: DashboardResponse; links: ReturnType<typeof dashboardDeepLinks> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Attention Required</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="flex flex-col" data-testid="dashboard-attention-list">
          <AttentionRow
            category="heldEntries"
            item={data.attention.heldEntries}
            href={links.salaryRelease}
          />
          <AttentionRow
            category="pendingCorrections"
            item={data.attention.pendingCorrections}
            href={links.corrections}
          />
          <AttentionRow
            category="recoveryDue"
            item={data.attention.recoveryDue}
            href={links.advanceRecovery}
          />
        </ul>
      </CardContent>
    </Card>
  );
}

function AttentionRow({
  category,
  item,
  href,
}: {
  category: keyof typeof DASHBOARD_ATTENTION_LABELS;
  item: { count: number; amount?: string } | null;
  href: string;
}) {
  const label = DASHBOARD_ATTENTION_LABELS[category];
  const testId = `dashboard-attention-${category}`;

  if (item === null) {
    return (
      <li className="flex items-center justify-between gap-3 border-b border-border px-[18px] py-3 last:border-0" data-testid={testId}>
        <div>
          <p className="text-xs font-medium text-text-faint">{label.title}</p>
          <p className="text-[11px] text-text-muted">{label.description}</p>
        </div>
        <span className="text-xs font-medium text-text-faint">{unavailableLabel('UNAUTHORIZED')}</span>
      </li>
    );
  }

  return (
    <li className="border-b border-border last:border-0" data-testid={testId}>
      <Link
        to={href}
        className="flex items-center justify-between gap-3 px-[18px] py-3 transition-colors hover:bg-bg"
        aria-label={`${label.title}: ${item.count}${item.amount ? `, ${formatMoney(item.amount)}` : ''}. ${label.description}`}
      >
        <div>
          <p className="text-xs font-medium text-text">{label.title}</p>
          <p className="text-[11px] text-text-muted">{label.description}</p>
        </div>
        <div className="flex items-center gap-2">
          {item.count > 0 ? (
            <Badge tone={category === 'heldEntries' ? 'hold' : 'amber'}>{formatNumber(item.count)}</Badge>
          ) : (
            <span className="text-xs tabular-nums text-text-muted">0</span>
          )}
          {item.amount && <span className="text-xs tabular-nums text-text-muted">{formatMoney(item.amount)}</span>}
        </div>
      </Link>
    </li>
  );
}

// --- Shared unavailable panel (Site Summary / Deductions) ------------------------------------------

function UnavailablePanel({ reason, testId }: { reason: 'NO_CYCLE' | 'UNAUTHORIZED'; testId: string }) {
  return (
    <div className="flex flex-col items-center gap-1 py-10 text-center" data-testid={testId}>
      <p className="text-xs font-medium text-text-faint">{unavailableLabel(reason)}</p>
      {reason === 'UNAUTHORIZED' && (
        <p className="text-xs text-text-muted">Contact a Master User if you believe this is a mistake.</p>
      )}
    </div>
  );
}
