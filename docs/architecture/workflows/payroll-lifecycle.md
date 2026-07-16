# Payroll Cycle Lifecycle & Historical Access

**Owner module(s):** Payroll Processing (jointly with Release Salary for per-Unit release, and
Corrections/Balance Adjustments for what happens after release)

**Contains:** The Draft → Released → Archived state machine, the Correction-workflow trigger
condition, new-cycle creation and employee selection, the Payroll Cycle Selector, and backup-package
generation

**Sections:** §4–§5 (own sequence, inherited from the former `data-and-storage.md` — distinct from
`database/`'s §0–§26 range; always cite the filename) · Full database index: `database/README.md`

For the schema this workflow governs, see `database/payroll-cycle.md` (`PayrollCycle`,
`ScheduledPayrollPeriod`), `database/release.md` (`PayrollUnitRelease`, `PayrollUnitReadiness`), and
`database/payroll-cycle.md §17–§18` (`BackupPackage`, `BackupPackageFile`). For the Outstanding
Payroll Obligations extensibility seam referenced throughout this file, see
`docs/architecture/workflows/outstanding-obligations.md`.

---

## 4. Payroll Cycle Lifecycle & Historical Access

**Revised 2026-07-05 (Phase 3 architecture review) — release now happens at Project Unit
granularity, not Site/Cycle granularity.** Everything below reflects that decision. The core shape of
this section (Draft → Released → Archived, Corrections apply once released, historical viewing always
reads PostgreSQL) is unchanged; what changed is *what sets* `PayrollEntry.released`, and the new
Correction-request/timing/installment mechanics layered on top of what happens after release. Full
schema detail: `database/payroll-entry.md §12`, `database/release.md §12b`,
`database/corrections.md §13a`, `database/balance-adjustments.md §14`, `§14a`, `§14b`.

### When the Correction workflow applies

This is the single trigger condition referenced everywhere in this document set — stated once here,
authoritatively, and never rephrased differently elsewhere:

> **A `PayrollEntry` requires the Correction workflow whenever `PayrollEntry.released = true`.**

**Simplified 2026-07-05** from the original two-clause "individually released, OR its parent
`PayrollCycle` is no longer in Draft." `PayrollCycle.status` is now itself derived from every Project
Unit under it having released or having all its remaining entries held (see "Cycle states" below) —
it can no longer diverge from entry-level `released`, so the second clause was never an independent
condition once that derivation exists; it's implied by the first. Any document or table that
previously stated the two-clause form is describing the same thing, just before this simplification
was possible.

### Cycle states

```
Draft (Open)
     ↓
 Released
     ↓
Archived (Locked)
```

- **Draft (Open)** — the current, in-progress cycle.
  - Payroll editing is allowed (all Payroll Entry fields, per employee) for any entry not yet
    released. Payroll managers (Payroll Staff, Master User) may freely edit any not-yet-released
    entry — this is unchanged and was never locked to only "before some deadline."
  - **Release now happens per Project Unit, not per Site (revised 2026-07-05).** Finance (a new role,
    see `docs/architecture/authentication.md`) executes "Release Unit X," inserting a
    `PayrollUnitRelease` row (`database/release.md §12b`) for `(cycleId, unitId)`. This immediately
    sweeps and releases every non-held `PayrollEntry` whose *every* touched Project Unit has now
    released — an entry with work lines at two Units waits for both, preserving one entry / one net
    salary / one Bank Sheet row even for a genuinely split employee (Principle 1, Principle 6). Finance
    may release a Unit immediately or wait for client funding to arrive — there is no forced timing,
    and different Units within the same Site or Cycle may release on entirely different days.
  - **"Ready for Release" (`PayrollUnitReadiness`, `database/release.md §12b`) is a separate,
    non-gating, informational status** — Payroll Staff mark a Unit "Ready" once its data entry is
    believed complete. This has **no effect whatsoever** on whether Finance can release that Unit;
    Finance may release a Unit that was never marked Ready, and marking a Unit Ready doesn't queue or
    trigger anything automatically. It exists purely so Finance has a signal, not a gate. Un-marking
    Ready deletes the row (there's no historical requirement to preserve it); if payroll data changes
    after a Unit was marked Ready, the system shows Finance a "modified since marked ready" notice
    (computed on read, not stored) without ever auto-clearing the flag.
  - Reports (Dashboard, Fines & EOBI Report, progress bars) continue updating live as figures change.
  - **Advance Deduction Deferral (added 2026-07-08, pre-Checkpoint-2 architecture amendment).** Before
    an entry is released, Payroll Staff (site-scoped) or Master User may defer that entry's linked
    Advance deduction to a chosen future Draft payroll cycle — frozen as BR-ADV-001 through BR-ADV-006,
    `database/advances.md §15`. This reuses the entry's existing edit permission and site-scoping; no
    new permission exists for it, and Finance (release-only, no payroll-edit capability) cannot perform
    it. Mechanically, in one transaction: the entry's `advanceDeduction`/`advanceId` (or
    `eidAdvanceDeduction`/`eidAdvanceId`) fields are zeroed (an ordinary Draft field edit, bumping the
    entry's existing `version`), the linked `Advance`'s `currentScheduledPeriodId` is moved to the
    chosen future `ScheduledPayrollPeriod` (`database/payroll-cycle.md §10a` — found or created for
    that target month via Payroll Processing's own owned find-or-create function, never a direct write
    from Advances, and never an existing `PayrollCycle` row, since only the current cycle is ever
    `Draft`), and an `AdvanceScheduleChange` row (`database/advances.md §15a`) records the mandatory
    reason plus who/when. A target must be strictly later than the current cycle — **not** limited to
    "next" or "one after next" (BR-ADV-003) — and, since released payroll is never modified
    (BR-ADV-002/Principle 9), this action is only ever available on an unreleased entry in the current
    `Draft` cycle to begin with; there is no mechanism to reach into a different cycle's entry to defer
    it. See `docs/architecture/workflows/outstanding-obligations.md` for how a deferred deduction is
    later picked back up once its target cycle is created.

- **Released** — the cycle as a whole has been finalized by an explicit Master User action
  ("Finalize Payroll Cycle"), not automatically and not as a side effect of any other action.
  **Reaffirmed 2026-07-05: this explicit action stays, even though `PayrollEntry.released` is now
  itself derived from per-Unit release events** — a cycle whose every Unit has released-or-been-held
  is merely *eligible* to finalize; it still shows as `Draft` until the Master User explicitly clicks
  Finalize, exactly as before this session. **Implemented Phase 5 Checkpoint 1 (2026-07-14):**
  `POST /api/v1/payroll-cycles/:cycleId/finalize` (`payroll-processing.service.ts`'s
  `finalizePayrollCycle`), reusing `payroll-cycle:manage` (the same permission cycle creation
  already uses). Finalization is a pure cycle-level `Draft` → `Released` transition, writing exactly
  one `payroll_cycle.released` `AuditLog` entry (`cycleId`, `year`, `month`, `entryCount`,
  `releasedCount`, `heldCount`) in the same transaction as the status change. **Empty cycles may be
  finalized** — a cycle with zero `PayrollEntry` rows trivially satisfies the precondition below.
  Finalization does **not** archive the cycle, generate a Backup Package, create a new cycle, release
  held entries, or invoke Advances materialization — those remain later Phase 5 checkpoints (or, for
  archiving/backups specifically, still not built as of this writing), each requiring its own separate
  authorization.
  - **Finalization precondition, strictly enforced, with no override:** the cycle cannot transition
    from `Draft` to `Released` while any `PayrollEntry` in it has `released = false AND hold = false`
    — i.e., every employee who could be released has been. **This wording is unchanged by the move to
    per-Unit release** — only the mechanism that sets `released = true` changed (`database/release.md
    §12b`'s sweep, or a Late Entry's own one-off release, below), not the precondition itself.
    Employees left `hold = true` are explicitly exempted from this precondition and may remain
    outstanding indefinitely; they do not block finalization. A pending **Late Entry** (below) is *not*
    exempted — it behaves like any other unreleased-and-non-held entry and blocks finalization the same
    way, unless also held. **There is no Master User override of this precondition** — Checkpoint 1's
    implementation exposes no override parameter anywhere in the route, request body, or service
    function signature. A cycle with unreleased, non-held stragglers simply cannot be finalized until
    they are released or held — this is deliberate: Corrections exist for genuine post-release
    discoveries, not as a shortcut around finishing the month's release work.
  - **Late Entry exception (added 2026-07-05):** if a new `PayrollEntry` is created for a Project Unit
    that has *already* released this cycle (e.g. a new hire added to an already-released Unit), the
    ordinary per-Unit sweep will never reach it — there's no future `PayrollUnitRelease` event left to
    trigger it. Such an entry needs its own dedicated, single-entry release action (mirroring "Release
    Unit X" but scoped to exactly one entry), requiring a mandatory reason (`PayrollEntry.lateReason`,
    `database/payroll-entry.md §12`) and generating its own one-off Bank Sheet/Cash Sheet document — the
    already-released Unit itself is never reopened or modified. Whether an unreleased entry currently
    qualifies for this path is derived, not stored: it's true exactly when every Project Unit the entry
    touches already has a `PayrollUnitRelease` row as of now. **This exception only applies while the
    Cycle itself is still `Draft`** — once the whole Cycle has been finalized (`Released`), no new
    `PayrollEntry` can be created against it at all; a new hire after full cycle finalization simply
    waits for the next cycle. The two behaviors reconcile this way, not as alternatives to choose
    between.
  - **The authoritative immutability rule (corrected 2026-07-14, Phase 5 Checkpoint 1 architecture
    review — this supersedes any earlier wording in this document that tied entry immutability to
    cycle status):**
    > A `PayrollEntry` becomes financially immutable when `PayrollEntry.released = true`. Cycle
    > finalization does not convert held, unreleased entries into released entries, and does not by
    > itself make them enter the Correction workflow.

    Concretely: a held, unreleased entry (`released = false`, `hold = true`) remains **ordinarily
    editable** after its parent cycle finalizes — exactly as editable as it was the moment before —
    because the shared editability guard (`payroll-entry.service.ts`'s `assertEntryEditable`) keys off
    `PayrollEntry.released` alone, never `PayrollCycle.status`. This was a **dormant conflict** before
    Checkpoint 1: no route could ever set a cycle's status to anything but `Draft`, so a
    (now-removed) `cycle.status !== 'Draft'` clause in that guard never actually fired; fixed as part
    of building Finalize rather than left latent. A held entry that survives finalization sits in
    neither the "ordinarily editable while cycle is Draft" bucket nor the Correction-eligible bucket
    in the sense those were originally described — it is simply an ordinarily-editable row whose
    parent cycle happens to be `Released`, per the rule above.

    **Extended to every mutation surface, not only the single-entry route (final review,
    2026-07-14):** the same first-pass fix had only touched `assertEntryEditable`'s own direct
    callers; two further surfaces carried an independent, equally-dormant `cycle.status !== 'Draft'`
    gate of their own and needed the identical correction — "Copy to All" bulk update
    (`bulkUpdatePayrollEntries`) and the CSV/Excel importer (`importPayrollEntries`). Both now rely
    purely on each row's own `released` flag, exactly like the single-entry path, so a held,
    unreleased entry stays reachable through every one of them after its cycle finalizes, while a
    released entry stays permanently skipped through all of them. Advance Deduction Deferral
    (`database/advances.md §15`) needed no code change — it already calls `assertEntryEditable` on
    the entry being deferred, so it inherited the fix automatically — but is worth stating
    explicitly: a held, unreleased entry may still have its Advance deduction deferred after its own
    cycle finalizes, precisely because the entry itself remains editable; the deferral *target*
    period's own cycle, if one already exists, must still independently be `Draft` (an unrelated
    check on a *different* cycle, unaffected by and not weakened by this fix); and a released entry
    can never use deferral to bypass immutability, since `assertEntryEditable` blocks it exactly as
    it blocks any other edit attempt. Full detail: `database/payroll-entry.md §12`'s Immutability
    note.
  - **Known, deliberately deferred product gap: there is no post-finalization release path for held
    entries yet.** Once a cycle finalizes, a held-but-unreleased entry has no in-app mechanism to ever
    become `released = true` for that cycle — Checkpoint 1 deliberately does not build a "Late Entry /
    post-finalization release" workflow (an override-free, explicitly separate future action, not to
    be confused with the no-override finalization precondition above). Until that workflow is built,
    the only way to affect payment for an employee left held past finalization is a hold/release
    decision in a *future* Draft cycle's own entry, per `database/payroll-entry.md §12`.
    `PayrollUnitReadiness` ("Ready for Release") likewise remains deferred, unrelated to this gap (see
    "Release now happens per Project Unit," above). **Sharpened by Phase 5 Checkpoint 4**: this
    "future Draft cycle" path is a *window*, not indefinite — a held entry stays ordinarily editable
    only through `Draft` and `Released`; once its cycle rolls over and archives, the row itself locks
    (below), so any correction to a still-unresolved held employee must happen before that rollover,
    or be carried forward into the new cycle's own entry, never by reopening the archived one.
  - Corrections are allowed, per Principle 9 — see
    `docs/architecture/workflows/corrections-and-balance-adjustments.md` for the full request/approval,
    immediate/deferred, and installment-recovery mechanics (all revised 2026-07-05). This applies to
    entries that actually reached `released = true`; it does not apply to a held entry left unreleased
    past finalization (previous bullet).
  - Balance Adjustments are generated from approved corrections (see
    `docs/architecture/workflows/corrections-and-balance-adjustments.md`) rather than the original
    figures being changed.
  - The original released payroll record remains unchanged, permanently (Principle 9).
  - **"Start New Payroll Cycle" (Phase 5 Checkpoint 3) lives on the Salary Release page**, next to
    Finalize Cycle, visible only when the current cycle is `Released` — behind a confirmation modal
    naming the outgoing cycle, the automatically-derived next period, and stating that a fresh Backup
    Package will be generated and the outgoing cycle archived. Attempting to start a new cycle while
    the current one is still `Draft` has no affordance here at all (the button doesn't render); the
    underlying plain-creation route independently rejects with a message to finalize first, for any
    caller that reaches it directly. The Payroll Entry page's own, separate "start the very first
    cycle" empty-state action is unaffected — see the plain-creation restriction, below.

- **Archived (Locked)** — **implemented Phase 5 Checkpoint 3 (2026-07-15)** as an explicit rollover
  action (`POST /api/v1/payroll-cycles/:cycleId/archive-and-create-next`, `payroll-cycle:manage`,
  Master-Admin-only), never an automatic side effect of ordinary cycle creation. Naming the outgoing
  cycle explicitly, rather than folding this into cycle creation, was the approved architecture
  decision (2026-07-15 review) — it keeps "create a cycle" (still possible only once, to bootstrap
  the very first cycle ever — see below) and "roll over to the next cycle" as two distinct actions,
  so starting a new cycle can never silently archive history as an undocumented side effect.
  - **The entire cycle becomes historical and fully read-only for ordinary editing — enforced,
    Phase 5 Checkpoint 4 (2026-07-16), not merely aspirational.** `assertEntryEditable`
    (`payroll-entry.service.ts`) rejects every ordinary mutation — single-entry update/delete,
    work-line add/update/delete, "Copy to All" bulk update, CSV/Excel import, and (inherited
    automatically) Advance Deduction Deferral — the instant the entry's parent cycle is `Archived`,
    **including a held, unreleased entry that was still editable through `Released`** (the one
    approved architecture decision this checkpoint made explicitly, superseding the "released-only"
    framing the Checkpoint 1 note above still uses for the `Draft`/`Released` window). This was the
    genuine open question Checkpoint 4 resolved: whether a held row's Checkpoint-1-approved
    editability window survives archiving. It does not — the decision favors Backup Package
    integrity (a still-editable row would let the archived record drift after its own archive-time
    snapshot) over indefinite held-row editability; the resolution path for a still-unresolved held
    employee is their own carried-forward entry in a later Draft cycle, never reopening the archived
    row (see the held-entry gap note above). Bulk update degrades gracefully for an Archived cycle —
    `appliedCount: 0` for the whole matched set, not a thrown error, matching how it already handled
    an all-released set before this checkpoint. Reads are unaffected: Payroll Entry, Bank Sheets,
    Cash Receiving, and Payslips all continue to read an Archived cycle exactly like any other,
    unrelated to this write-side lock.
  - Archived cycles continue to accept Corrections indefinitely (a dispute or discovered error
    doesn't have an expiry) — per the trigger condition above, this was already true the moment the
    cycle became `Released`; `Archived` doesn't change the correction-eligibility rule, only the
    cycle's own visibility/historical status. What never happens, in either state, is the historical
    `PayrollEntry` record itself being edited. Every approved Correction against a Released or
    Archived cycle creates a Balance Adjustment, which is always settled inside the *currently active
    Draft* cycle — never by writing back into the original cycle's own figures, and never by
    reopening it. See `docs/architecture/workflows/corrections-and-balance-adjustments.md` for the full
    settlement workflow.
  - A fresh Backup Package is always generated for the cycle being archived, immediately before the
    archive transition, as part of the same rollover action (§5).
  - `PayrollCycle.archivedWithBackupPackageId` records exactly which `BackupPackage` version gated
    this specific archive (`database/payroll-cycle.md §10`) — additive schema, Phase 5 Checkpoint 3.
  - Defensively re-validates, at rollover time, that the named outgoing cycle is the only currently
    `Released` cycle in the system — the invariant this checkpoint establishes (at most one cycle is
    ever `Released` at a time, since every rollover archives its predecessor atomically) should
    always hold by construction; this is a backstop, not the primary correctness mechanism.

Only one cycle is ever in `Draft` state at a time.

### New Cycle Creation & Employee Selection

**`POST /api/v1/payroll-cycles` (plain creation) is restricted to bootstrapping the very first cycle
ever** (no `PayrollCycle` row of any status exists yet) — implemented Phase 5 Checkpoint 3. Once any
cycle exists, this route rejects with a typed conflict pointing the caller at the rollover endpoint
below, regardless of that existing cycle's own status. This is what makes "starting a new cycle" and
"archiving the outgoing one" the same atomic action for every cycle after the first, with no route
that can create a second cycle without also handling its predecessor.

**Rollover (`POST /api/v1/payroll-cycles/:cycleId/archive-and-create-next`) requires the named
outgoing cycle to already be `Released`** and, in one PostgreSQL transaction (preceded by the
necessarily-non-transactional Backup Package storage write — see §5's cross-system ordering), in
this order:

1. Commits the freshly-generated Backup Package's `READY` metadata (assembled and written to storage
   just before this transaction opened — §5).
2. Transitions the outgoing cycle to `Archived`, setting `archivedAt`/`archivedBy`/
   `archivedWithBackupPackageId`, guarded by an atomic conditional update scoped to
   `status: 'Released'` (the same race-safe pattern Finalize's own `Draft` → `Released` transition
   uses) — a losing concurrent rollover attempt matches zero rows and reports a clean conflict.
3. Creates the new `PayrollCycle` row (`Draft`), whose `(year, month)` is always the outgoing cycle's
   own `(year, month)` plus exactly one calendar month (December rolling the year) — **derived
   automatically, never caller-supplied**. There is no "skip a month" or "pick an arbitrary period"
   override.
4. Resolves any `ScheduledPayrollPeriod` matching the new cycle's `(year, month)`
   (`database/payroll-cycle.md §10a`) — a single, generic step, with no knowledge of which
   module(s), if any, reference that period.
5. Selects which employees get a new `PayrollEntry`: the union of (a) every currently active employee
   (`dateOfLeaving IS NULL`), and (b) every departed employee with an outstanding obligation due this
   exact period. **Approved Phase 5 boundary (superseding this section's own earlier, more general
   wording — see `docs/architecture/workflows/outstanding-obligations.md`'s current text): there is
   no generic Outstanding-Payroll-Obligation provider/hook registry.** Advances is the only
   implemented obligation source today, called directly (an `ACTIVE` Advance whose
   `currentScheduledPeriodId` resolves to the new period) — a real registry is revisited only if a
   second, concurrently-existing provider (e.g. Phase 6 Balance Adjustments) actually demonstrates
   the abstraction is justified, never built ahead of that need. A departed-obligation entry carries
   no ordinary pay (`grossPay`/`eobiAmount` zeroed, `eobiApplicable` false) and is created
   `hold = true`, so it can never be mistaken for, or accidentally paid as, ordinary salary; it can
   still be released like any other held entry once its obligation is settled.
6. Bulk-creates the new cycle's `PayrollEntry` rows (each with its own single, freshly-seeded
   `PayrollEntryWorkLine`, per `database/payroll-entry.md §12a`'s carry-forward rule) — reading the
   outgoing cycle's own entries for carry-forward as late as possible, inside this same transaction,
   since a held, unreleased entry stays editable even after its cycle is `Released` (above).
7. Invokes Advances' own materialization directly against the newly-created entries (including any
   departed-obligation ones) — the one explicit call, not a registry dispatch.
8. Writes `payroll_cycle.archived`, `payroll_cycle.created`, and `payroll_cycle.rollover_completed`
   audit entries (§ Audit, below), all inside this same transaction.

If anything fails after the Backup Package version was reserved but before this transaction commits,
the entire transaction rolls back — the outgoing cycle is never archived without its corresponding
new Draft and bootstrap state, because that pairing is literally the same transaction. This attempt's
own already-written storage objects are then best-effort deleted and the reserved `BackupPackage` row
is marked `FAILED` — the same cleanup manual generation itself uses (§5). A failed rollover may
therefore leave a `FAILED` `BackupPackage` row and/or an orphaned storage object; it never leaves a
database-lifecycle change without its pair.

Carried-forward fields for continuing employees (gross pay, cycle days, OT/leave rate overrides, EOBI
amount/applicability, site/bank/designation as of the source cycle) follow the same copy-at-creation
rule as any new `PayrollEntry` — see `database/payroll-entry.md §12`.

### Payroll Cycle Selector

**Implemented Phase 5 Checkpoint 4 (2026-07-16).** Users can open and view **any** previous cycle at
any time, in whichever state it's in — Payroll Entry, Salary Release, Bank Sheets, Cash Receiving,
and Payslips all read live from PostgreSQL, scoped by an explicit `cycleId`. Statements remain out of
scope (deferred, unrelated to this checkpoint). **Editability of what's shown follows the trigger
condition below — corrected from this section's original wording**: an entry is editable while
`released = false`, **as long as its parent cycle is not `Archived`** (the approved Checkpoint 4
decision, see "Archived (Locked)" above) — not "otherwise, changes only via Correction," since
Corrections/Balance Adjustments remain Phase 6, not yet built.

**Route architecture — a URL segment, not a query parameter or local component state:**

```text
/payroll-cycles/:cycleId/payroll-entry
/payroll-cycles/:cycleId/release
/payroll-cycles/:cycleId/bank-sheet
/payroll-cycles/:cycleId/cash-receiving
/payroll-cycles/:cycleId/payslips
```

The five original flat paths (`/payroll-entry`, `/release`, `/bank-sheet`, `/cash-receiving`,
`/payslips`) remain mounted as compatibility redirects — both routes render the exact same page
component; `useSelectedPayrollCycle` reads `cycleId` from the URL via `useParams`, redirecting the
flat route to the canonical one once a default cycle resolves. This makes every historical view
refresh-persistent, back/forward-correct, and shareable by URL — a real gap the pre-Checkpoint-4
per-page ad hoc `<select>` + local-state implementations (Bank Sheet, Cash Receiving, Payslips, each
independently) never had.

**Default-selection rule, shared across every cycle-aware page** (`resolveDefaultCycleId`,
`frontend/src/hooks/use-payroll-cycles.ts`): the Draft cycle if one exists, otherwise the newest
Released cycle, otherwise the newest Archived cycle, otherwise no redirect (the true empty-install
case, where each page shows its own existing empty state). An explicit, malformed, or nonexistent
`:cycleId` already present in the URL is **never** redirected away from — the page's own existing
data-fetch error state (a 404/generic error) surfaces exactly as it always has, since none of the
underlying data hooks ever assumed a "current cycle" internally to begin with.

**Shared selector** — one hook (`useSelectedPayrollCycle`, `frontend/src/hooks/
use-selected-payroll-cycle.ts`) plus one small display component pair (`PayrollCycleStatusBadge`/
`PayrollCycleSelectField`, `frontend/src/components/payroll-cycle/payroll-cycle-selector.tsx`) used
identically by all five pages — replacing three independent, near-duplicate implementations (Bank
Sheet, Cash Receiving, Payslips) and adding the capability fresh to the two pages that never had it
(Payroll Entry, Salary Release). No search or virtualization — cycle counts stay in the dozens even
after years of operation. No page-specific filter (Site/Bank/Unit/search) lives in the shared piece;
those remain owned by each page exactly as before.

**Salary Release, specifically**: action-taking (per-Unit Release, Finalize, Rollover) is only ever
bound to the one currently Draft/Released cycle, gated by its live server-returned `status` — a
historical Archived selection renders a read-only summary with no action affordance at all. A
historical `Released`-but-not-current cycle cannot exist under the approved lifecycle (Checkpoint 3's
own invariant: at most one cycle is ever `Released` at a time, since every rollover archives its
predecessor atomically), so "is this the current outgoing cycle" reduces to checking `status ===
'RELEASED'` directly — no separate "is this THE current one" flag is needed. A confirmation modal
open for one selected cycle closes if the selection changes underneath it; a successful rollover
navigates directly to the new Draft's own Release page rather than relying on the default-selection
effect to catch up.

**Cycle-list disclosure**: `GET /api/v1/payroll-cycles` remains globally visible to any user holding
a payroll permission — not site-scoped — an explicit, confirmed decision (Phase 5 Checkpoint 4
architecture review), since a cycle's own `(year, month, status)` carries no employee, money, or site
information; every actual payroll figure remains fully site- and permission-scoped at the query level
exactly as before this checkpoint.

**Historical viewing inside the application always comes from PostgreSQL — never from a backup
package.** Backup packages (below) exist for disaster recovery and external/offline access only. This
distinction is intentional and must not be blurred: if PostgreSQL is the record of truth, any code
path that renders historical data from a backup file instead is a bug, even if it happens to produce
the same numbers today.

---

## 5. Backup Packages

**Implemented Phase 5 Checkpoint 2 (2026-07-14) as a reusable, manually-triggered domain; automatic
generation on the cycle archive transition implemented Phase 5 Checkpoint 3 (2026-07-15).** The
manual entry point (`POST /api/v1/payroll-cycles/:cycleId/backup-packages`, `payroll-cycle:manage`,
Master-Admin-only) is unchanged and still the only way to generate a backup for a cycle that is not
being archived right now (e.g. a manual snapshot, or — later — a correction-triggered regeneration
against an already-archived cycle). Rollover (§4) calls the same generator, refactored into four
composable phases (`reserveBackupPackageVersion` → `assembleBackupPackageFiles` →
`writeBackupPackageFilesToStorage` → `commitBackupPackageReady`) so both callers share one
implementation — see the Generation ordering note below for how rollover's own transaction folds the
fourth phase into its larger transaction rather than duplicating this logic. A Draft cycle is
rejected; `Released` and `Archived` cycles are both accepted.

**Rollover always generates a fresh Backup Package version, never reuses an earlier `READY`
package — approved Phase 5 Checkpoint 3 architecture decision.** This is forced by Checkpoint 1's own
approved rule that a held, unreleased `PayrollEntry` stays editable even after its cycle is
`Released` (§4) — an earlier package, manual or from a prior failed rollover attempt, cannot be
proven to still reflect the cycle's true final pre-archive state, so rollover's own fresh assembly,
generated immediately before the archive transition, is the only one ever trusted to gate it.

**Contents, approved by the 2026-07-14 architecture review (amended from this section's original
list):**
- `manifest.json` — package version, cycle identity, generation timestamp/actor, application/schema
  version, release-status summary, and every other file's own filename/checksum/size. Built last
  (it needs every other file's checksum to be meaningful) but stored/listed first.
- Payroll Entry CSV **and** XLSX — full Payroll Entry data for the cycle, produced by the same
  `exportPayrollEntriesToCsv`/`Xlsx` builders the live Payroll Entry export route already uses.
- Bank Sheets CSV — **one combined file spanning every active Bank plus Cash**, not one file per
  bank (a change from this section's original per-bank framing): built by looping the existing
  single-bank `getBankSheet()` query once per active Bank and once for Cash and concatenating rows,
  never a second query/calculation path.
- Cash Receiving CSV — produced by the existing `exportCashReceivingSheetToCsv` builder, unchanged.
- **Payslip PDFs and an Audit Log export were both evaluated and explicitly deferred** — absent from
  this checkpoint entirely. Payslips are deterministically regenerable on demand from released
  `PayrollEntry` data (the same reasoning `docs/architecture/system-conventions.md §2` already gives
  for not caching them elsewhere), and an Audit Log export has no existing builder to reuse. Revisit
  only if a real, measured need emerges — not built ahead of one.

Every figure in every file above is read from `PayrollEntry`'s own already-frozen columns via
existing, already-shipped builders — a backup can never diverge from what the in-app equivalent
showed, by construction (Principle 6), not by a separate parity check.

**Storage:** written through the `StorageProvider` abstraction (`docs/architecture/system-conventions.md
§2`) — local filesystem in development, swappable to cloud object storage in production without
touching the generation logic. Keys: `backups/{cycleId}/v{version}/{filename}` — five individual
stored objects per version (manifest + four data files), never a persisted ZIP of the whole package.

**Generation ordering (the approved cross-system atomicity ordering, now implemented):** assemble
every file's content in memory → write all five storage objects → one final PostgreSQL transaction
(create every `BackupPackageFile` row, flip the package to `READY`, write the audit entry) → commit.
If anything fails after the package's version was reserved, this attempt's own already-written
storage objects are best-effort deleted and the reserved row is marked `FAILED` with a short,
non-sensitive diagnostic — a `BackupPackage` is either `READY` and fully downloadable, or it is not a
usable domain record; there is no partial/half-written state ever exposed. For manual generation,
this final transaction is the entire transaction. **For rollover (Phase 5 Checkpoint 3), the exact
same final-commit phase (`commitBackupPackageReady`) instead runs *inside* rollover's own larger
transaction**, which also archives the outgoing cycle, creates the new Draft, bootstraps its entries,
and materializes Advances — "Backup metadata, cycle archiving, and new-cycle database state either
commit together or none of them commit." The version reservation and the storage writes themselves
still happen before that transaction opens either way, since neither can participate in a Postgres
transaction — this part of the ordering is unchanged by which caller is generating.

**Versioning:** version 1 is created the first time a Backup Package is generated for a cycle; each
subsequent generation (manual retry now, or — later — a correction approved against an already-
archived cycle, per `docs/architecture/workflows/corrections-and-balance-adjustments.md`) reserves
the next integer version atomically (`MAX(version) + 1`, inside the same transaction that creates the
row, before any storage write begins) and is retained, never overwritten — the package follows the
same "never overwrite history" rule as the database itself. A concurrent second generation attempt
for the same cycle either lands on the next version cleanly or loses the reservation race with a
typed `409 Conflict` (never two successful generations landing on the same version, never a raw
constraint-violation leak).

**Authorization:** generation, listing, package detail, and individual file download all reuse
`payroll-cycle:manage` (the same permission Finalize Cycle and cycle creation already use — all
three the same class of system-lifecycle action) — Master Admin only; no new permission was
introduced. Every download is authorized and resolved through the `BackupPackageFile` row's own id;
no raw storage key is ever accepted from or exposed to a client.

**Purpose boundary:** backup packages are for disaster recovery and external handoff (e.g. giving the
client an offline copy, or restoring from a catastrophic failure) — they are not, and must never
become, a data source for any in-application feature.

**Explicitly deferred, still:** historical cycle selection (Checkpoint 4), Payslip PDFs, an Audit Log
export, and a Backup Package browsing/download UI — generating one is reachable from the frontend (the
rollover trigger below), but browsing/downloading existing packages remains backend-API-only.
