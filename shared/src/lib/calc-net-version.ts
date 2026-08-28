/**
 * The explicit calculation-version concept the "Payroll Financial Integrity" checkpoint introduces
 * (`docs/PROJECT_PROGRESS.md`) — the invariant it exists to enforce is that released financial
 * history must never depend on whatever `calcNet` happens to mean in the current deployment.
 *
 * `LEGACY_V1` — the divide-before-multiply arithmetic every `PayrollEntry` in this codebase's history
 * was computed under, from `calcNet`'s own introduction (2026-07-07) through the precision fix
 * (2026-08-28). Frozen forever in `calc-net-legacy-v1.ts`.
 *
 * `V2_PRECISE` — the corrected multiply-before-divide arithmetic (`calc-net.ts`, fixed 2026-08-28).
 * The current canonical calculator for every Draft/Held/unreleased entry, and what a newly-released
 * entry's `PayrollEntryReleaseSnapshot` captures going forward.
 *
 * Deliberately a closed union, not an open-ended string — a third version can only ever be added by
 * extending this union and this file's `calcNetForVersion` dispatcher together, never silently.
 */
export type CalcNetVersion = 'LEGACY_V1' | 'V2_PRECISE';

import { calcNet, type CalcNetResult, type PayrollEntryCalcInput } from './calc-net';
import { calcNetLegacyV1 } from './calc-net-legacy-v1';

/** The one place that maps a `CalcNetVersion` to the calculator that actually implements it — every
 * historical-reconstruction call site goes through this, never branching on the version itself. */
export function calcNetForVersion(version: CalcNetVersion, input: PayrollEntryCalcInput): CalcNetResult {
  return version === 'LEGACY_V1' ? calcNetLegacyV1(input) : calcNet(input);
}
