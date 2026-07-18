-- CreateEnum
CREATE TYPE "CorrectionField" AS ENUM ('GROSS_PAY', 'DAYS', 'OT_HOURS', 'OT_RATE', 'ALLOWANCE', 'LEAVE_DAYS', 'LEAVE_RATE', 'CYCLE_DAYS', 'EOBI_AMOUNT', 'EOBI_APPLICABLE', 'ADVANCE_DEDUCTION', 'EID_ADVANCE_DEDUCTION', 'FINE');

-- CreateEnum
CREATE TYPE "CorrectionRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BalanceAdjustmentType" AS ENUM ('PAYABLE', 'RECOVERY', 'NONE');

-- CreateEnum
CREATE TYPE "BalanceAdjustmentStatus" AS ENUM ('PENDING', 'SETTLED');

-- CreateEnum
CREATE TYPE "BalanceAdjustmentPaymentTiming" AS ENUM ('IMMEDIATE', 'DEFERRED');

-- Note: this migration was generated via `prisma migrate diff` against the live database directly
-- (no shadow database available in this environment — matching the same constraint and the same
-- workaround already documented in the Advances migration, 20260711160000_advances/migration.sql).
-- That diff also proposed `DROP TABLE "session"` — the express-session/connect-pg-simple session
-- store table, created at runtime and never part of this Prisma schema — which has been
-- deliberately removed from this file, same as every prior migration generated this same way. It
-- must never be dropped by a Prisma migration.

-- CreateTable
CREATE TABLE "CorrectionRequest" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payrollEntryId" UUID NOT NULL,
    "field" "CorrectionField" NOT NULL,
    "proposedNewValue" VARCHAR(80) NOT NULL,
    "adjustmentTypeId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedById" UUID NOT NULL,
    "requestedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "CorrectionRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMPTZ(6),
    "rejectionReason" TEXT,
    "resultingCorrectionId" UUID,

    CONSTRAINT "CorrectionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Correction" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payrollEntryId" UUID NOT NULL,
    "field" "CorrectionField" NOT NULL,
    "oldValue" VARCHAR(80) NOT NULL,
    "newValue" VARCHAR(80) NOT NULL,
    "oldNetSalary" DECIMAL(12,2) NOT NULL,
    "newNetSalary" DECIMAL(12,2) NOT NULL,
    "adjustmentTypeId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "approvedById" UUID NOT NULL,
    "approvedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversesCorrectionId" UUID,

    CONSTRAINT "Correction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BalanceAdjustment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "correctionId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "sourceCycleId" UUID NOT NULL,
    "adjustmentTypeId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "type" "BalanceAdjustmentType" NOT NULL,
    "status" "BalanceAdjustmentStatus" NOT NULL DEFAULT 'PENDING',
    "paymentTiming" "BalanceAdjustmentPaymentTiming",
    "recoveryInstallmentAmount" DECIMAL(12,2),
    "remainingAmount" DECIMAL(12,2) NOT NULL,
    "remark" TEXT NOT NULL,
    "settledInCycleId" UUID,
    "settledAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BalanceAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrectionPayment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "balanceAdjustmentId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "bankId" UUID,
    "branchCode" VARCHAR(20),
    "accountNumber" VARCHAR(40),
    "iban" VARCHAR(34),
    "paidAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidById" UUID NOT NULL,

    CONSTRAINT "CorrectionPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BalanceAdjustmentSettlement" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "balanceAdjustmentId" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "amountApplied" DECIMAL(12,2) NOT NULL,
    "appliedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BalanceAdjustmentSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CorrectionRequest_resultingCorrectionId_key" ON "CorrectionRequest"("resultingCorrectionId");

-- CreateIndex
CREATE INDEX "CorrectionRequest_payrollEntryId_idx" ON "CorrectionRequest"("payrollEntryId");

-- CreateIndex
CREATE INDEX "CorrectionRequest_status_idx" ON "CorrectionRequest"("status");

-- CreateIndex
CREATE INDEX "CorrectionRequest_requestedById_idx" ON "CorrectionRequest"("requestedById");

-- CreateIndex
CREATE INDEX "CorrectionRequest_reviewedById_idx" ON "CorrectionRequest"("reviewedById");

-- CreateIndex
CREATE INDEX "Correction_payrollEntryId_idx" ON "Correction"("payrollEntryId");

-- CreateIndex
CREATE INDEX "Correction_payrollEntryId_field_approvedAt_idx" ON "Correction"("payrollEntryId", "field", "approvedAt" DESC);

-- CreateIndex
CREATE INDEX "Correction_adjustmentTypeId_idx" ON "Correction"("adjustmentTypeId");

-- CreateIndex
CREATE INDEX "Correction_approvedAt_idx" ON "Correction"("approvedAt");

-- CreateIndex
CREATE INDEX "Correction_approvedById_idx" ON "Correction"("approvedById");

-- CreateIndex
CREATE INDEX "Correction_reversesCorrectionId_idx" ON "Correction"("reversesCorrectionId");

