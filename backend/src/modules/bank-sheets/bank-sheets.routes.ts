import { Router } from 'express';
import { PERMISSIONS } from '@payroll/shared';
import { requireAuth } from '../../common/middleware/attach-user';
import { requirePermission } from '../../common/middleware/require-permission';
import { badRequest } from '../../common/http-error';
import { recordAuditLog } from '../audit-log/audit-log.service';
import { getPayrollCycle } from '../payroll-processing/payroll-processing.service';
import { exportBankSheetToCsv, exportBankSheetToXlsx, getBankSheet } from './bank-sheets.service';

function requireIdParam(id: string | undefined): string {
  if (!id) throw badRequest('id parameter is required');
  return id;
}

function requireBankIdQuery(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) {
    throw badRequest('A ?bankId= query parameter is required (a Bank id, or "cash")');
  }
  return raw;
}

function parseSiteIdsQuery(raw: unknown): string[] | undefined {
  if (!raw) return undefined;
  const values = Array.isArray(raw) ? raw : [raw];
  return values.flatMap((value) => String(value).split(',')).filter(Boolean);
}

/** Mounted at /api/v1/payroll-cycles/:cycleId/bank-sheet — Finance's (or Master User's) derived,
 * read-only Bank Sheet view (Phase 4 Checkpoint 3, docs/architecture/database/relationships.md).
 * Gated exclusively by `bank-sheets:view`; Payroll Staff never holds it, per this checkpoint's own
 * explicit permission scope. Mounted ahead of payrollCyclesRouter's own /:id route, same reasoning
 * as :cycleId/entries and :cycleId/units before it. */
export const bankSheetRouter = Router({ mergeParams: true });

bankSheetRouter.use(requireAuth);

bankSheetRouter.get('/', requirePermission(PERMISSIONS.BANK_SHEETS_VIEW), async (req, res, next) => {
  try {
    const cycleId = requireIdParam(req.params.cycleId);
    const bankFilter = requireBankIdQuery(req.query.bankId);
    const siteIds = parseSiteIdsQuery(req.query.siteIds);
    const sheet = await getBankSheet(req.currentUser!, cycleId, bankFilter, siteIds);
    res.status(200).json(sheet);
  } catch (error) {
    next(error);
  }
});

/** Writes its own summary `AuditLog` entry per export, mirroring Payroll Entry export's own
 * `payroll_entry.export` precedent — one entry per operation, not one per row. */
bankSheetRouter.get('/export', requirePermission(PERMISSIONS.BANK_SHEETS_VIEW), async (req, res, next) => {
  try {
    const cycleId = requireIdParam(req.params.cycleId);
    const bankFilter = requireBankIdQuery(req.query.bankId);
    const siteIds = parseSiteIdsQuery(req.query.siteIds);
    const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';

    const [cycle, { buffer, rowCount, bankLabel }] = await Promise.all([
      getPayrollCycle(cycleId),
      format === 'xlsx'
        ? exportBankSheetToXlsx(req.currentUser!, cycleId, bankFilter, siteIds)
        : exportBankSheetToCsv(req.currentUser!, cycleId, bankFilter, siteIds),
    ]);

    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'bank_sheet.export',
      entityType: 'PayrollCycle',
      entityId: cycleId,
      metadata: { cycleId, bankFilter, bankLabel, siteIds: siteIds ?? null, format, rowCount },
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    // Period-aware filename (Phase 5 Checkpoint 4) — matches Cash Receiving's own existing
    // convention exactly, so two different historical periods' exports are never indistinguishable
    // on disk.
    const period = `${cycle.year}-${String(cycle.month).padStart(2, '0')}`;
    const filename = `bank-sheet-${bankLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${period}.${format}`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader(
      'Content-Type',
      format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv',
    );
    res.status(200).send(buffer);
  } catch (error) {
    next(error);
  }
});
