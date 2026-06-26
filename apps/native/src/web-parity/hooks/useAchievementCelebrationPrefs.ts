import {useSyncExternalStore} from 'react';

/**
 * Native parity port of web/src/hooks/useAchievementCelebrationPrefs.ts.
 *
 * User preferences for achievement-unlock celebrations. On the web these are
 * persisted client-side in `localStorage` (mirroring `useStatusBarPrefs`)
 * rather than in the `settings` key/value table so toggles take effect
 * instantly without a round-trip and survive offline; cross-tab sync is handled
 * via the window `storage` event so toggling on one tab updates open instances
 * of the settings page in other tabs.
 *
 * React Native has neither `localStorage` nor a cross-tab `storage` event, so —
 * following the sibling StatusBar native port — persistence is an injectable
 * seam (`AchievementCelebrationPrefsStorage`). Until a host wires one via
 * `setAchievementCelebrationPrefsStorage`, the store is in-memory only and
 * persistence is a documented no-op while in-session reactive updates still
 * apply. Re-hydration when a backend is wired is the native analog of the web's
 * cross-tab `storage` event re-sync.
 *
 * - `showToasts`         — render the celebration toast on unlock (default: on)
 * - `playSound`          — play the unlock chime (default: off — opt-in to
 *                          avoid surprising users with audio)
 * - `showOnDashboard`    — render the "Recently unlocked" widget content
 *                          (default: on; the widget itself is added per-user
 *                          by the dashboard layout)
 * - `pushOnUnlock`       — gate push delivery for achievement events
 *                          (default: on; honoured by future push wiring)
 */
export interface AchievementCelebrationPrefs {
  showToasts: boolean;
  playSound: boolean;
  showOnDashboard: boolean;
  pushOnUnlock: boolean;
}

/**
 * Optional persistence backend. React Native has no localStorage and no
 * cross-tab `storage` event, so a host may inject an AsyncStorage/MMKV-style
 * seam to make preferences durable + shareable across surfaces. Until one is
 * provided the store is in-memory only and persistence is a documented no-op.
 */
export interface AchievementCelebrationPrefsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = 'teslasync:achievement-celebration:v1';

const defaultPrefs: AchievementCelebrationPrefs = {
  showToasts: true,
  playSound: false,
  showOnDashboard: true,
  pushOnUnlock: true,
};

let prefsStorage: AchievementCelebrationPrefsStorage | null = null;

function readPrefs(): AchievementCelebrationPrefs {
  if (!prefsStorage) {
    return defaultPrefs;
  }
  try {
    const raw = prefsStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaultPrefs;
    }
    const parsed = JSON.parse(raw) as Partial<AchievementCelebrationPrefs>;
    return {
      showToasts:
        typeof parsed.showToasts === 'boolean'
          ? parsed.showToasts
          : defaultPrefs.showToasts,
      playSound:
        typeof parsed.playSound === 'boolean'
          ? parsed.playSound
          : defaultPrefs.playSound,
      showOnDashboard:
        typeof parsed.showOnDashboard === 'boolean'
          ? parsed.showOnDashboard
          : defaultPrefs.showOnDashboard,
      pushOnUnlock:
        typeof parsed.pushOnUnlock === 'boolean'
          ? parsed.pushOnUnlock
          : defaultPrefs.pushOnUnlock,
    };
  } catch {
    return defaultPrefs;
  }
}

// Stable cache so useSyncExternalStore returns referentially-equal snapshots
// when nothing has changed (otherwise React raises an infinite-render).
let cachedPrefs: AchievementCelebrationPrefs = readPrefs();
let cachedSerialized = JSON.stringify(cachedPrefs);

function getSnapshot(): AchievementCelebrationPrefs {
  return cachedPrefs;
}

function refreshSnapshot(): void {
  const next = readPrefs();
  const serialized = JSON.stringify(next);
  if (serialized !== cachedSerialized) {
    cachedPrefs = next;
    cachedSerialized = serialized;
  }
}

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  // The web hook also attaches a window `storage` listener for cross-tab sync;
  // React Native has no such event, so external re-sync arrives via
  // `setAchievementCelebrationPrefsStorage` instead.
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Wire (or clear) the native persistence backend. Re-hydrates the cached
 * preferences from the new store and notifies subscribers — the native analog
 * of the web's cross-tab `storage` event re-sync.
 */
export function setAchievementCelebrationPrefsStorage(
  storage: AchievementCelebrationPrefsStorage | null,
): void {
  prefsStorage = storage;
  refreshSnapshot();
  for (const cb of listeners) {
    cb();
  }
}

export function useAchievementCelebrationPrefs(): AchievementCelebrationPrefs {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Imperatively patch the celebration prefs. Triggers a re-render in every
 * mounted `useAchievementCelebrationPrefs()`. Pass partial updates — unspecified
 * keys retain their current value. Persists via the injected storage backend
 * when one is wired; otherwise the change applies for the current session only.
 */
export function setAchievementCelebrationPrefs(
  patch: Partial<AchievementCelebrationPrefs>,
): void {
  const next: AchievementCelebrationPrefs = {...cachedPrefs, ...patch};
  const serialized = JSON.stringify(next);
  if (serialized === cachedSerialized) {
    return;
  }
  if (prefsStorage) {
    try {
      prefsStorage.setItem(STORAGE_KEY, serialized);
    } catch {
      // Storage may be unavailable (no backend, quota); fall through to the
      // in-memory update so the current session still reflects the toggle.
    }
  }
  cachedPrefs = next;
  cachedSerialized = serialized;
  for (const cb of listeners) {
    cb();
  }
}
