/**
 * Field-level diffing for an `AuditLog` entry's `metadata` (docs/architecture/database-schema.md
 * §9/§22 — every mutation's audit entry carries a diff of what actually changed). The single
 * implementation of this concern — first written for Employee updates, and reused as-is by
 * Payroll Entry (Phase 3) rather than being redefined a second time.
 */

export type JsonPrimitive = string | number | boolean | null;

export function toJsonPrimitive(value: unknown): JsonPrimitive {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}

export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: JsonPrimitive; to: JsonPrimitive }> {
  const changes: Record<string, { from: JsonPrimitive; to: JsonPrimitive }> = {};
  for (const key of Object.keys(after)) {
    const normalizedBefore = toJsonPrimitive(before[key]);
    const normalizedAfter = toJsonPrimitive(after[key]);
    if (normalizedBefore !== normalizedAfter) {
      changes[key] = { from: normalizedBefore, to: normalizedAfter };
    }
  }
  return changes;
}

export function omitKeys<V>(obj: Record<string, V>, keys: string[]): Record<string, V> {
  const result: Record<string, V> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!keys.includes(key)) result[key] = value;
  }
  return result;
}
