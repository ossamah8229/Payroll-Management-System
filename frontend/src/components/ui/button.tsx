import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * docs/design-system.md §3: "5 variants × 2 sizes covers the whole app." One shared component,
 * not ad hoc classes per page — every later phase's buttons (Release, Correction approval, Copy
 * to All, etc.) reuse exactly this component.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-mid focus-visible:ring-offset-1',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-white hover:bg-accent-mid',
        secondary: 'bg-surface text-text border border-border hover:bg-bg hover:border-border-strong',
        green: 'bg-success text-white hover:brightness-110',
        amber: 'bg-warning text-white hover:brightness-110',
      },
      size: {
        default: 'px-3.5 py-1.5 text-xs',
        sm: 'px-2.5 py-1 text-[11px]',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
