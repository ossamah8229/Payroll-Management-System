import type { Prisma } from '@prisma/client';
import { prisma, type PrismaTransactionClient } from '../../lib/prisma';

export interface RecordAuditLogInput {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * The **only** way any code in this application writes to the audit log — an insert, nothing
 * else (docs/architecture/data-and-storage.md §3). There is deliberately no `update`/`delete`
 * export from this module; that absence is the application-layer half of the immutability
 * guarantee. The database-level half (a trigger rejecting UPDATE/DELETE outright) is the
 * defense-in-depth backstop — see prisma/sql/audit_log_immutability.sql.
 *
 * Accepts an optional transaction client so a caller can record an audit entry in the exact same
 * database transaction as the change it documents (Principle 3: no financial change without its
 * audit entry, atomically). Phase 1 has no financial mutations yet, but auth events (login,
 * logout) and the RBAC foundation are the first callers, and every later module's write paths
 * follow this same pattern.
 */
export async function recordAuditLog(
  input: RecordAuditLogInput,
  client: PrismaTransactionClient = prisma,
): Promise<void> {
  await client.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadata: input.metadata,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}
