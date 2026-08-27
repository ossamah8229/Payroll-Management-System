import { Router } from 'express';
import {
  cancelAdvanceSchema,
  createAdvanceSchema,
  deferAdvanceScheduleSchema,
  listAdvancesQuerySchema,
  PERMISSIONS,
  updateAdvanceSchema,
} from '@payroll/shared';
import { requireAuth } from '../../common/middleware/attach-user';
import { requirePermission } from '../../common/middleware/require-permission';
import { badRequest } from '../../common/http-error';
import {
  cancelAdvance,
  createAdvance,
  deferAdvanceSchedule,
  getAdvance,
  listAdvances,
  updateAdvance,
} from './advances.service';

function requireIdParam(id: string | undefined): string {
  if (!id) throw badRequest('id parameter is required');
  return id;
}

/** Mounted at /api/v1/advances (Phase 4 Checkpoint 5). Gated exclusively by `ADVANCES_MANAGE` —
 * Payroll Staff (site-scoped) and Master Admin only. Finance holds no Advances permission
 * (approved architecture decision, unchanged from the frozen permission set). */
export const advancesRouter = Router();

advancesRouter.use(requireAuth);
advancesRouter.use(requirePermission(PERMISSIONS.ADVANCES_MANAGE));

advancesRouter.get('/', async (req, res, next) => {
  try {
    // `siteId` may arrive as a single string or, when the caller selects more than one site,
    // repeated `siteId=` query values that Express parses into an array (v1.0.4 checkpoint — see
    // `listAdvancesQuerySchema`'s own doc comment).
    const rawSiteId = req.query.siteId;
    const siteIds =
      rawSiteId === undefined
        ? undefined
        : Array.isArray(rawSiteId)
          ? rawSiteId.filter((value): value is string => typeof value === 'string')
          : typeof rawSiteId === 'string'
            ? [rawSiteId]
            : undefined;

    const query = listAdvancesQuerySchema.parse({
      employeeId: typeof req.query.employeeId === 'string' ? req.query.employeeId : undefined,
      siteIds,
      type: typeof req.query.type === 'string' ? req.query.type : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      page: typeof req.query.page === 'string' ? req.query.page : undefined,
      pageSize: typeof req.query.pageSize === 'string' ? req.query.pageSize : undefined,
    });
    const result = await listAdvances(req.currentUser!, query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

advancesRouter.get('/:id', async (req, res, next) => {
  try {
    const id = requireIdParam(req.params.id);
    const advance = await getAdvance(req.currentUser!, id);
    res.status(200).json({ advance });
  } catch (error) {
    next(error);
  }
});

advancesRouter.post('/', async (req, res, next) => {
  try {
    const input = createAdvanceSchema.parse(req.body);
    const advance = await createAdvance(req.currentUser!, input, {
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.status(201).json({ advance });
  } catch (error) {
    next(error);
  }
});

advancesRouter.patch('/:id', async (req, res, next) => {
  try {
    const id = requireIdParam(req.params.id);
    const input = updateAdvanceSchema.parse(req.body);
    const advance = await updateAdvance(req.currentUser!, id, input, {
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.status(200).json({ advance });
  } catch (error) {
    next(error);
  }
});

advancesRouter.post('/:id/defer', async (req, res, next) => {
  try {
    const id = requireIdParam(req.params.id);
    const input = deferAdvanceScheduleSchema.parse(req.body);
    const advance = await deferAdvanceSchedule(req.currentUser!, id, input, {
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.status(200).json({ advance });
  } catch (error) {
    next(error);
  }
});

advancesRouter.post('/:id/cancel', async (req, res, next) => {
  try {
    const id = requireIdParam(req.params.id);
    const input = cancelAdvanceSchema.parse(req.body);
    const advance = await cancelAdvance(req.currentUser!, id, input, {
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.status(200).json({ advance });
  } catch (error) {
    next(error);
  }
});
