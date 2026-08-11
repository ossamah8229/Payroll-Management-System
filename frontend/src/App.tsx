import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, RouterProvider, type RouteObject } from 'react-router-dom';
import { PERMISSIONS } from '@payroll/shared';
import { useSession } from '@/hooks/use-session';
import { RouteLoadingFallback } from '@/components/layout/route-loading-fallback';
import { RouteErrorBoundary } from '@/components/layout/route-error-boundary';
import { RequirePermission } from '@/components/layout/require-permission';
import { LoginPage } from '@/routes/login-page';
import { NotFoundPage } from '@/routes/not-found-page';
import { usePayrollEntryUnloadGuard } from '@/lib/payroll-entry-save-status-store';

/**
 * AUD-012 (Post-Phase-5 Stabilization Checkpoint 4) — every authenticated page-level route is
 * lazy-loaded, so its own code (and whatever it pulls in — grids, PDF-adjacent Payslips code,
 * import/export builders, etc.) is fetched only when that route is actually navigated to, not as
 * part of the initial bundle every session pays for regardless of which pages it ever visits.
 * `LoginPage` and `NotFoundPage` are deliberately NOT lazy — `LoginPage` is the very first screen
 * an unauthenticated session renders, so lazy-loading it would insert a network round trip before
 * a user can even see the login form; `NotFoundPage` is tiny and needed for the catch-all `*` route
 * to resolve immediately. Each `.then(module => ...)` adapts this codebase's own named-export
 * convention (`export function XPage`) to `React.lazy`'s required default-export shape — no route
 * component's own export style changed.
 */
const HomePage = lazy(() => import('@/routes/home-page').then((m) => ({ default: m.HomePage })));
const ProjectSitesPage = lazy(() =>
  import('@/routes/project-sites-page').then((m) => ({ default: m.ProjectSitesPage })),
);
const EmployeesPage = lazy(() => import('@/routes/employees-page').then((m) => ({ default: m.EmployeesPage })));
const PayrollEntryPage = lazy(() =>
  import('@/routes/payroll-entry-page').then((m) => ({ default: m.PayrollEntryPage })),
);
const SalaryReleasePage = lazy(() =>
  import('@/routes/salary-release-page').then((m) => ({ default: m.SalaryReleasePage })),
);
const BankSheetPage = lazy(() => import('@/routes/bank-sheet-page').then((m) => ({ default: m.BankSheetPage })));
const CashReceivingPage = lazy(() =>
  import('@/routes/cash-receiving-page').then((m) => ({ default: m.CashReceivingPage })),
);
const AdvancesPage = lazy(() => import('@/routes/advances-page').then((m) => ({ default: m.AdvancesPage })));
const PayslipsPage = lazy(() => import('@/routes/payslips-page').then((m) => ({ default: m.PayslipsPage })));
const SettingsPage = lazy(() => import('@/routes/settings-page').then((m) => ({ default: m.SettingsPage })));
const UsersPage = lazy(() => import('@/routes/users-page').then((m) => ({ default: m.UsersPage })));
const RolesPage = lazy(() => import('@/routes/roles-page').then((m) => ({ default: m.RolesPage })));
const CorrectionsPage = lazy(() =>
  import('@/routes/corrections-page').then((m) => ({ default: m.CorrectionsPage })),
);
const CorrectionRequestDetailPage = lazy(() =>
  import('@/routes/correction-request-detail-page').then((m) => ({ default: m.CorrectionRequestDetailPage })),
);
const BalanceAdjustmentDetailPage = lazy(() =>
  import('@/routes/balance-adjustment-detail-page').then((m) => ({ default: m.BalanceAdjustmentDetailPage })),
);
const StatementsPage = lazy(() => import('@/routes/statements-page').then((m) => ({ default: m.StatementsPage })));
const ReportsPage = lazy(() => import('@/routes/reports-page').then((m) => ({ default: m.ReportsPage })));
const ReportsPayrollSummaryPage = lazy(() =>
  import('@/routes/reports-payroll-summary-page').then((m) => ({ default: m.ReportsPayrollSummaryPage })),
);
const ReportsEmployeePayrollHistoryPage = lazy(() =>
  import('@/routes/reports-employee-payroll-history-page').then((m) => ({ default: m.ReportsEmployeePayrollHistoryPage })),
);
const EmployeePayrollHistoryDetailPage = lazy(() =>
  import('@/routes/reports-employee-payroll-history-detail-page').then((m) => ({
    default: m.EmployeePayrollHistoryDetailPage,
  })),
);
const ReportsProjectSitePayrollPage = lazy(() =>
  import('@/routes/reports-project-site-payroll-page').then((m) => ({ default: m.ReportsProjectSitePayrollPage })),
);
const ReportsDeductionReportPage = lazy(() =>
  import('@/routes/reports-deduction-report-page').then((m) => ({ default: m.ReportsDeductionReportPage })),
);
const ReportsOvertimeReportPage = lazy(() =>
  import('@/routes/reports-overtime-report-page').then((m) => ({ default: m.ReportsOvertimeReportPage })),
);
const ReportsAdvanceRecoveryReportPage = lazy(() =>
  import('@/routes/reports-advance-recovery-report-page').then((m) => ({ default: m.ReportsAdvanceRecoveryReportPage })),
);
const ReportsAdvanceRecoveryReportDetailPage = lazy(() =>
  import('@/routes/reports-advance-recovery-report-detail-page').then((m) => ({
    default: m.ReportsAdvanceRecoveryReportDetailPage,
  })),
);

