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

> **Update, 2026-08-26 (latest) — H3 Employee Identity Completeness Audit CLOSED, AMBER, with an
> owner clarification that Employee Code incompleteness is expected current state.** Employee Codes
> have not yet been generated for the full workforce (a dedicated future phase) — missing Employee
> Code (850/1,247 active employees, 68.2%) is therefore explicitly **not** an August
> payroll-readiness defect/risk and must not move any classification toward AMBER/RED by itself.
> **H3 remains AMBER** on corrected grounds: the "Muhammad Tariq" case (5 same-named active
> employees, 3 with neither Father Name nor CNIC — worse than the 1 pair the prior, now-stale audit
> found) is currently still operationally distinguishable only because those three sit at three
> different Site/Unit combinations. **September attendance entry may proceed.** Targeted remediation
> (Father Name/CNIC for the 3 blank Muhammad Tariq records, then other duplicate-name employees
> missing both fields) explicitly excludes Employee Code. The shared `EmployeeLookup` component's
> failure to show Father Name/CNIC at the selection point (Advances/Corrections creation) is recorded
> as a deferred, non-urgent UX-hardening candidate — not implemented, not an emergency v1.0.3 item.
> Full record: `docs/PROJECT_PROGRESS.md`'s own "H3 CLOSEOUT" entry (immediately above its own §2)
> and this file's own §67 — not duplicated here in full.
>
> ---
>
> **Update, 2026-08-26 (superseded by the entry above for status purposes) — Sharafat Masih legacy
> Advance inconsistency REPAIRED in production.** Business confirmed PKR 10,000 was the actual
> authorized/disbursed amount — the
> Advance's own `totalAmount` (PKR 5,000) had under-recorded it; the linked Payroll Entry's
> `advanceDeduction` (PKR 10,000) was already correct. Repaired via a one-time, engineer-executed
> production transaction: rehearsed empirically against a local disposable Postgres first, then a
> production dry run (all preconditions matched exactly, deliberately rolled back, zero writes),
> then execution with the same unmodified script — a single guarded compare-and-swap raised
> `Advance.totalAmount` **5,000 → 10,000 only** (`outstandingBalance`/`status`/`repaymentType`/
> scheduling/notes all unchanged), **zero PayrollEntry writes** (its `version`/`updatedAt` confirmed
> bit-for-bit unchanged after commit), one `advance.updated` AuditLog entry recorded in the same
> transaction, attributed to the real authenticated Master Admin (Ossamah Suhail/Finance,
> `4ba66cfc-615a-484c-991e-fc9d7497de04` — resolved by read-only lookup after two active Master
> Admin accounts were found and the user was asked to disambiguate, never invented). Production
> access was obtained via the official Render CLI, authenticated by the user themselves; the
> production connection string was held only in-memory for each command and never written to any
> file, log, or commit; no Render configuration of any kind was touched; no migration/seed/db-push
> was run. The one-time repair script was deleted immediately after verification and was never
> committed to any branch. `v1.0.2` tag unchanged. **Final classification: GREEN — Sharafat Masih's
> Advance and its linked August 2026 Draft Payroll Entry now reconciled at PKR 10,000.** Full
> record: `docs/PROJECT_PROGRESS.md`'s own "Sharafat Masih Legacy Advance Repair — Path 2 Local
> Rehearsal, Production Dry Run, One-Row Production Repair" entry and this file's own §66 — not
> duplicated here in full.
>
> ---
>
> **Update, 2026-08-25 (superseded by the entry above for status purposes) — v1.0.2 RELEASED.**
> Annotated tag `v1.0.2` (tag
> object `065aa682f7f4129a7f949994a1afa2fcac77f8d0`) created pointing exactly at
> **`096cf7933876df18729f0100920caa62647c496c`** (PR #16's merge commit — not the later docs-only
> `4634b93`), pushed as the only ref (`git push origin v1.0.2`, no force-push), independently
> re-resolved via `git ls-remote --tags origin` after the push. GitHub Release "Payroll Management
> System v1.0.2" published from that tag — `isDraft: false`, `isPrerelease: false`, targeting
> `096cf7933876df18729f0100920caa62647c496c`, published `2026-08-25T18:01:57Z`. `v1.0.0`, `v1.0.1`,
> `v1.0.0-rc1`, and `backend-live-v1` all reconfirmed unchanged (local SHAs match remote for every
> one). **Sharafat Masih remains untouched — remediation status PENDING BUSINESS CONFIRMATION** of
> whether PKR 5,000 or PKR 10,000 is the actual authorized amount; the two application-level
> remediation paths (both requiring a one-time engineer-executed correction, not a Finance
> self-service UI action) remain recorded, neither executed; no direct SQL, no guard bypassed, no
> production validation weakened. **Final classification: v1.0.2 RELEASED — Advance Edit/Cancel and
> Advance↔Payroll Entry integrity production baseline established.** Full record:
> `docs/PROJECT_PROGRESS.md`'s own "v1.0.2 RELEASED — Tag Created, GitHub Release Published" entry
> and this file's own §65 — not duplicated here in full.
>
> ---
>
> **Update, 2026-08-25 (superseded by the entry above for status purposes) — v1.0.2 PRODUCTION
> CUTOVER: PR #16 merged, post-merge CI GREEN, production deployment and smoke all GREEN, STOP BEFORE
> TAG (tag has since been approved and created — see the entry above) — and a new finding: Edit/
> Cancel/Defer are all currently blocked (409) for Sharafat Masih's specific record.** PR #16 (Advance
> Edit/Cancel integrity fix, narrowed to Amount + Date + Notes) merged into `main` with a normal merge
> commit, **`096cf7933876df18729f0100920caa62647c496c`**, after a re-checked pre-merge integrity gate
> (head unchanged, CI green at that head, no diverged `main`, scope limited to the documented eight
> files). Post-merge CI (run `32877904798`, on the actual merge commit) is **SUCCESS** — Backend all
> six shards, Frontend, E2E all green. Production deployment verified functionally (no Render API/CLI
> access this session, disclosed): backend `/health` 200 on both the custom domain and the raw Render
> URL, frontend 200, authenticated session loads real data. **Read-only production smoke all GREEN**:
> Advances and Payroll Entry both load normally; the narrowed Edit modal (Advance Amount / Advance
> Date / Notes only, nothing else) confirmed live via inspecting Sharafat Masih's own Advance, closed
> without saving. **Zero production data was mutated.** `v1.0.0`/`v1.0.0-rc1`/`v1.0.1`/
> `backend-live-v1` all confirmed unchanged. **Classification: GREEN — v1.0.2 deployed and
> production-validated, ready to tag; recommended tag target
> `096cf7933876df18729f0100920caa62647c496c`.** Per explicit instruction, **the `v1.0.2` tag was NOT
> created, no GitHub Release was published**, and Sharafat Masih's record was **NOT** remediated —
> awaiting separate approval of the tag, and separate business confirmation of the correct Advance
> amount before any remediation.
>
> **New finding, corrects the prior checkpoints' own assumption**: tracing `updateAdvance`/
> `cancelAdvance`/`deferAdvanceSchedule` against Sharafat Masih's exact live numbers (`totalAmount`
> PKR 5,000, `outstandingBalance` PKR 0, linked Payroll Entry `advanceDeduction` PKR 10,000) found
> that **none of the three actions can currently succeed on this one record, for any input** — each
> reverses the live PKR 10,000 deduction before writing, which always computes an
> `outstandingBalance` that exceeds `totalAmount` by exactly the pre-existing PKR 5,000 gap, and the
> checkpoint's own defensive bounds guard correctly rejects every such write with a 409. This is the
> guard working as designed (no crash, no silent corruption), but it means the "a Master Admin uses
> the now-fixed Edit action" remediation recorded by the prior two checkpoints does **not** actually
> work for this record — it was untested at the time. **Two remediation paths, both requiring a
> one-time engineer-executed data correction (not a Finance self-service UI action), are recorded in
> full in `docs/PROJECT_PROGRESS.md`'s own "v1.0.2 PRODUCTION CUTOVER" entry — not duplicated here.**
> Full record: that same `docs/PROJECT_PROGRESS.md` entry (immediately above its own §2) and this
> file's own §64 below — not duplicated here in full.
>
> ---
>
> **Update, 2026-08-25 (superseded by the entry above for status purposes) — v1.0.1 Checkpoint 1: PR #15 merged, post-merge CI GREEN, production
> deployment and read-only smoke all GREEN, STOP BEFORE TAG.** PR #15 (Employee Identity Visibility —
> `Code | Employee | Father Name | CNIC` in Payroll Entry, Advances, Employee Registry) merged into
> `main` with a normal merge commit, **`f5897afa38a07662fc29244e0a77e2d6866426d4`**, after a re-checked
> pre-merge integrity gate (head unchanged, CI green at that head, no diverged `main`, zero backend/
> payroll-calculation files). Post-merge CI (run `32825644622`, on the actual merge commit) is
> **SUCCESS** — Backend all six shards, Frontend, E2E all green. Production deployment verified
> functionally (no Render API/CLI access this session, disclosed): backend `/health` 200, frontend
> 200, authenticated session loads real data. **Read-only production smoke all GREEN** on all three
> screens — the identity columns are live in production, the frozen Payroll Entry pane behaves
> correctly under horizontal scroll, and **a real duplicate-name pair was found directly in
> production** (four distinct active employees all named "Muhammad Imran," distinguished only by the
> new Father Name/CNIC columns) — no synthetic case was needed. **Zero production data was mutated.**
> `v1.0.0` confirmed unchanged (`5e097ef470956ade8b022072fbdf16949539777c`). **Classification: GREEN —
> v1.0.1 production candidate validated and ready to tag; recommended tag target
> `f5897afa38a07662fc29244e0a77e2d6866426d4`.** Per explicit instruction, **the `v1.0.1` tag was NOT
> created, no GitHub Release was published** — awaiting separate approval. Full record:
> `docs/PROJECT_PROGRESS.md`'s own "v1.0.1 Checkpoint 1 — Merge, Production Verification" entry and
> this file's own §58 — not duplicated here in full.
>
> ---
>
> **Update, 2026-08-21 — Backend/CI Reliability Checkpoint 2, and Payslips Batch-Audit
> Ordering Fix — Reliability Phase 4 COMPLETE. Both COMMITTED and MERGED to `main`.** Continues the
> Checkpoint 2 item left open by the entry below. **Checkpoint 2A** (`5b6b9b8`, "fix: dispose session
> store before pool teardown"): the `Jest did not exit...` warning and CI run #88's
> `"Cannot use a pool after calling end on the pool"` failure both traced to `connect-pg-simple`'s
> `PGStore` self-rescheduling prune timer outliving a freshly-minted-per-`createApp()`-call store;
> fixed by making the store a lazy singleton, closed (`store.close()`) before the pool (`pool.end()`)
> in `closeSessionPool()`. A monolithic single-process `--runInBand` Backend Jest run then
> independently reproduced a heap-exhaustion failure near the existing 3072 MB ceiling — diagnosed
> (not fixed) via a temporary heap-instrumentation branch (`diagnostic/jest-heap-pass-1`, PR #8,
> later closed unmerged as superseded), which measured a maximum observed per-shard heap of
> approximately 1,458 MB. **Checkpoint 2C** (`f08d78c`, "ci: shard backend tests for memory
> isolation"): the permanent fix — six sequential, process-isolated shard steps in
> `.github/workflows/ci.yml` (`--shard=1/6`…`6/6`), each a fresh Jest process, resetting the
> accumulated heap baseline between shards; `--runInBand` retained within each shard, 3072 MB
> ceiling unchanged. A related PDF-worker test-isolation defect (`69f66e9`, "fix: isolate PDF worker
> test configuration") was fixed the same pass: `tests/setup.ts` transitively imported
> `pdf-worker-client.ts` (via `../src/app`) before `pdf-worker-timeout.test.ts`/
> `pdf-worker-infrastructure.test.ts`'s own dedicated socket/timeout env vars were set, so a plain
> `require()` returned an already-cached, default-configured instance; fixed with
> `jest.isolateModules` plus explicit `__TEST_ONLY__` socket/timeout ownership assertions. All three
> commits merged via **PR #9** as `c1b77083ee8657abf0351946bab03b35d8692839`; runtime gate **Run #95**
> — Backend SUCCESS (all six shards), Frontend SUCCESS, E2E SUCCESS, overall SUCCESS. The immediate
> post-merge push-to-`main` run (**Run #96**, same commit) then caught a separate, previously-unknown
> defect: `FAIL tests/payslips.test.ts` — the batch ZIP export's response could complete
> (`res.on('finish')`, via `archive.pipe(res)`'s default `end:true`) before
> `recordAuditLog('payslip.batch_exported')` had run. Fixed
> (`8d83e274b3fcbb177fa259ec97d421d05d1cfa6d`, "fix: order payslip batch audit before response
> completion") by piping with `{ end: false }` and calling `res.end()` explicitly only after the audit
> write resolves. Merged via **PR #10** (exactly one commit, one file) as
> `aec372eda89e87894b199ef601446cba708e2bc0`; runtime gate **Run #97** — Backend SUCCESS (all six
> shards, including shard 1/6's `PASS tests/payslips.test.ts`), Frontend SUCCESS, E2E SUCCESS (195
> tests: 186 passed, 1 flaky-then-passed-on-retry in unrelated `08-role-administration.spec.ts:227`,
> 8 skipped), overall SUCCESS; post-merge **Run #98** confirmed the same on `main` (E2E 187 passed, 0
> flaky that run). Cleanup: PR #8 closed unmerged (superseded, never merged); remote branches
> `reliability/checkpoint-2-final`, `fix/payslip-batch-audit-ordering`, and
> `diagnostic/jest-heap-pass-1` deleted (both PRs confirmed merged / diagnostic PR confirmed closed
> unmerged first); local-only `backup/bfd96aa-payslips-fix` deleted after confirming its diff was
> byte-identical to the merged `8d83e27` (rebase-only difference) and that `8d83e27` is a confirmed
> ancestor of `main`. No production migration, seed, or deployment was performed. **Reliability
> Phase 4 is now COMPLETE; Reliability Phase 5 has NOT begun and remains blocked pending separate
> authorization.** Still open, not resolved by this checkpoint: historical Statements/Corrections
> intermittent anomalies; the Node 20.20.2-vs-Puppeteer->=22.12.0 engine mismatch; 10 pre-existing
> `no-console` lint warnings; the Run #97 flaky Playwright retry above (did not reproduce in Run #98,
> not proven permanently resolved by one clean run). Full record:
> `docs/PROJECT_PROGRESS.md`'s own "Backend/CI Reliability Checkpoint 2 — Session/Pool Lifecycle,
> Permanent Six-Shard Sharding, PDF-Worker Test Isolation, and Payslips Batch-Audit Ordering Fix
> (2026-08-21)" entry — not duplicated here in full.
>
> ---
>
> **Update, 2026-08-19 (latest) — Backend/CI Reliability Checkpoint: known-green baseline,
> GitHub Actions performance-test investigation, and Plan-Shape Hardening — COMMITTED
> (`bbf54b3daad75f0642956b4994d375412379749a`), PUSHED to `origin/main`.** Not a roadmap-phase
> checkpoint — this is a separate reliability-tracking sequence ("Reliability Phase 4"/"Reliability
> Phase 5" below), unrelated to `docs/IMPLEMENTATION_PLAN.md`'s own Phase 4/Phase 5. A clean local
> baseline (backend 94/94 suites/1831/1831 tests, frontend 1056/1056, E2E 195/187/0/8) surfaced,
> under real GitHub Actions conditions, stale-planner-statistics and brittle exact-plan-shape
> ("not Seq Scan") test assertions that a local run never reproduced. Advance Recovery's fixture
> statistics were hardened with an explicit `ANALYZE` (`7734bb6`); a full audit then removed
> categorical scan-shape assertions from six performance suites wherever fixture selectivity made a
> sequential scan a legitimate, fast, cost-based choice, replacing them with structural index
> verification (`expectIndexColumns`, `backend/tests/helpers.ts`, reads Postgres catalog metadata
> directly) plus the pre-existing, unchanged wall-clock timing bounds. No threshold raised, no
> fixture shrunk, no retry/sleep/skip added, no planner setting touched, no production code changed.
> **Authoritative runtime gate: GitHub Actions Run #86 (run ID `32244434825`) — Backend SUCCESS
> (94/94 suites, 1831/1831 tests), Frontend SUCCESS, E2E SUCCESS (confirmed actually executed),
> overall workflow SUCCESS.** Two items explicitly remain open, not fixed here: the
> `Jest did not exit...` open-handle warning (`sessionPool`/`connect-pg-simple` lifecycle,
> Reliability Checkpoint 2, not started) and historical `statements.test.ts`/
> `corrections-service.test.ts` intermittent anomalies (recorded, not proven permanently resolved by
> one green run). A Node 20.20.2-vs-Puppeteer's-declared->=22.12.0 engine mismatch and 10
> pre-existing `no-console` lint warnings are recorded as non-blocking maintenance debt. Reliability
> Phase 5 has not begun and remains blocked pending separate authorization. Full record:
> `docs/PROJECT_PROGRESS.md`'s own "Backend/CI Reliability Checkpoint" entry — not duplicated here
> in full.
>
> ---
>
> **Update, 2026-08-13 (latest) — Dashboard Checkpoint 1A (Backend Foundation) — IMPLEMENTED,
> awaiting review, NOT COMMITTED.** A single aggregation endpoint, `GET /api/v1/dashboard`
> (`docs/architecture/workflows/dashboard.md`), answering "what does the active/current payroll cycle
> look like right now, and is there anything I need to pay attention to?" — Total Employees, Net
> Payroll, Pending Release, Release Progress, Deduction Breakdown, a Top-5 Site Payroll Summary, and
> Attention Required (Held Entries, Pending Corrections, Recovery Due). Route gate reuses the
> established any-of mechanism (`reports:view OR payroll:view`, no new permission), but every widget
> independently re-checks its own permission — a caller passing the outer gate does not automatically
> see every widget (e.g. Finance, `payroll:view` only, sees Pending Release/Release Progress but not
> Net Payroll/Deductions/Site Summary). Every cycle-scoped financial figure reuses Payroll Summary's
> own aggregation (`reports.service.ts`'s `buildPayrollSummaryData`, exported for this reuse) — no
> new financial or release formula anywhere in this module; numeric identity with the Payroll
> Summary/Deduction Report/Salary Release Report's own live totals is proven by direct HTTP
> reconciliation tests, not merely asserted. No caching layer yet (deliberately deferred, frozen
> decision) and no migration was needed (10,000-employee-scale `EXPLAIN ANALYZE` evidence shows every
> new query index-backed). Backend-only — this checkpoint explicitly stopped before any frontend
> Dashboard work, any other report, or any commit/push/deploy. Full record:
> `docs/architecture/workflows/dashboard.md` and `docs/PROJECT_PROGRESS.md`'s own "Dashboard
> Checkpoint 1A" §1 entry — not duplicated here in full. **`docs/PROJECT_PROGRESS.md` §1 remains the
> authoritative chronological record for anything between this entry and the 2026-08-07 one
> immediately below** (several Reports checkpoints and a Payroll Entry RBAC correction landed in that
> gap — this file was not updated for each of them individually; see `PROJECT_PROGRESS.md`).
>
> ---
>
> **Update, 2026-08-07 (latest) — Phase 7 Reports, Overtime Report Checkpoint 1B (Frontend, Browser
> Print, and E2E) — IMPLEMENTED, awaiting review, NOT COMMITTED.** Built over the now-committed
> (`862c231`, pushed to `origin/main`) Checkpoint 1A backend — no backend, shared-contract, or
> database change this checkpoint. Full record: `docs/architecture/workflows/reports.md` §18.11 and
> `docs/PROJECT_PROGRESS.md`'s own "Phase 7 Reports — Overtime Report, Checkpoint 1B" §1 entry — not
> duplicated here in full.
>
> **Gated on `reports:view`**, same as every sibling Checkpoint-1B report — never `statements:view`.
> Route pair (`/reports/overtime-report` + `/payroll-cycles/:cycleId/reports/overtime-report`),
> catalogue card now `available: true` with no `requiredPermission` override, no detail route.
>
> **Report grain, carried faithfully into the frontend**: one table row = one `PayrollEntryWorkLine`,
> keyed on `workLineId` (never `payrollEntryId`, which two rows can share) — the page never merges,
> groups, or deduplicates rows by employee. An employee with 2 work lines this cycle legitimately
> renders as 2 rows. Because the same employee name/code can legitimately repeat across adjacent
> rows, the Unit column renders as a solid blue `Badge` rather than plain text — this report's one
> deliberate visual departure from every sibling report's identical column styling, so a duplicate
> employee name is never mistaken for duplicate data at a glance.
>
> **Built**: `hooks/use-overtime-report.ts` (list query disabled until a Cycle exists, CSV/XLSX
> export with structured-413 handling, a stable-query-key test proving one request per genuine change
> and zero redundant ones on an unchanged re-render); filters — Site, Unit (disabled unless exactly
> one Site selected), Row Status, Has Correction, and the one report-specific Has Overtime tri-state;
> totals grouped into Overtime (Total OT Hours/Earnings, collapses to a notice when `totalsComputed`
> is `false`), Coverage (Matching Work Lines always exact; Employees/Sites/Units With Overtime
> individually dashed when unavailable), and Status (Released/Held/Pending/Corrected Entries, always
> exact, never recomputed from visible rows — an entry with 2 OT-matching work lines still counts as
> 1 entry); an 11-column table (the smallest of any report in this module) sorted server-side on the
> six approved fields only (Designation/Effective OT Rate/OT Earnings/Gross Pay/Has Correction render
> with no sort button); CSV/XLSX export of the complete filtered result; a dedicated
> `OvertimeReportPrintOptionsDialog`/`overtime-report-print-fields.ts` (current-page-only,
> `overtime-report-print-fields:v1` localStorage key, 10 cards/11 columns, readability thresholds
> scaled down from Employee Payroll History's own 13-column scale to this report's smaller ceiling);
> the same page-clamp-on-shrunk-total safeguard Project Site Payroll Report's/Deduction Report's own
> Checkpoint 1B work established, included from the start.
>
> **Verified**: 111 new frontend tests, all passing (109 across 4 new colocated Vitest files —
> 21 hook, 2 labels, 19 print-fields, 69 page, including a dedicated **WorkLine grain** suite proving
> one employee/two work lines renders as exactly two rows never merged, each with its own correct
> Unit and independently-preserved OT Hours/Effective OT Rate/OT Earnings — plus 2 added to the
> existing catalogue test); full frontend suite **689/689**. `typecheck`/`lint`/`build` clean across
> `shared`/`backend`/`frontend`, `typecheck:e2e` clean, `git diff --check` clean.
> `tests/e2e/specs/22-overtime-report.spec.ts` — **10/10 passing** standalone, **9/9** for
> `17-reports.spec.ts` standalone (unaffected), **19/19** combined (real backend, real Chromium, no
> route mocking) — covering navigation/totals/sorting/pagination, Site scoping with a genuine
> historical transfer, Unit filter and Has Overtime, a dedicated **Multi-unit work-line grain** test
> (two real work lines, two different Units, two different explicit OT rates — 4h@120=480 vs.
> 9h@200=1,800 — both retained as two on-screen rows and two CSV export rows), all five row statuses,
> a real approved Correction leaving OT Hours/OT Earnings provably unchanged with no reason-text leak,
> CSV export downloaded and its contents swept for sensitive fields, XLSX download/action/filename
> verified (XLSX content/header/security parity already covered by the backend's own Checkpoint 1A
> export tests), Print Options defaults/readability plus a direct proof
> that zero export requests fire from Print, a responsive-layout check at 1024px, and permission
> enforcement.
>
> **Overtime Report is now fully complete pending review** (Checkpoints 0, 1A, 1B). No
> commit/push/deploy occurred this session for Checkpoint 1B.
>
> **This entry supersedes the Checkpoint 0/1A-only entry immediately below** (backend foundation
> only, no frontend) **for current-status purposes — that entry's own text is left exactly as
> originally written**, per this project's "don't rewrite history" documentation convention: a
> superseding update is always a new, later entry, never an edit to an earlier one's own words. Note
> one factual update the entry below predates: its own Checkpoint 1A was subsequently reviewed and
> **committed as `862c231`, pushed to `origin/main`** — the "No commit, push, or deployment occurred"
> line in that entry describes its state at the time it was written, not the current state.

> **Update, 2026-08-07 (latest) — Phase 7 Reports, Overtime Report Checkpoint 0 (Architecture,
> approved) and Checkpoint 1A (Backend Foundation) — IMPLEMENTED, awaiting review, NOT COMMITTED.**
> Backend/shared-contracts/tests only — no frontend page exists yet for this report. Full record:
> `docs/architecture/workflows/reports.md` §18 and `docs/PROJECT_PROGRESS.md`'s own "Phase 7 Reports
> — Overtime Report" entry (all 17 frozen decisions; the single-line-`calcNet`-call rationale;
> performance/boundary evidence) — not duplicated here in full.
>
> **Report grain — a frozen, intentional architectural exception**: one row = one
> `PayrollEntryWorkLine`, not one `PayrollEntry` (every sibling report in this module is
> `PayrollEntry`-grain). OT hours/rate are genuinely work-line-scoped; this is the only grain where
> OT Hours/Effective OT Rate/OT Earnings are all unambiguous per Unit. Gated on `reports:view`
> (never `statements:view`), site authorization always `PayrollEntry.siteId`. Totals split into
> always-exact entry-level counts (Released/Held/Pending — a deliberate 3-of-5-state narrowing,
> `NO_PAY_DUE`/`RECOVERY_DUE` remain filterable but aren't their own totals bucket) and a bounded
> 20,000-row group. No "Average OT Rate" (a naive average wouldn't be hours-weighted).
>
> **Built**: `shared/src/schemas/overtime-report.ts`,
> `backend/src/modules/reports/overtime-report.service.ts`, two routes on the existing
> `reportsRouter` (`GET /overtime-report`, `GET .../export`). `backend/tests/overtime-report.test.ts`
> (54 tests), `-performance.test.ts` (9 tests, real `EXPLAIN ANALYZE`, no `Seq Scan` on `PayrollEntry`
> in every filtered/sorted query shape — see the independent review bullet below for the one
> no-filter exception — no migration needed), `-boundary.test.ts` (6 tests, the exact
> 19,999/20,000/20,001 ceiling proven at real volume, from day one rather than a later hardening
> pass).
>
> **Verified**: `typecheck`/`lint`/`build` clean across `shared`/`backend`. A combined `--runInBand`
> run of this report's own files plus every sibling report (250 tests) passed 249/250 on a freshly
> re-provisioned local Postgres — the one failure (`employee-payroll-history.test.ts` › "automatic
> RECOVERY_DUE at release creates a distinct origin path," expects `201` receives `500`) sits
> entirely outside every file this checkpoint touches, confirmed pre-existing by reproducing it
> against clean, unmodified `main` on the same freshly-migrated database. Diagnosing this also
> independently reproduced this file's own already-documented `roles.test.ts` "second qualifying
> administrator" hazard (§1 below, ~line 3670) — not a new finding.
>
> **Independent hostile review (2026-08-07, same day, before commit)**: found and fixed two
> test-only defects in `overtime-report-performance.test.ts`. (1) A genuine, deterministic (5/5
> reproductions) stale-Postgres-statistics bad-plan bug: the seed's bulk `createMany` left the
> database without real statistics, and without them Postgres drove the unit-filtered list query
> from the wrong side of the join, turning a ~5ms query into a measured 3.2s–11.1s — fixed by an
> explicit `ANALYZE` immediately after seeding, matching the statistics a real production table
> already has by the time anyone queries it. (2) That same fix then correctly exposed the
> single-cycle no-filter query's "no `Seq Scan`" assertion as a legitimate, always-fast (~180ms–1.3s,
> both well under the 3s bound) cost-based coin-flip at this fixture's own 33% single-cycle
> selectivity, not a defect — relaxed to test the wall-clock bound that actually matters, not plan
> shape. No application/production code changed. `overtime-report.test.ts` (54) and
> `-boundary.test.ts` (6) were re-run unaffected; `-performance.test.ts` re-passed 9/9 across five
> consecutive full-suite runs after the fix. Full detail: `docs/architecture/workflows/reports.md`
> §18.8's own independent-review addendum.
>
> **No commit, push, or deployment occurred.** No frontend work started (Checkpoint 1B) — the
> Reports catalogue's existing placeholder entry is untouched.

> **Update, 2026-08-07 (later same day) — Phase 7 Reports, Deduction Report Checkpoint 1B
> (Frontend, Browser Print, and E2E) — IMPLEMENTED, awaiting review, NOT COMMITTED.** Built over the
> frozen Checkpoint 1A backend below — no backend, shared-contract, or database change. Full record:
> `docs/architecture/workflows/reports.md` §17.12 and `docs/PROJECT_PROGRESS.md`'s own "Phase 7
> Reports — Deduction Report, Checkpoint 1B" §1 entry — not duplicated here in full.
>
> **Gated on `reports:view`** (frozen decision 3), same as Payroll Summary/Project Site Payroll
> Report — never `statements:view`. Route pair (`/reports/deduction-report` +
> `/payroll-cycles/:cycleId/reports/deduction-report`), catalogue card now `available: true` with no
> `requiredPermission` override, no detail route (frozen decision 12).
>
> **Built**: `hooks/use-deduction-report.ts` (list query disabled until a Cycle exists, CSV/XLSX
> export with structured-413 handling); filters — the base set (Site, Unit, Row Status, Has
> Correction) plus the five approved deduction tri-states (Has EOBI, Has Advance Deduction, Has EID
> Advance Deduction, Has Fine, Has Correction Recovery); totals grouped into Payroll Deductions
> (collapses to a notice when `totalsComputed` is `false`) and Status (five status counts +
> Matching Entries always visible; Employees With Any Deduction individually dashed when
> unavailable); a 14-column table sorted server-side on the eight approved fields only (EOBI/Total
> Deductions/Correction Count render with no sort button); CSV/XLSX export; a dedicated
> `DeductionReportPrintOptionsDialog`/`deduction-report-print-fields.ts` (current-page-only,
> `deduction-report-print-fields:v1` localStorage key, 14 cards/14 columns, readability thresholds
> scaled from Employee Payroll History's own 13-column scale).
>
> **Verified**: 81 new frontend tests, all passing (79 across 4 new colocated Vitest files + 2 added
> to the existing catalogue test); full frontend suite **549/549**. `typecheck`/`lint`/`build` clean
> across `shared`/`backend`/`frontend`, `typecheck:e2e` clean, `git diff --check` clean.
> `tests/e2e/specs/21-deduction-report.spec.ts` — **9/9 passing** standalone, **18/18 passing**
> combined with `17-reports.spec.ts` (real backend, real Chromium, no route mocking) — covering
> navigation/totals/sorting/pagination, Site scoping with a genuine historical transfer, a dedicated
> test proving all five deduction tri-states narrow correctly individually and in AND-composition,
> all five row statuses, a real approved Correction leaving Total Deductions unchanged, CSV/XLSX
> export with a sensitive-field sweep, Print Options defaults/readability, a responsive-layout check
> at 1024px, and permission enforcement.
>
> **Deduction Report is now functionally complete pending review** (Checkpoints 0, 1A, 1B). No
> commit/push/deploy occurred.
>
> **This entry supersedes the Checkpoint 0/1A-only entry immediately below** (backend foundation
> only, no frontend) **for current-status purposes — that entry's own text is left exactly as
> originally written**, per this project's "don't rewrite history" documentation convention: a
> superseding update is always a new, later entry, never an edit to an earlier one's own words.
>
> **Addendum, same day — M1–M5 final targeted review/remediation pass, still NOT COMMITTED.** Full
> record: `docs/architecture/workflows/reports.md` §17.13. One genuine defect found and fixed: the
> print context header was missing the Has Correction and all five deduction tri-state filter
> summaries (now included). Filter/navigation-state architecture verified against Project Site
> Payroll Report's own precedent (no persistence beyond the URL-encoded Cycle — confirmed intended,
> no new global store). Export request parity, print content, and accessibility all covered with new
> regression tests; no other production code changed. Also corrected this same pass's own earlier
> mistake of rewriting the entry below's historical wording (see the note above). Updated, verified
> totals: **108 Deduction-Report-specific frontend tests** (106 across the 4 dedicated files + 2
> catalogue tests, up from 81), full suite **576/576**; `tests/e2e/specs/21-deduction-report.spec.ts`
> **10/10** standalone, **19/19** combined with `17-reports.spec.ts`. `typecheck`/`lint`/`build`/
> `typecheck:e2e`/`git diff --check` all clean. Deduction Report remains functionally complete
> pending review — still not committed, pushed, or deployed.

> **Update, 2026-08-07 (latest) — Phase 7 Reports, Deduction Report Checkpoint 0 (Architecture,
> approved) and Checkpoint 1A (Backend Foundation) — IMPLEMENTED, awaiting review, NOT COMMITTED.**
> Backend/shared-contracts/tests only — no frontend page exists yet for this report. Full record:
> `docs/architecture/workflows/reports.md` §17 and `docs/PROJECT_PROGRESS.md`'s own "Phase 7
> Reports — Deduction Report" §1 entry (all 16 frozen decisions; the third-consumer row-status
> extraction; shared schema; backend service; table columns; totals; exact test counts; performance
> evidence; known limitations) — not duplicated here.
>
> **Business definition (Checkpoint 0)**: a single-cycle, deduction-type-centric operational report
> — "which employees had which deduction(s) this cycle, how much, and what does each type total to
> company-wide?" — one row = one `PayrollEntry`, exactly one required Payroll Cycle, never a
> cross-cycle history, an Advance Recovery report, or a second Project Site Payroll Report.
>
> **First step this checkpoint**: extracted the generic 5-state `PayrollEntry` row-status derivation
> (`deriveEmployeePayrollHistoryRowStatus`/`employeePayrollHistoryRowStatusWhereClause`) out of its
> Employee-Payroll-History-specific home into a neutral `backend/src/modules/reports/
> payroll-entry-row-status.ts` (`derivePayrollEntryRowStatus`/`payrollEntryRowStatusWhereClause`) —
> Deduction Report is the third consumer (after Employee Payroll History and Project Site Payroll
> Report), this project's own documented extraction threshold. Behavior-preserving rename/move only
> — verified by the renamed test file passing unchanged plus both existing consumers' full suites
> passing unweakened.
>
> **Built**: `GET /api/v1/reports/deduction-report` and `.../export`, gated by
> `PERMISSIONS.REPORTS_VIEW`; `shared/src/schemas/deduction-report.ts`; a backend service
> structurally mirroring Project Site Payroll Report's own, narrowed to five deduction types
> (effective EOBI, Advance, EID Advance, Fine, Correction Balance Recovery — Correction Balance
> Payable explicitly excluded as an earning) with five independent tri-state presence filters
> (`hasEobi`/`hasAdvanceDeduction`/`hasEidAdvanceDeduction`/`hasFine`/`hasCorrectionRecovery`,
> `AND`-composed); eight fully database-sorted fields with **zero** bounded-in-memory-sort
> exceptions anywhere in this report (unlike every sibling report's own `netSalary` carve-out) —
> effective EOBI/Total Deductions/Net Salary/Gross Pay/cycle are deliberately excluded from V1
> sorting instead; the same *unified* bounded totals strategy (no split SQL-aggregate shortcut) as
> its siblings, reusing the identical 20,000-row ceiling convention; CSV/XLSX export of the complete
> filtered dataset. No detail endpoint, no per-Unit deduction total of any kind, no schema or
> migration change.
>
> **Verified**: 60 new backend tests (`deduction-report.test.ts`) plus 12 new committed performance
> tests (`deduction-report-performance.test.ts`, seeding 30,000 real `PayrollEntry` rows with
> deliberately varied deduction values/EOBI applicability and running real `EXPLAIN (ANALYZE,
> BUFFERS)` against every deduction-filter/sort query shape — no `Seq Scan` on `PayrollEntry` in any
> measured shape), all 72 passing; `typecheck`/`lint`/`build` clean across `shared`/`backend`. A
> targeted 195-test re-run across every touched/depended-on file (the extraction's own tests, both
> migrated consumers' full suites, and this report's own two new files) passes unweakened with
> `--runInBand`. One honest, disclosed performance finding: the cycle+site-filtered query used a
> `Bitmap Index Scan` via the composite index rather than the plain `Index Scan` Project Site
> Payroll Report's own identically-shaped query saw — a different, equally valid, cost-based
> planner choice at this suite's own data distribution, not a regression.
>
> **Repository-state note, this session**: this checkpoint restarted from a freshly-verified,
> fully-synchronized `main` (local `main` == `origin/main` == GitHub `refs/heads/main`) after an
> earlier same-day Checkpoint 0 pass was found to have been performed against a stale local `main`
> ref — a read-only, git-only reconciliation (fetch + fast-forward), not a code change, resolved it
> before any Deduction Report work began.
>
> **Update, 2026-08-07 (same day) — targeted review/hardening pass, tests/documentation only, still
> NOT COMMITTED.** Full record: `docs/architecture/workflows/reports.md` §17.11. Strengthened
> `deduction-report.test.ts`'s CSV/XLSX export-parity and sensitive-field-sweep coverage (real
> header-keyed reconstruction against the list endpoint, not positional spot checks; now 63 tests);
> added `deduction-report-boundary.test.ts` (6 tests, a real seeded-at-volume proof of the
> 19,999/20,000/20,001 export/totals ceiling) and `payroll-entry-row-status-regression.test.ts` (2
> tests, proving Employee Payroll History/Project Site Payroll Report/Deduction Report all derive
> the identical `rowStatus` for the same rows). Full backend suite run once to completion —
> **1,495/1,496 passing** (78 suites); the one failure (an `employee-payroll-history.test.ts`
> query-count assertion, expected 8 observed 10) sits outside every file this work touched and
> passed clean on an isolated re-run of that file — a pre-existing, first-query-connection-overhead
> pattern this project has documented before, not a regression. No production code changed.

> **Update, 2026-08-06 (superseded by the entry above for status purposes) — Phase 7 Reports, Project Site Payroll Report Checkpoint 0
> (Architecture, read-only, approved) and Checkpoint 1A (Backend Foundation) — IMPLEMENTED,
> awaiting review, NOT COMMITTED.** Backend/shared-contracts/tests only — no frontend page exists
> yet for this report. Full record: `docs/architecture/workflows/reports.md` §16 and
> `docs/PROJECT_PROGRESS.md`'s own "Phase 7 Reports — Project Site Payroll Report" §1 entries
> (Checkpoint 0 findings and all seven frozen decisions; Checkpoint 1A's shared schema, backend
> service/routes, table columns, totals, exact test counts, performance evidence, known
> limitations) — not duplicated here.
>
> **Business definition (Checkpoint 0)**: "Which employees were paid at the selected Project
> Site(s) during one payroll cycle?" — the row-level drill-down beneath Payroll Summary's own
> site-aggregate rows, one row = one `PayrollEntry`, always exactly one Payroll Cycle (never a
> range or a historical browser — that stays Employee Payroll History's own role).
>
> **Built**: `GET /api/v1/reports/project-site-payroll` and `.../export`, gated by
> `PERMISSIONS.REPORTS_VIEW` (the same permission Payroll Summary already uses — deliberately not
> `statements:view`, since this report's disclosure surface matches Payroll Summary's own
> site-scoped operational audience, not Employee Payroll History's narrower cross-cycle-history
> one); `shared/src/schemas/project-site-payroll-report.ts`; a backend service structurally
> mirroring Employee Payroll History's own (row select/`calcNet` adapter/ordering/bounded
> `netSalary` sort) but narrowed to the approved filter set (Payroll Cycle required, Site
> multi-select, Unit, Row Status, Has Correction — no employee search, designation, date range,
> roster status, or outstanding-balance filter); totals reusing Payroll Summary's own field/bucket
> model with Employee Payroll History's own guarded-computation ceiling; CSV/XLSX export of the
> complete filtered dataset. No detail endpoint, no per-Unit financial total of any kind (frozen
> decisions 4 and 5 — there is no mathematically correct way to allocate an entry's aggregate
> deductions across multiple work lines with the existing schema, so none was invented). No schema
> or migration change.
>
> **Verified**: 37 new backend tests (`project-site-payroll-report.test.ts`) plus 5 new committed
> performance tests (`project-site-payroll-report-performance.test.ts`, seeding 30,000 real
> `PayrollEntry` rows and running real `EXPLAIN (ANALYZE, BUFFERS)` against the report's actual
> query shapes — no `Seq Scan` on `PayrollEntry` in any measured shape), all 42 passing;
> `typecheck`/`lint` clean across `shared`/`backend`. One honest, disclosed performance finding:
> Postgres's planner chose the single-column `PayrollEntry_cycleId_idx` over either
> `[cycleId,siteId]` composite index for the one-cycle-plus-one-site query shape at this data
> volume — still fast (~12ms), still not a sequential scan, recorded as measured evidence rather
> than the composite-index assumption going in.
>
> **Environment note, this session**: a long-lived local `embedded-postgres` instance degraded
> partway through this session's own verification work (every login in every backend test file,
> including entirely unmodified pre-existing ones, began failing with `INVALID_CREDENTIALS` even
> though direct `argon2`/Prisma reproduction outside Jest/Express worked correctly) — re-provisioning
> a fresh instance from a clean data directory resolved it completely, with no code change of any
> kind. Confirmed unrelated to this checkpoint's own changes by reproducing the same failure
> pattern with this checkpoint's two new test files entirely excluded from the run.
>
> **Later clarification (independent Checkpoint 1A review, same day) — supersedes the uncertainty
> above with stronger evidence.** The review did not accept "re-provisioning fixed it" as
> sufficient and instead isolated the variable properly via `git worktree`: (1) the pure
> pre-checkpoint baseline (commit `d1116aa`, zero changes from this checkpoint) ran the full
> 1,371-test suite cleanly (1,345 passing; the 26 failures were the same pre-existing
> Puppeteer/Chrome-unavailable-in-that-isolated-worktree gaps, unrelated to anything); (2) this
> checkpoint's *production* changes alone (`reports.routes.ts`/`shared/index.ts`/the two new
> source files), applied to that same clean worktree with **no test files present at all**,
> produced the statistically indistinguishable result (1,344/1,371, the same known gaps plus one
> unrelated pre-existing flake) — proving the production code itself is not the cause; (3) a
> subsequent full-suite run in the original working directory, with everything present, passed
> **1,412/1,412, zero failures**. The earlier widespread login failures were transient
> session-level resource contention (most likely from running several concurrent
> `embedded-postgres` instances/worktrees/Jest processes across a long, active session), not a
> deterministic property of this code, this database, or this directory — and not a regression
> from this checkpoint. See the Checkpoint 1A independent review's own §14 for the full evidence
> table.
>
> **Not started this checkpoint**: any frontend work for this report (deferred to a future
> Checkpoint 1B), a detail page/endpoint, per-Unit financial totals, any other Phase
> 8A-catalogued report, and Dashboard.

> **Update, 2026-08-05 (superseded by the entry above for status purposes) — Phase 7 Reports, Employee Payroll History
> Checkpoint 1B (Frontend, Print, E2E, and Phase Close-Out) — IMPLEMENTED, awaiting review, NOT
> COMMITTED.** Frontend-only, over the frozen Checkpoint 1A backend — no backend/shared-contract/
> database change. Gated on `statements:view` throughout (routes, catalogue card), matching the
> already-approved decision. Full record: `docs/architecture/workflows/reports.md` §15.10 and
> `docs/PROJECT_PROGRESS.md`'s own "Phase 7 Reports — Employee Payroll History, Checkpoint 1B" entry
> (routes/permission, data hooks, filters, table/sorting/pagination, totals-unavailable handling,
> detail-page section-by-section breakdown, export/print behavior, exact test counts, Playwright
> results, performance observations, known limitations) — not duplicated here.
>
> **Built**: `/reports/employee-payroll-history` and `/reports/employee-payroll-history/:entryId`
> routes; `use-employee-payroll-history.ts` (imports DTOs directly from `@payroll/shared` rather
> than hand-copying — they're already the single shared source of truth); a dedicated historical
> employee lookup (a second fork of `StatementEmployeeLookup`'s own shape, pointed at
> `GET /employee-payroll-history/employees`); the approved filter set only (Employee, Site
> multi-select, Unit disabled unless exactly one Site is selected, Cycle From/To, Row Status, the
> two tri-state All/Yes/No boolean filters — a new, documented `docs/design-system.md` §2.4
> convention — Current Roster Status); server-paginated/server-sorted table with per-status badge
> tones, a totals-unavailable notice when the backend's own `totalsComputed` is `false`; a
> non-modal detail page (9 top-level sections, with Settlements and Correction Payments presented
> inline within the relevant correction/balance-adjustment sections, modeled on
> `balance-adjustment-detail-page.tsx`) that clearly separates the original, immutable payroll
> result from later Corrections/Balance Adjustments/Materializations/Settlements, with CNIC shown
> and no banking field ever present; CSV/XLSX export
> (the first frontend code in this app to handle the structured `413 EXPORT_ROW_LIMIT_EXCEEDED`
> response, via a new `ExportRowLimitExceededError`); a report-specific browser Print (current page
> only, a fresh field vocabulary, never Payroll Summary's own, `localStorage`-only preference, no
> backend PDF).
>
> **Verified**: 62 new frontend tests (5 new colocated files plus a new `reports-page.test.tsx`,
> 3 tests), full frontend suite 389/389; `typecheck`/`lint`/`build` clean across
> `shared`/`backend`/`frontend`, `typecheck:e2e` clean; new Playwright spec
> `19-employee-payroll-history-frontend.spec.ts` **5/5 passing** (Master User multi-cycle/
> correction/materialization/sort/paginate flow, CSV/XLSX export content, Print Options, a genuine
> Site-A→Site-B transfer/concealment scenario, permission enforcement), run both in isolation and
> alongside `17-reports.spec.ts` (**9/9 passing, unweakened**).
>
> **Not started this checkpoint** (unchanged from the architecture review): saved filter presets,
> backend PDF, every other Phase 8A-catalogued report, and Dashboard. **Employee Payroll History
> (Checkpoints 0, 1A, 1B) is now fully complete.**

> **Update, 2026-08-05 (superseded by the entry above for status purposes) — Post-Checkpoint-1A UAT
> Stabilization: Sticky Header Containment, EOBI Totals/Bulk Apply, Project Site Form Reset —
> IMPLEMENTED, awaiting review, NOT COMMITTED.** Three independently-reported UAT defects, fixed as one scoped checkpoint
> per explicit instruction — no Employee Payroll History Checkpoint 1B, Dashboard, or other report
> work was started. Full record: `docs/PROJECT_PROGRESS.md`'s own "Post-Checkpoint-1A UAT
> Stabilization" entry (root causes, exact fixes, every file changed) and this session's own
> completion report (full test results, Playwright evidence, performance measurement).
>
> **Sticky header** — root-caused via direct pixel sampling of a real headless-Chromium screenshot
> (not guessed): every virtualized Payroll Entry row had a fully transparent background, relying on
> the ancestor Card's own incidental white surface rather than painting its own opaque one. Fixed
> with an explicit `bg-surface-2` on the row (`payroll-entry-row.tsx`) — the one place in the app
> with a genuine sticky-header + GPU-transformed-virtualized-content combination. A direct
> repository-wide audit confirmed no other page has any sticky element at all, so there was no
> second implementation to patch.
>
> **EOBI totals** — the footer summed every row's *raw* `eobiAmount` regardless of
> `eobiApplicable`; `calcNet` itself was never wrong (already-tested), the bug was two frontend
> aggregation paths bypassing it (`calc-input.ts`'s `computeServerSnapshot`, and
> `payroll-entry-page.tsx`'s own hand-rolled print-totals calculation). Both now route through
> `eobiApplicable ? eobiAmount : 0`/`calcNet`'s `totalDeduction`. A missing `eobiApplicable`
> dependency in the row's live-edit effect (so toggling alone never re-reported to the totals
> store) was fixed alongside it.
>
> **Bulk EOBI Amount** — a new `field: 'eobiAmount'` variant on the existing
> `bulkUpdatePayrollEntriesSchema`/`bulkUpdatePayrollEntries` bulk-update code path (same
> `updateMany` bulk statement, same audit/site-scope/editability guarantees as the three existing
> bulk fields) plus a fourth `CopyToAllToolbar` field, reusing the exact same UI pattern. Applies
> to every matched entry regardless of `eobiApplicable`; never touches `eobiApplicable` itself or
> `Employee.defaultEobiApplicable` (verified directly in tests). 10,000-row timing case added
> alongside the existing Copy-to-All perf test.
>
> **Project Site form reset** — root-caused to the create-mode modal being a single,
> unconditionally-mounted instance for the page's whole life, so its `useState` initializers only
> ever ran once; the edit-mode instance was already conditionally mounted and never had this
> problem. Fixed by mounting create fresh every open, matching every other modal in that file,
> plus a new "Add another" checkbox with an explicit `resetForm()` for the one case a remount can't
> cover (staying open, same instance). Every reported scenario re-verified against the real running
> application.
>
> **Verification**: backend full suite **1369/1369**; frontend full suite **325/325** (312
> pre-existing + 13 new); typecheck/lint/build clean across `shared`/`backend`/`frontend`;
> `git diff --check` clean; full Playwright suite result in this session's own completion report.
> **Do not begin Employee Payroll History Checkpoint 1B, Dashboard, or any other report until this
> checkpoint is reviewed and landed.**

> **Update, 2026-08-05 (superseded by the entry above for status purposes) — Phase 7 Reports, Employee Payroll History Checkpoint 1A
> (Backend Foundation) — IMPLEMENTED, awaiting review, NOT COMMITTED.** Backend service/routes/
> shared Zod contracts/database index/tests only, per explicit checkpoint scope — no frontend
> page, no drill-down UI, no browser Print, no backend PDF, no saved-filter presets, none of which
> were started. Preceded by a read-only Checkpoint 0 architecture review (same day) that derived
> the report's exact contract from the real schema/service code rather than a generic template,
> and flagged five genuine decisions the user then explicitly approved before this implementation
> began: permission `statements:view` (not `reports:view`), a 20,000-row export ceiling, shared
> Zod contracts (a first for this module), the entry-oriented detail route shape, and the bulk-
> export sensitive-field exclusion list. Full design record: `docs/architecture/workflows/
> reports.md §15`. Full implementation/test/verification record: `docs/PROJECT_PROGRESS.md`'s new
> "Phase 7 Reports — Employee Payroll History, Checkpoint 1A" entry. **A real formatting bug was
> found and fixed during this checkpoint's own test-writing** (several detail-endpoint monetary
> fields used a bare `Decimal.toString()` instead of `.toFixed(2)`, silently dropping trailing
> zeros — e.g. `"2000.00"` rendering as `"2000"` — confirmed via a direct Postgres round-trip, then
> fixed at every affected call site before this reached review, not after). New tests: 85/85
> passing across `employee-payroll-history.test.ts` (63), `employee-payroll-history-status.test.ts`
> (18), and `excel-utils.test.ts` (4) — see this session's own completion report for the full
> backend-suite/typecheck/lint/build verification result. Two extractions, both behavior-
> preserving and covered by the pre-existing test suites passing unweakened: the historical-
> payroll employee lookup (`statements.service.ts`'s own `searchStatementEmployees` is now a thin
> wrapper) and the Excel column-width helper (now shared by Reports and Statements; Bank Sheets'
> own copy deliberately left untouched, per the approved migration list).

> **Update, 2026-08-05 (superseded by the entry above for status purposes) — PR #6 MERGED into `main`; Render deployment triggered — supersedes
> the Phase 7H entry immediately below, which is otherwise unchanged as written.** The user confirmed
> PR #6 was manually merged into `main` and that Render's already-configured automatic deployment was
> triggered by that merge. This session verified directly (git + `gh`, not assumed): `gh pr view 6` →
> `state: MERGED`, `mergedAt: 2026-08-05T02:22:07Z`, squash-merge commit
> `e066f49f4c7496ac1e189bed61ab63ef2daac704` now on `origin/main`. `git diff e066f49 a09e4aa` (the PR's
> own feature-branch tip) is empty — the squash carried the branch's tree over byte-for-byte, so
> Phase 7H's PDF worker (`backend/src/lib/pdf/worker/*`) is confirmed present on `origin/main`, not
> merely on the now-deleted feature branch. Local `main` was one fast-forward commit behind
> `origin/main` (no divergence, nothing uncommitted anywhere in the repository).
> **CI on the merge itself** (GitHub Actions run `30969152578`, triggered by the push to `main`)
> reported `build-and-check: failure` — read directly from the log, this is `backup-packages.test.ts`'s
> pre-existing, already-documented KI-5 one-second-timestamp flake (`docs/release/KNOWN_ISSUES_v1.0.md`),
> not the Phase 7H PDF/Jest-VM-teardown issue: zero `"Test environment has been torn down"`
> occurrences anywhere in the run, 1280/1281 other tests passed. Phase 7H's fix held on this real,
> independent post-merge run. **Render deployment**: user-confirmed as triggered; this session could
> not independently confirm deployment *completion* — no Render dashboard/API access was available,
> and a health-check probe of the documented backend URL
> (`https://payroll-backend.onrender.com/health`) returned `404` with Render's own
> `x-render-routing: no-server` header (no live service currently answers that exact hostname). This
> is inconclusive rather than a contradiction of the user's confirmation, and is recorded honestly as
> such — see this file's Addendum 29 for the full evidence and the related stale-branch investigation
> (PR #5 / `payroll-entry/durability-and-release-safety`, also fully resolved, safe to delete pending
> approval) and `docs/PROJECT_PROGRESS.md`'s Phase 7H closure note.

> **Update, 2026-08-04 (superseded by the entry above) — Phase 7H: Permanent PDF Test Infrastructure Stabilisation —
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

## 29. Addendum, 2026-08-05 — Repository Reconciliation: PR #6 Merge Confirmation, Deployment Evidence, and Stale-Branch Investigation

Documentation/investigation-only checkpoint, per explicit scope — no application code changed, no
Employee Payroll History/Report/Dashboard/UI work performed.

**PR #6 is MERGED.** `gh pr view 6`: `state: MERGED`, `mergedAt: 2026-08-05T02:22:07Z`, squash-merge
commit `e066f49f4c7496ac1e189bed61ab63ef2daac704` on `origin/main` (parent: `f7d08dc`, i.e. directly
on top of PR #5's own squash commit — one parent, confirming this was a squash, not a true merge
commit). `git diff e066f49 a09e4aa` (the feature branch's own final local tip) is empty — proves the
squash is byte-identical to the branch, so nothing was lost or altered. `git ls-tree -r origin/main`
confirms `backend/src/lib/pdf/worker/{pdf-worker.entry,pdf-worker-client,protocol}.ts` are present on
`origin/main`. Local `main` (`f7d08dc`) was exactly one fast-forward behind `origin/main`
(`e066f49`) — `git log main..origin/main` shows only that one commit, `git log origin/main..main` is
empty, and `git status` was clean throughout this session on every branch touched.

**CI on the merge commit**: GitHub Actions run `30969152578` (push trigger, `main`) →
`build-and-check: failure`. `gh run view --log-failed` shows the single failing test directly:
`backup-packages.test.ts › ... byte-identical to the live Cash Receiving export (generated-at
excluded)`, failing on a one-second timestamp mismatch (`2:25:19 AM` vs. `2:25:20 AM`) — exactly
KI-5's documented profile (`docs/release/KNOWN_ISSUES_v1.0.md`), already on record as
non-deterministic and non-blocking. `Test Suites: 1 failed, 68 passed, 69 total`;
`Tests: 1 failed, 1280 passed, 1281 total`. Zero `"Test environment has been torn down"`
occurrences anywhere in the log — Phase 7H's fix is confirmed to hold on a real, independent,
post-merge CI run, not only in the pre-merge branch testing already recorded under Phase 7H.

**Render deployment**: user-confirmed as triggered by this merge (Render's automatic-deploy is
already configured per `render.yaml`, consistent with the confirmation). This session had no Render
dashboard or API access, so deployment *completion* could not be independently re-derived. A direct
probe was attempted anyway: `curl -i https://payroll-backend.onrender.com/health` (the backend URL
`docs/release/CONFIGURATION_REFERENCE.md` documents) returned `HTTP/2 404` with
`x-render-routing: no-server` — a Render-specific header meaning no active service is currently bound
to that exact hostname. This is **inconclusive, not disconfirming**: it may reflect a different real
service hostname, a paused/sleeping instance, or simply a probe this sandbox cannot complete
correctly — none of which this session could distinguish without dashboard access. Recorded per the
required distinction: **merge — confirmed directly**; **automatic deployment trigger — user-confirmed,
plausible, not independently re-derived**; **deployment completion / production smoke verification —
NOT confirmed this session**.

**Stale-branch investigation — `payroll-entry/durability-and-release-safety` (PR #5)**: `gh pr view 5`
confirms `state: MERGED`, `mergedAt: 2026-08-03T17:17:12Z`, squash commit `f7d08dc` on `main`. GitHub's
"2 ahead / 2 behind" reading of this branch reflects the branch's own two raw commits (`4d57993`,
`19e4e78`) being unreachable from `main` *by hash* — the expected, and here confirmed misleading,
signature of any squash merge, exactly as this checkpoint's own instructions warned against relying
on the ahead/behind count alone. `git cherry -v origin/main origin/payroll-entry/durability-and-release-safety`
shows both commits marked `+` (no patch-id match in `main`) for that same reason. The check that
actually settles it: `git diff f7d08dc 19e4e78` is empty — the tree at `main`'s own PR #5 squash
commit is byte-identical to the branch's tip. **Classification: A — fully incorporated.** No unique,
unmerged, or abandoned work exists on this branch; it is safe to delete (remote and local) once
explicitly approved.

**Repository state at the close of this checkpoint**: `main` (needs only a routine fast-forward to
`origin/main`, zero conflict risk, not yet performed pending approval), `feat/phase-7f-payroll-workflow-integrity`
(fully merged via squash; GitHub already auto-deleted its own remote copy on merge — a local copy and
its now-stale tracking branch remain, safe to delete once approved), and
`payroll-entry/durability-and-release-safety` (Classification A above, safe to delete once approved).
No branch anywhere in the repository holds required, unmerged work.

**No commit, push, branch deletion, or GitHub modification occurred this session** — stopped
deliberately for review and explicit authorization, per this checkpoint's own instruction. No
Employee Payroll History, other Report, Dashboard, or UI work was started.

## 30. Addendum, 2026-08-05 (later same day) — Phase 7 Reports, Employee Payroll History: Checkpoint 0 (Architecture Review) and Checkpoint 1A (Backend Foundation) — IMPLEMENTED, NOT COMMITTED

Full detail in `docs/PROJECT_PROGRESS.md`'s new "Phase 7 Reports — Employee Payroll History"
entries and `docs/architecture/workflows/reports.md §15` — this is the handoff summary.

**Checkpoint 0 (read-only architecture review)**: derived the report's exact contract — grain,
columns and their canonical sources, corrections/balance-adjustment representation, historical
RBAC, filters, drill-down design, export/print design, pagination/performance design, API surface
— directly from the real schema and service code, deliberately not accepting the generic report
description in the original request at face value (it assumed a "Leave Deduction" column that
doesn't exist in this schema's `calcNet` formula — leave is an earning, per `shared/src/lib/
calc-net.ts` — among other corrections). Flagged five genuine decisions for approval rather than
silently resolving them; the user approved all five before implementation began.

**Checkpoint 1A (backend foundation)**, built against those five approved decisions plus two more
(report grain, financial-meaning rule) already settled by the architecture itself: new shared Zod
contracts (`shared/src/schemas/employee-payroll-history.ts`), a new backend service and status-
derivation module (`backend/src/modules/reports/employee-payroll-history{.service,-status}.ts`),
four new routes on the existing Reports router, one additive database migration
(`[siteId, cycleId]` index on `PayrollEntry`), and two behavior-preserving extractions (historical
employee lookup, shared Excel column-width helper) — full detail in `PROJECT_PROGRESS.md`.

**Worth a future session's attention, not fixed here**: `docs/architecture/workflows/reports.md`
§15.9 discloses that this report's totals block is recomputed on every list call (not only
exports), which measured roughly 500–700ms at 9,000 matching rows in this session's own seeded
30,000-row performance test — extrapolating to the full 20,000-row ceiling, upwards of a second on
every page navigation of a large, loosely-filtered result set. Not a defect (the design is
correct and disclosed), but a real latency characteristic a future checkpoint may want to address
by making totals a separate, independently-fetched call rather than bundling them into every list
response — an API-shape change, so deliberately not made silently in this one.

**No frontend work of any kind was started** — the list/detail pages, drill-down UI, browser
Print, and saved-filter presets all remain exactly as Checkpoint 0's own review scoped them:
deferred to Checkpoint 1B or a later frontend refinement, never begun in this session.

**No commit, push, or deployment occurred this session** — stopped deliberately for review, per
explicit instruction. No other report, Dashboard work, or unrelated module was started or modified.

## 31. Addendum, 2026-08-05 (later same day) — Post-Checkpoint-1A UAT Stabilization: Sticky Header Containment, EOBI Totals/Bulk Apply, Project Site Form Reset — IMPLEMENTED, NOT COMMITTED

Full detail in `docs/PROJECT_PROGRESS.md`'s own "Post-Checkpoint-1A UAT Stabilization" entry — this
is the handoff summary. Three independently-reported UAT defects, fixed as one scoped checkpoint;
no Employee Payroll History Checkpoint 1B, Dashboard, or other report work was started.

**Environment note for the next session**: this session's own local Postgres was provisioned fresh
in the scratchpad on a non-default port (5433, `embedded-postgres`) specifically because a
different, unrelated session's own stale Postgres was already occupying the project's usual 5432 —
left untouched rather than killed, per this session's own non-destructive-by-default posture. A
*second*, separate database (`payroll_test`, same port-5433 instance) was provisioned purely for
the backend Jest suite, after discovering the first database (manually seeded with UI-verification
fixtures, including a real payroll cycle) broke the bootstrap-only `POST /api/v1/payroll-cycles`
tests — worth remembering: never point `DATABASE_URL` at a manually-exercised dev database when
running the committed test suite, even locally.

**Part A (sticky header) — investigation method, since the eventual root cause required real
evidence, not inference.** A live Chromium browser (Playwright, no `claude-in-chrome` available
this session — user declined) was driven against a freshly seeded 80-employee Payroll Entry grid.
Two hypotheses were tested and **disproven** before the real one was found: (1) the app shell
somehow lets the *document* scroll — disproven directly (`window.scrollY` stayed 0,
`document.documentElement.scrollHeight === clientHeight` after every scroll attempt); (2) the
grid's own sticky header fails to occlude a scrolled-past row — the initial screenshot evidence
*looked* like this (a "Test Employee 8" fragment visible right at the header's lower edge), but
pixel-level sampling (`PIL`, sampling raw RGB values down a vertical line through the suspect
region) proved this was simply the header's *own* "Employee" column label text, not foreign
content — a false positive from not accounting for the header having real text content in the
same screen column being sampled. The real defect (every virtualized row fully transparent,
`rgba(0,0,0,0)`, confirmed via `getComputedStyle`) was found only after this elimination, by
directly inspecting the row's own computed background rather than continuing to reason about
z-index/stacking (which was already correct). A `will-change: transform` speculative fix was tried
and measured to have **zero effect** (confirming the mechanism was never a compositing-layer-order
issue) before landing on the actual fix (an explicit opaque background) — recorded here so a future
session doesn't re-try the same dead end. **This paragraph's own record is what an independent
review (2026-08-05) used to correct overstated "confirmed root cause" wording in
`docs/design-system.md` and `docs/PROJECT_PROGRESS.md`** — this account was already accurate and
needed no change itself; only the two more headline-style summaries elsewhere had drifted stronger
than what's recorded here.

**Part D (Project Sites) — a genuinely new "Add another" UI was added, not merely a bug fix.** The
UAT description referenced an "Add another" option that did not exist anywhere in the shipped code
— the create modal only ever had Cancel/Create. This checkpoint added a `Checkbox` ("Add another
after this one") to `SiteFormModal`'s create mode only, per the task's explicit requirement, rather
than treating the reported defect as solely "close/reopen retains values" (which was also true and
also fixed, via the same conditional-mount change).

**Testing note**: `SiteFormModal` is now exported from `project-sites-page.tsx` (previously
module-private) specifically so its reset lifecycle could be unit-tested directly, independent of
the page's own `DropdownMenu`-driven Edit action — Radix's `DropdownMenu` does not open under
`fireEvent.click` in jsdom (confirmed via a minimal isolated repro; `aria-expanded`/`data-state`
never changed even with `hasPointerCapture`/pointer-event stubs applied) with no
`@testing-library/user-event` available in this project to work around it. The full page-level
flow (including the dropdown) is covered instead by a real-browser Playwright spec, which has no
such limitation.

**Verification**: backend full suite **1369/1369** (fresh `payroll_test` database). Frontend full
suite **325/325** (312 pre-existing + 13 new — `calc-input.test.ts` new file, 3 tests;
`payroll-entry-grid.test.tsx` two new describe blocks, 5 tests; `project-sites-page.test.tsx` new
file, 5 tests). `typecheck`/`lint`/`build` clean across `shared`/`backend`/`frontend` (only
pre-existing, unrelated lint warnings — KI-4 and two backend script files, both untouched this
session). `git diff --check` clean.

**Playwright**: the two directly-relevant specs (`06-ui-regression.spec.ts` extended, new
`18-post-checkpoint-1a-uat-stabilization.spec.ts`) both passed cleanly in an isolated run before
the full-suite run. The full suite (82 tests, single worker, `workers: 1`) took an unusually long
3.4 hours and reported 5 failures — investigated, not waved away: this session's *own* lingering
manual dev-server processes (backend/frontend, left running from earlier live-browser verification)
were still competing for host resources for the whole run. After killing them, the 5 failing tests
were re-run: **3 passed cleanly in isolation** (`03-navigation`'s full-route sweep,
`08-role-administration`'s role-rename test, `12-corrections-completion`'s released-row-actions
test) — confirmed environmental, not a regression. The remaining 2 (`07-corrections.spec.ts`
Scenario 4 — a Balance Adjustment settlement status assertion; `15-statements.spec.ts`'s Export PDF
download) failed consistently even after freeing resources and re-running with correct
prerequisite state, but both are in modules this checkpoint's diff never touches at all (`git diff
--stat` confirms zero files under `corrections/`, `balance-adjustments/`, or `statements/`,
frontend or backend) — consistent with this project's own already-documented pattern of
Corrections-domain timing flakiness (SESSION_HANDOFF's Phase 7F entry) and Puppeteer/PDF resource
sensitivity (KI-10). Reported honestly rather than re-run silently until green: these 2 are
pre-existing, unrelated to this checkpoint's changes, not confirmed fixed by this session.

**No commit, push, or deployment occurred this session** — stopped deliberately for review, per
explicit instruction. No Employee Payroll History Checkpoint 1B, Dashboard, or other report/
unrelated module was started or modified.

## 32. Addendum, 2026-08-05 (later same day) — Independent-Review Remediation (M1–M4) — IMPLEMENTED, NOT COMMITTED

A separate session ran a rigorous, independent, read-only review of Addendum 31's checkpoint —
re-deriving every claim from the real diff and live application behavior — and returned **APPROVE
WITH NON-BLOCKING NOTES** (0 Blockers, 0 High, 5 Medium, 2 Low). This addendum records the
follow-up remediation pass, explicitly scoped to **M1–M4 only** (M5 — Corrections Scenario 4's own
pre-existing, unrelated reproducibility — deliberately left open and untouched). Full design record:
`docs/PROJECT_PROGRESS.md`'s own "Post-Checkpoint-1A UAT Stabilization — Independent Review
Remediation" entry.

**M1 (docs)**: `docs/design-system.md` and `docs/PROJECT_PROGRESS.md` both corrected — neither now
claims a *confirmed* causal link between the row-opacity fix and the user's own specific reported
screenshot; both now state plainly that the robustness gap is confirmed, the reported symptom itself
was never conclusively reproduced in the review environment, and opaque rows are correct by
construction regardless. This file's own §31 investigation-method paragraph needed no correction
(it was already this precise) — a cross-reference sentence was added there instead, pointing at it
as the source record the other two files' headline wording was corrected against.

**M2 (audit previous-value summary)**: implemented generically for all four bulk fields, not only
`eobiAmount` — `payroll-entry.service.ts`'s `bulkUpdatePayrollEntries` now records
`previousValues: { kind: 'single', value } | { kind: 'mixed', distinctCount, minimum, maximum }` in
the same `payroll_entry.bulk_updated` audit metadata, bounded regardless of row count, numeric
(never raw-string) distinctness comparison. **The matching read moved inside the same transaction**
as the `updateMany`/audit insert (previously a separate pre-transaction read) — closes a real TOCTOU
gap where a concurrent request could have made the recorded "previous value" untruthful.

**M3 (rollback test)**: new forced-audit-failure test (`jest.spyOn(auditLogService,
'recordAuditLog')`, the same pattern `eobi-bidirectional-sync.test.ts` already established) proves
the whole bulk request 500s and every touched/untouched row, applicability flag, and Employee
default is exactly as it was before the call. A second new test proves the `previousValues` summary
itself is truthful across a genuinely mixed population (300/400/450.50 → `{mixed, distinctCount:3,
minimum:300, maximum:450.5}`) and correctly collapses to `single` once the population re-agrees.
`payroll-entry.test.ts` is now 18/18 (4 new).

**M4 (conflict-row opacity)**: root-caused precisely — `cn()`/`tailwind-merge` keeps only the *last*
conflicting `bg-*` class, so `status === 'conflict' && 'bg-danger-light/40'` silently dropped the
row's own base `bg-surface-2` (Addendum 31's own opaque-row fix) for exactly this one reachable row
state, reintroducing the same translucency gap for a concurrent-edit conflict. Fixed by dropping the
`/40` suffix (`bg-danger-light`, already used at full opacity elsewhere in this app —
`badge.tsx`'s `hold`/`red` variants, the Payroll Summary Print Options warning banner — no new
color introduced). New file `payroll-entry-row.test.tsx` (2 tests) asserts the real, rendered,
tailwind-merge-resolved `className` directly: a conflict row contains `bg-danger-light` and matches
no `bg-*/NN` opacity-suffixed pattern at all; an ordinary row still resolves to plain `bg-surface-2`.

**Verification**: `payroll-entry.test.ts` **18/18**; Bulk EOBI Amount 10,000-row timing re-measured
at **780ms** (unchanged from the original 714ms baseline — the transactional restructuring and the
previous-value computation added no measurable cost); frontend full suite **327/327** (325 + 2 new);
typecheck/lint/build clean across all three workspaces (identical pre-existing warning baseline,
zero new); `git diff --check` clean.

**Full backend suite, run once in the environment as it stood at the time, per explicit instruction
not to chase a clean result by repeating it**: **1349/1371** (22 failed) — **identical in every
respect to the pre-remediation baseline** (same 3 files — `payslips.test.ts`, `statements.test.ts`,
`payroll-hold-workflow.test.ts` — same homogeneous `"PDF test worker did not become ready within
30000ms"`/`"Exceeded timeout of 45000 ms"` signature, same already-documented KI-10 pattern, zero
overlap with this remediation's own changed files). Total grew from 1369 to 1371, exactly matching
the 2 new tests added in `payroll-entry.test.ts`; `payroll-entry.test.ts` itself passed cleanly
within this same full run (not only in isolation). **Zero new failures, zero regressions — the
identical pre-existing environmental issue, reported honestly rather than re-run until green.**

**Corrections Scenario 4 (M5) remains open, separate, and unresolved** — out of this remediation's
authorized scope. **Employee Payroll History Checkpoint 1B remains not started.**

**No commit, push, or deployment occurred this session** — stopped deliberately for final
authorization, per explicit instruction.

## 33. Addendum, 2026-08-06 — Phase 7 Reports, Project Site Payroll Report: Checkpoint 1B (Frontend, Browser Print, E2E, and Phase Close-Out) — IMPLEMENTED, NOT COMMITTED

Full detail in `docs/PROJECT_PROGRESS.md`'s new "Phase 7 Reports — Project Site Payroll Report,
Checkpoint 1B" entry and `docs/architecture/workflows/reports.md §16.9` — this is the handoff
summary. Starting state was verified clean before any edit: branch `main`, local `HEAD` equal to
`origin/main` at `4085e7e91c5eac377f86e8b2cfd2c1edb9bc532e` (Checkpoint 1A backend, already
committed and pushed per the prior session), working tree clean.

**This checkpoint is frontend-only, built entirely over the frozen Checkpoint 1A backend** — no
backend, shared-contract, or database file was modified. Route (`/reports/project-site-payroll` +
the canonical `/payroll-cycles/:cycleId/reports/project-site-payroll`), gated on `PERMISSIONS.REPORTS_VIEW`
(frozen decision 2), reusing `useSelectedPayrollCycle`/`PayrollCycleSelectField` exactly as Payroll
Summary already does — the established precedent for "exactly one required Cycle, no range," rather
than Employee Payroll History's own local-state Cycle-range shape, which doesn't apply here. Data
layer (`use-project-site-payroll-report.ts`), filters (Cycle/Site/Unit/Row Status/Has Correction —
the approved set only), totals (all 18 backend fields, grouped into three labeled clusters, the
`totalsComputed: false` notice), table (19 approved columns, server sort/pagination, row-status
badges via a new `project-site-payroll-labels.ts`), export (CSV/XLSX, mutually-exclusive
`activeExport` guard, structured 413 handling), and browser print (a fresh
`project-site-payroll-print-fields.ts` vocabulary/localStorage key, current-page-only scope stated
in the dialog, 19-column-scaled readability thresholds reused from Payroll Summary since both
tables share the same 19-column maximum) were all built following the exact patterns
`reports-payroll-summary-page.tsx` and `reports-employee-payroll-history-page.tsx` already
established — no new architectural pattern was introduced.

**Environment note for the next session**: this worktree had no `node_modules` of its own (Node's
module resolution was silently falling back to the parent checkout's hoisted packages, which is
usually harmless but was missing `@types/archiver` at the root, breaking the E2E harness's own
`tsc -p tsconfig.build.json` backend build step). Fixed by running a plain `npm install` inside the
worktree — a normal, worktree-local, reversible action, not a workaround. A local Postgres was also
independently provisioned in the session's own job scratchpad (`@embedded-postgres/darwin-x64`,
port 5433, roles/databases `payroll_dev`/`payroll_test`) to run the backend Jest suite directly;
this is separate from, and unrelated to, the E2E harness's own self-contained Postgres (port 55432,
provisioned automatically by `tests/e2e/global-setup.ts` inside `tests/e2e/.tmp/`) — the two never
share state. Both are session-scoped and expected to be re-provisioned fresh next time.

**Verification**: frontend `typecheck`/`lint`/`build` clean; full frontend suite **460/460** (70 net
new — 68 across 4 new colocated test files, 2 added to the existing `reports-page.test.tsx`).
`typecheck:e2e` clean. New Playwright spec (`tests/e2e/specs/20-project-site-payroll-report.spec.ts`,
8 tests covering Master User navigation, Site scoping/historical-transfer/no-cross-site-leak, Unit
filtering, all five row statuses via real fixture data (not simulated — a genuine zero-net entry for
No Pay Due, a genuine zero-worked-days entry for Recovery Due, a genuine post-release "Late Entry"
for Pending), Corrections, Export, Print, and Permission) **8/8 passing**, both standalone and
combined with the existing `17-reports.spec.ts` (**9/9 passing, unweakened** by this checkpoint).
Directly affected backend suites re-run to confirm the frozen backend is untouched:
`project-site-payroll-report.test.ts` **37/37** and `project-site-payroll-report-performance.test.ts`
**5/5**, both unweakened. Full backend suite was not re-run, per this checkpoint's own instruction
("do not rerun the entire backend suite unless backend/shared production files are changed
unexpectedly") — no backend/shared production file was touched.

**No commit, push, or deployment occurred this session** — stopped deliberately for independent
review, per explicit instruction. **Project Site Payroll Report is now fully complete** (Checkpoints
0, 1A, 1B). Deduction Report, Overtime Report, Advance Recovery Report, Salary Release Report,
Variance/Month-on-Month Report, Dashboard, and every other module remain untouched and **Not
Started** — none was begun this session.

## 34. Addendum, 2026-08-06 (same day) — Project Site Payroll Report Checkpoint 1B: independent review remediation — IMPLEMENTED, STILL NOT COMMITTED

An independent, read-only review of Addendum 33's Checkpoint 1B (same worktree/branch,
`worktree-reports+project-site-payroll-1b`, base commit unchanged at
`4085e7e91c5eac377f86e8b2cfd2c1edb9bc532e`) found **zero Blocker/High-severity findings** and
returned a verdict of **APPROVE WITH NON-BLOCKING NOTES**. Three of the review's non-blocking notes
were authorized for a targeted remediation pass, applied in this same uncommitted checkpoint —
**Addendum 33 above is left as the unmodified historical record of what was true before this
remediation**; this entry documents what changed since.

**1. Correction-count zero case** (`frontend/src/routes/reports-project-site-payroll-page.test.tsx`)
— the existing test's title claimed both a badge for `correctionCount > 0` and a plain "0" (never a
badge) for `correctionCount === 0`, but only asserted the former. Strengthened in place (not split):
now renders two rows in one fixture and asserts both — the badge case resolves to a `<span>` with the
Badge's `rounded-full` class, the zero case resolves to the bare `<td>` itself with no such class —
plus that the zero-correction row's other fields (employee code/name, row status) remain visible and
correct alongside it. No production behavior changed; the review found no defect, only a coverage
gap the test's own title had overclaimed.

**2. No request without a Cycle** (`frontend/src/hooks/use-project-site-payroll-report.test.ts`) — a
new, direct hook-level suite renders the real `useProjectSitePayrollReportList` hook through
`renderHook`/`QueryClientProvider` (matching `use-payroll-entry-editor.test.tsx`'s own established
real-hook-testing convention) with `global.fetch` stubbed. Proves: the query's `fetchStatus` stays
`'idle'` and `fetch` is never called while `cycleId` is empty, including across re-renders; a
positive control proves the same hook does issue exactly one request once a real `cycleId` is
supplied; and a transition test proves flipping from an empty to a real `cycleId` moves the query
from disabled to enabled with exactly one request — not merely the pure URL-builder functions the
prior test file only exercised. No production code changed — `enabled: Boolean(params.cycleId)`
(`use-project-site-payroll-report.ts`) was already correct; it now has direct proof.

**3. Page clamp when total shrinks** (`frontend/src/routes/reports-project-site-payroll-page.tsx`) —
a genuine, narrow gap the review identified: if the backend's total for the currently-viewed page
shrinks under an *unchanged* filter set (e.g. another user releases/holds rows while a reviewer sits
on page 3), nothing previously corrected the now-out-of-range page, risking a stale, empty page shown
as if it were current data. Added a `useEffect` keyed on the resolved `report.data` (and `page`) that
clamps `page` down to `Math.max(1, Math.ceil(total / pageSize))` whenever `page > 1` and the current
page exceeds that value. Deliberately keyed on `report.data` alone (never on
`isLoading`/`isFetching`) — this hook has no `placeholderData`/`keepPreviousData`, so `report.data` is
`undefined` for the entire duration of any in-flight request; checking it directly is what guarantees
the effect never clamps before a real response exists and never acts on stale/previous-page data.
Never fires below page 1; self-terminates after one corrective `setPage` (recomputing against the
same total no longer finds the new page out of range), so it cannot loop with, or fight, the
pre-existing filter/sort/Cycle page-reset effect. Four new tests prove: an already-valid page stays
unchanged; a shrunk total clamps to the new last valid page with an exact, asserted request-count
delta (proving no storm/loop); a total of 0 clamps to page 1; and a loading/no-data render neither
clamps nor throws.

**4. Documentation**: `docs/architecture/workflows/reports.md §16.9` and this
`docs/PROJECT_PROGRESS.md` entry were both updated in place — the "no request without a Cycle" claim
now cites direct test proof rather than only a code comment, the page-clamp behavior is recorded, and
every test count was corrected. **Both remain marked "awaiting review, NOT COMMITTED"** — this
remediation does not change that status; it is still the same not-yet-authorized-to-commit
checkpoint, now with the review's non-blocking notes closed.

**Verification (re-run after remediation)**: frontend `typecheck`/`lint`/`build` clean; full frontend
suite **468/468** (78 net new versus the pre-checkpoint baseline — 76 across the 4 new colocated test
files [14 hook, 5 labels, 14 print-fields, 43 page], 2 in the existing `reports-page.test.tsx`; +8
versus Addendum 33's 70, from the 4 new hook tests and 4 new page tests above — the corrections test
was strengthened in place, not split, so it does not add to the count). `typecheck:e2e` clean.
`tests/e2e/specs/20-project-site-payroll-report.spec.ts` re-run standalone: **8/8 passing**; combined
with `17-reports.spec.ts`: **17/17 passing**, unweakened. No backend/shared/schema/migration file was
touched by this remediation (confirmed via `git diff --name-status`, unchanged from Addendum 33's own
scope) — the directly-affected backend suites were not re-run since no backend/shared production file
changed. `git diff --check` clean; no test/build artifacts left in the working tree.

**No commit, push, or deployment occurred this session** — stopped deliberately for final
authorization, per explicit instruction. Project Site Payroll Report's frontend, print, and E2E
remain fully implemented and now fully address the independent review's non-blocking notes, still
**awaiting explicit authorization to commit**. Deduction Report, Overtime Report, Advance Recovery
Report, Salary Release Report, Variance/Month-on-Month Report, Dashboard, and every other module
remain untouched and **Not Started**.

## 35. Addendum, 2026-08-10 — UAT: Payroll Entry "New Employee" quick action, and scroll/header blank-space defect reopened and correctly fixed — IMPLEMENTED, NOT COMMITTED

Two UAT items resolved before Advance Recovery Report or any Dashboard work begins, per explicit
instruction to stop after this checkpoint for review. Starting state verified first: `main ==
origin/main == cde6a3ec688f1713a861b8d9375fd76497603b44`, working tree clean.

**Floating "+" — corrected premise, confirmed by search.** No current or historically-shipped
floating/hovering employee-add control exists in real application source. It appears only in the
original static prototype (`reference/payroll_prototype.html`'s `.quick-add-btn`, `onclick=
"showModal('emp-modal')"`, positioned for Payroll Entry) and the original spec
(`reference/PROJECT_SPEC.md`), neither of which is part of the built app; it was already absent from
the later, phase-by-phase prototypes that actually drove implementation
(`docs/prototypes/phase3-payroll-entry-preview.html` has no FAB). `git log -S"floating"`/`-S"FAB"`
across the whole history turned up nothing relevant. `docs/design-system.md`'s Components table row
for it is marked superseded/historical (struck through, not deleted) rather than removed outright,
per the instruction to preserve chronology.

**Employee Registry's existing create architecture** (investigated before writing any code):
`employees-page.tsx`'s "+ New Employee" button (`size="sm"`, default/primary variant, `Plus` icon)
simply set local `createOpen` state; the create/edit modal (`EmployeeFormModal`) was page-local,
inline in the same file, using `useCreateEmployee`/`useUpdateEmployee` (`hooks/use-employees.ts`) for
submission, `EMPLOYEES_CREATE`/`EMPLOYEES_EDIT` for both frontend button-gating and independent
backend route enforcement, and `useCreateEmployee`'s own `onSuccess` invalidating the base
`['employees']` React Query key (covering every filtered variant Employee Registry's own list query
might be using).

**Reusable modal.** Extracted verbatim (no behavior change) into
`frontend/src/components/employees/employee-form-modal.tsx`, exporting `EmployeeFormModal` with one
new optional prop, `onCreated?: () => void` — fires only after a successful *create* (never edit),
used by Payroll Entry's own caller only; Employee Registry omits it, unaffected.
`employees-page.tsx` now imports `EmployeeFormModal` instead of defining it; every now-exclusively-
extracted import (`normalizeCnic`, `checkCnicAvailability`, `useCreateEmployee`, `useUpdateEmployee`,
`CnicAvailability`) was removed from `employees-page.tsx`'s own import list, confirmed via grep that
nothing else in that file still referenced them, and confirmed via `tsc -b --noEmit` (clean) and a
real-Chromium Playwright pass that Employee Registry's own New Employee, Edit (pre-fill), and blank-
on-reopen behaviors are byte-for-byte unchanged.

**Payroll Entry placement/behavior.** A `+ New Employee` button (identical `size="sm"`/primary
pattern to Employee Registry's own) added to `PayrollPageToolbar`'s `actions` slot, gated on
`hasPermission(user, PERMISSIONS.EMPLOYEES_CREATE)`, rendered only alongside the toolbar's other
cycle-scoped actions (i.e. only once a cycle is selected — consistent with every other action in that
slot). Opens the same `EmployeeFormModal`, no `employee`/`defaultSiteId` (always a blank create
state, verified via Playwright: `#emp-name` etc. are empty on every open, including a second open
right after a successful create). No second employee-create form, no second validation path, no
second API route.

**Post-create refresh — corrected mid-implementation.** Initial assumption (from an earlier research
pass) was that creating an Employee never creates a `PayrollEntry`. **This was wrong**:
`backend/src/modules/employees/employees.service.ts`'s `createEmployee` already calls
`syncEmployeeIntoCurrentDraftCycle` synchronously, inside the same transaction, on every employee
creation — a pre-existing, already-shipped behavior, confirmed by grep
(`employees.service.ts:402`) and by a real Playwright run showing the `PayrollEntry` row already
exists (`reconciledCount: 0` when the page's own separate roster-reconciliation effect ran against
it) immediately after the `POST /api/v1/employees` response. The only real gap was that Payroll
Entry's own `usePayrollEntries(cycleId)` frontend query cache wasn't invalidated after a creation
triggered from its own page. Fixed by invalidating `payrollEntriesQueryKey(cycleId)` directly in the
button's `onCreated` handler (`useQueryClient` + the hook's already-exported `payrollEntriesQueryKey`)
— no new payroll-entry-creation semantics invented; this only makes the frontend reflect what the
backend already did. (An intermediate version of this fix instead re-triggered
`reconcileDraftCycleRoster` — a real mechanism, but for a different problem, an employee who predates
this sync-on-create behavior — and it correctly, harmlessly, always returned `reconciledCount: 0` for
a brand-new employee; replaced once the actual mechanism was understood.) Verified end-to-end via
Playwright: the new employee's row appears in the grid with no page reload.

**Scroll/header defect — reopened, investigated, re-root-caused.** The 2026-08-05 Post-Checkpoint-1A
UAT Stabilization fix (Addendum 31/32 above) gave every Payroll Entry virtualized row an explicit
`bg-surface-2`. Real, but that same session's own independent review (Addendum 32, M1) had already
flagged the causal claim as unconfirmed — the actual reported symptom was never reproduced live, only
disproved (the initial "bleed-through" hypothesis was wrong; a `will-change: transform` probe measured
zero effect). UAT on 2026-08-10 reproduced the defect on **Employee Registry** — a page using the
plain, non-virtualized shared `<Table>`, with no sticky element of its own at all — conclusively
proving the 2026-08-05 fix was never the real mechanism (that code path does not even run on this
page). Investigated fresh, with no assumption the old diagnosis was correct: real Chromium via
Playwright, seeded with 45 employees, CDP `Input.synthesizeScrollGesture` (`gestureSourceType:
'touch'`, `yOverscroll: 200`) to trigger a real browser-native overscroll bounce, screenshotting
mid-gesture and sampling the rendered pixel color at the top of the content region with `sharp`.
Before any fix: the sampled pixel at the very top of the viewport read `rgb(240, 237, 232)` — exactly
`--color-bg` — instead of the Topbar's own `rgb(255, 255, 255)`, a real, visually-confirmed gap. Root
cause: `html`/`body` were left at the browser default `overscroll-behavior-y: auto`; nothing prevented
the browser's own native elastic bounce from acting on the document itself, which shifts AppShell's
entire root (`app-shell.tsx`'s outer `flex h-screen overflow-hidden` div, Topbar included) down within
the viewport for the duration of the bounce. Reproduced identically on every page audited (Employee
Registry, Payroll Entry, Project Sites, Reports catalogue, a long report, Salary Release) — a single
shared-layout defect, never a per-page one.

**Fix — at the shared layout level, not a per-page patch**: `frontend/src/index.css`'s `@layer base`
adds `overscroll-y-none` to both `html` and `body`; `app-shell.tsx`'s `<main>` (the one element that
legitimately scrolls) additionally carries `overscroll-y-contain`, so its own scroll-chaining is
contained rather than propagating. Re-ran the identical CDP-gesture pixel-sampling probe after the
fix: the same sample now reads `rgb(255, 255, 255)` on every page tested, confirming the gap can no
longer occur. `docs/design-system.md` §2.1 records both the 2026-08-05 fix (left in place, as a real
robustness rule, marked historical/insufficient for this specific symptom) and this fix's full
technical explanation.

**Tests**: frontend `typecheck`/`lint`/`build` clean; `git diff --check` clean.
`tests/e2e/specs/23-scroll-header-integrity.spec.ts` (new) — 12/12 passing: deterministic
`overscroll-behavior` assertions across Employee Registry/Payroll Entry/Project Sites/Reports
catalogue/Salary Release; scroll-owner + header position/opacity geometry assertions (before/after a
substantial scroll) for Employee Registry, Payroll Entry, and Project Site Payroll Report (the long
report); and the CDP-gesture pixel-sampling proof for Employee Registry and Payroll Entry (mandatory
coverage). `tests/e2e/specs/24-payroll-entry-quick-add-employee.spec.ts` (new) — 3/3 passing: button
placement/no-FAB proof, full shared-modal create-to-grid-refresh flow (asserting the single
`POST /api/v1/employees` route, blank state on every open, and grid refresh without reload), and
`employees:create` permission parity between both pages (including a direct backend-bypass attempt
via `context.request.post`, confirmed `403`). `06-ui-regression.spec.ts`'s own sticky-header-
containment test's doc comment corrected to reflect this history (its assertions themselves are
unchanged and still pass, since they were never wrong, only insufficient).

