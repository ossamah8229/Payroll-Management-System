import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        // z-[70], above Modal's z-[60] (see modal.tsx) — discovered via Phase 2.5 Checkpoint 1's
        // Manage Units panel, the first place in the app a DropdownMenu opens *inside* an
        // already-open Modal: at z-50 it rendered behind that modal's own overlay, silently
        // swallowing every click on the menu. A dropdown is always the most recently opened,
        // currently-interactive layer relative to whatever Modal it's triggered from — whether
        // that Modal is the page's base content or, as here, another Modal already on screen —
        // so it must render above Modal in all cases, not just the base-page case the z-[60] rule
        // was originally written for.
        'z-[70] min-w-[180px] overflow-hidden rounded-lg border border-border bg-surface-2 p-1 shadow-md',
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        className,
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & { inset?: boolean }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 text-xs text-text outline-none transition-colors',
      'focus:bg-bg data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      inset && 'pl-8',
      className,
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

/**
 * A checkbox item that keeps the menu open across repeated toggles — Radix's default `onSelect`
 * behavior closes the menu on every selection, which is right for an action menu (Edit/Delete) but
 * wrong for a multi-select filter (`MultiSelectFilter`, Phase 3 Checkpoint 4): an operator toggling
 * three sites in a row shouldn't have the panel snap shut after the first click. First use of this
 * primitive; existing `DropdownMenuItem` usages (row action menus) are unaffected.
 */
const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, onSelect, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    onSelect={(event) => {
      event.preventDefault();
      onSelect?.(event);
    }}
    className={cn(
      'relative flex cursor-pointer select-none items-center gap-2 rounded py-1.5 pl-7 pr-2 text-xs text-text outline-none transition-colors',
      'focus:bg-bg data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-border-strong">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="h-3 w-3 text-accent" aria-hidden />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = DropdownMenuPrimitive.CheckboxItem.displayName;

const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn('px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted', className)}
    {...props}
  />
));
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName;

const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator ref={ref} className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
));
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
};
