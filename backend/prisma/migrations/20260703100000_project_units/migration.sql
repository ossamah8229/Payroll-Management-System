-- Phase 2.5, Checkpoint 1 (docs/IMPLEMENTATION_PLAN.md) — introduces ProjectUnit
-- (docs/architecture/database/sites-and-units.md §8a) and removes ProjectSite.branchCode (§8's revision
-- note). This is the project's first genuinely destructive migration (dropping a column in use
-- by the Prisma schema) — low practical risk only because, per docs/PROJECT_PROGRESS.md and
-- docs/SESSION_HANDOFF.md, no Postgres instance has ever applied any prior migration in this
-- environment, so no live data can be lost. `unitLabel` defaults to 'Branch' for any existing row,
-- matching the schema's own field default, so this remains additive-safe for the one column it
-- does add.

-- AlterTable
ALTER TABLE "ProjectSite" DROP COLUMN "branchCode",
ADD COLUMN     "unitLabel" VARCHAR(40) NOT NULL DEFAULT 'Branch';

-- CreateTable
CREATE TABLE "ProjectUnit" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "siteId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "code" VARCHAR(20),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ProjectUnit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectUnit_siteId_idx" ON "ProjectUnit"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectUnit_siteId_name_key" ON "ProjectUnit"("siteId", "name");

-- CreateIndex
-- Composite-FK-support index, not a business uniqueness rule — lets Checkpoint 2's
-- Employee.unitId and Phase 3's PayrollEntryWorkLine.unitId declare
-- (unitId, siteId) -> ProjectUnit(id, siteId) as a database-level guarantee
-- (docs/architecture/database/sites-and-units.md §8a).
CREATE UNIQUE INDEX "ProjectUnit_id_siteId_key" ON "ProjectUnit"("id", "siteId");

-- AddForeignKey
ALTER TABLE "ProjectUnit" ADD CONSTRAINT "ProjectUnit_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "ProjectSite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
