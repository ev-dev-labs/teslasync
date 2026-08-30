/**
 * Recently viewed pages.
 *
 * Client-side LRU of the user's most recently visited routes. Capped at
 * {@link RECENT_PAGES_MAX} entries. Surfaces in four places:
 *
 *   - Command palette "Recent" section when the input is empty.
 *   - Global status-bar popover.
 *   - Explore page's recently visited strip.
 *   - Settings → Privacy → "Clear recent pages" button.
 *
 * Storage is intentionally client-side only. Recent-page history is a
 * privacy-sensitive surface (it leaks browsing patterns across devices)
 * so we keep it in the user's own `localStorage` and never sync to the
 * backend. The privacy section's clear button is the only kill switch
 * we need.
 *
 * The store is framework-agnostic — pure read/write/transform helpers
 * so it can be unit-tested without a DOM round-trip. Wire-up to React
 * lives in `App.tsx` (route effect) and the consumer surfaces.
 */

import { ROUTE_REGISTRY } from './routeRegistry'

/** localStorage key. Versioned (`:v1`) so a future migration can re-key. */
const STORAGE_KEY = 'teslasync:recent-pages:v1'

/** Synthetic same-tab change event — `storage` only fires cross-tab. */
const LOCAL_EVENT = 'teslasync:recent-pages-local-changed'

const MAX_ENTRIES = 50

export const RECENT_PAGES_STORAGE_KEY = STORAGE_KEY
export const RECENT_PAGES_MAX = MAX_ENTRIES

/**
 * Coarse category for a recorded page. Drives the icon shown in the
 * palette / recent-page surfaces and gives consumers a stable grouping key. New kinds
 * may be added without breaking forward compatibility — unknown kinds
 * read from storage are surfaced as `'page'` by consumers.
 */
export type RecentPageKind =
  | 'page'
  | 'vehicle'
  | 'drive'
  | 'trip'
  | 'charging'
  | 'geofence'
  | 'year-review'

export interface RecentEntry {
  /** Pathname (no search/hash). Used for both navigation and dedup. */
  path: string
  /** Captured page title at recording time, suitable for display. */
  title: string
  /** Coarse category for icon + grouping. */
  kind: RecentPageKind
  /** Captured numeric/string id when path contains an `:id`-style param. */
  ref_id?: string
  /** ms since epoch of the most recent visit. */
  visited_at: number
}

/**
 * Path-pattern → kind table. Order matters: more specific patterns first.
 * The path classifier is intentionally registry-independent so adding a
 * new dynamic route doesn't require a registry round-trip.
 */
const PATH_PATTERNS: { test: RegExp; kind: RecentPageKind }[] = [
  { test: /^\/vehicles\/([^/]+)(?:\/|$)/, kind: 'vehicle' },
  { test: /^\/drives\/([^/]+)(?:\/|$)/, kind: 'drive' },
  { test: /^\/charging\/([^/]+)(?:\/|$)/, kind: 'charging' },
  { test: /^\/trips\/([^/]+)(?:\/|$)/, kind: 'trip' },
  { test: /^\/geofences\/([^/]+)(?:\/|$)/, kind: 'geofence' },
  { test: /^\/year-review\/([^/]+)(?:\/|$)/, kind: 'year-review' },
]

export interface PathClassification {
  kind: RecentPageKind
  ref_id?: string
}

/** Classify `path` into a {@link RecentPageKind} + optional ref_id. */
export function classifyPath(path: string): PathClassification {
  for (const p of PATH_PATTERNS) {
    const m = p.test.exec(path)
    if (m) return { kind: p.kind, ref_id: m[1] }
  }
  return { kind: 'page' }
}

/**
 * Routes that should never enter the recent list. Public-share tokens are
 * privacy-sensitive; onboarding/watch are transient flows that don't make
 * sense to "return to"; /search is dynamic-query oriented and would
 * pollute recents with stale searches; /me/activity is itself a history
 * surface.
 */
const SKIP_PREFIXES = ['/onboarding', '/s/', '/watch']
const SKIP_EXACT = new Set<string>(['/search', '/me/activity'])

export function shouldRecordPath(path: string): boolean {
  if (typeof path !== 'string') return false
  if (!path || path[0] !== '/') return false
  if (SKIP_EXACT.has(path)) return false
  for (const pre of SKIP_PREFIXES) {
    if (pre.endsWith('/')) {
      // Trailing slash means "match anything under this segment",
      // including the bare segment without a slash (e.g. `/s` is
      // never a real route, but `/s/abc` is).
      if (path === pre.slice(0, -1) || path.startsWith(pre)) return false
    } else if (path === pre || path.startsWith(pre + '/')) {
      return false
    }
  }
  return true
}

