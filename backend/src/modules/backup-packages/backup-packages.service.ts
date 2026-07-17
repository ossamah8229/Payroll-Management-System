import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import { Prisma } from '@prisma/client';
import type { SessionUser } from '@payroll/shared';
import { prisma, type PrismaTransactionClient } from '../../lib/prisma';
import { badRequest, conflict, notFound } from '../../common/http-error';
import type { RequestMeta } from '../../common/request-meta';
import { logger } from '../../lib/logger';
import { recordAuditLog } from '../audit-log/audit-log.service';
import { storageProvider } from '../../lib/storage';
import { StorageError } from '../../lib/storage/errors';
import { getPayrollCycle } from '../payroll-processing/payroll-processing.service';
import { exportPayrollEntriesToCsv, exportPayrollEntriesToXlsx } from '../payroll-entry/payroll-entry-import-export.service';
import { buildCombinedBankSheetCsv } from '../bank-sheets/bank-sheets.service';
import { exportCashReceivingSheetToCsv } from '../cash-receiving/cash-receiving.service';
import { getCompanySettings } from '../settings/settings.service';

/**
 * Backup Packages (Phase 5 Checkpoint 2, docs/architecture/database/payroll-cycle.md §17-18) —
 * the reusable, versioned backup-generation domain. Generation was **manually triggered only** in
 * Checkpoint 2; Checkpoint 3 (`payroll-processing.service.ts`'s `archiveAndCreateNextPayrollCycle`)
 * is the first caller that also generates automatically, immediately before archiving.
 *
 * **Content, per the approved architecture review (2026-07-14):** Payroll Entry CSV + XLSX,
 * one combined Bank Sheets CSV (every active Bank plus Cash), Cash Receiving CSV, and
 * `manifest.json`. Payslip PDFs and an Audit Log export were both evaluated and explicitly
 * deferred — absent from this checkpoint entirely, not stubbed.
 *
 * **Reuse boundary (Principle 6 — no parallel calculation path):** every data file is produced by
 * calling this codebase's own existing, already-shipped export builders
 * (`exportPayrollEntriesToCsv`/`Xlsx`, `buildCombinedBankSheetCsv`, `exportCashReceivingSheetToCsv`)
 * exactly as the live export routes already do — this module only orchestrates *which* builders run
 * and *how* their output is bundled/persisted, never recomputing a payroll figure itself.
 *
 * **Phase 5 Checkpoint 3 refactor — four composable phases, not a rewrite.** `generateBackupPackage`
 * (manual generation, unchanged behavior) and `archiveAndCreateNextPayrollCycle` (rollover,
 * `payroll-processing.service.ts`) both now call the same four primitives instead of each having
 * their own copy of this logic:
 * 1. `reserveBackupPackageVersion` — the `GENERATING` row, own insert, before any storage write.
 * 2. `assembleBackupPackageFiles` — builds every file's bytes in memory, no I/O side effects.
 * 3. `writeBackupPackageFilesToStorage` — writes each assembled file through `StorageProvider`.
 * 4. `commitBackupPackageReady` — the final `BackupPackageFile` rows + `READY` flip + audit entry,
 *    now parameterized by a `PrismaTransactionClient` instead of always opening its own
 *    transaction, so a caller (rollover) can fold this commit into its own larger transaction that
 *    also archives the outgoing cycle and creates the next Draft — "Backup metadata, cycle
 *    archiving, and new-cycle database state either commit together or none of them commit"
 *    (docs/architecture/system-conventions.md §2). `generateBackupPackage` still opens its own
 *    transaction around this same function for standalone manual generation — nothing about that
 *    call site's behavior changed.
 */

const MANIFEST_FILENAME = 'manifest.json';

/** Reads `backend/package.json`'s own `version` field, resolved the same way `STORAGE_ROOT`/
 * `DATABASE_URL` already are — relative to the process's working directory
 * (`backend/src/lib/storage/resolve-root.ts`'s own established convention), since this backend is
 * always run from the `backend/` directory. Falls back to `'unknown'` rather than throwing — a
 * missing/unreadable `package.json` should never block backup generation itself. This project does
 * not yet bump this field per deploy, a known, accepted limitation (docs/PROJECT_PROGRESS.md), not
 * something this checkpoint invents a fix for. */
