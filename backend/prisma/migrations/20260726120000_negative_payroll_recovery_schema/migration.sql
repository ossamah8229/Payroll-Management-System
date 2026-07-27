-- Negative Payroll Recovery checkpoint (2026-07-26) — schema foundation.
--
-- `PayrollEntry.released` keeps meaning exactly what it means today ("money was paid") — it is
-- never redefined. `payoutOutcome` is the new resolution for a still-Draft entry whose own
-- current-cycle netSalary is <= 0 when its Units release: NO_PAY_DUE (netSalary = 0) or
-- RECOVERY_DUE (netSalary < 0). The CHECK constraint below makes `released`/`payoutOutcome`
-- mutually exclusive at the database level, not just by application convention.
--
-- `BalanceAdjustment.correctionId` is relaxed to nullable so a RECOVERY-type row can originate
-- directly from a negative-net Draft entry (`originPayrollEntryId`) instead of only from a
-- post-release `Correction` — reusing the existing materialization/settlement machinery
-- unchanged. Exactly one of the two origins is required, enforced by the second CHECK below.

-- CreateEnum
CREATE TYPE "PayrollEntryPayoutOutcome" AS ENUM ('NO_PAY_DUE', 'RECOVERY_DUE');

-- AlterTable: PayrollEntry
ALTER TABLE "PayrollEntry" ADD COLUMN "payoutOutcome" "PayrollEntryPayoutOutcome";

ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_payoutOutcome_released_check"
  CHECK ("payoutOutcome" IS NULL OR "released" = false);

CREATE INDEX "PayrollEntry_cycleId_hold_released_payoutOutcome_idx"
  ON "PayrollEntry"("cycleId", "hold", "released", "payoutOutcome");

-- AlterTable: BalanceAdjustment
ALTER TABLE "BalanceAdjustment" ALTER COLUMN "correctionId" DROP NOT NULL;
ALTER TABLE "BalanceAdjustment" ADD COLUMN "originPayrollEntryId" UUID;

ALTER TABLE "BalanceAdjustment" ADD CONSTRAINT "BalanceAdjustment_origin_xor_check"
  CHECK (
    ("correctionId" IS NOT NULL AND "originPayrollEntryId" IS NULL) OR
    ("correctionId" IS NULL AND "originPayrollEntryId" IS NOT NULL)
  );

CREATE UNIQUE INDEX "BalanceAdjustment_originPayrollEntryId_key"
  ON "BalanceAdjustment"("originPayrollEntryId");

ALTER TABLE "BalanceAdjustment" ADD CONSTRAINT "BalanceAdjustment_originPayrollEntryId_fkey"
  FOREIGN KEY ("originPayrollEntryId") REFERENCES "PayrollEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
