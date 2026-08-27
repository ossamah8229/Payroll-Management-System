import type { BrowserContext } from '@playwright/test';
import { test, expect, login, getCsrfToken } from '../fixtures/auth';
import { apiGet, apiPost } from '../helpers/api';
import { createSiteWithEmployee, ensureAnyPayrollCycleExists } from '../helpers/fixtures';
import { createScopedUser } from '../helpers/create-scoped-user';
import { BACKEND_URL } from '../setup/config';

/** `apiPost`'s own CSRF-attaching convention (`helpers/api.ts`), for PATCH — matching
 * `08-role-administration.spec.ts`'s own local precedent (kept local rather than added to the
 * shared helper, since neither file is the sole owner of a general PATCH need yet). */
async function apiPatch<T = unknown>(context: BrowserContext, path: string, body: unknown): Promise<{ status: number; body: T }> {
  const csrfToken = await getCsrfToken(context);
  const res = await context.request.patch(`${BACKEND_URL}${path}`, { data: body, headers: { 'x-csrf-token': csrfToken } });
  if (!res.ok()) {
    throw new Error(`PATCH ${path} failed: ${res.status()} ${await res.text()}`);
  }
  return { status: res.status(), body: (await res.json()) as T };
}

/**
 * Phase 7A Checkpoint 2 — Statements frontend, real-browser verification. Drives the real
 * navigation/selection workflow and the real backend ledger (Checkpoint 1,
 * `docs/architecture/workflows/statements-ledger.md`) end to end: no mocked hooks, no fabricated
 * DOM — the same real-stack discipline every prior phase's own E2E pass used.
 *
 * **Checkpoint 2 correction (this file, revised)**: the original selection flow required a Site
 * before the Employee field could even be used, discovered via the *current*-site-scoped Employee
 * Lookup — an architectural review found this made a transferred employee permanently
 * undiscoverable to the very user who administered their history at their *old* site (see
 * `docs/architecture/workflows/statements-ledger.md §15`). The page is now Employee-first, backed
 * by a dedicated historical-attribution discovery endpoint (`GET /api/v1/statements/employees`,
 * `statements.service.ts`'s `searchStatementEmployees`) — Site/Unit are optional narrowing
 * filters, never a prerequisite. The Advance-restriction-notice test below now drives a genuine
 * Site A → Site B employee transfer and a real Site-A-only user through the real UI — no
 * `page.route` interception, replacing this file's own previous mocked compromise.
 *
 * **Fixture design note — why an Advance, not a released Payroll Entry, for the first two tests:**
 * the Statement's default display range ("Latest 12 Cycles") is bounded by whichever real
 * `PayrollCycle` rows already exist system-wide by the time this file runs (this suite's specs run
 * sequentially against one shared, disposable database, `playwright.config.ts`'s `workers: 1`) —
 * several earlier specs bootstrap a cycle dated far in the future (`fixtures.ts`'s own `year: 2900`
 * bootstrap) purely to avoid colliding with anything realistic. Rather than gamble on which cycle
 * period is "latest" at run time, those two tests anchor their own fixture Advance's
 * `dateGiven`/`originalPeriod` to whatever cycle the API itself reports as newest right before
 * creating it — guaranteeing the fixture always lands inside the default range regardless of run
 * order. An Advance also needs no released (or even Draft) `PayrollEntry` of its own to produce
 * both a real financial-movement ledger row (`ADVANCE_GIVEN`) and a real informational one
 * (`ADVANCE_CANCELLED`) — the simplest fully-real path to both row kinds.
 */

interface CycleRow {
  id: string;
  year: number;
  month: number;
  status: string;
}

/** Drives the real `StatementEmployeeLookup` combobox — types enough of the employee's own name
 * to surface exactly one match, then clicks it, the same interaction a real user performs (mirrors
 * `07-corrections.spec.ts`'s own `pickEmployeeInLookup` for the equivalent current-site lookup). */
