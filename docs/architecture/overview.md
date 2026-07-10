# Architecture Overview

**Owner module(s):** All modules (system-wide architecture overview)

**Contains:** Modular-monolith rationale, the 18-module ownership table, high-level data flow,
extensibility seams

**Sections:** — (narrative document, not part of the §-numbered schema/workflow set) · Database
index: `database/README.md`

## Overall Architecture: Modular Monolith

The system is a single deployable Express + TypeScript application, backed by one PostgreSQL
database — not a microservices architecture. At this project's scale (a small internal user base, one
company, and — per Principle 10 — a design floor of 10,000+ employees rather than a hard ceiling) a
distributed architecture would add operational risk (network calls, partial failures, eventual
consistency) without solving a real problem, directly conflicting with Principle 4 (never sacrifice
correctness for performance/complexity that isn't needed). A well-indexed Postgres monolith
comfortably carries 10,000 employees' worth of relational data (`database/schema-invariants.md`
§23) — scaling to that floor is a matter of query/index/virtualization discipline within this
architecture, not a reason to abandon it.

What a monolith *doesn't* get for free — clean separation of concerns — is enforced by discipline
instead: the backend is organized into one folder per business domain under `backend/src/modules/`
(`docs/architecture/folder-structure.md`), and modules interact through each other's service-layer
functions, never by reaching directly into another module's database tables. This is what makes the
system's core invariants (Payroll Entry as single source of truth, immutable released payroll,
append-only audit log) enforceable in practice rather than just documented in principle.

## Major Modules

