import argon2 from 'argon2';
import type { CreateUserInput, ResetUserPasswordInput, UpdateUserInput } from '@payroll/shared';
import { ROLE_CODES } from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { badRequest, notFound } from '../../common/http-error';

/** The safe, explicit User Management response shape (Phase 5 Checkpoint 4 security correction,
 * 2026-07-16) — every field a client of `GET/POST/PATCH /api/v1/users` genuinely needs, and
 * nothing else. **Never `passwordHash`, `roleId`, `avatarStorageKey`, `themeAccentColor`, or raw
 * Prisma relation objects** — this project's permanent convention (`docs/architecture/
 * system-conventions.md`) is that no HTTP route returns a raw Prisma model. Every function below
 * uses an explicit Prisma `select` (not `include`) so `passwordHash` is never even fetched from the
 * database for these read paths, not merely stripped afterward. */
export interface UserSummary {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  lastLoginAt: string | null;
  role: { code: string; name: string };
  siteAssignments: {
    siteId: string;
    site: {
      id: string;
      name: string;
      address: string | null;
      unitLabel: string;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
    };
  }[];
}

const USER_SUMMARY_SELECT = {
  id: true,
  name: true,
  email: true,
  isActive: true,
  lastLoginAt: true,
  role: { select: { code: true, name: true } },
  siteAssignments: {
    select: {
      siteId: true,
      site: {
        select: {
          id: true,
          name: true,
          address: true,
          unitLabel: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  },
} as const;

type RawUserSummary = {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  role: { code: string; name: string };
  siteAssignments: {
    siteId: string;
    site: {
      id: string;
      name: string;
      address: string | null;
      unitLabel: string;
      isActive: boolean;
      createdAt: Date;
      updatedAt: Date;
    };
  }[];
};

function toUserSummary(user: RawUserSummary): UserSummary {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    role: { code: user.role.code, name: user.role.name },
    siteAssignments: user.siteAssignments.map((assignment) => ({
      siteId: assignment.siteId,
      site: {
        id: assignment.site.id,
        name: assignment.site.name,
        address: assignment.site.address,
        unitLabel: assignment.site.unitLabel,
        isActive: assignment.site.isActive,
        createdAt: assignment.site.createdAt.toISOString(),
        updatedAt: assignment.site.updatedAt.toISOString(),
      },
    })),
  };
}

export async function listUsers(): Promise<UserSummary[]> {
  const users = await prisma.user.findMany({
    select: USER_SUMMARY_SELECT,
    orderBy: { name: 'asc' },
  });
  return users.map(toUserSummary);
}

async function getUserRaw(id: string): Promise<RawUserSummary & { role: { code: string; name: string } }> {
  const user = await prisma.user.findUnique({
    where: { id },
    select: USER_SUMMARY_SELECT,
  });

  if (!user) {
    throw notFound('User not found');
  }

  return user;
}

export async function getUser(id: string): Promise<UserSummary> {
  return toUserSummary(await getUserRaw(id));
}

export async function createUser(input: CreateUserInput): Promise<UserSummary> {
  const role = await prisma.role.findUnique({ where: { code: input.roleCode } });
  if (!role) {
    throw badRequest(`Role ${input.roleCode} is not seeded`);
  }

  const passwordHash = await argon2.hash(input.password);
  const isMasterAdmin = input.roleCode === ROLE_CODES.MASTER_ADMIN;
  const siteIds = isMasterAdmin ? [] : (input.siteIds ?? []);

  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash,
      roleId: role.id,
      siteAssignments: {
        create: siteIds.map((siteId) => ({ siteId })),
      },
    },
    select: USER_SUMMARY_SELECT,
  });

  return toUserSummary(user);
}

export async function updateUser(
  currentUserId: string,
  targetUserId: string,
  input: UpdateUserInput,
): Promise<UserSummary> {
  // `getUserRaw` (not the public `getUser`) so the Master-Admin-role check below reads directly off
  // the same fetch, without re-deriving a second Prisma round trip just to inspect `role.code`.
  const existing = await getUserRaw(targetUserId);

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
  const exists = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } });
  if (!exists) {
    throw notFound('User not found');
  }
  const passwordHash = await argon2.hash(input.newPassword);
  await prisma.user.update({ where: { id: targetUserId }, data: { passwordHash } });
}
