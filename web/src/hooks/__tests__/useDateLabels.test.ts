/**
 * `useDateLabels` route-side label formatter tests.
 *
 * `useDateLabels` is the same thin, memoised binding pattern as
 * `useDateFormat`, but for the calendar labels the app shell never needs
 * (month-year, month name, weekday name, chart-axis hour, day-precision
 * relative days). It resolves the same `{ locale, tz }` from
 * `useSettings()` + `useTimezone()` and hands every call to the matching
 * pure helper in `@/lib/dateConvert`. The suite verifies the same three
 * contracts as its shell sibling:
 *
 *   1. Delegation — each of the five formatters forwards `(value,
 *      { locale, tz })` to its `@/lib/dateConvert` sibling, and a
 *      per-call `override` is merged on top (override wins).
 *   2. Behaviour — end-to-end renders prove real, deterministic output
 *      (explicit locale + tz make ICU output stable), including the
 *      day-boundary behaviour `formatRelativeDays` carries over from
 *      the shell hook.
 *   3. Reference stability — formatters + the result object are identical
 *      across a no-op re-render and rebuild when `locale` or `tz` changes.
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

vi.mock('@/lib/dateConvert', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/dateConvert')>('@/lib/dateConvert')
  return {
    ...actual,
    formatMonthYear: vi.fn(actual.formatMonthYear),
    formatMonthName: vi.fn(actual.formatMonthName),
    formatWeekdayName: vi.fn(actual.formatWeekdayName),
    formatMonthDayHour: vi.fn(actual.formatMonthDayHour),
    formatRelativeDays: vi.fn(actual.formatRelativeDays),
  }
})

import { useDateLabels } from '../useDateLabels'
import * as dateLib from '@/lib/dateConvert'

const LIB_FNS = [
  dateLib.formatMonthYear,
  dateLib.formatMonthName,
  dateLib.formatWeekdayName,
  dateLib.formatMonthDayHour,
  dateLib.formatRelativeDays,
] as const

const FORMATTER_KEYS = [
  'formatMonthYear',
  'formatMonthName',
  'formatWeekdayName',
  'formatMonthDayHour',
  'formatRelativeDays',
] as const

beforeEach(() => {
  H.state.settings = { tz_display_default: 'vehicle' }
  H.state.locale = 'en-US'
  H.state.tz = 'UTC'
  H.timezoneSpy.mockClear()
  for (const fn of LIB_FNS) vi.mocked(fn).mockClear()
})

describe('useDateLabels — exposed opts / tz / locale', () => {
  it('exposes the resolved tz + locale and a matching opts object', () => {
    H.state.locale = 'en-GB'
    H.state.tz = 'America/New_York'
    const { result } = renderHook(() => useDateLabels())
    expect(result.current.tz).toBe('America/New_York')
    expect(result.current.locale).toBe('en-GB')
    expect(result.current.opts).toEqual({ locale: 'en-GB', tz: 'America/New_York' })
  })

  it('returns a callable formatter for every documented key', () => {
    const { result } = renderHook(() => useDateLabels())
    for (const key of FORMATTER_KEYS) {
      expect(typeof result.current[key]).toBe('function')
    }
  })
})

describe('useDateLabels — delegation to @/lib/dateConvert', () => {
  const VALUE = '2026-04-04T02:30:00Z'

  it('does not invoke any lib formatter on render alone', () => {
    renderHook(() => useDateLabels())
    for (const fn of LIB_FNS) expect(fn).not.toHaveBeenCalled()
  })

  it('forwards (value, { locale, tz }) for each formatter', () => {
    const { result } = renderHook(() => useDateLabels())
    const opts = { locale: 'en-US', tz: 'UTC' }

    result.current.formatMonthYear(VALUE)
    expect(dateLib.formatMonthYear).toHaveBeenCalledWith(VALUE, opts)

    result.current.formatMonthName(VALUE)
    expect(dateLib.formatMonthName).toHaveBeenCalledWith(VALUE, opts)

    result.current.formatWeekdayName(VALUE)
    expect(dateLib.formatWeekdayName).toHaveBeenCalledWith(VALUE, opts)

    result.current.formatMonthDayHour(VALUE)
    expect(dateLib.formatMonthDayHour).toHaveBeenCalledWith(VALUE, opts)

    result.current.formatRelativeDays(VALUE)
    expect(dateLib.formatRelativeDays).toHaveBeenCalledWith(VALUE, opts)
  })

  it('merges a per-call override on top of the resolved opts (tz override wins)', () => {
    const { result } = renderHook(() => useDateLabels())
    result.current.formatMonthYear(VALUE, { tz: 'America/Los_Angeles' })
    expect(dateLib.formatMonthYear).toHaveBeenCalledWith(VALUE, {
      locale: 'en-US',
      tz: 'America/Los_Angeles',
    })
  })
})

describe('useDateLabels — end-to-end behaviour', () => {
  it('renders month labels in the resolved locale + UTC zone', () => {
    const { result } = renderHook(() => useDateLabels())
    expect(result.current.formatMonthYear('2026-04-04T02:30:00Z')).toBe('Apr 2026')
    expect(result.current.formatMonthName('2026-04-04T02:30:00Z')).toBe('Apr')
    expect(result.current.formatWeekdayName('2026-04-04T02:30:00Z')).toBe('Sat')
  })

  it('renders nullish values as the em-dash placeholder', () => {
    const { result } = renderHook(() => useDateLabels())
    expect(result.current.formatMonthYear(null)).toBe('—')
    expect(result.current.formatMonthDayHour(undefined)).toBe('—')
  })
})

describe('useDateLabels — relative days (faked clock)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-04T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('anchors formatRelativeDays day boundaries to the resolved tz', () => {
    const { result } = renderHook(() => useDateLabels())
    // Same UTC day → Today; previous UTC day → Yesterday.
    expect(result.current.formatRelativeDays('2026-04-04T02:30:00Z')).toBe('Today')
    expect(result.current.formatRelativeDays('2026-04-03T23:00:00Z')).toBe('Yesterday')
  })

  it('lets an override tz roll formatRelativeDays across the day boundary', () => {
    const { result } = renderHook(() => useDateLabels())
    // In UTC this is Today; in LA the same instant is the previous day.
    expect(result.current.formatRelativeDays('2026-04-04T02:30:00Z')).toBe('Today')
    expect(
      result.current.formatRelativeDays('2026-04-04T02:30:00Z', {
        tz: 'America/Los_Angeles',
      }),
    ).toBe('Yesterday')
  })
})

describe('useDateLabels — reference stability', () => {
  it('returns identical formatter + result references across a no-op re-render', () => {
    const { result, rerender } = renderHook(() => useDateLabels())
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
    expect(result.current.formatMonthYear).toBe(first.formatMonthYear)
    expect(result.current.opts).toBe(first.opts)
  })

  it('rebuilds formatters when the resolved tz changes', () => {
    const { result, rerender } = renderHook(() => useDateLabels())
    const firstFormatMonthYear = result.current.formatMonthYear
    const firstOpts = result.current.opts
    H.state.tz = 'America/New_York'
    rerender()
    expect(result.current.tz).toBe('America/New_York')
    expect(result.current.opts).not.toBe(firstOpts)
    expect(result.current.formatMonthYear).not.toBe(firstFormatMonthYear)
  })
})
