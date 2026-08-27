-- v1.0.4 Advances Scalability checkpoint (2026-08-27).
--
-- Purely additive: two new indexes, no column/table/data change.
--
-- The Advances list now paginates server-side (`listAdvances`, advances.service.ts), filtered by an
-- optional `status`, always sorted `createdAt desc` with an `id asc` deterministic tie-break. At
-- ~80 new Advances recorded every month, an unindexed sort/filter over this table would only get
-- slower — these indexes keep it constant-shape as the table grows:
--   - `[status, createdAt DESC]` serves the common "one status filter (e.g. ACTIVE only), newest
--     first" case directly from the index.
--   - `[createdAt DESC]` alone serves the unfiltered "All statuses" default view.
CREATE INDEX "Advance_status_createdAt_idx" ON "Advance"("status", "createdAt" DESC);
CREATE INDEX "Advance_createdAt_idx" ON "Advance"("createdAt" DESC);
