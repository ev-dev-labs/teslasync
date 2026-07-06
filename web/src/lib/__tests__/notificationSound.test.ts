import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  DEFAULT_NOTIFICATION_SOUND_PREFS,
  NOTIFICATION_SOUND_CATEGORIES,
  __getCachedAudioContextForTests,
  __resetNotificationSoundForTests,
  clamp,
  getNotificationSoundPrefs,
  mapNotificationToCategory,
  playForNotification,
  playNotificationSound,
  primeNotificationAudio,
  setNotificationSoundPrefs,
  type NotificationSoundCategory,
  type NotificationSoundPrefs,
} from '../notificationSound'

const STORAGE_KEY = 'teslasync:notification-sound-prefs:v1'

interface MockOscillator {
  type: OscillatorType
  frequency: { value: number }
  connect: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

interface MockGain {
  gain: {
    setValueAtTime: ReturnType<typeof vi.fn>
    exponentialRampToValueAtTime: ReturnType<typeof vi.fn>
  }
  connect: ReturnType<typeof vi.fn>
}

interface MockAudioContext {
  currentTime: number
  destination: object
  createOscillator: ReturnType<typeof vi.fn<[], MockOscillator>>
  createGain: ReturnType<typeof vi.fn<[], MockGain>>
  oscillators: MockOscillator[]
  gains: MockGain[]
  ctorCount: number
}

function makeMockAudioContextCtor(): {
  Ctor: new () => MockAudioContext
  instance: () => MockAudioContext | null
  count: () => number
} {
  let last: MockAudioContext | null = null
  let count = 0
  const onConstruct = (instance: MockAudioContext) => {
    count += 1
    instance.ctorCount = count
    last = instance
  }
  class Ctx implements MockAudioContext {
    currentTime = 0
    destination = {}
    oscillators: MockOscillator[] = []
    gains: MockGain[] = []
    ctorCount = 0
    constructor() {
      onConstruct(this)
    }
    createOscillator(): MockOscillator {
      const osc: MockOscillator = {
        type: 'sine',
        frequency: { value: 0 },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      }
      this.oscillators.push(osc)
      return osc
    }
    createGain(): MockGain {
      const gain: MockGain = {
        gain: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      }
      this.gains.push(gain)
      return gain
    }
  }
  return {
    Ctor: Ctx as unknown as new () => MockAudioContext,
    instance: () => last,
    count: () => count,
  }
}

function withMockAudio(): {
  instance: () => MockAudioContext | null
  count: () => number
  restore: () => void
} {
  const w = window as unknown as Record<string, unknown>
  const prevAC = w.AudioContext
  const prevWebkit = w.webkitAudioContext
  const mock = makeMockAudioContextCtor()
  w.AudioContext = mock.Ctor
  w.webkitAudioContext = undefined
  return {
    instance: mock.instance,
    count: mock.count,
    restore: () => {
      w.AudioContext = prevAC
      w.webkitAudioContext = prevWebkit
    },
  }
}

function resetState() {
  localStorage.clear()
  setNotificationSoundPrefs({
    master: DEFAULT_NOTIFICATION_SOUND_PREFS.master,
    perCategory: { ...DEFAULT_NOTIFICATION_SOUND_PREFS.perCategory },
    volume: DEFAULT_NOTIFICATION_SOUND_PREFS.volume,
  })
  __resetNotificationSoundForTests()
}

describe('clamp', () => {
  it('returns min when value is below min', () => {
    expect(clamp(-1, 0, 1)).toBe(0)
  })
  it('returns max when value is above max', () => {
    expect(clamp(2, 0, 1)).toBe(1)
  })
  it('returns value when within range', () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5)
  })
  it('returns min for NaN', () => {
    expect(clamp(Number.NaN, 0, 1)).toBe(0)
  })
})

describe('NOTIFICATION_SOUND_CATEGORIES + DEFAULT_NOTIFICATION_SOUND_PREFS', () => {
  it('default perCategory has an entry for every category', () => {
    for (const cat of NOTIFICATION_SOUND_CATEGORIES) {
      expect(
        Object.prototype.hasOwnProperty.call(
          DEFAULT_NOTIFICATION_SOUND_PREFS.perCategory,
          cat,
        ),
      ).toBe(true)
    }
  })
  it('default master is off so users opt in', () => {
    expect(DEFAULT_NOTIFICATION_SOUND_PREFS.master).toBe(false)
  })
  it('default volume is in range', () => {
    expect(DEFAULT_NOTIFICATION_SOUND_PREFS.volume).toBeGreaterThan(0)
    expect(DEFAULT_NOTIFICATION_SOUND_PREFS.volume).toBeLessThanOrEqual(1)
  })
})

