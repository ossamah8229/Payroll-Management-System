import { Router } from 'express';
import { createBankSchema, PERMISSIONS, updateBankSchema } from '@payroll/shared';
import { requireAuth } from '../../common/middleware/attach-user';
import { requirePermission } from '../../common/middleware/require-permission';
import { badRequest, forbidden } from '../../common/http-error';
import { recordAuditLog } from '../audit-log/audit-log.service';
import { createBank, deleteBank, listBanks, updateBank } from './banks.service';

function requireIdParam(id: string | undefined): string {
  if (!id) throw badRequest('id parameter is required');
  return id;
}

/**
 * Bank Registry (Phase 4 Checkpoint 1). `GET /` stays open to any authenticated user for its
 * default, active-only result — unchanged from before this checkpoint, since Employee Registry and
 * Payroll Entry dropdowns already depend on it. Only `?includeInactive=true` (the Bank Registry
 * admin screen, Settings → Banks) requires `banks:manage`, checked here rather than via
 * `requirePermission` middleware since it's conditional on a query param, not the whole route.
 */
export const banksRouter = Router();

banksRouter.use(requireAuth);

banksRouter.get('/', async (req, res, next) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';

    if (includeInactive && !req.currentUser!.permissions.includes(PERMISSIONS.BANKS_MANAGE)) {
      throw forbidden(`Missing required permission: ${PERMISSIONS.BANKS_MANAGE}`);
    }

    const banks = await listBanks({ includeInactive });
    res.status(200).json({ banks });
  } catch (error) {
    next(error);
  }
});

banksRouter.post('/', requirePermission(PERMISSIONS.BANKS_MANAGE), async (req, res, next) => {
  try {
    const input = createBankSchema.parse(req.body);
    const bank = await createBank(input);

    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'bank.created',
      entityType: 'Bank',
      entityId: bank.id,
      metadata: { code: bank.code, name: bank.name },
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    res.status(201).json({ bank });
  } catch (error) {
    next(error);
  }
});

banksRouter.patch('/:id', requirePermission(PERMISSIONS.BANKS_MANAGE), async (req, res, next) => {
  try {
    const input = updateBankSchema.parse(req.body);
    const bank = await updateBank(requireIdParam(req.params.id), input);

    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'bank.updated',
      entityType: 'Bank',
      entityId: bank.id,
      metadata: { changes: input },
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    res.status(200).json({ bank });
  } catch (error) {
    next(error);
  }
});

banksRouter.delete('/:id', requirePermission(PERMISSIONS.BANKS_MANAGE), async (req, res, next) => {
  try {
    const id = requireIdParam(req.params.id);
    await deleteBank(id);

    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'bank.deleted',
      entityType: 'Bank',
      entityId: id,
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
