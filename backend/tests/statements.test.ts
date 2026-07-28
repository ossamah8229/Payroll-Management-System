import request from 'supertest';
import { Decimal } from 'decimal.js';
import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { searchStatementEmployees } from '../src/modules/statements/statements.service';
import { loadSessionUser } from '../src/modules/auth/auth.service';
import { closeBrowser } from '../src/lib/pdf/browser';
import * as renderPdfModule from '../src/lib/pdf/render-pdf';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

/** Pre-Deployment Reliability Checkpoint precedent (`payslips.test.ts`'s own identical comment) —
 * this file now also drives real Puppeteer PDF generation (Phase 7B Checkpoint 1's own PDF export
 * tests, below), the same real-browser-under-shared-host-contention risk that checkpoint already
 * measured and responded to for Payslips. Applied here proactively rather than waiting for a
 * reproduced flake, since the cause (a shared, resource-constrained host) applies identically to
 * any suite that launches the same singleton Chromium instance. */
jest.setTimeout(45000);

/**
 * Phase 7A Checkpoint 1 — canonical Employee Statement of Account ledger
 * (`backend/src/modules/statements/`). Drives the real HTTP stack end to end wherever a checkpoint
 * this deep in the payroll lifecycle already exists to produce the fixture (cycle creation, release,
 * corrections, advances) — matching `payroll-release-recovery-accounting.test.ts`'s own established
 * precedent — and falls back to direct-Prisma fixtures only for states no real workflow can produce
 * on demand (the legacy negative-payroll anomaly, which predates the current architecture by
 * construction).
 */
