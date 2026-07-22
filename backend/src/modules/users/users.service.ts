import argon2 from 'argon2';
import type { CreateUserInput, ResetUserPasswordInput, UpdateUserInput } from '@payroll/shared';
import { ROLE_CODES } from '@payroll/shared';
import { prisma, type PrismaTransactionClient } from '../../lib/prisma';
import { invalidateAllSessionsForUser } from '../../lib/session-store';
import type { RequestMeta } from '../../common/request-meta';
import { badRequest, notFound } from '../../common/http-error';
import { recordAuditLog } from '../audit-log/audit-log.service';
import { assertUserChangeKeepsAnAdministrator, getAssignableRole } from '../roles/roles.service';

/** The safe, explicit User Management response shape (Phase 5 Checkpoint 4 security correction,
 * 2026-07-16) — every field a client of `GET/POST/PATCH /api/v1/users` genuinely needs, and
 * nothing else. **Never `passwordHash`, `roleId` , `avatarStorageKey`, `themeAccentColor`, or raw
 * Prisma relation objects** — this project's permanent convention (`docs/architecture/
 * system-conventions.md`) is that no HTTP route returns a raw Prisma model. Every function below
 * uses an explicit Prisma `select` (not `include`) so `passwordHash` is never even fetched from the
 * database for these read paths, not merely stripped afterward.
 *
 * Administration & Security Management Phase 1: `role` now also carries `id` (so the frontend's
 * Edit User role selector can pre-select the user's current role) alongside the pre-existing
 * `code`/`name`. */
export interface UserSummary {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  lastLoginAt: string | null;
  role: { id: string; code: string; name: string };
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
  role: { select: { id: true, code: true, name: true } },
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
  role: { id: string; code: string; name: string };
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
    role: { id: user.role.id, code: user.role.code, name: user.role.name },
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

async function getUserRaw(
  id: string,
  tx: PrismaTransactionClient = prisma,
): Promise<RawUserSummary> {
  const user = await tx.user.findUnique({
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

/** Fetches a user's *current* role's permission keys — used only by the final-administrator
 * safeguard (`assertUserChangeKeepsAnAdministrator`), never returned to a client. */
async function getUserCurrentPermissionKeys(userId: string, tx: PrismaTransactionClient): Promise<string[]> {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { role: { select: { rolePermissions: { select: { permission: { select: { key: true } } } } } } },
  });
  return user.role.rolePermissions.map((rp) => rp.permission.key);
}

export async function createUser(input: CreateUserInput): Promise<UserSummary> {
  return prisma.$transaction(async (tx) => {
    const role = await getAssignableRole(input.roleId, tx);

    const passwordHash = await argon2.hash(input.password);
    const isMasterAdmin = role.code === ROLE_CODES.MASTER_ADMIN;
    const siteIds = isMasterAdmin ? [] : (input.siteIds ?? []);

    const user = await tx.user.create({
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
  });
}

/**
 * Administration & Security Management Phase 1 — `roleId` reassignment added alongside the
 * pre-existing name/isActive/siteIds fields. Reassignment:
 * 1. Validates the destination role exists and is active (`getAssignableRole`).
 * 2. Applies the final-active-administrator safeguard (`assertUserChangeKeepsAnAdministrator`) —
 *    both here and for a plain deactivation (`isActive: false`), since either can remove a user's
 *    administrative capability.
 * 3. Records a dedicated `user.role_changed` audit entry with a before/after role snapshot,
 *    distinct from the generic `user.updated` entry the route itself still writes for other
 *    field changes.
 * 4. Revokes every existing session for the affected user (`invalidateAllSessionsForUser`) —
 *    recommended and applied here (docs/architecture/authentication.md): a role change is
 *    security-sensitive enough that requiring an explicit re-login, rather than a silent
 *    same-session permission swap, is the safer default. The very next request already reflects
 *    the new role regardless (permissions are DB-loaded fresh every request,
 *    `auth.service.ts`'s `loadSessionUser`) — revocation forces a new login on top of that, it
 *    does not substitute for it.
 */
export async function updateUser(
  currentUserId: string,
  targetUserId: string,
  input: UpdateUserInput,
  requestMeta: RequestMeta,
): Promise<UserSummary> {
  if (input.isActive === false && targetUserId === currentUserId) {
    throw badRequest('You cannot deactivate your own account');
  }
  if (input.roleId !== undefined && targetUserId === currentUserId) {
    throw badRequest('You cannot change your own role');
  }

  const roleChanged = await prisma.$transaction(async (tx) => {
    const existing = await getUserRaw(targetUserId, tx);
    const currentPermissionKeys = await getUserCurrentPermissionKeys(targetUserId, tx);

    if (input.isActive === false) {
      await assertUserChangeKeepsAnAdministrator(tx, targetUserId, currentPermissionKeys, null);
    }

    let newRole: Awaited<ReturnType<typeof getAssignableRole>> | undefined;
    if (input.roleId !== undefined && input.roleId !== existing.role.id) {
      newRole = await getAssignableRole(input.roleId, tx);
      await assertUserChangeKeepsAnAdministrator(tx, targetUserId, currentPermissionKeys, newRole.permissionKeys);
    }

    await tx.user.update({
      where: { id: targetUserId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
        ...(newRole && { roleId: newRole.id }),
      },
    });

    const targetIsMasterAdmin = (newRole?.code ?? existing.role.code) === ROLE_CODES.MASTER_ADMIN;
    if (input.siteIds !== undefined && !targetIsMasterAdmin) {
      await tx.userSiteAssignment.deleteMany({ where: { userId: targetUserId } });
      await tx.userSiteAssignment.createMany({
        data: input.siteIds.map((siteId) => ({ userId: targetUserId, siteId })),
      });
    }

    if (newRole) {
      await recordAuditLog(
        {
          actorUserId: currentUserId,
          action: 'user.role_changed',
          entityType: 'User',
          entityId: targetUserId,
          metadata: {
            previousRole: { id: existing.role.id, name: existing.role.name },
            newRole: { id: newRole.id, name: newRole.name },
          },
          ipAddress: requestMeta.ipAddress,
          userAgent: requestMeta.userAgent,
        },
        tx,
      );
    }

    return Boolean(newRole);
  });

  // Outside the transaction, same pattern as resetUserPassword/changeOwnPassword —
  // invalidateAllSessionsForUser talks to the session store via its own separate `pg` pool
  // (lib/session-store.ts), not through Prisma at all, so it was never something a Prisma
  // transaction could participate in.
  if (roleChanged) {
    await invalidateAllSessionsForUser(targetUserId);
  }

  return getUser(targetUserId);
}

export async function resetUserPassword(targetUserId: string, input: ResetUserPasswordInput): Promise<void> {
  const exists = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } });
  if (!exists) {
    throw notFound('User not found');
  }
  const passwordHash = await argon2.hash(input.newPassword);
  await prisma.user.update({ where: { id: targetUserId }, data: { passwordHash } });
  await invalidateAllSessionsForUser(targetUserId);
}
