// Unit test for the generated AI feature registry mirror
// (web/src/ai/features.ts).
//
// `features.ts` is emitted by tools/aigen from
// internal/ai/features/registry.go and carries a `DO NOT EDIT` banner —
// editing it would break `go run ./tools/aigen --check` in CI and be
// overwritten on the next `make generate`. The right way to "elevate"
// a generated data module is therefore to lock, in an executable test,
// the invariants the generator is contractually required to preserve
// (ADR-015 + internal/ai/features CoverageOK):
//
//   * AI_FEATURE_IDS is a stable, sorted, duplicate-free id list.
//   * AI_FEATURES is a frozen id -> meta record whose map key always
//     equals entry.id, whose metadata is well-typed, and whose
//     defaultOn is false for every feature (ADR-015 §I7).
//   * isKnownAiFeature is an own-property type guard that stays
//     prototype-pollution safe (it must NOT report inherited
//     Object.prototype members as known features).
//
// These assertions turn a silent generator regression (a mis-sorted
// list, a key/id mismatch, a feature accidentally defaulting on, or a
// guard downgraded to `key in obj`) into a red test.

import { describe, it, expect } from 'vitest'

import {
  AI_FEATURES,
  AI_FEATURE_IDS,
  isKnownAiFeature,
  type AiFeatureId,
  type AiFeatureMeta,
} from '@/ai/features'

const SEED_ID: AiFeatureId = 'chatbot-llm'

describe('AI_FEATURE_IDS', () => {
  it('is a non-empty frozen list that includes the seed feature', () => {
    expect(Array.isArray(AI_FEATURE_IDS)).toBe(true)
    expect(AI_FEATURE_IDS.length).toBeGreaterThanOrEqual(1)
    expect(Object.isFrozen(AI_FEATURE_IDS)).toBe(true)
    expect(AI_FEATURE_IDS).toContain(SEED_ID)
  })

  it('contains no duplicate ids', () => {
    const unique = new Set<string>(AI_FEATURE_IDS)
    expect(unique.size).toBe(AI_FEATURE_IDS.length)
  })

  it('is sorted lexicographically (deterministic aigen output)', () => {
    const resorted = [...AI_FEATURE_IDS].sort()
    expect(resorted).toEqual([...AI_FEATURE_IDS])
  })

  it('lists exactly the keys of AI_FEATURES, in the same order', () => {
    expect(Object.keys(AI_FEATURES)).toEqual([...AI_FEATURE_IDS])
  })
})

describe('AI_FEATURES', () => {
  it('is frozen at the record, entry, and uiTestIds level', () => {
    expect(Object.isFrozen(AI_FEATURES)).toBe(true)
    for (const id of AI_FEATURE_IDS) {
      expect(Object.isFrozen(AI_FEATURES[id])).toBe(true)
      expect(Object.isFrozen(AI_FEATURES[id].uiTestIds)).toBe(true)
    }
  })

  it('rejects mutation of the frozen record', () => {
    expect(() => {
      const mutable = AI_FEATURES as unknown as Record<string, number>
      mutable.__injected__ = 1
    }).toThrow(TypeError)
  })

  it('keys every entry by its own id (map-key invariant)', () => {
    for (const id of AI_FEATURE_IDS) {
      expect(AI_FEATURES[id].id).toBe(id)
    }
  })

  it('populates required, well-typed metadata for every feature', () => {
    for (const id of AI_FEATURE_IDS) {
      const meta: AiFeatureMeta = AI_FEATURES[id]
      expect(meta.name.length).toBeGreaterThan(0)
      expect(meta.tier.length).toBeGreaterThan(0)
      expect(typeof meta.description).toBe('string')
      expect(typeof meta.needsRag).toBe('boolean')
      expect(typeof meta.needsTools).toBe('boolean')
      expect(typeof meta.needsStream).toBe('boolean')
      expect(Array.isArray(meta.uiTestIds)).toBe(true)
    }
  })

  it('never defaults a feature on (ADR-015 §I7)', () => {
    const defaultedOn = AI_FEATURE_IDS.filter((id) => AI_FEATURES[id].defaultOn)
    expect(defaultedOn).toEqual([])
  })

  it('emits only ai-feature-* ui test id markers', () => {
    for (const id of AI_FEATURE_IDS) {
      for (const tid of AI_FEATURES[id].uiTestIds) {
        expect(typeof tid).toBe('string')
        expect(tid).toMatch(/^ai-feature-[a-z0-9-]+$/)
      }
    }
  })

  it('locks the seed chatbot-llm metadata snapshot', () => {
    expect(AI_FEATURES[SEED_ID]).toEqual({
      id: 'chatbot-llm',
      name: 'Helix fleet intelligence copilot',
      description:
        'Evidence-first conversational agent with live fleet tools, cross-domain analysis, TeslaSync knowledge retrieval, visible provenance, and a deterministic fallback when AI is off.',
      tier: 'U',
      defaultOn: false,
      needsRag: true,
      needsTools: true,
      needsStream: true,
      uiTestIds: ['ai-feature-chatbot-llm-root'],
    })
  })
})

describe('isKnownAiFeature', () => {
  it('accepts every registered feature id', () => {
    for (const id of AI_FEATURE_IDS) {
      expect(isKnownAiFeature(id)).toBe(true)
    }
  })

  it('rejects ids that are not in the registry', () => {
    expect(isKnownAiFeature('definitely-not-a-feature')).toBe(false)
    expect(isKnownAiFeature('')).toBe(false)
    // Lookups are case-sensitive kebab-case.
    expect(isKnownAiFeature('Chatbot-LLM')).toBe(false)
  })

  it('is prototype-pollution safe (own-property, not `in`)', () => {
    // Every one of these is an inherited Object.prototype member. A
    // naive `key in AI_FEATURES` guard would wrongly report them as
    // known features; the own-property check must return false.
    const inherited = ['__proto__', 'constructor', 'hasOwnProperty', 'toString', 'valueOf']
    for (const key of inherited) {
      expect(isKnownAiFeature(key)).toBe(false)
    }
  })

  it('narrows a string to AiFeatureId in the true branch', () => {
    const candidate = String(SEED_ID)
    if (!isKnownAiFeature(candidate)) {
      throw new Error('seed feature chatbot-llm must be known')
    }
    // Type-narrowed to AiFeatureId here, so this index access is
    // type-safe rather than a `Record` widening.
    const meta: AiFeatureMeta = AI_FEATURES[candidate]
    expect(meta.id).toBe('chatbot-llm')
  })
})
