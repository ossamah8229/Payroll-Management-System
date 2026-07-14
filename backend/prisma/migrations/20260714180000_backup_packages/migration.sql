-- Phase 5 Checkpoint 2 (Backup Packages, approved 2026-07-14 architecture review) — adds
-- BackupPackage/BackupPackageFile (docs/architecture/database/payroll-cycle.md §17-18, amended
-- from the originally frozen sketch: BackupPackage gains status/generatedBy/failureReason;
-- BackupPackageFile gains filename/contentType/checksum/sortOrder). Generated via
-- `prisma migrate diff` against the live database, with the tool's spurious
-- `DROP TABLE "session"` line removed by hand — "session" is owned by connect-pg-simple, not this
-- Prisma schema (docs/architecture/database/access-control.md §20), and no migration in this
-- project has ever touched it.

-- CreateEnum
CREATE TYPE "BackupPackageStatus" AS ENUM ('GENERATING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "BackupFileType" AS ENUM ('MANIFEST', 'PAYROLL_ENTRY_CSV', 'PAYROLL_ENTRY_XLSX', 'BANK_SHEETS_CSV', 'CASH_RECEIVING_CSV');

-- CreateTable
CREATE TABLE "BackupPackage" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cycleId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "BackupPackageStatus" NOT NULL DEFAULT 'GENERATING',
    "generatedAt" TIMESTAMPTZ(6),
    "generatedBy" UUID NOT NULL,
    "applicationVersion" VARCHAR(40) NOT NULL,
    "databaseSchemaVersion" VARCHAR(60) NOT NULL,
    "releaseStatusSummary" JSONB NOT NULL,
    "totalSizeBytes" BIGINT,
    "fileCount" INTEGER,
    "manifestChecksum" VARCHAR(64),
    "failureReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "BackupPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupPackageFile" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "backupPackageId" UUID NOT NULL,
    "fileType" "BackupFileType" NOT NULL,
    "filename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackupPackageFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackupPackage_cycleId_idx" ON "BackupPackage"("cycleId");

-- CreateIndex
CREATE INDEX "BackupPackage_status_idx" ON "BackupPackage"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BackupPackage_cycleId_version_key" ON "BackupPackage"("cycleId", "version");

-- CreateIndex
CREATE INDEX "BackupPackageFile_backupPackageId_idx" ON "BackupPackageFile"("backupPackageId");

-- CreateIndex
CREATE UNIQUE INDEX "BackupPackageFile_backupPackageId_fileType_key" ON "BackupPackageFile"("backupPackageId", "fileType");

-- AddForeignKey
ALTER TABLE "BackupPackage" ADD CONSTRAINT "BackupPackage_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "PayrollCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackupPackage" ADD CONSTRAINT "BackupPackage_generatedBy_fkey" FOREIGN KEY ("generatedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackupPackageFile" ADD CONSTRAINT "BackupPackageFile_backupPackageId_fkey" FOREIGN KEY ("backupPackageId") REFERENCES "BackupPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
