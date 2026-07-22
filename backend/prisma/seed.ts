import 'dotenv/config';
import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import { CASH_BANK_CODE, PERMISSIONS, ROLE_CODES, ROLE_PERMISSIONS } from '@payroll/shared';

const prisma = new PrismaClient();

/** Fixed, well-known CompanySettings PK — the primary key itself enforces the singleton. */
const COMPANY_SETTINGS_ID = '00000000-0000-0000-0000-000000000001';

const BANKS = [
  { code: 'ABL', name: 'Allied Bank Limited' },
  { code: 'HBL', name: 'Habib Bank Limited' },
  { code: 'MCB', name: 'MCB Bank Limited' },
  // The reserved, protected Cash record (Phase 4 Checkpoint 1 — Bank Registry). Seeded once here
  // and never touched again by this script (`update: {}` below) — its code/name are permanently
  // locked by banks.service.ts regardless, but this keeps the seed itself from ever being a second
  // place that could silently rewrite it.
  { code: CASH_BANK_CODE, name: 'Cash' },
];

const ROLE_DISPLAY_NAMES: Record<string, string> = {
  [ROLE_CODES.MASTER_ADMIN]: 'Master Admin',
  [ROLE_CODES.PAYROLL_STAFF]: 'Payroll Staff',
  [ROLE_CODES.FINANCE]: 'Finance',
};

const ADJUSTMENT_TYPES = [
  { code: 'ATTENDANCE_CORRECTION', label: 'Attendance Correction' },
  { code: 'OVERTIME_CORRECTION', label: 'Overtime Correction' },
  { code: 'SALARY_REVISION', label: 'Salary Revision' },
  { code: 'LEAVE_ADJUSTMENT', label: 'Leave Adjustment' },
  { code: 'FINE_ADJUSTMENT', label: 'Fine Adjustment' },
  { code: 'ADVANCE_RECOVERY', label: 'Advance Recovery' },
  { code: 'MANUAL_ADJUSTMENT', label: 'Manual Adjustment' },
];

/**
 * Idempotent — safe to re-run against an environment that already has seed data. Seeds the
 * permission registry, the three system roles with their bootstrap-default grants (Administration
 * & Security Management Phase 1: first-creation only, never a recurring reconciliation — see the
 * role-seeding loop's own comment below), one Master Admin account, the Bank/AdjustmentType lookup
 * tables, and the singleton CompanySettings row. Later phases extend this file additively rather
 * than replacing it.
 */
async function main() {
  console.log('Seeding permissions...');
  for (const key of Object.values(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key },
    });
  }

  // Administration & Security Management Phase 1 — `ROLE_PERMISSIONS` is a **bootstrap default
  // only**, applied exactly once per role at first-creation time, never a recurring authoritative
  // overwrite. Once a seeded role exists, its permissions become administrator-editable at
  // runtime (POST/PATCH /api/v1/roles) — the database is the runtime source of truth
  // (docs/architecture/authentication.md), and re-running this seed script (idempotent by design,
  // safe to run against an environment that already has data) must never reconcile an
  // administrator's later edits back to this file's own defaults. An existing role is therefore
  // left completely untouched here, permissions included — only a role that does not exist yet
  // is created, with its documented default grants applied at that single moment.
  console.log('Seeding roles and role-permission grants...');
  for (const roleCode of Object.values(ROLE_CODES)) {
    const existingRole = await prisma.role.findUnique({ where: { code: roleCode } });
    if (existingRole) {
      continue;
    }

    const role = await prisma.role.create({
      data: {
        code: roleCode,
        name: ROLE_DISPLAY_NAMES[roleCode] ?? roleCode,
        isSystemRole: true,
      },
    });

    const grantedKeys = ROLE_PERMISSIONS[roleCode];
    const permissions = await prisma.permission.findMany({
      where: { key: { in: grantedKeys } },
    });

    await prisma.rolePermission.createMany({
      data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
    });
  }

  console.log('Seeding Master Admin account...');
  const masterAdminRole = await prisma.role.findUniqueOrThrow({
    where: { code: ROLE_CODES.MASTER_ADMIN },
  });

  const seedEmail = process.env.SEED_MASTER_ADMIN_EMAIL ?? 'admin@broomservices.pk';
  const seedPassword = process.env.SEED_MASTER_ADMIN_PASSWORD ?? 'ChangeMe123!';

  const existingAdmin = await prisma.user.findUnique({ where: { email: seedEmail } });
  if (!existingAdmin) {
    const passwordHash = await argon2.hash(seedPassword);
    await prisma.user.create({
      data: {
        roleId: masterAdminRole.id,
        name: 'Master Admin',
        email: seedEmail,
        passwordHash,
      },
    });
    console.log(`Created Master Admin account: ${seedEmail}`);
    if (!process.env.SEED_MASTER_ADMIN_PASSWORD) {
      console.log(
        `  Using default password "${seedPassword}" — override via SEED_MASTER_ADMIN_PASSWORD ` +
          'and change it after first login.',
      );
    }
  } else {
    console.log(`Master Admin account already exists: ${seedEmail}`);
  }

  console.log('Seeding banks...');
  for (const bank of BANKS) {
    await prisma.bank.upsert({
      where: { code: bank.code },
      update: {},
      create: bank,
    });
  }

  console.log('Seeding adjustment types...');
  for (const adjustmentType of ADJUSTMENT_TYPES) {
    await prisma.adjustmentType.upsert({
      where: { code: adjustmentType.code },
      update: {},
      create: adjustmentType,
    });
  }

  console.log('Seeding company settings...');
  await prisma.companySettings.upsert({
    where: { id: COMPANY_SETTINGS_ID },
    update: {},
    create: {
      id: COMPANY_SETTINGS_ID,
      companyName: process.env.SEED_COMPANY_NAME ?? 'Broom Services Private Limited',
    },
  });

  console.log('Seed complete.');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
