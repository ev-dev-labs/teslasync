/**
 * i18n direction primitives.
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

// Native parity port of web/src/lib/i18nDir.ts.
//
// This module is small, non-visual i18n-direction logic. RTL_LANGS, the
// Direction type, getLangDir, textAnchorForDir, and mapControlPositionForDir
// are pure: they touch only Object.freeze / Set / String / Array primitives
// that behave identically under Hermes (React Native) and Node (Jest), and
// they import nothing — no DOM, no Recharts, no Leaflet, no react-leaflet, no
// old web-UI components. textAnchorForDir and mapControlPositionForDir merely
// compute plain SVG `text-anchor` / Leaflet position STRINGS; they reference
// those libraries only in their JSDoc, so they port byte-for-byte (cf. the
// existing inline copies in
// src/web-parity/components/charts/ChartContainer.tsx).
//
// The single browser boundary is applyDocumentDirection, which the web source
// guards with `typeof document !== 'undefined' && document.documentElement`.
// React Native (Hermes) has no global `document`; the react-native-web build
// does. Following the established native idiom in columnOrderStore.ts
// (globalThis-backed Web API access), the `<html dir>` / `<html lang>` writes
// go through a `globalThis.document` accessor typed as a minimal
// WebLikeDocument. Under Hermes that accessor is undefined, so the helper takes
// exactly the source's no-document branch — it performs no side effects and
// returns the resolved direction, honouring the source's documented "Safe to
// call in non-browser contexts (returns the resolved direction without side
// effects)" contract. Under react-native-web the real document is present, so
// the attribute writes match web byte-for-byte. (Native RTL *layout*
// application via I18nManager is intentionally NOT added here: it would be a
// side effect that violates that contract and belongs to a native i18n
// bootstrap, not this 1:1 helper port.)

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
  if (!lang) {
    return 'ltr';
  }
  const primary = String(lang).toLowerCase().split('-')[0];
  return RTL_LANGS.has(primary) ? 'rtl' : 'ltr';
}

/** Minimal `<html>`-like element surface: just the `setAttribute` write the
 *  source reaches for. Avoids depending on the DOM lib (absent from the native
 *  TS config) while keeping the exact same call shape. */
interface WebLikeElement {
  setAttribute(name: string, value: string): void;
}

/** Minimal `document`-like surface exposing only `documentElement`. */
interface WebLikeDocument {
  documentElement?: WebLikeElement | null;
}

/** Resolve the ambient `document`. The real DOM document under the
 *  react-native-web build; `undefined` under Hermes/native, in which case
 *  {@link applyDocumentDirection} takes the source's no-document branch. */
function webDocument(): WebLikeDocument | undefined {
  return (globalThis as {document?: WebLikeDocument}).document;
}

/**
 * Apply the resolved direction + language to `<html>` for the active
 * document. Safe to call in non-browser contexts (returns the resolved
 * direction without side effects) so that callers in SSR / unit tests
 * can rely on the return value.
 */
export function applyDocumentDirection(
  lang: string | null | undefined,
): Direction {
  const dir = getLangDir(lang);
  const doc = webDocument();
  if (doc && doc.documentElement) {
    doc.documentElement.setAttribute('dir', dir);
    if (lang) {
      doc.documentElement.setAttribute('lang', String(lang));
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
  if (axis === 'x') {
    return 'middle';
  }
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
