// Native parity port of web/src/lib/errorMessage.ts.
//
// PURPOSE (web, source L1-10): a single pure helper, getErrorMessage(err:
// unknown): string, that safely extracts a human-readable message from an
// unknown value. React Query / TanStack Query surfaces rejection reasons as
// `unknown` (source L2-4), so callers cannot assume an Error instance. The
// helper normalises the three shapes a thrown value can take:
//   • Error instance  -> err.message               (source L7)
//   • string          -> the string itself          (source L8)
//   • anything else    -> 'An unexpected error occurred' (source L9 fallback)
//
// NATIVE ADAPTATION (contract rule 6 — non-visual utility code): this module has
// ZERO imports and ZERO DOM, window, Recharts, Leaflet, or web-UI dependency. It
// relies only on the `instanceof Error` brand check, `typeof`, and a string
// literal — all of which Hermes/React Native support identically to the browser.
// There is therefore NO browser-only behavior to gate and NO "unavailable" state
// to expose; the function name, `unknown` parameter type, `string` return type,
// branch ordering, and the verbatim fallback string all port byte-for-byte. The
// only mechanical difference from the source is native formatting applied by
// prettier/eslint (statement-terminating semicolons + arrowParens:'avoid'),
// which the source already satisfies — behavior and output are bit-for-bit
// identical to the web original.
//
// NOTE: the @tanstack/react-query-backed native parity pages
// (features/maps/pages/TemperatureImpactPage.tsx,
// features/vehicle-systems/pages/SoftwareUpdatesPage.tsx) currently inline their
// own copy of this helper; this canonical module is the shared source of truth
// going forward and is import-compatible (`getErrorMessage` named export).

/**
 * Safely extract a human-readable message from an unknown error.
 * React Query errors are typed as `unknown` — this normalises
 * Error objects, strings, and arbitrary values into a string.
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'An unexpected error occurred';
}
