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
 * For each flagged entry, this reports: the cycle it belongs to and that cycle's status
 * (DRAFT/RELEASED/ARCHIVED), whether every Project Unit the entry touches has its own
 * `PayrollUnitRelease` row (i.e. whether a release event actually happened for it), and the
 * recomputed net salary. It deliberately does NOT claim to know whether the entry was ever
 * actually included in a generated Bank Sheet/Cash Receiving Sheet export — those are purely
 * derived, never stored (`bank-sheets.service.ts`/`cash-receiving.service.ts`), so there is no
 * historical record to check. Treat any released negative row as a manual finance reconciliation
 * question, not something this script can resolve definitively.
 */
import { prisma } from '../src/lib/prisma';
import { computeEntryCalc, type EntryWithWorkLines } from '../src/modules/payroll-entry/payroll-entry.service';

async function main() {
  const entries = await prisma.payrollEntry.findMany({
    where: { released: true },
    include: {
      workLines: { orderBy: { sortOrder: 'asc' } },
      cycle: { select: { id: true, year: true, month: true, status: true } },
      employee: { select: { name: true, employeeCode: true, cnic: true } },
    },
  });

  const negative = entries.filter((entry) => Number(computeEntryCalc(entry as EntryWithWorkLines).netSalary) < 0);

  if (negative.length === 0) {
    console.log('No released PayrollEntry rows with a negative net salary were found in this database.');
    await prisma.$disconnect();
    return;
  }

  console.log(`Found ${negative.length} released PayrollEntry row(s) with a negative net salary:\n`);

  for (const entry of negative) {
    const calc = computeEntryCalc(entry as EntryWithWorkLines);
    const touchedUnitIds = [...new Set(entry.workLines.map((line) => line.unitId))];
    const releases = await prisma.payrollUnitRelease.findMany({
      where: { cycleId: entry.cycleId, unitId: { in: touchedUnitIds } },
      select: { unitId: true },
    });
    const releasedUnitIds = new Set(releases.map((r) => r.unitId));
    const allUnitsReleased = touchedUnitIds.every((id) => releasedUnitIds.has(id));

    console.log(
      [
        `PayrollEntry ${entry.id}`,
        `  Employee: ${entry.employee.name} (Code: ${entry.employee.employeeCode ?? 'n/a'}, CNIC: ${entry.employee.cnic ?? 'n/a'})`,
        `  Cycle: ${entry.cycle.year}-${String(entry.cycle.month).padStart(2, '0')} (status: ${entry.cycle.status})`,
        `  Net Salary: ${calc.netSalary}`,
        `  All touched Units have a PayrollUnitRelease row: ${allUnitsReleased}`,
        `  releasedAt: ${entry.releasedAt?.toISOString() ?? 'null'}`,
      ].join('\n'),
    );
  }

  console.log(
    '\nThis script cannot determine whether any of these rows were ever included in an actual generated Bank Sheet/Cash Receiving export — those are derived on demand and never stored. Treat as a manual finance reconciliation question.',
  );

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
