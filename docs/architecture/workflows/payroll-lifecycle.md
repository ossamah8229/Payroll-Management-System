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
    "Release now happens per Project Unit," above).
  - Corrections are allowed, per Principle 9 — see
    `docs/architecture/workflows/corrections-and-balance-adjustments.md` for the full request/approval,
    immediate/deferred, and installment-recovery mechanics (all revised 2026-07-05). This applies to
    entries that actually reached `released = true`; it does not apply to a held entry left unreleased
    past finalization (previous bullet).
  - Balance Adjustments are generated from approved corrections (see
    `docs/architecture/workflows/corrections-and-balance-adjustments.md`) rather than the original
    figures being changed.
  - The original released payroll record remains unchanged, permanently (Principle 9).
  - "Start New Payroll Cycle" is only available once the current cycle is `Released` — attempting to
    start a new cycle while the current one is still `Draft` is blocked with a message to finalize it
    first.

- **Archived (Locked)** — triggered automatically the moment a new payroll cycle is created.
  - The entire cycle becomes historical and fully read-only.
  - Archived cycles continue to accept Corrections indefinitely (a dispute or discovered error
    doesn't have an expiry) — per the trigger condition above, this was already true the moment the
    cycle became `Released`; `Archived` doesn't change the correction-eligibility rule, only the
    cycle's own visibility/historical status. What never happens, in either state, is the historical
    `PayrollEntry` record itself being edited. Every approved Correction against a Released or
    Archived cycle creates a Balance Adjustment, which is always settled inside the *currently active
    Draft* cycle — never by writing back into the original cycle's own figures, and never by
    reopening it. See `docs/architecture/workflows/corrections-and-balance-adjustments.md` for the full
    settlement workflow.
  - A backup package is automatically generated for the cycle being archived (§5).

Only one cycle is ever in `Draft` state at a time.

### New Cycle Creation & Employee Selection

Creating a new cycle requires the current cycle to already be `Released` (above) and, in one
transaction, in this order:

1. Transitions the current cycle to `Archived` and generates its backup package (§5).
2. Creates the new `PayrollCycle` row (`Draft`).
3. Resolves any `ScheduledPayrollPeriod` matching this new cycle's `(year, month)`
   (`database/payroll-cycle.md §10a`) — a single, generic step, with no knowledge of which
   module(s), if any, reference that period.
4. Selects which employees get a new `PayrollEntry`: the union of (a) every currently active employee
   (`dateOfLeaving IS NULL`), and (b) every employee — active or departed — selected by **any
   registered Outstanding Payroll Obligation provider's** carry-forward predicate (see
   `docs/architecture/workflows/outstanding-obligations.md`). Payroll Processing never cares which
   module owns a given obligation; it only evaluates the union of whatever predicates are registered.
5. Bulk-creates the new cycle's `PayrollEntry` rows (each with its own single, freshly-seeded
   `PayrollEntryWorkLine`, per `database/payroll-entry.md §12a`'s carry-forward rule).
6. Invokes every registered provider's Payroll Materialization Hook, where one exists, against the
   newly-created entries — each invocation independent of the others (no assumed ordering, see
   `docs/architecture/workflows/outstanding-obligations.md`).

Carried-forward fields for continuing employees (gross pay, cycle days, OT/leave rate overrides, EOBI
amount/applicability, site/bank/designation as of the source cycle) follow the same copy-at-creation
rule as any new `PayrollEntry` — see `database/payroll-entry.md §12`.

### Payroll Cycle Selector

Users can open and view **any** previous cycle at any time, in whichever state it's in — Payroll
Entry, Release status, Bank Sheets, Cash Sheets, Payslips, and Statements as they existed for that
cycle. Every such view is scoped by `cycleId` and reads live from PostgreSQL. Editability of what's
shown follows the trigger condition above: an entry is editable only if `released = false` (simplified
2026-07-05, above); otherwise, changes only via Correction.

**Historical viewing inside the application always comes from PostgreSQL — never from a backup
package.** Backup packages (below) exist for disaster recovery and external/offline access only. This
distinction is intentional and must not be blurred: if PostgreSQL is the record of truth, any code
path that renders historical data from a backup file instead is a bug, even if it happens to produce
the same numbers today.

---

## 5. Backup Packages

When a cycle transitions to `Archived` (i.e., the moment a new cycle is created — see §4), the
system automatically generates a backup package for the cycle being archived.

**Contents:**
- Payroll CSV — full Payroll Entry data for the cycle, matching the existing Payroll Entry
  import/export column set.
- Bank Sheets CSV — the released, non-held, bank-account-holding employees for the cycle, one row
  per employee, using the same combined payment amount (net salary ± any settling Balance
  Adjustments) as the in-app Bank Sheet — see
  `docs/architecture/workflows/corrections-and-balance-adjustments.md` ("Representation in Bank
  Sheets, Cash Sheets, and Payslips"). The backup must never diverge from what the in-app sheet showed.
- Receivings CSV — the same, for released, non-held, cash-payment employees (Cash Receiving Sheet
  data).
- `metadata.json`, containing:
  - Cycle month/label and release-status summary (released / held / pending counts)
  - **Application Version** — the deployed app release/build identifier at generation time
  - **Database Schema Version** — the applied Prisma migration identifier at generation time
  - **Backup Version** — this package's own version number (see Versioning, below)
  - **Generated Timestamp** — when the package was produced

  Capturing application and schema version alongside the data itself means a backup package is
  self-describing: restoring or auditing it later doesn't require guessing which code/schema version
  produced it.

**Storage:** written through the `StorageProvider` abstraction (`docs/architecture/system-conventions.md
§2`) — local filesystem in development, swappable to cloud object storage in production without
touching the generation logic.

**Versioning:** a backup package's `Backup Version` increments if it is regenerated for a cycle that
has already been archived — which happens when a correction is later approved against that
historical cycle's data (see `docs/architecture/workflows/corrections-and-balance-adjustments.md`).
Each version is retained, not overwritten; the package itself follows the same "never overwrite
history" rule as the database.

**Purpose boundary:** backup packages are for disaster recovery and external handoff (e.g. giving the
client an offline copy, or restoring from a catastrophic failure) — they are not, and must never
become, a data source for any in-application feature.
