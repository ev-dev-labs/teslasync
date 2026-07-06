/**
 * `useDateFormat` locale + timezone-aware formatter tests.
 *
 * `useDateFormat` is a thin, memoised binding layer: it resolves the
 * effective `{ locale, tz }` from `useSettings()` + `useTimezone()` and hands
 * every call straight to the matching pure helper in `@/lib/dateFormat`. The
 * suite therefore verifies four contracts rather than re-testing the lib's
 * calendar math:
 *
 *   1. Timezone-mode resolution — an explicit `mode` wins over
 *      `settings.tz_display_default`, and any missing / blank / out-of-union
 *      persisted value is sanitised back to the `'vehicle'` default (the
 *      hardening `isTzMode` guard replaces an unsafe `as TzMode` cast).
 *   2. Delegation — each of the eight formatters forwards `(value,
 *      { locale, tz })` to its `@/lib/dateFormat` sibling, and a per-call
 *      `override` is merged on top (override wins) without a second hook.
 *   3. Behaviour — a handful of end-to-end renders prove real, deterministic
 *      output (explicit locale + tz make ICU output stable) and that the
 *      override actually shifts the wall-clock day.
 *   4. Reference stability — formatters + the result object are identical
 *      across a no-op re-render (safe for memoised children) and rebuild when
 *      `locale` or `tz` changes.
 *
 * `useSettings`, `useTimezone`, and the `@/lib/dateFormat` helpers are mocked
 * per-file (file-level `vi.mock` takes precedence over the global
 * `test-setup.ts` stubs) so no QueryClient/Router context or real network is
 * required.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { TzMode } from '@/lib/timezone'

const H = vi.hoisted(() => {
  const state = {
    settings: { tz_display_default: 'vehicle' } as { tz_display_default?: unknown },
    locale: 'en-US' as string,
    tz: 'UTC' as string,
  }
  // Records the `mode` argument `useDateFormat` threads into `useTimezone`,
  // so the mode-resolution branch can be asserted directly.
  const timezoneSpy = vi.fn((mode?: string): string => {
    void mode
    return state.tz
  })
  return { state, timezoneSpy }
})

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ settings: H.state.settings, locale: H.state.locale }),
}))

vi.mock('@/lib/timezone', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/timezone')>('@/lib/timezone')
  return {
    ...actual,
    useTimezone: (mode?: TzMode) => H.timezoneSpy(mode),
  }
})

vi.mock('@/lib/dateFormat', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/dateFormat')>('@/lib/dateFormat')
  return {
    ...actual,
    formatDate: vi.fn(actual.formatDate),
    formatDateTime: vi.fn(actual.formatDateTime),
    formatTime: vi.fn(actual.formatTime),
    formatDateShort: vi.fn(actual.formatDateShort),
    formatDateWithDay: vi.fn(actual.formatDateWithDay),
    formatRelative: vi.fn(actual.formatRelative),
    formatRelativeTime: vi.fn(actual.formatRelativeTime),
    formatRelativeDays: vi.fn(actual.formatRelativeDays),
  }
})

import { useDateFormat } from '../useDateFormat'
import * as dateLib from '@/lib/dateFormat'

const LIB_FNS = [
  dateLib.formatDate,
  dateLib.formatDateTime,
  dateLib.formatTime,
  dateLib.formatDateShort,
  dateLib.formatDateWithDay,
  dateLib.formatRelative,
  dateLib.formatRelativeTime,
  dateLib.formatRelativeDays,
] as const

const FORMATTER_KEYS = [
  'formatDate',
  'formatDateTime',
  'formatTime',
  'formatDateShort',
  'formatDateWithDay',
  'formatRelative',
  'formatRelativeTime',
  'formatRelativeDays',
] as const

beforeEach(() => {
  H.state.settings = { tz_display_default: 'vehicle' }
  H.state.locale = 'en-US'
  H.state.tz = 'UTC'
  H.timezoneSpy.mockClear()
  for (const fn of LIB_FNS) vi.mocked(fn).mockClear()
})

describe('useDateFormat — timezone mode resolution', () => {
  it('threads the settings default (vehicle) into useTimezone when no mode is passed', () => {
    renderHook(() => useDateFormat())
    expect(H.timezoneSpy).toHaveBeenCalledWith('vehicle')
  })

  it('honours a non-default settings preference (utc)', () => {
    H.state.settings = { tz_display_default: 'utc' }
    renderHook(() => useDateFormat())
    expect(H.timezoneSpy).toHaveBeenCalledWith('utc')
  })

  it('lets an explicit mode argument override the settings default', () => {
    H.state.settings = { tz_display_default: 'vehicle' }
    renderHook(() => useDateFormat('user'))
    expect(H.timezoneSpy).toHaveBeenCalledWith('user')
    expect(H.timezoneSpy).not.toHaveBeenCalledWith('vehicle')
  })

  it('sanitises a blank persisted tz_display_default back to vehicle', () => {
    // Regression: `??` does not catch '' — the old `as TzMode` cast would
    // have forwarded an invalid empty mode into useTimezone.
    H.state.settings = { tz_display_default: '' }
    renderHook(() => useDateFormat())
    expect(H.timezoneSpy).toHaveBeenCalledWith('vehicle')
    expect(H.timezoneSpy).not.toHaveBeenCalledWith('')
  })

  it('sanitises a legacy out-of-union tz_display_default back to vehicle', () => {
    H.state.settings = { tz_display_default: 'local' }
    renderHook(() => useDateFormat())
    expect(H.timezoneSpy).toHaveBeenCalledWith('vehicle')
    expect(H.timezoneSpy).not.toHaveBeenCalledWith('local')
  })

  it('falls back to vehicle when tz_display_default is undefined', () => {
    H.state.settings = {}
    renderHook(() => useDateFormat())
    expect(H.timezoneSpy).toHaveBeenCalledWith('vehicle')
  })
})

describe('useDateFormat — exposed opts / tz / locale', () => {
  it('exposes the resolved tz + locale and a matching opts object', () => {
    H.state.locale = 'en-GB'
    H.state.tz = 'America/New_York'
    const { result } = renderHook(() => useDateFormat())
    expect(result.current.tz).toBe('America/New_York')
    expect(result.current.locale).toBe('en-GB')
    expect(result.current.opts).toEqual({ locale: 'en-GB', tz: 'America/New_York' })
  })

  it('returns a callable formatter for every documented key', () => {
    const { result } = renderHook(() => useDateFormat())
    for (const key of FORMATTER_KEYS) {
      expect(typeof result.current[key]).toBe('function')
    }
  })
})

describe('useDateFormat — delegation to @/lib/dateFormat', () => {
  const VALUE = '2026-04-04T02:30:00Z'

  it('does not invoke any lib formatter on render alone', () => {
    renderHook(() => useDateFormat())
    for (const fn of LIB_FNS) expect(fn).not.toHaveBeenCalled()
  })

  it('forwards (value, { locale, tz }) for each formatter', () => {
    const { result } = renderHook(() => useDateFormat())
    const opts = { locale: 'en-US', tz: 'UTC' }

    result.current.formatDate(VALUE)
    expect(dateLib.formatDate).toHaveBeenCalledWith(VALUE, opts)

    result.current.formatDateTime(VALUE)
    expect(dateLib.formatDateTime).toHaveBeenCalledWith(VALUE, opts)

    result.current.formatTime(VALUE)
    expect(dateLib.formatTime).toHaveBeenCalledWith(VALUE, opts)

    result.current.formatDateShort(VALUE)
    expect(dateLib.formatDateShort).toHaveBeenCalledWith(VALUE, opts)

    result.current.formatDateWithDay(VALUE)
    expect(dateLib.formatDateWithDay).toHaveBeenCalledWith(VALUE, opts)

    result.current.formatRelative(VALUE)
    expect(dateLib.formatRelative).toHaveBeenCalledWith(VALUE, opts)

    result.current.formatRelativeTime(VALUE)
    expect(dateLib.formatRelativeTime).toHaveBeenCalledWith(VALUE, opts)

    result.current.formatRelativeDays(VALUE)
    expect(dateLib.formatRelativeDays).toHaveBeenCalledWith(VALUE, opts)
  })

  it('merges a per-call override on top of the resolved opts (tz override wins)', () => {
    const { result } = renderHook(() => useDateFormat())
    result.current.formatDate(VALUE, { tz: 'America/Los_Angeles' })
    expect(dateLib.formatDate).toHaveBeenCalledWith(VALUE, {
      locale: 'en-US',
      tz: 'America/Los_Angeles',
    })
  })

  it('merges a per-call locale override on top of the resolved opts', () => {
    const { result } = renderHook(() => useDateFormat())
    result.current.formatDateTime(VALUE, { locale: 'fr-FR' })
    expect(dateLib.formatDateTime).toHaveBeenCalledWith(VALUE, {
      locale: 'fr-FR',
      tz: 'UTC',
    })
  })
})

describe('useDateFormat — end-to-end behaviour', () => {
  it('renders a nullish value as the em-dash placeholder', () => {
    const { result } = renderHook(() => useDateFormat())
    expect(result.current.formatDate(null)).toBe('—')
    expect(result.current.formatDateTime(undefined)).toBe('—')
  })

  it('renders a real timestamp in the resolved locale + UTC zone', () => {
    const { result } = renderHook(() => useDateFormat())
    // 02:30Z on Apr 4 — deterministic because locale + tz are explicit.
    expect(result.current.formatDate('2026-04-04T02:30:00Z')).toBe('Apr 4, 2026')
    expect(result.current.formatDateTime('2026-04-04T02:30:00Z')).toContain('Apr 4, 2026')
  })

  it('lets an override tz shift the rendered wall-clock day', () => {
    const { result } = renderHook(() => useDateFormat())
    // 02:30Z Apr 4 is still Apr 3 (19:30) in Los Angeles (PDT, UTC-7).
    expect(
      result.current.formatDate('2026-04-04T02:30:00Z', { tz: 'America/Los_Angeles' }),
    ).toBe('Apr 3, 2026')
  })
})

describe('useDateFormat — relative formatters (faked clock)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-04T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('classifies recent timestamps via formatRelative', () => {
    const { result } = renderHook(() => useDateFormat())
    expect(result.current.formatRelative('2026-04-04T11:59:30Z')).toBe('just now')
    expect(result.current.formatRelative('2026-04-04T11:30:00Z')).toBe('30m ago')
  })

  it('classifies recent timestamps via formatRelativeTime', () => {
    const { result } = renderHook(() => useDateFormat())
    expect(result.current.formatRelativeTime('2026-04-04T11:59:30Z')).toBe('Just now')
    expect(result.current.formatRelativeTime('2026-04-04T09:00:00Z')).toBe('3h ago')
  })

  it('anchors formatRelativeDays day boundaries to the resolved tz', () => {
    const { result } = renderHook(() => useDateFormat())
    // Same UTC day → Today; previous UTC day → Yesterday.
    expect(result.current.formatRelativeDays('2026-04-04T02:30:00Z')).toBe('Today')
    expect(result.current.formatRelativeDays('2026-04-03T23:00:00Z')).toBe('Yesterday')
  })

  it('lets an override tz roll formatRelativeDays across the day boundary', () => {
    const { result } = renderHook(() => useDateFormat())
    // In UTC this is Today; in LA the same instant is the previous day.
    expect(result.current.formatRelativeDays('2026-04-04T02:30:00Z')).toBe('Today')
    expect(
      result.current.formatRelativeDays('2026-04-04T02:30:00Z', {
        tz: 'America/Los_Angeles',
      }),
    ).toBe('Yesterday')
  })
})

describe('useDateFormat — reference stability', () => {
  it('returns identical formatter + result references across a no-op re-render', () => {
    const { result, rerender } = renderHook(() => useDateFormat())
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
    expect(result.current.formatDate).toBe(first.formatDate)
    expect(result.current.opts).toBe(first.opts)
  })

  it('rebuilds formatters when the resolved tz changes', () => {
    const { result, rerender } = renderHook(() => useDateFormat())
    const firstFormatDate = result.current.formatDate
    const firstOpts = result.current.opts
    H.state.tz = 'America/New_York'
    rerender()
    expect(result.current.tz).toBe('America/New_York')
    expect(result.current.opts).not.toBe(firstOpts)
    expect(result.current.formatDate).not.toBe(firstFormatDate)
  })

  it('rebuilds formatters when the resolved locale changes', () => {
    const { result, rerender } = renderHook(() => useDateFormat())
    const firstFormatTime = result.current.formatTime
    H.state.locale = 'de-DE'
    rerender()
    expect(result.current.locale).toBe('de-DE')
    expect(result.current.formatTime).not.toBe(firstFormatTime)
  })
})
