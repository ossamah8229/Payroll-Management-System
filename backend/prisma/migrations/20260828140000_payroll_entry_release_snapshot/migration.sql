-- Payroll Financial Integrity — Released-Value Immutability (2026-08-28 checkpoint). Purely
-- additive: one new enum, one new table, no alteration to any existing column, table, or row.
-- Existing released/Draft PayrollEntry rows remain valid and untouched — no historical monetary
-- snapshot is fabricated by this migration (see this checkpoint's own "no fake backfill" policy,
-- docs/PROJECT_PROGRESS.md). A pre-existing, unrelated local-dev-only schema drift (a stray
-- "session" table present in this sandbox's own `payroll_manual` database but absent from
-- schema.prisma, predating this checkpoint) was deliberately excluded from this migration by hand
-- after `prisma migrate diff` surfaced it — dropping it is out of this migration's scope and is not
-- a production-safe inference to make from one sandbox database's own drift.

-- CreateEnum
CREATE TYPE "CalcNetVersion" AS ENUM ('LEGACY_V1', 'V2_PRECISE');

-- CreateTable
CREATE TABLE "PayrollEntryReleaseSnapshot" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payrollEntryId" UUID NOT NULL,
    "calculationVersion" "CalcNetVersion" NOT NULL,
    "earnedAmount" DECIMAL(12,2) NOT NULL,
    "otEarned" DECIMAL(12,2) NOT NULL,
    "leaveEarned" DECIMAL(12,2) NOT NULL,
    "netSalary" DECIMAL(12,2) NOT NULL,
    "resolvedAt" TIMESTAMPTZ(6) NOT NULL,
    "resolvedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollEntryReleaseSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayrollEntryReleaseSnapshot_payrollEntryId_key" ON "PayrollEntryReleaseSnapshot"("payrollEntryId");

-- AddForeignKey
ALTER TABLE "PayrollEntryReleaseSnapshot" ADD CONSTRAINT "PayrollEntryReleaseSnapshot_payrollEntryId_fkey" FOREIGN KEY ("payrollEntryId") REFERENCES "PayrollEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollEntryReleaseSnapshot" ADD CONSTRAINT "PayrollEntryReleaseSnapshot_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

