# Implementation Plan — Payroll Management System

## Status

Architecture is **frozen and implementation-ready** as of this document's creation. This plan is the
master roadmap from an empty `backend/`/`frontend/` scaffold to a production deployment. It assumes
every decision in `docs/PROJECT_PRINCIPLES.md` and `docs/architecture/*.md` as given — this document
sequences and de-risks *building* that architecture; it does not revisit *what* to build.

If anything encountered during implementation appears to contradict the frozen architecture, **stop
and raise it before proceeding** — per the standing rule for this project, architecture is not
silently reinterpreted to fit an implementation convenience.

---

## Overall Implementation Strategy

Three principles govern the sequencing below, all inherited directly from the frozen architecture:

1. **Build the invariant-enforcing layers before anything that depends on them.** Authentication,
   RBAC/site-scoping, and the Audit Log are load-bearing for almost every later module — they're
   Phase 1, not a cross-cutting afterthought.
2. **Build along the load-bearing data path before its branches.** The path
   *Employee Registry → Payroll Entry → Payroll Processing → Release → Bank Sheets/Cash Receiving*
   (`docs/architecture/overview.md`) is built and proven correct before its highest-risk branch —
   *Corrections → Balance Adjustments* — is layered on top of it. Building the branch first would mean
   testing it against a moving trunk.
3. **The hardest correctness problem (the Correction baseline-replay algorithm,
   `docs/architecture/post-release-corrections.md`) is scheduled deliberately late, once everything it
   depends on is stable** — not deferred out of avoidance, but sequenced so it's tested against a
   trustworthy foundation rather than a still-changing one.

Within each phase: schema/migration work → backend service + route → tests → frontend → integration
test. No phase's frontend work starts before that phase's backend routes are tested, per Principle 4
(correctness before polish).

---

## Phase Breakdown

### Phase 0 — Project Scaffolding & Foundations

**Builds:** npm workspace root (`backend/`, `frontend/`, `shared/`); Express + TypeScript skeleton
with a health-check route; Vite + React + TypeScript skeleton with Tailwind configured from
`docs/design-system.md` tokens; Prisma initialized against a local PostgreSQL instance; the
`StorageProvider` interface with a working `LocalFilesystemStorageProvider`; GitHub Actions CI
skeleton (install, lint, typecheck); `shared/` package with an empty Zod schema/constants structure.

**Depends on:** nothing — this is the starting point.

**Effort estimate:** 2–3 days.

**Testing strategy:** CI pipeline itself is the test — a green build on a trivial change confirms
lint/typecheck/build all work end to end. No business-logic tests yet.

**Definition of Done:** `npm install && npm run build` succeeds from a clean clone; CI is green on a
pull request; a request to the health-check route returns 200 from both local dev and a first Render
staging deploy.

---

### Phase 1 — Auth, RBAC, and the Audit Log (foundational)

**Builds:** Prisma schema for the auth/RBAC/audit subset of `docs/architecture/database-schema.md`
in one initial migration — `Role`, `Permission`, `RolePermission`, `User`, `ProjectSite` (minimal:
id/name/branchCode/isActive only), `UserSiteAssignment`, `AuditLog`; seed
script (two roles + permissions, one Master Admin user); `express-session` + `connect-pg-simple` +
Argon2 login/logout; CSRF token issuance/validation middleware; the permission-check middleware and
the site-scoping middleware (independent layers, per `docs/architecture/authentication.md`); the
Audit Log module's insert-only service function plus the database-level `UPDATE`/`DELETE` block
(revoked privileges or a rejecting trigger). `Bank`, `AdjustmentType`, and `CompanySettings` — along
with the rest of the 18-table schema — are deferred to the phase that builds the module owning them
(see Phase 2's `Builds` entry), added via new additive migrations, per Principle 8. *(Resolved
2026-07-02: this deferral was implemented ahead of the plan text in a prior session and is now
ratified as the correct scope — see `docs/PROJECT_PROGRESS.md` §3.1.)*

**Depends on:** Phase 0.