async function pickStatementEmployee(page: import('@playwright/test').Page, employeeName: string) {
  const input = page.locator('#statement-employee');
  await input.fill(employeeName);
  const option = page.getByRole('option', { name: new RegExp(employeeName) });
  await expect(option.first()).toBeVisible({ timeout: 5000 });
  await option.first().click();
}

test.describe('Statements — Employee Statement of Account', () => {
  test('navigation, Employee-first selection, and full Statement rendering', async ({ authenticatedPage: page }) => {
    const context = page.context();
    const label = `stmt-${Date.now()}`;
    const { employeeId } = await createSiteWithEmployee(context, label);

    await ensureAnyPayrollCycleExists(context);
    const cyclesRes = await apiGet<{ cycles: CycleRow[] }>(context, '/api/v1/payroll-cycles');
    const anchor = cyclesRes.body.cycles[0]!; // newest first, matching the API's own ordering
    const anchorDate = `${anchor.year}-${String(anchor.month).padStart(2, '0')}-15`;

    const advanceRes = await apiPost<{ advance: { id: string } }>(context, '/api/v1/advances', {
      employeeId,
      type: 'LOAN',
      totalAmount: '15000',
      dateGiven: anchorDate,
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: anchor.year, month: anchor.month },
    });
    await apiPost(context, `/api/v1/advances/${advanceRes.advance.id}/cancel`, {
      reason: 'E2E Statements verification — no live deduction to reverse',
    });

    // --- Navigation ------------------------------------------------------------------------
    await page.goto('/');
    await page.getByRole('link', { name: 'Statements' }).click();
    await expect(page).toHaveURL(/\/statements$/);
    await expect(page.getByRole('heading', { name: 'Select Statement' })).toBeVisible();

    // --- Employee-first selection: no Site/Unit prerequisite ------------------------------
    const employeeInput = page.locator('#statement-employee');
    await expect(employeeInput).toBeEnabled();
    await pickStatementEmployee(page, `E2E Employee ${label}`);

    // --- Statement loads, header identifies it as a Statement (never a Payslip) ------------
    await expect(page.getByText('Employee Statement of Account')).toBeVisible();
    await expect(page.getByRole('heading', { name: `E2E Employee ${label}` })).toBeVisible();
    // Scoped to the main content area — the sidebar's own "Payslips" nav link legitimately
    // contains the substring "payslip" and would otherwise false-positive this check.
    await expect(page.locator('main').getByText(/payslip/i)).toHaveCount(0);

    // --- Opening / Closing Balances stay separate (Payable / Recovery / Advance) -----------
    await expect(page.getByText('Opening Balances')).toBeVisible();
    await expect(page.getByText('Closing Balances')).toBeVisible();
    // `.rounded-lg` is `Card`'s own distinguishing class (`card.tsx`) — CardHeader/CardContent are
    // plain divs without it, so this reliably selects the whole Closing Balances card (title +
    // figures together), not just whichever nested div happens to contain the title text.
    const closingCard = page.locator('.rounded-lg', { hasText: 'Closing Balances' });
    // v1.0.4 Cancel Business Semantics fix — cancelling an Advance waives whatever remained
    // unrecovered; this ledger's ADVANCE_CANCELLED event now carries a real DECREASE movement of
    // the true waived remainder (here, the full 15,000 — nothing was ever recovered), so Closing
    // Advance Outstanding correctly reads 0.00, never the stale full given amount. Scoped to the
    // specific "Advance Outstanding" figure — Payable/Recovery are also legitimately 0.00 here for
    // this freshly created employee, so a bare card-wide text match would be ambiguous.
    const closingAdvanceFigure = closingCard.getByText('Advance Outstanding', { exact: true }).locator('..');
    await expect(closingAdvanceFigure.getByText('PKR 0.00')).toBeVisible();

    // --- Ledger: two real financial movement rows (Given, then Cancelled) -------------------
    const givenRow = page.getByRole('row', { name: /Advance Given/ });
    await expect(givenRow).toBeVisible();
    await expect(givenRow.getByText(/\+\s*PKR 15,000\.00/)).toBeVisible();

    const cancelledRow = page.getByRole('row', { name: /Advance Cancelled/ });
    await expect(cancelledRow).toBeVisible();
    // No longer "Informational" — the waived remainder is a real ledger movement now.
    await expect(cancelledRow.getByText(/[-−]\s*PKR 15,000\.00/)).toBeVisible();

    // Running balances come straight from the backend DTO, per row — the ledger's column order is
    // Date/Period, Category, Description, Movement, Running Payable, Running Recovery, Running
    // Advance, so each row's own *last* cell is its running Advance Outstanding at that point.
    await expect(givenRow.locator('td').last()).toHaveText('PKR 15,000.00');
    await expect(cancelledRow.locator('td').last()).toHaveText('PKR 0.00');

    // Master Admin is always unrestricted — no Advance-restriction notice for this session.
    await expect(page.getByText(/advance history restricted/i)).toHaveCount(0);

    // --- No horizontal overflow (long descriptions/site names must wrap or scroll inside the
    //     ledger table, never blow out the page itself) ------------------------------------
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });

  test('viewing a Statement issues only GET requests — no mutation endpoint is ever called', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `stmt-nomutate-${Date.now()}`;
    await createSiteWithEmployee(context, label);

    const nonGetRequests: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET' && request.url().includes('/api/v1/')) {
        nonGetRequests.push(`${request.method()} ${request.url()}`);
      }
    });

    await page.goto('/statements');
    await pickStatementEmployee(page, `E2E Employee ${label}`);
    await expect(page.getByText('Employee Statement of Account')).toBeVisible();

    // Nothing recorded after `page.goto('/statements')` (the discovery search included) should
    // ever be a non-GET call — this page never mutates anything (Checkpoint 2 brief §11/12R).
    expect(nonGetRequests).toEqual([]);
  });

  /**
   * The genuine, previously-unreachable Advance-history restriction scenario (Checkpoint 2
   * correction — replaces this file's own earlier `page.route`-mocked version). A real employee
   * transfer, a real Site-A-only user, real discovery through historical `PayrollEntry.siteId`
   * attribution, and a real restriction notice — no interception, no fabricated DOM.
   */
  test('a Site-A-only user naturally discovers a transferred employee, views their permitted history, and sees the Advance-history restriction notice — no mocking', async ({
    authenticatedPage: adminPage,
    browser,
  }) => {
    const context = adminPage.context();
    const label = `stmt-transfer-${Date.now()}`;

    const siteA = await apiPost<{ site: { id: string; name: string } }>(context, '/api/v1/sites', {
      name: `E2E Statements Site A ${label}`,
    });
    const unitA = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${siteA.site.id}/units`, {
      name: `E2E Statements Unit A ${label}`,
    });
    const siteB = await apiPost<{ site: { id: string; name: string } }>(context, '/api/v1/sites', {
      name: `E2E Statements Site B ${label}`,
    });
    const unitB = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${siteB.site.id}/units`, {
      name: `E2E Statements Unit B ${label}`,
    });

    const employee = await apiPost<{ employee: { id: string } }>(context, '/api/v1/employees', {
      name: `E2E Transferred Employee ${label}`,
      designation: 'Guard',
      siteId: siteA.site.id,
      unitId: unitA.unit.id,
      grossPay: '30000',
    });

    // A Draft cycle's own reconcile-roster self-heals a missing entry for an employee created
    // after that cycle already existed (the same mechanism `payroll-entry-page.tsx` itself relies
    // on) — the one reliable way to give this employee a real, released Site-A PayrollEntry
    // without gambling on this shared suite's own cross-spec cycle timing.
    const cyclesRes = await apiGet<{ cycles: CycleRow[] }>(context, '/api/v1/payroll-cycles');
    const draftCycle = cyclesRes.body.cycles?.find((c) => c.status === 'DRAFT');
    test.skip(!draftCycle, 'No Draft payroll cycle exists yet — run the full suite, not this file alone.');
    if (!draftCycle) return;

    await apiPost(context, `/api/v1/payroll-cycles/${draftCycle.id}/reconcile-roster`, {});
    await apiPost(context, `/api/v1/payroll-cycles/${draftCycle.id}/units/${unitA.unit.id}/release`, {});

    // Real Advance history — this is exactly what must become invisible to the Site-A-only user
    // once the employee transfers to Site B (Advance has no historical site attribution of its
    // own, `statements-ledger.md §7` — gated by the employee's *current* site only).
    await apiPost(context, '/api/v1/advances', {
      employeeId: employee.employee.id,
      type: 'LOAN',
      totalAmount: '5000',
      dateGiven: `${draftCycle.year}-${String(draftCycle.month).padStart(2, '0')}-10`,
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: draftCycle.year, month: draftCycle.month },
    });

    // Transfer the employee to Site B — current Employee.siteId is now B; the released entry
    // above (siteId = Site A, frozen at creation) is untouched.
    await apiPatch(context, `/api/v1/employees/${employee.employee.id}`, {
      siteId: siteB.site.id,
      unitId: unitB.unit.id,
    });

    // --- Site-A-only user: statements:view, assigned to Site A only ------------------------
    const siteAEmail = `e2e-stmt-site-a-${label}@example.test`;
    const siteAPassword = 'E2EStatementsSiteA1!';
    await createScopedUser({
      email: siteAEmail,
      password: siteAPassword,
      roleCode: 'PAYROLL_STAFF',
      permissionKeys: ['statements:view'],
      siteIds: [siteA.site.id],
      name: 'E2E Site A Statements User',
    });

    const siteAContext = await browser.newContext();
    const siteAPage = await siteAContext.newPage();
    await login(siteAPage, siteAEmail, siteAPassword);

    await siteAPage.goto('/statements');
    // Discoverable purely through the Site-A historical PayrollEntry above — her *current* site
    // is B, entirely outside this user's own assigned sites.
    await pickStatementEmployee(siteAPage, `E2E Transferred Employee ${label}`);

    await expect(siteAPage.getByText('Employee Statement of Account')).toBeVisible();
    await expect(siteAPage.getByRole('row', { name: /Advance Given/ })).toHaveCount(0);
    await expect(siteAPage.getByText(/advance history restricted/i)).toBeVisible();
    await expect(siteAPage.locator('main').getByText(/no advances/i)).toHaveCount(0);

    await siteAContext.close();
  });
});

