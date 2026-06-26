// Native parity port of web/src/hooks/useKeyboardShortcuts.ts.
//
// The web hook wires global keyboard navigation shortcuts: it listens for
// `keydown` on `window`, ignores keystrokes typed into form fields
// (INPUT/TEXTAREA/SELECT/contentEditable), toggles a "?" cheat sheet, opens the
// command palette (Ctrl/⌘+K or "/") by dispatching a `toggle-command-palette`
// CustomEvent on `window`, and implements a two-stroke "g then <key>" GOTO mode
// that calls react-router-dom's `useNavigate()` to jump between pages. Every one
// of those mechanisms — `window.addEventListener('keydown')`, the
// `KeyboardEvent`/`HTMLElement` DOM types, `window.dispatchEvent(new
// CustomEvent(...))`, and `useNavigate()` — is browser-only.
//
// A React Native binary has no hardware-keyboard `keydown` stream and no
// react-router; mobile navigation is driven by touch + a navigator, not by
// "g v" key chords. So, following the established parity convention for
// browser-only behaviour:
//   * useFaviconBadge reaches the browser document/Image through a `globalThis`
//     facade gated by a capability check (real DOM on the react-native-web
//     target, inert no-op on a pure native runtime).
//   * LegacyAlertRulesRedirect / Breadcrumbs / App.tsx replace react-router
//     navigation with an injected `onNavigate(path)` callback.
// this port does both:
//   * The keydown listener attaches to a native-safe `window` facade reached via
//     `globalThis` (a real `window` exposing `addEventListener` exists on the
//     react-native-web target, so the full shortcut behaviour is preserved
//     there; `getKeyboardEventTarget()` returns undefined on a pure native
//     runtime and the hook is an inert no-op — the faithful "no hardware
//     keyboard" outcome).
//   * `useNavigate()` is replaced by an optional `onNavigate(path)` callback and
//     the command-palette CustomEvent by an optional `onToggleCommandPalette()`
//     callback; when the latter is omitted the hook still dispatches the exact
//     `toggle-command-palette` event on the window facade (when present) so it
//     interoperates with whatever listens for it on the react-native-web target.
//
// State names (mode, showCheatSheet, toggleCheatSheet), the exported
// GOTO_SHORTCUTS map (paths + labels byte-for-byte, all 14 entries), the
// GOTO_TIMEOUT_MS = 1500 timeout, the form-field guard, the "?", Escape,
// Ctrl/⌘+K, "/", "g", and GOTO-target key handling, and the cleanup that removes
// the listener + clears the timeout are all preserved exactly as on web. Browser
// unavailability is surfaced via `nativeKeyboardShortcutsCapabilities` and the
// parity sidecar. No DOM elements, Recharts, Leaflet, or web UI components are
// imported; the only runtime dependency is react.

import {useCallback, useEffect, useRef, useState} from 'react';

type ShortcutMode = 'idle' | 'goto';

interface ShortcutState {
  mode: ShortcutMode;
  showCheatSheet: boolean;
  toggleCheatSheet: () => void;
}

/** Navigation shortcuts activated by pressing g then a target key */
export const GOTO_SHORTCUTS: Record<string, {path: string; label: string}> = {
  d: {path: '/', label: 'Dashboard'},
  v: {path: '/vehicles', label: 'Vehicles'},
  c: {path: '/charging', label: 'Charging'},
  r: {path: '/drives', label: 'Drives'},
  t: {path: '/trips', label: 'Trips'},
  b: {path: '/battery', label: 'Battery & Energy'},
  a: {path: '/analytics', label: 'Analytics'},
  e: {path: '/efficiency', label: 'Efficiency'},
  s: {path: '/settings', label: 'Settings'},
  n: {path: '/notifications/inbox', label: 'Notifications'},
  l: {path: '/live-signals', label: 'Live Signals'},
  o: {path: '/automations', label: 'Automations'},
  x: {path: '/commands', label: 'Commands'},
  i: {path: '/climate', label: 'Climate'},
};

const GOTO_TIMEOUT_MS = 1500;

/** The exact global event the web hook dispatches to open the command palette;
 * preserved byte-for-byte so the react-native-web target interoperates with the
 * same listener the web shell registers. */
const COMMAND_PALETTE_EVENT = 'toggle-command-palette';

// ── Native-safe keyboard facade ──────────────────────────────────────────────
// Minimal structural shapes of the browser keyboard pieces the hook touches,
// declared locally so the port typechecks under the React Native lib (which
// excludes `dom`). They are reached through `globalThis`, so the real browser
// implementations satisfy them on the react-native-web target while a pure
// native runtime simply has no `window` listening for `keydown` and the hook
// no-ops.

interface KeyboardTargetLike {
  tagName?: string;
  isContentEditable?: boolean;
}

interface KeyboardEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  target: KeyboardTargetLike | null;
  preventDefault(): void;
}

type KeydownListener = (event: KeyboardEventLike) => void;

interface CustomEventLike {
  readonly type: string;
}

type CustomEventConstructor = new (type: string) => CustomEventLike;

interface KeyboardEventTargetLike {
  addEventListener(type: 'keydown', listener: KeydownListener): void;
  removeEventListener(type: 'keydown', listener: KeydownListener): void;
  dispatchEvent?(event: CustomEventLike): void;
}

/** The react-native-web `window` when a real browser keyboard surface is present
 * (it exposes `addEventListener`), else undefined on a pure native runtime — the
 * native-safe gate replacing the web's "window is always there" assumption. */