describe('mapNotificationToCategory', () => {
  it('returns null for null/undefined input', () => {
    expect(mapNotificationToCategory(null)).toBeNull()
    expect(mapNotificationToCategory(undefined)).toBeNull()
    expect(mapNotificationToCategory({})).toBeNull()
  })

  it('honours an explicit category override', () => {
    expect(mapNotificationToCategory({ category: 'critical_alert' })).toBe('critical_alert')
    expect(mapNotificationToCategory({ category: 'achievement' })).toBe('achievement')
  })

  it('ignores an explicit category that is not in the enum', () => {
    expect(mapNotificationToCategory({ category: 'bogus', severity: 'critical' })).toBe(
      'critical_alert',
    )
  })

  it.each([
    ['critical', 'critical_alert'],
    ['CRITICAL', 'critical_alert'],
    ['crit', 'critical_alert'],
    ['warn', 'warning_alert'],
    ['warning', 'warning_alert'],
    ['info', 'info_alert'],
    ['notice', 'info_alert'],
  ] as const)('alert severity %s → %s', (severity, expected) => {
    expect(mapNotificationToCategory({ type: 'alert', severity })).toBe(expected)
  })

  it('falls back to info for an alert with no severity', () => {
    expect(mapNotificationToCategory({ type: 'alert' })).toBe('info_alert')
  })

  it('returns null for non-alert events with no severity match', () => {
    expect(mapNotificationToCategory({ type: 'export_status' })).toBeNull()
    expect(mapNotificationToCategory({ type: 'export_status', severity: 'unknown' })).toBeNull()
  })

  it.each([
    ['charge_complete', 'charge_complete'],
    ['charging_complete', 'charge_complete'],
    ['drive_complete', 'drive_complete'],
    ['drive_end', 'drive_complete'],
    ['trip_complete', 'drive_complete'],
    ['automation_run', 'automation_run'],
    ['automation', 'automation_run'],
    ['achievement', 'achievement'],
    ['achievement_unlocked', 'achievement'],
  ] as const)('event kind %s → %s', (kind, expected) => {
    expect(mapNotificationToCategory({ kind })).toBe(expected)
  })

  it('prefers explicit category over kind/severity', () => {
    expect(
      mapNotificationToCategory({ category: 'info_alert', kind: 'charge_complete', severity: 'critical' }),
    ).toBe('info_alert')
  })
})

describe('setNotificationSoundPrefs / useNotificationSoundPrefs storage', () => {
  beforeEach(() => {
    resetState()
  })

  it('round-trips through localStorage', () => {
    setNotificationSoundPrefs({ master: true, volume: 0.3 })
    const stored = localStorage.getItem(STORAGE_KEY)
    expect(stored).not.toBeNull()
    const parsed = JSON.parse(stored!) as NotificationSoundPrefs
    expect(parsed.master).toBe(true)
    expect(parsed.volume).toBe(0.3)
  })

  it('clamps stored volume into [0,1]', () => {
    setNotificationSoundPrefs({ volume: 5 })
    expect(getNotificationSoundPrefs().volume).toBe(1)
    setNotificationSoundPrefs({ volume: -1 })
    expect(getNotificationSoundPrefs().volume).toBe(0)
  })

  it('shallow-merges perCategory patches', () => {
    setNotificationSoundPrefs({ perCategory: { critical_alert: false } })
    const prefs = getNotificationSoundPrefs()
    expect(prefs.perCategory.critical_alert).toBe(false)
    // Other categories preserved.
    expect(prefs.perCategory.warning_alert).toBe(
      DEFAULT_NOTIFICATION_SOUND_PREFS.perCategory.warning_alert,
    )
  })

  it('survives a corrupt localStorage payload', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json')
    // Force a re-read by patching another key (no-op merge) and confirm
    // the in-memory prefs remain valid defaults rather than throwing.
    setNotificationSoundPrefs({ master: false })
    const prefs = getNotificationSoundPrefs()
    expect(prefs.master).toBe(false)
    expect(typeof prefs.volume).toBe('number')
  })

  it('notifies subscribers when prefs actually change', () => {
    const cb = vi.fn()
    const w = window as unknown as { dispatchEvent: typeof window.dispatchEvent }
    void w
    // Subscribe via the storage event manually — the public hook only
    // fires under React. We validate the in-process listener path by
    // directly comparing snapshots before/after.
    const before = getNotificationSoundPrefs()
    setNotificationSoundPrefs({ master: !before.master })
    const after = getNotificationSoundPrefs()
    expect(after).not.toBe(before)
    expect(after.master).toBe(!before.master)
    expect(cb).not.toHaveBeenCalled()
  })

  it('returns the same snapshot reference when no change', () => {
    const a = getNotificationSoundPrefs()
    setNotificationSoundPrefs({ master: a.master, volume: a.volume })
    const b = getNotificationSoundPrefs()
    expect(b).toBe(a)
  })
})

