import { describe, it, expect } from 'vitest'

import type { ActiveSession } from '@/api/types'

import { computeSessionStats, type SessionStats, type BreakdownItem } from './sessionStats'

// One representative real-world user-agent per branch we care about. The
// heuristics themselves are exhaustively covered in deviceLabel.test.ts — here
// we only need enough variety to exercise the tally/grouping/sort logic.
const UA = {
  chromeWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  chromeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  firefoxWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  // Nothing recognisable → both browser and os fall back to the em-dash bucket.
  unknown: 'SomeHeadlessCrawler/2.1 (+https://example.com/bot)',
} as const

const EM_DASH = '\u2014'

let seq = 0
/** Build a fully-shaped ActiveSession, overriding only the fields under test. */
function session(overrides: Partial<ActiveSession> = {}): ActiveSession {
  seq += 1
  return {
    id: `sess-${seq}`,
    user_agent: UA.chromeWin,
    ip: '203.0.113.1',
    created_at: '2024-01-01T00:00:00Z',
    last_seen_at: '2024-01-01T00:00:00Z',
    current: false,
    ...overrides,
  }
}

/** Collapse a breakdown into a plain {label: count} map for order-agnostic asserts. */
function toMap(items: BreakdownItem[]): Record<string, number> {
  return Object.fromEntries(items.map((i) => [i.label, i.count]))
}

