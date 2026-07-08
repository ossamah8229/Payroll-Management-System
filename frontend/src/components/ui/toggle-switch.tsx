import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * docs/design-system.md §3: a pill toggle with a sliding knob, used for both Hold and EOBI on/off
 * — a real component, not a native checkbox, so it reads as a physical on/off affordance for a
 * non-technical user. Callers are responsible for their own locked-state gating (§4:
 * "Hold toggle is disabled once the row is released").
 */
export interface ToggleSwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  'aria-label': string;
  className?: string;
}

export function ToggleSwitch({
  checked,
  onCheckedChange,
  disabled,
  className,
  ...aria
}: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-mid focus-visible:ring-offset-1',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-success' : 'bg-border-strong',
        className,
      )}
      {...aria}
    >
      <span
        className={cn(
          'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  );
}
