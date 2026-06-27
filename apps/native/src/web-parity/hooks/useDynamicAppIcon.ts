// Native parity port of web/src/hooks/useDynamicAppIcon.ts.
//
// The web hook re-tints, in real time, the four pieces of BROWSER CHROME that
// represent the running PWA whenever the user switches theme (or tweaks the
// custom primary/accent pickers):
//   • Layer 1 — every `<link rel="icon">` favicon, swapped to a base64 SVG data
//     URL of the active primary→accent gradient, tagged with a
//     `data-dynamic-app-icon` marker + a `data-base-href` so `useFaviconBadge`
//     composites its unread-count dot over the live dynamic base (web L65-79).
//   • theme-color — the `<meta name="theme-color">` content (drives Chrome's
//     Android URL-bar tint), created if absent (web L81-91).
//   • Layer 2 — the `<link rel="apple-touch-icon">`, set to a 180×180 PNG
//     rasterised from the apple-variant SVG via a `<canvas>` (web L93-106).
//   • Layer 3 — the `<link rel="manifest">`, replaced with a Blob URL of a
//     synthetic Web App Manifest whose icons are rasterised maskable/standard
//     PNG data URLs, revoking the previous Blob URL to avoid leaks (web L108-166)
//     and a final unmount-time revoke (web L169-179).
//
// NATIVE ADAPTATION (contract rule 7 — browser-only behavior made native-safe):
//   React Native has no `document`, no favicon / apple-touch-icon / `<meta>` /
//   `<link rel="manifest">`, no `<canvas>` rasterizer, and no
//   `Blob`/`URL.createObjectURL`. None of the four DOM-injection layers exist, so
//   the actual browser-chrome mutation is UNAVAILABLE
//   (DYNAMIC_APP_ICON_DOM_UNAVAILABLE_REASON) and SVG→PNG rasterization is
//   UNAVAILABLE (DYNAMIC_APP_ICON_PNG_UNAVAILABLE_REASON). What IS platform-
//   agnostic — deriving the icon artwork from (primary, accent) — is ported
//   faithfully and the computed brand intent (favicon SVG + its data URL, the
//   `data-base-href` coordination value, the theme-color, the apple/standard/
//   maskable artwork, and the synthetic manifest metadata) is published to an
//   observable in-process snapshot store (subscribeDynamicAppIcon /
//   getDynamicAppIconSnapshot) that a native brand surface MAY consume — e.g. a
//   react-native-svg header mark, a status-bar tint, or a splash icon. This is
//   the established useCriticalAlertFlash precedent: do the computable work,
//   publish the intent to a module store, and document the unavailable DOM sink.
//
// Per-import native adaptation:
//   - react useEffect/useRef (web L1) -> kept verbatim (useEffect/useRef).
//   - @/components/ui/ThemeProvider useTheme (web L2) -> the native
//     ../components/ui/ThemeProvider useTheme (same context, same
//     theme.primary/theme.accent shape).
//   - @/lib/appIcon buildAppIconSvg/renderSvgToPngDataUrl/svgToDataUrl (web L3-7)
//     -> inlined native-safe equivalents (no native web-parity/lib/appIcon module
//     exists). buildAppIconSvg is a pure SVG-string builder ported verbatim.
//     svgToDataUrl uses a self-contained ASCII base64 encoder instead of the
//     browser `btoa` (which Hermes does not ship) so the data URL is identical on
//     device and under Jest. renderSvgToPngDataUrl has no `<canvas>`/Image on
//     native and resolves null — exactly the web hook's documented
//     jsdom/headless skip path.
//
// State names (lastBlobUrlRef, lastSignatureRef), the `${primary}|${accent}`
// signature dedup, the two-effect structure (theme effect + unmount cleanup),
// and the DYNAMIC_MARK / FALLBACK_BG constants are all preserved.
//
// No DOM, document, canvas, Blob/URL, Recharts, Leaflet, or web-UI imports reach
// this native output — only react and the native ThemeProvider parity module.

import { useEffect, useRef } from 'react';

import { useTheme } from '../components/ui/ThemeProvider';

