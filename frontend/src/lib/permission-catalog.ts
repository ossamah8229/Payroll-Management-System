import type { PermissionCatalogEntry } from '@/hooks/use-roles';

/**
 * Administration & Security Management Phase 1 — groups a permission catalog by its
 * presentational `group` field, sorted alphabetically by group name, for the permission-matrix
 * editor (`components/roles/permission-matrix.tsx`). Extracted as a pure function so it's
 * unit-testable directly, matching this codebase's established testing convention (logic-only
 * tests, no component rendering — `vitest.config.ts`) — the component itself only calls this and
 * renders the result, no grouping logic of its own to test separately.
 */
export function groupPermissionCatalog(catalog: PermissionCatalogEntry[]): [string, PermissionCatalogEntry[]][] {
  const byGroup = new Map<string, PermissionCatalogEntry[]>();
  for (const entry of catalog) {
    const list = byGroup.get(entry.group) ?? [];
    list.push(entry);
    byGroup.set(entry.group, list);
  }
  return Array.from(byGroup.entries()).sort(([a], [b]) => a.localeCompare(b));
}
