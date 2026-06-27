// Native parity port of web/src/lib/notificationSound.ts.
//
// The web module is a non-visual utility: a `useSyncExternalStore`-backed
// preference store (persisted in browser localStorage) plus a tiny WebAudio
// player that procedurally synthesises a short tonal cue per notification
// category. It contains no JSX, no Recharts/Leaflet, and no web UI component —
// the only browser-coupled pieces are three globals, each ported behind the
// established native-parity conventions (the useOnboardingSkip / AIVoiceMode
// `globalThis`-probe precedent) so the full public surface, every state name,
// the STORAGE_KEY, and the structured `PlayResult` reason contract are
// preserved byte-for-byte:
//
//   * `localStorage` (readPrefs / setNotificationSoundPrefs) is resolved via
//     `getWebStorage()`, which prefers `globalThis.localStorage` when present
//     (the react-native-web target, keeping the exact STORAGE_KEY + JSON
//     payload) and otherwise reports "no store". A pure native runtime then
//     behaves exactly like the web source's documented non-browser path:
//     reads return defaults and writes fall through to the in-memory
//     `cachedPrefs` so the current process still reflects the toggle. Durable
//     cross-restart persistence on a pure native runtime is intentionally
//     unavailable (see `nativeNotificationSoundCapabilities`).
//   * The cross-tab `window.addEventListener('storage', …)` listener in
//     `subscribe` is resolved via `getStorageEventTarget()` — attached when a
//     global event target exists (react-native-web), folded into the existing
//     module `listeners` set otherwise. Same-process subscribers are always
//     notified via that set (driven by `setNotificationSoundPrefs`), exactly as
//     on web; cross-surface fan-out via the `storage` event is web-only.
//   * The WebAudio `AudioContext` / `OscillatorType` types are unavailable
//     because the native tsconfig omits the DOM lib, so minimal structural
//     interfaces (`AudioContextLike`, `OscillatorNodeLike`, `GainNodeLike`,
//     `OscillatorWaveType`) are declared locally and the constructor is probed
//     off `globalThis` (`AudioContext ?? webkitAudioContext`). When no
//     constructor resolves — a pure native runtime — `playNotificationSound`
//     returns the same `{ played: false, reason: 'no_audio_context' }` the web
//     source already produces in a non-browser environment. It never throws and
//     never rejects.
//
// No DOM elements, Recharts, Leaflet, react-router-dom, or web UI components are
// imported; the only runtime dependency is react's `useSyncExternalStore`, which
// runs identically under Hermes.

import {useSyncExternalStore} from 'react';

/**
 * Per-channel notification audio.
 *
 * Stores user preferences in localStorage (no backend AppSettings field
 * needed) and provides a tiny WebAudio-based player that procedurally
 * synthesises a short cue per category. We deliberately avoid bundling
 * .mp3/.wav assets so the app stays offline-friendly and adds no binary
 * weight; tone profiles are designed to be short (<450 ms) and tonal.
 *
 * Channels are independent of the OS-level browser notification gate in
 * `useNotificationListener` — sounds may fire while the tab is visible
 * (the toast is the visual; the cue is the auditory affordance).
 *
 * Achievement audio remains owned by `AchievementUnlockListener` /
 * `useAchievementCelebrationPrefs` — the `achievement` category here is
 * exposed for parity in the settings UI and as a hook for future
 * non-toast achievement triggers; it does not duplicate the existing
 * unlock chime.
 *
 * Native parity: the persistence and WebAudio layers degrade to native-safe
 * equivalents on a pure native runtime — see the file header and
 * {@link nativeNotificationSoundCapabilities}.
 */

export const NOTIFICATION_SOUND_CATEGORIES = [
  'critical_alert',
  'warning_alert',
  'info_alert',
  'charge_complete',
  'drive_complete',
  'automation_run',
  'achievement',
] as const;

export type NotificationSoundCategory =
  (typeof NOTIFICATION_SOUND_CATEGORIES)[number];