/**
 * Phase 7B Checkpoint 3 — Employee Statement Print & Export, real-browser verification. Frontend
 * only: PDF/XLSX/CSV export routes and Browser Print were already exercised at the backend/
 * PDF-template level (Checkpoints 1-2, `backend/tests/statement-export.test.ts`,
 * `statement-pdf-template.test.ts`); this file drives the real UI — the shared `PrintButton`/
 * `PrintSettingsDialog` architecture (`docs/architecture/print-architecture.md`) and three real
 * file downloads — against the real backend, no mocking.
 *
 * **Filename note (Phase 7B Checkpoint 3 post-review refinement)**: unlike the component-level unit
 * tests, this suite runs frontend (port 4200) and backend (port 4100) as genuinely separate origins
 * (`tests/e2e/setup/config.ts`), the same cross-origin shape production uses — so this is also the
 * real-browser proof that `backend/src/app.ts`'s `exposedHeaders` now includes
 * `content-disposition` (alongside the pre-existing `x-csrf-token`, unchanged): `fetch`'s
 * `response.headers.get('content-disposition')` is visible to this page's own JS here, and
 * `downloadEmployeeStatementExport` (`use-employee-statement.ts`) actually uses the backend's own
 * filename rather than its `employee-statement.{format}` fallback. Before this refinement, the
 * header was not CORS-exposed and every download below used the fallback name instead — see this
 * checkpoint's earlier final report for that prior state.
 */
