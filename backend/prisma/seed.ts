import 'dotenv/config';
import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import { PERMISSIONS, ROLE_CODES, ROLE_PERMISSIONS } from '@payroll/shared';

const prisma = new PrismaClient();

/**
 * Idempotent — safe to re-run against an environment that already has seed data (upserts
 * throughout, never blind inserts). Seeds exactly what Phase 1 needs: the permission registry,
 * the two roles with their grants, and one Master Admin account so the system is usable
 * immediately after migration. Later phases extend this file additively (banks, adjustment
 * types, company settings, etc.) rather than replacing it.
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

  console.log('Seeding roles and role-permission grants...');
  for (const roleCode of Object.values(ROLE_CODES)) {
    const role = await prisma.role.upsert({
      where: { code: roleCode },
      update: {},
      create: {
        code: roleCode,
        name: roleCode === ROLE_CODES.MASTER_ADMIN ? 'Master Admin' : 'Payroll Staff',
      },
    });

    const grantedKeys = ROLE_PERMISSIONS[roleCode];
    const permissions = await prisma.permission.findMany({
      where: { key: { in: grantedKeys } },
    });

    for (const permission of permissions) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
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