function hasStorage(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.localStorage !== 'undefined'
  )
}

function isValidEntry(e: unknown): e is RecentEntry {
  if (!e || typeof e !== 'object') return false
  const r = e as Record<string, unknown>
  return (
    typeof r.path === 'string' &&
    typeof r.title === 'string' &&
    typeof r.visited_at === 'number' &&
    Number.isFinite(r.visited_at) &&
    typeof r.kind === 'string'
  )
}

function load(): RecentEntry[] {
  if (!hasStorage()) return []
  let raw: string | null
  try {
    raw = window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return []
  }
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const valid: RecentEntry[] = []
    for (const item of parsed) {
      if (isValidEntry(item)) valid.push(item)
      if (valid.length >= MAX_ENTRIES) break
    }
    return valid
  } catch {
    return []
  }
}

function save(entries: RecentEntry[]): void {
  if (!hasStorage()) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Quota exceeded / disabled storage — fail silently. Recents is
    // additive UX; dropping a write degrades gracefully.
    return
  }
  notify()
}

function notify(): void {
  if (typeof window === 'undefined') return
  if (typeof window.dispatchEvent !== 'function') return
  try {
    window.dispatchEvent(new Event(LOCAL_EVENT))
  } catch {
    // Some test runtimes lack the Event constructor — silently skip.
  }
}

export interface RecordPageViewInput {
  /** Pathname (no search/hash). */
  path: string
  /** Display title captured at the time of the visit. */
  title: string
  /** Override the auto-classified kind. */
  kind?: RecentPageKind
  /** Override the auto-extracted ref id. */
  ref_id?: string
  /** Test seam — defaults to `Date.now()`. */
  now?: number
}

/**
 * Record a single visit to `path`. Moves the entry to the top of the
 * list, replacing any prior entry for the same path. No-op for paths
 * filtered by {@link shouldRecordPath}.
 */
export function recordPageView(input: RecordPageViewInput): void {
  const path = input?.path
  if (!shouldRecordPath(path)) return
  const cls = classifyPath(path)
  const visited_at = typeof input.now === 'number' && Number.isFinite(input.now)
    ? input.now
    : Date.now()
  const title = (input.title && input.title.trim()) || path
  const entry: RecentEntry = {
    path,
    title,
    kind: input.kind ?? cls.kind,
    ref_id: input.ref_id ?? cls.ref_id,
    visited_at,
  }
  const remaining = load().filter((e) => e.path !== path)
  remaining.unshift(entry)
  if (remaining.length > MAX_ENTRIES) remaining.length = MAX_ENTRIES
  save(remaining)
}

/** Snapshot of the recent-page list, newest first. Optionally truncated. */
export function getRecentPages(limit?: number): RecentEntry[] {
  const all = load()
  if (typeof limit === 'number') {
    return all.slice(0, Math.max(0, limit))
  }
  return all
}

/** Wipe all recent-page history. Fires a same-tab change event. */
export function clearRecentPages(): void {
  if (!hasStorage()) {
    notify()
    return
  }
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore — same rationale as save()
  }
  notify()
}

/**
 * Subscribe to recent-page list changes. Fires for changes made in the
 * same tab (via {@link LOCAL_EVENT}) AND in other tabs (via the native
 * `storage` event). Returns an unsubscribe function.
 */
export function subscribeRecentPages(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onLocal = () => {
    try {
      handler()
    } catch {
      // Never let a subscriber crash the bus.
    }
  }
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== STORAGE_KEY) return
    try {
      handler()
    } catch {
      // swallow
    }
  }
  window.addEventListener(LOCAL_EVENT, onLocal)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(LOCAL_EVENT, onLocal)
    window.removeEventListener('storage', onStorage)
  }
}

/**
 * Resolve a stable label for `path` from {@link ROUTE_REGISTRY}. Returns
 * null if no match is found so callers can fall back to the captured
 * document title or the raw path. Parameterized routes (e.g.
 * `/vehicles/:id`) match on a regex derived from the registry pattern.
 */
export function resolvePageLabel(path: string): string | null {
  if (!path) return null
  for (const r of ROUTE_REGISTRY) {
    if (r.path === path) return r.label
  }
  for (const r of ROUTE_REGISTRY) {
    if (!r.path.includes(':')) continue
    const re = new RegExp(
      '^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:[^/]+/g, '[^/]+') + '$',
    )
    if (re.test(path)) return r.label
  }
  return null
}

/** Test-only helper: wipe the entire list without firing events. */
export function __resetRecentPagesForTests(): void {
  if (!hasStorage()) return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
