import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * docs/design-system.md §3 Modal: 3-part (header with title + close, 20px-padded body,
 * right-aligned footer actions). Width varies by use — 420px for small confirmations, 520-580px
 * default, 620px for forms — passed per-instance via `widthClassName` rather than baked in, since
 * every later phase's modals (Correction approval, Advance creation, etc.) reuse this shell.
 *
 * z-[60] here, deliberately below DropdownMenuContent's z-[70] (see dropdown-menu.tsx) — a
 * DropdownMenu opened from *inside* an open Modal (e.g. Phase 2.5's Manage Units panel) must
 * render above this Modal's own overlay, not behind it.
 */
const Modal = DialogPrimitive.Root;
const ModalTrigger = DialogPrimitive.Trigger;

function ModalContent({
  className,
  widthClassName = 'max-w-[560px]',
  title,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  widthClassName?: string;
  title: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/40" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-[60] w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-surface-2 shadow-md',
          widthClassName,
          className,
        )}
        {...props}
      >
        <div className="flex items-center justify-between gap-2.5 border-b border-border px-5 py-3.5">
          <DialogPrimitive.Title className="text-[13px] font-semibold text-text">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Close className="rounded p-1 text-text-muted transition-colors hover:bg-bg hover:text-text">
            <X className="h-4 w-4" aria-hidden />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </div>
        <div className="p-5">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function ModalFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('mt-5 flex items-center justify-end gap-2 border-t border-border pt-4', className)}
      {...props}
    />
  );
}

export { Modal, ModalTrigger, ModalContent, ModalFooter };
