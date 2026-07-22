import { randomBytes } from 'node:crypto';
import type { CreateRoleInput, DuplicateRoleInput, UpdateRoleInput } from '@payroll/shared';
import { CRITICAL_ADMIN_PERMISSIONS } from '@payroll/shared';
import { prisma, type PrismaTransactionClient } from '../../lib/prisma';
import type { RequestMeta } from '../../common/request-meta';
import { badRequest, notFound } from '../../common/http-error';
import { recordAuditLog } from '../audit-log/audit-log.service';

/**
 * Administration & Security Management Phase 1 — dynamic role administration
 * (docs/architecture/authentication.md). `Role` is a real, relational table (`Role`/`Permission`/
 * `RolePermission`, all pre-existing since Phase 1) — this module is what makes it
 * administrator-editable at runtime instead of only via source-code/seed changes. Every function
 * here treats `Role.id` as the one true identity; `Role.name` is an editable display label with no
 * authorization meaning; `Role.code` is a generated internal identifier assigned once at creation
 * (see `generateRoleCode`) and never changed by a rename.
 */

export interface RoleSummary {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  isSystemRole: boolean;
  permissionCount: number;
  assignedUserCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RoleDetail extends RoleSummary {
  permissionKeys: string[];
}

const ROLE_SUMMARY_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  isActive: true,
  isSystemRole: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { users: true, rolePermissions: true } },
} as const;

type RawRoleSummary = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  isSystemRole: boolean;
  createdAt: Date;
  updatedAt: Date;
  _count: { users: number; rolePermissions: number };
};

function toRoleSummary(role: RawRoleSummary): RoleSummary {
  return {
    id: role.id,
    code: role.code,
    name: role.name,
    description: role.description,
    isActive: role.isActive,
    isSystemRole: role.isSystemRole,
    permissionCount: role._count.rolePermissions,
    assignedUserCount: role._count.users,
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
  };
}

/** A stable, generated internal identifier for a custom role — derived from `name` once, at
 * creation time, and never changed by a later rename (`Role.code`'s own schema.prisma comment).
 * Authorization must never depend on this value beyond the pre-existing, documented
 * `MASTER_ADMIN` exception — it exists only because `Role.code` is a `@unique NOT NULL` column,
 * a pre-Phase-1 constraint this phase deliberately keeps rather than migrating away from. */
function generateRoleCode(name: string): string {
  const slug = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  const suffix = randomBytes(4).toString('hex').toUpperCase();
  return `${slug || 'ROLE'}_${suffix}`;
}

async function assertNameNotTaken(
  name: string,
  tx: PrismaTransactionClient,
  excludeRoleId?: string,
): Promise<void> {
  const trimmed = name.trim();
  const existing = await tx.role.findFirst({
    where: {
      name: { equals: trimmed, mode: 'insensitive' },
      ...(excludeRoleId && { id: { not: excludeRoleId } }),
    },
    select: { id: true },
  });
  if (existing) {
    throw badRequest(`A role named "${trimmed}" already exists`);
  }
}

/** Every submitted key must already exist in the `Permission` catalog — an unknown key is
 * rejected outright, never silently ignored or auto-created. Returns the matched rows so callers
 * get real `Permission.id`s to build `RolePermission` rows from. */
async function resolvePermissions(keys: string[], tx: PrismaTransactionClient) {
  const uniqueKeys = Array.from(new Set(keys));
  const permissions = await tx.permission.findMany({ where: { key: { in: uniqueKeys } } });
  if (permissions.length !== uniqueKeys.length) {
    const foundKeys = new Set(permissions.map((p) => p.key));
    const unknown = uniqueKeys.filter((key) => !foundKeys.has(key));
    throw badRequest(`Unknown permission key(s): ${unknown.join(', ')}`);
  }
  return permissions;
}

// --- Final-active-administrator safeguard -------------------------------------------------------

/** True if a role granting exactly `permissionKeys` would satisfy the "full administrative
 * capability" bar this system requires at least one active user to retain — see
 * `CRITICAL_ADMIN_PERMISSIONS`'s own doc comment (shared/src/constants/permissions.ts) for exactly
 * which keys, and why `payroll-cycle:manage` is deliberately excluded. */
