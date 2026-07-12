-- Phase 4 Checkpoint 6.1 (Payslips backend foundation, approved 2026-07-12): adds two nullable
-- identity-snapshot columns to PayrollEntry so a Payslip reads a historically frozen employee
-- name/father name instead of Employee's live record — closing the gap the 2026-07-11/07-12
-- banking refinement review explicitly left open ("Snapshot-name finding, unresolved, requires
-- your decision" — PROJECT_PROGRESS.md's Post-Phase-4 refinement entry). Nullable at the schema
-- level only because pre-existing rows need a backfill; every entry created going forward
-- (createPayrollEntry / createPayrollCycle bootstrap) always populates both.

-- AlterTable: PayrollEntry
ALTER TABLE "PayrollEntry" ADD COLUMN "employeeNameSnapshot" VARCHAR(160);
ALTER TABLE "PayrollEntry" ADD COLUMN "fatherNameSnapshot" VARCHAR(160);

-- Best-effort backfill for rows that already existed before this migration: copies each entry's
-- CURRENT linked Employee name/father name. This is not, and cannot be, historically exact for an
-- employee who was already renamed between an old entry's creation and this migration running —
-- no record of the name as it stood at that entry's own creation time exists anywhere before this
-- column existed, so there is nothing more accurate to backfill from. It is exact for every
-- employee who has never been renamed, which is the overwhelming majority of existing data. This
-- statement touches only the two new identity columns — no financial figure on any released
-- PayrollEntry is read, recomputed, or rewritten by this migration.
UPDATE "PayrollEntry" pe
SET "employeeNameSnapshot" = e."name",
    "fatherNameSnapshot" = e."fatherName"
FROM "Employee" e
WHERE pe."employeeId" = e."id";
