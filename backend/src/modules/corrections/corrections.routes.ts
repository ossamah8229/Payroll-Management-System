import { Router } from 'express';
import {
  approveCorrectionRequestSchema,
  createCorrectionRequestSchema,
  listBalanceAdjustmentsQuerySchema,
  listCorrectionRequestsQuerySchema,
  materializeBalanceAdjustmentSchema,
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
  listBalanceAdjustmentsForUser,
  listSettlementsForAdjustment,
  previewSettlement,
  recordBalanceAdjustmentSettlement,
  recordCorrectionPayment,
} from './corrections.settlement.service';
import {
  getBalanceAdjustmentMaterializations,
  materializeBalanceAdjustment,
  materializeEligibleAdjustmentsForCycle,
  previewMaterialization,
} from './corrections.materialization.service';

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
 *
 * Phase 6 Checkpoint 5 adds materialization preview/recording/listing on `balanceAdjustmentsRouter`
 * (one adjustment at a time) plus `payrollCycleMaterializationsRouter` (the batch "materialize
 * every eligible adjustment into this Draft cycle" action, cycle-scoped since it isn't about one
 * already-known adjustment id). No frontend, no Corrections Ledger — unchanged from Checkpoint 4's
 * own scope boundary.
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

/** Mounted at /api/v1/correction-requests (Phase 6 Checkpoint 3; list/detail access widened
 * Presentation & Workflow Stabilization Checkpoint, 2026-07-25) — list and detail are
 * `ENTRY_VIEW_PERMISSIONS`-gated (`payroll:entry` or `corrections:approve`), the same "view" vs.
 * "decide" split every other dual-permission route in this router already uses: a requester
 * (`payroll:entry` only) may list and open exactly the requests they themselves submitted (the
 * "My Requests" view — see `listCorrectionRequestsForUser`/`getCorrectionRequestDetail` in
 * `corrections.service.ts` for the self-scoping this depends on), never anyone else's. Approve and
 * reject remain `corrections:approve`-only, explicitly re-asserted per-route below rather than
 * relying on the (now widened) router-level gate — this is the one boundary the brief is explicit
 * about never widening: "Do not grant approval rights." */
export const correctionRequestsRouter = Router();

correctionRequestsRouter.use(requireAuth);
correctionRequestsRouter.use(requirePermission(ENTRY_VIEW_PERMISSIONS));

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

correctionRequestsRouter.post(
  '/:id/approve',
  requirePermission(PERMISSIONS.CORRECTIONS_APPROVE),
  async (req, res, next) => {
    try {
      const id = requireIdParam(req.params.id);
      const input = approveCorrectionRequestSchema.parse(req.body);
      const result = await approveCorrectionRequest(req.currentUser!, id, input, requestMetaFrom(req));
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },
);

correctionRequestsRouter.post(
  '/:id/reject',
  requirePermission(PERMISSIONS.CORRECTIONS_APPROVE),
  async (req, res, next) => {
    try {
      const id = requireIdParam(req.params.id);
      const input = rejectCorrectionRequestSchema.parse(req.body);
      const correctionRequest = await rejectCorrectionRequest(req.currentUser!, id, input, requestMetaFrom(req));
      res.status(200).json({ correctionRequest });
    } catch (error) {
      next(error);
    }
  },
);

// A viewer (Payroll Staff, `payroll:entry`) may check outstanding-balance detail or preview a
// settlement; only the Master User (`corrections:approve`) may actually record one — mirroring
// `ENTRY_VIEW_PERMISSIONS`'s own dual-permission convention above ("view" vs. "decide").
const BALANCE_VIEW_PERMISSIONS = [PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.CORRECTIONS_APPROVE];

/** Mounted at /api/v1/balance-adjustments (Phase 6 Checkpoint 4) — outstanding-balance reads and
 * settlement preview/recording, one `BalanceAdjustment` id at a time. No new permission key —
 * reuses `payroll:entry`/`corrections:approve` exactly as `correctionRequestsRouter` above does. */
export const balanceAdjustmentsRouter = Router();

balanceAdjustmentsRouter.use(requireAuth);

/** Phase 6 Checkpoint 6 — the Corrections Ledger's own list route. Mounted ahead of `/:id` below
 * only in source order for readability; Express already distinguishes the exact `/` path from
 * `/:id` regardless of declaration order. */
balanceAdjustmentsRouter.get('/', requirePermission(BALANCE_VIEW_PERMISSIONS), async (req, res, next) => {
  try {
    const query = listBalanceAdjustmentsQuerySchema.parse({
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      type: typeof req.query.type === 'string' ? req.query.type : undefined,
      employeeId: typeof req.query.employeeId === 'string' ? req.query.employeeId : undefined,
    });
    const balanceAdjustments = await listBalanceAdjustmentsForUser(req.currentUser!, query);
    res.status(200).json({ balanceAdjustments });
  } catch (error) {
    next(error);
  }
});

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

// --- Phase 6 Checkpoint 5: Draft-cycle materialization -------------------------------------------

balanceAdjustmentsRouter.get(
  '/:id/materializations',
  requirePermission(BALANCE_VIEW_PERMISSIONS),
  async (req, res, next) => {
    try {
      const id = requireIdParam(req.params.id);
      const materializations = await getBalanceAdjustmentMaterializations(req.currentUser!, id);
      res.status(200).json({ materializations });
    } catch (error) {
      next(error);
    }
  },
);

balanceAdjustmentsRouter.post(
  '/:id/materializations/preview',
  requirePermission(BALANCE_VIEW_PERMISSIONS),
  async (req, res, next) => {
    try {
      const id = requireIdParam(req.params.id);
      const input = materializeBalanceAdjustmentSchema.parse(req.body);
      const preview = await previewMaterialization(req.currentUser!, id, input.targetCycleId);
      res.status(200).json({ preview });
    } catch (error) {
      next(error);
    }
  },
);

balanceAdjustmentsRouter.post(
  '/:id/materializations',
  requirePermission(PERMISSIONS.CORRECTIONS_APPROVE),
  async (req, res, next) => {
    try {
      const id = requireIdParam(req.params.id);
      const input = materializeBalanceAdjustmentSchema.parse(req.body);
      const result = await materializeBalanceAdjustment(req.currentUser!, id, input.targetCycleId, requestMetaFrom(req));
      res.status(201).json({ result });
    } catch (error) {
      next(error);
    }
  },
);

/** Mounted at /api/v1/payroll-cycles/:cycleId (Phase 6 Checkpoint 5) — the batch materialization
 * action, cycle-scoped since it isn't about one already-known BalanceAdjustment id. Kept in this
 * module (not payroll-processing.routes.ts) since it's a correction-domain concern, mounted
 * separately alongside every other :cycleId-nested router already registered in app.ts. */
export const payrollCycleMaterializationsRouter = Router({ mergeParams: true });

payrollCycleMaterializationsRouter.use(requireAuth);

payrollCycleMaterializationsRouter.post(
  '/',
  requirePermission(PERMISSIONS.CORRECTIONS_APPROVE),
  async (req, res, next) => {
    try {
      const cycleId = requireIdParam(req.params.cycleId);
      const summary = await materializeEligibleAdjustmentsForCycle(req.currentUser!, cycleId, requestMetaFrom(req));
      res.status(200).json({ summary });
    } catch (error) {
      next(error);
    }
  },
);
