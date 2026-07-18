import { Router } from 'express';
import {
  approveCorrectionRequestSchema,
  createCorrectionRequestSchema,
  listCorrectionRequestsQuerySchema,
  PERMISSIONS,
  previewCorrectionSchema,
  rejectCorrectionRequestSchema,
} from '@payroll/shared';
import { requireAuth } from '../../common/middleware/attach-user';
import { requirePermission } from '../../common/middleware/require-permission';
import { badRequest } from '../../common/http-error';
import {
  approveCorrectionRequest,
  createCorrectionRequest,
  getCorrectionHistoryForEntry,
  getCorrectionRequestDetail,
  listCorrectionRequestsForUser,
  previewCorrectionForEntry,
  rejectCorrectionRequest,
} from './corrections.service';

/**
 * Phase 6 Checkpoint 3 API surface — exactly the route capabilities this checkpoint's own brief
 * lists (create, list, detail, preview, approve, reject) plus the entry-scoped correction-history
 * route the Architecture Review's own route table specifies. No "direct correction" route (see
 * `corrections.service.ts`'s own module comment — deliberately deferred), no balance-adjustment
 * listing/detail/settlement routes (Checkpoint 3 creates `BalanceAdjustment` rows but does not
 * expose a ledger view over them yet — that's the Corrections Ledger, explicitly out of scope).
 */

function requireIdParam(id: string | undefined): string {
  if (!id) throw badRequest('id parameter is required');
  return id;
}

const requestMetaFrom = (req: { ip?: string; get: (name: string) => string | undefined }) => ({
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

// A requester (Payroll Staff, `payroll:entry`) may create a request or preview a correction; only
// the Master User (`corrections:approve`) may see approved history — matching the Architecture
// Review's own route table exactly ("payroll:entry or corrections:approve").
const ENTRY_VIEW_PERMISSIONS = [PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.CORRECTIONS_APPROVE];

/** Mounted at /api/v1/payroll-entries/:entryId (Phase 6 Checkpoint 3) — entry-scoped correction
 * actions: propose a request, preview a would-be correction, and view the approved history. */
export const payrollEntryCorrectionsRouter = Router({ mergeParams: true });

payrollEntryCorrectionsRouter.use(requireAuth);

payrollEntryCorrectionsRouter.get(
  '/corrections',
  requirePermission(ENTRY_VIEW_PERMISSIONS),
  async (req, res, next) => {
    try {
      const entryId = requireIdParam(req.params.entryId);
      const corrections = await getCorrectionHistoryForEntry(req.currentUser!, entryId);
      res.status(200).json({ corrections });
    } catch (error) {
      next(error);
    }
  },
);

payrollEntryCorrectionsRouter.post(
  '/corrections/preview',
  requirePermission(ENTRY_VIEW_PERMISSIONS),
  async (req, res, next) => {
    try {
      const entryId = requireIdParam(req.params.entryId);
      const input = previewCorrectionSchema.parse(req.body);
      const preview = await previewCorrectionForEntry(req.currentUser!, entryId, input);
      res.status(200).json({ preview });
    } catch (error) {
      next(error);
    }
  },
);

payrollEntryCorrectionsRouter.post(
  '/correction-requests',
  requirePermission(PERMISSIONS.PAYROLL_ENTRY),
  async (req, res, next) => {
    try {
      const entryId = requireIdParam(req.params.entryId);
      const input = createCorrectionRequestSchema.parse(req.body);
      const correctionRequest = await createCorrectionRequest(req.currentUser!, entryId, input, requestMetaFrom(req));
      res.status(201).json({ correctionRequest });
    } catch (error) {
      next(error);
    }
  },
);

/** Mounted at /api/v1/correction-requests (Phase 6 Checkpoint 3) — the Master User's review
 * queue: list, detail, approve, reject. Every route here is `corrections:approve`-gated, matching
 * the Architecture Review's own route table (Master Admin only, today). */
export const correctionRequestsRouter = Router();

correctionRequestsRouter.use(requireAuth);
correctionRequestsRouter.use(requirePermission(PERMISSIONS.CORRECTIONS_APPROVE));

correctionRequestsRouter.get('/', async (req, res, next) => {
  try {
    const query = listCorrectionRequestsQuerySchema.parse({
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      payrollEntryId: typeof req.query.payrollEntryId === 'string' ? req.query.payrollEntryId : undefined,
    });
    const correctionRequests = await listCorrectionRequestsForUser(req.currentUser!, query);
    res.status(200).json({ correctionRequests });
  } catch (error) {
    next(error);
  }
});

correctionRequestsRouter.get('/:id', async (req, res, next) => {
  try {
    const id = requireIdParam(req.params.id);
    const correctionRequest = await getCorrectionRequestDetail(req.currentUser!, id);
    res.status(200).json({ correctionRequest });
  } catch (error) {
    next(error);
  }
});

correctionRequestsRouter.post('/:id/approve', async (req, res, next) => {
  try {
    const id = requireIdParam(req.params.id);
    const input = approveCorrectionRequestSchema.parse(req.body);
    const result = await approveCorrectionRequest(req.currentUser!, id, input, requestMetaFrom(req));
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

correctionRequestsRouter.post('/:id/reject', async (req, res, next) => {
  try {
    const id = requireIdParam(req.params.id);
    const input = rejectCorrectionRequestSchema.parse(req.body);
    const correctionRequest = await rejectCorrectionRequest(req.currentUser!, id, input, requestMetaFrom(req));
    res.status(200).json({ correctionRequest });
  } catch (error) {
    next(error);
  }
});