describe('computeSessionStats', () => {
  describe('empty / nullish input', () => {
    const EMPTY: SessionStats = {
      total: 0,
      current: null,
      otherCount: 0,
      lastActive: null,
      byBrowser: [],
      byOS: [],
      byNetwork: [],
    }

    it.each<[string, ActiveSession[] | null | undefined]>([
      ['null', null],
      ['undefined', undefined],
      ['empty array', []],
    ])('returns a fully-zeroed, empty-breakdown shape for %s', (_label, input) => {
      expect(computeSessionStats(input)).toEqual(EMPTY)
    })

    it('never throws and always returns array breakdowns (safe to .map)', () => {
      const stats = computeSessionStats(undefined)
      expect(Array.isArray(stats.byBrowser)).toBe(true)
      expect(Array.isArray(stats.byOS)).toBe(true)
      expect(Array.isArray(stats.byNetwork)).toBe(true)
    })
  })

  describe('total / current / otherCount', () => {
    it('counts total sessions and identifies the current one by reference', () => {
      const current = session({ current: true })
      const other = session()
      const stats = computeSessionStats([current, other])

      expect(stats.total).toBe(2)
      expect(stats.current).toBe(current)
      expect(stats.otherCount).toBe(1)
    })

    it('reports no current session and counts all as "other" when none is flagged', () => {
      const stats = computeSessionStats([session(), session(), session()])

      expect(stats.total).toBe(3)
      expect(stats.current).toBeNull()
      expect(stats.otherCount).toBe(3)
    })

    it('otherCount + (current ? 1 : 0) always reconstructs total', () => {
      const stats = computeSessionStats([session({ current: true }), session(), session()])
      const currentContribution = stats.current ? 1 : 0
      expect(stats.otherCount + currentContribution).toBe(stats.total)
    })

    it('returns the first current session when more than one is (erroneously) flagged', () => {
      const first = session({ current: true })
      const second = session({ current: true })
      const stats = computeSessionStats([first, second])

      expect(stats.current).toBe(first)
      // Only the current flag matters for otherCount, not identity dedupe.
      expect(stats.otherCount).toBe(0)
    })
  })

  describe('lastActive', () => {
    it('selects the most-recent last_seen_at regardless of list order', () => {
      const stats = computeSessionStats([
        session({ last_seen_at: '2024-03-01T10:00:00Z' }),
        session({ last_seen_at: '2024-06-15T08:30:00Z' }),
        session({ last_seen_at: '2024-01-20T00:00:00Z' }),
      ])
      expect(stats.lastActive).toBe('2024-06-15T08:30:00Z')
    })

    it('returns null when no session carries a last_seen_at', () => {
      const stats = computeSessionStats([
        session({ last_seen_at: '' }),
        session({ last_seen_at: '' }),
      ])
      expect(stats.lastActive).toBeNull()
    })

    it('ignores sessions with an empty timestamp but keeps the real one', () => {
      const stats = computeSessionStats([
        session({ last_seen_at: '' }),
        session({ last_seen_at: '2024-05-05T12:00:00Z' }),
      ])
      expect(stats.lastActive).toBe('2024-05-05T12:00:00Z')
    })

    // Regression: an unparseable timestamp appearing BEFORE a valid one must not
    // suppress the valid winner. `validTime > NaN` is false, so the naive
    // "compare against the current winner" loop used to get stuck on the first
    // garbage value and hide every later real timestamp.
    it('skips an invalid timestamp and still surfaces a later valid one', () => {
      const stats = computeSessionStats([
        session({ last_seen_at: 'not-a-real-date' }),
        session({ last_seen_at: '2024-07-04T04:08:00Z' }),
      ])
      expect(stats.lastActive).toBe('2024-07-04T04:08:00Z')
    })

    it('returns null when every timestamp is unparseable', () => {
      const stats = computeSessionStats([
        session({ last_seen_at: 'garbage' }),
        session({ last_seen_at: 'also-garbage' }),
      ])
      expect(stats.lastActive).toBeNull()
    })
  })

  describe('byBrowser breakdown', () => {
    it('groups sessions by detected browser and counts each group', () => {
      const stats = computeSessionStats([
        session({ user_agent: UA.chromeWin }),
        session({ user_agent: UA.chromeMac }),
        session({ user_agent: UA.firefoxWin }),
      ])
      expect(toMap(stats.byBrowser)).toEqual({ Chrome: 2, Firefox: 1 })
    })

    it('sorts by count descending', () => {
      const stats = computeSessionStats([
        session({ user_agent: UA.firefoxWin }),
        session({ user_agent: UA.chromeWin }),
        session({ user_agent: UA.chromeMac }),
      ])
      expect(stats.byBrowser.map((i) => i.label)).toEqual(['Chrome', 'Firefox'])
      expect(stats.byBrowser[0].count).toBe(2)
    })

    it('breaks count ties by label ascending (locale compare)', () => {
      const stats = computeSessionStats([
        session({ user_agent: UA.firefoxWin }),
        session({ user_agent: UA.chromeWin }),
      ])
      // Both have count 1 → alphabetical: Chrome before Firefox.
      expect(stats.byBrowser.map((i) => i.label)).toEqual(['Chrome', 'Firefox'])
    })

    it('buckets an unrecognised user-agent under the em-dash placeholder', () => {
      const stats = computeSessionStats([session({ user_agent: UA.unknown })])
      expect(stats.byBrowser).toEqual([{ key: EM_DASH, label: EM_DASH, count: 1 }])
    })

    it('emits BreakdownItem rows whose key mirrors the label', () => {
      const stats = computeSessionStats([session({ user_agent: UA.chromeWin })])
      const [row] = stats.byBrowser
      expect(row.key).toBe(row.label)
      expect(Object.keys(row).sort()).toEqual(['count', 'key', 'label'])
    })
  })

  describe('byOS breakdown', () => {
    it('groups by operating system and counts each platform', () => {
      const stats = computeSessionStats([
        session({ user_agent: UA.chromeWin }),
        session({ user_agent: UA.firefoxWin }),
        session({ user_agent: UA.chromeMac }),
        session({ user_agent: UA.safariIphone }),
      ])
      expect(toMap(stats.byOS)).toEqual({ Windows: 2, macOS: 1, iOS: 1 })
    })

    it('does not misbucket Apple mobile agents as macOS', () => {
      const stats = computeSessionStats([session({ user_agent: UA.safariIphone })])
      const labels = stats.byOS.map((i) => i.label)
      expect(labels).toContain('iOS')
      expect(labels).not.toContain('macOS')
    })
  })

  describe('byNetwork breakdown', () => {
    it('groups sessions by source IP and counts each network', () => {
      const stats = computeSessionStats([
        session({ ip: '203.0.113.1' }),
        session({ ip: '203.0.113.1' }),
        session({ ip: '198.51.100.7' }),
      ])
      expect(toMap(stats.byNetwork)).toEqual({ '203.0.113.1': 2, '198.51.100.7': 1 })
      // Highest-count network sorts first.
      expect(stats.byNetwork[0]).toEqual({ key: '203.0.113.1', label: '203.0.113.1', count: 2 })
    })

    it('falls back to the em-dash placeholder for a blank IP', () => {
      const stats = computeSessionStats([session({ ip: '' })])
      expect(toMap(stats.byNetwork)).toEqual({ [EM_DASH]: 1 })
    })
  })

  it('derives every facet from a single mixed session list in one pass', () => {
    const current = session({
      user_agent: UA.chromeWin,
      ip: '203.0.113.1',
      last_seen_at: '2024-08-01T00:00:00Z',
      current: true,
    })
    const stats = computeSessionStats([
      current,
      session({ user_agent: UA.firefoxWin, ip: '203.0.113.1', last_seen_at: '2024-09-10T00:00:00Z' }),
      session({ user_agent: UA.safariIphone, ip: '198.51.100.7', last_seen_at: '2024-07-01T00:00:00Z' }),
    ])

    expect(stats.total).toBe(3)
    expect(stats.current).toBe(current)
    expect(stats.otherCount).toBe(2)
    expect(stats.lastActive).toBe('2024-09-10T00:00:00Z')
    expect(toMap(stats.byBrowser)).toEqual({ Chrome: 1, Firefox: 1, Safari: 1 })
    expect(toMap(stats.byOS)).toEqual({ Windows: 2, iOS: 1 })
    expect(toMap(stats.byNetwork)).toEqual({ '203.0.113.1': 2, '198.51.100.7': 1 })
  })
})
