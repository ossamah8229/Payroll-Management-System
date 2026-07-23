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
 *
 * **UAT Defect 2 correction (Post-Phase-5 Stabilization Checkpoint 4D correction):** the outer
 * `DialogPrimitive.Content` used to carry `overflow-y-auto` directly (opted into per call site via
 * `widthClassName`, e.g. `"max-w-[640px] max-h-[85vh] overflow-y-auto"`), making the *entire*
 * header+body+footer block one scroll region with no sticky header/footer. The Roles & Permissions
 * editor additionally nested a *second*, independently `max-h`-capped `overflow-y-auto` region
 * inside its own body (the permission matrix) — two competing scroll contexts, which is what
 * produced the reported "excessive empty scrolling" / "frame and content separate" bug (the outer
 * region's own scroll extent no longer corresponded to what was visibly left to see). Fixed at the
 * shared-component level, not per-caller: `DialogPrimitive.Content` is now a fixed-height
 * (`max-h-[85vh]`, still overridable per call site) flex column with exactly one scroll region —
 * the body div below, which needs `min-h-0` alongside `flex-1` or a flex child never shrinks below
 * its content's natural height and silently defeats the parent's own height cap (the standard
 * flexbox-scrolling pitfall). The header is `shrink-0` (never scrolls); `ModalFooter` is `sticky
 * bottom-0` *within* that same body scroll region, so it stays reachable at the bottom of the
 * viewport rather than requiring a further scroll past it, without needing every caller to restructure
 * how they compose header/body/footer (still just three children in document order). Every caller
 * that previously opted into scrolling via `overflow-y-auto` in `widthClassName` had that removed
 * (now redundant/handled here); callers with a custom `max-h` (e.g. `max-h-[75vh]` for an Import
 * Results summary) keep it, since `cn()`'s tailwind-merge resolves the conflict in the caller's
 * favor. A caller with content shorter than `max-h-[85vh]` is unaffected either way — the body
 * simply never overflows, so there's nothing to scroll.
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
          'fixed left-1/2 top-1/2 z-[60] flex max-h-[85vh] w-[92vw] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-surface-2 shadow-md',
          widthClassName,
          className,
        )}
        {...props}
      >
        <div className="flex shrink-0 items-center justify-between gap-2.5 border-b border-border px-5 py-3.5">
          <DialogPrimitive.Title className="text-[13px] font-semibold text-text">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Close className="rounded p-1 text-text-muted transition-colors hover:bg-bg hover:text-text">
            <X className="h-4 w-4" aria-hidden />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </div>
        {/* The one body scroll region (see the class-level note above) — `min-h-0` is required
            alongside `flex-1`, not decorative, or this div refuses to shrink below its content's
            natural height and the outer `max-h-[85vh]` cap on `DialogPrimitive.Content` above stops
            doing anything. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function ModalFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // rounded-b-lg matches ModalContent's own rounded-lg — without it, this footer's flush
        // (-mx-5 -mb-5) rectangular background would show square corners poking past the dialog's
        // own rounded bottom corners.
        'sticky bottom-0 -mx-5 -mb-5 mt-5 flex items-center justify-end gap-2 rounded-b-lg border-t border-border bg-surface-2 px-5 py-4',
        className,
      )}
      {...props}
    />
  );
}

export { Modal, ModalTrigger, ModalContent, ModalFooter };
