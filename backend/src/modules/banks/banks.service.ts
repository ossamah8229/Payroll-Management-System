import { CASH_BANK_CODE, type CreateBankInput, type UpdateBankInput } from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { badRequest, notFound } from '../../common/http-error';

/**
 * Bank Registry (Phase 4 Checkpoint 1, docs/architecture/database/employee.md §7). The existing
 * `Bank` model remains the single source of truth — no duplicate lookup table, no new columns.
 * `Bank.isActive` already existed before this checkpoint; this module adds the create/edit/
 * deactivate/delete surface a Master User needs on top of it, plus two frozen business rules:
 *
 * 1. A bank's `code` becomes permanently locked the moment any `Employee` or `PayrollEntry`
 *    references it — `name` and `isActive` stay editable regardless. If the export identifier
 *    genuinely needs to change, the correct workflow is creating a new Bank and deactivating the
 *    old one, never rewriting a historical identifier.
 * 2. The reserved Cash record (`code = CASH_BANK_CODE`, seeded automatically in
 *    `backend/prisma/seed.ts`) is a protected system record: it cannot be edited (code, name, or
 *    active status) or deleted, full stop, regardless of whether it's referenced.
 */

async function countBankReferences(id: string): Promise<number> {
  const [employeeCount, payrollEntryCount] = await Promise.all([
    prisma.employee.count({ where: { bankId: id } }),
    prisma.payrollEntry.count({ where: { bankId: id } }),
  ]);
  return employeeCount + payrollEntryCount;
}

/**
 * The default (`includeInactive: false`) list is what Employee Registry / Payroll Entry dropdowns
 * already consumed before this checkpoint — active banks only, and it deliberately excludes the
 * reserved Cash record so it never appears twice alongside those screens' own existing "Cash"/
 * "None (cash payment)" sentinel option. `includeInactive: true` (the Bank Registry admin screen,
 * `banks:manage`-gated at the route layer) returns every bank, including inactive ones and Cash,
 * each annotated with whether it's currently referenced — so the frontend can proactively lock the
 * Code field in the Edit dialog rather than only rejecting it on submit.
 */
export async function listBanks(options: { includeInactive?: boolean } = {}) {
  const { includeInactive = false } = options;

  const banks = await prisma.bank.findMany({
    where: includeInactive ? {} : { isActive: true, code: { not: CASH_BANK_CODE } },
    orderBy: { name: 'asc' },
  });

  if (!includeInactive) {
    return banks.map((bank) => ({ ...bank, isReferenced: false }));
  }

  return Promise.all(
    banks.map(async (bank) => ({
      ...bank,
      isReferenced: (await countBankReferences(bank.id)) > 0,
    })),
  );
}

async function getBank(id: string) {
  const bank = await prisma.bank.findUnique({ where: { id } });
  if (!bank) {
    throw notFound('Bank not found');
  }
  return bank;
}

export async function createBank(input: CreateBankInput) {
  if (input.code.toUpperCase() === CASH_BANK_CODE) {
    throw badRequest(`"${CASH_BANK_CODE}" is a reserved bank code`);
  }

  return prisma.bank.create({ data: { code: input.code, name: input.name } });
}

export async function updateBank(id: string, input: UpdateBankInput) {
  const bank = await getBank(id);

  if (bank.code === CASH_BANK_CODE) {
    if (input.code !== undefined || input.name !== undefined || input.isActive !== undefined) {
      throw badRequest('Cash is a protected system record and cannot be modified');
    }
    return bank;
  }

  if (input.code !== undefined && input.code !== bank.code) {
    if (input.code.toUpperCase() === CASH_BANK_CODE) {
      throw badRequest(`"${CASH_BANK_CODE}" is a reserved bank code`);
    }

    const referenceCount = await countBankReferences(id);
    if (referenceCount > 0) {
      throw badRequest(
        `This bank's code is locked — it is already referenced by ${referenceCount} employee/payroll record(s). Create a new bank instead and deactivate this one.`,
      );
    }
  }

  return prisma.bank.update({
    where: { id },
    data: {
      ...(input.code !== undefined && { code: input.code }),
      ...(input.name !== undefined && { name: input.name }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
    },
  });
}

export async function deleteBank(id: string): Promise<void> {
  const bank = await getBank(id);

  if (bank.code === CASH_BANK_CODE) {
    throw badRequest('Cash is a protected system record and cannot be deleted');
  }

  const referenceCount = await countBankReferences(id);
  if (referenceCount > 0) {
    throw badRequest(
      `Cannot delete this bank while ${referenceCount} employee/payroll record(s) still reference it`,
    );
  }

  await prisma.bank.delete({ where: { id } });
}