/** Gates any route that requires an authenticated session, redirecting to /login otherwise. This
 * loading state (the session fetch) is unrelated to a lazy route's own code-loading state (handled
 * by the `<Suspense>` boundary in `App`, below) but reuses the identical fallback for visual
 * consistency — a user should never be able to tell which kind of "loading" they're seeing. */
function RequireSession({
  children,
}: {
  children: (user: NonNullable<ReturnType<typeof useSession>['data']>) => ReactNode;
}) {
  const { data: sessionUser, isLoading } = useSession();

  if (isLoading) return <RouteLoadingFallback />;
  if (!sessionUser) return <Navigate to="/login" replace />;

  return <>{children(sessionUser)}</>;
}

/**
 * Phase 7E durability checkpoint (A3) — converted from `<Routes>`/`<Route>` (declarative mode) to
 * `createBrowserRouter`/`RouterProvider` (data mode), the only way React Router 6.27 exposes
 * `useBlocker` — the framework-native in-app navigation guard the Payroll Entry route needs so a
 * dirty/saving/failed/conflicted row can never be silently navigated away from (see
 * `PayrollEntryPage`'s own use of it). Every route below is otherwise byte-for-byte the same
 * element tree this file already rendered — `RequireSession`/`RequirePermission` wrapping,
 * lazy-loading, and every path (including the flat/`:cycleId`-nested pair for each cycle-aware
 * page) are unchanged; only the JSX-vs-object-array wiring around them changed. `useBlocker` is
 * only ever called from inside `PayrollEntryPage` itself, so no other route's navigation behavior
 * is affected by this migration.
 */