export interface NotificationSoundPrefs {
  /** Overall sound on/off. When false, every category is muted. */
  master: boolean;
  /** Per-category audio gate. */
  perCategory: Record<NotificationSoundCategory, boolean>;
  /** Output volume in [0, 1]. */
  volume: number;
}

export const DEFAULT_NOTIFICATION_SOUND_PREFS: NotificationSoundPrefs = {
  master: false,
  perCategory: {
    critical_alert: true,
    warning_alert: true,
    info_alert: false,
    charge_complete: true,
    drive_complete: false,
    automation_run: false,
    achievement: false,
  },
  volume: 0.6,
};

const STORAGE_KEY = 'teslasync:notification-sound-prefs:v1';

export function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function isCategoryKey(k: string): k is NotificationSoundCategory {
  return (NOTIFICATION_SOUND_CATEGORIES as readonly string[]).includes(k);
}

function normalizePerCategory(
  raw: unknown,
): NotificationSoundPrefs['perCategory'] {
  const out: NotificationSoundPrefs['perCategory'] = {
    ...DEFAULT_NOTIFICATION_SOUND_PREFS.perCategory,
  };
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (isCategoryKey(k) && typeof v === 'boolean') {
        out[k] = v;
      }
    }
  }
  return out;
}

function normalizePrefs(raw: unknown): NotificationSoundPrefs {
  if (!raw || typeof raw !== 'object') return DEFAULT_NOTIFICATION_SOUND_PREFS;
  const r = raw as Partial<NotificationSoundPrefs>;
  return {
    master:
      typeof r.master === 'boolean'
        ? r.master
        : DEFAULT_NOTIFICATION_SOUND_PREFS.master,
    perCategory: normalizePerCategory(r.perCategory),
    volume:
      typeof r.volume === 'number'
        ? clamp(r.volume, 0, 1)
        : DEFAULT_NOTIFICATION_SOUND_PREFS.volume,
  };
}

// ── Native-safe persistence ───────────────────────────────────────────
// react-native-web exposes the real `localStorage`; a pure native runtime
// does not. We probe `globalThis` for it (the AIVoiceMode / useOnboardingSkip
// precedent) and treat its absence exactly like the web source's
// `typeof localStorage === 'undefined'` guard — reads return defaults and
// writes are skipped while `cachedPrefs` still tracks in-process updates.

interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getWebStorage(): WebStorageLike | undefined {
  const candidate = (globalThis as typeof globalThis & {localStorage?: unknown})
    .localStorage;
  if (candidate == null || typeof candidate !== 'object') return undefined;
  const storage = candidate as Partial<WebStorageLike>;
  if (
    typeof storage.getItem === 'function' &&
    typeof storage.setItem === 'function'
  ) {
    return storage as WebStorageLike;
  }
  return undefined;
}

function readPrefs(): NotificationSoundPrefs {
  const store = getWebStorage();
  if (!store) return DEFAULT_NOTIFICATION_SOUND_PREFS;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_NOTIFICATION_SOUND_PREFS;
    return normalizePrefs(JSON.parse(raw));
  } catch {
    return DEFAULT_NOTIFICATION_SOUND_PREFS;
  }
}

// Stable cache so useSyncExternalStore returns referentially-equal snapshots
// when nothing has changed (otherwise React 18 raises an infinite-render).
let cachedPrefs: NotificationSoundPrefs = readPrefs();
let cachedSerialized = JSON.stringify(cachedPrefs);