/**
 * Marker attribute the web hook tags every dynamically-mutated `<link>` /
 * `<meta>` with so `useFaviconBadge` can find the "live base" href and so a
 * re-applied identical theme can no-op (web L14). React Native has no DOM nodes
 * to mark; the value is surfaced in the published snapshot (`dynamicMark`) so a
 * native favicon-badge analog can key on the same coordination string.
 */
const DYNAMIC_MARK = 'data-dynamic-app-icon';

/**
 * Default fallback background used when the manifest theme-color is missing.
 * Matches the build-time `background_color` in `vite.config.ts` (web L20).
 */
const FALLBACK_BG = '#0a0a0f';

/* ------------------------------------------------------------------ */
/*  Inlined native-safe @/lib/appIcon helpers                          */
/* ------------------------------------------------------------------ */

const VIEWBOX = 200;
const RX_STANDARD = 44;
const BOLT_PATH = 'M112 30L62 108h34L78 170l58-82h-34z';

/**
 * Sanity-check a colour string before pasting it into an SVG; defends against
 * malformed values from corrupted persistence / API (web appIcon L24-28).
 */
function safeHex(value: string, fallback: string): string {
  return /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : fallback;
}

type AppIconMode = 'standard' | 'maskable' | 'apple';

interface BuildIconOptions {
  primary: string;
  accent: string;
  mode?: AppIconMode;
}

/**
 * Build the SVG markup for an app icon at the given primary/accent colour pair.
 * Pure function (web appIcon L48-105) — same inputs always produce byte-identical
 * output. Ported verbatim; contains no DOM or browser dependency.
 */
