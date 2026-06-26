// Native parity port of web/src/hooks/useShortcutRegistry.ts.
//
// The web module is a keyboard-shortcut registry: a tiny external store (built
// on `useSyncExternalStore`) of ShortcutDefinitions that lets any component
// declare hotkeys and have them surface in the global cheatsheet, plus a single
// delegated `keydown` listener installed on `document` that dispatches to the
// highest-priority matching entry for the active route. Three pieces of it are
// browser-only:
//   * the delegated `document.addEventListener('keydown', ...)` listener and the
//     `KeyboardEvent` / `HTMLElement` (`isContentEditable`, `tagName`) DOM types
//     it inspects — a React Native binary has no hardware-keyboard `keydown`
//     stream;
//   * `window.location.pathname`, read outside React render to scope shortcuts
//     to the active route;
//   * react-router-dom's `useLocation()`, used by `useActiveShortcuts` to
//     re-filter when the route changes.
//
// Following the established parity conventions for browser-only behaviour
// (useKeyboardShortcuts reaches a native-safe keydown facade via `globalThis`
// gated by a capability check; useFaviconBadge prefers `globalThis.document`
// when present and otherwise no-ops; RouteAnnouncer / RouteTransition /
// LegacyAlertRulesRedirect replace react-router's `useLocation()` with an
// injected `pathname` prop), this port:
//   * Ports the entire external store (entries Map, listeners Set, snapshot,
//     subscribe/getSnapshot/registerShortcut/unregisterShortcut/
//     _resetShortcutRegistry) and the scope-matching / priority-resolution
//     logic 1:1 — all pure JS that Hermes runs identically.
//   * Reaches the `keydown` event target through `globalThis.document`: a real
//     `document` exposing `addEventListener` exists on the react-native-web
//     target so the full delegated-shortcut behaviour is preserved there;
//     `getKeyboardEventTarget()` returns undefined on a pure native runtime and
//     `ensureDelegatedListener()` is an inert no-op (the faithful "no hardware
//     keyboard" outcome).
//   * Reads the active pathname from a `globalThis.location` facade
//     (`activePathname()`, the ShellVisualParityFrame precedent) and lets
//     `useActiveShortcuts(pathname?)` accept a caller-supplied pathname that
//     replaces react-router's reactive `useLocation()` (the RouteAnnouncer /
//     RouteTransition prop precedent); when omitted it falls back to the
//     location facade.
//   * Replaces the DOM `KeyboardEvent` / `HTMLElement` types (RN tsconfig lib
//     excludes `dom`) with the locally-declared, exported `ShortcutKeyboardEvent`
//     structural type so `match` / `handler` predicates stay typed and the real
//     browser KeyboardEvent satisfies it on the react-native-web target.
//
// The exported surface (ShortcutScope, ShortcutDefinition, registerShortcut,
// unregisterShortcut, _resetShortcutRegistry, useShortcut, useActiveShortcuts,
// useAllShortcuts), every state name, the `id` dedupe contract, the priority /
// allowInInput / Escape-always-allowed semantics, and the single-delegated-
// listener design are all preserved exactly as on web. Browser unavailability is
// surfaced via `nativeShortcutRegistryCapabilities` and the parity sidecar. No
// DOM elements, Recharts, Leaflet, react-router-dom, or web UI components are
// imported; the only runtime dependency is react.

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

export type ShortcutScope = 'global' | 'route' | 'page';

// ── Native-safe keyboard event facade ───────────────────────────────────────
// Minimal structural shapes of the browser keyboard pieces the registry touches,
// declared locally so the port typechecks under the React Native lib (which
// excludes `dom`). They are reached through `globalThis`, so the real browser
// `KeyboardEvent` / `HTMLElement` satisfy them on the react-native-web target
// while a pure native runtime simply has no `document` listening for `keydown`
// and the delegated listener no-ops.

/** Structural stand-in for the DOM `EventTarget` / `HTMLElement` the typing
 * guard inspects (web read `event.target as HTMLElement`). */
interface ShortcutEventTarget {
  tagName?: string;
  isContentEditable?: boolean;
}

/**
 * Native-safe replacement for the DOM `KeyboardEvent` passed to `match` /
 * `handler`. Exported so callers can type their predicates; the real browser
 * `KeyboardEvent` structurally satisfies it on the react-native-web target.
 */
export interface ShortcutKeyboardEvent {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  target: ShortcutEventTarget | null;
  preventDefault(): void;
}

