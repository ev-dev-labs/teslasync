/**
 * Filters Go nil string representations from API data.
 * Go's fmt.Sprintf("%v", nil) produces "<nil>" which gets stored in DB
 * and returned by the API as a literal string.
 *
 * Native conversion (contract rule 6): cleanNil is non-visual utility code
 * — a single pure string normalizer with no DOM, no browser globals, no
 * Recharts/Leaflet, and no web UI components — so the logic ports 1:1 to
 * React Native-compatible TypeScript. The public surface is identical to
 * the web (`cleanNil`).
 */
export function cleanNil(v?: string | null): string | undefined {
  if (!v || v === '<nil>' || v === 'nil' || v === 'null') return undefined;
  return v;
}