**Effort estimate:** 4–6 days. This is small in table count but disproportionately important — every
later phase's security posture depends on getting this right once, rather than retrofitting it.

**Testing strategy:**
- Migration applies cleanly to an empty database; seed script is idempotent (safe to re-run).
- Login/logout/session-expiry unit and integration tests, including deactivation invalidating an
  active session immediately (the specific reason server-side sessions were chosen).
- RBAC middleware unit tests: a request without the required permission is rejected before reaching
  any handler; a Payroll Staff request for a site outside their assignment is rejected server-side
  regardless of client-supplied parameters.
- **Audit Log immutability test is mandatory here, not optional**: attempt an `UPDATE` and a `DELETE`
  against `audit_log` directly (bypassing the service layer) and assert both are rejected by the
  database itself — this is the one test in the whole plan that verifies a defense-in-depth
  guarantee, not just application logic.

**Definition of Done:** a scripted login as the seeded Master Admin succeeds; a scripted attempt to
call any protected route without a session fails with 401; a scripted attempt to update or delete an
audit log row fails at the database level; CSRF-missing requests to state-changing routes are
rejected.

**🛑 Review checkpoint.** Stop here for explicit approval before building anything on top of this
foundation. A flaw discovered later in RBAC or audit immutability is expensive to retrofit across
every module built after it.

---

### Phase 2 — Master Data: Project Sites, Employee Registry, Settings, Users

**Builds:** an additive migration bringing in `Bank`, `AdjustmentType`, and `CompanySettings`, with
seed rows (three banks, seven `AdjustmentType` rows, singleton `CompanySettings`) — this is the
Phase 1 seed-scope item deferred here per the resolved scope note (`docs/PROJECT_PROGRESS.md`
§3.1). `Bank` has no relationship to `ProjectSite` — Project Sites are physical client work
locations only, with no banking properties (see `docs/architecture/database-schema.md` §8's
2026-07-02 revision note; a `ProjectSite.defaultBankId` field was briefly added and then removed
before this phase's commit, having incorrectly conflated a site's client identity with banking
data). Project Sites CRUD (delete
blocked while employees remain assigned); Employee Registry CRUD (CNIC/employee-code partial-unique
handling, DOL-based soft "leaving," full site-scoped RBAC for Payroll Staff on view/edit/create per
the C11 decision, generic audit logging on every create/update); Company Details / My Profile / Theme
(Settings module); User Management (Master Admin creates Payroll Staff accounts with per-site
assignment via `UserSiteAssignment`); Employee Registry CSV/Excel import/export against the official
template headers.

**Depends on:** Phase 1 (auth, RBAC, audit).

**Effort estimate:** 4–6 days.

**Testing strategy:**
- Site deletion blocked while employees assigned; succeeds once reassigned.
- CNIC/employee-code uniqueness enforced only among non-null values.
- **Site-scoping boundary tests are the priority here**: a Payroll Staff user cannot view, edit, or
  create an employee at a site outside their assignment, tested both through the intended UI path and
  via a direct API call with a manipulated `siteId` — the server-side check must hold regardless of
  what the client sends (this is the concrete test for the C11 decision).
- Import/export round-trip: export then re-import the same file produces no unintended changes;
  malformed rows are rejected with per-row error messages, not a whole-file failure.

**Definition of Done:** Master Admin can create a Payroll Staff user, assign sites, and confirm that
user's session genuinely cannot see or touch employees/sites outside that assignment.

---

### Phase 3 — Payroll Entry & Payroll Processing (the core)

**Builds:** `PayrollCycle` Draft creation (bootstrapping the very first cycle); `calcNet` as a pure,
well-tested function (Principle 5); the Payroll Entry grid backend (paginated/filterable query keyed
by `(cycleId, siteId)`) and frontend (TanStack Table + TanStack Virtual for the 1,500-row grid,
inline-editable cells matching `docs/design-system.md`); optimistic locking via `version` with an
autosave pattern that surfaces a conflict rather than silently overwriting; the multi-select site
filter component; the "Copy to All" bulk-apply toolbar; Payroll Entry CSV/Excel import/export
(rejecting rows for already-released employees, per the original spec, with a per-row skip report).

