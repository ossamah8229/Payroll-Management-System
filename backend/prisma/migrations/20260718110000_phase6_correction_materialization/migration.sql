-- CreateEnum
CREATE TYPE "MaterializationStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'CANCELLED');

-- AlterTable
ALTER TABLE "PayrollEntry" ADD COLUMN     "correctionBalancePayable" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "correctionBalanceRecovery" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Note: this migration was generated via `prisma migrate diff` against the live database directly
-- (no shadow database available in this environment). That diff also proposed `DROP TABLE
-- "session"` — the express-session/connect-pg-simple session store table, created at runtime and
-- never part of this Prisma schema — which has been deliberately removed from this file. It must
-- never be dropped by a Prisma migration.

-- CreateTable
CREATE TABLE "BalanceAdjustmentMaterialization" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "balanceAdjustmentId" UUID NOT NULL,
    "payrollEntryId" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "MaterializationStatus" NOT NULL DEFAULT 'ACTIVE',
    "settlementId" UUID,
    "consumedAt" TIMESTAMPTZ(6),
    "cancelledAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BalanceAdjustmentMaterialization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BalanceAdjustmentMaterialization_settlementId_key" ON "BalanceAdjustmentMaterialization"("settlementId");

-- CreateIndex
CREATE INDEX "BalanceAdjustmentMaterialization_balanceAdjustmentId_status_idx" ON "BalanceAdjustmentMaterialization"("balanceAdjustmentId", "status");

-- CreateIndex
CREATE INDEX "BalanceAdjustmentMaterialization_payrollEntryId_idx" ON "BalanceAdjustmentMaterialization"("payrollEntryId");

-- CreateIndex
CREATE INDEX "BalanceAdjustmentMaterialization_cycleId_idx" ON "BalanceAdjustmentMaterialization"("cycleId");

-- CreateIndex
CREATE UNIQUE INDEX "BalanceAdjustmentMaterialization_balanceAdjustmentId_cycleI_key" ON "BalanceAdjustmentMaterialization"("balanceAdjustmentId", "cycleId");

-- AddForeignKey
ALTER TABLE "BalanceAdjustmentMaterialization" ADD CONSTRAINT "BalanceAdjustmentMaterialization_balanceAdjustmentId_fkey" FOREIGN KEY ("balanceAdjustmentId") REFERENCES "BalanceAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceAdjustmentMaterialization" ADD CONSTRAINT "BalanceAdjustmentMaterialization_payrollEntryId_fkey" FOREIGN KEY ("payrollEntryId") REFERENCES "PayrollEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceAdjustmentMaterialization" ADD CONSTRAINT "BalanceAdjustmentMaterialization_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "PayrollCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceAdjustmentMaterialization" ADD CONSTRAINT "BalanceAdjustmentMaterialization_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "BalanceAdjustmentSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-added CHECK constraints (not expressible via Prisma's schema DSL) — same convention as
-- every prior migration's own append (e.g. 20260707120000_payroll_cycle_and_entry,
-- 20260718100000_phase6_corrections_domain).

-- PayrollEntry's two new aggregate columns follow every other monetary PayrollEntry column's own
-- >= 0 convention (grossPay, allowance, eobiAmount, advanceDeduction, eidAdvanceDeduction, fine).
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_correctionBalancePayable_check" CHECK ("correctionBalancePayable" >= 0);
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_correctionBalanceRecovery_check" CHECK ("correctionBalanceRecovery" >= 0);

ALTER TABLE "BalanceAdjustmentMaterialization" ADD CONSTRAINT "BalanceAdjustmentMaterialization_amount_check" CHECK ("amount" > 0);

-- Lifecycle-state integrity, exactly as specified: ACTIVE has no consumedAt/cancelledAt/settlementId;
-- CONSUMED requires consumedAt + settlementId and forbids cancelledAt; CANCELLED requires
-- cancelledAt and forbids consumedAt/settlementId. Checkpoint 5 itself only ever inserts ACTIVE
-- rows (the default) — CONSUMED/CANCELLED are reserved for a later checkpoint's own transition,
-- but the constraint exists now so that transition can never be written inconsistently.
ALTER TABLE "BalanceAdjustmentMaterialization" ADD CONSTRAINT "BalanceAdjustmentMaterialization_status_check" CHECK (
  ("status" = 'ACTIVE' AND "consumedAt" IS NULL AND "cancelledAt" IS NULL AND "settlementId" IS NULL)
  OR ("status" = 'CONSUMED' AND "consumedAt" IS NOT NULL AND "cancelledAt" IS NULL AND "settlementId" IS NOT NULL)
  OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "consumedAt" IS NULL AND "settlementId" IS NULL)
);