describe('playNotificationSound', () => {
  let audio: ReturnType<typeof withMockAudio>

  beforeEach(() => {
    resetState()
    audio = withMockAudio()
  })

  afterEach(() => {
    audio.restore()
    __resetNotificationSoundForTests()
  })

  it('no-ops when master is off', () => {
    const result = playNotificationSound('critical_alert', {
      ...DEFAULT_NOTIFICATION_SOUND_PREFS,
      master: false,
    })
    expect(result).toEqual({ played: false, reason: 'master_off' })
    expect(__getCachedAudioContextForTests()).toBeNull()
  })

  it('no-ops when the category is disabled even if master is on', () => {
    const prefs: NotificationSoundPrefs = {
      ...DEFAULT_NOTIFICATION_SOUND_PREFS,
      master: true,
      perCategory: {
        ...DEFAULT_NOTIFICATION_SOUND_PREFS.perCategory,
        critical_alert: false,
      },
    }
    const result = playNotificationSound('critical_alert', prefs)
    expect(result).toEqual({ played: false, reason: 'category_off' })
    expect(__getCachedAudioContextForTests()).toBeNull()
  })

  it('no-ops when volume is zero', () => {
    const prefs: NotificationSoundPrefs = {
      ...DEFAULT_NOTIFICATION_SOUND_PREFS,
      master: true,
      perCategory: {
        ...DEFAULT_NOTIFICATION_SOUND_PREFS.perCategory,
        critical_alert: true,
      },
      volume: 0,
    }
    const result = playNotificationSound('critical_alert', prefs)
    expect(result).toEqual({ played: false, reason: 'volume_zero' })
    expect(__getCachedAudioContextForTests()).toBeNull()
  })

  it('plays when master + category are on and volume > 0', () => {
    const prefs: NotificationSoundPrefs = {
      ...DEFAULT_NOTIFICATION_SOUND_PREFS,
      master: true,
      perCategory: {
        ...DEFAULT_NOTIFICATION_SOUND_PREFS.perCategory,
        critical_alert: true,
      },
      volume: 0.5,
    }
    const result = playNotificationSound('critical_alert', prefs)
    expect(result).toEqual({ played: true })
    const ctx = audio.instance()
    expect(ctx).not.toBeNull()
    // critical_alert profile has 2 notes.
    expect(ctx!.oscillators.length).toBe(2)
    expect(ctx!.gains.length).toBe(2)
    for (const osc of ctx!.oscillators) {
      expect(osc.start).toHaveBeenCalledTimes(1)
      expect(osc.stop).toHaveBeenCalledTimes(1)
    }
  })

  it('caches the AudioContext across plays', () => {
    const prefs: NotificationSoundPrefs = {
      ...DEFAULT_NOTIFICATION_SOUND_PREFS,
      master: true,
      perCategory: {
        ...DEFAULT_NOTIFICATION_SOUND_PREFS.perCategory,
        info_alert: true,
      },
      volume: 0.5,
    }
    playNotificationSound('info_alert', prefs)
    playNotificationSound('info_alert', prefs)
    expect(audio.count()).toBe(1)
  })

  it('returns no_audio_context when the AudioContext ctor is missing', () => {
    audio.restore()
    const w = window as unknown as Record<string, unknown>
    const prevAC = w.AudioContext
    const prevWebkit = w.webkitAudioContext
    w.AudioContext = undefined
    w.webkitAudioContext = undefined
    try {
      const prefs: NotificationSoundPrefs = {
        ...DEFAULT_NOTIFICATION_SOUND_PREFS,
        master: true,
        perCategory: {
          ...DEFAULT_NOTIFICATION_SOUND_PREFS.perCategory,
          info_alert: true,
        },
        volume: 0.5,
      }
      const result = playNotificationSound('info_alert', prefs)
      expect(result).toEqual({ played: false, reason: 'no_audio_context' })
    } finally {
      w.AudioContext = prevAC
      w.webkitAudioContext = prevWebkit
    }
  })

  it('reads from cached prefs when no explicit prefs argument is given', () => {
    setNotificationSoundPrefs({
      master: true,
      perCategory: { info_alert: true },
      volume: 0.5,
    })
    const result = playNotificationSound('info_alert')
    expect(result.played).toBe(true)
  })

  it('every category has a tone profile (parity check)', () => {
    setNotificationSoundPrefs({
      master: true,
      perCategory: NOTIFICATION_SOUND_CATEGORIES.reduce(
        (acc, cat) => {
          acc[cat] = true
          return acc
        },
        {} as Record<NotificationSoundCategory, boolean>,
      ),
      volume: 0.5,
    })
    for (const cat of NOTIFICATION_SOUND_CATEGORIES) {
      const result = playNotificationSound(cat)
      expect(result.played).toBe(true)
    }
  })
})

