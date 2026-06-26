// Native parity port of web/src/hooks/useFaviconBadge.ts.
//
// The web hook paints a coloured dot (with an optional count digit) onto the
// browser tab favicon when there are unread notifications, restoring the
// original icon when the count clears or the user disables `tab_badge_enabled`.
// A React Native binary has no browser tab and therefore no favicon to badge —
// the dock / notification-centre app-icon badge is a separate OS API and not
// this hook's contract — so the favicon-painting machinery (document
// `<link rel="icon">` lookup, `<canvas>` compositing, `new Image()` loading,
// `toDataURL`) is browser-only.
//
// Following the established parity convention for browser-only behaviour
// (InstallPrompt substitutes window events / matchMedia with native-safe
// equivalents carrying an explicit unavailable state; useConfirm prefers
// `globalThis.localStorage` when present and otherwise no-ops), this port:
//   * Keeps the full hook contract, state names (count, enabled), the
//     FAVICON_SIZE / BADGE_COLOR (red-400) / BADGE_TEXT_COLOR constants, the
//     `tab_badge_enabled !== false` gate, the `count <= 0` restore and
//     `count < 10` single-digit thresholds, the stale-onload sequence guard,
//     and the multi-link snapshot/restore + dynamic-icon `data-base-href`
//     coordination exactly as on web.
//   * Reads `count` from the native useUnreadCount and `enabled` from the
//     native useSettings (`tab_badge_enabled`), preserving the same data
//     dependencies and `/notifications/unread-count` + `/settings` API intent.
//   * Replaces the hard DOM globals with a minimal, locally-typed favicon
//     facade reached via `globalThis`. On the react-native-web target (a real
//     browser DOM + canvas + Image) the favicon is painted for genuine parity;
//     on a pure native runtime (Hermes) `getFaviconDocument()` returns
//     undefined and the hook is an inert no-op — the faithful "no favicon to
//     badge" outcome. Explicit unavailable state is exported as
//     `nativeFaviconBadgeCapabilities` and documented in the parity sidecar.
//
// No DOM elements, Recharts, Leaflet, or web UI components are imported; the
// only runtime dependencies are react plus the two native parity hooks.

import {useEffect, useRef} from 'react';

import {useUnreadCount} from '../api/hooks/useNotifications';
import {useSettings} from '../api/hooks/useSettings';

const FAVICON_SIZE = 32;
// red-400 — matches the `severity-critical` token used elsewhere in
// the UI for at-a-glance "needs attention" colouring.
const BADGE_COLOR = '#f87171';
const BADGE_TEXT_COLOR = '#ffffff';

// ── Native-safe favicon facade ───────────────────────────────────────────────
// Minimal structural shapes of the browser DOM pieces the badge touches,
// declared locally so the port typechecks under the React Native lib (which
// excludes `dom`). They are reached through `globalThis`, so the real browser
// implementations satisfy them on the react-native-web target while a pure
// native runtime simply has no `document` / `Image` and the hook no-ops.

interface FaviconLinkElement {
  href: string;
  dataset: {baseHref?: string};
}

interface FaviconCanvasContext {
  drawImage(
    image: FaviconImage,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  fillStyle: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  beginPath(): void;
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
  ): void;
  fill(): void;
  fillText(text: string, x: number, y: number): void;
}

interface FaviconCanvasElement {
  width: number;
  height: number;
  getContext(contextId: '2d'): FaviconCanvasContext | null;
  toDataURL(type?: string): string;
}

interface FaviconImage {
  crossOrigin: string | null;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  src: string;
}

type FaviconImageConstructor = new () => FaviconImage;

interface FaviconDocument {
  querySelectorAll(selectors: string): ArrayLike<FaviconLinkElement>;
  createElement(tagName: 'canvas'): FaviconCanvasElement;
}

/** The react-native-web `document` when a real browser DOM is present, else
 * undefined on a pure native runtime (mirrors the web `typeof document` guard). */
function getFaviconDocument(): FaviconDocument | undefined {
  const candidate = (
    globalThis as typeof globalThis & {document?: FaviconDocument}
  ).document;
  return candidate && typeof candidate.querySelectorAll === 'function'
    ? candidate
    : undefined;
}

/** The browser `Image` constructor when present (react-native-web target),
 * else undefined on a pure native runtime. */
function getImageConstructor(): FaviconImageConstructor | undefined {
  const candidate = (
    globalThis as typeof globalThis & {Image?: FaviconImageConstructor}
  ).Image;
  return typeof candidate === 'function' ? candidate : undefined;
}

/** Explicit capability matrix for the native favicon-badge surface. Both are
 * false on a pure native runtime (no browser tab/favicon); the favicon path
 * still runs on the react-native-web target where a real DOM is present. */
