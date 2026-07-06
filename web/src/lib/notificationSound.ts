import { useSyncExternalStore } from 'react'

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
 */

export const NOTIFICATION_SOUND_CATEGORIES = [
  'critical_alert',
  'warning_alert',
  'info_alert',
  'charge_complete',
  'drive_complete',
  'automation_run',
  'achievement',
] as const

export type NotificationSoundCategory = (typeof NOTIFICATION_SOUND_CATEGORIES)[number]

export interface NotificationSoundPrefs {
  /** Overall sound on/off. When false, every category is muted. */
  master: boolean
  /** Per-category audio gate. */
  perCategory: Record<NotificationSoundCategory, boolean>
  /** Output volume in [0, 1]. */
  volume: number
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
}

const STORAGE_KEY = 'teslasync:notification-sound-prefs:v1'

export function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min
  if (n < min) return min
  if (n > max) return max
  return n
}

function isCategoryKey(k: string): k is NotificationSoundCategory {
  return (NOTIFICATION_SOUND_CATEGORIES as readonly string[]).includes(k)
}

function normalizePerCategory(
  raw: unknown,
): NotificationSoundPrefs['perCategory'] {
  const out: NotificationSoundPrefs['perCategory'] = {
    ...DEFAULT_NOTIFICATION_SOUND_PREFS.perCategory,
  }
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (isCategoryKey(k) && typeof v === 'boolean') {
        out[k] = v
      }
    }
  }
  return out
}

function normalizePrefs(raw: unknown): NotificationSoundPrefs {
  if (!raw || typeof raw !== 'object') return DEFAULT_NOTIFICATION_SOUND_PREFS
  const r = raw as Partial<NotificationSoundPrefs>
  return {
    master: typeof r.master === 'boolean' ? r.master : DEFAULT_NOTIFICATION_SOUND_PREFS.master,
    perCategory: normalizePerCategory(r.perCategory),
    volume:
      typeof r.volume === 'number'
        ? clamp(r.volume, 0, 1)
        : DEFAULT_NOTIFICATION_SOUND_PREFS.volume,
  }
}

function readPrefs(): NotificationSoundPrefs {
  if (typeof localStorage === 'undefined') return DEFAULT_NOTIFICATION_SOUND_PREFS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_NOTIFICATION_SOUND_PREFS
    return normalizePrefs(JSON.parse(raw))
  } catch {
    return DEFAULT_NOTIFICATION_SOUND_PREFS
  }
}

// Stable cache so useSyncExternalStore returns referentially-equal snapshots
// when nothing has changed (otherwise React 18 raises an infinite-render).
let cachedPrefs: NotificationSoundPrefs = readPrefs()
let cachedSerialized = JSON.stringify(cachedPrefs)

function getSnapshot(): NotificationSoundPrefs {
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
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage)
  }
  return () => {
    listeners.delete(cb)
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage)
    }
  }
}

export function useNotificationSoundPrefs(): NotificationSoundPrefs {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Synchronous accessor — useful inside SSE event callbacks where hooks can't run. */
export function getNotificationSoundPrefs(): NotificationSoundPrefs {
  return cachedPrefs
}

/**
 * Imperatively patch sound prefs. Triggers a re-render in every mounted
 * `useNotificationSoundPrefs()` (current tab + other tabs via the
 * `storage` event). Pass partial updates — unspecified keys retain
 * their current value. `perCategory` merges shallowly.
 */
export interface NotificationSoundPrefsPatch {
  master?: boolean
  volume?: number
  perCategory?: Partial<NotificationSoundPrefs['perCategory']>
}

export function setNotificationSoundPrefs(patch: NotificationSoundPrefsPatch): void {
  const nextPerCategory = patch.perCategory
    ? { ...cachedPrefs.perCategory, ...patch.perCategory }
    : cachedPrefs.perCategory
  const next: NotificationSoundPrefs = {
    master: typeof patch.master === 'boolean' ? patch.master : cachedPrefs.master,
    perCategory: nextPerCategory,
    volume:
      typeof patch.volume === 'number'
        ? clamp(patch.volume, 0, 1)
        : cachedPrefs.volume,
  }
  const serialized = JSON.stringify(next)
  if (serialized === cachedSerialized) return
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, serialized)
    } catch {
      // Quota / private mode — fall through to in-memory update so the
      // current tab still reflects the toggle.
    }
  }
  cachedPrefs = next
  cachedSerialized = serialized
  for (const cb of listeners) cb()
}

