import express, { type Express } from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { Pool } from 'pg';
import { env, isProduction } from './config/env';
import { logger } from './lib/logger';
import { attachUser } from './common/middleware/attach-user';
import { csrfProtection, issueCsrfCookie } from './common/middleware/csrf';
import { errorHandler } from './common/middleware/error-handler';
import { authRouter } from './modules/auth/auth.routes';
import { projectSitesRouter } from './modules/project-sites/project-sites.routes';
import { projectUnitsRouter } from './modules/project-units/project-units.routes';
import { banksRouter } from './modules/banks/banks.routes';
import { employeesRouter } from './modules/employees/employees.routes';
import { settingsRouter } from './modules/settings/settings.routes';
import { companyLogoPublicRouter } from './modules/settings/company-logo-public.routes';
import { usersLookupRouter, usersRouter } from './modules/users/users.routes';
import { rolesRouter } from './modules/roles/roles.routes';
import { payrollCyclesRouter } from './modules/payroll-processing/payroll-processing.routes';
import {
  payrollCycleEntriesRouter,
  payrollEntriesRouter,
  workLinesRouter,
} from './modules/payroll-entry/payroll-entry.routes';
import { payrollUnitReleasesRouter } from './modules/payroll-release/payroll-release.routes';
import { bankSheetRouter } from './modules/bank-sheets/bank-sheets.routes';
import { cashReceivingRouter } from './modules/cash-receiving/cash-receiving.routes';
import { payslipsRouter } from './modules/payslips/payslips.routes';
import { advancesRouter } from './modules/advances/advances.routes';
import { taskNotificationsRouter, tasksRouter } from './modules/tasks/tasks.routes';
import { backupPackageDetailRouter, backupPackagesRouter } from './modules/backup-packages/backup-packages.routes';
import {
  balanceAdjustmentsRouter,
  correctionRequestsRouter,
  payrollCycleMaterializationsRouter,
  payrollEntryCorrectionsRouter,
} from './modules/corrections/corrections.routes';
import { adjustmentTypesRouter } from './modules/adjustment-types/adjustment-types.routes';
import { employeeStatementRouter, statementEmployeesRouter } from './modules/statements/statements.routes';
import { reportsRouter } from './modules/reports/reports.routes';
import { dashboardRouter } from './modules/dashboard/dashboard.routes';

const PgSession = connectPgSimple(session);

/**
 * A dedicated `pg` Pool for the session store, separate from Prisma's own connection pool.
 * `connect-pg-simple` speaks directly to Postgres via `pg`; Prisma manages its own pool
 * internally and the two are intentionally not shared, since they have different lifecycle and
 * pooling needs.
 *
 * Reliability Checkpoint 2 — `connect-pg-simple` is handed this pool but never owns it (`#ownsPg`
 * in its own source is only true when *it* constructs the pool itself from a connection string,
 * which never applies here since we always pass an existing `pool`), so *this module* is the
 * pool's sole owner: it alone decides when the pool is created (lazily, on first `createApp()`
 * call — never at import time, so importing `app.ts` without ever building an app, e.g. from test
 * infra, opens no socket) and when it's torn down (`closeSessionPool`, called once from
 * production shutdown in `server.ts` and once per test file from `tests/setup.ts`). Mirrors the
 * lazy-singleton/idempotent-close shape already used for the shared Puppeteer browser
 * (`lib/pdf/browser.ts`'s `getBrowser`/`closeBrowser`).
 *
 * Checkpoint 2A — the `PGStore` handed to `session()` below is *also* application-owned and lazily
 * singleton, for the same reason as the pool: each `PGStore` schedules its own self-rescheduling
 * prune timer (`#initPruneTimer`/`#pruneSessions` in connect-pg-simple's source) the first time a
 * request actually touches the session store, and that timer keeps rescheduling itself until
 * `store.close()` is called on that *exact instance* — it is not tied to the pool at all. Since
 * `pool` is an externally-supplied option, `PGStore.close()` only clears its own prune timer; it
 * never touches the pool (that's still this module's job below). A naive `new PgSession(...)`
 * inside `createApp()` would mint a fresh, independently-timered store on every call — and this
 * module's disposer only ever sees the pool, never any of those store instances — so any store
 * that had already served a request would keep re-arming its timer forever, including past the
 * point where `closeSessionPool()` ends the pool: the timer fires, queries an already-ended pool,
 * and errors (exactly the `"Cannot use a pool after calling end on the pool"` failure surfaced by
 * CI run #88). Reusing one store, closed alongside its pool, keeps the two resources' lifecycles
 * aligned no matter how many times `createApp()` is called against the same module registry.
 */
