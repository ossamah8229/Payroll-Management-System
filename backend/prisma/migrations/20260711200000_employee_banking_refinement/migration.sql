-- Banking refinement (approved 2026-07-11): Account Title is removed entirely — the account
-- holder is always the employee's own legal name, never a separately stored string. IBAN is
-- added as a new optional field. This project is still pre-production, so this is a clean
-- migration (no deprecated column left behind), not a soft-deprecation.

-- AlterTable: Employee
ALTER TABLE "Employee" ADD COLUMN     "iban" VARCHAR(34);
ALTER TABLE "Employee" DROP COLUMN "accountTitle";

-- AlterTable: PayrollEntry
ALTER TABLE "PayrollEntry" ADD COLUMN     "iban" VARCHAR(34);
ALTER TABLE "PayrollEntry" DROP COLUMN "accountTitle";