function buildAppIconSvg(opts: BuildIconOptions): string {
  const primary = safeHex(opts.primary, '#00f0ff');
  const accent = safeHex(opts.accent, '#10b981');
  const mode: AppIconMode = opts.mode ?? 'standard';

  if (mode === 'apple') {
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
 * Self-contained ASCII/Latin-1 base64 encoder. The web `svgToDataUrl` relies on
 * the browser `btoa` (web appIcon L107-127); React Native (Hermes) does not ship
 * `btoa`, so a local encoder is used to guarantee byte-identical output on device
 * and under Jest (Node). The generated SVG is pure ASCII, so encoding bytes 0-255
 * directly is safe — the same constraint the web `btoa` path documents.
 */
/* eslint-disable no-bitwise -- base64 encoding is inherently bitwise */
function encodeBase64Ascii(input: string): string {
  let output = '';
  let i = 0;
  while (i < input.length) {
    const c1 = input.charCodeAt(i++) & 0xff;
    const c2 = i < input.length ? input.charCodeAt(i++) & 0xff : NaN;
    const c3 = i < input.length ? input.charCodeAt(i++) & 0xff : NaN;
    const e1 = c1 >> 2;
    const e2 = ((c1 & 0x03) << 4) | (Number.isNaN(c2) ? 0 : c2 >> 4);
    const e3 = Number.isNaN(c2)
      ? 64
      : ((c2 & 0x0f) << 2) | (Number.isNaN(c3) ? 0 : c3 >> 6);
    const e4 = Number.isNaN(c3) ? 64 : c3 & 0x3f;
    output +=
      BASE64_ALPHABET.charAt(e1) +
      BASE64_ALPHABET.charAt(e2) +
      (e3 === 64 ? '=' : BASE64_ALPHABET.charAt(e3)) +
      (e4 === 64 ? '=' : BASE64_ALPHABET.charAt(e4));
  }
  return output;
}
/* eslint-enable no-bitwise */

/**
 * Encode an SVG string as a base64 `image/svg+xml` data URL (web appIcon
 * L107-127). Byte-stable for the same input. Uses the local encoder above rather
 * than the browser `btoa`.
 */
function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${encodeBase64Ascii(svg)}`;
}

/**
 * Web appIcon L129-164 rasterises an SVG to a PNG data URL via `<canvas>`,
 * returning null when the host cannot rasterise (test, headless worker without
 * canvas, decode failure) — callers treat null as "skip this layer". React Native
 * has no `<canvas>`/`Image` rasterizer, so this native analog always resolves
 * null, taking exactly that documented skip path. See
 * {@link DYNAMIC_APP_ICON_PNG_UNAVAILABLE_REASON}.
 */
function renderSvgToPngDataUrl(
  _svg: string,
  _size: number,
): Promise<string | null> {
  return Promise.resolve(null);
}

/* ------------------------------------------------------------------ */
/*  Native-unavailable state (contract rule 7)                         */
/* ------------------------------------------------------------------ */

/**
 * Why the four browser-chrome injection layers (favicon, apple-touch-icon,
 * theme-color meta, manifest blob) cannot run on React Native.
 */
export const DYNAMIC_APP_ICON_DOM_UNAVAILABLE_REASON =
  'React Native has no document, no favicon / apple-touch-icon <link>, no <meta name="theme-color">, no <link rel="manifest">, and no Blob / URL.createObjectURL, so useDynamicAppIcon cannot inject the dynamically-themed icons into browser chrome. The computed brand artwork (favicon SVG + data URL, the data-base-href coordination value, the theme-color, the apple/standard/maskable SVGs, and the synthetic manifest metadata) is instead published to the observable snapshot store (subscribeDynamicAppIcon / getDynamicAppIconSnapshot) for a native brand surface to consume.';

/**
 * Why the apple-touch-icon and manifest PNG rasters are absent on React Native.
 */
export const DYNAMIC_APP_ICON_PNG_UNAVAILABLE_REASON =
  'React Native has no <canvas> / Image SVG rasterizer, so useDynamicAppIcon cannot rasterise the apple-touch-icon (180px) or the manifest maskable/standard PNG icons (192/512px). renderSvgToPngDataUrl resolves null — exactly the web hook\u2019s documented jsdom/headless skip — so the published snapshot exposes the source SVG artwork while its PNG fields stay null (pngIconsAvailable: false).';

/* ------------------------------------------------------------------ */
/*  Observable published-intent snapshot store                         */
/* ------------------------------------------------------------------ */

/** One icon entry of the synthetic Web App Manifest (web L144-149). */
export interface DynamicAppIconManifestIcon {
  /** PNG raster data URL on the web; null on native (raster unavailable). */
  src: string | null;
  sizes: string;
  type: string;
  purpose: 'any' | 'maskable';
}

/** The synthetic Web App Manifest the web hook injects (web L135-150). */
export interface DynamicAppIconManifest {
  name: string;
  short_name: string;
  start_url: string;
  display: string;
  background_color: string;
  theme_color: string;
  orientation: string;
  categories: string[];
  icons: DynamicAppIconManifestIcon[];
}

/**
 * The dynamic-app-icon brand intent the web hook would have injected into
 * browser chrome, published for a native brand surface to consume.
 */
export interface DynamicAppIconSnapshot {
  /** `${primary}|${accent}` change signature (web L61). */
  signature: string;
  primary: string;
  accent: string;
  /** Favicon artwork SVG markup (web Layer 1, mode 'standard'). */
  faviconSvg: string;
  /** Favicon SVG as a base64 data URL (the web `<link rel="icon">` href). */
  faviconDataUrl: string;
  /**
   * The live base href a native favicon-badge surface composites over — the web
   * `data-base-href` coordination value (web L78). Equals faviconDataUrl.
   */
  baseHref: string;
  /** The web DOM marker attribute key (web L14), surfaced for parity. */
  dynamicMark: string;
  /** Chrome URL-bar / theme-color tint (web `<meta name="theme-color">`, L90). */
  themeColor: string;
  /** apple-touch-icon artwork SVG (web Layer 2 source). */
  appleSvg: string;
  /** apple-touch-icon 180px PNG data URL; null on native (raster unavailable). */
  appleTouchIconPng: string | null;
  /** standard PWA icon artwork SVG (web Layer 3 base). */
  standardSvg: string;
  /** maskable PWA icon artwork SVG (web Layer 3 base). */
  maskableSvg: string;
  /** The synthetic Web App Manifest (web Layer 3). */
  manifest: DynamicAppIconManifest;
  /** Whether the manifest icon PNG rasters are populated (false on native). */
  pngIconsAvailable: boolean;
}

type DynamicAppIconListener = (snapshot: DynamicAppIconSnapshot | null) => void;

const snapshotListeners = new Set<DynamicAppIconListener>();
let currentSnapshot: DynamicAppIconSnapshot | null = null;

/** Current published dynamic-app-icon snapshot (null before first publish). */
export function getDynamicAppIconSnapshot(): DynamicAppIconSnapshot | null {
  return currentSnapshot;
}

/**
 * Subscribe to dynamic-app-icon snapshot changes. A native brand surface (header
 * mark, status-bar tint, splash icon) can use this to mirror the web's live
 * favicon/manifest re-tint. Returns an unsubscribe.
 */
export function subscribeDynamicAppIcon(
  listener: DynamicAppIconListener,
): () => void {
  snapshotListeners.add(listener);
  return () => {
    snapshotListeners.delete(listener);
  };
}

function publishDynamicAppIcon(snapshot: DynamicAppIconSnapshot | null): void {
  currentSnapshot = snapshot;
  for (const listener of Array.from(snapshotListeners)) {
    listener(snapshot);
  }
}

/* ------------------------------------------------------------------ */
/*  The hook                                                           */
/* ------------------------------------------------------------------ */

/**
 * Re-derives the themed app-icon artwork (favicon, apple-touch-icon, theme-color,
 * PWA manifest) whenever the user switches theme or tweaks the custom
 * primary/accent pickers, and publishes the result to the observable snapshot
 * store.
 *
 * On the web this mutates `<link rel="icon">`, `<link rel="apple-touch-icon">`,
 * `<meta name="theme-color">`, and `<link rel="manifest">` in real time. React
 * Native has none of those, so the browser-chrome injection is unavailable
 * (DYNAMIC_APP_ICON_DOM_UNAVAILABLE_REASON) and SVG→PNG rasterization is
 * unavailable (DYNAMIC_APP_ICON_PNG_UNAVAILABLE_REASON); the computed brand
 * intent is published via subscribeDynamicAppIcon instead. Mount once near the
 * root of the app.
 */
export function useDynamicAppIcon(): void {
  const { theme } = useTheme();
  const lastBlobUrlRef = useRef<string | null>(null);
  const lastSignatureRef = useRef<string>('');

  useEffect(() => {
    // Web L57 bailed when `typeof document === 'undefined'`. React Native has no
    // document; rather than bail we publish the computed brand intent below. The
    // browser-chrome injection itself is unavailable
    // (DYNAMIC_APP_ICON_DOM_UNAVAILABLE_REASON).
    const primary = theme.primary;
    const accent = theme.accent;
    const signature = `${primary}|${accent}`;
    if (signature === lastSignatureRef.current) {
      return;
    }
    lastSignatureRef.current = signature;

    // ── Layer 1: favicon (web L65-79) ────────────────────────────────────
    const faviconSvg = buildAppIconSvg({ primary, accent, mode: 'standard' });
    const faviconHref = svgToDataUrl(faviconSvg);

    // ── theme-color meta (web L81-91) ────────────────────────────────────
    const themeColor = primary;

    // ── Layer 2 source: apple-touch-icon (web L96) ───────────────────────
    const appleSvg = buildAppIconSvg({ primary, accent, mode: 'apple' });

    // ── Layer 3 sources: manifest icons (web L114-115) ───────────────────
    const standardSvg = buildAppIconSvg({ primary, accent, mode: 'standard' });
    const maskableSvg = buildAppIconSvg({ primary, accent, mode: 'maskable' });

    // Build the synthetic manifest (web L135-150). PNG icon srcs are null on
    // native (DYNAMIC_APP_ICON_PNG_UNAVAILABLE_REASON); every metadata field —
    // including background_color: FALLBACK_BG (web L140) and theme_color: primary
    // (web L141) — is preserved.
    const manifest: DynamicAppIconManifest = {
      name: 'TeslaSync',
      short_name: 'TeslaSync',
      start_url: '/',
      display: 'standalone',
      background_color: FALLBACK_BG,
      theme_color: primary,
      orientation: 'any',
      categories: ['auto', 'utilities'],
      icons: [
        { src: null, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: null, sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: null, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
        { src: null, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    };

    // Publish synchronously: favicon + theme-color + manifest metadata are
    // available immediately, mirroring the web's instant Layer 1 + theme-color.
    publishDynamicAppIcon({
      signature,
      primary,
      accent,
      faviconSvg,
      faviconDataUrl: faviconHref,
      baseHref: faviconHref,
      dynamicMark: DYNAMIC_MARK,
      themeColor,
      appleSvg,
      appleTouchIconPng: null,
      standardSvg,
      maskableSvg,
      manifest,
      pngIconsAvailable: false,
    });

    // ── Layer 2: apple-touch-icon raster (web L97-106) ───────────────────
    // Fire-and-forget. Native raster resolves null, so the `if (!dataUrl) return`
    // skip fires exactly as on the web when canvas is unavailable; if a native
    // raster ever becomes available this patches appleTouchIconPng in place.
    void renderSvgToPngDataUrl(appleSvg, 180).then(dataUrl => {
      if (!dataUrl) {
        return;
      }
      const snap = currentSnapshot;
      if (!snap || snap.signature !== signature) {
        return;
      }
      publishDynamicAppIcon({ ...snap, appleTouchIconPng: dataUrl });
    });

    // ── Layer 3: manifest raster + link (web L117-166) ───────────────────
    // Rasterize the 4 manifest PNGs and only when ALL succeed build + link the
    // manifest blob. Native raster resolves null, so the `if (!std192 || ...)
    // return` skip fires (faithful to the web jsdom skip), and the Blob /
    // URL.createObjectURL manifest linking is itself unavailable on native
    // (DYNAMIC_APP_ICON_DOM_UNAVAILABLE_REASON) — the manifest metadata is already
    // published above; only the PNG raster srcs + blob href are missing.
    void Promise.all([
      renderSvgToPngDataUrl(standardSvg, 192),
      renderSvgToPngDataUrl(standardSvg, 512),
      renderSvgToPngDataUrl(maskableSvg, 192),
      renderSvgToPngDataUrl(maskableSvg, 512),
    ]).then(([std192, std512, msk192, msk512]) => {
      if (!std192 || !std512 || !msk192 || !msk512) {
        return;
      }
      const snap = currentSnapshot;
      if (!snap || snap.signature !== signature) {
        return;
      }
      // Free the previous manifest (web L157-165 revokes the previous blob URL
      // AFTER the swap); on native the prior published manifest is simply
      // superseded by the patched snapshot below.
      const previous = lastBlobUrlRef.current;
      const patchedManifest: DynamicAppIconManifest = {
        ...snap.manifest,
        icons: [
          { src: std192, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: std512, sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: msk192,
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: msk512,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      };
      publishDynamicAppIcon({
        ...snap,
        manifest: patchedManifest,
        pngIconsAvailable: true,
      });
      lastBlobUrlRef.current = signature;
      if (previous) {
        // Web URL.revokeObjectURL(previous) — no blob URL exists on native.
      }
    });
  }, [theme.primary, theme.accent]);

  // Web L169-179 unmount cleanup: revoke the final manifest blob URL so it does
  // not leak across HMR cycles or test re-mounts. Native has no blob URL; clear
  // the published manifest snapshot instead. Because the manifest raster never
  // succeeds on native (renderSvgToPngDataUrl -> null), lastBlobUrlRef stays null
  // and — exactly like the web hook in a canvas-less (jsdom) environment, where
  // only the manifest blob is revoked and the favicon/meta survive — this is a
  // no-op and the published snapshot persists.
  useEffect(() => {
    return () => {
      const url = lastBlobUrlRef.current;
      if (url) {
        publishDynamicAppIcon(null);
        lastBlobUrlRef.current = null;
      }
    };
  }, []);
}

/**
 * Test seam — clears the published snapshot and drops all subscribers so each
 * jest run starts from clean module-singleton state.
 */
export function __resetDynamicAppIconForTests(): void {
  snapshotListeners.clear();
  currentSnapshot = null;
}
