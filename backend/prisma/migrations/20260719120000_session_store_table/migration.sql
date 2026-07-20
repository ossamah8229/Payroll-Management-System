-- Session store table for `connect-pg-simple` (backend/src/app.ts).
--
-- `createTableIfMissing` is deliberately disabled in production (`!isProduction` in app.ts) so a
-- first request in a freshly deployed environment can never race an implicit table-creation
-- attempt against the session store's own pool. That comment already asserted the table "is
-- created via a documented migration step" — this migration is that step, closing a real gap
-- found during RC1 clean-environment/production-mode validation (docs/release/RC1_VALIDATION_REPORT.md):
-- in `NODE_ENV=production` with no migration providing this table, every login attempt failed
-- with `relation "session" does not exist` (500) because `connect-pg-simple` had nowhere to
-- persist the session it just created.
--
-- Schema is `connect-pg-simple`'s own upstream default (`node_modules/connect-pg-simple/table.sql`),
-- reproduced verbatim so behavior matches what `createTableIfMissing: true` would have created in
-- development. Not modeled in `schema.prisma` — the application never queries this table through
-- Prisma; `connect-pg-simple` owns it exclusively via its own separate `pg` pool (see app.ts).

CREATE TABLE "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL
)
WITH (OIDS=FALSE);

ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;

CREATE INDEX "IDX_session_expire" ON "session" ("expire");
