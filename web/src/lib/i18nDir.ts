/**
 * Phase-46 / Prompt 48 — i18n direction primitives.
 *
 * Provides:
 *   - {@link RTL_LANGS}                — frozen set of RTL ISO-639-1 codes.
 *   - {@link getLangDir}               — language-tag → 'ltr' | 'rtl'.
 *   - {@link applyDocumentDirection}   — sets `<html dir>` + `<html lang>`.
 *   - {@link textAnchorForDir}         — Recharts Y-axis label anchor flip.
 *   - {@link mapControlPositionForDir} — Leaflet layer-control swap.
 *
 * Wiring is centralised in `web/src/i18n/index.ts`, which calls
 * `applyDocumentDirection(initialLang)` at boot AND registers a
 * `languageChanged` listener so future calls to `i18n.changeLanguage(...)`
 * automatically re-apply the direction without leaking knowledge of i18next
 * into helper consumers.
 */

/**
 * ISO-639-1 codes for languages that render right-to-left. The set is
 * intentionally narrow — adding a code here flips global layout, so new
 * entries should be matched by translation coverage in the same change.
 *
 * Sources:
 *   - Arabic (ar)
 *   - Hebrew (he)
 *   - Persian / Farsi (fa)
 *   - Urdu (ur)
 */
export const RTL_LANGS: ReadonlySet<string> = Object.freeze(
  new Set(['ar', 'he', 'fa', 'ur']),
);

/**
 * Direction primitive — one of 'ltr' or 'rtl'. Mirrors the value the
 * platform expects in `<html dir>`.
 */
export type Direction = 'ltr' | 'rtl';

/**
 * Resolve the writing direction for an i18next-style language tag.
 *
 * - Tags are normalised by lowercasing AND splitting on `-` so that
 *   region subtags (`ar-SA`, `he-IL`, `pt-BR`) resolve to the same
 *   direction as their bare primary subtag.
 * - Empty / nullish input falls back to `'ltr'` since LTR is the safer
 *   default for unknown locales.
 */
export function getLangDir(lang: string | null | undefined): Direction {
  if (!lang) return 'ltr';
  const primary = String(lang).toLowerCase().split('-')[0];
  return RTL_LANGS.has(primary) ? 'rtl' : 'ltr';
}

/**
 * Apply the resolved direction + language to `<html>` for the active
 * document. Safe to call in non-browser contexts (returns the resolved
 * direction without side effects) so that callers in SSR / unit tests
 * can rely on the return value.
 */
export function applyDocumentDirection(lang: string | null | undefined): Direction {
  const dir = getLangDir(lang);
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.setAttribute('dir', dir);
    if (lang) {
      document.documentElement.setAttribute('lang', String(lang));
    }
  }
  return dir;
}

/**
 * Pick the SVG `text-anchor` value for a Recharts Y-axis label so that
 * the label aligns to the inside edge of the chart in both directions.
 *
 * - LTR: Y-axis sits on the left → labels read outward → `'end'`.
 * - RTL: Y-axis sits on the right → labels read outward → `'start'`.
 *
 * X-axis labels are direction-neutral (`'middle'`) — exposed as a
 * companion helper for symmetry so callers don't hand-pick anchors.
 */
export function textAnchorForDir(
  axis: 'x' | 'y',
  dir: Direction,
): 'start' | 'middle' | 'end' {
  if (axis === 'x') return 'middle';
  return dir === 'rtl' ? 'start' : 'end';
}

/**
 * Pick the Leaflet control-position string for a top-corner control so
 * it stays on the "trailing" side of the map in both directions.
 *
 * - LTR: trailing edge is right → `'topright'`.
 * - RTL: trailing edge is left  → `'topleft'`.
 *
 * Bottom-corner controls follow the same swap via the optional `vertical`
 * argument so callers can use a single helper for the four corners.
 */
export function mapControlPositionForDir(
  dir: Direction,
  vertical: 'top' | 'bottom' = 'top',
): 'topright' | 'topleft' | 'bottomright' | 'bottomleft' {
  if (vertical === 'bottom') {
    return dir === 'rtl' ? 'bottomleft' : 'bottomright';
  }
  return dir === 'rtl' ? 'topleft' : 'topright';
}
