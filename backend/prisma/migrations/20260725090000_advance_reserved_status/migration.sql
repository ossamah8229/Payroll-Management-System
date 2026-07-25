-- Presentation & Workflow Stabilization Checkpoint (2026-07-25) — Advance lifecycle fix.
-- Adds the `RESERVED` status: an Advance whose outstandingBalance has reached zero from a
-- deduction materialized into a still-Draft (unreleased) PayrollEntry, but not yet confirmed by an
-- actual Payroll Release. Matches this schema's established "additive only" pattern for new enum
-- values (see 20260724130000_advance_cancelled_status) — no existing row's `status` value changes,
-- no column added, no existing constraint altered here. A separate, later migration
-- (20260725091000_advance_reserved_constraints) updates the constraints that reference this value,
-- since Postgres does not allow a newly added enum value to be used in the same transaction that
-- added it.
ALTER TYPE "AdvanceStatus" ADD VALUE 'RESERVED';
