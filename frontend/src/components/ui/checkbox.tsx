import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * The one shared Checkbox for the whole app (Post-Phase-5 Stabilization Checkpoint 2, Part 4) —
 * replaces every native, unstyled `<input type="checkbox">` (Employee Registry's "Active
 * employees only" filter, the EOBI-applicable form field, Users' site-assignment list and Active
 * toggle, Payslips' select-all/per-row selection). Built on Radix (already this codebase's
 * primitive library for every other interactive control — Dialog, DropdownMenu, Label, Avatar)
 * rather than hand-rolled, so keyboard interaction, `aria-checked`, and indeterminate state are
 * correct by construction rather than reimplemented per call site.
 */
const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & {
    /** Radix's own tri-state `checked` already accepts `'indeterminate'` — re-exposed here only
     * so callers don't need to import `CheckboxPrimitive` themselves to spell the type. */
    checked?: boolean | 'indeterminate';
  }
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border border-border-strong bg-surface-2 outline-none transition-colors',
      'hover:border-accent-mid',
      'focus-visible:ring-2 focus-visible:ring-accent-light focus-visible:ring-offset-1',
      'data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-white">
      {props.checked === 'indeterminate' ? (
        <Minus className="h-3 w-3" strokeWidth={3} aria-hidden />
      ) : (
        <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
      )}
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
