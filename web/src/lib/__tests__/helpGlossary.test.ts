import { describe, it, expect } from 'vitest'

import {
  GLOSSARY,
  getGlossaryTerm,
  listGlossaryIds,
  resolveGlossaryTerm,
} from '../helpGlossary'

/**
 * HELP-03. The six terms named in the requirement must be present and must
 * carry provenance — a definition without "where this number comes from" is
 * exactly the gap that makes users mistrust the chart.
 */

const REQUIRED_TERMS = [
  'soc',
  'rated_range',
  'degradation',
  'phantom_drain',
  'efficiency',
  'signal_freshness',
] as const

describe('glossary coverage', () => {
  it('defines every required term', () => {
    for (const id of REQUIRED_TERMS) {
      expect(getGlossaryTerm(id), `missing glossary term: ${id}`).not.toBeNull()
    }
  })

  it('has unique ids', () => {
    const ids = listGlossaryIds()
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every term a definition AND a provenance sentence', () => {
    for (const term of GLOSSARY) {
      expect(term.definitionFallback.length, `${term.id} definition`).toBeGreaterThan(30)
      expect(term.howMeasuredFallback.length, `${term.id} provenance`).toBeGreaterThan(30)
      expect(term.termFallback.length).toBeGreaterThan(0)
    }
  })

  it('gives every term at least one searchable alias', () => {
    for (const term of GLOSSARY) {
      expect(term.aliases.length, `${term.id} aliases`).toBeGreaterThan(0)
      for (const alias of term.aliases) {
        expect(alias).toBe(alias.toLowerCase())
      }
    }
  })

  it('reuses the shipped catalog keys where a vetted definition already exists', () => {
    // Re-using these keys means a translator who has already localised the
    // vampire-drain / degradation / efficiency strings gets the glossary for
    // free, and the two surfaces cannot disagree.
    expect(getGlossaryTerm('phantom_drain')?.definitionKey).toBe('help.vampireDrain.body')
    expect(getGlossaryTerm('degradation')?.definitionKey).toBe('help.battery.degradationRate')
    expect(getGlossaryTerm('efficiency')?.definitionKey).toBe('help.lifetime.avgEfficiency')
    expect(getGlossaryTerm('signal_freshness')?.definitionKey).toBe('help.signal.stale')
    expect(getGlossaryTerm('state_of_health')?.definitionKey).toBe('help.battery.soh')
  })

  it('does not have two terms claiming the same alias', () => {
    const seen = new Map<string, string>()
    for (const term of GLOSSARY) {
      for (const alias of term.aliases) {
        const existing = seen.get(alias)
        // `soh` is legitimately an alias of both degradation and state of
        // health; anything else sharing an alias is a lookup ambiguity.
        if (existing && alias !== 'soh' && alias !== 'state of health') {
          throw new Error(`alias "${alias}" claimed by both ${existing} and ${term.id}`)
        }
        if (!existing) seen.set(alias, term.id)
      }
    }
    expect(seen.size).toBeGreaterThan(0)
  })
})

describe('resolveGlossaryTerm', () => {
  it('resolves by id', () => {
    expect(resolveGlossaryTerm('soc')?.id).toBe('soc')
  })

  it('resolves by canonical term, case-insensitively', () => {
    expect(resolveGlossaryTerm('RATED RANGE')?.id).toBe('rated_range')
  })

  it('resolves by alias', () => {
    expect(resolveGlossaryTerm('vampire drain')?.id).toBe('phantom_drain')
    expect(resolveGlossaryTerm('wh/km')?.id).toBe('efficiency')
  })

  it('trims surrounding whitespace', () => {
    expect(resolveGlossaryTerm('  state of charge  ')?.id).toBe('soc')
  })

  it('is exact, not fuzzy — a wrong definition is worse than none', () => {
    expect(resolveGlossaryTerm('rated')).toBeNull()
    expect(resolveGlossaryTerm('drain')).toBeNull()
  })

  it('returns null for empty and non-string input', () => {
    expect(resolveGlossaryTerm('')).toBeNull()
    expect(resolveGlossaryTerm('   ')).toBeNull()
    expect(resolveGlossaryTerm(undefined as unknown as string)).toBeNull()
  })
})
