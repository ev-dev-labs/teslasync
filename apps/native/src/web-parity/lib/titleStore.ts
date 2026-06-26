// Native parity port of web/src/lib/titleStore.ts.
//
// titleStore — single owner of the app window/tab title.
//
// Three independent contributors compose into the final title:
//   - `baseTitle`   — the canonical page title (set by `usePageTitle`)
//   - `basePrefix`  — unread-count badge (e.g. "(3) ", set by `useTitleBadge`)
//   - `flashPrefix` — critical-alert flash (e.g. "(!) ALERT — ",
//                     set by `useCriticalAlertFlash`)
//
// The flash prefix takes priority over the unread badge so that, while
// an alert is flashing, the page does not "fight" with the badge for
// which prefix to display. When the flash ends and `flashPrefix` is
// cleared back to `''`, the unread badge re-appears automatically.
//
// This module is a runtime-singleton (module-level state) by design;
// it represents the global window's title bar, of which there is
// exactly one. Tests can call `__resetTitleStoreForTests()` between
// runs to restore defaults.
//
// Web -> native adaptation (conversion contract rule 7):
//   On the web the module's only side effect is writing `document.title`
//   (guarded by `typeof document === 'undefined'`). React Native has no DOM
//   `document`, and there is no cross-platform JS API for an OS title bar
//   (iOS/Android have none; RN-Windows/macOS window titles require a native
//   module). The browser-only title write is therefore UNAVAILABLE. We preserve
//   every contributor, the exact flash-over-badge precedence, and all seven
//   public functions byte-for-byte, but `apply()` now routes the composed result
//   to an in-process sink instead of `document.title`: it records the composed
//   title (readable via `getComposedTitle()` for the same assertions the web made
//   against `document.title`) and notifies any `subscribeTitle()` listeners. A
//   future native header / RN-Windows-or-macOS title module can wire real
//   delivery into that listener set without touching a single caller.
//   `isNativeTitleBarAvailable()` reports the explicit unavailable state.

/** Observer invoked with the composed title whenever it changes. */
export type TitleListener = (title: string) => void;

let basePrefix = '';
let flashPrefix = '';
let baseTitle = 'TeslaSync';

// Last value apply() composed. On the web this was written to `document.title`;
// natively it is the parity surface read back by getComposedTitle(). Seeded with
// the default-state composition (no prefixes + 'TeslaSync') so reads are sane
// before the first setter runs.
let composedTitle = 'TeslaSync';

// Optional observers of the composed title. Empty by default — the native OS
// title bar is unavailable, so nothing consumes this until a real transport
// (e.g. a screen header or a RN-Windows/macOS native module) subscribes.
const listeners = new Set<TitleListener>();

function apply(): void {
  const prefix = flashPrefix || basePrefix;
  composedTitle = `${prefix}${baseTitle}`;
  for (const listener of listeners) {
    listener(composedTitle);
  }
}

export function setBaseTitle(title: string): void {
  baseTitle = title;
  apply();
}

export function setBasePrefix(prefix: string): void {
  basePrefix = prefix;
  apply();
}

export function setFlashPrefix(prefix: string): void {
  flashPrefix = prefix;
  apply();
}

export function getBaseTitle(): string {
  return baseTitle;
}

export function getBasePrefix(): string {
  return basePrefix;
}

export function getFlashPrefix(): string {
  return flashPrefix;
}

/**
 * Composed title last produced by the contributors:
 * `${flashPrefix || basePrefix}${baseTitle}`. This is the exact string the web
 * wrote to `document.title`; exposed natively so callers/tests can read the
 * rendered result without a DOM.
 */
export function getComposedTitle(): string {
  return composedTitle;
}

/**
 * Explicit unavailable-state flag (conversion contract rule 7). React Native has
 * no DOM `document.title` and no built-in cross-platform OS title-bar API, so
 * this is always `false` until a native title transport is wired into
 * {@link subscribeTitle}.
 */
export function isNativeTitleBarAvailable(): boolean {
  return false;
}

/**
 * Observe composed-title changes. Returns an unsubscribe function. Mirrors the
 * web side effect (which wrote straight to `document.title`) as an in-process
 * fan-out so a native header or a future RN-Windows/macOS title module can render
 * the title without any caller change. The listener fires immediately with the
 * current composed title so late subscribers are not left stale.
 */
export function subscribeTitle(listener: TitleListener): () => void {
  listeners.add(listener);
  listener(composedTitle);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Test-only helper to restore module state between tests. Not exported
 * from any barrel and intentionally underscore-prefixed. Also clears the
 * native listener registry (mirroring the web reset's full singleton restore)
 * so test runs stay hermetic.
 */
export function __resetTitleStoreForTests(): void {
  listeners.clear();
  basePrefix = '';
  flashPrefix = '';
  baseTitle = 'TeslaSync';
  apply();
}
