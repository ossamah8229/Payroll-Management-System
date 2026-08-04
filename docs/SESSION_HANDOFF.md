# Session Handoff — Payroll Management System

Read this file first in any new session, alongside `docs/PROJECT_PROGRESS.md`. Together they should
be enough to resume correctly without re-deriving context from scratch — per
`docs/IMPLEMENTATION_PLAN.md`'s own "How to Resume This Project" section, the full read order is:
`docs/PROJECT_PRINCIPLES.md` → `docs/architecture/overview.md` → rest of `docs/architecture/*.md` →
`docs/IMPLEMENTATION_PLAN.md` → this file → `docs/PROJECT_PROGRESS.md`.

> **Currency notice (added 2026-07-16, superseded by §0 below, added 2026-07-18):** §1 below was
> last updated during Phase 2/2.5 and does not reflect Phase 3 onward — all of which is complete.
> **`docs/PROJECT_PROGRESS.md` §1 is the current, authoritative chronological record; treat it as
> correct wherever it disagrees with anything below §0.** The rest of this file (§1 onward) is
> retained as historical narrative of how each phase was actually built — still useful for *why*,
> not for *what's true now*. For current state, read §0 first.

---

## 0. Current state (authoritative as of 2026-07-19 — read this section first)

> **Update, 2026-08-04 (latest) — Phase 7H: Permanent PDF Test Infrastructure Stabilisation —
> IMPLEMENTED, awaiting review, NOT YET COMMITTED.** PR #6 (Phase 7F) was blocked by a CI failure
> that Phase 7G's own diagnostic fix (commits `cd71b5d`/`15a3776`) traced to
> `"Test environment has been torn down"` — proven (reproduction matrix across 5 call paths, not
> inferred) to be a Jest `--experimental-vm-modules` VM-lifecycle race in `browser.ts`'s dynamic
> `import('puppeteer')`, not a payroll defect: direct in-Jest calls failed 37/40 and 18/20 under
> concurrent stress; the identical render outside Jest entirely succeeded 20/20; the same work run
> from a child process spawned by a Jest test succeeded 10/10 under the identical stress. **Fixed**
> by moving real Puppeteer rendering to a persistent worker process
> (`backend/src/lib/pdf/worker/`) that is never itself inside a Jest VM realm — structurally
> immune, not merely less likely to fail. Two further bugs (a duplicate-spawn race and an
> orphaned-Chrome leak, both found while stress-testing the new architecture itself) were also
> fixed. Verified via 5× isolated + 5× combined + 3× full-backend-suite runs (3,843 total test
> executions): zero recurrences, zero lingering processes. The query-count flake (KI-10) is
> unrelated and untouched. Full detail: `docs/PROJECT_PROGRESS.md`'s "Phase 7H" entry and
> `docs/architecture/testing.md`'s "Backend PDF test architecture" section.

