-- CreateEnum
CREATE TYPE "PayrollCycleStatus" AS ENUM ('DRAFT', 'RELEASED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "PayrollCycle" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "year" SMALLINT NOT NULL,
    "month" SMALLINT NOT NULL,
    "status" "PayrollCycleStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceCycleId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID NOT NULL,
    "releasedAt" TIMESTAMPTZ(6),
    "releasedBy" UUID,
    "archivedAt" TIMESTAMPTZ(6),
    "archivedBy" UUID,

    CONSTRAINT "PayrollCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollEntry" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cycleId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "designation" VARCHAR(80) NOT NULL,
    "bankId" UUID,
    "branchCode" VARCHAR(20),
    "accountNumber" VARCHAR(40),
    "accountTitle" VARCHAR(160),
    "grossPay" DECIMAL(12,2) NOT NULL,
    "allowance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "leaveDays" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "leaveRate" DECIMAL(10,2),
    "eobiAmount" DECIMAL(10,2) NOT NULL DEFAULT 400.00,
    "eobiApplicable" BOOLEAN NOT NULL DEFAULT true,
    "advanceDeduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "eidAdvanceDeduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "fine" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "hold" BOOLEAN NOT NULL DEFAULT false,
    "released" BOOLEAN NOT NULL DEFAULT false,
    "releasedAt" TIMESTAMPTZ(6),
    "releasedBy" UUID,
    "lateReason" TEXT,
    "remarks" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PayrollEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollEntryWorkLine" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payrollEntryId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "days" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "otHours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "otRate" DECIMAL(10,2),
    "cycleDays" SMALLINT NOT NULL DEFAULT 30,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PayrollEntryWorkLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayrollCycle_year_month_key" ON "PayrollCycle"("year", "month");

-- CreateIndex
CREATE INDEX "PayrollEntry_cycleId_idx" ON "PayrollEntry"("cycleId");

-- CreateIndex
CREATE INDEX "PayrollEntry_employeeId_idx" ON "PayrollEntry"("employeeId");

-- CreateIndex
CREATE INDEX "PayrollEntry_cycleId_hold_released_idx" ON "PayrollEntry"("cycleId", "hold", "released");

-- CreateIndex
CREATE INDEX "PayrollEntry_cycleId_siteId_idx" ON "PayrollEntry"("cycleId", "siteId");

-- CreateIndex
CREATE INDEX "PayrollEntry_bankId_idx" ON "PayrollEntry"("bankId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollEntry_cycleId_employeeId_key" ON "PayrollEntry"("cycleId", "employeeId");

-- CreateIndex
CREATE INDEX "PayrollEntryWorkLine_payrollEntryId_idx" ON "PayrollEntryWorkLine"("payrollEntryId");

-- CreateIndex
CREATE INDEX "PayrollEntryWorkLine_unitId_idx" ON "PayrollEntryWorkLine"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollEntryWorkLine_payrollEntryId_unitId_key" ON "PayrollEntryWorkLine"("payrollEntryId", "unitId");

-- AddForeignKey
ALTER TABLE "PayrollCycle" ADD CONSTRAINT "PayrollCycle_sourceCycleId_fkey" FOREIGN KEY ("sourceCycleId") REFERENCES "PayrollCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollCycle" ADD CONSTRAINT "PayrollCycle_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollCycle" ADD CONSTRAINT "PayrollCycle_releasedBy_fkey" FOREIGN KEY ("releasedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollCycle" ADD CONSTRAINT "PayrollCycle_archivedBy_fkey" FOREIGN KEY ("archivedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "PayrollCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "ProjectSite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "Bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_releasedBy_fkey" FOREIGN KEY ("releasedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollEntryWorkLine" ADD CONSTRAINT "PayrollEntryWorkLine_payrollEntryId_fkey" FOREIGN KEY ("payrollEntryId") REFERENCES "PayrollEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollEntryWorkLine" ADD CONSTRAINT "PayrollEntryWorkLine_unitId_siteId_fkey" FOREIGN KEY ("unitId", "siteId") REFERENCES "ProjectUnit"("id", "siteId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-added below: check constraints and the partial index Prisma's schema DSL cannot express
-- (docs/architecture/database-schema.md §10/§12/§12a), same pattern as Employee's CNIC check
-- constraint and partial-unique indexes (Phase 2 migration).

-- CheckConstraint: PayrollCycle.month must be a valid calendar month (§10).
ALTER TABLE "PayrollCycle" ADD CONSTRAINT "PayrollCycle_month_check" CHECK ("month" BETWEEN 1 AND 12);

-- PartialIndex: the "which cycle is currently Draft" lookup is hot and should be a fast partial
-- index rather than a plain index over a column with only three possible values (§10, §23).
CREATE INDEX "PayrollCycle_status_draft_idx" ON "PayrollCycle"("status") WHERE "status" = 'DRAFT';

-- CheckConstraint: PayrollEntry's non-negative monetary/quantity fields (§12).
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_grossPay_check" CHECK ("grossPay" >= 0);
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_allowance_check" CHECK ("allowance" >= 0);
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_leaveDays_check" CHECK ("leaveDays" >= 0);
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_eobiAmount_check" CHECK ("eobiAmount" >= 0);
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_advanceDeduction_check" CHECK ("advanceDeduction" >= 0);
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_eidAdvanceDeduction_check" CHECK ("eidAdvanceDeduction" >= 0);
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_fine_check" CHECK ("fine" >= 0);

-- CheckConstraint: released = true implies releasedAt/releasedBy are both populated (§12).
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_released_fields_check"
    CHECK ("released" = false OR ("releasedAt" IS NOT NULL AND "releasedBy" IS NOT NULL));

-- CheckConstraint: lateReason is only ever populated at the moment of a Late Entry's own one-off
-- release, so it implies released = true (§12's 2026-07-05 revision note).
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_lateReason_requires_released_check"
    CHECK ("lateReason" IS NULL OR "released" = true);

-- CheckConstraint: PayrollEntryWorkLine's non-negative attendance fields and cycleDays range (§12a).
ALTER TABLE "PayrollEntryWorkLine" ADD CONSTRAINT "PayrollEntryWorkLine_days_check" CHECK ("days" >= 0);
ALTER TABLE "PayrollEntryWorkLine" ADD CONSTRAINT "PayrollEntryWorkLine_otHours_check" CHECK ("otHours" >= 0);
ALTER TABLE "PayrollEntryWorkLine" ADD CONSTRAINT "PayrollEntryWorkLine_cycleDays_check" CHECK ("cycleDays" BETWEEN 1 AND 31);
