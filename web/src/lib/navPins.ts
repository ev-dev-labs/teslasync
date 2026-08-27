/**
 * navPins
 * ───────
 * Shared persistence for pinned ("Quick access") navigation destinations.
 *
 * The sidebar owned this list privately, so the command palette could not
 * surface a user's pinned pages. Extracting it here gives both surfaces one
 * source of truth plus a same-tab/cross-tab change bus, mirroring the
 * `lib/recentPages.ts` contract.
 *
 * Safety rules
 * ------------
 * - Every read is defensive: malformed / non-array / non-string payloads
 *   degrade to the default list instead of throwing.
 * - Every write is wrapped — private browsing and storage-quota errors must
 *   never break navigation. A FAILED write does not silently lose the change:
 *   the sanitized value is kept as an in-memory session override, and the
 *   change event carries the payload, so a same-tab subscriber never re-reads
 *   stale storage and undoes the in-memory update.
 * - Only rooted in-app paths (`/…`) are ever stored, so a poisoned storage
 *   value cannot turn a pin into an off-site link.
 * - The list is capped at {@link MAX_PINNED_NAV_ITEMS} entries.
 */

export const PINNED_NAV_STORAGE_KEY = 'teslasync-pinned-nav-paths'
export const RECENT_NAV_STORAGE_KEY = 'teslasync-recent-nav-paths'

/** Emitted on `window` whenever the pinned list changes in THIS tab. */
export const NAV_PINS_EVENT = 'teslasync:nav-pins-change'

export const MAX_PINNED_NAV_ITEMS = 8
export const MAX_RECENT_NAV_ITEMS = 3

export const DEFAULT_PINNED_NAV_PATHS: readonly string[] = [
  '/',
  '/digital-twin',
  '/vehicles',
  '/charging',
  '/live',
]

/** Payload delivered to {@link subscribeNavPins} listeners. */
export interface NavPinsChangeDetail {
  /** Authoritative pinned list AFTER the change (never re-read from storage). */
  pinned: string[]
  /** Authoritative recent list AFTER the change. */
  recent: string[]
  /**
   * `false` when the change could not be persisted (quota exceeded, private
   * browsing, storage disabled). The lists above are still correct for this
   * session — subscribers must trust them over `localStorage`.
   */
  persisted: boolean
  /** `local` for this tab's own write, `storage` for another tab's. */
  source: 'local' | 'storage'
}

/** Outcome of a pinned/recent write. */
export interface NavPinsWriteResult {
  /** The sanitized list that is now authoritative for this session. */
  paths: string[]
  /** `false` when the write was rejected by the browser. */
  persisted: boolean
}

/**
 * Session overrides used ONLY after a failed write.
 *
 * While set, reads prefer this value over `localStorage`: our own write did
 * not land, so storage holds a stale list and re-reading it would silently
 * roll the user's change back. Cleared when a later write succeeds, or when
 * another tab writes the key (that tab's storage value then wins, preserving
 * normal cross-tab semantics).
 */
let sessionPinnedOverride: string[] | null = null
let sessionRecentOverride: string[] | null = null

function isRootedPath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
}

function sanitizePaths(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const entry of value) {
    if (!isRootedPath(entry) || seen.has(entry)) continue
    seen.add(entry)
    out.push(entry)
    if (out.length >= max) break
  }
  return out
}

function readPaths(key: string, max: number): string[] | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    if (raw == null) return null
    return sanitizePaths(JSON.parse(raw) as unknown, max)
  } catch {
    return null
  }
}

/** Persist `paths`; returns `false` when the browser rejected the write. */
function writePaths(key: string, paths: readonly string[]): boolean {
  if (typeof window === 'undefined') return false
  try {
    window.localStorage.setItem(key, JSON.stringify(paths))
    return true
  } catch {
    // Navigation still works without persistence — pins are convenience-only.
    return false
  }
}

function notify(detail: NavPinsChangeDetail): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<NavPinsChangeDetail>(NAV_PINS_EVENT, { detail }),
  )
}

/** Test seam: drop any in-memory fallback so each test starts clean. */
export function __resetNavPinsSessionOverridesForTests(): void {
  sessionPinnedOverride = null
  sessionRecentOverride = null
}

/** Two path lists are equivalent when they hold the same paths in the same order. */
export function navPathsEqual(
  left: readonly string[] | null | undefined,
  right: readonly string[] | null | undefined,
): boolean {
  const a = left ?? []
  const b = right ?? []
  if (a.length !== b.length) return false
  return a.every((value, index) => value === b[index])
}

