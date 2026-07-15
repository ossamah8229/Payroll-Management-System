-- AlterTable
ALTER TABLE "PayrollCycle" ADD COLUMN     "archivedWithBackupPackageId" UUID;

-- CreateIndex
CREATE INDEX "PayrollCycle_archivedWithBackupPackageId_idx" ON "PayrollCycle"("archivedWithBackupPackageId");

-- AddForeignKey
ALTER TABLE "PayrollCycle" ADD CONSTRAINT "PayrollCycle_archivedWithBackupPackageId_fkey" FOREIGN KEY ("archivedWithBackupPackageId") REFERENCES "BackupPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