**Depends on:** Phase 2 (Employee Registry, Sites).

**Effort estimate:** 7–10 days — the largest single phase, and the one the original spec explicitly
flags as the most likely source of a real-world performance complaint if done naively.

**Testing strategy:**
- `calcNet` unit tests covering every edge case named in the spec and the schema doc: null
  `otRate`/`leaveRate` falling back to derived rates, `cycleDays` at its boundary values (1 and 31),
  zero `days`/`grossPay`, and a fixed set of golden-output cases carried over from the prototype's
  sample data to catch any regression against the original formula.
- Concurrency test: two simulated concurrent edits to the same `PayrollEntry` — the second write must
  fail on stale `version`, not silently overwrite the first.
- Performance test with ~1,500 synthetic rows: grid renders and scrolls without all rows mounting to
  the DOM at once; this is validated here, not deferred to Phase 9, because it's cheapest to fix while
  the grid is freshly built.
- Import/export tests mirroring Phase 2's, plus the "skip already-released rows, report the skip
  count" behavior specifically.

**Definition of Done:** a full synthetic 1,500-employee Draft cycle can be created, edited across
multiple simulated concurrent sessions without data loss, filtered by site, and bulk-edited via Copy
to All — all within a response time that doesn't require the client to wait more than a second or two
per interaction on realistic hardware.

**🛑 Review checkpoint.** Stop here. This is the single source of truth for the entire system
(Principle 1) — everything in Phases 4–7 reads from what this phase produces. Verify `calcNet`
correctness and the locking/autosave behavior before building Release, Bank Sheets, or Corrections on
top of it.

---

### Phase 4 — Release, Payment Artifacts, and Advances

**Builds:** Release Salary (per-employee release, bulk Release All/Hold All scoped by site, with the
corrected C1/C2 behavior — `hold` never gates editability, and freezes only once `released = true`);
Bank Sheets and Cash Receiving Sheets (derived, read-only, filtered by bank/site, PDF via Puppeteer
and Excel via ExcelJS, matching the client's exact historical formats, disbursed from Broom Services'
own Company Bank Account(s) — see the design note added 2026-07-02 below); Payslip generation (PDF).

**Advances module, explicitly expanded 2026-07-02** (terms below map to the existing `Advance`
model in `docs/architecture/database-schema.md` §15 except where flagged as new or open):

- **Advance Requests** — recording a new `LOAN` or `EID_ADVANCE` (matches the existing spec's
  "Record Advance" action, done directly by Payroll Staff per `reference/PROJECT_SPEC.md`'s role
  description; a formal request/approval workflow, if wanted, is new scope and not yet confirmed).
- **Outstanding Balances** — `Advance.outstandingBalance`, already fully spec'd (§15); no change.
- **Installments / Deferred Deductions + Automatic Payroll Recovery — clarified 2026-07-02
  (RESOLVED).** Payroll Staff defines — and can edit at any time — a repayment schedule for an
  `INSTALLMENT`-type advance: specifically, the per-cycle deduction amount. "Automatic Payroll
  Recovery" means the system automatically *applies* that already-approved schedule going forward —
  it does **not** mean the system calculates or decides the amount. Concretely: at each new-cycle
  `PayrollEntry` creation (the existing cycle-turnover transaction, Phase 5), the linked `ACTIVE`
  advance's scheduled amount auto-populates that cycle's `advanceDeduction`/`.eidAdvanceDeduction`
  field, and `outstandingBalance` decrements accordingly — the field remains staff-editable
  afterward in Draft, like any other Payroll Entry field, if a one-off change is needed without
  altering the standing schedule. Editing the schedule itself is a distinct, audit-logged action.
  This stays fully compatible with `reference/PROJECT_SPEC.md`'s "verified multiple times" rule
  ("do not build auto-deduction *logic*... just preserve the balance-tracking display") — no value
  is ever computed by the system, only repeated forward until staff changes it — while removing the
  need to retype the same amount every month by hand.
  **Proposed schema addition for Phase 4** (not yet implemented): `Advance.scheduledInstallmentAmount`
  (numeric, nullable — null means no standing schedule, e.g. a one-off full-deduction advance).
