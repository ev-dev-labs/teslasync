/**
 * Dynamic PWA / favicon SVG and PNG generation.
 *
 * The build-time icons in `web/public/icons/` use the same restrained framed
 * mark. Once a user picks a different theme in Appearance settings, the bolt
 * and frame accent follow that choice without turning the entire launcher
 * icon into a saturated gradient.
 *
 * This module generates all the icon variants we need at runtime as a pure
 * function of (primary, accent). The companion hook `useDynamicAppIcon`
 * wires the output into `<link rel="icon">` etc. and the manifest blob.
 *
 * All SVG strings share the same artwork (rounded square + lightning bolt)
 * as `web/public/icons/icon-192.svg`, `icon-maskable-192.svg`, and
 * `apple-touch-icon.png` so swapping in a dynamic version does not change
 * the silhouette — only the semantic accent.
 */

const VIEWBOX = 200
const RX_STANDARD = 44
const BOLT_PATH = 'M112 30L62 108h34L78 170l58-82h-34z'
const BRAND_BG = '#0b0d12'
const BRAND_SURFACE = '#171c25'
const DEFAULT_PRIMARY = '#3b82f6'
const DEFAULT_ACCENT = '#06b6d4'

/** Sanity-check a colour string before pasting it into an SVG; defends
 * against malformed values from corrupted localStorage / API.
 *
 * Only the four CSS hex notations are accepted — #RGB (3), #RGBA (4),
 * #RRGGBB (6), and #RRGGBBAA (8). Five- and seven-digit strings are NOT
 * valid CSS colours: a renderer silently drops malformed fills and strokes,
 * would blank the artwork — exactly the corruption this guard exists to
 * prevent — so they fall back rather than flowing through. */
function safeHex(value: string, fallback: string): string {
  return /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)
    ? value
    : fallback
}

export type AppIconMode =
  /** Standard rounded-square brand mark. Used for browser tab favicon
   *  and as the base for the PWA `icons[]` "any" purpose entries. */
  | 'standard'
  /** Maskable variant: same artwork scaled into the inner 80% safe-zone
   *  so Android's adaptive-icon mask can crop the outer 10% on each
   *  side without clipping the bolt. See https://web.dev/maskable-icon/. */
  | 'maskable'
  /** Apple-touch-icon variant with a full-bleed background. iOS applies its
   *  own outer clip mask, so the canvas itself must not be pre-rounded. */
  | 'apple'

export interface BuildIconOptions {
  primary: string
  accent: string
  mode?: AppIconMode
}

/**
 * Build the SVG markup for an app icon at the given primary/accent colour
 * pair. Returns a string of well-formed SVG suitable for either embedding
 * as a data URL or rasterising via canvas.
 *
 * Pure function — same inputs always produce byte-identical output, which
 * keeps the icon stable across re-renders so the browser doesn't churn the
 * favicon for no reason.
 */
export function buildAppIconSvg(opts: BuildIconOptions): string {
  const primary = safeHex(opts.primary, DEFAULT_PRIMARY)
  const accent = safeHex(opts.accent, DEFAULT_ACCENT)
  const mode: AppIconMode = opts.mode ?? 'standard'

  if (mode === 'apple') {
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}">`,
      `<rect width="${VIEWBOX}" height="${VIEWBOX}" fill="${BRAND_BG}"/>`,
      `<rect x="12" y="12" width="176" height="176" rx="36" fill="${BRAND_SURFACE}" stroke="${accent}" stroke-opacity="0.4" stroke-width="6"/>`,
      `<path d="${BOLT_PATH}" fill="${primary}"/>`,
      `</svg>`,
    ].join('')
  }

  if (mode === 'maskable') {
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}">`,
      `<rect width="${VIEWBOX}" height="${VIEWBOX}" fill="${BRAND_BG}"/>`,
      `<rect x="20" y="20" width="160" height="160" rx="32" fill="${BRAND_SURFACE}" stroke="${accent}" stroke-opacity="0.4" stroke-width="6"/>`,
      `<g transform="translate(20 20) scale(0.8)">`,
      `<path d="${BOLT_PATH}" fill="${primary}"/>`,
      `</g>`,
      `</svg>`,
    ].join('')
  }

  // standard
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}">`,
    `<rect width="${VIEWBOX}" height="${VIEWBOX}" rx="${RX_STANDARD}" fill="${BRAND_BG}"/>`,
    `<rect x="8" y="8" width="184" height="184" rx="38" fill="${BRAND_SURFACE}" stroke="${accent}" stroke-opacity="0.4" stroke-width="6"/>`,
    `<path d="${BOLT_PATH}" fill="${primary}"/>`,
    `</svg>`,
  ].join('')
}

/**
 * Encode an SVG string as a data URL. We use base64 rather than URL-encoded
 * UTF-8 because (a) it survives every `<link>` attribute parser and (b) it
 * is byte-stable for the same input, so the browser's URL-equality check
 * doesn't fire spurious favicon reloads.
 *
 * Uses `btoa` in the browser. In test (jsdom) `btoa` is available too.
 */
export function svgToDataUrl(svg: string): string {
  // btoa() requires Latin-1 input. SVG output here is pure ASCII (no
  // non-Latin characters in attribute values), so a plain btoa is safe.
  // If we ever start interpolating user-supplied text into SVGs, switch
  // to a UTF-8 safe encoder (TextEncoder + base64 of bytes).
  //
  // Both browsers and jsdom expose `btoa`, so this code path covers every
  // environment we run in. We guard with a runtime check anyway so the
  // function returns a predictable empty data URL instead of throwing in
  // exotic non-DOM workers.
  if (typeof btoa !== 'function') return 'data:image/svg+xml;base64,'
  return `data:image/svg+xml;base64,${btoa(svg)}`
}

/**
 * Rasterise an SVG string to a PNG data URL at the given size via canvas.
 * Returns null if the host environment cannot rasterise (test, headless
 * worker without canvas, image decode failure). Callers should treat null
 * as "skip this layer" rather than as a hard error.
 */
export function renderSvgToPngDataUrl(
  svg: string,
  size: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null)
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      resolve(null)
      return
    }
    const img = new Image()
    img.onload = () => {
      try {
        ctx.drawImage(img, 0, 0, size, size)
        resolve(canvas.toDataURL('image/png'))
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = svgToDataUrl(svg)
  })
}