function getSnapshot(): NotificationSoundPrefs {
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

// ── Native-safe cross-surface storage event ──────────────────────────
// Stand-in for `window.addEventListener('storage', …)`. The web listener wakes
// OTHER tabs when localStorage changes; React Native is a single process with
// no `storage` event, so it folds into the module `listeners` set below. When a
// global event target exists (react-native-web) we still attach to it so the
// cross-surface path is preserved verbatim.

interface StorageEventLike {
  key: string | null;
}

interface StorageEventTargetLike {
  addEventListener(
    type: 'storage',
    listener: (event: StorageEventLike) => void,
  ): void;
  removeEventListener(
    type: 'storage',
    listener: (event: StorageEventLike) => void,
  ): void;
}

function getStorageEventTarget(): StorageEventTargetLike | undefined {
  const scope = globalThis as typeof globalThis & {
    addEventListener?: unknown;
    removeEventListener?: unknown;
  };
  if (
    typeof scope.addEventListener === 'function' &&
    typeof scope.removeEventListener === 'function'
  ) {
    return scope as unknown as StorageEventTargetLike;
  }
  return undefined;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const target = getStorageEventTarget();
  const onStorage = (e: StorageEventLike) => {
    if (e.key !== STORAGE_KEY) return;
    refreshSnapshot();
    cb();
  };
  if (target) {
    target.addEventListener('storage', onStorage);
  }
  return () => {
    listeners.delete(cb);
    if (target) {
      target.removeEventListener('storage', onStorage);
    }
  };
}

export function useNotificationSoundPrefs(): NotificationSoundPrefs {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Synchronous accessor — useful inside SSE event callbacks where hooks can't run. */
export function getNotificationSoundPrefs(): NotificationSoundPrefs {
  return cachedPrefs;
}

/**
 * Imperatively patch sound prefs. Triggers a re-render in every mounted
 * `useNotificationSoundPrefs()` (current tab + other tabs via the
 * `storage` event). Pass partial updates — unspecified keys retain
 * their current value. `perCategory` merges shallowly.
 */
export interface NotificationSoundPrefsPatch {
  master?: boolean;
  volume?: number;
  perCategory?: Partial<NotificationSoundPrefs['perCategory']>;
}

export function setNotificationSoundPrefs(
  patch: NotificationSoundPrefsPatch,
): void {
  const nextPerCategory = patch.perCategory
    ? {...cachedPrefs.perCategory, ...patch.perCategory}
    : cachedPrefs.perCategory;
  const next: NotificationSoundPrefs = {
    master:
      typeof patch.master === 'boolean' ? patch.master : cachedPrefs.master,
    perCategory: nextPerCategory,
    volume:
      typeof patch.volume === 'number'
        ? clamp(patch.volume, 0, 1)
        : cachedPrefs.volume,
  };
  const serialized = JSON.stringify(next);
  if (serialized === cachedSerialized) return;
  const store = getWebStorage();
  if (store) {
    try {
      store.setItem(STORAGE_KEY, serialized);
    } catch {
      // Quota / private mode — fall through to in-memory update so the
      // current tab still reflects the toggle.
    }
  }
  cachedPrefs = next;
  cachedSerialized = serialized;
  for (const cb of listeners) cb();
}

// ── Severity → category mapping ───────────────────────────────────────

/**
 * Loose shape covering the SSE `alert` payload, web-push payload, and
 * generic notification objects we may want to map to a sound channel.
 * Both backend severity spellings ('warn' and 'warning') are accepted.
 */
export interface NotificationCategoryInput {
  type?: string | null;
  kind?: string | null;
  category?: string | null;
  severity?: string | null;
}

export function mapNotificationToCategory(
  input: NotificationCategoryInput | null | undefined,
): NotificationSoundCategory | null {
  if (!input) return null;

  const explicit = (input.category ?? '').toLowerCase().trim();
  if (isCategoryKey(explicit)) return explicit;

  const kind = (input.kind ?? input.type ?? '').toLowerCase().trim();
  switch (kind) {
    case 'charge_complete':
    case 'charging_complete':
      return 'charge_complete';
    case 'drive_complete':
    case 'drive_end':
    case 'trip_complete':
      return 'drive_complete';
    case 'automation_run':
    case 'automation':
      return 'automation_run';
    case 'achievement':
    case 'achievement_unlocked':
      return 'achievement';
  }

  const severity = (input.severity ?? '').toLowerCase().trim();
  if (severity === 'critical' || severity === 'crit') return 'critical_alert';
  if (severity === 'warn' || severity === 'warning') return 'warning_alert';
  if (severity === 'info' || severity === 'notice') return 'info_alert';

  // Bare alert event with no severity → treat as informational. We
  // require an explicit `alert` kind so that an entirely-empty input
  // (no kind, no severity, no category) maps to null rather than
  // accidentally triggering the info cue.
  if (kind === 'alert') return 'info_alert';
  return null;
}

// ── WebAudio player ───────────────────────────────────────────────────
// The native tsconfig omits the DOM lib, so the browser `AudioContext` /
// `OscillatorType` types are unavailable. We declare the minimal structural
// surface the player actually touches and probe the constructor off
// `globalThis`; on a pure native runtime no constructor resolves and the
// player no-ops with a structured reason (never throws).

type OscillatorWaveType =
  | 'sine'
  | 'square'
  | 'sawtooth'
  | 'triangle'
  | 'custom';

interface AudioNodeLike {
  connect(destination: AudioNodeLike): void;
}

interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, startTime: number): void;
  exponentialRampToValueAtTime(value: number, endTime: number): void;
}

