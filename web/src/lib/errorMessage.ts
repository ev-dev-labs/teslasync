/**
 * Safely extract a human-readable message from an unknown error.
 *
 * Async boundaries (React Query's `error`, `try/catch`, event handlers)
 * surface their failures as `unknown`. This normalises the shapes we
 * actually see in practice into a **non-empty** display string:
 *
 *   - `Error` instances — including our `ApiError` / `RateLimitError`
 *     subclasses — via `.message`;
 *   - bare thrown strings;
 *   - object-like rejections that carry a string `message` or `error`
 *     field (e.g. a raw parsed API body, or a non-`Error` throw).
 *
 * A blank result is never returned: an `Error` with an empty `message`,
 * an empty/whitespace string, or an unrecognised value all fall back to
 * `fallback`, so a caller rendering `"Failed to load: {getErrorMessage(e)}"`
 * never trails off into nothing.
 *
 * @param err      The caught value, of unknown type.
 * @param fallback Localisable last-resort message. Pass a translated string
 *                 (e.g. `t('error.unexpected', 'An unexpected error occurred')`)
 *                 to keep the fallback in the user's language.
 * @returns A non-empty, human-readable message.
 */
export function getErrorMessage(
  err: unknown,
  fallback = 'An unexpected error occurred',
): string {
  if (err instanceof Error) {
    return err.message.trim() !== '' ? err.message : fallback;
  }

  if (typeof err === 'string') {
    return err.trim() !== '' ? err : fallback;
  }

  if (err !== null && typeof err === 'object') {
    const record = err as Record<string, unknown>;
    const candidate =
      typeof record.message === 'string'
        ? record.message
        : typeof record.error === 'string'
          ? record.error
          : undefined;
    if (candidate !== undefined && candidate.trim() !== '') {
      return candidate;
    }
  }

  return fallback;
}