**Files changed**: `frontend/src/index.css`, `frontend/src/components/layout/app-shell.tsx`,
`frontend/src/components/employees/employee-form-modal.tsx` (new),
`frontend/src/routes/employees-page.tsx`, `frontend/src/routes/payroll-entry-page.tsx`,
`tests/e2e/specs/23-scroll-header-integrity.spec.ts` (new),
`tests/e2e/specs/24-payroll-entry-quick-add-employee.spec.ts` (new),
`tests/e2e/specs/06-ui-regression.spec.ts` (comment only), `docs/design-system.md`,
`docs/PROJECT_PROGRESS.md`, this addendum.

**Addendum, same day — hostile/independent review found and fixed one genuine defect.** Requested
as a read-only/hostile review of the above; production code was to stay untouched unless a real
defect turned up. One did:`handleEmployeeCreated`'s post-create query invalidation invalidated
whichever cycle Payroll Entry's URL currently named, not necessarily the cycle the employee was
actually synced into (`employees.service.ts` always syncs into the current *global* Draft cycle,
regardless of which cycle the page happens to be viewing — and the Historical Payroll Cycle
Selector lets this page display a read-only Released/Archived cycle). Combined with
`usePayrollEntries`'s `staleTime: Infinity`, creating an employee while viewing a historical cycle
left the real Draft cycle's cache stale for the rest of the session — the new employee wouldn't
appear there without a full reload. Reproduced live in a single real-Chromium SPA session (in-app
Cycle-selector navigation only, never `page.goto`, which would trivially mask the bug by wiping the
client-side cache), fixed by resolving the actual Draft cycle from the page's own `cycles` list
rather than trusting the viewed `cycleId`, and regression-tested with a new spec proven to fail
against the original code and pass against the fix. Every other claim from the original pass was
independently re-verified rather than re-asserted: the Employee Registry extraction diffed
byte-for-byte behaviorally identical against the base commit; `overscroll-y-none` and
`overscroll-y-contain` each independently and fully fix the scroll defect on their own (tested by
removing each in isolation — legitimate defense-in-depth, not redundant); the scroll regression spec
was proven to fail 7/10 tests when the production fix is reverted; and the 3 pre-existing E2E
failures were reconfirmed via a fresh full-suite run plus direct failure-signature inspection
(Corrections/Balance-Adjustment lifecycle, a virtualized-grid row lookup unrelated to Employee
creation, and a Puppeteer PDF-export timeout — none touch AppShell, `index.css`, or the Employee
modal). Final verdict: **APPROVE WITH NON-BLOCKING NOTES** (after the one fix above was applied).

