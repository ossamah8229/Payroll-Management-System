import { Router } from 'express';
import { createPayrollCycleSchema, PERMISSIONS } from '@payroll/shared';
import { requireAuth } from '../../common/middleware/attach-user';
import { requirePermission } from '../../common/middleware/require-permission';
import { badRequest } from '../../common/http-error';
import { createPayrollCycle, getPayrollCycle, listPayrollCycles } from './payroll-processing.service';

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