- **Cash Advances** — advance disbursement to an employee with no bank account on file, parallel to
  the existing Cash Receiving Sheet concept for salary. **New scope**: the current `Advance` model
  tracks a balance but not a disbursement *event* or its payment method (cash vs. bank), so this
  needs its own design pass during Phase 4, not assumed here.
- **Advance-only Bank Sheets** — a dedicated bank-sheet-style document for disbursing a *new*
  advance amount via bank transfer, separate from the existing salary Bank Sheet. **New artifact
  type**, not in the current spec; needs its own design pass during Phase 4 (including which Company
  Bank Account funds it — see the design note below).

**Company Bank Account design note (added 2026-07-02, pending user approval — not yet implemented):**
Broom Services owns multiple bank accounts used as the *source* of salary/advance disbursements,
separate from `Employee.bankId` (an employee's own receiving account) and never attached to
`ProjectSite` (confirmed 2026-07-02 — see `docs/architecture/database-schema.md` §8's revision
note). A `CompanyBankAccount` lookup table is proposed for Phase 4 schema work: `id`, `bankId` (FK →
`Bank`), `accountNumber`, `accountTitle`, a human-readable `label`, `branchCode`, `isActive`,
`isDefault`. Two open sub-questions need an answer before this is finalized: (1) is disbursement
same-bank-only (a Broom Services HBL account pays HBL-held employees), or can any company account
fund any employee via manual selection at Release time; (2) is the source account recorded per
`PayrollEntry`/per-release (fine-grained, supports mixed sourcing within one cycle) or per Bank
Sheet generation event (coarser)? See `docs/PROJECT_PROGRESS.md` §3 item 7.

**Depends on:** Phase 3 (Payroll Entry must exist and be reliable before anything derives from it).

**Effort estimate:** 5–7 days.

**Testing strategy:**
- State-machine tests: an employee cannot be released while `hold = true`; toggling hold has no
  effect on field editability; once released, every field including `hold` is verified immutable
  (application layer, plus a direct-write test against the recommended DB trigger).
- Bank Sheet/Cash Receiving derivation tests: only released, non-held, correctly-bank/no-bank
  employees appear; totals match the sum of underlying `PayrollEntry.netSalary` values exactly
  (Principle 6) — a golden-file comparison against a hand-computed expected sheet for a fixed test
  dataset.
- PDF/Excel output tests: generated documents match the client's real formats (payslip, bank sheet,
  cash sheet) closely enough to be usable as-is — this one benefits from an actual client review pass,
  not just automated snapshot testing.
- Advance auto-linking test: a new deduction links to the correct `ACTIVE` advance; attempting to
  create a second `ACTIVE` advance of the same type for one employee is rejected by the partial unique
  index.

**Definition of Done:** a full release cycle — release a filtered site, generate its Bank Sheet and
Cash Receiving Sheet as PDF and Excel, generate a payslip for a released employee — can be performed
end to end and the client (or someone standing in for them) confirms the documents are usable as-is.

---

### Phase 5 — Cycle Finalization, Archiving, and Backups

**Builds:** the explicit "Finalize Cycle" action with its no-override precondition
(`docs/architecture/data-and-storage.md` §4); the new-cycle-creation transaction (archive the outgoing
cycle, generate its backup package, create the new Draft's `PayrollEntry` rows for active employees
plus any employee with a `PENDING` Balance Adjustment); the Backup Package generator (Payroll/Bank
Sheets/Receivings CSV + `metadata.json`, versioned, written through `StorageProvider`); the Payroll
Cycle Selector (browse any historical cycle, always reading PostgreSQL, never a backup file).

**Depends on:** Phase 4 (Release must exist for the finalization precondition to be meaningful).

**Effort estimate:** 4–6 days.

