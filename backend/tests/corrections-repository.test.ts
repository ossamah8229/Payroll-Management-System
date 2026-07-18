import { prisma } from '../src/lib/prisma';
import { cleanTestData, createTestUser } from './helpers';
import { acquirePayrollEntryLock } from '../src/modules/corrections/corrections.lock';
import {
  assertAdjustmentTypeValid,
  getApprovedCorrectionsForEntry,
  getCorrectionById,
  getEntryForCorrection,
  previewCorrection,
} from '../src/modules/corrections/corrections.repository';
import { CorrectionValidationError } from '../src/modules/corrections/corrections.types';

/**
 * Phase 6 Checkpoint 2 — DB-backed coverage for the read-only repository layer, the
 * `AdjustmentType` validity check, the `previewCorrection` orchestration end to end against real
 * rows, and the transaction-scoped advisory lock (`corrections.lock.ts`). Pure calculation-engine
 * coverage (baseline reconstruction, delta math, field validation) lives in
 * `corrections-calculation.test.ts` and needs no database at all.
 */
describe('Phase 6 Checkpoint 2 — corrections repository, orchestration, and advisory lock', () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  async function makeSiteWithUnit(name: string) {
    const site = await prisma.projectSite.create({ data: { name } });
    const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} Unit`, code: 'U-1' } });
    return { site, unit };
  }

  async function makeEmployee(siteId: string, unitId: string, name: string) {
    return prisma.employee.create({ data: { name, designation: 'Guard', siteId, unitId, grossPay: '30000' } });
  }

  async function makeUser(email: string) {
    return createTestUser({ email, password: 'CorrectHorseBattery1!', roleCode: 'TEST_MASTER' });
  }

  async function makeAdjustmentType(code: string, isActive = true) {
    return prisma.adjustmentType.create({ data: { code: `TEST_${code}`, label: code, isActive } });
  }

  // A monotonic (year, month) counter, not `Math.random()` — a test that builds two fixture sets
  // back to back (the advisory-lock tests below need two distinct PayrollEntry ids) must never
  // collide on PayrollCycle's own `@@unique([year, month])` constraint within the same run.
  let cycleCounter = 0;
  function nextCycleYearMonth(): { year: number; month: number } {
    cycleCounter += 1;
    return { year: 2900 + Math.floor(cycleCounter / 12), month: (cycleCounter % 12) + 1 };
  }

  async function makeCycle(userId: string) {
    const { year, month } = nextCycleYearMonth();
    return prisma.payrollCycle.create({ data: { year, month, createdBy: userId, status: 'RELEASED' } });
  }

  async function makeReleasedEntry(cycleId: string, employeeId: string, siteId: string, unitId: string, releasedBy: string) {
    return prisma.payrollEntry.create({
      data: {
        cycleId,
        employeeId,
        siteId,
        designation: 'Guard',
        grossPay: '30000',
        released: true,
        releasedAt: new Date(),
        releasedBy,
        workLines: { create: [{ siteId, unitId, days: '20', cycleDays: 30 }] },
      },
    });
  }

  async function makeFixtures(label: string) {
    const { site, unit } = await makeSiteWithUnit(`Test Site Corrections Repo ${label}`);
    const employee = await makeEmployee(site.id, unit.id, `Corrections Repo Employee ${label}`);
    const user = await makeUser(`corrections-repo-${label}@test.local`);
    const cycle = await makeCycle(user.id);
    const entry = await makeReleasedEntry(cycle.id, employee.id, site.id, unit.id, user.id);
    const adjustmentType = await makeAdjustmentType(label);
    return { site, unit, employee, user, cycle, entry, adjustmentType };
  }

  async function makeCorrection(entryId: string, adjustmentTypeId: string, approvedById: string, field = 'GROSS_PAY', newValue = '32000') {
    return prisma.correction.create({
      data: {
        payrollEntryId: entryId,
        field: field as never,
        oldValue: '30000',
        newValue,
        oldNetSalary: '30000',
        newNetSalary: newValue,
        adjustmentTypeId,
        reason: 'Attendance miscounted for this period',
        approvedById,
      },
    });
  }

  // --- getEntryForCorrection ------------------------------------------------------------------

  it('getEntryForCorrection returns the entry with its work lines', async () => {
    const { entry } = await makeFixtures('get-entry');
    const loaded = await getEntryForCorrection(entry.id);
    expect(loaded.id).toBe(entry.id);
    expect(loaded.workLines).toHaveLength(1);
  });

  it('getEntryForCorrection throws ENTRY_NOT_FOUND for a nonexistent id', async () => {
    await expect(getEntryForCorrection('00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({
      code: 'ENTRY_NOT_FOUND',
    });
  });

  // --- getApprovedCorrectionsForEntry ---------------------------------------------------------

  it('getApprovedCorrectionsForEntry returns an empty array when none exist', async () => {
    const { entry } = await makeFixtures('no-corrections');
    const corrections = await getApprovedCorrectionsForEntry(entry.id);
    expect(corrections).toEqual([]);
  });

  it('getApprovedCorrectionsForEntry returns every Correction row for the entry', async () => {
    const { entry, adjustmentType, user } = await makeFixtures('with-corrections');
    await makeCorrection(entry.id, adjustmentType.id, user.id, 'GROSS_PAY', '32000');
    await makeCorrection(entry.id, adjustmentType.id, user.id, 'FINE', '500');

    const corrections = await getApprovedCorrectionsForEntry(entry.id);
    expect(corrections).toHaveLength(2);
    expect(corrections.map((c) => c.field).sort()).toEqual(['FINE', 'GROSS_PAY']);
  });

  it('a PENDING CorrectionRequest against the entry has zero effect — never returned by getApprovedCorrectionsForEntry', async () => {
    const { entry, adjustmentType, user } = await makeFixtures('pending-request');
    await prisma.correctionRequest.create({
      data: {
        payrollEntryId: entry.id,
        field: 'GROSS_PAY',
        proposedNewValue: '99999',
        adjustmentTypeId: adjustmentType.id,
        reason: 'Proposed but not yet reviewed',
        requestedById: user.id,
      },
    });

    const corrections = await getApprovedCorrectionsForEntry(entry.id);
    expect(corrections).toEqual([]);
  });

  it('a REJECTED CorrectionRequest against the entry has zero effect — never returned by getApprovedCorrectionsForEntry', async () => {
    const { entry, adjustmentType, user } = await makeFixtures('rejected-request');
    await prisma.correctionRequest.create({
      data: {
        payrollEntryId: entry.id,
        field: 'GROSS_PAY',
        proposedNewValue: '99999',
        adjustmentTypeId: adjustmentType.id,
        reason: 'Proposed then rejected',
        requestedById: user.id,
        status: 'REJECTED',
        reviewedById: user.id,
        reviewedAt: new Date(),
        rejectionReason: 'Not supported by attendance records',
      },
    });

    const corrections = await getApprovedCorrectionsForEntry(entry.id);
    expect(corrections).toEqual([]);
  });

  // --- getCorrectionById -----------------------------------------------------------------------

  it('getCorrectionById resolves an existing Correction', async () => {
    const { entry, adjustmentType, user } = await makeFixtures('get-by-id');
    const created = await makeCorrection(entry.id, adjustmentType.id, user.id);
    const found = await getCorrectionById(created.id);
    expect(found?.id).toBe(created.id);
  });

  it('getCorrectionById returns null for a nonexistent id', async () => {
    const found = await getCorrectionById('00000000-0000-0000-0000-000000000000');
    expect(found).toBeNull();
  });

  // --- assertAdjustmentTypeValid ----------------------------------------------------------------

  it('assertAdjustmentTypeValid passes for an existing, active AdjustmentType', async () => {
    const type = await makeAdjustmentType('active-type', true);
    await expect(assertAdjustmentTypeValid(type.id)).resolves.toBeUndefined();
  });

  it('assertAdjustmentTypeValid throws INVALID_ADJUSTMENT_TYPE for a retired (isActive=false) AdjustmentType', async () => {
    const type = await makeAdjustmentType('retired-type', false);
    await expect(assertAdjustmentTypeValid(type.id)).rejects.toMatchObject({ code: 'INVALID_ADJUSTMENT_TYPE' });
  });

  it('assertAdjustmentTypeValid throws INVALID_ADJUSTMENT_TYPE for a nonexistent id', async () => {
    await expect(assertAdjustmentTypeValid('00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({
      code: 'INVALID_ADJUSTMENT_TYPE',
    });
  });

  // --- previewCorrection (full orchestration, real rows) --------------------------------------

  it('previewCorrection computes a full preview against real PayrollEntry/Correction rows', async () => {
    const { entry, adjustmentType } = await makeFixtures('preview-happy-path');

    const preview = await previewCorrection(entry.id, {
      field: 'GROSS_PAY',
      proposedNewValue: '32000',
      adjustmentTypeId: adjustmentType.id,
    });

    expect(preview.oldValue).toBe('30000');
    expect(preview.newValue).toBe('32000');
    expect(preview.delta.classification).toBe('PAYABLE');
  });

  it('previewCorrection reflects a prior approved Correction as its baseline', async () => {
    const { entry, adjustmentType, user } = await makeFixtures('preview-chained');
    await makeCorrection(entry.id, adjustmentType.id, user.id, 'GROSS_PAY', '32000');

    const preview = await previewCorrection(entry.id, {
      field: 'GROSS_PAY',
      proposedNewValue: '34000',
      adjustmentTypeId: adjustmentType.id,
    });

    expect(preview.oldValue).toBe('32000');
    expect(preview.newValue).toBe('34000');
  });

  it('previewCorrection rejects an invalid adjustmentTypeId before touching the calculation engine', async () => {
    const { entry } = await makeFixtures('preview-bad-adjustment-type');

    await expect(
      previewCorrection(entry.id, {
        field: 'GROSS_PAY',
        proposedNewValue: '32000',
        adjustmentTypeId: '00000000-0000-0000-0000-000000000000',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ADJUSTMENT_TYPE' });
  });

  it('previewCorrection resolves a real reversesCorrectionId end to end', async () => {
    const { entry, adjustmentType, user } = await makeFixtures('preview-reversal');
    const original = await makeCorrection(entry.id, adjustmentType.id, user.id, 'GROSS_PAY', '32000');

    const preview = await previewCorrection(entry.id, {
      field: 'GROSS_PAY',
      proposedNewValue: '30000',
      adjustmentTypeId: adjustmentType.id,
      reversesCorrectionId: original.id,
    });

    expect(preview.reversesCorrectionId).toBe(original.id);
    expect(preview.oldValue).toBe('32000');
    expect(preview.newValue).toBe('30000');
  });

  it('previewCorrection throws ENTRY_NOT_RELEASED for a still-Draft entry', async () => {
    const { site, unit } = await makeSiteWithUnit('Test Site Corrections Repo draft-entry');
    const employee = await makeEmployee(site.id, unit.id, 'Corrections Repo Employee draft-entry');
    const user = await makeUser('corrections-repo-draft-entry@test.local');
    const { year, month } = nextCycleYearMonth();
    const cycle = await prisma.payrollCycle.create({ data: { year, month, createdBy: user.id, status: 'DRAFT' } });
    const draftEntry = await prisma.payrollEntry.create({
      data: {
        cycleId: cycle.id,
        employeeId: employee.id,
        siteId: site.id,
        designation: 'Guard',
        grossPay: '30000',
        workLines: { create: [{ siteId: site.id, unitId: unit.id, days: '20', cycleDays: 30 }] },
      },
    });
    const adjustmentType = await makeAdjustmentType('draft-entry');

    await expect(
      previewCorrection(draftEntry.id, {
        field: 'GROSS_PAY',
        proposedNewValue: '32000',
        adjustmentTypeId: adjustmentType.id,
      }),
    ).rejects.toMatchObject({ code: 'ENTRY_NOT_RELEASED' });
  });

  it('CorrectionValidationError is the exact error class thrown, not merely error-shaped', async () => {
    await expect(getEntryForCorrection('00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(
      CorrectionValidationError,
    );
  });

  // --- Advisory lock ----------------------------------------------------------------------------

  describe('advisory lock', () => {
    async function hashKeyFor(payrollEntryId: string): Promise<number> {
      const rows = await prisma.$queryRaw<{ key: number }[]>`SELECT hashtext(${payrollEntryId}) as key`;
      return rows[0]!.key;
    }

    it('derives a deterministic key: the same PayrollEntry id hashes identically every time', async () => {
      const { entry } = await makeFixtures('lock-deterministic');
      const key1 = await hashKeyFor(entry.id);
      const key2 = await hashKeyFor(entry.id);
      expect(key1).toBe(key2);
    });

    it('different PayrollEntry ids hash to different keys', async () => {
      const { entry: entryA } = await makeFixtures('lock-key-a');
      const { entry: entryB } = await makeFixtures('lock-key-b');
      const keyA = await hashKeyFor(entryA.id);
      const keyB = await hashKeyFor(entryB.id);
      expect(keyA).not.toBe(keyB);
    });

    it('a second transaction locking the SAME PayrollEntry waits for the first to release', async () => {
      const { entry } = await makeFixtures('lock-same-entry');
      const holdMs = 400;

      const first = prisma.$transaction(async (tx) => {
        await acquirePayrollEntryLock(entry.id, tx);
        await new Promise((resolve) => setTimeout(resolve, holdMs));
      });
      await new Promise((resolve) => setTimeout(resolve, 50)); // let `first` acquire before starting `second`

      const secondStart = Date.now();
      let secondAcquiredAt = 0;
      const second = prisma.$transaction(async (tx) => {
        await acquirePayrollEntryLock(entry.id, tx);
        secondAcquiredAt = Date.now();
      });

      await Promise.all([first, second]);
      expect(secondAcquiredAt - secondStart).toBeGreaterThanOrEqual(holdMs - 150);
    }, 10000);

    it('a transaction locking a DIFFERENT PayrollEntry does not wait behind an unrelated lock', async () => {
      const { entry: entryA } = await makeFixtures('lock-different-a');
      const { entry: entryB } = await makeFixtures('lock-different-b');
      const holdMs = 400;

      const first = prisma.$transaction(async (tx) => {
        await acquirePayrollEntryLock(entryA.id, tx);
        await new Promise((resolve) => setTimeout(resolve, holdMs));
      });
      await new Promise((resolve) => setTimeout(resolve, 50));

      const secondStart = Date.now();
      let secondAcquiredAt = 0;
      const second = prisma.$transaction(async (tx) => {
        await acquirePayrollEntryLock(entryB.id, tx);
        secondAcquiredAt = Date.now();
      });

      await Promise.all([first, second]);
      expect(secondAcquiredAt - secondStart).toBeLessThan(holdMs / 2);
    }, 10000);
  });
});
