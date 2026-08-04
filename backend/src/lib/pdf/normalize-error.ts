/** A safely-serializable, minimal error shape — never fabricates fields that weren't present on
 * the original value. */
export interface NormalizedError {
  name: string;
  message: string;
  stack?: string;
}

/**
 * Phase 7H — `instanceof Error` fails for an error thrown across a VM realm boundary (observed
 * directly: Jest's own `"Test environment has been torn down"` failure is thrown from a different
 * realm than the code that catches it, so it has its own `Error` constructor that doesn't match
 * this realm's `Error`). Such a value is still, in practice, a genuine Error-shaped object with
 * real own `name`/`message`/`stack` string properties — this extracts them by duck-typing instead
 * of `instanceof`, so a cross-realm error is reported accurately rather than collapsing to the
 * `errorName: "object"` fallback. Never invents a name/message/stack that wasn't actually present.
 */
export function normalizeError(error: unknown): NormalizedError {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  if (error && typeof error === 'object') {
    const candidate = error as Record<string, unknown>;
    const hasErrorShape = typeof candidate.message === 'string';
    if (hasErrorShape) {
      return {
        name: typeof candidate.name === 'string' ? candidate.name : 'Error',
        message: candidate.message as string,
        stack: typeof candidate.stack === 'string' ? candidate.stack : undefined,
      };
    }
  }
  return { name: typeof error, message: String(error) };
}
