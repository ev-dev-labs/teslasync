import { describe, it, expect } from 'vitest'
import {
  NAV_AUTH_MODES,
  NAV_CAPABILITIES,
  hasNavCapability,
  isNavAuthModeResolved,
  normalizeNavAuthMode,
  resolveNavCapabilities,
  resolveNavCapabilitiesFromAuthMode,
  type NavCapability,
} from '../navCapabilities'
import type { AuthModeResponse } from '@/api/types'

function authMode(overrides: Partial<AuthModeResponse> = {}): AuthModeResponse {
  return {
    mode: 'forward_auth',
    capabilities: {
      step_up_reauth: true,
      totp_enrollment: true,
      session_list: true,
      impersonation: false,
      rbac: true,
    },
    ...overrides,
  } as AuthModeResponse
}

const PRIVILEGED: NavCapability[] = ['administration', 'developer']

describe('normalizeNavAuthMode', () => {
  it('accepts exactly the two contract modes', () => {
    expect(normalizeNavAuthMode('open')).toBe('open')
    expect(normalizeNavAuthMode('forward_auth')).toBe('forward_auth')
    expect([...NAV_AUTH_MODES]).toEqual(['open', 'forward_auth'])
  })

  it('rejects anything else as unresolved', () => {
    for (const value of [undefined, null, '', 'oidc', 'OPEN', 0, {}, []]) {
      expect(normalizeNavAuthMode(value), String(value)).toBeNull()
    }
  })
})

describe('resolveNavCapabilities — fail closed', () => {
  it('grants only core when the contract has not resolved', () => {
    expect([...resolveNavCapabilities()]).toEqual(['core'])
    expect([...resolveNavCapabilities({ authMode: undefined })]).toEqual(['core'])
    expect([...resolveNavCapabilities({ authMode: null })]).toEqual(['core'])
  })

  it('withholds privileged capabilities while the contract is in flight', () => {
    const granted = resolveNavCapabilities({ authMode: null })
    for (const capability of PRIVILEGED) {
      expect(granted.has(capability), capability).toBe(false)
    }
    expect(granted.has('account')).toBe(false)
  })

  it('withholds privileged capabilities when the request failed (no data)', () => {
    const granted = resolveNavCapabilitiesFromAuthMode(undefined)
    for (const capability of PRIVILEGED) {
      expect(granted.has(capability), capability).toBe(false)
    }
    expect(granted.has('core')).toBe(true)
  })

  it('withholds privileged capabilities for an unrecognized mode string', () => {
    const granted = resolveNavCapabilitiesFromAuthMode(
      authMode({ mode: 'saml' as AuthModeResponse['mode'] }),
    )
    expect(granted.has('administration')).toBe(false)
    expect(granted.has('developer')).toBe(false)
    expect(granted.has('account')).toBe(false)
  })

  it('does not treat a capabilities-only payload as a confirmed mode', () => {
    const granted = resolveNavCapabilities({ authCapabilities: { rbac: true } })
    expect(granted.has('administration')).toBe(false)
  })
})

