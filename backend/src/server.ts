import { createApp, closeSessionPool } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { closeBrowser } from './lib/pdf/browser';
import { recoverStaleGeneratingBackupPackages } from './modules/backup-packages/backup-packages.service';

const app = createApp();

async function main(): Promise<void> {
  // AUD-011 — recover any Backup Package left GENERATING by a previous process's crash or
  // restart before this process accepts any traffic, so a stale row is never left permanently
  // stuck and no incoming request can race the recovery sweep itself.
  await recoverStaleGeneratingBackupPackages();

  const server = app.listen(env.PORT, () => {
    logger.info(`Backend listening on port ${env.PORT} (${env.NODE_ENV})`);
  });

  // Reliability Checkpoint 2 — guards against a second shutdown() running concurrently (SIGTERM
  // and SIGINT arriving close together, or a signal repeated) from calling `server.close()` twice
  // or double-logging; the individual cleanup calls below (`closeSessionPool`/`closeBrowser`/
  // `prisma.$disconnect`) are each independently idempotent regardless, so this guard is a
  // belt-and-suspenders simplification, not what makes cleanup safe.
  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down gracefully`);
    server.close(async () => {
      // Phase 4 Checkpoint 6.2 — the shared Puppeteer browser (if a PDF was ever rendered this
      // process) must be closed explicitly, same as Prisma, or it's left as an orphaned Chrome
      // process rather than exiting with the server.
      await closeBrowser();
      // Reliability Checkpoint 2 — the session store's dedicated `pg` Pool (app.ts's
      // `sessionPool`) is application-owned and `connect-pg-simple` never closes it itself; without
      // this call it kept real sockets/idle timers alive past process exit, previously masked only
      // by `process.exit(0)` below forcibly tearing down the process anyway.
      await closeSessionPool();
      await prisma.$disconnect();
      process.exit(0);
    });
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
