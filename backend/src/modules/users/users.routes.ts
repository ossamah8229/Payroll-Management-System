import { Router } from 'express';
import { createUserSchema, PERMISSIONS, resetUserPasswordSchema, updateUserSchema } from '@payroll/shared';
import { requireAuth } from '../../common/middleware/attach-user';
import { requirePermission } from '../../common/middleware/require-permission';
import { rotateCsrfCookie } from '../../common/middleware/csrf';
import { badRequest } from '../../common/http-error';
import { recordAuditLog } from '../audit-log/audit-log.service';
import { createUser, getUser, listUsers, resetUserPassword, updateUser } from './users.service';

export const usersRouter = Router();

usersRouter.use(requireAuth, requirePermission(PERMISSIONS.USERS_MANAGE));

function requireIdParam(id: string | undefined): string {
  if (!id) throw badRequest('id parameter is required');
  return id;
}

usersRouter.get('/', async (_req, res, next) => {
  try {
    const users = await listUsers();
    res.status(200).json({ users });
  } catch (error) {
    next(error);
  }
});

usersRouter.get('/:id', async (req, res, next) => {
  try {
    const user = await getUser(requireIdParam(req.params.id));
    res.status(200).json({ user });
  } catch (error) {
    next(error);
  }
});

usersRouter.post('/', async (req, res, next) => {
  try {
    const input = createUserSchema.parse(req.body);
    const user = await createUser(input);

    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'user.created',
      entityType: 'User',
      entityId: user.id,
      metadata: { email: user.email, roleId: input.roleId, roleName: user.role.name },
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    res.status(201).json({ user });
  } catch (error) {
    next(error);
  }
});

usersRouter.patch('/:id', async (req, res, next) => {
  try {
    const id = requireIdParam(req.params.id);
    const input = updateUserSchema.parse(req.body);
    const requestMeta = { ipAddress: req.ip ?? null, userAgent: req.get('user-agent') ?? null };
    const user = await updateUser(req.currentUser!.id, id, input, requestMeta);

    // One audit entry per distinct semantic change present in this request, rather than a single
    // generic "user.updated" blob — `updateUser` (users.service.ts) already writes its own
    // `user.role_changed` entry (with a before/after role snapshot) when `roleId` changes, so this
    // route only covers the fields it alone is responsible for.
    if (input.isActive !== undefined) {
      await recordAuditLog({
        actorUserId: req.currentUser!.id,
        action: input.isActive ? 'user.activated' : 'user.deactivated',
        entityType: 'User',
        entityId: user.id,
        ...requestMeta,
      });
    }
    if (input.siteIds !== undefined) {
      await recordAuditLog({
        actorUserId: req.currentUser!.id,
        action: 'user.sites_changed',
        entityType: 'User',
        entityId: user.id,
        metadata: { siteIds: input.siteIds },
        ...requestMeta,
      });
    }
    if (input.name !== undefined) {
      await recordAuditLog({
        actorUserId: req.currentUser!.id,
        action: 'user.updated',
        entityType: 'User',
        entityId: user.id,
        metadata: { field: 'name' },
        ...requestMeta,
      });
    }

    res.status(200).json({ user });
  } catch (error) {
    next(error);
  }
});

usersRouter.post('/:id/reset-password', async (req, res, next) => {
  try {
    const id = requireIdParam(req.params.id);
    const input = resetUserPasswordSchema.parse(req.body);
    await resetUserPassword(id, input);

    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'user.password-reset',
      entityType: 'User',
      entityId: id,
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    // AUD-009: `resetUserPassword` already deleted every session row for the target user. In the
    // ordinary case the acting Master Admin is resetting someone *else's* password, so the
    // admin's own session (a different row) is untouched and this just responds normally. In the
    // edge case where a Master Admin resets their own account's password, their own current
    // session row was just deleted too — `req.session.destroy()` (same pattern as `/logout` and
    // `/auth/change-password`) clears this request's own cookie so its response reflects that
    // immediately, rather than only on this session's next request. The CSRF token is rotated
    // here too (Checkpoint 4D), same rationale as login/logout/change-password — only in this
    // branch, since only here was the acting user's own session/token just invalidated.
    if (req.currentUser!.id === id) {
      req.session.destroy((error) => {
        if (error) {
          next(error);
          return;
        }
        res.clearCookie('connect.sid');
        rotateCsrfCookie(res);
        res.status(204).send();
      });
      return;
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
