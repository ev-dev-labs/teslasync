import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import {
  CONSENT_POLICY_STORAGE_KEY,
  POLICY_HINT_TTL_MS,
  __reinitVitalsConsentPolicyFromStorageForTests,
  getRestrictiveConsentHint,
  getVitalsConsentDecision,
  getVitalsConsentPolicy,
  isVitalsReportingAllowed,
  resetVitalsConsentRequirementForTests,
  setVitalsConsentPolicy,
  setVitalsConsentRequirement,
  subscribeVitalsConsentPolicy,
} from '../webVitalsConsent'
import { clearConsent, setConsent } from '../cookieConsent'

function cache(policy: string, ageMs = 0): void {
  localStorage.setItem(
    CONSENT_POLICY_STORAGE_KEY,
    JSON.stringify({ policy, at: Date.now() - ageMs }),
  )
}

describe('webVitalsConsent — tri-state policy', () => {
  beforeEach(() => {
    localStorage.clear()
    clearConsent()
    resetVitalsConsentRequirementForTests('unknown')
  })

  afterEach(() => {
    localStorage.clear()
    clearConsent()
    resetVitalsConsentRequirementForTests('unknown')
    vi.useRealTimers()
  })

  it('fails closed: an unresolved policy HOLDS, it does not send', () => {
    expect(getVitalsConsentPolicy()).toBe('unknown')
    expect(getVitalsConsentDecision()).toBe('hold')
    expect(isVitalsReportingAllowed()).toBe(false)
  })

  it('starts unresolved on every page load, whatever is cached', () => {
    cache('not-required')
    __reinitVitalsConsentPolicyFromStorageForTests()
    expect(getVitalsConsentPolicy()).toBe('unknown')

    cache('required')
    __reinitVitalsConsentPolicyFromStorageForTests()
    expect(getVitalsConsentPolicy()).toBe('unknown')
  })

  it('sends only once the policy resolves to not-required', () => {
    setVitalsConsentRequirement(false)
    expect(getVitalsConsentPolicy()).toBe('not-required')
    expect(getVitalsConsentDecision()).toBe('send')
    expect(isVitalsReportingAllowed()).toBe(true)
  })

  it('drops for a required policy until the user accepts', () => {
    setVitalsConsentRequirement(true)
    expect(getVitalsConsentDecision()).toBe('drop')

    setConsent('declined')
    expect(getVitalsConsentDecision()).toBe('drop')

    setConsent('accepted')
    expect(getVitalsConsentDecision()).toBe('send')
  })

  it('treats undefined as unknown so a loading query cannot fail open', () => {
    setVitalsConsentRequirement(false)
    expect(getVitalsConsentDecision()).toBe('send')

    setVitalsConsentRequirement(undefined)
    expect(getVitalsConsentPolicy()).toBe('unknown')
    expect(getVitalsConsentDecision()).toBe('hold')
  })
})

