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
 * flexbox-scrolling pitfall). The header is `shrink-0` (never scrolls).
 *
 * **Footer-overlap correction (System-Wide RBAC Consistency remediation, UAT):** the above fix
 * consolidated scrolling to one region but still rendered `ModalFooter` as `position: sticky`
 * *inside* that same scrollable body — reachable without a further scroll, but with nothing
 * reserving the footer's own height at the bottom of the body's scrollable content. Once a dialog's
 * content (e.g. the Roles & Permissions matrix with many groups) ran only slightly taller than
 * `max-h-[85vh]`, the sticky footer visually sat on top of the last item(s) rather than after them —
 * exactly the "content flows underneath the footer" / "final permission obscured" defect. Fixed by
 * making `ModalFooter` a true, non-overlaying flex sibling of the scrollable body — `ModalContent`
 * below pulls any `ModalFooter` element out of `children` and renders it *after*, not inside, the
 * scroll container, so it occupies real flex space the body can never scroll underneath. A caller
 * still just lists header content, body content, and a `<ModalFooter>` as ordinary children, in any
 * order — this component finds and repositions the footer regardless.
 */
const Modal = DialogPrimitive.Root;
const ModalTrigger = DialogPrimitive.Trigger;

function isModalFooterElement(child: React.ReactNode): child is React.ReactElement {
  return React.isValidElement(child) && child.type === ModalFooter;
}

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
  const childArray = React.Children.toArray(children);
  const footer = childArray.find(isModalFooterElement);
  const bodyChildren = childArray.filter((child) => child !== footer);

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/40 print:hidden" />
      <DialogPrimitive.Content
        className={cn(
          // print:hidden (Production Print Defect fix) — no modal, of any kind, is ever
          // printable content; this Portal renders directly into document.body, a sibling of
          // the app root, never a wrapper around it, so this can never hide the report a page
          // underneath is printing. Defense in depth only — the real fix is lifecycle-level
          // (PrintButton's flushSync-ordered close-then-print), this just guarantees the same
          // outcome even if a future regression leaves a dialog mounted at print time.
          'fixed left-1/2 top-1/2 z-[60] flex max-h-[85vh] w-[92vw] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-surface-2 shadow-md print:hidden',
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
            doing anything. `ModalFooter`, if present, was already pulled out of `children` above —
            never rendered in here, so the body can never scroll underneath it. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{bodyChildren}</div>
        {footer}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function ModalFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // A true flex sibling of the scrollable body above (see the class-level note), not
        // sandwiched inside its padding box — no negative margins needed to reach the dialog's own
        // edges, since this div is no longer nested inside anything with its own padding.
        // rounded-b-lg matches ModalContent's own rounded-lg corners at the bottom edge.
        'shrink-0 flex items-center justify-end gap-2 rounded-b-lg border-t border-border bg-surface-2 px-5 py-4',
        className,
      )}
      {...props}
    />
  );
}

export { Modal, ModalTrigger, ModalContent, ModalFooter };
