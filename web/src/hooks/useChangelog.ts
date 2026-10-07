import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { CHANGELOG, LATEST_VERSION, type ChangelogEntry } from '@/generated/changelog'

/**
 * Changelog acknowledgement state.
 *
 * Tracks which changelog version the user has acknowledged via localStorage,
 * exposes the entries that have shipped since their last visit, and provides
 * helpers to mark the current latest as seen. Backed by useSyncExternalStore
 * so it cross-syncs between tabs (mirrors useStatusBarPrefs /
 * useAchievementCelebrationPrefs).
 *
 * Storage keys:
 *   - teslasync:changelog:seen-version   string  (highest version the user
 *                                                 has seen the modal for)
 *   - teslasync:changelog:last-shown     number  (epoch ms — used to throttle
 *                                                 the auto-show to once per
 *                                                 24h, regardless of seen-state)
 *
 * Comparison: strict numeric semver (MAJOR.MINOR.PATCH). Pre-release tags
 * (-beta.N, -rc.N, -alpha.N) are stripped before compare and treated as
 * lower than the corresponding release. Anything that fails to parse falls
 * back to lexicographic comparison so the system never crashes on a
 * malformed entry.
 */

export const SEEN_VERSION_KEY = 'teslasync:changelog:seen-version'
export const LAST_SHOWN_KEY = 'teslasync:changelog:last-shown'

const ONBOARDED_KEY = 'teslasync-onboarded'
const AUTO_SHOW_THROTTLE_MS = 24 * 60 * 60 * 1000

/**
 * Compare two semver strings. Returns -1 if a < b, 0 if equal, 1 if a > b.
 * Pre-release tags sort BEFORE the release ("1.0.0-beta.1" < "1.0.0").
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  if (a === b) return 0
  const parse = (v: string): { core: [number, number, number]; pre: string | null } | null => {
    const match = v.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+](.+))?$/)
    if (!match) return null
    return {
      core: [Number(match[1]), Number(match[2]), Number(match[3])],
      pre: match[4] ?? null,
    }
  }
  const pa = parse(a)
  const pb = parse(b)
  if (!pa || !pb) {
    return a < b ? -1 : a > b ? 1 : 0
  }
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1
  }
  // Cores equal — pre-release sorts before stable release.
  if (pa.pre === null && pb.pre !== null) return 1
  if (pa.pre !== null && pb.pre === null) return -1
  if (pa.pre === null && pb.pre === null) return 0
  return (pa.pre as string) < (pb.pre as string) ? -1 : (pa.pre as string) > (pb.pre as string) ? 1 : 0
}

// ── External-store wiring ────────────────────────────────────────────────────

interface ChangelogState {
  seenVersion: string | null
  lastShownAt: number | null
}

function readState(): ChangelogState {
  try {
    const seenVersion = localStorage.getItem(SEEN_VERSION_KEY)
    const lastShownRaw = localStorage.getItem(LAST_SHOWN_KEY)
    const lastShownAt = lastShownRaw ? Number(lastShownRaw) : null
    return {
      seenVersion: seenVersion && seenVersion.length > 0 ? seenVersion : null,
      lastShownAt: lastShownAt && Number.isFinite(lastShownAt) ? lastShownAt : null,
    }
  } catch {
    return { seenVersion: null, lastShownAt: null }
  }
}

let cachedState: ChangelogState = readState()
let cachedSerialized = JSON.stringify(cachedState)

function getSnapshot(): ChangelogState {
  return cachedState
}

function refreshSnapshot(): void {
  const next = readState()
  const serialized = JSON.stringify(next)
  if (serialized !== cachedSerialized) {
    cachedState = next
    cachedSerialized = serialized
  }
}

const listeners = new Set<() => void>()

function subscribe(cb: () => void): () => void {
  // Re-read localStorage on every new subscription. Without this, any
  // mutation to localStorage that happened BEFORE the first hook mounted
  // (cross-tab writes, test setup, restored state on app boot) would not
  // be reflected — useSyncExternalStore would hand back the stale module
  // cache from getSnapshot until something explicitly notified.
  refreshSnapshot()
  listeners.add(cb)
  const onStorage = (e: StorageEvent) => {
    if (e.key !== SEEN_VERSION_KEY && e.key !== LAST_SHOWN_KEY) return
    refreshSnapshot()
    cb()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', onStorage)
  }
}

function notifyAll(): void {
  for (const cb of listeners) cb()
}

function writeSeenVersion(version: string | null): void {
  try {
    if (version === null) {
      localStorage.removeItem(SEEN_VERSION_KEY)
    } else {
      localStorage.setItem(SEEN_VERSION_KEY, version)
    }
  } catch {
    // localStorage may be unavailable (private mode / quota) — fall through
    // so the in-memory cache still updates and the current tab reflects it.
  }
  refreshSnapshot()
  notifyAll()
}

function writeLastShownAt(ts: number | null): void {
  try {
    if (ts === null) {
      localStorage.removeItem(LAST_SHOWN_KEY)
    } else {
      localStorage.setItem(LAST_SHOWN_KEY, String(ts))
    }
  } catch {
    // ignore
  }
  refreshSnapshot()
  notifyAll()
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface UseChangelogResult {
  /** All releases (newest first) — re-export of generated CHANGELOG. */
  entries: readonly ChangelogEntry[]
  /** Topmost version, e.g. "0.7.0". */
  latestVersion: string
  /** Highest version the user has acknowledged, or null if never seen. */
  seenVersion: string | null
  /** True when latestVersion > seenVersion (or seenVersion is null). */
  hasUnseen: boolean
  /** Entries that shipped after seenVersion (or all if first visit). */
  newEntries: readonly ChangelogEntry[]
  /** Mark the current latest as seen and stamp the auto-show throttle. */
  markSeen: () => void
  /** Stamp the auto-show throttle WITHOUT marking seen (modal opened manually). */
  stampShown: () => void
  /** True when enough time has passed since the last auto-show. */
  canAutoShow: boolean
  /** True if the user has finished the OnboardingWizard at least once. */
  hasCompletedOnboarding: boolean
}

