-- CreateEnum
CREATE TYPE "PayType" AS ENUM ('DAILY_WAGE', 'MONTHLY');

-- CreateTable
CREATE TABLE "Bank" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(10) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeCode" VARCHAR(30),
    "cnic" VARCHAR(15),
    "name" VARCHAR(160) NOT NULL,
    "fatherName" VARCHAR(160),
    "religion" VARCHAR(40),
    "dateOfBirth" DATE,
    "mobileNumber" VARCHAR(20),
    "designation" VARCHAR(80) NOT NULL,
    "siteId" UUID NOT NULL,
    "dateOfJoining" DATE,
    "dateOfLeaving" DATE,
    "payType" "PayType" NOT NULL DEFAULT 'DAILY_WAGE',
    "grossPay" DECIMAL(12,2) NOT NULL,
    "bankId" UUID,
    "branchCode" VARCHAR(20),
    "accountNumber" VARCHAR(40),
    "accountTitle" VARCHAR(160),
    "defaultEobiAmount" DECIMAL(10,2) NOT NULL DEFAULT 400.00,
    "defaultEobiApplicable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Employee_grossPay_check" CHECK ("grossPay" >= 0),
    CONSTRAINT "Employee_defaultEobiAmount_check" CHECK ("defaultEobiAmount" >= 0),
    CONSTRAINT "Employee_cnic_check" CHECK ("cnic" IS NULL OR "cnic" ~ '^[0-9]{13}$')
);

-- CreateTable
CREATE TABLE "AdjustmentType" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(40) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdjustmentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanySettings" (
    "id" UUID NOT NULL,
    "companyName" VARCHAR(200) NOT NULL,
    "registeredAddress" VARCHAR(300),
    "phone" VARCHAR(30),
    "email" VARCHAR(255),
    "logoStorageKey" TEXT,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" UUID,

    CONSTRAINT "CompanySettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Bank_code_key" ON "Bank"("code");

-- CreateIndex
-- Partial unique indexes: nullable-but-unique-when-present, per database-schema.md §9/§26 item 2.
CREATE UNIQUE INDEX "Employee_cnic_key" ON "Employee"("cnic") WHERE "cnic" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Employee_employeeCode_key" ON "Employee"("employeeCode") WHERE "employeeCode" IS NOT NULL;

-- CreateIndex
CREATE INDEX "Employee_siteId_idx" ON "Employee"("siteId");

-- CreateIndex
CREATE INDEX "Employee_bankId_idx" ON "Employee"("bankId");

-- CreateIndex
-- Common-case filter: active employees (dateOfLeaving IS NULL).
CREATE INDEX "Employee_active_idx" ON "Employee"("siteId") WHERE "dateOfLeaving" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "AdjustmentType_code_key" ON "AdjustmentType"("code");

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "ProjectSite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "Bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanySettings" ADD CONSTRAINT "CompanySettings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