function getKeyboardEventTarget(): KeyboardEventTargetLike | undefined {
  const candidate = (
    globalThis as typeof globalThis & {window?: KeyboardEventTargetLike}
  ).window;
  return candidate && typeof candidate.addEventListener === 'function'
    ? candidate
    : undefined;
}

/** The browser `CustomEvent` constructor when present (react-native-web target),
 * else undefined on a pure native runtime. */
function getCustomEventConstructor(): CustomEventConstructor | undefined {
  const candidate = (
    globalThis as typeof globalThis & {CustomEvent?: CustomEventConstructor}
  ).CustomEvent;
  return typeof candidate === 'function' ? candidate : undefined;
}

/** Dispatches the `toggle-command-palette` event on the window facade, exactly
 * as the web hook does, when both `dispatchEvent` and a `CustomEvent`
 * constructor are available (react-native-web target). No-op otherwise. */
function dispatchCommandPaletteToggle(target: KeyboardEventTargetLike): void {
  const CustomEventCtor = getCustomEventConstructor();
  if (target.dispatchEvent && CustomEventCtor) {
    target.dispatchEvent(new CustomEventCtor(COMMAND_PALETTE_EVENT));
  }
}

/** Clears a pending GOTO timeout. React Native's `clearTimeout(handle: number)`
 * requires a non-optional argument (the browser DOM lib's is optional), so guard
 * the ref — a no-op when no timeout is pending, exactly matching the web
 * `clearTimeout(undefined)` behaviour. */
function clearPendingTimeout(
  handle: ReturnType<typeof setTimeout> | undefined,
): void {
  if (handle !== undefined) {
    clearTimeout(handle);
  }
}

/** Explicit capability matrix for the native keyboard-shortcuts surface. All
 * false on a pure native runtime (no hardware-keyboard `keydown`, no
 * react-router, no window CustomEvent bus); the keydown path still runs on the
 * react-native-web target where a real `window` is present. */
export const nativeKeyboardShortcutsCapabilities = {
  hardwareKeyboardListeningAvailable: false,
  reactRouterNavigateAvailable: false,
  commandPaletteWindowEventAvailable: false,
} as const;

/**
 * Native-safe replacements for the web hook's browser-only side effects.
 * `useNavigate()` is replaced by `onNavigate` and the `toggle-command-palette`
 * CustomEvent by `onToggleCommandPalette` (both optional so the hook can mount
 * before the navigator/palette are wired). Calling `useKeyboardShortcuts()` with
 * no arguments preserves the web zero-argument call site.
 */
export interface UseKeyboardShortcutsOptions {
  /** Native-safe replacement for react-router's `useNavigate()`; invoked with
   * the GOTO target path (e.g. '/vehicles'). */
  onNavigate?: (path: string) => void;
  /** Native-safe replacement for the `toggle-command-palette` CustomEvent fired
   * on Ctrl/⌘+K or "/". When omitted, the hook falls back to dispatching that
   * exact event on the window facade (react-native-web target). */
  onToggleCommandPalette?: () => void;
}

export function useKeyboardShortcuts(
  options: UseKeyboardShortcutsOptions = {},
): ShortcutState {
  const {onNavigate, onToggleCommandPalette} = options;
  const [mode, setMode] = useState<ShortcutMode>('idle');
  const [showCheatSheet, setShowCheatSheet] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const toggleCheatSheet = useCallback(() => {
    setShowCheatSheet(prev => !prev);
  }, []);

  useEffect(() => {
    const eventTarget = getKeyboardEventTarget();
    if (!eventTarget) return;

    const handler = (e: KeyboardEventLike) => {
      const target = e.target;
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable
      ) {
        return;
      }

      const isCtrlOrMeta = e.ctrlKey || e.metaKey;

      // ? → toggle cheat sheet
      if (e.key === '?' && !isCtrlOrMeta) {
        e.preventDefault();
        toggleCheatSheet();
        return;
      }

      // Esc → close everything
      if (e.key === 'Escape') {
        setMode('idle');
        setShowCheatSheet(false);
        clearPendingTimeout(timeoutRef.current);
        return;
      }

      // Ctrl+K or / → command palette
      if (
        (e.key === 'k' && isCtrlOrMeta) ||
        (e.key === '/' && !isCtrlOrMeta && mode === 'idle')
      ) {
        e.preventDefault();
        if (onToggleCommandPalette) {
          onToggleCommandPalette();
        } else {
          dispatchCommandPaletteToggle(eventTarget);
        }
        return;
      }

      // Enter GOTO mode
      if (mode === 'idle' && e.key === 'g' && !isCtrlOrMeta) {
        setMode('goto');
        clearPendingTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => setMode('idle'), GOTO_TIMEOUT_MS);
        return;
      }

      // Handle GOTO target key
      if (mode === 'goto') {
        const shortcut = GOTO_SHORTCUTS[e.key.toLowerCase()];
        if (shortcut) {
          e.preventDefault();
          onNavigate?.(shortcut.path);
        }
        setMode('idle');
        clearPendingTimeout(timeoutRef.current);
        return;
      }
    };

    eventTarget.addEventListener('keydown', handler);
    return () => {
      eventTarget.removeEventListener('keydown', handler);
      clearPendingTimeout(timeoutRef.current);
    };
  }, [mode, onNavigate, onToggleCommandPalette, toggleCheatSheet]);

  return {mode, showCheatSheet, toggleCheatSheet};
}
