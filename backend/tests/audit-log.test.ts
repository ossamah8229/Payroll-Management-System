import { prisma } from '../src/lib/prisma';
import { recordAuditLog } from '../src/modules/audit-log/audit-log.service';

/**
 * The Audit Log immutability guarantee (docs/architecture/system-conventions.md §3) is enforced at
 * two independent layers: the application never exposes an update/delete path (there is simply no
 * such export from audit-log.service.ts — nothing to test there beyond "the function doesn't
 * exist"), and the database itself rejects UPDATE/DELETE via a trigger, tested directly here by
 * bypassing the application layer entirely with a raw query.
 *
 * Requires backend/prisma/sql/audit_log_immutability.sql to have been applied as a migration
 * (see backend/README.md) — this test is the mandatory verification that it actually was.
 */
describe('AuditLog immutability (database-level)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects a raw UPDATE against AuditLog', async () => {
    await recordAuditLog({
      actorUserId: null,
      action: 'test.immutability.update',
      entityType: 'Test',
    });

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "AuditLog" SET action = 'tampered' WHERE action = 'test.immutability.update'`,
      ),
    ).rejects.toThrow();
  });

  it('rejects a raw DELETE against AuditLog', async () => {
    await recordAuditLog({
      actorUserId: null,
      action: 'test.immutability.delete',
      entityType: 'Test',
    });

    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "AuditLog" WHERE action = 'test.immutability.delete'`),
    ).rejects.toThrow();
  });
});
