import { Router } from 'express';
import {
  approveCorrectionRequestSchema,
  createCorrectionRequestSchema,
  listCorrectionRequestsQuerySchema,
  PERMISSIONS,
  previewCorrectionSchema,
  previewSettlementSchema,
  recordBalanceAdjustmentSettlementSchema,
  recordCorrectionPaymentSchema,
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
import {
  getBalanceAdjustmentDetail,
  listSettlementsForAdjustment,
  previewSettlement,
  recordBalanceAdjustmentSettlement,
  recordCorrectionPayment,
} from './corrections.settlement.service';

/**
 * Phase 6 Checkpoint 3 API surface — exactly the route capabilities this checkpoint's own brief
 * lists (create, list, detail, preview, approve, reject) plus the entry-scoped correction-history
 * route the Architecture Review's own route table specifies. No "direct correction" route (see
 * `corrections.service.ts`'s own module comment — deliberately deferred).
 *
 * Phase 6 Checkpoint 4 adds `balanceAdjustmentsRouter`, below — settlement preview/recording and
 * outstanding-balance reads. No general "list all BalanceAdjustments" browse route — that is the
 * Corrections Ledger, explicitly out of this checkpoint's scope; every route here operates on one
 * already-known `BalanceAdjustment` id.
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

// A viewer (Payroll Staff, `payroll:entry`) may check outstanding-balance detail or preview a
// settlement; only the Master User (`corrections:approve`) may actually record one — mirroring
// `ENTRY_VIEW_PERMISSIONS`'s own dual-permission convention above ("view" vs. "decide").
const BALANCE_VIEW_PERMISSIONS = [PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.CORRECTIONS_APPROVE];

/** Mounted at /api/v1/balance-adjustments (Phase 6 Checkpoint 4) — outstanding-balance reads and
 * settlement preview/recording, one `BalanceAdjustment` id at a time. No new permission key —
 * reuses `payroll:entry`/`corrections:approve` exactly as `correctionRequestsRouter` above does. */
export const balanceAdjustmentsRouter = Router();

balanceAdjustmentsRouter.use(requireAuth);

balanceAdjustmentsRouter.get('/:id', requirePermission(BALANCE_VIEW_PERMISSIONS), async (req, res, next) => {
  try {
    const id = requireIdParam(req.params.id);
    const balanceAdjustment = await getBalanceAdjustmentDetail(req.currentUser!, id);
    res.status(200).json({ balanceAdjustment });
  } catch (error) {
    next(error);
  }
});

balanceAdjustmentsRouter.get('/:id/settlements', requirePermission(BALANCE_VIEW_PERMISSIONS), async (req, res, next) => {
  try {
    const id = requireIdParam(req.params.id);
    const settlements = await listSettlementsForAdjustment(req.currentUser!, id);
    res.status(200).json({ settlements });
  } catch (error) {
    next(error);
  }
});

balanceAdjustmentsRouter.post(
  '/:id/settlements/preview',
  requirePermission(BALANCE_VIEW_PERMISSIONS),
  async (req, res, next) => {
    try {
      const id = requireIdParam(req.params.id);
      const input = previewSettlementSchema.parse(req.body);
      const preview = await previewSettlement(req.currentUser!, id, input);
      res.status(200).json({ preview });
    } catch (error) {
      next(error);
    }
  },
);

balanceAdjustmentsRouter.post(
  '/:id/settlements',
  requirePermission(PERMISSIONS.CORRECTIONS_APPROVE),
  async (req, res, next) => {
    try {
      const id = requireIdParam(req.params.id);
      const input = recordBalanceAdjustmentSettlementSchema.parse(req.body);
      const result = await recordBalanceAdjustmentSettlement(req.currentUser!, id, input, requestMetaFrom(req));
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

balanceAdjustmentsRouter.post('/:id/payments', requirePermission(PERMISSIONS.CORRECTIONS_APPROVE), async (req, res, next) => {
  try {
    const id = requireIdParam(req.params.id);
    const input = recordCorrectionPaymentSchema.parse(req.body);
    const result = await recordCorrectionPayment(req.currentUser!, id, input, requestMetaFrom(req));
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});
