-- Terminology audit (Corrections/RBAC completion checkpoint) — "Master User" is this system's live,
-- user-facing display name for the MASTER_ADMIN role (docs/architecture/authentication.md: renamed
-- 2026-07-05, "same role, no functional change"), but that rename never reached the seeded data:
-- prisma/seed.ts is idempotent-upsert-only and explicitly never reconciles already-existing rows
-- (its own doc comment), so every database seeded before this migration still shows "Master Admin"
-- in Settings -> Roles, the sidebar footer, and anywhere else Role.name/User.name is rendered.
--
-- This is a pure data fix, not a schema change — no column, identifier, or Role.code value is
-- touched (ROLE_CODES.MASTER_ADMIN stays 'MASTER_ADMIN' everywhere; authorization never depended on
-- either display name, docs/architecture/authentication.md's own audit). Deliberately scoped to only
-- the exact, still-default seed values, so an administrator who already renamed their own Master
-- Admin role or personal account name to anything else is never silently overwritten here.

UPDATE "Role"
SET name = 'Master User'
WHERE code = 'MASTER_ADMIN' AND name = 'Master Admin';

UPDATE "User"
SET name = 'Master User'
WHERE name = 'Master Admin'
  AND "roleId" IN (SELECT id FROM "Role" WHERE code = 'MASTER_ADMIN');
