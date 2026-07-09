import { Router } from 'express';
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

function requireIdParam(id: string | undefined): string {
  if (!id) throw badRequest('id parameter is required');
  return id;
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

payrollCycleEntriesRouter.get('/', requirePermission(PERMISSIONS.PAYROLL_ENTRY), async (req, res, next) => {
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

/** Mounted at /api/v1/payroll-entries and /api/v1/work-lines — individual resources addressed
 * directly by their own id, the same shape as Project Units' PATCH/DELETE routes. */
export const payrollEntriesRouter = Router();

payrollEntriesRouter.use(requireAuth);

payrollEntriesRouter.get('/:id', requirePermission(PERMISSIONS.PAYROLL_ENTRY), async (req, res, next) => {
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
