import { createApp } from './app';
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

  async function shutdown(signal: string): Promise<void> {
    logger.info(`Received ${signal}, shutting down gracefully`);
    server.close(async () => {
      // Phase 4 Checkpoint 6.2 — the shared Puppeteer browser (if a PDF was ever rendered this
      // process) must be closed explicitly, same as Prisma, or it's left as an orphaned Chrome
      // process rather than exiting with the server.
      await closeBrowser();
      await prisma.$disconnect();
      process.exit(0);
    });
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
