import { Router } from 'express';
import { createUserSchema, PERMISSIONS, resetUserPasswordSchema, updateUserSchema } from '@payroll/shared';
import { requireAuth } from '../../common/middleware/attach-user';
import { requirePermission } from '../../common/middleware/require-permission';
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
      metadata: { email: user.email, roleCode: input.roleCode },
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
    const user = await updateUser(req.currentUser!.id, id, input);

    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'user.updated',
      entityType: 'User',
      entityId: user.id,
      metadata: { changes: input },
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

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

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