function roleGrantsFullAdminCapability(permissionKeys: string[]): boolean {
  const held = new Set(permissionKeys);
  return CRITICAL_ADMIN_PERMISSIONS.every((key) => held.has(key));
}

/** Counts currently-active users, holding a currently-active role, whose role grants full
 * administrative capability — optionally excluding one user (simulating "if this user were
 * removed from consideration") or one role (simulating "if this role's holders were removed from
 * consideration", used for role deactivation/permission-change checks, since every holder of that
 * one role is affected identically and simultaneously). Always run inside the same transaction as
 * the change being validated, so a concurrent race can't slip through between check and mutation. */
async function countQualifyingAdministrators(
  tx: PrismaTransactionClient,
  options: { excludeUserId?: string; excludeRoleId?: string } = {},
): Promise<number> {
  const users = await tx.user.findMany({
    where: {
      isActive: true,
      role: { isActive: true },
      ...(options.excludeUserId && { id: { not: options.excludeUserId } }),
      ...(options.excludeRoleId && { roleId: { not: options.excludeRoleId } }),
    },
    select: {
      role: { select: { rolePermissions: { select: { permission: { select: { key: true } } } } } },
    },
  });

  return users.filter((user) =>
    roleGrantsFullAdminCapability(user.role.rolePermissions.map((rp) => rp.permission.key)),
  ).length;
}

const FINAL_ADMIN_ERROR =
  'This change would leave no active user with full administrative capability ' +
  '(users:manage, settings:manage, sites:manage, and audit-log:view). At least one must remain.';

/** Guards user deactivation and role reassignment (`users.service.ts`) — only blocks the change
 * when the *target user themselves* currently qualifies as a full administrator and no other
 * qualifying administrator would remain afterward. A non-administrator user can always be
 * deactivated/reassigned freely; this never blocks anything else. */
export async function assertUserChangeKeepsAnAdministrator(
  tx: PrismaTransactionClient,
  targetUserId: string,
  currentPermissionKeys: string[],
  nextPermissionKeys: string[] | null,
): Promise<void> {
  const currentlyQualifies = roleGrantsFullAdminCapability(currentPermissionKeys);
  if (!currentlyQualifies) return;

  const stillQualifies = nextPermissionKeys !== null && roleGrantsFullAdminCapability(nextPermissionKeys);
  if (stillQualifies) return;

  const remaining = await countQualifyingAdministrators(tx, { excludeUserId: targetUserId });
  if (remaining === 0) {
    throw badRequest(FINAL_ADMIN_ERROR);
  }
}

/** Guards role deactivation and role permission changes (`updateRole`, below) — only blocks the
 * change when this *role itself* currently qualifies as administrator-granting and no qualifying
 * administrator on any *other* role would remain afterward. A role that never granted full
 * administrative capability can always be edited/deactivated freely. */
export async function assertRoleChangeKeepsAnAdministrator(
  tx: PrismaTransactionClient,
  roleId: string,
  currentPermissionKeys: string[],
  nextPermissionKeys: string[] | null,
): Promise<void> {
  const currentlyQualifies = roleGrantsFullAdminCapability(currentPermissionKeys);
  if (!currentlyQualifies) return;

  const stillQualifies = nextPermissionKeys !== null && roleGrantsFullAdminCapability(nextPermissionKeys);
  if (stillQualifies) return;

  const remaining = await countQualifyingAdministrators(tx, { excludeRoleId: roleId });
  if (remaining === 0) {
    throw badRequest(FINAL_ADMIN_ERROR);
  }
}

// --- Reads -----------------------------------------------------------------------------------

export async function listRoles(options: { includeInactive?: boolean } = {}): Promise<RoleSummary[]> {
  const roles = await prisma.role.findMany({
    where: options.includeInactive ? {} : { isActive: true },
    select: ROLE_SUMMARY_SELECT,
    orderBy: { name: 'asc' },
  });
  return roles.map(toRoleSummary);
}

async function getRoleRaw(id: string, tx: PrismaTransactionClient = prisma) {
  const role = await tx.role.findUnique({
    where: { id },
    select: { ...ROLE_SUMMARY_SELECT, rolePermissions: { select: { permission: { select: { id: true, key: true } } } } },
  });
  if (!role) {
    throw notFound('Role not found');
  }
  return role;
}

