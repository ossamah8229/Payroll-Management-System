import { PrismaClient } from '@prisma/client';
import { isProduction } from '../config/env';

/**
 * A single, shared Prisma Client instance for the whole process. Re-exported (not re-instantiated)
 * everywhere it's needed, including as the `tx` parameter type for functions that must participate
 * in a caller's transaction (see src/modules/audit-log/audit-log.service.ts).
 *
 * **Non-production only, query events are also emitted** (`{ emit: 'event', level: 'query' }`) —
 * added Phase 4 Checkpoint 6.3.1 so a test can attach `prisma.$on('query', ...)` and assert an
 * actual query *count* (proving a bulk read path issues one query, not one per row) rather than a
 * fuzzy duration bound. `emit: 'event'` only makes listening possible; nothing subscribes by
 * default, so this has no behavioral effect unless a test explicitly attaches a listener. Confined
 * to non-production so there is zero risk of this ever affecting production logging/behavior.
 */
export const prisma = new PrismaClient({
  log: isProduction ? ['error', 'warn'] : [{ emit: 'event', level: 'query' }, 'error', 'warn'],
});

export type PrismaTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
