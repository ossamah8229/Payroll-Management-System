import { Router } from 'express';
import { PERMISSIONS } from '@payroll/shared';
import { requireAuth } from '../../common/middleware/attach-user';
import { requirePermission } from '../../common/middleware/require-permission';
import { badRequest } from '../../common/http-error';
import { recordAuditLog } from '../audit-log/audit-log.service';
import { getCompanySettings } from '../settings/settings.service';
import { getPayrollCycle } from '../payroll-processing/payroll-processing.service';
import {
  exportCashReceivingSheetToCsv,
  exportCashReceivingSheetToXlsx,
  getCashReceivingSheet,
} from './cash-receiving.service';

function requireIdParam(id: string | undefined): string {
  if (!id) throw badRequest('id parameter is required');
  return id;
}

function parseSiteIdsQuery(raw: unknown): string[] | undefined {
  if (!raw) return undefined;
  const values = Array.isArray(raw) ? raw : [raw];
  return values.flatMap((value) => String(value).split(',')).filter(Boolean);
}

/** Mounted at /api/v1/payroll-cycles/:cycleId/cash-receiving — Finance's (or Master User's)
 * derived, read-only Cash Receiving Sheet view (Phase 4 Checkpoint 4). **Gated by the existing
 * `bank-sheets:view` permission, reused rather than a new permission** — approved architecture
 * decision: Finance and Master User already see both documents, Payroll Staff sees neither. Mounted
 * ahead of payrollCyclesRouter's own /:id route, same reasoning as :cycleId/bank-sheet before it. */
export const cashReceivingRouter = Router({ mergeParams: true });

cashReceivingRouter.use(requireAuth);

cashReceivingRouter.get('/', requirePermission(PERMISSIONS.BANK_SHEETS_VIEW), async (req, res, next) => {
  try {
    const cycleId = requireIdParam(req.params.cycleId);
    const siteIds = parseSiteIdsQuery(req.query.siteIds);
    const sheet = await getCashReceivingSheet(req.currentUser!, cycleId, siteIds);
    res.status(200).json(sheet);
  } catch (error) {
    next(error);
  }
});

/** Writes its own summary `AuditLog` entry per export, mirroring Bank Sheet export's own
 * `bank_sheet.export` precedent — one entry per operation, not one per row. Viewing is not
 * audited, matching Bank Sheets' own asymmetry exactly. */
cashReceivingRouter.get('/export', requirePermission(PERMISSIONS.BANK_SHEETS_VIEW), async (req, res, next) => {
  try {
    const cycleId = requireIdParam(req.params.cycleId);
    const siteIds = parseSiteIdsQuery(req.query.siteIds);
    const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';

    const [cycle, companySettings] = await Promise.all([getPayrollCycle(cycleId), getCompanySettings()]);
    const cycleLabel = new Date(cycle.year, cycle.month - 1).toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
    });

    const { buffer, rowCount } =
      format === 'xlsx'
        ? await exportCashReceivingSheetToXlsx(
            req.currentUser!,
            cycleId,
            {
              companyName: companySettings.companyName,
              cycleLabel,
              generatedByName: req.currentUser!.name,
              generatedAt: new Date(),
            },
            siteIds,
          )
        : await exportCashReceivingSheetToCsv(
            req.currentUser!,
            cycleId,
            {
              companyName: companySettings.companyName,
              cycleLabel,
              generatedByName: req.currentUser!.name,
              generatedAt: new Date(),
            },
            siteIds,
          );

    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'cash_receiving_sheet.export',
      entityType: 'PayrollCycle',
      entityId: cycleId,
      metadata: { cycleId, siteIds: siteIds ?? null, format, rowCount },
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    const filename = `cash-receiving-sheet-${cycle.year}-${String(cycle.month).padStart(2, '0')}.${format}`;
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