**No commit, push, or deployment occurred this session** — stopped deliberately for review, per
explicit instruction. Advance Recovery Report **NOT** started; Dashboard **NOT** touched; no
unrelated report work performed.

## 36. Addendum, 2026-08-10 (later same day) — Phase 7 Reports, Advance Recovery Report: Checkpoint 1A (Backend Foundation) — IMPLEMENTED, NOT COMMITTED

Backend, shared contracts, and backend tests only, per explicit Checkpoint 1A authorization —
Checkpoint 0's own frozen architecture decisions (business purpose, grain, optional Cycle,
permission, site authorization, canonical financial values, current-vs-historical semantics,
filters, list columns, DB-native totals, detail/history endpoint, sorting, pagination, employee
lookup, export, no-schema-change target) carried over verbatim from the authorizing instruction. No
Checkpoint 1B (frontend) work. Starting state verified first: `main == origin/main ==
4eca09e58cec740c029b8cf54474c79f19188298`, working tree clean.

**Report grain is `Advance`, not `PayrollEntry`** — a first for this Reports module; every prior
report in it (Payroll Summary, Employee Payroll History, Project Site Payroll Report, Deduction
Report, Overtime Report) is grained on some `PayrollEntry`-family row. **Cycle is optional** —
likewise a first; every sibling report requires exactly one Cycle. Both are intentional, frozen
architectural exceptions specific to this report's own domain (an Advance's own lifecycle spans many
cycles, and its live balance is meaningful with no cycle selected at all), not an inconsistency to
reconcile with the rest of the module.