describe('Employee Statement of Account — canonical ledger (Phase 7A Checkpoint 1)', () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
    // Phase 7B Checkpoint 1 — this file now also launches the shared Puppeteer singleton (PDF
    // export tests, below); closing it here matches `browser.ts`'s own documented contract ("called
    // from PDF-related test suites' own afterAll, so neither a real process exit nor a Jest run
    // leaves an orphaned Chrome process") and mirrors `payslips.test.ts`'s identical call exactly.
    await closeBrowser();
  });

  // --- Agents --------------------------------------------------------------------------------

  async function masterAdminAgent(email: string) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.MASTER_ADMIN,
      permissionKeys: [
        PERMISSIONS.PAYROLL_CYCLE_MANAGE,
        PERMISSIONS.PAYROLL_ENTRY,
        PERMISSIONS.PAYROLL_RELEASE,
        PERMISSIONS.CORRECTIONS_APPROVE,
        PERMISSIONS.ADVANCES_MANAGE,
        PERMISSIONS.STATEMENTS_VIEW,
      ],
    });
  }

  async function payrollStaffAgent(email: string, siteIds: string[], permissionKeys: string[] = [PERMISSIONS.STATEMENTS_VIEW]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.PAYROLL_STAFF,
      permissionKeys,
      siteIds,
    });
  }

  // --- Fixtures --------------------------------------------------------------------------------

  let cycleCounter = 0;
  function nextCycleYearMonth(): { year: number; month: number } {
    cycleCounter += 1;
    return { year: 2900 + Math.floor(cycleCounter / 12), month: (cycleCounter % 12) + 1 };
  }

  async function makeSiteWithUnit(name: string) {
    const site = await prisma.projectSite.create({ data: { name } });
    const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} Unit` } });
    return { site, unit };
  }

  type Agent = Awaited<ReturnType<typeof masterAdminAgent>>;

  async function makeDraftCycle(admin: Agent, override?: { year: number; month: number }) {
    const { year, month } = override ?? nextCycleYearMonth();
    const res = await admin.agent.post('/api/v1/payroll-cycles').set('x-csrf-token', admin.csrfToken).send({ year, month });
    if (res.status !== 201) throw new Error(`cycle create failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.cycle as { id: string; year: number; month: number };
  }

  async function getEntry(admin: Agent, cycleId: string, employeeId: string) {
    const res = await admin.agent.get(`/api/v1/payroll-cycles/${cycleId}/entries?employeeId=${employeeId}`);
    if (res.status !== 200 || !res.body.entries?.length) {
      throw new Error(`entry not found: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body.entries[0] as { id: string; version: number; calc: { netSalary: string } };
  }

  /** Sets `allowance` (pure additive earning) and `eobiApplicable: false` so this entry's net
   * salary equals exactly `amount`, independent of default work-line/EOBI math — same fixture
   * technique `payroll-release-recovery-accounting.test.ts` already established. */
  async function setNetSalary(admin: Agent, entryId: string, version: number, amount: string) {
    const res = await admin.agent
      .patch(`/api/v1/payroll-entries/${entryId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version, eobiApplicable: false, allowance: amount });
    if (res.status !== 200) throw new Error(`setNetSalary failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.entry as { id: string; version: number; calc: { netSalary: string } };
  }

  async function releaseUnit(admin: Agent, cycleId: string, unitId: string) {
    const res = await admin.agent.post(`/api/v1/payroll-cycles/${cycleId}/units/${unitId}/release`).set('x-csrf-token', admin.csrfToken).send({});
    if (res.status !== 201) throw new Error(`release failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as { releasedEntryCount: number; noPayDueCount: number; recoveryDueCount: number; blockedCount: number };
  }

  async function finalizeCycle(admin: Agent, cycleId: string) {
    const res = await admin.agent.post(`/api/v1/payroll-cycles/${cycleId}/finalize`).set('x-csrf-token', admin.csrfToken).send({});
    if (res.status !== 200) throw new Error(`finalize failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  async function rollover(admin: Agent, cycleId: string) {
    const res = await admin.agent.post(`/api/v1/payroll-cycles/${cycleId}/archive-and-create-next`).set('x-csrf-token', admin.csrfToken).send({});
    if (res.status !== 201) throw new Error(`rollover failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.newCycle as { id: string; year: number; month: number };
  }

  async function makeAdjustmentType(code: string) {
    return prisma.adjustmentType.create({ data: { code: `TEST_${code}`, label: code } });
  }

  /** `approveCorrectionRequest` rejects a requester approving their own request
   * (`SELF_REVIEW_NOT_ALLOWED`) — `requester` and `approver` must therefore be two distinct users,
   * matching the real Payroll Staff-proposes / Master-User-decides split this workflow models. */
  async function submitAndApproveCorrection(
    requester: Agent,
    approver: Agent,
    entryId: string,
    field: string,
    proposedNewValue: string,
    adjustmentTypeId: string,
    approveExtra: { paymentTiming?: 'IMMEDIATE' | 'DEFERRED'; recoveryInstallmentAmount?: string } = {},
  ) {
    const reqRes = await requester.agent
      .post(`/api/v1/payroll-entries/${entryId}/correction-requests`)
      .set('x-csrf-token', requester.csrfToken)
      .send({ field, proposedNewValue, adjustmentTypeId, reason: 'Statement checkpoint test correction' });
    if (reqRes.status !== 201) throw new Error(`correction request failed: ${reqRes.status} ${JSON.stringify(reqRes.body)}`);
    const requestId = reqRes.body.correctionRequest.id as string;

    const approveRes = await approver.agent
      .post(`/api/v1/correction-requests/${requestId}/approve`)
      .set('x-csrf-token', approver.csrfToken)
      .send(approveExtra);
    if (approveRes.status !== 200) throw new Error(`approve failed: ${approveRes.status} ${JSON.stringify(approveRes.body)}`);
    return approveRes.body as { correction: { id: string }; balanceAdjustment: { id: string; type: string; amount: string } };
  }

  /** `period` is the *scheduled deduction* period (`originalPeriod`) — set far in the future to
   * deliberately avoid immediate materialization. `dateGiven` defaults to the same period (the
   * common case, used by most fixtures) but can be overridden independently via
   * `overrides.dateGiven` for a fixture that needs "given now, scheduled to deduct much later." */
  async function createAdvance(
    admin: Agent,
    employeeId: string,
    period: { year: number; month: number },
    overrides: Partial<{
      type: 'LOAN' | 'EID_ADVANCE';
      totalAmount: string;
      repaymentType: 'FULL_DEDUCTION' | 'INSTALLMENT';
      dateGiven: string;
    }> = {},
  ) {
    const res = await admin.agent
      .post('/api/v1/advances')
      .set('x-csrf-token', admin.csrfToken)
      .send({
        employeeId,
        type: overrides.type ?? 'LOAN',
        totalAmount: overrides.totalAmount ?? '1000',
        dateGiven: overrides.dateGiven ?? `${period.year}-${String(period.month).padStart(2, '0')}-01`,
        repaymentType: overrides.repaymentType ?? 'FULL_DEDUCTION',
        originalPeriod: period,
      });
    if (res.status !== 201) throw new Error(`createAdvance failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.advance as { id: string; status: string; outstandingBalance: string };
  }

  /** Row counts across every table a Statement read could conceivably (but must never) mutate —
   * used to prove a `GET` is genuinely read-only, not merely "didn't throw." */
  async function snapshotFinancialRowCounts(employeeId: string) {
    const [payrollEntries, corrections, balanceAdjustments, settlements, correctionPayments, advances] = await Promise.all([
      prisma.payrollEntry.count({ where: { employeeId } }),
      prisma.correction.count({ where: { payrollEntry: { employeeId } } }),
      prisma.balanceAdjustment.count({ where: { employeeId } }),
      prisma.balanceAdjustmentSettlement.count({ where: { balanceAdjustment: { employeeId } } }),
      prisma.correctionPayment.count({ where: { employeeId } }),
      prisma.advance.count({ where: { employeeId } }),
    ]);
    return { payrollEntries, corrections, balanceAdjustments, settlements, correctionPayments, advances };
  }

  async function getStatement(agent: Agent, employeeId: string, query = '') {
    return agent.agent.get(`/api/v1/employees/${employeeId}/statement${query}`);
  }

  // ============================================================================================
  // A/B — normal payroll outcomes
  // ============================================================================================

  it('A: represents a normal released cycle as an informational Net Salary Paid row with no balance movement', async () => {
    const admin = await masterAdminAgent('stmt-paid-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Stmt Paid Site');
    const employee = await prisma.employee.create({
      data: { name: 'Paid Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });
    const cycle = await makeDraftCycle(admin);
    const entry = await getEntry(admin, cycle.id, employee.id);
    await setNetSalary(admin, entry.id, entry.version, '5000');
    await releaseUnit(admin, cycle.id, unit.id);

    const res = await getStatement(admin, employee.id);
    expect(res.status).toBe(200);
    const paidEntry = res.body.entries.find((e: { kind: string }) => e.kind === 'CYCLE_PAID');
    expect(paidEntry).toBeDefined();
    expect(paidEntry.isInformational).toBe(true);
    expect(paidEntry.movement).toBeNull();
    expect(paidEntry.description).toContain('5000.00');
    expect(res.body.closingBalances).toEqual({ payableOutstanding: '0.00', recoveryOutstanding: '0.00', advanceOutstanding: '0.00' });
  });

  it('B: represents NO_PAY_DUE as an informational row with no amount and no movement', async () => {
    const admin = await masterAdminAgent('stmt-nopay-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Stmt NoPay Site');
    const employee = await prisma.employee.create({
      data: { name: 'NoPay Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });
    const cycle = await makeDraftCycle(admin);
    const entry = await getEntry(admin, cycle.id, employee.id);
    await setNetSalary(admin, entry.id, entry.version, '0');
    const release = await releaseUnit(admin, cycle.id, unit.id);
    expect(release.noPayDueCount).toBe(1);

    const res = await getStatement(admin, employee.id);
    const noPayEntry = res.body.entries.find((e: { kind: string }) => e.kind === 'CYCLE_NO_PAY_DUE');
    expect(noPayEntry).toBeDefined();
    expect(noPayEntry.isInformational).toBe(true);
    expect(noPayEntry.movement).toBeNull();
    expect(noPayEntry.description).not.toMatch(/PKR/); // must never look like a payment
    expect(res.body.closingBalances.payableOutstanding).toBe('0.00');
    expect(res.body.closingBalances.recoveryOutstanding).toBe('0.00');
  });

  // ============================================================================================
  // C/D — negative payroll recovery, including the three-case carried-forward accounting
  // ============================================================================================

  it('C: represents RECOVERY_DUE as an informational cycle row paired with a real Recoverable-increasing BalanceAdjustment row', async () => {
    const admin = await masterAdminAgent('stmt-recdue-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Stmt RecDue Site');
    const employee = await prisma.employee.create({
      data: { name: 'RecDue Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });
    const cycle = await makeDraftCycle(admin);
    // Default 0-work-day entry nets exactly -400 (0 earning, 400 EOBI deduction).
    const entry = await getEntry(admin, cycle.id, employee.id);
    expect(entry.calc.netSalary).toBe('-400.00');
    const release = await releaseUnit(admin, cycle.id, unit.id);
    expect(release.recoveryDueCount).toBe(1);

    const res = await getStatement(admin, employee.id);
    const recDueEntry = res.body.entries.find((e: { kind: string }) => e.kind === 'CYCLE_RECOVERY_DUE');
    expect(recDueEntry).toBeDefined();
    expect(recDueEntry.isInformational).toBe(true);
    expect(recDueEntry.movement).toBeNull();

    const createdEntries = res.body.entries.filter((e: { kind: string }) => e.kind === 'BALANCE_ADJUSTMENT_CREATED');
    expect(createdEntries).toHaveLength(1);
    expect(createdEntries[0].movement).toEqual({ balance: 'RECOVERABLE', direction: 'INCREASE', amount: '400.00' });
    expect(createdEntries[0].isInformational).toBe(false);
    expect(res.body.closingBalances.recoveryOutstanding).toBe('400.00');

    // Never a second, independent recovery representation for the same event.
    expect(res.body.entries.filter((e: { kind: string }) => e.kind === 'CYCLE_RECOVERY_DUE')).toHaveLength(1);
  });

  // Each of the three cases below is its own `it()` (not sub-blocks of one test) so `beforeEach`
  // gives each a fully clean slate — a shared employee bootstrap-sweep would otherwise pull a
  // *previous* case's still-unresolved employee into a *later* case's cycle, blocking Finalize.

  it('D1: three-case carried-forward recovery accounting — partial absorption across cycles', async () => {
    const admin = await masterAdminAgent('stmt-3case-partial-admin@test.local');
    // --- Case: partial absorption across cycles (400 recovery -> 300 partial -> 100 final) -----
    {
      const { site, unit } = await makeSiteWithUnit('Test Site Stmt 3case Partial Site');
      const employee = await prisma.employee.create({
        data: { name: '3case Partial Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
      });
      const cycle1 = await makeDraftCycle(admin);
      await releaseUnit(admin, cycle1.id, unit.id); // -400 -> RECOVERY_DUE, BalanceAdjustment(400) created

      await finalizeCycle(admin, cycle1.id);
      const cycle2 = await rollover(admin, cycle1.id);
      const bootstrapped2 = await getEntry(admin, cycle2.id, employee.id);
      const entry2 = await setNetSalary(admin, bootstrapped2.id, bootstrapped2.version, '300'); // before-recovery earnings
      expect(entry2.calc.netSalary).toBe('-100.00'); // 300 - 400 materialized recovery
      const release2 = await releaseUnit(admin, cycle2.id, unit.id);
      expect(release2.noPayDueCount).toBe(1);
      expect(release2.recoveryDueCount).toBe(0); // no NEW recovery

      await finalizeCycle(admin, cycle2.id);
      const cycle3 = await rollover(admin, cycle2.id);
      const bootstrapped3 = await getEntry(admin, cycle3.id, employee.id);
      const entry3 = await setNetSalary(admin, bootstrapped3.id, bootstrapped3.version, '500');
      expect(entry3.calc.netSalary).toBe('400.00'); // 500 - 100 remaining
      await releaseUnit(admin, cycle3.id, unit.id);

      const res = await getStatement(admin, employee.id, '?fromCycleId=' + cycle1.id + '&toCycleId=' + cycle3.id);
      expect(res.status).toBe(200);
      const settlements = res.body.entries.filter((e: { kind: string }) => e.kind === 'BALANCE_ADJUSTMENT_SETTLED');
      expect(settlements).toHaveLength(2);
      expect(settlements[0].movement).toEqual({ balance: 'RECOVERABLE', direction: 'DECREASE', amount: '300.00' });
      expect(settlements[1].movement).toEqual({ balance: 'RECOVERABLE', direction: 'DECREASE', amount: '100.00' });
      expect(res.body.closingBalances.recoveryOutstanding).toBe('0.00');
      // Exactly one BalanceAdjustment ever created for this employee (no duplicate/second recovery).
      expect(res.body.entries.filter((e: { kind: string }) => e.kind === 'BALANCE_ADJUSTMENT_CREATED')).toHaveLength(1);
    }
  });

  it('D2: three-case carried-forward recovery accounting — exact-zero boundary settles in full as NO_PAY_DUE, never RECOVERY_DUE', async () => {
    const admin = await masterAdminAgent('stmt-3case-boundary-admin@test.local');
    // --- Case: exact-zero boundary (recovery deduction exactly consumes available salary) ------
    {
      const { site, unit } = await makeSiteWithUnit('Test Site Stmt 3case Boundary Site');
      const employee = await prisma.employee.create({
        data: { name: '3case Boundary Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
      });
      const cycle1 = await makeDraftCycle(admin);
      await releaseUnit(admin, cycle1.id, unit.id);
      await finalizeCycle(admin, cycle1.id);
      const cycle2 = await rollover(admin, cycle1.id);
      const bootstrapped2 = await getEntry(admin, cycle2.id, employee.id);
      const entry2 = await setNetSalary(admin, bootstrapped2.id, bootstrapped2.version, '400');
      expect(entry2.calc.netSalary).toBe('0.00');
      const release2 = await releaseUnit(admin, cycle2.id, unit.id);
      expect(release2.noPayDueCount).toBe(1); // never RECOVERY_DUE at the exact boundary
      expect(release2.recoveryDueCount).toBe(0);

      const res = await getStatement(admin, employee.id, '?fromCycleId=' + cycle1.id + '&toCycleId=' + cycle2.id);
      expect(res.body.closingBalances.recoveryOutstanding).toBe('0.00');
      expect(res.body.entries.filter((e: { kind: string }) => e.kind === 'BALANCE_ADJUSTMENT_CREATED')).toHaveLength(1);
    }
  });

  it('D3: three-case carried-forward recovery accounting — an unaffordable old recovery and a genuinely new, distinct shortfall never merge', async () => {
    const admin = await masterAdminAgent('stmt-3case-newob-admin@test.local');
    // --- Case: the old recovery is unaffordable this cycle, and this cycle independently --------
    // --- generates a genuinely new, distinct shortfall (never merged with the old one) ----------
    {
      const { site, unit } = await makeSiteWithUnit('Test Site Stmt 3case New Obligation Site');
      const employee = await prisma.employee.create({
        data: { name: '3case New Obligation Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
      });
      const cycle1 = await makeDraftCycle(admin);
      await releaseUnit(admin, cycle1.id, unit.id); // opening recovery: 400

      await finalizeCycle(admin, cycle1.id);
      const cycle2 = await rollover(admin, cycle1.id);
      const bootstrapped2 = await getEntry(admin, cycle2.id, employee.id);
      // earnings 300, a new unrelated deduction (fine) 500 -> baseNet = 300-500 = -200, independent
      // of the carried-forward 400.
      const patchRes = await admin.agent
        .patch(`/api/v1/payroll-entries/${bootstrapped2.id}`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ version: bootstrapped2.version, eobiApplicable: false, allowance: '300', fine: '500' });
      expect(patchRes.status).toBe(200);
      const release2 = await releaseUnit(admin, cycle2.id, unit.id);
      expect(release2.recoveryDueCount).toBe(1); // a genuinely new RECOVERY_DUE this cycle
      expect(release2.noPayDueCount).toBe(0);

      const res = await getStatement(admin, employee.id, '?fromCycleId=' + cycle1.id + '&toCycleId=' + cycle2.id);
      const created = res.body.entries.filter((e: { kind: string }) => e.kind === 'BALANCE_ADJUSTMENT_CREATED');
      expect(created).toHaveLength(2); // the original 400, plus a distinct new 200 — never merged
      const amounts = created.map((e: { movement: { amount: string } }) => e.movement.amount).sort();
      expect(amounts).toEqual(['200.00', '400.00']);
      // The old recovery settled nothing this cycle (cancelled reservation, not a zero settlement).
      const settlementsThisRange = res.body.entries.filter((e: { kind: string }) => e.kind === 'BALANCE_ADJUSTMENT_SETTLED');
      expect(settlementsThisRange).toHaveLength(0);
      expect(res.body.closingBalances.recoveryOutstanding).toBe('600.00'); // 400 + 200, conservation holds

      // Independently verify against the live DB — penny-level reconciliation.
      const dbSum = await prisma.balanceAdjustment.aggregate({
        where: { employeeId: employee.id, type: 'RECOVERY' },
        _sum: { remainingAmount: true },
      });
      expect(new Decimal(dbSum._sum.remainingAmount!.toString()).toFixed(2)).toBe('600.00');
    }
  });

  // ============================================================================================
  // E — Correction PAYABLE lifecycle: creation -> deferred/materialized -> settlement
  // ============================================================================================

  it('E: Correction PAYABLE — creation, deferred materialization into the next Draft cycle, and settlement at release', async () => {
    const admin = await masterAdminAgent('stmt-payable-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Stmt Payable Site');
    const employee = await prisma.employee.create({
      data: { name: 'Payable Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });
    const adjustmentType = await makeAdjustmentType('PAYABLE_TEST');
    const cycle1 = await makeDraftCycle(admin);
    const entry1 = await getEntry(admin, cycle1.id, employee.id);
    await setNetSalary(admin, entry1.id, entry1.version, '5000');
    await releaseUnit(admin, cycle1.id, unit.id);

    const entryAfterRelease = await getEntry(admin, cycle1.id, employee.id);
    const requester = await payrollStaffAgent('stmt-payable-requester@test.local', [site.id], [PERMISSIONS.PAYROLL_ENTRY]);
    const { balanceAdjustment } = await submitAndApproveCorrection(
      requester,
      admin,
      entryAfterRelease.id,
      'ALLOWANCE',
      '6000', // was effectively 5000 -> +1000 net salary -> PAYABLE 1000
      adjustmentType.id,
      { paymentTiming: 'DEFERRED' },
    );
    expect(balanceAdjustment.type).toBe('PAYABLE');
    expect(new Decimal(balanceAdjustment.amount).toFixed(2)).toBe('1000.00');

    await finalizeCycle(admin, cycle1.id);
    const cycle2 = await rollover(admin, cycle1.id); // materializes the DEFERRED payable automatically
    const bootstrapped2 = await getEntry(admin, cycle2.id, employee.id);
    await setNetSalary(admin, bootstrapped2.id, bootstrapped2.version, '2000');
    await releaseUnit(admin, cycle2.id, unit.id); // settles it, merged into the ordinary release

    const res = await getStatement(admin, employee.id, `?fromCycleId=${cycle1.id}&toCycleId=${cycle2.id}`);
    const correctionRow = res.body.entries.find((e: { kind: string }) => e.kind === 'CORRECTION_APPROVED');
    expect(correctionRow).toBeDefined();
    expect(correctionRow.movement).toBeNull(); // informational only — never double-counted

    const created = res.body.entries.find((e: { kind: string }) => e.kind === 'BALANCE_ADJUSTMENT_CREATED');
    expect(created.movement).toEqual({ balance: 'PAYABLE', direction: 'INCREASE', amount: '1000.00' });

    const settled = res.body.entries.find((e: { kind: string }) => e.kind === 'BALANCE_ADJUSTMENT_SETTLED');
    expect(settled.movement).toEqual({ balance: 'PAYABLE', direction: 'DECREASE', amount: '1000.00' });
    expect(settled.cycleYear).toBe(cycle2.year);
    expect(settled.cycleMonth).toBe(cycle2.month);

    expect(res.body.closingBalances.payableOutstanding).toBe('0.00');
  });

  // ============================================================================================
  // F — Correction RECOVERY lifecycle: partial settlement across cycles -> final settlement
  // ============================================================================================

  it('F: Correction RECOVERY — installment settlement across two cycles reaches SETTLED with the correct running balance at each step', async () => {
    const admin = await masterAdminAgent('stmt-corr-recovery-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Stmt Corr Recovery Site');
    const employee = await prisma.employee.create({
      data: { name: 'Corr Recovery Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });
    const adjustmentType = await makeAdjustmentType('RECOVERY_TEST');
    const cycle1 = await makeDraftCycle(admin);
    const entry1 = await getEntry(admin, cycle1.id, employee.id);
    await setNetSalary(admin, entry1.id, entry1.version, '5000');
    await releaseUnit(admin, cycle1.id, unit.id);

    const entryAfterRelease = await getEntry(admin, cycle1.id, employee.id);
    const requester = await payrollStaffAgent('stmt-recovery-requester@test.local', [site.id], [PERMISSIONS.PAYROLL_ENTRY]);
    const { balanceAdjustment } = await submitAndApproveCorrection(
      requester,
      admin,
      entryAfterRelease.id,
      'ALLOWANCE',
      '4000', // 5000 -> 4000, -1000 net salary -> RECOVERY 1000
      adjustmentType.id,
      { recoveryInstallmentAmount: '600' },
    );
    expect(balanceAdjustment.type).toBe('RECOVERY');
    expect(new Decimal(balanceAdjustment.amount).toFixed(2)).toBe('1000.00');

    await finalizeCycle(admin, cycle1.id);
    const cycle2 = await rollover(admin, cycle1.id); // materializes min(600, 1000) = 600
    const bootstrapped2 = await getEntry(admin, cycle2.id, employee.id);
    const entry2 = await setNetSalary(admin, bootstrapped2.id, bootstrapped2.version, '2000');
    expect(entry2.calc.netSalary).toBe('1400.00'); // 2000 - 600
    await releaseUnit(admin, cycle2.id, unit.id); // settles 600, remaining 400, still PENDING

    const afterCycle2 = await prisma.balanceAdjustment.findUniqueOrThrow({ where: { id: balanceAdjustment.id } });
    expect(afterCycle2.remainingAmount.toFixed(2)).toBe('400.00');
    expect(afterCycle2.status).toBe('PENDING');

    await finalizeCycle(admin, cycle2.id);
    const cycle3 = await rollover(admin, cycle2.id); // materializes min(600, 400) = 400 (the true remainder)
    const bootstrapped3 = await getEntry(admin, cycle3.id, employee.id);
    await setNetSalary(admin, bootstrapped3.id, bootstrapped3.version, '2000');
    await releaseUnit(admin, cycle3.id, unit.id); // settles the final 400 -> SETTLED

    const res = await getStatement(admin, employee.id, `?fromCycleId=${cycle1.id}&toCycleId=${cycle3.id}`);
    const settlements = res.body.entries.filter((e: { kind: string }) => e.kind === 'BALANCE_ADJUSTMENT_SETTLED');
    expect(settlements).toHaveLength(2);
    expect(settlements[0].movement).toEqual({ balance: 'RECOVERABLE', direction: 'DECREASE', amount: '600.00' });
    expect(settlements[1].movement).toEqual({ balance: 'RECOVERABLE', direction: 'DECREASE', amount: '400.00' });
    expect(res.body.closingBalances.recoveryOutstanding).toBe('0.00');

    const finalAdjustment = await prisma.balanceAdjustment.findUniqueOrThrow({ where: { id: balanceAdjustment.id } });
    expect(finalAdjustment.status).toBe('SETTLED');
  });

  // ============================================================================================
  // G — CorrectionPayment standalone settlement
  // ============================================================================================

  it('G: a standalone CorrectionPayment settling a PAYABLE balance outside any cycle appears as its own Payable-decreasing row', async () => {
    const admin = await masterAdminAgent('stmt-corr-payment-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Stmt Corr Payment Site');
    const employee = await prisma.employee.create({
      data: { name: 'Corr Payment Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });
    const adjustmentType = await makeAdjustmentType('PAYMENT_TEST');
    const cycle1 = await makeDraftCycle(admin);
    const entry1 = await getEntry(admin, cycle1.id, employee.id);
    await setNetSalary(admin, entry1.id, entry1.version, '5000');
    await releaseUnit(admin, cycle1.id, unit.id);

    const entryAfterRelease = await getEntry(admin, cycle1.id, employee.id);
    const requester = await payrollStaffAgent('stmt-payment-requester@test.local', [site.id], [PERMISSIONS.PAYROLL_ENTRY]);
    const { balanceAdjustment } = await submitAndApproveCorrection(
      requester,
      admin,
      entryAfterRelease.id,
      'ALLOWANCE',
      '5750',
      adjustmentType.id,
      { paymentTiming: 'IMMEDIATE' },
    );
    expect(balanceAdjustment.type).toBe('PAYABLE');

    const paymentRes = await admin.agent
      .post(`/api/v1/balance-adjustments/${balanceAdjustment.id}/payments`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    expect(paymentRes.status).toBe(201);

    const res = await getStatement(admin, employee.id);
    const paymentRow = res.body.entries.find((e: { kind: string }) => e.kind === 'CORRECTION_PAYMENT');
    expect(paymentRow).toBeDefined();
    expect(paymentRow.movement).toEqual({ balance: 'PAYABLE', direction: 'DECREASE', amount: '750.00' });
    expect(paymentRow.cycleId).toBeNull(); // genuinely standalone, no cycle attribution
    expect(res.body.closingBalances.payableOutstanding).toBe('0.00');

    const finalAdjustment = await prisma.balanceAdjustment.findUniqueOrThrow({ where: { id: balanceAdjustment.id } });
    expect(finalAdjustment.status).toBe('SETTLED');
  });

  // ============================================================================================
  // H/I/J — Advance lifecycle
  // ============================================================================================

  it('H: Advance — creation, RESERVED at Draft materialization, final deduction and PAID_OFF at release', async () => {
    const admin = await masterAdminAgent('stmt-advance-full-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Stmt Advance Full Site');
    const employee = await prisma.employee.create({
      data: { name: 'Advance Full Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });
    const cycle = await makeDraftCycle(admin);

    const advance = await createAdvance(admin, employee.id, { year: cycle.year, month: cycle.month }, { totalAmount: '1000' });
    expect(advance.status).toBe('RESERVED'); // immediately materialized, fully reserved
    expect(new Decimal(advance.outstandingBalance).toFixed(2)).toBe('0.00');

    const entry = await getEntry(admin, cycle.id, employee.id);
    await setNetSalary(admin, entry.id, entry.version, '5000'); // 5000 - 1000 advance deduction
    await releaseUnit(admin, cycle.id, unit.id);

    const afterRelease = await prisma.advance.findUniqueOrThrow({ where: { id: advance.id } });
    expect(afterRelease.status).toBe('PAID_OFF');
    expect(afterRelease.paidOffAt).not.toBeNull();

    const res = await getStatement(admin, employee.id);
    const given = res.body.entries.find((e: { kind: string }) => e.kind === 'ADVANCE_GIVEN');
    expect(given.movement).toEqual({ balance: 'ADVANCE', direction: 'INCREASE', amount: '1000.00' });

    const deduction = res.body.entries.find((e: { kind: string }) => e.kind === 'ADVANCE_DEDUCTION_FINAL');
    expect(deduction).toBeDefined();
    expect(deduction.movement).toEqual({ balance: 'ADVANCE', direction: 'DECREASE', amount: '1000.00' });
    // No separate RESERVED event once the same deduction has finalized at release.
    expect(res.body.entries.filter((e: { kind: string }) => e.kind === 'ADVANCE_DEDUCTION_RESERVED')).toHaveLength(0);

    const paidOff = res.body.entries.find((e: { kind: string }) => e.kind === 'ADVANCE_PAID_OFF');
    expect(paidOff).toBeDefined();
    expect(paidOff.isInformational).toBe(true);
    expect(paidOff.movement).toBeNull();

    expect(res.body.closingBalances.advanceOutstanding).toBe('0.00');
  });

  it('I: Advance — a deduction deferred before release leaves no deduction event and restores the Advance Outstanding balance', async () => {
    const admin = await masterAdminAgent('stmt-advance-defer-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Stmt Advance Defer Site');
    const employee = await prisma.employee.create({
      data: { name: 'Advance Defer Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });
    const cycle = await makeDraftCycle(admin);
    const advance = await createAdvance(admin, employee.id, { year: cycle.year, month: cycle.month }, { totalAmount: '1000' });
    expect(advance.status).toBe('RESERVED');

    const entry = await getEntry(admin, cycle.id, employee.id);
    const futureYear = cycle.month === 12 ? cycle.year + 1 : cycle.year;
    const futureMonth = cycle.month === 12 ? 1 : cycle.month + 1;
    const deferRes = await admin.agent
      .post(`/api/v1/advances/${advance.id}/defer`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ payrollEntryId: entry.id, toPeriod: { year: futureYear, month: futureMonth }, reason: 'Employee requested deferral' });
    expect(deferRes.status).toBe(200);

    const afterDefer = await prisma.advance.findUniqueOrThrow({ where: { id: advance.id } });
    expect(afterDefer.status).toBe('ACTIVE');
    expect(afterDefer.outstandingBalance.toFixed(2)).toBe('1000.00');

    const res = await getStatement(admin, employee.id);
    expect(res.body.entries.filter((e: { kind: string }) => e.kind.startsWith('ADVANCE_DEDUCTION'))).toHaveLength(0);
    const scheduleChanged = res.body.entries.find((e: { kind: string }) => e.kind === 'ADVANCE_SCHEDULE_CHANGED');
    expect(scheduleChanged).toBeDefined();
    expect(scheduleChanged.isInformational).toBe(true);
    expect(scheduleChanged.description).toContain('Employee requested deferral');
    expect(res.body.closingBalances.advanceOutstanding).toBe('1000.00');
  });

  it('J: Advance — cancelling before release reverses the live deduction and leaves an informational Cancelled marker', async () => {
    const admin = await masterAdminAgent('stmt-advance-cancel-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Stmt Advance Cancel Site');
    const employee = await prisma.employee.create({
      data: { name: 'Advance Cancel Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });
    const cycle = await makeDraftCycle(admin);
    const advance = await createAdvance(admin, employee.id, { year: cycle.year, month: cycle.month }, { totalAmount: '1000' });
    expect(advance.status).toBe('RESERVED');

    const cancelRes = await admin.agent
      .post(`/api/v1/advances/${advance.id}/cancel`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ reason: 'Recorded against the wrong employee' });
    expect(cancelRes.status).toBe(200);

    const afterCancel = await prisma.advance.findUniqueOrThrow({ where: { id: advance.id } });
    expect(afterCancel.status).toBe('CANCELLED');

    const res = await getStatement(admin, employee.id);
    expect(res.body.entries.filter((e: { kind: string }) => e.kind.startsWith('ADVANCE_DEDUCTION'))).toHaveLength(0);
    const cancelled = res.body.entries.find((e: { kind: string }) => e.kind === 'ADVANCE_CANCELLED');
    expect(cancelled).toBeDefined();
    expect(cancelled.isInformational).toBe(true);
    expect(cancelled.movement).toBeNull();
    // Faithfully mirrors the live canonical record — see the checkpoint report's documented
    // discrepancy: a cancellation with nothing live to reverse does not zero `outstandingBalance`.
    expect(res.body.closingBalances.advanceOutstanding).toBe(afterCancel.outstandingBalance.toFixed(2));
  });

  // ============================================================================================
  // K/L/M — employee transfer, site-scoping, Master Admin visibility
  // ============================================================================================

  it('K/L/M: historical site-scoping follows PayrollEntry.siteId (not current Employee.siteId), and Master Admin sees everything', async () => {
    const admin = await masterAdminAgent('stmt-transfer-admin@test.local');
    const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site Stmt Transfer Site A');
    const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site Stmt Transfer Site B');

    const employee = await prisma.employee.create({
      data: { name: 'Transfer Employee', designation: 'Guard', siteId: siteA.id, unitId: unitA.id, grossPay: '30000' },
    });

    const cycle1 = await makeDraftCycle(admin);
    await releaseUnit(admin, cycle1.id, unitA.id); // -400 -> RECOVERY_DUE at Site A

    // Transfer the employee to Site B — takes effect at the *next* cycle's bootstrap, per the
    // frozen Payroll Bootstrap Rule; this cycle's own entry (siteId = Site A) is untouched.
    const transferRes = await admin.agent
      .patch(`/api/v1/employees/${employee.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ siteId: siteB.id, unitId: unitB.id });
    expect(transferRes.status).toBe(200);

    await finalizeCycle(admin, cycle1.id);
    const cycle2 = await rollover(admin, cycle1.id); // new entry bootstraps at Site B, materializes the 400 recovery
    const bootstrapped2 = await getEntry(admin, cycle2.id, employee.id);
    await setNetSalary(admin, bootstrapped2.id, bootstrapped2.version, '2000');
    await releaseUnit(admin, cycle2.id, unitB.id); // settles the (Site-A-origin) recovery; this entry itself is Site B

    const siteAOnlyStaff = await payrollStaffAgent('stmt-site-a-staff@test.local', [siteA.id]);
    const siteBOnlyStaff = await payrollStaffAgent('stmt-site-b-staff@test.local', [siteB.id]);
    const neitherSiteStaff = await payrollStaffAgent('stmt-no-site-staff@test.local', []);

    // --- L: zero overlap -> 404, reveals nothing ------------------------------------------------
    const noneRes = await getStatement(neitherSiteStaff, employee.id);
    expect(noneRes.status).toBe(404);

    // --- K (part 1): Site-A-only user sees cycle1's outcome + the whole BalanceAdjustment lifecycle
    // (it originated at Site A), but NOT cycle2's own outcome (a Site B entry).
    const siteAOnlyRes = await getStatement(siteAOnlyStaff, employee.id, `?fromCycleId=${cycle1.id}&toCycleId=${cycle2.id}`);
    expect(siteAOnlyRes.status).toBe(200);
    const siteAKinds = siteAOnlyRes.body.entries.map((e: { kind: string }) => e.kind);
    expect(siteAKinds).toContain('CYCLE_RECOVERY_DUE');
    expect(siteAKinds).toContain('BALANCE_ADJUSTMENT_CREATED');
    expect(siteAKinds).toContain('BALANCE_ADJUSTMENT_SETTLED');
    expect(siteAKinds).not.toContain('CYCLE_PAID'); // cycle2's own outcome is Site B, invisible
    expect(siteAOnlyRes.body.closingBalances.recoveryOutstanding).toBe('0.00'); // sees the full settlement too

    // --- K (part 2): Site-B-only user sees cycle2's own outcome but NOT the Site-A-origin recovery
    // — a new site assignment never retroactively grants access to the old site's obligations.
    const siteBOnlyRes = await getStatement(siteBOnlyStaff, employee.id, `?fromCycleId=${cycle1.id}&toCycleId=${cycle2.id}`);
    expect(siteBOnlyRes.status).toBe(200);
    const siteBKinds = siteBOnlyRes.body.entries.map((e: { kind: string }) => e.kind);
    expect(siteBKinds).toContain('CYCLE_PAID');
    expect(siteBKinds).not.toContain('CYCLE_RECOVERY_DUE');
    expect(siteBKinds).not.toContain('BALANCE_ADJUSTMENT_CREATED');
    expect(siteBKinds).not.toContain('BALANCE_ADJUSTMENT_SETTLED');

    // --- M: Master Admin sees the full, unfiltered history. -------------------------------------
    const adminRes = await getStatement(admin, employee.id, `?fromCycleId=${cycle1.id}&toCycleId=${cycle2.id}`);
    const adminKinds = adminRes.body.entries.map((e: { kind: string }) => e.kind);
    expect(adminKinds).toEqual(expect.arrayContaining(['CYCLE_RECOVERY_DUE', 'BALANCE_ADJUSTMENT_CREATED', 'BALANCE_ADJUSTMENT_SETTLED', 'CYCLE_PAID']));
  });

  // ============================================================================================
  // N — legacy negative payroll anomaly
  // ============================================================================================

  it('N: a legacy released PayrollEntry with a negative net salary renders as an inert historical anomaly, never mutated, never a new recovery', async () => {
    const admin = await masterAdminAgent('stmt-legacy-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Stmt Legacy Site');
    const employee = await prisma.employee.create({
      data: { name: 'Legacy Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });
    const cycle = await prisma.payrollCycle.create({ data: { year: 2900, month: 1, createdBy: admin.userId, status: 'RELEASED' } });

    // Directly simulated — this state predates the negative-payroll-recovery architecture and can
    // never be newly produced by any current code path (`releaseProjectUnit` only ever sets
    // `released = true` for `netSalary > 0`).
    const legacyEntry = await prisma.payrollEntry.create({
      data: {
        cycleId: cycle.id,
        employeeId: employee.id,
        siteId: site.id,
        designation: 'Guard',
        grossPay: '0',
        eobiApplicable: true,
        released: true,
        releasedAt: new Date(),
        releasedBy: admin.userId,
        workLines: { create: [{ siteId: site.id, unitId: unit.id, days: '0', cycleDays: 30, otHours: '0' }] },
      },
    });

    const res = await getStatement(admin, employee.id, `?fromCycleId=${cycle.id}&toCycleId=${cycle.id}`);
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].kind).toBe('CYCLE_LEGACY_NEGATIVE_ANOMALY');
    expect(res.body.entries[0].isInformational).toBe(true);
    expect(res.body.entries[0].movement).toBeNull();
    expect(res.body.closingBalances).toEqual({ payableOutstanding: '0.00', recoveryOutstanding: '0.00', advanceOutstanding: '0.00' });

    // Zero mutation, zero new BalanceAdjustment.
    const balanceAdjustments = await prisma.balanceAdjustment.findMany({ where: { employeeId: employee.id } });
    expect(balanceAdjustments).toHaveLength(0);
    const unchangedEntry = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: legacyEntry.id } });
    expect(unchangedEntry.updatedAt.getTime()).toBe(legacyEntry.updatedAt.getTime());
    expect(unchangedEntry.version).toBe(legacyEntry.version);
  });

  // ============================================================================================
  // O — deterministic ordering
  // ============================================================================================

  it('O: same-period events sort deterministically (Correction before its own BalanceAdjustment) and sequence is strictly increasing', async () => {
    const admin = await masterAdminAgent('stmt-order-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Stmt Order Site');
    const employee = await prisma.employee.create({
      data: { name: 'Order Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });
    const adjustmentType = await makeAdjustmentType('ORDER_TEST');
    const cycle = await makeDraftCycle(admin);
    const entry = await getEntry(admin, cycle.id, employee.id);
    await setNetSalary(admin, entry.id, entry.version, '5000');
    await releaseUnit(admin, cycle.id, unit.id);

    const entryAfterRelease = await getEntry(admin, cycle.id, employee.id);
    const requester = await payrollStaffAgent('stmt-order-requester@test.local', [site.id], [PERMISSIONS.PAYROLL_ENTRY]);
    await submitAndApproveCorrection(requester, admin, entryAfterRelease.id, 'ALLOWANCE', '5500', adjustmentType.id, { paymentTiming: 'IMMEDIATE' });

    const res1 = await getStatement(admin, employee.id);
    const res2 = await getStatement(admin, employee.id);
    expect(res1.body.entries.map((e: { id: string }) => e.id)).toEqual(res2.body.entries.map((e: { id: string }) => e.id));

    const kinds = res1.body.entries.map((e: { kind: string }) => e.kind);
    const correctionIndex = kinds.indexOf('CORRECTION_APPROVED');
    const createdIndex = kinds.indexOf('BALANCE_ADJUSTMENT_CREATED');
    expect(correctionIndex).toBeGreaterThanOrEqual(0);
    expect(createdIndex).toBeGreaterThan(correctionIndex);

    const sequences = res1.body.entries.map((e: { sequence: number }) => e.sequence);
    for (let i = 1; i < sequences.length; i += 1) {
      expect(sequences[i]).toBeGreaterThan(sequences[i - 1]);
    }
  });

  // ============================================================================================
  // P — penny-level reconciliation across all three balances at once
  // ============================================================================================

  it('P: closing balances reconcile exactly (penny-level) against independently-computed sums from the canonical tables', async () => {
    const admin = await masterAdminAgent('stmt-reconcile-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Stmt Reconcile Site');
    const employee = await prisma.employee.create({
      data: { name: 'Reconcile Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });
    const adjustmentType = await makeAdjustmentType('RECONCILE_TEST');

    const cycle1 = await makeDraftCycle(admin);
    await createAdvance(admin, employee.id, { year: cycle1.year, month: cycle1.month }, { totalAmount: '2000', repaymentType: 'INSTALLMENT' });
    // INSTALLMENT with no scheduledInstallmentAmount set yet materializes nothing this cycle — the
    // advance stays ACTIVE with the full balance outstanding (`materializeOneAdvanceDeduction`'s own
    // documented no-op path), a deliberately realistic mixed state for this reconciliation fixture.
    const entry1 = await getEntry(admin, cycle1.id, employee.id);
    await setNetSalary(admin, entry1.id, entry1.version, '5000');
    await releaseUnit(admin, cycle1.id, unit.id);

    const entryAfterRelease = await getEntry(admin, cycle1.id, employee.id);
    const requester = await payrollStaffAgent('stmt-reconcile-requester@test.local', [site.id], [PERMISSIONS.PAYROLL_ENTRY]);
    await submitAndApproveCorrection(requester, admin, entryAfterRelease.id, 'ALLOWANCE', '5300', adjustmentType.id, { paymentTiming: 'DEFERRED' });
    await submitAndApproveCorrection(requester, admin, entryAfterRelease.id, 'FINE', '150', adjustmentType.id, { recoveryInstallmentAmount: '50' });

    const res = await getStatement(admin, employee.id);
    expect(res.status).toBe(200);

    const [payableAgg, recoveryAgg, advanceAgg] = await Promise.all([
      prisma.balanceAdjustment.aggregate({ where: { employeeId: employee.id, type: 'PAYABLE' }, _sum: { remainingAmount: true } }),
      prisma.balanceAdjustment.aggregate({ where: { employeeId: employee.id, type: 'RECOVERY' }, _sum: { remainingAmount: true } }),
      prisma.advance.aggregate({ where: { employeeId: employee.id }, _sum: { outstandingBalance: true } }),
    ]);

    expect(res.body.closingBalances.payableOutstanding).toBe(new Decimal(payableAgg._sum.remainingAmount?.toString() ?? '0').toFixed(2));
    expect(res.body.closingBalances.recoveryOutstanding).toBe(new Decimal(recoveryAgg._sum.remainingAmount?.toString() ?? '0').toFixed(2));
    expect(res.body.closingBalances.advanceOutstanding).toBe(new Decimal(advanceAgg._sum.outstandingBalance?.toString() ?? '0').toFixed(2));
  });

  // ============================================================================================
  // Permissions — statements:view is independent of every other payroll permission
  // ============================================================================================

  describe('permissions', () => {
    // Deliberately custom `TEST_`-prefixed role codes (not `ROLE_CODES.PAYROLL_STAFF`/`FINANCE`/
    // `MASTER_ADMIN`) — those three are real, already-seeded roles whose baseline grants (Master
    // Admin: everything; Payroll Staff/Finance: `statements:view` among them, per this checkpoint's
    // own approved default) only ever *grow* via `createTestUser`'s upsert, never shrink to exactly
    // what a test passes. A true "missing statements:view" negative case requires a genuinely fresh
    // role with zero baseline grants — the same precedent `bank-sheets.test.ts`'s `TEST_NO_BANK_
    // SHEETS` and `employees.test.ts`'s `TEST_EMPLOYEES_VIEW_ONLY` already establish.
    it('rejects a request with no statements:view, even with payroll:entry/reports:view/corrections:approve', async () => {
      const { site, unit } = await makeSiteWithUnit('Test Site Stmt Perm Site');
      const employee = await prisma.employee.create({
        data: { name: 'Perm Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
      });
      const noStatementsAgent = await createAuthenticatedAgent(app, {
        email: 'stmt-no-perm@test.local',
        password: PASSWORD,
        roleCode: 'TEST_STATEMENTS_NO_VIEW',
        permissionKeys: [PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.REPORTS_VIEW],
        siteIds: [site.id],
      });
      const res = await getStatement(noStatementsAgent, employee.id);
      expect(res.status).toBe(403);
    });

    it('rejects corrections:approve alone, without statements:view', async () => {
      const { site, unit } = await makeSiteWithUnit('Test Site Stmt Perm Site 2');
      const employee = await prisma.employee.create({
        data: { name: 'Perm Employee 2', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
      });
      const correctionsOnlyAgent = await createAuthenticatedAgent(app, {
        email: 'stmt-corrections-only@test.local',
        password: PASSWORD,
        roleCode: 'TEST_STATEMENTS_CORRECTIONS_ONLY',
        permissionKeys: [PERMISSIONS.CORRECTIONS_APPROVE],
        siteIds: [site.id],
      });
      const res = await correctionsOnlyAgent.agent.get(`/api/v1/employees/${employee.id}/statement`);
      expect(res.status).toBe(403);
    });

    it('allows a request with statements:view, but still enforces site-scope as a second, independent check', async () => {
      const { site: siteA } = await makeSiteWithUnit('Test Site Stmt Perm Site A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site Stmt Perm Site B');
      const employee = await prisma.employee.create({
        data: { name: 'Perm Employee 3', designation: 'Guard', siteId: siteB.id, unitId: unitB.id, grossPay: '30000' },
      });
      const wrongSiteAgent = await payrollStaffAgent('stmt-wrong-site@test.local', [siteA.id]);
      const res = await getStatement(wrongSiteAgent, employee.id);
      expect(res.status).toBe(404); // has the permission, but zero site overlap
    });
  });

  // ============================================================================================
  // Gap-closure Q1/Q2 — bounded-range opening balances are a full-history replay, never a
  // truncated query. Protects against a future "optimize by only fetching the visible range"
  // regression, per the explicit checkpoint instruction.
  // ============================================================================================

  it('Q1: opening balances for a bounded range correctly reflect Payable/Recovery obligations created BEFORE the range', async () => {
    const admin = await masterAdminAgent('stmt-opening-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Stmt Opening Site');
    const employee = await prisma.employee.create({
      data: { name: 'Opening Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });
    const adjustmentType = await makeAdjustmentType('OPENING_TEST');
    const requester = await payrollStaffAgent('stmt-opening-requester@test.local', [site.id], [PERMISSIONS.PAYROLL_ENTRY]);

    // Cycle 1: PAYABLE +1000 (IMMEDIATE — never auto-materializes, so cycle 2's manual partial
    // settlement below isn't fighting an already-reserved amount).
    const cycle1 = await makeDraftCycle(admin);
    const entry1 = await getEntry(admin, cycle1.id, employee.id);
    await setNetSalary(admin, entry1.id, entry1.version, '5000');
    await releaseUnit(admin, cycle1.id, unit.id);
    const entry1AfterRelease = await getEntry(admin, cycle1.id, employee.id);
    const { balanceAdjustment } = await submitAndApproveCorrection(
      requester,
      admin,
      entry1AfterRelease.id,
      'ALLOWANCE',
      '6000',
      adjustmentType.id,
      { paymentTiming: 'IMMEDIATE' },
    );
    expect(balanceAdjustment.type).toBe('PAYABLE');

    // Cycle 2: PAYABLE settlement -400 (manual, cycle-scoped) — remainingAmount left at 600.
    await finalizeCycle(admin, cycle1.id);
    const cycle2 = await rollover(admin, cycle1.id);
    const settleRes = await admin.agent
      .post(`/api/v1/balance-adjustments/${balanceAdjustment.id}/settlements`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ cycleId: cycle2.id, amount: '400' });
    expect(settleRes.status).toBe(201);
    const afterCycle2 = await prisma.balanceAdjustment.findUniqueOrThrow({ where: { id: balanceAdjustment.id } });
    expect(afterCycle2.remainingAmount.toFixed(2)).toBe('600.00');

    // Cycle 2's own entry didn't otherwise get touched — hold it so it doesn't block Finalize.
    const cycle2Entry = await getEntry(admin, cycle2.id, employee.id);
    const holdRes = await admin.agent
      .patch(`/api/v1/payroll-entries/${cycle2Entry.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: cycle2Entry.version, hold: true });
    expect(holdRes.status).toBe(200);

    // Cycle 3: RECOVERY +250 (a second, distinct correction against cycle 3's own released entry).
    await finalizeCycle(admin, cycle2.id);
    const cycle3 = await rollover(admin, cycle2.id);
    const entry3 = await getEntry(admin, cycle3.id, employee.id);
    await setNetSalary(admin, entry3.id, entry3.version, '5000');
    await releaseUnit(admin, cycle3.id, unit.id);
    const entry3AfterRelease = await getEntry(admin, cycle3.id, employee.id);
    const recoveryResult = await submitAndApproveCorrection(requester, admin, entry3AfterRelease.id, 'FINE', '250', adjustmentType.id, {});
    expect(recoveryResult.balanceAdjustment.type).toBe('RECOVERY');

    // Request the Statement beginning at cycle 3 — everything above happened strictly before it.
    const res = await getStatement(admin, employee.id, `?fromCycleId=${cycle3.id}&toCycleId=${cycle3.id}`);
    expect(res.status).toBe(200);
    expect(res.body.openingBalances.payableOutstanding).toBe('600.00');
    expect(res.body.openingBalances.recoveryOutstanding).toBe('0.00');
    expect(res.body.closingBalances.payableOutstanding).toBe('600.00'); // unchanged inside the range
    expect(res.body.closingBalances.recoveryOutstanding).toBe('250.00');

    const cycleIdsInEntries = new Set(res.body.entries.map((e: { cycleId: string | null }) => e.cycleId).filter(Boolean));
    expect(cycleIdsInEntries.has(cycle1.id)).toBe(false); // out of range, not displayed
    expect(cycleIdsInEntries.has(cycle2.id)).toBe(false);
    expect(cycleIdsInEntries.has(cycle3.id)).toBe(true);

    const [payableAgg, recoveryAgg] = await Promise.all([
      prisma.balanceAdjustment.aggregate({ where: { employeeId: employee.id, type: 'PAYABLE' }, _sum: { remainingAmount: true } }),
      prisma.balanceAdjustment.aggregate({ where: { employeeId: employee.id, type: 'RECOVERY' }, _sum: { remainingAmount: true } }),
    ]);
    expect(res.body.closingBalances.payableOutstanding).toBe(new Decimal(payableAgg._sum.remainingAmount!.toString()).toFixed(2));
    expect(res.body.closingBalances.recoveryOutstanding).toBe(new Decimal(recoveryAgg._sum.remainingAmount!.toString()).toFixed(2));
  });

  it('Q2: opening balances for a bounded range correctly reflect an Advance created BEFORE the range and still outstanding', async () => {
    const admin = await masterAdminAgent('stmt-opening-advance-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Stmt Opening Advance Site');
    const employee = await prisma.employee.create({
      data: { name: 'Opening Advance Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });

    const cycle1 = await makeDraftCycle(admin);
    const entry1 = await getEntry(admin, cycle1.id, employee.id);
    await setNetSalary(admin, entry1.id, entry1.version, '3000');
    await releaseUnit(admin, cycle1.id, unit.id);

    // Given *during* cycle 1 (so `ADVANCE_GIVEN` itself is attributed to a period before the
    // requested range) but *scheduled* to deduct well beyond this fixture's own cycles, so it never
    // materializes and stays fully outstanding at its own `totalAmount` throughout cycles 1-3.
    await createAdvance(
      admin,
      employee.id,
      { year: cycle1.year + 5, month: 1 },
      { totalAmount: '500', dateGiven: `${cycle1.year}-${String(cycle1.month).padStart(2, '0')}-01` },
    );

    await finalizeCycle(admin, cycle1.id);
    const cycle2 = await rollover(admin, cycle1.id);
    const cycle2Entry = await getEntry(admin, cycle2.id, employee.id);
    await admin.agent
      .patch(`/api/v1/payroll-entries/${cycle2Entry.id}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version: cycle2Entry.version, hold: true });
    await finalizeCycle(admin, cycle2.id);
    const cycle3 = await rollover(admin, cycle2.id);

    const res = await getStatement(admin, employee.id, `?fromCycleId=${cycle3.id}&toCycleId=${cycle3.id}`);
    expect(res.status).toBe(200);
    expect(res.body.openingBalances.advanceOutstanding).toBe('500.00');
    expect(res.body.closingBalances.advanceOutstanding).toBe('500.00');
    expect(res.body.entries.some((e: { kind: string }) => e.kind === 'ADVANCE_GIVEN')).toBe(false); // out of range

    const advanceAgg = await prisma.advance.aggregate({ where: { employeeId: employee.id }, _sum: { outstandingBalance: true } });
    expect(res.body.closingBalances.advanceOutstanding).toBe(new Decimal(advanceAgg._sum.outstandingBalance!.toString()).toFixed(2));
  });

  // ============================================================================================
  // Gap-closure — sensitive-document HTTP/audit behavior (Cache-Control, statement.viewed,
  // no-audit-on-denial, and proof that viewing never mutates a financial/accounting row).
  // ============================================================================================

  describe('sensitive-document HTTP/audit behavior', () => {
    it('a successful view sets Cache-Control: no-store and writes exactly one safe statement.viewed audit entry', async () => {
      const admin = await masterAdminAgent('stmt-audit-success-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site Stmt Audit Success Site');
      const employee = await prisma.employee.create({
        data: { name: 'Audit Success Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
      });

      const beforeCount = await prisma.auditLog.count({ where: { action: 'statement.viewed', entityId: employee.id } });
      const res = await getStatement(admin, employee.id);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');

      const afterEntries = await prisma.auditLog.findMany({ where: { action: 'statement.viewed', entityId: employee.id } });
      expect(afterEntries).toHaveLength(beforeCount + 1);
      const entry = afterEntries[afterEntries.length - 1]!;
      expect(entry.actorUserId).toBe(admin.userId);
      expect(entry.entityType).toBe('Employee');

      const metadata = entry.metadata as Record<string, unknown>;
      expect(Object.keys(metadata).sort()).toEqual(['entryCount', 'fromCycleId', 'toCycleId']);
      const serialized = JSON.stringify(metadata).toLowerCase();
      expect(serialized).not.toMatch(/cnic|iban|account|balance|salary|payable|recover/);
    });

    it('a permission-denied request (missing statements:view) writes no statement.viewed audit entry', async () => {
      const { site, unit } = await makeSiteWithUnit('Test Site Stmt Audit Denied Perm Site');
      const employee = await prisma.employee.create({
        data: { name: 'Audit Denied Perm Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
      });
      const noStatementsAgent = await createAuthenticatedAgent(app, {
        email: 'stmt-audit-denied-perm@test.local',
        password: PASSWORD,
        roleCode: 'TEST_STATEMENTS_AUDIT_DENIED',
        permissionKeys: [PERMISSIONS.PAYROLL_ENTRY],
        siteIds: [site.id],
      });

      const res = await getStatement(noStatementsAgent, employee.id);
      expect(res.status).toBe(403);
      const entries = await prisma.auditLog.findMany({ where: { action: 'statement.viewed', entityId: employee.id } });
      expect(entries).toHaveLength(0);
    });

    it('an out-of-scope (site) request writes no statement.viewed audit entry', async () => {
      const { site: siteA } = await makeSiteWithUnit('Test Site Stmt Audit Denied Scope A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site Stmt Audit Denied Scope B');
      const employee = await prisma.employee.create({
        data: { name: 'Audit Denied Scope Employee', designation: 'Guard', siteId: siteB.id, unitId: unitB.id, grossPay: '30000' },
      });
      const wrongSiteAgent = await payrollStaffAgent('stmt-audit-denied-scope@test.local', [siteA.id]);

      const res = await getStatement(wrongSiteAgent, employee.id);
      expect(res.status).toBe(404);
      const entries = await prisma.auditLog.findMany({ where: { action: 'statement.viewed', entityId: employee.id } });
      expect(entries).toHaveLength(0);
    });

    it('viewing a Statement never mutates any financial/accounting row', async () => {
      const admin = await masterAdminAgent('stmt-no-mutation-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site Stmt No Mutation Site');
      const employee = await prisma.employee.create({
        data: { name: 'No Mutation Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
      });
      const cycle = await makeDraftCycle(admin);
      const entry = await getEntry(admin, cycle.id, employee.id);
      await setNetSalary(admin, entry.id, entry.version, '5000');
      await releaseUnit(admin, cycle.id, unit.id);

      const before = await snapshotFinancialRowCounts(employee.id);
      const entryBefore = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });

      const res = await getStatement(admin, employee.id);
      expect(res.status).toBe(200);

      const after = await snapshotFinancialRowCounts(employee.id);
      expect(after).toEqual(before);
      const entryAfter = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
      expect(entryAfter.version).toBe(entryBefore.version);
      expect(entryAfter.updatedAt.getTime()).toBe(entryBefore.updatedAt.getTime());
    });
  });

  // ============================================================================================
  // Gap-closure — Advance-history scope metadata must be explicit, never silent (old-Site vs.
  // current-Site RBAC).
  // ============================================================================================

  describe('Advance history scope metadata', () => {
    it("A: a user with access to the employee's OLD site (not the current one) still sees allowed historical salary rows, but Advance history is excluded and explicitly marked restricted", async () => {
      const admin = await masterAdminAgent('stmt-scope-a-admin@test.local');
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site Stmt Scope A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site Stmt Scope B');
      const employee = await prisma.employee.create({
        data: { name: 'Scope Employee', designation: 'Guard', siteId: siteA.id, unitId: unitA.id, grossPay: '30000' },
      });

      const cycle1 = await makeDraftCycle(admin);
      const entry1 = await getEntry(admin, cycle1.id, employee.id);
      await setNetSalary(admin, entry1.id, entry1.version, '5000');
      await releaseUnit(admin, cycle1.id, unitA.id);

      await createAdvance(admin, employee.id, { year: cycle1.year, month: cycle1.month }, { totalAmount: '500' });

      // Transfer the employee to Site B — current site becomes B; the historical cycle-1 entry
      // stays permanently attributed to Site A.
      const transferRes = await admin.agent
        .patch(`/api/v1/employees/${employee.id}`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ siteId: siteB.id, unitId: unitB.id });
      expect(transferRes.status).toBe(200);

      const oldSiteOnlyAgent = await payrollStaffAgent('stmt-scope-a-oldsite@test.local', [siteA.id]);
      const res = await getStatement(oldSiteOnlyAgent, employee.id);
      expect(res.status).toBe(200);

      expect(res.body.entries.some((e: { kind: string }) => e.kind === 'CYCLE_PAID')).toBe(true);
      expect(res.body.entries.some((e: { kind: string }) => e.kind.startsWith('ADVANCE_'))).toBe(false);
      expect(res.body.scope).toEqual({ advanceHistoryIncluded: false, advanceHistoryRestriction: 'CURRENT_SITE_OUT_OF_SCOPE' });
    });

    it("B: a user with access to the employee's current site sees Advance history included", async () => {
      const admin = await masterAdminAgent('stmt-scope-b-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site Stmt Scope B Current');
      const employee = await prisma.employee.create({
        data: { name: 'Scope Current Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
      });
      await createAdvance(admin, employee.id, { year: 2960, month: 1 }, { totalAmount: '500' });

      const currentSiteAgent = await payrollStaffAgent('stmt-scope-b-current@test.local', [site.id]);
      const res = await getStatement(currentSiteAgent, employee.id);
      expect(res.status).toBe(200);
      expect(res.body.scope).toEqual({ advanceHistoryIncluded: true });
      expect(res.body.entries.some((e: { kind: string }) => e.kind === 'ADVANCE_GIVEN')).toBe(true);
    });

    it('C: Master Admin always receives the complete Advance history regardless of site assignment', async () => {
      const admin = await masterAdminAgent('stmt-scope-c-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site Stmt Scope C');
      const employee = await prisma.employee.create({
        data: { name: 'Scope Master Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
      });
      await createAdvance(admin, employee.id, { year: 2961, month: 1 }, { totalAmount: '500' });

      const res = await getStatement(admin, employee.id);
      expect(res.status).toBe(200);
      expect(res.body.scope).toEqual({ advanceHistoryIncluded: true });
    });
  });

  // ============================================================================================
  // Statement employee discovery (Phase 7A Checkpoint 2 correction) —
  // GET /api/v1/statements/employees, historical PayrollEntry.siteId scoping.
  // ============================================================================================

  describe('Statement employee discovery — historical PayrollEntry.siteId scoping', () => {
    async function searchEmployees(agent: Agent, query = '') {
      return agent.agent.get(`/api/v1/statements/employees${query}`);
    }

    it('A/B/C: a transferred employee is discoverable by the old-site user through historical PayrollEntry.siteId, never by their current Employee.siteId', async () => {
      const admin = await masterAdminAgent('stmt-discover-admin@test.local');
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site Discover A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site Discover B');

      const alpha = await prisma.employee.create({
        data: { name: 'Discover Alpha Transferred', designation: 'Guard', siteId: siteA.id, unitId: unitA.id, grossPay: '30000' },
      });
      // Beta has always been at Site B — a *real* historical PayrollEntry there (never at Site A).
      // Created before cycle1 so she is bootstrapped and released exactly like Alpha, proving her
      // exclusion below is specifically because her own PayrollEntry.siteId is B, not merely
      // because she happens to have no history at all (that's covered separately by test H).
      const beta = await prisma.employee.create({
        data: { name: 'Discover Beta Native', designation: 'Guard', siteId: siteB.id, unitId: unitB.id, grossPay: '30000' },
      });
      const cycle1 = await makeDraftCycle(admin);
      await releaseUnit(admin, cycle1.id, unitA.id);
      await releaseUnit(admin, cycle1.id, unitB.id);

      // Transfer Alpha to Site B — her *current* Employee.siteId is now B; cycle1's own entry
      // (siteId = Site A, frozen at creation) is untouched. After this, Alpha and Beta share the
      // exact same *current* site — only their history still tells them apart.
      const transferRes = await admin.agent
        .patch(`/api/v1/employees/${alpha.id}`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ siteId: siteB.id, unitId: unitB.id });
      expect(transferRes.status).toBe(200);

      const siteAOnlyStaff = await payrollStaffAgent('stmt-discover-a-staff@test.local', [siteA.id]);

      const res = await searchEmployees(siteAOnlyStaff, '?search=Discover');
      expect(res.status).toBe(200);
      const names = res.body.employees.map((e: { name: string }) => e.name);
      expect(names).toContain('Discover Alpha Transferred');
      expect(names).not.toContain('Discover Beta Native');

      // C: the discovered employee's Statement is then genuinely viewable — the picker and the
      // Statement endpoint agree on what "discoverable" means. No response interception, no
      // mocking — the same real HTTP path an actual session would take.
      const found = res.body.employees.find((e: { name: string }) => e.name === 'Discover Alpha Transferred');
      const stmtRes = await getStatement(siteAOnlyStaff, found.employeeId);
      expect(stmtRes.status).toBe(200);
      expect(stmtRes.body.entries.some((e: { kind: string }) => e.kind === 'CYCLE_RECOVERY_DUE' || e.kind === 'CYCLE_PAID' || e.kind === 'CYCLE_PENDING')).toBe(true);
    });

    it("D: the same Site-A-only user's discovered Statement never includes the transferred employee's Site-B-only rows", async () => {
      const admin = await masterAdminAgent('stmt-discover-d-admin@test.local');
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site Discover D A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site Discover D B');

      const employee = await prisma.employee.create({
        data: { name: 'Discover D Employee', designation: 'Guard', siteId: siteA.id, unitId: unitA.id, grossPay: '30000' },
      });
      const cycle1 = await makeDraftCycle(admin);
      await releaseUnit(admin, cycle1.id, unitA.id);
      await admin.agent
        .patch(`/api/v1/employees/${employee.id}`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ siteId: siteB.id, unitId: unitB.id });
      await finalizeCycle(admin, cycle1.id);
      const cycle2 = await rollover(admin, cycle1.id); // bootstraps a Site-B entry
      const bootstrapped2 = await getEntry(admin, cycle2.id, employee.id);
      await setNetSalary(admin, bootstrapped2.id, bootstrapped2.version, '2000');
      await releaseUnit(admin, cycle2.id, unitB.id);

      const siteAOnlyStaff = await payrollStaffAgent('stmt-discover-d-staff@test.local', [siteA.id]);
      const stmtRes = await getStatement(siteAOnlyStaff, employee.id, `?fromCycleId=${cycle1.id}&toCycleId=${cycle2.id}`);
      expect(stmtRes.status).toBe(200);
      const kinds = stmtRes.body.entries.map((e: { kind: string }) => e.kind);
      // cycle2's own CYCLE_PAID outcome is a Site-B row — invisible to the Site-A-only user, the
      // exact same historical-attribution rule the existing K/L/M test already covers end to end.
      expect(kinds).not.toContain('CYCLE_PAID');
    });

    it('G: Master Admin discovers employees at any site, with no site filter required', async () => {
      const admin = await masterAdminAgent('stmt-discover-g-admin@test.local');
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site Discover G A');
      const employee = await prisma.employee.create({
        data: { name: 'Discover G Employee', designation: 'Guard', siteId: siteA.id, unitId: unitA.id, grossPay: '30000' },
      });
      const cycle = await makeDraftCycle(admin);
      await releaseUnit(admin, cycle.id, unitA.id);

      const res = await searchEmployees(admin, '?search=Discover G');
      expect(res.status).toBe(200);
      expect(res.body.employees.some((e: { employeeId: string }) => e.employeeId === employee.id)).toBe(true);
    });

    it('H: an employee with zero visible historical PayrollEntry is never returned, even to Master Admin', async () => {
      const admin = await masterAdminAgent('stmt-discover-h-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site Discover H');
      // Deliberately no cycle/entry created for this employee at all.
      const orphan = await prisma.employee.create({
        data: { name: 'Discover H Orphan Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
      });

      const res = await searchEmployees(admin, '?search=Discover H Orphan');
      expect(res.status).toBe(200);
      expect(res.body.employees.some((e: { employeeId: string }) => e.employeeId === orphan.id)).toBe(false);
    });

    it('J1: an explicit siteId filter narrows the candidate list to that site historical PayrollEntry rows only', async () => {
      const admin = await masterAdminAgent('stmt-discover-j1-admin@test.local');
      const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site Discover J1 A');
      const { site: siteB, unit: unitB } = await makeSiteWithUnit('Test Site Discover J1 B');
      const empA = await prisma.employee.create({
        data: { name: 'Discover J1 At Site A', designation: 'Guard', siteId: siteA.id, unitId: unitA.id, grossPay: '30000' },
      });
      const empB = await prisma.employee.create({
        data: { name: 'Discover J1 At Site B', designation: 'Guard', siteId: siteB.id, unitId: unitB.id, grossPay: '30000' },
      });
      const cycle = await makeDraftCycle(admin);
      await releaseUnit(admin, cycle.id, unitA.id);
      await releaseUnit(admin, cycle.id, unitB.id);

      const res = await searchEmployees(admin, `?search=Discover J1&siteId=${siteA.id}`);
      expect(res.status).toBe(200);
      const ids = res.body.employees.map((e: { employeeId: string }) => e.employeeId);
      expect(ids).toContain(empA.id);
      expect(ids).not.toContain(empB.id);
    });

    it('J2: a requested siteId outside the caller own accessible sites is rejected with 403, never silently ignored or widened', async () => {
      const { site: siteA } = await makeSiteWithUnit('Test Site Discover J2 A');
      const { site: siteB } = await makeSiteWithUnit('Test Site Discover J2 B');
      const siteAOnlyStaff = await payrollStaffAgent('stmt-discover-j2-staff@test.local', [siteA.id]);

      const res = await searchEmployees(siteAOnlyStaff, `?siteId=${siteB.id}`);
      expect(res.status).toBe(403);
    });

    it('I: search narrows by name/code/CNIC, and pageSize/page bound the result set', async () => {
      const admin = await masterAdminAgent('stmt-discover-i-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site Discover I');

      const created: { id: string; name: string }[] = [];
      for (let i = 0; i < 5; i += 1) {
        const employee = await prisma.employee.create({
          data: {
            name: `Discover I Employee ${i}`,
            employeeCode: `DISC-I-${i}`,
            designation: 'Guard',
            siteId: site.id,
            unitId: unit.id,
            grossPay: '30000',
          },
        });
        created.push(employee);
      }
      // Employees created above already existed when this cycle bootstraps, so each receives an
      // entry automatically (the same bootstrap `createPayrollCycle` itself uses) — no need for a
      // second, explicit per-employee entry-creation call.
      const cycle = await makeDraftCycle(admin);
      await releaseUnit(admin, cycle.id, unit.id);

      const bySearch = await searchEmployees(admin, '?search=DISC-I-3');
      expect(bySearch.status).toBe(200);
      expect(bySearch.body.employees).toHaveLength(1);
      expect(bySearch.body.employees[0].employeeId).toBe(created[3]!.id);

      const paged = await searchEmployees(admin, '?search=Discover I Employee&pageSize=2&page=1');
      expect(paged.status).toBe(200);
      expect(paged.body.employees).toHaveLength(2);
      expect(paged.body.total).toBe(5);
      expect(paged.body.page).toBe(1);
      expect(paged.body.pageSize).toBe(2);

      const page2 = await searchEmployees(admin, '?search=Discover I Employee&pageSize=2&page=2');
      expect(page2.body.employees).toHaveLength(2);
      const page1Ids = paged.body.employees.map((e: { employeeId: string }) => e.employeeId);
      const page2Ids = page2.body.employees.map((e: { employeeId: string }) => e.employeeId);
      expect(page1Ids.some((id: string) => page2Ids.includes(id))).toBe(false);
    });

    it('Privacy: the response carries only identity fields — no salary, banking, or Advance/correction figures', async () => {
      const admin = await masterAdminAgent('stmt-discover-privacy-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site Discover Privacy');
      const employee = await prisma.employee.create({
        data: { name: 'Discover Privacy Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000', accountNumber: '1234567890', iban: 'PK00TEST0000000000000000' },
      });
      const cycle = await makeDraftCycle(admin);
      await releaseUnit(admin, cycle.id, unit.id);

      const res = await searchEmployees(admin, '?search=Discover Privacy');
      expect(res.status).toBe(200);
      const candidate = res.body.employees[0];
      expect(Object.keys(candidate).sort()).toEqual(['cnic', 'currentSiteId', 'currentSiteName', 'employeeCode', 'employeeId', 'name'].sort());
      const serialized = JSON.stringify(candidate);
      expect(serialized).not.toContain('1234567890');
      expect(serialized).not.toContain('PK00TEST');
      expect(serialized).not.toContain('30000');
    });

    it('No N+1: the query count is fixed (count + one findMany), independent of how many employees match', async () => {
      const admin = await masterAdminAgent('stmt-discover-perf-admin@test.local');
      const { site, unit } = await makeSiteWithUnit('Test Site Discover Perf');
      for (let i = 0; i < 8; i += 1) {
        const employee = await prisma.employee.create({
          data: { name: `Discover Perf Employee ${i}`, designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
        });
        void employee;
      }
      // Created before the cycle so each employee receives a bootstrapped entry automatically.
      const cycle = await makeDraftCycle(admin);
      await releaseUnit(admin, cycle.id, unit.id);

      const sessionUser = await loadSessionUser(admin.userId);
      if (!sessionUser) throw new Error('expected a loadable session user');

      let queryCount = 0;
      const listener = () => {
        queryCount += 1;
      };
      prisma.$on('query', listener);

      // Warm up first (connection/prepared-statement cache), matching this suite's own established
      // precedent (payslips.test.ts's N+1 proof) for why an unwarmed first call isn't measured.
      await searchStatementEmployees(sessionUser, { search: 'Discover Perf' });

      queryCount = 0;
      const small = await searchStatementEmployees(sessionUser, { search: 'Discover Perf Employee 0' });
      const smallQueries = queryCount;

      queryCount = 0;
      const large = await searchStatementEmployees(sessionUser, { search: 'Discover Perf' });
      const largeQueries = queryCount;

      expect(small.employees.length).toBe(1);
      expect(large.employees.length).toBe(8);
      // A fixed cost of 3 — one COUNT, one main SELECT, and Prisma's own single batched relation
      // fetch for the joined `site.name` (its default `relationLoadStrategy` issues one extra
      // round trip for an included relation, never one per row) — identical for 1 match and for 8,
      // proving this scales with the *shape* of the query, not with how many candidates it finds.
      // A real per-candidate N+1 would instead show `largeQueries` growing well past `smallQueries`.
      expect(smallQueries).toBe(3);
      expect(largeQueries).toBe(3);
    });
  });

  // ==============================================================================================
  // Phase 7B Checkpoint 1 — Statement PDF export
  // ==============================================================================================

  /** supertest/superagent only auto-buffers `res.body` for content-types it recognizes as binary —
   * `application/pdf` isn't reliably one of them — same helper as `payslips.test.ts`'s/
   * `bank-sheets.test.ts`'s own identically-named, independently duplicated `binaryParser`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function binaryParser(res: any, callback: (err: Error | null, body: unknown) => void) {
    res.setEncoding('binary');
    let data = '';
    res.on('data', (chunk: string) => {
      data += chunk;
    });
    res.on('end', () => {
      callback(null, Buffer.from(data, 'binary'));
    });
  }

  /** Crude, heuristic page-count estimate from the raw PDF byte stream — counts `/Type /Page`
   * object entries while excluding `/Type /Pages` (the page-*tree* node, not an individual page).
   * Empirically verified against this checkpoint's own manually-inspected fixtures (1/2/10-page
   * cases each matched this count exactly) — good enough for an automated "this is genuinely
   * multi-page" signal, but not a substitute for the manual visual inspection reported alongside
   * it (this checkpoint's own report is explicit that the two are not the same kind of evidence). */
  function estimatePdfPageCount(buffer: Buffer): number {
    const matches = buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g);
    return matches ? matches.length : 0;
  }

  function getStatementPdf(agent: Agent, employeeId: string, query = '') {
    return agent.agent.get(`/api/v1/employees/${employeeId}/statement/pdf${query}`).buffer(true).parse(binaryParser);
  }

  it('A: requires authentication — an unauthenticated request is rejected', async () => {
    const { site, unit } = await makeSiteWithUnit('Test Site Stmt PDF Auth');
    const employee = await prisma.employee.create({
      data: { name: 'PDF Auth Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });
    const res = await request(app).get(`/api/v1/employees/${employee.id}/statement/pdf`);
    expect(res.status).toBe(401);
  });

  it('B: requires statements:view — a user without it is rejected', async () => {
    const admin = await masterAdminAgent('stmt-pdf-noperm-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Stmt PDF NoPerm');
    const employee = await prisma.employee.create({
      data: { name: 'PDF NoPerm Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });
    const cycle = await makeDraftCycle(admin);
    await releaseUnit(admin, cycle.id, unit.id);

    const noPerm = await createAuthenticatedAgent(app, {
      email: 'stmt-pdf-noperm-user@test.local',
      password: PASSWORD,
      roleCode: 'TEST_NO_STATEMENTS_VIEW',
      permissionKeys: [PERMISSIONS.PAYROLL_VIEW],
      siteIds: [site.id],
    });
    const res = await getStatementPdf(noPerm, employee.id);
    expect(res.status).toBe(403);
  });

  it('C: Master Admin can export a valid, non-empty PDF, always as an attachment', async () => {
    const admin = await masterAdminAgent('stmt-pdf-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Stmt PDF Admin');
    const employee = await prisma.employee.create({
      data: { name: 'PDF Admin Employee', employeeCode: 'PDFADM1', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });
    const cycle = await makeDraftCycle(admin);
    const entry = await getEntry(admin, cycle.id, employee.id);
    await setNetSalary(admin, entry.id, entry.version, '5000');
    await releaseUnit(admin, cycle.id, unit.id);

    const res = await getStatementPdf(admin, employee.id);
    expect(res.status).toBe(200);
    const buffer = res.body as Buffer;
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(0);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="employee-statement-pdfadm1-[a-z0-9-]+\.pdf"$/);
  });

  it('post-review refinement: a ?disposition=inline query param has no effect — the response is always an attachment', async () => {
    const admin = await masterAdminAgent('stmt-pdf-noinline-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Stmt PDF NoInline');
    const employee = await prisma.employee.create({
      data: { name: 'PDF NoInline Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });
    const cycle = await makeDraftCycle(admin);
    await releaseUnit(admin, cycle.id, unit.id);

    const res = await getStatementPdf(admin, employee.id, '?disposition=inline');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).not.toContain('inline');
  });

  it('H: falls back to a short-id-based filename when the employee has no employeeCode, with no CNIC or unsafe characters', async () => {
    const admin = await masterAdminAgent('stmt-pdf-filename-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Stmt PDF Filename');
    const employee = await prisma.employee.create({
      data: { name: 'PDF Filename Employee', cnic: '3520299999999', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });
    const cycle = await makeDraftCycle(admin);
    await releaseUnit(admin, cycle.id, unit.id);

    const res = await getStatementPdf(admin, employee.id);
    expect(res.status).toBe(200);
    const disposition = res.headers['content-disposition'] as string;
    expect(disposition).toMatch(/^attachment; filename="employee-statement-[a-z0-9-]+\.pdf"$/);
    expect(disposition).not.toContain('9999999');
    // The filename *value* itself (inside the quotes the header format itself always adds) must
    // contain no quote/CNIC/unsafe character — checked against the extracted value, not the whole
    // `filename="..."` header, which legitimately always has two literal quote characters.
    const filename = /filename="([^"]+)"/.exec(disposition)![1]!;
    expect(filename).not.toContain('"');
    expect(filename).not.toMatch(/[<>:'"/\\|?*]/);
  });

  it('D/E: a historically scoped user exports only their visible history; zero Site overlap preserves the concealed 404', async () => {
    const admin = await masterAdminAgent('stmt-pdf-scope-admin@test.local');
    const { site: siteA, unit: unitA } = await makeSiteWithUnit('Test Site Stmt PDF Scope A');
    const { site: siteB } = await makeSiteWithUnit('Test Site Stmt PDF Scope B');
    const employee = await prisma.employee.create({
      data: { name: 'PDF Scope Employee', designation: 'Guard', siteId: siteA.id, unitId: unitA.id, grossPay: '30000' },
    });

    const cycle1 = await makeDraftCycle(admin);
    await releaseUnit(admin, cycle1.id, unitA.id);

    const staffA = await payrollStaffAgent('stmt-pdf-scope-staffA@test.local', [siteA.id]);
    const staffB = await payrollStaffAgent('stmt-pdf-scope-staffB@test.local', [siteB.id]);

    // Site A user: visible history exists (the released cycle above) — exports successfully.
    const resA = await getStatementPdf(staffA, employee.id);
    expect(resA.status).toBe(200);
    expect((resA.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    // Site B user: zero overlap with this employee's history — the same "reveal nothing" 404
    // `getEmployeeStatement` itself already establishes for the JSON route, never a 403 that would
    // confirm the employee exists.
    const resB = await getStatementPdf(staffB, employee.id);
    expect(resB.status).toBe(404);
  });

  it('F: the requested range is passed through to the canonical Statement service exactly as the JSON route resolves it', async () => {
    const admin = await masterAdminAgent('stmt-pdf-range-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Stmt PDF Range');
    const employee = await prisma.employee.create({
      data: { name: 'PDF Range Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });
    const cycle1 = await makeDraftCycle(admin);
    await releaseUnit(admin, cycle1.id, unit.id);
    await finalizeCycle(admin, cycle1.id);
    const cycle2 = await rollover(admin, cycle1.id);
    await releaseUnit(admin, cycle2.id, unit.id);

    const jsonRes = await getStatement(admin, employee.id, `?fromCycleId=${cycle1.id}&toCycleId=${cycle1.id}`);
    expect(jsonRes.status).toBe(200);
    expect(jsonRes.body.range.fromCycle.id).toBe(cycle1.id);
    expect(jsonRes.body.range.toCycle.id).toBe(cycle1.id);

    const pdfRes = await getStatementPdf(admin, employee.id, `?fromCycleId=${cycle1.id}&toCycleId=${cycle1.id}`);
    expect(pdfRes.status).toBe(200);

    const auditEntry = await prisma.auditLog.findFirst({
      where: { action: 'statement.exported', entityId: employee.id },
      orderBy: { occurredAt: 'desc' },
    });
    const metadata = auditEntry!.metadata as { resolvedFromCycleId: string; resolvedToCycleId: string };
    expect(metadata.resolvedFromCycleId).toBe(cycle1.id);
    expect(metadata.resolvedToCycleId).toBe(cycle1.id);
  });

  it('S/T: writes exactly one statement.exported audit entry per PDF request, and never statement.viewed', async () => {
    const admin = await masterAdminAgent('stmt-pdf-audit-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Stmt PDF Audit');
    const employee = await prisma.employee.create({
      data: { name: 'PDF Audit Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });
    const cycle = await makeDraftCycle(admin);
    await releaseUnit(admin, cycle.id, unit.id);

    const res = await getStatementPdf(admin, employee.id);
    expect(res.status).toBe(200);

    const exportedEntries = await prisma.auditLog.findMany({
      where: { action: 'statement.exported', entityId: employee.id },
    });
    expect(exportedEntries).toHaveLength(1);
    expect(exportedEntries[0]!.actorUserId).toBe(admin.userId);
    expect(exportedEntries[0]!.entityType).toBe('Employee');
    const metadata = exportedEntries[0]!.metadata as { format: string; disposition: string; entryCount: number };
    expect(metadata.format).toBe('pdf');
    // `disposition` is always 'attachment' now (post-review refinement — no inline mode exists),
    // recorded as a constant rather than removed from the audit metadata shape.
    expect(metadata.disposition).toBe('attachment');
    expect(typeof metadata.entryCount).toBe('number');

    // The PDF endpoint must never also log statement.viewed — that action is reserved for the JSON
    // detail route, which this request never touched.
    const viewedEntries = await prisma.auditLog.findMany({
      where: { action: 'statement.viewed', entityId: employee.id },
    });
    expect(viewedEntries).toHaveLength(0);
  });

  it("U: causes no financial mutation — every source table's row count is identical before and after", async () => {
    const admin = await masterAdminAgent('stmt-pdf-nomut-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Stmt PDF NoMutation');
    const employee = await prisma.employee.create({
      data: { name: 'PDF NoMutation Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });
    const cycle = await makeDraftCycle(admin);
    const entry = await getEntry(admin, cycle.id, employee.id);
    await setNetSalary(admin, entry.id, entry.version, '5000');
    await releaseUnit(admin, cycle.id, unit.id);

    const before = await snapshotFinancialRowCounts(employee.id);
    const res = await getStatementPdf(admin, employee.id);
    expect(res.status).toBe(200);
    const after = await snapshotFinancialRowCounts(employee.id);
    expect(after).toEqual(before);
  });

  it('6: the canonical Statement query is issued once per PDF export, not duplicated by the render path', async () => {
    const admin = await masterAdminAgent('stmt-pdf-onefetch-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Stmt PDF OneFetch');
    const employee = await prisma.employee.create({
      data: { name: 'PDF OneFetch Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });
    const cycle = await makeDraftCycle(admin);
    await releaseUnit(admin, cycle.id, unit.id);

    // Warm up first (connection/prepared-statement cache) — matches this suite's own established
    // "No N+1" precedent above.
    await getStatement(admin, employee.id);

    let queryCount = 0;
    const listener = () => {
      queryCount += 1;
    };
    prisma.$on('query', listener);

    queryCount = 0;
    await getStatement(admin, employee.id);
    const jsonQueries = queryCount;

    queryCount = 0;
    const pdfRes = await getStatementPdf(admin, employee.id);
    const pdfQueries = queryCount;

    expect(pdfRes.status).toBe(200);
    // The PDF path issues the identical set of queries the JSON route does to build the ledger,
    // plus exactly one additional read (`getCompanySettings()`) — never roughly double, which is
    // what a second, duplicated `getEmployeeStatement()` call inside the render path would produce.
    expect(pdfQueries).toBe(jsonQueries + 1);
  });

  it('V: a PDF renderer failure returns the repository-standard safe failure response, never a stack trace', async () => {
    const admin = await masterAdminAgent('stmt-pdf-rendererror-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Stmt PDF RenderError');
    const employee = await prisma.employee.create({
      data: { name: 'PDF RenderError Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });
    const cycle = await makeDraftCycle(admin);
    await releaseUnit(admin, cycle.id, unit.id);

    const spy = jest.spyOn(renderPdfModule, 'renderHtmlToPdf').mockRejectedValueOnce(new Error('Simulated Puppeteer render failure'));
    try {
      const res = await getStatementPdf(admin, employee.id);
      expect(res.status).toBe(500);
      const body = JSON.parse((res.body as Buffer).toString('utf8'));
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(body)).not.toContain('at renderHtmlToPdf');
      expect(JSON.stringify(body)).not.toContain('.ts:');
      expect(body.error).not.toHaveProperty('stack');
    } finally {
      spy.mockRestore();
    }
  });

  it('W/X: a real, moderately large multi-cycle Statement renders as a genuine multi-page PDF with repeated headers', async () => {
    const admin = await masterAdminAgent('stmt-pdf-large-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Stmt PDF Large');
    const employee = await prisma.employee.create({
      data: { name: 'PDF Large Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '30000' },
    });

    // A real 30-cycle history through the full HTTP/DB stack — deliberately smaller than the
    // ~300-row synthetic-DTO fixture this checkpoint's own report also generated directly through
    // `renderStatementHtml`/`renderHtmlToPdf` (real Puppeteer, handcrafted data, not the full HTTP/
    // DB stack) — this test instead proves the *entire* real pipeline (DB replay →
    // `getEmployeeStatement` → `renderStatementHtml` → Puppeteer → HTTP response) produces a
    // genuinely multi-page PDF, not just the template/renderer in isolation.
    let cycle = await makeDraftCycle(admin);
    await releaseUnit(admin, cycle.id, unit.id);
    for (let i = 1; i < 30; i++) {
      await finalizeCycle(admin, cycle.id);
      cycle = await rollover(admin, cycle.id);
      await releaseUnit(admin, cycle.id, unit.id);
    }

    const res = await getStatementPdf(admin, employee.id);
    expect(res.status).toBe(200);
    const buffer = res.body as Buffer;
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    const pageCount = estimatePdfPageCount(buffer);
    expect(pageCount).toBeGreaterThan(1);
  });
});
