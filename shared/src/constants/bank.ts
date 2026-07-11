/**
 * Reserved `Bank.code` for the system's permanent, protected "Cash" record
 * (docs/architecture/database/employee.md §7, Phase 4 Checkpoint 1 — Bank Registry). Seeded
 * automatically (backend/prisma/seed.ts), never created by a user, and exempt from every ordinary
 * Bank Registry edit/deactivate/delete rule (backend/src/modules/banks/banks.service.ts). Not a
 * separate model — Cash is a `Bank` row like any other, just a protected one.
 */
export const CASH_BANK_CODE = 'CASH';
