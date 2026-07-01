# Project Principles — Payroll Management System

These are the non-negotiable rules the system is built on. They take precedence over convenience,
performance, and developer preference. Any implementation decision that conflicts with one of these
must be flagged and resolved before merging, not worked around silently.

---

### 1. Payroll Entry is the single source of truth

Release Salary, Bank Sheets, Cash Receiving Sheets, Payslips, and Statements of Account are all
*derived, read-only views* computed from Payroll Entry data. None of them may hold independently
editable copies of a figure. If a number needs to change, it changes in Payroll Entry (or, once
released, through the Correction workflow) — never in a downstream view.

**Why:** this was the client's most-repeated requirement during scoping. A payroll system where two
screens can disagree about an employee's net salary is a system nobody can trust.

### 2. Historical payroll must never be overwritten

Once a payroll cycle exists, its data is permanent. A new cycle is a new set of records, not an edit
of the old one. Locking a cycle (see `docs/architecture/data-and-storage.md`) makes this
structural, not just a convention — the application must refuse to overwrite locked data, full stop.

**Why:** ~1,500 employees, high turnover, monthly deadlines — the client needs to be able to answer
"what did we pay this person in March 2024" with certainty, indefinitely.

### 3. Every financial change must be auditable

Every mutation that affects money — release, hold, correction, advance recorded, cycle locked,
balance settled — writes an Audit Log entry, in the same transaction as the change itself. There is
no "minor" financial change that skips logging.

**Why:** this is what makes the Correction workflow and post-release balance rule trustworthy. An
audit trail that can have gaps isn't an audit trail.

### 4. Never sacrifice correctness for performance

At ~1,500 employees this system will never be under real load pressure. When a choice arises between
a faster-but-riskier path and a slower-but-provably-correct one, take the correct one. Optimize only
after correctness is established and only where a real bottleneck is measured (e.g. the
1,500-row Payroll Entry grid render, which is a legitimate, spec-called-out exception).

**Why:** the client's own words were "cannot have any crashes or lapses" — for a payroll system,
"fast but occasionally wrong" is a worse failure mode than "correct but a little slower."

### 5. All financial calculations must be deterministic and reproducible

Given the same inputs (gross pay, days, OT, leave, EOBI, advances, fines, cycle days), `calcNet`
(or its production equivalent) must always produce the same output — no hidden state, no
non-deterministic rounding, no timezone-dependent date math affecting a monetary result.

**Why:** reproducibility is what lets a correction, an audit, or a client dispute be resolved by
recomputing rather than trusting whatever the UI happened to show at the time.

### 6. Every exported value must exactly match the underlying payroll data

PDF payslips, bank sheet PDFs/Excel, cash receiving sheets, and CSV/Excel exports must never
recompute or reformat a figure differently than the value stored and shown in-app. Formatting
(e.g. `en-US` grouping) may differ visually; the underlying number may not.

**Why:** a bank sheet total that doesn't match Payroll Entry is a discrepancy the client discovers
only after money has moved — the most expensive place to find a bug.

### 7. Role-based access control must never be bypassed

Every route that reads or writes payroll, employee, or financial data enforces role and site-scoping
server-side, on every request — never inferred from the client, never skipped for convenience in an
internal tool, admin script, or one-off fix.

**Why:** Payroll Staff are explicitly restricted to their assigned sites and cannot release, hold, or
approve corrections. That boundary is a business control, not a UI nicety, and must hold even if the
UI is bypassed entirely (direct API calls, scripts, etc.).

### 8. Prefer additive schema evolution over destructive schema changes

New requirements are met by adding tables/columns, not by repurposing or dropping existing ones.
Destructive migrations (dropping/renaming a column that's in use, changing a column's meaning) are a
last resort and require explicit sign-off, since they risk breaking historical data integrity
(Principle 2).

**Why:** this is what lets future modules (biometric attendance, gratuity, ESS, new reports) get
added without touching the load-bearing payroll logic that already works.

### 9. Released payroll is immutable

Once payroll has been released, the released payroll itself is never edited or overwritten. Any
subsequent change is represented as a Correction and, where money is owed either way, a Balance
Adjustment — while the original released payroll record is preserved permanently, exactly as it was
at the moment of release.

**Why:** release means funds have already moved. "Editing" a released salary after the fact would
mean the system's record of what was paid no longer matches what was actually paid — the single
most damaging kind of inconsistency a payroll system can have. This principle is what the
`Released` and `Archived` payroll cycle states (`docs/architecture/data-and-storage.md`) and the
balance-based correction model (`docs/architecture/post-release-corrections.md`) exist to enforce.

---

Related documents: `docs/architecture/data-and-storage.md` (how Principles 2, 3, 6, 8, 9 are
structurally enforced), `docs/architecture/post-release-corrections.md` (how Principles 1, 2, 3, 6, 9
apply specifically to corrections made after a salary has been released).
