import { useEffect, type ReactNode } from 'react';
import { useSession } from '@/hooks/use-session';

/**
 * Applies the signed-in user's accent color (docs/design-system.md §1.1: "User-customizable per
 * the Theme settings tab... doesn't affect other users' views") by rewriting the `--accent` CSS
 * variable at runtime. The Settings → Theme picker UI itself is a later phase; this provider is
 * the foundation it will call into — Phase 1 just needs the mechanism to exist and apply whatever
 * color is already on the session user.
 *
 * `--accent-light`/`--accent-mid` are left at their default-blue values for now — deriving
 * accurate tints/shades for an arbitrary user-picked color is a Theme-feature concern, not a
 * foundation one; this only wires up the one variable Phase 1 can act on correctly.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { data: sessionUser } = useSession();

  useEffect(() => {
    if (sessionUser?.themeAccentColor) {
      document.documentElement.style.setProperty('--accent', sessionUser.themeAccentColor);
    }
  }, [sessionUser?.themeAccentColor]);

  return children;
}