> **Update, 2026-07-30 — Phase 7D final refinement: EOBI Synchronisation Permissions &
> Audit — IMPLEMENTED, awaiting review, NOT COMMITTED.** Same-day follow-up overriding the entry
> directly below: the dual-permission requirement (`employees:edit` **and** `payroll:entry` before
> the synchronised write would proceed) is removed — the client clarified the synchronised write is
> an **internal system synchronisation, not a second user edit**, so each route now requires only
> its own pre-existing permission (`payroll:entry` alone for Payroll Entry, `employees:edit` alone
> for Employee Registry). This is **not** a bypass: a user still cannot reach the *opposite* route
> directly, for any field, without that route's own permission — re-verified explicitly with new
> tests 9c/9d. Audit events renamed and restructured: `employee.eobi_synced`/
> `payroll_entry.eobi_synced` (recorded only on the cascaded entity, with the directly-edited
> entity's own change folded anonymously into the generic bundle) become
> `employee.eobi_updated`/`payroll_entry.eobi_updated` (recorded on **both** entities whenever
> either changes, each carrying `metadata.origin: 'employee_registry' | 'payroll_entry'`,
> `eobiApplicable`/`defaultEobiApplicable` now excluded from the generic
> `payroll_entry.updated`/`employee.updated` bundle so there is exactly one dedicated entry per
> entity per change, never zero, never two). Transaction behaviour unchanged (same one transaction,
> same forced-failure rollback proof, updated for the renamed action). `eobi-bidirectional-sync.test.ts`
> rewritten, now 15 tests. Full backend suite re-run clean (same pre-existing, unrelated
> `corrections-service.test.ts` flake already on record). Full detail:
> `docs/PROJECT_PROGRESS.md`'s "Phase 7D final refinement — EOBI Synchronisation Permissions &
> Audit" entry. **No commit, push, or deployment occurred.**

> **Update, 2026-07-30 (superseded by the entry above for status purposes) — Phase 7D refinement: EOBI Bidirectional Synchronisation —
> IMPLEMENTED, awaiting review, NOT COMMITTED.** Same-day follow-up overriding the entry directly
> below: the client requires `Employee.defaultEobiApplicable` and the current Draft
> `PayrollEntry.eobiApplicable` to stay *consistent*, not merely both independently editable — a
> change on either screen now also writes to the other, inside the same DB transaction as the
> primary edit, via one new shared function (`backend/src/modules/payroll-entry/eobi-sync.service.ts`'s
> `syncEobiApplicability`), called from `employees.service.ts`'s `updateEmployee` and
> `payroll-entry.service.ts`'s `updatePayrollEntry`. Only the *current Draft* cycle's entry ever
> participates (found fresh via `status: 'DRAFT'`, never created if none exists — Employee
> Registry's value is simply retained as the future default); Released/Archived entries are
> structurally unreachable by that lookup, never touched. Each direction now additionally requires
> the *other* screen's own permission (`employees:edit` for a Draft-entry EOBI change,
> `payroll:entry` for an Employee Registry one) specifically when that field is part of the request
> — investigated first (the two routes genuinely gate on different permission keys; the seeded
> `PAYROLL_STAFF` role holds both today, but a custom role might not), so no cross-screen
> permission bypass is possible without weakening either existing permission. Two distinct audit
> actions (`employee.eobi_synced`/`payroll_entry.eobi_synced`), one per entity actually written,
> cross-referencing the originating screen/entry — never a duplicate-looking pair for one logical
> change. New test file `eobi-bidirectional-sync.test.ts` (13 tests, all 12 requested scenarios).
> **Backend: 1207/1208 tests passing** (62 suites) — the sole failure is a pre-existing,
> confirmed-unrelated timing-sensitive concurrency test (`corrections-service.test.ts`, a module
> this session never touched, passes cleanly in isolation). Frontend unaffected (234/234, no
> frontend change needed — both EOBI checkboxes already existed and call the same PATCH routes).
> Typecheck/lint/build clean (same two pre-existing, unrelated issues already on record). Full
> detail: `docs/PROJECT_PROGRESS.md`'s "Phase 7D refinement — EOBI Bidirectional Synchronisation"
> entry. **No commit, push, or deployment occurred.**

> **Update, 2026-07-30 (superseded by the entry above for status purposes) — Phase 7D, Payroll Master-Data Integrity & Payroll Entry UI
> Refinements — IMPLEMENTED, awaiting review, NOT COMMITTED.** Closes a production UAT-reported
> defect class: `PayrollEntry.designation`/`bankId`/`branchCode`/`accountNumber`/`iban` were
> duplicated columns, independently editable via `PATCH /payroll-entries/:id`, that could drift from
> Employee Registry's own record and go stale while an entry was still Draft. **Employee Registry is
> now the sole authoritative, editable source for these fields.** `updatePayrollEntrySchema`
> (`shared/src/schemas/payroll-entry.ts`) no longer accepts any of them — a PATCH that still sends
> them has them silently ignored, never persisted (verified test-side). While an entry is unreleased
> (`released = false` and `payoutOutcome = null`), `payroll-entry.service.ts`'s new
> `withLiveMasterData()` overwrites the entry's own stored columns with Employee Registry's *live*
> values on every read (list/get/mutation responses) — a Draft-cycle Employee Registry edit (a
> corrected bank account, a title change) is visible after an ordinary page refresh, no separate
> resync action. Once an entry resolves (`released = true`, or `payoutOutcome` set by a Unit release
> sweep), `payroll-release.service.ts`'s `releaseProjectUnit` now syncs those same five fields from
> Employee Registry's *current* record onto the entry's own columns at the exact moment of
> resolution (`liveMasterByEntryId`), freezing an accurate, permanent snapshot — replacing the old
> "frozen at creation/last-PATCH, whichever came later" behavior. **EOBI applicability
> (`eobiAmount`/`eobiApplicable`) deliberately stays untouched** — still a Payroll Entry PATCH-
> editable, cycle-specific toggle, not routed through Employee Registry. Every other payroll-cycle
> financial field (grossPay, days/hours/rates, leave, allowance, advances, fine, hold, remarks)
> remains exactly as Draft-editable as before. Frontend (`payroll-entry-row.tsx`): the five
> fields render as plain `ReadOnlyCell`s (matching the existing Code/Name pattern), no `<input>`/
> `<select>`; `columns.ts`'s `NAVIGABLE_COLUMN_IDS` updated to drop them from Arrow-key navigation.
> **Totals-row overlap** (production UAT, footer totals overlapping adjacent columns under large
> sums/headcounts) fixed structurally: `computeColumnWidths` now also measures each column's
> *summed footer total* (via a new `computeStaticFooterTotals`/`extractFooterValue`, reusing
> `computeServerSnapshot`), the same technique the Advance-balance-label width fix already
> established — never a font-size reduction. **Advance Balance presentation** (balance text crowding
> the row border) fixed via a new `InlineNumberCell` `compact` prop (`py-0.5` instead of `py-1`,
> applied only when a balance label is present) plus `BalanceLabel`'s `mt-0`/`leading-none` — row
> height (`ROW_HEIGHT = 40`) unchanged. **Payslip PDF company logo removed** (client requirement) —
> `lib/pdf/templates/payslip.ts`'s `<img>`/`PAYSLIP_EXTRA_STYLES`/`companyLogoDataUri` deleted
> entirely (`PayslipPdfMeta` no longer even accepts a logo), `.doc-header` renders the company
> name/address directly with no wrapping flex row; header geometry unchanged (verified via
> `pdf-template.test.ts`). Statement/Bank Sheet/Cash Receiving/Login/Sidebar/Company Settings logo
> behavior is completely untouched — each already renders its own logo independently (never shared
> code with the Payslip template). **A related pre-existing test-construction technique became
> obsolete and was rewritten, not silently left broken**: four tests (in
> `payroll-entry-release-readiness.test.ts` and `payroll-release-eligibility.test.ts`) constructed a
> "duplicate/missing banking data" release-block scenario by directly mutating a `PayrollEntry`'s own
> stale column via raw Prisma — exactly the stale-duplication defect this checkpoint eliminates.
> Rewritten to either simulate the equivalent state on the *Employee* record instead (still a real,
> defense-in-depth scenario, since `employees.service.ts`'s own `applyBankingInvariant` would reject
> it at the ordinary API boundary) or to explicitly assert the fix (a stale entry column no longer
> produces a false block; release/finalize now succeed). **Testing**: 2 new backend test files/
> significant additions (`payroll-entry-master-data-boundary.test.ts`, updates to
> `payroll-entry.test.ts`/`payroll-release.test.ts`/`pdf-template.test.ts`/the two eligibility files
> above) plus 1 new frontend Vitest file (`master-data-boundary.test.tsx`, 16 tests covering
> read-only cells, EOBI/financial-field editability, totals-width, and Advance Balance classes).
> **Full backend suite: 61 suites / 1195 tests, all passing** (confirmed via two full runs against an
> isolated, freshly migrated/seeded PostgreSQL instance — the first run's 15 apparent failures were
> traced to this session's own leftover debug-script data on a *different*, unintentionally-targeted
> Postgres instance, not a real regression; cleaned up and reconfirmed). **Full frontend suite: 25
> files / 234 tests, all passing.** Typecheck/lint/build clean across shared/backend/frontend (same
> two pre-existing, unrelated issues already on record — one e2e typecheck error in
> `08-role-administration.spec.ts`, two lint errors in `statements.test.ts` — both reconfirmed
> unrelated via `git diff`). **Known limitation**: Playwright/real-browser E2E verification could not
> be executed this session — this sandboxed environment cannot download the Playwright Chromium
> binary (no network access for browser-binary installs), the same category of environment
> constraint already on record for Phase 4/7C's deployment-verification gaps. Compensating evidence:
> every UI requirement (read-only cells, EOBI toggle, totals width, Advance Balance classes, row
> height) is covered by real-DOM Vitest component tests (`@testing-library/react`), and the full
> master-data-boundary contract (live refresh, PATCH rejection, release-time freeze, released-entry
> immutability) is covered by real HTTP + real Postgres backend integration tests — but no pixel-level
> browser screenshot exists for this checkpoint. **No commit, push, or deployment occurred — do not
> mark Phase 7D complete** until this report is reviewed. Full detail:
> `docs/PROJECT_PROGRESS.md`'s "Phase 7D" entry.

> **Update, 2026-07-28 (superseded by the entry above for status purposes) — Phase 7B, Checkpoint 1 (Backend Employee Statement PDF Export) is
> REVIEWED AND APPROVED, with one post-review refinement applied and verified: the endpoint always
> returns `Content-Disposition: attachment` — the originally-shipped `?disposition=inline|attachment`
> choice (mirroring Payslip's own dual-mode `/pdf` route) was removed, since a Statement will get its
> own dedicated browser-Print workflow in a later Phase 7B checkpoint, making a second "preview"
> responsibility on this one endpoint unnecessary. Employee Statement PDFs are always downloaded;
> Browser Print for Statements remains a separate, later, Not Started checkpoint. Adds one new
> backend route,
> `GET /api/v1/employees/:employeeId/statement/pdf`, reusing Payslip's own established Puppeteer/
> HTML-to-PDF architecture (`lib/pdf/render-pdf.ts`, the shared browser singleton, `PRINT_STYLES`,
> `escapeHtml()`) rather than introducing a second pipeline — the only new production code is one
> pure template (`lib/pdf/templates/statement.ts`) and the route/service wiring around it
> (`statements.routes.ts`/`statements.service.ts`'s new `generateStatementPdf`). Gated by the
> existing `statements:view` permission — **no new `statements:export` permission**, matching
> `payslips:view`'s own precedent of gating view and export uniformly (an explicit, approved Phase
> 7B architecture-review decision); the permission's metadata label was updated to reflect the
> broadened scope, the grant itself unchanged. The canonical `EmployeeStatement` DTO
> (`getEmployeeStatement()`) remains the sole financial source of truth — fetched exactly once per
> export, opening/running/closing balances rendered verbatim, never recalculated or netted. Supports
> genuine multi-page output (page-numbered footer, repeating table headers) — verified empirically
> against 1-page, 2-page, and 10-page (300-entry) fixtures; portrait A4 was sufficient for the
> approved 7-column ledger layout, no landscape fallback needed. Audited as a new `statement.exported`
> action, distinct from the existing `statement.viewed`. Excel export, CSV export, frontend download/
> print buttons, Reports, and Dashboard are all still separate, later, Not Started work — this
> checkpoint is backend PDF export only. **Testing**: 20 new pure-template tests
> (`statement-pdf-template.test.ts`) plus 14 new integration tests appended to `statements.test.ts`'s
> own PDF-export section (auth/RBAC/site-scope/concealment/range/audit/no-mutation/single-fetch/
> renderer-failure/multi-page) — full backend suite confirmed clean (see
> `docs/PROJECT_PROGRESS.md`'s "Phase 7B, Checkpoint 1" entry for exact counts); Payslip PDF
> regression suite re-run clean; typecheck/lint/build clean across shared/backend/frontend (one
> pre-existing, unrelated e2e typecheck error in `08-role-administration.spec.ts` and two pre-existing
> lint errors elsewhere in `statements.test.ts` were found, confirmed pre-existing via `git status`/
> isolated re-run, and left untouched — out of this checkpoint's scope). **Do not mark Phase 7B
> complete — Checkpoint 1 (this one) covers PDF only; Excel, CSV, frontend integration, and browser
> Print for Statements all remain separate, later checkpoints, each requiring its own go-ahead.**

> **Update, 2026-07-28 (superseded by the entry above for status purposes) — PHASE 7A IS COMPLETE.**
> Reviewed, approved, committed, pushed, and
> deployed. Phase 7A now delivers, end to end: the canonical Statement backend ledger (Checkpoint
> 1); the Statements frontend page (Checkpoint 2); historical employee discovery via
> `PayrollEntry.siteId`/`PayrollEntryWorkLine.unitId` (Checkpoint 2's own same-day correction —
> replacing the original, current-site-scoped Employee Lookup reuse, which an architectural review
> found made a transferred employee permanently undiscoverable to the very user who administered
> their history at their old site); Employee-first Statement selection (Site/Unit are optional
> narrowing filters only, never a prerequisite, and selecting an employee never implies visibility
> into their full history); and a naturally-reachable Advance-history restriction workflow, verified
> end to end with a real Site A → Site B employee transfer and a real site-scoped user — no
> `page.route` interception anywhere in the final test suite. Full test coverage: backend
> `statements.test.ts` **37/37**; directly-related regressions (`employees`/`advances`/
> `corrections-settlement`) **114/114**; frontend **180/180**; E2E `tests/e2e/specs/15-statements.spec.ts`
> **3/3**; typecheck/lint/build clean across shared/backend/frontend. Full record:
> `docs/PROJECT_PROGRESS.md`'s "Phase 7A — closure and landing" entry (commit SHAs and the
> push/deploy/post-deploy-verification outcome are recorded there once landed). **Phase 7 as a
> whole is NOT complete — Phase 7B (Statement Print/Excel export), Phase 7C (Reports), and Phase 7D
> (Dashboard) all remain Not Started, each requiring its own separate, explicit authorization.**

> **Update, 2026-07-28 (superseded by the entry above for status purposes) — Phase 7A Checkpoint
> 2's own disclosed Advance-restriction reachability gap is now CORRECTED. Still IMPLEMENTED,
> awaiting review — NOT
> committed, NOT pushed, NOT deployed.** A dedicated, read-only architectural investigation (full
> report delivered and approved before any code changed) confirmed the restriction notice below is
> correct and must remain, but was genuinely unreachable through the real UI — root cause:
> `employees.service.ts`'s `listEmployees` (backing the general `EmployeeLookup`) scopes by an
> employee's *current* site, the right rule for its real callers (Advances' Record Advance,
> Corrections' Request Correction — both forward-looking) but the wrong tool for Statements' own
> retrospective lookup. Approved fix (Option A): redesign Statements' own selection, leave
> `EmployeeLookup`/`listEmployees` completely untouched. **Implemented**: a new, Statements-only
> `GET /api/v1/statements/employees` (`statements.service.ts`'s `searchStatementEmployees`)
> discovers employees via historical `PayrollEntry.siteId`/`PayrollEntryWorkLine.unitId` — the same
> pattern `payslips.service.ts`'s `listPayslips`/`payroll-entry.service.ts`'s `listPayrollEntries`
> already use for their own site-scoped pickers/lists, never `Employee.siteId`; gated by
> `statements:view`, site-scope enforced server-side (`assertSiteAccess`/`getAccessibleSiteIds`),
> Master Admin unrestricted, minimum-identity response only (no salary/banking/Advance figures), a
> fixed 3-query cost proven independent of match count, **no schema/migration change, no new
> index**. A new, deliberately *separate* frontend picker
> (`components/statements/statement-employee-lookup.tsx`'s `StatementEmployeeLookup` +
> `hooks/use-statement-employees.ts`) — not a conditional flag added to the shared `EmployeeLookup`,
> keeping Advances/Corrections' own correctness completely isolated from this change (confirmed
> untouched: `employees.test.ts`/`advances.test.ts`/`corrections-settlement.test.ts` **114/114**).
> The Statements page (`statements-page.tsx`) is now **Employee-first**: the Employee field is
> always enabled, Site/Unit are optional narrowing filters only, and changing either after an
> employee is selected clears that selection outright (never silently re-validates it) — a new
> on-page note states explicitly that selecting an employee never grants visibility into their full
> history. Every other already-approved Checkpoint 2 behavior (opening/closing balances, ledger
> rendering, running balances, error/loading/empty states, read-only GET-only behavior, navigation/
> route gating) is unchanged. **The Advance-history restriction deliberately still follows the
> employee's *current* site** — `Advance` has no historical site attribution anywhere in this schema
> (a long-standing, already-documented limitation), so there is no principled historical mechanism
> to scope it any other way; this is exactly what makes the notice still meaningful once salary/
> correction history became historically discoverable. **The restriction notice is now naturally
> reachable** — `tests/e2e/specs/15-statements.spec.ts`'s own previously-mocked
> (`page.route`-intercepted) test is fully replaced with a genuine Site A → Site B employee-transfer
> scenario and a real Site-A-only user (`createScopedUser`), no interception, no fabricated DOM.
> **Testing**: 9 new backend tests (`statements.test.ts`'s new "Statement employee discovery" block)
> — full suite **37/37**; directly-related regressions **114/114**; backend typecheck/lint clean.
> Frontend: `statements-page.test.tsx` rewritten for the Employee-first flow (28/28), a new
> `use-statement-employees.test.ts` (4/4) — full frontend suite **180/180**; typecheck/lint/build
> clean across shared/backend/frontend. E2E: `tests/e2e/specs/15-statements.spec.ts` **3/3**,
> including the replaced real-transfer scenario. No `@payroll/shared` change; the full backend suite
> was deliberately not re-run (nothing outside the Statements module and its own directly-related
> regression suites changed). Full record: `docs/PROJECT_PROGRESS.md`'s "Phase 7A Checkpoint 2 —
> architectural investigation and correction" entry and
> `docs/architecture/workflows/statements-ledger.md §16`. **Do not mark Phase 7A complete until this
> checkpoint is reviewed and landed. Do not begin Print/Excel Statement export, Reports, or Dashboard
> without a separate go-ahead.**

> **Update, 2026-07-28 (superseded by the correction above for status purposes) — Phase 7A
> Checkpoint 2 (Statements frontend page) is IMPLEMENTED, awaiting review — NOT committed, NOT
> pushed, NOT deployed**, per explicit instruction to stop after
> implementation/tests/documentation. New `frontend/src/routes/statements-page.tsx` (plus
> `hooks/use-employee-statement.ts` and `components/statements/statement-labels.ts`) — a purely
> presentational consumer of Checkpoint 1's own canonical ledger endpoint; **no backend or shared
> package change, no migration** (`statements:view` and the route already existed). Navigation: a new
> "Statements" sidebar item (Payroll section, `statements:view`, `nav-config.ts`) and a lazy-loaded
> `/statements` route (`App.tsx`), following the exact `RequireSession`/`RequirePermission`
> composition every other route already uses. **Selection**: Site → Unit → Employee, reusing the
> existing `EmployeeLookup`/`useAccessibleProjectSites`/`useProjectUnits` building blocks rather than
> a second filtering system (Unit narrowing via `EmployeeLookup`'s own `restrictToEmployeeIds` prop,
> the same mechanism Corrections' Request Correction modal already established) — then a Statement
> Period picker bound to real `PayrollCycle` rows only ("Latest 12 Cycles" default, matching the
> backend's own fallback, or an explicit From/To Cycle pair with inline ordering validation), never an
> arbitrary date range. **Rendering — zero frontend financial calculation**: Opening/Closing Balances
> and every ledger row's own `runningBalances` are rendered exactly as the backend returns them, the
> three balances (Payable/Recovery/Advance) always visually separate, never netted; the
> informational-vs-financial-movement invariant renders as a plain "Informational" label (no monetary
> figure) or a signed amount + balance name, never invented Debit/Credit terminology; the
> Advance-history restriction notice renders on `scope.advanceHistoryIncluded === false`, worded to
> communicate restricted visibility without ever implying "no advances" or disclosing a hidden
> count/amount. 403/404/network-failure states are all handled, a 403/404 never offering retry and
> never distinguishing a genuine not-found from the backend's own deliberate zero-site-overlap
> concealment. **No Print/Excel export, Reports, or Dashboard work** — each remains a separate, later
> checkpoint, per this checkpoint's own explicit scope boundary. **Testing**: frontend suite
> **172/172** (50 new/extended — `statement-labels.test.ts`, `use-employee-statement.test.ts`,
> `statements-page.test.tsx`, four new `nav-config.test.ts` cases); typecheck/lint/build clean across
> shared/backend/frontend; a new permanent E2E spec (`tests/e2e/specs/15-statements.spec.ts`, **3/3
> passed**) against a freshly provisioned real backend/database/production frontend build, verifying
> navigation, the real Site → Unit → Employee selection workflow, a real financial-movement row
> (`ADVANCE_GIVEN`) and a real informational row (`ADVANCE_CANCELLED`) rendering correctly with
> correct per-row running balances, Opening/Closing Balances staying separate, no page-level
> horizontal overflow, and that viewing a Statement issues only `GET` requests (a live
> `page.on('request')` listener recorded zero non-`GET` calls). **One discrepancy discovered and
> fully disclosed, not silently patched**: the Advance-restriction-notice's own real trigger scenario
> (a site-scoped user who administered an employee's *old* Site, after that employee transferred
> elsewhere) is not reachable through this checkpoint's own Employee Lookup for *any* non-Master-Admin
> session — `employees.service.ts`'s `listEmployees` search matches only an employee's *current* site
> against the caller's own scope, so the exact user who would receive the restriction can never find
> that employee in the picker, and Master Admin is always unrestricted so can never trigger it either.
> The notice's own *rendering* is still verified live (one E2E test intercepts only the final
> `GET .../statement` response with a scope-restricted payload shaped exactly like the real DTO, over
> an otherwise entirely real login/navigation/selection flow — clearly commented in the spec as a
> disclosed compromise). Full record: `docs/PROJECT_PROGRESS.md`'s "Phase 7A, Checkpoint 2" entry and
> `docs/architecture/workflows/statements-ledger.md §15`. **Do not begin Print/Excel Statement export,
> Reports, or Dashboard without a separate go-ahead — none of the three is started.**

> **Update, 2026-07-27 (superseded by the entry above for status purposes) — Phase 7 has formally begun. Architecture review COMPLETE (read-only,
> no code); Phase 7A Checkpoint 1 (canonical Employee Statement of Account ledger, backend only) is
> COMPLETE, COMMITTED (`87e34d1`/`bdc4bfd`/`8d141b7`), PUSHED, AND DEPLOYED** — local `HEAD` and
> `origin/main` both confirmed at `8d141b7`; Render auto-deployed cleanly (no migration needed — no
> schema/migration change in this checkpoint); `/health` returned `{"status":"ok"}` consistently, the
> frontend root and `/login` both returned 200, and an unauthenticated probe of the new
> `/api/v1/employees/:id/statement` route returned `401` (not `404`), directly confirming the new
> backend build is live — the one production request this landing made, rejected before touching any
> data. **Authenticated production Statement UAT was NOT performed** (no production credentials in
> this environment); no production data was created, modified, or deleted. New module
> `backend/src/modules/statements/` — a purely derived,
> read-only ledger over `PayrollEntry`/`Correction`/`BalanceAdjustment`/`Advance`, exposing three
> independent running balances (Payable to Employee / Recoverable from Employee / Advance Outstanding
> — never combined), a hard informational-vs-financial-movement invariant, full negative-payroll and
> legacy-anomaly incorporation, and historical-site RBAC keyed off each `PayrollEntry`'s own frozen
> `siteId` (never the employee's current site). New `statements:view` permission, default-granted like
> `payslips:view`. No schema change, no new table, no index added (none was justified by the actual
> query shape). **Same-day gap-closure pass added**: a dedicated bounded-range opening-balance
> regression proof (no defect found), sensitive-document `Cache-Control: no-store`/`statement.viewed`
> audit/no-mutation regression coverage (no code change needed — already correct), and a new
> `EmployeeStatement.scope` field making the Advances-history site-scope limitation explicit rather
> than silent (zero weakening of the underlying security rule). **Final: 28/28 ledger tests, 123/123
> across every directly-related regression suite, zero regressions, backend typecheck/lint/build
> clean.** Full design record: `docs/architecture/workflows/statements-ledger.md`; full build record:
> `docs/PROJECT_PROGRESS.md`'s "Phase 7A, Checkpoint 1", "gap-closure pass", and "landing record"
> entries. **No frontend, print/export, Reports, or Dashboard work was done as part of this checkpoint
> — see the "Update, 2026-07-28" entry above: Phase 7A Checkpoint 2 (the Statements frontend page) is
> now implemented, awaiting review. Print/export, Reports, and Dashboard each remain a separate, later
> checkpoint requiring its own explicit authorization.**

> **Update, 2026-07-23 (latest same-day update) — Pre-Deployment Reliability Checkpoint (Payslip PDF
> Full-Suite Flakiness) is COMPLETE, NOT pushed.** `payslips.test.ts`'s intermittent full-suite
> failures were root-caused via extensive controlled reproduction (20 isolated + 10 full-suite runs,
> before/after the fix) to this shared host's own measured, severe ambient resource contention from
> processes outside this suite's control — never a codebase defect (the singleton Puppeteer browser
> lifecycle was reviewed and confirmed correctly bounded; zero leaked processes across 50+
> reproduction runs). Fixed with three lifecycle/resource measures — a bounded one-time
> render-recovery retry, the heaviest test recycling the shared browser after itself, and a
> file-scoped Jest timeout increase (15000ms → 45000ms, this file only) — backed by measured
> evidence, not a blind change. Result: PDF/timeout failures dropped from 2/20 to 0/20 in isolated
> runs and 2/10 to 1/10 in full-suite runs, the one remainder coinciding with a directly measured
> >5x host slowdown. **Reported honestly as a large, measured improvement — not a claim of absolute
> zero**, per this checkpoint's own explicit instruction. A separate, unrelated Prisma query-count
> flake was found and partially (not fully) mitigated; see `docs/release/KNOWN_ISSUES_v1.0.md` KI-10.
> Full record: `docs/architecture/testing.md`'s "Payslip PDF test reliability" section and
> `docs/PROJECT_PROGRESS.md` §1's own dated entry. **Do not re-open this investigation without new
> evidence; do not push or deploy without the user's own separate go-ahead.**

> **Update, 2026-07-23 (earlier same day) — Checkpoint 4D Correction and UAT Defect Remediation is
> COMPLETE, NOT pushed.** Three items: (1) the same-day Checkpoint 4D CSRF fix below was reviewed
> and its design **rejected** — an in-memory map coalescing concurrent requests, keyed by `req.ip`,
> is not a browser identity and cannot guarantee correctness across more than one backend process.
> Corrected to a stateless backend (unchanged from before Checkpoint 4C) plus a one-shot client-side
> recovery on a specifically recognized `CSRF_TOKEN_MISMATCH` code
> (`frontend/src/lib/api-client.ts`) — token rotation itself was untouched by the correction. (2) UAT
> Defect 1 fixed: a custom role granted `sites:manage` could create a Project Site but never see it
> or any other site (`listProjectSites` scoped visibility to the literal Master Admin role code only;
> `sites:manage` is a global `CRITICAL_ADMIN_PERMISSIONS` capability and now grants the same
> unrestricted visibility any role holding it). (3) UAT Defect 2 fixed: the Roles & Permissions
> dialog's excessive empty scrolling / frame desync, caused by a nested independent scroll region
> inside the permission matrix — fixed at the shared `ModalContent`/`ModalFooter` level (proper flex
> column, one scroll region, sticky footer), benefiting every dialog in the app. Full record:
> `docs/architecture/authentication.md` ("Checkpoint 4C/4D" section, now describing the corrected
> design, and its new "UAT Defect 1" note) and `docs/PROJECT_PROGRESS.md` §1's own dated
> "Checkpoint 4D Correction and UAT Defect Remediation" entry (following the original, now-superseded
> Checkpoint 4D entry). **None of these three items is an open item anymore — do not re-open or
> re-fix without a new, genuinely reproduced defect. Do not reintroduce an IP-keyed CSRF design.**

> **Update, 2026-07-22 — Post-Phase-5 Stabilization Checkpoint 5 (Administration & Security
> Management Phase 1) is COMPLETE**, committed as `bf1a749`/`5983232`/`2e4c81f`, **not pushed**. A
> Master User can now create/rename/duplicate/deactivate/delete roles and their permission matrix,
> and reassign a user's role, entirely at runtime — no source-code change or redeployment. One role
> per user, per-user permission overrides, and multi-role assignment remain explicitly out of
> scope. Full record:
> `docs/PROJECT_PROGRESS.md` §1's own dated entry (same section, following Phase 6 Checkpoint 7A).
> Everything below this notice describes state as of Phase 6's close and is otherwise still
> accurate.

**All of Phases 0–5, all four Post-Phase-5 Stabilization checkpoints, and all of Phase 6
(Corrections & Balance Adjustments) are complete. Phase 6 is CLOSED.** The
Architecture Review and its Product Decision Resolution (both review-only, no repository changes)
are complete, refining the design frozen alongside Phase 3 (2026-07-05); see
`docs/PROJECT_PROGRESS.md` §3 for that record.
**Checkpoints 1 (Corrections Domain & Schema Foundation), 2 (Baseline Reconstruction & Delta
Calculation Engine), 2A (review-only verification, no defects found), 3 (Transactional Correction
Approval & Balance Adjustment Creation), 4 (Settlement, Payment Recording & Outstanding Balance
Lifecycle), 5 (Draft-Cycle Materialization of Outstanding Balance Adjustments), 5A (review-only —
found and fixed a genuine reservation-vs-settlement double-processing defect), 6 (Corrections
Ledger, Review Queue & Frontend Operational Workflow — the frontend now exists), 6A (review-only —
fixed a Corrections-sidebar-visibility gap for `corrections:approve`-only reviewers), and 7
(End-to-End Financial Lifecycle Validation, Audit Hardening & Phase 6 Close-Out) are all
complete** — see `docs/PROJECT_PROGRESS.md` §1's own dated entries for each. Checkpoint 3 was the
first to write data (`CorrectionRequest` creation/approval/rejection, immutable `Correction` +
`BalanceAdjustment` creation). Checkpoint 4 added manual settlement recording against an outstanding
`BalanceAdjustment` — a standalone `CorrectionPayment` (`PAYABLE`, always full) and a repeatable
cycle-scoped `BalanceAdjustmentSettlement` (partial-or-full, either type), both behind their own
dedicated advisory lock, plus the departed-employee `RECOVERY` rule ("remains permanently pending,"
per the Product Decision Resolution). Checkpoint 5 added a new `BalanceAdjustmentMaterialization`
reservation model (17th migration, approved only after three rounds of user-driven schema revision
— see `docs/PROJECT_PROGRESS.md` §1's own Checkpoint 5 entry for the full record) that projects an
eligible `PAYABLE`(`DEFERRED`)/`RECOVERY` obligation into the current Draft cycle's own
`PayrollEntry` (two new aggregate columns feeding `calcNet`), wired automatically into
`archiveAndCreateNextPayrollCycle` as the second consumer of the existing Materialization Hook seam
— materialization was a reservation/projection only at that point; it never touched
`BalanceAdjustment.remainingAmount`/`.status`, and never created a `CorrectionPayment`/
`BalanceAdjustmentSettlement`. Checkpoint 5A found that settlement recording had never actually been
made reservation-aware — an amount already reserved into a Draft cycle could also be settled
independently, double-processing the same obligation — and fixed it (`RESERVED_AMOUNT_UNAVAILABLE`),
with no schema change. Checkpoint 6 built the frontend: a Review Queue and Corrections Ledger
under `/corrections`, request creation from an eligible Released/Archived Payroll Entry with live
preview, approval/rejection dialogs, BalanceAdjustment/materialization/settlement presentation, and
reservation-aware standalone settlement recording — plus two minimal, read-only backend additions
(`GET /adjustment-types`, `GET /balance-adjustments` list). Checkpoint 6A fixed the sidebar gap
above. **Checkpoint 7 closed the one remaining structural gap: the `ACTIVE -> CONSUMED`
materialization transition, deferred by every prior checkpoint as "a later checkpoint's own event."**
Without it, a materialized obligation could never actually reach `SETTLED` through any supported
workflow — Checkpoint 5A's own `RESERVED_AMOUNT_UNAVAILABLE` ceiling correctly blocked
double-processing an active reservation, but nothing ever *resolved* it either. Fixed using the
`settlementId`/`consumedAt` columns Checkpoint 5's own schema already reserved (**no migration**):
`payroll-release.service.ts`'s `releaseProjectUnit` — the moment a `PayrollEntry` actually releases —
now consumes every `ACTIVE` materialization reserved against the entries it just released, inside
that same transaction, third participant in Checkpoint 5's "cycle, then adjustment" lock order. A
companion eligibility fix (`TARGET_ENTRY_ALREADY_RELEASED`) closes the race this makes load-bearing.
`CANCELLED` remains unbuilt (one narrow pre-existing edge case — a `hold`-marked entry with an
already-materialized obligation — documented, not fixed, no proven need). See
`docs/PROJECT_PROGRESS.md` §1's own Checkpoint 7 entry and
`docs/architecture/workflows/corrections-and-balance-adjustments.md`'s own Checkpoint 7 scope note
for the full record. **No bank-sheet/cash-sheet integration was added — Bank Sheets/Cash Receiving
Sheets/Payslips already reflect a materialized correction balance automatically, since all three
reuse the same shared `computeEntryCalc`.** **Checkpoint 7A (documentation/UX only, no production
code changed) then created the Phase 6 living HTML prototype every prior phase already had —
`docs/prototypes/phase6-corrections-preview.html`, 13 tabs traced to the real implementation, zero
console errors under a headless-browser pass — restoring parity with Phases 1–5's own prototype
convention.** Do not begin Phase 7 without its own separate, explicit go-ahead.

**Latest commits:** Post-Phase-5 Stabilization Checkpoint 5's three commits — database/backend role
administration `bf1a749`, frontend role/user administration `5983232`, tests and documentation
`2e4c81f` — **not pushed**. Before that: Phase 6 Checkpoint 6's implementation (`0256ab4`) and
doc-hash follow-up (`790147c`); Phase 6 Checkpoint 6A's implementation/test commit `9d6a39b`; Phase
6 Checkpoint 7's implementation/test commit `4812971`; Phase 6 Checkpoint 7A's prototype commit
`039b109`.

**Stabilization checkpoints, all complete:**
- **Checkpoint 1** (AUD-001–005: backend start-script fix, CSV-formula-injection sanitizer,
  malformed-UUID 400 handling, Payslips filter alignment, the Phase 5 prototype) — `638f45c`/`a139931`.
- **Checkpoint 2** (AUD-006/007/008/010: prototype icon/emoji cleanup, prototype shell-scroll fix,
  contrast, control-height/table-density consistency, full living-prototype reconciliation) —
  `d1c543e`/`2d4e167`.
- **Checkpoint 3** (AUD-009 session revocation on password change/reset; AUD-011 stale `GENERATING`
  Backup Package recovery) — `3102c74`/`31e688f`.
- **Checkpoint 4** (AUD-012 route-level frontend code splitting; AUD-013 the permanent Playwright
  E2E harness, `tests/e2e/`, plus the documentation reconciliation it identified as needed) —
  `4764afb`.
- **Checkpoint 5** (Administration & Security Management Phase 1 — dynamic roles, permission
  matrix, and runtime user role assignment; the final-active-administrator safeguard; session
  revocation on role change) — `bf1a749`/`5983232`/`2e4c81f`, **not pushed**. See
  `docs/PROJECT_PROGRESS.md` §1 for the full record.

**Phase 6, in progress:**
- **Checkpoint 1** (Corrections Domain & Schema Foundation — five new models, five new enums,
  migration `20260718100000_phase6_corrections_domain`, no calculation/approval/settlement/API/
  frontend logic) — `ac58748`.
- **Checkpoint 2** (Baseline Reconstruction & Delta Calculation Engine — pure functions only, no
  schema change, no side effects; `backend/src/modules/corrections/`: baseline reconstruction,
  delta calculation, the advisory-lock helper, full domain validation) — `1002209`.
- **Checkpoint 2A** (review-only verification — no defects; two test coverage gaps closed) —
  `1aede0a`.
- **Checkpoint 3** (Transactional Correction Approval & Balance Adjustment Creation — the first
  checkpoint to write data; `corrections.service.ts`/`corrections.routes.ts`: request
  creation/listing/detail, transactional approve/reject, immutable `Correction` +
  `BalanceAdjustment` creation, advisory-lock-protected concurrency, one aggregate audit event per
  approval) — `6189ba9`.
- **Checkpoint 4** (Settlement, Payment Recording & Outstanding Balance Lifecycle —
  `corrections.settlement.ts`/`.service.ts`/`corrections.routes.ts`'s new `balanceAdjustmentsRouter`:
  standalone `CorrectionPayment` + cycle-scoped `BalanceAdjustmentSettlement` recording, partial/
  full settlement, a dedicated `BalanceAdjustment`-scoped advisory lock, the departed-employee
  `RECOVERY` rule) — `9f9c88d`.
- **Checkpoint 5** (Draft-Cycle Materialization of Outstanding Balance Adjustments — new
  `BalanceAdjustmentMaterialization` reservation model (migration
  `20260718110000_phase6_correction_materialization`); `corrections.materialization.ts`/`.service.ts`/
  `corrections.routes.ts`'s new `payrollCycleMaterializationsRouter` + `balanceAdjustmentsRouter`
  additions; `calcNet`/`computeEntryCalc` extended; wired into
  `archiveAndCreateNextPayrollCycle` as the Materialization Hook seam's second consumer; a real
  cross-checkpoint deadlock between materialize and settle found under concurrent-load testing and
  fixed via a new `error-handler.ts` mapping, not by changing either transaction) — see
  `docs/PROJECT_PROGRESS.md` §1's own Checkpoint 5 entry for commit hashes.
- **Checkpoint 5A** (review-only — Reservation vs Settlement Consistency Review; found and fixed one
  genuine defect: settlement recording ignored active Draft-cycle reservations. Every settlement
  path now reads `getActiveReservedAmount` and rejects `RESERVED_AMOUNT_UNAVAILABLE`; no schema
  change) — `9d19cbb`/`b8a3e81`.
- **Checkpoint 6** (Corrections Ledger, Review Queue & Frontend Operational Workflow — the frontend:
  `frontend/src/routes/corrections-page.tsx`/`correction-request-detail-page.tsx`/
  `balance-adjustment-detail-page.tsx`, `frontend/src/components/corrections/*` (four modals + pure
  label helpers), three new hooks; wired into `App.tsx`/`nav-config.ts` and a "Request Correction"
  toolbar action on `payroll-entry-page.tsx`. Two minimal, read-only backend additions:
  `GET /adjustment-types` (new module) and `GET /balance-adjustments` (list, added to the existing
  router) — both reuse existing repository shapes, no migration, no new permission key) — see
  `docs/PROJECT_PROGRESS.md` §1's own Checkpoint 6 entry for commit hashes.
- **Checkpoint 6A** (review-only — Corrections Navigation Permission Verification & Focused Fix;
  found and fixed one real gap: `nav-config.ts`'s Corrections sidebar item was gated on
  `payroll:entry` alone, so a `corrections:approve`-only reviewer couldn't see it at all, even
  though the Review Queue and its backend route are authorized for exactly that permission.
  Frontend-only fix — `NavItem.requiredPermission` now accepts an OR-array, a new
  `frontend/src/lib/permissions.ts` centralizes the corrections-domain permission rule, four
  call sites switched from ad hoc inline checks to it. No backend change, no new permission key,
  no schema change) — `9d6a39b`.
- **Checkpoint 7** (End-to-End Financial Lifecycle Validation, Audit Hardening & Phase 6 Close-Out —
  full lifecycle/audit/API/permission/reporting/export validation across every Checkpoint 1–6A flow;
  found and fixed one genuine gap, the `ACTIVE -> CONSUMED` materialization transition: new
  `consumeMaterializationsForReleasedEntries` (`corrections.materialization.service.ts`), wired into
  `payroll-release.service.ts`'s `releaseProjectUnit` at the exact moment a `PayrollEntry` releases,
  using the `settlementId`/`consumedAt` columns Checkpoint 5's own schema already reserved — no
  migration. Companion eligibility fix `TARGET_ENTRY_ALREADY_RELEASED`
  (`corrections.materialization.ts`). 9 new backend tests
  (`corrections-release-consumption.test.ts`), Scenario 4 of the E2E corrections spec extended to
  drive a PAYABLE obligation all the way to `SETTLED` through the real browser/backend/database) —
  `4812971`. **Phase 6 is now fully closed.**

**Current verified test counts** (see `docs/architecture/testing.md` for what each suite covers and
how its database is provisioned — treat any older count anywhere else in this file as a historical
snapshot, not current): backend **791/791** on a clean run (one query-planner-sensitivity-under-load
transient failure in `payroll-entry-performance.test.ts` observed on a full-suite run, confirmed
clean on an isolated re-run — the same already-documented flaky pattern, unrelated to corrections;
the up-to-11 pre-existing `payslips.test.ts` failures on environment-load-affected runs remain the
same confirmed non-deterministic flakiness, not a fixed defect), frontend **61/61**, E2E **21/21**
(Scenario 4 extended in place, not a new scenario — count unchanged). 17 migrations, zero schema
drift.

**Exact next step:** Phase 7 — but only on its own explicit authorization. **Phase 6 is fully closed
as of Checkpoint 7; do not begin any Phase 7 work without a separate, explicit go-ahead.** The
up-to-11 `payslips.test.ts` failures (PDF generation returning 500/400) remain open and unrepaired,
confirmed environment-load-sensitive rather than a stable failure — still worth a dedicated
investigation pass, independent of any phase's own close-out.

**Render production deployment update (added after this section's 2026-07-19 authoritative
snapshot):** the backend is now live on Render, and the Puppeteer/Chrome runtime-provisioning
defect that blocked production Payslip PDF generation (`Could not find Chrome (ver.
150.0.7871.24)`) is resolved — full incident record, root cause, and the verified dashboard
Build/Start commands are in `docs/RENDER_PRODUCTION_DEPLOYMENT.md`. Production login and one
individual Payslip PDF (open + download) were manually verified against the live deployment; this
closes the production PDF deployment blocker specifically. **Batch Payslip generation and broader
production verification (font rendering, memory stability under a real batch, graceful shutdown)
remain separate, not-yet-performed work — do not treat them as verified on the strength of the one
individual PDF above.**

**Essential commands** (see `docs/architecture/testing.md` for the full breakdown):

```bash
npm install
npx playwright install chromium   # once — E2E's own browser binaries

npm run typecheck && npm run lint && npm run build

npm run test:backend              # requires a provisioned payroll_dev — docs/architecture/testing.md
npm run test:frontend
npm run test:e2e                  # provisions and tears down its own database automatically
```

---

## 1. Current repository status

- Branch: `main`
- **This session (2026-07-14) ran the Phase 5 architecture review (approved, no redesign required —
  see `docs/PROJECT_PROGRESS.md` §1's "Phase 5 architecture review" entry) and implemented Phase 5
  Checkpoint 0 — `StorageProvider` Foundation. Reviewed, approved, a final narrow pre-commit
  verification pass found and fixed two real gaps (absolute paths in error messages; missing
  explicit directory/file permissions — see `docs/PROJECT_PROGRESS.md` §1's "final narrow pre-commit
  verification pass" entry), and COMMITTED as `d87b9b0`.** `backend/src/lib/storage/`
  (`StorageProvider` interface + `LocalFilesystemStorageProvider`, the storage abstraction
  originally planned for Phase 0 and never built — `docs/PROJECT_PROGRESS.md` §3 item 4, now
  closed), a new required `STORAGE_ROOT` env var, and `backend/tests/storage.test.ts` (46 tests
  total). Full backend suite **392/392** (383 prior + 9 from the final verification pass);
  typecheck/lint/build clean across all three workspaces; `prisma validate` clean (no schema
  change). One real defect found and fixed during initial implementation — a Jest/Node VM-realm
  `instanceof Error` gotcha in the containment check's error-type guard, fixed via duck-typing;
  two further real gaps found and fixed during the final verification pass (see above) — all
  confirmed stable across repeated isolated test runs. No HTTP route added (deliberately deferred to
  the `BackupPackage` checkpoint, which has a real domain record to authorize a download against);
  no Finalize Cycle, `BackupPackage`, archiving, new-cycle-creation changes, or historical cycle
  selection — all explicitly out of this checkpoint's scope and unstarted. Full record:
  `docs/PROJECT_PROGRESS.md` §1's "Phase 5, Checkpoint 0" and "final narrow pre-commit verification
  pass" entries.
- **Later the same day (2026-07-14): Phase 5 Checkpoint 1 — Finalize Payroll Cycle.** The explicit
  `DRAFT` → `RELEASED` cycle-level transition: `POST /api/v1/payroll-cycles/:cycleId/finalize`
  (`finalizePayrollCycle`, `payroll-processing.service.ts`), reusing `payroll-cycle:manage`.
  No-override precondition (zero `PayrollEntry` rows with `released = false AND hold = false`),
  atomic conditional `updateMany` concurrency guard, exactly one `payroll_cycle.released` audit row
  per successful finalize. Frontend: a "Finalize Cycle" action on the Salary Release page, gated by
  permission and Draft-only, behind a confirmation modal.
  **Editability invariant, corrected across every mutation surface (two passes, same day):**
  `PayrollEntry` immutability is driven exclusively by `released = true`, never by
  `PayrollCycle.status`. The first pass fixed `assertEntryEditable` (single-entity update/delete,
  work-line add/update/delete); a same-day final review found two further surfaces —
  `bulkUpdatePayrollEntries` ("Copy to All") and `importPayrollEntries` (CSV/Excel import) — carried
  their own independent, equally-dormant `cycle.status !== 'DRAFT'` gate and needed the identical
  fix. Advance Deduction Deferral needed no code change (it already calls `assertEntryEditable` on
  the source entry) but is now explicitly documented and tested. Every other `cycle.status` check in
  the codebase was reviewed and confirmed to guard something else (cycle creation, Late Entry
  creation boundary, per-Unit release, finalization itself, Advance target-period validity) and was
  left untouched. Full record: `docs/PROJECT_PROGRESS.md` §1's "Phase 5, Checkpoint 1" and "final
  review corrections" entries.
  **Tests:** 27 in `payroll-cycle-finalize.test.ts`, plus corrections/additions in
  `payroll-entry.test.ts`, `payroll-entry-import-export.test.ts`, and `advances.test.ts` (64 total
  across these four files, run 3× in immediate succession with identical results each time).
  **Full backend suite, run once against a freshly provisioned, isolated PostgreSQL instance and a
  clean process state (all stale Jest/Node/Puppeteer/Postgres processes from prior sessions killed
  first): 420/420, all 26 suites green, zero failures.** Earlier verification passes this same day,
  against a long-lived Postgres instance reused from an unrelated prior session, had shown 11
  `payslips.test.ts` PDF-rendering failures (assumed at the time to be the same "pre-existing,
  environment-dependent" issue Checkpoint 0's own session had already logged) plus one occasional,
  non-reproducing failure elsewhere. **The clean re-run traced the real cause: a days-old, orphaned
  Puppeteer/Chrome-for-Testing process, left running from a completely different session's
  scratchpad, was interfering with the PDF-generation path's own Puppeteer usage.** Once killed and a
  genuinely isolated environment was used, all failures disappeared. This corrects the record — those
  failures were not an inherent limitation of this sandbox, and should not have been characterized as
  "baseline instability" without first checking for exactly this kind of leftover process.
  **Browser/Playwright verification remains outstanding** — no `playwright` dependency, config, or
  test directory exists anywhere in this repository, and no browser-automation tool is available in
  this session's toolset; this is not a gap this checkpoint's own scope requires installing new
  tooling to close (the repository defines no supported setup to fall back to). What *was* verified:
  the frontend production build succeeds cleanly, Vite's dev transform of the modified files succeeds
  with no errors, and the real production-build HTTP flow (login → CSRF → block → hold → finalize →
  persisted status/audit → second-attempt-fails → held entry editable via both single-entity PATCH
  and bulk update) was driven end-to-end against the compiled `dist/` build and the fresh database. A
  future session with access to a browser-automation tool should still click through the Salary
  Release page's Finalize flow visually before this is considered fully verified.
- **Later still the same day (2026-07-14): Phase 5 Checkpoint 2 — Backup Packages: reusable domain
  and generator — COMMITTED as `3ea879e`.** A read-only architecture review ran first (approved
  with six final decisions — include Payroll Entry XLSX; reuse `payroll-cycle:manage`; synchronous
  generation; individual files + manifest, not a persisted ZIP; no frontend UI this checkpoint;
  defer Payslip PDFs and an Audit Log export), then implementation:
  `BackupPackage`/`BackupPackageFile` (additive migration `20260714180000_backup_packages`, amended
  from the originally frozen sketch with `status`/`generatedBy`/`failureReason` and
  `filename`/`contentType`/`checksum`/`sortOrder`), a new `backend/src/modules/backup-packages/`
  module (`generateBackupPackage` — Draft cycles rejected, version reserved atomically before any
  storage write, content assembled purely via existing export builders, `manifest.json` built last
  with a canonical-JSON checksum, cross-system ordering per Checkpoint 0's own frozen decision,
  best-effort cleanup + `FAILED` on any error), four new routes (generate/list/detail/download, all
  `payroll-cycle:manage`, Master-Admin-only), and a new combined Bank Sheets CSV builder
  (`bank-sheets.service.ts`, loops the existing per-bank `getBankSheet()` rather than a second query
  path). A same-day, 12-point final verification pass (before commit) found and fixed one real
  gap — list/detail responses were leaking each file's raw `storageKey` — and added 6 further
  regression tests (32 total in `backup-packages.test.ts`), plus the existing Bank Sheets/Cash
  Receiving/Payroll Entry export regression suites re-run clean; full backend suite **452/452**.
  Full record: `docs/PROJECT_PROGRESS.md` §1's "Phase 5, Checkpoint 2" and "final narrow
  verification pass" entries.
- **This session (2026-07-15): Phase 5 Checkpoint 3 — Cycle Archiving, Automatic Backup Generation,
  and New-Cycle Rollover — COMPLETE, COMMITTED as `957ab9d`.** A read-only
  architecture review ran first (approved with six final decisions — dedicated rollover endpoint;
  plain cycle-creation route restricted to the very-first-cycle case; a minimal frontend slice ships
  this checkpoint; next period always derived automatically, no override; additive
  `PayrollCycle.archivedWithBackupPackageId` FK; departed-employee visual indicator deferred), then
  implementation: `POST /api/v1/payroll-cycles/:cycleId/archive-and-create-next`
  (`archiveAndCreateNextPayrollCycle`, `payroll-processing.service.ts`) — one transaction (archive
  outgoing cycle, commit fresh Backup Package `READY` metadata, create next Draft with a derived
  year/month, bootstrap entries, materialize Advances, three audit entries), preceded by the
  necessarily non-transactional Backup Package reserve/assemble/storage-write. `backup-packages
  .service.ts`'s generator refactored into four composable phases so rollover reuses it rather than
  duplicating logic; manual generation's own behavior unchanged. `createPayrollCycle`'s bootstrap
  extracted into a shared helper. Closes the departed-employee Advance-materialization gap that
  `advances.service.ts` had documented as an accepted limitation since Phase 4. Corrected
  `docs/architecture/workflows/outstanding-obligations.md`, which had drifted into describing a
  generic provider registry as already-adopted convention (never built) and listing `BalanceAdjustment`
  (Phase 6, not yet built) as "today's" provider. Frontend: "Start New Payroll Cycle" moved to the
  Salary Release page next to Finalize Cycle; the Payroll Entry page's redundant toolbar button
  removed and its empty state split into two cases. One additive migration
  (`20260715142622_payroll_cycle_archived_with_backup_package`). 17 new tests
  (`payroll-cycle-rollover.test.ts`) plus 4 existing tests corrected across `payroll-cycle.test.ts`
  (3) and `payslips.test.ts` (1) to reach a second cycle via Finalize + rollover instead of a now-
  disallowed second plain-route call. Full backend suite **469/469**. Two real defects caught by this
  checkpoint's own new tests before commit: a storage-cleanup-array-by-reference bug in the phase
  refactor, and an invalid `cycleDays = 0` on departed-obligation work lines (violates the
  `cycleDays BETWEEN 1 AND 31` check constraint — fixed to the ordinary schema default, 30; "no work
  performed" is expressed via `days`, not `cycleDays`). Real-stack verification: real PostgreSQL
  (embedded-postgres, re-provisioned this session), real filesystem `StorageProvider`, compiled
  backend, real login/CSRF/cookies — both via `supertest` and, in a same-session final-verification
  pass, live `curl` HTTP against the compiled server (create first cycle → finalize → edit a held
  entry → rollover → confirm the Backup Package reflects the edit → confirm archive/new-Draft/
  Advance-materialization → confirm a second rollover attempt and a second plain-creation attempt
  both fail). That same final-verification pass strengthened three existing tests to explicitly
  assert concurrency/field/immutability properties the checkpoint review required proving directly.
  Full record: `docs/PROJECT_PROGRESS.md` §1's "Phase 5, Checkpoint 3" entry. **Do not begin Phase 5
  Checkpoint 4 (Payroll Cycle Selector) or Phase 6 without their own explicit go-ahead.**
- **This session (2026-07-16): Phase 5 Checkpoint 4 — Historical Payroll Cycle Selector —
  COMPLETE, COMMITTED as `10e3194`.** A read-only architecture review ran first
  (approved with four final decisions — Archived cycles are fully locked for ordinary Payroll Entry
  editing; historical navigation uses route segments `/payroll-cycles/:cycleId/...`; the Payroll
  Cycle list stays globally visible, data stays server-side permission/site-filtered; historical
  export filenames include the payroll period), then implementation. **Backend:**
  `assertEntryEditable` extended to also reject once `cycle.status === 'ARCHIVED'` across every
  mutation surface (single-entity update/delete, work-line add/update/delete,
  `bulkUpdatePayrollEntries`, `importPayrollEntries`, `deferAdvanceSchedule` inherited with zero code
  change); `listPayrollCycles` gained a derived `isCurrentDraft` boolean, no schema change; Bank
  Sheet/single Payslip PDF/Payslip batch ZIP filenames now include the cycle's period slug (Cash
  Receiving already had this). **Frontend:** five nested routes added alongside the existing flat
  ones, which now redirect to a resolved default cycle (newest Draft → newest Released → newest
  Archived) instead of carrying their own state; a new shared `useSelectedPayrollCycle` hook and
  `<PayrollCycleSelectField>`/`<PayrollCycleStatusBadge>` component pair replace three independent
  duplicated ad hoc selectors (Bank Sheet, Cash Receiving, Payslips); Payroll Entry gained a full
  Archived read-only mode with a banner; Salary Release gated its Finalize/Rollover actions to
  Draft/Released-only and now navigates straight to the new Draft after a rollover; a dormant
  frontend bug (`isEntryEditable` stricter than the backend) was found and fixed as part of making
  non-Draft cycles reachable for the first time. React Query cache keys were not redesigned — the
  existing `cycleId`-aware keys already isolated data correctly. **Tests:** 8 new backend tests
  (`payroll-cycle-archived-lock.test.ts`) plus filename assertions in three existing suites — full
  backend suite **477/477** (469 prior + 8 new); 7 new frontend unit tests
  (`use-payroll-cycles.test.ts`) — full frontend suite **21/21** (14 prior + 7 new). typecheck/lint/
  build clean across all three workspaces. Full record: `docs/PROJECT_PROGRESS.md` §1's "Phase 5,
  Checkpoint 4" entry.
- **Same day (2026-07-16), before commit: security correction — a confirmed `passwordHash` response
  leak, requested as a "Payroll Cycle response serialization" fix.** Investigation traced it instead
  to `backend/src/modules/users/users.service.ts` (`listUsers`/`getUser`/`createUser`/`updateUser`,
  returning the raw Prisma `User` row into every Users route's JSON response) — a long-standing,
  previously-noticed-but-deferred gap (Phase 3.5 Checkpoint 2's own record already flagged it in
  passing, choosing only to keep the Tasks module's own `assignedTo`/`assignedBy` fields narrow
  rather than fix Users itself). Fixed with an explicit Prisma `select` + DTO assembly matching the
  frontend's own already-narrow `ManagedUser` shape. The requested narrow review of every
  directly-related Payroll Cycle/Backup Package/Salary Release response confirmed those were already
  clean (a genuine negative finding — `PayrollCycle`'s actor columns are plain scalar FK strings;
  Backup Package responses already strip `storageKey`; the one nested `User` relation actually
  queried, `payroll-release.service.ts`'s unit-status payload, already narrowed to `{ id, name }`).
  New permanent convention recorded: `docs/architecture/system-conventions.md §4`, "No HTTP route may
  return a raw Prisma model or relation object." 10 new regression tests (4 in `users.test.ts`, 6 in
  the new `payroll-lifecycle-response-security.test.ts`, using a new recursive
  `assertNoSensitiveKeys()` helper in `tests/helpers.ts`) — full backend suite **487/487** (477 prior
  + 10 new). Live-reconfirmed against a freshly compiled server: the leak is gone, and the full
  Checkpoint 4 Archived-lock matrix (single-entry/bulk/work-line/import, held-then-archived and
  released-then-archived entries) was independently re-verified end-to-end. One non-blocking
  observation surfaced but deliberately left unfixed (out of the requested narrow scope): a malformed
  `cycleId` produces a verbose 500 in non-production `NODE_ENV` only (already masked in real
  production by the existing `isProduction` gate) — pre-existing, not a Checkpoint 4 regression. Full
  record: `docs/PROJECT_PROGRESS.md` §1's "Phase 5, Checkpoint 4 — security correction" entry.
- **Later the same day (2026-07-16): Phase 5 final browser verification and close-out — Phase 5 is
  now COMPLETE AND CLOSED.** The one gap every prior checkpoint's own verification had carried
  forward — genuine browser rendering/JS/interaction/network/console verification, never available
  in this sandbox before — was closed using a real Playwright-driven Chromium browser (locally
  cached from a prior session, installed scratchpad-only, never a workspace dependency) against a
  fully fresh real-stack environment (fresh PostgreSQL, all 15 migrations, fresh seed, freshly
  compiled backend, the real production frontend build cross-origin against the backend — the same
  topology real deployment uses — a cleared real filesystem `StorageProvider`, real cookies/CSRF, no
  mocks). **108 assertions across the entire Phase 5 lifecycle passed, reproduced stable across two
  independent fresh runs, with zero unexpected console/network errors** — login/navigation, first-cycle
  creation via the real UI, Draft Payroll Entry editing (single-entry/hold/bulk/Split-by-Unit/filter),
  Finalize (precondition genuinely blocking, then resolving), Released-cycle behavior, Rollover
  (a due Advance and departed employee recorded through the UI beforehand, the confirmation modal's
  exact copy verified, duplicate-submission genuinely blocked — a real disabled-button timeout, not
  just asserted), the Historical Cycle Selector across all five pages, the Archived-cycle lock
  (including a direct browser-session mutation attempt, server-rejected), historical filenames/content
  for an Archived cycle, Payroll Staff and Finance role/site-scoping through the real UI (both users
  created via the UI, both logged in independently, both confirmed correctly scoped), and Backup
  Package integrity. **No defect was found — the working tree needed zero code changes.** Full
  backend/frontend suites re-confirmed unchanged (487/487, 21/21); `prisma validate`/migration status
  (still zero drift)/typecheck/lint/production builds all re-confirmed clean. All verification data,
  browser artifacts, and the scratchpad Playwright install were deleted; the database was
  re-provisioned genuinely fresh and empty; both test servers stopped; the frontend production build
  regenerated once more without the temporary cross-origin override. Full record:
  `docs/PROJECT_PROGRESS.md` §1's "Phase 5 — final browser verification and close-out" entry.
  **Phase 4's own outstanding Render/Linux-container Chromium deployment smoke test was not performed
  this session and remains separately open** — not conflated with this sandboxed Playwright run.
- **Prior to this session: Phase 4 Checkpoint 6.3 work (Payslip Frontend, Batch Generation, and Phase
  4 Close-Out, below) is reviewed, approved, verified, and COMMITTED as `7ff696b`.** This doc-only
  follow-up pass records that hash here, matching this project's own established convention (the
  implementation commit's own docs couldn't self-reference a hash that didn't exist yet at commit
  time). Full prior lineage (the block below was itself stale — several sessions out of date, still
  narrating a long-past Checkpoint 3 commit as "this session's work" — corrected here against
  `git log` rather than left compounding):
  `674ab04` (Phase 2's substantive build) → `89ac6ff` (Phase 2 UI/UX polish pass) → `11cdc9d` (Phase
  2 checkpoint documentation) → `b7ba9cf` (pre-Phase-3 architecture review) → `74c124e` (further doc
  status update) → `0d9ea33` (Checkpoint 0) → `c60094c` (Checkpoint 1) → `70a45ad` (Checkpoint 2) →
  `b27f559` (Checkpoint 2 doc close) → `ed4ed1f` (**database-verification debt closed**, 2026-07-04)
  → `33f2b18` (Checkpoint 3) → `28d4192` (doc-only commit hash record) → `e26fe8c` (Checkpoint 4) →
  `0ca9a8f` (doc-only commit hash record, closing Phase 2.5) → `1c4d61f` (Phase 3 architecture
  freeze, doc-only) → `aefa64f` (Phase 3 Checkpoint 0 implementation) → `d9c3184` (doc-only commit
  hash record) → `55eda58` (Phase 3 Checkpoint 1 implementation) → `0d54a97` (Advance Deduction
  Deferral architecture amendment, doc-only, frozen 2026-07-09) → `e072da5` (Phase 3 Checkpoint 2
  implementation, reviewed and committed) → `3479bff` (doc-only commit hash record, closing
  Checkpoint 2) → `6be6e68` (Phase 3 Checkpoint 3 Split by Unit workflow implementation, reviewed,
  verified, and committed) → `70a52da` (Phase 3 Checkpoint 4 multi-site filtering and Copy to All
  implementation, reviewed, verified, and committed) → `b4c1d21` (Phase 3 Checkpoint 5 Payroll Entry
  CSV/Excel import/export implementation, reviewed, verified, and committed) → `4da8a01` (doc-only
  commit hash record, closing Checkpoint 5) → `3298e34` (Phase 3 Checkpoint 6 10,000-employee
  performance/concurrency validation implementation, reviewed, verified, and committed) → `fbf8ffc`
  (doc-only commit hash record, closing Checkpoint 6 and Phase 3) → `0fb296e` (Phase 3.5 Checkpoint 0
  — Chat removal, Tasks Workspace, and Phase Close-Out Rule architecture revision — implementation,
  reviewed, verified, and committed) → `1220dce` (Phase 3.5 Checkpoints 1–3 — Tasks Workspace database
  foundation, backend, and frontend/prototype/testing — implementation, reviewed, verified, and
  committed) → `7c2cdb5` (Phase 4 Checkpoint 1 — Bank Registry — implementation, committed) →
  `cedf386` (Phase 4 Checkpoint 2 — Finance Role and Salary Release foundation — implementation,
  reviewed, verified, and committed) → `86f1095` (Phase 4 Checkpoint 3 — Bank Sheets —
  implementation, reviewed, verified, and committed) → `9a2caeb` (Employee Statements deferred to
  Phase 7 — documentation-only) → `477fbb1` (Phase 4 Checkpoint 4 — Cash Receiving Sheets —
  implementation, reviewed, verified, and committed) → `d1c9dd1` (doc-only commit hash record,
  closing Checkpoint 4) → `75c5e64` (Phase 4 Checkpoint 5 — Advances — implementation, reviewed,
  verified, and committed) → `f002072` (doc-only commit hash record, closing Checkpoint 5) →
  `3c05f5e` (Phase 1–3 HTML prototype reconciliation, docs-only) → `3b74c32` (post-Phase-4 banking
  refinement — Account Title removal, IBAN addition, banking invariants — implementation,
  committed) → `9d9bc32` (Layout Integrity corrections — implementation, committed) → `372eeba`
  (doc-only commit, closing out both of the above) → `093a9df` (Phase 4 Checkpoints 6.1 — Payslips
  backend foundation — and 6.2 — Payslip PDF Engine — implementation, reviewed, verified, and
  committed together as one logical commit) → `7ff696b` (Phase 4 Checkpoint 6.3 — Payslip Frontend,
  Batch Generation, and Phase 4 Close-Out — implementation, reviewed, verified, and committed).
- **Post-Phase-4 banking refinement — COMMITTED as `3b74c32`.** `Employee`/`PayrollEntry.
  accountTitle` removed entirely (clean, destructive migration); `iban` added to both; a new
  banking invariant (bank employee requires Account Number, cash employee has neither); Bank
  Sheet's "Title of Account" now derives from the employee name instead of a stored field; a
  permanent Layout Integrity Rule for business-critical identifiers. Full record:
  `docs/PROJECT_PROGRESS.md` §1's "Post-Phase-4 refinement" entry.
- **That same refinement's Layout Integrity corrections — COMMITTED as `9d9bc32`** (the corrected,
  final version — see `docs/PROJECT_PROGRESS.md` §1 for the two intermediate "rejected on review"
  iterations this superseded, 2026-07-12 and 2026-07-13). Root cause was not the column-width numbers
  alone — Payroll Entry's Bank `<select>` showed only `bank.code`, and `ReadOnlyCell` silently
  ellipsis-clipped Employee Code; a Dynamic Width Rule replaced every guessed fixed pixel width with
  a content-driven calculation. Verified with a real, in-session-provisioned headless browser (live
  DOM measurements: zero `scrollWidth`/`clientWidth` overflow for Bank/Account Number/IBAN across
  Payroll Entry, Employee Registry, and Bank Sheet). Both this commit and `3b74c32` were closed out by
  a doc-only commit, `372eeba`. **Reconciled 2026-07-12 (Phase 4 Checkpoint 6.1's own preflight):**
  `372eeba`'s own prose still read "not yet committed"/"pending review" in several places, narrating
  the working tree's state as it stood *before* these two commits existed — corrected in place in
  `docs/PROJECT_PROGRESS.md` §1, since `git log` was never actually in doubt.
- **Phase 4, Checkpoints 6.1 (Payslips backend foundation) and 6.2 (Payslip PDF Engine) — reviewed,
  approved, verified, and COMMITTED TOGETHER as `093a9df`.** Checkpoint 6.1 was intentionally left
  uncommitted while Checkpoint 6.2 was built directly on top of it in the same session, per explicit
  instruction, then both were staged and committed as one logical implementation commit. Payslip
  generation is now explicitly three checkpoints — **6.1 Backend Foundation → 6.2 PDF Engine → 6.3
  Frontend, Batch Generation, and Phase Close-Out** — superseding this file's own earlier informal
  "Payslip generation" framing as one undivided item.
  - **6.1**: `PayrollEntry.employeeNameSnapshot`/`.fatherNameSnapshot` (additive migration), a
    dedicated `payslips:view` permission (Master Admin/Payroll Staff/Finance), and a new
    `backend/src/modules/payslips/` module exposing the list/picker and single assembled Payslip
    JSON endpoints.
  - **6.2**: `puppeteer` added; `backend/src/lib/pdf/` (browser singleton, generic HTML→PDF
    renderer, HTML-escaping utility, shared print stylesheet, the Payslip template); one new
    `GET .../payslips/:employeeId/pdf` endpoint — identical permission/site-scoping/released-gate
    as the JSON route, one PDF artifact serving both preview and download via
    `Content-Disposition`, a new `payslip.exported` audit action. `Payslip.periodStartDate`/
    `.periodEndDate` added to 6.1's JSON shape (derived, not stored). Fully stateless — no
    persistence, no cache, no `StorageProvider` dependency
    (`docs/architecture/system-conventions.md §2`, clarified this same checkpoint).
  - **Real deviation found during implementation**: Puppeteer 22+ is ESM-only and this backend
    compiles to CommonJS — TypeScript's own dynamic `import()` doesn't solve this either
    (downlevels to a failing `require()`); fixed via the standard
    `new Function('return import("puppeteer")')` ESM-from-CJS interop pattern, plus
    `NODE_OPTIONS=--experimental-vm-modules` added to the `test` script so Jest itself can execute
    it.
  - **Final narrow pre-commit verification pass (2026-07-12)**, against the approved review's own
    7-point checklist, found and fixed one real issue before commit: `getBrowser()`'s crash/
    disconnect relaunch could race under concurrent requests and orphan a Chrome process; fixed
    with a compare-and-swap guard. The other six checks (interop isolation, page-close-in-finally,
    filename sanitization against quotes/CRLF/path separators, correct binary `Buffer` handling, no
    sensitive data in application logs) were all confirmed already correct.
  - **325/325 backend tests** (304 at 6.1+6.2's initial implementation, unchanged after the final
    verification fix); real-stack verification against the actual compiled production build
    (`dist/`), including a hostile-input employee name through the real endpoint, verified escaped,
    not executed.
  - **Known limitation, carried forward and still not resolved as of Checkpoint 6.3 (below)**: no
    actual Render/Linux-container deployment smoke test was possible this session either (no Docker,
    no live Render access in this sandboxed environment).
  - Full detail: `docs/PROJECT_PROGRESS.md` §1's "Phase 4, Checkpoint 6.1"/"Checkpoint 6.2" entries.
- **Phase 4, Checkpoint 6.3 (Payslip Frontend, Batch Generation, and Phase 4 Close-Out) — reviewed,
  approved, verified, and COMMITTED as `7ff696b`.** Preceded by its own read-only architecture
  review, approved with refinements (bounded stateless ZIP streaming, no Redis/queue/job
  table/persisted artifact, exactly 300 as a named constant).
  - **6.3.1**: `getPayslipsBulk()` — one shared bulk-assembly builder (one `PayrollEntry` query, one
    `CompanySettings` read, every row through the same `buildPayslip()` as the individual endpoint);
    `renderPayslipPdfBuffer()` extracted so individual and batch generation share one PDF-rendering
    call path.
  - **6.3.2**: `POST /payroll-cycles/:cycleId/payslips/batch` — same `payslips:view` permission, no
    new key; `MAX_BATCH_PAYSLIPS_PER_REQUEST = 300` (`@payroll/shared`) enforced by Zod **before**
    any database query; a canary render of the first Payslip before any header is sent; bounded
    concurrency (`BATCH_RENDER_CONCURRENCY = 4`) over the warm Puppeteer singleton; a partial-failure
    path that continues the batch and appends a `_summary.txt` (never leaking internal error detail);
    collision-proof archive filenames (`buildArchiveEntryName()`/`slugify()`); exactly one
    `payslip.batch_exported` audit entry per request, never one per employee; client-disconnect
    detection that stops scheduling new renders.
  - **6.3.3**: new `/payslips` frontend route — cycle/site/unit/search filters, "select all
    **currently loaded**" semantics only (never company-wide, never out-of-scope; any filter change
    clears the selection), individual preview/download reusing the existing single-PDF endpoint (no
    second HTML template), batch download with `AbortController` cancellation and honest
    non-percentage progress messaging (the frontend's 300 limit is UX-only — the backend
    independently re-validates every request).
  - **6.3.4**: `docs/prototypes/phase4-payslips-preview.html` (six tab screens, visually verified,
    zero console errors); full verification pass — **backend 346/346** (325 prior + 21 new);
    typecheck/lint/build clean across shared/backend/frontend; real production-build HTTP
    verification; real Playwright browser verification (login through batch ZIP download,
    structurally inspected, plus individual PDF download, empty state, and permission-denied state).
    One genuinely flaky test found and fixed (an N+1 query-count assertion sensitive to first-query
    connection overhead — fixed with a warm-up call, confirmed non-flaky across 5 isolated runs, see
    `docs/PROJECT_PROGRESS.md` §1 for the full root-cause note, including an unrelated pre-existing
    "Jest did not exit" connection-leak artifact that is not a Checkpoint 6.3 regression).
  - **Mandatory deployment verification — genuinely re-attempted, still not possible.** No
    Docker/Podman/Colima, no Render API token, no git remote, in this sandboxed environment. Recorded
    honestly as outstanding, not marked passed. **This is the one condition keeping Phase 4 from
    being marked fully closed** — see `docs/PROJECT_PROGRESS.md` §1's "Phase 4 close-out review".
  - Full detail: `docs/PROJECT_PROGRESS.md` §1's "Phase 4, Checkpoint 6.3" and "Phase 4 close-out
    review" entries.
  **Phase 4 is code-complete but not fully closed. Do not begin Phase 5 without both (a) closing the
  outstanding deployment-verification condition and (b) separate, explicit authorization — per this
  project's standing per-phase practice.**
- **Phase 4, Checkpoint 1 (Bank Registry) is reviewed, approved, verified, and COMMITTED as
  `7c2cdb5`.** Master User management of the Bank Registry (create/edit/activate/deactivate, delete
  blocked while referenced, the reserved/protected `CASH` system record, `banks:manage`
  permission), explicitly scoped to exclude Finance Role, Salary Release, Bank Sheets, Statements,
  and Reports. **18 new backend tests, full suite 226/226** at the time; a reviewed
  `docs/prototypes/phase4-bank-registry-preview.html`. **Documentation note (reconciled
  2026-07-11, the following session, during Checkpoint 2's own pre-commit review):** this
  checkpoint's own commit did not update `PROJECT_PROGRESS.md`/`SESSION_HANDOFF.md`/
  `IMPLEMENTATION_PLAN.md` at the time — a real gap in the documentation-before-done convention,
  reconstructed from `7c2cdb5`'s diff and recorded properly (not silently skipped) before Checkpoint
  2 was committed. Full detail: `docs/PROJECT_PROGRESS.md` §1's "Phase 4, Checkpoint 1" entry.
- **Phase 4, Checkpoint 2 (Finance Role and Salary Release foundation) is reviewed, approved,
  verified, and COMMITTED as `cedf386`.** A new `FINANCE` role and `payroll:view`/`payroll:release`
  permissions, the `PayrollUnitRelease` data model (migration `20260711140000_payroll_unit_release`), the
  per-Unit release workflow/sweep (`backend/src/modules/payroll-release/`), an any-of
  `requirePermission`, a new Salary Release frontend page, User Management's Finance-role support,
  and `docs/prototypes/phase4-salary-release-preview.html`. Scope was deliberately narrowed before
  any code was written — `PayrollUnitReadiness` ("Ready for Release") and the Late Entry one-off
  release path are both explicitly deferred to a later checkpoint, per the user's own answers to two
  scope-clarifying questions asked up front. **The double-release business rule (releasing an
  already-released Unit must fail cleanly, not rely solely on the DB unique constraint) was
  explicitly re-verified before commit** — `releaseProjectUnit()`'s existing service-level pre-check
  (a typed 409 `CONFLICT`) was already correct; the test was strengthened to assert the exact
  response body and a zero-second-row database check, plus a new concurrent-race test confirming the
  DB constraint's own P2002 → 409 translation (the global error handler) as the correctness backstop.
  **241/241 backend tests** (226 prior + 15 new); a real-stack Playwright pass (Master User creates a
  Finance user and a Draft cycle, the Finance user releases a Project Unit, the UI updates correctly,
  zero console errors) — full detail: `docs/PROJECT_PROGRESS.md` §1's "Phase 4, Checkpoint 2" entry.
- **Phase 4, Checkpoint 3 (Bank Sheets) is reviewed, approved, verified, and COMMITTED.** Preceded
  by a read-only architecture review (no files touched) reconfirming the release boundary, the
  derived/no-own-table nature of Bank
  Sheets, and the reserved `bank-sheets:view` permission name against the codebase as it stood after
  Checkpoints 1–2. One unified Bank Sheet feature (`backend/src/modules/bank-sheets/`,
  `frontend/src/routes/bank-sheet-page.tsx`) filters released-only payroll by any active Bank or a
  `cash` sentinel — a deliberate, user-directed scope decision in place of the frozen architecture's
  separate future Cash Receiving module. CSV/Excel export reuses the existing `ExcelJS`/
  `csv-stringify` convention; a new shared `sumMoney()` sums totals via `decimal.js`, matching
  `calcNet`'s own rounding policy. **Two real defects found and fixed via this checkpoint's own
  mandatory Playwright pass**: (1) a genuine, pre-existing Employee Registry bug — the "New Employee"
  modal's form state silently carried over between consecutive employee creations (bank, account
  number, designation, gross pay, all of it) because the modal never unmounts, only its "Edit"
  sibling does; fixed with a reset-on-open effect, confirmed via direct database inspection before
  and after. (2) The Bank Sheet totals row's `position: sticky` had no bounded vertical scrolling
  ancestor to attach to and instead floated at the page's own edge; fixed to a plain footer row,
  matching CSS also updated in the prototype. Historical snapshot integrity was verified two ways —
  a dedicated backend test and a live Playwright check — changing an employee's bank/account/
  designation after release, then confirming a previously generated Bank Sheet is byte-for-byte
  unchanged. **253/253 backend tests** (241 prior + 12 new); a real-stack Playwright pass covering
  bank/Cash filtering, untruncated account numbers, CSV export, the historical-snapshot check, and
  Payroll Staff's complete exclusion (no sidebar item, 403 on direct API access) — full detail:
  `docs/PROJECT_PROGRESS.md` §1's "Phase 4, Checkpoint 3" entry.
- **Architecture review, same day (2026-07-11, documentation-only, no code/schema/migrations/
  prototypes): Employee Statements is confirmed NOT Phase 4 scope.** A complete Statement of Account
  depends on `Correction`/`BalanceAdjustment`/`CorrectionPayment` (Phase 6, not started) and `Advance`
  (Phase 4's own not-yet-built sub-scope) — none exist in `backend/prisma/schema.prisma` yet, so
  building it now would produce a structurally incomplete ledger. Bank Registry/Salary Release
  foundation/Bank Sheets remain exactly Checkpoints 1/2/3, unchanged. Employee Statements remains
  Phase 7 scope, exactly as `docs/IMPLEMENTATION_PLAN.md` already specified — this review confirms
  the existing frozen plan, not a redesign. New note recorded: Reports (also Phase 7) should reuse
  Statements' ledger-computation code rather than duplicating it. Full detail:
  `docs/PROJECT_PROGRESS.md` §1's "Phase 4 — Employee Statements Architecture Review and Scope
  Decision" entry.
- **Phase 4, Checkpoint 4 (Cash Receiving Sheets) is reviewed, approved, verified, and COMMITTED as
  `477fbb1`.** Preceded by its own read-only architecture review (no files touched), approved with
  two changes: reuse `bank-sheets:view` rather than introduce `cash-receiving:view`, and ship a
  simplified document layout rather than the original historical prototype's full attendance
  breakdown. A dedicated module (`backend/src/modules/cash-receiving/`), not a bolt-on filter inside
  Bank Sheets — sourced from released, non-held `PayrollEntry` rows with `bankId IS NULL` (Bank
  Sheets' own already-shipped Cash rule, reused unchanged; `accountNumber` deliberately not
  introduced). No database changes of any kind. CSV/XLSX export only, reusing existing
  `ExcelJS`/`csv-stringify` helpers; export-only audit logging (`cash_receiving_sheet.export`).
  Document columns: Serial No., Employee Code, Employee Name, CNIC, Designation, Site, Net Salary,
  Signature / Thumb Impression, Remarks, with a Company/Cycle/Generated-By/Generated-On header and a
  Total Employees/Total Cash Amount footer. **264/264 backend tests** (253 prior + 11 new); a
  real-stack Playwright pass (Finance access, Payroll Staff denial via sidebar and direct API 403,
  cash-only filtering verified live against a mixed bank/cash release, CNIC untruncated, Signature
  column width verified, CSV/Excel downloads, empty state, zero uncaught JavaScript errors). One
  label inconsistency ("Sr." vs. the approved "Serial No.") was found and fixed in both the on-screen
  page and the prototype during pre-commit final verification, re-verified live — not a behavior
  change. Ad hoc dev-database test records created during verification were identified and removed
  before commit. Full detail: `docs/PROJECT_PROGRESS.md` §1's "Phase 4, Checkpoint 4" entry.
  **Checkpoint 4 is complete and closed.**
- **Phase 4, Checkpoint 5 (Advances) is reviewed, approved, verified, and COMMITTED as `75c5e64`.**
  Preceded by its own read-only architecture review that verified every assumption against the actual
  implementation, not just documentation — confirmed `Advance`/`ScheduledPayrollPeriod`/
  `AdvanceScheduleChange` and the generic Outstanding-Payroll-Obligation registry were 100%
  documentation with zero code, and that `createPayrollCycle`'s bootstrap silently reset
  `advanceDeduction`/`eidAdvanceDeduction` to zero every cycle (the gap this checkpoint fills, not a
  pre-existing bug). Adds `Advance`, `ScheduledPayrollPeriod` (owned by Payroll Processing),
  `AdvanceScheduleChange` (append-only), and `PayrollEntry.advanceId`/`.eidAdvanceId`. **At most one
  `ACTIVE` Advance per employee per type is now confirmed and enforced** — `database/
  schema-invariants.md` had explicitly left this "not yet confirmed — revisit before Phase 4"; a
  partial unique index backstops an application-layer check. **Deliberately no generic
  Outstanding-Payroll-Obligation provider/hook registry** — `payroll-processing.service.ts` calls
  Advances' own materialization function directly; that generalization is deferred until Phase 6
  becomes a genuine second consumer. `Advance.scheduledInstallmentAmount` (additive beyond `database/
  advances.md` §15's original columns, but already proposed by name in this document's Phase 4
  section) lets an `INSTALLMENT` advance's deduction repeat forward automatically without the system
  ever computing the amount. No new permission — `advances:manage` already existed and was already
  granted to Payroll Staff; Finance receives none, unchanged. Cash Advances, Advance-only Bank
  Sheets, and Company Bank Account management remain out of scope; Payroll Entry import/export is
  unchanged (no automatic Advance linking on import). **A real design gap was found and fixed before
  commit**: deferring a `FULL_DEDUCTION` advance's just-materialized deduction must reverse its
  `PAID_OFF` status back to `ACTIVE`, since the entry hasn't released yet — nothing about a
  not-yet-released deduction is final. **276/276 backend tests** (264 prior + 12 new); a real-stack
  Playwright pass (Record Advance via the real UI, automatic materialization confirmed via both the
  new Payroll Entry balance indicator and the Advances page, Defer modal auto-resolving the live
  entry, Finance denial via sidebar and 403, zero real console errors). Ad hoc dev-database test
  records from two rounds of Playwright verification were identified and removed before commit. Full
  detail: `docs/PROJECT_PROGRESS.md` §1's "Phase 4, Checkpoint 5" entry. **Checkpoint 5 is complete
  and closed. Do not begin the next Phase 4 checkpoint (Payslip generation) until the next explicit
  review and authorization.**
- **Phase 3.5 (Tasks Workspace) is reviewed, approved, verified, and COMMITTED across two commits —
  `0fb296e` (Checkpoint 0, architecture revision) and `1220dce` (Checkpoints 1–3, implementation).
  Phase 3.5 is now fully complete and closed — its own 🛑 review checkpoint has passed.** The
  previously-planned Team Collaboration/Chat panel is permanently removed (never deferred) and
  replaced by a lightweight, ownership-based internal task-delegation tool — `Task`/`TaskNotification`
  (`backend/prisma/schema.prisma`, migration `20260710150000_tasks`), the full
  `backend/src/modules/tasks/` service/route layer (`requireTaskAccess` as a service-layer assertion,
  not middleware; reassignment detected implicitly within the ordinary `PATCH`; dedicated
  complete/cancel/reopen/delete actions), and the complete frontend
  (`frontend/src/components/tasks/`, a polling notification badge, filters/sorting/pagination).
  This same effort also made the HTML-prototype review/create/update rule a permanent
  Definition-of-Done requirement (`docs/IMPLEMENTATION_PLAN.md`'s Definition of Done section),
  alongside the existing Playwright rule — see `docs/prototypes/phase3.5-tasks-workspace-preview.html`
  for that rule's first real application. Full decision/implementation record:
  `docs/PROJECT_PROGRESS.md` §1's "Phase 3.5" entries; the frozen decisions are repeated in §3 below.
  **Verified**: `typecheck`/`lint`/`build` clean across all three workspaces; **208/208 backend
  tests** (184 prior + 24 new); **18/18 real-stack Playwright checks**, zero console errors; `prisma
  validate`/migration-drift clean. Two real defects were found and fixed via the Playwright pass
  before anything shipped (a due-date round-trip format mismatch causing silent edit failures, and
  two components firing a needless `users:manage`-gated request for non-Master-User sessions) — full
  detail in `docs/PROJECT_PROGRESS.md`'s Checkpoint 3 entry. `reference/PROJECT_SPEC.md` and
  `reference/payroll_prototype.html` were **not** touched at any point, per standing convention
  (frozen, never edited) — both still describe the retired Chat concept as client-provided historical
  reference only.
- **Phase 3 Checkpoint 6 (10,000-employee performance/concurrency validation) is reviewed, approved,
  verified, and COMMITTED as `3298e34` (2026-07-10). Phase 3 (Checkpoints 0–6) is now fully complete
  and closed — its own 🛑 review checkpoint has passed.** A read-only architecture review preceded
  implementation and froze five decisions before any code was written — see
  `docs/PROJECT_PROGRESS.md` §1's "Phase 3, Checkpoint 6" entry for the full decision record; the
  frozen decisions are repeated in §3 below, permanently binding on any future session that touches
  this code. Measurement-first: a new committed backend performance/concurrency suite
  (`backend/tests/payroll-entry-performance.test.ts`, 9 tests against a synthetic 10,000-employee
  cycle) plus a real-browser Playwright pass drove every decision — **Decision 1 (fetch
  parallelization) was applied because measurement justified it** (sequential fetch measured at
  2.8s, ~94% of the 3s acceptable ceiling); **Decisions 2 (`LiveTotalsStore`) and 3 (cache
  invalidation) were deliberately left unchanged because measurement did not justify a change**. The
  measurement work also surfaced and fixed a real, pre-existing correctness bug — `createPayrollCycle`
  never assigned `sortOrder`, making pagination unstable at 10,000 tied rows (23 rows silently
  duplicated across page boundaries, 23 others dropped) — fixed in
  `payroll-processing.service.ts` with a dedicated regression test asserting 10,000 distinct
  `sortOrder` values. Verified: `typecheck`/`lint`/`build` clean across all three workspaces;
  **184/184 backend tests** (175 prior + 9 new) against live PostgreSQL; a real-browser regression
  pass confirming every Decision 4 target met (2.75s initial load, 47–52ms typing latency, zero
  scroll long tasks, 580ms Copy to All, stable memory) and zero regressions in inline autosave, the
  site filter, Copy to All scoping, and Split by Unit at 10,000-row scale. **Checkpoint 6 is complete
  and closed.**
- **Phase 3 Checkpoint 5 (Payroll Entry CSV/Excel import/export) is reviewed, approved, verified, and
  COMMITTED as `b4c1d21`.** A read-only architecture review preceded implementation and surfaced one
  three-option design fork plus four further open questions, all frozen by explicit user decision
  before any code was written — see `docs/PROJECT_PROGRESS.md` §1's "Phase 3, Checkpoint 5" entry
  for the full decision record; the frozen decisions are repeated in §3 below, permanently binding on
  any future session that touches this code. Verified: `typecheck`/`lint`/`build` clean across all
  three workspaces; **175/175 backend tests** (165 prior + 10 new,
  `backend/tests/payroll-entry-import-export.test.ts`) against live PostgreSQL; a real-stack
  Playwright pass, **13/13 checks**. **Checkpoint 5 is complete and closed.**
- **Phase 3 Checkpoint 2 (Payroll Entry grid frontend) is reviewed, approved, verified, and
  COMMITTED.** A pre-commit verification pass found and fixed three genuine defects within scope: a
  numeric-input crash (unparseable text crashed the live `calcNet` preview — no error boundary
  existed anywhere in the app), the sticky totals row only summing currently-mounted/virtualized-
  visible rows (undercounting at scale), and a Cycle Days validation inconsistency (invalid
  keystrokes were silently discarded rather than flagged). All three are fixed; full record:
  `docs/PROJECT_PROGRESS.md` §1's "Phase 3, Checkpoint 2" and "Pre-Commit Final Verification Pass"
  subsections. **Checkpoint 2 is complete and closed.**
- **Phase 3 Checkpoint 3 ("Split by {unitLabel}" workflow) is reviewed, approved, verified, and
  COMMITTED as `6be6e68`.** A dedicated design-only review preceded implementation and approved a
  Modal-based Split editor (over three other compared alternatives) with eight required
  implementation decisions — most importantly, that the modal shares the grid's existing debounced-
  autosave/optimistic-locking commit queue rather than introducing a separate Save/Cancel workflow.
  No backend or shared-schema changes were needed (Checkpoint 1 already built the Work Line CRUD
  this checkpoint calls). Before commit, an explicit final architectural verification pass (network-
  capture Playwright: autosave batching across multiple lines in one debounce window, queueing
  during an in-flight save, a rapid add/edit/delete restructuring stress test, and a Checkpoint 2
  regression check) found and fixed one further real bug — a totals-row column-misalignment from the
  new `units` column. `typecheck`/`lint`/`build` clean; backend suite re-confirmed at 160/160 against
  a freshly re-provisioned database. Full record: `docs/PROJECT_PROGRESS.md` §1's "Phase 3,
  Checkpoint 3" and "Pre-Commit Final Verification Pass" subsections. **Checkpoint 3 is complete and
  closed.**
- **Phase 3 Checkpoint 4 (multi-select site filter + "Copy to All") is reviewed, approved, verified,
  and COMMITTED as `70a52da` (2026-07-09).** A read-only architecture review preceded implementation,
  followed by a dedicated investigation answering two open questions with evidence from the actual
  codebase (not assumption): a new backend bulk-update endpoint is required (`database/schema-invariants.md`
  §23's standing "bulk writes over row-by-row loops" rule, the `employee.import` summary-audit
  precedent, and a real O(N²) cache-merge cost the looping alternative would introduce); Copy to All
  applies only to a split entry's **primary** work line (documentation was genuinely ambiguous on
  this point — stated as such, not silently resolved — with primary-line-only frozen for consistency
  with the grid's own existing inline columns). One new backend endpoint (`PATCH
  /api/v1/payroll-cycles/:cycleId/entries/bulk`, one transaction, one summary audit entry, a
  deliberate and documented exception to per-row optimistic locking for this endpoint only); the site
  filter itself needed no backend change (pure in-memory filtering of the already-fully-fetched
  entries array). New reusable `MultiSelectFilter` (`frontend/src/components/ui/multi-select-filter.tsx`,
  no Payroll-Entry-specific logic, per spec item 10's stated future reuse in Release Salary/Fines
  report) and `CopyToAllToolbar`. `typecheck`/`lint`/`build` clean; **5 new backend tests, full suite
  165/165** against a freshly re-provisioned database; a real-stack Playwright pass, **15/15 checks**,
  covering the filter, primary-line-only bulk targeting on a genuinely split entry, cross-site
  isolation, and explicit Checkpoint 2/3 regression checks. A final repository-wide verification pass
  (diff scope, merge markers, TODO/debug-logging sweeps, a fresh typecheck/lint/build, and both the
  backend suite and Playwright pass re-confirmed against a freshly re-provisioned database) found no
  defects before commit. Full record: `docs/PROJECT_PROGRESS.md` §1's "Phase 3, Checkpoint 4"
  subsection. **Checkpoint 4 is complete and closed.**
- **The Advance Deduction Deferral architecture is now FROZEN (2026-07-09, architecture-only session,
  no application code).** New business rule: authorized users may defer an Advance's scheduled
  deduction to any future Draft payroll cycle before release (BR-ADV-001 through BR-ADV-006,
  `database/advances.md` §15). Two new tables (`ScheduledPayrollPeriod`, §10a;
  `AdvanceScheduleChange`, §15a) and two new `Advance` columns are speced, plus the generalized
  **Outstanding Payroll Obligations** extension seam on Payroll Processing's cycle bootstrap
  (`docs/architecture/workflows/outstanding-obligations.md`, `docs/architecture/overview.md` Extensibility). Full
  decision record: `docs/PROJECT_PROGRESS.md` §1's "Advance Deduction Deferral" subsection. **Do not
  reopen or redesign this without a genuine implementation blocker or a new business requirement** —
  Phase 4 should implement directly against this frozen documentation.
- **Phase 3 Checkpoint 1 (cycle bootstrap/creation, Payroll Entry/Work Line backend CRUD, RBAC/
  site-scoping, audit logging) is reviewed, approved, and COMMITTED** as `55eda58`. Two business
  decisions were frozen as part of this review — the **Payroll Bootstrap Rule** (continuing
  employees carry forward payroll-specific values from their prior entry, never from `Employee`'s
  own record, while designation/bank/unit/site fields always refresh from `Employee`'s current
  record) and **`PayrollEntry.siteId` is permanently non-editable via the update API** (site
  changes flow only through the Employee Transfer workflow). Both are recorded in full in
  `docs/PROJECT_PROGRESS.md` §1's "Phase 3, Checkpoint 1" subsection and in code comments
  (`payroll-processing.service.ts`'s `createPayrollCycle`, `payroll-entry.ts`'s
  `updatePayrollEntrySchema`). **160/160 backend tests passing** (145 prior + 15 new),
  typecheck/lint/build clean.
- **Phase 3 Checkpoint 0 was completed in an earlier session** (schema/migration + shared
  `calcNet` — no routes, services, or frontend), committed as `aefa64f` + `d9c3184`. Full decision
  record: `docs/PROJECT_PROGRESS.md` §1's "Phase 3, Checkpoint 0" subsection. **Checkpoints 2–6
  have NOT started** — each requires its own explicit go-ahead, per the checkpoint breakdown
  `docs/IMPLEMENTATION_PLAN.md`'s Phase 3 section established.
- **The earlier Phase 3 Architecture Review session (2026-07-05, architecture only, no code)**
  produced the complete Payroll Entry, Payroll Processing, Release (now per Project Unit), and
  Corrections/Balance Adjustments design now frozen into `docs/architecture/*.md` and
  `docs/IMPLEMENTATION_PLAN.md`. Full decision record: `docs/PROJECT_PROGRESS.md` §1's "Phase 3
  Architecture Review" subsection. Checkpoint 0 implemented against that frozen design, with two
  explicitly approved deviations recorded in `database/payroll-entry.md` §12 and `database/schema-invariants.md` §25's dated revision notes
  (the `advanceId`/`eidAdvanceId` deferral to Phase 4, and the new `PayrollEntry.remarks` column)
  and one in `overview.md` (`calcNet`'s implementation living in `shared/`, not backend-only).
  Checkpoint 1 implements CRUD/RBAC against that same frozen design and Checkpoint 0's schema, with
  its own explicit, approved scope boundary around cycle creation (see below) and the now-frozen
  Payroll Bootstrap Rule/`siteId`-non-editable decisions above — none of these are
  docs/architecture/*.md revisions; all are implementation-level decisions recorded in
  `docs/PROJECT_PROGRESS.md`.
- Checkpoint 2 shipped (prior session): `Employee.unitId` + composite FK against
  `ProjectUnit(id, siteId)`, the new append-only `EmployeeTransferHistory` table, migration
  `20260703140000_employee_unit_and_transfer_history`, `assertUnitBelongsToSite()`, `updateEmployee()`
  rewritten to detect a transfer and write the Employee update + `EmployeeTransferHistory` row +
  `employee.transferred` `AuditLog` entry atomically in one transaction (also fixing a pre-existing,
  unrelated atomicity gap in the ordinary `employee.updated` path — see §3 below), a new reusable
  `SiteUnitSelect` component wired into the Employee Registry's create/edit form, interim
  import/export unit handling (single-unit-per-site auto-resolve; full column remap is Checkpoint 3),
  new/updated backend tests, and a `pluralize()`-utility-reuse fix caught while writing an error
  message. **Do not begin Checkpoint 3 without first closing the database-verification debt below —
  this is now an explicit, mandatory gate, not a background item.**
- **Phase 2 is complete and committed. The pre-Phase-3 architecture review is complete and
  committed.** A full pre-Phase-3 architecture review produced six new business decisions (Project
  Unit model, Payroll Entry Work Lines, date display standard, a 10,000-employee performance floor, a
  CNIC duplicate-detection recommendation, and a deployment-model reaffirmation), all written into
  `docs/architecture/database-schema.md`, `docs/architecture/overview.md`,
  `docs/architecture/folder-structure.md`, `docs/architecture/tech-stack.md`, `docs/design-system.md`,
  `docs/PROJECT_PRINCIPLES.md` (new Principle 10), and `docs/IMPLEMENTATION_PLAN.md` (new Phase 2.5).
  **The CNIC recommendation is now a finalized decision, not pending** — see §3 below and
  `docs/PROJECT_PROGRESS.md` §3 item 22. Full decision record: `docs/PROJECT_PROGRESS.md` §3 items
  16–22.
- **Phase 2.5 is now CLOSED (updated 2026-07-05 — this bullet described an in-progress state as of an
  earlier point in the project and is corrected here to avoid contradicting §1's current-status
  summary above).** All five checkpoints are complete and committed: 0–2 in prior sessions, the
  database-verification close and Checkpoint 3 (import/export remap to Project Units with
  three-layer Site/Unit validation) on 2026-07-04, and Checkpoint 4 (CNIC normalization, duplicate-
  check, Reactivate workflow) on 2026-07-05 — see §2's entries for the full detail on each.
- `npm run typecheck`, `npm run lint` (0 errors, same 3 pre-existing `react-refresh` warnings), and
  `npm run build` were all re-run at the end of this session after Checkpoint 2's code changes and
  are clean across all three workspaces. `backend/tests/date-utils.test.ts` and `rbac.test.ts` (no DB
  required) were run directly and pass (23/23 assertions); every updated/new DB-backed test file
  (`employees.test.ts`, `employees-import-export.test.ts`, `project-sites.test.ts`,
  `project-units.test.ts`) was confirmed to compile and execute correctly through `ts-jest`, failing
  only on the expected "no Postgres reachable" environment constraint — not a code defect. A final,
  whole-app Playwright pass (Employee Registry + Project Sites/Manage Units together) also ran clean
  with zero console errors.
- **The database-verification debt is CLOSED (2026-07-04).** Real PostgreSQL 18 was provisioned in
  the session sandbox (embedded-postgres npm binaries — no Docker/Homebrew needed; see
  `docs/PROJECT_PROGRESS.md` §1's "Database verification" subsection for the recipe). All six
  pre-existing migrations applied to a completely fresh database without modification; the full
  backend suite passes **78/78**; the composite FK and Audit Log immutability were additionally
  verified at the raw-SQL level; a second fresh database replayed the whole chain to prove
  reproducibility; and a first-ever **real-stack Playwright E2E** (live browser → frontend →
  backend → PostgreSQL, no mocks) passed with zero console errors. Four real defects were found and
  fixed — see §2's 2026-07-04 entry and §3's new rules. The live DB is scratchpad-local and must be
  re-provisioned each session (fast: migrate deploy + seed).

## 2. What was completed today (2026-07-02)

**Morning: Phase 1 close-out and decision resolution**
- Resumed per `docs/IMPLEMENTATION_PLAN.md`'s "How to Resume This Project"; verified branch/commit/
  clean tree; confirmed the repository matched the documentation exactly.
- Re-confirmed no Postgres is reachable in this environment (checked for Docker, Docker Compose,
  Podman, Homebrew, native `psql`/`pg_ctl`, Postgres.app — none present), and did not attempt to
  install one, per instruction.
- Resolved the Bank/AdjustmentType/CompanySettings Phase-1-vs-Phase-2 scope question with the user
  (ratified the existing `schema.prisma` narrowing) and the two Employee Registry §26 design
  assumptions (CNIC/employeeCode nullability, free-text designation/religion) — both updated in
  `docs/IMPLEMENTATION_PLAN.md`/`docs/architecture/database-schema.md`.
- Obtained the user's **explicit conditional sign-off** on the Phase 1 review checkpoint and
  committed the close-out as `2e804d4`.

**Afternoon: Phase 2 implementation, in full**
- Built all five Phase 2 deliverables per `docs/IMPLEMENTATION_PLAN.md`: the master-data migration
  (`Bank`/`Employee`/`AdjustmentType`/`CompanySettings`), Project Sites
  CRUD, Employee Registry CRUD (C11 site-scoped RBAC, CNIC/employeeCode uniqueness, DOL-based
  leaving), Employee Registry CSV/Excel import/export against the official template, the Settings
  module (Company Details/My Profile/Theme), and User Management — backend + tests + frontend for
  each, in that order, verifying `typecheck`/`lint`/`build` after every module rather than only at
  the end. Full detail in `docs/PROJECT_PROGRESS.md` §1.
- Added site-scoping boundary tests beyond the per-module basics, specifically covering the C11
  decision's "direct API call with a manipulated siteId" requirement, including an update-time
  site-change boundary case.
- Discovered and documented (did not silently work around) a gap: `StorageProvider`, called for in
  Phase 0's plan text, was never actually built in any prior session. Scoped Settings/My Profile to
  text fields only this session and flagged logo/avatar upload as blocked on this — see
  `docs/PROJECT_PROGRESS.md` §3 item 4 for the resolution options.
  Also flagged (non-blocking) the Employee Registry import template's two redundant-looking column
  pairs as an assumption worth client confirmation — §3 item 5.
- Generated three static HTML prototypes under `docs/prototypes/` at meaningful UI milestones
  (Project Sites, Employee Registry, Settings+Users) per the user's standing instruction.
- Added new dependencies: `@radix-ui/react-dialog` (frontend, first Modal component); `exceljs`,
  `csv-parse`, `csv-stringify`, `multer` (backend, import/export).

**Evening: architectural review before the Phase 2 commit**
- Before committing, the user reviewed the Phase 2 work and identified that
  `ProjectSite.defaultBankId` (added during this session) was wrong for Broom Services' actual
  business model: Project Sites are physical work locations only; employees own their own payment
  method/bank account; Broom Services itself owns the company bank account(s) used as disbursement
  *source* accounts. Removed `defaultBankId` completely — schema, the hand-edited (never-applied)
  migration, shared Zod schema, backend service/routes, frontend form/table, HTML prototype, and
  `docs/architecture/database-schema.md`'s §7/§8/§21 text (with an explicit dated revision note,
  since that document is otherwise frozen). See `docs/PROJECT_PROGRESS.md` §3 item 6 for the full
  reasoning.
- Performed a full architecture consistency review against the corrected business model and
  surfaced two further items *without* silently fixing them — `docs/PROJECT_PROGRESS.md` §3 items
  7–8: (a) Broom Services' own disbursement source bank account(s) aren't modeled anywhere yet
  (matters for Phase 4, not Phase 2); (b) `ProjectSite` may be missing `address`/`client` fields per
  the user's own restated model, though site names already encode the client as free text so this
  may not be a real gap. Both presented to the user for a decision, not resolved.
- Confirmed the deployment model is unaffected: single-company-per-installation (the `CompanySettings`
  singleton, fixed-UUID pattern) with no `Tenant`/`Organization`/`Workspace`/`Company` abstraction
  anywhere in the codebase — nothing needed to change here, this was a confirmation, not a fix.
- Re-ran `typecheck`/`lint`/`build` after the correction; this file and `docs/PROJECT_PROGRESS.md`
  updated again to reflect the revised Phase 2 state. A commit is still pending explicit user
  approval, now for the corrected version of Phase 2.
- **This Phase 2 work was subsequently committed as `674ab04`** ("Phase 2: Project Sites, Employee
  Registry, Settings, User Management") — the commit approval referenced above was obtained and
  acted on; `674ab04` is HEAD as of the polish pass below.

**Later same day: Phase 2 UI/UX polish pass (explicitly not Phase 3)** — full detail in
`docs/PROJECT_PROGRESS.md`'s "Phase 2 UI/UX polish pass" subsection. Summary: fixed a global
`AppShell` scroll bug (blank space above the sidebar on overscroll), added a local-time-based
dashboard greeting, fixed an Employee Registry table header/value alignment mismatch, added
`ProjectSite.address` (a scoped, explicitly user-authorized exception to this pass's own
no-schema-changes rule — see `docs/PROJECT_PROGRESS.md` §3 item 8 and
`database/sites-and-units.md` §8's revision note), added a Company Logo placeholder section
to Settings and a matching logo slot on the login page (both UI-only, still blocked on
`StorageProvider`), improved Settings page spacing/hierarchy, standardized the seed script's company
name to "Broom Services Private Limited", and standardized `Button` height to match `Input`. A new
migration (`20260702165738_project_site_address`) was hand-written the same way as Phase 2's
migration, for the same reason (no Postgres reachable in this environment to run `prisma migrate
dev`) — validated via `prisma validate`/`format`, not yet applied to a live database.

**Still later same day: final visual consistency audit, then the Phase 2 checkpoint close.** The user
asked for one more pass — a full audit of every page/modal for spacing, alignment, typography,
padding, table headers, button heights, card widths, modal spacing, and responsive behavior — before
Phase 3. This is where Playwright-driven visual verification (real headless-Chromium rendering with
mocked API responses, screenshotted and measured, not just read as code) was actually used for the
first time in this project, and it caught two real, previously-undetected defects: a design-system-
contradicting label-casing inconsistency (8 call sites overriding the shared `Label` component to
`normal-case` for no discernible reason, contradicting `docs/design-system.md` §2.4's explicit
uppercase-filter-label rule) and a spacing value outside the documented scale (`gap-8`/`gap-9`,
self-introduced earlier the same pass). Both fixed. A suspected z-index stacking bug (dropdown menu
apparently rendering on top of a modal opened from it) was investigated with pixel-level sampling and
found to be a false alarm — a defensive fix was kept anyway (`Modal` now explicitly outranks
`DropdownMenuContent` in z-index) since it costs nothing and removes an implicit assumption. Full
detail in `docs/PROJECT_PROGRESS.md`'s "Final visual consistency audit" subsection.

**This ordering was revised 2026-07-03 (Phase 2.5, Checkpoint 1) — `DropdownMenuContent` now
outranks `Modal`, not the other way around.** Checkpoint 1's Manage Units panel was the first place
in the app a `DropdownMenu` opens *from inside* an already-open `Modal`, and at the old ordering
this was a confirmed, reproducible bug (not a false alarm this time): the open Modal's own overlay
permanently intercepted every click on the nested dropdown's menu items. See
`docs/PROJECT_PROGRESS.md`'s Checkpoint 1 entry for the full reasoning and the trade-off this
re-opens (a still-unconfirmed, purely cosmetic transition-overlap risk in the original direction).

The whole polish pass (layout fix, greeting, table alignment, Project Sites address, logo
placeholders, Settings layout, company name, button/input heights, plus this audit's two fixes) was
committed together as `89ac6ff` ("feat(ui): Phase 2 UI polish and UX improvements") after explicit
user approval — the commit message the user asked for at the start of the pass. The user then
explicitly stated **"Phase 2 is now complete"** and requested this formal checkpoint (this
documentation update), on the same conditional basis as Phase 1's closure (`docs/PROJECT_PROGRESS.md`
§4's DB-backed-verification caveat carried forward as a tracked open item, not a blocker). **Phase 3 has not started
and must not begin without the user's explicit instruction next session.**

### What was completed this session (2026-07-03 to 2026-07-04)

A new session, picking up per "How to Resume This Project": confirmed branch/commit/clean tree
against `74c124e`, re-read the full doc set, and confirmed Phase 2 plus the pre-Phase-3 architecture
review were both genuinely complete and committed.

- **Approved the Phase 2.5 checkpoint breakdown** (Checkpoints 0–4) with five amendments: a
  Checkpoint 0 foundation step, three-layer Site/Unit import validation, dedicated employee transfer
  audit entries, a finalized CNIC/Reactivate policy (CNIC stays globally unique, no override,
  Reactivate for rehires), and the new `EmployeeTransferHistory` table — refined further to add
  `effectiveDate`/`remarks`/`transferredByUserId` and an explicit single-source-of-truth requirement
  for date formatting.
- **Checkpoint 0** — shared `formatDate()`/`parseDateInput()`/`toIsoDateOnly()` and a `DateInput`
  component; a full-codebase grep caught and fixed two pre-existing ad-hoc date-formatting call sites
  in the CSV/Excel export/import service. Committed as `0d9ea33`.
- **Checkpoint 1** — `ProjectUnit` as a dedicated master-data module, `ProjectSite.unitLabel`
  replacing `branchCode`, a "Manage Units" frontend panel. Playwright verification caught and fixed
  two real bugs: a nested-`Modal` Radix `aria-hidden` bug, and a `DropdownMenuContent`-behind-`Modal`
  z-index bug (this project's first `DropdownMenu`-inside-`Modal` usage). Committed as `c60094c`.
- **Checkpoint 2** — `Employee.unitId` + composite FK, `EmployeeTransferHistory`, atomic transfer
  writes (which also fixed a pre-existing, unrelated audit-logging atomicity gap in the ordinary
  employee-update path), a reusable `SiteUnitSelect` component, interim import/export unit handling.
  Also honored a Checkpoint-1 forward-reference by wiring up `deleteProjectUnit`'s previously-a-no-op
  delete guard. Committed in this session's final commit, together with this documentation update and
  refreshed HTML prototypes.
- **All four `docs/prototypes/*.html` files reviewed and updated** to reflect Checkpoints 0–2:
  Branch Code → Unit label throughout, a new "Manage Units panel" screen, `DD-MM-YYYY` date
  placeholders, a Site → Branch/Department cascading select in the Employee form. The two prototypes
  with nothing relevant to change (`phase1-preview.html`, `phase2-settings-users-preview.html`) were
  still reviewed individually and got a footer note confirming that review took place.
- **Full documentation consistency pass**: `IMPLEMENTATION_PLAN.md`, `PROJECT_PROGRESS.md`,
  `SESSION_HANDOFF.md` (this file), and `README.md` all updated to remove stale commit-hash
  references, "not yet committed" phrasing for now-committed work, and the outdated claim that
  Phase 2.5 was "architecture/documentation only."
- **The session was explicitly closed after Checkpoint 2** — the user's instruction was not to begin
  Checkpoint 3, and to make closing the database-verification debt the mandatory first task of the
  next session, ahead of any further implementation.

### What was completed this session (2026-07-04, evening): database-verification debt CLOSED

Executed exactly per §7 item 1 (as it stood): provisioned real PostgreSQL 18.4 in the sandbox
scratchpad via `@embedded-postgres/darwin-x64` (no Docker/Homebrew exists here; the binaries run
TCP-only on `localhost:5432` because the scratchpad path exceeds the Unix-socket length limit),
created the `payroll`/`payroll_dev` role/database matching `backend/.env.example`, and ran the full
sequence: `migrate deploy` (all six migrations applied to a fresh DB, unmodified, first try) → seed
(run twice — idempotency confirmed live) → full test suite.

**The first live run failed and surfaced four real defects, all fixed the same session** (full
detail: `docs/PROJECT_PROGRESS.md` §1 "Database verification"):
1. The Audit Log immutability trigger blocked the FK's own `ON DELETE SET NULL` — any `User` with
   audit history was undeletable, contradicting `database/audit-log.md` §16. Fixed by a new migration,
   `20260704180000_audit_log_allow_fk_actor_set_null` (permits exactly that one column transition,
   rejects everything else); dated revision notes added to `database/audit-log.md` §16 and
   `docs/architecture/system-conventions.md` §3.
2. Every `Employee` date write 500'd against real Postgres (Prisma `@db.Date` rejects the bare
   `YYYY-MM-DD` strings the Zod schemas produce) — create-with-DOB, mark-as-left, transfer
   `effectiveDate`, and import DOB/DOJ/DOL were all affected. Fixed via a new shared
   `isoDateToUtcDate()` in `shared/src/lib/date.ts`, applied at every Prisma date-write boundary.
3. `cleanTestData()` deleted AuditLog rows — rejected by the project's own trigger. Tests no longer
   delete audit rows (assertions were already entity-scoped); `EmployeeTransferHistory` cleanup was
   added in FK-safe order (its `RESTRICT` FKs otherwise block employee/user cleanup).
4. The login rate limiter (10/IP/15 min) tripped under one-login-per-test; relaxed to 1000 under
   `NODE_ENV=test` only — production limit unchanged.

After the fixes: **78/78 tests, 10/10 suites, green**; a second fresh database replayed all seven
migrations + seed + suite from zero; `prisma migrate diff` against a real shadow DB shows no drift;
raw-SQL probes confirmed the composite FK rejects cross-site pairs at the database level and the
audit trigger still rejects ordinary UPDATE/DELETE. Then typecheck/lint/build (all clean; frontend
`.tsbuildinfo` cleared first per §3's standing lesson) and a real-stack Playwright E2E — seeded-admin
login, site + two units created, employee created **with a DOB** (exercising fix 2 end to end), DOB
round-tripping as `15-03-1990`, same-site transfer writing its `EmployeeTransferHistory` row and
`employee.transferred` audit entry — zero console errors. E2E fixtures were cleaned from the dev DB
afterward (audit rows remain, by design). **Phase 1's five open DB-backed checklist items and
Phase 2's one are now genuinely closed — see §5/§6.**

### What was completed this session (2026-07-04, evening, continued): Checkpoint 3

Built immediately after the database verification closed, per the session plan — the first
checkpoint in this project developed with its DB-backed tests actually running. Full detail:
`docs/PROJECT_PROGRESS.md` §1's Checkpoint 3 subsection; plan text updated in
`docs/IMPLEMENTATION_PLAN.md` (Checkpoint 3 marked COMPLETE with the as-built mapping).

- **Export**: `Area`/`Area/Location` → the employee's `ProjectUnit.name` (documented aliases);
  `Branch Code` → `ProjectUnit.code`. The template's mapping comment is now a finalized decision,
  resolving `docs/PROJECT_PROGRESS.md` §3 item 5 (subject to one client sanity-check).
- **Import**: `resolveRowUnit()` resolves a row's unit within its named site by code, then name,
  case-insensitively; all provided columns must agree; a row naming no unit is a per-row error —
  Checkpoint 2's interim single-unit auto-resolution is gone. Error messages use the site's own
  `unitLabel` via `pluralize()`.
- **Three-layer validation**: (1) `resolveRowUnit()` explicitly rejects a unit that exists under a
  *different* site, naming the mismatch; (2) `assertUnitBelongsToSite()` — now exported — is
  re-asserted before every import write; (3) the composite FK backstops, now with its own raw-write
  test. Each layer has a test proving it catches the violation alone.
- **Import-driven transfers are real transfers**: `updateEmployee()`'s transfer block was extracted
  into a shared `recordEmployeeTransfer()` (single implementation of the history-row +
  `employee.transferred`-entry invariant); the import path calls it atomically with the row update
  whenever a row changes an existing employee's site/unit (reason: "Employee Registry import").
  `importEmployees()` now takes `RequestMeta`. The one-summary-`employee.import`-entry design is
  unchanged for non-transfer rows.
- **88/88 tests against live PostgreSQL**; typecheck/lint/build clean; real-stack Playwright pass
  drove an actual CSV upload through the UI (2 created, 1 cross-site row skipped with the exact
  per-row reason shown in the Import Results modal; units verified via the edit form; zero console
  errors). Prototypes reviewed — none depict import contents, none changed.

### What was completed this session (2026-07-05): Phase 3 Architecture Review — COMPLETE, no code

A dedicated, explicitly design-only session ("do not begin implementation yet" was the opening
instruction) run immediately after Phase 2.5 Checkpoint 4 closed. Objective: freeze the complete
Payroll Entry, Payroll Processing, Release, and Corrections/Balance Adjustments architecture before
any Phase 3 code is written, incorporating six new business rules — the system is not an attendance
management system; payroll managers may freely edit until release; "Ready for Release" is a
non-locking status; payroll releases independently per Project Unit; Finance may release immediately
or wait for client funding; corrections after release require Master User approval, with positive/
negative balances settling differently (immediate/deferred, or installment recovery).

**Full decision record: `docs/PROJECT_PROGRESS.md` §1's "Phase 3 Architecture Review" subsection** —
not duplicated here in full; the highlights any future session needs to know before touching Phase 3:

- **Release moves to Project Unit granularity** (`PayrollUnitRelease`, `database/release.md` §12b),
  executed by a new **Finance** role, not Payroll Staff. `PayrollEntry.released` keeps its existing
  shape but is now *derived* — an entry releases only once every Project Unit its work lines touch has
  released, so a multi-unit split employee (Phase 2.5's own capability) still resolves to exactly one
  net salary and one Bank Sheet row (Principle 1, 6 both held intact — this was the session's central
  design fork, resolved after weighing three candidate options with the user).
- **`PayrollUnitReadiness`** — the new, explicitly non-gating "Ready for Release" signal, modeled by
  row existence (not a boolean), the one deliberate exception to this schema's anti-deletion
  convention.
- **The correction trigger simplifies to one clause**: `PayrollEntry.released = true` (previously two
  clauses — released OR cycle-not-Draft — now redundant since Cycle status is itself derived).
- **`CorrectionRequest`** (`database/corrections.md §13a`) — any authorized payroll user may propose a correction; only a Master
  User may approve (producing a `Correction`) or reject it. A Master User correcting personally still
  bypasses this table entirely, unchanged from before this session.
- **`BalanceAdjustment` gains immediate/deferred timing** (`PAYABLE`, via a new `CorrectionPayment`
  table for the no-open-entry case, `database/balance-adjustments.md §14a`) **and installment recovery** (`RECOVERY`, via
  `recoveryInstallmentAmount`/`remainingAmount` and a new append-only `BalanceAdjustmentSettlement`
  history table, `database/balance-adjustments.md §14b`, mirroring `Advance.scheduledInstallmentAmount`'s and
  `EmployeeTransferHistory`'s already-established patterns respectively).
- **Late Entry exception**: an entry created after its Unit already released needs its own one-off
  release (`PayrollEntry.lateReason`, a single field — "is this entry late" is derived, never stored).
  Documented (not yet built): its one-off document should share implementation with
  `CorrectionPayment`'s where practical, while staying separate business entities.
- **`FINANCE`** — new, third, site-scoped role (reuses `UserSiteAssignment`, no new mechanism); can
  view payroll/release Units/execute Correction Payments; explicitly cannot edit payroll, mark Ready,
  or approve/reject corrections.
- **"Master Admin" renamed "Master User"** — `docs/architecture/*.md` and `docs/IMPLEMENTATION_PLAN.md`
  **only**. Not applied to `reference/PROJECT_SPEC.md` (frozen, never edited), the HTML prototypes
  (reviewed this session, left unchanged — see below), or this file's/`PROJECT_PROGRESS.md`'s own
  historical entries.

**Net schema growth:** 5 new tables, 2 new enums, 4 new columns across `PayrollEntry`/
`BalanceAdjustment` — bringing the documented schema to 25 tables. **None of this exists in
`backend/prisma/schema.prisma` yet** — it's a design specification, same as the rest of
`docs/architecture/database/`, waiting for Phase 3 implementation.

**Files touched:** `docs/architecture/database-schema.md`, `data-and-storage.md`,
`post-release-corrections.md`, `authentication.md`, `overview.md`, `docs/IMPLEMENTATION_PLAN.md`
(Phase 3/4/6 sections + file-wide Master User rename). `docs/PROJECT_PRINCIPLES.md` reviewed, no
changes needed — every decision is additive/consistent with the existing ten principles.

**HTML prototypes reviewed this session, none refreshed**: none of the four existing prototypes
(`phase1-preview.html`, `phase2-project-sites-preview.html`,
`phase2-employee-registry-preview.html`, `phase2-settings-users-preview.html`) depict Payroll Entry,
Release, or Corrections screens, so nothing in them is factually contradicted by tonight's decisions.
The full UI/UX prototype pass for these new screens stays deferred until the corresponding functional
phases are actually built, per standing project practice — this was a deliberate "leave alone unless
factually wrong" review, not an oversight.

**No architectural questions remain open from this session.** Pre-existing open items unrelated to
tonight (Company Bank Account modeling, at-most-one-`ACTIVE`-`Advance`-per-type, calendar-month-only
cycles — `docs/PROJECT_PROGRESS.md` §3) are untouched, still open on their own original timelines.

**Documentation architecture restructuring — COMPLETE, 2026-07-08.** Commit `cfc4ef4`
(`docs(architecture): split architecture into modular bounded-context documentation`).
`docs/architecture/database-schema.md`, `data-and-storage.md`, and `post-release-corrections.md`
were split into bounded-context files under the new `docs/architecture/database/` (13 schema files
+ `README.md` index), the new `docs/architecture/workflows/` (3 workflow narratives), and a new
`docs/architecture/system-conventions.md`, per a restructuring plan frozen across multiple
architecture-review rounds — global §-numbering preserved unchanged, the Documentation Ownership
Rule and a size guideline adopted (`docs/architecture/folder-structure.md`). **Documentation-only:
no application behavior, database schema, migrations, or API surface changed** — every code and
migration comment citing an old path was rewritten to its new location (migration `.sql` files had
only `--` comment lines touched, never DDL), and all three workspaces typecheck cleanly. A
dedicated pre-commit documentation-integrity audit (bare `§N` cross-reference review across the
three process docs) preceded the commit.

## 3. What must not be changed without approval

- Anything in `docs/architecture/*.md` or `docs/PROJECT_PRINCIPLES.md` — the architecture is
  explicitly frozen (see `docs/IMPLEMENTATION_PLAN.md`'s opening section). Any implementation detail
  that appears to contradict these documents must be raised, not silently reinterpreted.
- The phase ordering and review checkpoints in `docs/IMPLEMENTATION_PLAN.md` (🛑 after Phase 1,
  Phase 3, Phase 5, Phase 6, Phase 9) — these are explicit stop-and-approve gates, not suggestions.
- The Phase 1 Prisma schema's table scope (`Role`/`Permission`/`RolePermission`/`User`/
  `ProjectSite`(minimal)/`UserSiteAssignment`/`AuditLog`) is now the **confirmed, permanent** Phase 1
  scope — resolved 2026-07-02, see `docs/PROJECT_PROGRESS.md` §3.1. `Bank`/`AdjustmentType`/
  `CompanySettings` belong to Phase 2 per the now-updated `docs/IMPLEMENTATION_PLAN.md`. Do not
  re-litigate this without a new explicit request.
- Audit Log immutability: no application code path should ever add an update/delete export from
  `audit-log.service.ts`, and the database trigger (originally
  `20260701164509_audit_log_immutability`, amended by
  `20260704180000_audit_log_allow_fk_actor_set_null`) must never be dropped or worked around.
  **The 2026-07-04 amendment is not a weakening**: it permits exactly one UPDATE shape — the
  `actorUserId` NOT NULL → NULL transition the FK's documented `ON DELETE SET NULL` action produces
  (`database/audit-log.md` §16's revision note) — and still rejects every other UPDATE and all DELETEs,
  verified live. Do not widen it further.
- **New rule (2026-07-04): every Prisma write to a `@db.Date` column goes through
  `isoDateToUtcDate()`** (`shared/src/lib/date.ts`) — Prisma rejects the bare `YYYY-MM-DD` strings
  the Zod schemas validate, and this was a real, live-DB-only 500 on every Employee date write.
  When adding any new date field (Phase 3's cycles, Phase 4's advances `dateGiven`, etc.), convert
  at the write boundary; grep for unconverted writes before calling the work done.
- Existing migrations (`20260701164444_init`, `20260701164509_audit_log_immutability`,
  `20260702084133_phase2_master_data`, `20260702165738_project_site_address`,
  `20260703100000_project_units`, `20260703140000_employee_unit_and_transfer_history`,
  `20260704180000_audit_log_allow_fk_actor_set_null`) should not be edited in
  place once applied anywhere beyond a fresh local dev database — per Principle 8 (additive-first
  schema evolution), later changes are new migrations, not edits to these. All seven are now
  verified against real PostgreSQL (2026-07-04).
- The C11 decision (Payroll Staff fully site-scoped on Employee Registry view/edit/create, no
  exceptions) is enforced via `assertSiteAccess()` in
  `backend/src/modules/employees/employees.service.ts` on every read/write path, including the
  site-change case on update and the import path. Do not add a code path that trusts a
  client-supplied `siteId` without this check.
- The `StorageProvider` gap (`docs/PROJECT_PROGRESS.md` §3 item 4) is a known, flagged deviation
  from the frozen Phase 0 plan — do not silently build an ad-hoc file-upload mechanism to route
  around it (e.g. a one-off multer-to-disk handler for the logo). **Confirmed 2026-07-02: deferred
  until before Phase 5**, not Phase 3 or Phase 4 — do not add file upload UI before then without
  building `StorageProvider` first. **New consideration, confirmed 2026-07-02** (`docs/PROJECT_
  PROGRESS.md` §3 item 13): design it for portability to whatever hosting a given customer provides —
  the deployment model remains single-company-per-installation (no multi-tenancy), but is not assumed
  to run on one specific hosting platform.
- **New, permanent process rule, added 2026-07-02**: every future phase's Definition of Done includes
  Playwright-driven visual verification (real headless-browser rendering + screenshots, mocked API
  data where no live backend/DB is available) as a mandatory step, in this order: typecheck → lint →
  build → Playwright visual verification → documentation update → git checkpoint. This is not optional
  polish — it caught real defects in the Phase 2 UI polish pass that static checks alone missed (see
  §2's final entry). Do not skip it for a future phase's frontend work on the assumption that
  typecheck/lint/build passing is sufficient.
- **New 2026-07-03, final architecture decisions — do not re-litigate:**
  - `ProjectSite` no longer owns a Branch Code or Department; `ProjectUnit` (a new, dedicated
    master-data module, not folded into Project Sites) is the operational sub-division an employee is
    deputed to. Internally generic, always displayed via that site's own `unitLabel` terminology.
  - **Explicit business rule, not merely a schema implication:** a `PayrollEntryWorkLine` may only
    reference a `ProjectUnit` belonging to the same `ProjectSite` as its parent `PayrollEntry` — an
    employee's Work Lines can never span more than one Project Site within a single cycle. Enforced
    at **two** independent layers, both required, neither a substitute for the other: a
    database-level **composite foreign key** (`(unitId, siteId) → ProjectUnit(id, siteId)`) and
    application-layer validation. `Employee.unitId` is paired with `Employee.siteId` the same way.
    Do not simplify either to a plain FK.
  - **Every `PayrollEntry` always has at least one `PayrollEntryWorkLine` — never optional, never
    zero.** This was an explicit simplification the user requested over an earlier "optional split"
    design specifically to keep `calcNet` to one calculation path. Do not reintroduce a
    split/non-split branch.
  - **No cross-site editing exception of any kind for a multi-unit employee.** Payroll Staff remain
    scoped to their assigned Project Sites only; multi-unit splitting is always intra-site (a
    `ProjectUnit` belongs to exactly one `ProjectSite`), which is precisely what makes this possible
    without a new RBAC concept. Do not add one.
  - Every user-facing date renders as `DD-MM-YYYY`; internal storage/API stay ISO. This is
    `docs/design-system.md` §4, a permanent UI standard, not a suggestion.
  - `docs/PROJECT_PRINCIPLES.md` Principle 10: the system must comfortably support **at least 10,000
    employees**. This is a design floor to weigh in every future phase, not a Phase 9 concern —
    Principle 4 (never sacrifice correctness for performance) is explicitly not in tension with it.
  - **CNIC duplicate handling is now finalized (2026-07-03, session 2) — no longer pending.** CNIC
    stays globally unique with no override mechanism; duplicate `Employee` records are never
    permitted; rehires go exclusively through a new Reactivate Employee action that updates the
    existing row in place. See `database/schema-invariants.md` §26 item 6 (rewritten as a final
    decision) and `docs/PROJECT_PROGRESS.md` §3 item 22. **Per standing instruction, the concrete
    implementation (exact endpoint shapes, fields touched, audit contents) still gets presented for
    approval before Checkpoint 4's code is written** — the policy is settled, the implementation still
    gets a design-review gate.
  - **`EmployeeTransferHistory`** (new table, `database/employee.md` §8b) — one row
    per Employee site/unit transfer (`effectiveDate`, `transferredByUserId`, optional `reason`/
    `remarks`, `createdAt`), append-only except by direct database intervention, no UI in Phase 2.5.
    Employee transfers also write a dedicated `employee.transferred` `AuditLog` entry, not the generic
    `employee.updated` entry. Do not fold these into a generic update path.
  - A new **Phase 2.5** (`docs/IMPLEMENTATION_PLAN.md`) sits between Phase 2 and Phase 3, now broken
    into five explicit, individually-gated checkpoints (0–4). **Checkpoints 0, 1, and 2 are all
    committed; Checkpoints 3–4 have not started**, and won't until the database-verification debt
    (§1 above) closes out. Phase 3 depends on it (specifically, `PayrollEntryWorkLine.unitId` cannot
    exist without `ProjectUnit`, built in Checkpoint 1).
  - **`ProjectUnit` now exists in the schema and is queryable** (Checkpoint 1,
    `backend/prisma/schema.prisma`, migration `20260703100000_project_units`) — nested under a
    Project Site, CRUD via the dedicated `project-units` module
    (`backend/src/modules/project-units/`), mounted at `/api/v1/sites/:siteId/units` (list/create,
    `requireSiteAccess`-gated) and `/api/v1/units/:id` (update/delete, `sites:manage`-gated).
    `ProjectSite.branchCode` no longer exists anywhere in the codebase — it is `unitLabel` now.
    `deleteProjectSite` blocks on referencing `ProjectUnit` rows in addition to `Employee` rows.
    **`Employee.unitId` still does not exist** (Checkpoint 2) — `deleteProjectUnit`'s guard is
    therefore currently a no-op in practice (nothing references a unit yet) and is explicitly flagged
    as such in its own code comment; do not mistake this for a finished guard.
  - **`DropdownMenuContent`'s z-index was raised above `Modal`'s (`z-[70]` vs. `z-[60]`), reversing
    the 2026-07-02 Phase 2 polish-audit ordering** (`frontend/src/components/ui/dropdown-menu.tsx`,
    `modal.tsx`). Checkpoint 1's Manage Units panel was the first place in the app a `DropdownMenu`
    opens *from inside* an already-open `Modal`; at the old ordering this was a **confirmed,
    reproducible bug** (not the "false alarm" the 2026-07-02 audit found in the other direction) — the
    open Modal's own overlay permanently intercepted every click on the nested dropdown, verified via
    Playwright to persist indefinitely, not just during a transition. This re-opens a still-unconfirmed,
    purely cosmetic risk in the original direction (a dropdown closing at the same moment a new Modal
    opens from it could theoretically render above that new Modal during the fade transition) — judged
    an acceptable trade-off since that risk was never confirmed as a real bug, while the one just fixed
    was. Do not revert this ordering without re-verifying the Manage Units panel (or any future
    dropdown-inside-modal usage) still works.
  - **`Employee.unitId` now exists and is required** (Checkpoint 2, migration
    `20260703140000_employee_unit_and_transfer_history`), composite-FK'd against
    `ProjectUnit(id, siteId)`. Every place that creates an `Employee` — the API, the CSV/Excel
    importer, and every test fixture — must supply a valid `unitId` belonging to the same site.
    `deleteProjectUnit`'s delete guard (Checkpoint 1, previously a documented no-op) is **now wired
    up** to block deletion while any `Employee.unitId` references the unit, honoring the forward
    reference left in that function's own Checkpoint 1 code comment — the `PayrollEntryWorkLine`
    half of this guard still belongs here once Phase 3 adds that table.
  - **`EmployeeTransferHistory` exists and is written to** whenever an Employee edit changes
    `siteId`/`unitId`, in the same transaction as the Employee update and a dedicated
    `employee.transferred` `AuditLog` entry (never the generic `employee.updated` entry for that
    specific change — other fields changed in the same request still get the generic entry). No UI
    consumes this table yet, per the original design.
  - **A pre-existing atomicity gap, unrelated to the new transfer logic, was found and fixed while
    implementing Checkpoint 2's explicit "atomic in a single transaction" requirement**: before this
    checkpoint, `employees.routes.ts`'s PATCH handler logged the generic `employee.updated` audit
    entry itself, *after* `updateEmployee()` returned — not in the same database transaction as the
    `Employee` row update, a real (if narrow) Principle 3 violation. Fixed by moving all audit
    logging for employee updates inside `updateEmployee()`'s own `prisma.$transaction(...)`. This
    wasn't asked for directly, but was necessary to make the transfer case genuinely atomic, and the
    fix applies to the ordinary update path too, not just the new one.
  - **Lesson learned, worth repeating for future sessions**: a stale `tsc -b` incremental cache
    (`frontend/dist-types-app/*.tsbuildinfo`) briefly reported a clean frontend typecheck despite a
    real, missing-`unitId` type error in `employees-page.tsx` — caught only because the clean result
    looked suspicious given that file hadn't been touched yet. **Whenever `@payroll/shared` changes,
    clear frontend's `.tsbuildinfo` files before trusting `npm run typecheck --workspace frontend`.**
- **New 2026-07-05, Phase 3 Architecture Review — final decisions, do not re-litigate:**
  - **Release granularity is per Project Unit, not per Site/Cycle.** `PayrollUnitRelease`
    (`database/release.md` §12b) is the release event; `PayrollEntry.released` is derived from it,
    releasing an entry only once *every* Project Unit its work lines touch has released. Do not
    reintroduce a direct per-employee "release" write path, and do not collapse a multi-unit entry's
    release back to "whichever unit releases first" — it must wait for all of them, preserving one
    entry/one net salary/one Bank Sheet row.
  - **`PayrollUnitReadiness` ("Ready for Release") is permanently non-gating.** Do not add any code
    path where Finance's ability to release a Unit depends on whether it was marked Ready — this was
    an explicit business rule ("NOT locked"), not an oversight to "fix" later.
  - **`FINANCE` is a real, permanent third role**, site-scoped identically to Payroll Staff, holding
    `payroll:view` (read-only) + `payroll:release` + `bank-sheets:view`/`cash-receiving:view` only. Do
    not grant Finance payroll-edit, mark-ready, or corrections-approve/reject permissions — the
    separation of preparation/execution/governance across Payroll Staff/Finance/Master User is
    deliberate, not provisional.
  - **The correction trigger is now one clause**: `PayrollEntry.released = true`. Do not reintroduce
    the old two-clause "OR cycle no longer Draft" form — it's now redundant by construction, since
    Cycle status is itself derived from Unit releases.
  - **`CorrectionRequest` (`database/corrections.md §13a`) is the only path for a non-Master-User-initiated correction.** A
    Master User correcting directly still bypasses it entirely — do not force every correction through
    the request table regardless of who's making it.
  - **`BalanceAdjustment.paymentTiming`/`recoveryInstallmentAmount`/`remainingAmount` are additive.**
    `NULL` `recoveryInstallmentAmount` must continue to reproduce the original full-amount-next-cycle
    behavior exactly — this is a regression risk worth its own explicit test when Phase 6 is built.
  - **A Late Entry (`PayrollEntry.lateReason`) only applies while its Cycle is still Draft.** Do not
    extend this exception to an already-`Released` cycle — a new hire after full cycle finalization
    simply waits for the next cycle, no exception needed there.
  - **"Master Admin" → "Master User" is scoped to `docs/architecture/*.md` and
    `docs/IMPLEMENTATION_PLAN.md` only.** Do not rename it in `reference/PROJECT_SPEC.md` (frozen,
    never edited) or in this file's/`PROJECT_PROGRESS.md`'s own historical entries describing what was
    literally built and named at the time — those are accurate historical record, not architecture.
  - **Full decision record:** `docs/PROJECT_PROGRESS.md` §1's "Phase 3 Architecture Review"
    subsection. **Phase 3 implementation still requires separate, explicit authorization** — the
    architecture being frozen does not itself authorize starting to write code.
- **New 2026-07-07, Phase 3 Checkpoint 0 — implementation decisions, do not re-litigate:**
  - **`PayrollEntry.advanceId`/`.eidAdvanceId` do not exist yet.** Deferred to a Phase 4 additive
    migration (they FK to `Advance`, which Phase 4 builds). Do not add them to a Checkpoint 1–6
    migration — they land specifically when Phase 4 introduces `Advance`.
  - **`PayrollEntry.remarks` (nullable text) exists**, an approved addition beyond
    `database/payroll-entry.md` §12's original design — ordinarily Draft-editable, frozen into the permanent
    snapshot once released, intended as the Payroll Entry grid's last column (a later checkpoint's UI
    work, not yet built).
  - **`calcNet`'s implementation lives in `shared/src/lib/calc-net.ts`**, not backend-only — exported
    from `@payroll/shared`, built on a new `decimal.js` dependency. **There must be exactly one
    implementation**, used by backend Payroll Processing, the frontend's live grid totals,
    import/export, reports, and (Phase 6) correction calculations. Do not write a second, backend- or
    frontend-only reimplementation of this formula anywhere.
  - **Rounding policy, do not relitigate**: every intermediate value feeding a further
    multiplication/division (daily rate, effective OT rate, effective leave rate) is carried at full
    decimal precision and never rounded before use in the next step. Only `earnedAmount`/`otEarned`/
    `leaveEarned` — each "done" being multiplied/divided — are rounded to 2dp (`ROUND_HALF_UP`).
    `totalEarning`/`totalDeduction`/`netSalary` are pure addition/subtraction of already-2dp values,
    guaranteeing `netSalary` always exactly equals `totalEarning - totalDeduction` as displayed. Do
    not round a rate before multiplying it, and do not compute `netSalary` from independently
    re-rounded full-precision totals — the existing addition-of-already-rounded-values approach is
    what keeps the payslip's own numbers internally consistent.
  - **No routes, service layer, frontend component, cycle-bootstrap action, or `AuditLog`/RBAC changes
    exist for Payroll Entry/Processing yet.** Checkpoint 0 is schema/migration + `calcNet` only.
    Checkpoint 1 owns the cycle bootstrap ("Start First Payroll Cycle", Master-User-only, audited,
    available only when zero `PayrollCycle` rows exist) and the first CRUD/read routes.
  - **`--shadow-database-url` must always point at a dedicated, disposable database** (e.g.
    `payroll_shadow`), never the working `payroll_dev` scratch database — Prisma uses that URL as
    scratch space and will reset whatever database it points at. This was a real process mistake this
    checkpoint (no lasting harm, since `payroll_dev` is ephemeral by design, but avoid repeating it).
  - **Full decision record:** `docs/PROJECT_PROGRESS.md` §1's "Phase 3, Checkpoint 0" subsection.
    **Checkpoint 1 still requires its own separate, explicit authorization** — Checkpoint 0 being
    complete does not itself authorize starting Checkpoint 1.
- **New 2026-07-07, Phase 3 Checkpoint 1 — implementation decisions, do not re-litigate:**
  - **`createPayrollCycle` is one function for both the first-ever cycle and every subsequent
    one.** Enforces only the one timeless invariant (§10): a single `DRAFT` cycle at a time. It
    does **not** require the outgoing cycle to be `RELEASED`, does not archive it, does not
    generate a `BackupPackage`, and does not account for departed employees with a pending
    `BalanceAdjustment` — that full transaction is explicitly Phase 5's job. Do not extend
    `createPayrollCycle` with any of that; build it as Phase 5's own, separate mechanism when
    Finalize/Release/`BackupPackage`/`BalanceAdjustment` exist.
  - **The Payroll Bootstrap Rule — a frozen business rule, confirmed 2026-07-07 (do not
    re-litigate):** a continuing employee's `grossPay`/`eobiAmount`/`eobiApplicable`/`leaveRate`
    and new line's `cycleDays`/`otRate` — payroll-specific values — always come from their most
    recent **prior entry**, never `Employee`'s own record (payroll values represent payroll history
    and stay stable until intentionally changed in Payroll Entry itself). `designation`, `bankId`,
    `branchCode`, `accountNumber`, `accountTitle`, and the new line's `unitId` (Primary Project
    Unit) always refresh from `Employee`'s **current** record instead (Employee master data should
    always reflect the latest assignment/banking information) — which is also what keeps a
    cross-site transfer's new entry consistent with its own work line's unit (the composite-FK
    invariant). Do not change which fields draw from which source without a new explicit decision.
  - **`PayrollEntry.siteId` is permanently non-editable via the update API — confirmed 2026-07-07,
    do not re-litigate.** Future site changes flow exclusively through the Employee Transfer
    workflow (picked up automatically by the next cycle's bootstrap via the Payroll Bootstrap Rule
    above), never a direct edit to an existing entry's site.
  - **`PERMISSIONS.PAYROLL_CYCLE_MANAGE` is Master-User-only** — cycle creation is a
    system-lifecycle action, not Payroll Staff's routine data entry. Do not grant it to Payroll
    Staff or fold it into `PERMISSIONS.PAYROLL_ENTRY`.
  - **Work-line mutations never get their own `AuditLog` action type.** Adding/updating/deleting a
    `PayrollEntryWorkLine` is folded into a `payroll_entry.updated` entry (`database/schema-invariants.md §22`'s explicit
    instruction) — do not introduce a `payroll_entry_work_line.*` action.
  - **`deletePayrollEntry` is permitted only while unreleased and the cycle is still Draft** — this
    is Draft data entry, not yet "historical payroll," so Principle 2 does not block it. Do not
    extend delete permission to a released entry or a non-Draft cycle.
  - **`backend/src/common/audit-diff.ts` and `backend/src/common/request-meta.ts` are now the
    single implementations** of the field-diff/`RequestMeta` utilities — `employees.service.ts`
    imports from them rather than defining its own copy. Any future module needing the same
    concern imports from these files; do not reintroduce a local copy.
  - **`createPayrollCycleSchema`'s `year` bound is 2000–2999**, not a narrower "realistic" range —
    deliberately wide enough to include the project's own `year: 2900` test-fixture convention.
    Do not narrow it back to exclude 2900 without also changing that test convention.
  - **Full decision record:** `docs/PROJECT_PROGRESS.md` §1's "Phase 3, Checkpoint 1" subsection.
    **Checkpoint 2 still requires its own separate, explicit authorization.**
- **New 2026-07-09, final architecture decisions — Advance Deduction Deferral, do not re-litigate:**
  - BR-ADV-001 through BR-ADV-006 (`database/advances.md` §15) are frozen business
    rules. An Advance's scheduled deduction may be deferred, before release, to any future Draft
    payroll cycle — not limited to "next" or "one after next" — by Payroll Staff (site-scoped) or
    Master User, with a mandatory reason, permanently recorded.
  - **`ScheduledPayrollPeriod`** (`database/payroll-cycle.md §10a`) is the single, canonical representation of a not-yet-existing
    future payroll period — never a raw `(year, month)` scalar pair on any other table. It is
    **infrastructure owned exclusively by Payroll Processing**: domain modules (Advances) may only
    reference it by foreign key and must go through Payroll Processing's own exposed find-or-create
    function — never a direct write. Do not reintroduce year/month scalars on `Advance` or any future
    obligation provider's tables to work around this.
  - **`AdvanceScheduleChange`** (`database/advances.md §15a`) is append-only (no updates, no deletes, only inserts) — named
    for recording schedule *changes*, not the schedule itself (that's `Advance.currentScheduledPeriodId`).
    Do not rename it back to something deferral-specific if a future "bring forward" rule arrives —
    extend it additively instead.
  - **Outstanding Payroll Obligations** (`docs/architecture/workflows/outstanding-obligations.md`,
    `docs/architecture/overview.md` Extensibility) is the generalized new-cycle carry-forward seam.
    Payroll Processing's bootstrap must never contain obligation-specific (e.g. `BalanceAdjustment`- or
    `Advance`-specific) knowledge, and registered providers must never be order-dependent. A future
    obligation type registers its own predicate/**Payroll Materialization Hook** — do not hardcode a
    new provider's checks directly into Payroll Processing's bootstrap logic.
  - **Full decision record:** `docs/PROJECT_PROGRESS.md` §1's "Advance Deduction Deferral" subsection.
    **This architecture is frozen — do not reopen or redesign it unless implementation reveals a
    genuine blocker or a new business requirement is introduced.** Phase 4 implements directly against
    it. Phase 3 Checkpoint 2 is unaffected and still requires its own separate authorization.
- **New 2026-07-09, Phase 3 Checkpoint 5 — implementation decisions, do not re-litigate (implemented,
  verified, and COMMITTED as `b4c1d21` — see §1 above):**
  - **The Payroll Entry import/export file format is permanently flat, representing only an entry's
    primary work line ("Option C").** Do not add a Unit/Branch column or multi-row-per-employee
    semantics to represent a split entry's non-primary lines — that was explicitly considered
    ("Option B") and rejected, since it would reopen Checkpoint 4's own frozen "Copy to All touches
    the primary line only" precedent. A split employee's non-primary lines remain reachable
    exclusively through the grid's Split by {unitLabel} modal; the limitation is a UI note, not a
    format concern.
  - **Import matches an existing `PayrollEntry` by `Employee Code` and/or `CNIC`** — both supported,
    neither one alone sufficient by design (CNIC is optional per Phase 2.5 Checkpoint 4). Do not
    narrow this back to CNIC-only.
  - **Import is permanently update-only.** It must never create a `PayrollEntry` or
    `PayrollEntryWorkLine`, never bootstrap an employee into a cycle, never modify `siteId` or
    `released`/`releasedAt`/`releasedBy`. A row identifying no matching entry in the target cycle is
    skipped and reported — do not add an "auto-create" fallback later without a fresh, explicit
    decision.
  - **Import does not require or check a per-row `version`** — it follows Checkpoint 4's
    administrative-bulk-operation precedent (no pre-check, but every written row still increments
    `version` so a concurrently-open grid row correctly 409s on its own next save). Do not add a
    `version` column to the spreadsheet format to "fix" this; it was a deliberate choice, not an
    oversight.
  - **Both import and export write their own summary `AuditLog` entry** (`payroll_entry.import`,
    `payroll_entry.export`) — a deliberate, approved deviation from Employee Registry's own export
    (which logs nothing). Do not remove the export-side audit entry to "match" that precedent.
  - **No new RBAC permission was introduced** — both routes reuse the single existing
    `PERMISSIONS.PAYROLL_ENTRY`. Do not split this module into separate view/create permissions the
    way Employee Registry has, without a fresh, explicit decision.
  - **`backend/src/common/import-export.ts`** now holds the one shared CSV/XLSX-to-table parsing
    implementation (`parseTableFromFile`) both Employee Registry's and Payroll Entry's importers call
    — do not reintroduce a second, duplicate implementation of that logic in a future importer;
    extend/reuse this one.
  - **`mapUpdateInputToEntryData`, `mapUpdateInputToWorkLineData`, and `assertEntryEditable`**
    (`backend/src/modules/payroll-entry/payroll-entry.service.ts`) are now exported and reused by the
    import path — the single implementation of "which fields does an edit touch" and "is this entry
    locked," respectively. Do not reintroduce a second copy of either mapping or the lock check in
    any future Payroll Entry code path (e.g. a future bulk-correction or reporting feature).
  - **Full decision record:** `docs/PROJECT_PROGRESS.md` §1's "Phase 3, Checkpoint 5" subsection.
- **New 2026-07-10, Phase 3 Checkpoint 6 — implementation decisions, do not re-litigate (implemented,
  verified, and COMMITTED as `3298e34` — see §1 above). Phase 3 (Checkpoints 0–6) is now fully
  complete and closed:**
  - **The in-memory grid architecture is permanently retained — no server-side windowed fetching.**
    This was an explicit, frozen decision (Decision 1), not merely undone-for-now: `LiveTotalsStore`,
    Copy to All, the multi-site filter, import/export, and the React Query cache all assume the whole
    cycle's entries are resident client-side. Do not introduce a windowed/paginated fetch without a
    coordinated rewrite of all of those pieces together, per a fresh, explicit decision.
  - **`usePayrollEntries` (`frontend/src/hooks/use-payroll-entries.ts`) now fetches page 1 alone,
    then the remaining pages in concurrency-capped (8-wide) parallel batches** — replacing the
    original fully-sequential one-page-at-a-time loop, because measurement proved the sequential
    version left too little headroom under the load-time target at 10,000 rows (2.8s of a 3s
    ceiling, before client-side rendering cost). The concurrency cap of 8 is a measured, not
    arbitrary, value (`backend/tests/payroll-entry-performance.test.ts`). Do not remove the cap.
  - **`LiveTotalsStore`'s full-recomputation-per-read model is unchanged, deliberately.** Real
    keystroke measurement (47–52ms per real keystroke, one >50ms long task only under an artificial
    rapid-fire stress test far faster than any human typist) did not meet the bar of "proves it is
    the bottleneck." Do not replace it with an incremental running-total model, a server aggregate,
    or a hybrid without new measurement evidence that it has actually become a problem.
  - **The `invalidateQueries` cache strategy after Copy to All/import is unchanged, deliberately** —
    no measurement showed it as a bottleneck. Do not build a targeted per-row cache merge for bulk
    operations without measurement justifying it first.
  - **`createPayrollCycle`'s bootstrap now assigns every entry its own `sortOrder`**
    (`backend/src/modules/payroll-processing/payroll-processing.service.ts`), fixing a real,
    pre-existing bug: every bootstrapped entry previously defaulted to `sortOrder = 0` (the schema
    column default, never overridden), which made `ORDER BY sortOrder ASC LIMIT/OFFSET` pagination
    unstable at the 10,000-employee floor — confirmed to silently duplicate 23 rows across page
    boundaries while dropping 23 others. This was found via this checkpoint's own real-browser
    measurement, not any prior test. A dedicated regression test
    (`backend/tests/payroll-entry-performance.test.ts`) asserts the bootstrap produces one distinct
    `sortOrder` per entry — do not remove it, and do not reintroduce a code path that creates
    `PayrollEntry` rows without an explicit, distinct `sortOrder`.
  - **`backend/tests/payroll-entry-performance.test.ts` is now the committed, repeatable
    10,000-employee performance/concurrency validation** — closing the gap Checkpoint 1's own
    informal, uncommitted 3,000-employee smoke test left open. Its fetch-comparison assertions check
    **distinct entry IDs seen across pagination**, not the row count summed across pages — the latter
    cannot detect a duplicate/gap pagination bug (50 pages of 200 always sums to 10,000 regardless).
    Any future change to `listPayrollEntries`'s pagination should be measured against this file, not
    assumed correct from a passing row-count-only test.
  - **The Definition of Done's "review, release" clause in `docs/IMPLEMENTATION_PLAN.md`'s Phase 3
    section is historical wording**, predating the 2026-07-07 checkpoint restructuring — confirmed by
    explicit decision (Decision 5) that Checkpoint 6 does not implement or validate Release, and a
    dated revision note was added there rather than the sentence being silently reinterpreted or
    deleted.
  - **Full decision record:** `docs/PROJECT_PROGRESS.md` §1's "Phase 3, Checkpoint 6" subsection.
    **Phase 4 implementation still requires its own separate, explicit authorization** — Phase 3
    being fully closed does not itself authorize starting Phase 4 work.
- **New 2026-07-10, Phase 3.5 (Tasks Workspace) — frozen decisions, do not re-litigate. Fully
  implemented and COMMITTED (`0fb296e` architecture revision, `1220dce` implementation — see §1
  above). Full decision/implementation record: `docs/PROJECT_PROGRESS.md` §1's "Phase 3.5"
  subsections:**
  - **Chat is permanently removed, not deferred.** The previously-planned Team Collaboration panel
    (`reference/PROJECT_SPEC.md`; `reference/payroll_prototype.html` — both frozen, unedited) will
    never contain chat, messaging, comments, discussion threads, attachments, subtasks, a Kanban view,
    or recurring tasks. Do not propose adding any of these to Tasks later without a fresh, explicit
    decision reopening this — it was a deliberate boundary, not an oversight.
  - **A new Phase 3.5 — Tasks Workspace exists between Phase 3 and Phase 4** in
    `docs/IMPLEMENTATION_PLAN.md`, with its own 🛑 review checkpoint. Phase 4 begins exactly as
    previously planned once Phase 3.5 closes — nothing about Phase 4's own frozen scope changed.
  - **Task visibility is ownership-based — an explicit, permanent exception to this system's role/site
    RBAC model**, documented in `docs/architecture/authentication.md`'s "Tasks: ownership-based
    visibility" section. Master User sees every task; the one user in `assignedToUserId` sees only
    their own; no one else can see or query it — regardless of role or site assignment. **Do not add
    site-scoping to Tasks.** This is not a variant of `assertSiteAccess()`; it is a distinct ownership
    check.
  - **One new permission, `tasks:manage`, Master-User-only.** Assignees need no permission beyond
    authentication to view their own tasks and mark them complete. No new role was introduced.
  - **Status lifecycle is `TO_DO` → `COMPLETED`/`CANCELLED` — no `IN_PROGRESS` value exists.** This
    was evaluated and deliberately rejected as unnecessary granularity, not an oversight. Master User
    may reopen a completed task (clears `completedAt`, reverts to `TO_DO`); only Master User edits
    title, description, priority, due date, or assignment — an assignee's only write is the completion
    flip.
  - **Priority is Low/Medium/High.** Due date is optional; recurring tasks are explicitly out of
    scope and will not be added.
  - **Notifications persist only three event types** — assigned, reassigned, completed. Due-today and
    overdue are computed live from `dueDate`/`status` at read time, never stored. **No WebSockets or
    SSE** — ordinary client polling, matching this project's existing infrastructure-restraint
    reasoning (`docs/architecture/authentication.md`'s Postgres-over-Redis rationale).
  - **Sorting supports exactly three dimensions**: Due Date, Priority, Recently Assigned (the last one
    driven by a dedicated `Task.assignedAt` column, distinct from `createdAt`, updated on
    reassignment). Nothing beyond this without a fresh decision.
  - **The HTML prototype review rule is now permanent, alongside the Playwright rule** —
    `docs/IMPLEMENTATION_PLAN.md`'s Definition of Done section. **It checks both directions**: every
    shipped feature has a prototype where appropriate, AND no prototype demonstrates behavior that no
    longer exists in the shipped architecture (the second direction is what would have caught the
    obsolete Chat panel, had a prototype for it ever existed). Every phase close, in order: review
    existing prototypes → remove/update obsolete behavior → create missing prototypes → verify the set
    matches shipped behavior → **only then** documentation updates → repository close-out.
  - **Prototype filenames use the literal phase number, including fractional ones** —
    `phase3.5-tasks-workspace-preview.html`, never folded into `phase3-*` or `phase4-*` naming.
  - **`reference/PROJECT_SPEC.md` and `reference/payroll_prototype.html` were not touched and must
    never be** — both still describe the retired Chat concept; living documentation (this revision)
    supersedes them, it does not conform to them.
  - **Phase 8 keeps its current name unchanged for now**, even though it loses the Team Collaboration
    line entirely (moved to Phase 3.5) — do not rename it preemptively; revisit only if it becomes
    genuinely misleading after further low-priority work accumulates there.
- **Employee Statements is not Phase 4 scope (confirmed 2026-07-11, architecture review, no code) —
  do not build it under Phase 4 without a new, explicit re-authorization.** It depends on
  `Correction`/`BalanceAdjustment`/`CorrectionPayment` (Phase 6) and `Advance` (Phase 4's own
  not-yet-built sub-scope), none of which exist yet; it remains Phase 7 work, unchanged from
  `docs/IMPLEMENTATION_PLAN.md`'s original sequencing. Reports (also Phase 7) should reuse Statements'
  ledger-computation code once both are built, rather than duplicating the aggregation — full record:
  `docs/PROJECT_PROGRESS.md` §1's "Phase 4 — Employee Statements Architecture Review and Scope
  Decision" entry.

## 4. Current frozen architecture (reference index)

- `docs/PROJECT_PRINCIPLES.md` — **10 standing principles as of 2026-07-03** (e.g. Payroll Entry as
  single source of truth, additive-first migrations, insert-only Audit Log, and the new Principle 10:
  a 10,000-employee performance/scale design floor). **Reviewed 2026-07-05 — no changes needed**,
  every Phase 3 architecture-review decision is additive/consistent with all ten.
- `docs/architecture/overview.md` — the load-bearing data path: Employee Registry/Project Units →
  Payroll Entry (+ Payroll Entry Work Lines) → Payroll Processing → Release (**now per Project Unit,
  2026-07-05**) → Bank Sheets/Cash Receiving, with CorrectionRequest → Corrections/Balance Adjustments
  as the highest-risk branch. Major Modules table includes **Project Units** as its own module and
  reflects Finance's new role in Release Salary. **As of 2026-07-09**, also includes a dedicated
  **Advances** module row (Advance Deduction Deferral) and a new "Outstanding Payroll Obligations"
  Extensibility bullet documenting the generalized, order-independent carry-forward seam.
- `docs/architecture/database/` (formal schema specification — see `database/README.md` for the
  per-file index) — **27-table schema as of 2026-07-09** (25 as of 2026-07-05 +
  `ScheduledPayrollPeriod`/`AdvanceScheduleChange`, 2026-07-09; Phase 1 + Phase 2 together implement a
  subset of it; see §1 of `docs/PROJECT_PROGRESS.md`). `database/schema-invariants.md §26` item 6 (CNIC duplicate-detection) is
  resolved, no longer pending. `Advance` (`database/advances.md §15`) now carries `originalScheduledPeriodId`/
  `currentScheduledPeriodId` and the frozen BR-ADV-001–006 rule set, none of it in
  `backend/prisma/schema.prisma` yet (Phase 4 work).
- `docs/architecture/authentication.md` — session-based auth, CSRF double-submit, RBAC +
  site-scoping as independent middleware layers. **Now three roles as of 2026-07-05**: Master User,
  Payroll Staff, and the new site-scoped **Finance** role (its own permission set documented in full).
  Multi-unit attendance splitting is still always intra-site, so no unit-level RBAC concept was
  introduced for that reason — unchanged since 2026-07-03. **As of 2026-07-09**, also documents that
  Advance Deduction Deferral reuses the existing payroll-edit permission/site-scoping — no new
  permission was introduced, and Finance still cannot perform it.
- `docs/architecture/workflows/corrections-and-balance-adjustments.md` — the baseline-reconstruction/replay algorithm
  (unaffected by 2026-07-05's changes — always operates on the resulting `Correction` regardless of
  which path produced it), deliberately scheduled late (Phase 6) per the plan. **As of 2026-07-05**,
  also covers the `CorrectionRequest` request/approval/rejection split, immediate/deferred `PAYABLE`
  settlement, and installment `RECOVERY` settlement.
- `docs/architecture/system-conventions.md` (`StorageProvider` abstraction) and
  `docs/architecture/workflows/payroll-lifecycle.md` — Finalize Cycle
  precondition (wording unchanged by 2026-07-05's per-Unit release move), Backup Package versioning.
  **As of 2026-07-05**, §4 also documents the per-Unit release mechanism, the simplified one-clause
  correction trigger, and the Late Entry exception. **As of 2026-07-09**, §4 also documents the Advance
  Deduction Deferral workflow and the generalized, order-independent Outstanding Payroll Obligations
  new-cycle carry-forward seam (replacing the old Balance-Adjustment-specific wording).
- `docs/design-system.md` — tokens (color/type/spacing/radius), layout patterns, the shared component
  inventory the frontend must reuse rather than re-implement per page, and, **as of 2026-07-03, §4's
  `DD-MM-YYYY` date-display convention** (alongside the existing `en-US` number-format convention).
  **Not touched by 2026-07-05's session** — no new UI/UX design decisions were made, only backend/data
  architecture.

## 5. Phase 1 completion checklist

Per `docs/IMPLEMENTATION_PLAN.md`'s Phase 1 Definition of Done:

- [x] Migration applies cleanly to an empty database — **verified live 2026-07-04** (fresh
      PostgreSQL 18, `migrate deploy`, unmodified, twice — second fresh DB replay included)
- [x] **Seed script confirmed idempotent against a live database** — verified 2026-07-04 (run twice)
- [x] **Scripted login as the seeded Master Admin succeeds** — verified 2026-07-04 (`auth.test.ts`
      live, plus a real-browser login in the Playwright E2E)
- [x] **Scripted attempt to call a protected route without a session fails with 401** — verified
      2026-07-04 (`auth.test.ts` live)
- [x] **Scripted attempt to update or delete an audit log row fails at the database level** —
      verified 2026-07-04 (`audit-log.test.ts` live, plus an independent raw-SQL probe)
- [x] **CSRF-missing requests to state-changing routes are rejected** — verified 2026-07-04
      (`auth.test.ts` live)
- [x] RBAC middleware unit tests (no DB required) — passing
- [x] `npm run typecheck` clean
- [x] `npm run lint` clean (0 errors)
- [x] **🛑 Review-checkpoint sign-off — obtained 2026-07-02 (conditional at the time).** The
      condition — DB-backed evidence — was fully discharged 2026-07-04.

**Bottom line: Phase 1 is closed, unconditionally, as of 2026-07-04.**

## 6. Phase 2 completion status

**Phase 2 is CLOSED (conditional), 2026-07-02** — same conditional basis as Phase 1 (code-complete +
statically verified + explicit user sign-off, with DB-backed evidence carried forward as a tracked
open item, not a blocker):

- [x] Master-data migration (`Bank`/`Employee`/`AdjustmentType`/`CompanySettings`) written and
      validated (`prisma validate`/`generate`/`format`); *not yet applied to a live database*.
      (`ProjectSite.defaultBankId` was added, then removed the same session after architectural
      review — see §2 "Evening" and `docs/PROJECT_PROGRESS.md` §3 item 6.)
- [x] Seed script extended (banks, adjustment types, company settings placeholder) — idempotent by
      construction (upserts throughout, matching Phase 1's pattern); *not yet run against a live
      database*.
- [x] Project Sites, Employee Registry, Settings, User Management: all built, backend + frontend.
- [x] Employee Registry CSV/Excel import/export against the official template.
- [x] Site-scoping boundary tests written, covering the C11 decision via direct API calls with a
      manipulated `siteId` (not just the intended UI path) — *not yet executed against a live
      database*.
- [x] `npm run typecheck` clean (all three workspaces).
- [x] `npm run lint` clean (0 errors, same 2 pre-existing warnings as Phase 1).
- [x] `npm run build` clean (backend + frontend production builds).
- [x] **Master Admin can create a Payroll Staff user, assign sites, and confirm that user's session
      genuinely cannot see or touch employees/sites outside that assignment** (the Phase 2
      Definition of Done, `docs/IMPLEMENTATION_PLAN.md`) — **verified live 2026-07-04**:
      `users.test.ts` + the C11 boundary tests in `employees.test.ts`/`employees-import-export.test.ts`
      all passing against real PostgreSQL, including the manipulated-`siteId` direct-API cases.
- [x] Phase 2 UI/UX polish pass + final visual consistency audit (Playwright-verified) — see §2.
- [x] **🛑 Phase 2 review checkpoint sign-off — CONDITIONAL, obtained 2026-07-02.** The user explicitly
      stated "Phase 2 is now complete" and requested this checkpoint. Phase 2 has no explicit 🛑 gate
      in `docs/IMPLEMENTATION_PLAN.md` (unlike Phase 1/3/5/6/9), but per this project's established
      practice, an explicit sign-off was still obtained before Phase 3 — on the same conditional basis
      as Phase 1's: the one DB-backed item directly above remains open, not re-litigated.

**Bottom line: Phase 2 is closed, unconditionally, as of 2026-07-04** — its one outstanding
DB-backed item was verified against live PostgreSQL, same as Phase 1's five.

## 7. Next steps, in order

**Updated 2026-07-16 — Phase 1, Phase 2, Phase 2.5, Phase 3 (all seven checkpoints), and Phase 3.5
(all four checkpoints) remain closed with full DB-backed evidence — see §1/§2. Phase 4 (all six
checkpoints, including Payslips 6.1–6.3) is now implemented, tested, and committed, but is
**code-complete, not fully closed** — see §1's Checkpoint 6.3 entry and
`docs/PROJECT_PROGRESS.md` §1's "Phase 4 close-out review" for the single outstanding condition
(real Render/Linux-container deployment verification). **Phase 5 is COMPLETE AND CLOSED, 2026-07-16**
— architecture review, Checkpoint 0 (`StorageProvider` foundation, COMMITTED `d87b9b0`),
Checkpoint 1 (Finalize Cycle, COMMITTED `cad93bc`), Checkpoint 2 (Backup Packages reusable
domain/generator, COMMITTED `3ea879e`), Checkpoint 3 (cycle archiving, automatic backup
generation, and new-cycle rollover, COMMITTED `957ab9d`), and Checkpoint 4 (Historical
Payroll Cycle Selector, full backend suite 487/487 including a `passwordHash`
response-serialization fix found during final review — Users module, not Checkpoint
4's own code — full frontend suite 21/21, COMMITTED as `10e3194`) are all complete. **The final
browser verification pass (real Playwright/Chromium, 108/108 assertions, zero unexpected console
errors, zero defects found) closed the one remaining gap this same session** — see §1's "Phase 5 —
final browser verification and close-out" entry. Phase 6 requires its own separate, explicit
go-ahead before any work begins.**

1. **Re-read the doc set in order** (`docs/PROJECT_PRINCIPLES.md` → `docs/architecture/*.md` →
   `docs/IMPLEMENTATION_PLAN.md` → this file → `docs/PROJECT_PROGRESS.md`), confirm branch/latest
   commit/clean working tree, per this project's standing "How to Resume" procedure.
2. **Re-provision the local database before running DB-backed tests** — the Postgres instance lives
   in the sandbox scratchpad and does not survive between sessions. Recipe: install
   `@embedded-postgres/darwin-x64` in the scratchpad, hydrate its symlinks, `initdb -U postgres -A
   trust`, start with `-c unix_socket_directories=''` (TCP only), create role `payroll` (password
   `payroll_dev_password`) and database `payroll_dev`, then `cp backend/.env.example backend/.env`,
   `npx prisma migrate deploy` (15 migrations as of Phase 5 Checkpoint 3 — Checkpoint 4 added no
   migration), seed **twice** (confirm idempotency), `npm run test --workspace backend` (expect
   **487/487** as of Phase 5 Checkpoint 4 — **use the `npm run test` script itself**, which sets
   `NODE_ENV=test` and `--runInBand`; running
   `npx jest` directly after sourcing `backend/.env` overrides `NODE_ENV` to `development` and drops
   the login rate limiter from 1000/window to 10/window, producing a cascade of spurious 429
   failures that look like real regressions but aren't).
   **If using `prisma migrate diff` with `--shadow-database-url` for a future migration, point it at
   a dedicated, disposable shadow database — never the working `payroll_dev` one.** **If seeding a
   large synthetic dataset for manual/browser testing, clean it up before running the automated
   backend suite** — `createPayrollCycle`'s bootstrap scans every active `Employee` system-wide, so
   leftover large-scale fixtures from a prior manual session will silently inflate other tests'
   expected entry counts. **If a full-suite run immediately follows another full-suite run and
   surfaces unrelated failures (FK violations, "record not found"), it is very likely the prior
   Jest process's lingering Postgres connections, not a code regression** — confirm via
   `SELECT count(*) FROM pg_stat_activity` returning to baseline (~9) before re-running; this has
   been a known "Jest did not exit one second after…" artifact since Checkpoint 6.1/6.2 and was
   re-confirmed, not newly introduced, during Checkpoint 6.3.
3. **Confirm the 487/487 baseline is green before touching any new code.**
4. **Close the one outstanding Phase 4 condition before treating the phase as fully closed: a real
   Render (or genuine Linux container) deployment smoke test.** Neither Docker/Podman/Colima nor
   Render API access nor a configured git remote were available in this session (same constraint as
   Checkpoint 6.2's own attempt) — this is not a "try harder locally" gap, it requires actual
   deploy access. Once available, confirm: production build, Chromium launch under
   `--no-sandbox`/`--disable-setuid-sandbox`, individual and batch PDF generation, font rendering
   (Times New Roman or its documented fallback), memory stability under a representative batch,
   graceful shutdown. Only then update `docs/PROJECT_PROGRESS.md` §2's Phase 4 row from
   "code-complete" to "closed."
5. **Phase 5 is fully COMPLETE AND CLOSED, 2026-07-16** — all five checkpoints committed
   (`d87b9b0`/`cad93bc`/`3ea879e`/`957ab9d`/`10e3194`) and the final real-browser verification pass
   (108/108 assertions, zero unexpected console errors, zero defects) has been performed and
   recorded — see `docs/PROJECT_PROGRESS.md` §1's "Phase 5 — final browser verification and
   close-out" entry. **Do not begin Corrections, Balance Adjustments, Employee Statements,
   `PayrollUnitReadiness`, Late Entry release, Backup Package UI, or any Phase 6 work until the user
   gives its own explicit go-ahead** — per this project's standing per-checkpoint/per-phase practice.
6. Decide how Broom Services' own disbursement source bank account(s) should be modeled
   (`docs/PROJECT_PROGRESS.md` §3 item 7) — still open, unrelated to Payslips.
7. The Phase 4 Render/Linux-container Chromium deployment smoke test remains open, explicitly
   separate from Phase 5's own closure — pick it up if genuine deploy access ever becomes available
   in this sandbox.
8. When explicitly instructed to begin **Phase 6**, follow the same standing Definition of Done:
   **architecture compliance → implementation → typecheck → lint → build → backend tests →
   real-stack verification → HTML prototype review/update → documentation updates → ask before
   committing.**

## 8. Risks and assumptions

- **Resolved 2026-07-04 — migrations verified for real.** The long-standing assumption that the
  hand-written/`migrate diff`-generated migrations would apply cleanly was tested and held: all six
  applied to a completely fresh PostgreSQL 18 database unmodified, first try. The companion risk
  ("if the DB-backed tests fail, the fix may touch committed files") also materialized exactly as
  anticipated and was handled: four real defects were found and fixed (see §2's 2026-07-04 entry),
  one of them via a new migration — existing migrations were not edited.
- **Resolved**: the Bank/AdjustmentType/CompanySettings scope question, the two Employee Registry
  `database/schema-invariants.md §26` items, the `ProjectSite.defaultBankId` removal, the `StorageProvider` deferral timing (confirmed:
  before Phase 5), `ProjectSite.address` (added, scoped exception), the company name ("Broom Services
  Private Limited"), and the deployment-portability nuance (single-company, but not
  hosting-provider-specific) — see `docs/PROJECT_PROGRESS.md` §3.
- **Still unresolved, carried forward**: the import-template redundant-column assumption (§3 item 5,
  likely resolved as a side effect of Checkpoint 3's `ProjectUnit` remap but not yet confirmed with
  the client), Broom Services' own disbursement source account modeling (§3 item 7, including its two
  sub-questions — needed before Phase 4 schema work), and the two open `database/schema-invariants.md` §26
  design assumptions (calendar-month-only cycles, at-most-one-`ACTIVE`-`Advance`-per-type). **The
  CNIC duplicate-handling decision (§26 item 6) is no longer on this list — it was finalized
  2026-07-03/04**: CNIC stays globally unique with no override, and rehires go through a Reactivate
  action — see `docs/PROJECT_PROGRESS.md` §3 item 22. Only the concrete Checkpoint 4 implementation
  still needs a separate design-approval gate, not the policy itself.
- **Assumption, flagged for revisit (2026-07-03)**: gross pay does not vary by Project Unit — verified
  against `reference/PROJECT_SPEC.md` and the schema doc (only the day-rate basis is documented as
  location-varying), but this is a documentation-based finding, not confirmed against the client's
  actual current practice. If real-world practice contradicts it, `PayrollEntryWorkLine`'s design
  (§12a) needs revisiting before Phase 3 schema work, since it currently assumes a single `grossPay`
  scalar per employee per cycle regardless of how many units they worked.
- **Assumption**: no one has manually altered the database, `.env`, or any untracked local file
  outside of what's described here since the last commit.
- **New, 2026-07-05 — the Phase 3 architecture freeze spans what were originally Phase 3, 4, and 6
  territory (Payroll Entry/Processing, Release, and Corrections/Balance Adjustments), because the
  session's new business rules made those three areas tightly interdependent (per-Unit release
  changes what "released" means for the correction trigger; the correction settlement model needed
  designing alongside it).** This does not change the implementation *sequencing* in
  `docs/IMPLEMENTATION_PLAN.md` — Phase 3's code should still be built and proven before Phase 4's,
  and Phase 4's before Phase 6's, per the plan's own stated strategy (build the trunk before its
  branches) — only the *architecture* for all three was frozen together, in one session, because they
  couldn't be designed in isolation from each other this time. Future sessions implementing Phase 4 or
  6 should not re-open architecture review for those phases; the design is already frozen and dated
  2026-07-05 alongside Phase 3's.

## 9. Addendum, 2026-07-23 — System-Wide RBAC Consistency Audit and Remediation

Production UAT (real custom roles, not synthetic test personas) found the RBAC conversion was
incomplete: `sites:manage`'s global-authority bypass (KI-8/"UAT Defect 1") had only been applied to
Project Site *visibility*, not the rest of the Sites/Units domain, and Employees/other operational
modules had never been audited for the same class of drift. Full detail is in
`docs/architecture/authentication.md`'s "System-Wide RBAC Consistency Audit and Remediation"
section and `docs/release/KNOWN_ISSUES_v1.0.md` KI-11 through KI-14 — this entry is only the
next-session pointer.

**What changed**: a new single-source-of-truth `backend/src/common/authz-policy.ts` (replacing two
independently-drifting implementations of the same site-scope check); `sites:manage` now
consistently global across all of Sites/Units (list/create/update/deactivate, both Sites and
Units); Employees' own site-scoping is confirmed correct and **unchanged** (deliberately not widened
by `sites:manage` — a real architectural distinction, not a gap), but its site pickers and empty
states are now consistent with that scope; `tasks:manage` reclassified as its own domain's global
permission (found proactively, not reported); the Modal footer overlap (KI-9's own fix was
necessary but not sufficient) is now fixed at the shared component level; the Employee form's
"Gross Pay (Template)" label is now "Default Gross Pay."

**What was deliberately not done**: `corrections-page.tsx`, `salary-release-page.tsx`,
`payslips-page.tsx`, `payroll-entry-page.tsx`, `bank-sheet-page.tsx`, `advances-page.tsx`, and
`cash-receiving-page.tsx` all share the identical latent site-picker inconsistency Employees had
(each calls the raw, `sites:manage`-aware `useProjectSites()` for its own filter) — not part of the
reported defects, not fixed this pass, and the fix (`useAccessibleProjectSites`) already exists for
whoever picks this up next. No schema/migration change was needed — this was a pure
application-layer (backend authorization logic + frontend consistency) remediation throughout.

**Verification**: backend 883/883, frontend 91/91, full E2E suite 40/40 (two new specs), all
typecheck/lint/build clean, Prisma schema/migrations untouched. Nothing pushed, nothing deployed.

---

## 10. Addendum, 2026-07-24 — Corrections Workflow Redesign / RBAC Consistency Completion

Two objectives: finish migrating the "deliberately not done" remainder §9 above named (the 7
site-scoped modules still calling the raw, `sites:manage`-aware `useProjectSites()`) to
`useAccessibleProjectSites(user)`, and give the Corrections workflow a real, discoverable entry
point. Full detail is in `docs/PROJECT_PROGRESS.md`'s "Corrections Workflow Redesign / RBAC
Consistency Completion (2026-07-24)" entry — this is only the next-session pointer.

**RBAC completion**: all 7 remaining modules (Corrections, Salary Release, Payslips, Payroll Entry,
Bank Sheet, Cash Receiving, Advances) now call `useAccessibleProjectSites(user)`. **All seven
operational modules named across both this checkpoint and §9's now use
`useAccessibleProjectSites(user)` — no module in this system follows a different site-scope rule
than any other, beyond the two pages that intentionally retain the unrestricted list: Project Sites
administration and the Users module's own site-assignment picker**, both of which genuinely need
every site regardless of the acting user's own assignment.

**Corrections discoverability**: the backend corrections lifecycle (create → review →
approve/reject → ledger → outstanding balance) was already complete and exhaustively tested (nine
backend test files) — it was **not duplicated** by this checkpoint. The actual gap was frontend
discoverability, now implemented at the released-entry row level:
`payroll-entry-row.tsx` renders a Released badge and a per-row actions menu (Create Correction, View
Correction History) on any row whose own `entry.released` is true, replacing the previous
single, page-wide toolbar button gated on cycle status rather than per-entry release state.

**Also delivered**: a reusable searchable `EmployeeLookup` component; standard print support across
all 8 named pages; downloadable import templates for Employees and Payroll Entry; a terminology
audit that made "Master User" the live seeded display name (it had only ever been documented, not
actually seeded).

**Verification**: backend **891 passed plus 1 known pre-existing isolated timing flake, 892
total** (the flake is `payslips.test.ts` under host resource contention — pre-existing, documented
KI-10 pattern, confirmed via isolated rerun at 47/47, not a regression). Frontend **91/91**. Full
E2E suite **44/44, with two legitimate conditional skips**. All typecheck/lint/build clean,
Prisma schema/migrations untouched. **Nothing pushed, nothing deployed** as of this addendum.

---

## 11. Addendum, 2026-07-24 — Operational Stabilization Checkpoint (unplanned, against `origin/main`)

An unplanned checkpoint, requested before any Phase 7 work began: two operational defects reported
against the currently shipped Payroll Entry workflow. **Explicitly does not start Phase 7** — full
detail is in `docs/PROJECT_PROGRESS.md`'s own dated entry; this is only the next-session pointer.

**Defect A (table misalignment)**: the totals row's hand-written cell list had silently drifted out
of sync with the canonical `PAYROLL_COLUMNS` array (missing the IBAN column's own placeholder cell),
shifting every total from Gross Pay through Net Salary one column left. Fixed by making the totals
row iterate `PAYROLL_COLUMNS` directly instead of a second, hand-maintained list — this class of
drift is now structurally impossible, not just corrected once. Header/body rows were already correct
(independently verified).

**Defect B (Payroll Manager missing data)**: not an RBAC defect — every user, Master Admin included,
saw the same absence. `bootstrapPayrollEntries` only ever populates a cycle once, at its own creation
or rollover; an employee created or reactivated afterward had no automatic path into the current
Draft cycle. Fixed with a new `syncEmployeeIntoCurrentDraftCycle`, run inside employee
creation/reactivation/CSV-import — Draft-cycle-only, no duplicates, released/archived history
unaffected.

**Verification**: backend full suite 901 passed, 1 failed (`backup-packages.test.ts`'s "Generated
On" timestamp-comparison test — a distinct test/mechanism from the documented KI-10, not classified
as that issue; confirmed non-reproducible via an immediate isolated rerun at 38/38, consistent with
full-suite-load timing sensitivity but not written up as 902/902 since this was not a clean full-suite
run). Frontend 94/94 (91 + 3 new alignment tests, verified to actually catch the original defect), 10
new backend integration tests (verified to fail pre-fix, pass post-fix), E2E 45/46 (one conditional
skip). Typecheck/lint/build all clean (one pre-existing, unrelated E2E-spec typecheck error predates
this checkpoint). Real browser verification performed with a Master User and a site-scoped Payroll
Manager against realistic data — the Draft-cycle synchronization rule (employee creation,
reactivation, and CSV/Excel import are the three sync entry points; current-Draft-cycle-only, no
duplicates, released/archived history untouched) confirmed live in both. **Since committed as
`a063b25`/`90b5f2f`/`bf89a06`, pushed to `origin/main`, and deployed via Render's existing
auto-deploy — production verification confirmed both fixes live. It also surfaced one further gap,
addressed in §12 below. Phase 7 status unchanged (Not started).**

---

## 12. Addendum, 2026-07-24 (later) — Draft Payroll Roster Reconciliation

Narrow follow-up to §11 above, triggered by that checkpoint's own production verification: a real
pre-existing employee ("Asim Khan," ABL West Region) predates the deployed create/reactivate/import
sync hooks and so stayed absent from the already-open Draft cycle — those hooks are forward-looking
only, and nothing else re-checks an already-active employee's presence in an already-open Draft
cycle after the fact. Full detail is in `docs/PROJECT_PROGRESS.md`'s own dated entry; this is only
the next-session pointer.

**Solution**: a new, explicit, idempotent `reconcileDraftCycleRoster` (`payroll-processing.service.ts`)
— hard-rejects any cycle that isn't (still) Draft before touching `PayrollEntry`, creates only
missing entries by reusing `syncEmployeeIntoCurrentDraftCycle` verbatim per employee (no second
creation implementation), never touches an existing entry. Gated the same as every other
cycle-lifecycle action (`payroll-cycle:manage`), not the narrower `payroll:entry` a day-to-day
Payroll Manager holds. Triggered automatically but safely: `payroll-entry-page.tsx` fires it once,
silently, when a session already holding that permission opens a Draft cycle — self-healing without
the entries list's own `GET` ever mutating.

**Verification**: 11 new backend integration tests, each independently confirmed to fail against the
pre-fix code and pass after (including the Draft-only guard, verified by temporarily disabling it).
Typecheck/lint/build clean for both workspaces. No schema/migration change.

**Since committed** as `fdd25b3`/`c355d0d`/`af8dbe8`/`06c4863` — no longer "not committed" as this
entry originally read; see §13 below for what was built on top of it and its own push/deploy record.

## 13. Addendum, 2026-07-24 (latest) — Advances/Corrections Operational Stabilization + Payroll Entry Sorting, Deputed Branch & Import Removal

Two separately-approved checkpoints, developed in parallel (one directly against `main`, one in an
isolated worktree branched from §12's `fdd25b3`), integrated together this session. Full detail in
`docs/PROJECT_PROGRESS.md` §1's two own dated entries; this is only the next-session pointer.

**A. Advances/Corrections Operational Stabilization** (committed `fb13204`/`9086e87`/`1d1e811`/
`3647b77`/`1229916`, directly on `main`): immediate Draft-cycle deduction materialization for a
newly-recorded Advance (no longer waiting for the next cycle bootstrap); lifecycle-aware Advance
Edit/Cancel (a new `CANCELLED` status, additive migration, `cancelAdvance` action); a redundant
"OPTIONAL — LEAVE BLANK FOR CASH" label removed from the Corrections Record Settlement dialog (Cash
remains explicitly selectable); a new sticky/frozen-column regression test for the Payroll Entry
grid (investigation found no defect — added as a mechanical guard against ever reintroducing one).

**B. Payroll Entry Sorting, Deputed Branch & Import Removal** (committed `89af663`, rebased cleanly
onto `main` after the five commits above — a fast-forward, no conflicts other than a trivial
auto-merge in `payroll-entry-alignment.test.tsx`, both sides' changes preserved intact): client-side
sortable columns (Employee, Employee Code, Deputed Branch, Gross Pay, Net Salary — stable, full-row
reordering, totals unaffected by sort direction); a new "Deputed Branch" column sourced from each
entry's own primary work-line `ProjectUnit` (never the employee's current live unit — preserves
historical branch meaning for released/archived payroll); Payroll Entry CSV/Excel import removed
entirely (routes, service, template, frontend UI) per product decision — export is unaffected, and
Employee Registry's own separate import feature is untouched.

**Verification**: frontend 113/113, backend 890-891/902 (all remaining failures independently
confirmed pre-existing/environmental — `payslips.test.ts` PDF-generation flakiness and one
`corrections-service.test.ts` concurrency test that passes cleanly in isolation — via `git diff`
showing zero changes to either file). Both workspaces' typecheck/lint/build clean. Real-browser
verification performed for the Payroll Entry checkpoint (Chromium/Playwright).

**Push/deploy record:** pushed to `origin/main` this same session — `origin/main` confirmed at
`94ad4b8` (local `main` and `origin/main` resolve to the identical SHA). Render auto-deployed from
this push with no build/migration failure — both `https://payroll-management-api-wlic.onrender.com/health`
and `https://payroll-management-app-qa3x.onrender.com/` returned 200 shortly after the push, and a
full authenticated production smoke pass (Chromium/Playwright, logged in as the real production
Master User) confirmed the new code is live:

- **Payroll Entry**: the Deputed Branch column is visible with real branch codes (`0206`, `3322`,
  `5455`), sortable both directions (verified for Employee, Deputed Branch, Employee Code, Gross
  Pay, and Net Salary); full rows — including the `Released` badge staying attached to its own
  employee ("Ossamah") — move together on sort; the totals row (`PKR 200,000.00`) is unchanged
  across every sort applied; horizontal scroll keeps header/body/totals aligned; Import, Download
  Import Template, and the file input are completely absent; Export CSV/Export Excel remain present.
- **Advances**: page and Record Advance dialog both load; "Current Draft — July 2026" is the
  pre-selected first-deduction-cycle option; existing Advances' Edit dialog exposes Total
  Amount/Repayment Type/Notes (the approved lifecycle-aware fields) and a Cancel action is present
  in the row list — inspected only, nothing submitted/cancelled. **One genuine limitation, not a
  defect**: the three pre-existing production Advances inspected (scheduled June/July 2026) all show
  `PKR 0` in Payroll Entry's Advance Ded. column — expected, since each predates this session's
  "materialize immediately into an already-open Draft" fix (that fix only applies to newly-recorded
  Advances going forward) and per this checkpoint's own explicit instruction, no new Advance was
  recorded in production merely to exercise it.
- **Corrections**: no pending or ledger correction requests currently exist in production, so the
  Record Settlement dialog itself could not be opened for a live wording check without fabricating a
  correction request — explicitly not done, per the same instruction above. The label removal
  (`1d1e811`) was already confirmed via direct source diff before this session's push.

No discrepancies found beyond the two explicitly-noted, expected limitations above (both a direct
consequence of "do not create unnecessary production financial/test records," not a code defect).

## 14. Addendum, 2026-07-25 — Payroll Presentation & Workflow Stabilization Checkpoint

Seven user-reported Payroll Entry/Salary Release/Advances/Corrections presentation and workflow
defects, each root-caused individually. Two review rounds (initial implementation, then an explicit
"final verification" pass — a broadened placeholder audit plus focused lifecycle-transition tests)
before approval. Full detail in `docs/PROJECT_PROGRESS.md` §1's own dated entry; this is only the
next-session pointer.

**Committed** (`4fa3554`/`4eb5dfe`/`623daff`/`50887ee`/`397c333`, directly on `main`):

- **Salary Release → Payroll Entry desync**: `useReleaseProjectUnit`'s `onSuccess` now also
  invalidates Payroll Entry's own query cache (previously only invalidated Salary Release's own
  query) — `PayrollEntry.released` was always the single source of truth; this closed a frontend
  notification gap, not a backend inconsistency.
- **Payroll Entry column architecture**: the body row now renders from a compiler-enforced
  `Record<PayrollColumnId, ReactNode>` map iterated in the canonical `PAYROLL_COLUMNS` order (header
  and totals already did) — a missing/misspelled column is now a type error, not a possible visual
  drift. Advance/Eid Advance balance labels are now included in dynamic column-width measurement, so
  they can no longer overflow into a neighboring column.
- **Advance lifecycle**: new `RESERVED` status between `ACTIVE` and `PAID_OFF` — a Draft deduction
  reaching zero balance is only *reserved*, not *paid off*, until the `PayrollEntry` carrying it is
  actually Released (`settleAdvancesForReleasedEntries`, called from `releaseProjectUnit`, the one
  and only place `PAID_OFF`/`paidOffAt` is ever set). Two additive migrations
  (`20260725090000_advance_reserved_status`, `20260725091000_advance_reserved_constraints`).
  Editing/deferring/cancelling a `RESERVED` advance still safely reverses the live Draft deduction;
  released payroll is never rewritten.
- **Request Correction employee lookup**: now explains *why* a real, visible employee doesn't match
  (no released Payroll Entry yet this cycle) instead of reporting "no employees match" as if the
  employee didn't exist — the eligibility rule itself (released-only) is unchanged and correct.
- **Commercial placeholder audit** (two passes): removed internal client-specific instructional
  examples from UI placeholders and, more significantly, from the downloadable Employee Import
  Template's sample row (previously named the real client's actual site and spelled out its bank's
  full legal name). Seed data and documented environment-variable-overridable deployment defaults
  (seeded banks, default admin email, default company name) were deliberately left unchanged — a
  final project-wide sweep found no remaining user-facing instructional placeholders containing
  internal company references.

**Verification**: `advances.test.ts` 34/34 (3 new lifecycle-verification tests + 1 strengthened,
explicitly proving all four RESERVED-lifecycle transitions end-to-end); 68/68 across
`payroll-release`/`corrections-release-consumption`/`payroll-cycle-rollover`/
`payroll-entry-performance`/`employees-import-export`; frontend 37/37. Typecheck/lint/build clean
across shared/backend/frontend (one pre-existing, unrelated e2e typecheck error left untouched).
Full regression suite run once during the first pass only (this checkpoint touched release
orchestration and shared schema) — confirmed pre-existing sandbox flakiness unrelated to this work,
not a regression; the second pass needed no broader run. Real-browser verification (Chromium/
Playwright) performed for every issue against a freshly seeded, dedicated local database.

**Push/deploy record**: see this session's final report for the confirmed `origin/main` SHA and
Render health-check result (not duplicated here to avoid a second, easily-stale copy).

## 15. Addendum, 2026-07-25 (later) — Post-Deployment UI & Corrections Workflow Stabilization Checkpoint

A separate, later same-day checkpoint against a fresh post-deployment report — five issues, distinct
from §14's "Payroll Presentation & Workflow Stabilization Checkpoint" despite the similar name. Full
detail in `docs/PROJECT_PROGRESS.md` §1's own dated entry ("Post-Deployment UI & Corrections Workflow
Stabilization Checkpoint"); this is only the next-session pointer.

**Committed LOCALLY only** (`341f65b`/`e9c22fc`/`92bc4c0`, directly on `main`, **NOT pushed, NOT
deployed**):

- **Status badge centering (Payroll Entry, Status column)**: the Released badge was centered together
  with its trailing actions button in one flex group, which centers the pair, not the badge. Replaced
  with a `grid-cols-[1fr_auto_1fr]` layout — the badge sits in the fixed middle track, flanked by two
  equal spacer tracks, so it centers regardless of column width or what the trailing track holds; the
  actions button lives in its own trailing track. No pixel offsets, no per-status special case.
- **Totals-row Employee-column alignment**: the "N employees" summary was keyed to the `employeeCode`
  ("Code") column instead of `employeeName` ("Employee") — a one-token mismatch, not a structural
  regression. Corrected; still fully derived from `PAYROLL_COLUMNS`, no hardcoded indexes.
- **Corrections requester-visible workflow / RBAC separation**: a Payroll Manager (`payroll:entry`
  only) submitting a correction request was unconditionally redirected to a detail page gated to
  `corrections:approve` only — an immediate 403 on their own submission, with no page anywhere they
  could see it afterward. Fixed by widening correction-request list/detail to `payroll:entry` OR
  `corrections:approve`, with a non-approver's list/detail server-side scoped to requests *they
  themselves submitted* — never another submitter's. **Approve/reject remain hard-gated to
  `corrections:approve`, enforced per-route independent of the widened list/detail gate — no approval
  right was widened.** New "My Requests" Corrections tab; the submission modal now routes an approver
  straight to the request, and everyone else back into Corrections (My Requests).

**Not committed — investigated and documented only, per the user's own explicit instruction not to
execute the production cleanup yet:**

- **`ZZZ SMOKETEST DeployCheck` (production smoke-test employee)**: confirms the 2026-07-24
  Operational Stabilization Checkpoint's own finding (not hard-coded anywhere, no name-based
  protection) and extends it — **employee hard-delete was deliberately not introduced**; every
  `Employee` row remains permanent by design. The production remediation, verified end-to-end against
  synthetic data (not production) but **not yet executed against the real record**:
  1. Mark `ZZZ SMOKETEST DeployCheck` as Left via the existing Employee Registry workflow.
  2. Remove only its existing `PayrollEntry` from the currently-open Draft cycle, if one exists, via
     the existing (API-only) delete action — no UI button exists for this specific step.
  3. Never delete or modify a Released/Archived `PayrollEntry`, or any other historical financial or
     audit record — the delete path itself already refuses once released.

**Verification**: frontend `payroll-entry-alignment.test.tsx` 10/10 (2 new), `permissions.test.ts`
updated (2 tests for the new default tab, 1 new for `canViewOwnCorrectionRequests`); backend
`corrections-service.test.ts` 53/53 (6 new integration tests covering own-only listing,
approver-sees-all, own-detail-allowed, another-submitter's-detail-rejected, approve/reject-still-
rejected-for-a-non-approver, and Finance still rejected outright). Typecheck/lint/build clean across
shared/backend/frontend (one pre-existing, unrelated e2e typecheck error confirmed via `git stash` to
reproduce on baseline `main`). Full regression suite deliberately not run, per this checkpoint's own
scope. Real-browser verification (Chromium/Playwright) performed for every issue, including the
Issue 5 recipe against synthetic data mirroring the real scenario.

**Push/deploy record**: none — these three commits are local-only on `main`, awaiting the user's own
separate go-ahead, same standing practice as every other checkpoint in this file.

## 16. Addendum, 2026-07-25 (latest) — Payroll Entry Status Column Final Stabilization Checkpoint

A focused follow-up to §15: `e9c22fc`'s grid-track fix centered the Released badge relative to its
own trailing actions button, but never fixed the actual root cause — the header row applied no
per-column alignment at all, so "STATUS" rendered left-aligned regardless of
`PAYROLL_COLUMNS`' `align: 'center'`. Full detail in `docs/PROJECT_PROGRESS.md` §1's own dated entry
("Payroll Entry Status Column Final Stabilization Checkpoint"); this is only the next-session
pointer.

**IMPLEMENTED, NOT COMMITTED** — every change below is in the working tree on `main` only. Per
explicit instruction, this checkpoint stops before `git add`/`commit`/push/deploy.

- **Removed the Status cell's "..." actions control entirely** (not hidden with CSS). Before
  removing it, inspected what it exposed — Create Correction (redundant with the existing
  page-level "Request Correction" toolbar button, whose own Employee search field covers the same
  capability) and View Correction History (no exact substitute for a `payroll:entry`-only,
  non-approver user — the closest alternative, "My Requests," is scoped to that user's own
  submissions, not every request against a given entry). **Reported this gap to the user before
  proceeding; user confirmed removal as specified.** Deleted the now-fully-orphaned
  `correction-history-modal.tsx` and the `canCorrect`/`onCreateCorrection`/`onViewCorrectionHistory`
  prop chain (row → grid → page) along with it, rather than leaving dead code.
- **Status header/body alignment now derives from `PAYROLL_COLUMNS`' own `align` field** — a new
  `COLUMN_ALIGN_BY_ID` map in `payroll-entry-grid.tsx` applies `text-center`/`text-right` to each
  header cell, a field that existed on `PayrollColumnDef` but no renderer had ever actually
  consumed. The Status body cell is now a plain `flex items-center justify-center` box (no more
  `grid-cols-[1fr_auto_1fr]`, unnecessary now that nothing else shares the cell) — the same
  convention every other center-aligned column already uses. No margin/translateX/absolute offset
  anywhere in the stack.
- **Status column `fixedWidth` narrowed 150 → 90** (`columns.ts`) now that it only needs to fit the
  "Released" badge, not badge + button + hover target.
- **Employee count / column order** — already correct as of §15's own fixes; verified by reading the
  current code (not assumed) and locked in with two new structural tests.
- **`ZZZ SMOKETEST DeployCheck`**: re-confirmed, still not executed. No production database, API
  token, or deployed-instance credentials exist in this sandboxed environment — re-verified this
  session, not just carried over from §15. The remediation recipe is unchanged from §15's own list
  above.

**Verification**: frontend `payroll-entry-alignment.test.tsx` (12/12), `payroll-entry-grid.test.tsx`
(6/6, 2 new), full `payroll-entry`/`corrections`/`routes` test directories (50/50). `tsc -b --noEmit`
and `eslint` both clean on every changed file. **Real-browser-verified** (Chromium/Playwright, via
the project's own committed `tests/e2e` harness — a disposable local database and dev-server stack,
never production): a throwaway script created a site/two employees (one long-named), released one
through the real Salary Release UI, and measured `getBoundingClientRect()` centers directly —
Status header center, body-cell center, and the Released badge's own center were pixel-identical in
both the unreleased and released states, with no button/menu present either time; totals-row
`Σ`/employee-count footer cells confirmed present and correctly positioned. Script deleted
immediately after use, never committed.

**Push/deploy record**: none — nothing from this checkpoint has even been committed yet, let alone
pushed. Next session should `git status`/`git diff` these working-tree changes and get the user's
explicit go-ahead before committing.

## 17. Addendum, 2026-07-25 (latest) — RBAC Creator Ownership & Professional Printing Checkpoint

Full record: `docs/PROJECT_PROGRESS.md` §1's own dated entry ("RBAC Creator Ownership &
Professional Printing Checkpoint"); this is the push/deploy/post-deploy-verification pointer.

**Part A (RBAC).** `createProjectSite` never wrote a `UserSiteAssignment` for its own creator —
`sites:manage` is a global administrative permission, never operational, so a scoped creator with
no pre-existing assignment could create a Project Site but couldn't then use it anywhere until a
Master Admin manually assigned it back. Fixed atomically (one `prisma.$transaction`, idempotent
`upsert`) via a general, reusable invariant (`common/creator-access.ts`), not a one-off — Master
Admin unaffected, `sites:manage` still grants no operational access to any other site. Full
resource-by-resource audit found Project Sites is the only resource needing this; Project
Units/Employees already inherit through their parent Site, financial/workflow records are
explicitly excluded. New nullable `ProjectSite.createdById` (migration
`20260725100000_project_site_creator`) is audit provenance only. **No historical backfill** — no
creator-identity column existed before this checkpoint, so old sites' creators aren't reliably
recoverable.

**Part B (Printing).** Replaced `PrintButton`'s bare `window.print()` with a shared
`PrintSettingsDialog`/`useTriggerPrint` architecture (Auto/Portrait/Landscape, Fit to page/Normal
size). Auto is fully deterministic — resolves to each page's own `recommendedOrientation`, never
delegated to the browser. Fit-to-page scales table *width* only via `table-layout: fixed`, never
forces row count onto one sheet. A4 stays the baseline; the native print dialog remains final
authority. Payroll Entry's print table (already non-virtualized, kept and extended) gained Deputed
Branch, a non-overflowing Advance/Eid balance note, and a totals row. Every one of the 8
`PrintButton` pages was individually audited; two real defects fixed (Payslips' checkbox/Actions
columns, Advances' Actions header) — Bank Sheet/Cash Receiving/Corrections had no screen-only-control
leak and were left unchanged (PASS). Every page's `recommendedOrientation` is now a deliberate
choice, not a silently-inherited Portrait default.

**Testing**: frontend full suite 127/127; backend focused 52/52 (project-sites 29, project-units
11, users 12); Chromium/Playwright 6/6 (`tests/e2e/specs/13-print-architecture.spec.ts` — Payroll
Entry Landscape, Salary Release Portrait, Bank Sheet + Cash Receiving added during the final
verification pass). Full backend/frontend/E2E regression suites deliberately not run — no shared
authorization/query primitive changed beyond the new, singly-consumed `creator-access.ts` helper.

**Commits** (`main`, in order): `cc16b6c` (RBAC), `08ee1ff` (shared print architecture), `4f2ca2e`
(Payroll Entry print), `1d0d5ca` (remaining pages standardised), `0be145c` (Chromium print e2e
spec), plus this documentation commit.

**Push/deploy record**: pushed to `origin/main` this same session immediately after the 5 code
commits above — `origin/main` confirmed at `0be145c` (local `main` and `origin/main` resolved to
the identical SHA via `git fetch` + `git rev-parse`). Render auto-deployed from this push with no
build/migration/startup failure visible through available service behavior — both
`https://payroll-management-api-wlic.onrender.com/health` (`{"status":"ok"}`, HTTP 200, checked
repeatedly across the whole verification window with no interruption) and
`https://payroll-management-app-qa3x.onrender.com/` (root HTTP 200) and `/login` (HTTP 200,
renders the real login form, `<title>Payroll Management System</title>`) confirmed live.

**New-bundle confirmation took real investigation, recorded here in full rather than glossed
over.** The deployed frontend's main JS entry chunk (`/assets/index-DIYkpnKI.js`) kept the *same*
filename/hash before and after this deploy, which on its own would look like the new build never
went live. Root cause: this app code-splits by route (`React.lazy` per page, `App.tsx`) — the
print/RBAC changes live inside `PrintButton`/`payroll-entry-page.tsx`/etc.'s own separately-hashed
lazy chunks, never referenced directly in `index.html`, so an unchanged *entry* chunk hash proves
nothing either way about those files. The deployed CSS bundle (`/assets/index-DjuAUycg.css` — a
single, non-code-split Tailwind/PostCSS output covering the whole app) is the file that actually
proves it: fetched directly and grepped for `print-fit` and `A4 portrait` — both this checkpoint's
own new, literal strings (`frontend/src/index.css`) — present in the live deployed CSS. That is
direct content evidence the new build is live, not an inference from a hash that turned out to be
the wrong artifact to check.

One unrelated environmental note from this same verification window: this sandbox's own local DNS
resolver was intermittently unable to resolve `payroll-management-app-qa3x.onrender.com`
specifically for a few minutes mid-verification (confirmed, via a public DNS-over-HTTPS query
against Cloudflare, that the DNS record itself was fine throughout) — worked around with curl's
`--resolve` flag pinned to the resolved IP. A sandbox networking hiccup, not a Render-side issue,
and not a discrepancy in the deployment itself.

**Post-deploy verification performed vs. not possible this session:**
- **Confirmed via HTTP evidence** (above): backend health, frontend availability, login page
  rendering, and the new build's actual presence (CSS content match).
- **NOT possible this session — no authenticated production credentials or Render dashboard/API
  access exist in this sandboxed environment** (re-confirmed, consistent with every prior
  checkpoint's own same finding): authenticated production RBAC UAT (a real Payroll Manager
  creating a Project Site and confirming immediate access) and authenticated production print UAT
  (opening the Print settings dialog, generating a real PDF, on a live authenticated page). **Both
  were already verified locally** — RBAC via 52 focused backend integration tests exercising the
  real transaction/assignment path, printing via 6 real-Chromium Playwright tests exercising the
  real dialog/`@page`/fit-to-page/dataset-completeness behavior — but neither was re-verified
  against the live production deployment itself. **Requires normal user UAT** with real production
  credentials before this checkpoint is considered fully closed end-to-end.
- **No historical Project Site creator-assignment backfill was performed** — production or
  otherwise, per the checkpoint's own explicit instruction not to.

**Phase 7 remains Not Started; this checkpoint does not begin it.**

## 18. Addendum, 2026-07-25 (latest) — Production Print Defect: Print Settings Captured in Printed Output

Full record: `docs/PROJECT_PROGRESS.md` §1's own dated entry ("Production Print Defect — Print
Settings Captured in Printed Output"); this is the push/deploy/post-deploy-verification pointer.

**What production UAT exposed**: after configuring Print Settings and clicking Print, Chrome's
native print preview showed the Print Settings dialog itself, not the underlying report — on
every one of the 8 `PrintButton` pages (all share the same architecture).

**Root cause**: `PrintSettingsDialog`'s confirm button called `onConfirm(settings)` (which
synchronously invokes `window.print()`) *before* `onOpenChange(false)`. `window.print()` captures
the DOM at the exact synchronous instant it runs, so the dialog was still mounted. Reordering the
two calls would not have fixed it — React 18 batches the state update behind `onOpenChange(false)`
and does not commit it to the DOM synchronously within the same handler.

**Fix — shared lifecycle**:

```
settings selected → flushSync close/unmount → apply print layout → window.print() → afterprint cleanup
```

`PrintSettingsDialog` now only reports settings via `onConfirm`; `PrintButton` forces the dialog's
close to commit synchronously via `flushSync` (React's own documented use case for this exact
scenario — a DOM-dependent imperative browser action right after a state change) before triggering
the actual print. **Defense in depth**: the shared `Modal`'s `Overlay`/`Content` now carry
`print:hidden` — every dialog in the app, not just print settings — so even a future lifecycle
regression could never make a mounted dialog printable. **Invariant now documented**
(`docs/architecture/print-architecture.md`): print configuration UI must never be printable.

**Why the previous tests missed it**: they stubbed `window.print` as a no-op and asserted DOM/CSS
state via a *later*, separate `page.evaluate()` — enough time for React to flush the buggy pending
close before the test looked. Both the unit test and the Chromium spec were rewritten to capture
DOM state *synchronously, inside the `window.print()` mock itself* — the same instant a real
browser's print engine captures. **Confirmed to fail against the pre-fix code and pass against the
fix** (verified directly: temporarily reverted the fix, re-ran both, saw them fail; restored the
fix, re-ran, saw them pass) — for both Payroll Entry (dedicated print table) and Bank
Sheet/Cash Receiving (live-DOM report), proving the fix generalizes across both print
architectures.

**Testing**: frontend full suite 128/128 (127 prior + 1 new regression); Chromium 4/4
(`tests/e2e/specs/13-print-architecture.spec.ts`). No backend changes — backend tests not run. No
broad regression suite run — the one shared-infrastructure touch (`modal.tsx`) is covered by the
full frontend unit suite; no other file exercises `Modal`.

**Commits** (`main`, in order): `469ce8e` (lifecycle + Modal CSS fix), `78bc15c` (regression
tests), plus this documentation commit.

**Push/deploy record**: pushed to `origin/main` this same session immediately after the 2 code
commits above — `origin/main` confirmed at `78bc15c` (local `main` and `origin/main` resolved to
the identical SHA via `git fetch` + `git rev-parse`). Render auto-deployed from this push:
`https://payroll-management-api-wlic.onrender.com/health` returned `{"status":"ok"}`/HTTP 200, and
`https://payroll-management-app-qa3x.onrender.com/` (root) and `/login` (renders the real login
form) both returned HTTP 200.

**Deployment/bundle evidence for this push, honestly qualified.** Unlike the previous checkpoint
(which added new, literal CSS strings this deploy's frontend build could be grepped for), this
fix is pure JS lifecycle-ordering logic with no new static string to search for in a built bundle.
The frontend's main entry JS/CSS bundle hashes did **not** change across this verification window
— consistent with, not contradicted by, this app's route-level code-splitting (`React.lazy` per
page, confirmed in the immediately preceding checkpoint's own deploy verification): `PrintButton`'s
logic lives inside per-page lazy chunks never referenced directly in `index.html`, so a fix
confined to it is not expected to change the *entry* bundle's own hash. What **was** confirmed:
the entry JS asset's own `last-modified`/`ETag` headers were fresh — timestamped *after* this
push's commits — and served with `cf-cache-status: MISS` (fetched fresh from Render's origin, not
Cloudflare's edge cache), directly evidencing a real rebuild happened at/after push time, not
merely an assumption from elapsed time. This is weaker evidence than a direct bundle-content match
(the previous checkpoint's stronger standard) — stated plainly rather than overstated.

One environmental repeat from the previous checkpoint: this sandbox's own local DNS resolver was
again intermittently unable to resolve both production hostnames for a few checks mid-verification
(confirmed via a public DNS-over-HTTPS query that both DNS records were fine throughout — same
Cloudflare-fronted IPs as before); worked around with curl's `--resolve` flag. A sandbox networking
hiccup, not a Render-side issue.

**Post-deploy print verification performed vs. not possible this session:**
- **Confirmed via HTTP evidence** (above): backend health, frontend availability, login page
  rendering, and evidence of a fresh rebuild at/after push time.
- **NOT possible this session — no authenticated production credentials or Render dashboard/API
  access exist in this sandboxed environment** (re-confirmed, consistent with every prior
  checkpoint's own same finding): an authenticated production print UAT (opening Print Settings on
  a live authenticated Payroll Entry or Bank Sheet/Cash Receiving page, choosing Auto (Landscape) +
  Fit to Page, clicking Print, and confirming the native preview shows the report and not the
  settings dialog). **The fix has already passed, locally, before this push**: the frontend unit
  regression test (`print-button.test.tsx`, capturing DOM state synchronously inside the mocked
  `window.print()`) and 4 real-Chromium Playwright tests (`13-print-architecture.spec.ts`, the same
  capture-at-invocation strategy, covering both Payroll Entry's dedicated print table and Bank
  Sheet/Cash Receiving's live-DOM report) — both confirmed to fail against the pre-fix code and
  pass against the fix. **Requires normal user UAT** with real production credentials to close the
  loop end-to-end in production specifically.
- No production payroll data was created or modified.

**Phase 7 remains Not Started; this checkpoint does not begin it.**

## 19. Addendum, 2026-07-26 (latest) — Import Template Contract Checkpoint: Employee Registry Rebuild + Project Site Bulk Import

Full record: `docs/PROJECT_PROGRESS.md` §1's own dated entry ("Import Template Contract checkpoint
— Employee Registry + Project Sites bulk import") and `docs/architecture/import-template
-architecture.md` (the authoritative design record); this is the push/deploy/post-deploy-
verification pointer.

**What this checkpoint covers, in one line each:**
- Audited the whole application and confirmed Employees was the only module with a real
  spreadsheet import capability; rebuilt its template onto a new Instructions/Import Data/Example
  workbook standard, fixing a real bug (an un-deleted Example row could previously be imported as
  real data) and a real gap (Pay Type/IBAN/EOBI fields were silently unimportable).
- Extended a new Project Site bulk import capability onto the same shared infrastructure — creates
  new Sites only, Site Name is the uniqueness key, `sites:manage` enforced server-side, no new
  permission introduced.
- Every successfully imported Site atomically gets its own Site row, one initial Project Unit
  (`"Main <Unit Label>"`), and the importer's own `UserSiteAssignment` — one transaction, composed
  from each module's own canonical creation primitive (`createProjectSiteInTransaction`/
  `createProjectUnit`), not a parallel implementation. Manual "New Site" creation is unchanged (no
  auto-created Unit — that invariant is import-specific). No standalone Project Unit bulk importer
  was built.
- Payroll Entry import remains removed, not reintroduced.

**Testing (focused, not a full-suite re-run for the final delta, per explicit instruction):**
Employee + Project Site + Project Unit focused suites **110/110**; Project Site import suite
**33/33**; `payroll-entry-draft-cycle-sync.test.ts` **10/10**; E2E `14-project-site-import.spec.ts`
(real Chromium) **3/3**; backend typecheck/lint clean; no schema/migration change. A representative
600-Project-Site import: 600 Sites, 600 initial Units, 600 creator assignments, 0 duplicates, 0
orphans, ~5.4s. An earlier full-suite run (983 tests) showed 953/983 passing, with all 30 failures
isolated to `payslips.test.ts` and independently confirmed via `git stash` against the clean,
pre-checkpoint baseline to be pre-existing, unrelated flakiness — the same standing
environment-load-sensitivity this file's own known-issue record already tracks for that suite, not
a new regression.

**Commits** (`main`, in order): `65764dc` (shared import infrastructure), `3343a08` (Employee
import refactor), `5fae5e6` (Project Site bulk import + initial-Unit/creator-access provisioning),
`67253eb` (payroll-entry test fix — a different test file's hardcoded Employee-import CSV header
had gone stale against the Part B rebuild), `913ce46` (Project Site import test suite), `f57b4f8`
(Project Site import E2E spec), plus this documentation commit.

**Push/deploy record**: pushed to `origin/main` immediately after the 7 commits above —
`origin/main` confirmed at `1b106fd` (local `main` and `origin/main` resolved to the identical SHA
via `git fetch` + `git rev-parse`; working tree clean; 0 commits behind, exactly 7 ahead of
`origin/main`'s pre-push SHA `c5b54f1`). Render auto-deployed from this push:
`https://payroll-management-api-wlic.onrender.com/health` returned `{"status":"ok"}`/HTTP 200 (after
a ~22s cold start — no startup/migration failure observed; this checkpoint added no migration, so
`prisma migrate deploy` was a no-op), and `https://payroll-management-app-qa3x.onrender.com/` (root)
and `/login` both returned HTTP 200.

**Deployment/bundle evidence for this push — the strongest class obtained across any checkpoint to
date: a direct content match, not just timing.** The frontend's lazy-loaded Project Sites page chunk
resolved to a filename (`project-sites-page-5SoHM9m5.js`) that did not exist before this push (a
fresh content hash — Vite hashes are content-derived); fetching it directly confirmed it contains
the exact new UI strings this checkpoint added ("Download Import Template", "Import Results"),
proving the live deployment is running this checkpoint's actual code, not merely inferring it from
timestamps. Corroborating timing evidence: the main entry bundle
(`index-BaSCNw9m.js`) and this same chunk both carry `last-modified: Sun, 26 Jul 2026 08:25:23 UTC`
— built together, in the same deploy — with `cf-cache-status: MISS` on the entry bundle (fetched
fresh from Render's origin, not Cloudflare's edge cache), directly evidencing a real rebuild at push
time rather than an assumption from elapsed time alone.

**No Render dashboard or API access exists in this sandboxed environment** (consistent with every
prior checkpoint's own same finding) — all verification above is HTTP-based (`curl`), not
dashboard/API-confirmed build logs.

**Post-deploy import verification performed vs. not possible this session:**
- **Confirmed via HTTP + bundle-content evidence** (above): backend health, frontend availability,
  login page rendering, and direct proof the live frontend bundle contains this checkpoint's new
  Project Sites import UI code.
- **NOT possible this session — no authenticated production credentials exist in this sandboxed
  environment.** Per explicit instruction, no live import UAT was attempted or fabricated. **Normal
  user UAT is required** to close the loop end-to-end in production specifically: downloading the
  Project Site import template, confirming its Instructions/Import Data/Example sheets, importing
  one deliberately temporary/approved test Site as an authorized scoped user, and confirming the
  Site + its one initial Project Unit were created, the importer immediately has access, no
  unrelated access was granted, and the results modal reads correctly.
- **No production data was created, modified, or mutated** — no bulk import, no test Site, no
  scale test was run against production. The 600-Site scale test was run only against this
  session's own local/isolated test database (see the focused-test results above), never against
  production, per explicit instruction not to create hundreds of production Sites or perform a
  production scale test.

**Phase 7 remains Not Started; this checkpoint does not begin it. No standalone Project Unit bulk
importer was introduced. Payroll Entry import remains absent.**

## 20. Addendum, 2026-07-26 (latest) — Employee Import Template Post-deployment UAT Correction

Full record: `docs/PROJECT_PROGRESS.md` §1's own dated entry ("Employee Import Template —
Post-deployment UAT Correction") and `docs/architecture/import-template-architecture.md`'s own
"Post-deployment UAT correction" and "Final refinement" sections (the authoritative design record);
this is the push/deploy/post-deploy-verification pointer.

**What this correction covers, in one line each:**
- Root-caused and fixed the blank Employee Bank / Project dropdown entries reported in production
  UAT of §19's checkpoint: both dropdowns shared one padded row count for their Excel validation
  ranges; each now gets its own independent count (`ImportColumnSpec.buildValidation`'s
  `listContext`, `backend/src/common/import-export.ts`).
- Renamed the "Project Bank" header to "Employee Bank" on every newly generated template;
  "Project Bank" is still accepted as a legacy input header alias on upload.
- A second UAT pass then found a remaining ambiguity — a blank cell was still silently treated the
  same as "Cash" — and closed it: **Employee Bank is now required in import files; a blank or
  whitespace-only cell is rejected server-side, independent of Excel's own `allowBlank: false`
  validation.** "Cash" still maps to the application's existing `bankId: null` representation; no new
  database representation was introduced. The legacy "Project Bank" alias still works, but backward
  compatibility applies to the header name only — a blank value under that header is rejected the
  same as under the canonical header.
- Investigated the Project dropdown specifically and found it already correct — RBAC-scoped via
  `listProjectSites(currentUser)`, fetched fresh on every template download, no restart/redeploy
  involved. No change was made there; its existing tests were preserved.

**Testing (focused, not a full-suite re-run, per explicit instruction):** Employee import focused
suite (`employees-import-export.test.ts`) **57/57**; combined directly-related regression run (that
suite plus `employees.test.ts`, `project-sites.test.ts`, `project-units.test.ts`,
`payroll-entry-draft-cycle-sync.test.ts`) **138/138**; backend typecheck and lint clean on every
touched file; no schema/migration change.

**Commits** (`main`, in order): `5ab1da1` (fix — dropdown row-count correction, Employee Bank rename
+ legacy alias, required-value validation), `1ef3b77` (test — Employee Bank import contract and
dynamic-dropdown coverage, plus the `payroll-entry-draft-cycle-sync.test.ts` fixture fix), `00c4567`
(documentation), plus this doc-only follow-up commit recording the push/deploy outcome below.

**Push/deploy record**: pushed to `origin/main` immediately after the 3 commits above —
`origin/main` confirmed at `00c4567` (local `main` and `origin/main` resolved to the identical SHA
via `git fetch` + `git rev-parse`; working tree clean; exactly 3 commits ahead of `origin/main`'s
pre-push SHA `7158d91`). Render auto-deployed from this push:
`https://payroll-management-api-wlic.onrender.com/health` returned `{"status":"ok"}`/HTTP 200 (after
a cold start — no startup/migration failure observed; this correction added no migration, so
`prisma migrate deploy` was a no-op), and `https://payroll-management-app-qa3x.onrender.com/` (root)
and `/login` both returned HTTP 200.

**Deployment evidence for this push — weaker than prior checkpoints' bundle-content match, reported
honestly rather than overstated.** This correction touched **zero frontend files** (`git diff
--name-only` across all three commits confirms it) — it is a backend-only change to the generated
Employee import `.xlsx` template and its server-side validation. That means the strongest technique
used in prior checkpoints (fetching a lazy-loaded frontend chunk by its content-hashed filename and
grepping it for a new UI string) does not apply here, because there is no new frontend string to
find — the changed code paths (`generateEmployeeImportTemplate`, `importEmployees`) are exercised
only via authenticated, RBAC-gated endpoints (`GET/POST /api/v1/employees/import-template`,
`/import`), and **no authenticated production credentials exist in this sandboxed environment**, so
those endpoints could not be hit directly to prove the live response contains this fix. What *was*
confirmed: the push succeeded and `origin/main` is at the exact commit containing the fix; the
backend responded healthy post-push with no startup/migration failure; a cold start was observed
(consistent with, but not proof of, a fresh deploy — Render can also cold-start an idle instance
without a new deploy). **No stronger, unauthenticated evidence was available for a backend-only,
auth-gated change; this is an honest limitation, not a gap that was worked around by inventing
weaker substitute evidence.**

**No Render dashboard or API access exists in this sandboxed environment** (consistent with every
prior checkpoint's own same finding) — all verification above is HTTP-based (`curl`), not
dashboard/API-confirmed build logs.

**Production UAT: not performed, per explicit instruction not to mutate production data merely to
test this correction, and because no authenticated production credentials exist in this
environment.** The useful manual UAT for the user, requiring no Employee to actually be imported:
download a fresh Employee Import Template, open the Import Data sheet, confirm the header reads
"Employee Bank" (not "Project Bank"), open its dropdown and confirm "Cash" appears exactly once with
every configured Bank present and no blank entries, then open the Project dropdown and confirm
currently accessible Sites appear with no blank entries.

**Phase 7 remains Not Started; this correction does not begin it. Project Site import was not
touched. No new Payroll Entry import was introduced.**

## 21. Addendum, 2026-07-27 (latest) — Negative Payroll Recovery & Employee Identity/Banking
Uniqueness Checkpoint: COMPLETE, COMMITTED LOCALLY on `main`, NOT pushed, NOT deployed

Full architecture/design record: `docs/PROJECT_PROGRESS.md` §1's own dated entry (immediately above
§2), `docs/architecture/database/release.md §12c`, `docs/architecture/database/employee.md §9`, and
`docs/architecture/workflows/corrections-and-balance-adjustments.md`'s "Negative Payroll Recovery"
section (including the full recovery-conservation accounting proof). This addendum is the
local-commit and production-preflight-procedure record specifically.

**What this checkpoint covers, in one line each:** negative/zero Net Salary can no longer be
released as a payment (`PayrollEntry.payoutOutcome`: `NO_PAY_DUE`/`RECOVERY_DUE`, `released` never
redefined); a carried-forward recovery deduction larger than a future cycle's own earnings is
proven, with a dedicated test, to never double-count into a second recovery; Employee Account
Number/IBAN gained the uniqueness enforcement they never had (global across active and departed
employees, same as CNIC/Employee Code); one canonical release-eligibility function replaces
scattered checks and surfaces a single "Needs Attention" badge pre-release; Bank Sheet/Cash
Receiving gained a defensive `netSalary > 0` filter; two read-only diagnostic scripts were added for
production use.

### Local commit list (in order, oldest first)

| Commit | Subject |
|---|---|
| `6760e83` | `feat(shared): add banking identifier normalization helpers` |
| `f79f564` | `feat(payroll): add no-pay/recovery payout outcomes and recovery accounting` |
| `b8e0b54` | `feat(employees): enforce account number and IBAN uniqueness` |
| `d5d2e9f` | `feat(payroll-entry): surface release readiness and Needs Attention` |
| `9e0c5e2` | `test: cover recovery accounting, release eligibility, and employee identifier uniqueness` |
| `2f15000` | `chore: add read-only production diagnostic scripts` |
| *(this commit)* | `docs: record Negative Payroll Recovery & Employee Identity/Banking Uniqueness checkpoint` |

No separate `perf:` commit was created — the transaction-boundary/batching fix in
`payroll-entry.service.ts` (readiness attachment runs after the mutation's own transaction commits,
not inside it) is inseparable from the feature commit that introduced the attachment call in the
first place; splitting it would have required fabricating an intermediate historical state that
never actually shipped as its own commit-able point.

**Local `main` HEAD after this documentation commit is `2f15000`'s child — see the final
local-commit report the user requested for the exact resolved SHA, ahead-of-`origin/main` count, and
working-tree status at the time it was produced (that report is the authoritative snapshot; this
addendum is written before the docs commit itself is created, so it cannot self-reference its own
hash).**

### Production duplicate preflight — the one remaining deployment blocker

Migration `20260726121000_employee_account_iban_canonical_uniqueness` adds partial unique indexes on
`Employee.accountNumberCanonical`/`ibanCanonical`. It is self-guarding (its `CREATE UNIQUE INDEX`
statements fail outright, rolling back the whole migration, if a canonical-level duplicate already
exists), but per explicit instruction this checkpoint does not rely on "fails safely" alone — the
goal is knowing about bad data *before* Render ever attempts the migration, not merely surviving a
failed attempt.

**Exact procedure, for someone with production database access (not performed by this session — no
such access exists here):**

```bash
# From a machine/session with a valid production DATABASE_URL (read replica is fine — this script
# only ever SELECTs, never writes):
cd backend
DATABASE_URL="<production connection string>" npx tsx scripts/find-employee-identifier-duplicates.ts
```

**PASS condition** — the script's own final line reads `No duplicates found — safe, as far as this
database is concerned, to apply the uniqueness migration.`, which only happens when all four of its
per-field checks report zero groups:
- `Employee Code: no canonical-level duplicates found.`
- `CNIC: no canonical-level duplicates found.`
- `Account Number: no canonical-level duplicates found.`
- `IBAN: no canonical-level duplicates found.`

If any field instead reports `N duplicate value(s) found`, the migration must **not** be deployed
until each reported group is remediated (merge/correct the duplicate records) — do not push `main`
to `origin/main` in that case, since Render auto-deploys from that branch and would then either fail
the deploy outright (the migration's own self-guard) or, if remediated incorrectly, silently merge
two distinct employees' identifiers.

**Second, non-blocking diagnostic** (for historical finance remediation, not a deploy gate):

```bash
cd backend
DATABASE_URL="<production connection string>" npx tsx scripts/find-negative-released-entries.ts
```

This reports any pre-existing `PayrollEntry` row already marked `released = true` whose recomputed
net salary is negative — bad data from *before* this checkpoint's fix shipped. It does not block the
uniqueness migration and was not run here (no production access); its output, once obtained, is a
manual finance reconciliation input, not something either script or this checkpoint can resolve
programmatically (Bank Sheets/Cash Receiving are derived-only and never stored, so there is no
historical record of what was actually paid).

**No production data of any kind was read, mutated, or otherwise touched by this checkpoint or this
session. Do not push `main` to `origin/main` until the first script above has been run against
production and confirmed clean. Phase 7 remains Not Started; this checkpoint does not begin it.**

**Superseded for status purposes by §22 below** — the production preflight described above as
outstanding has since run and passed; §22 has the actual results and a diagnostic-script fix this
addendum's own procedure surfaced.

## 22. Addendum, 2026-07-27 (latest) — Production Preflight Results, Diagnostic Fix, and Push/Deploy
Record

Full architecture record: §21 above and `docs/PROJECT_PROGRESS.md` §1's own dated entry. This
addendum is the actual production-preflight-outcome record, the pre-migration diagnostic-script fix
that outcome surfaced, and (once Steps 5–7 below complete) the push/deploy/post-deploy-verification
record.

### Diagnostic-script fix: `find-negative-released-entries.ts` pre-migration compatibility

Running the second (non-blocking) diagnostic against production — still pre-migration, since it must
run before that deploy — failed with `P2022: PayrollEntry.payoutOutcome does not exist`. Root cause:
the script used an implicit full-column `include`, and the locally generated Prisma Client (built
from the *current* `schema.prisma`, which already declares `payoutOutcome`) asked Postgres for that
column regardless of the target database's actual migration state. Fixed with an explicit
`PRE_MIGRATION_SAFE_PAYROLL_ENTRY_SELECT` (`find-negative-released-entries.ts`) — every `PayrollEntry`
column that predates migration `20260726120000_negative_payroll_recovery_schema`, `payoutOutcome`
deliberately excluded, so the generated SQL never references it on either schema state.
`computeEntryCalc`/`calcNet` never read `payoutOutcome` (confirmed by direct inspection of every field
each one touches — 11 `PayrollEntry` scalars, 5 `PayrollEntryWorkLine` scalars, none of them this
migration's column), so a local `payoutOutcome: null` placeholder satisfies the function's full-entry
input type without touching any real financial field. Verified against a disposable local database
built by applying every migration except the last two, then again with both applied — identical
output. New regression test, `find-negative-released-entries-script.test.ts` (3 tests): asserts the
select never reintroduces `payoutOutcome`, contains every field the calculation needs, and produces
the exact same `netSalary` as an unrestricted fetch. Both diagnostic scripts re-confirmed read-only.
Committed as `bc14ec3`, standalone, no schema/migration/application-behavior change.

### Production preflight — RESULT 1: Employee identifier duplicates — PASS

Production contains 6 `Employee` rows. `find-employee-identifier-duplicates.ts` reported:
- Employee Code: **0 duplicates**
- CNIC: **0 duplicates**
- canonical Account Number: **0 duplicates**
- canonical IBAN: **0 duplicates**

**The employee identifier uniqueness migration (`20260726121000_employee_account_iban_canonical_uniqueness`)
is cleared from the duplicate-data perspective and no longer blocks deployment.**

### Production preflight — RESULT 2: historical negative released payroll — 3 legacy rows found

`find-negative-released-entries.ts` (post-fix) found exactly 3 historical `released = true`
`PayrollEntry` rows with a negative calculated Net Salary, all Cycle 2026-07, all with every touched
Unit already carrying its own `PayrollUnitRelease` row:

| Employee | Net Salary | releasedAt |
|---|---|---|
| Adil Masih | -400.00 | 2026-07-25T12:37:39.688Z |
| Asim Khan | -400.00 | 2026-07-25T18:55:10.602Z |
| Ameen Shah | -400.00 | 2026-07-25T18:55:10.602Z |

**Total historical negative amount: 1,200.00.**

**Explicit accounting decision (recorded here as the authoritative record of this decision, made by
the user, not inferred):**
- These are **legacy records created before the negative-payroll-recovery architecture existed** —
  the exact accepted-gap scenario `docs/PROJECT_PROGRESS.md` §1's own checkpoint entry and this
  addendum's §21 both already flagged as a possibility, now confirmed to exist.
- **These 3 historical `PayrollEntry` rows must NOT be mutated** — no field on any of them is
  changed by this checkpoint or its deployment, preserving audit integrity for records created under
  the old application behavior.
- **No `BalanceAdjustment`/recovery is automatically created for any of these 3 employees.** The new
  architecture's recovery-creation path (`createNegativePayrollRecoveryAdjustment`) only ever fires
  at the moment `releaseProjectUnit` itself resolves a still-Draft entry — it has no retroactive
  sweep over already-released historical rows, and none was added for this finding.
- **Whether PKR 400 is genuinely receivable from each of these 3 employees is an open manual finance
  reconciliation question**, not something resolvable from the database alone — the diagnostic
  correctly cannot determine whether these amounts were ever actually paid out, since Bank
  Sheet/Cash Receiving are derived-on-demand and never persisted, so there is no stored record of
  what any historical sheet actually contained.
- **This finding does NOT block deployment.** The new architecture governs *future* releases only —
  it structurally prevents a *new* negative-net entry from ever being paid or silently
  double-counted; it makes no claim about, and takes no action on, data that predates it.

### Migration/architecture final review (Step 3)

Both new migrations remain exactly `20260726120000_negative_payroll_recovery_schema` and
`20260726121000_employee_account_iban_canonical_uniqueness`, in that order, with no other new
migration folder present. Migration SQL re-read in full immediately before push: the
`accountNumberCanonical`/`ibanCanonical` backfill `UPDATE` statements
(`NULLIF(regexp_replace(upper("accountNumber"), '[^A-Z0-9]', '', 'g'), '')` /
`NULLIF(regexp_replace(upper("iban"), '[^A-Z0-9]', '', 'g'), '')`) use the exact same semantics as
`shared/src/lib/banking.ts`'s `normalizeAccountNumber`/`normalizeIban` (uppercase, strip everything
but `[A-Z0-9]` for Account Number / strip whitespace only for IBAN, never numeric coercion) — the
migration's one-time backfill and the application's ongoing write path can never compute a different
canonical value for the same input. `employeeCode`/`cnic` uniqueness is unchanged by either new
migration — still the pre-existing partial unique indexes, still case-sensitive for `employeeCode`,
**not touched by this checkpoint**, per explicit instruction.

Architecture guarantees reconfirmed against the actual code (not merely restated) immediately before
push:
1. `netSalary < 0` can never become a payable amount — `releaseProjectUnit` only sets `released =
   true` for `netSalary > 0` (`computeReleaseRecoveryAdjustment`'s adjusted figure).
2. The negative amount is represented through `BalanceAdjustment(type: RECOVERY,
   originPayrollEntryId: ...)`, reusing the existing materialization/settlement lifecycle.
3. `netSalary = 0` → `payoutOutcome = NO_PAY_DUE`.
4. `netSalary > 0` and otherwise eligible → `released = true` (paid).
5. Bank Sheet excludes non-positive payouts (`bank-sheets.service.ts`'s `netSalary > 0` filter).
6. Cash Receiving excludes non-positive payouts (`cash-receiving.service.ts`, same filter).
7. Release readiness (`evaluatePayrollEntryReleaseReadiness`) blocks duplicate CNIC/Employee
   Code/Account Number/IBAN and missing-Account-Number-for-a-bank-employee.
8. Payroll Entry surfaces "Needs Attention" pre-release via the same canonical
   `releaseBlockReasons`, no duplicated frontend logic.
9. Salary Release reports `blockedEntries` (employee + reasons), not just a bare count.
10. A carried-forward recovery cannot double-count — proven for all three
    `computeReleaseRecoveryAdjustment` cases, including Case 3, with a conservation-invariant test.
11. Historical Released/Archived records are not rewritten by this deployment — neither migration's
    SQL touches `PayrollEntry.released`/`.netSalary`-affecting columns for existing rows, and no
    application code path retroactively processes already-released entries.

Employee identifier uniqueness confirmed to apply consistently across manual creation, manual
editing, reactivation, import, and the database's own partial unique indexes — all four routed
through the same `assertNoDuplicateEmployeeIdentifiers` pre-write check and the same
`accountNumberCanonical`/`ibanCanonical` columns.

### Steps 4–7 — tests, push, deploy, post-deploy verification (COMPLETE)

**Tests/typecheck (final pass, no application code changed since the diagnostic fix):**
`tests/find-negative-released-entries-script.test.ts` **3/3**; backend `tsc --noEmit` clean;
`npx prisma validate` clean. No full-suite re-run performed — no application code changed during
this final documentation/review pass, per explicit instruction to run only what's necessary.

**Push:** `git push origin main` — performed by the user directly (this session's own `git push` was
blocked by its sandbox's own auto-mode permission classifier, which treats a push to `origin/main`,
which triggers Render auto-deploy, as too high-stakes to run automatically even under explicit
instruction; the user ran it themselves). Confirmed after the fact: local `main` and `origin/main`
both resolve to the identical SHA `192ce8b` (`git fetch` + `git rev-parse` both sides) — 9 commits
(`6760e83`..`192ce8b`) landed on `origin/main` in one push, no force-push, no rewritten history.

**Render deployment verification:**
- `https://payroll-management-api-wlic.onrender.com/health` → `{"status":"ok"}` / HTTP 200,
  consistently across 3 checks spaced ~4s apart — no crash loop.
- `https://payroll-management-app-qa3x.onrender.com/` (root) and `/login` → HTTP 200.
- **Migration success**: not directly confirmed via Render build logs (no Render dashboard/API
  access exists in this environment, same limitation every prior checkpoint in this project has
  noted) — inferred instead from the documented Start Command ordering
  (`docs/RENDER_PRODUCTION_DEPLOYMENT.md`: `npx prisma migrate deploy ... && ... npm run start`) —
  a failed migration (e.g. the uniqueness index's own self-guard tripping on an undetected
  duplicate) would have prevented the backend process from ever starting, so `/health` returning 200
  is strong indirect evidence both new migrations applied cleanly. This is weaker than an actual
  build-log line reading "Applying migration `20260726121000_...`" — reported honestly as indirect
  evidence, not overstated as a direct confirmation.
- **Direct proof the new frontend build is actually live** (stronger than timing alone): fetched the
  live `index.html` → its hashed entry bundle → the lazy-loaded `payroll-entry-page-*.js` and
  `salary-release-page-*.js` chunks, and grepped them for this checkpoint's own new, distinctive UI
  strings — **found `"Needs Attention"`** in the Payroll Entry chunk and **found `"blocked — needs
  attention"`** in the Salary Release chunk, both strings that did not exist in the application
  before this checkpoint. The entry bundle's `last-modified` header also read a timestamp from
  within the hour this deploy happened, consistent with (not proof of, on its own) a fresh build.

**Post-deployment safety check:** no production data was read, written, or otherwise touched by this
session at any point — this environment has no authenticated production database or API access, so
neither diagnostic script could be re-run here post-deploy. **If the user has production database
read access, re-running both is worthwhile confirmation** (not required — deployment is already
verified healthy by the checks above): `find-employee-identifier-duplicates.ts` is expected to still
report 0 duplicates; `find-negative-released-entries.ts` is expected to still report the *same* 3
historical rows (Adil Masih, Asim Khan, Ameen Shah) — **that is the correct, expected outcome, not a
regression** — the new architecture prevents *future* negative-net entries from ever reaching
`released = true`, it does not and must not retroactively alter historical data. No historical
`PayrollEntry` row was modified by this deployment, and no automatic recovery was created for any of
the 3 legacy rows.

**Phase 7 remains Not Started; this checkpoint's deployment does not begin it. No further feature
work follows this deployment without a separate go-ahead.**

## 23. Addendum, 2026-07-30 — Phase 7C: Company Logo Storage and Safe Document Integration — IMPLEMENTED, NOT COMMITTED

Full detail in `docs/PROJECT_PROGRESS.md`'s own Phase 7C entry — this is the handoff summary.

**What shipped**: `R2StorageProvider` (a second, S3-compatible `StorageProvider` implementation,
selected via `STORAGE_PROVIDER=r2`, `local` stays default); company logo upload/replace/remove/
retrieve, wired into Company Settings, Login page, Sidebar, and (print-only, layout-verified) Payslip/
Statement PDFs and Bank Sheet/Cash Receiving. No schema migration — `logoStorageKey` reinterpreted as
a version identifier. Theme (`--accent`) untouched throughout, verified in a real browser.

**Two real bugs found only by real-browser (Playwright) verification, both fixed**:
1. `projectUnitsRouter`'s blanket `requireAuth` (mounted broadly at `/api/v1`) intercepted the
   logo-serving routes before they ever matched — fixed by mounting the public logo router
   immediately after `authRouter`, ahead of every other authenticated router. If any *future* route
   needs to be unauthenticated, check this ordering issue first — it will recur for the same reason.
2. `helmet()`'s default `Cross-Origin-Resource-Policy: same-origin` silently blocked the frontend
   from embedding the logo via `<img>` (cross-origin in production, and in this repo's own Playwright
   harness's two-port topology) — fixed with a per-route override to `cross-origin`, not an app-wide
   change. **Any future route intended to be loaded as a cross-origin `<img>`/media subresource will
   need the same explicit override** — this is not automatic.

**Verification**: full backend suite (60/60 suites, 1188/1188 tests), full frontend suite (24/24
files, 218/218 tests), new Playwright spec (4/4 passing, real browser/backend/DB/storage). Typecheck
and lint clean except two pre-existing, unrelated failures already documented in the Phase 7B/7C
PROJECT_PROGRESS entries (confirmed via `git diff` to predate this session).

**Known gap, not fixed (out of scope)**: this repo's shared Playwright `createSiteWithEmployee` E2E
fixture produces a zero-worked-days/negative-net-salary entry that Salary Release silently excludes
from bulk release — reproduced identically against the pre-existing, unmodified
`13-print-architecture.spec.ts` Bank Sheet/Cash Receiving tests. Any future Playwright spec needing a
*released* entry should be aware of this before assuming the shared fixture "just works."

**Not started (at the time)**: Reports, Dashboard. **No commit, push, or deploy occurred this
session** — stopped deliberately for review, per explicit instruction.

## 24. Addendum, 2026-07-31 — Phase 8A (Reports Investigation) + Phase 8B Checkpoint 1 (Reporting Foundation + Payroll Summary Report) — IMPLEMENTED, NOT COMMITTED

Full detail in `docs/PROJECT_PROGRESS.md`'s own "Phase 8A" and "Phase 8B Checkpoint 1" entries
(inserted just before its §2 "Remaining work" table) — this is the handoff summary.

**Naming note, read first**: "Phase 8A"/"Phase 8B" are this work's own out-of-band requester's
session labels, not this roadmap's numbering — the actual work is this roadmap's **Phase 7** Reports
sub-scope (`docs/IMPLEMENTATION_PLAN.md`'s Phase 7 = "Statements, Reports, Dashboard"). This roadmap's
own Phase 8 (Team Collaboration panel, Audit Log viewer UI) is untouched and still Not Started —
same kind of naming collision already on record for "Phase 7D" in Addendum 23.

**Phase 8A** was investigation-only (no code/schema/DB change, no commit): an architecture audit of
the actual existing Prisma schema, backend modules, frontend components, export/print infrastructure,
and RBAC, producing a full report catalogue, filter matrix, drill-down architecture, financial-
correctness rules, and test strategy — delivered as a published artifact. Key finding: `PayrollEntry`
is only partially snapshotted, and Bank Sheet's own "Account Title" already, knowingly, reads live
`Employee.name` even for archived cycles — a pre-existing, already-shipped gap, not something this
investigation introduced.

**Phase 8B Checkpoint 1** implements the Reports module foundation (reusing the existing, previously-
unused `reports:view` permission — no new permission; a new, module-scoped server-side pagination
utility, since none existed anywhere in this codebase) and the first production report, Payroll
Summary — grouped Payroll Cycle → Project Site → totals, every net-salary-derived figure computed via
the single canonical `calcNet`, `cycleTotals` always reflecting the complete filtered scope (never
just the current page), CSV/XLSX export sharing one query/aggregation with the on-screen view, browser
print via the existing `PrintButton`/`PrintContextHeader` system. "Outstanding/balance amount" is
deliberately answered as this cycle's own not-yet-released net salary, not the live, cross-cycle
`BalanceAdjustment.remainingAmount` — see `docs/architecture/workflows/reports.md §5` for the full
reasoning; that figure is left for a future, dedicated report.

**One genuine test-authoring pitfall found and fixed**: reusing the real `ROLE_CODES.PAYROLL_STAFF`
role code for a "lacks `reports:view`" test agent (both in the Jest suite and the Playwright fixture)
silently inherited that role's real seeded default grant, which already includes `reports:view` —
fixed with a dedicated `TEST_`-coded role in both places, matching `bank-sheets.test.ts`'s own
established precedent. A second, minor fixture-ordering lesson in the Playwright spec: creating an
Employee while a Draft cycle already exists auto-syncs them into its roster
(`syncEmployeeIntoCurrentDraftCycle`), so the spec must not also explicitly create a payroll entry for
that employee.

**Verification**: full repo typecheck/lint/build all clean. Backend: 1220/1242 (the 22 failures are
`git diff`-confirmed pre-existing, reproduce identically with the new `reports.test.ts` entirely
absent, and split into two known, unrelated classes — Puppeteer/Chrome PDF rendering unavailable in
this sandbox, and one concurrency-timing flake under full-suite connection-pool load that passes
53/53 in isolation). Frontend: 256/256 (up from 246). Playwright: the new `17-reports.spec.ts`, 2/2
passing against the real stack (real browser, backend, and Postgres) — real data rendering plus a
real CSV download, and a real permission-revocation Access-Denied check mirroring
`10-site-visibility.spec.ts`'s own established "never a false empty state" assertion.

**Not started**: the remaining Phase 8A-catalogued reports (Employee Payroll History, Project Site
Payroll Report, Deduction Report, Overtime Report, Advance Recovery Report, Salary Release Report,
Variance/Month-on-Month Report) and Dashboard. No existing module's behavior (Payroll Entry, Salary
Release, Employee Registry, Advances, Corrections, Statements, Payslips, Bank Sheets, Cash Receiving,
company logo, theme system) was modified. **No commit, push, or deploy occurred this session** —
stopped deliberately for review, per explicit instruction.

## 25. Addendum, 2026-08-03 — Post-deployment Print Usability Refinement (Payroll Summary) — IMPLEMENTED, NOT COMMITTED

Full detail in `docs/PROJECT_PROGRESS.md`'s own "Post-deployment Print Usability Refinement" entry
(inserted just before its §2 "Remaining work" table) — this is the handoff summary.

Production UAT on the deployed Payroll Summary report found a real defect: the printed report was
illegible (19 columns squashed onto one page), even though the on-screen report and Excel export
were already correct. Fixed with a new, Payroll-Summary-scoped Print Options dialog
(`components/reports/payroll-summary-print-options-dialog.tsx` + `payroll-summary-print-fields.ts`)
— presets and individual summary-card/table-column checkboxes, Project Site always locked selected —
that confirms into the exact same shared `useTriggerPrint` print engine every other page already
uses, never a new one. A print-only cards/table block renders only the selected fields from the
already-loaded report DTO (no new fetch, no recalculated figure); the on-screen table/cards and
CSV/XLSX export are completely unaffected. Legibility comes from letting the (now smaller,
user-chosen) column set size itself naturally rather than reusing the shared `.print-fit` class's
existing table-layout:fixed/8.5px-font shrink, which is what made the full table illegible in the
first place. Last-used selection is remembered in browser `localStorage` only, not PostgreSQL.

**Verification**: full frontend suite 278/278 (256 + 22 new — 15 dialog-component tests, 7
page-level tests). New real-Chromium Playwright coverage (`17-reports.spec.ts`, 8/8 including the 2
pre-existing Reports tests): every preset/custom selection prints exactly its own headings (exact
accessible-name match, not just "some text node exists"), plus measurable geometry proof of no
horizontal overflow, no per-cell clipping, and no adjacent totals-cell overlap; on-screen table
still complete under real screen media; Excel export still succeeds and unaffected. Repo-wide
typecheck clean; no backend change (frontend presentation only), so no backend test/build impact.

**No commit, push, or deployment occurred this session** — stopped deliberately for review, per
explicit instruction. No other report, Dashboard work, or unrelated module was started or modified.

## 26. Addendum, 2026-08-03 — Final Print UX Refinement (Payroll Summary) — IMPLEMENTED, NOT COMMITTED

Full detail in `docs/PROJECT_PROGRESS.md`'s own "Final Print UX Refinement" entry — this is the
handoff summary. Two UX changes to the Print Options dialog from Addendum 25, before landing:

1. **Default selection is now the complete report** (every card, every column) — the application
   must never silently hide report data, so a smaller printout is now something a user explicitly
   opts into (a preset or a hand-picked selection), never the unexplained starting point. Reset to
   Default now restores this same complete selection, not Compact Summary. A saved browser-local
   preference still wins over the new default on the dialog's next open — no storage migration.
2. **"N columns selected" replaced with a Print Readability indicator** — four column-count tiers
   (Excellent ≤8 / Good 9–11 / Wide 12–15 / Very Wide 16+), purely informational, never altering the
   selection; only Very Wide additionally shows a prominent, still non-blocking warning banner.

No backend change, no calculation change, no CSV/XLSX change, no other report started.
**Verification**: full frontend suite 288/288 (278 + 10 net new — dialog tests expanded to 23, page
tests to 19). Reports Playwright (`17-reports.spec.ts`) 9/9 (8 existing + 1 new confirming the
real-browser default). Typecheck/lint clean; no backend build impact.

**No commit, push, or deployment occurred this session** — stopped deliberately for review, per
explicit instruction. No other report, Dashboard work, or unrelated module was started or modified.

## 27. Addendum, 2026-08-04 — Phase 7F: Payroll Workflow Integrity — IMPLEMENTED, NOT COMMITTED

Full detail in `docs/PROJECT_PROGRESS.md`'s own "Phase 7F — Payroll Workflow Integrity" entry
(inserted just before its §2 "Remaining work" table) and
`docs/architecture/workflows/payroll-lifecycle.md §4`'s new subsections — this is the handoff
summary. Four objectives from a production-UAT-driven checkpoint, all implemented and tested.

**Objective 1 (Employee Registry authoritative Draft master data)**: production UAT found editing
Gross Salary in Employee Registry didn't update an already-created, unreleased Payroll Entry.
Extended Phase 7D's own "Master Data Boundary" live-overlay/release-freeze mechanism
(`withLiveMasterData`/`liveMasterByEntryId`) to the three fields it had missed — `grossPay`,
`employeeNameSnapshot`, `fatherNameSnapshot` — removed from `updatePayrollEntrySchema` the same way
`designation`/banking fields already were. CNIC/Employee Code confirmed already correctly live
(never independently stored on `PayrollEntry`); EOBI applicability confirmed already correct via
its own distinct bidirectional-sync mechanism. Every genuinely Payroll-owned field confirmed still
Draft-editable via a dedicated regression test. **Known limitation, not fixed**: CSV/Excel export
and Backup Package generation still read the entry's stored column directly, bypassing the live
overlay — a pre-existing gap mirroring Bank Sheet's own already-shipped "Account Title" gap
(Phase 8A); Bank Sheets/Cash Receiving themselves are unaffected (`released: true`-scoped only).

**Objective 2 (Release All)**: new bulk release action (`POST
/api/v1/payroll-cycles/:cycleId/units/release-all`), scoped to one Site or "All Sites" (the
caller's own RBAC-accessible scope). Loops the exact same, unmodified `releaseProjectUnit` once per
not-yet-released Unit — introduces no second release mechanism. **Transaction strategy: one
transaction per Project Unit, sequential** (reasoning fully documented in both the function's own
doc comment and the workflow doc) — chosen over one giant transaction (timeout/lock-duration/
blast-radius risk) and over one per employee (no natural single-employee transaction boundary this
architecture already has). A genuine per-Unit failure is reported and skipped without affecting any
other, already-succeeded Unit — verified with a test that forces one specific Unit to fail via a
targeted `jest.spyOn` on the plain (pre-transaction) `prisma.projectUnit.findUnique` call, confirmed
not to intercept anything inside `releaseProjectUnit`'s own transactional client proxy.

**Objective 3 (Hold Workflow Verification)**: full audit of the documented Hold → Release →
Hold-removed lifecycle. Mechanics were already correct through "release remaining" (held entries
were always excluded from `releaseProjectUnit`'s own candidate query). Two real gaps found and
fixed: (1) `getUnitReleaseStatus`'s `willReleaseCount` included Held entries, overstating the
Release confirmation dialog's "will release now" figure — fixed, with a new `heldCount` field
surfacing the excluded count explicitly rather than folding it into "remain pending." (2) The
documented lifecycle's own final step — un-Hold *after* the Unit already released — had no path
back to release at all; `releaseProjectUnit` unconditionally 409'd a second call against an
already-released Unit. This is the "Late Entry" gap every prior checkpoint's own doc comments
documented as explicitly deferred (distinct from the still-genuinely-open "no post-finalization
release path" gap, which this does **not** close — see the workflow doc's own clarification).
Closed as a **Late/Straggler Sweep**: a second call against an already-released Unit now sweeps
only newly-eligible stragglers (no new `PayrollUnitRelease` row — still insert-once, still no
"un-release"), still rejecting with the identical 409 when there's genuinely nothing new. Verified
this doesn't regress the pre-existing "double-click" 409 test, and correctly waits for a
straggler's *other* touched Unit before resolving it. Surfaced in the UI as a distinctly-labeled
"Release Remaining" action. Also added a derived, purely client-side Site-level release-status badge
(Draft/Partially Released/Held Remaining/Released) — investigation found none existed before this
checkpoint; computed from already-fetched data, no new backend endpoint.

**Objective 4 (edge-case audit)**: Hold→Released→Hold-removed→release-remaining is the Late/
Straggler Sweep above, verified end to end. Recovery Due/No Payout/Balance Payable/Corrections/
Balance Adjustments all confirmed unaffected by every change in this checkpoint — every
Corrections/Balance-Adjustments test suite and the negative-salary/recovery-accounting suites pass
unchanged in the full regression run. Bank Sheets/Cash Receiving/Payslips/Statements confirmed
scoped to released entries only, unaffected by the Draft-time changes, and Payslips specifically
more correct than before (name/father-name now freeze at release time, not entry-creation time).

**Verification**: full backend suite — see this file's own final tally below (re-run clean against
a freshly re-provisioned local database after an unrelated mid-session database-corruption incident
this session's own investigation found and fixed — see "Environment note" below, not a code
defect). Full frontend suite **312/312** passing throughout (no regression at any point). Repo-wide
typecheck clean (shared/backend/frontend/e2e) after every change. New test files: `backend/tests/
payroll-entry-master-data-boundary-grosspay.test.ts` (6), `payroll-release-all.test.ts` (13),
`payroll-hold-workflow.test.ts` (4) — 23 new backend tests, all passing, none flaky across repeated
runs. Five pre-existing backend tests and two pre-existing frontend tests updated for the
intentional `grossPay`-no-longer-Draft-editable behavior change (not relaxed — each re-scoped to
what it actually verifies, with a swapped still-editable field where `grossPay` was only ever
incidental to that test's real point).

**Environment note (not a code defect, recorded for the next session)**: this session's local
Postgres (re-provisioned per the standing `@embedded-postgres/darwin-x64` recipe) accumulated
cross-test-file pollution from several earlier, interrupted `npx jest` invocations run directly
(bypassing `npm run test`) while diagnosing an unrelated login-401 issue during initial setup —
traced to `roles.test.ts`'s own "second qualifying administrator" test, which deliberately
deactivates the real `MASTER_ADMIN` system role mid-test and restores it in a follow-up statement
that never ran because an earlier partial invocation aborted first. This is a pre-existing test-
isolation hazard (a shared, global system-role row mutated without a guaranteed-to-run restore),
not something this checkpoint's own code changes caused — confirmed by reproducing the exact same
cascading 401 failures against a freshly re-provisioned, completely unmodified database using only
`npx jest` directly. Fixed for this session by dropping and recreating the database cleanly and
running the full suite exactly once via `npm run test`. **Worth a dedicated hardening pass in a
future checkpoint** (e.g. `cleanTestData()` also resetting system-role `isActive`/`isSystemRole` to
their seeded values, or that specific test using `try/finally`) — not attempted here, out of scope
for a Payroll workflow checkpoint, and the underlying mechanism (this test intentionally toggles a
real system role for one assertion) is itself sound; only the restore's own failure-safety needs
hardening.

**No commit, push, or deployment occurred this session** — stopped deliberately for review, per
explicit instruction. No other report, Dashboard work, or unrelated module was started or modified.

## 28. Addendum, 2026-08-04 (later same day) — Phase 7F Refinement: Export live overlay + Release Remaining idempotency — IMPLEMENTED, NOT COMMITTED

Full detail in `docs/PROJECT_PROGRESS.md`'s own "Phase 7F Refinement" entry — this is the handoff
summary. Two review follow-ups, both closed.

**1. CSV/Excel export now matches the on-screen Payroll Entry grid.** Export
(`payroll-entry-import-export.service.ts`) was reading stored `PayrollEntry` columns directly,
bypassing Objective 1's own live-overlay — a Draft export could show a stale Gross Salary/
Designation. Also found, independently: the export's Name column was the *opposite* problem —
always live (`entry.employee.name`), never frozen even for a Released row. Fixed by exporting and
reusing the existing `withLiveMasterData` (no new logic) and switching Name to
`employeeNameSnapshot ?? entry.employee.name` (Payslip's own existing convention). Released/Archived
export rows are unaffected — same `released || payoutOutcome !== null` gate already proven
elsewhere. No calculation or Release-semantics change. Backup Package generation (reuses this same
export) inherits the fix for free.

**2. Release Remaining idempotency, tested explicitly.** New test:
hold → release remaining → un-hold → Release Remaining → Release Remaining again. Second call 409s;
verified byte-identical afterward: `PayrollUnitRelease` count, `payroll_unit.late_sweep`/
`payroll_entry.released` audit counts, the entry's own row, Bank Sheet row, Cash Receiving row
count, a real Payslip PDF (still generates cleanly), and the Statement ledger (still one line).

**Testing-infrastructure note**: the new test's two real Payslip PDF generations exposed
`payroll-hold-workflow.test.ts` to the same measured Puppeteer/Chrome resource-contention fragility
`payslips.test.ts` already carries its own file-scoped `jest.setTimeout(45000)` for — reproduced
once under full-suite load (a 500, not a hang), absent both in isolation and after applying the
identical existing mitigation. Not a logic defect; same established pattern, not a new one.

**Verification (final, after the refinement)**:
- Backend: **1271/1272** — the one failure (`corrections-service.test.ts`'s "Concurrent approval...
  two different requests... serialize" test) is a pre-existing, already-documented full-suite
  concurrency-timing flake in a module this checkpoint never touched (Corrections) — confirmed
  **53/53 in isolation**, the exact figure this project's own prior documentation already recorded
  for this same known flake.
- Frontend: **312/312**.
- Playwright: full suite re-run — see this addendum's own final line below for the result.
- Typecheck (shared/backend/frontend/e2e): clean. Lint (backend + frontend): clean, 0 errors (only
  pre-existing warnings in files this checkpoint never touched). Build: clean.

**No commit, push, or deployment occurred this session** — stopped deliberately for review, per
explicit instruction. No other report, Dashboard work, or unrelated module was started or modified.

