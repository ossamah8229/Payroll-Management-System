-- Phase 4 Checkpoint 2 (Finance Role + Salary Release foundation).
-- Adds PayrollUnitRelease (docs/architecture/database/release.md §12b) — the release event for one
-- Project Unit, for one cycle; `PayrollEntry.released`/`.releasedAt`/`.releasedBy` (already present
-- since Phase 3 Checkpoint 0) are derived from this table's rows, swept transactionally in
-- payroll-release.service.ts. FINANCE is a new Role row seeded by prisma/seed.ts, not a schema
-- change here. PayrollUnitReadiness and the Late Entry one-off release path are deliberately
-- deferred past this checkpoint (see docs/PROJECT_PROGRESS.md's Phase 4 Checkpoint 2 entry).
-- Generated via `prisma migrate diff` against the live database, with the tool's spurious
-- `DROP TABLE "session"` line removed by hand — "session" is owned by connect-pg-simple, not this
-- Prisma schema (docs/architecture/database/access-control.md §20), and no migration in this
-- project has ever touched it.

-- CreateTable
CREATE TABLE "PayrollUnitRelease" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cycleId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "releasedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedById" UUID NOT NULL,

    CONSTRAINT "PayrollUnitRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayrollUnitRelease_cycleId_idx" ON "PayrollUnitRelease"("cycleId");

-- CreateIndex
CREATE INDEX "PayrollUnitRelease_unitId_idx" ON "PayrollUnitRelease"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollUnitRelease_cycleId_unitId_key" ON "PayrollUnitRelease"("cycleId", "unitId");

-- AddForeignKey
ALTER TABLE "PayrollUnitRelease" ADD CONSTRAINT "PayrollUnitRelease_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "PayrollCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollUnitRelease" ADD CONSTRAINT "PayrollUnitRelease_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "ProjectUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollUnitRelease" ADD CONSTRAINT "PayrollUnitRelease_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
