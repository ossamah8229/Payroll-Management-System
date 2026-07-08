import { Router } from 'express';
import { requireAuth } from '../../common/middleware/attach-user';
import { prisma } from '../../lib/prisma';

/**
 * Read-only — banks are seeded reference data (docs/architecture/database/employee.md §7, "single
 * digits" row count), not a CRUD module of their own in the plan. Any authenticated user can list
 * them; they're needed to populate Project Site and Employee bank-selection dropdowns.
 */
export const banksRouter = Router();

banksRouter.use(requireAuth);

banksRouter.get('/', async (_req, res, next) => {
  try {
    const banks = await prisma.bank.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
    res.status(200).json({ banks });
  } catch (error) {
    next(error);
  }
});
