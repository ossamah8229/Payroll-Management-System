# Outstanding Payroll Obligations — the New-Cycle Carry-Forward Seam

**Owner module(s):** Payroll Processing (orchestration only — never contains obligation-specific
knowledge); Advances (today's only implemented obligation source)

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

**Corrected 2026-07-15 (Phase 5 Checkpoint 3 architecture review) — reconciles this file's own
2026-07-08 generalization with what was actually approved and built.** The 2026-07-08 amendment
below generalized this section into a registered-provider/hook-registry framework ahead of Advances
actually being built. As Advances was built (Phase 4 Checkpoint 5) and as Phase 5 Checkpoint 3 closed
the departed-employee gap, the approved, shipped convention turned out to be simpler and was
explicitly re-confirmed, not the registry: **there is no generic Outstanding-Payroll-Obligation
provider/hook registry anywhere in this codebase.** `payroll-processing.service.ts`'s rollover
bootstrap (`archiveAndCreateNextPayrollCycle`) calls Advances' own
`materializeScheduledAdvanceDeductions` **directly** — one explicit call, not a dispatch through a
registered-provider list. **`BalanceAdjustment` does not exist yet** — it is Phase 6, not "today's"
anything; the paragraph below that lists it as an already-registered provider pre-dates Phase 4 and
was never accurate for a shipped system. Phase 6, when it lands, adds its own direct call here,
mirroring Advances' — **a real registry is revisited only if a second, concurrently-existing provider
actually demonstrates the abstraction is justified, never built ahead of that need** (the same
anti-premature-abstraction discipline `docs/architecture/overview.md`'s Extensibility section already
states for Biometric Attendance and Leave Management). The rest of this file, below, is kept for
historical/design-rationale context — what "outstanding" means, why it's Payroll Processing's
business only to orchestrate — but its "registered provider" framing should be read as the *shape a
future registry would take if one is ever justified*, not as the current implementation.

**What Payroll Processing's rollover bootstrap actually does (Phase 5 Checkpoint 3,
`archiveAndCreateNextPayrollCycle`):** selects the union of (a) every currently active employee
(`dateOfLeaving IS NULL`), and (b) every departed employee with an `ACTIVE` Advance due the new
period — a direct query against `Employee`/`Advance`, not a predicate invoked through a registry.
Departed-obligation entries carry no ordinary pay (zeroed `grossPay`/`eobiAmount`, `hold = true` —
see `database/payroll-entry.md §12`'s own note on this entry shape). After every entry exists,
rollover calls `materializeScheduledAdvanceDeductions` once, directly, which populates
`advanceDeduction`/`advanceId` (or the eid- equivalent), advances `currentScheduledPeriodId` to the
following month (or clears it on `PAID_OFF`), and writes the `advance.schedule_materialized` audit
entry (`database/advances.md §15`) — exactly the behavior the "Payroll Materialization Hook" concept
below describes, just reached by a direct function call instead of a hook registry lookup.

---

**Added 2026-07-08, pre-Checkpoint-2 architecture amendment — superseded by the 2026-07-15 correction
above; kept for design-rationale context only.** Payroll Processing's new-cycle bootstrap must never
contain hardcoded knowledge of any other module's tables (the same discipline
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

**Provider independence (added 2026-07-08, still the right principle for if/when a registry is ever
built):** a future obligation type's predicate and materialization logic must be independent and safe
to run in any order, or concurrently — never assuming another provider has already run, or will run
before or after it. If a genuine ordering dependency between two obligation types is ever discovered,
it must be resolved by an explicit architecture decision, never by depending on whatever order happens
to fall out of implementation today.

**What this section used to list as "today's two registered providers" (Balance Adjustments and
Advances) was never accurate as written** — `BalanceAdjustment` is Phase 6, not yet built, and no
registry exists for either. Advances is the one real, implemented obligation source; see "What
Payroll Processing's rollover bootstrap actually does," above, for its exact predicate and
materialization behavior.

A future obligation type (a Loans, Recoveries, or Bonus Deferral module, say) is added by giving
Payroll Processing's bootstrap its own additional direct call, mirroring Advances' — **not** by
building a registry ahead of that second real need. Should Phase 6 (Balance Adjustments) or a later
module become a genuine second consumer of this same seam, *that* is the point to evaluate whether a
real registry is justified, not before.

---

**Resolved 2026-07-18 (Phase 6 Checkpoint 5) — Balance Adjustments is now the second real consumer,
and a registry was still not built, per the rule stated just above.** Checkpoint 5 adds
`materializeCorrectionObligationsForNewCycle` (`corrections.materialization.service.ts`), called by
`archiveAndCreateNextPayrollCycle` immediately after `materializeScheduledAdvanceDeductions` —
another direct, explicit call, not a dispatch through a registered-provider list. It runs inside the
same already-open rollover transaction the new cycle's entries were just created in, taking the exact
`employeeIdToEntryId` map Advances' own call already builds, so the two providers do not duplicate
that lookup. **Materialization is a distinct concept from settlement**, so this call is *narrower*
than the "Payroll Materialization Hook" description above might suggest: it never marks a
`BalanceAdjustment` settled, never touches `remainingAmount`/`status`, and never creates a
`CorrectionPayment`/`BalanceAdjustmentSettlement` — it only ever writes an `ACTIVE`
`BalanceAdjustmentMaterialization` reservation row and recomputes the new entry's own
`correctionBalancePayable`/`correctionBalanceRecovery` aggregate columns, feeding `calcNet`
(`docs/architecture/workflows/corrections-and-balance-adjustments.md`'s own Checkpoint 5 scope note
has the full mechanism). Provider independence held exactly as this file's own principle requires:
Advances' own materialization and Balance Adjustments' own materialization run one after the other
in a fixed, arbitrary order inside the same transaction, neither reads the other's output, and
neither assumes anything about whether the other ran. No registry was introduced — two real,
concurrently-existing direct-call consumers now exist, but per this file's own standing rule, a
registry is justified only once maintaining N direct calls is demonstrably worse than the
abstraction, which two calls does not yet demonstrate.