test.describe('Statements — Print & Export (Phase 7B Checkpoint 3)', () => {
  test('Print/Export actions are absent before a Statement loads, and all four appear once it does', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `stmt-actions-${Date.now()}`;
    await createSiteWithEmployee(context, label);

    await page.goto('/statements');
    await expect(page.getByRole('button', { name: 'Print' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Export PDF' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Export Excel' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Export CSV' })).toHaveCount(0);

    await pickStatementEmployee(page, `E2E Employee ${label}`);
    await expect(page.getByText('Employee Statement of Account')).toBeVisible();

    await expect(page.getByRole('button', { name: 'Print' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export PDF' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export Excel' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible();
    // No dropdown/overflow/split-button menu was introduced — four explicit, always-visible buttons.
    await expect(page.getByRole('menu')).toHaveCount(0);
  });

  test('Print opens the shared print settings dialog (Landscape recommended for the Ledger) and completes with the dialog unmounted before window.print()', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `stmt-print-${Date.now()}`;
    await createSiteWithEmployee(context, label);

    // Captures state *inside* the `window.print()` stub itself — the same synchronous instant a
    // real print engine would capture — matching `13-print-architecture.spec.ts`'s own regression
    // discipline for the Production Print Defect (a settings dialog left mounted at print time).
    await page.addInitScript(() => {
      (window as unknown as { __printCapture: unknown }).__printCapture = null;
      window.print = () => {
        (window as unknown as { __printCapture: unknown }).__printCapture = {
          dialogPresent: document.querySelector('[role="dialog"]') !== null,
        };
      };
    });

    await page.goto('/statements');
    await pickStatementEmployee(page, `E2E Employee ${label}`);
    await expect(page.getByText('Employee Statement of Account')).toBeVisible();

    await page.getByRole('button', { name: 'Print' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Print settings')).toBeVisible();
    await expect(dialog.getByText('Auto')).toBeVisible();
    await expect(dialog.getByText('(Landscape)')).toBeVisible();
    await dialog.getByRole('button', { name: 'Print', exact: true }).click();

    const capture = await page.evaluate(
      () => (window as unknown as { __printCapture: { dialogPresent: boolean } | null }).__printCapture,
    );
    expect(capture?.dialogPresent).toBe(false);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  for (const { format, buttonName, extension } of [
    { format: 'pdf', buttonName: 'Export PDF', extension: 'pdf' },
    { format: 'xlsx', buttonName: 'Export Excel', extension: 'xlsx' },
    { format: 'csv', buttonName: 'Export CSV', extension: 'csv' },
  ] as const) {
    test(`Export ${format.toUpperCase()} downloads a real file from the backend export endpoint`, async ({
      authenticatedPage: page,
    }) => {
      const context = page.context();
      const label = `stmt-export-${format}-${Date.now()}`;
      await createSiteWithEmployee(context, label);

      await page.goto('/statements');
      await pickStatementEmployee(page, `E2E Employee ${label}`);
      await expect(page.getByText('Employee Statement of Account')).toBeVisible();

      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: buttonName }).click(),
      ]);

      expect(await download.failure()).toBeNull();
      // See this file's own module doc comment — now that `content-disposition` is CORS-exposed,
      // the backend's own richer filename (`employee-statement-{code-or-id}-{period-slug}.{ext}`,
      // `statements.routes.ts`'s `buildStatementFilenameStem`) is what the frontend actually uses.
      // Matched by pattern, not exact string — the code-or-id/period-slug segment legitimately
      // varies with fixture data and this suite's shared database state — but the hyphenated shape
      // is unambiguous proof this is the backend's name, not the bare `employee-statement.{ext}`
      // fallback (no hyphen after "statement") that ran before this refinement.
      expect(download.suggestedFilename()).toMatch(new RegExp(`^employee-statement-.+\\.${extension}$`));
      expect(download.suggestedFilename()).not.toBe(`employee-statement.${extension}`);
    });
  }

  test('actions are mutually exclusive: exporting one format disables Print and every other format until it finishes', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `stmt-mutex-${Date.now()}`;
    await createSiteWithEmployee(context, label);

    await page.goto('/statements');
    await pickStatementEmployee(page, `E2E Employee ${label}`);
    await expect(page.getByText('Employee Statement of Account')).toBeVisible();

    // Throttle the export response just enough to observe the mid-flight disabled state — the
    // real backend response is otherwise too fast in a local/E2E environment to reliably catch.
    await page.route('**/statement/csv**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
    });

    const exportCsvButton = page.getByRole('button', { name: 'Export CSV' });
    const downloadPromise = page.waitForEvent('download');
    await exportCsvButton.click();

    await expect(page.getByRole('button', { name: 'Print' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Export PDF' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Export Excel' })).toBeDisabled();
    await expect(exportCsvButton).toBeDisabled();

    await downloadPromise;
    await expect(page.getByRole('button', { name: 'Print' })).toBeEnabled();
    await expect(exportCsvButton).toBeEnabled();
  });

  test('print-readiness: selection/search controls hidden and Statement content visible under print media, no horizontal overflow', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `stmt-printready-${Date.now()}`;
    await createSiteWithEmployee(context, label);

    await page.goto('/statements');
    await pickStatementEmployee(page, `E2E Employee ${label}`);
    await expect(page.getByText('Employee Statement of Account')).toBeVisible();

    await page.emulateMedia({ media: 'print' });

    // Filter/search controls (Checkpoint 3's own Print Readiness audit item) — the whole "Select
    // Statement" card is print:hidden.
    await expect(page.getByRole('heading', { name: 'Select Statement' })).toBeHidden();
    await expect(page.locator('#statement-employee')).toBeHidden();

    // Statement content itself — identity, balances, ledger — stays visible and self-describing.
    await expect(page.getByRole('heading', { name: `E2E Employee ${label}` })).toBeVisible();
    await expect(page.getByText('Opening Balances')).toBeVisible();
    await expect(page.getByText('Closing Balances')).toBeVisible();
    await expect(page.locator('.print-flow table').first()).toBeVisible();

    // Actions themselves never print.
    await expect(page.getByRole('button', { name: 'Print' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Export PDF' })).toBeHidden();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    await page.emulateMedia({ media: 'screen' });
  });

  test('a user without statements:view never sees the Print/Export actions (page-level permission gate, no per-button check)', async ({
    authenticatedPage: adminPage,
    browser,
  }) => {
    const context = adminPage.context();
    const label = `stmt-noaccess-${Date.now()}`;
    const email = `e2e-stmt-noaccess-${label}@example.test`;
    const password = 'E2EStatementsNoAccess1!';
    // A brand-new role code, never a seeded one (`PAYROLL_STAFF`/`FINANCE`) — `createScopedUser`
    // upserts by role code, so reusing a seeded code would keep that role's own real, already-
    // granted permissions (including `statements:view`) rather than producing genuine zero access.
    // `Role.code` is `varchar(40)`, so this stays short rather than embedding the full `label`.
    await createScopedUser({
      email,
      password,
      roleCode: `E2E_NOACCESS_${Date.now()}`,
      permissionKeys: [],
      siteIds: [],
      name: 'E2E No-Access Statements User',
    });

    const noAccessContext = await browser.newContext();
    const noAccessPage = await noAccessContext.newPage();
    await login(noAccessPage, email, password);

    await noAccessPage.goto('/statements');
    // The route-level `RequirePermission` guard (`App.tsx`) intercepts before `StatementsPage`
    // itself ever mounts — its own inline `!canView` message (covered by the Vitest RBAC suite,
    // which renders the component directly, bypassing the router) is unreachable via real
    // navigation. This is the actual page-level gate a real user without `statements:view` hits.
    await expect(noAccessPage.getByText(/you do not have permission to access this page/i)).toBeVisible();
    await expect(noAccessPage.getByRole('button', { name: 'Print' })).toHaveCount(0);
    await expect(noAccessPage.getByRole('button', { name: 'Export PDF' })).toHaveCount(0);
    await expect(noAccessPage.getByRole('button', { name: 'Export Excel' })).toHaveCount(0);
    await expect(noAccessPage.getByRole('button', { name: 'Export CSV' })).toHaveCount(0);

    await noAccessContext.close();
  });
});
