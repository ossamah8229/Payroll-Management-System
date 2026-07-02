import argon2 from 'argon2';
import type { CreateUserInput, ResetUserPasswordInput, UpdateUserInput } from '@payroll/shared';
import { ROLE_CODES } from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { badRequest, notFound } from '../../common/http-error';

export async function listUsers() {
  return prisma.user.findMany({
    include: { role: true, siteAssignments: { include: { site: true } } },
    orderBy: { name: 'asc' },
  });
}

export async function getUser(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    include: { role: true, siteAssignments: { include: { site: true } } },
  });

  if (!user) {
    throw notFound('User not found');
  }

  return user;
}

export async function createUser(input: CreateUserInput) {
  const role = await prisma.role.findUnique({ where: { code: input.roleCode } });
  if (!role) {
    throw badRequest(`Role ${input.roleCode} is not seeded`);
  }

  const passwordHash = await argon2.hash(input.password);
  const isMasterAdmin = input.roleCode === ROLE_CODES.MASTER_ADMIN;
  const siteIds = isMasterAdmin ? [] : (input.siteIds ?? []);

  return prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash,
      roleId: role.id,
      siteAssignments: {
        create: siteIds.map((siteId) => ({ siteId })),
      },
    },
    include: { role: true, siteAssignments: { include: { site: true } } },
  });
}

export async function updateUser(
  currentUserId: string,
  targetUserId: string,
  input: UpdateUserInput,
) {
  const existing = await getUser(targetUserId);

  if (input.isActive === false && targetUserId === currentUserId) {
    throw badRequest('You cannot deactivate your own account');
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: targetUserId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
      },
    });

    if (input.siteIds !== undefined && existing.role.code !== ROLE_CODES.MASTER_ADMIN) {
      await tx.userSiteAssignment.deleteMany({ where: { userId: targetUserId } });
      await tx.userSiteAssignment.createMany({
        data: input.siteIds.map((siteId) => ({ userId: targetUserId, siteId })),
      });
    }
  });

  return getUser(targetUserId);
}

export async function resetUserPassword(targetUserId: string, input: ResetUserPasswordInput): Promise<void> {
  await getUser(targetUserId);
  const passwordHash = await argon2.hash(input.newPassword);
  await prisma.user.update({ where: { id: targetUserId }, data: { passwordHash } });
}