interface OscillatorNodeLike extends AudioNodeLike {
  type: OscillatorWaveType;
  frequency: {value: number};
  start(when: number): void;
  stop(when: number): void;
}

interface GainNodeLike extends AudioNodeLike {
  gain: AudioParamLike;
}

interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: AudioNodeLike;
  createOscillator(): OscillatorNodeLike;
  createGain(): GainNodeLike;
}

type AudioContextCtor = new () => AudioContextLike;

interface ToneProfile {
  /** Sequence of (frequency, startOffsetSec) pairs. */
  notes: Array<{freq: number; offset: number; duration?: number}>;
  /** Oscillator type. */
  wave: OscillatorWaveType;
  /** Peak gain before the user volume multiplier (0..1). */
  peakGain: number;
}

const TONE_PROFILES: Record<NotificationSoundCategory, ToneProfile> = {
  // Urgent two-note descending fall (B5 → E5) with a square wave for
  // attention.
  critical_alert: {
    wave: 'square',
    peakGain: 0.22,
    notes: [
      {freq: 987.77, offset: 0},
      {freq: 659.25, offset: 0.18},
    ],
  },
  // Two equal mid-pitch beeps (A5 + A5) — recognisable but not panic-inducing.
  warning_alert: {
    wave: 'triangle',
    peakGain: 0.18,
    notes: [
      {freq: 880, offset: 0},
      {freq: 880, offset: 0.18},
    ],
  },
  // Single soft G5 chime.
  info_alert: {
    wave: 'sine',
    peakGain: 0.14,
    notes: [{freq: 783.99, offset: 0, duration: 0.4}],
  },
  // Rising perfect fifth (C5 → G5) — "task done" affordance.
  charge_complete: {
    wave: 'triangle',
    peakGain: 0.18,
    notes: [
      {freq: 523.25, offset: 0},
      {freq: 783.99, offset: 0.14},
    ],
  },
  // Two-tone "trip ended" (E5 → C5).
  drive_complete: {
    wave: 'triangle',
    peakGain: 0.16,
    notes: [
      {freq: 659.25, offset: 0},
      {freq: 523.25, offset: 0.16},
    ],
  },
  // Subtle single sine blip (D5).
  automation_run: {
    wave: 'sine',
    peakGain: 0.1,
    notes: [{freq: 587.33, offset: 0, duration: 0.25}],
  },
  // Major triad arpeggio (C5 → E5 → G5).
  achievement: {
    wave: 'triangle',
    peakGain: 0.18,
    notes: [
      {freq: 523.25, offset: 0},
      {freq: 659.25, offset: 0.1},
      {freq: 783.99, offset: 0.2},
    ],
  },
};

/**
 * Cached AudioContext — lazily created on first successful `play` and
 * shared across categories so we don't allocate one per cue.
 */
