/**
 * Negative Payroll Recovery checkpoint (2026-07-26) — READ-ONLY diagnostic. Reports every
 * `PayrollEntry` marked `released = true` whose own `netSalary` (recomputed via the same
 * `computeEntryCalc`/`calcNet` path every other reader uses) is negative — the exact bad-data
 * pattern this checkpoint's Part A6 was asked to investigate, not fix.
 *
 * This script makes **no writes of any kind** — it never mutates `PayrollEntry.released`, never
 * creates a `BalanceAdjustment`, never touches anything. Run it manually against whichever
 * database you point `DATABASE_URL` at:
 *
 *   npx tsx scripts/find-negative-released-entries.ts
 *
 * IMPORTANT: this has only ever been run against a local development database. It has not been
 * run against production — there is no production access available to whoever authored this
 * checkpoint. Run it against production yourself before acting on the negative/duplicate rows
 * described in the checkpoint report.
 *
 * **Pre-migration compatibility (2026-07-27 fix).** This diagnostic is explicitly meant to run
 * BEFORE `20260726120000_negative_payroll_recovery_schema` is ever deployed — the whole point is
 * finding bad data ahead of that deploy — so it must work against a database that does not yet
 * have that migration's `PayrollEntry.payoutOutcome` column. The locally generated Prisma Client
 * is built from the *current* `schema.prisma`, which already knows about `payoutOutcome`; a plain
 * `prisma.payrollEntry.findMany()` (or `include`, which selects every scalar column by default)
 * would ask Postgres for that column and fail with `P2022` against a pre-migration database. The
 * fix: `PRE_MIGRATION_SAFE_PAYROLL_ENTRY_SELECT` below is an explicit Prisma `select` that lists
 * only `PayrollEntry` columns that existed before that migration — `payoutOutcome` is deliberately
 * absent, so the generated SQL never references it, and the query succeeds on both the old and
 * the new schema. See `docs/architecture/database/payroll-entry.md`/`release.md` for the column's
 * own history; `tests/find-negative-released-entries-script.test.ts` fails if `payoutOutcome` is
 * ever added back to `PRE_MIGRATION_SAFE_PAYROLL_ENTRY_SELECT`, so a future edit can't silently
 * reintroduce the same P2022 regression.
 *
 * The calculation itself (`computeEntryCalc`/`calcNet`) never reads `payoutOutcome` (or `released`/
 * `releasedAt`/`releasedBy`, for that matter) — it only consumes the 11 `PayrollEntry` scalar
 * fields and 5 `PayrollEntryWorkLine` fields documented on `PayrollEntryCalcInput`/
 * `PayrollWorkLineCalcInput` (`shared/src/lib/calc-net.ts`), all of which predate this migration
 * and are included in the select below unchanged. `computeEntryCalc` is typed to take a full
 * `EntryWithWorkLines` (`PayrollEntry & { workLines: PayrollEntryWorkLine[] }`), so each fetched
 * row is given an explicit `payoutOutcome: null` placeholder before the cast — a value that is
 * never read by the calculation, standing in only so the object's shape satisfies that type. No
 * financial field is defaulted or falsified; only this one, calc-irrelevant, release-outcome-model
 * field is.
 *
 * Makes no writes of any kind.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { computeEntryCalc, type EntryWithWorkLines } from '../src/modules/payroll-entry/payroll-entry.service';

/**
 * Every `PayrollEntry` scalar column that existed before migration
 * `20260726120000_negative_payroll_recovery_schema` — deliberately excludes `payoutOutcome`, the
 * one column that migration added. Exported so `scripts/find-negative-released-entries.script.test.ts`
 * can assert `payoutOutcome` is absent without duplicating this literal.
 */
