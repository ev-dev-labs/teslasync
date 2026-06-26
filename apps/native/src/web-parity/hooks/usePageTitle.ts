// Native parity port of web/src/hooks/usePageTitle.ts.
//
// On the web, `usePageTitle(title)` sets the browser tab/document title to
// `"{title} — TeslaSync"` for the lifetime of the mounted page and restores the
// previous title on unmount. Writes flow through the `titleStore` singleton
// (web/src/lib/titleStore.ts) rather than touching `document.title` directly,
// so the tab-badge prefixes painted by sibling hooks — the unread-count badge
// (`useTitleBadge`) and the critical-alert flash (`useCriticalAlertFlash`) — are
// automatically re-applied on top of the canonical title whenever it changes
// (e.g. on navigation between pages).
//
// React Native has NO `document` and no window/tab title bar (contract rules
// 4 & 7): there is nothing equivalent to `document.title` to paint, and the
// unread-badge / alert-flash prefixes are a browser-tab affordance that does
// not exist on a native screen. Painting the OS-level title is therefore
// permanently UNAVAILABLE on native. The behavior that IS still meaningful —
// the canonical "current page base title" as a piece of in-memory state and its
// save/restore lifecycle — is preserved faithfully:
//
//   - A module-level `baseTitle` singleton mirrors titleStore's `baseTitle`,
//     seeded to `'TeslaSync'` exactly as on the web.
//   - `usePageTitle` keeps its identical signature + effect: on mount / when
//     `title` changes it captures the previous base title, sets the base title
//     to `"{title} — TeslaSync"`, and restores the previous value on cleanup.
//   - The browser-only `apply()` step (`document.title = prefix + baseTitle`)
//     is replaced by an injectable `PageTitleSink` seam. Until a host wires one
//     via `setPageTitleSink` (e.g. to drive a React Navigation header), title
//     changes apply to in-memory state only — the explicit native-safe
//     unavailable state required by rule 7. The badge/flash prefix composition
//     is dropped because there is no tab to host a prefix.
//
// No DOM modules, HTML elements, Recharts, Leaflet, or web UI components are
// imported — only `react`.

import { useEffect } from 'react';

/**
 * Optional native sink for the canonical page title — the native-safe analog of
 * the web's `document.title` write. A host may inject one (e.g. to update a
 * navigation header) via `setPageTitleSink`; until then title changes apply to
 * in-memory state only and painting the title is a documented no-op.
 */
export type PageTitleSink = (title: string) => void;

// Module-level singleton mirroring web titleStore's `baseTitle`, seeded to
// 'TeslaSync' to match titleStore.ts's default exactly.
let baseTitle = 'TeslaSync';
let titleSink: PageTitleSink | null = null;

function applyTitle(): void {
  // Web titleStore's `apply()` does `document.title = prefix + baseTitle`.
  // Native has no document/tab title bar, so forward to the injected sink if a
  // host wired one; otherwise this is a documented no-op (unavailable state).
  titleSink?.(baseTitle);
}

function getBaseTitle(): string {
  return baseTitle;
}

function setBaseTitle(title: string): void {
  baseTitle = title;
  applyTitle();
}

/**
 * Read the current canonical page title — the native analog of querying the
 * base portion of `document.title`. Exposed for hosts wiring a navigation
 * header and for tests.
 */
export function getPageTitle(): string {
  return getBaseTitle();
}

/**
 * Wire (or clear, with `null`) the native page-title sink and immediately push
 * the current title through it. This is the explicit native opt-in that makes
 * the otherwise-unavailable `document.title` write observable on native.
 */
export function setPageTitleSink(sink: PageTitleSink | null): void {
  titleSink = sink;
  applyTitle();
}

/**
 * Sets the canonical title for the current page in the format
 * `"{title} — TeslaSync"`, restoring the previous title on unmount. See the
 * file header for how this maps to the web's titleStore-backed behavior and why
 * the browser tab paint + badge prefixes are unavailable on native.
 */
export function usePageTitle(title: string): void {
  useEffect(() => {
    const prev = getBaseTitle();
    setBaseTitle(`${title} — TeslaSync`);
    return () => {
      setBaseTitle(prev);
    };
  }, [title]);
}