| Module | Owns | Responsibility |
|---|---|---|
| **Authentication** | Sessions, CSRF tokens | Login/logout, session lifecycle (`docs/architecture/authentication.md`), password verification. Publishes the current-user/permission context every other module's access-control middleware depends on. Depends on no other module. |
| **Employee Registry** | `Employee` | Identity, employment, and bank details (CNIC, name, father's name, DOB/DOJ/DOL, designation, deputed site, deputed Project Unit, bank/account). Enforces CNIC as the unique cross-system key (database-unique, partial — see `database/schema-invariants.md` §26 item 6 for the duplicate-detection UX built around it) and historical preservation (DOL, never hard-delete). **Payroll Staff are fully site-scoped here — view, edit, and create are all restricted to their assigned sites, with no global access, and no separate unit-level scoping exists since a Project Unit belongs to exactly one Project Site**; Master User is unrestricted (`docs/architecture/authentication.md`). Editing `Employee.siteId`/`.unitId` (a transfer) never cascades into any existing `PayrollEntry` — see Payroll Entry, below. |
| **Project Sites** | `ProjectSite` | Pure client/location master data (name, address, and the site's configured unit terminology — "Branch"/"Department"/etc.) — no banking or operational-unit properties of its own (revised 2026-07-03; previously conflated site and branch-code concepts). Referenced by Project Units and by Authentication/Settings (Payroll Staff site assignment, still site-level). Blocks deletion while units remain under it. |
| **Project Units** | `ProjectUnit` | **New, dedicated master-data module (2026-07-03)**, one level under Project Sites — the actual operational sub-division (a specific branch/department/section) an employee is deputed to, owning its own code and name (the direct successor to the old `ProjectSite.branchCode`). Referenced by Employee Registry (an employee's default unit) and Payroll Entry (work-line attendance, below). Blocks deletion while employees or work lines remain assigned. |
| **Payroll Entry** | `PayrollEntry` + `PayrollEntryWorkLine` (Draft-cycle writes) | The single editable data-capture surface for a cycle's monthly figures — Principle 1. `PayrollEntry` holds gross pay, allowance, leave, EOBI, advances, fines, hold; attendance (days, OT) is captured on one or more `PayrollEntryWorkLine` rows, **always at least one per entry**, each attributed to a specific Project Unit under the entry's own site (2026-07-03 — see `database/payroll-entry.md` §12a) so an employee working across more than one Branch/Department within a cycle is a native, non-special-cased workflow. **Business rule, enforced at both the database and application layers (`database/payroll-entry.md` §12a): a Work Line may only reference a Project Unit belonging to the same Project Site as its parent Payroll Entry — an employee's Work Lines can never span more than one Project Site within a cycle.** Site, designation, and bank fields are copied from `Employee` when the entry is created, then behave as ordinary Draft-editable fields (same as `grossPay`) — an `Employee` update never reaches back to change them. Payroll-data site-scoping is enforced against `PayrollEntry.siteId`, not `Employee.siteId`; multi-unit splitting is always intra-site per the rule above, so this remains the only scoping check needed. All downstream financial views — release, net salary, Bank Sheets, Payslips, Corrections — read from `PayrollEntry`'s aggregate figures only; none maintain an independent copy, and none operate at the work-line level. |
| **Payroll Processing** | `PayrollCycle`, `calcNet`, `ScheduledPayrollPeriod` (added 2026-07-08) | Owns the cycle lifecycle (Draft → Released → Archived, `docs/architecture/workflows/payroll-lifecycle.md` §4), including the explicit "Finalize Cycle" action that transitions Draft → Released — unchanged as an explicit Master User action even though `PayrollEntry.released` is now derived from per-Unit release events, below (revised 2026-07-05). Finalization is blocked — with no Master User override — while any non-held employee remains unreleased. Also owns the deterministic net-salary calculation (Principle 5) and orchestrates new-cycle creation: archiving the outgoing cycle, generating its backup package, resolving any `ScheduledPayrollPeriod` matching the new cycle (`database/payroll-cycle.md` §10a), and selecting which employees receive a new `PayrollEntry` — every active employee, plus any employee matched by a registered **Outstanding Payroll Obligation** provider (see Extensibility, below; today, Balance Adjustments and Advances). **Revised 2026-07-08:** Payroll Processing's bootstrap never contains obligation-specific knowledge itself — it only orchestrates (create cycle → resolve period → evaluate registered predicates → bulk-create entries → invoke registered Payroll Materialization Hooks, each independent of the others — no assumed order); each owning module supplies its own predicate/hook. **Revised 2026-07-07 (Phase 3 Checkpoint 0, implementation):** `calcNet`'s actual *implementation* lives in `shared/src/lib/calc-net.ts`, not backend-only — the frontend's live grid totals (a later checkpoint) need byte-identical net-salary math without a server round trip per keystroke, and this project's established "one implementation, never two" precedent (`formatDate`, `normalizeCnic`, `pluralize`, all in `shared/`) argues against a second, backend-only copy. Payroll Processing still *owns* the calculation in the architectural sense (it decides when/how it's invoked, and no other module reimplements payroll math independently) — only the physical location of the pure function itself moved. |
| **Release Salary** | `PayrollUnitRelease`, `PayrollUnitReadiness` (both added 2026-07-05) | **Revised 2026-07-05: release now happens per Project Unit, executed by the new Finance role**, not per-employee/per-site by Payroll Staff. Finance releases a Unit immediately or waits for client funding; this sweeps every non-held `PayrollEntry` whose every touched Unit has now released (an entry spanning multiple Units waits for all of them, preserving one entry/one payment — Principle 1, 6). A Late Entry (created after its Unit already released) gets its own one-off release instead, `lateReason` mandatory. `PayrollUnitReadiness` is Payroll Staff's/Master User's own non-gating "prep complete" signal to Finance — informational only, never required for release. Writes release/hold/readiness status; never independently edits payroll figures, and does not itself transition the cycle's own status (that's Payroll Processing's Finalize action, above — its precondition wording is unchanged, see `database/payroll-cycle.md` §10). |
| **Corrections** | `Correction`, `CorrectionRequest` (added 2026-07-05) | The Correction workflow, triggered whenever `PayrollEntry.released = true` (`docs/architecture/workflows/payroll-lifecycle.md` §4) — before/after preview computed against the entry's *current effective state* (replaying any prior corrections, not the stale original — `docs/architecture/workflows/corrections-and-balance-adjustments.md`), mandatory reason + standardized Adjustment Type. **Revised 2026-07-05:** any authorized payroll user may submit a `CorrectionRequest`; only a Master User may approve or reject it (producing a `Correction` on approval) — or a Master User may correct directly, bypassing the request entirely. Never mutates the underlying `PayrollEntry` (Principle 9). |
| **Balance Adjustments** | `BalanceAdjustment`, `CorrectionPayment`, `BalanceAdjustmentSettlement` (both added 2026-07-05) | The automatic settlement pipeline: always created on Correction approval (a zero-difference correction still creates one, typed `NONE` and immediately settled). **Revised 2026-07-05:** a `PAYABLE` balance settles `IMMEDIATE`ly (folded into an already-open `PayrollEntry`, else a standalone `CorrectionPayment`) or `DEFERRED` (unchanged — surfaced automatically in the next Draft cycle, settled and merged into that release's ordinary payment on release, never a second transfer). A `RECOVERY` balance may now settle across one or more future cycles as an installment, each cycle's partial application logged as a `BalanceAdjustmentSettlement` row. No manual transfer between cycles, ever. A correction to an advance-deduction field also reconciles the linked `Advance`'s balance in the same transaction. One of today's two registered Outstanding Payroll Obligation providers (below) — contributes only a carry-forward predicate, no Payroll Materialization Hook. |
| **Advances** | `Advance`, `AdvanceScheduleChange` (added 2026-07-08; `ScheduledPayrollPeriod` is owned by Payroll Processing, above) | A supporting module feeding Payroll Entry, alongside the rest of this table's modules — tracks a `LOAN`/`EID_ADVANCE`'s outstanding balance (`PROJECT_SPEC.md`: no auto-calculated installment size, but the system must track and display the remaining balance) and its scheduled deduction period. **Added 2026-07-08 (pre-Phase-3-Checkpoint-2 architecture amendment):** before an entry is released, Payroll Staff (site-scoped) or Master User may defer that entry's linked deduction to any future Draft payroll cycle — BR-ADV-001 through BR-ADV-006 (`database/advances.md` §15). A deferral moves (never duplicates) `Advance.currentScheduledPeriodId` and is permanently recorded in `AdvanceScheduleChange` (`database/advances.md` §15a). The other of today's two registered Outstanding Payroll Obligation providers (below) — contributes both a carry-forward predicate (an `ACTIVE` advance whose schedule resolves to the new cycle) and a Payroll Materialization Hook (materializing that cycle's deduction and writing the `advance.schedule_materialized` audit entry, distinct from `advance.deferred`). Reuses Payroll Entry's existing edit permission and site-scoping; no new permission, and Finance (release-only) cannot perform a deferral. |
| **Bank Sheets** | (derived, read-only) | Released, non-held, bank-account-holding employees for a cycle/bank/site — exactly one row per employee, amount = net salary ± any settling Balance Adjustments. No data entry — filters and export only. |
| **Cash Receiving** | (derived, read-only) | Same as Bank Sheets, for employees without a bank account, matching the Cash Receiving Sheet format — also exactly one row per employee. |
| **Statements** | (read/aggregation only) | Per-employee ledger: earnings, deductions, corrections, and balance adjustments across cycles, with running balance. Reads Payroll Entry, Corrections, and Balance Adjustments; owns no primary data of its own. |
| **Reports** | (read-only queries) | Fines & EOBI Report and future reports. Each report is an isolated, side-effect-free query module — this is also the extensibility seam for future reports (see below). |
| **Dashboard** | (read-only, cached) | Summary stats, per-site payroll summary, release progress, deduction breakdown. The most read-heavy module; a candidate for short-TTL caching. |
| **Settings** | `User`, `Role`, `CompanySettings` | Company Details (Master-User-only; feeds Payslip/Bank Sheet headers), My Profile, Theme, and User Management (accounts, role assignment, per-site assignment for Payroll Staff **and, added 2026-07-05, Finance**) — the "Settings & Profile" and "User Management" screens both live here, working with Authentication's permission model. |
| **Audit Log** | `AuditLog` | Append-only recorder and query surface for every financial/administrative action across all other modules (Principle 3). Receives events; never depends on other modules' internals. |
| **Tasks** | `Task`, `TaskNotification` (both added 2026-07-10) | **Added 2026-07-10 — the permanent replacement for the previously-planned "Team Collaboration panel (Chat/To-Do)."** Lightweight internal delegation/tracking: Master User creates and assigns a task to exactly one other user; the assignee can view and mark complete their own tasks; no one else can see the task exists. **Ownership-based visibility, not role- or site-based** — a genuine exception to this system's usual RBAC shape, see `docs/architecture/authentication.md`. Standalone and cross-cutting: it owns no payroll data, is read by no other module, and sits outside the load-bearing payroll data flow entirely (same category as Authentication/Settings below, not a payroll-domain module). Deliberately excludes chat, messaging, comments, discussion threads, attachments, subtasks, a Kanban view, and recurring tasks — not unbuilt placeholders, permanently out of scope. |

## Interactions & High-Level Data Flow

**Revised 2026-07-05 (Phase 3 architecture review)** — release now happens at Project Unit
granularity, executed by the new Finance role, and the Corrections branch gained a request/approval
split plus immediate/deferred and installment settlement options. The overall shape (master data →
Payroll Entry → Processing → Release → derived sheets, with Corrections/Balance Adjustments as the one
branch that changes a released entry's outcome) is unchanged.

```
                        ┌──────────────────┐     ┌────────────────┐
                        │ Employee Registry │     │ Project Sites  │   ← master/reference data
                        └─────────┬─────────┘     └───────┬────────┘
                                  └────────────┬───────────┘
                                               ▼
                                     ┌───────────────────┐
                                     │   Payroll Entry    │  ← current Draft cycle, single source of truth
                                     └──────────┬─────────┘
                                                │  orchestrated by
                                                ▼
                                     ┌───────────────────┐
                                     │ Payroll Processing │  ← cycle lifecycle, calcNet
                                     └──────────┬─────────┘
                                                ▼
                                     ┌────────────────────────────────┐
                                     │   Release Salary (per Unit)     │  ← Finance releases each Project
                                     │   PayrollUnitRelease            │    Unit independently; an entry
                                     │   PayrollUnitReadiness (signal) │    releases once ALL its touched
                                     └──────────┬───────────────────────┘    Units have (or via its own
                                                ▼                            Late Entry release)
                              ┌──────────────────┼──────────────────┐
                              ▼                                    ▼
                    ┌─────────────────┐                  ┌───────────────────┐
                    │   Bank Sheets    │                  │  Cash Receiving    │   ← derived, read-only
                    └─────────────────┘                  └───────────────────┘

   (once released = true, further changes to an entry flow through:)

   ┌───────────────────┐    ┌─────────────┐    ┌───────────────────────┐
   │ CorrectionRequest  │──► │ Corrections  │──► │  Balance Adjustments   │
   │ (optional; any     │    │ (Master User │    │  ┌─ PAYABLE, IMMEDIATE │──► fold into an open entry,
   │  payroll user;     │    │  approves/   │    │  │                     │    else a CorrectionPayment
   │  Master User        │    │  rejects, or │    │  ├─ PAYABLE, DEFERRED  │──► next Draft cycle (unchanged)
   │  approves/rejects) │    │  corrects    │    │  │                     │
   └───────────────────┘    │  directly)   │    │  └─ RECOVERY            │──► one or more future cycles,
                              └─────────────┘    └───────────────────────┘    each installment logged

   Every mutation above (Unit release, hold, correction request/approval/rejection, balance adjustment
   created/settled at any stage, advance reconciled, cycle finalized/archived, employee/user/role
   change) → Audit Log  (append-only, same transaction)

   Statements, Reports, Dashboard  ←  read-only aggregations over all of the above

   Authentication + Settings  →  cross-cutting: gate every module's access via
                                  role + site-scoping middleware; not part of the payroll
                                  data flow itself

   Tasks  →  cross-cutting, standalone: ownership-based visibility (not role/site-scoped);
             owns no payroll data and is read by no other module; not part of the payroll
             data flow itself
```

The load-bearing path is **Employee Registry / Project Sites → Payroll Entry → Payroll Processing →
Release Salary (now per Project Unit) → (Bank Sheets / Cash Receiving)**, with **CorrectionRequest →
Corrections → Balance Adjustments** providing the only route by which an entry that requires the
Correction workflow (`released = true`) can still have its outcome change — always by adding a new,
linked record, never by editing the path it branches from.

## Extensibility: Adding Future Modules Without Changing Payroll Processing

Payroll Processing owns the cycle state machine and `calcNet` — the one piece of the system where an
uncontrolled change would be highest-risk. Each future module integrates at a **defined seam**
instead of modifying it:

- **Biometric Attendance** — becomes a new *caller* of Payroll Entry's existing "set attendance
  figures" service function (the same function manual entry already uses to write `days`/`ot`), via
  a sync/aggregation service that turns raw punch records into those same fields. Payroll Processing
  never needs to know whether `days` came from a person typing or a biometric sync — the input
  contract is unchanged. Manual entry keeps working as an override.
- **Leave Management** — same pattern as Biometric Attendance: a new module owns leave requests,
  approvals, and balance tracking, and feeds its computed "leave days for this cycle" into Payroll
  Entry through the existing field/service contract, rather than introducing a second, parallel leave
  calculation inside Payroll Processing.
- **ESS (Employee Self-Service) Portal** — requires a third role. Authentication's RBAC is already
  modeled as Role → Permission (`docs/architecture/authentication.md`), so an "Employee" role with a
  narrow, self-scoped permission set is a data change. ESS gets its own API namespace
  (`/api/v1/ess/...`) that composes existing *read* paths (Statements, Payslip generation,
  Corrections history) scoped to the requesting employee's own CNIC — it consumes existing modules'
  outputs and never touches Payroll Processing's internals.
- **Gratuity** — a new, isolated module that reads Employee (DOJ/DOL) and historical cycle data
  through Payroll Processing's and Employee Registry's existing read APIs (not by querying their
  tables directly), computes a gratuity figure on exit, and writes to its own table. It never
  modifies core payroll tables or `calcNet`.
- **Outstanding Payroll Obligations (added 2026-07-08)** — the seam Payroll Processing's new-cycle
  bootstrap uses to decide which departed employees still need a `PayrollEntry`, and to let each
  obligation's owning module materialize its own entry fields, without Payroll Processing ever
  containing module-specific knowledge (`docs/architecture/workflows/outstanding-obligations.md`). Each owning
  module registers a **carry-forward predicate** ("does employee X have an obligation targeting the
  cycle now being created") and, optionally, a **Payroll Materialization Hook** ("materialize this
  obligation onto that employee's new entry" — named for what it does, not merely "populate," so the
  name stays accurate as further obligation types are added). Payroll Processing's bootstrap evaluates
  the union of every registered predicate, then invokes every registered Payroll Materialization Hook
  — it never inspects a provider's own tables directly. **Providers are independent and
  order-independent by design**: Payroll Processing never relies on the order predicates or hooks are
  evaluated in, and no provider may assume another has or hasn't already run within the same bootstrap.
  If a genuine ordering dependency is ever needed, it must be introduced as an explicit architecture
  decision, never implied by registration order. Today's two providers are Balance Adjustments
  (predicate only — a `PENDING` adjustment; settlement itself is unchanged, a release-time concern) and
  Advances (predicate **and** a Payroll Materialization Hook — a scheduled deduction resolving to the
  new cycle, per BR-ADV-001–006, `database/advances.md` §15). A future obligation type
  (Loans, Recoveries, Bonus Deferrals, or similar) plugs into exactly this same seam, registering its
  own predicate/hook, with no change to Payroll Processing's bootstrap orchestration itself.

The common thread: a future module either (a) calls an existing module's already-published write
path with new upstream data (attendance, leave), (b) consumes existing modules' read paths to compute
something new (ESS, Gratuity, additional Reports), or (c, added 2026-07-08) registers itself against
an explicit extension seam Payroll Processing already orchestrates generically (Outstanding Payroll
Obligations) — never (d) modifies Payroll Processing's internal state machine or calculation logic,
and never reaches into another module's tables directly. This is the same modular-monolith discipline
already governing the current 18 modules (added Project Units, 2026-07-03; Release Salary,
Corrections, and Balance Adjustments' internal mechanics revised 2026-07-05 for per-Unit release and
the Finance role; Advances added 2026-07-08 for Advance Deduction Deferral; Tasks added 2026-07-10,
replacing the previously-planned Team Collaboration/Chat panel — without changing the module
boundaries themselves), applied concretely to what comes next. **Tasks is not part of this
extensibility-seam list** — it doesn't call Payroll Processing's write paths, read its data, or
register against Outstanding Payroll Obligations; it's a standalone, cross-cutting supporting module
(alongside Authentication and Settings, below), not a payroll-domain extension.