export const PRE_MIGRATION_SAFE_PAYROLL_ENTRY_SELECT = {
  id: true,
  cycleId: true,
  employeeId: true,
  siteId: true,
  employeeNameSnapshot: true,
  fatherNameSnapshot: true,
  designation: true,
  bankId: true,
  branchCode: true,
  accountNumber: true,
  iban: true,
  grossPay: true,
  allowance: true,
  leaveDays: true,
  leaveRate: true,
  eobiAmount: true,
  eobiApplicable: true,
  advanceDeduction: true,
  advanceId: true,
  eidAdvanceDeduction: true,
  eidAdvanceId: true,
  fine: true,
  correctionBalancePayable: true,
  correctionBalanceRecovery: true,
  hold: true,
  released: true,
  releasedAt: true,
  releasedBy: true,
  lateReason: true,
  remarks: true,
  sortOrder: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  // `PayrollEntryWorkLine` has no columns added by the negative-payroll-recovery migration, so a
  // plain nested select of every one of its own scalar fields is safe pre- and post-migration.
  workLines: {
    orderBy: { sortOrder: 'asc' as const },
    select: {
      id: true,
      payrollEntryId: true,
      siteId: true,
      unitId: true,
      days: true,
      otHours: true,
      otRate: true,
      cycleDays: true,
      sortOrder: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  cycle: { select: { id: true, year: true, month: true, status: true } },
  employee: { select: { name: true, employeeCode: true, cnic: true } },
} satisfies Prisma.PayrollEntrySelect;

type PreMigrationSafePayrollEntry = Prisma.PayrollEntryGetPayload<{ select: typeof PRE_MIGRATION_SAFE_PAYROLL_ENTRY_SELECT }>;

async function main() {
  const entries = await prisma.payrollEntry.findMany({
    where: { released: true },
    select: PRE_MIGRATION_SAFE_PAYROLL_ENTRY_SELECT,
  });

  // `payoutOutcome` is never fetched from the database (see the module doc comment above) — it is
  // not read by `computeEntryCalc`/`calcNet`, so `null` here is a type-satisfying placeholder, not
  // financial data. Every field the calculation actually reads comes from the real query above.
  const entriesForCalc: EntryWithWorkLines[] = entries.map(
    (entry: PreMigrationSafePayrollEntry) => ({ ...entry, payoutOutcome: null }) as unknown as EntryWithWorkLines,
  );

  const negative = entriesForCalc.filter((entry) => Number(computeEntryCalc(entry).netSalary) < 0);

  if (negative.length === 0) {
    console.log('No released PayrollEntry rows with a negative net salary were found in this database.');
    await prisma.$disconnect();
    return;
  }

  console.log(`Found ${negative.length} released PayrollEntry row(s) with a negative net salary:\n`);

  for (const entry of negative) {
    const calc = computeEntryCalc(entry);
    const original = entries.find((e) => e.id === entry.id)!;
    const touchedUnitIds = [...new Set(original.workLines.map((line) => line.unitId))];
    const releases = await prisma.payrollUnitRelease.findMany({
      where: { cycleId: original.cycleId, unitId: { in: touchedUnitIds } },
      select: { unitId: true },
    });
    const releasedUnitIds = new Set(releases.map((r) => r.unitId));
    const allUnitsReleased = touchedUnitIds.every((id) => releasedUnitIds.has(id));

    console.log(
      [
        `PayrollEntry ${original.id}`,
        `  Employee: ${original.employee.name} (Code: ${original.employee.employeeCode ?? 'n/a'}, CNIC: ${original.employee.cnic ?? 'n/a'})`,
        `  Cycle: ${original.cycle.year}-${String(original.cycle.month).padStart(2, '0')} (status: ${original.cycle.status})`,
        `  Net Salary: ${calc.netSalary}`,
        `  All touched Units have a PayrollUnitRelease row: ${allUnitsReleased}`,
        `  releasedAt: ${original.releasedAt?.toISOString() ?? 'null'}`,
      ].join('\n'),
    );
  }

  console.log(
    '\nThis script cannot determine whether any of these rows were ever included in an actual generated Bank Sheet/Cash Receiving export — those are derived on demand and never stored. Treat as a manual finance reconciliation question.',
  );

  await prisma.$disconnect();
}

// Guarded so importing `PRE_MIGRATION_SAFE_PAYROLL_ENTRY_SELECT` for tests
// (`tests/find-negative-released-entries-script.test.ts`) never triggers a live DB query/
// `prisma.$disconnect()` as an import side effect — `main()` only runs when this file is executed
// directly (`npx tsx scripts/find-negative-released-entries.ts`).
if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
