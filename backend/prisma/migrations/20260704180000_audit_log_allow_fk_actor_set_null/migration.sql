-- Audit Log immutability, corrected for the actorUserId ON DELETE SET NULL FK action
-- (docs/architecture/database-schema.md §16, docs/architecture/data-and-storage.md §3).
--
-- Found during the first-ever live-database verification (2026-07-04): the original
-- reject_audit_log_mutation() (20260701164509_audit_log_immutability) raised on *every* UPDATE,
-- including the UPDATE Postgres itself performs when a referenced "User" row is deleted and the
-- "AuditLog"."actorUserId" FK applies its documented ON DELETE SET NULL action. That made any
-- User row with audit history undeletable — directly contradicting §16's stated reason for
-- choosing SET NULL over RESTRICT ("a historical audit entry is never itself a reason a user
-- record becomes undeletable"). The two frozen requirements (append-only trigger, SET NULL FK)
-- conflicted; this migration resolves the conflict in favor of the FK semantics §16 explicitly
-- documents, keeping the trigger maximally strict everywhere else.
--
-- The one — and only — UPDATE now permitted: "actorUserId" transitioning from NOT NULL to NULL
-- with every other column byte-identical (i.e., exactly what the FK's SET NULL action produces,
-- and nothing else). Any other UPDATE, and every DELETE, is still rejected. This does not widen
-- what the architecture already allows: deleting a User was always documented to null the actor
-- reference on that user's historical audit entries.

CREATE OR REPLACE FUNCTION reject_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."actorUserId" IS NOT NULL
     AND NEW."actorUserId" IS NULL
     AND to_jsonb(NEW) - 'actorUserId' = to_jsonb(OLD) - 'actorUserId'
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'AuditLog is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;
