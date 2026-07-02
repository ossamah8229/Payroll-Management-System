-- Additive-only per Principle 8: adds a nullable address column to ProjectSite.
-- Authorized 2026-07-02 as a scoped exception during the Phase 2 UI polish pass — see
-- docs/architecture/database-schema.md §8 revision note and docs/PROJECT_PROGRESS.md §3 item 8.
ALTER TABLE "ProjectSite" ADD COLUMN "address" VARCHAR(300);