**Testing strategy:**
- Finalization precondition test: blocked while any non-held entry is unreleased; **explicitly test
  that no code path — including a direct API call as Master Admin — can override this**, since the
  decision was "no override," not "override requires extra permission."
- New-cycle-creation transaction test: verifies the all-or-nothing behavior (archive + backup +
  new-cycle creation succeed together or not at all); a deliberately-departed employee with a
  `PENDING` Balance Adjustment is confirmed to receive a new `PayrollEntry` in the next cycle, flagged
  as a Final Settlement.
- Backup package test: generated CSVs match what the in-app Bank Sheet/Cash Sheet showed at the moment
  of archiving, byte-for-byte on the figures; regenerating a backup for an already-archived cycle
  (triggered by a later correction, tested together with Phase 6) increments `Backup Version` rather
  than overwriting.
- Cycle Selector test: viewing a historical cycle never touches the `StorageProvider` — verified by
  asserting no storage read occurs during a historical-view request.

**Definition of Done:** a full month-end cycle turnover — finalize, auto-archive, auto-backup, new
Draft created — can be run against a realistic dataset, and the resulting Archived cycle's data is
byte-identical to what the app showed immediately before archiving.

**🛑 Review checkpoint.** Stop here before Corrections. Once Phase 6 is built, Archived cycles will
start receiving live corrections against real historical data — the archiving/backup mechanics need
to be trusted first.

---

### Phase 6 — Corrections & Balance Adjustments (highest-risk logic)

**Builds:** the Correction workflow (before/after preview, mandatory reason + standardized Adjustment
Type, Master-Admin-only approval); the **baseline-reconstruction/replay algorithm**
(`docs/architecture/post-release-corrections.md`) exactly as specified — this is the most
implementation-sensitive piece of logic in the entire system; the Balance Adjustment automatic
settlement pipeline, including the `NONE`-type zero-difference case; the Advance-reconciliation
transaction triggered by a correction to a deduction field; the merged-payment representation in Bank
Sheets/Cash Receiving Sheets (one row, combined amount) with the breakdown surfaced separately on
Payslips and the Statement of Account groundwork (full Statement itself is Phase 7).

**Depends on:** Phases 3–5 (Payroll Entry, Release, and Archiving must all be solid — this phase
operates entirely on data those phases produce and lock).

**Effort estimate:** 6–9 days — small in table count, large in correctness surface area.

**Testing strategy (the most important test suite in the project):**
- **Sequential-correction tests are mandatory and exhaustive**: two corrections to *different* fields
  on the same entry must produce a second `BalanceAdjustment` that correctly reflects the first
  correction's already-approved effect; two corrections to the *same* field must show the second
  approver the post-first-correction value as "old," not the stale original; cumulative balance
  adjustments across N corrections must sum to exactly the true total difference from the originally
  released figures. These should be property-style tests generating random correction sequences and
  asserting the invariant holds, not just a couple of hand-picked examples.
- Zero-diff correction test: creates a `NONE`-type, already-`SETTLED`, zero-amount row; never appears
  in any pending-balance query or payment artifact.
- Advance-reconciliation test: correcting a deduction field adjusts the *linked* advance's balance
  (via the stored FK, not "whichever is currently active"), including the scenario where the
  originally-linked advance has since been paid off and superseded by a new one of the same type —
  this is the specific bug the explicit FK linkage was added to prevent, and must be tested directly.
- Settlement-merge test: a settling `PENDING` adjustment plus an ordinary net salary in the same
  release produces exactly one Bank Sheet row with the correctly combined amount — never two rows.
- Archived-cycle correction test: a correction against a cycle archived months earlier succeeds,
  triggers a new `BackupPackage` version for that cycle (tying back to Phase 5), and never touches the
  archived `PayrollEntry` row itself.

**Definition of Done:** the property-style sequential-correction test suite passes consistently
across many randomized runs (not just fixed examples); a full walkthrough — release a cycle, archive
it, submit two corrections against the same historical entry weeks apart, confirm the resulting
balance settles correctly and automatically in a future cycle's release — is demonstrable end to end.

