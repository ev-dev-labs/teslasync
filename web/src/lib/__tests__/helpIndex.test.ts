import { describe, it, expect, beforeEach } from 'vitest'

import {
  HELP_SEARCH_LIMIT,
  __resetHelpIndexForTests,
  buildHelpIndex,
  featureForRoute,
  helpEntriesForRoute,
  scoreHelpEntry,
  searchHelpIndex,
} from '../helpIndex'
import { GLOSSARY } from '../helpGlossary'
import { EMPTY_STATE_GUIDANCE } from '../emptyStateGuidance'
import { ONBOARDING_TASKS } from '../onboardingTasks'

/**
 * HELP-06. Determinism is the whole product requirement here: if the same
 * query can return different results on two loads, the index cannot be used as
 * documentation and users fall back to guessing.
 */

beforeEach(() => {
  __resetHelpIndexForTests()
})

describe('buildHelpIndex', () => {
  it('covers every glossary term, empty-state and onboarding task', () => {
    const ids = new Set(buildHelpIndex().map((entry) => entry.id))
    for (const term of GLOSSARY) expect(ids.has(`glossary:${term.id}`)).toBe(true)
    for (const guidance of EMPTY_STATE_GUIDANCE) {
      expect(ids.has(`troubleshooting:empty:${guidance.id}`)).toBe(true)
    }
    for (const task of ONBOARDING_TASKS) expect(ids.has(`task:${task.id}`)).toBe(true)
  })

  it('includes visible pages and excludes hidden parameterised routes', () => {
    const ids = new Set(buildHelpIndex().map((entry) => entry.id))
    expect(ids.has('page:/battery')).toBe(true)
    expect(ids.has('page:/drives/:id')).toBe(false)
  })

  it('has unique ids and is sorted by id', () => {
    const index = buildHelpIndex()
    const ids = index.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort()).toEqual(ids)
  })

  it('memoises — the same array instance is returned', () => {
    expect(buildHelpIndex()).toBe(buildHelpIndex())
  })

  it('gives every entry a non-empty title, summary and feature bucket', () => {
    for (const entry of buildHelpIndex()) {
      expect(entry.titleFallback.length).toBeGreaterThan(0)
      expect(entry.summaryFallback.length).toBeGreaterThan(0)
      expect(entry.feature.length).toBeGreaterThan(0)
    }
  })
})

describe('featureForRoute', () => {
  it('uses the first path segment', () => {
    expect(featureForRoute('/battery/health')).toBe('battery')
    expect(featureForRoute('/charging')).toBe('charging')
  })

  it('treats the root as the dashboard bucket', () => {
    expect(featureForRoute('/')).toBe('dashboard')
  })
})

describe('searchHelpIndex — determinism', () => {
  it('returns identical, identically-ordered results across calls', () => {
    const a = searchHelpIndex('drain').map((entry) => entry.id)
    const b = searchHelpIndex('drain').map((entry) => entry.id)
    expect(a).toEqual(b)
  })

  it('is unaffected by the order of the underlying index', () => {
    const index = buildHelpIndex()
    const forward = searchHelpIndex('battery', { index }).map((entry) => entry.id)
    const reversed = searchHelpIndex('battery', { index: [...index].reverse() }).map(
      (entry) => entry.id,
    )
    expect(reversed).toEqual(forward)
  })

  it('is case- and whitespace-insensitive', () => {
    expect(searchHelpIndex('  PHANTOM DRAIN ').map((e) => e.id)).toEqual(
      searchHelpIndex('phantom drain').map((e) => e.id),
    )
  })
})

describe('searchHelpIndex — ranking', () => {
  it('puts the definition first when the user types a defined term', () => {
    expect(searchHelpIndex('phantom drain')[0].id).toBe('glossary:phantom_drain')
    expect(searchHelpIndex('rated range')[0].id).toBe('glossary:rated_range')
    expect(searchHelpIndex('soc')[0].id).toBe('glossary:soc')
  })

  it('finds a term through an alias the user is more likely to know', () => {
    expect(searchHelpIndex('vampire drain')[0].id).toBe('glossary:phantom_drain')
  })

  it('finds pages by name', () => {
    const ids = searchHelpIndex('system status').map((entry) => entry.id)
    expect(ids).toContain('page:/system-status')
  })

  it('respects the result cap', () => {
    expect(searchHelpIndex('a').length).toBeLessThanOrEqual(HELP_SEARCH_LIMIT)
    expect(searchHelpIndex('battery', { limit: 2 })).toHaveLength(2)
  })

  it('can be restricted to one kind', () => {
    const results = searchHelpIndex('battery', { kind: 'glossary' })
    for (const entry of results) expect(entry.kind).toBe('glossary')
  })

  it('returns nothing for an empty query', () => {
    expect(searchHelpIndex('')).toEqual([])
    expect(searchHelpIndex('   ')).toEqual([])
    expect(searchHelpIndex(undefined as unknown as string)).toEqual([])
  })

  it('returns nothing for a query that matches nothing', () => {
    expect(searchHelpIndex('zzzzzzzzqqqq')).toEqual([])
  })
})

describe('scoreHelpEntry', () => {
  const entry = buildHelpIndex().find((e) => e.id === 'glossary:soc')!

  it('scores an exact term above a mere alias-prefix match', () => {
    // 'soc' is an exact term; 'battery' only prefixes the alias
    // "battery level" and appears in the summary.
    expect(scoreHelpEntry(entry, 'soc')).toBeGreaterThan(scoreHelpEntry(entry, 'battery'))
  })

  it('scores zero for a non-match and for an empty needle', () => {
    expect(scoreHelpEntry(entry, 'zzzzz')).toBe(0)
    expect(scoreHelpEntry(entry, '')).toBe(0)
  })
})

describe('helpEntriesForRoute', () => {
  it('surfaces feature-relevant entries for a nested route', () => {
    const ids = helpEntriesForRoute('/battery/health').map((entry) => entry.id)
    expect(ids.length).toBeGreaterThan(0)
    // The page entry for the exact route is excluded — the user is already there.
    expect(ids).not.toContain('page:/battery/health')
  })

  it('surfaces charging guidance on the charging route', () => {
    const ids = helpEntriesForRoute('/charging').map((entry) => entry.id)
    expect(ids).toContain('troubleshooting:empty:charging.list')
  })

  it('is deterministic', () => {
    expect(helpEntriesForRoute('/charging').map((e) => e.id)).toEqual(
      helpEntriesForRoute('/charging').map((e) => e.id),
    )
  })

  it('returns nothing for an empty pathname', () => {
    expect(helpEntriesForRoute('')).toEqual([])
  })

  it('respects the limit', () => {
    expect(helpEntriesForRoute('/charging', { limit: 2 })).toHaveLength(2)
  })
})