let sessionPool: Pool | null = null;
let sessionStore: InstanceType<typeof PgSession> | null = null;

export function getSessionPool(): Pool {
  if (!sessionPool) {
    sessionPool = new Pool({ connectionString: env.DATABASE_URL });
  }
  return sessionPool;
}

export function getSessionStore(): InstanceType<typeof PgSession> {
  if (!sessionStore) {
    sessionStore = new PgSession({
      pool: getSessionPool(),
      tableName: 'session',
      // Explicit creation is disabled in production — the table is created via a documented
      // migration step (see backend/README.md), not implicitly at runtime, so a first request
      // in production can never race a table-creation attempt.
      createTableIfMissing: !isProduction,
    });
  }
  return sessionStore;
}

/**
 * Idempotent — a second call (or a call when no pool was ever created) is a safe no-op.
 *
 * Disposal order matters: `store.close()` synchronously clears the store's prune timer (and marks
 * it `closed`, so an in-flight prune can't re-arm it) *before* the pool underneath it is ended, so
 * there is never a window where a still-scheduled prune can fire against an already-ended pool.
 */
export async function closeSessionPool(): Promise<void> {
  if (!sessionPool) return;
  const pool = sessionPool;
  const store = sessionStore;
  sessionPool = null;
  sessionStore = null;
  if (store) {
    await store.close();
  }
  await pool.end();
}

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // required for correct req.ip / secure cookies behind Render's proxy

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
      // Frontend and backend are separate origins in production (docs/architecture/deployment.md);
      // without this, the browser's Fetch API silently hides these response headers from JS on a
      // cross-origin response even though CORS otherwise allows reading the body (only a small
      // built-in set of headers is exposed by default) — see common/middleware/csrf.ts and
      // frontend/src/lib/api-client.ts for `x-csrf-token`.
      //
      // `content-disposition` (Phase 7B Checkpoint 3 refinement) — every file-download route in
      // this backend (Statements' `/pdf`/`/xlsx`/`/csv`, Payslips, Bank Sheet, Employees export,
      // etc.) already sets a real `Content-Disposition: attachment; filename="..."` header; without
      // exposing it here, the frontend's own `extractFilenameFromContentDisposition`
      // (`use-employee-statement.ts`) could never see it cross-origin (production, and this
      // project's own E2E harness) and silently used its fallback filename instead. Purely additive
      // — `x-csrf-token` stays exposed exactly as before, no other CORS behavior changes.
      exposedHeaders: ['x-csrf-token', 'content-disposition'],
    }),
  );
  app.use(
    pinoHttp({
      logger,
      autoLogging: !isProduction ? { ignore: (req) => req.url === '/health' } : true,
    }),
  );
  app.use(express.json());
  app.use(cookieParser());

  app.use(
    session({
      store: getSessionStore(),
      name: 'connect.sid',
      secret: env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        secure: isProduction,
        // 'none' in production: frontend and backend are cross-site *.onrender.com subdomains
        // (docs/release/KNOWN_ISSUES_v1.0.md KI-2), and a 'lax' cookie is never attached to a
        // cross-site fetch/XHR request — only 'none' (paired with 'secure', already true above)
        // actually rides along on the API calls the SPA makes. 'lax' in development, where the
        // Vite proxy (vite.config.ts) makes the two look same-origin and 'none' would require
        // 'secure' over plain HTTP, which browsers refuse. Same reasoning as the CSRF cookie
        // (common/middleware/csrf.ts).
        sameSite: isProduction ? 'none' : 'lax',
        maxAge: 1000 * 60 * 60 * 8, // 8 hours idle timeout, rolling
      },
    }),
  );

  app.use(issueCsrfCookie);
  app.use(csrfProtection);
  app.use(attachUser);

  // Liveness check — deliberately touches nothing but the process itself (no DB, no session
  // store), so it reflects whether the HTTP server is up, independent of dependency health.
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Checkpoint 4D correction — the safe endpoint `frontend/src/lib/api-client.ts`'s CSRF mismatch
  // recovery calls. It does nothing beyond what `issueCsrfCookie` above already did for this
  // request (echo the token bound to whatever `csrf_token` cookie the browser sent, or mint one if
  // it sent none) — deliberately not `/health` (a liveness probe, semantically unrelated) and not
  // `/api/v1/auth/me` (requires authentication, and carries session-bootstrap React Query side
  // effects a plain, framework-agnostic recovery call has no business triggering). No body needed —
  // the token travels in the `x-csrf-token` response header exactly like every other safe request.
  app.get('/api/v1/csrf-token', (_req, res) => {
    res.status(204).send();
  });

  app.use('/api/v1/auth', authRouter);
  // Phase 7C — mounted immediately after authRouter and, critically, *before*
  // `projectUnitsRouter` below: that router (and several others further down) is mounted at a
  // broad prefix with its own path-less `.use(requireAuth)`, which runs for *any* request that
  // reaches it regardless of whether one of its own routes actually matches — an earlier version
  // of this mount order placed this router immediately before `settingsRouter` instead, and every
  // request for GET /company/logo/ui|print was rejected 401 by `projectUnitsRouter`'s blanket
  // `requireAuth` before Express ever tried this router at all. Mounting it here, ahead of every
  // other authenticated router under /api/v1, is what actually makes it unauthenticated in
  // practice, not just in its own doc comment.
  app.use('/api/v1/settings', companyLogoPublicRouter);
  // Mounted before projectSitesRouter: its routes (/sites/:siteId/units, /units/:id) are more
  // specific than anything projectSitesRouter matches, so there's no ambiguity either way, but
  // registering the more specific paths first keeps the intent obvious.
  app.use('/api/v1', projectUnitsRouter);
  app.use('/api/v1/sites', projectSitesRouter);
  app.use('/api/v1/banks', banksRouter);
  // Phase 7A Checkpoint 1 — mounted ahead of employeesRouter's own blanket mount, same
  // "more-specific-sub-resource-router-first" convention as every other :parentId-nested route
  // below (Payslips, Bank Sheets, Cash Receiving, Corrections).
  app.use('/api/v1/employees/:employeeId/statement', employeeStatementRouter);
  app.use('/api/v1/employees', employeesRouter);
  // Phase 7A Checkpoint 2 correction — deliberately its own top-level path, not nested under
  // /api/v1/employees, so it can never be mistaken for (or accidentally merged into) the
  // current-site-scoped general Employee Lookup mounted just above. See statements.routes.ts's own
  // doc comment on statementEmployeesRouter for why this stays a separate endpoint.
  app.use('/api/v1/statements/employees', statementEmployeesRouter);
  app.use('/api/v1/settings', settingsRouter);
  // Mounted before usersRouter's own blanket users:manage gate — /assignable is intentionally
  // gated by tasks:manage instead (System-Wide RBAC Consistency remediation).
  app.use('/api/v1/users-lookup', usersLookupRouter);
  app.use('/api/v1/users', usersRouter);
  app.use('/api/v1/roles', rolesRouter);
  // Nested under a cycle for list/create; mounted before payrollCyclesRouter's own /:id route so
  // Express matches the more specific /:cycleId/entries path first (same reasoning as
  // projectUnitsRouter being mounted ahead of projectSitesRouter, above).
  app.use('/api/v1/payroll-cycles/:cycleId/entries', payrollCycleEntriesRouter);
  // Same reasoning as :cycleId/entries above — mounted ahead of payrollCyclesRouter's own /:id
  // route so Express matches this more specific /:cycleId/units path first (Phase 4 Checkpoint 2).
  app.use('/api/v1/payroll-cycles/:cycleId/units', payrollUnitReleasesRouter);
  // Same reasoning again — mounted ahead of payrollCyclesRouter's own /:id route (Phase 4
  // Checkpoint 3).
  app.use('/api/v1/payroll-cycles/:cycleId/bank-sheet', bankSheetRouter);
  // Same reasoning again — a dedicated module, not a bolt-on of bank-sheet above (Phase 4
  // Checkpoint 4).
  app.use('/api/v1/payroll-cycles/:cycleId/cash-receiving', cashReceivingRouter);
  // Same reasoning again — a dedicated module, not a bolt-on of Bank Sheets/Cash Receiving above
  // (Phase 4 Checkpoint 6.1).
  app.use('/api/v1/payroll-cycles/:cycleId/payslips', payslipsRouter);
  // Same reasoning again — mounted ahead of payrollCyclesRouter's own /:id route (Phase 5
  // Checkpoint 2).
  app.use('/api/v1/payroll-cycles/:cycleId/backup-packages', backupPackagesRouter);
  // Phase 6 Checkpoint 5 — same reasoning again, mounted ahead of payrollCyclesRouter's own /:id
  // route.
  app.use('/api/v1/payroll-cycles/:cycleId/materializations', payrollCycleMaterializationsRouter);
  app.use('/api/v1/payroll-cycles', payrollCyclesRouter);
  // Phase 6 Checkpoint 3 — mounted ahead of payrollEntriesRouter's own /:id route, same reasoning
  // as every other :id-nested-route-mounted-first case above (its own sub-paths, /corrections and
  // /correction-requests, never collide with payrollEntriesRouter's bare /:id anyway, but this
  // keeps the "more specific first" convention consistent).
  app.use('/api/v1/payroll-entries/:entryId', payrollEntryCorrectionsRouter);
  app.use('/api/v1/payroll-entries', payrollEntriesRouter);
  app.use('/api/v1/work-lines', workLinesRouter);
  // Phase 6 Checkpoint 3 — flat top-level resource, matching Advances' own pattern.
  app.use('/api/v1/correction-requests', correctionRequestsRouter);
  // Phase 6 Checkpoint 4 — flat top-level resource, same pattern.
  app.use('/api/v1/balance-adjustments', balanceAdjustmentsRouter);
  // Phase 6 Checkpoint 6 — read-only lookup route for the Corrections frontend's Adjustment Type
  // dropdown, matching Banks' own flat-top-level-lookup-resource pattern.
  app.use('/api/v1/adjustment-types', adjustmentTypesRouter);
  // Phase 4 Checkpoint 5 — flat top-level resource, matching Banks' own pattern (Advances relate
  // to Employee, not to a specific Payroll Cycle route).
  app.use('/api/v1/advances', advancesRouter);
  app.use('/api/v1/tasks', tasksRouter);
  app.use('/api/v1/task-notifications', taskNotificationsRouter);
  // Phase 8B Checkpoint 1 — flat top-level resource; read-only, derived reporting endpoints, never
  // nested under a specific payroll cycle route (a report's own ?cycleId= query parameter selects the
  // cycle instead, since a report is a lens over existing data, not a sub-resource of one cycle).
  app.use('/api/v1/reports', reportsRouter);
  // Dashboard Checkpoint 1A — flat top-level resource, single aggregation endpoint
  // (`docs/architecture/workflows/dashboard.md`), mirroring Reports' own mount pattern immediately
  // above (a lens over existing data, not a sub-resource of any one payroll cycle route).
  app.use('/api/v1/dashboard', dashboardRouter);
  // Phase 5 Checkpoint 2 — id-scoped detail/download routes, a flat top-level resource (a package/
  // file is looked up by its own id, matching Advances' own "not nested under a specific parent
  // route" pattern above).
  app.use('/api/v1/backup-packages', backupPackageDetailRouter);

  app.use(errorHandler);

  return app;
}
