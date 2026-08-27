import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Consent-policy gate coverage.
 *
 * Two things are under test:
 *
 *  1. The gate publishes the LIVE `require_cookie_consent` policy, and treats
 *     loading and error alike as "unknown" (HOLD, transmit nothing).
 *  2. It is mounted at the App root, ABOVE `<Routes>`, so the policy also
 *     resolves on the standalone routes that never mount `<Layout>` —
 *     `/s/:token` and `/watch`. Before this, those surfaces (the ones we hand
 *     to anonymous visitors) never resolved a policy at all.
 */

const { versionQueryResult, errorReporterConsentSpy } = vi.hoisted(() => ({
  versionQueryResult: { current: { data: undefined as unknown } },
  errorReporterConsentSpy: vi.fn(),
}))

vi.mock('@/api/hooks/useSettings', () => ({
  useVersionInfo: () => versionQueryResult.current,
}))

vi.mock('@/lib/errorReporter', () => ({
  setErrorReporterConsentRequirement: errorReporterConsentSpy,
  reportFrontendError: vi.fn(),
  installGlobalErrorReporting: vi.fn(),
}))

import { VitalsConsentPolicyGate } from '../VitalsConsentPolicyGate'
import {
  CONSENT_POLICY_STORAGE_KEY,
  __reinitVitalsConsentPolicyFromStorageForTests,
  getRestrictiveConsentHint,
  getVitalsConsentDecision,
  getVitalsConsentPolicy,
  resetVitalsConsentRequirementForTests,
} from '@/lib/webVitalsConsent'
import { clearConsent, setConsent } from '@/lib/cookieConsent'

function cachePolicy(policy: 'required' | 'not-required', ageMs = 0): void {
  localStorage.setItem(
    CONSENT_POLICY_STORAGE_KEY,
    JSON.stringify({ policy, at: Date.now() - ageMs }),
  )
}

function setVersion(data: unknown): void {
  versionQueryResult.current = { data }
}

function renderGate(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <VitalsConsentPolicyGate />
    </MemoryRouter>,
  )
}

describe('VitalsConsentPolicyGate', () => {
  beforeEach(() => {
    localStorage.clear()
    clearConsent()
    resetVitalsConsentRequirementForTests('unknown')
    setVersion(undefined)
    errorReporterConsentSpy.mockReset()
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
    clearConsent()
    resetVitalsConsentRequirementForTests('unknown')
  })

  it('holds while the version query is still loading', () => {
    setVersion(undefined)
    renderGate()

    expect(getVitalsConsentPolicy()).toBe('unknown')
    expect(getVitalsConsentDecision()).toBe('hold')
    // The unresolved state is published EXPLICITLY to the error reporter too,
    // so it fails closed instead of inheriting a permissive default.
    expect(errorReporterConsentSpy).toHaveBeenCalledWith(undefined)
  })

  it('publishes the unresolved state to both reporters on a query failure', () => {
    setVersion(undefined)
    renderGate()

    expect(getVitalsConsentPolicy()).toBe('unknown')
    expect(errorReporterConsentSpy).toHaveBeenCalledTimes(1)
    expect(errorReporterConsentSpy).toHaveBeenCalledWith(undefined)
  })

  it('holds when the version query fails with no cached response', () => {
    // A failed `/system/version` leaves `data` undefined — indistinguishable
    // from loading, and treated the same way: unknown → hold.
    setVersion(undefined)
    renderGate()

    expect(getVitalsConsentPolicy()).toBe('unknown')
    expect(getVitalsConsentDecision()).toBe('hold')
  })

  it('a query failure does not let a cached not-required hint authorise sending', () => {
    cachePolicy('not-required')
    expect(__reinitVitalsConsentPolicyFromStorageForTests()).toBeNull()

    setVersion(undefined) // query errored
    renderGate()

    expect(getVitalsConsentPolicy()).toBe('unknown')
    expect(getVitalsConsentDecision()).toBe('hold')
  })

  it('resolves not-required and authorises sending', () => {
    setVersion({ require_cookie_consent: false })
    renderGate()

    expect(getVitalsConsentPolicy()).toBe('not-required')
    expect(getVitalsConsentDecision()).toBe('send')
    expect(errorReporterConsentSpy).toHaveBeenCalledWith(false)
  })

  it('resolves required and blocks sending until the user accepts', () => {
    setVersion({ require_cookie_consent: true })
    renderGate()

    expect(getVitalsConsentPolicy()).toBe('required')
    expect(getVitalsConsentDecision()).toBe('drop')
    expect(errorReporterConsentSpy).toHaveBeenCalledWith(true)

    setConsent('accepted')
    expect(getVitalsConsentDecision()).toBe('send')
  })

  it('republishes when the policy flips mid-session', () => {
    setVersion({ require_cookie_consent: false })
    const view = renderGate()
    expect(getVitalsConsentDecision()).toBe('send')

    setVersion({ require_cookie_consent: true })
    act(() => {
      view.rerender(
        <MemoryRouter initialEntries={['/']}>
          <VitalsConsentPolicyGate />
        </MemoryRouter>,
      )
    })

    expect(getVitalsConsentPolicy()).toBe('required')
    expect(getVitalsConsentDecision()).toBe('drop')
  })
})

describe('VitalsConsentPolicyGate :: cached hint is restrictive-only', () => {
  beforeEach(() => {
    localStorage.clear()
    clearConsent()
    resetVitalsConsentRequirementForTests('unknown')
    setVersion(undefined)
    errorReporterConsentSpy.mockReset()
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
    clearConsent()
    resetVitalsConsentRequirementForTests('unknown')
  })

  it('a cached not-required hint is ignored on load and never authorises a send', () => {
    cachePolicy('not-required')
    expect(__reinitVitalsConsentPolicyFromStorageForTests()).toBeNull()
    expect(getRestrictiveConsentHint()).toBeNull()
    expect(getVitalsConsentDecision()).toBe('hold')
  })

  it('a cached required hint keeps the gate closed before resolution', () => {
    cachePolicy('required')
    expect(__reinitVitalsConsentPolicyFromStorageForTests()).toBe('required')
    expect(getVitalsConsentDecision()).toBe('drop')
  })

  it('a cached required hint still cannot authorise an accepted user', () => {
    cachePolicy('required')
    __reinitVitalsConsentPolicyFromStorageForTests()
    setConsent('accepted')
    // Accepted + cached-required would be permitted under either live policy,
    // but the cache is never allowed to authorise: HOLD until resolution.
    expect(getVitalsConsentDecision()).toBe('hold')

    setVersion({ require_cookie_consent: true })
    renderGate()
    expect(getVitalsConsentDecision()).toBe('send')
  })

  it('clears a stale required hint once the live policy says not-required', () => {
    cachePolicy('required')
    __reinitVitalsConsentPolicyFromStorageForTests()
    expect(getRestrictiveConsentHint()).toBe('required')

    setVersion({ require_cookie_consent: false })
    renderGate()

    expect(getRestrictiveConsentHint()).toBeNull()
    expect(getVitalsConsentDecision()).toBe('send')
    expect(JSON.parse(localStorage.getItem(CONSENT_POLICY_STORAGE_KEY) as string).policy).toBe(
      'not-required',
    )
  })

  it('honours an explicit decline before the policy resolves', () => {
    cachePolicy('not-required')
    __reinitVitalsConsentPolicyFromStorageForTests()
    setConsent('declined')
    expect(getVitalsConsentDecision()).toBe('drop')
  })
})