export interface ShortcutDefinition {
  /** Stable id, also used as the cheatsheet React key + dedupe key. */
  id: string;
  /**
   * Key combination as an array of label tokens, e.g. `['?']`,
   * `['Ctrl', 'K']`, `['g', 'd']`, or `['Shift', '←']`. Each token renders as
   * its own key chip. The tokens are display-only; the matching logic
   * uses {@link ShortcutDefinition.match}.
   */
  keys: string[];
  /** Already-translated description shown in the cheatsheet. */
  description: string;
  /** Group the shortcut renders under in the cheatsheet (already translated). */
  group: string;
  /**
   * Scope determines visibility in the cheatsheet:
   *   - `'global'` — always visible
   *   - `'route'` — visible only when the current pathname matches `routeMatch`
   *   - `'page'`  — same as `'route'`; semantic shorthand for "this single component"
   */
  scope: ShortcutScope;
  /** Required when scope is `'route'` or `'page'`. Pathname prefix or regex. */
  routeMatch?: string | RegExp;
  /**
   * Optional native keyboard predicate. If supplied alongside `handler` the
   * registry's delegated listener invokes `handler` whenever this returns
   * `true`. Pure consumers (informational only) can omit it.
   */
  match?: (event: ShortcutKeyboardEvent) => boolean;
  /**
   * Optional callback. If omitted, the entry is informational — the registry
   * does not wire any listener and the caller manages its own. If supplied,
   * `match` is also required for the registry to know when to fire.
   */
  handler?: (event: ShortcutKeyboardEvent) => void;
  /**
   * Priority for resolving multiple matching definitions in the same scope.
   * Higher wins. Default `0`.
   */
  priority?: number;
  /**
   * When `true` the registry will fire the handler even if the active focus
   * is inside a form input / contenteditable. Default `false`. (`Esc` is
   * always allowed regardless of this flag.)
   */
  allowInInput?: boolean;
}

/* ------------------------------------------------------------------ */
/*  External store                                                     */
/* ------------------------------------------------------------------ */

interface RegistryState {
  /** All currently-registered entries, keyed by `id`. Last writer wins. */
  entries: Map<string, ShortcutDefinition>;
  listeners: Set<() => void>;
  /** Cached snapshot — kept stable so `useSyncExternalStore` skips re-renders. */
  snapshot: ShortcutDefinition[];
}

const store: RegistryState = {
  entries: new Map<string, ShortcutDefinition>(),
  listeners: new Set<() => void>(),
  snapshot: [],
};

function rebuildSnapshot(): void {
  store.snapshot = Array.from(store.entries.values());
}

function emit(): void {
  rebuildSnapshot();
  store.listeners.forEach(listener => {
    listener();
  });
}

function subscribe(listener: () => void): () => void {
  store.listeners.add(listener);
  return () => {
    store.listeners.delete(listener);
  };
}

function getSnapshot(): ShortcutDefinition[] {
  return store.snapshot;
}

function getServerSnapshot(): ShortcutDefinition[] {
  return store.snapshot;
}

/**
 * Imperative register/unregister. Exported for the global seed and tests; UI
 * code should use {@link useShortcut} instead.
 */
export function registerShortcut(def: ShortcutDefinition): void {
  store.entries.set(def.id, def);
  emit();
}

export function unregisterShortcut(id: string): void {
  if (!store.entries.delete(id)) return;
  emit();
}

/** Test helper — wipe the registry. Not for production use. */
export function _resetShortcutRegistry(): void {
  store.entries.clear();
  store.listeners.clear();
  store.snapshot = [];
}

/* ------------------------------------------------------------------ */
/*  Delegated listener                                                 */
/* ------------------------------------------------------------------ */

type KeydownListener = (event: ShortcutKeyboardEvent) => void;

/** The react-native-web `document` when a real browser keyboard surface is
 * present (it exposes `addEventListener`), else undefined on a pure native
 * runtime — the native-safe gate replacing the web's `typeof document` check. */
interface KeyboardEventTargetLike {
  addEventListener(type: 'keydown', listener: KeydownListener): void;
}

function getKeyboardEventTarget(): KeyboardEventTargetLike | undefined {
  const candidate = (
    globalThis as typeof globalThis & { document?: KeyboardEventTargetLike }
  ).document;
  return candidate && typeof candidate.addEventListener === 'function'
    ? candidate
    : undefined;
}

/** Explicit capability matrix for the native shortcut-registry surface. Both
 * are false on a pure native runtime (no hardware-keyboard `keydown` listening,
 * no react-router location); the delegated-listener and location paths still run
 * on the react-native-web target where a real `document` / `location` exist. */
export const nativeShortcutRegistryCapabilities = {
  delegatedKeydownListeningAvailable: false,
  reactRouterLocationAvailable: false,
} as const;

/**
 * The registry installs at most ONE keydown listener on `document` regardless
 * of how many definitions are registered. This avoids duplicating
 * `addEventListener('keydown', ...)` in every consumer.
 */
let delegatedListenerAttached = false;

