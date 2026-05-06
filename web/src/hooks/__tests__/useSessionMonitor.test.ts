import { describe, it, expect } from 'vitest'
import { deriveSessionState, SESSION_EXPIRING_THRESHOLD_S } from '../useSessionMonitor'
import type { SessionInfo } from '@/api/types'

/**
 * Phase-46 / Prompt 05 — useSessionMonitor unit tests.
 *
 * The hook itself is a thin wrapper around useQuery + a 1Hz tick.
 * The non-trivial logic is in {@link deriveSessionState}, which is
 * exported so tests can exercise it without spinning up a
 * QueryClient.
 */

const NOW = Date.parse('2025-05-04T12:00:00Z')

function session(overrides: Partial<SessionInfo>): SessionInfo {
  return {
    authenticated: true,
    mode: 'session',
    expires_at: null,
    expires_in: null,
    user: { sub: 'alice@example.com' },
    renewable: true,
    ...overrides,
  }
}

describe('deriveSessionState', () => {
  it('reports mode=unknown when data is missing', () => {
    const state = deriveSessionState(null, NOW)
    expect(state.mode).toBe('unknown')
    expect(state.expiresInSeconds).toBeNull()
    expect(state.isExpiringSoon).toBe(false)
    expect(state.hasExpired).toBe(false)
    expect(state.renewable).toBe(false)
  })

  it('open mode → no expiry tracking, never expired', () => {
    const state = deriveSessionState(
      { authenticated: true, mode: 'open', expires_at: null, expires_in: null, user: null, renewable: false },
      NOW,
    )
    expect(state.mode).toBe('open')
    expect(state.expiresInSeconds).toBeNull()
    expect(state.isExpiringSoon).toBe(false)
    expect(state.hasExpired).toBe(false)
  })

  it('authenticated=false → hasExpired immediately', () => {
    const state = deriveSessionState(
      session({ authenticated: false, user: null }),
      NOW,
    )
    expect(state.hasExpired).toBe(true)
    expect(state.isExpiringSoon).toBe(false)
  })

  it('expires_at within threshold → isExpiringSoon true', () => {
    const within = new Date(NOW + 30 * 1000).toISOString()
    const state = deriveSessionState(session({ expires_at: within }), NOW)
    expect(state.expiresInSeconds).toBe(30)
    expect(state.isExpiringSoon).toBe(true)
    expect(state.hasExpired).toBe(false)
  })

  it('expires_at well beyond threshold → no warning', () => {
    const far = new Date(NOW + 10 * 60 * 1000).toISOString()
    const state = deriveSessionState(session({ expires_at: far }), NOW)
    expect(state.expiresInSeconds).toBe(600)
    expect(state.isExpiringSoon).toBe(false)
    expect(state.hasExpired).toBe(false)
  })

  it('expires_at in the past → hasExpired', () => {
    const past = new Date(NOW - 5 * 1000).toISOString()
    const state = deriveSessionState(session({ expires_at: past }), NOW)
    expect(state.expiresInSeconds).toBeLessThanOrEqual(0)
    expect(state.hasExpired).toBe(true)
    expect(state.isExpiringSoon).toBe(false)
  })

  it('falls back to expires_in when expires_at is missing', () => {
    const state = deriveSessionState(
      session({ expires_at: null, expires_in: 45 }),
      NOW,
    )
    expect(state.expiresInSeconds).toBe(45)
    expect(state.isExpiringSoon).toBe(true)
  })

  it('falls back to expires_in when expires_at is unparseable', () => {
    const state = deriveSessionState(
      session({ expires_at: 'not-a-date', expires_in: 120 }),
      NOW,
    )
    expect(state.expiresInSeconds).toBe(120)
    expect(state.isExpiringSoon).toBe(false)
  })

  it('reports null expiresIn when neither field is usable', () => {
    const state = deriveSessionState(
      session({ expires_at: null, expires_in: null }),
      NOW,
    )
    expect(state.expiresInSeconds).toBeNull()
    expect(state.isExpiringSoon).toBe(false)
    expect(state.hasExpired).toBe(false)
  })

  it('boundary: equal-to threshold is NOT "expiring soon"', () => {
    // The threshold is strict-less-than on purpose: a banner that flips
    // on exactly at the boundary would briefly show "60s remaining"
    // which is the same value the polling response carries — looks
    // like a glitch. Match the implementation: < threshold only.
    const at = new Date(NOW + SESSION_EXPIRING_THRESHOLD_S * 1000).toISOString()
    const state = deriveSessionState(session({ expires_at: at }), NOW)
    expect(state.isExpiringSoon).toBe(false)
  })

  it('renewable flag passes through when authenticated', () => {
    const state = deriveSessionState(
      session({ expires_at: null, renewable: false }),
      NOW,
    )
    expect(state.renewable).toBe(false)
  })
})
