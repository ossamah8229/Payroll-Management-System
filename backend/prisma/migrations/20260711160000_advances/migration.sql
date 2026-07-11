-- CreateEnum
CREATE TYPE "AdvanceType" AS ENUM ('LOAN', 'EID_ADVANCE');

-- CreateEnum
CREATE TYPE "AdvanceRepaymentType" AS ENUM ('FULL_DEDUCTION', 'INSTALLMENT');

-- CreateEnum
CREATE TYPE "AdvanceStatus" AS ENUM ('ACTIVE', 'PAID_OFF');

-- AlterTable
ALTER TABLE "PayrollEntry" ADD COLUMN     "advanceId" UUID,
ADD COLUMN     "eidAdvanceId" UUID;

-- Note: this migration was generated via `prisma migrate diff` against the live database directly
-- (no shadow database available in this environment). That diff also proposed `DROP TABLE
-- "session"` — the express-session/connect-pg-simple session store table, created at runtime and
-- never part of this Prisma schema — which has been deliberately removed from this file. It must
-- never be dropped by a Prisma migration.

-- CreateTable
CREATE TABLE "ScheduledPayrollPeriod" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "year" SMALLINT NOT NULL,
    "month" SMALLINT NOT NULL,
    "payrollCycleId" UUID,
    "resolvedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledPayrollPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Advance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "type" "AdvanceType" NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "outstandingBalance" DECIMAL(12,2) NOT NULL,
    "dateGiven" DATE NOT NULL,
    "repaymentType" "AdvanceRepaymentType" NOT NULL,
    "scheduledInstallmentAmount" DECIMAL(12,2),
    "notes" TEXT,
    "status" "AdvanceStatus" NOT NULL DEFAULT 'ACTIVE',
    "originalScheduledPeriodId" UUID,
    "currentScheduledPeriodId" UUID,
    "paidOffAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Advance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvanceScheduleChange" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "advanceId" UUID NOT NULL,
    "payrollEntryId" UUID NOT NULL,
    "fromPeriodId" UUID NOT NULL,
    "toPeriodId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "changedById" UUID NOT NULL,
    "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdvanceScheduleChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduledPayrollPeriod_payrollCycleId_idx" ON "ScheduledPayrollPeriod"("payrollCycleId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledPayrollPeriod_year_month_key" ON "ScheduledPayrollPeriod"("year", "month");

-- CreateIndex
CREATE INDEX "Advance_employeeId_idx" ON "Advance"("employeeId");

-- CreateIndex
CREATE INDEX "Advance_currentScheduledPeriodId_idx" ON "Advance"("currentScheduledPeriodId");

-- CreateIndex
CREATE INDEX "AdvanceScheduleChange_advanceId_changedAt_idx" ON "AdvanceScheduleChange"("advanceId", "changedAt" DESC);

-- CreateIndex
CREATE INDEX "AdvanceScheduleChange_payrollEntryId_idx" ON "AdvanceScheduleChange"("payrollEntryId");

-- CreateIndex
CREATE INDEX "PayrollEntry_advanceId_idx" ON "PayrollEntry"("advanceId");

-- CreateIndex
CREATE INDEX "PayrollEntry_eidAdvanceId_idx" ON "PayrollEntry"("eidAdvanceId");

-- AddForeignKey
ALTER TABLE "ScheduledPayrollPeriod" ADD CONSTRAINT "ScheduledPayrollPeriod_payrollCycleId_fkey" FOREIGN KEY ("payrollCycleId") REFERENCES "PayrollCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "Advance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_eidAdvanceId_fkey" FOREIGN KEY ("eidAdvanceId") REFERENCES "Advance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Advance" ADD CONSTRAINT "Advance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Advance" ADD CONSTRAINT "Advance_originalScheduledPeriodId_fkey" FOREIGN KEY ("originalScheduledPeriodId") REFERENCES "ScheduledPayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Advance" ADD CONSTRAINT "Advance_currentScheduledPeriodId_fkey" FOREIGN KEY ("currentScheduledPeriodId") REFERENCES "ScheduledPayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvanceScheduleChange" ADD CONSTRAINT "AdvanceScheduleChange_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "Advance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvanceScheduleChange" ADD CONSTRAINT "AdvanceScheduleChange_payrollEntryId_fkey" FOREIGN KEY ("payrollEntryId") REFERENCES "PayrollEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvanceScheduleChange" ADD CONSTRAINT "AdvanceScheduleChange_fromPeriodId_fkey" FOREIGN KEY ("fromPeriodId") REFERENCES "ScheduledPayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvanceScheduleChange" ADD CONSTRAINT "AdvanceScheduleChange_toPeriodId_fkey" FOREIGN KEY ("toPeriodId") REFERENCES "ScheduledPayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvanceScheduleChange" ADD CONSTRAINT "AdvanceScheduleChange_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-added: Prisma-DSL-inexpressible constraints (docs/architecture/database/advances.md §15/§15a),
-- matching this project's established convention for Employee's CNIC/employeeCode partial unique
-- indexes and PayrollEntry's numeric check constraints.

-- At most one ACTIVE Advance per employee per type (approved, frozen architecture decision) — the
-- database-level backstop behind the application-layer check in advances.service.ts.
CREATE UNIQUE INDEX "Advance_employeeId_type_active_key" ON "Advance"("employeeId", "type") WHERE "status" = 'ACTIVE';

-- CheckConstraint
ALTER TABLE "Advance" ADD CONSTRAINT "Advance_totalAmount_check" CHECK ("totalAmount" > 0);
ALTER TABLE "Advance" ADD CONSTRAINT "Advance_outstandingBalance_check" CHECK ("outstandingBalance" >= 0 AND "outstandingBalance" <= "totalAmount");
ALTER TABLE "Advance" ADD CONSTRAINT "Advance_scheduledInstallmentAmount_check" CHECK ("scheduledInstallmentAmount" IS NULL OR "scheduledInstallmentAmount" > 0);
ALTER TABLE "Advance" ADD CONSTRAINT "Advance_paidoff_no_current_period_check" CHECK ("status" != 'PAID_OFF' OR "currentScheduledPeriodId" IS NULL);

ALTER TABLE "AdvanceScheduleChange" ADD CONSTRAINT "AdvanceScheduleChange_reason_check" CHECK (length(trim("reason")) > 0);

ALTER TABLE "ScheduledPayrollPeriod" ADD CONSTRAINT "ScheduledPayrollPeriod_month_check" CHECK ("month" BETWEEN 1 AND 12);

-- The "still-pending periods" lookup the cycle-bootstrap resolution step uses every time a new
-- cycle is created (docs/architecture/database/payroll-cycle.md §10a).
CREATE INDEX "ScheduledPayrollPeriod_pending_idx" ON "ScheduledPayrollPeriod"("year", "month") WHERE "payrollCycleId" IS NULL;