// ── Severity → category mapping ───────────────────────────────────────

/**
 * Loose shape covering the SSE `alert` payload, web-push payload, and
 * generic notification objects we may want to map to a sound channel.
 * Both backend severity spellings ('warn' and 'warning') are accepted.
 */
export interface NotificationCategoryInput {
  type?: string | null
  kind?: string | null
  category?: string | null
  severity?: string | null
}

export function mapNotificationToCategory(
  input: NotificationCategoryInput | null | undefined,
): NotificationSoundCategory | null {
  if (!input) return null

  const explicit = (input.category ?? '').toLowerCase().trim()
  if (isCategoryKey(explicit)) return explicit

  const kind = (input.kind ?? input.type ?? '').toLowerCase().trim()
  switch (kind) {
    case 'charge_complete':
    case 'charging_complete':
      return 'charge_complete'
    case 'drive_complete':
    case 'drive_end':
    case 'trip_complete':
      return 'drive_complete'
    case 'automation_run':
    case 'automation':
      return 'automation_run'
    case 'achievement':
    case 'achievement_unlocked':
      return 'achievement'
  }

  const severity = (input.severity ?? '').toLowerCase().trim()
  if (severity === 'critical' || severity === 'crit') return 'critical_alert'
  if (severity === 'warn' || severity === 'warning') return 'warning_alert'
  if (severity === 'info' || severity === 'notice') return 'info_alert'

  // Bare alert event with no severity → treat as informational. We
  // require an explicit `alert` kind so that an entirely-empty input
  // (no kind, no severity, no category) maps to null rather than
  // accidentally triggering the info cue.
  if (kind === 'alert') return 'info_alert'
  return null
}

// ── WebAudio player ───────────────────────────────────────────────────

interface ToneProfile {
  /** Sequence of (frequency, startOffsetSec) pairs. */
  notes: Array<{ freq: number; offset: number; duration?: number }>
  /** Oscillator type. */
  wave: OscillatorType
  /** Peak gain before the user volume multiplier (0..1). */
  peakGain: number
}

const TONE_PROFILES: Record<NotificationSoundCategory, ToneProfile> = {
  // Urgent two-note descending fall (B5 → E5) with a square wave for
  // attention.
  critical_alert: {
    wave: 'square',
    peakGain: 0.22,
    notes: [
      { freq: 987.77, offset: 0 },
      { freq: 659.25, offset: 0.18 },
    ],
  },
  // Two equal mid-pitch beeps (A5 + A5) — recognisable but not panic-inducing.
  warning_alert: {
    wave: 'triangle',
    peakGain: 0.18,
    notes: [
      { freq: 880, offset: 0 },
      { freq: 880, offset: 0.18 },
    ],
  },
  // Single soft G5 chime.
  info_alert: {
    wave: 'sine',
    peakGain: 0.14,
    notes: [{ freq: 783.99, offset: 0, duration: 0.4 }],
  },
  // Rising perfect fifth (C5 → G5) — "task done" affordance.
  charge_complete: {
    wave: 'triangle',
    peakGain: 0.18,
    notes: [
      { freq: 523.25, offset: 0 },
      { freq: 783.99, offset: 0.14 },
    ],
  },
  // Two-tone "trip ended" (E5 → C5).
  drive_complete: {
    wave: 'triangle',
    peakGain: 0.16,
    notes: [
      { freq: 659.25, offset: 0 },
      { freq: 523.25, offset: 0.16 },
    ],
  },
  // Subtle single sine blip (D5).
  automation_run: {
    wave: 'sine',
    peakGain: 0.1,
    notes: [{ freq: 587.33, offset: 0, duration: 0.25 }],
  },
  // Major triad arpeggio (C5 → E5 → G5).
  achievement: {
    wave: 'triangle',
    peakGain: 0.18,
    notes: [
      { freq: 523.25, offset: 0 },
      { freq: 659.25, offset: 0.1 },
      { freq: 783.99, offset: 0.2 },
    ],
  },
}