-- CreateIndex
CREATE UNIQUE INDEX "BalanceAdjustment_correctionId_key" ON "BalanceAdjustment"("correctionId");

-- CreateIndex
CREATE INDEX "BalanceAdjustment_employeeId_status_idx" ON "BalanceAdjustment"("employeeId", "status");

-- CreateIndex
CREATE INDEX "BalanceAdjustment_status_idx" ON "BalanceAdjustment"("status");

-- CreateIndex
CREATE INDEX "BalanceAdjustment_adjustmentTypeId_status_idx" ON "BalanceAdjustment"("adjustmentTypeId", "status");

-- CreateIndex
CREATE INDEX "BalanceAdjustment_sourceCycleId_idx" ON "BalanceAdjustment"("sourceCycleId");

-- CreateIndex
CREATE INDEX "BalanceAdjustment_settledInCycleId_idx" ON "BalanceAdjustment"("settledInCycleId");

-- CreateIndex
CREATE UNIQUE INDEX "CorrectionPayment_balanceAdjustmentId_key" ON "CorrectionPayment"("balanceAdjustmentId");

-- CreateIndex
CREATE INDEX "CorrectionPayment_employeeId_idx" ON "CorrectionPayment"("employeeId");

-- CreateIndex
CREATE INDEX "BalanceAdjustmentSettlement_balanceAdjustmentId_idx" ON "BalanceAdjustmentSettlement"("balanceAdjustmentId");

-- CreateIndex
CREATE INDEX "BalanceAdjustmentSettlement_cycleId_idx" ON "BalanceAdjustmentSettlement"("cycleId");

-- CreateIndex
CREATE UNIQUE INDEX "BalanceAdjustmentSettlement_balanceAdjustmentId_cycleId_key" ON "BalanceAdjustmentSettlement"("balanceAdjustmentId", "cycleId");

-- AddForeignKey
ALTER TABLE "CorrectionRequest" ADD CONSTRAINT "CorrectionRequest_payrollEntryId_fkey" FOREIGN KEY ("payrollEntryId") REFERENCES "PayrollEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectionRequest" ADD CONSTRAINT "CorrectionRequest_adjustmentTypeId_fkey" FOREIGN KEY ("adjustmentTypeId") REFERENCES "AdjustmentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectionRequest" ADD CONSTRAINT "CorrectionRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectionRequest" ADD CONSTRAINT "CorrectionRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectionRequest" ADD CONSTRAINT "CorrectionRequest_resultingCorrectionId_fkey" FOREIGN KEY ("resultingCorrectionId") REFERENCES "Correction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Correction" ADD CONSTRAINT "Correction_payrollEntryId_fkey" FOREIGN KEY ("payrollEntryId") REFERENCES "PayrollEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Correction" ADD CONSTRAINT "Correction_adjustmentTypeId_fkey" FOREIGN KEY ("adjustmentTypeId") REFERENCES "AdjustmentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Correction" ADD CONSTRAINT "Correction_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Correction" ADD CONSTRAINT "Correction_reversesCorrectionId_fkey" FOREIGN KEY ("reversesCorrectionId") REFERENCES "Correction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceAdjustment" ADD CONSTRAINT "BalanceAdjustment_correctionId_fkey" FOREIGN KEY ("correctionId") REFERENCES "Correction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceAdjustment" ADD CONSTRAINT "BalanceAdjustment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceAdjustment" ADD CONSTRAINT "BalanceAdjustment_sourceCycleId_fkey" FOREIGN KEY ("sourceCycleId") REFERENCES "PayrollCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceAdjustment" ADD CONSTRAINT "BalanceAdjustment_adjustmentTypeId_fkey" FOREIGN KEY ("adjustmentTypeId") REFERENCES "AdjustmentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceAdjustment" ADD CONSTRAINT "BalanceAdjustment_settledInCycleId_fkey" FOREIGN KEY ("settledInCycleId") REFERENCES "PayrollCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectionPayment" ADD CONSTRAINT "CorrectionPayment_balanceAdjustmentId_fkey" FOREIGN KEY ("balanceAdjustmentId") REFERENCES "BalanceAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectionPayment" ADD CONSTRAINT "CorrectionPayment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectionPayment" ADD CONSTRAINT "CorrectionPayment_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "Bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectionPayment" ADD CONSTRAINT "CorrectionPayment_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceAdjustmentSettlement" ADD CONSTRAINT "BalanceAdjustmentSettlement_balanceAdjustmentId_fkey" FOREIGN KEY ("balanceAdjustmentId") REFERENCES "BalanceAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceAdjustmentSettlement" ADD CONSTRAINT "BalanceAdjustmentSettlement_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "PayrollCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-added: Prisma-DSL-inexpressible constraints (docs/architecture/database/corrections.md §13/
-- §13a, docs/architecture/database/balance-adjustments.md §14/§14a/§14b), matching this project's
-- established convention for Employee's CNIC/employeeCode partial unique indexes and Advance's own
-- numeric/status check constraints (20260711160000_advances/migration.sql).

