import { describe, expect, it } from 'vitest';
import type { PermissionCatalogEntry } from '@/hooks/use-roles';
import { groupPermissionCatalog } from './permission-catalog';

function entry(key: string, group: string): PermissionCatalogEntry {
  return { id: `id-${key}`, key, label: key, group, action: 'view' };
}

describe('groupPermissionCatalog', () => {
  it('groups entries by their group field', () => {
    const catalog = [entry('employees:view', 'Employees'), entry('employees:edit', 'Employees'), entry('sites:manage', 'Sites and Units')];

    const groups = groupPermissionCatalog(catalog);

    expect(groups).toHaveLength(2);
    const employeesGroup = groups.find(([name]) => name === 'Employees');
    expect(employeesGroup?.[1].map((e) => e.key)).toEqual(['employees:view', 'employees:edit']);
  });

  it('sorts groups alphabetically by name', () => {
    const catalog = [entry('tasks:manage', 'Tasks'), entry('advances:manage', 'Advances'), entry('reports:view', 'Reports')];

    const groups = groupPermissionCatalog(catalog);

    expect(groups.map(([name]) => name)).toEqual(['Advances', 'Reports', 'Tasks']);
  });

  it('returns an empty array for an empty catalog', () => {
    expect(groupPermissionCatalog([])).toEqual([]);
  });

  it('places a single-entry group correctly alongside multi-entry groups', () => {
    const catalog = [entry('users:manage', 'Users'), entry('employees:view', 'Employees'), entry('employees:edit', 'Employees')];

    const groups = groupPermissionCatalog(catalog);

    expect(groups.map(([name, entries]) => [name, entries.length])).toEqual([
      ['Employees', 2],
      ['Users', 1],
    ]);
  });
});
