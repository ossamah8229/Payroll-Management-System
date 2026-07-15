import { Router } from 'express';
import { createPayrollCycleSchema, PERMISSIONS } from '@payroll/shared';
import { requireAuth } from '../../common/middleware/attach-user';
import { requirePermission } from '../../common/middleware/require-permission';
import { badRequest } from '../../common/http-error';
import {
  archiveAndCreateNextPayrollCycle,
  createPayrollCycle,
  finalizePayrollCycle,
  getPayrollCycle,
  listPayrollCycles,
} from './payroll-processing.service';

function requireIdParam(id: string | undefined): string {
  if (!id) throw badRequest('id parameter is required');
  return id;
}

export const payrollCyclesRouter = Router();

payrollCyclesRouter.use(requireAuth);

// View access is shared with Finance (read-only, Phase 4 Checkpoint 2) via `payroll:view` —
// Payroll Staff's own `payroll:entry` grant already implies view, so both are accepted here.
const VIEW_PERMISSIONS = [PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.PAYROLL_VIEW];

payrollCyclesRouter.get('/', requirePermission(VIEW_PERMISSIONS), async (req, res, next) => {
  try {
    const cycles = await listPayrollCycles();
    res.status(200).json({ cycles });
  } catch (error) {
    next(error);
  }
});

payrollCyclesRouter.get('/:id', requirePermission(VIEW_PERMISSIONS), async (req, res, next) => {
  try {
    const cycle = await getPayrollCycle(requireIdParam(req.params.id));
    res.status(200).json({ cycle });
  } catch (error) {
    next(error);
  }
});

// Master-User-only (docs/architecture/authentication.md: cycle creation is a system-lifecycle
// action, the same class as Finalize Cycle, not Payroll Staff's day-to-day data entry).
payrollCyclesRouter.post(
  '/',
  requirePermission(PERMISSIONS.PAYROLL_CYCLE_MANAGE),
  async (req, res, next) => {
    try {
      const input = createPayrollCycleSchema.parse(req.body);
      // createPayrollCycle owns its own audit logging inside the create transaction — the route
      // never logs a second, redundant entry after the fact (same convention as updateEmployee).
      const cycle = await createPayrollCycle(req.currentUser!, input, {
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });

      res.status(201).json({ cycle });
    } catch (error) {
      next(error);
    }
  },
);

// Master-User-only (same permission as creation — Finalize is the same class of system-lifecycle
// action, docs/architecture/workflows/payroll-lifecycle.md §4). Explicit `:id` route, never an
// implicit "current cycle" mutation — a Finalize request always names the exact cycle it targets.
payrollCyclesRouter.post(
  '/:id/finalize',
  requirePermission(PERMISSIONS.PAYROLL_CYCLE_MANAGE),
  async (req, res, next) => {
    try {
      // finalizePayrollCycle owns its own audit logging inside the finalize transaction — the
      // route never logs a second, redundant entry after the fact (same convention as
      // createPayrollCycle/releaseProjectUnit).
      const cycle = await finalizePayrollCycle(req.currentUser!, requireIdParam(req.params.id), {
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });

      res.status(200).json({ cycle });
    } catch (error) {
      next(error);
    }
  },
);

// Master-User-only, same permission as creation/Finalize (docs/architecture/workflows/
// payroll-lifecycle.md §4 — the month-end rollover workflow, Phase 5 Checkpoint 3). The outgoing
// cycle is always named explicitly by id; the next calendar period is always derived server-side
// (outgoing month + 1) — there is deliberately no request body, so there is nothing for a caller to
// override.
payrollCyclesRouter.post(
  '/:cycleId/archive-and-create-next',
  requirePermission(PERMISSIONS.PAYROLL_CYCLE_MANAGE),
  async (req, res, next) => {
    try {
      // archiveAndCreateNextPayrollCycle owns its own audit logging inside its own transaction —
      // the route never logs a second, redundant entry after the fact (same convention as
      // createPayrollCycle/finalizePayrollCycle).
      const result = await archiveAndCreateNextPayrollCycle(
        req.currentUser!,
        requireIdParam(req.params.cycleId),
        {
          ipAddress: req.ip ?? null,
          userAgent: req.get('user-agent') ?? null,
        },
      );

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);
