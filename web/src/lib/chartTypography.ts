/**
 * @module chartTypography
 *
 * Runtime typography helpers for non-DOM text — Recharts axis ticks, chart
 * labels, and Leaflet/canvas overlays. Those render into SVG/canvas and cannot
 * consume Tailwind classes, so they must read the live `--font-*` CSS variables
 * (written by FontProvider) instead of hardcoding a family or a `fontSize: 11`.
 *
 * The charts/maps sweep consumes these so chart text follows the user's chosen
 * font + text-scale just like the rest of the app.
 */

const FALLBACK_SANS = "'Inter', system-ui, -apple-system, sans-serif"

/** Historical Recharts tick size — the default base for {@link getChartFontSize}. */
const DEFAULT_BASE_PX = 11

/**
 * Defensive ceiling for the text-scale multiplier. FontProvider's slider writes
 * `--font-scale` within [0.85, 1.35], but the var is also set by the FOUC
 * bootstrap in index.html and can be hand-edited or corrupted by a peer tab, so
 * an absurd value must not blow chart labels up to hundreds of px. Kept well
 * above the slider ceiling so no legitimate preference is ever clamped.
 */
const MAX_CHART_FONT_SCALE = 3

function rootStyle(): CSSStyleDeclaration | null {
  if (typeof document === 'undefined' || !document.documentElement) return null
  try {
    return getComputedStyle(document.documentElement)
  } catch {
    return null
  }
}

/** Current resolved UI font stack (`--font-sans`), for SVG/canvas `fontFamily`. */
export function getChartFontFamily(): string {
  const s = rootStyle()
  const v = s?.getPropertyValue('--font-sans').trim()
  return v || FALLBACK_SANS
}

/**
 * Current text-scale multiplier (`--font-scale`), clamped to a sane range.
 * Non-finite / non-positive values fall back to `1`; anything above the
 * defensive ceiling is capped so malformed CSS can't produce giant chart text.
 */
export function getChartFontScale(): number {
  const s = rootStyle()
  const v = Number.parseFloat(s?.getPropertyValue('--font-scale') ?? '1')
  if (!Number.isFinite(v) || v <= 0) return 1
  return v > MAX_CHART_FONT_SCALE ? MAX_CHART_FONT_SCALE : v
}

/**
 * A chart font size (in px) derived from a design base size and the user's
 * text-scale, so SVG/canvas labels grow/shrink with the rest of the UI.
 * Defaults to the historical 11px tick size. A non-finite or non-positive
 * `basePx` (which would yield a `NaN`/`0`/negative, unrenderable font size)
 * falls back to that default rather than propagating an invalid size to SVG.
 */
export function getChartFontSize(basePx = DEFAULT_BASE_PX): number {
  const base = Number.isFinite(basePx) && basePx > 0 ? basePx : DEFAULT_BASE_PX
  return Math.round(base * getChartFontScale())
}
