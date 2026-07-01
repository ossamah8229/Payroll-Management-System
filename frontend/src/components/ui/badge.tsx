import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * docs/design-system.md §3: "Semantic, not decorative — color always maps to the same meaning
 * app-wide (green=released/positive, amber=pending, red=hold/danger, blue=info, purple=role/
 * locked)." `blue` reuses the accent tokens rather than a separate color, matching the
 * prototype's `badge-blue` (which is literally the accent color at low opacity).
 */
const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap',
  {
    variants: {
      tone: {
        green: 'bg-success-light text-success',
        amber: 'bg-warning-light text-warning',
        red: 'bg-danger-light text-danger',
        blue: 'bg-accent-light text-accent',
        purple: 'bg-special-light text-special',
        gray: 'bg-bg text-text-muted',
        hold: 'bg-danger-light text-danger border border-danger',
      },
    },
    defaultVariants: {
      tone: 'gray',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, className }))} {...props} />;
}

export { Badge, badgeVariants };