export async function getRoleDetail(id: string): Promise<RoleDetail> {
  const role = await getRoleRaw(id);
  return {
    ...toRoleSummary(role),
    permissionKeys: role.rolePermissions.map((rp) => rp.permission.key),
  };
}

export interface RoleUserSummary {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
}

/** A limited, administrative user list for "who currently holds this role" — never a password
 * hash, session detail, or anything beyond what `users.service.ts`'s own `UserSummary` already
 * exposes for the full user list. */
export async function listRoleUsers(roleId: string): Promise<RoleUserSummary[]> {
  await getRoleRaw(roleId);
  return prisma.user.findMany({
    where: { roleId },
    select: { id: true, name: true, email: true, isActive: true },
    orderBy: { name: 'asc' },
  });
}

// --- Writes ----------------------------------------------------------------------------------

export async function createRole(
  input: CreateRoleInput,
  actorUserId: string,
  requestMeta: RequestMeta,
): Promise<RoleDetail> {
  const roleId = await prisma.$transaction(async (tx) => {
    await assertNameNotTaken(input.name, tx);
    const permissions = await resolvePermissions(input.permissionKeys, tx);

    const role = await tx.role.create({
      data: {
        code: generateRoleCode(input.name),
        name: input.name.trim(),
        description: input.description ?? null,
        rolePermissions: {
          create: permissions.map((permission) => ({ permissionId: permission.id })),
        },
      },
    });

    await recordAuditLog(
      {
        actorUserId,
        action: 'role.created',
        entityType: 'Role',
        entityId: role.id,
        metadata: { name: role.name, permissionKeys: permissions.map((p) => p.key) },
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      },
      tx,
    );

    return role.id;
  });

  return getRoleDetail(roleId);
}

export async function updateRole(
  id: string,
  input: UpdateRoleInput,
  actorUserId: string,
  requestMeta: RequestMeta,
): Promise<RoleDetail> {
  await prisma.$transaction(async (tx) => {
    const existing = await getRoleRaw(id, tx);
    const currentKeys = existing.rolePermissions.map((rp) => rp.permission.key);

    if (input.name !== undefined && input.name.trim() !== existing.name) {
      await assertNameNotTaken(input.name, tx, id);
      await tx.role.update({ where: { id }, data: { name: input.name.trim() } });
      await recordAuditLog(
        {
          actorUserId,
          action: 'role.renamed',
          entityType: 'Role',
          entityId: id,
          metadata: { previousName: existing.name, newName: input.name.trim() },
          ipAddress: requestMeta.ipAddress,
          userAgent: requestMeta.userAgent,
        },
        tx,
      );
    }

    if (input.description !== undefined && input.description !== existing.description) {
      await tx.role.update({ where: { id }, data: { description: input.description } });
      await recordAuditLog(
        {
          actorUserId,
          action: 'role.updated',
          entityType: 'Role',
          entityId: id,
          metadata: { field: 'description' },
          ipAddress: requestMeta.ipAddress,
          userAgent: requestMeta.userAgent,
        },
        tx,
      );
    }

    if (input.permissionKeys !== undefined) {
      const nextPermissions = await resolvePermissions(input.permissionKeys, tx);
      const nextKeys = nextPermissions.map((p) => p.key);

      await assertRoleChangeKeepsAnAdministrator(tx, id, currentKeys, nextKeys);

      const added = nextKeys.filter((key) => !currentKeys.includes(key));
      const removed = currentKeys.filter((key) => !nextKeys.includes(key));

      if (added.length > 0 || removed.length > 0) {
        // Atomic replace — delete every existing grant, then create the submitted set, both
        // inside this same transaction (never a partial add/remove visible to any concurrent
        // reader, and a failure anywhere rolls back the whole replacement).
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.rolePermission.createMany({
          data: nextPermissions.map((permission) => ({ roleId: id, permissionId: permission.id })),
        });

        await recordAuditLog(
          {
            actorUserId,
            action: 'role.permissions_changed',
            entityType: 'Role',
            entityId: id,
            metadata: { added, removed },
            ipAddress: requestMeta.ipAddress,
            userAgent: requestMeta.userAgent,
          },
          tx,
        );
      }
    }

    if (input.isActive !== undefined && input.isActive !== existing.isActive) {
      // Deliberately no blanket "system roles cannot be deactivated" rule — only deletion is
      // restricted for a system role (Step 5's own invariant list). Deactivating Master Admin,
      // Payroll Staff, or Finance is otherwise ordinary, gated by exactly the same
      // final-administrator safeguard every other role's deactivation goes through below.
      if (input.isActive === false) {
        // Deactivating strips every current holder's effective access immediately
        // (auth.service.ts's loadSessionUser) — the same safeguard as deactivating a user.
        await assertRoleChangeKeepsAnAdministrator(tx, id, currentKeys, null);
      }

      await tx.role.update({ where: { id }, data: { isActive: input.isActive } });
      await recordAuditLog(
        {
          actorUserId,
          action: input.isActive ? 'role.activated' : 'role.deactivated',
          entityType: 'Role',
          entityId: id,
          ipAddress: requestMeta.ipAddress,
          userAgent: requestMeta.userAgent,
        },
        tx,
      );
    }
  });

  return getRoleDetail(id);
}