export function useChangelog(): UseChangelogResult {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const newEntries = useMemo<readonly ChangelogEntry[]>(() => {
    if (!state.seenVersion) return CHANGELOG
    return CHANGELOG.filter((e) => compareVersions(e.version, state.seenVersion as string) > 0)
  }, [state.seenVersion])

  const hasUnseen = newEntries.length > 0

  const canAutoShow = useMemo(() => {
    if (!hasUnseen) return false
    if (state.lastShownAt == null) return true
    return Date.now() - state.lastShownAt >= AUTO_SHOW_THROTTLE_MS
  }, [hasUnseen, state.lastShownAt])

  const hasCompletedOnboarding = useMemo(() => {
    try {
      return localStorage.getItem(ONBOARDED_KEY) != null
    } catch {
      return false
    }
  }, [])

  const markSeen = useCallback(() => {
    writeSeenVersion(LATEST_VERSION)
    writeLastShownAt(Date.now())
  }, [])

  const stampShown = useCallback(() => {
    writeLastShownAt(Date.now())
  }, [])

  return {
    entries: CHANGELOG,
    latestVersion: LATEST_VERSION,
    seenVersion: state.seenVersion,
    hasUnseen,
    newEntries,
    markSeen,
    stampShown,
    canAutoShow,
    hasCompletedOnboarding,
  }
}

/** Custom event the modal listens for to open imperatively (palette, status-bar dot). */
export const OPEN_CHANGELOG_MODAL_EVENT = 'teslasync:changelog:open'

/** Dispatch the open event from anywhere (command palette, version segment, etc). */
export function openChangelogModal(): void {
  window.dispatchEvent(new CustomEvent(OPEN_CHANGELOG_MODAL_EVENT))
}
