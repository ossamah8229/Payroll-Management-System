-- Administration & Security Management Phase 1 — dynamic role administration.
--
-- Adds the two columns needed to let a Master User manage roles at runtime instead of only via
-- source-code/seed changes: `isActive` (gates new assignment; see `Role`'s own schema.prisma
-- comment for why it also strips an existing holder's *effective* access, a deliberate deviation
-- from this schema's usual "isActive blocks new links only" convention) and `isSystemRole` (the
-- one authoritative, name-independent signal that a role is one of the three seeded/protected
-- roles and can never be deleted).
--
-- Note: this migration deliberately does NOT touch the "session" table. That table is
-- `connect-pg-simple`'s own (see the 20260719120000_session_store_table migration's own comment) —
-- it is intentionally absent from schema.prisma, so `prisma migrate dev`'s diff-based generation
-- always proposes dropping it as a false positive. That DROP TABLE statement was removed by hand
-- from this migration before it was ever applied.

-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isSystemRole" BOOLEAN NOT NULL DEFAULT false;
