import { Router } from 'express';
import archiver from 'archiver';
import { batchPayslipsSchema, PERMISSIONS } from '@payroll/shared';
import { requireAuth } from '../../common/middleware/attach-user';
import { requirePermission } from '../../common/middleware/require-permission';
import { badRequest } from '../../common/http-error';
import { logger } from '../../lib/logger';
import { recordAuditLog } from '../audit-log/audit-log.service';
import { getPayrollCycle } from '../payroll-processing/payroll-processing.service';
import {
  generatePayslipPdf,
  getPayslip,
  getPayslipsBulk,
  listPayslips,
  renderPayslipPdfBuffer,
  type Payslip,
} from './payslips.service';

/** `{year}-{month, zero-padded}` — the shared period-slug convention every historical export
 * filename in this codebase now uses (Phase 5 Checkpoint 4), matching Cash Receiving/Bank Sheet's
 * own identical construction. Exported (Phase 7B Checkpoint 1) so the Statement PDF export
 * (`statements.routes.ts`) can reuse this single implementation for its own range-based filename
 * rather than adding a fourth independent copy of "YYYY-MM, zero-padded" alongside this file's own,
 * Bank Sheet's, and Cash Receiving's. */
export function periodSlug(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function requireIdParam(id: string | undefined): string {
  if (!id) throw badRequest('id parameter is required');
  return id;
}

/** Splits a comma-separated (or repeated) query param into an id list — used for both `siteIds`
 * and `unitIds` below; genuinely generic, so it isn't duplicated per param name. */
function parseIdsQuery(raw: unknown): string[] | undefined {
  if (!raw) return undefined;
  const values = Array.isArray(raw) ? raw : [raw];
  return values.flatMap((value) => String(value).split(',')).filter(Boolean);
}

/** How many Puppeteer pages the batch endpoint renders concurrently — a small, named constant
 * (Checkpoint 6.3.2's own explicit requirement), not tuned per request. Bounds memory/CPU
 * pressure on the one warm, shared Chromium instance (`lib/pdf/browser.ts`) regardless of how
 * many employees are in the batch (up to `MAX_BATCH_PAYSLIPS_PER_REQUEST`). */
const BATCH_RENDER_CONCURRENCY = 4;

/** Splits an array into fixed-size chunks — the same bounded-batch-processing shape
 * `payroll-processing.service.ts`'s own `chunk()` helper already establishes for bulk Prisma
 * writes, applied here to bounded-concurrency PDF rendering instead. Not shared/exported from
 * there — a 5-line, dependency-free utility duplicated locally is exactly the kind of small
 * repetition this codebase already tolerates (e.g. every export test file's own `binaryParser`)
 * rather than introducing a speculative shared module for one line of logic. */
function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** Lowercases and collapses every character outside `[a-z0-9]` into a single `-`, exactly like
 * the single-PDF download's own filename sanitization (Checkpoint 6.2, verified empirically
 * there against quotes/CR/LF/path separators) — reused here, not reinvented, since it already
 * proves safe against every character class this checkpoint's own filename-safety requirements
 * name explicitly. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Builds one collision-proof archive entry name per Payslip — `{employeeCode-or-shortId}-
 * {slugifiedName}.pdf`, falling back to a literal `'payslip'` base if an employee's identity
 * fields happen to contain nothing but characters `slugify` strips entirely (e.g. an all-emoji
 * name), and appending a numeric suffix against `usedNames` if two employees still collide (most
 * commonly two people sharing the exact same name) — duplicate archive-entry names would
 * otherwise silently overwrite one Payslip with another inside the same ZIP.
 */
