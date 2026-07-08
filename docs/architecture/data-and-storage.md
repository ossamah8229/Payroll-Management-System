# Data, Storage, and History Architecture

Covers: primary key strategy, the file storage abstraction, immutable audit logging, and the payroll
cycle lifecycle / backup package strategy. This document governs schema design before scaffolding
begins.

---

## 1. Primary Keys — UUID

All major entities use UUID primary keys, generated at the database layer (Postgres
`gen_random_uuid()`, matching Prisma's `@default(uuid())`), rather than auto-increment integers:

`Employee, PayrollCycle, PayrollEntry, User, ProjectSite, Correction, Advance, AuditLog`,
and, for consistency, every other application-owned table (`Role`, `Permission`,
`BalanceAdjustment`, `BackupPackage`, `CompanySettings`, etc.).

**Why:** sequential integer IDs leak information (row counts, creation order) and collide easily
across import/export/merge operations — a real risk here given CSV/Excel import is a first-class
workflow. UUIDs also let records be safely referenced in exported files, backup packages, and audit
log entries without depending on a live database sequence.

The one exception is the `express-session` / `connect-pg-simple` session table, whose schema is
dictated by that library, not by this rule.

---

## 2. Storage Abstraction Layer

Generated files (PDFs, Excel exports, backup packages, uploaded logos/avatars) are never written
directly to `fs` or a cloud SDK from business logic. All file I/O goes through a single
`StorageProvider` interface:

```
StorageProvider
  save(key, data, contentType)   -> StorageRef
  read(key)                      -> Buffer
  getUrl(key)                    -> string        // signed URL in cloud impl, local path/route in dev
  delete(key)                    -> void           // restricted; see audit note below
  list(prefix)                   -> StorageRef[]
```

**Implementations:**
- `LocalFilesystemStorageProvider` — development default. Writes under a project-local storage
  directory (e.g. `backend/storage/`), served back via a simple authenticated route for local use.
- Cloud implementation (e.g. S3 or R2-backed) — introduced when production hosting is finalized.
  Selected via configuration/environment variable; business logic that calls `StorageProvider` never
  changes when the implementation swaps.

Every feature that produces a file — Puppeteer PDF generation, ExcelJS exports, backup packages,
company logo/avatar uploads — depends on this interface only. This is what lets development run
entirely on the local filesystem while production later moves to cloud object storage with no
business-logic changes, per the approved architecture.

**Deletion is restricted and audited.** Generated payroll artifacts (payslips, bank sheets, backup
packages) are financial records — deleting one is itself an action that should go through the Audit
Log, not a bare storage call available to any code path.

---

## 3. Immutable, Append-Only Audit Log

The Audit Log is a permanent record. Application code has no code path that updates or deletes an
audit row — only `auditLog.record(...)`, an insert.

This is enforced at two layers, deliberately redundant (defense in depth — an application-layer rule
alone is one bug away from being violated):

1. **Application layer:** no service function exists to modify or remove an audit entry. Code review
   should treat any such function as an automatic rejection.
2. **Database layer:** the application's database role has `UPDATE`/`DELETE` privileges revoked on
   the `audit_log` table, and/or a `BEFORE UPDATE OR DELETE` trigger raises an exception. This
   protects against future bugs, ad hoc scripts, or a raw query bypassing the service layer.
   *(Revised 2026-07-04: the trigger carves out exactly one permitted UPDATE — the
   `actorUserId` NOT NULL → NULL transition produced by that FK's documented `ON DELETE SET NULL`
   action, with all other columns unchanged — because the original unconditional trigger made any
   `User` with audit history undeletable, contradicting `database-schema.md` §16's explicit FK
   design. See §16's matching revision note.)*

**Every financial mutation writes its audit entry in the same database transaction as the change
itself** — release, hold, correction (including a zero-net-difference correction — see
`docs/architecture/post-release-corrections.md`), balance adjustment created/settled, advance
recorded, advance balance reconciled by a correction, cycle status transition (Released, Archived),
employee record created/updated (including a site transfer, bank-detail change, or a departure being
recorded), user/role/site-assignment changes, company settings changes. If the transaction fails,
neither the change nor its audit entry persists — there is no state where a financial change exists
without a corresponding audit record, and there is no entity in the system whose mutations are exempt
from this list.

---

## 4. Payroll Cycle Lifecycle & Historical Access

**Revised 2026-07-05 (Phase 3 architecture review) — release now happens at Project Unit granularity,
not Site/Cycle granularity.** Everything below reflects that decision. The core shape of this section
(Draft → Released → Archived, Corrections apply once released, historical viewing always reads
PostgreSQL) is unchanged; what changed is *what sets* `PayrollEntry.released`, and the new
Correction-request/timing/installment mechanics layered on top of what happens after release. Full
schema detail: `docs/architecture/database-schema.md` §12, §12b, §13a, §14, §14a, §14b.

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
    `PayrollUnitRelease` row (`database-schema.md` §12b) for `(cycleId, unitId)`. This immediately
    sweeps and releases every non-held `PayrollEntry` whose *every* touched Project Unit has now
    released — an entry with work lines at two Units waits for both, preserving one entry / one net
    salary / one Bank Sheet row even for a genuinely split employee (Principle 1, Principle 6). Finance
    may release a Unit immediately or wait for client funding to arrive — there is no forced timing,
    and different Units within the same Site or Cycle may release on entirely different days.
  - **"Ready for Release" (`PayrollUnitReadiness`, `database-schema.md` §12b) is a separate,
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
    `docs/architecture/database-schema.md` §15. This reuses the entry's existing edit permission and
    site-scoping; no new permission exists for it, and Finance (release-only, no payroll-edit
    capability) cannot perform it. Mechanically, in one transaction: the entry's
    `advanceDeduction`/`advanceId` (or `eidAdvanceDeduction`/`eidAdvanceId`) fields are zeroed (an
    ordinary Draft field edit, bumping the entry's existing `version`), the linked `Advance`'s
    `currentScheduledPeriodId` is moved to the chosen future
    `ScheduledPayrollPeriod` (`database-schema.md` §10a — found or created for that target month via
    Payroll Processing's own owned find-or-create function, never a direct write from Advances, and
    never an existing `PayrollCycle` row, since only the current cycle is ever `Draft`), and an
    `AdvanceScheduleChange` row (`database-schema.md` §15a) records the mandatory reason plus who/when.
    A target must be strictly later than the current cycle — **not** limited to "next" or "one after
    next" (BR-ADV-003) — and, since released payroll is never modified (BR-ADV-002/Principle 9), this
    action is only ever available on an unreleased entry in the current `Draft` cycle to begin with;
    there is no mechanism to reach into a different cycle's entry to defer it. See "Outstanding Payroll
    Obligations," below, for how a deferred deduction is later picked back up once its target cycle is
    created.

- **Released** — the cycle as a whole has been finalized by an explicit Master User action
  ("Finalize Payroll Cycle"), not automatically and not as a side effect of any other action.
  **Reaffirmed 2026-07-05: this explicit action stays, even though `PayrollEntry.released` is now
  itself derived from per-Unit release events** — a cycle whose every Unit has released-or-been-held
  is merely *eligible* to finalize; it still shows as `Draft` until the Master User explicitly clicks
  Finalize, exactly as before this session.
  - **Finalization precondition, strictly enforced, with no override:** the cycle cannot transition
    from `Draft` to `Released` while any `PayrollEntry` in it has `released = false AND hold = false`
    — i.e., every employee who could be released has been. **This wording is unchanged by the move to
    per-Unit release** — only the mechanism that sets `released = true` changed (§12b's sweep, or a
    Late Entry's own one-off release, below), not the precondition itself. Employees left `hold = true`
    are explicitly exempted from this precondition and may remain outstanding indefinitely; they do not
    block finalization. A pending **Late Entry** (below) is *not* exempted — it behaves like any other
    unreleased-and-non-held entry and blocks finalization the same way, unless also held. **There is no
    Master User override of this precondition.** A cycle with unreleased, non-held stragglers simply
    cannot be finalized until they are released or held — this is deliberate: Corrections exist for
    genuine post-release discoveries, not as a shortcut around finishing the month's release work.
  - **Late Entry exception (added 2026-07-05):** if a new `PayrollEntry` is created for a Project Unit
    that has *already* released this cycle (e.g. a new hire added to an already-released Unit), the
    ordinary per-Unit sweep will never reach it — there's no future `PayrollUnitRelease` event left to
    trigger it. Such an entry needs its own dedicated, single-entry release action (mirroring "Release
    Unit X" but scoped to exactly one entry), requiring a mandatory reason (`PayrollEntry.lateReason`,
    `database-schema.md` §12) and generating its own one-off Bank Sheet/Cash Sheet document — the
    already-released Unit itself is never reopened or modified. Whether an unreleased entry currently
    qualifies for this path is derived, not stored: it's true exactly when every Project Unit the entry
    touches already has a `PayrollUnitRelease` row as of now. **This exception only applies while the
    Cycle itself is still `Draft`** — once the whole Cycle has been finalized (`Released`), no new
    `PayrollEntry` can be created against it at all; a new hire after full cycle finalization simply
    waits for the next cycle. The two behaviors reconcile this way, not as alternatives to choose
    between.
  - Once `Released`, payroll is finalized — ordinary field edits no longer apply to any entry in this
    cycle (every entry in it now has `released = true`, per the finalization precondition above, so the
    trigger condition applies to all of them).
  - Corrections are allowed, per Principle 9 — see `docs/architecture/post-release-corrections.md` for
    the full request/approval, immediate/deferred, and installment-recovery mechanics (all revised
    2026-07-05).
  - Balance Adjustments are generated from approved corrections (see
    `docs/architecture/post-release-corrections.md`) rather than the original figures being changed.
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
    reopening it. See `docs/architecture/post-release-corrections.md` for the full settlement
    workflow.
  - A backup package is automatically generated for the cycle being archived (§5).

Only one cycle is ever in `Draft` state at a time.

### Outstanding Payroll Obligations — the new-cycle carry-forward seam

**Added 2026-07-08, pre-Checkpoint-2 architecture amendment**, generalizing what this section
previously stated as a single, Balance-Adjustment-specific rule. Payroll Processing's new-cycle
bootstrap must never contain hardcoded knowledge of any other module's tables (the same discipline
`docs/architecture/overview.md`'s Extensibility section already applies to Biometric Attendance and
Leave Management — a future module integrates at a defined seam, never by editing Payroll Processing's
internals). Carry-forward is therefore expressed as an abstraction, not a name-checked list:

> An **Outstanding Payroll Obligation** is anything a module registers as needing a future
> `PayrollEntry` to settle, pay, or apply itself against. Each owning module supplies, for this seam:
> (1) a **carry-forward predicate** — does employee X have an obligation that requires an entry in the
> cycle now being created; and, optionally, (2) a **Payroll Materialization Hook** — given a newly
> created entry, materialize whatever that obligation type contributes to it (renamed 2026-07-08 from
> an earlier "population hook" working name — the responsibility is materializing a payroll obligation
> into a `PayrollEntry`, not merely populating data, and this name stays accurate as further obligation
> types are added).

Payroll Processing's bootstrap **orchestrates only**: it never inspects `BalanceAdjustment` or
`Advance` (or any future obligation module's tables) directly. It invokes every registered provider's
predicate to decide which departed employees to include, then — after every entry for the new cycle
exists — invokes every registered provider's Payroll Materialization Hook, where one exists. Each
module owns its own business rules for what "outstanding" means and what materializing an obligation
looks like; Payroll Processing owns only the orchestration described here.

**Provider independence (added 2026-07-08):** Payroll Processing must never rely on the order in which
providers are evaluated or invoked. Every registered predicate and every registered Payroll
Materialization Hook must be independent and safe to run in any order, or concurrently — a provider
must never assume another provider has already run, or will run before or after it, within the same
bootstrap. If a genuine ordering dependency between two obligation types is ever discovered, it must be
resolved by an explicit architecture decision (e.g. a documented, named ordering rule), never by
depending on whatever order registration happens to produce today. This is what keeps a future
obligation type a pure addition rather than a source of subtle coupling to whichever providers already
exist.

**Today's two registered providers:**

1. **Balance Adjustments** — predicate: at least one `PENDING BalanceAdjustment` for this employee.
   No Payroll Materialization Hook: settlement is a release-time concern (`docs/architecture/
   post-release-corrections.md`), unchanged by this amendment — the entry is created with all
   earning/attendance fields at zero and is visually flagged in the UI as a computed "Final
   Settlement" indicator (`docs/design-system.md`), so it never reads as an active employee's ordinary
   monthly pay, exactly as before.
2. **Advances** — predicate: an `ACTIVE Advance` whose `currentScheduledPeriodId`
   (`docs/architecture/database-schema.md` §15) resolves to the cycle now being created. Payroll
   Materialization Hook: populate that entry's `advanceDeduction`/`advanceId` (or eid- equivalent) from
   the advance's schedule, advance `currentScheduledPeriodId` to the following month as the new default
   target (or clear it to null if this installment brings the advance to `PAID_OFF`), and write the
   `advance.schedule_materialized` audit entry (`docs/architecture/database-schema.md` §15) — distinct
   from `advance.deferred`, marking the moment a previously-deferred (or ordinary) schedule actually
   lands in a real `PayrollEntry`, not merely that it moved.

A future obligation type (a Loans, Recoveries, or Bonus Deferral module, say) plugs into this same seam
by registering its own predicate and, if needed, its own Payroll Materialization Hook — never by
Payroll Processing being edited to know about it, and never by assuming its own execution order
relative to any other provider.

### New Cycle Creation & Employee Selection

Creating a new cycle requires the current cycle to already be `Released` (above) and, in one
transaction, in this order:

1. Transitions the current cycle to `Archived` and generates its backup package (§5).
2. Creates the new `PayrollCycle` row (`Draft`).
3. Resolves any `ScheduledPayrollPeriod` matching this new cycle's `(year, month)`
   (`docs/architecture/database-schema.md` §10a) — a single, generic step, with no knowledge of which
   module(s), if any, reference that period.
4. Selects which employees get a new `PayrollEntry`: the union of (a) every currently active employee
   (`dateOfLeaving IS NULL`), and (b) every employee — active or departed — selected by **any
   registered Outstanding Payroll Obligation provider's** carry-forward predicate (above). Payroll
   Processing never cares which module owns a given obligation; it only evaluates the union of
   whatever predicates are registered.
5. Bulk-creates the new cycle's `PayrollEntry` rows (each with its own single, freshly-seeded
   `PayrollEntryWorkLine`, per `database-schema.md` §12a's carry-forward rule).
6. Invokes every registered provider's Payroll Materialization Hook, where one exists, against the
   newly-created entries — each invocation independent of the others (no assumed ordering, above).

Carried-forward fields for continuing employees (gross pay, cycle days, OT/leave rate overrides, EOBI
amount/applicability, site/bank/designation as of the source cycle) follow the same copy-at-creation
rule as any new `PayrollEntry` — see `docs/architecture/database-schema.md` §12.

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
  `docs/architecture/post-release-corrections.md` ("Representation in Bank Sheets, Cash Sheets, and
  Payslips"). The backup must never diverge from what the in-app sheet showed.
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

**Storage:** written through the `StorageProvider` abstraction (§2) — local filesystem in
development, swappable to cloud object storage in production without touching the generation logic.

**Versioning:** a backup package's `Backup Version` increments if it is regenerated for a cycle that
has already been archived — which happens when a correction is later approved against that
historical cycle's data (see `docs/architecture/post-release-corrections.md`). Each version is
retained, not overwritten; the package itself follows the same "never overwrite history" rule as the
database.

**Purpose boundary:** backup packages are for disaster recovery and external handoff (e.g. giving the
client an offline copy, or restoring from a catastrophic failure) — they are not, and must never
become, a data source for any in-application feature.