export async function duplicateRole(
  id: string,
  input: DuplicateRoleInput,
  actorUserId: string,
  requestMeta: RequestMeta,
): Promise<RoleDetail> {
  const newRoleId = await prisma.$transaction(async (tx) => {
    const source = await getRoleRaw(id, tx);
    await assertNameNotTaken(input.newName, tx);

    const role = await tx.role.create({
      data: {
        code: generateRoleCode(input.newName),
        name: input.newName.trim(),
        description: input.description ?? source.description,
        isActive: input.isActive ?? true,
      },
    });

    // Copies the source role's permission *assignments*, not its permission *keys* re-resolved —
    // source.rolePermissions is already loaded (getRoleRaw's own select includes the join rows
    // with each permission's id), so this needs no second lookup.
    if (source.rolePermissions.length > 0) {
      await tx.rolePermission.createMany({
        data: source.rolePermissions.map((rp) => ({ roleId: role.id, permissionId: rp.permission.id })),
      });
    }

    await recordAuditLog(
      {
        actorUserId,
        action: 'role.duplicated',
        entityType: 'Role',
        entityId: role.id,
        metadata: { sourceRoleId: id, sourceName: source.name, newName: role.name },
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      },
      tx,
    );

    return role.id;
  });

  return getRoleDetail(newRoleId);
}

export async function deleteRole(id: string, actorUserId: string, requestMeta: RequestMeta): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const role = await getRoleRaw(id, tx);

    if (role.isSystemRole) {
      throw badRequest('System roles cannot be deleted');
    }
    if (role._count.users > 0) {
      throw badRequest(
        `Cannot delete this role while ${role._count.users} user(s) are still assigned to it — reassign them first, or deactivate the role instead`,
      );
    }

    await tx.role.delete({ where: { id } });

    await recordAuditLog(
      {
        actorUserId,
        action: 'role.deleted',
        entityType: 'Role',
        entityId: id,
        metadata: { name: role.name },
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      },
      tx,
    );
  });
}

// --- Consumed by users.service.ts for role assignment/reassignment ---------------------------

/** Loads a role for assignment purposes (create-user, reassign-role) — throws if it doesn't exist
 * or isn't currently assignable (inactive). Returns its current permission keys too, so callers
 * can run `assertUserChangeKeepsAnAdministrator` without a second query. */
export async function getAssignableRole(
  roleId: string,
  tx: PrismaTransactionClient = prisma,
): Promise<{ id: string; code: string; name: string; permissionKeys: string[] }> {
  const role = await tx.role.findUnique({
    where: { id: roleId },
    include: { rolePermissions: { include: { permission: true } } },
  });
  if (!role) {
    throw badRequest('Selected role does not exist');
  }
  if (!role.isActive) {
    throw badRequest(`Role "${role.name}" is inactive and cannot be assigned`);
  }
  return {
    id: role.id,
    code: role.code,
    name: role.name,
    permissionKeys: role.rolePermissions.map((rp) => rp.permission.key),
  };
}