-- A correction's reason (and a rejected request's rejection reason) must be an actual explanation,
-- not whitespace.
ALTER TABLE "Correction" ADD CONSTRAINT "Correction_reason_check" CHECK (length(trim("reason")) > 0);
ALTER TABLE "CorrectionRequest" ADD CONSTRAINT "CorrectionRequest_reason_check" CHECK (length(trim("reason")) > 0);

-- A correction can never reverse itself.
ALTER TABLE "Correction" ADD CONSTRAINT "Correction_reversesCorrectionId_not_self_check" CHECK ("reversesCorrectionId" IS NULL OR "reversesCorrectionId" != "id");

-- CorrectionRequest's own single-permitted-transition invariant (database/corrections.md §13a) —
-- PENDING has none of the decision fields set; REJECTED requires a reviewer, a timestamp, and a
-- mandatory rejection reason but never a resulting Correction; APPROVED requires a reviewer, a
-- timestamp, and a resulting Correction but never a rejection reason.
ALTER TABLE "CorrectionRequest" ADD CONSTRAINT "CorrectionRequest_pending_state_check" CHECK (
  "status" != 'PENDING' OR ("reviewedById" IS NULL AND "reviewedAt" IS NULL AND "resultingCorrectionId" IS NULL AND "rejectionReason" IS NULL)
);
ALTER TABLE "CorrectionRequest" ADD CONSTRAINT "CorrectionRequest_rejected_state_check" CHECK (
  "status" != 'REJECTED' OR ("reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "rejectionReason" IS NOT NULL AND "resultingCorrectionId" IS NULL)
);
ALTER TABLE "CorrectionRequest" ADD CONSTRAINT "CorrectionRequest_approved_state_check" CHECK (
  "status" != 'APPROVED' OR ("reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "resultingCorrectionId" IS NOT NULL AND "rejectionReason" IS NULL)
);

-- BalanceAdjustment's own type/amount/status invariants (database/balance-adjustments.md §14) — a
-- NONE-type row is always zero-amount and already settled; every other type is always a positive
-- amount. remainingAmount is always within [0, amount], and reaching SETTLED always means it
-- reached exactly zero. paymentTiming/recoveryInstallmentAmount are only ever set for the one type
-- each is meaningful for. Note: the fuller "SETTLED with no settledInCycleId requires a linked
-- CorrectionPayment" invariant cannot be expressed as a CHECK constraint (Postgres CHECK constraints
-- cannot reference another table) — that half is an application-layer invariant only, enforced by
-- whichever future checkpoint implements settlement (Checkpoint 3), not this one.
ALTER TABLE "BalanceAdjustment" ADD CONSTRAINT "BalanceAdjustment_type_amount_status_check" CHECK (
  ("type" = 'NONE' AND "amount" = 0 AND "status" = 'SETTLED') OR ("type" != 'NONE' AND "amount" > 0)
);
ALTER TABLE "BalanceAdjustment" ADD CONSTRAINT "BalanceAdjustment_pending_state_check" CHECK (
  "status" != 'PENDING' OR ("settledInCycleId" IS NULL AND "settledAt" IS NULL AND "type" != 'NONE')
);
ALTER TABLE "BalanceAdjustment" ADD CONSTRAINT "BalanceAdjustment_remainingAmount_check" CHECK ("remainingAmount" >= 0 AND "remainingAmount" <= "amount");
ALTER TABLE "BalanceAdjustment" ADD CONSTRAINT "BalanceAdjustment_settled_remaining_zero_check" CHECK ("status" != 'SETTLED' OR "remainingAmount" = 0);
ALTER TABLE "BalanceAdjustment" ADD CONSTRAINT "BalanceAdjustment_paymentTiming_type_check" CHECK ("paymentTiming" IS NULL OR "type" = 'PAYABLE');
ALTER TABLE "BalanceAdjustment" ADD CONSTRAINT "BalanceAdjustment_recoveryInstallmentAmount_type_check" CHECK ("recoveryInstallmentAmount" IS NULL OR "type" = 'RECOVERY');
ALTER TABLE "BalanceAdjustment" ADD CONSTRAINT "BalanceAdjustment_recoveryInstallmentAmount_positive_check" CHECK ("recoveryInstallmentAmount" IS NULL OR "recoveryInstallmentAmount" > 0);

-- CorrectionPayment/BalanceAdjustmentSettlement amounts are always positive (database/
-- balance-adjustments.md §14a/§14b).
ALTER TABLE "CorrectionPayment" ADD CONSTRAINT "CorrectionPayment_amount_check" CHECK ("amount" > 0);
ALTER TABLE "BalanceAdjustmentSettlement" ADD CONSTRAINT "BalanceAdjustmentSettlement_amountApplied_check" CHECK ("amountApplied" > 0);