**Site authorization** uses `Advance.employee.siteId` (the employee's CURRENT site) — `Advance` has
no historical `siteId` column anywhere in this schema. This deliberately follows the existing
Advances module's own shipped authorization model (`advances.service.ts`) rather than inventing a
new one, including its 403-not-404 posture on the new detail endpoint. A disclosed, accepted V1
limitation: a transferred employee's Advance and its recovery history follow their current site, not
the site they belonged to when the Advance originated — proven directly by a live
`prisma.employee.update` mid-test transfer scenario on both the list and detail endpoints, not
merely asserted. No `siteId` column was added to `Advance`; no migration exists for this checkpoint.

**Totals are true DB aggregates throughout** (`SUM`/`COUNT`/`GROUP BY`) — the one totals contract in
this Reports module with **no `totalsComputed` flag/fallback at any row count**, unlike every
`calcNet`-dependent sibling report. Verified directly, not merely asserted from the shared contract's
own doc comment: a dedicated boundary suite seeds 20,001 real `Advance` rows and proves every total
stays real/non-null/correctly-summed at all three boundary counts, including one row past the export
ceiling. The one subtlety this required getting right: a type-split total (`loan`/`eidAdvance`) must
use `{ AND: [where, { type: 'LOAN' }] }`-style composition, never a shallow `{ ...where, type: 'LOAN'
}` spread — the latter would silently discard a caller's own `advanceType` filter when computing the
*other* type's split, incorrectly pulling in every Advance of that type matching the remaining
filters instead of correctly returning zero. Caught and fixed during the focused test pass (a test
explicitly proves the correct, filter-respecting zero), not left as a latent defect.

**New dedicated detail/recovery-history endpoint** (`GET /api/v1/reports/advance-recovery/
:advanceId`) — Checkpoint 0 approved building this now, unlike every sibling report's own "no detail
endpoint in V1" decision. Returns the Advance's own current summary, every genuinely linked
`PayrollEntry` recovery event (with that event's own HISTORICAL site — the one field in the whole
response that is deliberately not current), and the existing append-only `AdvanceScheduleChange`
history — kept as two clearly separate arrays, never merged, so a recovery event is never mistaken
for a scheduling/deferral event or vice versa.

**Employee lookup** (`GET /api/v1/reports/advance-recovery/employees`) is a small, purpose-built,
current-site-scoped query — the existing historical-payroll employee lookup
(`common/historical-payroll-employee-lookup.ts`, used by Employee Payroll History/Statements) was
inspected first and correctly rejected: it scopes by historical `PayrollEntry.siteId`, the wrong
authorization basis for a report whose own model is current-site-based throughout (§19.1 decision 15,
`docs/architecture/workflows/reports.md`).

**Export** carries an explicit "As of &lt;timestamp&gt;" disclosure so a selected Cycle filter can
never be misread as implying the current-balance figures are "as of" that cycle — an XLSX subtitle
row beneath the title; for CSV, a filename-embedded timestamp instead of an extra body row, since an
extra row would break the CSV's own header/row parity with the declared, potentially
machine-parsed `ADVANCE_RECOVERY_REPORT_EXPORT_HEADERS`.

**Performance evidence**: seeded 10 sites × 1,000 employees (10,000, the named design-floor
population), ~15,000 `Advance` rows across a multi-year `dateGiven` spread with mixed type/status,
plus real cross-cycle recovery `PayrollEntry` history — a committed, repeatable performance suite (9
tests) measuring all 8 representative shapes named in the authorizing instruction with real
`EXPLAIN (ANALYZE, BUFFERS)`. Honest finding: `Advance` itself carries only `@@index([employeeId])`
and `@@index([currentScheduledPeriodId])` — no `type`/`status` index, no `siteId` column at all — so
the broad-roster and status-filtered shapes do involve a `Seq Scan` at this fixture's ~15,000-row
scale, a legitimate cost-based planner choice, not evidence of a missing index; every shape still
completed its real HTTP request in well under one second. **No migration is proposed or recommended
by this checkpoint** — see `docs/architecture/workflows/reports.md §19.7` for the full evidence table
and reasoning, including a disclosed caveat about one hand-written approximating raw-SQL `EXPLAIN`
showing a worse isolated plan than the real, faster end-to-end HTTP measurement above it.

**Tests**: `advance-recovery-report.test.ts` (58), `advance-recovery-report-performance.test.ts` (9),
`advance-recovery-report-boundary.test.ts` (6) — **73/73 new backend tests passing.**
`typecheck`/`lint`/`build` clean across `shared`/`backend`, `git diff --check` clean. Targeted
regression re-run (`advances.test.ts`, `deduction-report.test.ts`, `overtime-report.test.ts`,
`project-site-payroll-report.test.ts`, `employee-payroll-history.test.ts`) passes unweakened with one
disclosed, pre-existing exception: 4 `advances.test.ts` failures (a payroll-cycle `finalize` endpoint
returning 400 instead of 200, across 4 otherwise-unrelated tests) — confirmed genuinely pre-existing,
not assumed, by a `git stash` round-trip reproducing the identical 4 failures on a clean `4eca09e`
checkout with zero code from this checkpoint applied, before restoring this checkpoint's own changes
and rebuilding. This checkpoint touches no payroll-cycle finalize/release code at all.

**Files changed**: `shared/src/schemas/advance-recovery-report.ts` (new), `shared/src/index.ts`,
`backend/src/modules/reports/advance-recovery-report.service.ts` (new),
`backend/src/modules/reports/reports.routes.ts`,
`backend/tests/advance-recovery-report.test.ts` (new),
`backend/tests/advance-recovery-report-performance.test.ts` (new),
`backend/tests/advance-recovery-report-boundary.test.ts` (new),
`docs/architecture/workflows/reports.md` (new §19), `docs/PROJECT_PROGRESS.md`, this addendum.

**Known limitation carried forward**: the current-site-only Advance authorization model (§19.1
decision 5 above) — disclosed, accepted, not a defect.

**No commit, push, or deployment occurred this session** — stopped deliberately for independent
review, per explicit instruction. Checkpoint 1B (frontend), Dashboard, Salary Release Report, and
Variance/Month-on-Month Report are all explicitly **NOT** started.

## 37. Addendum, 2026-08-10 (later same day) — Advance Recovery Report Checkpoint 1A: Independent Hostile Review — APPROVE WITH FIXES (no production defect found; regression coverage strengthened)

An adversarial, independent re-review of Checkpoint 1A above, per explicit instruction. Scope: the
same uncommitted diff (repository/diff integrity re-verified: `main == 4eca09e`, working tree contains
only Checkpoint 1A's own files, no frontend/Dashboard/schema/migration/unrelated change, `git diff
--check` clean). Every production code path was independently traced against the schema/frozen
contract — authorization (all four endpoints, including a fresh detail-endpoint live-transfer test
and an employeeId-site-bypass test, both added below), transferred-employee semantics, canonical
financial-value sourcing (cross-checked directly against `advances.service.ts`'s own materialization/
reversal/release code, confirming `outstandingBalance` decrements at Draft materialization, not
Release, and that every reversal path nulls `advanceId`/`eidAdvanceId` so a reversed/deferred Draft
deduction can never leak into `recoveryHistory`), optional-Cycle behavior, totals arithmetic
(including the `AND`-composition type-split correctness), detail/history query correctness (LOAN vs
EID_ADVANCE linkage, historical vs current site attribution), export CSV/XLSX field-by-field parity,
sensitive-field exclusion, the 19,999/20,000/20,001 export boundary, and performance/index evidence
against the actual `schema.prisma` indexes (`Advance` has only `@@index([employeeId])`/
`@@index([currentScheduledPeriodId])`, `PayrollEntry` has `@@index([advanceId])`/
`@@index([eidAdvanceId])`, `AdvanceScheduleChange` has `@@index([advanceId, changedAt(sort: Desc)])`
— all confirmed to match the performance suite's own claims).

**No production defect found.** Three test-coverage gaps were identified and closed with new
regression tests in `advance-recovery-report.test.ts` (all passing): (1) the detail endpoint's own
live-transfer authorization behavior (Site A loses access with 403, Site B gains it with 200) was
previously only proven on the list endpoint, not the detail endpoint, despite both sharing the
identical `assertSiteAccess` call; (2) a malformed `advanceId` on the detail route returning 400
(enforced by the route's own `z.string().uuid()` parse) had no explicit test; (3) `employeeId`
filtering could not previously be shown, by test, to be incapable of bypassing site scoping — traced
in code (the site filter and `employeeId` filter are separate top-level keys in one Prisma `where`
object, therefore implicitly `AND`-composed, never one overriding the other) and now proven directly:
an explicit `employeeId` belonging to an inaccessible employee returns zero rows, never that
employee's Advance.

**Test count is now 76, not 73** (`advance-recovery-report.test.ts` 61, up from 58; boundary 6;
performance 9 — unchanged) — the increase is these three added regression tests, not a correction of
a wrong prior count (58/73 was accurate for the file set as it stood after Addendum 36).

**The Addendum 36 pre-existing-failure claim (4 `advances.test.ts` failures) was independently
re-verified**, not merely trusted: `git stash push -u` on this exact session's working tree, confirmed
clean at `4eca09e` (`git status` empty), `advances.test.ts` run standalone — identical 4 failures at
the identical 4 line numbers (`tests/advances.test.ts:444/635/951/1476`, all a payroll-cycle `finalize`
call receiving `400` instead of `200`), then `git stash pop` restored this checkpoint's changes
byte-for-byte (verified via `git status` matching pre-stash exactly). Confirms the claim precisely.

**Full-suite degradation (§16 of the review instruction) — investigated, not run wholesale.** The
plain `advance-recovery-report*` Jest run prints "Jest did not exit one second after the test run has
completed" — but the identical warning, byte-for-byte, also printed on the from-scratch
`advances.test.ts` run against clean `4eca09e` (zero Checkpoint 1A code present) and on
`deduction-report.test.ts`/`overtime-report.test.ts` (both pre-existing, unrelated suites). A
`--detectOpenHandles` re-run of the three new suites together found zero reported open
handles/leaked timers/connections. This is conclusive evidence the warning is a repo-wide Jest/pg-pool
teardown-timing characteristic, not a leak introduced by this checkpoint — so the broader ~1,638-test/
150-failure/76-minute full-suite run this review's own instructions flagged as a possible target was
correctly judged unnecessary; there was no positive signal pointing at this checkpoint as a
contributor.

**"As of" disclosure (§12) — assessed, not changed.** The XLSX subtitle row plus CSV's filename-
embedded timestamp is judged sufficient: the field names themselves (`Current Outstanding Balance`)
already state the current-vs-historical distinction, and inserting a metadata row into the CSV body
would break its declared header/row parity with `ADVANCE_RECOVERY_REPORT_EXPORT_HEADERS` for a
programmatic consumer — the frozen decision's own stated reason for this asymmetry. No change made.

**Verification evidence**: `shared`/`backend` `npx tsc --noEmit` clean; `npm run lint` clean (0
errors, 10 pre-existing warnings confined to unrelated `backend/scripts/*.ts` files, untouched by this
diff); `npm run build` clean; `advance-recovery-report*` (3 files, 76/76) passing; `advances.test.ts`
34/34 with the same 4 pre-existing failures on both the working tree and the clean-`4eca09e` stash
comparison; `deduction-report.test.ts` + `overtime-report.test.ts` 117/117 passing; `git diff --check`
clean.

**Files changed by this review pass**: `backend/tests/advance-recovery-report.test.ts` (3 new
regression tests added, no existing test modified/weakened), `docs/SESSION_HANDOFF.md` (this
addendum), `docs/PROJECT_PROGRESS.md`, `docs/architecture/workflows/reports.md` (test-count
correction + this review's findings). No other file touched. No production code changed — no genuine
defect was found to fix.

**Verdict: APPROVE WITH FIXES** (fixes being the three added regression tests — no production code
defect existed to fix). Migration: not recommended, consistent with Addendum 36's own conclusion,
independently re-confirmed against the actual schema. Checkpoint 1B may proceed once explicitly
authorized. **No commit, push, or deployment occurred during this review.**

## 38. Addendum, 2026-08-10 (later same day) — Phase 7 Reports, Advance Recovery Report: Checkpoint 1B (Frontend, Detail Page, Browser Print, Playwright, and Documentation) — IMPLEMENTED, NOT COMMITTED

Frontend-only, over the frozen Checkpoint 1A backend (Addendum 36/37 above) — no backend, shared-
contract, schema, or migration change in this checkpoint. Starting state verified: `main ==
origin/main == 4804c46682ec7c22559f3734dff516212844c27b` everywhere, working tree clean, before this
checkpoint's first file was written. Gated on `reports:view` throughout (routes, catalogue card),
matching Checkpoint 1A's own frozen decision 4. Full architectural record:
`docs/architecture/workflows/reports.md` §19.11; roadmap record: `docs/PROJECT_PROGRESS.md`'s "Phase 7
Reports — Advance Recovery Report, Checkpoint 1B" entry.

**The one architecturally distinctive decision this checkpoint made**: since Cycle is optional for
this report (unlike every sibling report's own mandatory single-cycle shape), the page deliberately
does **not** use the shared `useSelectedPayrollCycle` hook — that hook's own job is to auto-redirect a
flat route to a resolved default Cycle the instant one exists, which is precisely the forced-selection
behavior the brief's own "do not force the user to select a Cycle" requirement rules out. Instead, the
page reads the optional `:cycleId` route param directly via `useParams`, with genuinely no redirect
logic of any kind — `/reports/advance-recovery` always renders the true no-Cycle roster by default,
and only navigates to the canonical `/payroll-cycles/:cycleId/reports/advance-recovery` URL when a
user explicitly picks a Cycle from the page's own selector (first option: "All Cycles / No Cycle
Context"). This was verified both by unit test (the list hook fires with no `cycleId` param at all on
mount) and by a real Playwright request/response comparison proving `currentOutstandingBalance`/
`recoveredToDate` render byte-identical whether or not a Cycle is subsequently selected.

**Routes/catalogue**: `/reports/advance-recovery`, `/payroll-cycles/:cycleId/reports/advance-recovery`,
and `/reports/advance-recovery/:advanceId` (a detail page exists in V1, unlike Deduction/Overtime/
Project Site Payroll Report), all lazy-loaded and `RequirePermission`-gated on
`PERMISSIONS.REPORTS_VIEW`. The Reports catalogue card flipped from `available: false` to
`available: true`, `to: '/reports/advance-recovery'`.

**Data layer** (`hooks/use-advance-recovery-report.ts`) — every DTO imported directly from
`@payroll/shared`; `useAdvanceRecoveryReportList` is never `enabled`-gated on `cycleId` (the one
genuine divergence from every sibling report's own required-cycle hook); a dedicated
`useAdvanceRecoveryReportEmployeeSearch` hits the backend's own purpose-built current-site-scoped
`/employees` endpoint; `downloadAdvanceRecoveryReportExport` handles the structured 413 via a dedicated
`AdvanceRecoveryReportExportRowLimitExceededError`, reusing the existing shared
`extractFilenameFromContentDisposition` helper rather than a second hand-rolled parser (per this
project's own "grep for duplicates on new shared utility" convention).

**Employee lookup** (`components/reports/advance-recovery-report-employee-lookup.tsx`) — a third
independent fork of `EmployeePayrollHistoryEmployeeLookup`'s own debounced-listbox interaction shape,
pointed at this report's own dedicated endpoint — deliberately not the historical-payroll lookup
(wrong authorization basis, current-site vs historical-site) and not the plain org-wide `EmployeeLookup`
(a differently-shaped candidate contract).

**Filters, table, totals, sorting, pagination**: exactly the approved Checkpoint 1A filter set (Site,
Employee, Advance Type, Status, Has Outstanding Balance tri-state, optional Cycle) and the frozen 11
list columns. `recoveredThisCycle === null` renders literally as "Not selected" everywhere (table, CSV,
print) — verified never a fabricated `0.00`. Totals render the backend's own always-fully-computed
aggregates verbatim (this report has no `totalsComputed` flag at all, unlike every `calcNet`-dependent
sibling). Only the eight backend-approved fields expose a sortable header. **Clear Filters decision
(documented, per the checkpoint brief's explicit requirement to document the chosen behavior)**: Cycle
is a navigation control, not a filter (`docs/design-system.md` §2.6) — Clear Filters resets every other
filter and the page to 1, never the current Cycle selection or sort.

**Detail page** (`reports-advance-recovery-report-detail-page.tsx`) — Advance Summary (explicit
"current, live figures" disclosure), Recovery History (each event's own HISTORICAL Site, explicitly
noted as potentially differing from the Advance Summary's current Site above it), and Schedule /
Deferral History (every `AdvanceScheduleChange`, in a structurally separate section, never merged with
or mislabeled as a recovery — verified directly by a real `/advances/:id/defer` call in Playwright).
**403 and 404 are deliberately shown as two different messages**, mirroring the backend's own existing
divergence from Employee Payroll History's concealment posture (Checkpoint 1A frozen decision 5). "Back
to Report" restores the list's filters/sort/page and, when applicable, the exact cycle-scoped canonical
URL, via `location.state` (`AdvanceRecoveryReportListNavigationState`), the same lightweight mechanism
Employee Payroll History's own detail page already established — no new global store, no URL query
serialization.

**Export/Print**: Export CSV/Export Excel over the current filters/sort, never page-limited, with the
same structured-413-via-`toast.error` handling every sibling report already uses. A dedicated
`advance-recovery-report-print-fields.ts`/`advance-recovery-report-print-options-dialog.tsx` pair,
versioned `localStorage` key `advance-recovery-report-print-fields:v1`, defaulting to the complete
report (never a silently narrowed default). Current page only, browser print only — no backend PDF.

**Tests**: 5 new colocated Vitest files (`use-advance-recovery-report.test.ts`,
`advance-recovery-report-labels.test.ts`, `advance-recovery-report-print-fields.test.ts`,
`reports-advance-recovery-report-page.test.tsx`, `reports-advance-recovery-report-detail-page.test.tsx`)
plus 2 new catalogue tests in `reports-page.test.tsx` — **87 new frontend tests, all passing** (this
was miscounted as "52" in this addendum's own first draft — corrected in Addendum 39 below; 87 is what
actually reconciles against the full-suite total already correctly stated next).
Full frontend suite: **776/776 passing.** `typecheck`/`lint`/`build` clean across `shared`/`backend`/
`frontend`; `typecheck:e2e` clean.

**Playwright** (`tests/e2e/specs/25-advance-recovery-report.spec.ts`, 10 tests, real backend, real
Chromium, no `page.route` interception for any RBAC or financial assertion). Fixture design note
documented in the spec's own header comment: creating an Advance whose `originalPeriod` is the current
Draft cycle immediately materializes a deduction onto that employee's own Draft `PayrollEntry` in the
same API call (`advances.service.ts`) — most scenarios therefore need no separate release step to
produce a real recovery event; an `INSTALLMENT` Advance with a `scheduledInstallmentAmount` smaller
than its `totalAmount` yields both a genuine Recovered This Cycle figure and a genuine residual Current
Outstanding Balance in one request. Covers: navigation, the no-Cycle roster, Cycle-selection revealing
Recovered This Cycle while the current balance stays byte-identical, one row per Advance (a real LOAN +
EID_ADVANCE pair for one employee), Site and Employee-lookup filters narrowing independently, the Has
Outstanding Balance tri-state, sorting/pagination, a genuine Site-A→Site-B employee-transfer scenario
(a Site-A-scoped user loses all visibility the instant the employee transfers; an explicit cross-site
403 on a direct API call; the detail page, viewed by an unrestricted admin, showing the CURRENT Site in
the Advance Summary while the Recovery History event keeps its own original HISTORICAL Site), the
detail page including a real defer call producing a structurally separate Schedule/Deferral History
entry, a nonexistent Advance's plain not-found state, CSV/XLSX export (safe headers; no CNIC/IBAN/
"account number"/correction terms anywhere in the downloaded CSV content itself; the Cycle-specific
Recovered This Cycle figure verified correct in the CSV body; XLSX verified via filename/download-
action only, per this checkpoint's own documented reliance on the backend Checkpoint 1A suite for
binary content parity), browser print (current-page scope, safe fields only, "Not selected" rather than
a fabricated zero), a 1024px responsive check (no horizontal document scroll, every filter remains
visible), and permission enforcement. **10/10 passing**, both standalone and combined with
`17-reports.spec.ts` (9/9 passing, unweakened) — **19/19 passing together.**

**Known limitations, disclosed** (matching every sibling report's own equivalent disclosures): (1) the
Checkpoint 1A site-authorization limitation (Advance visibility follows the employee's CURRENT site,
not any historical site) is a backend behavior this frontend only ever displays, never controls; (2)
`ReportPagination`'s "Showing X–Y of Z site(s)" wording is a pre-existing wart in the shared component
(originating from Project Site Payroll Report), reused unchanged rather than silently patched as an
out-of-scope side effect of this checkpoint; (3) navigating between the flat and canonical cycle-scoped
URLs remounts the page component, so in-progress filter state is not preserved across a Cycle-selector
change beyond what `location.state` explicitly restores on a Back navigation — the same accepted,
documented limitation Deduction/Overtime Report already carry.

**Verification evidence**: `frontend`/`shared`/`backend` `npx tsc --noEmit` clean (via the root
`npm run typecheck`, which also runs `typecheck:e2e`); `npx eslint .` clean (0 errors, the same 6
pre-existing Fast-Refresh warnings this repository already carried, all in files this checkpoint never
touched); `npm run build` clean (frontend production build succeeds, including the two new lazy route
chunks); full frontend Vitest suite 776/776 passing; `25-advance-recovery-report.spec.ts` 10/10
standalone; `17-reports.spec.ts` 9/9 standalone, unweakened; both combined 19/19; `git diff --check`
clean. Backend suites were not re-run — no backend/shared file changed in this checkpoint.

**Files changed**: `frontend/src/hooks/use-advance-recovery-report.ts` (new),
`frontend/src/hooks/use-advance-recovery-report.test.ts` (new),
`frontend/src/components/reports/advance-recovery-report-labels.ts` (new, + test),
`frontend/src/components/reports/advance-recovery-report-employee-lookup.tsx` (new),
`frontend/src/components/reports/advance-recovery-report-print-fields.ts` (new, + test),
`frontend/src/components/reports/advance-recovery-report-print-options-dialog.tsx` (new),
`frontend/src/routes/reports-advance-recovery-report-page.tsx` (new, + test),
`frontend/src/routes/reports-advance-recovery-report-detail-page.tsx` (new, + test),
`frontend/src/App.tsx` (3 routes + 2 lazy imports added), `frontend/src/routes/reports-page.tsx`
(catalogue card activated), `frontend/src/routes/reports-page.test.tsx` (2 tests added),
`tests/e2e/specs/25-advance-recovery-report.spec.ts` (new), `docs/architecture/workflows/reports.md`
(§19.11 added, status header updated), `docs/PROJECT_PROGRESS.md` (new Checkpoint 1B entry + Phase 7
row update), `docs/SESSION_HANDOFF.md` (this addendum). No backend, shared-contract, schema, or
migration file touched.

**Advance Recovery Report is now functionally complete (Checkpoints 0, 1A, 1B), pending independent
review.** Salary Release Report, Variance/Month-on-Month Report, and Dashboard remain **Not Started**
and require their own separate, explicit authorization — this checkpoint did not begin any of them.
**No commit, push, or deployment occurred.**

## 39. Addendum, 2026-08-10 (later same day) — Advance Recovery Report Checkpoint 1B: Independent
## Hostile Review — APPROVE WITH FIXES

A 24-section adversarial review of the still-uncommitted Checkpoint 1B frontend (Addendum 38 above)
against §19.1's frozen backend decisions and this project's own established frontend conventions.
Starting state re-verified: `main == origin/main == 4804c46682ec7c22559f3734dff516212844c27b`, working
tree limited to Checkpoint 1B's own files (docs + the 13 frontend/e2e files listed in Addendum 38's own
"Files changed"), `git diff --check` clean. Full architectural record:
`docs/architecture/workflows/reports.md` §19.12.

**One genuine production defect found and fixed (information disclosure)**: the detail page
(`reports-advance-recovery-report-detail-page.tsx`) originally rendered two different messages for a
403 ("You do not have access to this Advance... outside your current Site access") versus a 404 ("This
Advance could not be found"), reasoning this mirrored the backend's own already-shipped 403/404 split
(§19.1 decision 5, itself mirroring the Advances module's own precedent). Hostile re-examination found
this reasoning does not transfer to this surface: the Advances module's own users can only ever
construct/see an Advance id already within their own site scope, but this report's `reports:view`
population routinely holds a grant scoped to only *some* sites, and the list endpoint already filters
every visible row to the caller's own sites — so the only way any `reports:view` holder reaches an
out-of-scope `advanceId` at all is a shared/guessed direct link, on which a distinguishing 403 message
would confirm "an Advance with this id exists, just outside your Site access." **Fixed**: both states
now render byte-identical "This Advance could not be found" copy, matching Employee Payroll History's
own "reveal nothing" posture — the backend's own 403/404 status codes are untouched (this was a
presentation-only fix, per this review's own explicit remit not to alter backend semantics).

**One documentation arithmetic defect corrected, unrelated to the fix above**: Addendum 38's own "52
new frontend tests" claim was independently re-derived via Vitest's own per-file counts and found
wrong — the actual pre-review count is 87 (10+33+19+6+17 across the 5 dedicated files, +2 catalogue
tests), which is what actually reconciles against 689 (Overtime Report Checkpoint 1B's own documented
full-suite baseline) + 87 = 776, the full-suite total Addendum 38 already correctly stated. A pure
counting mistake in the summary prose — every one of the 87 tests was real, colocated, and already
passing.

**Two test-coverage gaps closed** (no existing test weakened): (1) the "Back to Report" restoration
test asserted only generic title text that would render identically on either the flat or cycle-scoped
route, despite its own comment claiming to prove the canonical URL was restored — now asserts the
restored Cycle `<select>`'s own value directly; (2) the Site-filter-narrows-away-the-selected-Employee
interaction (documented in Addendum 38's own "Filters" section) had zero test coverage in either Vitest
or Playwright, despite being the same class of restoration/clearing bug this project was previously
burned by in Employee Payroll History's own Unit-clearing mount-effect defect — a new Playwright
assertion now proves the Employee lookup genuinely collapses (not left as a hidden incompatible filter)
the instant a Site-filter change excludes the already-selected Employee's own Site.

**Three Playwright hostile-navigation regressions added**: a real browser Back/Forward round trip
across no-Cycle ⇄ a selected Cycle (necessarily single-Cycle, not two distinct Cycles — only one
`PayrollCycle` is ever in Draft state system-wide, `POST /payroll-cycles` 409s otherwise, and this spec
has no guaranteed second Cycle to select when run standalone); a direct-URL-bypass check on the DETAIL
route (Addendum 38's own Permission test only covered the list route) for a `statements:view`-only
user; the 403-concealment proof described above, appended to the existing Site-A→Site-B transfer
scenario.

**Sections hostile-reviewed with no defect found** (matching Addendum 38's own claims against the
actual code/tests, not just re-reading them): routes/permission (all three routes independently
`RequirePermission`-gated, confirmed in `App.tsx`, no catalogue-card-only permission); optional-Cycle
mechanism (no `useSelectedPayrollCycle`, no auto-redirect, confirmed via `useParams` read);
current-vs-historical field provenance (cross-checked directly against
`advance-recovery-report.service.ts`'s `mapAdvanceToRow`/`getAdvanceRecoveryReportDetail` — confirmed
independent of `cycleId`); Site/Employee-lookup single-Site-only narrowing (confirmed as this module's
own pre-existing convention, identical in `EmployeePayrollHistoryEmployeeLookup`, not a new gap); row
grain (one row per Advance, keyed on `advanceId`); totals (backend-verbatim, no client recomputation);
sorting/pagination (only the eight approved fields sortable); CSV/XLSX export parity (identical query
strings except `format`); print (current-page-only, safe vocabulary, verified via
`page.emulateMedia({ media: 'print' })` reading actual rendered content); accessibility; responsive
(1024px, no horizontal document scroll); and the disclosed cycle-switch-remounts-the-page limitation
(confirmed intentional, matching Deduction/Overtime Report's own identical precedent).

**Verification evidence**: focused Advance Recovery Report Vitest files 97/97; full frontend suite
**777/777** (was 776/776, net +1 from the new byte-identical-403/404 regression test);
`typecheck`/`lint`/`build` clean across `shared`/`backend`/`frontend` (identical pre-existing warning
counts to Addendum 38); `typecheck:e2e` clean; `25-advance-recovery-report.spec.ts` **11/11**, run
standalone twice to rule out flakiness in the newly added tests; `17-reports.spec.ts` **9/9**
standalone, unweakened; both combined **20/20**; `git diff --check` clean. Backend suites were not
re-run — no backend/shared file was touched by this review.

**Files touched by this review** (all already-uncommitted Checkpoint 1B files — no scope expansion):
`frontend/src/routes/reports-advance-recovery-report-detail-page.tsx` (403/404 concealment fix),
`frontend/src/routes/reports-advance-recovery-report-detail-page.test.tsx` (403/404 tests updated,
Back-to-Report assertion strengthened), `tests/e2e/specs/25-advance-recovery-report.spec.ts` (3 new
regressions), `docs/architecture/workflows/reports.md` (§19.12 added, status header updated),
`docs/PROJECT_PROGRESS.md` (new review entry + row-text correction), `docs/SESSION_HANDOFF.md` (this
addendum + Addendum 38's own test-count correction).

**Verdict: APPROVE WITH FIXES.** One genuine frontend information-disclosure defect fixed; one
documentation arithmetic defect corrected; two test-coverage gaps closed; three Playwright
hostile-navigation regressions added. No other production defect found across the full 24-section
review scope. **No commit, push, or deployment occurred during this review.** Advance Recovery Report
(Checkpoints 0, 1A, 1B) remains pending final authorization. No other report or Dashboard work was
started or touched.

## 40. Addendum — Phase 7 Reports, Salary Release Report: Checkpoint 0 (Architecture Review, approved) and Checkpoint 1A (Backend Foundation) — IMPLEMENTED, NOT COMMITTED

Backend, shared contracts, and backend tests only, per explicit Checkpoint 1A authorization —
Checkpoint 0's own frozen architecture decisions (business purpose, grain, cycle scope, permission,
site authorization, release-status model, Original Released Amount semantics, correction/balance-
salary boundary, actor exposure, payment method, filters, columns, totals, sorting, no detail
endpoint, export, no-schema-change target) carried over verbatim from the authorizing instruction. No
Checkpoint 1B (frontend), Variance/Month-on-Month Report, or Dashboard work. Starting state verified
first: `main == origin/main == 9a9dee19a323d44922f71cb9646ec6cff432421d`, working tree clean.

**The first Reports-module report gated on an OR permission.** Every prior report in this module
gates on exactly one permission (`reports:view` or `statements:view`). Salary Release Report gates on
`reports:view` **OR** `payroll:view` — Finance holds `payroll:view`/`payroll:release` but has never
held `reports:view`; Payroll Staff holds `reports:view` but not `payroll:view`. Gating on
`reports:view` alone would have excluded Finance, the role that actually executes releases, from a
report whose whole subject is release reconciliation. Investigated before implementation began:
`requirePermission` (`backend/src/common/middleware/require-permission.ts`) already natively accepts
either a single permission or an array (any-of semantics) — `payroll-entry.routes.ts`'s own
`VIEW_PERMISSIONS = [PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.PAYROLL_VIEW]` is the exact real
precedent this checkpoint's own `SALARY_RELEASE_REPORT_PERMISSION` reuses — no custom middleware was
written. A dedicated test proves `payroll:release` alone (without `payroll:view`) does **not** imply
access, and a real `ROLE_CODES.FINANCE`-coded agent (holding Finance's own actual permission set) is
proven allowed, not merely a synthetic `payroll:view`-only test role.

**Original Released Amount — the financial-correctness gate this checkpoint could not proceed past
without resolving first.** Before writing any implementation code, traced every Corrections/
Balance-Adjustment write path against the actual code (not the architecture docs' own claims) to
answer: can `calcNet` applied to a `RELEASED` `PayrollEntry`'s own stored columns ever change after a
later correction? Findings: `corrections.service.ts`'s `approveCorrectionRequest` never issues a
`tx.payrollEntry.update` of any kind — only `Correction`/`BalanceAdjustment`/`CorrectionRequest` rows
are written, and the entry must already be `released = true` before a correction may even be
proposed. `correctionBalancePayable`/`correctionBalanceRecovery` — the two calc-input columns a
settlement could plausibly touch — are written exclusively by `recomputeAndPersistEntryAggregates`,
whose sole caller hard-rejects any target entry with `released = true`
(`determineMaterialization`'s `TARGET_ENTRY_ALREADY_RELEASED` gate) — a materialization can only ever
land on a still-unreleased, later Draft-cycle entry, never back onto the entry that originated the
obligation. `assertEntryEditable` blocks every ordinary mutation path the instant `released = true`.
**Conclusion: yes, proven immutable — no STOP condition triggered.** This is the identical property
`employee-payroll-history.test.ts`'s own "the original released Net Salary on the main row is never
replaced by a correction-replayed figure" test already proves for an equivalent figure; this
checkpoint's own test suite (`salary-release-report.test.ts`) adds two dedicated regression tests
under its own name: one releases an entry for real, captures its amount, performs a real post-release
Correction, and verifies both the stored `PayrollEntry` row (`version`/`updatedAt` included) and the
report's own amount are byte-for-byte unchanged; the other proves a materialized settlement landing
on a *later* cycle's entry never contaminates the *originating* released entry.

**Release actor and payment method — both deliberately excluded from V1, per frozen decision.**
Released At is shown; Released By is not — `PayrollEntry.releasedBy` may represent whichever
Unit-release action happened to complete the final touched Unit for a multi-Unit entry, not a
semantically reliable "who released this employee." A derived Bank/Cash column (from `bankId IS
NULL`) was considered and rejected — the schema stores no canonical release/payment channel, and
presenting an inference as authoritative release metadata was judged the wrong call for a report this
report's own subject makes plausible to over-trust.

**Totals keep `releasedAmount` and `pendingReleaseAmount` strictly separate** — reusing Payroll
Summary's own field/bucket model (never combined into one "Total Released" figure), gated by the same
bounded fetch-and-`calcNet`/`sumMoney` strategy (`SALARY_RELEASE_REPORT_EXPORT_MAX_ROWS = 20,000`)
every sibling report's own monetary totals already use. `correctionBalancePayableTotal`/
`correctionBalanceRecoveryTotal` sum the raw stored columns across every matching row regardless of
status, mirroring Payroll Summary's own `balancePayableIncluded`/`recoveryDeducted` convention.

**Performance evidence**: seeded 10 sites × 1,000 employees × 3 cycles (30,000 total `PayrollEntry`
rows), the target cycle's own 10,000-employee population deliberately distributed across every
release-state bucket (40% RELEASED/30% PENDING/10% HELD/10% NO_PAY_DUE/10% RECOVERY_DUE — mutually
exclusive per the schema's own CHECK constraint), plus multi-Unit and corrected-entry subsets — a
committed, repeatable performance suite (12 tests) measuring the 8 representative shapes named in the
authorizing instruction with real `EXPLAIN (ANALYZE, BUFFERS)`. **No `Seq Scan` occurs on
`PayrollEntry` in any measured shape** — the existing composite
`PayrollEntry_cycleId_hold_released_payoutOutcome_idx`, `PayrollEntry_siteId_cycleId_idx`, and
`PayrollEntry_cycleId_siteId_idx` indexes already cover every filtered/sorted shape this report needs,
including `releasedAt` sorting. **No migration is proposed or recommended by this checkpoint** — see
`docs/architecture/workflows/reports.md §20.5` for the full evidence table.

**Tests**: `salary-release-report.test.ts` (51), `salary-release-report-performance.test.ts` (12),
`salary-release-report-boundary.test.ts` (6) — **69/69 new backend tests passing.**
`typecheck`/`lint`/`build` clean across `shared`/`backend`/`frontend`, `git diff --check` clean.
Combined regression run with every sibling report's own suite (`payroll-entry-row-status.test.ts`,
`project-site-payroll-report.test.ts`, `deduction-report.test.ts`, `overtime-report.test.ts`,
`advance-recovery-report.test.ts`, `employee-payroll-history.test.ts`) — **365/365 passing,
unweakened.**

**Files changed**: `shared/src/schemas/salary-release-report.ts` (new), `shared/src/index.ts`,
`backend/src/modules/reports/salary-release-report.service.ts` (new),
`backend/src/modules/reports/reports.routes.ts`, `backend/tests/salary-release-report.test.ts` (new),
`backend/tests/salary-release-report-performance.test.ts` (new),
`backend/tests/salary-release-report-boundary.test.ts` (new),
`docs/architecture/workflows/reports.md` (new §20, status header updated), `docs/PROJECT_PROGRESS.md`
(new §1 entry, §2 table row updated, §5 next-action updated), this addendum.

**Known limitations, disclosed**: (1) Released By is a genuine, deliberate V1 exclusion, not an
oversight — a future audit-focused report is the correct home if actor identity is ever needed; (2)
no Payment Method/channel field — the schema does not store one; (3) `originalReleasedAmount` is
deliberately not sortable in V1, mirroring Deduction Report's/Overtime Report's own restraint (a
`calcNet`-derived, status-gated figure, not a plain stored column) absent real usage proving the need.

**No commit, push, or deployment occurred this session** — stopped deliberately for independent
review, per explicit instruction. Checkpoint 1B (frontend), Variance/Month-on-Month Report, and
Dashboard are all explicitly **NOT** started.

## 41. Addendum, 2026-08-11 — Salary Release Report Checkpoint 1A: Independent Hostile Review — APPROVE WITH FIXES (no production defect found; regression coverage strengthened)

An adversarial, independent re-review of Checkpoint 1A above (Addendum 40), per explicit instruction.
Scope: the same uncommitted diff (repository/diff integrity re-verified: `main == origin/main ==
9a9dee19a323d44922f71cb9646ec6cff432421d`, working tree contains only Checkpoint 1A's own shared
contract/service/routes/tests/docs, no frontend/Dashboard/schema/migration/unrelated change, `git diff
--check` clean).

**Original Released Amount immutability — re-derived independently, not trusted from the checkpoint's
own doc comment.** Every `payrollEntry.update`/`updateMany` call site in the entire backend was
individually located and inspected: `payroll-release.service.ts` (the release write itself — the
Master Data Boundary's `liveMasterByEntryId` spread, including `grossPay`, is written atomically in
the same statement that sets `released: true`, never as a separate later write against an
already-released row; candidates are filtered `released: false` up front, so a row can never be
"released" twice); `corrections.repository.ts`'s `updatePayrollEntryCorrectionAggregates` (reachable
only through `recomputeAndPersistEntryAggregates`, whose sole caller hard-rejects
`targetEntryReleased: true` via `determineMaterialization`'s `TARGET_ENTRY_ALREADY_RELEASED` gate);
`advances.service.ts`'s `materializeOneAdvanceDeduction` (every call site — `createAdvance`,
`settleAdvancesForReleasedEntries`'s own release-time `Advance` settlement never touches `PayrollEntry`
— is gated on `released: false`); `eobi-sync.service.ts` (only ever targets the current Draft cycle's
entry, explicitly excluding `released`/`payoutOutcome`-resolved rows); and every path in
`payroll-entry.service.ts` (single-entry, work-line, and bulk-update) behind `assertEntryEditable`,
which rejects `released = true`, `payoutOutcome != null`, or an `ARCHIVED` cycle. This independently
confirms — from the production architecture side, not merely from `approveCorrectionRequest` never
issuing a `PayrollEntry` write — that no code path in this system can mutate a released entry's own
`calcNet` inputs. Category: **both** (A: production architecture: confirmed by direct trace; C: the
checkpoint's own two dedicated regression tests, re-run against real Postgres, also confirm it
end-to-end through the real release/correction HTTP endpoints).

**No production code defect found.** Every other claim in Addendum 40 (release-status financial
semantics, multi-Unit/Late-Entry release semantics, the OR-permission gate and its inability to widen
Site access, historical Site-A/B authorization via `PayrollEntry.siteId`, correction/balance-field
separation, Released At semantics, sensitive-field/value exclusion, the 19,999/20,000/20,001 boundary,
CSV/XLSX/list parity, sort/pagination stability, and query discipline) was independently traced against
the actual code and re-verified against real seeded-Postgres test runs — all held.

**Three test-coverage gaps were identified and closed with new regression tests** (no existing test
weakened): (1) `salary-release-report.test.ts`'s multi-status test proved `originalReleasedAmount`
is `null` for HELD/PENDING/NO_PAY_DUE/RECOVERY_DUE but never explicitly asserted `releasedAt === null`
for HELD (a plain stored column an operator's hold never touches, but never directly proven by test);
(2) no test filtered a multi-Unit `PayrollEntry` by its *second*, non-primary Unit and proved exactly
one row returned — the "Prisma's `workLines: { some }` never fans out the root row" property had only
been proven for the unfiltered case, not the filtered one the review instruction specifically named;
(3) `payroll-entry-row-status-regression.test.ts` — the cross-consumer proof that
`derivePayrollEntryRowStatus` produces identical results across every real report endpoint — had not
been extended to include Salary Release Report as a fourth consumer, despite it consuming the exact
same shared derivation. Test count is now **70, not 69** (`salary-release-report.test.ts` 52, up from
51; boundary 6; performance 12 — unchanged) — the increase is this added regression test, not a
correction of a wrong prior count (51/69 was accurate for the file set as it stood after Addendum 40).
`payroll-entry-row-status-regression.test.ts` grew from 2 to 2 tests (unchanged count, each test
extended in place to add Salary Release Report as a fourth assertion target).

**The §18-class incident narrative (contaminated DB state / stale fixture rows / Puppeteer timeouts)
this review's own instructions asked to be investigated does not apply to this checkpoint** — checked
directly, not assumed: no "ScrollInvestigation Site" or any related term appears anywhere in
`docs/SESSION_HANDOFF.md`, `docs/PROJECT_PROGRESS.md`, or the wider repository; Addendum 40 discloses
no such incident; and a live `ps aux` check during this review found exactly one, idle,
this-session's-own `payroll_dev` Postgres process and zero stray Puppeteer/Chrome-headless processes.
This class of incident belongs to a different checkpoint's own history (see the project-memory note on
known stale-process test flakiness), not this one — nothing here needed cleanup.

**Performance evidence re-verified at real volume, not re-read from Addendum 40's own table.** The full
30,000-row performance fixture was re-seeded and every `EXPLAIN (ANALYZE, BUFFERS)` shape re-run:
`Index Scan using "PayrollEntry_cycleId_idx"` (or the composite/site-scoped equivalent) on every
measured shape, zero `Seq Scan`, `releasedAt` sorting confirmed genuinely DB-native and fast (~8ms at
10,000 rows). The suite does not run a standalone `ANALYZE "PayrollEntry"` before its own `EXPLAIN
ANALYZE` calls — checked against every sibling report's own performance suite
(`deduction-report-performance.test.ts`, `project-site-payroll-report-performance.test.ts`,
`advance-recovery-report-performance.test.ts`) and confirmed this is the *majority* existing
convention in this module already (only `overtime-report-performance.test.ts` explicitly `ANALYZE`s),
not a gap this checkpoint introduced. No migration is recommended, consistent with Addendum 40's own
conclusion.

**Verification evidence**: `shared`/`backend` `npx tsc --noEmit` clean; `npm run lint` clean (0
errors, 10 pre-existing warnings confined to unrelated `backend/scripts/*.ts` files, untouched by this
diff); `npm run build` clean across `shared`/`backend`/`frontend`; `salary-release-report.test.ts`
(52/52), `salary-release-report-boundary.test.ts` (6/6, real 19,999/20,000/20,001-row volume),
`salary-release-report-performance.test.ts` (12/12, real `EXPLAIN ANALYZE`),
`payroll-entry-row-status.test.ts` + `payroll-entry-row-status-regression.test.ts` (both green),
combined with `project-site-payroll-report.test.ts`/`deduction-report.test.ts`/
`overtime-report.test.ts`/`advance-recovery-report.test.ts`/`employee-payroll-history.test.ts` —
**368/368 passing, unweakened.** `git diff --check` clean.

**Files changed by this review pass**: `backend/tests/salary-release-report.test.ts` (2 new
assertions in an existing test, 1 new regression test added, no existing test weakened),
`backend/tests/payroll-entry-row-status-regression.test.ts` (extended to a fourth report, no existing
test removed), `docs/SESSION_HANDOFF.md` (this addendum), `docs/PROJECT_PROGRESS.md`,
`docs/architecture/workflows/reports.md §20.6/§20.8` (test-count correction + this review's
findings). No other file touched. No production code changed — no genuine defect was found to fix.

**Verdict: APPROVE WITH FIXES** (fixes being the three added/extended regression tests — no
production code defect existed to fix). Migration: not recommended, independently re-confirmed
against the actual schema and real `EXPLAIN ANALYZE` evidence. Checkpoint 1B may proceed once
explicitly authorized. **No commit, push, or deployment occurred during this review.**

## 42. Addendum, 2026-08-11 (later same day) — Phase 7 Reports, Salary Release Report: Checkpoint 1B (Frontend, OR Permission Gate, Browser Print, and E2E) — IMPLEMENTED, NOT COMMITTED

Frontend, browser print, and Playwright only, per explicit Checkpoint 1B authorization — the frozen
Checkpoint 1A backend above (Addenda 40/41, independently hostile-reviewed, APPROVE WITH FIXES,
70/70 backend tests) receives no change of any kind. Starting state verified first: `main ==
origin/main == 6b5fdca33c1dc6d5d543c8811a41501f0234ccc5`, working tree clean. Two pre-existing,
unrelated files were investigated and ruled out as conflicts before any work began: a stray
`frontend/src/routes/salary-release-page.tsx` (the Phase 4 payroll *release action* page, tracked
since commit `cedf386`, an unrelated naming collision — this checkpoint's own new page is named
`reports-salary-release-report-page.tsx`, following the established `reports-<name>-report-page.tsx`
convention) and a separate, gitignored `.claude/worktrees/reports+project-site-payroll-1b/` directory
(an unrelated task's own isolated worktree, not part of this repository's tracked state).

**The first Reports-module report gated on an OR permission, carried through the frontend — and the
one place this checkpoint found a genuine, undisclosed architectural gap.** `RequirePermission`
(`components/layout/require-permission.tsx`) already accepted `permission: PermissionKey[]` with
any-of semantics (added Post-Phase-5 Stabilization Checkpoint 4B) — no new guard component was
needed, and the report's own route (`App.tsx`) was gated on `[PERMISSIONS.REPORTS_VIEW,
PERMISSIONS.PAYROLL_VIEW]` directly. But investigating the actual `/reports` catalogue route and
`ReportsPage`'s own internal `canView` check (both previously `reports:view`-only) surfaced that a
payroll:view-only Finance user could not reach the catalogue shell *at all* — failing the
authorizing instruction's own required scenario ("payroll:view-only user: catalogue access; route
access") regardless of how correctly Salary Release Report's own card/route were gated. This was
caught by the instruction's own §23 hostile self-check ("Can a payroll:view-only legitimate Finance
user really reach the page? Did the catalogue accidentally remain reports:view-only?") before
shipping, not discovered afterward.

**Fix, and the judgment call behind its shape.** Widened both the `/reports` route's own
`RequirePermission` and `ReportsPage`'s own `canView` to `hasAnyPermission(user, [REPORTS_VIEW,
PAYROLL_VIEW])`. This alone would have been unsafe in isolation — every *other* catalogue entry
(Payroll Summary, Project Site Payroll Report, Deduction Report, Overtime Report, Advance Recovery
Report) had an implicit, undeclared `requiredPermission` of "none beyond whatever gate got the user
onto this page," which was only ever safe while that page-level gate was `reports:view` alone. Left
unchanged, widening the page-level gate would have shown a payroll:view-only user five other reports'
own cards as live-looking links that still 403 on their own unchanged, still-`reports:view`-only
individual routes. Fixed by making the implicit assumption explicit:
`ReportCatalogueEntry.requiredPermission` absent now means "the ordinary `reports:view` requirement
every report before this one already assumed" (`isCatalogueEntryVisible`'s own default), so a
payroll:view-only user sees the catalogue shell and exactly the one card — Salary Release Report,
whose own `requiredPermission` is the explicit `[REPORTS_VIEW, PAYROLL_VIEW]` array — they are
actually authorized to open. Employee Payroll History's own pre-existing `statements:view` override
is untouched. Proven directly: `reports-page.test.tsx` gained tests asserting a payroll:view-only
user sees the Salary Release Report card and *none* of the five reports:view-only sibling cards, plus
the widened page-level admit/deny boundary itself — none of the pre-existing tests were weakened.

**Fixed during independent hostile review (2026-08-11) — the Reports *sidebar* nav item is now widened
to the same OR gate.** The original Checkpoint 1B submission left `nav-config.ts`'s "Reports" entry
pinned to `reports:view` alone, disclosing it as a deliberate limitation on the reasoning that sidebar
visibility is a UX convenience only, never the actual security boundary. The hostile review rejected
that as insufficient: a payroll:view-only Finance user still had no normal, discoverable navigation
path to a report whose whole subject is the releases Finance itself executes — only a bookmark, a
shared link, or direct URL entry. Fixed: `nav-config.ts`'s "Reports" item now requires
`['reports:view', 'payroll:view']`, the same any-of shape already used for the Corrections item. The
previously-frozen `nav-config.test.ts` case was updated, not preserved — "do not weaken existing
tests" means don't silently drop coverage, not "never correct a test pinning behavior the approved
architecture has since superseded." `26-salary-release-report.spec.ts`'s Finance permission test now
asserts the sidebar "Reports" link is visible and clickable before falling back to the same
direct-navigation assertions the other permission cases already use.

**Route/catalogue**: `/reports/salary-release` plus the canonical
`/payroll-cycles/:cycleId/reports/salary-release`, lazy-loaded. The catalogue's previously-disabled
card (`available: false`) is now a real link with the OR `requiredPermission` above. AppShell title
"Salary Release Report", subtitle "Release reconciliation for one payroll cycle — released, pending,
held, and resolved entries."

**Data layer** (`hooks/use-salary-release-report.ts`) mirrors `use-deduction-report.ts`'s convention
exactly: one list query (`enabled: Boolean(cycleId)`, proven by a direct hook-level suite with
`global.fetch` stubbed — empty Cycle issues zero requests, a real Cycle issues exactly one, an
unchanged re-render issues no duplicate), sorted Site ids in both query key and URL, a blob-download
export function for CSV/XLSX, and a dedicated `SalaryReleaseReportExportRowLimitExceededError`
carrying the backend's structured 413 body verbatim.

**Filters** (frozen Checkpoint 1A set only): Payroll Cycle (required, single, navigation control),
Site (multi-select), Unit (disabled unless exactly one Site selected, cleared on an incompatible Site
change, never cleared by an unrelated rerender — proven by a dedicated test), Row Status, Has
Correction (tri-state). Clear Filters restores every filter to default and resets pagination, never
touching the selected Cycle.

**Release-semantics disclosure** (§6 of the authorizing instruction) — a concise on-screen
`ReleaseSemanticsNotice` (mirrors `reports-payroll-summary-page.tsx`'s own `Info`-icon banner
convention) states Original Released Amount is fixed once released, and Correction Balance Payable/
Recovery are later, separate settlement amounts never folded back in — plain wording naming neither
`calcNet` nor any other implementation detail. The print context header carries the same disclosure
as one concise extra line, alongside every active filter — never omitting one, the Deduction Report
defect this checkpoint's own authorizing instruction named explicitly as the one not to repeat.

**Totals, table, sorting, pagination** — the backend's `SalaryReleaseReportTotals` render verbatim in
two groups (Release Amounts/Status), with the four monetary figures collapsing into the standard
"Totals are unavailable for this result size" notice (never a misleading zero) when `totalsComputed`
is `false`, while all seven status/count figures stay always-exact and always visible. The 11-column
table (Employee Code, Employee Name, Project Site, Primary Unit, Designation, Row Status, Original
Released Amount, Released At, Correction Count, Correction Balance Payable, Correction Balance
Recovery) is server-sorted on exactly the five backend-approved fields, server-paginated with the
same page-clamp-on-shrunk-total safeguard every sibling report's own Checkpoint 1B work established.
A non-`RELEASED` row always renders `—` for Original Released Amount/Released At, never a fabricated
figure. No Released By, Payment Method, banking, CNIC, correction reason, or audit actor anywhere —
none of these exist on the frozen row contract to begin with. No edit action, no "View Details"
action, no row click, no detail route — proven both by a direct component test and by a real `GET
/api/v1/reports/salary-release/:id` returning 404 in Playwright (no such route exists in the frozen
backend). No client-side summation and no `calcNet` import anywhere in this page.

**Export/Print** — Export CSV/Excel always covers the complete filtered result, never just the
current page, with request-parity proven at the URL-construction level (identical query strings
except `format`); a 413 shows the backend's own structured message via `toast.error`. Browser Print
is current-page-only, backed by a dedicated `SalaryReleaseReportPrintOptionsDialog`/
`salary-release-report-print-fields.ts` under its own versioned `salary-release-report-print-
fields:v1` `localStorage` key, defaulting to every safe card/column selected (11 cards, 11 columns,
Employee Name locked); readability thresholds (Excellent 0–4/Good 5–7/Wide 8–9/Very Wide 10+) are
reused verbatim from Overtime Report's own identical 11-column ceiling.

**Tests**: `use-salary-release-report.test.ts` (21), `salary-release-report-labels.test.ts` (6),
`salary-release-report-print-fields.test.ts` (19 — its sensitive-field sweep deliberately does not
forbid `correctionBalancePayable`/`correctionBalanceRecovery`, this report's own frozen, approved
fields, unlike every sibling report's sweep which correctly does forbid its own analogous field),
`reports-salary-release-report-page.test.tsx` (42 — the full OR-gate permission matrix, Cycle
requirement, totals including `totalsComputed: false` never rendering a financial zero, every table
column with a full sensitive-field sweep, all five statuses with no fabricated amount/timestamp on a
non-RELEASED row, Original Released Amount kept visibly separate from both correction balances at
once, server-only sorting, the page-clamp safeguard, Unit-filter compatibility clearing and an
unrelated-rerender-preserves-Unit proof, Clear Filters preserving the Cycle, export, print context) —
88 new tests across 4 dedicated files, plus 8 new tests in `reports-page.test.tsx` (the catalogue
card's OR-gate visibility matrix and the widened page-level admit/deny boundary), none weakening an
existing test — 96 new/changed frontend tests, 98 including the hostile-review sidebar fix
(`nav-config.test.ts`'s four Reports-item cases grew to six). **Full frontend suite: 875/875
passing.** `npx tsc --noEmit` clean across `shared`/`backend`/`frontend`, `npm run build` clean,
`typecheck:e2e` (`tsc -p tests/e2e/tsconfig.json`) clean, `git diff --check` clean.

**Playwright** (`tests/e2e/specs/26-salary-release-report.spec.ts`, 15 tests) — real backend, real
Chromium, no `page.route` interception for any RBAC or financial assertion. All five row statuses
constructed through real release/hold actions within one shared Draft cycle: `RELEASED` (full worked
days, a real Unit release), `HELD` (a real hold before release, excluded from the sweep), `PENDING` (a
genuinely positive net salary, never released — proving Pending Release Amount totals a real positive
figure, not a negative default-fixture net), `NO_PAY_DUE` (`eobiApplicable: false` plus the default
zero worked days, reaching `netSalary = 0` exactly, `payroll-release-eligibility.ts`'s own documented
condition), and `RECOVERY_DUE` (the default zero-worked-days fixture's own negative net through the
EOBI deduction alone, needing no changes — the same construction `02-payroll-lifecycle.spec.ts`'s own
bootstrap already documents). A dedicated Multi-Unit release test proves a real entry spanning two
Units stays non-RELEASED until both release, then resolves to exactly one row with one Original
Released Amount and one Released At, its Primary Unit column showing `"(+1 more)"`. A real
post-release Correction test submits and approves a genuine `CorrectionRequest` through the real
backend (`assertEntryIsReleased` only requires the entry itself be released, not the cycle be
Archived — no rollover/archive dance was needed) via a second reviewer session (`corrections:approve`,
self-review is blocked by `assertNotSelfReview`), proving Original Released Amount is byte-identical
before and after while Correction Count increments to 1. Site scoping and historical transfer mirrors
Overtime Report's own identical pattern (`PayrollEntry.siteId` is always historical, never the
employee's current Site) — a real employee transfer after release, the transferred-away Site B never
offered as a filter to the Site-A-scoped user, and a direct API call naming the inaccessible Site
403s. Filters, sorting/pagination, Export (CSV/XLSX, safe headers only), Print (current-page scope,
print body content asserted under `page.emulateMedia`), Responsive layout (1024px, no horizontal
document scroll), and No detail action round out the suite. **The Permission describe block proves
the full OR matrix**: `reports:view` alone and `payroll:view` alone (via a **real seeded
`FINANCE`-role** user, constructed the same way `create-scoped-user.ts`'s own doc comment describes —
upserting against the already-seeded `Role` row rather than inventing a synthetic one — never
`reports:view`) both admit; neither permission, `payroll:release` alone, and `statements:view` alone
all deny. **15/15 passing.** Combined regression run alongside every sibling report's own Playwright
spec (`17-reports.spec.ts`, `20-project-site-payroll-report.spec.ts`, `21-deduction-report.spec.ts`,
`22-overtime-report.spec.ts`, `25-advance-recovery-report.spec.ts`) — **63/63 passing, unweakened.**

**Request discipline observed** (§18 of the authorizing instruction): zero list requests before a
Cycle exists; exactly one list request per genuine filter/sort/pagination change, none for an
unrelated re-render; zero backend requests fired merely by opening or confirming Print; no client-side
all-row fetch for totals or print; export always sends the current filter/sort state with no
`page`/`pageSize`.

**Files changed**: `frontend/src/hooks/use-salary-release-report.ts` (new) + `.test.ts` (new),
`frontend/src/components/reports/salary-release-report-labels.ts` (new) + `.test.ts` (new),
`frontend/src/components/reports/salary-release-report-print-fields.ts` (new) + `.test.ts` (new),
`frontend/src/components/reports/salary-release-report-print-options-dialog.tsx` (new),
`frontend/src/routes/reports-salary-release-report-page.tsx` (new) + `.test.tsx` (new),
`frontend/src/App.tsx` (two new routes, one new lazy import), `frontend/src/routes/reports-page.tsx`
(catalogue card enabled, OR gate widened), `frontend/src/routes/reports-page.test.tsx` (8 new tests),
`frontend/src/components/layout/nav-config.ts` (Reports sidebar item widened to the OR gate — hostile
review fix), `frontend/src/components/layout/nav-config.test.ts` (Reports sidebar OR coverage updated),
`tests/e2e/specs/26-salary-release-report.spec.ts` (new; sidebar assertion added by the hostile
review), `docs/architecture/workflows/reports.md` (new §20.9), `docs/PROJECT_PROGRESS.md` (new §1
entry, §2 table row updated, §5 next-action updated), this addendum. No backend, shared-contract,
schema, or migration file touched.

**Known limitations, disclosed**: every Checkpoint 1A backend limitation (no Released By, no payment
method, Original Released Amount not sortable) carries through unchanged, since none of it is a
frontend decision to begin with. (The Reports sidebar nav item previously stayed `reports:view`-only,
leaving Finance without a discoverable navigation path — fixed during the 2026-08-11 independent
hostile review; no longer a limitation.)

**No backend/shared/schema/migration change of any kind.** No Variance/Month-on-Month Report or
Dashboard work — neither was started or touched. **No commit, push, or deployment occurred this
session** — stopped deliberately for independent review, per explicit instruction. Salary Release
Report is now fully implemented pending final authorization (Checkpoints 0, 1A, 1B).

---

## 43. Addendum, 2026-08-11 (later same day) — UAT: Payroll Entry Employee Row Actions — IMPLEMENTED, NOT COMMITTED

Small, frontend-only UAT item, not part of the Phase 7 Reports sequence — explicitly *not*
Variance/Month-on-Month Report or Dashboard, neither of which was started. Starting state verified
first: `main == origin/main == caa8e50fd25dfa0a05f0d11fbd6b47570d8576e8`, working tree clean.

**What was built**: a row-level `⋯` overflow menu in Payroll Entry (Edit Employee / Mark as Left),
placed at the frozen far-right position, using the exact same shared `EmployeeFormModal`
(`components/employees/employee-form-modal.tsx`) and newly-extracted `MarkLeftModal`
(`components/employees/mark-left-modal.tsx`) Employee Registry itself renders — one edit
implementation, one mark-left implementation, one permission (`EMPLOYEES_EDIT`, independently
enforced server-side), reused rather than duplicated. Full record, including the investigation
findings, the genuine architecture gap deliberately left open, the sticky-right judgment call, and
exact test/E2E results: `docs/PROJECT_PROGRESS.md`'s own "UAT — Payroll Entry Employee Row Actions"
§1 entry — not duplicated here in full.

**The one thing to know before touching this area again**: `markEmployeeLeft` does not remove or
exclude an employee's existing Draft `PayrollEntry` row — an employee already in the current Draft
cycle before being marked Left stays there, fully editable, until a *not-yet-built* roster-exclusion
rule is added. This was investigated and explicitly reported rather than silently invented, per the
authorizing instruction's own stop condition. Do not build that removal logic without a separate,
explicit go-ahead — it is a new business rule (which of Draft-delete / query-filter-exclude / hold /
defer-to-next-cycle-rollover the product actually wants is an open decision), not a bug fix.

**Files changed**: `frontend/src/components/employees/mark-left-modal.tsx` (new, extracted from
`employees-page.tsx`), `frontend/src/components/payroll-entry/payroll-entry-row-actions.test.tsx`
(new), `tests/e2e/specs/27-payroll-entry-employee-row-actions.spec.ts` (new), plus edits to
`employee-form-modal.tsx` (new `onUpdated` callback), `employees-page.tsx` (now imports the extracted
modal), `columns.ts`/`payroll-entry-row.tsx`/`payroll-entry-grid.tsx`/`payroll-entry-totals-row.tsx`
(the new sticky-right `actions` column, consistently across all four rendering layers),
`payroll-entry-page.tsx` (state, permission gate, cycle-targeted invalidation), and the pre-existing
`payroll-entry-alignment.test.tsx`/`payroll-entry-grid.test.tsx`/`master-data-boundary.test.tsx`/
`payroll-entry-row.test.tsx`/`payroll-entry-page.test.tsx` (updated for the two new row props and the
one documented sticky-right exception). `docs/design-system.md` gained a new "Row action menu (`⋯`)"
component-table entry.

**Verification**: full frontend suite **884/884**, `typecheck`/`lint`/`build` clean across every
workspace, `typecheck:e2e` clean, `git diff --check` clean. New Playwright spec standalone: **5/5**.
Full-suite Playwright regression (160 tests, `workers: 1`): **154 passed, 3 failed, 3 skipped** — all
3 failures independently confirmed pre-existing (exact match with this file's own already-documented
rollover/released-badge/PDF-export flaky set; the released-badge one further root-caused by direct
code inspection to a stale test expecting a per-row Correction button removed from that cell back on
2026-07-25, unrelated to this checkpoint's own purely additive final column); the 3 skips are this
checkpoint's own Historical-cycle scenario plus two pre-existing tests, all three via the same
graceful "no Draft cycle exists at this point in the sequential run" `test.skip` pattern those specs
already use elsewhere.

**No backend/shared/schema/migration change of any kind.** No Variance/Month-on-Month Report or
Dashboard work. **No commit, push, or deployment occurred this session** — stopped deliberately for
independent review, per explicit instruction.

---

## 44. Addendum, 2026-08-11 (same day, continuation) — UAT: Payroll Entry Employee Row Actions —
## RBAC Split + Draft-Payroll Removal — IMPLEMENTED, NOT COMMITTED

Continuation of §43 — two business requirements arrived after that checkpoint closed, closing both
open items it deliberately left: the RBAC question ("no separate mark-as-left permission to mirror")
and the Draft-payroll finding ("markEmployeeLeft does not remove or exclude... a new business rule,
not a bug fix"). Full record: `docs/PROJECT_PROGRESS.md`'s own "UAT — Payroll Entry Employee Row
Actions — RBAC Split + Draft-Payroll Removal" entry — not duplicated here in full.

**RBAC**: `Edit Employee` stays `EMPLOYEES_EDIT`-only. `Mark as Left` now accepts `EMPLOYEES_EDIT`
**OR** `PAYROLL_ENTRY` (`payroll:entry`, the exact operational permission `payroll-entry.routes.ts`
already gates every write on) via `requirePermission`'s existing any-of-list support —
`employees.routes.ts`'s `POST /:id/leave` — no new permission introduced, `PATCH /:id`/`/reactivate`
unchanged. Frontend `payroll-entry-row.tsx` split one `canEditEmployee` flag into two independent
ones (`canEditEmployee`, `canMarkEmployeeLeft`), each gating its own menu item.

**Draft removal**: new `removeEmployeeFromCurrentDraftCycle` (`payroll-processing.service.ts`, beside
its own inverse, `syncEmployeeIntoCurrentDraftCycle`) — resolves the actual current Draft cycle
(never the viewed one), deletes the employee's entry in it unless it has already individually
resolved (a per-Unit Late Release, left untouched — Principle 9) or a real financial obligation
(`AdvanceScheduleChange`/`BalanceAdjustmentMaterialization`, both traced by direct schema reading, the
only two FK types that can reference a still-Draft `PayrollEntry`) already points at it, in which case
it is held (`hold: true`) rather than deleted — the same convention `bootstrapPayrollEntries`'s own
departed-obligation-employee path already establishes. `markEmployeeLeft` (`employees.service.ts`)
now wraps the `Employee` update, its own audit entry, and this removal in one transaction. Reactivate
investigated and left unchanged — it already calls `syncEmployeeIntoCurrentDraftCycle`, so the
"inverse of the inverse" needed no new code.

**Verification**: 11 new backend tests (RBAC matrix + Draft removal + historical preservation +
financial-linkage retention + Reactivate restore), full backend regression sweep across
employees/payroll-processing/advances/corrections/payroll-cycle/payroll-release (368 tests total)
all green; full frontend suite 889/889; new/rewritten Playwright spec 27 (Scenarios A–E, real
permission-scoped users, real backend) 5/5. `typecheck`/`lint`/`build`/`typecheck:e2e`/`git diff
--check` all clean.

**No commit, push, or deployment occurred this session** — stopped deliberately for independent
review, per explicit instruction. Variance/Month-on-Month Report and Dashboard remain untouched.

---

## 45. Addendum, 2026-08-12 — CORRECTION to §44: the OR-gate was a confirmed defect, not the
## approved model — Mark as Left is now `PAYROLL_ENTRY`-only. IMPLEMENTED, STILL NOT COMMITTED

**This entry corrects §44 above. §44 is left unedited as a historical record — it accurately
describes what was built at the time, but what was built there does not satisfy the approved RBAC
architecture.** A forensic audit (2026-08-12) reconciled the working tree against the original stop
instruction and its later clarification, and found: `Edit Employee` and `Mark as Left` were *not*
independent, because `Mark as Left` accepted `EMPLOYEES_EDIT` **OR** `PAYROLL_ENTRY`. Under that
gate, a user holding `employees:edit` but no `payroll:entry` access could mark an employee left —
exactly the case the approved architecture forbids ("Mark as Left must NOT be granted merely
because they can edit employees, if Payroll Entry access is absent"). The audit further found this
incorrect behavior had been baked into the checkpoint's own tests as the expected/passing case
(backend `payroll-entry-employee-row-actions.test.ts`, frontend `payroll-entry-page.test.tsx`, and
this file's own E2E spec 27) — the tests were validating the implementation against itself, not
against the requirement.

**Approved RBAC model** (now implemented):

| Permission held | Edit Employee | Mark as Left |
|---|---|---|
| `payroll:entry` only | hidden/denied | visible/allowed |
| `employees:edit` only | visible/allowed | hidden/denied |
| both | visible/allowed | visible/allowed |
| neither | hidden/denied | hidden/denied |

No new permission was introduced — `PERMISSIONS.PAYROLL_ENTRY` (`payroll:entry`) already existed
and already governed every other Payroll Entry write; it now governs Mark as Left exclusively, in
Payroll Entry's own row menu and in Employee Registry's, so the two surfaces agree.

**Files changed this correction**:
- `backend/src/modules/employees/employees.routes.ts` — `POST /:id/leave`:
  `requirePermission([EMPLOYEES_EDIT, PAYROLL_ENTRY])` → `requirePermission(PAYROLL_ENTRY)`.
  `PATCH /:id` and `/:id/reactivate` unchanged (`EMPLOYEES_EDIT`-only).
- `backend/src/modules/employees/employees.service.ts` — `markEmployeeLeft`'s own doc comment
  corrected (no code-path change; the transactional Draft-removal behavior from §44 is unchanged
  and unaffected by this fix).
- `frontend/src/routes/payroll-entry-page.tsx` — `canMarkEmployeeLeft`:
  `hasAnyPermission(user, [EMPLOYEES_EDIT, PAYROLL_ENTRY])` → `hasPermission(user, PAYROLL_ENTRY)`.
  `hasAnyPermission` import removed (no longer used in this file). `canEditEmployee` unchanged.
- `frontend/src/routes/employees-page.tsx` — Employee Registry's own row menu, previously gated
  entirely on one `canEdit` flag (`EMPLOYEES_EDIT`) covering Edit/Mark as Left/Reactivate together,
  split into `canEditEmployee` (`EMPLOYEES_EDIT` — gates Edit and Reactivate, both unchanged
  server-side) and `canMarkEmployeeLeft` (`PAYROLL_ENTRY` — gates Mark as Left only). The `⋯`
  trigger itself now renders whenever either flag is true (previously `canEdit` alone).
- `frontend/src/components/employees/mark-left-modal.tsx`,
  `frontend/src/components/payroll-entry/payroll-entry-row.tsx` — stale doc comments describing the
  OR-gate corrected to describe the `PAYROLL_ENTRY`-only model.
- Tests: `backend/tests/payroll-entry-employee-row-actions.test.ts` (RBAC matrix rewritten: the
  `employees:edit only` case now asserts Mark as Left returns 403, not 200),
  `frontend/src/routes/payroll-entry-page.test.tsx` (same correction, plus a new explicit "both
  permissions" case), `tests/e2e/specs/27-payroll-entry-employee-row-actions.spec.ts` (new Scenario
  A2: an `employees:edit`-only user cannot reach `/payroll-entry` at all — the route's own
  `RequirePermission` guard already requires `payroll:entry` — so the requirement is proven via
  Employee Registry's own row menu instead, plus a direct `POST /:id/leave` bypass attempt, both
  asserting denial). No existing test was weakened or deleted.

**Requirement #2 (Draft PayrollEntry removal/hold) is unaffected by this correction** — it was
already correctly implemented in §44 and needed no change: `removeEmployeeFromCurrentDraftCycle`
still resolves the actual current Draft cycle, deletes an unreleased/unobligated entry, holds
(never deletes) one a real financial obligation already points at, never touches a released or
historical entry, and both remain covered by their existing, unmodified backend tests (verified
green below).

**Verification**:
- Focused backend: `payroll-entry-employee-row-actions.test.ts`, 11/11 passing (RBAC matrix
  corrected; Draft-removal/hold/historical-preservation cases unchanged and still passing).
- Backend regression: `employees`/`payroll-entry-draft-cycle-sync`/
  `payroll-entry-draft-roster-reconciliation`/`employee-identifier-uniqueness`/
  `employees-import-export` (123/123), plus
  `advances`/`corrections-materialization`/`corrections-service`/`payroll-cycle-finalize`/
  `payroll-cycle-rollover`/`payroll-cycle`/`payroll-release-all`/`payroll-release`/
  `payroll-release-negative-salary` (234/234) — both sweeps green.
- Focused frontend: the six Payroll Entry row-action/grid/alignment test files, 59/59. **Full
  frontend suite: 890/890** (one net new test — the added "both permissions" case).
- `typecheck` (all four workspaces + `typecheck:e2e`), `lint` (0 errors, only pre-existing unrelated
  warnings), `build` (all workspaces), `git diff --check` — all clean.
- E2E spec 27 standalone: 6/6 (5 original scenarios + new Scenario A2).
- **Full Playwright suite, once** (`workers: 1`, 161 tests): 154 passed, 4 failed, 3 skipped. Three
  failures are the already-documented pre-existing set (`07-corrections.spec.ts` Scenario 4,
  `12-corrections-completion.spec.ts` Released-badge, `15-statements.spec.ts` Export PDF) —
  reconfirmed unchanged by this fix. **One new failure not previously documented**:
  `08-role-administration.spec.ts` — "renaming a role does not change its user's access; removing a
  permission takes effect immediately" (expects `403` after removing `employees:view` from a role,
  received `200`). This diff never touches `GET /employees`, role administration, or session/
  permission-cache invalidation — confirmed unrelated by direct code inspection — and it reproduces
  deterministically when the spec is run alone, so it is not this fix's own flakiness surfacing
  differently. **Not investigated or fixed here — out of scope for this RBAC correction; flagged for
  separate attention**, likely a permission-cache invalidation timing issue (the user's very next
  request after a role's permission is edited via the UI still succeeds once before the removal
  takes effect).

**No commit, push, or deployment occurred this session.** Variance/Month-on-Month Report and
Dashboard remain untouched. **This checkpoint (§43 + §44 + this correction) is still not authorized
for commit** — leave the working tree as-is for a fresh independent hostile review.

## 46. Addendum — Phase 7 Reports, Variance / Month-on-Month Report: Checkpoint 0 (Architecture
Review, approved) and Checkpoint 1A (Backend Foundation) — IMPLEMENTED, NOT COMMITTED

Backend, shared contracts, and backend tests only, per explicit Checkpoint 1A authorization —
Checkpoint 0's own frozen architecture decisions (business purpose, two-explicit-cycle model,
employee-grain pairing, population classification, Direction, financial basis, correction boundary,
transfer/Unit context, permission, two-sided Site authorization, filters, sorting, totals, no
detail page, export, performance strategy, no-schema-change target) carried over verbatim from the
authorizing instruction. No Checkpoint 1B (frontend), Dashboard, or unrelated report work. Starting
state verified first: `main == origin/main == a14d425083bd14653a3022bcf30ef13bff8511e5`, working
tree clean.

**The first cross-cycle report in this module.** Every prior report (§15–§20 of
`docs/architecture/workflows/reports.md`) is scoped to exactly one Payroll Cycle at a time; several
explicitly disclaim cross-cycle comparison as this report's own future territory (Payroll Summary's
own §3, Deduction Report's §17.1.1, Overtime Report's §18.1.1). Report grain is one row per
Employee, paired by `PayrollEntry.employeeId` across two explicit, independently-choosable Cycles
(`currentCycleId`/`comparisonCycleId`) — arbitrary, non-adjacent comparison is permitted; the API
never infers "previous month." Population classification (New/Departed/Continued) is derived purely
from `PayrollEntry` row presence/absence on each side, proven independent of `Employee.dateOfLeaving`
by a dedicated test (an active employee with `dateOfLeaving IS NULL` and no current-side entry is
still classified `DEPARTED`). Direction (Increased/Decreased/Unchanged) applies only to `CONTINUED`
rows — a `NEW`/`DEPARTED` row is never represented as a salary change from/to zero. Financial basis
is canonical `calcNet` over each side's own stored `PayrollEntry` columns, identical in spirit to
Salary Release Report's own "Original Released Amount" precedent — corrections are existence-only
context (`hasComparisonCorrection`/`hasCurrentCorrection`), never replayed into the compared figure.

**Query strategy — the one genuine architectural departure from every sibling report.** No single
Prisma query can express "this employee's row in a different Cycle," so `variance-report.service.ts`
fetches each Cycle's own accessible candidate rows independently and pairs them in application
memory by `employeeId` (safe and unambiguous because of `PayrollEntry`'s own `@@unique([cycleId,
employeeId])` constraint). This means the report cannot avoid materializing every accessible
candidate row on **both** Cycles regardless of which page is requested — a real, disclosed cost
`variance-report-performance.test.ts` measures directly at ~10,000-employees-per-cycle scale (all
ten required query shapes complete in ~2s each; `EXPLAIN (ANALYZE, BUFFERS)` confirms `Index Scan`
via the existing `PayrollEntry_cycleId_hold_released_payoutOutcome_idx`/
`PayrollEntry_siteId_cycleId_idx` indexes, never `Seq Scan` — no new index required).

**Two-sided Site authorization — the security invariant this checkpoint's own test suite caught a
real pre-sign-off defect in.** The frozen rule: a `CONTINUED` employee is visible only when *both*
sides are individually accessible against the caller's full accessible-Site set
(`PayrollEntry.siteId`, never `Employee.siteId`); one inaccessible side must make the row
*completely absent* — never shown as a misclassified `NEW`/`DEPARTED` row, never with a partial or
redacted side, never with a variance amount computable against a value the caller couldn't
otherwise see. The first implementation pre-filtered each side's own fetch to accessible Sites
*before* pairing — which meant a genuinely `CONTINUED` employee with one inaccessible side was built
from the other side's data alone and misclassified as `NEW` or `DEPARTED`, and shown, in direct
violation of the frozen rule. The dedicated two-sided-authorization tests in
`variance-report.test.ts` caught this immediately, before any review was sought. **Fix**: a second,
deliberately Site-*unfiltered* existence-only query per side (`fetchExistingEmployeeIds` — returning
only the bare set of `employeeId`s with any entry in that Cycle, never a Site, an amount, or any
other field), cross-checked against every candidate pair to suppress a row outright whenever a side
that *globally* exists was not also fetched as data. This existence check leaks nothing to the
client — a suppressed row's non-appearance is indistinguishable from that employee never having
existed in that Cycle at all.

**A second real defect, also caught by this checkpoint's own boundary test before sign-off:** this
report's own correction-existence batch lookup spans **both** Cycles' candidate sets — up to
~40,000 entry ids at the real 20,001-employee-per-cycle boundary-test scale — enough to exceed
PostgreSQL's hard 32,767-bind-parameter-per-statement limit in a single `IN (...)` clause (`too many
bind variables in prepared statement, expected maximum of 32767, received 40003`, a genuine
`prisma.correction.groupBy()` failure reproduced and fixed, not a hypothetical). Fixed by chunking
at `CORRECTION_LOOKUP_CHUNK_SIZE = 5,000` — still a small, bounded number of calls at design-floor
scale (verified: fewer than 10 `groupBy` calls at the ~19,000-entry-id performance fixture), never
one call per row.

**Totals**: population/Direction/Site-Transfer/corrected-entry counts are always exact, regardless
of `matchingCount` — they fall out of the same pairing pass this report's own grain already
requires, unlike a sibling report's independent single-table status counts. The four monetary
fields are gated by the standard `VARIANCE_REPORT_EXPORT_MAX_ROWS = 20,000` ceiling.
`aggregateVariancePercent` is derived from the two aggregate totals themselves — a dedicated test
constructs a fixture whose aggregate percent deliberately differs from every individual row's own
percent, proving the two are never averaged/summed together.

**Tests**: `variance-report.test.ts` (48), `variance-report-boundary.test.ts` (8, real
19,999/20,000/20,001-row proof), `variance-report-performance.test.ts` (11) — **67/67 passing**.
Every sibling report's own suite plus `payroll-entry-row-status`/`-regression` re-run unweakened —
**382/382 passing**. Full repo typecheck (`shared`/`backend`/`frontend`) clean, backend lint clean
(zero errors, only pre-existing unrelated warnings), backend build clean, `git diff --check` clean.
Files changed: `shared/src/schemas/variance-report.ts` (new), `shared/src/index.ts` (purely
additive), `backend/src/modules/reports/variance-report.service.ts` (new),
`backend/src/modules/reports/reports.routes.ts` (purely additive, 0 lines removed), three new test
files. No existing report's code was modified.

**No commit, push, or deployment occurred this session.** Checkpoint 1B (frontend) and Dashboard
remain untouched. **This checkpoint is not authorized for commit** — leave the working tree as-is
for independent hostile review.

## 47. Addendum — Phase 7 Reports, Variance / Month-on-Month Report: Checkpoint 1B (Frontend,
## Dual-Cycle UI, Browser Print, and E2E) — IMPLEMENTED, NOT COMMITTED

Frontend-only, per explicit Checkpoint 1B authorization, over the frozen Checkpoint 1A backend §46
above — no backend, shared-contract, or database change. Starting state verified first: `main ==
origin/main == 6f8d1f7d73520182921e56b8506ca2391804f39e`, working tree clean.

**The first Reports-module frontend needing two independent Payroll Cycles at once.** Every prior
report's own frontend (§15.1–§20.9) manages exactly one Cycle, most via the shared
`useSelectedPayrollCycle` hook and its dual flat/`:cycleId`-nested route pair. Variance cannot reuse
that pattern — a single path segment cannot name two independent Cycles — so `/reports/variance`
carries both `currentCycleId`/`comparisonCycleId` in its own query string instead, read directly off
`useSearchParams()` every render rather than mirrored into `useState`. This is the one design choice
this checkpoint leaned on hardest: because both ids are read from the same `URLSearchParams` object
in the same render, there is no code path where one is stale while the other is fresh — "never
briefly display stale comparison data under the new selection" (the authorizing instruction's own
§4) falls out of the architecture rather than needing a defensive check.

**Smart default, never a forced pick.** A `useEffect` fills `currentCycleId` via the existing
`resolveDefaultCycleId` (Draft → newest Released → newest Archived), then, only once Current is
known and no explicit `comparisonCycleId` is already present, fills the immediately-preceding Cycle
by index into the already-newest-first Cycle list. When Current is the single oldest Cycle in the
system, this resolves to nothing — proven by a dedicated one-Cycle-fixture test — rather than ever
defaulting to comparing a Cycle against itself. An already-explicit `comparisonCycleId` (arbitrary,
non-adjacent, or otherwise) is never overridden.

**Data layer** (`hooks/use-variance-report.ts`) mirrors every sibling report hook's own convention,
with one structural difference: `enabled: Boolean(currentCycleId) && Boolean(comparisonCycleId)`
instead of a single-Cycle `Boolean(cycleId)` gate — proven by 21 direct hook-level tests (zero
requests with either Cycle empty, exactly one request once both are present, a genuinely second
request when Comparison changes while Current stays fixed, no duplicate from an unrelated
re-render). Employee lookup (`variance-report-employee-lookup.tsx`) is a deliberate fork of Employee
Payroll History's own component, over this report's own `/reports/variance/employees` endpoint —
matching that component's own doc comment, which already named a third historical-discovery
consumer as the point to extract a shared base; that extraction stays out of scope here, same as
Salary Release Report's own precedent of not forcing a premature abstraction.

**Population/Direction presentation** — two independent badge columns
(`variance-report-labels.ts`): NEW is blue, DEPARTED is gray, CONTINUED is green (a population
change is never itself "good" or "bad," so neither uses red/amber); INCREASED is green, DECREASED
is red, UNCHANGED is gray. **One disclosed judgment call**: Direction is rendered as its own table
column, one field beyond the authorizing instruction's own §9 "should include" list (which does not
name it explicitly) — given §10's own extensive treatment of Direction as an independent dimension
and the existing Direction filter, a filtered result with no on-screen field showing what was
filtered on would be a worse design than the instruction's own minimum. Every missing-side financial
field renders through the existing shared `formatMoney` (already `—`-for-`null`) or a
`!== null`-guarded `${value}%` — this page never computes a financial value, only formats what the
backend already computed, so Infinity/NaN is structurally unreachable, not just avoided by
convention.

**Second disclosed judgment call**: Clear Filters preserves sort, matching Salary Release
Report's/Employee Payroll History's own established convention rather than inventing a third
behavior this project's own siblings hadn't already settled on.

**Print/Export/EPH drill-down** — a fresh print field vocabulary (13 summary cards, 14 table
columns, `variance-report-print-fields:v1`), current-page-only, zero backend requests from Print
(proven directly, both in the unit suite and in the E2E spec by counting real network requests
during the Print flow); export carries both Cycle ids plus every filter/sort, never `page`/
`pageSize`, CSV/XLSX request-parity proven directly. "View Full History" navigates to Employee
Payroll History via the exact `location.state.listState` mechanism that page's own list already
reads on mount — no new Variance-specific detail query, no duplicate correction/history page.

**Tests**: `use-variance-report.test.ts` (21), `variance-report-labels.test.ts` (5),
`variance-report-print-fields.test.ts` (21), `reports-variance-report-page.test.tsx` (53) — **100
new frontend tests** (corrected during independent hostile review — the original count of 104/"9
labels" mismatched the actual 5 tests in `variance-report-labels.test.ts`). Full frontend suite:
**1002/1002** on three consecutive full-suite runs during review (the previously-reported single
`payroll-entry-grid.test.tsx` failure did not reproduce; no code linkage exists between the Variance
diff and that file, and this diff never touches Payroll Entry). `typecheck` (all workspaces), `lint`
(0 errors, only pre-existing unrelated warnings), `build`, `typecheck:e2e`, `git diff --check` all
clean.

**E2E** (`tests/e2e/specs/29-variance-report.spec.ts`, new, 10/10 passing against the real backend)
— a real month-end rollover (Finalize + Archive-and-create-next, the identical real construction
`19-employee-payroll-history-frontend.spec.ts` already established) produces two genuine Payroll
Cycles. One comprehensive scenario proves New/Departed/Continued (Increased/Decreased/Unchanged), a
zero-Comparison-Net row (no Infinity/NaN in real rendered output), a real Site Transfer (the
employee's Site is patched *before* rollover, so the already-created Comparison-side entry stays
pinned to the old Site while rollover's own freshly-materialized Current-side entry picks up the
new one — the same "historical entry never retroactively changes" principle Salary Release Report's
own spec already proved, applied here across two Cycles instead of one), a real Unit Change, and
real correction context (approved by a second reviewer session, never the requester). Separate tests
cover two-sided Site authorization (a Site-A-only user sees a same-Site row in full but never the
Transfer row, whose Current side sits at Site B — re-verifying at the frontend a rule the backend's
own Checkpoint 1A test suite already caught a real defect in), export, print, the EPH drill-down,
the catalogue card plus no-detail-endpoint confirmation, and the permission gate (`reports:view`
alone admits; `payroll:view` alone — unlike Salary Release Report — is denied, proving Variance
genuinely has no OR gate). Combined regression run with `17-reports.spec.ts`/
`19-employee-payroll-history-frontend.spec.ts`/`26-salary-release-report.spec.ts`: **39/39 passing**,
including this spec running immediately after 19's own rollover of the shared Draft cycle.

**Files changed**: `frontend/src/hooks/use-variance-report.ts` (new) +
`use-variance-report.test.ts` (new); `frontend/src/components/reports/variance-report-labels.ts`
(new) + its test; `variance-report-print-fields.ts` (new) + its test;
`variance-report-print-options-dialog.tsx` (new); `variance-report-employee-lookup.tsx` (new);
`frontend/src/routes/reports-variance-report-page.tsx` (new) + its test; `frontend/src/App.tsx`
(additive: one lazy import, one route object); `frontend/src/routes/reports-page.tsx` (additive:
one catalogue entry); `tests/e2e/specs/29-variance-report.spec.ts` (new). No existing report's own
file was modified beyond the two purely-additive edits. No backend, shared-contract, or database
file touched.

**No commit, push, or deployment occurred this session.** Dashboard remains untouched. **This
checkpoint is not authorized for commit** — leave the working tree as-is for independent hostile
review.

## 48. Addendum — Dashboard Checkpoint 1B (Frontend, UI, and E2E) — IMPLEMENTED, NOT COMMITTED

Frontend-only, per explicit Checkpoint 1B authorization, over the frozen Checkpoint 1A backend
(committed as `c30cf8c2f49feaa23fff9ce5225202e05d41cc6a` — Dashboard Checkpoint 1A's own record is
in `docs/PROJECT_PROGRESS.md`, not this file, since it predates this addendum log catching up).
Starting state verified first: `main == origin/main == c30cf8c2f49feaa23fff9ce5225202e05d41cc6a`,
working tree clean.

Replaces the Phase-1 `HomePage` placeholder at `/` with the real Dashboard. Route and sidebar nav
gate both widened from "always visible" to `reports:view OR payroll:view` — the same any-of gate
the frozen backend route already enforces — so a `statements:view`-only session now sees
`AccessDeniedPage` at `/` rather than a Dashboard that would have rendered every widget `null`.

**The data hook is the simplest in this codebase** (`use-dashboard.ts`): `GET /api/v1/dashboard`
takes no request parameters, so its query key is one fixed constant, never params-derived — "one
request, no fan-out" falls out of that shape rather than needing a runtime guard. Every widget
renders the backend's own value verbatim (no `calcNet`, no arithmetic on any money field anywhere in
the Dashboard frontend). **The one deliberate design decision this checkpoint leaned on**: a
cycle-scoped widget's `null` is disambiguated via the response's own `cycle` field — "No active
cycle" when `cycle` itself is `null`, "Unavailable" when a cycle exists but the caller lacks that
widget's own permission — surfacing the schema's own frozen "a caller can always distinguish these"
contract as two genuinely different user-facing messages instead of one generic string.

**A real defect found and fixed before sign-off, not by the backend but by the frontend's own E2E
suite**: `page.goto('/')` used as a same-URL reload of the bare root path (while already on it)
reliably produces two `/api/v1/dashboard` requests — the first `net::ERR_ABORTED` within ~2ms,
before it ever reaches the backend. Root-caused via a controlled repro (reproduced identically for
`/`, never for `/employees`'s own same-URL reload, and never for a *fresh* landing on `/` via login
or cross-route navigation) to a `vite preview`/Chromium root-path navigation artifact — not a
`useDashboard` or React Query defect, and not a real backend fan-out (the aborted request never
leaves the browser's own queue: no doubled audit-log entry, no doubled aggregation query). Every
E2E request-count assertion now measures a genuine fresh landing, documented directly in the spec's
`gotoDashboard` helper so a future session doesn't have to re-derive this.

**Tests**: `use-dashboard.test.ts` (11), `dashboard-labels.test.ts` (13), `home-page.test.tsx` (16),
6 new cases added to the pre-existing `nav-config.test.ts` — 46 new frontend tests. Full frontend
suite **1043/1043**. `typecheck` (all four workspaces), `lint` (0 errors, only pre-existing unrelated
warnings), `build`, `git diff --check` all clean.

**E2E** (`tests/e2e/specs/30-dashboard.spec.ts`, new, 10/10 passing against the real backend, no
`page.route` mocking of core Dashboard data) — initial load with exactly one Dashboard request; a
`payroll:view`-only user (Finance-shaped: reports-only widgets read Unavailable, payroll-gated ones
don't); a `reports:view`-only user (the inverse, `totalEmployees` Unavailable); denied without
either permission, with the sidebar link's own exact-name absence checked (not the substring-matching
"Back to Dashboard" button `AccessDeniedPage` itself renders — a locator precision fix made during
this checkpoint's own review, not a product defect); a Site-scoped user whose `siteScope`/Site
Payroll Summary never include an inaccessible Site; **financial reconciliation** — Dashboard's own
`netPayroll` compared live against the Payroll Summary Report's `cycleTotals.netSalary` for the
identical cycle; Attention Required links landing on their correct existing routes; responsive
layout at 1440/1024/768px with no document horizontal scroll; a privacy sweep; and request discipline
(one Dashboard request, zero fan-out to any of the five per-widget report endpoints it could have
independently re-fetched). Combined regression run with `03-navigation.spec.ts`/`17-reports.spec.ts`/
`26-salary-release-report.spec.ts`/`29-variance-report.spec.ts`: **49/49 passing**.

**Known limitation, disclosed rather than fixed**: `AccessDeniedPage`'s shared "Back to Dashboard"
button always links to `/`. For the one session shape this checkpoint newly makes possible (neither
`reports:view` nor `payroll:view` held), that button now leads to a second Access Denied page
instead of a real destination — not a crash or a loop, but a dead end. `AccessDeniedPage` is a
shared layout component this checkpoint was instructed not to modify without a genuine regression;
left for a future session's explicit decision.

**Files changed**: `frontend/src/hooks/use-dashboard.ts` (new) + its test;
`frontend/src/components/dashboard/dashboard-labels.ts` (new) + its test;
`frontend/src/routes/home-page.tsx` (rewritten) + its new test; `frontend/src/App.tsx` (`/` route
wrapped in `RequirePermission`, additive); `frontend/src/components/layout/nav-config.ts` (Dashboard
item's `requiredPermission` added) + its test; `tests/e2e/specs/30-dashboard.spec.ts` (new). No
backend, `shared/src/schemas/`, `shared/src/index.ts`, Prisma schema, or migration file touched — no
Variance, Payroll Entry, or unrelated report file touched.

**No commit, push, or deployment occurred this session.** **This checkpoint is not authorized for
commit** — leave the working tree as-is for independent hostile review.

## 49. Addendum — Dashboard Checkpoint 1B, Targeted UAT Remediation — IMPLEMENTED, NOT COMMITTED

Same session, narrowly-scoped follow-up authorized specifically to fix two UX defects independent
review found in §48's build — nothing else touched (no backend/`shared`/route-gate/cycle-resolution/
Site-authorization/financial-source/one-request-contract change).

**Fixes §48's own disclosed "Known limitation."** `AccessDeniedPage` gained one optional prop,
`hideHomeAction` (default `false`, every non-Dashboard caller unchanged), threaded through
`RequirePermission` and set only where `App.tsx` wires the `/` route — a user denied Dashboard access
now sees Access Denied with no action that relinks to the same denied route.

**Site Payroll Summary drill-down honesty.** Every row previously linked to the same unfiltered
Payroll Summary report (`ReportsPayrollSummaryPage` has no Site-filter mechanism to land on), which
implied a Site-specific drill-down that didn't exist. Site name is now plain text, not a `Link`; one
honest, always-present card-level "View Payroll Summary" action replaces the misleading row-level
one.

**Tests**: `require-permission.test.tsx` (2, new), `home-page.test.tsx` (+2), a strengthened
`30-dashboard.spec.ts` denied-state assertion, and one new `30-dashboard.spec.ts` E2E test for the
Site Summary honesty fix. Full frontend suite **1047/1047**; `typecheck`/`lint`/`build`/
`typecheck:e2e`/`git diff --check` all clean. `docs/architecture/workflows/dashboard.md` and
`docs/PROJECT_PROGRESS.md` updated with matching addenda (§15.1 and the new "Dashboard Checkpoint 1B
— Targeted UAT Remediation" entry respectively) — §48's own record above is left as-is.

**No commit, push, or deployment occurred this session.** Not authorized for commit; no other
roadmap work started.

## 50. Addendum, 2026-08-24 — Reliability Phase 5: Node 24 Runtime Contract (Checkpoints 1A/1B) merged; Payslips N+1 Guard (Checkpoint 2B diagnostic → 2C permanent) merged; Phase 5 PAUSED for a higher-priority v1.0.0 Payroll Entry issue

Closes out Reliability Phase 5 Checkpoint 2C, pauses the phase. Full technical record:
`docs/PROJECT_PROGRESS.md`'s own "Reliability Phase 5 — Node 24 Runtime Contract (Checkpoints
1A/1B) and Payslips N+1 Guard (Checkpoint 2B/2C)" §1 entry — this addendum is the session-chronology
summary, not a duplicate of that record.

**Node 24 runtime contract (Checkpoints 1A/1B).** CI/dev/Render moved off Node 20 (EOL
2026-04-30, and silently failing Puppeteer 25.x's `>=22.12.0` engine requirement) to Node 24.19.0
across `.github/workflows/ci.yml`, `package.json` `engines.node`, `.nvmrc`, and `render.yaml`'s
`NODE_VERSION` (Render env var, since `rootDir`-scoped services can't see root-level version files).
No dependency/lockfile/application-code change. Merged via PR #11 as `ecf186d`, all-green.

**Payslips N+1 guard.** The historical `payslips.test.ts` aggregate query-count flake (intermittent
9-vs-8, and on an earlier occasion 8-vs-7 — `docs/release/KNOWN_ISSUES_v1.0.md` KI-10) came from a
bare total-count equality assertion that couldn't tell a real regression apart from one harmless
statement landing in only one measured window. Checkpoint 2B (branch
`reliability/checkpoint-2b-n1-diagnostic`, PR #12) added purely observational per-query
instrumentation without touching the existing assertion; five independent same-SHA CI runs all
showed an identical steady-state of 8 application queries in a fixed shape, but never reproduced the
historical extra statement — that exact query remains unidentified, and Checkpoint 2C's design does
not depend on it being found. Checkpoint 2C (branch `reliability/checkpoint-2c-payslips-n1-guard`,
PR #13, `f77af3e`) replaced the aggregate count with an exact per-table/per-operation
application-query fingerprint comparison between a 2-employee and 10-employee call; every captured
query is classified as `application`, `lifecycle` (connection/session bookkeeping, excluded from the
comparison), or `unknown` — an `unknown` query fails the test outright instead of being silently
absorbed. No tolerance, retry, sleep, or skip; test-only change, no production code touched.
`payslips.test.ts` passed all 6 CI attempts during development, plus 3 clean full-gate observations
at `f77af3e` (Backend all 6 shards / Frontend / E2E all SUCCESS), including PR #13's own pre-merge
gate.

**Merge and cleanup.** PR #13 merged to `main` as merge commit
`ed95d6f02cae4ce5b0755f2998006b4f0a805e01`; the merge-triggered post-merge CI run on `main`
(Backend/Frontend/E2E) was all-green. PR #12 was confirmed never merged (its head is not an ancestor
of `main`) and its diff confirmed to contain only temporary, self-described diagnostic
instrumentation (no unique permanent code) before being closed as superseded and its remote branch
deleted; the PR itself remains visible on GitHub as closed, and its diagnostic findings are preserved
in `docs/PROJECT_PROGRESS.md`.

**Unrelated, still-open, separately-tracked flakes** observed during Checkpoint 2's reruns and
explicitly out of this checkpoint's scope: `employee-payroll-history.test.ts` query-count assertions,
`corrections-service.test.ts` concurrent approval behavior, `statements.test.ts` query-count
assertions. None were investigated or touched here.

**Reliability Phase 5 Checkpoint 2C: COMPLETE.** Reliability Phase 5 overall is **PAUSED** —not
closed out, not continuing to Checkpoint 3 or any further checkpoint — because a higher-priority
v1.0.0 Payroll Entry correctness issue has been identified ahead of the **August 30, 2026** payroll
launch. **Do not begin Phase 5's next checkpoint, and do not investigate the Employee Payroll
History / Corrections / Statements flakes above, until the Payroll Entry issue is resolved and Phase
5 is explicitly resumed.** No Payroll Entry code was modified in this session.

## 51. Addendum, 2026-08-24 (later same day) — v1.0.0 RELEASE BLOCKER: Payroll Entry Working-Days Aggregation and Export Correctness — IMPLEMENTED, PR #14 CI GREEN, Draft PR still open, NOT merged, NOT deployed

Full technical record: `docs/PROJECT_PROGRESS.md`'s own "v1.0.0 RELEASE BLOCKER — Payroll Entry
Working-Days Aggregation and Export Correctness" §1 entry, including the complete export-contract
audit table. This addendum is the session-chronology summary and the mandatory manual UAT checklist.

**Business rule fixed.** A split-unit employee's Payroll Entry grid parent row, sticky totals row
footer, and CSV/XLSX export all derived "Working Days" from the *primary* work line only
(`workLines[0].days`), understating a genuinely split employee's total (e.g. 10 days at Unit A + 10
at Unit B displayed as 10, not 20). Root-caused to three independent read sites sharing one bug
pattern; salary calculation itself (`calcNet`'s `earnedAmount`/`otEarned`) was already correctly
summing across every line — this was strictly a display/audit-surface defect, proven not a
payment-correctness one by a dedicated financial-regression test.

**Canonical fix.** One new field, `totalWorkingDays`, added to `calcNet`'s own result
(`shared/src/lib/calc-net.ts`) — `SUM(workLines.days)`, computed inside the existing per-line
summation loop. The grid, the footer, and the backend export now all read this one field; none
re-derive it. A multi-unit row's Working Days cell became read-only (edits continue exclusively via
the existing Split-by-Unit modal); a single-unit row (the common case) is byte-for-byte unchanged.

**Export made faithful to the grid.** Nine columns appended after the existing `Released` column
(nothing removed or repositioned): `Net Salary`, `Bank`, `Bank Name`, `Branch Code`,
`Account Number`, `IBAN`, `Deputed Branch Code`, `Deputed Branch Name`, `Unit Working Days
Breakdown`, `Remarks`. `Bank`/`Bank Name` deliberately kept as two separate, already-existing fields
rather than inventing a "Branch Name" the schema has no field for (approved product decision —
this schema has no bank-*branch*-name column anywhere, only a free-text `branchCode`).

**Deliberately out of scope, disclosed rather than silently fixed:** `OT Hours` has the exact same
latent primary-line-only defect pattern in the grid/footer/export (confirmed architecturally — the
underlying architecture doc's own framing groups `days`/`hours` together, and `calcNet` already sums
`otEarned` across lines the same way it sums `earnedAmount`) — not touched in this checkpoint, since
it was not part of the reported defect or this checkpoint's explicit acceptance criteria, and this
is a hard-deadline release-blocker fix, not the moment to expand scope. Flagged for a future,
separately-authorized checkpoint.

**Tests.** `backend/tests/calc-net.test.ts` (pure, no DB) — single-unit unchanged, 10+10=20,
7+13=20, a three-line 5+8+9.5=22.5 split, and an explicit financial-regression proof that
`earnedAmount`/`otEarned`/`totalEarning`/`totalDeduction`/`netSalary` are byte-for-byte unchanged —
**25/25 passing, run locally.** `frontend/src/components/payroll-entry/calc-input.test.ts` and
`payroll-entry-row.test.tsx` — footer-sum and read-only-vs-editable rendering coverage, including a
mixed single-/multi-unit roster asserting the footer total is exactly 72.5 — **run locally,
passing.** Full frontend suite **1063/1063**. `backend/tests/payroll-entry-import-export.test.ts` —
new export-contract tests (multi-unit totals/breakdown, every new banking column, live-bank-overlay
resolution, Remarks, CSV/XLSX parity) — written but **not run locally, no PostgreSQL available in
this sandbox** (explicit instruction: do not fake it) — verified instead by PR #14's own CI, which
caught and drove the fix of two real bugs in these new test fixtures (see "CI / PR" below).
`typecheck` (all 4 workspaces)/`lint`/`build`/`git diff --check` all clean throughout.

**CI / PR.** Branch `fix/v1-payroll-entry-audit-export`, **PR #14** (draft), cut from `main` at
`44c1dbe1ee80e4b54d6cf4c0bdfdf6d83f8892cf` (the documented Reliability Phase 5 Checkpoint 2C closeout
commit). Three CI runs: the first two failed — both failures confined entirely to this checkpoint's
own new `payroll-entry-import-export.test.ts` fixtures, never production code (a fixture-ordering
gotcha this same file's own pre-existing tests already document, a missing `accountNumber` silently
tripping `employees.service.ts`'s own banking invariant on an unrelated fixture, and one
unreproducible-without-DB test folded into an already-passing one rather than debugged further — full
root-cause detail in `docs/PROJECT_PROGRESS.md`'s own entry for this checkpoint). The third run, head
commit **`cc5f851edb943258b12913349b535bffd93f3e4c`**, is **fully green: Backend (all six shards)
SUCCESS, Frontend SUCCESS, E2E SUCCESS** —
<https://github.com/ossamah8229/Payroll-Management-System/actions/runs/32741314385>.

**Manual UAT checklist (not yet performed against a real browser session in this sandbox):**

1. Open Payroll Entry for a Draft cycle.
2. Find (or create) a known multi-unit employee — one entry with two `PayrollEntryWorkLine`s at
   different Units.
3. Open the "Split by {unitLabel}" modal via the row's Units pill; confirm each line's own days
   (e.g. 10 and 10).
4. Confirm the parent grid row's Working Days cell equals the sum of the lines shown in the modal
   (20, not 10) and is no longer a directly-editable input for this row.
5. Confirm the sticky totals row footer's Working Days total incorporates the full sum for every
   row in the filtered roster (not just primary lines).
6. Export the cycle to XLSX.
7. Confirm the exported `Branch Code` column is present and correct.
8. Confirm the exported `Bank Name` column is present and correct (and, separately, that no column
   is mislabeled "Branch Name").
9. Confirm every other expected grid business column is present per the export-contract audit table
   (`docs/PROJECT_PROGRESS.md`'s own entry for this checkpoint).
10. Confirm the exported `Days` total for the multi-unit employee is 20, and that `Unit Working Days
    Breakdown` names both units with 10 each.
11. Confirm a single-unit employee's export row is unaffected — `Days` unchanged, breakdown column
    blank.
12. Confirm the multi-unit employee's Net Salary in the export reconciles with the pre-fix value
    (unaffected by this checkpoint, since `calcNet`'s earning formula was never touched).

**No production mutation was used to create test data — every scenario above uses ordinary Draft-cycle
fixtures.** **CI is green; this manual UAT checklist is the one remaining item before PR #14 itself
can be merged.** **This checkpoint is a v1.0.0 RELEASE BLOCKER, not optional Phase 5 debt — do not
resume Reliability Phase 5, and do not begin any other roadmap work, until it is resolved.**

## 52. Addendum, 2026-08-24 (later same day) — v1.0.0 RELEASE BLOCKER: Manual UAT PASSED, one wording defect found and fixed, awaiting fresh CI before merge

Full technical record: `docs/PROJECT_PROGRESS.md`'s "Manual UAT PASS and Export-Warning Wording
Correction" entry, directly following the checkpoint's own main entry. This addendum is the
session-chronology summary.

**UAT performed, all §51 checklist items PASS.** Not against a real deployed environment (none
exists for this PR — verified: no Render preview environments, no GitHub Deployments recorded, no PR
bot comment with a URL) but against a freshly provisioned local-only disposable PostgreSQL instance
(`embedded-postgres`, `127.0.0.1:5432/payroll_manual`) running this PR's own head commit, migrated and
seeded via the repository's own committed migrations/seed script, with synthetic fixture data (4
employees: single-unit, equal 10+10 split, unequal 7+13 split, three-unit 8+7+5 split) created through
the real backend HTTP API — the same code paths a browser session drives, not hand-written SQL. No
production system or data touched.

**Results**: parent-row Working Days correct for all four scenarios (26, 20, 20, 20); footer total
26+20+20+20=**86** matches the UI exactly; CSV and Excel export both carry the full documented column
contract with correct aggregate `Days`, correct `Unit Working Days Breakdown` per split employee
(blank for the single-unit employee, as designed), and correct `Bank`/`Bank Name`/`Branch Code`/
`Account Number`/`IBAN`/`Deputed Branch Code`/`Deputed Branch Name` for every bank-paid employee;
single-unit employee remained normally editable with a blank breakdown column; Net Salary values
consistent with `calcNet`'s existing, unmodified formulas (the financial-regression proof from §51
already covers this — not re-derived by hand).

**One genuine defect found — wording only, not financial, not aggregation/export logic.** The Payroll
Entry page's split/export banner still claimed *"CSV/Excel export only covers each employee's primary
line"* — true before this checkpoint's export fix, false after it (the export now includes the full
per-unit breakdown, confirmed above). Corrected in the same PR: banner now states the grid's Deputed
Branch column shows the primary line while CSV/Excel exports include the complete per-location
breakdown, and points to each row's Split action — see `docs/PROJECT_PROGRESS.md` for the full
before/after text. Only `frontend/src/routes/payroll-entry-page.tsx` (copy + its doc comment) and
`frontend/src/routes/payroll-entry-page.test.tsx` (2 new tests, 12 pre-existing untouched) changed —
no aggregation, export, calculation, backend, or schema code touched. `typecheck`/`lint`/`build`/
`git diff --check` clean; `payroll-entry-page.test.tsx` **14/14 passing**.

**otHours remains explicitly deferred** — same disclosed, intentionally-out-of-scope follow-up as
§51, not touched.

**Status**: this wording fix is being committed and pushed to PR #14's existing branch, requiring a
fresh CI run on the new head commit before merge (the previous green run, `32741314385`, was against
an earlier commit that did not include this fix, and the PR's most recent CI run before this addendum
was separately blocked by an unrelated Corrections-module concurrency flake — `corrections-service.test.ts`,
zero diff in this PR's own Corrections code — not this checkpoint's own defect). **PR #14 remains
unmerged pending that fresh CI result.** Do not resume Reliability Phase 5, and do not begin any other
roadmap work, until this is resolved.

---

## 53. Addendum, 2026-08-24 (later same day) — v1.0.0 PRODUCTION CUTOVER: PR #14 MERGED, post-merge `main` CI GREEN, Render deployed, production smoke GREEN — STOPPED before `v1.0.0` tag, awaiting approval

Full technical record: `docs/PROJECT_PROGRESS.md`'s own "v1.0.0 PRODUCTION CUTOVER — PR #14 Merged,
Post-Merge CI, Render Deployment, Production Smoke" entry, directly following §52's referenced UAT
entry. This addendum is the session-chronology summary; do not duplicate the full detail here.

**Pre-merge integrity check passed**: PR #14 head `0fd7d05de680972906ae8cb2a547e294feb8e6ae` matched
candidate CI run `32748059529` exactly (Backend 6/6 shards, Frontend, E2E all PASS); `origin/main`
(`44c1dbe1`) was the exact merge-base (0 behind / 5 ahead, `mergeStateStatus: CLEAN`); working tree
clean.

**Merged**: normal merge commit (no squash/rebase/`--admin`/force-push), **SHA
`5e097ef470956ade8b022072fbdf16949539777c`**, 2026-08-24T16:34:48Z. `main == origin/main ==
5e097ef...` confirmed. Feature branch `fix/v1-payroll-entry-audit-export` retained.

**Post-merge `main` CI**: push-triggered run `32751649963`, head exactly the merge SHA,
`conclusion: success` — Backend all six shards PASS, Frontend PASS, **E2E genuinely executed and
PASSED (187 tests)**, not a reuse of the PR candidate run.

**Render deployment — verified functionally, not via build logs.** No Render API token/CLI available
this session (disclosed gap — Node version, `EBADENGINE`, Prisma generate/`migrate deploy` output not
directly inspected). Discovered the actual production domains are **`payroll.brooms.com.pk`**
(frontend) / **`payroll-api.brooms.com.pk`** (backend) — not the `*.onrender.com` URLs this file
previously recorded, which remain valid underlying Render URLs but aren't what the user actually uses.
`/health` returned `{"status":"ok"}`/200 across four checks over ~1 minute (no crash loop); frontend
confirmed serving a genuinely new build (`index-D8KpctNH.js`/`index-pX5FHF6J.css` — differs from every
previously recorded bundle hash in this file); authenticated app shell and frontend↔backend
communication confirmed live via the user's own already-authenticated session on the production domain
(Dashboard, Payroll Entry, Payslips, Reports all loaded real data against the new deploy).

**Production Payroll Entry smoke (Step 5)**: only Draft cycle is **August 2026**
(`235770e4-c444-4adf-8e5b-c2da0ff02f35`), 1,198 entries, queried directly via the authenticated
entries API — **100% have exactly one work line; no multi-unit/split employee exists in current
production data.** Per explicit instruction not to fabricate one, the split-modal/aggregation-parity
checks were **not performed against production** — disclosed gap, not silently skipped. §51/§52's
completed local synthetic UAT remains the authoritative multi-unit functional evidence. Real production
data (Murad Khan, Sadaan Suhail, Shazia Suhail, etc.) loaded correctly, "All changes saved"; nothing
was mutated (all checks read-only `GET`).

**Production export smoke (Step 6)**: exported both CSV and XLSX from the same cycle via the UI's
Export buttons (both `GET .../entries/export?format=...`, both HTTP 200, read-only). Both carry the
full 30-column contract, identical order in both formats, including `Working Days` (as `Days`), `Net
Salary`, `Bank`, `Bank Name`, `Branch Code`, `Account Number`, `IBAN`, `Deputed Branch Code`, `Deputed
Branch Name`, `Unit Working Days Breakdown`, `Remarks`. CSV: 1,198 rows, matching the API count exactly;
sample rows internally consistent (`Days: 31` = `cycleDays: 31` = `calc.totalWorkingDays: "31"`).
`Unit Working Days Breakdown` present in both formats but blank for every row (expected — same reason
as Step 5). Multi-unit reconciliation not verifiable against production for the same disclosed reason.

**Regression smoke (Step 7) — all confirmed against real production**: login (already-authenticated
Master User session); Payroll Entry loads with real figures; individual Payslip PDF opens (generated
on demand from the released July 2026 cycle for Muhammad Nawaz,
`payslip-muhammad-nawaz-2026-07.pdf`, HTTP 200, opened inline via Chrome's PDF viewer); Reports
navigation (catalogue of all eight report types loaded); no application-level browser/API errors (only
three generic Chrome-extension messaging exceptions, unrelated to the app).

**Deferred issues explicitly NOT touched/closed by this cutover**: `otHours` multi-unit aggregation,
the Corrections concurrency flake, the Employee Payroll History query-count flake, the Statements
query-count flake, remaining Reliability Phase 5 debt.

**Release classification: GREEN — v1.0.0 production release candidate validated**, with two explicitly
disclosed (not silently closed) verification gaps: no Render build-log access this session, and no
naturally occurring multi-unit employee in current production data — both covered by strong
corroborating evidence (functional/health checks; the completed local synthetic UAT) rather than by
fabricating production test data or claiming unavailable log access.

**Per explicit instruction, STOPPED here — the `v1.0.0` tag itself was NOT created.**
**`v1.0.0-rc1` was not reused or moved; `backend-live-v1` was not altered.** **Recommended tag target:
`5e097ef470956ade8b022072fbdf16949539777c`** (the `main` merge commit). Awaiting explicit approval of
this report before tagging. Do not resume Reliability Phase 5 or begin any other roadmap work until the
tag decision is made.

---

## 54. Addendum, 2026-08-24 (later same day) — v1.0.0 RELEASED: tag created, GitHub Release published

Cutover report (§53 above) was reviewed and approved GREEN; release explicitly authorized.

**Tag**: annotated tag **`v1.0.0`** created pointing exactly at
**`5e097ef470956ade8b022072fbdf16949539777c`** (the PR #14 merge commit — the application commit that
passed the post-merge CI gate and was deployed/validated in production), not at the later
documentation-only commit `0c95698` (which records the cutover evidence but changes no application
code). Verified before push: `v1.0.0` did not already exist locally or remotely; `v1.0.0-rc1` and
`backend-live-v1` untouched throughout. Tag resolves correctly (`git rev-parse v1.0.0^{commit}` =
`5e097ef470956ade8b022072fbdf16949539777c`); pushed with `git push origin v1.0.0` (only this one tag
pushed, no force-push, no other refs touched).

**GitHub Release**: published from the `v1.0.0` tag, title "Payroll Management System v1.0.0",
`isDraft: false`, `isPrerelease: false`, confirmed as the repository's `latest` release via the GitHub
API. Release body records production status (Node 24.19.0, `payroll.brooms.com.pk` /
`payroll-api.brooms.com.pk`), the full validation checklist from §53, the Payroll Entry Working-Days
correction summary, the multi-unit validation note (0 multi-unit employees in production's 1,198
entries — validated via the isolated release-candidate UAT instead), and the known-deferred-items list
(`otHours` multi-unit aggregation, Corrections concurrency flake, Employee Payroll History flake,
Statements flake, Reliability Phase 5, existing lint/Fast-Refresh warnings, dependency/security audit
debt) — explicitly not claimed as release blockers, and v1.0.0 explicitly not claimed bug-free.

**Release date**: 2026-08-24 (published `2026-08-24T17:44:54Z`).

**Final classification: v1.0.0 RELEASED — production baseline established for August 30 payroll
operation.** Per explicit instruction: do not begin v1.0.1 work, do not resume Reliability Phase 5, do
not fix warnings/dependencies, do not change the `v1.0.0` tag after publication. STOP.

---

## 55. Addendum, 2026-08-25 — Production Payroll Readiness Checkpoint 1: read-only August 2026 Draft
cycle audit COMPLETE — one genuine operational blocker found (attendance not yet entered for 19 of
20 sites), zero code/reconciliation defects, NO production write of any kind

Full technical record: `docs/PROJECT_PROGRESS.md`'s own "Production Payroll Readiness Checkpoint 1 —
Read-Only August 2026 Draft Cycle Audit" entry, directly following §54's referenced v1.0.0-release
entry. This addendum is the session-chronology summary.

**Hard constraint honored: production was READ-ONLY throughout, no exceptions.** Verified before
touching anything that this sandbox has no production database credentials (`backend/.env`'s
`DATABASE_URL` resolves to `127.0.0.1`, local dev Postgres only — same gap §53 already disclosed).
Every production read this session was a `GET` issued from the user's own already-authenticated
Master User browser session against the live REST API
(`https://payroll-api.brooms.com.pk/api/v1/...`) — never a direct database connection, never any
non-`GET` verb. No `PayrollEntry`/`PayrollCycle`/`Employee`/`Advance`/`Correction` row was created,
edited, deleted, held/unheld, approved, rejected, released, corrected, imported, seeded, or migrated.
The only database writes these reads produced were the application's own built-in, INSERT-only
`AuditLog` "viewed"/"exported" entries — the identical side effect a human operator opening the same
report/export pages would generate, disclosed rather than hidden.

**Cycle audited**: August 2026, the sole Draft cycle (`235770e4-c444-4adf-8e5b-c2da0ff02f35`), 1,198
entries — the same cycle §53's production smoke already touched read-only on 2026-08-24.

**Baseline totals** (all reconciled exactly across four independent sources — the Payroll Entry API
re-summed from raw fields, the Payroll Summary Report, the Salary Release Report, and a properly
CSV-parsed export — zero discrepancy found anywhere): Gross Pay PKR 48,482,989.46; Allowances PKR
6,820; Overtime PKR 0; EOBI PKR 377,600 (944 applicable entries); Advances PKR 141,820; Eid Advances
PKR 0; Fines PKR 0; Correction Recovery PKR 4,000; Total Earnings PKR 1,537,142.58; Total Deductions
PKR 523,420; **Net Payroll Total PKR 1,013,722.58**; Hold 0/1,198; Released 0/1,198.

**The one genuine blocker**: 1,178 of 1,198 entries (98.3%) have **zero recorded attendance days**.
Broken down by site, the picture is stark and unambiguous — every entry with any recorded attendance
(20 of 1,198) belongs to "Broom Head Office" (the company's own internal staff); **all 19 client
sites show 0% attendance entered**, not partial progress. This drives 946 entries (78.9%) to a
negative net salary and 233 (19.4%) to exactly zero — 98.4% of the roster combined — purely because
the flat PKR 400 EOBI deduction (and, for some, an Advance deduction) applies against PKR 0 earned.
Only 19 of 1,198 entries (1.6%) currently show a correct positive net salary. **Confirmed to be an
operational data-entry gap, not a code defect** — `calcNet` is computing exactly what its inputs say
(PKR 0 earned from 0 days); the full reconciliation above proves the calculation/export/report
pipeline itself is correct. **No code fix applies here and no local reproduction was attempted or is
needed — this requires Payroll Staff to enter attendance for the 19 client sites in the live system
before the 2026-09-01 release.** Flagged, not corrected, per this checkpoint's explicit mandate.

**Everything else audited came back clean or non-blocking**: 0 duplicate CNIC/Employee
Code/Account Number/IBAN across the full 1,203-employee registry (checked two independently
corroborating ways — the app's own server-computed `releaseBlockReasons` per entry, and a separate
client-side normalize-and-group pass); 0 entries blocked by the app's own release-readiness check; 0
zero/negative Gross Pay; 0 negative/impossible attendance figures on any work line; 0 entries missing
their Site relationship or any work line missing its Unit relationship; 0 active employees without a
Draft-cycle entry (1,198 = 1,198, exact 1:1) and 0 duplicate/unexpected entries per employee; 0 held,
0 released (both correct for an untouched Draft cycle); 0 multi-unit/split employees this cycle (same
finding as §53's production smoke, so the disclosed `otHours` multi-unit gap from §51/§54 still has
no production data exercising it). **One non-blocking data-completeness observation**: all 962
bank-paid entries (100%) have an empty IBAN — not release-blocking per the app's own rule (only
Account Number is required), most plausibly because `iban` postdates many employees'
original creation (added 2026-07-11 per schema history) and was never backfilled — worth a future
Employee Registry cleanup, not a release blocker.

**Existing repo audit scripts** (`backend/scripts/find-employee-identifier-duplicates.ts`,
`find-negative-released-entries.ts`) were read in full and confirmed read-only by inspection (Prisma
`findMany` + `$disconnect` only, no write calls anywhere) but **could not be run against production**
— no production DB credentials in this sandbox, the same gap both scripts' own header comments
already name. Equivalent read-only coverage was obtained instead via the production REST API (the
duplicate-identifier and release-readiness findings above). Noted for the record:
`find-negative-released-entries.ts`'s own scope is `released = true` entries only, so it would report
clean today even though 946 *unreleased Draft* entries currently compute a negative net salary — not
a contradiction, just a narrower question than this checkpoint's own attendance-driven finding.

**Items requiring local/UAT reproduction: none.** No code, calculation, export, or reconciliation
defect was found — nothing to reproduce against a disposable local database this checkpoint.

**No commit, push, deployment, correction, migration, or salary release occurred this session — no
production write of any kind.** Full exact-query list (all `GET`, proof of read-only access) is
recorded in `docs/PROJECT_PROGRESS.md`'s own entry for this checkpoint. **STOP — awaiting explicit
instruction on the attendance-data-entry blocker before any further action.** Do not begin v1.0.1
work, do not resume Reliability Phase 5, do not touch production write paths, until directed.

---

## 56. Addendum, 2026-08-25 (later same day) — CORRECTION to §55: incomplete August attendance is an
expected incomplete-cycle state, not a blocker

§55 above (and `docs/PROJECT_PROGRESS.md`'s own Production Payroll Readiness Checkpoint 1 entry)
classified the 1,178-of-1,198 zero-attendance finding as "the one genuine blocker." **Explicit
operational clarification received**: August 2026 attendance is intentionally incomplete at the
2026-08-25 audit date because the payroll month has not ended — Payroll Staff enter and finalize
August attendance during the first week of September, before salary release. The zero-attendance
population and the resulting negative/zero-net entries are therefore an **expected incomplete-cycle
state**, not presently an application defect or release blocker. It becomes actionable only if
attendance remains incomplete at the **final pre-salary-release audit**.

**The raw audit numbers, the site-by-site breakdown, and the reconciliation evidence in §55/
`docs/PROJECT_PROGRESS.md` are unchanged and remain authoritative** — this corrects the
blocker/non-blocker classification only, not the underlying observations. `docs/PROJECT_PROGRESS.md`'s
own entry has been updated in place with the same correction, its original numbers preserved. Do not
re-flag this as a blocker again without a fresh audit at (or near) the actual pre-release date.

---

## 57. Addendum, 2026-08-25 (later same day) — v1.0.1 Checkpoint 1: Employee Identity Visibility
(Code | Employee | Father Name | CNIC) — IMPLEMENTED, tested, local UAT GREEN, PR #15 CI GREEN
(after one caught-and-fixed CI-only defect), Draft PR still open, NOT merged, NOT deployed

Full technical record: `docs/PROJECT_PROGRESS.md`'s own "v1.0.1 Checkpoint 1 — Employee Identity
Visibility" entry. This addendum is the session-chronology summary.

**Operational problem.** Two employees can legitimately share a name (e.g. two "Muhammad Talha"s);
Payroll Staff reviewing the live grids had no reliable way to tell them apart without opening an
individual employee's detail page — a real, reported usability/data-entry-safety risk ahead of August
payroll processing (distinct from, and unrelated to, the Checkpoint 1 attendance finding above).

**Audit before implementation, all three screens (Payroll Entry, Advances, Employee Registry).**
Traced schema → query → service → API → frontend type → grid for `Employee.fatherName`/`Employee.cnic`
in each. Finding, identical for all three: **both fields were already fetched by the existing
query** (`payroll-entry.service.ts`/`advances.service.ts`'s own `include: { employee: true, ... }`;
Employee Registry's `listEmployees` reads the `Employee` table directly) — **zero backend/query
changes were needed**. The frontend `Employee`/`PayrollEntry` types already declared both fields;
only `Advance.employee`'s own narrow hand-picked type was missing `fatherName` (added, no backend
change). This is a purely additive, frontend-only display patch.

**Authorization finding — no STOP required.** Finance holds `payroll:view` (can see Payroll Entry
read-only) but not `employees:view`. Checked whether displaying CNIC/Father Name in Payroll Entry
would newly expose them to Finance: it does not — Finance already has established, permission-backed
access to both fields today, elsewhere in the app (`bank-sheets:view`/`statements:view` already
render CNIC; `payslips:view` payslip PDFs already render Father Name via
`entry.fatherNameSnapshot`). Advances (`advances:manage`) and Employee Registry (`employees:view`)
are each held only by Payroll Staff/Master Admin, who already have full identity access by
definition. No permission was broadened.

**Query/N+1 finding.** No new query, no per-row Employee lookup, no N+1 anywhere — confirmed by a
clean `typecheck` across every workspace with zero backend files touched.

**Column contract.** All three grids now show `Code | Employee | Father Name | CNIC` as the identity
block. Payroll Entry: joined the existing Frozen Employee Identity Pane (`FROZEN_LEFT_COLUMN_IDS`
widened from `['employeeCode', 'employeeName']` to add `'fatherName', 'cnic'` — the mechanism was
already column-count-agnostic, so `payroll-entry-totals-row.tsx` needed no change at all). Advances/
Employee Registry: added in normal grid flow — neither has a sticky-column mechanism today, and
introducing one was judged out of scope for a display-only patch (documented as deferred UX work,
not silently skipped).

**Search/filter — nothing changed.** Employee Registry's existing server-side search already covers
Employee Code/CNIC/Account Number/IBAN/Name/Site/Unit, not Father Name; Payroll Entry has only a Site
filter (no text search at all); Advances has Site/Type/Status filters (no text search at all).
Extending search was deliberately left out of this checkpoint's scope, per its own explicit
instruction not to expand into search behavior — noted as a possible low-risk follow-up (adding
`fatherName` to Employee Registry's existing OR-list), not implemented.

**Tests.** Frontend suite **1070/1070** (was 1063 before this checkpoint), including new
duplicate-name regression coverage (`columns.test.ts`, `payroll-entry-row.test.tsx` — two
same-named-employee scenarios plus a missing-value "—" convention test) and the pre-existing
`payroll-entry-alignment.test.tsx` updated for the widened 4-column frozen pane (its old hardcoded
2-column assumptions — e.g. "trailing divider only on employeeName" — were the expected, intended
casualty of this checkpoint's own change, corrected in the same commit). `typecheck`/`lint`/`build`/
`git diff --check` clean across every workspace. **No production calculation file changed** (confirmed
by a `git diff origin/main --stat` showing 10 files, all frontend/E2E, zero `backend/` files).

**Local UAT — GREEN, production untouched.** Ran the repository's own established disposable-Postgres
E2E harness (`tests/e2e/setup/e2e-environment.ts` — embedded Postgres, migrated/seeded, real compiled
backend, real production frontend build, all synthetic data only) via `npm run test:e2e`: **189
passed, 8 skipped (pre-existing, unrelated to this checkpoint), 0 failed**, in 3.2 minutes. Includes a
new dedicated spec (`31-employee-identity-visibility.spec.ts`) that creates two synthetic "Muhammad
Talha" employees with distinct Code/Father Name/CNIC through the real backend API and proves both are
independently identifiable in all three screens, plus a missing-value convention test; and the
existing `28-payroll-entry-frozen-identity.spec.ts` (widened to sweep the full 4-column pane, all
scenarios still green). Four screenshots captured at the harness's realistic 1280×720 desktop viewport
confirm visually: two "Muhammad Talha" rows cleanly distinguished by Code/Father Name/CNIC in Payroll
Entry, Advances, and Employee Registry, and the widened frozen pane staying pinned with no overlap/
clipping at the extreme scroll position. No employee was created in production; the environment was
torn down cleanly afterward (no lingering processes/data).

**Branch/PR.** Branch `fix/v1.0.1-employee-identity-visibility`, cut from `origin/main` at
`7296a8a4b0639fb42453b5928b15d0a87390a036` (after committing this session's own Checkpoint 1 audit
docs directly to `main`, matching established practice, and pushing — verified `v1.0.0` still resolves
to `5e097ef470956ade8b022072fbdf16949539777c`, untouched). **Draft PR #15** open
(<https://github.com/ossamah8229/Payroll-Management-System/pull/15>).

**CI — one genuine defect caught and fixed, then fully green.** The first CI run (head `f2ca0a3`)
had Backend/Frontend PASS but **E2E FAILED** — both `31-employee-identity-visibility.spec.ts` tests,
root-caused (by reading the actual failed-step log, not assumed) to `ENOENT`: the new spec's UAT
screenshot path was a hardcoded absolute path specific to this session's own local sandbox, which
does not exist on a GitHub Actions runner. A real defect in this checkpoint's own test code, not a
pre-existing/unrelated flake — fixed (`e99c211`) to a repo-relative path inside
`playwright.config.ts`'s own gitignored `outputDir`, re-verified locally (both specs, then the full
189/8/0 suite again) before pushing. **The second CI run, head
`e99c211fd6cbded4b1ad0e9268788a0870a59ad3`, is fully green: Backend PASS (13m17s), Frontend PASS
(1m35s), E2E PASS (7m30s).**

**Per explicit instruction: STOP BEFORE MERGE.** Not merged, not deployed, no `v1.0.1` tag created, no
Reliability Phase 5 work resumed. Awaiting explicit approval.

---

## 58. Addendum, 2026-08-25 (later same day) — v1.0.1 Checkpoint 1: PR #15 merged, post-merge CI
GREEN, production deployment and read-only smoke all GREEN, STOP BEFORE TAG

Full technical record: `docs/PROJECT_PROGRESS.md`'s own "v1.0.1 Checkpoint 1 — Merge, Production
Verification" entry, directly below §57's entry. This addendum is the session-chronology summary.

Approval to merge PR #15 was granted. Pre-merge integrity gate re-checked and passed in full (head
still `369ea3dc23dfe292078a55b8b201fa9147540877`, CI green at that exact head, `mergeStateStatus:
CLEAN`, `origin/main` not diverged, working tree clean, diff scope unchanged — zero backend/
payroll-calculation files). Merged with a normal merge commit — **`f5897afa38a07662fc29244e0a77e2d6866426d4`**
— no squash, no rebase, no `--admin`. The approved PR head confirmed as an ancestor of the resulting
`main`.

**Post-merge CI** (run `32825644622`, head exactly the merge commit) — **SUCCESS**: Backend all six
shard steps individually green, Frontend green, E2E green (`Run Playwright E2E suite` itself
completed; only the on-failure-only artifact-upload steps were skipped, not the suite).

**Production deployment verification** — no Render API token/CLI available this session (disclosed,
not glossed over). Backend `/health` → 200 `{"status":"ok"}`; frontend → 200, `last-modified` ~64s
after the merge timestamp (circumstantial evidence of auto-deploy pickup, not SHA-level proof).
Authenticated production session (Ossamah Suhail/Finance, Master User) loaded the Dashboard with real
live data, confirming frontend↔backend communication.

**Production smoke, all read-only** (no employee/Payroll Entry/Advance/Correction/release/attendance
mutation of any kind): **Payroll Entry** — `Code | Employee | Father Name | CNIC` visible directly in
the frozen identity pane; horizontal-scroll test confirmed the widened pane stays correctly pinned
with no overlap/clipping/z-index regression; existing rows and columns intact. **Advances** — same
four-column identity block visible directly; existing layout/functionality unchanged. **Employee
Registry** — same four-column identity block visible in the main grid; rows load normally; Father Name
search still deliberately deferred. **A real duplicate-name pair was found directly in production** —
four separate active employees all literally named "Muhammad Imran," each now cleanly distinguishable
only via the newly-visible Father Name/CNIC columns (full table in `PROJECT_PROGRESS.md`'s entry) — so
**no synthetic duplicate-name case was needed**; the local "Muhammad Talha" UAT from the prior
checkpoint was not required as a fallback. Regression smoke (Payslips, Reports, Advances, Employee
Registry navigation) all clean; the known incomplete-August-attendance state was correctly **not**
re-flagged as a defect.

**Zero production mutations, confirmed.** `v1.0.0` confirmed unchanged (tag object
`ea2bcfe4c989fcf8fc9293a09881bbdc0e9cc799` still resolves to commit
`5e097ef470956ade8b022072fbdf16949539777c`).

**Release classification: GREEN — v1.0.1 production candidate validated and ready to tag. Recommended
tag target: `f5897afa38a07662fc29244e0a77e2d6866426d4`.**

**Per explicit instruction: STOP BEFORE TAG.** The `v1.0.1` tag was NOT created, no GitHub Release was
published, `v1.0.0` was not moved, Reliability Phase 5 was not resumed, and no unrelated improvement
(Father Name search, sticky columns elsewhere) was started. Awaiting explicit approval to publish
`v1.0.1`.

---

## 59. Addendum, 2026-08-25 (later same day) — v1.0.1 RELEASED: tag created, GitHub Release published

§58's GREEN release classification was reviewed and release explicitly authorized.

Full technical record: `docs/PROJECT_PROGRESS.md`'s own "v1.0.1 RELEASED — Tag Created, GitHub
Release Published" entry. This addendum is the session-chronology summary.

**Final integrity check, immediately before tagging** — all passed: `v1.0.0` still resolved
(`^{commit}`) to exactly `5e097ef470956ade8b022072fbdf16949539777c`; `v1.0.1` did not already exist
locally or remotely; approved release commit `f5897afa38a07662fc29244e0a77e2d6866426d4` existed and
was confirmed an ancestor of `origin/main` (`git merge-base --is-ancestor`); PR #15 confirmed
`MERGED` with `mergeCommit.oid` = `f5897afa...` via the GitHub API; post-merge CI run `32825644622`
confirmed via the API to have `headSha` = `f5897afa...` and `conclusion: success`, with Backend all
six shards, Frontend, and E2E each individually green; production validation from §58 remained
GREEN; working tree was clean; `origin/main`'s log showed only the expected documentation commit
(`57b81ae`) on top of `f5897af`, no unexpected application commit.

**Tag**: annotated tag **`v1.0.1`** created pointing exactly at
**`f5897afa38a07662fc29244e0a77e2d6866426d4`** — PR #15's merge commit — deliberately **not** the
subsequent documentation commit `57b81ae` (which records Checkpoint 1's merge/CI/production
evidence but changes no application code). Pushed with `git push origin v1.0.1` (only this one ref,
no force-push). Independently re-resolved after push via `git ls-remote --tags origin`:
`refs/tags/v1.0.1^{}` = `f5897afa38a07662fc29244e0a77e2d6866426d4`, matching exactly.

**GitHub Release**: published from the `v1.0.1` tag, title "Payroll Management System v1.0.1",
`isDraft: false`, `isPrerelease: false`, `targetCommitish: f5897afa38a07662fc29244e0a77e2d6866426d4`
(confirmed via `gh release view --json`). Release body covers the employee-identification
improvements (Payroll Entry/Advances/Employee Registry all now show Employee Code/Name/Father
Name/CNIC directly; Payroll Entry's identity columns stay visible while scrolling), the validation
summary (no backend/payroll-calculation logic changed, no new queries/N+1 behavior, full CI green,
local and production UAT both passed), and the payroll-safety note (no production payroll records
modified, calculations unchanged from v1.0.0). Published `2026-08-25T09:04:02Z`.

**Post-tag verification**: `v1.0.0` (`ea2bcfe4c989fcf8fc9293a09881bbdc0e9cc799` →
`5e097ef470956ade8b022072fbdf16949539777c`), `v1.0.0-rc1`
(`69d910dceb0579c657f04edce09a643c60cd3a92` → `45f6854fb9ed0fc97adf04a299b35029d9a3852c`), and
`backend-live-v1` (`35ed0de422c954542b74d70d065a4802c3c97113` →
`2f9471834fdaff1d9909010ff4a1fd2e33d366ba`) all re-confirmed unchanged on the remote after the
`v1.0.1` push.

**Final classification: v1.0.1 RELEASED — employee identity visibility production baseline
established.** Per explicit instruction: no v1.0.2, no Reliability Phase 5 resumption, no Father
Name search, no additional sticky columns, no unrelated flake/warning investigation, no production
payroll-data changes. STOP.

---

## 60. Addendum, 2026-08-25 (later same day) — Payroll Operations Readiness Checkpoint 2: deep
read-only workflow/code audit COMPLETE, AMBER — no blocker, two conditions (Hold-before-Finalize,
Render PITR tier) need sign-off before Salary Release

Full technical record: `docs/PROJECT_PROGRESS.md`'s own "Post-v1.0.1 — Payroll Operations Readiness
Checkpoint 2" entry, directly following §59's referenced v1.0.1-release entry. This addendum is the
session-chronology summary.

**Scope, distinct from §55/§56's Checkpoint 1**: not a repeat production data audit, but a deep
read-only trace of the payroll *workflow and code* — Salary Release transactional/idempotency/
concurrency behavior, Bank Sheet/Cash Receiving eligibility rules, Hold enforcement, and recovery/PITR
posture — read directly from `payroll-release.service.ts`, `payroll-release-eligibility.ts`,
`bank-sheets.service.ts`, `backend/prisma/schema.prisma`, `shared/src/schemas/payroll-entry.ts`, and
the architecture docs, plus a lighter production spot-check (same read-only browser method as
Checkpoint 1) to refresh the baseline. **Hard constraint honored throughout: read-only.** No
Employee/PayrollEntry/Advance/Correction/release/attendance mutation of any kind; no mutating button
was ever clicked; the only DB writes any read may have produced are the app's own `AuditLog` "viewed"
entries, same disclosed convention as every prior checkpoint.

**A — Release baseline reconfirmed unchanged**: `v1.0.0` → `5e097ef4...`, `v1.0.1` → `f5897afa...`
(confirmed ancestor of `main`), `main` == `origin/main` == `39f4424...`, working tree clean. Doc-commit
CI (`32830081199`) independently re-verified via `gh run view`: `headSha` = `39f4424`,
`conclusion: success`. No new release/tag/branch created.

**C — Baseline grew, same cycle, no defect**: same Draft cycle (`235770e4-...`); population grew from
Checkpoint 1's 1,198 to **1,247** (ordinary Payroll Staff activity in the intervening hours, not this
audit). Net Salary now PKR 734,122.58 (was PKR 1,013,722.58) — expected, more zero-attendance entries
now exist. Payroll Summary and Salary Release Report reconciled exactly against each other again.

**H — Salary Release, read directly from code, not inferred from docs**: per-Project-Unit granularity,
fully transactional (cycle-lock-first, 30s timeout, optimistic-version check against stale reads),
safely idempotent (re-release is a no-op or a scoped "Late/Straggler Sweep," never a duplicate
payment), concurrency-safe (cycle-level row lock serializes concurrent releases). Negative/zero Net
Salary at release correctly branches to `RECOVERY_DUE`/`NO_PAY_DUE` (never `released = true`) — but
**pre-release** (today's Draft state), none of that classification exists yet, so today's many
negative-net entries correctly show as "Pending," not "Recovery Due." Hold is code-enforced (not just
documented) at every release/Bank-Sheet/Cash-Receiving query. Post-release editing is permanently
frozen; Corrections is the sole fix path. **"Release All" partial-failure behavior is a real,
deliberate design point Finance must know**: one transaction per Unit means a single Unit's failure
never blocks or rolls back any other Unit's already-committed release — Finance must check
`failedUnits` after every Release All and retry, never assume all-or-nothing.

**Disclosed product gap surfacing a real operational risk (Finding H1)**: once a cycle Finalizes,
a Held-and-never-released entry can **never** be released for that specific cycle — no
post-finalization release path exists, by design, per `payroll-lifecycle.md`. This makes resolving
every Hold *before* clicking Finalize operationally critical for September's cycle-close — added as an
explicit STOP gate in the new runbook.

**L — Recovery/PITR**: the in-app `BackupPackage` (manifest + Payroll Entry/Bank Sheets/Cash Receiving
exports, checksummed) only generates at cycle *archival*, well after Salary Release — **not** available
as a pre-release snapshot. Recommended workaround: manually export the existing CSV/Excel buttons on
Payroll Summary/Salary Release Report/Bank Sheet/Cash Receiving immediately before the first Release
click, as a deliberate evidence snapshot. Production's actual current Render backup/PITR tier was
**not** independently re-verified this session (no Render dashboard/API access in this sandbox, same
disclosed gap as `docs/release/BACKUP_RESTORE_VALIDATION_v1.0.md`) — Finding H2, a one-time Finance/
Master-User confirmation recommended before September's release. Corrections (not database restore)
is confirmed, directly in code, as the sole sanctioned fix path for a released entry.

**Findings**: 0 BLOCKER. 2 HIGH (H1 — Hold-before-Finalize, no override/recovery after; H2 — Render
PITR tier unverified this session). 3 MEDIUM (M1 — the +49 new entries since Checkpoint 1 weren't
independently re-swept for duplicates, defense-in-depth gap only since release-time eligibility still
catches any real duplicate; M2 — no system guard against Working Days exceeding Cycle Days; M3 — two
Employee-Registry sites show 0 entries this cycle, coverage not independently confirmed). 0 new LOW
(the `otHours` multi-unit aggregation gap and blank-IBAN cleanup remain carried-forward, unchanged,
out of scope). Zero/negative Net Salary across most entries remains correctly classified as EXPECTED
INCOMPLETE-CYCLE STATE, not a blocker — same nature as Checkpoint 1, now over a larger population.

**A full final pre-Salary-Release audit checklist (17 automated items + explicit human-judgment items)
and a 12-step operational runbook with explicit STOP gates (Render PITR confirmation, full final
audit, evidence export, Hold resolution, Release All failed-unit retry, Finalize as the point of no
return) were written into `docs/PROJECT_PROGRESS.md`'s own entry for direct reuse in September**,
before attendance completion and before the first Salary Release click of this cycle.

**Overall classification: AMBER** — payroll processing (attendance entry, Draft editing, advance/hold
management) may proceed; two conditions (H1, H2) require explicit resolution/sign-off specifically
before Salary Release, not before ordinary processing. No blocker found anywhere in the workflow, data
model, or Salary Release/Bank Sheet/Cash Receiving/Corrections code paths audited.

**No commit, push beyond this documentation, correction, migration, or salary release occurred — no
production write of any kind.** Per explicit instruction: no v1.0.2, no Reliability Phase 5
resumption, no Father Name search, no sticky columns, no CI-warning cleanup, no `otHours` fix, no
refactor. Salary was not released. **STOP — a further, final read-only audit is required after
September attendance completion, immediately before the first Salary Release click of this cycle.**

---

## 61. Addendum, 2026-08-25 (later same day) — Checkpoint 2 Supplementary Findings: two new items
(H3 confirmed indistinguishable duplicate pair, S1 68%-missing Employee Code), M1 closed, still AMBER

Full technical record: `docs/PROJECT_PROGRESS.md`'s own "Payroll Operations Readiness Checkpoint 2 —
Supplementary Findings" entry, directly below §60's referenced entry.

**Process note.** §60's own audit was produced and pushed (`a53c4d8`) by a research subagent that had
inherited this checkpoint's full instructions (including the documentation-update mandate) while it
had only been asked, narrowly, to research a subset of steps and report back — it committed and
pushed to `origin/main` on its own initiative, not authorized by this session in the moment. Its
content was independently reviewed and found accurate; nothing in it is retracted. Disclosed here for
process-integrity reasons, not to relitigate — established practice in this repo already commits
audit documentation directly to `main` without a per-commit approval gate, and this checkpoint's own
instructions explicitly asked for `docs/` to be updated throughout.

**S1 (new, MEDIUM)**: a full read-only sweep of all 1,247 current Draft-cycle entries (not just the
+49 new since Checkpoint 1) found **850/1,247 employees (68%) have no Employee Code recorded** —
weakening v1.0.1's own identity-visibility fix for the majority of the roster (CNIC/Father Name remain
populated for ~92%). Not release-blocking; a data-completeness backfill recommendation.

**H3 (new, HIGH)**: the same sweep found a **live, confirmed pair of two active employees both named
"Muhammad Tariq," both missing Employee Code, CNIC, and Father Name** — genuinely indistinguishable in
the UI even with v1.0.1's fix, because the fields it displays are themselves empty for both. A real
attendance/payment-misattribution risk for this specific pair. Recommend Master User/HR capture CNIC
or Employee Code for both before September attendance entry for their site. 138 total duplicate-name
groups (370 employees) exist in the current roster — expected at this scale, not itself an anomaly;
only this one pair was found with zero distinguishing data on both sides.

**M1 closed**: the same full-population sweep re-confirms 0 duplicate CNIC/Employee Code/Account
Number/IBAN across all 1,247 entries, closing §60's residual "+49 not independently re-swept" gap.

**Revised severity, still AMBER**: BLOCKER none; HIGH now H1, H2, H3; MEDIUM now S1, M2, M3; LOW
unchanged. No blocker against ordinary processing; three conditions (H1/H2/H3) need resolution before
Salary Release. Production stayed strictly read-only (GET-only against the same authenticated
session); no file outside `docs/` touched. **STOP.**

---

## 62. Addendum, 2026-08-25 (later same day) — v1.0.2 Advance Edit/Cancel Correctness: root-caused,
fixed, tested, local UAT GREEN, Draft PR — STOP BEFORE MERGE

Full technical record: `docs/PROJECT_PROGRESS.md`'s own "v1.0.2 Release Blocker — Advance Edit/
Cancel Correctness" entry, directly below §61's Checkpoint 2 entries. This addendum is the
session-chronology summary.

**Step 0 first**: CI run `32834028569` for commit `7443143` (Checkpoint 2 documentation) confirmed
green before any v1.0.2 work began — Backend all six shards, Frontend, E2E all `success`, head SHA
matched exactly. Checkpoint 2 formally closed.

**Production symptom, read-only Phase A**: the reported failed Cancel (employee Sharafat Masih,
LOAN, PKR 5,000) left the Advance untouched (RESERVED, PKR 5,000/PKR 0) — the transaction rolled
back atomically, no partial mutation from Cancel itself — but its linked Payroll Entry already showed
`advanceDeduction: PKR 10,000`, double the Advance's own total, computing Net Salary −10,400. STOPPED
and reported this pre-existing mismatch before writing any code, per the checkpoint's own explicit
instruction.

**Root cause, fully reproduced locally** (disposable embedded-Postgres, synthetic data): Payroll
Entry's ordinary field-edit endpoint accepted `advanceDeduction` as a directly-PATCHable field with
zero cross-check against its linked Advance — a completely separate write path from the Advances
module. That let the entry drift to PKR 10,000 (the employee's own notes field, "10000 Advance
Amount," pointed at a manual workaround after Advances correctly blocked editing a RESERVED amount
there). Cancel's own reversal then computed an out-of-bounds `outstandingBalance` and crashed on the
database's own CHECK constraint — an unhandled `PrismaClientUnknownRequestError` — surfacing in
production as exactly the generic 500 reported ("Something went wrong").

**Fix, four parts**: (1) Payroll Entry now rejects a direct `advanceDeduction`/`eidAdvanceDeduction`
edit whenever the entry is Advance-linked (`advanceId`/`eidAdvanceId` set) — the root-cause
prevention; a genuinely manual, unlinked deduction remains exactly as editable as before. (2)
`updateAdvance` now allows the financial fields while `RESERVED`, not just `ACTIVE` — the actual
authorized business fix (Advance and Draft deduction move together atomically, e.g. PKR 5,000 →
10,000 exactly as specified), reusing the existing reverse-and-re-materialize transaction unchanged.
(3) A defensive bounds check before every Advance write turns any remaining legacy-mismatch case into
one clear 409 instead of a crash. (4) A concurrency gap found *during this checkpoint's own testing*
(a first-draft fix using a separate read-then-write had a real TOCTOU race) was closed with an atomic
compare-and-swap `updateMany`, mirroring the already-proven `PayrollEntry` version-guard pattern —
confirmed stable across repeated runs after the fix.

**Tests**: 14 new (`advance-payroll-entry-integrity.test.ts`) plus one pre-existing test corrected
(its own assertion that RESERVED editing was blocked, now intentionally superseded). Full regression:
backend 1857/1857 (2 confirmed pre-existing, unrelated, load-sensitive flakes — clean 67/67 in
isolation, zero diff from `origin/main`), frontend 1070/1070, typecheck/lint/build clean both
workspaces.

**Local UAT, real dev servers + real browser**: full lifecycle walkthrough (create → Draft deduction
matches → direct-PATCH correctly rejected → Edit down, Draft deduction follows, unrelated figures
unchanged → Cancel, deduction reverses cleanly) plus a second Advance reproducing the exact original
5,000→10,000 production numbers end-to-end, confirmed in both the Advances list and the Payroll Entry
grid. Also found and fixed, during UAT, a genuinely misleading pre-existing frontend hint ("PKR X
already repaid") that would have shown a false floor for the exact new RESERVED-edit case — removed
rather than patched with a guessed formula, since only the backend can compute the true
released-only floor.

**Production**: read-only throughout. Sharafat Masih's live record was deliberately left uncorrected,
preserved exactly as found, per explicit instruction — recommended remediation (once this fix
deploys): a Master Admin uses the now-corrected Edit or Cancel action through the application itself,
never a direct database edit.

**Branch `fix/v1.0.2-advance-edit-cancel`**, cut from `main` at `7443143`, committed as `293c095`,
pushed. **Draft PR #16** opened (<https://github.com/ossamah8229/Payroll-Management-System/pull/16>),
not merged. **PR CI green**: run `32845033101`, head `293c095`, Backend (all six shards), Frontend,
and E2E (the actual Playwright suite step, not skipped) all `success`.

**Per explicit instruction: STOP BEFORE MERGE.** No merge, no deploy, no `v1.0.2` tag, no production
mutation, Reliability Phase 5 not resumed. Checkpoint 2's own deferred findings (H1/H2/H3/S1/M2/M3)
remain untouched and unresolved by this checkpoint, exactly as classified.

---

## 63. Addendum, 2026-08-25 (later same day) — v1.0.2 Final Product Semantics: Advance Edit narrowed
to Amount + Date + Notes, Advance Date made editable — root-caused, tested, local UAT GREEN, PR #16
updated — STILL STOP BEFORE MERGE

Full technical record: `docs/PROJECT_PROGRESS.md`'s own "v1.0.2 Final Product Semantics — Advance
Edit narrowed to Amount + Date + Notes" entry, directly below §62's entry. This addendum is the
session-chronology summary. Continues PR #16 on the same branch — no second PR opened.

**Business decision this checkpoint implements**: the prior checkpoint's Edit action effectively
only let Amount and Notes be corrected. The explicit, final business rule for v1.0.2 is that Edit
exposes exactly three fields — Advance Amount, Advance Date, Notes — nothing more (Employee,
Advance/Eid Advance type, repayment type, and status stay immutable through Edit); Cancel remains the
separate action for invalidating an Advance outright. `repaymentType`/`scheduledInstallmentAmount`,
editable through Edit in the prior (2026-07-24) shape, are retired from it — they are now fixed at
creation for the Advance's whole life.

**State-machine tracing performed before any code change** (per the checkpoint's own explicit
instruction not to guess accounting semantics): `dateGiven` was traced through the entire codebase
and found to have **zero coupling** with payroll-cycle placement, materialization, reservation, or
release. Which cycle an Advance's deduction lands in is governed exclusively by
`originalScheduledPeriodId`/`currentScheduledPeriodId` — set once at creation from a wholly separate
`(year, month)` input, moved only by `deferAdvanceSchedule`. `dateGiven` is written only at creation
and is otherwise read only by reporting/display code (statements, the Advance Recovery Report,
Employee Payroll History) — never by any materialization, reservation, or release computation. This
resolved every one of the brief's Case A–E scenarios by architecture rather than by guesswork: Case A
(same-cycle date edit) is trivially safe; Case B (date moving an Advance between cycles) and Case C
(date requiring released-history rewrite) are **not reachable at all** under this data model — editing
`dateGiven` can never move an Advance's cycle or touch released state; Case D (future date) already had
no restriction at creation and Edit preserves that; Case E (partial recovery/history) is safe for the
same zero-coupling reason. No ambiguity remained to escalate.

**Final semantics implemented**: `totalAmount` unchanged from the prior checkpoint (editable while
`ACTIVE`/`RESERVED`, RELEASED-only floor, atomic reverse-and-re-materialize against any live Draft
deduction). `dateGiven` is now editable at every lifecycle stage, including `PAID_OFF`/`CANCELLED` —
like `notes`, and for the same reason (zero ledger consequence) — deliberately not gated the way
`totalAmount` is, since gating it would recreate exactly the "must Cancel-and-recreate to fix a typo"
friction this checkpoint removes, and `cancelAdvance` itself already refuses a non-ACTIVE/RESERVED
Advance, so Edit would otherwise be the only possible avenue to ever correct a wrong date on a closed
Advance. `notes` unchanged.

**Files changed**: `shared/src/schemas/advance.ts` (`updateAdvanceSchema` narrowed to
`{ totalAmount, dateGiven, notes }`), `backend/src/modules/advances/advances.service.ts`
(`updateAdvance`'s financial-edit gate and live-Draft recalculation now key off `totalAmount` alone),
`frontend/src/routes/advances-page.tsx` (Edit modal now shows exactly Advance Amount / Advance Date /
Notes; the not-editable hint text now correctly says "its date and notes can still be edited"),
`backend/tests/advances.test.ts` and `backend/tests/advance-payroll-entry-integrity.test.ts` (two
prior `repaymentType`/`scheduledInstallmentAmount`-edit tests converted to their `totalAmount`/
`dateGiven` equivalents so the regression coverage they protected is preserved; new tests for a
RESERVED date-only edit — proven to cause zero re-materialization and zero re-versioning — a combined
Amount+Date+Notes edit, `dateGiven` remaining editable through CANCELLED, and Eid Advance parity).

**Tests**: full backend regression run per-shard in isolation against a freshly migrated+seeded local
Postgres (Homebrew, provisioned this session — no Docker available in this sandbox): 1861/1861 across
all six shards (359/350/180/323/314/335), zero diff from `origin/main` outside this checkpoint's own
files. Two transient failures were observed only when running the six shards back-to-back
immediately after a fresh DB reset (one in `payroll-schema.test.ts`, two in performance-report
suites under real load); both suites are pre-existing, untouched by this diff, and reran 100% green
individually — the same class of load-sensitive flake this project's prior checkpoints have already
documented, not a regression. Frontend: 1070/1070. `typecheck` (all three workspaces + E2E),
`lint`, and full `build` all clean.

**Local UAT, real dev servers + real browser** (fresh synthetic Site/Branch/Employee, disposable
local Postgres): recorded a PKR 5,000 LOAN targeting the current Draft cycle (materializes
immediately, RESERVED) — confirmed the Payroll Entry grid shows the PKR 5,000 deduction — Edited the
Advance Amount 5,000 → 10,000 (the exact original production numbers) — confirmed the Draft
deduction moved to PKR 10,000 in lockstep — Edited only the Advance Date (RESERVED, amount
untouched) — reopened Edit and confirmed the new date persisted — Edited Notes only — Cancelled, with
a reason — confirmed the Advance returned to `outstandingBalance` PKR 10,000 and the Payroll Entry
grid's deduction reversed to 0, freeing the field back to ordinary manual editability. Full lifecycle
confirmed working end-to-end through the real UI the way a Payroll Staff user would use it.

**Production**: read-only throughout — no browser or API action in this checkpoint touched anything
but the disposable local database. Sharafat Masih's live production record remains exactly as found
by the prior checkpoint (untouched); the recommended remediation is unchanged — a Master Admin uses
the now-corrected Edit action through the application itself once this deploys.

**Branch/PR/CI**: continued on `fix/v1.0.2-advance-edit-cancel`, committed as `66f4024`, pushed.
**PR #16 CI**: run `32872985805`, head `66f4024` — see `docs/PROJECT_PROGRESS.md`'s own entry for the
final per-job result.

**Per explicit instruction: STILL STOP BEFORE MERGE.** No merge, no deploy, no `v1.0.2` tag, no
production mutation, Reliability Phase 5 not resumed, no other Checkpoint 2 finding touched.

---

## 64. Addendum, 2026-08-25 (later same day) — v1.0.2 PRODUCTION CUTOVER: PR #16 merged, post-merge
CI GREEN, production deployment and read-only smoke all GREEN, STOP BEFORE TAG — Sharafat Masih
Edit/Cancel/Defer found blocked (409) on the deployed fix, two remediation paths recorded, neither
executed

Full technical record: `docs/PROJECT_PROGRESS.md`'s own "v1.0.2 PRODUCTION CUTOVER — PR #16 Merged,
Post-Merge CI, Render Deployment, Production Smoke, Sharafat Masih Remediation-Blocked Finding"
entry, directly below §63's referenced entry. This addendum is the session-chronology summary.

**Pre-merge integrity gate re-checked and passed in full**: PR #16 head still
`6a9ece1f7c1e1f4abfed9689bdf5a69038ae1511` (matched the remote branch tip exactly), CI green at that
exact head (run `32875081305` — Backend all six shards, Frontend, E2E all `success`), `origin/main`
confirmed an ancestor of the PR branch (no divergence), working tree clean, diff scope re-confirmed
as the documented eight files only (zero migration/schema/dependency/Node/Render config changes).

**Merge**: PR #16 marked Ready for Review, merged with a normal merge commit — **`096cf793387
6df18729f0100920caa62647c496c`** — no squash, no rebase, no `--admin`, no force-push. Feature branch
retained.

**Post-merge CI** (run `32877904798`, head exactly the merge commit) — **SUCCESS**: Backend all six
shard steps individually green, Frontend green, E2E green (the actual Playwright suite step
completed, not skipped).

**Production deployment verification** — no Render API token/CLI/dashboard access this session
(disclosed, not glossed over). Backend `/health` → 200 `{"status":"ok"}` on both the custom domain
and the raw `onrender.com` URL. Frontend → 200 on both, `last-modified` ~55s after the merge
timestamp (circumstantial evidence of auto-deploy pickup). Authenticated production session (Ossamah
Suhail/Finance, Master User — already-authenticated browser session, not a fresh login) loaded the
Dashboard with real live data, confirming frontend↔backend communication.

**Production smoke, all read-only**: Advances page loads normally, full list renders with filters
intact. Payroll Entry page loads normally, same August 2026 Draft cycle, all columns intact, "All
changes saved." The narrowed Edit Advance modal was opened directly on Sharafat Masih's own live
Advance to visually confirm the deployed field set — **exactly** Advance Amount (5000), Advance Date
(25-08-2026), Notes ("10000 Advance Amount"), no other field — then closed via the modal's own
**Cancel** button without submitting anything. The record's PKR 5,000.00/PKR 0.00/Reserved (pending
release) values were re-confirmed unchanged immediately after.

**New finding — Sharafat Masih's specific record cannot currently be self-serviced through Edit,
Cancel, or Defer, for any input.** Traced (not executed against production) `updateAdvance`/
`cancelAdvance`/`deferAdvanceSchedule` in `backend/src/modules/advances/advances.service.ts` against
this record's exact live numbers. All three reverse the live PKR 10,000 Payroll Entry deduction back
onto `outstandingBalance` before writing, and all three then hit the checkpoint's own
`assertOutstandingBalanceWithinBounds` guard: reversing PKR 10,000 against a PKR 5,000
`totalAmount`/PKR 0 `outstandingBalance` Advance always yields a post-reversal `outstandingBalance`
exactly PKR 5,000 above whatever `totalAmount` ends up being — a bounds violation, unconditionally,
for Edit at any target amount, for Cancel (no input at all), and for Defer (no input at all). **This
corrects an untested assumption carried by both prior v1.0.2 checkpoint entries** ("a Master Admin
uses the now-fixed Edit action") — that action does not actually work for this record; the guard is
functioning exactly as designed (a clean 409 instead of the original unhandled 500), but there is
currently no self-service in-app remediation path for this specific pre-existing corruption. A real
fix requires a one-time, engineer-executed data correction reconciling the Advance and its Payroll
Entry back into a mathematically consistent relationship, not a Finance-clickable action.

**Two remediation paths recorded, neither executed**: (1) if PKR 5,000 is correct, the Payroll
Entry's `advanceDeduction` must be brought back down to PKR 5,000 by an engineer (the app's own
direct-PATCH path for this field is now correctly blocked when Advance-linked); (2) if PKR 10,000 is
correct, the Advance's `totalAmount`/`outstandingBalance` must be raised to PKR 10,000/PKR 0 by an
engineer to match its Payroll Entry. Full detail in `docs/PROJECT_PROGRESS.md`'s own entry. **Neither
path was executed** — Sharafat Masih's live record remains exactly as found by every prior
checkpoint: `totalAmount` PKR 5,000, `outstandingBalance` PKR 0, `status` RESERVED, `repaymentType`
FULL_DEDUCTION, linked Payroll Entry `advanceDeduction` PKR 10,000, `notes` "10000 Advance Amount."

**Zero production mutations, confirmed.** `v1.0.0` (`ea2bcfe4...` → `5e097ef4...`), `v1.0.0-rc1`,
`v1.0.1` (`f5897afa...`), and `backend-live-v1` all reconfirmed present and unchanged via `git tag
-l`.

**Release classification: GREEN — v1.0.2 deployed and production-validated; ready to tag, with
Sharafat Masih live-data remediation separately pending business confirmation of the correct amount.
Recommended tag target: `096cf7933876df18729f0100920caa62647c496c`.**

**Per explicit instruction: STOP BEFORE TAG.** The `v1.0.2` tag was NOT created, no GitHub Release
was published, `v1.0.0`/`v1.0.0-rc1`/`v1.0.1`/`backend-live-v1` were not moved, Sharafat Masih was
NOT remediated (either path), Reliability Phase 5 was not resumed, and none of H1/H2/H3/S1/M2/M3 was
touched. Awaiting explicit approval to tag `v1.0.2`, and separately, business confirmation of the
correct Sharafat Masih Advance amount before any remediation is executed.

---

## 65. Addendum, 2026-08-25 (later same day) — v1.0.2 RELEASED: tag created, GitHub Release
published, Sharafat Masih remediation status PENDING BUSINESS CONFIRMATION

§64's GREEN release classification was reviewed and release explicitly authorized: "The Sharafat
Masih inconsistency is a pre-existing live-data anomaly and does not block tagging the successfully
deployed integrity fix."

Full technical record: `docs/PROJECT_PROGRESS.md`'s own "v1.0.2 RELEASED — Tag Created, GitHub
Release Published" entry. This addendum is the session-chronology summary.

**Final integrity check, immediately before tagging** — all passed: `v1.0.2` did not already exist
locally or remotely (`git tag -l` / `git ls-remote --tags origin`); target commit
`096cf7933876df18729f0100920caa62647c496c` confirmed to exist with exactly the expected parents
(`7443143b...` prior `main`, `6a9ece1f...` PR #16 head) and confirmed an ancestor of `origin/main`;
`v1.0.0`/`v1.0.0-rc1`/`v1.0.1`/`backend-live-v1` all reconfirmed unchanged on the remote before
tagging.

**Tag**: annotated tag **`v1.0.2`** (tag object `065aa682f7f4129a7f949994a1afa2fcac77f8d0`) created
pointing exactly at **`096cf7933876df18729f0100920caa62647c496c`** — PR #16's merge commit —
deliberately **not** the subsequent documentation commit `4634b933c41ad11091538f04b667dff60d92ff9b`
(which records this cutover's own merge/CI/production evidence but changes no application code).
Pushed with `git push origin v1.0.2` (only this one ref, no force-push). Independently re-resolved
after push via `git ls-remote --tags origin`: `refs/tags/v1.0.2^{}` =
`096cf7933876df18729f0100920caa62647c496c`, matching exactly.

**GitHub Release**: published from the `v1.0.2` tag, title "Payroll Management System v1.0.2",
`isDraft: false`, `isPrerelease: false`, `targetCommitish: 096cf7933876df18729f0100920caa62647c496c`
(confirmed via `gh release view --json`). Release body covers the Advance Edit/Cancel and
Advance↔Payroll Entry integrity improvements (Edit narrowed to Amount + Advance Date + Notes;
Amount edits atomically synchronize the Advance and any linked unreleased Draft Payroll Entry
deduction; Advance Date is non-financial metadata editable at every lifecycle stage; Cancel
correctly reverses valid unreleased reservations; Payroll Entry can no longer independently
overwrite an Advance-managed deduction; a legacy inconsistent state now fails safely with a 409
instead of a 500; released payroll history remains immutable; concurrency guards prevent
Advance/Payroll Entry divergence), with an explicit scope note that this release does not
automatically repair any pre-existing inconsistent production record. Published
`2026-08-25T18:01:57Z`.

**Post-tag verification**: `v1.0.0` (`ea2bcfe4c989fcf8fc9293a09881bbdc0e9cc799` →
`5e097ef470956ade8b022072fbdf16949539777c`), `v1.0.1` (`3a8592fcb4268490b4c482f852049a21e643750b` →
`f5897afa38a07662fc29244e0a77e2d6866426d4`), `v1.0.0-rc1`
(`69d910dceb0579c657f04edce09a643c60cd3a92` → `45f6854fb9ed0fc97adf04a299b35029d9a3852c`), and
`backend-live-v1` (`35ed0de422c954542b74d70d065a4802c3c97113` →
`2f9471834fdaff1d9909010ff4a1fd2e33d366ba`) all re-confirmed unchanged on the remote after the
`v1.0.2` push.

**Sharafat Masih — remediation status PENDING BUSINESS CONFIRMATION, untouched by this release.**
Preserved exactly as found: Advance `totalAmount` PKR 5,000, `outstandingBalance` PKR 0, `status`
RESERVED, `repaymentType` FULL_DEDUCTION, linked Payroll Entry `advanceDeduction` PKR 10,000, `notes`
"10000 Advance Amount." Ordinary Edit/Cancel/Defer now safely return a 409 domain conflict on this
specific record rather than corrupting its state further, per §64's own finding. No direct SQL was
run, no guard was bypassed, no production validation was weakened. The two application-level
remediation paths (each requiring a one-time engineer-executed correction, not a Finance
self-service UI action) remain recorded in `docs/PROJECT_PROGRESS.md`'s cutover entry, awaiting
business confirmation of whether PKR 5,000 or PKR 10,000 is correct before either is executed.

**Final classification: v1.0.2 RELEASED — Advance Edit/Cancel and Advance↔Payroll Entry integrity
production baseline established.** Per explicit instruction: no v1.0.3, no Sharafat Masih
remediation, no Reliability Phase 5 resumption, no H1/H2/H3/M2/M3 work, no further changes to the
`v1.0.2` tag, no other release. STOP.

---

## 66. Addendum, 2026-08-26 — Sharafat Masih legacy Advance inconsistency REPAIRED in production:
local rehearsal, production dry run, one-row production repair, full read-only post-verification

Full technical record: `docs/PROJECT_PROGRESS.md`'s own "Sharafat Masih Legacy Advance Repair —
Path 2 Local Rehearsal, Production Dry Run, One-Row Production Repair" entry, directly above its
"§2. Remaining work" heading. This addendum is the session-chronology summary.

**Business confirmation**: PKR 10,000 is the actual authorized/disbursed amount — settles the
"PENDING BUSINESS CONFIRMATION" status carried by §64/§65 above. Path 2 (raise the Advance to match
its already-correct Payroll Entry) explicitly authorized; Path 1 explicitly not reconsidered.

**Local rehearsal, disposable Postgres only**: a throwaway Jest file reproduced Sharafat Masih's
exact live numbers (`totalAmount` 5,000 / `outstandingBalance` 0 / `status` RESERVED /
`repaymentType` FULL_DEDUCTION, linked unreleased Payroll Entry `advanceDeduction` 10,000) and
rehearsed the exact standalone Advance-only compare-and-swap transaction intended for production —
proved one Advance row changes, zero PayrollEntry writes, one correctly-shaped audit log entry, and
that Edit/Cancel/Defer all 409 before repair and all succeed after, on independent fresh fixtures.
Also corrected one inaccuracy in the prior "traced, not executed" finding (§64): a same-value Edit
resubmission does not exercise the guard at all — only a genuine amount change, or Cancel/Defer,
actually reach it. Deleted after use, never committed. One piece of unrelated orphaned local test
data from an earlier session was found and removed to unblock cleanup — not production.

**Production access**: the official Render CLI (installed this session via Homebrew), authenticated
by the user themselves (`render login`, browser device-code flow — this session never handled a
password or token directly). The production backend was positively identified via DNS
(`payroll-api.brooms.com.pk` → `payroll-management-api-wlic.onrender.com`, exactly
`srv-d9euhnjtqb8s73b8f1s0`'s own service URL) and its database via the single shared Production
environment (`payroll-management-db`, `dpg-d9etojbeo5us73ftma40-a`) — not assumed from name
similarity. The production connection string was obtained via `render postgres get
--include-sensitive-connection-info` and held only in-memory, inline per command, never written to
any file/log/commit. No Render configuration (env vars, service settings, database settings,
networking, backups, deployment) was touched. No migration/seed/`db push`/reset was run.

**Repair actor**: resolved by a strictly read-only `SELECT` against production's `User`/`Role`
tables — two active Master Admin accounts were found (Ossamah Suhail/Finance and Muhammad
Suhail/CEO); execution paused and the user was asked to disambiguate rather than guessing.
`REPAIR_ACTOR_USER_ID = 4ba66cfc-615a-484c-991e-fc9d7497de04` (Ossamah Suhail/Finance) used.

**Production dry run**: the exact, unmodified, already-rehearsed script against the real production
database, no `--execute`. All preconditions (Advance id/employeeId/totalAmount/outstandingBalance/
status/repaymentType; PayrollEntry id/cycleId/employeeId/advanceId-linkage/advanceDeduction/
released; PayrollCycle id/status) matched exactly, then deliberately rolled back. Zero writes.

**Execution**: script file confirmed byte-identical (SHA-256 + `git status`) between dry run and
execute. Ran with `--execute` and the same actor id. Preconditions re-validated inside the
transaction a second time, then one guarded `Advance.updateMany` CAS wrote `totalAmount` 5,000.00 →
10,000.00 only — `outstandingBalance`/`status`/`repaymentType`/scheduling/notes all unchanged, zero
PayrollEntry writes — followed by one `advance.updated` AuditLog entry in the same transaction,
then committed.

**Post-write read-only verification**: Advance — `totalAmount` 10,000.00, `outstandingBalance` 0.00
(unchanged), `status` RESERVED (unchanged), `repaymentType` FULL_DEDUCTION (unchanged), `updatedAt`
changed. PayrollEntry — `advanceDeduction` 10,000.00 (unchanged), `advanceId` unchanged, `version`
**3 (bit-for-bit unchanged)**, `updatedAt` **unchanged** — proving zero writes, not merely an equal
value; `released` false. PayrollCycle — DRAFT (unchanged). Exactly one Advance row exists for this
employee. AuditLog — exactly one new `advance.updated` entry, correct actor, correct entity,
`changes.totalAmount = {from: "5000.00", to: "10000.00"}`, a note identifying this as the
business-confirmed legacy-data correction. **No other production mutation was performed** — every
step after the one authorized CAS write was strictly read-only; no Save/Edit/Cancel/Defer/Hold/
Release/Finalize action was exercised.

**Repository/script cleanup**: `backend/scripts/repair-sharafat-masih-advance.ts` deleted; confirmed
never committed to any branch or ref; working tree confirmed fully clean, still on `main`; `v1.0.2`
(and every other tag) unchanged.

**Final classification: GREEN — Sharafat Masih legacy Advance inconsistency repaired; Advance and
its linked August 2026 Draft Payroll Entry now reconciled at PKR 10,000.** Per explicit instruction:
no further production mutation, no Reliability Phase 5 resumption, no H1/H2/H3/M2/M3 work, no new
release. STOP.

---

## 67. Addendum, 2026-08-26 — H3 Employee Identity Completeness Audit CLOSED (AMBER), corrected for
the owner's Employee Code clarification

Full technical record: `docs/PROJECT_PROGRESS.md`'s own "H3 CLOSEOUT" entry, directly above its own
"§2. Remaining work" heading. This addendum is the session-chronology summary. The full H3 audit
itself (production population, missing-identity statistics, the 138 duplicate-name groups and their
LEVEL 0–3 classification, identifier-uniqueness results, schema/validation guarantees, and the
workflow-by-workflow employee-picker trace) was delivered directly to the owner in the immediately
preceding checkpoint and is not re-recorded here.

**Owner clarification, supersedes the prior report's framing**: Employee Codes have not yet been
generated for the full workforce — planned for a later dedicated implementation phase. **Missing
Employee Code (850/1,247 active employees, 68.2%) is expected current state, not an August
payroll-readiness defect, warning, or remediation item — it must not by itself move any
classification toward AMBER or RED.** No mass Employee Code cleanup, no mandatory-Code policy, no
Code-generation work, and no "new employees must have Code" rule are in scope now or in any near-
term checkpoint.

**H3 classification, corrected grounds: AMBER (unchanged conclusion, corrected reasoning)** — rests
on CNIC (103/1,247 missing, 8.3%) and Father Name (95/1,247 missing, 7.6%) completeness, and
specifically the "Muhammad Tariq" case: five active employees sharing that exact name, three with
neither Father Name nor CNIC populated — worse than the single confirmed pair the prior, now-stale
audit found. Those three remain currently distinguishable only because they sit at three different
Site/Unit combinations, which the app's existing employee pickers do display. **September attendance
entry may proceed.**

**Remediation, narrowly scoped**: (1) HR/Payroll populates Father Name and/or CNIC for the three
blank Muhammad Tariq records first; (2) then other duplicate-name employees missing both fields
simultaneously. Employee Code explicitly excluded from this remediation request.

**Software UX finding, recorded, deliberately not implemented**: the shared `EmployeeLookup`
component (Advances' Record Advance, Corrections' Request Correction) shows only Name + Employee
Code + Site + Unit at the selection point, never Father Name/CNIC. Now confirmed more relevant given
Employee Code's intentional incompleteness — the picker cannot safely assume Code is universally
available. Recorded as a future small UX-hardening candidate only; does not justify emergency
v1.0.3 work before payroll. Father Name search in Employee Registry remains deferred, unchanged.

**Production**: read-only throughout this closeout (documentation only) — no code, no production
mutation, no repository change beyond these two docs files.

**Final classification: H3 CLOSED — AMBER.** Per explicit instruction: no Employee Code work, no
EmployeeLookup UX change, no Father Name search change, no Reliability Phase 5 resumption, no other
H3-adjacent item authorized by this closeout. M2 (Working Days vs Cycle Days) begins next, as its
own separate, strictly read-only audit.