function isTypingTarget(event: ShortcutKeyboardEvent): boolean {
  const target = event.target;
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function activePathname(): string {
  // Used only by the delegated listener — outside React render — so we can't
  // use a `pathname` prop. The `globalThis.location` facade is the source of
  // truth at event time (a real `location` on the react-native-web target,
  // undefined on a pure native runtime — the web's `typeof window` guard).
  const location = (
    globalThis as typeof globalThis & { location?: { pathname?: string } }
  ).location;
  return location?.pathname ?? '';
}

function matchesScope(def: ShortcutDefinition, pathname: string): boolean {
  if (def.scope === 'global') return true;
  if (!def.routeMatch) return false;
  if (typeof def.routeMatch === 'string') {
    return pathname.startsWith(def.routeMatch);
  }
  return def.routeMatch.test(pathname);
}

function delegatedListener(event: ShortcutKeyboardEvent): void {
  // `Esc` always allowed; everything else respects typing-target focus unless
  // the entry opts in via `allowInInput`.
  const inTyping = isTypingTarget(event);
  const pathname = activePathname();

  let best: ShortcutDefinition | null = null;
  let bestPriority = -Infinity;
  for (const def of store.entries.values()) {
    if (!def.handler || !def.match) continue;
    if (inTyping && !def.allowInInput && event.key !== 'Escape') continue;
    if (!matchesScope(def, pathname)) continue;
    if (!def.match(event)) continue;
    const p = def.priority ?? 0;
    if (p > bestPriority) {
      best = def;
      bestPriority = p;
    }
  }
  if (best?.handler) {
    best.handler(event);
  }
}

function ensureDelegatedListener(): void {
  if (delegatedListenerAttached) return;
  const eventTarget = getKeyboardEventTarget();
  if (!eventTarget) return;
  eventTarget.addEventListener('keydown', delegatedListener);
  delegatedListenerAttached = true;
}

/* ------------------------------------------------------------------ */
/*  Hooks                                                              */
/* ------------------------------------------------------------------ */

/**
 * Register one or more shortcut definitions for the lifetime of the calling
 * component.
 *
 * Strict-mode safe: definitions are deduped by `id`, so React 18's
 * mount → cleanup → mount sequence ends with the same final state as a
 * single mount.
 *
 * @example informational only — caller wires its own listener
 *   useShortcut({
 *     id: 'replay.scrubber.space',
 *     keys: ['Space'],
 *     description: t('replay.shortcuts.playPause', 'Play / Pause'),
 *     group: t('shortcuts.groups.replay', 'Trip replay'),
 *     scope: 'route',
 *     routeMatch: '/replay/',
 *   })
 *
 * @example registry-managed handler
 *   useShortcut({
 *     id: 'palette.open',
 *     keys: ['Ctrl', 'K'],
 *     description: t('shortcuts.openPalette', 'Open command palette'),
 *     group: t('shortcuts.groups.actions', 'Actions'),
 *     scope: 'global',
 *     match: e => (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k',
 *     handler: e => {
 *       e.preventDefault()
 *     },
 *   })
 */
export function useShortcut(
  defs: ShortcutDefinition | ShortcutDefinition[],
): void {
  // Normalise to array up front so the hook contract stays simple.
  // The `defs` argument is intentionally NOT in the dep array — we use a
  // serialised stable key instead so callers can pass freshly-built arrays
  // each render without re-registering on every tick.
  const key = stableKey(defs);
  const list = useMemo<ShortcutDefinition[]>(
    () => (Array.isArray(defs) ? defs : [defs]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  // Keep the latest definitions in a ref so the cleanup uses the same ids the
  // setup used (handles cases where the array changes between renders).
  const idsRef = useRef<string[]>([]);

  useEffect(() => {
    ensureDelegatedListener();
    const ids = list.map(d => d.id);
    idsRef.current = ids;
    list.forEach(registerShortcut);
    return () => {
      ids.forEach(unregisterShortcut);
    };
  }, [list]);
}

/** Stable cache key derived from definitions (id + scope + route + keys). */
function stableKey(defs: ShortcutDefinition | ShortcutDefinition[]): string {
  const arr = Array.isArray(defs) ? defs : [defs];
  return arr
    .map(
      d =>
        `${d.id}|${d.scope}|${String(d.routeMatch ?? '')}|${d.keys.join('+')}`,
    )
    .join('\n');
}

/**
 * Read the active shortcut definitions — global plus any route-scoped
 * entries whose `routeMatch` matches the current pathname.
 *
 * Returns a referentially-stable array between renders unless the underlying
 * registry mutates.
 *
 * `pathname` is the native-safe replacement for react-router's reactive
 * `useLocation().pathname`: callers pass their current route path (reactive at
 * the caller, the RouteAnnouncer / RouteTransition precedent). When omitted it
 * falls back to the `globalThis.location` facade (react-native-web target).
 */
export function useActiveShortcuts(pathname?: string): ShortcutDefinition[] {
  const all = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const activePath = pathname ?? activePathname();
  return useMemo(
    () => all.filter(d => matchesScope(d, activePath)),
    [all, activePath],
  );
}

/**
 * Read every registered shortcut, ignoring scope. Useful when the cheatsheet
 * filter is set to "All".
 */
export function useAllShortcuts(): ShortcutDefinition[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