type WindowWithLegacyAudio = typeof window & {
  webkitAudioContext?: typeof AudioContext
}

/**
 * Cached AudioContext — lazily created on first successful `play` and
 * shared across categories so we don't allocate one per cue.
 */
let cachedCtx: AudioContext | null = null

/** Test-only reset hook. Drops the cached AudioContext. */
export function __resetNotificationSoundForTests(): void {
  cachedCtx = null
}

/** Test-only inspector. */
export function __getCachedAudioContextForTests(): AudioContext | null {
  return cachedCtx
}

function resolveAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null
  const w = window as WindowWithLegacyAudio
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

/**
 * Create (and, when possible, resume) the shared AudioContext *without*
 * emitting any sound.
 *
 * Browsers only allow an AudioContext to start from inside a user gesture
 * (click / tap / keypress). Call this from a real gesture handler — e.g. the
 * moment the user enables notification sounds — so a later, non-gesture
 * SSE-driven cue can play instead of being silently blocked by the autoplay
 * policy. Warming up by calling `playNotificationSound` at volume 0 does *not*
 * work: it short-circuits on the zero-volume guard before the context is ever
 * constructed.
 *
 * Safe to call repeatedly (the context is cached) and never throws.
 *
 * @returns true when a live AudioContext is available afterwards.
 */
export function primeNotificationAudio(): boolean {
  const Ctor = resolveAudioContextCtor()
  if (!Ctor) return false
  try {
    const ctx = cachedCtx ?? new Ctor()
    cachedCtx = ctx
    // A context constructed outside a gesture (or after the tab was
    // backgrounded) can start 'suspended'; resume it while we still hold the
    // user gesture so the next cue is audible.
    if (ctx.state === 'suspended') {
      void ctx.resume()
    }
    return true
  } catch {
    cachedCtx = null
    return false
  }
}

export interface PlayResult {
  played: boolean
  reason?:
    | 'master_off'
    | 'category_off'
    | 'unknown_category'
    | 'no_audio_context'
    | 'volume_zero'
    | 'play_failed'
}

/**
 * Play the cue for `category` if both master and per-category prefs
 * allow it. Silently no-ops (returning a structured reason) when audio
 * is unavailable or pref-disabled — never throws, never rejects.
 */
export function playNotificationSound(
  category: NotificationSoundCategory,
  prefs: NotificationSoundPrefs = cachedPrefs,
): PlayResult {
  if (!prefs.master) return { played: false, reason: 'master_off' }
  if (!prefs.perCategory[category]) {
    return { played: false, reason: 'category_off' }
  }
  const profile = TONE_PROFILES[category]
  if (!profile) return { played: false, reason: 'unknown_category' }

  const volume = clamp(prefs.volume, 0, 1)
  if (volume <= 0) return { played: false, reason: 'volume_zero' }

  const Ctor = resolveAudioContextCtor()
  if (!Ctor) return { played: false, reason: 'no_audio_context' }

  try {
    if (!cachedCtx) cachedCtx = new Ctor()
    const ctx = cachedCtx
    const now = ctx.currentTime
    const peak = profile.peakGain * volume
    const tail = 0.45
    for (const note of profile.notes) {
      const start = now + note.offset
      const dur = note.duration ?? tail
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = profile.wave
      osc.frequency.value = note.freq
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(start)
      osc.stop(start + dur + 0.05)
    }
    return { played: true }
  } catch {
    return { played: false, reason: 'play_failed' }
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
  const category = mapNotificationToCategory(input)
  if (!category) return null
  playNotificationSound(category, prefs)
  return category
}
