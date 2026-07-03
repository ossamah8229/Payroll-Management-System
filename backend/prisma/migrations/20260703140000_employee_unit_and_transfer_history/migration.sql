-- Phase 2.5, Checkpoint 2 (docs/IMPLEMENTATION_PLAN.md) — adds Employee.unitId (composite-FK'd
-- against ProjectUnit(id, siteId), docs/architecture/database-schema.md §9) and the new,
-- append-only EmployeeTransferHistory table (§8b). Employee.unitId is added NOT NULL with no
-- default, mirroring how Employee.siteId has always been required — safe here only because, per
-- docs/PROJECT_PROGRESS.md and docs/SESSION_HANDOFF.md, no Postgres instance has ever applied any
-- prior migration in this environment, so there is no existing Employee data to backfill.

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "unitId" UUID NOT NULL;

-- CreateTable
CREATE TABLE "EmployeeTransferHistory" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "fromSiteId" UUID NOT NULL,
    "toSiteId" UUID NOT NULL,
    "fromUnitId" UUID NOT NULL,
    "toUnitId" UUID NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "transferredByUserId" UUID NOT NULL,
    "reason" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeTransferHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeTransferHistory_employeeId_effectiveDate_idx" ON "EmployeeTransferHistory"("employeeId", "effectiveDate" DESC);

-- CreateIndex
CREATE INDEX "EmployeeTransferHistory_toUnitId_effectiveDate_idx" ON "EmployeeTransferHistory"("toUnitId", "effectiveDate");

-- CreateIndex
CREATE INDEX "EmployeeTransferHistory_fromSiteId_idx" ON "EmployeeTransferHistory"("fromSiteId");

-- CreateIndex
CREATE INDEX "EmployeeTransferHistory_toSiteId_idx" ON "EmployeeTransferHistory"("toSiteId");

-- CreateIndex
CREATE INDEX "EmployeeTransferHistory_fromUnitId_idx" ON "EmployeeTransferHistory"("fromUnitId");

-- CreateIndex
CREATE INDEX "Employee_unitId_idx" ON "Employee"("unitId");

-- AddForeignKey
-- The composite FK that makes "an employee's unit must belong to their own site" a database-level
-- guarantee, not just an application-layer check (docs/architecture/database-schema.md §9).
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_unitId_siteId_fkey" FOREIGN KEY ("unitId", "siteId") REFERENCES "ProjectUnit"("id", "siteId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeTransferHistory" ADD CONSTRAINT "EmployeeTransferHistory_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeTransferHistory" ADD CONSTRAINT "EmployeeTransferHistory_fromSiteId_fkey" FOREIGN KEY ("fromSiteId") REFERENCES "ProjectSite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeTransferHistory" ADD CONSTRAINT "EmployeeTransferHistory_toSiteId_fkey" FOREIGN KEY ("toSiteId") REFERENCES "ProjectSite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeTransferHistory" ADD CONSTRAINT "EmployeeTransferHistory_fromUnitId_fkey" FOREIGN KEY ("fromUnitId") REFERENCES "ProjectUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeTransferHistory" ADD CONSTRAINT "EmployeeTransferHistory_toUnitId_fkey" FOREIGN KEY ("toUnitId") REFERENCES "ProjectUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeTransferHistory" ADD CONSTRAINT "EmployeeTransferHistory_transferredByUserId_fkey" FOREIGN KEY ("transferredByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
