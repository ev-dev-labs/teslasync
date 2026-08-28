import { describe, it, expect, afterEach, vi } from 'vitest'

import {
  demoCredentialsMode,
  getDemoApiBase,
  isDemoBaseCrossOrigin,
  stripCredentialHeadersForDemo,
} from '../demoMode'

/**
 * HELP-12 request routing (correction round).
 *
 * The first slice validated an isolated demo API base and then never used it:
 * `resolveDemoMode().apiBase` was computed and discarded, so a build with demo
 * mode "on" rendered the DEMO DATA banner over live production data. That is
 * the worst available outcome — it labels real data as synthetic and trains
 * the user to ignore the banner.
 *
 * These tests pin the routing contract at the pure-function boundary, which is
 * where the decision is actually made. The client-level wiring is covered by
 * `api/__tests__/clientDemoRouting.test.ts`.
 */

const ENABLED_SAME_ORIGIN = {
  VITE_DEMO_MODE: 'true',
  VITE_DEMO_API_BASE: '/demo-api/v1',
}

const ENABLED_CROSS_ORIGIN = {
  VITE_DEMO_MODE: 'true',
  VITE_DEMO_API_BASE: 'https://demo.example.com/api/v1',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('getDemoApiBase — authoritative only when fully enabled', () => {
  it('returns null with no configuration', () => {
    expect(getDemoApiBase({})).toBeNull()
  })

  it('returns null when the flag is set but the base is missing', () => {
    expect(getDemoApiBase({ VITE_DEMO_MODE: 'true' })).toBeNull()
  })

  it('returns null when the base collides with the production base', () => {
    expect(
      getDemoApiBase({ VITE_DEMO_MODE: 'true', VITE_DEMO_API_BASE: '/api/v1' }),
    ).toBeNull()
  })

  it('returns null for a near-miss flag value', () => {
    expect(
      getDemoApiBase({ ...ENABLED_SAME_ORIGIN, VITE_DEMO_MODE: 'TRUE' }),
    ).toBeNull()
  })

  it('returns the validated base only when everything checks out', () => {
    expect(getDemoApiBase(ENABLED_SAME_ORIGIN)).toBe('/demo-api/v1')
    expect(getDemoApiBase(ENABLED_CROSS_ORIGIN)).toBe('https://demo.example.com/api/v1')
  })

  it('is null in this test environment, so normal mode is the default', () => {
    expect(getDemoApiBase()).toBeNull()
  })
})

describe('cross-origin credential protection', () => {
  it('treats a root-relative demo base as same-origin', () => {
    expect(isDemoBaseCrossOrigin(ENABLED_SAME_ORIGIN)).toBe(false)
    expect(demoCredentialsMode(ENABLED_SAME_ORIGIN)).toBeUndefined()
  })

  it('treats an absolute demo base on another host as cross-origin', () => {
    expect(isDemoBaseCrossOrigin(ENABLED_CROSS_ORIGIN)).toBe(true)
    expect(demoCredentialsMode(ENABLED_CROSS_ORIGIN)).toBe('omit')
  })

  it('is never cross-origin in normal mode', () => {
    expect(isDemoBaseCrossOrigin({})).toBe(false)
    expect(demoCredentialsMode({})).toBeUndefined()
  })

  it('drops identity headers for a cross-origin demo base', () => {
    const headers = new Headers({
      Accept: 'application/json',
      Authorization: 'Bearer production-secret',
      'X-Sudo-Token': 'sudo-secret',
    })

    stripCredentialHeadersForDemo(headers, ENABLED_CROSS_ORIGIN)

    expect(headers.get('authorization')).toBeNull()
    expect(headers.get('x-sudo-token')).toBeNull()
    // Non-credential headers survive — this is a filter, not a reset.
    expect(headers.get('accept')).toBe('application/json')
  })

  it('leaves headers untouched in normal mode', () => {
    const headers = new Headers({ 'X-Sudo-Token': 'sudo-secret' })
    stripCredentialHeadersForDemo(headers, {})
    expect(headers.get('x-sudo-token')).toBe('sudo-secret')
  })

  it('leaves headers untouched for a same-origin demo base', () => {
    const headers = new Headers({ 'X-Sudo-Token': 'sudo-secret' })
    stripCredentialHeadersForDemo(headers, ENABLED_SAME_ORIGIN)
    expect(headers.get('x-sudo-token')).toBe('sudo-secret')
  })

  it('never reaches the credential question for an unresolvable base', () => {
    const env = { VITE_DEMO_MODE: 'true', VITE_DEMO_API_BASE: 'https://[not a url' }
    // The collision guard now rejects an unresolvable base outright — demo
    // mode is simply off, which is stronger than "on, but withholding
    // credentials". There is no cross-origin question left to answer.
    expect(getDemoApiBase(env)).toBeNull()
    expect(isDemoBaseCrossOrigin(env)).toBe(false)
    expect(demoCredentialsMode(env)).toBeUndefined()
  })
})
