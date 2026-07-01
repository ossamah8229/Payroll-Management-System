import { PrismaClient } from '@prisma/client';
import { isProduction } from '../config/env';

/**
 * A single, shared Prisma Client instance for the whole process. Re-exported (not re-instantiated)
 * everywhere it's needed, including as the `tx` parameter type for functions that must participate
 * in a caller's transaction (see src/modules/audit-log/audit-log.service.ts).
 */
export const prisma = new PrismaClient({
  log: isProduction ? ['error', 'warn'] : ['error', 'warn'],
});

export type PrismaTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
