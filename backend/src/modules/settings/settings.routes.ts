import { Router } from 'express';
import { PERMISSIONS, updateCompanySettingsSchema } from '@payroll/shared';
import { requireAuth } from '../../common/middleware/attach-user';
import { requirePermission } from '../../common/middleware/require-permission';
import { recordAuditLog } from '../audit-log/audit-log.service';
import { getCompanySettings, updateCompanySettings } from './settings.service';

export const settingsRouter = Router();

settingsRouter.use(requireAuth);

// Read access is unrestricted to any authenticated user — company name/address appears
// throughout the app shell and generated documents, not just the Settings page itself.
settingsRouter.get('/company', async (_req, res, next) => {
  try {
    const settings = await getCompanySettings();
    res.status(200).json({ settings });
  } catch (error) {
    next(error);
  }
});

settingsRouter.patch(
  '/company',
  requirePermission(PERMISSIONS.SETTINGS_MANAGE),
  async (req, res, next) => {
    try {
      const input = updateCompanySettingsSchema.parse(req.body);
      const settings = await updateCompanySettings(req.currentUser!.id, input);

      await recordAuditLog({
        actorUserId: req.currentUser!.id,
        action: 'company-settings.updated',
        entityType: 'CompanySettings',
        entityId: settings.id,
        metadata: { changes: input },
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });

      res.status(200).json({ settings });
    } catch (error) {
      next(error);
    }
  },
);
