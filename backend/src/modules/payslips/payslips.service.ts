import type { Prisma, CompanySettings } from '@prisma/client';
import type { SessionUser } from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { notFound } from '../../common/http-error';
import { assertSiteAccess, isMasterAdmin } from '../../common/authz-policy';
import { getPayrollCycle } from '../payroll-processing/payroll-processing.service';
import { getCompanySettings } from '../settings/settings.service';
import { computeEntryCalc } from '../payroll-entry/payroll-entry.service';
import { renderHtmlToPdf } from '../../lib/pdf/render-pdf';
import { renderPayslipHtml, type PayslipPdfMeta } from '../../lib/pdf/templates/payslip';

/**
 * Payslips (Phase 4 Checkpoint 6.1, docs/architecture/database/relationships.md — "Bank Sheets,
 * Cash Receiving... Payslips... have no tables of their own — they are query modules"). Purely
 * derived, read-only, exactly like Bank Sheets/Cash Receiving: every field is computed live from
 * `PayrollEntry`'s own already-frozen columns and the two new identity-snapshot columns added by
 * this same checkpoint's migration, never stored anywhere as a "Payslip" row (Principle 1, Principle
 * 6, Principle 9 — see this checkpoint's own architecture review).
 *
 * **Reused, not reimplemented**: site-scoping (`assertSiteAccess`/`isMasterAdmin`,
 * `employees.service.ts`), the released/non-held query boundary (same shape as
 * `bank-sheets.service.ts`/`cash-receiving.service.ts`), and all money arithmetic
 * (`computeEntryCalc` → `calcNet`, `@payroll/shared`). Nothing here recomputes a monetary figure
 * independently.
 *
 * **Gated by a dedicated `payslips:view` permission**, not `payroll:entry`/`payroll:view`/
 * `bank-sheets:view` — an individual Payslip discloses one employee's own net-salary breakdown, a
 * materially more sensitive per-person view than any aggregate sheet those permissions already
 * gate (this checkpoint's own frozen decision).
 *
 * **Route-agnostic by design**: both functions below take only `currentUser`/`cycleId`/identifiers
 * as arguments and return plain data — no Express `Request`/`Response` anywhere in this file. This
 * is deliberate so the exact same assembly logic can later back a PDF-rendering call (Checkpoint
 * 6.2), a batch/ZIP export (Checkpoint 6.3), and a future Employee Self-Service endpoint scoped to
 * the requesting employee's own CNIC (docs/architecture/overview.md's ESS composition note) without
 * being rewritten for any of them.
 *
 * **Phase 4 Checkpoint 6.2 (Payslip PDF Engine)** adds `generatePayslipPdf()` below — it calls
 * `getPayslip()` for every field and every authorization check, performs no independent Prisma
 * query, and returns a stateless in-memory `Buffer` (`backend/src/lib/pdf/`); nothing is ever
 * persisted or cached.
 *
 * **Accepted, documented gap: `CompanySettings` is read live, never snapshotted**
 * (`docs/architecture/database/access-control.md §19`) — if the company's own name/address ever
 * changes, a regenerated historical Payslip would show the new details, not what was true at
 * release time. Left open deliberately (a company rename is far lower-probability than an
 * employee's, and closing it is real schema scope outside this PDF-engine checkpoint) — not an
 * oversight.
 */

export interface PayslipListItem {
  entryId: string;
  employeeId: string;
  employeeCode: string | null;
  cnic: string | null;
  employeeName: string;
  designation: string;
  siteId: string;
  siteName: string;
}

export interface ListPayslipsResult {
  total: number;
  page: number;
  pageSize: number;
  employees: PayslipListItem[];
}

export interface ListPayslipsFilters {
  siteIds?: string[];
  /** Filters via `workLines.some.unitId` — `PayrollEntry` has no direct `unitId` column (§12a),
   * same reasoning as `BulkPayslipFilters.unitIds` below. Added Checkpoint 6.3.3 so the frontend's
   * Unit filter is genuinely functional, not decorative. */
  unitIds?: string[];
  search?: string;
  page?: number;
  pageSize?: number;
}

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

/**
 * Resolves the site filter exactly like `bank-sheets.service.ts`'s own `resolveSiteIdFilter` does —
 * an explicit `siteIds` list (each independently `assertSiteAccess`-checked, so a manipulated
 * out-of-assignment id 403s rather than silently being dropped) or, when omitted, every site the
 * caller is assigned to (Master User: unrestricted).
 */
