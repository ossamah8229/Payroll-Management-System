import type { PayrollEntry } from '@/hooks/use-payroll-entries';

/**
 * Phase 7E's optimistic release preflight covers only entries the backend will actually consider
 * for this Unit's release sweep. Held entries are deliberately excluded from that candidate set;
 * including one here makes the backend correctly treat it as "no longer a live candidate" and
 * reject the entire Unit with a stale-data 409. Keep this predicate aligned with
 * `releaseProjectUnit`'s `released: false, hold: false, payoutOutcome: null` candidate query.
 */
export function expectedVersionsForUnit(
  entries: Array<Pick<PayrollEntry, 'id' | 'version' | 'released' | 'hold' | 'payoutOutcome' | 'workLines'>>,
  unitId: string,
): { entryId: string; version: number }[] {
  return entries
    .filter(
      (entry) =>
        !entry.released &&
        !entry.hold &&
        entry.payoutOutcome === null &&
        entry.workLines.some((line) => line.unitId === unitId),
    )
    .map((entry) => ({ entryId: entry.id, version: entry.version }));
}
