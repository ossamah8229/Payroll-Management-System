import { Toaster as Sonner } from 'sonner';

/**
 * docs/design-system.md §3 Toast: "Bottom-right, ~3.2s auto-dismiss, used for every
 * non-destructive confirmation instead of alert()." High-stakes actions (release, correction,
 * delete) use a confirmation modal instead — built per-feature in later phases, not this
 * component.
 */
function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      duration={3200}
      toastOptions={{
        classNames: {
          toast: 'bg-text! text-white! border-none! rounded! text-xs! font-medium!',
        },
      }}
    />
  );
}

export { Toaster };
