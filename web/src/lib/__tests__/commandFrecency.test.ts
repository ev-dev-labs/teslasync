import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  recordCommandUse,
  getCommandScore,
  getAllCommandScores,
  _resetFrecency,
} from '../commandFrecency'

const STORAGE_KEY = 'teslasync:cmd-frecency:v1'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
  vi.useRealTimers()
})

describe('commandFrecency', () => {
  it('returns 0 for an unrecorded command', () => {
    expect(getCommandScore('never.recorded')).toBe(0)
  })

  it('recordCommandUse → getCommandScore returns positive', () => {
    recordCommandUse('cmd.foo')
    expect(getCommandScore('cmd.foo')).toBeGreaterThan(0)
  })

  it('persists to localStorage under the v1 key', () => {
    recordCommandUse('cmd.foo')
    const raw = localStorage.getItem(STORAGE_KEY)
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw as string) as Record<string, { count: number; lastUsed: number }>
    expect(parsed['cmd.foo']).toBeDefined()
    expect(parsed['cmd.foo'].count).toBe(1)
    expect(parsed['cmd.foo'].lastUsed).toBeGreaterThan(0)
  })

  it('two recordings roughly double the score (within decay tolerance at the same instant)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    recordCommandUse('cmd.foo')
    const single = getCommandScore('cmd.foo')
    recordCommandUse('cmd.foo')
    const doubled = getCommandScore('cmd.foo')
    // Same timestamp ⇒ same decay factor ⇒ count is the only delta.
    expect(doubled).toBeGreaterThan(single * 1.99)
    expect(doubled).toBeLessThan(single * 2.01)
  })

  it('score decays by ~half over a 14-day window (HALF_LIFE_DAYS)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    recordCommandUse('cmd.foo')
    const fresh = getCommandScore('cmd.foo')
    expect(fresh).toBeGreaterThan(0)
    // Advance exactly 14 days
    vi.setSystemTime(new Date('2026-01-15T00:00:00Z'))
    const decayed = getCommandScore('cmd.foo')
    // Tight band around 0.5
    expect(decayed).toBeGreaterThan(fresh * 0.49)
    expect(decayed).toBeLessThan(fresh * 0.51)
  })

  it('older usage decays well below newer usage given the same count', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    recordCommandUse('old.cmd')
    // Advance ~6 months
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'))
    recordCommandUse('new.cmd')
    expect(getCommandScore('new.cmd')).toBeGreaterThan(getCommandScore('old.cmd'))
  })

  it('recordCommandUse refreshes lastUsed so subsequent decay uses the new timestamp', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    recordCommandUse('cmd.foo')
    // Decay-only window: 28 days later → score halves twice (~25% of original count=1)
    vi.setSystemTime(new Date('2026-01-29T00:00:00Z'))
    const aged = getCommandScore('cmd.foo')
    // Re-record at the aged timestamp; this writes a new lastUsed=now AND bumps count to 2
    recordCommandUse('cmd.foo')
    const refreshed = getCommandScore('cmd.foo')
    // After refresh: decay factor is 1.0 (lastUsed === now), count is 2 → score = 2.0
    // Aged before refresh was ~0.25, so refresh should be substantially higher.
    expect(refreshed).toBeGreaterThan(aged)
    expect(refreshed).toBeCloseTo(2, 5)
  })

  it('_resetFrecency clears all stored data', () => {
    recordCommandUse('cmd.foo')
    recordCommandUse('cmd.bar')
    expect(getCommandScore('cmd.foo')).toBeGreaterThan(0)
    _resetFrecency()
    expect(getCommandScore('cmd.foo')).toBe(0)
    expect(getCommandScore('cmd.bar')).toBe(0)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('getAllCommandScores returns the decayed score for every recorded id', () => {
    recordCommandUse('a')
    recordCommandUse('b')
    recordCommandUse('a')
    const scores = getAllCommandScores()
    expect(Object.keys(scores).sort()).toEqual(['a', 'b'])
    expect(scores.a).toBeGreaterThan(scores.b)
  })

  it('survives malformed JSON in storage gracefully', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json')
    expect(getCommandScore('foo')).toBe(0)
    expect(getAllCommandScores()).toEqual({})
    // Subsequent recording recovers
    recordCommandUse('foo')
    expect(getCommandScore('foo')).toBeGreaterThan(0)
  })

  it('ignores entries that are not the expected shape', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        valid: { count: 3, lastUsed: Date.now() },
        // each of these is malformed in a different way
        notObj: 'oops',
        missingFields: { count: 1 },
        nanCount: { count: NaN, lastUsed: 0 },
        infiniteUsed: { count: 1, lastUsed: Infinity },
      }),
    )
    const scores = getAllCommandScores()
    expect(Object.keys(scores)).toEqual(['valid'])
    expect(scores.valid).toBeGreaterThan(0)
  })

  it('ignores empty / whitespace-like ids passed to recordCommandUse', () => {
    recordCommandUse('')
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('survives an array payload (not an object) in storage', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['a', 'b']))
    expect(getCommandScore('a')).toBe(0)
    expect(getAllCommandScores()).toEqual({})
  })
})
