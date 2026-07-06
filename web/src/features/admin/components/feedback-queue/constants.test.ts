import { describe, expect, it } from 'vitest'

import type { FeedbackCategory, FeedbackStatus } from '@/api/types'

import { CATEGORY_COLORS, STATUS_COLORS, type FeedbackCounts } from './constants'

/**
 * `constants.ts` is a pure data module (two colour lookup maps + one type), so
 * there is no component or hook to mount — these are plain Vitest unit tests,
 * matching the sibling `helpers.test.ts` / `serviceOptions.test.ts` convention.
 *
 * We assert the invariants the two real consumers silently rely on:
 *   - StatusDistribution reads `STATUS_COLORS[key]` straight into a segment's
 *     `backgroundColor`; a missing key would paint an invisible bar.
 *   - CategoryMix passes `CATEGORY_COLORS[key]` to `MetricBar`, which appends an
 *     alpha channel via `` `${color}99` `` — only valid for 6-digit hex.
 *   - FeedbackCounts is a partial map read as `counts[key] ?? 0`.
 */

const HEX6 = /^#[0-9a-f]{6}$/i
const HEX8 = /^#[0-9a-f]{8}$/i

// These arrays ARE the FeedbackStatus / FeedbackCategory unions; typing them
// so a future union change forces this file to be revisited alongside the map.
const ALL_STATUSES: FeedbackStatus[] = ['new', 'triaged', 'closed']
const ALL_CATEGORIES: FeedbackCategory[] = ['bug', 'feature', 'other']

describe('STATUS_COLORS', () => {
  it('maps every FeedbackStatus to a defined colour (no undefined segment fills)', () => {
    expect(Object.keys(STATUS_COLORS).sort()).toEqual([...ALL_STATUSES].sort())
    for (const key of ALL_STATUSES) {
      expect(STATUS_COLORS[key]).toBeDefined()
    }
  })

  it('uses distinct 6-digit hex fills so the stacked bar stays legible', () => {
    const values = ALL_STATUSES.map((k) => STATUS_COLORS[k])
    for (const v of values) expect(v).toMatch(HEX6)
    // A duplicate colour would make two segments visually indistinguishable.
    expect(new Set(values).size).toBe(values.length)
  })

  it('pins the documented palette (regression guard on the design tokens)', () => {
    expect(STATUS_COLORS).toEqual({
      new: '#f59e0b',
      triaged: '#10b981',
      closed: '#64748b',
    })
  })

  it('is frozen so a consumer cannot mutate the shared palette in place', () => {
    expect(Object.isFrozen(STATUS_COLORS)).toBe(true)
    expect(() => {
      const mutable = STATUS_COLORS as Record<string, string>
      mutable.new = '#000000'
    }).toThrow()
    // The rejected write must not have altered the value.
    expect(STATUS_COLORS.new).toBe('#f59e0b')
  })
})

describe('CATEGORY_COLORS', () => {
  it('maps every FeedbackCategory to a defined colour', () => {
    expect(Object.keys(CATEGORY_COLORS).sort()).toEqual([...ALL_CATEGORIES].sort())
    for (const key of ALL_CATEGORIES) {
      expect(CATEGORY_COLORS[key]).toBeDefined()
    }
  })

  it('uses distinct 6-digit hex fills', () => {
    const values = ALL_CATEGORIES.map((k) => CATEGORY_COLORS[k])
    for (const v of values) expect(v).toMatch(HEX6)
    expect(new Set(values).size).toBe(values.length)
  })

  it('pins the documented palette', () => {
    expect(CATEGORY_COLORS).toEqual({
      bug: '#f43f5e',
      feature: '#22d3ee',
      other: '#a78bfa',
    })
  })

  it('stays valid when MetricBar appends an alpha channel (`${color}99`)', () => {
    // CategoryMix -> MetricBar builds `${color}99` / `${color}40`; that is only
    // a valid colour when the base is #rrggbb. Guards that cross-component
    // contract against someone switching a value to rgb()/#rgb/a named colour.
    for (const key of ALL_CATEGORIES) {
      expect(`${CATEGORY_COLORS[key]}99`).toMatch(HEX8)
      expect(`${CATEGORY_COLORS[key]}40`).toMatch(HEX8)
    }
  })

  it('is frozen', () => {
    expect(Object.isFrozen(CATEGORY_COLORS)).toBe(true)
    expect(() => {
      const mutable = CATEGORY_COLORS as Record<string, string>
      mutable.bug = '#000000'
    }).toThrow()
  })
})

describe('FeedbackCounts', () => {
  // Mirrors the exact read pattern used in StatusDistribution / CategoryMix:
  //   const count = counts[key] ?? 0
  const readCount = (
    counts: FeedbackCounts,
    key: FeedbackStatus | FeedbackCategory,
  ): number => counts[key] ?? 0

  it('reads a present count verbatim', () => {
    const counts: FeedbackCounts = { new: 5, triaged: 2, bug: 3 }
    expect(readCount(counts, 'new')).toBe(5)
    expect(readCount(counts, 'bug')).toBe(3)
  })

  it('falls back to 0 for a key absent while its count query is still loading', () => {
    const counts: FeedbackCounts = { new: 5 }
    expect(readCount(counts, 'triaged')).toBe(0)
    expect(readCount(counts, 'closed')).toBe(0)
  })

  it('falls back to 0 for an explicitly undefined count', () => {
    const counts: FeedbackCounts = { new: undefined }
    expect(readCount(counts, 'new')).toBe(0)
  })

  it('supports an empty object — every facet resolves to 0', () => {
    const counts: FeedbackCounts = {}
    const total = [...ALL_STATUSES, ...ALL_CATEGORIES].reduce(
      (sum, key) => sum + readCount(counts, key),
      0,
    )
    expect(total).toBe(0)
  })
})