function rawStoredValue(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

/**
 * Should `paths` be written back to `key`?
 *
 * Answers "no" in the two cases that would otherwise cause needless writes —
 * and, because every write publishes on the change bus, needless write loops:
 *
 * 1. Nothing is stored yet AND `paths` still equals the untouched fallback.
 *    Writing here would silently convert "never customized" into an explicit
 *    user list on first paint.
 * 2. The raw stored payload is already byte-identical to what we would write.
 *
 * It DOES answer "yes" when storage holds a stale or malformed payload, so a
 * dirty value is normalized exactly once rather than re-read (and re-sanitized)
 * forever.
 */
function needsRewrite(
  key: string,
  paths: readonly string[],
  fallback: readonly string[],
  max: number,
  sessionOverride: string[] | null,
): boolean {
  // A session override means our last write was REJECTED. Re-attempting on
  // every render would be a write storm against a full/disabled quota, so we
  // only retry when the caller actually has a different list.
  if (sessionOverride) return !navPathsEqual(paths, sessionOverride)
  const raw = rawStoredValue(key)
  if (raw == null) return !navPathsEqual(paths, fallback)
  return raw !== JSON.stringify(sanitizePaths(paths, max))
}

/** `true` when the pinned list should be persisted (see {@link needsRewrite}). */
export function pinnedNavPathsNeedRewrite(paths: readonly string[]): boolean {
  return needsRewrite(
    PINNED_NAV_STORAGE_KEY,
    paths,
    DEFAULT_PINNED_NAV_PATHS,
    MAX_PINNED_NAV_ITEMS,
    sessionPinnedOverride,
  )
}

/** `true` when the recent list should be persisted (see {@link needsRewrite}). */
export function recentNavPathsNeedRewrite(paths: readonly string[]): boolean {
  return needsRewrite(
    RECENT_NAV_STORAGE_KEY,
    paths,
    [],
    MAX_RECENT_NAV_ITEMS,
    sessionRecentOverride,
  )
}

/**
 * Pinned destinations, most-recently-pinned first.
 *
 * A missing storage entry means "never customized" and yields the curated
 * defaults; an explicitly emptied list stays empty. An active session override
 * (previous write rejected) wins over storage — otherwise a read would resurrect
 * the stale list the failed write was meant to replace.
 */
export function getPinnedNavPaths(): string[] {
  if (sessionPinnedOverride) return [...sessionPinnedOverride]
  const stored = readPaths(PINNED_NAV_STORAGE_KEY, MAX_PINNED_NAV_ITEMS)
  if (stored == null) return [...DEFAULT_PINNED_NAV_PATHS]
  return stored
}

/**
 * Persist the pinned list and publish the change.
 *
 * The event carries the sanitized payload, so a same-tab subscriber applies
 * exactly what was set instead of re-reading `localStorage` — which, after a
 * quota failure, still holds the previous value and would undo the update.
 */
export function setPinnedNavPaths(paths: readonly string[]): NavPinsWriteResult {
  const next = sanitizePaths(paths, MAX_PINNED_NAV_ITEMS)
  const persisted = writePaths(PINNED_NAV_STORAGE_KEY, next)
  sessionPinnedOverride = persisted ? null : next
  notify({
    pinned: next,
    recent: getRecentNavPaths(),
    persisted,
    source: 'local',
  })
  return { paths: next, persisted }
}

/** Recently visited nav destinations (strict recency, excludes pins). */
export function getRecentNavPaths(): string[] {
  if (sessionRecentOverride) return [...sessionRecentOverride]
  return readPaths(RECENT_NAV_STORAGE_KEY, MAX_RECENT_NAV_ITEMS) ?? []
}

/** Recent-list counterpart of {@link setPinnedNavPaths}. */
export function setRecentNavPaths(paths: readonly string[]): NavPinsWriteResult {
  const next = sanitizePaths(paths, MAX_RECENT_NAV_ITEMS)
  const persisted = writePaths(RECENT_NAV_STORAGE_KEY, next)
  sessionRecentOverride = persisted ? null : next
  notify({
    pinned: getPinnedNavPaths(),
    recent: next,
    persisted,
    source: 'local',
  })
  return { paths: next, persisted }
}

/** `true` when `path` is currently pinned. */
export function isNavPathPinned(path: string): boolean {
  return getPinnedNavPaths().includes(path)
}

/**
 * Subscribe to pin changes from this tab (`NAV_PINS_EVENT`) and from other
 * tabs (`storage`). Returns an unsubscribe function.
 *
 * The listener always receives an authoritative {@link NavPinsChangeDetail}:
 *
 * - `source: 'local'` — the payload published by our own write, valid even
 *   when persistence failed, so subscribers never re-read stale storage.
 * - `source: 'storage'` — another tab wrote the key. That tab's value becomes
 *   authoritative, so any session override from a failed local write is
 *   dropped first and the detail is read back from storage.
 */
export function subscribeNavPins(
  listener: (detail: NavPinsChangeDetail) => void,
): () => void {
  if (typeof window === 'undefined') return () => {}

  const onLocal = (event: Event) => {
    const detail = (event as CustomEvent<NavPinsChangeDetail>).detail
    listener(
      detail ?? {
        pinned: getPinnedNavPaths(),
        recent: getRecentNavPaths(),
        persisted: true,
        source: 'local',
      },
    )
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key === PINNED_NAV_STORAGE_KEY) {
      sessionPinnedOverride = null
    } else if (event.key === RECENT_NAV_STORAGE_KEY) {
      sessionRecentOverride = null
    } else {
      return
    }
    listener({
      pinned: getPinnedNavPaths(),
      recent: getRecentNavPaths(),
      persisted: true,
      source: 'storage',
    })
  }

  window.addEventListener(NAV_PINS_EVENT, onLocal)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(NAV_PINS_EVENT, onLocal)
    window.removeEventListener('storage', onStorage)
  }
}
