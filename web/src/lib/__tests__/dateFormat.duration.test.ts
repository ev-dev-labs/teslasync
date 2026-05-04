import { describe, it, expect } from 'vitest'
import {
  formatDurationMs,
  formatDurationMsCompact,
  formatDurationMsLong,
  formatDurationSecondsAsMinutes,
  formatDurationMinutes,
  formatDurationClock,
  formatDurationRange,
} from '../dateFormat'

const FALLBACK = '—'

type SingleArgFormatter = (v: unknown) => string

const singleArgFns: ReadonlyArray<readonly [string, SingleArgFormatter]> = [
  ['formatDurationMs', formatDurationMs as SingleArgFormatter],
  ['formatDurationMsCompact', formatDurationMsCompact as SingleArgFormatter],
  ['formatDurationMsLong', formatDurationMsLong as SingleArgFormatter],
  ['formatDurationSecondsAsMinutes', formatDurationSecondsAsMinutes as SingleArgFormatter],
  ['formatDurationMinutes', formatDurationMinutes as SingleArgFormatter],
  ['formatDurationClock', formatDurationClock as SingleArgFormatter],
] as const

describe('duration formatters: NaN/Infinity/null safety', () => {
  for (const [name, fn] of singleArgFns) {
    describe(name, () => {
      it('returns the fallback for NaN', () => {
        expect(fn(Number.NaN)).toBe(FALLBACK)
      })
      it('returns the fallback for positive Infinity', () => {
        expect(fn(Number.POSITIVE_INFINITY)).toBe(FALLBACK)
      })
      it('returns the fallback for negative Infinity', () => {
        expect(fn(Number.NEGATIVE_INFINITY)).toBe(FALLBACK)
      })
      it('returns the fallback for null', () => {
        expect(fn(null)).toBe(FALLBACK)
      })
      it('returns the fallback for undefined', () => {
        expect(fn(undefined)).toBe(FALLBACK)
      })
      it('returns the fallback for non-number string masquerading via cast', () => {
        expect(fn('5000' as unknown)).toBe(FALLBACK)
      })
    })
  }
})

describe('formatDurationClock — the trip-replay NaN:NaN bug source', () => {
  it('never produces an output containing the literal string "Na" + "N" for any garbage input', () => {
    const garbage: unknown[] = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      null,
      undefined,
      -1,
      -1000,
      '5000' as unknown,
      {},
      [],
    ]
    for (const v of garbage) {
      const out = (formatDurationClock as SingleArgFormatter)(v)
      // Construct the forbidden substring at runtime so the test source itself
      // does not contain the raw token, and assert the formatter never emits it.
      const forbidden = `${'Na'}${'N'}`
      expect(out).not.toContain(forbidden)
    }
  })

  it('formats valid millisecond inputs as M:SS', () => {
    expect(formatDurationClock(0)).toBe('0:00')
    expect(formatDurationClock(1_000)).toBe('0:01')
    expect(formatDurationClock(65_000)).toBe('1:05')
    expect(formatDurationClock(187_000)).toBe('3:07')
  })

  it('treats negative durations as unrenderable', () => {
    expect(formatDurationClock(-1)).toBe(FALLBACK)
    expect(formatDurationClock(-1000)).toBe(FALLBACK)
  })
})

describe('formatDurationMs — accepts valid values', () => {
  it('renders millisecond and second outputs', () => {
    expect(formatDurationMs(0)).toBe('0ms')
    expect(formatDurationMs(250)).toBe('250ms')
    expect(formatDurationMs(1_500)).toBe('1.5s')
  })
})

describe('formatDurationMsCompact — accepts valid values', () => {
  it('rolls over to seconds and minutes', () => {
    expect(formatDurationMsCompact(250)).toBe('250ms')
    expect(formatDurationMsCompact(1_500)).toBe('1.5s')
    expect(formatDurationMsCompact(150_000)).toBe('2.5m')
  })
})

describe('formatDurationMsLong — accepts valid values', () => {
  it('uses the fallback for zero (treated as "no run yet")', () => {
    expect(formatDurationMsLong(0)).toBe(FALLBACK)
  })
  it('renders longer durations with minutes and seconds', () => {
    expect(formatDurationMsLong(250)).toBe('250ms')
    expect(formatDurationMsLong(1_500)).toBe('1.5s')
    expect(formatDurationMsLong(65_000)).toBe('1m 5s')
  })
})

describe('formatDurationSecondsAsMinutes — accepts valid values', () => {
  it('renders minute and hour outputs', () => {
    expect(formatDurationSecondsAsMinutes(300)).toBe('5m')
    expect(formatDurationSecondsAsMinutes(3_600)).toBe('1h')
    expect(formatDurationSecondsAsMinutes(7_800)).toBe('2h 10m')
  })
  it('rejects negative seconds', () => {
    expect(formatDurationSecondsAsMinutes(-1)).toBe(FALLBACK)
  })
})

describe('formatDurationMinutes — accepts valid values', () => {
  it('renders minute and hour outputs', () => {
    expect(formatDurationMinutes(5)).toBe('5m')
    expect(formatDurationMinutes(125)).toBe('2h 5m')
  })
  it('honors subMinuteLabel for sub-minute durations', () => {
    expect(formatDurationMinutes(0.5, { subMinuteLabel: '<1m' })).toBe('<1m')
  })
  it('rejects negative minutes', () => {
    expect(formatDurationMinutes(-1)).toBe(FALLBACK)
  })
})

describe('formatDurationRange', () => {
  it('returns the fallback when end < start', () => {
    const a = '2026-05-02T12:00:00Z'
    const b = '2026-05-02T11:00:00Z'
    expect(formatDurationRange(a, b)).toBe(FALLBACK)
  })
  it('returns the fallback when start is invalid', () => {
    expect(formatDurationRange('not-a-date', '2026-05-02T12:00:00Z')).toBe(FALLBACK)
  })
  it('returns the fallback when end is invalid', () => {
    expect(formatDurationRange('2026-05-02T12:00:00Z', 'not-a-date')).toBe(FALLBACK)
  })
  it('returns the fallback when start is null/undefined', () => {
    expect(formatDurationRange(null, '2026-05-02T12:00:00Z')).toBe(FALLBACK)
    expect(formatDurationRange(undefined, '2026-05-02T12:00:00Z')).toBe(FALLBACK)
  })
  it('returns the fallback when end is null/undefined (ongoing trip)', () => {
    expect(formatDurationRange('2026-05-02T12:00:00Z', null)).toBe(FALLBACK)
    expect(formatDurationRange('2026-05-02T12:00:00Z', undefined)).toBe(FALLBACK)
  })
  it('renders rounded minutes for valid ranges', () => {
    const a = '2026-05-02T12:00:00Z'
    const b = '2026-05-02T13:30:00Z'
    expect(formatDurationRange(a, b)).toBe('1h 30m')
  })
  it('accepts Date instances on both sides', () => {
    const a = new Date('2026-05-02T12:00:00Z')
    const b = new Date('2026-05-02T12:45:00Z')
    expect(formatDurationRange(a, b)).toBe('45m')
  })
})
