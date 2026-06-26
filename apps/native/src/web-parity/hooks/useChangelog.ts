// Native parity port of web/src/hooks/useChangelog.ts.
//
// Changelog acknowledgement state for React Native.
//
// Tracks which changelog version the user has acknowledged, exposes the entries
// that have shipped since their last visit, and provides helpers to mark the
// current latest as seen. Backed by useSyncExternalStore so it cross-syncs
// between every mounted consumer in the same app process (mirrors the web
// useStatusBarPrefs / useAchievementCelebrationPrefs contract).
//
// Web -> native adaptation (conversion contract rule 7):
//   * Browser localStorage has no synchronous React Native equivalent, so the
//     two storage keys live in an in-memory module store (session-scoped, like
//     useChartLegendState / the CommandPalette frecency store). The string key
//     constants are preserved so a future AsyncStorage-backed store can adopt
//     them unchanged.
//   * The web `window` 'storage' event powered cross-TAB sync; React Native has
//     no tabs and no window, so cross-component sync is driven entirely by the
//     module listener Set + notifyAll() that already existed in the source.
//   * window.dispatchEvent(new CustomEvent(OPEN_CHANGELOG_MODAL_EVENT)) becomes
//     a module-level subscriber bus (subscribeOpenChangelogModal) mirroring the
//     native commandPaletteBus pattern; OPEN_CHANGELOG_MODAL_EVENT stays the
//     stable channel identifier.
//
// Storage keys (now in-memory map keys):
//   - teslasync:changelog:seen-version   string  (highest version the user has
//                                                 seen the modal for)
//   - teslasync:changelog:last-shown     number  (epoch ms — throttles the
//                                                 auto-show to once per 24h)
//
// Comparison: strict numeric semver (MAJOR.MINOR.PATCH). Pre-release tags
// (-beta.N, -rc.N, -alpha.N) are stripped before compare and treated as lower
// than the corresponding release. Anything that fails to parse falls back to
// lexicographic comparison so the system never crashes on a malformed entry.

import {useCallback, useMemo, useSyncExternalStore} from 'react';

import {
  CHANGELOG,
  LATEST_VERSION,
  type ChangelogEntry,
} from '../generated/changelog';

export const SEEN_VERSION_KEY = 'teslasync:changelog:seen-version';
export const LAST_SHOWN_KEY = 'teslasync:changelog:last-shown';

const ONBOARDED_KEY = 'teslasync-onboarded';
const AUTO_SHOW_THROTTLE_MS = 24 * 60 * 60 * 1000;

// ── Native-safe synchronous key/value store ──────────────────────────────────
//
// Web read/wrote browser localStorage. React Native exposes only the async
// AsyncStorage, which cannot back a synchronous useSyncExternalStore snapshot,
// so changelog ack state persists for the current app process in this in-memory
// map. The getItem/setItem/removeItem surface mirrors the Web Storage API so the
// read/write helpers below stay structurally identical to the source.

const memoryStore = new Map<string, string>();

const memoryStorage = {
  getItem(key: string): string | null {
    return memoryStore.has(key) ? (memoryStore.get(key) as string) : null;
  },
  setItem(key: string, value: string): void {
    memoryStore.set(key, value);
  },
  removeItem(key: string): void {
    memoryStore.delete(key);
  },
};

