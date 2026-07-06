/**
 * Dynamic PWA / favicon SVG and PNG generation.
 *
 * The build-time icons in `web/public/icons/` are baked with the cyan→emerald
 * brand gradient. Once a user picks a different theme in Appearance settings
 * (Tesla Red, Matrix Green, etc.) the on-tab favicon and the PWA install
 * icons should reflect that choice — otherwise the running app and its
 * browser-chrome representation are visually out of sync.
 *
 * This module generates all the icon variants we need at runtime as a pure
 * function of (primary, accent). The companion hook `useDynamicAppIcon`
 * wires the output into `<link rel="icon">` etc. and the manifest blob.
 *
 * All SVG strings share the same artwork (rounded square + lightning bolt)
 * as `web/public/icons/icon-192.svg`, `icon-maskable-192.svg`, and
 * `apple-touch-icon.png` so swapping in a dynamic version does not change
 * the silhouette — only the gradient stops.
 */

const VIEWBOX = 200
const RX_STANDARD = 44
const BOLT_PATH = 'M112 30L62 108h34L78 170l58-82h-34z'

/** Sanity-check a colour string before pasting it into an SVG; defends
 * against malformed values from corrupted localStorage / API.
 *
 * Only the four CSS hex notations are accepted — #RGB (3), #RGBA (4),
 * #RRGGBB (6), and #RRGGBBAA (8). Five- and seven-digit strings are NOT
 * valid CSS colours: a renderer silently drops such a `stop-color`, which
 * would blank the gradient — exactly the corruption this guard exists to
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
  /** Apple-touch-icon variant: full-bleed gradient with no rounded
   *  corners. iOS applies its own clip mask, so we must NOT pre-round. */
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
  const primary = safeHex(opts.primary, '#00f0ff')
  const accent = safeHex(opts.accent, '#10b981')
  const mode: AppIconMode = opts.mode ?? 'standard'

  if (mode === 'apple') {
    // Full-bleed: no rx, iOS rounds it. Bolt centred at the same scale
    // as the standard variant so the silhouette matches.
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}">`,
      `<defs><linearGradient id="g" x1="0" y1="0" x2="${VIEWBOX}" y2="${VIEWBOX}" gradientUnits="userSpaceOnUse">`,
      `<stop stop-color="${primary}"/><stop offset="1" stop-color="${accent}"/>`,
      `</linearGradient></defs>`,
      `<rect width="${VIEWBOX}" height="${VIEWBOX}" fill="url(#g)"/>`,
      `<path d="${BOLT_PATH}" fill="#ffffff"/>`,
      `</svg>`,
    ].join('')
  }

  if (mode === 'maskable') {
    // Bolt scaled to ~80% and centred. We keep the gradient full-bleed
    // so the safe-zone (the inner 80% Android guarantees won't be
    // cropped) shows the bolt without the bolt itself touching any
    // edge. The transform: translate(20,20) shifts the bolt into the
    // safe-zone, then scale(0.8) shrinks it.
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}">`,
      `<defs><linearGradient id="g" x1="0" y1="0" x2="${VIEWBOX}" y2="${VIEWBOX}" gradientUnits="userSpaceOnUse">`,
      `<stop stop-color="${primary}"/><stop offset="1" stop-color="${accent}"/>`,
      `</linearGradient></defs>`,
      `<rect width="${VIEWBOX}" height="${VIEWBOX}" fill="url(#g)"/>`,
      `<g transform="translate(20 20) scale(0.8)">`,
      `<path d="${BOLT_PATH}" fill="#ffffff"/>`,
      `</g>`,
      `</svg>`,
    ].join('')
  }

  // standard
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}">`,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="${VIEWBOX}" y2="${VIEWBOX}" gradientUnits="userSpaceOnUse">`,
    `<stop stop-color="${primary}"/><stop offset="1" stop-color="${accent}"/>`,
    `</linearGradient></defs>`,
    `<rect width="${VIEWBOX}" height="${VIEWBOX}" rx="${RX_STANDARD}" fill="url(#g)"/>`,
    `<path d="${BOLT_PATH}" fill="#ffffff"/>`,
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
