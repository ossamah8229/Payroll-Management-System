-- Negative Payroll Recovery / Employee Identifier Uniqueness checkpoint (2026-07-26).
--
-- `accountNumber`/`iban` never had any uniqueness enforcement at any point in this schema's
-- history (only `cnic`/`employeeCode` do, via the partial unique indexes created in
-- 20260702084133_phase2_master_data). This migration closes that gap the same way: a partial
-- unique index (`WHERE ... IS NOT NULL`), Prisma-DSL-inexpressible, added by raw SQL.
--
-- Rather than uniquely indexing the raw `accountNumber`/`iban` columns directly (whose formatting
-- is free-text and not meaningfully canonical — e.g. "0110-79310689-03" vs "0110 79310689 03" vs
-- "011079310689 03" should all collide, an IBAN with/without spaces should too), this adds two
-- app-maintained shadow columns holding the canonical form (shared/src/lib/banking.ts's
-- normalizeAccountNumber/normalizeIban) and indexes those instead. This is a plain column, not a
-- Postgres GENERATED column, matching this schema's existing derived-column convention (e.g.
-- `correctionBalancePayable`) rather than introducing a new one; every employee create/update/
-- import write path (employees.service.ts) is responsible for keeping it in sync with the raw
-- value, same discipline as any other derived field in this domain.
--
-- SAFETY: this migration's own backfill computes each existing row's canonical value from
-- whatever is already stored, then attempts to create the unique index over it. If any existing
-- data already has a canonical-level duplicate (e.g. two employees whose account numbers differ
-- only by formatting), CREATE UNIQUE INDEX fails outright and this entire migration transaction
-- rolls back — it cannot half-apply. See backend/scripts/find-employee-identifier-duplicates.ts
-- for a read-only preflight check to run before applying this migration to any database whose
-- data hasn't already been verified duplicate-free.

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN "accountNumberCanonical" VARCHAR(40);
ALTER TABLE "Employee" ADD COLUMN "ibanCanonical" VARCHAR(34);

-- Backfill: pure function of each row's own existing accountNumber/iban.
UPDATE "Employee"
SET "accountNumberCanonical" = NULLIF(regexp_replace(upper("accountNumber"), '[^A-Z0-9]', '', 'g'), '')
WHERE "accountNumber" IS NOT NULL;

UPDATE "Employee"
SET "ibanCanonical" = NULLIF(regexp_replace(upper("iban"), '[[:space:]]', '', 'g'), '')
WHERE "iban" IS NOT NULL;

-- CreateIndex (partial unique — multiple NULLs/blank-derived-NULLs remain allowed, e.g. Cash
-- employees with no bank account on file).
CREATE UNIQUE INDEX "Employee_accountNumberCanonical_key"
  ON "Employee"("accountNumberCanonical") WHERE "accountNumberCanonical" IS NOT NULL;

CREATE UNIQUE INDEX "Employee_ibanCanonical_key"
  ON "Employee"("ibanCanonical") WHERE "ibanCanonical" IS NOT NULL;