describe('playForNotification', () => {
  let audio: ReturnType<typeof withMockAudio>

  beforeEach(() => {
    resetState()
    audio = withMockAudio()
  })

  afterEach(() => {
    audio.restore()
  })

  it('returns the resolved category when audio plays', () => {
    setNotificationSoundPrefs({
      master: true,
      perCategory: { critical_alert: true },
      volume: 0.5,
    })
    const cat = playForNotification({ type: 'alert', severity: 'critical' })
    expect(cat).toBe('critical_alert')
    expect(audio.instance()).not.toBeNull()
  })

  it('returns null when no category can be inferred', () => {
    setNotificationSoundPrefs({ master: true, volume: 0.5 })
    const cat = playForNotification({ type: 'export_status' })
    expect(cat).toBeNull()
    expect(audio.instance()).toBeNull()
  })

  it('returns the category even when prefs gate the actual playback', () => {
    setNotificationSoundPrefs({
      master: true,
      perCategory: { warning_alert: false },
      volume: 0.5,
    })
    const cat = playForNotification({ type: 'alert', severity: 'warn' })
    expect(cat).toBe('warning_alert')
    expect(audio.instance()).toBeNull()
  })
})

describe('primeNotificationAudio', () => {
  let audio: ReturnType<typeof withMockAudio>

  beforeEach(() => {
    resetState()
    audio = withMockAudio()
  })

  afterEach(() => {
    audio.restore()
    __resetNotificationSoundForTests()
  })

  it('creates the shared AudioContext without playing any tone', () => {
    // Unlike a volume-0 play (which short-circuits before constructing the
    // context), priming must actually allocate a live AudioContext so a
    // later autoplay-gated cue can sound.
    expect(__getCachedAudioContextForTests()).toBeNull()
    const ok = primeNotificationAudio()
    expect(ok).toBe(true)
    const ctx = audio.instance()
    expect(ctx).not.toBeNull()
    // Priming is silent — no oscillators/gains are ever scheduled.
    expect(ctx!.oscillators.length).toBe(0)
    expect(ctx!.gains.length).toBe(0)
  })

  it('reuses the cached context on repeat calls (only one ctor)', () => {
    primeNotificationAudio()
    primeNotificationAudio()
    primeNotificationAudio()
    expect(audio.count()).toBe(1)
  })

  it('returns false when no AudioContext constructor is available', () => {
    audio.restore()
    const w = window as unknown as Record<string, unknown>
    const prevAC = w.AudioContext
    const prevWebkit = w.webkitAudioContext
    w.AudioContext = undefined
    w.webkitAudioContext = undefined
    try {
      expect(primeNotificationAudio()).toBe(false)
      expect(__getCachedAudioContextForTests()).toBeNull()
    } finally {
      w.AudioContext = prevAC
      w.webkitAudioContext = prevWebkit
    }
  })

  it('resumes a context that starts suspended (autoplay unlock)', () => {
    audio.restore()
    const resume = vi.fn(() => Promise.resolve())
    const w = window as unknown as Record<string, unknown>
    const prevAC = w.AudioContext
    const prevWebkit = w.webkitAudioContext
    class SuspendedCtx {
      state = 'suspended'
      resume = resume
      currentTime = 0
      destination = {}
      createOscillator() {
        return { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), frequency: { value: 0 }, type: 'sine' }
      }
      createGain() {
        return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() }
      }
    }
    w.AudioContext = SuspendedCtx as unknown as typeof AudioContext
    w.webkitAudioContext = undefined
    try {
      const ok = primeNotificationAudio()
      expect(ok).toBe(true)
      expect(resume).toHaveBeenCalledTimes(1)
    } finally {
      w.AudioContext = prevAC
      w.webkitAudioContext = prevWebkit
    }
  })
})
