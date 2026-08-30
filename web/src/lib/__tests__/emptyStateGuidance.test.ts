import { describe, it, expect } from 'vitest'

import {
  EMPTY_STATE_GUIDANCE,
  getEmptyStateGuidance,
  listEmptyStateGuidanceIds,
} from '../emptyStateGuidance'
import { ROUTE_REGISTRY } from '../routeRegistry'

/**
 * HELP-02 governance. The pattern is only worth having if every entry answers
 * all four questions and offers exactly one reachable action — otherwise it
 * degrades back into "No data available" with extra ceremony.
 */

describe('empty-state guidance registry', () => {
  it('has unique ids', () => {
    const ids = EMPTY_STATE_GUIDANCE.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('answers all four questions for every entry', () => {
    for (const entry of EMPTY_STATE_GUIDANCE) {
      expect(entry.meaningFallback.length, `${entry.id} meaning`).toBeGreaterThan(20)
      expect(entry.prerequisiteFallback.length, `${entry.id} prerequisite`).toBeGreaterThan(20)
      expect(entry.likelyCauseFallback.length, `${entry.id} likely cause`).toBeGreaterThan(20)
      expect(entry.action.labelFallback.length, `${entry.id} action`).toBeGreaterThan(0)
    }
  })

  it('points every action at a route declared in the route registry', () => {
    const known = new Set(ROUTE_REGISTRY.map((route) => route.path))
    for (const entry of EMPTY_STATE_GUIDANCE) {
      expect(known.has(entry.action.to), `${entry.id} → ${entry.action.to}`).toBe(true)
    }
  })

  it('namespaces every i18n key under emptyState.<id>', () => {
    for (const entry of EMPTY_STATE_GUIDANCE) {
      const prefix = `emptyState.${entry.id}.`
      expect(entry.meaningKey.startsWith(prefix)).toBe(true)
      expect(entry.prerequisiteKey.startsWith(prefix)).toBe(true)
      expect(entry.likelyCauseKey.startsWith(prefix)).toBe(true)
      expect(entry.action.labelKey.startsWith(prefix)).toBe(true)
    }
  })

  it('declares a feature bucket so the help index can group entries', () => {
    for (const entry of EMPTY_STATE_GUIDANCE) {
      expect(entry.feature.length).toBeGreaterThan(0)
    }
  })

  it('never blames the user in the likely-cause sentence', () => {
    // "You forgot to…" is a support ticket in the making. The cause describes
    // the system's state, not the reader's behaviour.
    for (const entry of EMPTY_STATE_GUIDANCE) {
      expect(entry.likelyCauseFallback).not.toMatch(/\byou (?:forgot|failed|did not|didn't)\b/i)
    }
  })
})

describe('getEmptyStateGuidance', () => {
  it('resolves a known id', () => {
    expect(getEmptyStateGuidance('drives.list')?.feature).toBe('driving')
  })

  it('returns null for an unknown id rather than throwing', () => {
    expect(getEmptyStateGuidance('nope.nope')).toBeNull()
    expect(getEmptyStateGuidance('')).toBeNull()
  })
})

describe('listEmptyStateGuidanceIds', () => {
  it('returns every id, sorted', () => {
    const ids = listEmptyStateGuidanceIds()
    expect(ids).toHaveLength(EMPTY_STATE_GUIDANCE.length)
    expect([...ids].sort()).toEqual(ids)
  })
})