async function resolveSiteIdFilter(currentUser: SessionUser, siteIds?: string[]): Promise<string[] | undefined> {
  if (siteIds) {
    for (const siteId of siteIds) assertSiteAccess(currentUser, siteId);
    return siteIds;
  }
  return !isMasterAdmin(currentUser) ? currentUser.siteIds : undefined;
}

/**
 * The picker/list endpoint's query — released, non-held employees only (same boundary as every
 * other Payslip read below), never Draft. Deliberately returns only the handful of fields a
 * picker/search UI needs, not the full assembled Payslip (`getPayslip`, below) — that stays a
 * separate, individually-authorized read per employee.
 */
export async function listPayslips(
  currentUser: SessionUser,
  cycleId: string,
  filters: ListPayslipsFilters,
): Promise<ListPayslipsResult> {
  await getPayrollCycle(cycleId); // 404s cleanly if the cycle doesn't exist
  const siteIdFilter = await resolveSiteIdFilter(currentUser, filters.siteIds);
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE));

  const search = filters.search?.trim();

  const where: Prisma.PayrollEntryWhereInput = {
    cycleId,
    released: true,
    hold: false,
    ...(siteIdFilter && { siteId: { in: siteIdFilter } }),
    ...(filters.unitIds && { workLines: { some: { unitId: { in: filters.unitIds } } } }),
    ...(search && {
      OR: [
        { employeeNameSnapshot: { contains: search, mode: 'insensitive' } },
        { employee: { employeeCode: { contains: search, mode: 'insensitive' } } },
        { employee: { cnic: { contains: search, mode: 'insensitive' } } },
      ],
    }),
  };

  const [total, entries] = await Promise.all([
    prisma.payrollEntry.count({ where }),
    prisma.payrollEntry.findMany({
      where,
      include: { employee: { select: { employeeCode: true, cnic: true } }, site: true },
      orderBy: [{ site: { name: 'asc' } }, { sortOrder: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    total,
    page,
    pageSize,
    employees: entries.map((entry) => ({
      entryId: entry.id,
      employeeId: entry.employeeId,
      employeeCode: entry.employee.employeeCode,
      cnic: entry.employee.cnic,
      // The snapshot, not the live Employee name — a renamed employee must not change what the
      // picker itself displays for an already-released entry (same historical guarantee the
      // assembled Payslip below gives). Non-null-asserted: guaranteed populated for every
      // released entry, same invariant as `getPayslip`'s own assembly below.
      employeeName: entry.employeeNameSnapshot!,
      designation: entry.designation,
      siteId: entry.siteId,
      siteName: entry.site.name,
    })),
  };
}

export interface PayslipCompany {
  companyName: string;
  registeredAddress: string | null;
  phone: string | null;
  email: string | null;
  logoStorageKey: string | null;
}

/** The one place `CompanySettings` maps onto `PayslipCompany` — used by both `getPayslip()` and
 * `getPayslipsBulk()` (Checkpoint 6.3.1) so a batch of 300 Payslips still resolves company details
 * exactly once, not once per row, without two copies of this trivial mapping drifting apart. */
function toPayslipCompany(settings: CompanySettings): PayslipCompany {
  return {
    companyName: settings.companyName,
    registeredAddress: settings.registeredAddress,
    phone: settings.phone,
    email: settings.email,
    logoStorageKey: settings.logoStorageKey,
  };
}

export interface PayslipIdentity {
  employeeCode: string | null;
  employeeName: string;
  fatherName: string | null;
  cnic: string | null;
  designation: string;
  siteId: string;
  siteName: string;
  /** The primary (lowest-`sortOrder`) work line's unit — "correctly derivable" for the common
   * single-work-line case (docs/architecture's own phrasing). A split-by-unit entry's full,
   * per-unit detail is in `workLines` below; this is a convenience field only, never the sole
   * source of unit information. */
  primaryUnitName: string;
}

export interface PayslipBanking {
  bankId: string | null;
  bankCode: string | null;
  branchCode: string | null;
  accountNumber: string | null;
  iban: string | null;
}

export interface PayslipWorkLine {
  unitId: string;
  unitName: string;
  days: string;
  otHours: string;
  otRate: string | null;
  cycleDays: number;
  /** From `calcNet`'s own per-line breakdown — display-only, never independently recomputed. */
  earnedAmount: string;
  otEarned: string;
}

export interface PayslipEarnings {
  grossPay: string;
  /** Sum of every work line's `days` — plain addition of already-stored figures, not a `calcNet`
   * output (calcNet has no single "total days" field of its own, since it works per-line). */
  workingDays: string;
  /** The primary work line's `cycleDays` — the basis `calcNet` itself uses for the leave-rate/
   * daily-rate calculation; not meaningful to sum across lines. */
  cycleDays: number;
  earnedAmount: string;
  /** Sum of every work line's `otHours`, same reasoning as `workingDays`. */
  overtimeHours: string;
  overtimeAmount: string;
  allowance: string;
  leaveDays: string;
  leaveRate: string;
  leaveEarned: string;
  totalEarning: string;
}

export interface PayslipDeductions {
  eobiDeduction: string;
  advanceDeduction: string;
  eidAdvanceDeduction: string;
  fine: string;
  totalDeduction: string;
}

export interface Payslip {
  entryId: string;
  employeeId: string;
  cycleId: string;
  cycleYear: number;
  cycleMonth: number;
  /** ISO `YYYY-MM-DD`, the calendar month's first/last day — derived from `cycleYear`/
   * `cycleMonth`, never stored (Checkpoint 6.2's architecture review: `PayrollCycle` has no
   * explicit period-date columns, and adding one would be schema scope this PDF-engine
   * checkpoint doesn't touch). Matches `reference/PROJECT_SPEC.md`'s frozen "Pay Period: [Start
   * Date] [End Date]" header field. */
  periodStartDate: string;
  periodEndDate: string;
  /** `PayrollEntry.releasedAt`, not `PayrollCycle.releasedAt` — release happens per employee's
   * Project Unit (docs/architecture/workflows/payroll-lifecycle.md), not per whole cycle, so this
   * is always the historically correct release moment for this specific Payslip. Never null: only
   * a released entry is ever returned by this function. */
  releasedAt: string;
  company: PayslipCompany;
  identity: PayslipIdentity;
  banking: PayslipBanking;
  workLines: PayslipWorkLine[];
  earnings: PayslipEarnings;
  deductions: PayslipDeductions;
  netSalary: string;
}

type EntryForPayslip = Prisma.PayrollEntryGetPayload<{
  include: {
    employee: true;
    site: true;
    bank: true;
    workLines: { include: { unit: true } };
    cycle: true;
    releaseSnapshot: true;
  };
}>;

/** First/last calendar day of `year`/`month` as ISO `YYYY-MM-DD` strings — a pure derivation, not
 * a stored value (see the `Payslip.periodStartDate`/`.periodEndDate` doc comment above). Day 0 of
 * the following month is JavaScript `Date`'s own idiom for "the last day of this month," used via
 * `Date.UTC` so this is never affected by the server process's local timezone. */
function computePeriodDates(year: number, month: number): { periodStartDate: string; periodEndDate: string } {
  const pad = (value: number) => String(value).padStart(2, '0');
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    periodStartDate: `${year}-${pad(month)}-01`,
    periodEndDate: `${year}-${pad(month)}-${pad(lastDay)}`,
  };
}

function buildPayslip(entry: EntryForPayslip, company: PayslipCompany): Payslip {
  const calc = computeEntryCalc(entry);
  const primaryLine = [...entry.workLines].sort((a, b) => a.sortOrder - b.sortOrder)[0]!;

  const workingDays = entry.workLines
    .reduce((sum, line) => sum + Number(line.days), 0)
    .toFixed(2);
  const overtimeHours = entry.workLines
    .reduce((sum, line) => sum + Number(line.otHours), 0)
    .toFixed(2);

  return {
    entryId: entry.id,
    employeeId: entry.employeeId,
    cycleId: entry.cycleId,
    cycleYear: entry.cycle.year,
    cycleMonth: entry.cycle.month,
    ...computePeriodDates(entry.cycle.year, entry.cycle.month),
    releasedAt: entry.releasedAt!.toISOString(),
    company,
    identity: {
      employeeCode: entry.employee.employeeCode,
      // Snapshots, never the live Employee record — the historical-correctness guarantee this
      // checkpoint's migration exists to provide (Principle 2/9). Non-null-asserted: every
      // released entry has both populated, either at creation (`createPayrollEntry`) or bootstrap
      // carry-forward (`createPayrollCycle`), or by this checkpoint's own backfill migration for
      // rows that predate it — same guaranteed-by-construction invariant as `releasedAt!` above.
      // CNIC/Employee Code are deliberately NOT snapshotted (this checkpoint's own frozen scope)
      // and remain live reads.
      employeeName: entry.employeeNameSnapshot!,
      fatherName: entry.fatherNameSnapshot,
      cnic: entry.employee.cnic,
      designation: entry.designation,
      siteId: entry.siteId,
      siteName: entry.site.name,
      primaryUnitName: primaryLine.unit.name,
    },
    banking: {
      bankId: entry.bankId,
      bankCode: entry.bank?.code ?? null,
      branchCode: entry.branchCode,
      accountNumber: entry.accountNumber,
      iban: entry.iban,
    },
    // `calc.workLines[i]` corresponds to `entry.workLines[i]` exactly — `computeEntryCalc` maps
    // `entry.workLines` into calcNet's input in the same given order, and calcNet iterates and
    // returns its per-line breakdown in that same order, never reordering (`shared/src/lib/
    // calc-net.ts`). Zipped by index rather than a second lookup structure.
    workLines: entry.workLines.map((line, index) => {
      const lineCalc = calc.workLines[index]!;
      return {
        unitId: line.unitId,
        unitName: line.unit.name,
        days: line.days.toString(),
        otHours: line.otHours.toString(),
        otRate: line.otRate?.toString() ?? null,
        cycleDays: line.cycleDays,
        earnedAmount: lineCalc.earnedAmount,
        otEarned: lineCalc.otEarned,
      };
    }),
    earnings: {
      grossPay: entry.grossPay.toString(),
      workingDays,
      cycleDays: primaryLine.cycleDays,
      earnedAmount: calc.earnedAmount,
      overtimeHours,
      overtimeAmount: calc.otEarned,
      allowance: entry.allowance.toString(),
      leaveDays: entry.leaveDays.toString(),
      leaveRate: calc.effectiveLeaveRate,
      leaveEarned: calc.leaveEarned,
      totalEarning: calc.totalEarning,
    },
    deductions: {
      eobiDeduction: calc.eobiDeduction,
      advanceDeduction: entry.advanceDeduction.toString(),
      eidAdvanceDeduction: entry.eidAdvanceDeduction.toString(),
      fine: entry.fine.toString(),
      totalDeduction: calc.totalDeduction,
    },
    netSalary: calc.netSalary,
  };
}

/**
 * Assembles one employee's Payslip for one cycle — released and non-held only (never Draft,
 * regardless of caller permission; this is a server-side invariant, never trusted from the
 * client). Site-scoped identically to every other read in this module. Does not itself write an
 * `AuditLog` entry — the caller (the route handler, matching `bank_sheet.export`'s own precedent)
 * does, since only the route knows the request's IP/user-agent context.
 */
export async function getPayslip(currentUser: SessionUser, cycleId: string, employeeId: string): Promise<Payslip> {
  await getPayrollCycle(cycleId); // 404s cleanly if the cycle doesn't exist

  const entry = await prisma.payrollEntry.findUnique({
    where: { cycleId_employeeId: { cycleId, employeeId } },
    include: {
      employee: true,
      site: true,
      bank: true,
      workLines: { include: { unit: true }, orderBy: { sortOrder: 'asc' } },
      cycle: true,
      releaseSnapshot: true,
    },
  });

  if (!entry) {
    throw notFound('Payslip not found for this employee in this payroll cycle');
  }

  // Released/non-held is a hard server-side gate, never inferred from anything client-supplied —
  // a Draft or held entry 404s exactly like a nonexistent one, revealing nothing about which case
  // it was (this checkpoint's cybersecurity baseline: no detail in error messages).
  if (!entry.released || entry.hold) {
    throw notFound('Payslip not found for this employee in this payroll cycle');
  }

  assertSiteAccess(currentUser, entry.siteId);

  const settings = await getCompanySettings();
  return buildPayslip(entry, toPayslipCompany(settings));
}

export interface BulkPayslipFilters {
  siteIds?: string[];
  unitIds?: string[];
  employeeIds?: string[];
  search?: string;
}

/**
 * Bulk Payslip assembly — Checkpoint 6.3.1. The one place a caller needing *many* Payslips at once
 * (the batch PDF/ZIP endpoint, Checkpoint 6.3.2) gets them, instead of calling `getPayslip()` in a
 * loop (which would issue one `findUnique` per employee — a genuine N+1 this function exists to
 * avoid). Issues exactly one `PayrollEntry` query and one `CompanySettings` read regardless of how
 * many employees match, then maps every row through the exact same `buildPayslip()` function
 * `getPayslip()` itself calls — there is only one Payslip-assembly implementation in this codebase,
 * this function does not duplicate `calcNet`, the released/hold gate, the identity-snapshot
 * reads, or any formatting rule.
 *
 * **Site-scoping is enforced twice, deliberately redundantly, for the same reason
 * `getPayslip()`'s does**: `resolveSiteIdFilter` both validates any explicitly-requested `siteIds`
 * against the caller's own assignment (a manipulated out-of-scope id throws) *and* is always
 * applied to the query's `where` clause — so even an explicit `employeeIds` list containing an id
 * outside the caller's site scope is silently excluded from the result, never processed. This is
 * the server-side authority the frontend's own "select all" checkbox must not be trusted to
 * provide (Checkpoint 6.3's own architecture review).
 *
 * `unitIds` filters via `workLines.some.unitId` — `PayrollEntry` itself has no direct `unitId`
 * column (attendance units live on the child `PayrollEntryWorkLine`, §12a), so "this employee's
 * cycle touches unit X" is necessarily a `some` relation filter, not a plain equality.
 */
export async function getPayslipsBulk(
  currentUser: SessionUser,
  cycleId: string,
  filters: BulkPayslipFilters,
): Promise<Payslip[]> {
  await getPayrollCycle(cycleId); // 404s cleanly if the cycle doesn't exist
  const siteIdFilter = await resolveSiteIdFilter(currentUser, filters.siteIds);
  const search = filters.search?.trim();

  const where: Prisma.PayrollEntryWhereInput = {
    cycleId,
    released: true,
    hold: false,
    ...(siteIdFilter && { siteId: { in: siteIdFilter } }),
    ...(filters.employeeIds && { employeeId: { in: filters.employeeIds } }),
    ...(filters.unitIds && { workLines: { some: { unitId: { in: filters.unitIds } } } }),
    ...(search && {
      OR: [
        { employeeNameSnapshot: { contains: search, mode: 'insensitive' } },
        { employee: { employeeCode: { contains: search, mode: 'insensitive' } } },
        { employee: { cnic: { contains: search, mode: 'insensitive' } } },
      ],
    }),
  };

  // The one query this whole function is built on — same include shape as `getPayslip()`'s own
  // single-entry `findUnique`, just a `findMany` instead, so the exact same `buildPayslip()` call
  // works unchanged for either one row or many.
  const entries = await prisma.payrollEntry.findMany({
    where,
    include: {
      employee: true,
      site: true,
      bank: true,
      workLines: { include: { unit: true }, orderBy: { sortOrder: 'asc' } },
      cycle: true,
      releaseSnapshot: true,
    },
    orderBy: [{ site: { name: 'asc' } }, { sortOrder: 'asc' }],
  });

  const settings = await getCompanySettings();
  const company = toPayslipCompany(settings);

  return entries.map((entry) => buildPayslip(entry, company));
}

export interface PayslipPdfResult {
  buffer: Buffer;
  /** Echoed back so the route can write its `payslip.exported` audit entry against the same
   * `entityId` the JSON route's `payslip.viewed` entry uses, and build a filename — without a
   * second `getPayslip()` call/Prisma round trip. */
  entryId: string;
  employeeName: string;
}

/**
 * Renders one employee's Payslip to PDF — Checkpoint 6.2. Calls `getPayslip()` above for every
 * authorization check and every field of data (permission is enforced by the caller via
 * `requirePermission`, same as the JSON route; site-scoping and the released/non-held gate are
 * `getPayslip()`'s own, inherited automatically); this function performs **no independent Prisma
 * query** and **no independent calculation** — it only turns the already-assembled `Payslip` into
 * HTML (`renderPayslipHtml`) and then into a PDF (`renderHtmlToPdf`).
 *
 * Stateless: returns an in-memory `Buffer` only. Nothing is written to disk, nothing is cached,
 * nothing is persisted — regenerating from the same `(cycleId, employeeId)` always re-renders
 * from scratch (this checkpoint's own architecture review, §2).
 */
export async function generatePayslipPdf(
  currentUser: SessionUser,
  cycleId: string,
  employeeId: string,
  meta: PayslipPdfMeta,
): Promise<PayslipPdfResult> {
  const payslip = await getPayslip(currentUser, cycleId, employeeId);
  const buffer = await renderPayslipPdfBuffer(payslip, meta);
  return { buffer, entryId: payslip.entryId, employeeName: payslip.identity.employeeName };
}

/**
 * Renders one already-assembled `Payslip` to a PDF `Buffer` — the thin two-call wrapper
 * (`renderPayslipHtml` then `renderHtmlToPdf`) both `generatePayslipPdf()` above and the batch
 * PDF/ZIP route (Checkpoint 6.3.2) share, so there is exactly one place that turns a `Payslip`
 * into bytes. The batch route calls this directly against `Payslip` objects already resolved by
 * `getPayslipsBulk()` — never `generatePayslipPdf()` itself, which would re-run `getPayslip()`
 * (and its own Prisma query) once per employee, reintroducing the exact N+1 this checkpoint exists
 * to avoid.
 */
export async function renderPayslipPdfBuffer(payslip: Payslip, meta: PayslipPdfMeta): Promise<Buffer> {
  const html = renderPayslipHtml(payslip, meta);
  return renderHtmlToPdf(html);
}
