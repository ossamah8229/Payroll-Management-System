# Outstanding Payroll Obligations — the New-Cycle Carry-Forward Seam

**Owner module(s):** Payroll Processing (orchestration only — never contains obligation-specific
knowledge); Balance Adjustments and Advances (today's two registered providers)

**Contains:** The carry-forward-predicate / Payroll Materialization Hook extensibility seam that
Payroll Processing's new-cycle bootstrap uses to decide which departed employees still need a new
`PayrollEntry`

**Sections:** extracted from the former `data-and-storage.md §4` — no independent section number of
its own; cite this file by name · Full database index: `database/README.md`

This is a subsection of the cycle-lifecycle workflow, split into its own file because it is a
distinct *extensibility pattern* (a plugin seam), not a *state transition* — see
`docs/architecture/workflows/payroll-lifecycle.md` for the Draft/Released/Archived state machine this
seam plugs into, and `docs/architecture/overview.md`'s Extensibility section for how this pattern
relates to the system's other future-module seams (Biometric Attendance, Leave Management, ESS,
Gratuity).

---

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
   No Payroll Materialization Hook: settlement is a release-time concern
   (`docs/architecture/workflows/corrections-and-balance-adjustments.md`), unchanged by this
   amendment — the entry is created with all earning/attendance fields at zero and is visually flagged
   in the UI as a computed "Final Settlement" indicator (`docs/design-system.md`), so it never reads as
   an active employee's ordinary monthly pay, exactly as before.
2. **Advances** — predicate: an `ACTIVE Advance` whose `currentScheduledPeriodId`
   (`database/payroll-cycle.md §10a`) resolves to the cycle now being created. Payroll Materialization
   Hook: populate that entry's `advanceDeduction`/`advanceId` (or eid- equivalent) from the advance's
   schedule, advance `currentScheduledPeriodId` to the following month as the new default target (or
   clear it to null if this installment brings the advance to `PAID_OFF`), and write the
   `advance.schedule_materialized` audit entry (`database/advances.md §15`) — distinct from
   `advance.deferred`, marking the moment a previously-deferred (or ordinary) schedule actually lands
   in a real `PayrollEntry`, not merely that it moved.

A future obligation type (a Loans, Recoveries, or Bonus Deferral module, say) plugs into this same seam
by registering its own predicate and, if needed, its own Payroll Materialization Hook — never by
Payroll Processing being edited to know about it, and never by assuming its own execution order
relative to any other provider.
