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

/** Current text-scale multiplier (`--font-scale`), clamped to a sane range. */
export function getChartFontScale(): number {
  const s = rootStyle()
  const v = Number.parseFloat(s?.getPropertyValue('--font-scale') ?? '1')
  return Number.isFinite(v) && v > 0 ? v : 1
}

/**
 * A chart font size (in px) derived from a design base size and the user's
 * text-scale, so SVG/canvas labels grow/shrink with the rest of the UI.
 * Defaults to the historical 11px tick size.
 */
export function getChartFontSize(basePx = 11): number {
  return Math.round(basePx * getChartFontScale())
}
