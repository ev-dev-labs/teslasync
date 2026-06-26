/**
 * appIcon — native-safe port of web/src/lib/appIcon.ts.
 *
 * Web parity source: web/src/lib/appIcon.ts.
 *
 * Dynamic brand-mark SVG (and, where a DOM canvas exists, PNG) generation.
 *
 * On the web the build-time icons in web/public/icons/ are baked with the
 * cyan→emerald brand gradient. Once a user picks a different theme in
 * Appearance settings (Tesla Red, Matrix Green, etc.) the on-tab favicon and
 * the PWA install icons should reflect that choice — otherwise the running app
 * and its browser-chrome representation are visually out of sync. React Native
 * has no browser tab or PWA manifest, but the same pure (primary, accent) → SVG
 * function still drives any in-app brand mark (e.g. a react-native-svg <SvgXml>
 * splash/header glyph), so the artwork stays a single source of truth.
 *
 * All SVG strings share the same artwork (rounded square + lightning bolt) as
 * web/public/icons/icon-192.svg, icon-maskable-192.svg, and
 * apple-touch-icon.png so swapping in a dynamic version does not change the
 * silhouette — only the gradient stops.
 *
 * Browser-only seams (conversion contract rule 7): the web `btoa` data-URL
 * encoder and the `document`/`<canvas>`/`Image` PNG rasteriser are not part of
 * the React Native core runtime. svgToDataUrl() falls back to a pure-TS ASCII
 * base64 encoder that emits byte-identical output to btoa() for the ASCII SVG
 * strings this module produces; renderSvgToPngDataUrl() rasterises when a DOM
 * canvas is present (react-native-web) and otherwise resolves null — the same
 * "skip this layer" contract the web caller already honours — with the reason
 * surfaced via APP_ICON_PNG_UNAVAILABLE_REASON. No DOM modules, browser HTML
 * elements, Recharts, Leaflet, or old web UI components are imported here.
 */

const VIEWBOX = 200;
const RX_STANDARD = 44;
const BOLT_PATH = 'M112 30L62 108h34L78 170l58-82h-34z';

/** Sanity-check a colour string before pasting it into an SVG; defends
 * against malformed values from corrupted storage / API. */
function safeHex(value: string, fallback: string): string {
  return /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : fallback;
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
  | 'apple';

export interface BuildIconOptions {
  primary: string;
  accent: string;
  mode?: AppIconMode;
}

/**
 * Build the SVG markup for an app icon at the given primary/accent colour
 * pair. Returns a string of well-formed SVG suitable for either embedding
 * as a data URL or rasterising via canvas.
 *
 * Pure function — same inputs always produce byte-identical output, which
 * keeps the icon stable across re-renders so the host doesn't churn the
 * favicon / brand mark for no reason.
 */
export function buildAppIconSvg(opts: BuildIconOptions): string {
  const primary = safeHex(opts.primary, '#00f0ff');
  const accent = safeHex(opts.accent, '#10b981');
  const mode: AppIconMode = opts.mode ?? 'standard';

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
    ].join('');
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
    ].join('');
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
  ].join('');
}

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Pure-TS Latin-1 → base64 encoder. Byte-identical to the browser `btoa`
 * for the ASCII-only SVG strings buildAppIconSvg emits, so the data URL is
 * stable across every runtime (browser, jsdom, Hermes). Used as the native
 * fallback when the global `btoa` is absent.
 */
function encodeBase64Ascii(input: string): string {
  let output = '';
  let i = 0;
  while (i < input.length) {
    const byte1 = input.charCodeAt(i++) & 0xff;
    const has2 = i < input.length;
    const byte2 = has2 ? input.charCodeAt(i++) & 0xff : 0;
    const has3 = i < input.length;
    const byte3 = has3 ? input.charCodeAt(i++) & 0xff : 0;

    const enc1 = byte1 >> 2;
    const enc2 = ((byte1 & 0x03) << 4) | (byte2 >> 4);
    const enc3 = ((byte2 & 0x0f) << 2) | (byte3 >> 6);
    const enc4 = byte3 & 0x3f;

    output +=
      BASE64_ALPHABET[enc1] +
      BASE64_ALPHABET[enc2] +
      (has2 ? BASE64_ALPHABET[enc3] : '=') +
      (has3 ? BASE64_ALPHABET[enc4] : '=');
  }
  return output;
}

