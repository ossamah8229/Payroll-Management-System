import * as React from 'react';
import { formatDate, parseDateInput } from '@payroll/shared';
import { cn } from '@/lib/cn';

/**
 * The one reusable date-entry control for the whole app (`docs/design-system.md` §4). A native
 * `<input type="date">` renders in the browser's OS locale and can't be forced to `DD-MM-YYYY`, so
 * every editable date goes through this masked input instead — it always displays/accepts
 * `DD-MM-YYYY` while emitting/accepting ISO `YYYY-MM-DD` (or `''`) as its `value`/`onChange`
 * contract, matching what the shared Zod schemas (`z.string().date()`) and the API expect.
 */

function maskDateDigits(digits: string): string {
  let result = digits.slice(0, 2);
  if (digits.length > 2) result += `-${digits.slice(2, 4)}`;
  if (digits.length > 4) result += `-${digits.slice(4, 8)}`;
  return result;
}

export interface DateInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  /** ISO `YYYY-MM-DD`, or `''`/`undefined` for no date. */
  value: string | null | undefined;
  /** Called with ISO `YYYY-MM-DD` once a complete, valid date is typed, or `''` when cleared/invalid. */
  onChange: (isoValue: string) => void;
}

const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  ({ value, onChange, className, ...props }, ref) => {
    const [text, setText] = React.useState(() => formatDate(value));

    // Keep the displayed text in sync when the external ISO value changes (e.g. loading a record).
    React.useEffect(() => {
      setText(formatDate(value));
    }, [value]);

    function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
      const digitsOnly = event.target.value.replace(/\D/g, '').slice(0, 8);
      const masked = maskDateDigits(digitsOnly);
      setText(masked);

      if (digitsOnly.length === 0) {
        onChange('');
      } else if (digitsOnly.length === 8) {
        onChange(parseDateInput(masked) ?? '');
      }
      // Partial input (1-7 digits): keep displaying it, don't emit a value change yet.
    }

    function handleBlur(event: React.FocusEvent<HTMLInputElement>) {
      const digitsOnly = text.replace(/\D/g, '');
      if (digitsOnly.length > 0 && digitsOnly.length < 8) {
        // Incomplete date left on blur — revert the display to the last known-good value.
        setText(formatDate(value));
      }
      props.onBlur?.(event);
    }

    return (
      <input
        ref={ref}
        inputMode="numeric"
        placeholder="DD-MM-YYYY"
        autoComplete="off"
        className={cn(
          'flex h-9 w-full rounded border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text outline-none placeholder:text-text-faint transition-colors',
          'focus:border-accent-mid focus:ring-2 focus:ring-accent-light',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
        value={text}
        onChange={handleChange}
        onBlur={handleBlur}
      />
    );
  },
);
DateInput.displayName = 'DateInput';

export { DateInput };
