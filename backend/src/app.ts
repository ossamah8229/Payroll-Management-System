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
import { usersRouter } from './modules/users/users.routes';
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

const PgSession = connectPgSimple(session);

/**
 * A dedicated `pg` Pool for the session store, separate from Prisma's own connection pool.
 * `connect-pg-simple` speaks directly to Postgres via `pg`; Prisma manages its own pool
 * internally and the two are intentionally not shared, since they have different lifecycle and
 * pooling needs.
 */
const sessionPool = new Pool({ connectionString: env.DATABASE_URL });

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // required for correct req.ip / secure cookies behind Render's proxy

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
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
      store: new PgSession({
        pool: sessionPool,
        tableName: 'session',
        // Explicit creation is disabled in production — the table is created via a documented
        // migration step (see backend/README.md), not implicitly at runtime, so a first request
        // in production can never race a table-creation attempt.
        createTableIfMissing: !isProduction,
      }),
      name: 'connect.sid',
      secret: env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
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

  app.use('/api/v1/auth', authRouter);
  // Mounted before projectSitesRouter: its routes (/sites/:siteId/units, /units/:id) are more
  // specific than anything projectSitesRouter matches, so there's no ambiguity either way, but
  // registering the more specific paths first keeps the intent obvious.
  app.use('/api/v1', projectUnitsRouter);
  app.use('/api/v1/sites', projectSitesRouter);
  app.use('/api/v1/banks', banksRouter);
  app.use('/api/v1/employees', employeesRouter);
  app.use('/api/v1/settings', settingsRouter);
  app.use('/api/v1/users', usersRouter);
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
  app.use('/api/v1/payroll-cycles', payrollCyclesRouter);
  app.use('/api/v1/payroll-entries', payrollEntriesRouter);
  app.use('/api/v1/work-lines', workLinesRouter);
  // Phase 4 Checkpoint 5 — flat top-level resource, matching Banks' own pattern (Advances relate
  // to Employee, not to a specific Payroll Cycle route).
  app.use('/api/v1/advances', advancesRouter);
  app.use('/api/v1/tasks', tasksRouter);
  app.use('/api/v1/task-notifications', taskNotificationsRouter);
  // Phase 5 Checkpoint 2 — id-scoped detail/download routes, a flat top-level resource (a package/
  // file is looked up by its own id, matching Advances' own "not nested under a specific parent
  // route" pattern above).
  app.use('/api/v1/backup-packages', backupPackageDetailRouter);

  app.use(errorHandler);

  return app;
}
