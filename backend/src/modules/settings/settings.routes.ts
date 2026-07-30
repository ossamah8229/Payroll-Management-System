import { Router } from 'express';
import multer from 'multer';
import { PERMISSIONS, updateCompanySettingsSchema } from '@payroll/shared';
import { requireAuth } from '../../common/middleware/attach-user';
import { requirePermission } from '../../common/middleware/require-permission';
import { badRequest } from '../../common/http-error';
import { recordAuditLog } from '../audit-log/audit-log.service';
import { getCompanySettings, serializeCompanySettings, updateCompanySettings } from './settings.service';
import { MAX_LOGO_UPLOAD_BYTES } from '../../lib/image/logo-image.service';
import { removeCompanyLogo, uploadCompanyLogo } from './company-logo.service';

export const settingsRouter = Router();

settingsRouter.use(requireAuth);

// Read access is unrestricted to any authenticated user — company name/address appears
// throughout the app shell and generated documents, not just the Settings page itself.
settingsRouter.get('/company', async (_req, res, next) => {
  try {
    const settings = await getCompanySettings();
    res.status(200).json({ settings: serializeCompanySettings(settings) });
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

      res.status(200).json({ settings: serializeCompanySettings(settings) });
    } catch (error) {
      next(error);
    }
  },
);

// A byte or two above `MAX_LOGO_UPLOAD_BYTES` itself — `logo-image.service.ts`'s own byte-length
// check is still the authoritative 2 MB enforcement; this just keeps multer from ever buffering a
// wildly oversized request body in memory before that check gets a chance to run.
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LOGO_UPLOAD_BYTES + 1024 },
});

settingsRouter.post(
  '/company/logo',
  requirePermission(PERMISSIONS.SETTINGS_MANAGE),
  logoUpload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw badRequest('No file uploaded — expected a multipart field named "file"');
      }

      const settings = await uploadCompanyLogo(req.currentUser!.id, req.file.buffer, {
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });

      res.status(200).json({ settings: serializeCompanySettings(settings) });
    } catch (error) {
      next(error);
    }
  },
);

settingsRouter.delete(
  '/company/logo',
  requirePermission(PERMISSIONS.SETTINGS_MANAGE),
  async (req, res, next) => {
    try {
      const settings = await removeCompanyLogo(req.currentUser!.id, {
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });

      res.status(200).json({ settings: serializeCompanySettings(settings) });
    } catch (error) {
      next(error);
    }
  },
);