describe('resolveNavCapabilities — confirmed modes', () => {
  it('always grants core', () => {
    expect(resolveNavCapabilities({ authMode: 'open' }).has('core')).toBe(true)
    expect(resolveNavCapabilities({ authMode: 'forward_auth' }).has('core')).toBe(true)
  })

  it('treats CONFIRMED open mode as the local operator', () => {
    const granted = resolveNavCapabilities({ authMode: 'open' })
    expect(granted.has('administration')).toBe(true)
    expect(granted.has('developer')).toBe(true)
    // No identity provider → no per-user account surfaces.
    expect(granted.has('account')).toBe(false)
  })

  it('grants account surfaces only behind confirmed ForwardAuth', () => {
    expect(resolveNavCapabilities({ authMode: 'forward_auth' }).has('account')).toBe(true)
    expect(resolveNavCapabilities({ authMode: 'open' }).has('account')).toBe(false)
  })

  it('defers to the advertised rbac capability behind ForwardAuth', () => {
    const withRbac = resolveNavCapabilities({
      authMode: 'forward_auth',
      authCapabilities: { rbac: true },
    })
    expect(withRbac.has('administration')).toBe(true)
    expect(withRbac.has('developer')).toBe(true)

    const withoutRbac = resolveNavCapabilities({
      authMode: 'forward_auth',
      authCapabilities: { rbac: false },
    })
    expect(withoutRbac.has('administration')).toBe(false)
    expect(withoutRbac.has('developer')).toBe(false)
    // Core is never revoked — the everyday hierarchy is identical for all.
    expect(withoutRbac.has('core')).toBe(true)
  })

  it('treats a missing capabilities envelope under ForwardAuth as no rbac', () => {
    const granted = resolveNavCapabilities({
      authMode: 'forward_auth',
      authCapabilities: null,
    })
    expect(granted.has('administration')).toBe(false)
  })

  it('never invents a capability outside the declared set', () => {
    const granted = resolveNavCapabilities({ authMode: 'open' })
    for (const capability of granted) {
      expect(NAV_CAPABILITIES).toContain(capability)
    }
  })

  it('is independent of the product persona (persona orders, it does not grant)', () => {
    const asOwner = resolveNavCapabilities({ authMode: 'forward_auth', persona: 'owner' })
    const asAdmin = resolveNavCapabilities({
      authMode: 'forward_auth',
      persona: 'administrator',
    })
    expect([...asOwner].sort()).toEqual([...asAdmin].sort())
  })
})

describe('resolveNavCapabilitiesFromAuthMode', () => {
  it('reads the raw contract envelope', () => {
    const granted = resolveNavCapabilitiesFromAuthMode(authMode())
    expect(granted.has('account')).toBe(true)
    expect(granted.has('administration')).toBe(true)
  })

  it('withholds privileged capabilities when rbac is not advertised', () => {
    const granted = resolveNavCapabilitiesFromAuthMode(
      authMode({
        capabilities: {
          step_up_reauth: true,
          totp_enrollment: true,
          session_list: true,
          impersonation: false,
          rbac: false,
        },
      }),
    )
    expect(granted.has('administration')).toBe(false)
    expect(granted.has('developer')).toBe(false)
  })

  it('grants operator capabilities for a confirmed open-mode deployment', () => {
    const granted = resolveNavCapabilitiesFromAuthMode(
      authMode({ mode: 'open', capabilities: undefined as never }),
    )
    expect(granted.has('administration')).toBe(true)
    expect(granted.has('developer')).toBe(true)
    expect(granted.has('account')).toBe(false)
  })
})

describe('isNavAuthModeResolved', () => {
  it('reports resolution state for the contract envelope', () => {
    expect(isNavAuthModeResolved(authMode())).toBe(true)
    expect(isNavAuthModeResolved(authMode({ mode: 'open' }))).toBe(true)
    expect(isNavAuthModeResolved(undefined)).toBe(false)
    expect(isNavAuthModeResolved(null)).toBe(false)
    expect(
      isNavAuthModeResolved(authMode({ mode: 'weird' as AuthModeResponse['mode'] })),
    ).toBe(false)
  })
})

describe('hasNavCapability', () => {
  it('always allows core, even without a resolved set', () => {
    expect(hasNavCapability(undefined, 'core')).toBe(true)
    expect(hasNavCapability(null, undefined)).toBe(true)
  })

  it('denies privileged capabilities without a resolved set', () => {
    expect(hasNavCapability(undefined, 'administration')).toBe(false)
  })

  it('reflects set membership', () => {
    const granted = new Set<NavCapability>(['core', 'developer'])
    expect(hasNavCapability(granted, 'developer')).toBe(true)
    expect(hasNavCapability(granted, 'administration')).toBe(false)
  })
})