let cachedCtx: AudioContextLike | null = null;

/** Test-only reset hook. Drops the cached AudioContext. */
export function __resetNotificationSoundForTests(): void {
  cachedCtx = null;
}

/** Test-only inspector. */
export function __getCachedAudioContextForTests(): AudioContextLike | null {
  return cachedCtx;
}

function resolveAudioContextCtor(): AudioContextCtor | null {
  const scope = globalThis as typeof globalThis & {
    AudioContext?: unknown;
    webkitAudioContext?: unknown;
  };
  const ctor = scope.AudioContext ?? scope.webkitAudioContext;
  return typeof ctor === 'function'
    ? (ctor as unknown as AudioContextCtor)
    : null;
}

/**
 * Explicit capability matrix for the native notification-sound surface.
 *
 * Each flag describes a *pure native runtime*. The react-native-web target may
 * light the corresponding browser API up at runtime (real `localStorage`, a
 * global `storage` event, a real `AudioContext`), in which case the
 * `getWebStorage` / `getStorageEventTarget` / `resolveAudioContextCtor` probes
 * transparently use it. On a pure native runtime these remain unavailable and
 * the module degrades to in-memory prefs + a silent (structured-reason) player.
 */
export const nativeNotificationSoundCapabilities = {
  /** Durable cross-restart pref persistence (localStorage) — web-only. */
  durablePrefsPersistenceAvailable: false,
  /** Cross-surface `storage` event fan-out — web-only. */
  crossTabStorageEventAvailable: false,
  /** Procedural WebAudio cue playback (`AudioContext`) — web-only. */
  webAudioPlaybackAvailable: false,
} as const;

export interface PlayResult {
  played: boolean;
  reason?:
    | 'master_off'
    | 'category_off'
    | 'unknown_category'
    | 'no_audio_context'
    | 'volume_zero'
    | 'play_failed';
}

/**
 * Play the cue for `category` if both master and per-category prefs
 * allow it. Silently no-ops (returning a structured reason) when audio
 * is unavailable or pref-disabled — never throws, never rejects.
 *
 * Native parity: on a pure native runtime no `AudioContext` constructor
 * resolves, so this returns `{ played: false, reason: 'no_audio_context' }`
 * — identical to the web source's non-browser behaviour.
 */
export function playNotificationSound(
  category: NotificationSoundCategory,
  prefs: NotificationSoundPrefs = cachedPrefs,
): PlayResult {
  if (!prefs.master) return {played: false, reason: 'master_off'};
  if (!prefs.perCategory[category]) {
    return {played: false, reason: 'category_off'};
  }
  const profile = TONE_PROFILES[category];
  if (!profile) return {played: false, reason: 'unknown_category'};

  const volume = clamp(prefs.volume, 0, 1);
  if (volume <= 0) return {played: false, reason: 'volume_zero'};

  const Ctor = resolveAudioContextCtor();
  if (!Ctor) return {played: false, reason: 'no_audio_context'};

  try {
    if (!cachedCtx) cachedCtx = new Ctor();
    const ctx = cachedCtx;
    const now = ctx.currentTime;
    const peak = profile.peakGain * volume;
    const tail = 0.45;
    for (const note of profile.notes) {
      const start = now + note.offset;
      const dur = note.duration ?? tail;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = profile.wave;
      osc.frequency.value = note.freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(
        Math.max(peak, 0.0002),
        start + 0.02,
      );
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur + 0.05);
    }
    return {played: true};
  } catch {
    return {played: false, reason: 'play_failed'};
  }
}

/**
 * Convenience wrapper: map an event payload to a category and play.
 * Returns the category that was attempted (or null if no mapping).
 */
export function playForNotification(
  input: NotificationCategoryInput | null | undefined,
  prefs: NotificationSoundPrefs = cachedPrefs,
): NotificationSoundCategory | null {
  const category = mapNotificationToCategory(input);
  if (!category) return null;
  playNotificationSound(category, prefs);
  return category;
}
