import { Router } from 'express';
import { PERMISSIONS } from '@payroll/shared';
import { requireAuth } from '../../common/middleware/attach-user';
import { requirePermission } from '../../common/middleware/require-permission';
import { badRequest, notFound } from '../../common/http-error';
import { logger } from '../../lib/logger';
import { recordAuditLog } from '../audit-log/audit-log.service';
import { storageProvider } from '../../lib/storage';
import { StorageNotFoundError } from '../../lib/storage/errors';
import {
  generateBackupPackage,
  getBackupPackage,
  getBackupPackageFile,
  listBackupPackages,
} from './backup-packages.service';

function requireIdParam(id: string | undefined): string {
  if (!id) throw badRequest('id parameter is required');
  return id;
}

/** `BigInt` fields (`sizeBytes`/`totalSizeBytes`) cannot be JSON-serialized by `res.json()`
 * directly — converted to string here, the one place any Backup Package response crosses the HTTP
 * boundary, rather than at every call site. **Also the one place `storageKey` is stripped from a
 * file entry before it ever reaches a client** — list/detail must never expose it (this
 * checkpoint's own explicit requirement: every download is resolved server-side through the
 * file's own `id`, never a client-supplied or client-visible raw key). The download route itself
 * never sends this serializer's output at all (it streams bytes), so this is the single place that
 * needs to guard against the leak. */
function serializeBackupPackage(backupPackage: {
  totalSizeBytes: bigint | null;
  files: { sizeBytes: bigint; storageKey: string; [key: string]: unknown }[];
  [key: string]: unknown;
}) {
  return {
    ...backupPackage,
    totalSizeBytes: backupPackage.totalSizeBytes?.toString() ?? null,
    files: backupPackage.files.map(({ storageKey: _storageKey, ...file }) => ({
      ...file,
      sizeBytes: file.sizeBytes.toString(),
    })),
  };
}

/** Filenames stored on `BackupPackageFile` are always one of five fixed, server-generated values
 * (`manifest.json`, `payroll-entry.csv`, etc. — never derived from user input, unlike a Payslip's
 * employee-name-derived filename) — this quoting is defense-in-depth, not a response to any actual
 * untrusted input. */
function contentDispositionFilename(filename: string): string {
  return filename.replace(/"/g, '');
}

/** Mounted at /api/v1/payroll-cycles/:cycleId/backup-packages (Phase 5 Checkpoint 2). Reuses
 * `payroll-cycle:manage` — the same permission Finalize Cycle and cycle creation already use, all
 * three being the same class of system-lifecycle action, Master-Admin-only by this codebase's own
 * role grants (least privilege: no business need yet for Finance/Payroll Staff to trigger or
 * download a disaster-recovery artifact). Mounted ahead of payrollCyclesRouter's own /:id route,
 * same reasoning as every other :cycleId-scoped sub-router before it. */
export const backupPackagesRouter = Router({ mergeParams: true });

backupPackagesRouter.use(requireAuth);

backupPackagesRouter.post(
  '/',
  requirePermission(PERMISSIONS.PAYROLL_CYCLE_MANAGE),
  async (req, res, next) => {
    try {
      const cycleId = requireIdParam(req.params.cycleId);
      // generateBackupPackage owns its own audit logging inside its final transaction (success)
      // and its own failure path (failure) — the route never logs a second, redundant entry.
      const backupPackage = await generateBackupPackage(req.currentUser!, cycleId, {
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });

      res.status(201).json({ backupPackage: serializeBackupPackage(backupPackage) });
    } catch (error) {
      next(error);
    }
  },
);

backupPackagesRouter.get('/', requirePermission(PERMISSIONS.PAYROLL_CYCLE_MANAGE), async (req, res, next) => {
  try {
    const cycleId = requireIdParam(req.params.cycleId);
    const backupPackages = await listBackupPackages(cycleId);
    res.status(200).json({ backupPackages: backupPackages.map(serializeBackupPackage) });
  } catch (error) {
    next(error);
  }
});

/** Mounted at /api/v1/backup-packages — the id-scoped detail/download routes, not nested under a
 * cycle (a package/file is looked up by its own id; the cycle it belongs to is inherent in the
 * returned record, not part of the URL). Same permission/authorization as the cycle-scoped router
 * above. */
export const backupPackageDetailRouter = Router();

backupPackageDetailRouter.use(requireAuth);

backupPackageDetailRouter.get('/:id', requirePermission(PERMISSIONS.PAYROLL_CYCLE_MANAGE), async (req, res, next) => {
  try {
    const id = requireIdParam(req.params.id);
    const backupPackage = await getBackupPackage(id);
    res.status(200).json({ backupPackage: serializeBackupPackage(backupPackage) });
  } catch (error) {
    next(error);
  }
});

/** Every download is authorized and resolved through this `BackupPackageFile` row's own `id` —
 * the client never supplies or sees a raw `storageKey` (this checkpoint's own explicit
 * requirement). A missing storage object behind a `READY` row's own key is corrupted state (see
 * this checkpoint's architecture review §9) — translated to the same generic 404 a nonexistent
 * file id gets, never a 500 leaking storage internals. */
backupPackageDetailRouter.get(
  '/files/:fileId',
  requirePermission(PERMISSIONS.PAYROLL_CYCLE_MANAGE),
  async (req, res, next) => {
    try {
      const fileId = requireIdParam(req.params.fileId);
      const file = await getBackupPackageFile(fileId);

      let stream;
      try {
        stream = await storageProvider.createReadStream(file.storageKey);
      } catch (error) {
        if (error instanceof StorageNotFoundError) {
          logger.error(
            { backupPackageFileId: file.id, backupPackageId: file.backupPackageId },
            'Backup Package file download: storage object missing for a READY package — corrupted state',
          );
          throw notFound('Backup package file not found');
        }
        throw error;
      }

      await recordAuditLog({
        actorUserId: req.currentUser!.id,
        action: 'backup_package.file_downloaded',
        entityType: 'BackupPackageFile',
        entityId: file.id,
        metadata: { backupPackageId: file.backupPackageId, fileType: file.fileType, filename: file.filename },
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', file.contentType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${contentDispositionFilename(file.filename)}"`,
      );
      stream.on('error', (streamError) => {
        logger.error(
          { streamError, backupPackageFileId: file.id },
          'Backup Package file download: stream error after headers were already sent',
        );
        res.destroy();
      });
      stream.pipe(res);
    } catch (error) {
      next(error);
    }
  },
);
