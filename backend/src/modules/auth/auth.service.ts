import argon2 from 'argon2';
import type { ChangePasswordInput, PermissionKey, RoleCode, SessionUser, UpdateProfileInput } from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { invalidateAllSessionsForUser } from '../../lib/session-store';
import { badRequest } from '../../common/http-error';

/**
 * Verifies email/password against the stored Argon2 hash. Returns the matching active user's ID,
 * or `null` for any failure reason — a wrong email and a wrong password are indistinguishable to
 * the caller, so a login-enumeration attack can't tell which one was wrong.
 */
export async function verifyCredentials(email: string, password: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !user.isActive) {
    // Run a hash comparison anyway against a dummy hash so this path takes roughly the same
    // time as the "user exists" path — a basic mitigation against email-enumeration via timing.
    await argon2.hash(password).catch(() => undefined);
    return null;
  }

  const passwordMatches = await argon2.verify(user.passwordHash, password);
  return passwordMatches ? user.id : null;
}

/**
 * Loads the full RBAC context for a user ID, fresh from the database — role, permissions, and
 * site assignments. This is the function `attachUser` middleware calls on every request; there
 * is no caching layer here on purpose (see src/types/express.d.ts for why).
 *
 * Returns `null` if the user doesn't exist or has been deactivated, so an already-issued session
 * cookie for a deactivated user stops working on its very next request.
 */
export async function loadSessionUser(userId: string): Promise<SessionUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      role: {
        include: {
          rolePermissions: { include: { permission: true } },
        },
      },
      siteAssignments: { select: { siteId: true } },
    },
  });

  if (!user || !user.isActive) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    roleCode: user.role.code as RoleCode,
    roleName: user.role.name,
    permissions: user.role.rolePermissions.map(
      (rolePermission) => rolePermission.permission.key as PermissionKey,
    ),
    siteIds: user.siteAssignments.map((assignment) => assignment.siteId),
    themeAccentColor: user.themeAccentColor,
  };
}

export async function touchLastLogin(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
}

/** Self-service profile update — name and/or the per-user Theme accent color (My Profile / Theme). */
export async function updateOwnProfile(userId: string, input: UpdateProfileInput): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.themeAccentColor !== undefined && { themeAccentColor: input.themeAccentColor }),
    },
  });
}

/**
 * Self-service password change — requires proving the current password first (unlike Master
 * Admin's user-management reset, which doesn't, since that path is already gated by
 * `users:manage`). **AUD-009 (Post-Phase-5 Stabilization Checkpoint 3):** every existing session
 * for this user — including the one making this very request — is invalidated once the new
 * password is stored, the same immediate-invalidation guarantee deactivation already provides
 * (docs/architecture/authentication.md). The route handler (`auth.routes.ts`) additionally
 * destroys the current request's own session/cookie so its response reflects that immediately,
 * rather than only on that session's next request.
 */
export async function changeOwnPassword(userId: string, input: ChangePasswordInput): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const currentPasswordMatches = await argon2.verify(user.passwordHash, input.currentPassword);
  if (!currentPasswordMatches) {
    throw badRequest('Current password is incorrect');
  }

  const passwordHash = await argon2.hash(input.newPassword);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  await invalidateAllSessionsForUser(userId);
}
