import { Router } from 'express';
import { PERMISSIONS } from '@payroll/shared';
import { requireAuth } from '../../common/middleware/attach-user';
import { requirePermission } from '../../common/middleware/require-permission';
import { listAdjustmentTypes } from './adjustment-types.service';

/**
 * Phase 6 Checkpoint 6 — read-only lookup route for the Corrections frontend (request-creation
 * form's Adjustment Type dropdown). Gated on the same two permissions the rest of the corrections
 * domain already uses for "may see corrections-related data" (`corrections.routes.ts`'s own
 * `ENTRY_VIEW_PERMISSIONS`) — no new permission key.
 */
export const adjustmentTypesRouter = Router();

adjustmentTypesRouter.use(requireAuth);

adjustmentTypesRouter.get(
  '/',
  requirePermission([PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.CORRECTIONS_APPROVE]),
  async (_req, res, next) => {
    try {
      const adjustmentTypes = await listAdjustmentTypes();
      res.status(200).json({ adjustmentTypes });
    } catch (error) {
      next(error);
    }
  },
);
