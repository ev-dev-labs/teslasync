import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Phase 40 / Prompt 64 — keyboard shortcut registry.
 *
 * A tiny external store of {@link ShortcutDefinition}s so any component can
 * declare its own keyboard hotkeys *and* have them automatically appear in
 * the global cheatsheet. Replaces the previous approach of hard-coding the
 * cheatsheet contents in `KeyboardShortcutsModal.tsx` and forces every
 * caller into a single source of truth.
 *
 * Two consumers:
 *   1. {@link useShortcut} — pages/components register entries for their
 *      lifetime. Strict-mode safe (dedupe key is `id`).
 *   2. {@link useActiveShortcuts} — the cheatsheet (and any future
 *      "active hotkey hint" surface) reads the union of all visible entries
 *      based on the current pathname.
 *
 * Design notes:
 *  - Built on `useSyncExternalStore` so React stays in control of subscription
 *    cleanup and concurrent rendering remains safe (same pattern as
 *    `web/src/components/charts/cursorSync.ts`).
 *  - When a `handler` is supplied, the registry attaches a single delegated
 *    `keydown` listener on `document` and dispatches to the highest-priority
 *    matching entry for the active scope. This avoids N component-level
 *    listeners. Callers without a `handler` are *informational only* — they
 *    populate the cheatsheet but the component wires its own raw listener.
 *  - Honors text-input focus: shortcuts are skipped when the active target is
 *    an `<input>`, `<textarea>`, `<select>`, or `[contenteditable]`. `Esc`
 *    always fires (it's the universal "cancel" key).
 */

export type ShortcutScope = 'global' | 'route' | 'page'

export interface ShortcutDefinition {
  /** Stable id, also used as the cheatsheet React key + dedupe key. */
  id: string
  /**
   * Key combination as an array of label tokens, e.g. `['?']`,
   * `['Ctrl', 'K']`, `['g', 'd']`, or `['Shift', '←']`. Each token renders as
   * its own `<kbd>` chip. The tokens are display-only; the matching logic
   * uses {@link match}.
   */
  keys: string[]
  /** Already-translated description shown in the cheatsheet. */
  description: string
  /** Group the shortcut renders under in the cheatsheet (already translated). */
  group: string
  /**
   * Scope determines visibility in the cheatsheet:
   *   - `'global'` — always visible
   *   - `'route'` — visible only when the current pathname matches `routeMatch`
   *   - `'page'`  — same as `'route'`; semantic shorthand for "this single component"
   */
  scope: ShortcutScope
  /** Required when scope is `'route'` or `'page'`. Pathname prefix or regex. */
  routeMatch?: string | RegExp
  /**
   * Optional native keyboard predicate. If supplied alongside `handler` the
   * registry's delegated listener invokes `handler` whenever this returns
   * `true`. Pure consumers (informational only) can omit it.
   */
  match?: (event: KeyboardEvent) => boolean
  /**
   * Optional callback. If omitted, the entry is informational — the registry
   * does not wire any listener and the caller manages its own. If supplied,
   * `match` is also required for the registry to know when to fire.
   */
  handler?: (event: KeyboardEvent) => void
  /**
   * Priority for resolving multiple matching definitions in the same scope.
   * Higher wins. Default `0`.
   */
  priority?: number
  /**
   * When `true` the registry will fire the handler even if the active focus
   * is inside a form input / contenteditable. Default `false`. (`Esc` is
   * always allowed regardless of this flag.)
   */
  allowInInput?: boolean
}

/* ------------------------------------------------------------------ */
/*  External store                                                     */
/* ------------------------------------------------------------------ */

interface RegistryState {
  /** All currently-registered entries, keyed by `id`. Last writer wins. */
  entries: Map<string, ShortcutDefinition>
  listeners: Set<() => void>
  /** Cached snapshot — kept stable so `useSyncExternalStore` skips re-renders. */
  snapshot: ShortcutDefinition[]
}

const store: RegistryState = {
  entries: new Map<string, ShortcutDefinition>(),
  listeners: new Set<() => void>(),
  snapshot: [],
}

function rebuildSnapshot(): void {
  store.snapshot = Array.from(store.entries.values())
}

function emit(): void {
  rebuildSnapshot()
  store.listeners.forEach((listener) => {
    listener()
  })
}

function subscribe(listener: () => void): () => void {
  store.listeners.add(listener)
  return () => {
    store.listeners.delete(listener)
  }
}

function getSnapshot(): ShortcutDefinition[] {
  return store.snapshot
}

function getServerSnapshot(): ShortcutDefinition[] {
  return store.snapshot
}

/**
 * Imperative register/unregister. Exported for the global seed and tests; UI
 * code should use {@link useShortcut} instead.
 */
export function registerShortcut(def: ShortcutDefinition): void {
  store.entries.set(def.id, def)
  emit()
}

export function unregisterShortcut(id: string): void {
  if (!store.entries.delete(id)) return
  emit()
}

/** Test helper — wipe the registry. Not for production use. */
export function _resetShortcutRegistry(): void {
  store.entries.clear()
  store.listeners.clear()
  store.snapshot = []
}

/* ------------------------------------------------------------------ */
/*  Delegated listener                                                 */
/* ------------------------------------------------------------------ */

/**
 * The registry installs at most ONE keydown listener on `document` regardless
 * of how many definitions are registered. This avoids duplicating
 * `addEventListener('keydown', ...)` in every consumer.
 */
let delegatedListenerAttached = false

function isTypingTarget(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null
  if (!target) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function activePathname(): string {
  // Used only by the delegated listener — outside React render — so we can't
  // use `useLocation`. window.location is the source of truth at event time.
  return typeof window === 'undefined' ? '' : window.location.pathname
}

function matchesScope(def: ShortcutDefinition, pathname: string): boolean {
  if (def.scope === 'global') return true
  if (!def.routeMatch) return false
  if (typeof def.routeMatch === 'string') return pathname.startsWith(def.routeMatch)
  return def.routeMatch.test(pathname)
}

function delegatedListener(event: KeyboardEvent): void {
  // `Esc` always allowed; everything else respects typing-target focus unless
  // the entry opts in via `allowInInput`.
  const inTyping = isTypingTarget(event)
  const pathname = activePathname()

  let best: ShortcutDefinition | null = null
  let bestPriority = -Infinity
  for (const def of store.entries.values()) {
    if (!def.handler || !def.match) continue
    if (inTyping && !def.allowInInput && event.key !== 'Escape') continue
    if (!matchesScope(def, pathname)) continue
    if (!def.match(event)) continue
    const p = def.priority ?? 0
    if (p > bestPriority) {
      best = def
      bestPriority = p
    }
  }
  if (best?.handler) {
    best.handler(event)
  }
}

function ensureDelegatedListener(): void {
  if (delegatedListenerAttached || typeof document === 'undefined') return
  document.addEventListener('keydown', delegatedListener)
  delegatedListenerAttached = true
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
 *       window.dispatchEvent(new CustomEvent('toggle-command-palette'))
 *     },
 *   })
 */