/**
 * Compare two semver strings. Returns -1 if a < b, 0 if equal, 1 if a > b.
 * Pre-release tags sort BEFORE the release ("1.0.0-beta.1" < "1.0.0").
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  if (a === b) {
    return 0;
  }
  const parse = (
    v: string,
  ): {core: [number, number, number]; pre: string | null} | null => {
    const match = v.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+](.+))?$/);
    if (!match) {
      return null;
    }
    return {
      core: [Number(match[1]), Number(match[2]), Number(match[3])],
      pre: match[4] ?? null,
    };
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) {
      return pa.core[i] < pb.core[i] ? -1 : 1;
    }
  }
  // Cores equal — pre-release sorts before stable release.
  if (pa.pre === null && pb.pre !== null) {
    return 1;
  }
  if (pa.pre !== null && pb.pre === null) {
    return -1;
  }
  if (pa.pre === null && pb.pre === null) {
    return 0;
  }
  return (pa.pre as string) < (pb.pre as string)
    ? -1
    : (pa.pre as string) > (pb.pre as string)
    ? 1
    : 0;
}

// ── External-store wiring ────────────────────────────────────────────────────

interface ChangelogState {
  seenVersion: string | null;
  lastShownAt: number | null;
}

function readState(): ChangelogState {
  try {
    const seenVersion = memoryStorage.getItem(SEEN_VERSION_KEY);
    const lastShownRaw = memoryStorage.getItem(LAST_SHOWN_KEY);
    const lastShownAt = lastShownRaw ? Number(lastShownRaw) : null;
    return {
      seenVersion: seenVersion && seenVersion.length > 0 ? seenVersion : null,
      lastShownAt:
        lastShownAt && Number.isFinite(lastShownAt) ? lastShownAt : null,
    };
  } catch {
    return {seenVersion: null, lastShownAt: null};
  }
}

let cachedState: ChangelogState = readState();
let cachedSerialized = JSON.stringify(cachedState);

function getSnapshot(): ChangelogState {
  return cachedState;
}

function refreshSnapshot(): void {
  const next = readState();
  const serialized = JSON.stringify(next);
  if (serialized !== cachedSerialized) {
    cachedState = next;
    cachedSerialized = serialized;
  }
}

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  // Re-read the in-memory store on every new subscription. Without this, any
  // mutation that happened BEFORE the first hook mounted (restored state on app
  // boot, test setup, an onboarding write) would not be reflected —
  // useSyncExternalStore would hand back the stale module cache from getSnapshot
  // until something explicitly notified. React Native has no cross-tab `window`
  // 'storage' event, so same-process writes drive updates through notifyAll()
  // below instead of a DOM storage listener.
  refreshSnapshot();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function notifyAll(): void {
  for (const cb of listeners) {
    cb();
  }
}

function writeSeenVersion(version: string | null): void {
  try {
    if (version === null) {
      memoryStorage.removeItem(SEEN_VERSION_KEY);
    } else {
      memoryStorage.setItem(SEEN_VERSION_KEY, version);
    }
  } catch {
    // The in-memory store never throws, but the guard mirrors the source so a
    // future AsyncStorage-backed implementation can drop in unchanged — the
    // current process still reflects the write via the cache refresh below.
  }
  refreshSnapshot();
  notifyAll();
}

function writeLastShownAt(ts: number | null): void {
  try {
    if (ts === null) {
      memoryStorage.removeItem(LAST_SHOWN_KEY);
    } else {
      memoryStorage.setItem(LAST_SHOWN_KEY, String(ts));
    }
  } catch {
    // ignore
  }
  refreshSnapshot();
  notifyAll();
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface UseChangelogResult {
  /** All releases (newest first) — re-export of generated CHANGELOG. */
  entries: readonly ChangelogEntry[];
  /** Topmost version, e.g. "0.7.0". */
  latestVersion: string;
  /** Highest version the user has acknowledged, or null if never seen. */
  seenVersion: string | null;
  /** True when latestVersion > seenVersion (or seenVersion is null). */
  hasUnseen: boolean;
  /** Entries that shipped after seenVersion (or all if first visit). */
  newEntries: readonly ChangelogEntry[];
  /** Mark the current latest as seen and stamp the auto-show throttle. */
  markSeen: () => void;
  /** Stamp the auto-show throttle WITHOUT marking seen (modal opened manually). */
  stampShown: () => void;
  /** True when enough time has passed since the last auto-show. */
  canAutoShow: boolean;
  /** True if the user has finished the OnboardingWizard at least once. */
  hasCompletedOnboarding: boolean;
}

export function useChangelog(): UseChangelogResult {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const newEntries = useMemo<readonly ChangelogEntry[]>(() => {
    if (!state.seenVersion) {
      return CHANGELOG;
    }
    return CHANGELOG.filter(
      e => compareVersions(e.version, state.seenVersion as string) > 0,
    );
  }, [state.seenVersion]);

  const hasUnseen = newEntries.length > 0;

  const canAutoShow = useMemo(() => {
    if (!hasUnseen) {
      return false;
    }
    if (state.lastShownAt == null) {
      return true;
    }
    return Date.now() - state.lastShownAt >= AUTO_SHOW_THROTTLE_MS;
  }, [hasUnseen, state.lastShownAt]);

  const hasCompletedOnboarding = useMemo(() => {
    try {
      return memoryStorage.getItem(ONBOARDED_KEY) != null;
    } catch {
      return false;
    }
  }, []);

  const markSeen = useCallback(() => {
    writeSeenVersion(LATEST_VERSION);
    writeLastShownAt(Date.now());
  }, []);

  const stampShown = useCallback(() => {
    writeLastShownAt(Date.now());
  }, []);

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
  };
}

/** Custom event the modal listens for to open imperatively (palette, status-bar dot). */
export const OPEN_CHANGELOG_MODAL_EVENT = 'teslasync:changelog:open';

// Native replacement for the web window CustomEvent bus. The web modal called
// window.addEventListener(OPEN_CHANGELOG_MODAL_EVENT, ...); React Native has no
// window, so a module-level subscriber Set carries the open signal (mirroring
// the native commandPaletteBus). OPEN_CHANGELOG_MODAL_EVENT is preserved as the
// stable channel identifier above.
const openChangelogModalSubscribers = new Set<() => void>();

/** Subscribe a native ChangelogModal to imperative open requests. Returns an unsubscribe. */
export function subscribeOpenChangelogModal(handler: () => void): () => void {
  openChangelogModalSubscribers.add(handler);
  return () => {
    openChangelogModalSubscribers.delete(handler);
  };
}

/** Dispatch the open event from anywhere (command palette, version segment, etc). */
export function openChangelogModal(): void {
  for (const handler of openChangelogModalSubscribers) {
    try {
      handler();
    } catch {
      // Never let a subscriber crash the bus.
    }
  }
}
