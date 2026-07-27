/**
 * Employee Identifier Uniqueness checkpoint (2026-07-26) — READ-ONLY preflight. Reports any
 * canonical-level duplicate Employee Code, CNIC, Account Number, or IBAN already present in the
 * database, using the exact same normalization this checkpoint's migration
 * (`prisma/migrations/20260726121000_employee_account_iban_canonical_uniqueness`) and application
 * code (`shared/src/lib/banking.ts`) use.
 *
 * Run this BEFORE applying that migration against any database whose data hasn't already been
 * verified duplicate-free — the migration is self-guarding (its own `CREATE UNIQUE INDEX`
 * statements fail outright if a canonical duplicate exists, rolling back the whole migration
 * transaction), but this script gives an actionable report instead of a failed deploy.
 *
 *   npx tsx scripts/find-employee-identifier-duplicates.ts
 *
 * IMPORTANT: this has only ever been run against a local development database. It has not been
 * run against production — there is no production access available to whoever authored this
 * checkpoint. Run it against production yourself before applying the migration there.
 *
 * Makes no writes of any kind.
 */
import { normalizeAccountNumber, normalizeIban, normalizeCnic } from '@payroll/shared';
import { prisma } from '../src/lib/prisma';

interface EmployeeRow {
  id: string;
  name: string;
  employeeCode: string | null;
  cnic: string | null;
  accountNumber: string | null;
  iban: string | null;
  dateOfLeaving: Date | null;
}

function reportGroups(
  fieldLabel: string,
  employees: EmployeeRow[],
  getCanonical: (employee: EmployeeRow) => string | null,
): boolean {
  const groups = new Map<string, EmployeeRow[]>();
  for (const employee of employees) {
    const value = getCanonical(employee);
    if (!value) continue;
    const list = groups.get(value) ?? [];
    list.push(employee);
    groups.set(value, list);
  }

  const duplicateGroups = [...groups.entries()].filter(([, group]) => group.length > 1);
  if (duplicateGroups.length === 0) {
    console.log(`${fieldLabel}: no canonical-level duplicates found.`);
    return false;
  }

  console.log(`${fieldLabel}: ${duplicateGroups.length} duplicate value(s) found:`);
  for (const [value, group] of duplicateGroups) {
    console.log(`  Canonical value "${value}" is shared by ${group.length} employees:`);
    for (const employee of group) {
      console.log(
        `    - ${employee.id} (${employee.name}, Code: ${employee.employeeCode ?? 'n/a'}, ${employee.dateOfLeaving ? 'departed' : 'active'})`,
      );
    }
  }
  return true;
}

async function main() {
  const employees = await prisma.employee.findMany({
    select: { id: true, name: true, employeeCode: true, cnic: true, accountNumber: true, iban: true, dateOfLeaving: true },
  });

  console.log(`Checking ${employees.length} employee row(s) for canonical-level duplicates...\n`);

  const anyEmployeeCode = reportGroups('Employee Code', employees, (e) => (e.employeeCode ? e.employeeCode.trim() : null));
  const anyCnic = reportGroups('CNIC', employees, (e) => normalizeCnic(e.cnic));
  const anyAccountNumber = reportGroups('Account Number', employees, (e) => normalizeAccountNumber(e.accountNumber));
  const anyIban = reportGroups('IBAN', employees, (e) => normalizeIban(e.iban));

  const anyDuplicates = anyEmployeeCode || anyCnic || anyAccountNumber || anyIban;
  console.log(
    anyDuplicates
      ? '\nDuplicates found — do NOT apply the accountNumberCanonical/ibanCanonical unique-index migration to this database until these are remediated.'
      : '\nNo duplicates found — safe, as far as this database is concerned, to apply the uniqueness migration.',
  );

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