export const nativeFaviconBadgeCapabilities = {
  faviconLinkElementsAvailable: false,
  canvasBadgeRenderingAvailable: false,
} as const;

/**
 * Paints a coloured dot (with optional count text) on top of the
 * site favicon when there are unread notifications. Restores the
 * original favicon when the count returns to zero or the user
 * disables `tab_badge_enabled`.
 *
 * Multiple `<link rel="icon">` elements are common (we ship a default
 * SVG and a 192×192 SVG); we mutate every one in tandem so whichever
 * size the browser picks shows the badge.
 *
 * Falls back to a no-op when the favicon image fails to load (e.g.
 * inside jsdom where canvas drawing is unsupported) — the badge is a
 * progressive enhancement, never required for correctness. On a pure
 * native runtime there is no favicon surface at all, so the hook is an
 * inert no-op (see `nativeFaviconBadgeCapabilities`).
 */
export function useFaviconBadge(): void {
  const {data: count = 0} = useUnreadCount();
  const {data: settings} = useSettings();
  const enabled = settings?.tab_badge_enabled !== false;
  const originalsRef = useRef<Map<FaviconLinkElement, string>>(new Map());
  const seqRef = useRef(0);

  useEffect(() => {
    const doc = getFaviconDocument();
    if (!doc) return;
    const links = Array.from(doc.querySelectorAll('link[rel="icon"]'));
    if (links.length === 0) return;

    // Snapshot original hrefs the first time we see each link so we
    // can restore them when the badge clears.
    //
    // Coordination with `useDynamicAppIcon`: that hook tags every
    // dynamically-mutated `<link rel="icon">` with a `data-base-href`
    // attribute pointing at the *current* themed favicon data URL. When
    // present, we treat that as the source of truth for both the snapshot
    // and the composite source — otherwise the badge would stomp the
    // dynamic icon back to the build-time SVG every time the unread
    // count changes.
    for (const link of links) {
      const liveBase = link.dataset.baseHref;
      if (liveBase) {
        // Always re-snapshot when the dynamic hook has updated the base.
        originalsRef.current.set(link, liveBase);
      } else if (!originalsRef.current.has(link)) {
        originalsRef.current.set(link, link.href);
      }
    }

    const restore = () => {
      for (const link of links) {
        const orig = originalsRef.current.get(link);
        if (orig !== undefined) link.href = orig;
      }
    };

    if (!enabled || count <= 0) {
      restore();
      return;
    }

    // Sequence number guards against a stale onload firing after the
    // count has changed again — without this, an in-flight render of
    // count=5 could overwrite a freshly-painted count=0 (restored).
    const seq = ++seqRef.current;
    const firstLink = links[0];
    const orig = originalsRef.current.get(firstLink);
    if (!orig) return;

    // `Image` exists wherever `document` does on the web target; the guard
    // keeps the port native-safe without altering web behaviour.
    const ImageCtor = getImageConstructor();
    if (!ImageCtor) return;

    const img = new ImageCtor();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (seq !== seqRef.current) return;
      try {
        const canvas = doc.createElement('canvas');
        canvas.width = FAVICON_SIZE;
        canvas.height = FAVICON_SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, FAVICON_SIZE, FAVICON_SIZE);

        // Coloured dot, top-right, with a faint dark outline so it
        // remains visible on light favicons.
        ctx.fillStyle = BADGE_COLOR;
        ctx.beginPath();
        ctx.arc(FAVICON_SIZE - 8, 8, 7, 0, Math.PI * 2);
        ctx.fill();

        // Only render the digit when it fits cleanly in a single
        // glyph; for 10+ the dot alone signals "you have unread".
        if (count < 10) {
          ctx.fillStyle = BADGE_TEXT_COLOR;
          ctx.font = 'bold 11px system-ui, -apple-system, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(count), FAVICON_SIZE - 8, 8);
        }

        const dataUrl = canvas.toDataURL('image/png');
        for (const link of links) link.href = dataUrl;
      } catch {
        // Canvas tainted (cross-origin SVG) or toDataURL unsupported
        // (jsdom). Silently skip — favicon stays at its original.
      }
    };
    img.onerror = () => {
      // Image failed to load (test env, missing file). Skip silently.
    };
    img.src = orig;
  }, [count, enabled]);

  // Restore originals when the host component unmounts so a navigation
  // away from the app does not leave a stale badged favicon cached.
  useEffect(() => {
    const originals = originalsRef.current;
    return () => {
      for (const [link, orig] of originals.entries()) {
        link.href = orig;
      }
    };
  }, []);
}
