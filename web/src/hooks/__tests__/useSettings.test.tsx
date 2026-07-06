/**
 * `useSettings` derived-hook contract.
 *
 * This is the unit test for the REAL `@/hooks/useSettings` hook (the
 * app-level derived hook, not the raw `@/api/hooks/useSettings` query).
 * It covers every export of the module:
 *
 *   1. `useSettings()` — default fallback, the metric/imperial derivation
 *      branches, locale normalisation, the `decimal_precision` clamp, the
 *      `preferred_range` / `ui_density` boundary guards, the module-level
 *      formatter-global side effects, cross-tab refetch on `settings.changed`,
 *      and referential stability of the returned object.
 *   2. The `@/lib/notificationSound` symbols re-exported through this barrel
 *      (`DEFAULT_NOTIFICATION_SOUND_PREFS`, `NOTIFICATION_SOUND_CATEGORIES`,
 *      `getNotificationSoundPrefs`, `setNotificationSoundPrefs`,
 *      `useNotificationSoundPrefs`).
 *
 * The cross-tab bus mechanics themselves live in
 * `lib/__tests__/broadcast.test.ts`; here we only assert that the hook
 * reacts to a peer `settings.changed` envelope.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { AppSettings } from '@/api/types'

// test-setup.ts installs a global vi.mock for '@/hooks/useSettings' that
// returns static defaults so unrelated component tests don't need a
// QueryClientProvider. This file IS the test for the real hook, so restore
// the actual implementation locally — a file-level vi.mock takes precedence
// over the setupFiles registration.
vi.mock('@/hooks/useSettings', async () =>
  await vi.importActual<typeof import('../useSettings')>('../useSettings'),
)

// Deterministic settings fetcher: `getSettings()` → `request('/settings')`.
// Both the alias `@/api/client` and the relative `./client` import inside
// `@/api/settings` resolve to the same module id, so this single mock covers
// the whole fetch path without touching the network.
let nextSettings: Partial<AppSettings> = { locale: 'en-US', decimal_precision: 2 }
vi.mock('@/api/client', () => ({
  request: vi.fn(async () => nextSettings),
}))

import {
  useSettings,
  DEFAULT_NOTIFICATION_SOUND_PREFS,
  NOTIFICATION_SOUND_CATEGORIES,
  getNotificationSoundPrefs,
  setNotificationSoundPrefs,
  useNotificationSoundPrefs,
} from '../useSettings'
import { request } from '@/api/client'
import {
  getGlobalLocale,
  getGlobalPrecision,
  setGlobalLocale,
  setGlobalPrecision,
} from '@/lib/numberFormat'
import { TOPICS } from '@/lib/broadcastTopics'
import * as notificationSound from '@/lib/notificationSound'

// ── Test plumbing ─────────────────────────────────────────────────────────────

function makeWrapper(): {
  Wrapper: (p: { children: ReactNode }) => JSX.Element
  qc: QueryClient
} {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return { Wrapper, qc }
}

// The bus self-filters same-tab broadcasts, so emulate a PEER envelope via the
// localStorage fallback transport (a `storage` event) exactly like the real
// cross-tab path in `lib/broadcast.ts`.
function emitPeerBroadcast(type: string): void {
  act(() => {
    const key = '__teslasync_bus_test'
    const env = { _from: 'peer-tab', _ts: Date.now(), msg: { type } }
    const serialized = JSON.stringify(env)
    window.localStorage.setItem(key, serialized)
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: serialized }))
  })
}

beforeEach(() => {
  // Start each test from a known-bad global so we can prove the hook wrote it.
  setGlobalLocale('xx-XX')
  setGlobalPrecision(0)
  nextSettings = { locale: 'en-US', decimal_precision: 2 }
  vi.mocked(request).mockClear()
})

afterEach(() => {
  vi.clearAllMocks()
})

// ── 1. Derivation branches ────────────────────────────────────────────────────

describe('useSettings — derived flags', () => {
  it('derives the metric branch (km / C / bar / rated) from resolved settings', async () => {
    nextSettings = {
      unit_of_length: 'km',
      unit_of_temp: 'C',
      unit_of_pressure: 'bar',
      preferred_range: 'rated',
      locale: 'en-US',
      decimal_precision: 2,
      ui_density: 'comfortable',
    }
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useSettings(), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.settings.unit_of_length).toBe('km'))
    expect(result.current.isMiles).toBe(false)
    expect(result.current.isFahrenheit).toBe(false)
    expect(result.current.isPSI).toBe(false)
    expect(result.current.decimals).toBe(2)
    expect(result.current.locale).toBe('en-US')
    expect(result.current.density).toBe('comfortable')
    expect(result.current.rangeType).toBe('rated')
  })

  it('derives the imperial branch (mi / F / psi / ideal) from resolved settings', async () => {
    nextSettings = {
      unit_of_length: 'mi',
      unit_of_temp: 'F',
      unit_of_pressure: 'psi',
      preferred_range: 'ideal',
      locale: 'en-GB',
      decimal_precision: 1,
      ui_density: 'compact',
    }
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useSettings(), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.isMiles).toBe(true))
    expect(result.current.isFahrenheit).toBe(true)
    expect(result.current.isPSI).toBe(true)
    expect(result.current.decimals).toBe(1)
    expect(result.current.locale).toBe('en-GB')
    expect(result.current.density).toBe('compact')
    expect(result.current.rangeType).toBe('ideal')
  })

  it('treats a missing unit_of_pressure as bar (isPSI false)', async () => {
    nextSettings = { unit_of_pressure: undefined, locale: 'de-DE' }
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useSettings(), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.locale).toBe('de-DE'))
    expect(result.current.isPSI).toBe(false)
  })
})

// ── 2. Default fallback while the query is pending ────────────────────────────

describe('useSettings — pending-query fallback', () => {
  it('returns built-in defaults (and applies them to the globals) before data arrives', () => {
    // A never-resolving fetch keeps the query pending so `settings` stays
    // undefined and the hook must fall back to its `defaults` object.
    vi.mocked(request).mockImplementationOnce(() => new Promise<never>(() => {}))
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useSettings(), { wrapper: Wrapper })

    expect(result.current.settings.unit_of_length).toBe('km')
    expect(result.current.settings.locale).toBe('en-US')
    expect(result.current.isMiles).toBe(false)
    expect(result.current.decimals).toBe(2)
    expect(result.current.density).toBe('comfortable')
    expect(result.current.rangeType).toBe('rated')
    // The post-commit effect must have synced the formatter globals even on
    // the defaults path (they were seeded to xx-XX / 0 in beforeEach).
    expect(getGlobalLocale()).toBe('en-US')
    expect(getGlobalPrecision()).toBe(2)
  })
})

// ── 3. Locale normalisation (blank → en-US) ───────────────────────────────────

describe('useSettings — locale normalisation', () => {
  it('rewrites an empty-string locale to en-US on settings and the derived locale', async () => {
    nextSettings = { locale: '', decimal_precision: 2, unit_of_length: 'mi' }
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useSettings(), { wrapper: Wrapper })

    // `unit_of_length: 'mi'` is the resolution sentinel (defaults are km).
    await waitFor(() => expect(result.current.isMiles).toBe(true))
    expect(result.current.locale).toBe('en-US')
    expect(result.current.settings.locale).toBe('en-US')
  })

  it('rewrites a whitespace-only locale to en-US', async () => {
    nextSettings = { locale: '   ', unit_of_temp: 'F' }
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useSettings(), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.isFahrenheit).toBe(true))
    expect(result.current.locale).toBe('en-US')
    expect(result.current.settings.locale).toBe('en-US')
  })
})

// ── 4. decimal_precision clamp (regression: RangeError-safe) ──────────────────

describe('useSettings — decimal_precision is clamped RangeError-safe', () => {
  it('clamps an over-large precision down to 20 for both the return and the global', async () => {
    nextSettings = { decimal_precision: 50, locale: 'fr-FR' }
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useSettings(), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.locale).toBe('fr-FR'))
    expect(result.current.decimals).toBe(20)
    expect(getGlobalPrecision()).toBe(20)
    // A consumer handing this straight to toFixed() must never throw.
    expect(() => (1.23456).toFixed(result.current.decimals)).not.toThrow()
  })

  it('clamps a negative precision up to 0', async () => {
    nextSettings = { decimal_precision: -3, locale: 'es-ES' }
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useSettings(), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.locale).toBe('es-ES'))
    expect(result.current.decimals).toBe(0)
    expect(() => (1.23456).toFixed(result.current.decimals)).not.toThrow()
  })

  it('falls back to 2 for a non-finite precision', async () => {
    nextSettings = { decimal_precision: Number.NaN, locale: 'ja-JP' }
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useSettings(), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.locale).toBe('ja-JP'))
    expect(result.current.decimals).toBe(2)
  })

  it('truncates a fractional precision to an integer', async () => {
    nextSettings = { decimal_precision: 3.9, locale: 'it-IT' }
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useSettings(), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.locale).toBe('it-IT'))
    expect(result.current.decimals).toBe(3)
  })
})

// ── 5. preferred_range boundary guard (regression: no blind cast) ─────────────

describe('useSettings — preferred_range guard', () => {
  it('maps an explicit "ideal" through unchanged', async () => {
    nextSettings = { preferred_range: 'ideal', locale: 'de-DE' }
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useSettings(), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.locale).toBe('de-DE'))
    expect(result.current.rangeType).toBe('ideal')
  })

  it('degrades an empty or unknown preferred_range to "rated"', async () => {
    nextSettings = { preferred_range: '', locale: 'fr-FR' }
    const empty = makeWrapper()
    const emptyHook = renderHook(() => useSettings(), { wrapper: empty.Wrapper })
    await waitFor(() => expect(emptyHook.result.current.locale).toBe('fr-FR'))
    expect(emptyHook.result.current.rangeType).toBe('rated')

    nextSettings = { preferred_range: 'garbage-value', locale: 'es-ES' }
    const junk = makeWrapper()
    const junkHook = renderHook(() => useSettings(), { wrapper: junk.Wrapper })
    await waitFor(() => expect(junkHook.result.current.locale).toBe('es-ES'))
    expect(junkHook.result.current.rangeType).toBe('rated')
  })
})

// ── 6. ui_density boundary guard ──────────────────────────────────────────────

describe('useSettings — ui_density guard', () => {
  it('passes through spacious and compact but coerces anything else to comfortable', async () => {
    nextSettings = { ui_density: 'spacious', locale: 'de-DE' }
    const a = makeWrapper()
    const spacious = renderHook(() => useSettings(), { wrapper: a.Wrapper })
    await waitFor(() => expect(spacious.result.current.locale).toBe('de-DE'))
    expect(spacious.result.current.density).toBe('spacious')

    nextSettings = { ui_density: 'ultra' as AppSettings['ui_density'], locale: 'fr-FR' }
    const b = makeWrapper()
    const bogus = renderHook(() => useSettings(), { wrapper: b.Wrapper })
    await waitFor(() => expect(bogus.result.current.locale).toBe('fr-FR'))
    expect(bogus.result.current.density).toBe('comfortable')
  })
})

// ── 7. Formatter globals + cross-tab refetch ──────────────────────────────────

describe('useSettings — formatter globals & broadcast', () => {
  it('applies the resolved locale and precision to the module formatter globals', async () => {
    nextSettings = { locale: 'de-DE', decimal_precision: 3 }
    const { Wrapper } = makeWrapper()
    renderHook(() => useSettings(), { wrapper: Wrapper })

    await waitFor(() => {
      expect(getGlobalLocale()).toBe('de-DE')
      expect(getGlobalPrecision()).toBe(3)
    })
  })

  it('refetches and re-derives on a settings.changed peer broadcast', async () => {
    nextSettings = { locale: 'en-US', decimal_precision: 2 }
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useSettings(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.locale).toBe('en-US'))

    nextSettings = { locale: 'ja-JP', decimal_precision: 1, unit_of_length: 'mi' }
    emitPeerBroadcast(TOPICS.SETTINGS_CHANGED)

    await waitFor(() => {
      expect(result.current.settings.locale).toBe('ja-JP')
      expect(result.current.decimals).toBe(1)
      expect(result.current.isMiles).toBe(true)
      expect(getGlobalLocale()).toBe('ja-JP')
    })
  })

  it('ignores unrelated broadcasts (no refetch)', async () => {
    nextSettings = { locale: 'nb-NO', decimal_precision: 2 }
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useSettings(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.locale).toBe('nb-NO'))

    const callsBefore = vi.mocked(request).mock.calls.length
    emitPeerBroadcast(TOPICS.THEME_CHANGED)
    // Give the bus a macrotask to (not) deliver.
    await new Promise((r) => setTimeout(r, 10))

    expect(vi.mocked(request).mock.calls.length).toBe(callsBefore)
  })
})

// ── 8. Referential stability (memoisation) ────────────────────────────────────

describe('useSettings — reference stability', () => {
  it('returns an identical object + settings reference across renders when nothing changed', async () => {
    nextSettings = { locale: 'nb-NO', decimal_precision: 2 }
    const { Wrapper } = makeWrapper()
    const { result, rerender } = renderHook(() => useSettings(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.settings.locale).toBe('nb-NO'))

    const first = result.current
    rerender()
    expect(result.current).toBe(first)
    expect(result.current.settings).toBe(first.settings)
  })

  it('produces a new reference once the settings actually change', async () => {
    nextSettings = { locale: 'nb-NO', decimal_precision: 2 }
    const { Wrapper, qc } = makeWrapper()
    const { result } = renderHook(() => useSettings(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.locale).toBe('nb-NO'))
    const first = result.current

    nextSettings = { locale: 'fr-FR', decimal_precision: 2 }
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['settings'] })
    })

    await waitFor(() => expect(result.current.locale).toBe('fr-FR'))
    expect(result.current).not.toBe(first)
  })
})

// ── 9. Re-exported notification-sound API ─────────────────────────────────────

describe('useSettings barrel — notification-sound re-exports', () => {
  it('re-exports the notification-sound symbols identical to @/lib/notificationSound', () => {
    expect(DEFAULT_NOTIFICATION_SOUND_PREFS).toBe(
      notificationSound.DEFAULT_NOTIFICATION_SOUND_PREFS,
    )
    expect(NOTIFICATION_SOUND_CATEGORIES).toBe(
      notificationSound.NOTIFICATION_SOUND_CATEGORIES,
    )
    expect(getNotificationSoundPrefs).toBe(notificationSound.getNotificationSoundPrefs)
    expect(setNotificationSoundPrefs).toBe(notificationSound.setNotificationSoundPrefs)
    expect(useNotificationSoundPrefs).toBe(notificationSound.useNotificationSoundPrefs)
  })

  it('exposes the expected default prefs + category set through the barrel', () => {
    expect(DEFAULT_NOTIFICATION_SOUND_PREFS.master).toBe(false)
    expect(DEFAULT_NOTIFICATION_SOUND_PREFS.volume).toBe(0.6)
    expect(NOTIFICATION_SOUND_CATEGORIES).toContain('critical_alert')
    expect(NOTIFICATION_SOUND_CATEGORIES).toContain('charge_complete')
    expect(NOTIFICATION_SOUND_CATEGORIES.length).toBe(7)
  })

  it('round-trips and clamps volume through the re-exported setter/getter', () => {
    setNotificationSoundPrefs({ volume: 0.42 })
    expect(getNotificationSoundPrefs().volume).toBe(0.42)

    // Out-of-range volume is clamped into [0, 1].
    setNotificationSoundPrefs({ volume: 5 })
    expect(getNotificationSoundPrefs().volume).toBe(1)
  })

  it('useNotificationSoundPrefs returns the live prefs snapshot', () => {
    const { result } = renderHook(() => useNotificationSoundPrefs())
    expect(result.current).toHaveProperty('master')
    expect(result.current).toHaveProperty('perCategory')
    expect(typeof result.current.volume).toBe('number')
  })
})
