import { Router } from 'express';
import { PERMISSIONS } from '@payroll/shared';
import { requireAuth } from '../../common/middleware/attach-user';
import { requirePermission } from '../../common/middleware/require-permission';
import { badRequest } from '../../common/http-error';
import { recordAuditLog } from '../audit-log/audit-log.service';
import { generatePayslipPdf, getPayslip, listPayslips } from './payslips.service';

function requireIdParam(id: string | undefined): string {
  if (!id) throw badRequest('id parameter is required');
  return id;
}

function parseSiteIdsQuery(raw: unknown): string[] | undefined {
  if (!raw) return undefined;
  const values = Array.isArray(raw) ? raw : [raw];
  return values.flatMap((value) => String(value).split(',')).filter(Boolean);
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
    const siteIds = parseSiteIdsQuery(req.query.siteIds);
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const page = req.query.page ? Number(req.query.page) : undefined;
    const pageSize = req.query.pageSize ? Number(req.query.pageSize) : undefined;

    // Deliberately no AuditLog entry here (this checkpoint's own frozen decision) — the picker/
    // list view discloses only names/codes already visible in Payroll Entry/Bank Sheets/Cash
    // Receiving to the same permission holders; only the single assembled Payslip below (the
    // actual net-salary disclosure) is audited.
    const result = await listPayslips(req.currentUser!, cycleId, { siteIds, search, page, pageSize });
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

    const { buffer, entryId, employeeName } = await generatePayslipPdf(req.currentUser!, cycleId, employeeId, {
      generatedByName: req.currentUser!.name,
      generatedAt: new Date(),
    });

    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'payslip.exported',
      entityType: 'PayrollEntry',
      entityId: entryId,
      metadata: { cycleId, employeeId, disposition },
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    const filename = `payslip-${employeeName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
    res.status(200).send(buffer);
  } catch (error) {
    next(error);
  }
});
