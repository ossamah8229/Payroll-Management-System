import type { VarianceReportDirection, VarianceReportPopulationStatus } from '@payroll/shared';
import type { BadgeProps } from '@/components/ui/badge';

/**
 * Variance / Month-on-Month Report Checkpoint 1B — pure label/tone lookups over the backend's own
 * derived `populationStatus`/`direction` (frozen Checkpoint 1A contract, `shared/src/schemas/
 * variance-report.ts`). This frontend never re-derives either value, only decides how the
 * already-derived value is displayed — always alongside its own text label, never color alone
 * (Checkpoint 1B §10/§18).
 *
 * Population Status and Direction are two independent dimensions (§10): Direction only ever exists
 * for a `CONTINUED` row (`null` on every `NEW`/`DEPARTED` row) — never derive one from the other.
 */

const POPULATION_STATUS_LABELS: Record<VarianceReportPopulationStatus, string> = {
  NEW: 'New',
  DEPARTED: 'Departed',
  CONTINUED: 'Continued',
};

export function populationStatusLabel(status: VarianceReportPopulationStatus): string {
  return POPULATION_STATUS_LABELS[status];
}

/** Blue (info) for a fresh appearance, gray (neutral) for a departure, green for an ongoing/ordinary
 * employee — a population change is never itself "good" or "bad," so neither NEW nor DEPARTED uses
 * red/amber the way a real salary decrease or a hold state would. */
export function populationStatusTone(status: VarianceReportPopulationStatus): NonNullable<BadgeProps['tone']> {
  switch (status) {
    case 'NEW':
      return 'blue';
    case 'DEPARTED':
      return 'gray';
    case 'CONTINUED':
      return 'green';
  }
}

const DIRECTION_LABELS: Record<VarianceReportDirection, string> = {
  INCREASED: 'Increased',
  DECREASED: 'Decreased',
  UNCHANGED: 'Unchanged',
};

/** `null` (never a rendered badge) for `NEW`/`DEPARTED` rows — callers must check `direction !==
 * null` before calling this, mirroring `variancePercent`'s own null-for-non-CONTINUED contract. */
export function directionLabel(direction: VarianceReportDirection): string {
  return DIRECTION_LABELS[direction];
}

export function directionTone(direction: VarianceReportDirection): NonNullable<BadgeProps['tone']> {
  switch (direction) {
    case 'INCREASED':
      return 'green';
    case 'DECREASED':
      return 'red';
    case 'UNCHANGED':
      return 'gray';
  }
}
