-- Audit Log immutability — database-level defense in depth
-- (docs/architecture/data-and-storage.md §3, docs/architecture/database-schema.md §16).
--
-- The application layer never updates or deletes an AuditLog row (see
-- backend/src/modules/audit-log/audit-log.service.ts, which exposes only an insert). This
-- trigger is the second, independent layer: it rejects any UPDATE or DELETE against the table
-- at the database itself, so a future bug, an ad hoc script, or a raw query can't silently
-- violate the guarantee.
--
-- The table name is quoted ("AuditLog") because the Prisma schema uses no @@map — the physical
-- table name is the exact, case-sensitive model name, matching database-schema.md's naming
-- exactly rather than converting to snake_case (see the note at the top of schema.prisma).
--
-- This is a separate migration from the initial schema (rather than folded into it) because it's
-- hand-written SQL expressing something schema.prisma cannot (a trigger) — kept as its own,
-- clearly-attributable step in the migration history rather than mixed into Prisma's own
-- generated CREATE TABLE output.

CREATE OR REPLACE FUNCTION reject_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_update ON "AuditLog";
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON "AuditLog"
  FOR EACH ROW
  EXECUTE FUNCTION reject_audit_log_mutation();

DROP TRIGGER IF EXISTS audit_log_no_delete ON "AuditLog";
CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON "AuditLog"
  FOR EACH ROW
  EXECUTE FUNCTION reject_audit_log_mutation();
