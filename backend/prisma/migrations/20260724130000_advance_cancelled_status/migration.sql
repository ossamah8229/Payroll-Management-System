-- Operational Stabilization Checkpoint (2026-07-24) — Advance Cancel/Void.
-- Adds a non-destructive `CANCELLED` status for correcting a mistakenly-recorded Advance, matching
-- this schema's existing "no hard delete of a permanent financial/master record" convention
-- (see the `Advance` model's own doc comment, schema.prisma). Additive only — no existing row's
-- `status` value changes, no column added, no existing constraint altered.
ALTER TYPE "AdvanceStatus" ADD VALUE 'CANCELLED';
