/**
 * Runtime guard that ensures a value is an array.
 * Use in hooks and pages when the API might return non-array data.
 *
 * @example
 * const drives = safeArray(data);  // Drive[] — guaranteed array
 * drives.map(d => ...)             // safe, never crashes
 */
export function safeArray<T>(value: T[] | T | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  console.warn('[safeArray] Expected array, got:', typeof value);
  return [];
}

/**
 * Runtime guard for nullable objects.
 * Returns the value if it's a non-null object, otherwise returns the fallback.
 */
export function safeObject<T extends Record<string, unknown>>(
  value: T | null | undefined,
  fallback: T,
): T {
  if (value != null && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return fallback;
}