describe('webVitalsConsent — the cache is restrictive-only', () => {
  beforeEach(() => {
    localStorage.clear()
    clearConsent()
    resetVitalsConsentRequirementForTests('unknown')
  })

  afterEach(() => {
    localStorage.clear()
    clearConsent()
    resetVitalsConsentRequirementForTests('unknown')
  })

  it('IGNORES a cached not-required hint — it must never authorise a send', () => {
    cache('not-required')
    expect(__reinitVitalsConsentPolicyFromStorageForTests()).toBeNull()
    expect(getRestrictiveConsentHint()).toBeNull()
    expect(getVitalsConsentDecision()).toBe('hold')
    expect(isVitalsReportingAllowed()).toBe(false)
  })

  it('honours a cached required hint in the restrictive direction', () => {
    cache('required')
    expect(__reinitVitalsConsentPolicyFromStorageForTests()).toBe('required')
    expect(getVitalsConsentDecision()).toBe('drop')
  })

  it('does not let a cached required hint authorise an accepted user', () => {
    cache('required')
    __reinitVitalsConsentPolicyFromStorageForTests()
    setConsent('accepted')
    // Permitted under BOTH possible live policies — but the cache still may
    // not authorise. Hold until the live policy lands, losing nothing.
    expect(getVitalsConsentDecision()).toBe('hold')

    setVitalsConsentRequirement(true)
    expect(getVitalsConsentDecision()).toBe('send')
  })

  it('honours an explicit decline before the policy resolves', () => {
    cache('not-required')
    __reinitVitalsConsentPolicyFromStorageForTests()
    setConsent('declined')
    expect(getVitalsConsentDecision()).toBe('drop')
  })

  it('persists both resolved values so the hint tracks the last known truth', () => {
    setVitalsConsentPolicy('required')
    expect(JSON.parse(localStorage.getItem(CONSENT_POLICY_STORAGE_KEY) as string).policy).toBe(
      'required',
    )
    expect(getRestrictiveConsentHint()).toBe('required')

    setVitalsConsentPolicy('not-required')
    expect(JSON.parse(localStorage.getItem(CONSENT_POLICY_STORAGE_KEY) as string).policy).toBe(
      'not-required',
    )
    // A live not-required must clear the in-memory restrictive hint too, so a
    // stale `required` cannot keep gating the rest of this page load.
    expect(getRestrictiveConsentHint()).toBeNull()
  })

  it('never persists unknown', () => {
    setVitalsConsentPolicy('required')
    setVitalsConsentPolicy('unknown')
    expect(JSON.parse(localStorage.getItem(CONSENT_POLICY_STORAGE_KEY) as string).policy).toBe(
      'required',
    )
  })

  it('expires a stale required hint and falls back to HOLD', () => {
    cache('required', POLICY_HINT_TTL_MS + 1)
    expect(__reinitVitalsConsentPolicyFromStorageForTests()).toBeNull()
    expect(getVitalsConsentDecision()).toBe('hold')
  })

  it.each([
    ['not JSON at all', 'garbage'],
    ['unknown policy value', JSON.stringify({ policy: 'maybe', at: Date.now() })],
    ['missing timestamp', JSON.stringify({ policy: 'required' })],
    ['non-numeric timestamp', JSON.stringify({ policy: 'required', at: 'now' })],
    ['persisted unknown', JSON.stringify({ policy: 'unknown', at: Date.now() })],
  ])('falls back to HOLD on a corrupt hint (%s)', (_label, raw) => {
    localStorage.setItem(CONSENT_POLICY_STORAGE_KEY, raw)
    expect(__reinitVitalsConsentPolicyFromStorageForTests()).toBeNull()
    expect(getVitalsConsentDecision()).toBe('hold')
  })
})

describe('webVitalsConsent — resolution notifications', () => {
  beforeEach(() => {
    localStorage.clear()
    clearConsent()
    resetVitalsConsentRequirementForTests('unknown')
  })

  afterEach(() => {
    localStorage.clear()
    clearConsent()
    resetVitalsConsentRequirementForTests('unknown')
  })

  it('notifies subscribers when the policy resolves', () => {
    const seen: string[] = []
    const unsubscribe = subscribeVitalsConsentPolicy(next => seen.push(next))

    setVitalsConsentRequirement(false)
    setVitalsConsentRequirement(false) // no duplicate notification
    setVitalsConsentRequirement(true)

    expect(seen).toEqual(['not-required', 'required'])
    unsubscribe()

    setVitalsConsentRequirement(false)
    expect(seen).toEqual(['not-required', 'required'])
  })

  it('survives a throwing subscriber', () => {
    const seen: string[] = []
    subscribeVitalsConsentPolicy(() => {
      throw new Error('boom')
    })
    subscribeVitalsConsentPolicy(next => seen.push(next))

    expect(() => setVitalsConsentRequirement(false)).not.toThrow()
    expect(seen).toEqual(['not-required'])
  })
})
