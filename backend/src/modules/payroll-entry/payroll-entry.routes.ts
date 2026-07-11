import { Router } from 'express';
import multer from 'multer';
import {
  addWorkLineSchema,
  bulkUpdatePayrollEntriesSchema,
  createPayrollEntrySchema,
  PERMISSIONS,
  updatePayrollEntrySchema,
  updateWorkLineSchema,
} from '@payroll/shared';
import { requireAuth } from '../../common/middleware/attach-user';
import { requirePermission } from '../../common/middleware/require-permission';
import { badRequest } from '../../common/http-error';
import { recordAuditLog } from '../audit-log/audit-log.service';
import {
  addWorkLine,
  bulkUpdatePayrollEntries,
  createPayrollEntry,
  deletePayrollEntry,
  deleteWorkLine,
  getPayrollEntry,
  listPayrollEntries,
  updatePayrollEntry,
  updateWorkLine,
} from './payroll-entry.service';
import {
  exportPayrollEntriesToCsv,
  exportPayrollEntriesToXlsx,
  importPayrollEntries,
  parsePayrollEntryImportFile,
} from './payroll-entry-import-export.service';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function requireIdParam(id: string | undefined): string {
  if (!id) throw badRequest('id parameter is required');
  return id;
}

function parseSiteIdsQuery(raw: unknown): string[] | undefined {
  if (!raw) return undefined;
  const values = Array.isArray(raw) ? raw : [raw];
  return values.flatMap((value) => String(value).split(',')).filter(Boolean);
}

function requireVersionQuery(raw: unknown): number {
  const version = Number(raw);
  if (!Number.isInteger(version)) {
    throw badRequest('A numeric ?version= query parameter is required for this action');
  }
  return version;
}

/** Mounted at /api/v1/payroll-cycles/:cycleId/entries — list/create are nested under a cycle,
 * the same shape as Project Units nesting under a Project Site. */
export const payrollCycleEntriesRouter = Router({ mergeParams: true });

payrollCycleEntriesRouter.use(requireAuth);

// View access is shared with Finance (read-only, Phase 4 Checkpoint 2) via `payroll:view` —
// Payroll Staff's own `payroll:entry` grant already implies view, so both are accepted here.
const VIEW_PERMISSIONS = [PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.PAYROLL_VIEW];