type Base64Encoder = (input: string) => string;

function getBtoa(): Base64Encoder | null {
  const candidate = (globalThis as typeof globalThis & { btoa?: unknown }).btoa;
  return typeof candidate === 'function' ? (candidate as Base64Encoder) : null;
}

/**
 * Encode an SVG string as a data URL. We use base64 rather than URL-encoded
 * UTF-8 because (a) it survives every attribute parser and (b) it is
 * byte-stable for the same input, so a host's URL-equality check doesn't fire
 * spurious reloads.
 *
 * Prefers the host `btoa` when present (browser / jsdom / react-native-web)
 * and falls back to a byte-identical pure-TS ASCII encoder on pure React
 * Native, so the data URL is always valid and byte-stable for the same input.
 */
export function svgToDataUrl(svg: string): string {
  // btoa() (and the fallback) require Latin-1 input. SVG output here is pure
  // ASCII (no non-Latin characters in attribute values), so a plain encode is
  // safe. If we ever start interpolating user-supplied text into SVGs, switch
  // to a UTF-8 safe encoder (TextEncoder + base64 of bytes).
  const encode = getBtoa() ?? encodeBase64Ascii;
  return `data:image/svg+xml;base64,${encode(svg)}`;
}

/**
 * Explicit unavailable-state for renderSvgToPngDataUrl on platforms without a
 * DOM canvas (pure React Native). Surfaced so callers/tests can document why a
 * PNG layer was skipped rather than guessing at the null return.
 */
export const APP_ICON_PNG_UNAVAILABLE_REASON =
  'PNG rasterisation needs a DOM <canvas>; React Native has no canvas runtime, so renderSvgToPngDataUrl resolves null (callers skip the PNG layer).';

interface HTMLImageElementLike {
  onload: (() => void) | null;
  onerror: (() => void) | null;
  src: string;
}

interface CanvasRenderingContext2DLike {
  drawImage(
    image: HTMLImageElementLike,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
}

interface HTMLCanvasElementLike {
  width: number;
  height: number;
  getContext(contextId: '2d'): CanvasRenderingContext2DLike | null;
  toDataURL(type?: string): string;
}

interface ImageConstructorLike {
  new (): HTMLImageElementLike;
}

interface DocumentLike {
  createElement(tagName: 'canvas'): HTMLCanvasElementLike;
}

function getBrowserDocument(): DocumentLike | null {
  const candidate = (globalThis as typeof globalThis & { document?: unknown })
    .document;
  if (
    candidate &&
    typeof (candidate as DocumentLike).createElement === 'function'
  ) {
    return candidate as DocumentLike;
  }
  return null;
}

function getImageConstructor(): ImageConstructorLike | null {
  const candidate = (globalThis as typeof globalThis & { Image?: unknown })
    .Image;
  return typeof candidate === 'function'
    ? (candidate as ImageConstructorLike)
    : null;
}

/**
 * Rasterise an SVG string to a PNG data URL at the given size via canvas.
 * Returns null if the host environment cannot rasterise (pure React Native
 * without a DOM canvas, image decode failure). Callers should treat null as
 * "skip this layer" rather than as a hard error — see
 * APP_ICON_PNG_UNAVAILABLE_REASON.
 */
export function renderSvgToPngDataUrl(
  svg: string,
  size: number,
): Promise<string | null> {
  return new Promise(resolve => {
    const doc = getBrowserDocument();
    const ImageCtor = getImageConstructor();
    if (!doc || !ImageCtor) {
      resolve(null);
      return;
    }
    const canvas = doc.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      resolve(null);
      return;
    }
    const img = new ImageCtor();
    img.onload = () => {
      try {
        ctx.drawImage(img, 0, 0, size, size);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = svgToDataUrl(svg);
  });
}
