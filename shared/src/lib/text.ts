/**
 * A small heuristic pluralizer for UI copy only — e.g. turning a `ProjectSite.unitLabel` like
 * "Branch" into "Branches" for a heading such as "Manage Branches". Not a general-purpose grammar
 * engine: tuned for the common English business-noun terms this app's unit-label terminology
 * actually uses (Branch, Department, Section, Division, Area, and similar). Never used for
 * anything data-bearing — `unitLabel` itself is always stored/compared in its singular, as-entered
 * form.
 */
export function pluralize(word: string): string {
  if (!word) return word;
  if (/[sxz]$/i.test(word) || /[cs]h$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}