payrollCycleEntriesRouter.get('/', requirePermission(VIEW_PERMISSIONS), async (req, res, next) => {
  try {
    const cycleId = requireIdParam(req.params.cycleId);
    const page = req.query.page ? Number(req.query.page) : undefined;
    const pageSize = req.query.pageSize ? Number(req.query.pageSize) : undefined;
    const result = await listPayrollEntries(req.currentUser!, {
      cycleId,
      siteId: typeof req.query.siteId === 'string' ? req.query.siteId : undefined,
      employeeId: typeof req.query.employeeId === 'string' ? req.query.employeeId : undefined,
      page,
      pageSize,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

payrollCycleEntriesRouter.post('/', requirePermission(PERMISSIONS.PAYROLL_ENTRY), async (req, res, next) => {
  try {
    const cycleId = requireIdParam(req.params.cycleId);
    const input = createPayrollEntrySchema.parse(req.body);
    // createPayrollEntry owns its own audit logging inside the create transaction.
    const entry = await createPayrollEntry(req.currentUser!, cycleId, input, {
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.status(201).json({ entry });
  } catch (error) {
    next(error);
  }
});

/** "Copy to All" (Phase 3 Checkpoint 4) — one bulk request, never a loop of individual PATCHes
 * (`database/schema-invariants.md` §23). Nested under the same cycle-scoped router as list/create
 * above, since it's another cycle-scoped Payroll Entry action, not a standalone resource. */
payrollCycleEntriesRouter.patch(
  '/bulk',
  requirePermission(PERMISSIONS.PAYROLL_ENTRY),
  async (req, res, next) => {
    try {
      const cycleId = requireIdParam(req.params.cycleId);
      const input = bulkUpdatePayrollEntriesSchema.parse(req.body);
      // bulkUpdatePayrollEntries owns its own single summary audit entry inside its transaction.
      const result = await bulkUpdatePayrollEntries(req.currentUser!, cycleId, input, {
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },
);

/** Payroll Entry CSV/Excel export (Phase 3 Checkpoint 5) — "export what's on screen," the same
 * `siteIds` filter shape Employee Registry's export already uses. Gated on the one `payroll:entry`
 * permission that already governs every other action on this router — no new permission
 * introduced. Writes its own summary `AuditLog` entry (unlike Employee Registry's export, which
 * doesn't — an explicit, approved deviation from that precedent for this checkpoint specifically). */
payrollCycleEntriesRouter.get(
  '/export',
  requirePermission(PERMISSIONS.PAYROLL_ENTRY),
  async (req, res, next) => {
    try {
      const cycleId = requireIdParam(req.params.cycleId);
      const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';
      const siteIds = parseSiteIdsQuery(req.query.siteIds);

      const { buffer, rowCount } =
        format === 'xlsx'
          ? await exportPayrollEntriesToXlsx(req.currentUser!, cycleId, siteIds)
          : await exportPayrollEntriesToCsv(req.currentUser!, cycleId, siteIds);

      await recordAuditLog({
        actorUserId: req.currentUser!.id,
        action: 'payroll_entry.export',
        entityType: 'PayrollEntry',
        metadata: { cycleId, siteIds: siteIds ?? null, format, rowCount },
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });

      const filename = `payroll-entry.${format}`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader(
        'Content-Type',
        format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv',
      );
      res.status(200).send(buffer);
    } catch (error) {
      next(error);
    }
  },
);

/** Payroll Entry CSV/Excel import (Phase 3 Checkpoint 5) — **update-only** (never creates a
 * `PayrollEntry`/`PayrollEntryWorkLine`, per the approved architecture); `importPayrollEntries`
 * owns all per-row validation/authorization/editability checks and reports a per-row result. This
 * route owns the one summary `AuditLog` entry for the whole operation, mirroring Employee
 * Registry's `employee.import` precedent exactly. */
payrollCycleEntriesRouter.post(
  '/import',
  requirePermission(PERMISSIONS.PAYROLL_ENTRY),
  upload.single('file'),
  async (req, res, next) => {
    try {
      const cycleId = requireIdParam(req.params.cycleId);
      if (!req.file) {
        throw badRequest('No file uploaded — expected a multipart field named "file"');
      }

      const rows = await parsePayrollEntryImportFile(req.file.buffer, req.file.originalname);
      const result = await importPayrollEntries(req.currentUser!, cycleId, rows);

      await recordAuditLog({
        actorUserId: req.currentUser!.id,
        action: 'payroll_entry.import',
        entityType: 'PayrollEntry',
        metadata: { cycleId, updated: result.updated, skippedCount: result.skipped.length },
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },
);

/** Mounted at /api/v1/payroll-entries and /api/v1/work-lines — individual resources addressed
 * directly by their own id, the same shape as Project Units' PATCH/DELETE routes. */
export const payrollEntriesRouter = Router();

payrollEntriesRouter.use(requireAuth);

payrollEntriesRouter.get('/:id', requirePermission(VIEW_PERMISSIONS), async (req, res, next) => {
  try {
    const entry = await getPayrollEntry(req.currentUser!, requireIdParam(req.params.id));
    res.status(200).json({ entry });
  } catch (error) {
    next(error);
  }
});

payrollEntriesRouter.patch('/:id', requirePermission(PERMISSIONS.PAYROLL_ENTRY), async (req, res, next) => {
  try {
    const id = requireIdParam(req.params.id);
    const input = updatePayrollEntrySchema.parse(req.body);
    const entry = await updatePayrollEntry(req.currentUser!, id, input, {
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.status(200).json({ entry });
  } catch (error) {
    next(error);
  }
});

payrollEntriesRouter.delete('/:id', requirePermission(PERMISSIONS.PAYROLL_ENTRY), async (req, res, next) => {
  try {
    const id = requireIdParam(req.params.id);
    const version = requireVersionQuery(req.query.version);
    await deletePayrollEntry(req.currentUser!, id, version, {
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

payrollEntriesRouter.post(
  '/:id/work-lines',
  requirePermission(PERMISSIONS.PAYROLL_ENTRY),
  async (req, res, next) => {
    try {
      const entryId = requireIdParam(req.params.id);
      const input = addWorkLineSchema.parse(req.body);
      const entry = await addWorkLine(req.currentUser!, entryId, input, {
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });
      res.status(201).json({ entry });
    } catch (error) {
      next(error);
    }
  },
);

/** Mounted at /api/v1/work-lines/:id — addressed directly, mirroring how PayrollEntry itself is
 * addressed directly for PATCH/DELETE regardless of which entry it belongs to. */
export const workLinesRouter = Router();

workLinesRouter.use(requireAuth);

workLinesRouter.patch('/:id', requirePermission(PERMISSIONS.PAYROLL_ENTRY), async (req, res, next) => {
  try {
    const id = requireIdParam(req.params.id);
    const input = updateWorkLineSchema.parse(req.body);
    const entry = await updateWorkLine(req.currentUser!, id, input, {
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.status(200).json({ entry });
  } catch (error) {
    next(error);
  }
});

workLinesRouter.delete('/:id', requirePermission(PERMISSIONS.PAYROLL_ENTRY), async (req, res, next) => {
  try {
    const id = requireIdParam(req.params.id);
    const version = requireVersionQuery(req.query.version);
    const entry = await deleteWorkLine(req.currentUser!, id, version, {
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.status(200).json({ entry });
  } catch (error) {
    next(error);
  }
});
