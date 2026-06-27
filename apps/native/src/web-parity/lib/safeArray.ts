// Native parity port of web/src/lib/safeArray.ts.
//
// Pure, DOM-free runtime type guards. No browser, React, Recharts, Leaflet,
// or web UI dependency — the logic relies only on standard JS built-ins
// (`Array.isArray`, `typeof`, loose `==` null check) and `console.warn`,
// all of which behave identically under React Native's Hermes/JSC engines
// (`console.warn` surfaces in Metro/LogBox instead of the browser devtools
// console). This is a faithful 1:1 logic/type port; no behavioural change.

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