**🛑 Review checkpoint.** Stop here for explicit sign-off. This phase is where a subtle bug would be
both easiest to introduce and most expensive to discover late (a wrong balance amount is a real
financial error, not a cosmetic one).

---

### Phase 7 — Statements, Reports, Dashboard

**Builds:** Statement of Account (per-employee, cross-cycle ledger, showing the replayed/corrected
current state, running balance, corrections and balance adjustments as distinct highlighted entries);
Fines & EOBI Report (multi-select site filter, four panels); Dashboard (summary stats, per-site
payroll summary, release progress, deduction breakdown, short-TTL caching).

**Depends on:** Phase 6 (Statements must correctly reflect corrections/balance adjustments, which
don't exist until Phase 6 is built).

**Effort estimate:** 4–6 days — lower implementation risk than Phases 3/6, but real correctness
dependency on everything before it, since these are pure aggregations with no data of their own.

**Testing strategy:**
- Statement running-balance test against a fixture with multiple cycles, a correction, and a settled
  balance adjustment — the running balance must reconcile to the same total the underlying
  `PayrollEntry`/`BalanceAdjustment` records imply.
- Report/Dashboard aggregate tests exclude departed employees from "current" counts unless they have a
  Final Settlement in progress.
- Cache invalidation test: a Dashboard figure updates within the cache's TTL window after the
  underlying data changes — not indefinitely stale.

**Definition of Done:** an employee with at least one correction and one settled balance adjustment
across two cycles shows a Statement of Account that a non-technical reviewer can follow and that
reconciles to the penny against the underlying records.

---

### Phase 8 — Supporting Features

**Builds:** Team Collaboration panel (Chat/To-Do — explicitly lowest priority per
`reference/PROJECT_SPEC.md`); Audit Log viewer UI (chronological feed, filterable); remaining
import/export polish and edge-case handling identified during earlier phases' testing.

**Depends on:** nothing structurally new — everything it touches already exists by Phase 7. Scheduled
last because the spec explicitly deprioritizes it.

**Effort estimate:** 2–4 days.

**Testing strategy:** Standard component/integration tests; lower bar than earlier phases is
acceptable here given the spec's own prioritization, but audit log viewing must still be verified
against the real `AuditLog` data generated by earlier phases' tests, not fixture-only data.

**Definition of Done:** Master Admin can browse the audit trail generated by every prior phase's
testing and recognize a coherent, readable history of the test scenarios that were run.

---

### Phase 9 — Hardening, Security Review, and Deployment

**Builds:** the full Playwright end-to-end suite across the complete lifecycle (create cycle → enter
payroll → release → generate sheets → finalize → archive → correct → settle → new cycle); a dedicated
security pass (RBAC boundary re-verification across every route, CSRF re-verification, session
handling); performance validation under realistic data volume; production environment setup on Render
(managed Postgres with PITR, web service, static site, staging separation, Sentry wired into both
services); a documented rollback plan; client User Acceptance Testing.

**Depends on:** all prior phases functionally complete.

**Effort estimate:** 5–8 days.

**Testing strategy:** this phase *is* the testing strategy — see the production readiness checklist
below, which doubles as its Definition of Done.

**🛑 Review checkpoint.** Stop for explicit client/stakeholder UAT sign-off before the production
deployment step specifically (staging deployment does not require this gate).

---

## Module Implementation Order (summary)

| Order | Module(s) | Phase |
|---|---|---|
| 1 | Authentication, Audit Log | 1 |
| 2 | Project Sites, Employee Registry, Settings, User Management | 2 |
| 3 | Payroll Entry, Payroll Processing | 3 |
| 4 | Release Salary, Bank Sheets, Cash Receiving, Advances | 4 |
| 5 | (Payroll Processing continued: Finalize/Archive/Backup) | 5 |
| 6 | Corrections, Balance Adjustments | 6 |
| 7 | Statements, Reports, Dashboard | 7 |
| 8 | (Team panel, Audit Log UI) | 8 |
| 9 | — (hardening/deployment, no new modules) | 9 |

This order matches `docs/architecture/overview.md`'s load-bearing path exactly, with Corrections/
Balance Adjustments deliberately sequenced after the trunk they branch from is proven, not before.

## Dependency Graph

```
Phase 0 (scaffolding)
   └─▶ Phase 1 (auth, RBAC, audit)                         🛑 checkpoint
          └─▶ Phase 2 (sites, employees, settings, users)
                 └─▶ Phase 3 (payroll entry, calcNet)        🛑 checkpoint
                        └─▶ Phase 4 (release, sheets, advances)
                               └─▶ Phase 5 (finalize, archive, backup)  🛑 checkpoint
                                      └─▶ Phase 6 (corrections, balance adjustments)  🛑 checkpoint
                                             └─▶ Phase 7 (statements, reports, dashboard)
                                                    └─▶ Phase 8 (supporting features)
                                                           └─▶ Phase 9 (hardening, deployment)  🛑 checkpoint
```

Each arrow is a hard dependency (the later phase reads or builds on tables/logic the earlier phase
produces) — phases are not meaningfully parallelizable beyond splitting frontend/backend work *within*
a phase across two developers, since almost every phase's backend must be trustworthy before its
frontend is built against it (per the overall strategy above).

---

## Definition of Done — Generic Criteria (applies to every phase in addition to its specific DoD)

- All new Prisma migrations applied cleanly to a fresh database via the seed + migration scripts.
- All new code passes lint and typecheck in CI.
- Unit and integration tests for the phase's specific testing strategy (above) are green.
- No principle from `docs/PROJECT_PRINCIPLES.md` is violated — reviewed explicitly, not assumed.
- Any deviation discovered from the frozen architecture during implementation has been raised and
  resolved (documented as an architecture update) before the phase is marked complete, not worked
  around silently.
- Audit Log entries are verified to appear for every mutation the phase introduces.
- **Playwright-driven visual verification — added 2026-07-02, mandatory from this point forward.**
  For any phase with frontend work: the actual pages/flows are rendered in a real (headless)
  browser and screenshotted — not just typechecked/linted/built — before the phase is considered
  done. This means: driving the affected routes and modals end to end, checking for console errors,
  and, where a live backend/DB isn't available, mocking API responses so real rendering can still be
  exercised. This was established during the Phase 2 UI/UX polish pass (see
  `docs/PROJECT_PROGRESS.md`'s "Phase 2 checkpoint" section for the audit that motivated it — it
  caught real defects, e.g. a table header/value alignment mismatch and a design-system-contradicting
  label-casing inconsistency, that static review and `typecheck`/`lint`/`build` alone did not).
  Standing checklist for every phase's Definition of Done, in order: **typecheck → lint → build →
  Playwright visual verification → documentation update → git checkpoint.**

---

## Risks and Mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| Correction baseline-replay algorithm implemented incorrectly | Wrong financial balances, discovered late | Property-style randomized test suite (Phase 6), dedicated review checkpoint before proceeding to Phase 7 |
| RBAC/site-scoping bypass via a missed route or a raw query | A Payroll Staff user sees/edits data outside their sites — a real security incident | Boundary tests introduced in Phase 2 and re-run in full in Phase 9; middleware applied at the router level, not per-handler, to minimize the chance a route is missed |
| 1,500-row Payroll Entry grid performs poorly | The client's explicitly named top concern ("cannot have any crashes or lapses") | Virtualization built in from the start of Phase 3, performance-tested within that same phase rather than deferred |
| Cycle archiving/backup failure blocks month-end close | A real business deadline (bank sheets/cheques go out on schedule) is missed | Phase 5 tests the all-or-nothing transaction explicitly; per `docs/architecture/database-schema.md` §22, cycle archiving is not coupled to backup file success in a way that can stall the transition — this needs to be re-verified during Phase 5, not assumed |
| Open design assumptions (`docs/architecture/database-schema.md` §26 items 2, 4, 5 — CNIC/employeeCode nullability, free-text designation/religion, calendar-month-only cycles) surface a real mismatch with client expectations | Rework of Employee Registry (Phase 2) or Payroll Processing (Phase 3) | Confirm these specific open items with the client before Phase 2 and Phase 3 begin, respectively — not discovered mid-build |
| Scope creep on Team Collaboration or cosmetic polish before the core payroll path is solid | Delays the client's actual priority | Enforced by phase ordering — Phase 8 cannot start before Phase 7 is done, and the spec's own prioritization is the justification if this is ever challenged |
| Client UAT surfaces a business-rule gap late (Phase 9) | Rework after "feature complete" | Where practical, informal client review is pulled earlier (explicitly suggested at the end of Phase 4, once real documents are being generated) rather than deferred entirely to Phase 9 |

---

## Deployment Milestones

- **End of Phase 0:** first deploy to Render staging — a trivial health-check app, proving the
  pipeline works before any real logic exists.
- **End of Phase 2:** staging redeployed with real auth + master data; usable for the client to start
  reviewing the Employee Registry UI against their real site/employee list.
- **End of Phase 4:** staging redeployed with a full release cycle usable end to end — this is the
  natural point for an informal client walkthrough of generated Bank Sheets/Cash Sheets/Payslips
  against their real historical documents.
- **End of Phase 6:** staging redeployed with Corrections/Balance Adjustments — the client should be
  walked through at least one real correction scenario before Phase 9's formal UAT.
- **End of Phase 8:** staging is feature-complete and matches the full approved scope.
- **Phase 9 completion, post-UAT sign-off:** production deployment on Render (managed PostgreSQL with
  PITR, web service, static site), Sentry live on both services, automated daily backups confirmed
  running, DNS cut over.
- **Post-launch:** a defined monitoring window (recommend at least one full monthly payroll cycle run
  in production before considering the system "settled") with Sentry alerting actively watched.

---

## Final Production Readiness Checklist

- [ ] All 18 tables migrated on production Postgres; seed data (roles, permissions, banks, adjustment
      types, Master Admin account, company settings) applied and verified.
- [ ] `BalanceAdjustmentType.NONE`, `PayrollEntry.advanceId`/`.eidAdvanceId`,
      `BalanceAdjustment.adjustmentTypeId` present and exercised by at least one passing test each.
- [ ] Audit Log immutability re-verified directly against the production database role's privileges
      (not just staging).
- [ ] RBAC/site-scoping boundary test suite passing against the production build.
- [ ] Full sequential-correction property test suite passing.
- [ ] Automated daily Postgres backups confirmed running, with point-in-time recovery enabled and a
      documented, tested restore procedure (a real restore drill, not just a configuration check).
- [ ] Backup package generation confirmed working against the production `StorageProvider`
      implementation (cloud, not local filesystem).
- [ ] Sentry receiving events from both the backend and frontend production services.
- [ ] SSL/TLS active on all public endpoints; session cookies confirmed `secure`/`httpOnly` in the
      production environment specifically (not just local dev).
- [ ] Staging and production environments confirmed separate (distinct databases, distinct storage
      buckets) — no shared state between them.
- [ ] CI gating deploys — no direct-to-production deploy path exists outside the pipeline.
- [ ] Client UAT sign-off obtained and recorded for at least: a full payroll cycle (entry → release →
      sheets → finalize → archive), one correction scenario, and the Employee Registry/RBAC boundary
      as experienced by an actual Payroll Staff account.
- [ ] Rollback plan documented (how to redeploy the previous release, and — separately — how a bad
      migration would be handled, given migrations are additive-first per Principle 8).
- [ ] Company Details (name, logo, address) populated with the client's real information, not seed
      placeholder data, before go-live.

---

## How to Resume This Project

Everything needed to resume — whether by this assistant in a future session or by a different
developer entirely — is in `docs/`. Read in this order: `docs/PROJECT_PRINCIPLES.md` →
`docs/architecture/overview.md` → the rest of `docs/architecture/*.md` → this file → whichever phase
is next per its checkpoint status. No context beyond these files should be required to continue
correctly.