const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <RequireSession>{(user) => <HomePage user={user} />}</RequireSession>,
  },
  {
    path: '/sites',
    element: (
      <RequireSession>
        {(user) => (
          <RequirePermission user={user} permission={PERMISSIONS.SITES_MANAGE}>
            <ProjectSitesPage user={user} />
          </RequirePermission>
        )}
      </RequireSession>
    ),
  },
  {
    path: '/employees',
    element: (
      <RequireSession>
        {(user) => (
          <RequirePermission user={user} permission={PERMISSIONS.EMPLOYEES_VIEW}>
            <EmployeesPage user={user} />
          </RequirePermission>
        )}
      </RequireSession>
    ),
  },
  // Historical Payroll Cycle Selector routing (Phase 5 Checkpoint 4) — every cycle-aware page is
  // mounted at two paths, both rendering the exact same component: the original flat path (kept as
  // a compatibility redirect — `useSelectedPayrollCycle` resolves the default cycle and navigates
  // to the canonical URL below) and the canonical `/payroll-cycles/:cycleId/...` path a
  // bookmark/refresh/back-forward can target directly. `useParams` returns `undefined` for
  // `cycleId` on the flat route and the actual value on the nested one — the same page component
  // handles both via one shared hook, not two separate implementations.
  {
    path: '/payroll-entry',
    element: (
      <RequireSession>
        {(user) => (
          <RequirePermission user={user} permission={PERMISSIONS.PAYROLL_ENTRY}>
            <PayrollEntryPage user={user} />
          </RequirePermission>
        )}
      </RequireSession>
    ),
  },
  {
    path: '/payroll-cycles/:cycleId/payroll-entry',
    element: (
      <RequireSession>
        {(user) => (
          <RequirePermission user={user} permission={PERMISSIONS.PAYROLL_ENTRY}>
            <PayrollEntryPage user={user} />
          </RequirePermission>
        )}
      </RequireSession>
    ),
  },
  {
    path: '/release',
    element: (
      <RequireSession>
        {(user) => (
          <RequirePermission user={user} permission={PERMISSIONS.PAYROLL_VIEW}>
            <SalaryReleasePage user={user} />
          </RequirePermission>
        )}
      </RequireSession>
    ),
  },
  {
    path: '/payroll-cycles/:cycleId/release',
    element: (
      <RequireSession>
        {(user) => (
          <RequirePermission user={user} permission={PERMISSIONS.PAYROLL_VIEW}>
            <SalaryReleasePage user={user} />
          </RequirePermission>
        )}
      </RequireSession>
    ),
  },
  {
    path: '/bank-sheet',
    element: (
      <RequireSession>
        {(user) => (
          <RequirePermission user={user} permission={PERMISSIONS.BANK_SHEETS_VIEW}>
            <BankSheetPage user={user} />
          </RequirePermission>
        )}
      </RequireSession>
    ),
  },
  {
    path: '/payroll-cycles/:cycleId/bank-sheet',
    element: (
      <RequireSession>
        {(user) => (
          <RequirePermission user={user} permission={PERMISSIONS.BANK_SHEETS_VIEW}>
            <BankSheetPage user={user} />
          </RequirePermission>
        )}
      </RequireSession>
    ),
  },
  {
    path: '/cash-receiving',
    element: (
      <RequireSession>
        {(user) => (
          <RequirePermission user={user} permission={PERMISSIONS.BANK_SHEETS_VIEW}>
            <CashReceivingPage user={user} />
          </RequirePermission>
        )}
      </RequireSession>
    ),
  },
  {
    path: '/payroll-cycles/:cycleId/cash-receiving',
    element: (
      <RequireSession>
        {(user) => (
          <RequirePermission user={user} permission={PERMISSIONS.BANK_SHEETS_VIEW}>
            <CashReceivingPage user={user} />
          </RequirePermission>
        )}
      </RequireSession>
    ),
  },
  {
    path: '/advances',
    element: (
      <RequireSession>
        {(user) => (
          <RequirePermission user={user} permission={PERMISSIONS.ADVANCES_MANAGE}>
            <AdvancesPage user={user} />
          </RequirePermission>
        )}
      </RequireSession>
    ),
  },
  {
    path: '/payslips',
    element: (
      <RequireSession>
        {(user) => (
          <RequirePermission user={user} permission={PERMISSIONS.PAYSLIPS_VIEW}>
            <PayslipsPage user={user} />
          </RequirePermission>
        )}
      </RequireSession>
    ),
  },
  {
    path: '/payroll-cycles/:cycleId/payslips',
    element: (
      <RequireSession>
        {(user) => (
          <RequirePermission user={user} permission={PERMISSIONS.PAYSLIPS_VIEW}>
            <PayslipsPage user={user} />
          </RequirePermission>
        )}
      </RequireSession>
    ),
  },
  {
    path: '/corrections',
    element: (
      <RequireSession>
        {(user) => (
          <RequirePermission user={user} permission={[PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.CORRECTIONS_APPROVE]}>
            <CorrectionsPage user={user} />
          </RequirePermission>
        )}
      </RequireSession>
    ),
  },
  {
    path: '/corrections/requests/:id',
    element: (
      <RequireSession>
        {(user) => (
          <RequirePermission user={user} permission={[PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.CORRECTIONS_APPROVE]}>
            <CorrectionRequestDetailPage user={user} />
          </RequirePermission>
        )}
      </RequireSession>
    ),
  },
  {
    path: '/corrections/ledger/:id',
    element: (
      <RequireSession>
        {(user) => (
          <RequirePermission user={user} permission={[PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.CORRECTIONS_APPROVE]}>
            <BalanceAdjustmentDetailPage user={user} />
          </RequirePermission>
        )}
      </RequireSession>
    ),
  },
  {
    path: '/statements',
    element: (
      <RequireSession>
        {(user) => (
          <RequirePermission user={user} permission={PERMISSIONS.STATEMENTS_VIEW}>
            <StatementsPage user={user} />
          </RequirePermission>
        )}
      </RequireSession>
    ),
  },
  {
    path: '/settings',
    // No permission requirement — GET /settings/company is intentionally unrestricted to any
    // authenticated user (settings.routes.ts's own documented decision: company name/address
    // appears throughout the app, not just this page). SettingsPage already gates its own edit
    // controls per-section (canManage/canManageBanks) — Fix 3's action-level gating, not a
    // route-level concern.
    element: <RequireSession>{(user) => <SettingsPage user={user} />}</RequireSession>,
  },
  {
    path: '/users',
    element: (
      <RequireSession>
        {(user) => (
          <RequirePermission user={user} permission={PERMISSIONS.USERS_MANAGE}>
            <UsersPage user={user} />
          </RequirePermission>
        )}
      </RequireSession>
    ),
  },
  {
    path: '/roles',
    element: (
      <RequireSession>
        {(user) => (
          <RequirePermission user={user} permission={PERMISSIONS.USERS_MANAGE}>
            <RolesPage user={user} />
          </RequirePermission>
        )}
      </RequireSession>
    ),
  },
  {
    path: '/reports',
    element: (
      <RequireSession>
        {(user) => (
          <RequirePermission user={user} permission={PERMISSIONS.REPORTS_VIEW}>
            <ReportsPage user={user} />
          </RequirePermission>
        )}
      </RequireSession>
    ),
  },
  // Historical Payroll Cycle Selector routing (same shape as every other cycle-aware page, e.g.
  // /bank-sheet above) — the flat route redirects to the canonical
  // /payroll-cycles/:cycleId/reports/payroll-summary URL via useSelectedPayrollCycle.
  {
    path: '/reports/payroll-summary',
    element: (
      <RequireSession>
        {(user) => (
          <RequirePermission user={user} permission={PERMISSIONS.REPORTS_VIEW}>
            <ReportsPayrollSummaryPage user={user} />
          </RequirePermission>
        )}
      </RequireSession>
    ),
  },
  {
    path: '/payroll-cycles/:cycleId/reports/payroll-summary',
    element: (
      <RequireSession>
        {(user) => (
          <RequirePermission user={user} permission={PERMISSIONS.REPORTS_VIEW}>
            <ReportsPayrollSummaryPage user={user} />
          </RequirePermission>
        )}
      </RequireSession>
    ),
  },
  // Employee Payroll History (Phase 7 Reports, Checkpoint 1B) — gated on `statements:view`, not
  // `reports:view` (approved decision 1, `docs/architecture/workflows/reports.md` §15.1.1): this
  // report discloses one employee's cross-cycle payroll history, the same sensitivity class
  // Statements itself already established a dedicated permission for, even though it's reached via
  // the Reports catalogue.
  {
    path: '/reports/employee-payroll-history',
    element: (
      <RequireSession>
        {(user) => (
          <RequirePermission user={user} permission={PERMISSIONS.STATEMENTS_VIEW}>
            <ReportsEmployeePayrollHistoryPage user={user} />
          </RequirePermission>
        )}
      </RequireSession>
    ),
  },
  {
    path: '/reports/employee-payroll-history/:entryId',
    element: (
      <RequireSession>
        {(user) => (
          <RequirePermission user={user} permission={PERMISSIONS.STATEMENTS_VIEW}>
            <EmployeePayrollHistoryDetailPage user={user} />
          </RequirePermission>
        )}
      </RequireSession>
    ),
  },
  // Project Site Payroll Report (Phase 7 Reports, Checkpoint 1B) — gated on `reports:view`, the
  // same permission Payroll Summary already uses (frozen decision 2,
  // `docs/architecture/workflows/reports.md` §16.1) — no requiredPermission override needed on the
  // catalogue card. Historical Payroll Cycle Selector routing (same shape as Payroll Summary above,
  // both requiring exactly one Payroll Cycle, no From/To range): the flat route redirects to the
  // canonical /payroll-cycles/:cycleId/reports/project-site-payroll URL via
  // useSelectedPayrollCycle. No detail route exists (frozen decision 4 — no detail endpoint/page).
  {
    path: '/reports/project-site-payroll',
    element: (
      <RequireSession>
        {(user) => (
          <RequirePermission user={user} permission={PERMISSIONS.REPORTS_VIEW}>
            <ReportsProjectSitePayrollPage user={user} />
          </RequirePermission>
        )}
      </RequireSession>
    ),
  },
  {
    path: '/payroll-cycles/:cycleId/reports/project-site-payroll',
    element: (
      <RequireSession>
        {(user) => (
          <RequirePermission user={user} permission={PERMISSIONS.REPORTS_VIEW}>
            <ReportsProjectSitePayrollPage user={user} />
          </RequirePermission>
        )}
      </RequireSession>
    ),
  },
  // Deduction Report (Phase 7 Reports, Checkpoint 1B) — gated on `reports:view`, the same permission
  // Payroll Summary/Project Site Payroll Report already use (frozen decision 3,
  // `docs/architecture/workflows/reports.md` §17.1) — no requiredPermission override needed on the
  // catalogue card. Historical Payroll Cycle Selector routing (same shape as Project Site Payroll
  // Report above, both requiring exactly one Payroll Cycle, no From/To range): the flat route
  // redirects to the canonical /payroll-cycles/:cycleId/reports/deduction-report URL via
  // useSelectedPayrollCycle. No detail route exists (frozen decision 12 — no detail endpoint/page).
  {
    path: '/reports/deduction-report',
    element: (
      <RequireSession>
        {(user) => (
          <RequirePermission user={user} permission={PERMISSIONS.REPORTS_VIEW}>
            <ReportsDeductionReportPage user={user} />
          </RequirePermission>
        )}
      </RequireSession>
    ),
  },
  {
    path: '/payroll-cycles/:cycleId/reports/deduction-report',
    element: (
      <RequireSession>
        {(user) => (
          <RequirePermission user={user} permission={PERMISSIONS.REPORTS_VIEW}>
            <ReportsDeductionReportPage user={user} />
          </RequirePermission>
        )}
      </RequireSession>
    ),
  },
  // Overtime Report (Phase 7 Reports, Checkpoint 1B) — gated on `reports:view`, the same permission
  // Project Site Payroll Report/Deduction Report already use (frozen decision,
  // `docs/architecture/workflows/reports.md` §18.1) — no requiredPermission override needed on the
  // catalogue card. Historical Payroll Cycle Selector routing (same shape as Deduction Report above,
  // both requiring exactly one Payroll Cycle, no From/To range): the flat route redirects to the
  // canonical /payroll-cycles/:cycleId/reports/overtime-report URL via useSelectedPayrollCycle. No
  // detail route exists (frozen decision — no detail endpoint/page; report grain is
  // `PayrollEntryWorkLine`, not `PayrollEntry`).
  {
    path: '/reports/overtime-report',
    element: (
      <RequireSession>
        {(user) => (
          <RequirePermission user={user} permission={PERMISSIONS.REPORTS_VIEW}>
            <ReportsOvertimeReportPage user={user} />
          </RequirePermission>
        )}
      </RequireSession>
    ),
  },
  {
    path: '/payroll-cycles/:cycleId/reports/overtime-report',
    element: (
      <RequireSession>
        {(user) => (
          <RequirePermission user={user} permission={PERMISSIONS.REPORTS_VIEW}>
            <ReportsOvertimeReportPage user={user} />
          </RequirePermission>
        )}
      </RequireSession>
    ),
  },
  // Advance Recovery Report (Phase 7 Reports, Checkpoint 1B) — gated on `reports:view`, the same
  // permission every other operational report in this module uses (frozen backend decision,
  // `docs/architecture/workflows/reports.md` §19.1) — no requiredPermission override needed on the
  // catalogue card. Cycle is OPTIONAL for this report (unlike every sibling above) — the flat
  // `/reports/advance-recovery` route is never auto-redirected to a resolved default cycle (this
  // page does not use `useSelectedPayrollCycle`); it stays the true no-cycle-context roster until a
  // user explicitly picks a Cycle from the page's own selector, which then navigates to the
  // canonical `/payroll-cycles/:cycleId/reports/advance-recovery` URL below. A detail route exists
  // (unlike Deduction/Overtime/Project Site Payroll Report) — the report grain is one `Advance`, and
  // its own Recovery History / Schedule-Deferral History are drill-down-only.
  {
    path: '/reports/advance-recovery',
    element: (
      <RequireSession>
        {(user) => (
          <RequirePermission user={user} permission={PERMISSIONS.REPORTS_VIEW}>
            <ReportsAdvanceRecoveryReportPage user={user} />
          </RequirePermission>
        )}
      </RequireSession>
    ),
  },
  {
    path: '/payroll-cycles/:cycleId/reports/advance-recovery',
    element: (
      <RequireSession>
        {(user) => (
          <RequirePermission user={user} permission={PERMISSIONS.REPORTS_VIEW}>
            <ReportsAdvanceRecoveryReportPage user={user} />
          </RequirePermission>
        )}
      </RequireSession>
    ),
  },
  {
    path: '/reports/advance-recovery/:advanceId',
    element: (
      <RequireSession>
        {(user) => (
          <RequirePermission user={user} permission={PERMISSIONS.REPORTS_VIEW}>
            <ReportsAdvanceRecoveryReportDetailPage user={user} />
          </RequirePermission>
        )}
      </RequireSession>
    ),
  },
  { path: '*', element: <NotFoundPage /> },
];

const router = createBrowserRouter(routes);

export function App() {
  // Phase 7E durability checkpoint (A2) — installed once, globally, regardless of which route is
  // currently mounted (see the hook's own doc comment for why this can't be scoped to just
  // PayrollEntryPage).
  usePayrollEntryUnloadGuard();

  return (
    <RouteErrorBoundary>
      <Suspense fallback={<RouteLoadingFallback />}>
        <RouterProvider router={router} />
      </Suspense>
    </RouteErrorBoundary>
  );
}