export function buildArchiveEntryName(payslip: Payslip, usedNames: Set<string>): string {
  const codeOrShortId = payslip.identity.employeeCode?.trim() || payslip.employeeId.slice(0, 8);
  const base = [slugify(codeOrShortId), slugify(payslip.identity.employeeName)].filter(Boolean).join('-') || 'payslip';

  let candidate = `${base}.pdf`;
  let suffix = 2;
  while (usedNames.has(candidate)) {
    candidate = `${base}-${suffix}.pdf`;
    suffix += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

/** Mounted at /api/v1/payroll-cycles/:cycleId/payslips (Phase 4 Checkpoint 6.1 — Payslips backend
 * foundation). Gated exclusively by `payslips:view`, a dedicated permission — never
 * `payroll:entry`/`payroll:view`/`bank-sheets:view` (this checkpoint's own frozen decision, an
 * individual Payslip is a materially more sensitive per-person disclosure than any aggregate
 * sheet those permissions already gate). Mounted ahead of payrollCyclesRouter's own /:id route,
 * same reasoning as :cycleId/entries, /units, /bank-sheet, and /cash-receiving before it.
 *
 * Phase 4 Checkpoint 6.2 (Payslip PDF Engine) adds the `/pdf` route below — same permission,
 * site-scoping, and released/non-held gate as the JSON route (both call `getPayslip()`), a new
 * `payslip.exported` audit action (never `payslip.viewed` — no double-logging, since the PDF
 * route never touches the JSON route's own handler). Batch/ZIP generation and any frontend
 * surface remain explicitly out of scope — Checkpoint 6.3. */
export const payslipsRouter = Router({ mergeParams: true });

payslipsRouter.use(requireAuth);

payslipsRouter.get('/', requirePermission(PERMISSIONS.PAYSLIPS_VIEW), async (req, res, next) => {
  try {
    const cycleId = requireIdParam(req.params.cycleId);
    const siteIds = parseIdsQuery(req.query.siteIds);
    const unitIds = parseIdsQuery(req.query.unitIds);
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const page = req.query.page ? Number(req.query.page) : undefined;
    const pageSize = req.query.pageSize ? Number(req.query.pageSize) : undefined;

    // Deliberately no AuditLog entry here (this checkpoint's own frozen decision) — the picker/
    // list view discloses only names/codes already visible in Payroll Entry/Bank Sheets/Cash
    // Receiving to the same permission holders; only the single assembled Payslip below (the
    // actual net-salary disclosure) is audited.
    const result = await listPayslips(req.currentUser!, cycleId, { siteIds, unitIds, search, page, pageSize });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

payslipsRouter.get('/:employeeId', requirePermission(PERMISSIONS.PAYSLIPS_VIEW), async (req, res, next) => {
  try {
    const cycleId = requireIdParam(req.params.cycleId);
    const employeeId = requireIdParam(req.params.employeeId);

    const payslip = await getPayslip(req.currentUser!, cycleId, employeeId);

    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'payslip.viewed',
      entityType: 'PayrollEntry',
      entityId: payslip.entryId,
      metadata: { cycleId, employeeId },
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    // Salary detail must never sit in a shared/proxy/browser cache (this checkpoint's
    // cybersecurity baseline) — a step beyond Bank Sheets/Cash Receiving's own precedent, which
    // sets no such header, justified by a Payslip's materially higher per-person sensitivity.
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(payslip);
  } catch (error) {
    next(error);
  }
});

/**
 * One PDF endpoint serves both in-app preview and explicit download — never two separate routes
 * (this checkpoint's own architecture review, §8: a second raw-HTML preview route would be an
 * unnecessary second injection surface for zero benefit, since browsers render PDFs natively).
 * `?disposition=attachment` forces a save dialog; the default, `inline`, lets the browser's own
 * PDF viewer render it embedded for preview. Either way the exact same bytes are served — there
 * is no second rendering path.
 */
payslipsRouter.get('/:employeeId/pdf', requirePermission(PERMISSIONS.PAYSLIPS_VIEW), async (req, res, next) => {
  try {
    const cycleId = requireIdParam(req.params.cycleId);
    const employeeId = requireIdParam(req.params.employeeId);
    const disposition = req.query.disposition === 'attachment' ? 'attachment' : 'inline';

    const [cycle, { buffer, entryId, employeeName }] = await Promise.all([
      getPayrollCycle(cycleId),
      generatePayslipPdf(req.currentUser!, cycleId, employeeId, {
        generatedByName: req.currentUser!.name,
        generatedAt: new Date(),
      }),
    ]);

    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'payslip.exported',
      entityType: 'PayrollEntry',
      entityId: entryId,
      metadata: { cycleId, employeeId, disposition },
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    // Period-aware filename (Phase 5 Checkpoint 4).
    const filename = `payslip-${employeeName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${periodSlug(cycle.year, cycle.month)}.pdf`;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
    res.status(200).send(buffer);
  } catch (error) {
    next(error);
  }
});

/**
 * Batch PDF/ZIP generation — Checkpoint 6.3.2. Bounded, stateless streaming: no queue, no job
 * table, no persisted artifact, no `StorageProvider`, no full ZIP ever buffered in this process's
 * memory before sending (`archiver` streams straight into `res` as each PDF completes). Explicitly
 * NOT Phase 5's job — a genuinely company-wide "generate everything" archive is deferred to
 * `BackupPackage`/`StorageProvider` when that phase is built; this endpoint exists for realistic,
 * operator-filtered batches up to `MAX_BATCH_PAYSLIPS_PER_REQUEST` (300).
 *
 * **Request validation, site-scope resolution, the released/non-held gate, and the batch-size cap
 * are all resolved before any response header is sent** — `batchPayslipsSchema.parse` enforces the
 * 300 cap on the request body itself (a 400 before touching the database at all for an
 * over-sized request); `getPayslipsBulk` then resolves the actual eligible set (site-scoped,
 * released/non-held only) — if it comes back empty, this is also still a clean 400, no streaming
 * ever begun.
 *
 * **"Canary" render**: the first eligible Payslip is rendered fully before headers are sent. If
 * Puppeteer itself is broken (not a one-off per-employee data issue), this is where it surfaces —
 * as a clean JSON 500, never a truncated ZIP already in flight. This is the checkpoint's own
 * deliberate answer to "every employee fails before any useful archive content is produced": it
 * can only happen here, before streaming starts, and it always produces an ordinary error
 * response. Once the canary succeeds, at least one real Payslip is guaranteed to reach the client
 * even if every subsequent render in the batch fails.
 *
 * **Partial failures** (any employee after the canary) never abort the batch — caught individually,
 * logged with no Payslip content (employeeId/entryId only, matching this checkpoint's cybersecurity
 * requirement), and listed by employee code/id in a `_summary.txt` appended to the archive, with no
 * stack trace, SQL detail, or filesystem path ever included.
 *
 * **Cancellation**: `res.on('close')` (before the response has actually finished) stops scheduling
 * further chunks — in-flight renders in the current chunk are allowed to finish naturally (Puppeteer
 * has no cheap mid-render abort), but no *new* chunk is started once a disconnect is observed.
 *
 * **Audit**: exactly one `payslip.batch_exported` entry per request, after the batch concludes
 * (success, partial failure, or cancellation) — never one per employee, and never
 * `payslip.exported` for any individual employee in the batch.
 */
payslipsRouter.post('/batch', requirePermission(PERMISSIONS.PAYSLIPS_VIEW), async (req, res, next) => {
  try {
    const cycleId = requireIdParam(req.params.cycleId);
    const body = batchPayslipsSchema.parse(req.body);

    const payslips = await getPayslipsBulk(req.currentUser!, cycleId, { employeeIds: body.employeeIds });

    if (payslips.length === 0) {
      throw badRequest(
        'No eligible Payslips matched the requested selection (released, non-held, and within your assigned sites)',
      );
    }

    const meta = { generatedByName: req.currentUser!.name, generatedAt: new Date() };

    let firstBuffer: Buffer;
    try {
      firstBuffer = await renderPayslipPdfBuffer(payslips[0]!, meta);
    } catch (error) {
      logger.error(
        { error, cycleId, employeeId: payslips[0]!.employeeId },
        'Batch Payslip generation: first-entry render failed — aborting before any response was sent',
      );
      throw badRequest('Payslip generation failed before any document could be produced. Please try again.');
    }

    // The client may have already disconnected during the (potentially slow) canary render,
    // before any header was ever sent — writing headers to a dead response would throw. Nothing
    // was ever streamed and no batch was ever meaningfully started, so this is handled the same
    // as any other pre-stream abort: no ZIP, no audit entry (there is nothing yet to summarize).
    if (res.writableEnded || res.destroyed) {
      return;
    }

    // Everything below this line commits to the response — no further JSON error path exists once
    // headers are sent.
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/zip');
    // Period-aware filename (Phase 5 Checkpoint 4) — every eligible Payslip in this batch belongs
    // to the same cycle (`cycleId` is the one path param the whole request is scoped to), so the
    // canary payslip's own already-resolved `cycleYear`/`cycleMonth` is the period, no extra query.
    const batchFilename = `payslips-${periodSlug(payslips[0]!.cycleYear, payslips[0]!.cycleMonth)}.zip`;
    res.setHeader('Content-Disposition', `attachment; filename="${batchFilename}"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    let cancelled = false;
    // Set once the archive's own readable side has finished producing every ZIP byte
    // (`archive.on('end')` below) — gates the `res.on('close')` handler the same way `completed`
    // used to, just keyed off archive completion instead of response completion (see the ordering
    // fix note above `donePromise` for why).
    let archiveEnded = false;

    // Checkpoint — Payslips Batch Audit Ordering fix: previously `donePromise` resolved on
    // `res.on('finish')`, which (via `archive.pipe(res)`'s default `end: true`) fired as soon as
    // the archive finished streaming, auto-ending the response *before* `recordAuditLog()` below
    // ever ran. That let a client observe a complete, successful response (and a test/consumer
    // immediately query AuditLog) before the `payslip.batch_exported` row was committed — a race
    // that small/fast batches reliably lost (run #89's `payslips.test.ts` failures). `res` is now
    // piped with `end: false`, and this promise resolves on the archive's own `'end'` event (all
    // ZIP bytes produced — a standard, destination-agnostic Node Readable signal, not tied to `res`
    // at all) instead of `res`'s `'finish'`. `res.end()` itself is now called explicitly, once,
    // after `recordAuditLog()` resolves (see below) — so `res`'s `'finish'` genuinely cannot fire
    // until the audit row is already committed. `res.on('close')` (real client disconnect) and
    // `archive.on('error')` are otherwise unchanged from before.
    const donePromise = new Promise<void>((resolve) => {
      archive.on('end', () => {
        archiveEnded = true;
        resolve();
      });
      res.on('close', () => {
        if (!archiveEnded) {
          cancelled = true;
        }
        resolve();
      });
      archive.on('error', (err) => {
        logger.error({ err, cycleId }, 'Archiver error during batch Payslip ZIP');
        cancelled = true;
        resolve();
      });
    });
    archive.on('warning', (err) => {
      logger.warn({ err, cycleId }, 'Archiver warning during batch Payslip ZIP');
    });

    // `end: false` — do not let the pipe auto-end `res` when the archive finishes; `res.end()` is
    // called explicitly below, after the audit write, so response completion can never precede it.
    archive.pipe(res, { end: false });

    const usedNames = new Set<string>();
    const successes: Payslip[] = [payslips[0]!];
    const failures: Payslip[] = [];
    archive.append(firstBuffer, { name: buildArchiveEntryName(payslips[0]!, usedNames) });

    for (const batch of chunk(payslips.slice(1), BATCH_RENDER_CONCURRENCY)) {
      if (cancelled) break;

      const results = await Promise.allSettled(batch.map((payslip) => renderPayslipPdfBuffer(payslip, meta)));
      results.forEach((result, index) => {
        const payslip = batch[index]!;
        if (result.status === 'fulfilled') {
          archive.append(result.value, { name: buildArchiveEntryName(payslip, usedNames) });
          successes.push(payslip);
        } else {
          // No Payslip content (name, salary, banking) is ever logged — employeeId/entryId only,
          // matching this checkpoint's own logging-safety requirement.
          logger.error(
            { error: result.reason, cycleId, employeeId: payslip.employeeId, entryId: payslip.entryId },
            'Batch Payslip generation: per-employee render failed — continuing with the rest of the batch',
          );
          failures.push(payslip);
        }
      });
    }

    if (failures.length > 0) {
      const summaryLines = [
        'Payslip Batch Generation Summary',
        `Cycle: ${cycleId}`,
        `Requested: ${body.employeeIds.length}`,
        `Eligible: ${payslips.length}`,
        `Succeeded: ${successes.length}`,
        `Failed: ${failures.length}`,
        '',
        'The following employees could not be included in this archive:',
        ...failures.map((payslip) => `- ${payslip.identity.employeeCode ?? payslip.employeeId}: PDF generation failed`),
      ];
      archive.append(summaryLines.join('\n'), { name: '_summary.txt' });
    }

    // Only the successful path still needs `finalize()` — a mid-loop disconnect already means
    // there's no point encoding/streaming further ZIP data; `donePromise` still resolves via the
    // `res.on('close')` branch above either way, since `archive.finalize()` was never called and
    // `archive`'s `'end'` will therefore never fire on its own.
    if (!cancelled) {
      archive.finalize().catch((err: unknown) => {
        logger.error({ err, cycleId }, 'Archiver finalize() error during batch Payslip ZIP');
      });
    }

    await donePromise;

    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'payslip.batch_exported',
      entityType: 'PayrollCycle',
      entityId: cycleId,
      metadata: {
        cycleId,
        // The distinct set of sites actually touched by this batch — derived from the resolved,
        // site-scoped eligible set itself (never from client-supplied filter params, which this
        // endpoint doesn't even accept — the frontend already resolves Site/Unit/search filters
        // down to explicit employeeIds before calling this route).
        siteIds: Array.from(new Set(payslips.map((p) => p.identity.siteId))),
        requestedCount: body.employeeIds.length,
        eligibleCount: payslips.length,
        successCount: successes.length,
        failureCount: failures.length,
        // Only a reasonably small failure list is worth recording by identity — beyond that, the
        // count itself is the operationally useful signal, not 300 individual UUIDs in one row.
        failedEmployeeIds: failures.length > 0 && failures.length <= 50 ? failures.map((p) => p.employeeId) : undefined,
        cancelled,
      },
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    // The ordering fix itself: `res` was piped with `end: false`, so nothing has ended the
    // response yet — `res.end()` (and therefore `res`'s own `'finish'`) only happens here, after
    // `recordAuditLog()` above has already resolved. A client cannot observe this response as
    // complete before the `payslip.batch_exported` row is committed. Guarded because a genuine
    // disconnect (`cancelled`) may have already destroyed/ended the connection server-side.
    if (!res.writableEnded && !res.destroyed) {
      res.end();
    }
  } catch (error) {
    next(error);
  }
});
