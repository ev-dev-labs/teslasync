import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatDate, formatDateTime, formatRelative, formatTime } from './dateFormat'
import {
  getGlobalLocale,
  getGlobalPrecision,
  setGlobalLocale,
  setGlobalPrecision,
} from './numberFormat'

const NOW = Date.parse('2026-04-04T12:00:00Z')
let originalLocale: string
let originalPrecision: number

beforeEach(() => {
  originalLocale = getGlobalLocale()
  originalPrecision = getGlobalPrecision()
  setGlobalLocale('en-US')
  setGlobalPrecision(2)
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
  setGlobalLocale(originalLocale)
  setGlobalPrecision(originalPrecision)
})

describe('formatRelative future and locale contract', () => {
  it('distinguishes one millisecond before at and after now', () => {
    expect(formatRelative(new Date(NOW - 1))).toBe('just now')
    expect(formatRelative(new Date(NOW))).toBe('just now')
    expect(formatRelative(new Date(NOW + 1))).toBe('in 1s')
  })

  it('switches future seconds to minutes at sixty seconds', () => {
    expect(formatRelative(new Date(NOW + 59_000))).toBe('in 59s')
    expect(formatRelative(new Date(NOW + 59_999))).toBe('in 59s')
    expect(formatRelative(new Date(NOW + 60_000))).toBe('in 1m')
    expect(formatRelative(new Date(NOW + 60_001))).toBe('in 1m')
    expect(formatRelative(new Date(NOW + 61_000))).toBe('in 1m')
  })

  it('keeps the past just-now window and whole-minute floor', () => {
    expect(formatRelative(new Date(NOW - 59_000))).toBe('just now')
    expect(formatRelative(new Date(NOW - 59_999))).toBe('just now')
    expect(formatRelative(new Date(NOW - 60_000))).toBe('1m ago')
    expect(formatRelative(new Date(NOW - 60_001))).toBe('1m ago')
    expect(formatRelative(new Date(NOW - 119_999))).toBe('1m ago')
    expect(formatRelative(new Date(NOW - 120_000))).toBe('2m ago')
  })

  it('switches future minutes hours days and absolute dates at original thresholds', () => {
    expect(formatRelative(new Date(NOW + 3_599_999))).toBe('in 59m')
    expect(formatRelative(new Date(NOW + 3_600_000))).toBe('in 1h')
    expect(formatRelative(new Date(NOW + 3_600_001))).toBe('in 1h')
    expect(formatRelative(new Date(NOW + 86_399_999))).toBe('in 23h')
    expect(formatRelative(new Date(NOW + 86_400_000))).toBe('in 1d')
    expect(formatRelative(new Date(NOW + 86_400_001))).toBe('in 1d')
    expect(formatRelative(new Date(NOW + 604_799_999))).toBe('in 6d')
    expect(formatRelative(new Date(NOW + 604_800_000), { tz: 'UTC' })).toBe('Apr 11, 2026')
    expect(formatRelative(new Date(NOW + 604_800_001), { tz: 'UTC' })).toBe('Apr 11, 2026')
  })

  it('preserves past minute hour day and seven-day absolute thresholds', () => {
    expect(formatRelative(new Date(NOW - 3_599_999))).toBe('59m ago')
    expect(formatRelative(new Date(NOW - 3_600_000))).toBe('1h ago')
    expect(formatRelative(new Date(NOW - 3_600_001))).toBe('1h ago')
    expect(formatRelative(new Date(NOW - 86_399_999))).toBe('23h ago')
    expect(formatRelative(new Date(NOW - 86_400_000))).toBe('1d ago')
    expect(formatRelative(new Date(NOW - 86_400_001))).toBe('1d ago')
    expect(formatRelative(new Date(NOW - 604_799_999))).toBe('6d ago')
    expect(formatRelative(new Date(NOW - 604_800_000), { tz: 'UTC' })).toBe('Mar 28, 2026')
    expect(formatRelative(new Date(NOW - 604_800_001), { tz: 'UTC' })).toBe('Mar 28, 2026')
  })

  it.each([
    { case: 'null', value: null },
    { case: 'undefined', value: undefined },
    { case: 'empty string', value: '' },
    { case: 'malformed string', value: 'not-a-date' },
    { case: 'invalid Date', value: new Date(NaN) },
  ])('returns the placeholder for $case', ({ value }) => {
    expect(formatRelative(value, { locale: 'fr-FR', tz: 'UTC' })).toBe('—')
  })

  it('localizes future past and present phrases in French', () => {
    const opts = { locale: 'fr-FR' }
    expect(formatRelative(new Date(NOW + 59_000), opts)).toBe('+59 s')
    expect(formatRelative(new Date(NOW + 60_000), opts)).toBe('+1 min')
    expect(formatRelative(new Date(NOW - 1_800_000), opts)).toBe('-30 min')
    expect(formatRelative(new Date(NOW - 59_000), opts)).toBe('maintenant')
    expect(formatRelative(new Date(NOW), opts)).toBe('maintenant')
  })

  it('honors locale digits while elapsed buckets ignore decimal precision', () => {
    const opts = { locale: 'en-US-u-nu-arab' }
    for (const precision of [0, 2, 20]) {
      setGlobalPrecision(precision)
      expect(formatRelative(new Date(NOW + 59_000), opts)).toBe('in ٥٩s')
      expect(formatRelative(new Date(NOW + 60_000), opts)).toBe('in ١m')
      expect(formatRelative(new Date(NOW - 1_800_000), opts)).toBe('٣٠m ago')
      expect(formatRelative(new Date(NOW - 59_000), opts)).toBe('just now')
    }
  })

  it('reads live global locale preferences and lets explicit locale win', () => {
    const timestamp = new Date(NOW - 1_800_000)
    expect(formatRelative(timestamp)).toBe('30m ago')
    setGlobalLocale('de-DE')
    expect(formatRelative(timestamp)).toBe('vor 30 m')
    expect(formatRelative(new Date(NOW))).toBe('jetzt')
    setGlobalLocale('fr-FR')
    expect(formatRelative(timestamp)).toBe('-30 min')
    expect(formatRelative(timestamp, { locale: 'en-US' })).toBe('30m ago')
    expect(timestamp.getTime()).toBe(NOW - 1_800_000)
    expect(getGlobalLocale()).toBe('fr-FR')
  })

  it('uses preferences for blank overrides and English for malformed locale tags', () => {
    const timestamp = new Date(NOW - 1_800_000)
    setGlobalLocale('de-DE')
    expect(formatRelative(timestamp, { locale: '' })).toBe('vor 30 m')
    expect(formatRelative(timestamp, { locale: '   ' })).toBe('vor 30 m')
    expect(formatRelative(timestamp, { locale: 'bad_locale' })).toBe('30m ago')
    setGlobalLocale('bad_locale')
    expect(formatRelative(new Date(NOW + 60_000))).toBe('in 1m')
    expect(formatRelative(timestamp, { locale: 'fr-FR' })).toBe('-30 min')
    setGlobalLocale('')
    expect(formatRelative(timestamp)).toBe('30m ago')
  })

  it('keeps elapsed labels timezone independent for equivalent string and Date inputs', () => {
    const timestamp = new Date(NOW + 59_000)
    const opts = { locale: 'en-US', tz: 'America/Los_Angeles' }
    expect(formatRelative(timestamp, opts)).toBe('in 59s')
    expect(formatRelative(timestamp.toISOString(), { ...opts, tz: 'Asia/Tokyo' })).toBe('in 59s')
    expect(formatRelative('2026-04-04T05:00:59-07:00', { ...opts, tz: 'UTC' })).toBe('in 59s')
    expect(timestamp.getTime()).toBe(NOW + 59_000)
    expect(opts).toEqual({ locale: 'en-US', tz: 'America/Los_Angeles' })
  })

  it('preserves target timezone and selected locale in the absolute fallback', () => {
    vi.setSystemTime(new Date('2026-04-04T00:30:00Z'))
    expect(formatRelative('2026-04-11T00:30:00Z', {
      locale: 'en-US', tz: 'America/Los_Angeles',
    })).toBe('Apr 10, 2026')
    expect(formatRelative('2026-03-28T00:30:00Z', {
      locale: 'en-US', tz: 'America/Los_Angeles',
    })).toBe('Mar 27, 2026')
    expect(formatRelative('2026-04-11T00:30:00Z', {
      locale: 'de-DE', tz: 'Asia/Tokyo',
    })).toBe('11. Apr. 2026')
    setGlobalLocale('de-DE')
    expect(formatRelative('2026-04-11T00:30:00Z', { tz: 'UTC' })).toBe('11. Apr. 2026')
  })

  it('formats the F06 ISO expiry one hour ahead for existing single-argument callers', () => {
    expect(formatRelative('2026-04-04T13:00:00Z')).toBe('in 1h')
    expect(formatRelative('2026-04-04T11:00:00Z')).toBe('1h ago')
    setGlobalLocale('fr-FR')
    expect(formatRelative('2026-04-04T13:00:00Z')).toBe('+1 h')
    expect(formatRelative('2026-04-04T11:00:00Z')).toBe('-1 h')
  })

  it('keeps epoch-zero dates distinct from missing values and zero elapsed time', () => {
    const epoch = new Date(0)
    const iso = epoch.toISOString()
    expect(formatRelative(epoch, { tz: 'UTC' })).toBe('Jan 1, 1970')
    expect(formatRelative(iso, { tz: 'UTC' })).toBe('Jan 1, 1970')
    vi.setSystemTime(0)
    expect(formatRelative(epoch)).toBe('just now')
    expect(formatRelative(iso)).toBe('just now')
    expect(formatRelative(new Date(-1))).toBe('just now')
    expect(formatRelative(new Date(1))).toBe('in 1s')
    expect(formatRelative(null)).toBe('—')
    expect(formatRelative(undefined)).toBe('—')
    expect(epoch.getTime()).toBe(0)
  })

  it('floors whole future seconds without collapsing positive sub-second instants', () => {
    expect(formatRelative(new Date(NOW + 999))).toBe('in 1s')
    expect(formatRelative(new Date(NOW + 1_000))).toBe('in 1s')
    expect(formatRelative(new Date(NOW + 1_001))).toBe('in 1s')
    expect(formatRelative(new Date(NOW + 1_999))).toBe('in 1s')
    expect(formatRelative(new Date(NOW + 2_000))).toBe('in 2s')
    expect(formatRelative(new Date(NOW - 999))).toBe('just now')
    expect(formatRelative(new Date(NOW - 1_000))).toBe('just now')
  })

  it.each([
    { transition: 'spring forward', now: '2026-03-08T09:59:00Z', future: '2026-03-08T10:01:00Z' },
    { transition: 'fall back', now: '2026-11-01T08:59:00Z', future: '2026-11-01T09:01:00Z' },
  ])('keeps elapsed minutes correct across $transition', ({ now, future }) => {
    const opts = { locale: 'en-US', tz: 'America/Los_Angeles' }
    vi.setSystemTime(new Date(now))
    expect(formatRelative(future, opts)).toBe('in 2m')
    vi.setSystemTime(new Date(future))
    expect(formatRelative(now, opts)).toBe('2m ago')
  })

  it('preserves absolute time, timezone and locale hour-cycle choices', () => {
    const iso = '2026-04-04T13:00:00Z'
    const twelveHour = Object.freeze({ locale: 'en-US-u-hc-h12', tz: 'UTC' })
    const twentyFourHour = Object.freeze({ locale: 'en-US-u-hc-h23', tz: 'UTC' })
    const pacific = Object.freeze({ locale: 'en-US-u-hc-h23', tz: 'America/Los_Angeles' })
    const before = [formatTime(iso, twelveHour), formatTime(iso, twentyFourHour), formatTime(iso, pacific)]
    expect(before).toEqual(['01:00 PM', '13:00', '06:00'])
    expect(formatDateTime(iso, twelveHour)).toBe('Apr 4, 2026, 01:00 PM')
    expect(formatDateTime(iso, twentyFourHour)).toBe('Apr 4, 2026, 13:00')
    for (const opts of [twelveHour, twentyFourHour, pacific]) {
      expect(formatRelative(iso, opts)).toBe('in 1h')
      expect(formatRelative('2026-04-11T13:00:00Z', opts))
        .toBe(formatDate('2026-04-11T13:00:00Z', opts))
    }
    expect([formatTime(iso, twelveHour), formatTime(iso, twentyFourHour), formatTime(iso, pacific)])
      .toEqual(before)
    expect(getGlobalLocale()).toBe('en-US')
    expect(getGlobalPrecision()).toBe(2)
  })

  it('preserves localized absolute dates and safe malformed-locale fallback at seven days', () => {
    const future = new Date(NOW + 604_800_000)
    const past = new Date(NOW - 604_800_000)
    const opts = { locale: 'en-US-u-nu-arab', tz: 'UTC' }
    for (const precision of [0, 20]) {
      setGlobalPrecision(precision)
      expect(formatRelative(future, opts)).toBe(formatDate(future, opts))
      expect(formatRelative(past, opts)).toBe(formatDate(past, opts))
    }
    expect(formatRelative(future, { locale: 'bad_locale', tz: 'UTC' })).toBe('Apr 11, 2026')
    expect(formatRelative(past, { locale: 'bad_locale', tz: 'UTC' })).toBe('Mar 28, 2026')
  })
})