export function useShortcut(defs: ShortcutDefinition | ShortcutDefinition[]): void {
  // Normalise to array up front so the hook contract stays simple.
  // The `defs` argument is intentionally NOT in the dep array — we use a
  // serialised stable key instead so callers can pass freshly-built arrays
  // each render without re-registering on every tick.
  const key = stableKey(defs)
  const list = useMemo<ShortcutDefinition[]>(
    () => (Array.isArray(defs) ? defs : [defs]),
    [key],
  )

  // Keep the latest definitions in a ref so the cleanup uses the same ids the
  // setup used (handles cases where the array changes between renders).
  const idsRef = useRef<string[]>([])

  useEffect(() => {
    ensureDelegatedListener()
    const ids = list.map((d) => d.id)
    idsRef.current = ids
    list.forEach(registerShortcut)
    return () => {
      ids.forEach(unregisterShortcut)
    }
  }, [list])
}

/** Stable cache key derived from definitions (id + scope + route + keys). */
function stableKey(defs: ShortcutDefinition | ShortcutDefinition[]): string {
  const arr = Array.isArray(defs) ? defs : [defs]
  return arr
    .map((d) => `${d.id}|${d.scope}|${String(d.routeMatch ?? '')}|${d.keys.join('+')}`)
    .join('\n')
}

/**
 * Read the active shortcut definitions — global plus any route-scoped
 * entries whose `routeMatch` matches the current pathname.
 *
 * Returns a referentially-stable array between renders unless the underlying
 * registry mutates.
 */
export function useActiveShortcuts(): ShortcutDefinition[] {
  const all = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const location = useLocation()
  return useMemo(
    () => all.filter((d) => matchesScope(d, location.pathname)),
    [all, location.pathname],
  )
}

/**
 * Read every registered shortcut, ignoring scope. Useful when the cheatsheet
 * filter is set to "All".
 */
export function useAllShortcuts(): ShortcutDefinition[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