export function getApplicationVersion(): string {
  try {
    const pkgPath = path.join(process.cwd(), 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** The latest applied Prisma migration name, read directly from Prisma's own `_prisma_migrations`
 * table — no new schema needed to track this. Falls back to `'unknown'` if the table is somehow
 * unreadable rather than blocking generation over a purely descriptive field. */
export async function getDatabaseSchemaVersion(): Promise<string> {
  try {
    const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL
      ORDER BY finished_at DESC
      LIMIT 1
    `;
    return rows[0]?.migration_name ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Released/held/pending counts at generation time — computed identically to Finalize Cycle's own
 * `payroll_cycle.released` audit metadata shape (`entryCount`/`releasedCount`/`heldCount`), not a
 * new calculation. */
async function computeReleaseStatusSummary(cycleId: string) {
  const [entryCount, releasedCount, heldCount] = await Promise.all([
    prisma.payrollEntry.count({ where: { cycleId } }),
    prisma.payrollEntry.count({ where: { cycleId, released: true } }),
    prisma.payrollEntry.count({ where: { cycleId, hold: true } }),
  ]);
  return { entryCount, releasedCount, heldCount };
}

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Recursively sorts every object's own keys (arrays keep their element order — the manifest's own
 * `files` list order is meaningful) before `JSON.stringify`, so the manifest's serialized bytes —
 * and therefore its checksum — never depend on JS's own key-insertion order. */
function canonicalJsonStringify(value: unknown, indent = 2): string {
  function sortKeys(input: unknown): unknown {
    if (Array.isArray(input)) {
      return input.map(sortKeys);
    }
    if (input !== null && typeof input === 'object') {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(input as Record<string, unknown>).sort()) {
        sorted[key] = sortKeys((input as Record<string, unknown>)[key]);
      }
      return sorted;
    }
    return input;
  }
  return JSON.stringify(sortKeys(value), null, indent);
}

/** A short, non-sensitive diagnostic for `BackupPackage.failureReason` — never a stack trace, SQL
 * detail, or filesystem path. `StorageError` subclasses guarantee their own `message` is safe to
 * log (`backend/src/lib/storage/errors.ts`'s own log-hygiene note); anything else (a Prisma error,
 * an exporter throwing) may carry raw SQL or path detail in its own `message`, so only its error
 * class name is recorded, never that message. Exported so `payroll-processing.service.ts`'s
 * rollover orchestrator can produce the identical diagnostic on its own failure path
 * (`failBackupPackageGeneration`, below, covers the ordinary case; rollover's own transaction
 * failure is the one path that can't go through it — see that module's own doc comment). */
export function safeFailureReason(error: unknown): string {
  if (error instanceof StorageError) {
    return `${error.name}: ${error.message}`;
  }
  if (error instanceof Error) {
    return `${error.constructor.name} occurred during Backup Package generation`;
  }
  return 'Unknown error occurred during Backup Package generation';
}

function formatCycleLabel(year: number, month: number): string {
  return new Date(year, month - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

export interface ManifestFileEntry {
  fileType: string;
  filename: string;
  sizeBytes: number;
  checksum: string;
}

export interface ManifestPayload {
  packageVersion: number;
  cycle: { id: string; year: number; month: number };
  generatedAt: string;
  generatedBy: { id: string; name: string };
  applicationVersion: string;
  databaseSchemaVersion: string;
  releaseStatusSummary: { entryCount: number; releasedCount: number; heldCount: number };
  files: ManifestFileEntry[];
  totalDataSizeBytes: number;
}

export interface AssembledBackupFile {
  fileType: 'MANIFEST' | 'PAYROLL_ENTRY_CSV' | 'PAYROLL_ENTRY_XLSX' | 'BANK_SHEETS_CSV' | 'CASH_RECEIVING_CSV';
  filename: string;
  contentType: string;
  buffer: Buffer;
  sizeBytes: number;
  checksum: string;
}

export interface AssembledBackupPackage {
  keyPrefix: string;
  allFiles: AssembledBackupFile[];
  totalSizeBytes: number;
  manifestChecksum: string;
}

export interface ReservedBackupPackageVersion {
  reserved: Prisma.BackupPackageGetPayload<Record<string, never>>;
  nextVersion: number;
  releaseStatusSummary: { entryCount: number; releasedCount: number; heldCount: number };
  applicationVersion: string;
  databaseSchemaVersion: string;
}

/**
 * Phase 1 of 4 — reserve the next `GENERATING` version, before any storage write begins. Race-safe:
 * the next version is computed and reserved via an ordinary `create()` relying on the
 * `(cycleId, version)` unique constraint as the concurrency backstop — a losing concurrent attempt
 * gets a clean, typed `409 CONFLICT` (never a raw constraint-violation leak, never two successful
 * generations landing on the same version). Shared by manual generation (`generateBackupPackage`,
 * below) and rollover (`payroll-processing.service.ts`'s `archiveAndCreateNextPayrollCycle`) — the
 * one place either caller reserves a version.
 *
 * **AUD-011:** also the "before creating a new Backup Package" lifecycle point —
 * `recoverStaleGeneratingBackupPackages` runs first, so a stale `GENERATING` row left behind by a
 * crashed process for this cycle (or any other) is recovered before a new version is reserved.
 * `nextVersion` below is unaffected either way: a recovered row keeps its own version number
 * whether `GENERATING` or `FAILED`, so `MAX(version) + 1` is correct regardless of ordering.
 */
export async function reserveBackupPackageVersion(
  cycleId: string,
  currentUser: SessionUser,
): Promise<ReservedBackupPackageVersion> {
  await recoverStaleGeneratingBackupPackages();

  const releaseStatusSummary = await computeReleaseStatusSummary(cycleId);
  const applicationVersion = getApplicationVersion();
  const databaseSchemaVersion = await getDatabaseSchemaVersion();

  const maxVersion = await prisma.backupPackage.aggregate({ where: { cycleId }, _max: { version: true } });
  const nextVersion = (maxVersion._max.version ?? 0) + 1;

  try {
    const reserved = await prisma.backupPackage.create({
      data: {
        cycleId,
        version: nextVersion,
        status: 'GENERATING',
        generatedBy: currentUser.id,
        applicationVersion,
        databaseSchemaVersion,
        releaseStatusSummary,
      },
    });
    return { reserved, nextVersion, releaseStatusSummary, applicationVersion, databaseSchemaVersion };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw conflict(
        'A Backup Package generation was already reserved for this cycle at this version — retry to allocate the next one',
      );
    }
    throw error;
  }
}

/**
 * Phase 2 of 4 — assembles every file's bytes in memory, no I/O side effects (no storage write, no
 * database write). Every byte comes from an existing, already-shipped export builder; nothing here
 * recomputes a payroll figure (Principle 6). Manifest is computed last (it needs every other file's
 * checksum/size to be meaningful) but ordered first in the returned `allFiles` — the deterministic
 * order both manual generation and rollover publish in.
 */
export async function assembleBackupPackageFiles(
  currentUser: SessionUser,
  cycle: { id: string; year: number; month: number },
  reservation: Pick<
    ReservedBackupPackageVersion,
    'nextVersion' | 'releaseStatusSummary' | 'applicationVersion' | 'databaseSchemaVersion'
  >,
): Promise<AssembledBackupPackage> {
  const { nextVersion, releaseStatusSummary, applicationVersion, databaseSchemaVersion } = reservation;

  const [payrollCsv, payrollXlsx, bankSheetsCsv] = await Promise.all([
    exportPayrollEntriesToCsv(currentUser, cycle.id),
    exportPayrollEntriesToXlsx(currentUser, cycle.id),
    buildCombinedBankSheetCsv(currentUser, cycle.id),
  ]);

  const companySettings = await getCompanySettings();
  const cashReceivingCsv = await exportCashReceivingSheetToCsv(currentUser, cycle.id, {
    companyName: companySettings.companyName,
    cycleLabel: formatCycleLabel(cycle.year, cycle.month),
    generatedByName: currentUser.name,
    generatedAt: new Date(),
  });

  // Deterministic order + checksums for the four data files.
  const dataFiles = [
    {
      fileType: 'PAYROLL_ENTRY_CSV' as const,
      filename: 'payroll-entry.csv',
      contentType: 'text/csv',
      buffer: payrollCsv.buffer,
    },
    {
      fileType: 'PAYROLL_ENTRY_XLSX' as const,
      filename: 'payroll-entry.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: payrollXlsx.buffer,
    },
    {
      fileType: 'BANK_SHEETS_CSV' as const,
      filename: 'bank-sheets.csv',
      contentType: 'text/csv',
      buffer: bankSheetsCsv.buffer,
    },
    {
      fileType: 'CASH_RECEIVING_CSV' as const,
      filename: 'cash-receiving.csv',
      contentType: 'text/csv',
      buffer: cashReceivingCsv.buffer,
    },
  ].map((file) => ({ ...file, sizeBytes: file.buffer.length, checksum: sha256Hex(file.buffer) }));

  const manifestPayload: ManifestPayload = {
    packageVersion: nextVersion,
    cycle: { id: cycle.id, year: cycle.year, month: cycle.month },
    generatedAt: new Date().toISOString(),
    generatedBy: { id: currentUser.id, name: currentUser.name },
    applicationVersion,
    databaseSchemaVersion,
    releaseStatusSummary,
    files: dataFiles.map((file) => ({
      fileType: file.fileType,
      filename: file.filename,
      sizeBytes: file.sizeBytes,
      checksum: file.checksum,
    })),
    totalDataSizeBytes: dataFiles.reduce((sum, file) => sum + file.sizeBytes, 0),
  };
  const manifestBuffer = Buffer.from(canonicalJsonStringify(manifestPayload), 'utf-8');
  const manifestChecksum = sha256Hex(manifestBuffer);

  const allFiles: AssembledBackupFile[] = [
    {
      fileType: 'MANIFEST',
      filename: MANIFEST_FILENAME,
      contentType: 'application/json',
      buffer: manifestBuffer,
      sizeBytes: manifestBuffer.length,
      checksum: manifestChecksum,
    },
    ...dataFiles,
  ];

  return {
    keyPrefix: `backups/${cycle.id}/v${nextVersion}`,
    allFiles,
    totalSizeBytes: allFiles.reduce((sum, file) => sum + file.sizeBytes, 0),
    manifestChecksum,
  };
}

/**
 * Phase 3 of 4 — writes each assembled file through `StorageProvider`, manifest first then the data
 * files (the same deterministic order they were assembled in). Pushes every key actually written,
 * in write order, into the caller-owned `writtenKeys` array (mutated in place, also returned for
 * convenience) — deliberately NOT a locally-built array returned only on success: if a write partway
 * through throws, this function throws too, but the caller's own array reference already holds
 * every key written before the failure, so `failBackupPackageGeneration` can still best-effort clean
 * up exactly what this attempt actually wrote, not nothing.
 */
export async function writeBackupPackageFilesToStorage(
  assembled: AssembledBackupPackage,
  writtenKeys: string[] = [],
): Promise<string[]> {
  for (const file of assembled.allFiles) {
    const key = `${assembled.keyPrefix}/${file.filename}`;
    await storageProvider.write(key, file.buffer, { contentType: file.contentType });
    writtenKeys.push(key);
  }
  return writtenKeys;
}

/**
 * Phase 4 of 4 — the final commit: every `BackupPackageFile` row, the package's `GENERATING` →
 * `READY` flip, and the `backup_package.generated` audit entry, all together or not at all.
 * Deliberately takes a caller-owned `PrismaTransactionClient` rather than opening its own — this is
 * the one piece of `generateBackupPackage`'s original body that had to change shape (not behavior)
 * for rollover to be able to fold this same commit into its own larger transaction that also
 * archives the outgoing cycle and creates the next Draft (docs/architecture/system-conventions.md
 * §2: "Backup metadata, cycle archiving, and new-cycle database state either commit together or
 * none of them commit"). `generateBackupPackage` below still wraps this in its own
 * `prisma.$transaction` for standalone manual generation — from that call site, nothing changed.
 */
export async function commitBackupPackageReady(
  tx: PrismaTransactionClient,
  params: {
    backupPackageId: string;
    cycleId: string;
    version: number;
    assembled: AssembledBackupPackage;
    currentUser: SessionUser;
    requestMeta: RequestMeta;
  },
): Promise<void> {
  const { backupPackageId, cycleId, version, assembled, currentUser, requestMeta } = params;

  for (const [index, file] of assembled.allFiles.entries()) {
    await tx.backupPackageFile.create({
      data: {
        backupPackageId,
        fileType: file.fileType,
        filename: file.filename,
        storageKey: `${assembled.keyPrefix}/${file.filename}`,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
        checksum: file.checksum,
        sortOrder: index,
      },
    });
  }

  await tx.backupPackage.update({
    where: { id: backupPackageId },
    data: {
      status: 'READY',
      generatedAt: new Date(),
      totalSizeBytes: assembled.totalSizeBytes,
      fileCount: assembled.allFiles.length,
      manifestChecksum: assembled.manifestChecksum,
    },
  });

  await recordAuditLog(
    {
      actorUserId: currentUser.id,
      action: 'backup_package.generated',
      entityType: 'BackupPackage',
      entityId: backupPackageId,
      metadata: { cycleId, version, fileCount: assembled.allFiles.length, totalSizeBytes: assembled.totalSizeBytes },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    },
    tx,
  );
}

/**
 * Shared "mark a reserved-but-unfinished `BackupPackage` `FAILED`" primitive — the status/
 * `failureReason` update (own catch/log so a failure here never masks the real, original error)
 * and the corresponding audit entry (same). Used by both `failBackupPackageGeneration` (an
 * exception during this process's own live generation attempt, actor = the requesting user) and
 * `recoverStaleGeneratingBackupPackages` (AUD-011, below — a `GENERATING` row left behind by a
 * crashed/restarted process, actor = the system itself, `actorUserId: null`, matching this
 * codebase's existing convention for a system-attributed audit entry, e.g. `auth.login.failed`) —
 * the one shared "how do we fail a package" step, not two copies of the update+audit pattern.
 */
async function markBackupPackageFailed(params: {
  backupPackageId: string;
  failureReason: string;
  auditAction: string;
  auditActorUserId: string | null;
  auditMetadata: Prisma.InputJsonValue;
  requestMeta: RequestMeta;
}): Promise<void> {
  const { backupPackageId, failureReason, auditAction, auditActorUserId, auditMetadata, requestMeta } = params;

  await prisma.backupPackage
    .update({ where: { id: backupPackageId }, data: { status: 'FAILED', failureReason } })
    .catch((updateError: unknown) => {
      logger.error(
        { updateError, backupPackageId },
        'Backup Package generation: failed to mark the package FAILED after an earlier error',
      );
    });

  await recordAuditLog({
    actorUserId: auditActorUserId,
    action: auditAction,
    entityType: 'BackupPackage',
    entityId: backupPackageId,
    metadata: auditMetadata,
    ipAddress: requestMeta.ipAddress,
    userAgent: requestMeta.userAgent,
  }).catch((auditError: unknown) => {
    logger.error({ auditError, backupPackageId }, `Backup Package generation: failed to write the ${auditAction} audit entry`);
  });
}

/**
 * Shared failure path for a reserved version that never reached `READY` — best-effort deletes this
 * attempt's own already-written storage objects (never blocks or masks the original error; a
 * cleanup failure leaves an orphaned, unreferenced storage object, an accepted outcome per
 * docs/architecture/system-conventions.md §2), then delegates the status update and
 * `backup_package.generation_failed` audit entry to `markBackupPackageFailed` above. Used by
 * `generateBackupPackage`'s own catch block (unchanged behavior) and by rollover's catch block
 * (`payroll-processing.service.ts`) — the one shared cleanup routine, not two copies of it.
 */
export async function failBackupPackageGeneration(params: {
  backupPackageId: string;
  cycleId: string;
  version: number;
  writtenKeys: string[];
  currentUser: SessionUser;
  requestMeta: RequestMeta;
  error: unknown;
}): Promise<void> {
  const { backupPackageId, cycleId, version, writtenKeys, currentUser, requestMeta, error } = params;

  for (const key of writtenKeys) {
    await storageProvider.delete(key).catch((cleanupError: unknown) => {
      logger.error(
        { cleanupError, key, cycleId, version },
        'Backup Package generation cleanup: failed to delete an orphaned storage object',
      );
    });
  }

  const failureReason = safeFailureReason(error);
  await markBackupPackageFailed({
    backupPackageId,
    failureReason,
    auditAction: 'backup_package.generation_failed',
    auditActorUserId: currentUser.id,
    auditMetadata: { cycleId, version, failureReason },
    requestMeta,
  });
}

/** AUD-011 (Post-Phase-5 Stabilization Checkpoint 3): how long a `BackupPackage` may sit
 * `GENERATING` before `recoverStaleGeneratingBackupPackages` (below) treats it as abandoned —
 * comfortably beyond the `commitBackupPackageReady` transaction's own 30-second timeout and any
 * realistic in-memory assembly time for even a large payroll's CSV/XLSX exports, so a genuinely
 * slow-but-live generation is never mistaken for a crashed one. */
const STALE_GENERATING_THRESHOLD_MS = 15 * 60 * 1000;

/**
 * AUD-011 — recovery for a `BackupPackage` left stuck `GENERATING` by a process that crashed or
 * was killed mid-attempt (before `failBackupPackageGeneration`'s own catch block ever ran).
 *
 * A `GENERATING` row is only ever created immediately before a fully synchronous generation
 * attempt (reserve → assemble → write storage → commit, all within one request/process's own
 * lifetime — see this module's file-level doc comment). There is no legitimate way for a row to
 * still be `GENERATING` once `STALE_GENERATING_THRESHOLD_MS` has elapsed: the process that
 * reserved it either finished (`READY`/`FAILED`) or died mid-attempt. This sweep finds any such
 * row and transitions it to `FAILED` via the same `markBackupPackageFailed` primitive a live
 * in-request failure uses, under a distinct `backup_package.generation_recovered` audit action
 * (system-attributed, `actorUserId: null` — no requesting user exists for a startup/pre-generation
 * sweep) so an audit reviewer can tell a caught exception apart from a later-discovered abandoned
 * row. The `status: 'GENERATING'` filter means a `READY` or already-`FAILED` row is never selected
 * in the first place — this can never revisit or corrupt a completed package's own version
 * history, and is naturally idempotent: a row this sweep already moved to `FAILED` no longer
 * matches on a repeat call.
 *
 * No best-effort storage cleanup is attempted here (unlike `failBackupPackageGeneration`) — after
 * a crash there is no in-memory `writtenKeys` list to consult, and this interface has no `list`
 * operation to discover orphans by prefix (`storage-provider.ts`'s own scope note). An orphaned,
 * unreferenced storage object from the abandoned attempt is the same accepted outcome
 * `docs/architecture/system-conventions.md §2` already documents for the live-failure cleanup
 * path's own best-effort limits.
 *
 * Called at two lifecycle points — process startup (`server.ts`, before accepting traffic) and
 * the top of `reserveBackupPackageVersion` (immediately before every new reservation, covering
 * both manual generation and rollover) — never a background worker, interval, or queue, per this
 * checkpoint's "no queues or schedulers" requirement.
 */
export async function recoverStaleGeneratingBackupPackages(): Promise<{ recoveredIds: string[] }> {
  const cutoff = new Date(Date.now() - STALE_GENERATING_THRESHOLD_MS);
  const stale = await prisma.backupPackage.findMany({
    where: { status: 'GENERATING', updatedAt: { lt: cutoff } },
    select: { id: true, cycleId: true, version: true },
  });

  for (const pkg of stale) {
    await markBackupPackageFailed({
      backupPackageId: pkg.id,
      failureReason: 'Recovered: generation was abandoned by a crashed or restarted process',
      auditAction: 'backup_package.generation_recovered',
      auditActorUserId: null,
      auditMetadata: { cycleId: pkg.cycleId, version: pkg.version },
      requestMeta: { ipAddress: null, userAgent: null },
    });
  }

  if (stale.length > 0) {
    logger.warn(
      { recoveredIds: stale.map((pkg) => pkg.id) },
      'Recovered stale GENERATING Backup Package(s) abandoned by a previous process',
    );
  }

  return { recoveredIds: stale.map((pkg) => pkg.id) };
}

/**
 * Generates a new, versioned Backup Package for one payroll cycle — manual generation, unchanged
 * behavior from Checkpoint 2. A thin wrapper around the four phases above: reserve → assemble →
 * write storage → one final Postgres transaction (`commitBackupPackageReady`) → commit. If anything
 * fails after the version is reserved, `failBackupPackageGeneration` best-effort cleans up this
 * attempt's own storage objects and marks the reserved row `FAILED` — it is never left `GENERATING`
 * forever by a caught error, and never partially `READY`.
 *
 * **Rejects a Draft cycle** — a Backup Package is a historical-snapshot artifact
 * (docs/architecture/workflows/payroll-lifecycle.md §5); backing up payroll still being entered
 * would be confusing at best. `RELEASED` and `ARCHIVED` cycles are both accepted.
 */
export async function generateBackupPackage(
  currentUser: SessionUser,
  cycleId: string,
  requestMeta: RequestMeta,
) {
  const cycle = await prisma.payrollCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) {
    throw notFound('Payroll cycle not found');
  }
  if (cycle.status === 'DRAFT') {
    throw badRequest('Cannot generate a Backup Package for a Draft payroll cycle');
  }

  const reservation = await reserveBackupPackageVersion(cycleId, currentUser);
  const { reserved, nextVersion } = reservation;

  const writtenKeys: string[] = [];
  try {
    const assembled = await assembleBackupPackageFiles(currentUser, cycle, reservation);
    await writeBackupPackageFilesToStorage(assembled, writtenKeys);

    await prisma.$transaction(
      (tx) =>
        commitBackupPackageReady(tx, {
          backupPackageId: reserved.id,
          cycleId,
          version: nextVersion,
          assembled,
          currentUser,
          requestMeta,
        }),
      { timeout: 30_000 },
    );

    return prisma.backupPackage.findUniqueOrThrow({
      where: { id: reserved.id },
      include: { files: { orderBy: { sortOrder: 'asc' } } },
    });
  } catch (error) {
    await failBackupPackageGeneration({
      backupPackageId: reserved.id,
      cycleId,
      version: nextVersion,
      writtenKeys,
      currentUser,
      requestMeta,
      error,
    });
    throw error;
  }
}

export async function listBackupPackages(cycleId: string) {
  await getPayrollCycle(cycleId); // 404s cleanly if the cycle doesn't exist
  return prisma.backupPackage.findMany({
    where: { cycleId },
    include: { files: { orderBy: { sortOrder: 'asc' } } },
    orderBy: { version: 'desc' },
  });
}

export async function getBackupPackage(id: string) {
  const backupPackage = await prisma.backupPackage.findUnique({
    where: { id },
    include: { files: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!backupPackage) {
    throw notFound('Backup package not found');
  }
  return backupPackage;
}

/** Resolves and authorizes a single stored file for download — the one place a raw `storageKey`
 * is ever read off a `BackupPackageFile` row; the caller (the download route) never accepts one
 * from the client. Only a file belonging to a `READY` package is ever returned — a `GENERATING`/
 * `FAILED` package's files are never downloadable, matching the "complete and downloadable, or
 * does not exist as a usable domain record" invariant. */
export async function getBackupPackageFile(fileId: string) {
  const file = await prisma.backupPackageFile.findUnique({
    where: { id: fileId },
    include: { backupPackage: true },
  });
  if (!file || file.backupPackage.status !== 'READY') {
    throw notFound('Backup package file not found');
  }
  return file;
}
