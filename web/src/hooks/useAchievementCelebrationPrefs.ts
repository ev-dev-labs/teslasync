import { useSyncExternalStore } from 'react'

/**
 * localStorage-backed user preferences for achievement-unlock celebrations.
 *
 * Stored client-side (mirroring `useStatusBarPrefs`) rather than in the
 * `settings` key/value table so toggles take effect instantly without a
 * round-trip and survive offline. Cross-tab sync is handled via the `storage`
 * window event so toggling on one tab updates open instances of the settings
 * page in other tabs.
 *
 * - `showToasts`         — render the celebration toast on unlock (default: on)
 * - `playSound`          — play the unlock chime (default: off — opt-in to
 *                          avoid surprising users with audio)
 * - `showOnDashboard`    — render the "Recently unlocked" widget content
 *                          (default: on; the widget itself is added per-user
 *                          by the dashboard layout)
 * - `pushOnUnlock`       — gate web push delivery for achievement events
 *                          (default: on; honoured by future push wiring)
 */
export interface AchievementCelebrationPrefs {
  showToasts: boolean
  playSound: boolean
  showOnDashboard: boolean
  pushOnUnlock: boolean
}

const STORAGE_KEY = 'teslasync:achievement-celebration:v1'

const defaultPrefs: AchievementCelebrationPrefs = {
  showToasts: true,
  playSound: false,
  showOnDashboard: true,
  pushOnUnlock: true,
}

function readPrefs(): AchievementCelebrationPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultPrefs
    const parsed = JSON.parse(raw) as Partial<AchievementCelebrationPrefs>
    return {
      showToasts: typeof parsed.showToasts === 'boolean' ? parsed.showToasts : defaultPrefs.showToasts,
      playSound: typeof parsed.playSound === 'boolean' ? parsed.playSound : defaultPrefs.playSound,
      showOnDashboard: typeof parsed.showOnDashboard === 'boolean' ? parsed.showOnDashboard : defaultPrefs.showOnDashboard,
      pushOnUnlock: typeof parsed.pushOnUnlock === 'boolean' ? parsed.pushOnUnlock : defaultPrefs.pushOnUnlock,
    }
  } catch {
    return defaultPrefs
  }
}

// Stable cache so useSyncExternalStore returns referentially-equal snapshots
// when nothing has changed (otherwise React 18 raises an infinite-render).
let cachedPrefs: AchievementCelebrationPrefs = readPrefs()
let cachedSerialized = JSON.stringify(cachedPrefs)

function getSnapshot(): AchievementCelebrationPrefs {
  return cachedPrefs
}

function refreshSnapshot(): void {
  const next = readPrefs()
  const serialized = JSON.stringify(next)
  if (serialized !== cachedSerialized) {
    cachedPrefs = next
    cachedSerialized = serialized
  }
}

const listeners = new Set<() => void>()

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return
    refreshSnapshot()
    cb()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', onStorage)
  }
}

export function useAchievementCelebrationPrefs(): AchievementCelebrationPrefs {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Imperatively patch the celebration prefs. Triggers a re-render in every
 * mounted `useAchievementCelebrationPrefs()` (current tab + other tabs via the
 * `storage` event). Pass partial updates — unspecified keys retain their
 * current value.
 */
export function setAchievementCelebrationPrefs(patch: Partial<AchievementCelebrationPrefs>): void {
  // Merge only keys whose value is an actual boolean. `Partial<…>` also admits
  // `undefined` for every key, so a caller forwarding a `boolean | undefined`
  // value (e.g. `{ showToasts: maybeUndefined }`) would otherwise write
  // `undefined` into the in-memory snapshot while `JSON.stringify` silently
  // drops that key from the persisted copy — leaving the live store and
  // localStorage disagreeing until the next reload coerces the missing key
  // back to its default.
  const next: AchievementCelebrationPrefs = { ...cachedPrefs }
  if (typeof patch.showToasts === 'boolean') next.showToasts = patch.showToasts
  if (typeof patch.playSound === 'boolean') next.playSound = patch.playSound
  if (typeof patch.showOnDashboard === 'boolean') next.showOnDashboard = patch.showOnDashboard
  if (typeof patch.pushOnUnlock === 'boolean') next.pushOnUnlock = patch.pushOnUnlock
  const serialized = JSON.stringify(next)
  if (serialized === cachedSerialized) return
  try {
    localStorage.setItem(STORAGE_KEY, serialized)
  } catch {
    // localStorage may be unavailable (private mode, quota); fall through to
    // in-memory update so the current tab still reflects the toggle.
  }
  cachedPrefs = next
  cachedSerialized = serialized
  for (const cb of listeners) cb()
}
