import { describe, it, expect, afterEach } from 'vitest'

import {
  DEMO_QUERY_KEY_PREFIX,
  DEMO_STORAGE_NAMESPACE,
  PRODUCTION_API_BASE,
  assertDemoModeEnabled,
  demoQueryKey,
  demoStorageKey,
  isDemoModeEnabled,
  isDemoQueryKey,
  isDemoStorageKey,
  purgeDemoStorage,
  resolveDemoMode,
} from '../demoMode'

/**
 * HELP-12. Demo mode is the one feature where a false negative is harmless and
 * a false positive is a data-integrity incident: synthetic degradation figures
 * rendered next to a real VIN are indistinguishable from real ones.
 *
 * So every test below asserts the same thing from a different angle — that the
 * guard refuses to enable unless the configuration is complete AND isolated.
 */

const ENABLED = { VITE_DEMO_MODE: 'true', VITE_DEMO_API_BASE: '/demo-api/v1' }

afterEach(() => {
  window.localStorage.clear()
})

describe('production-collision guard', () => {
  // String equality against the literal `/api/v1` let several spellings of the
  // production API through, each of which would have run demo mode over real
  // vehicle data while displaying a "DEMO DATA" banner.

  it('rejects the literal production base', () => {
    expect(
      resolveDemoMode({ VITE_DEMO_MODE: 'true', VITE_DEMO_API_BASE: '/api/v1' }),
    ).toEqual({ enabled: false, reason: 'demo_api_base_collides_with_production' })
  })

  it('rejects a same-origin ABSOLUTE spelling of the production base', () => {
    const absolute = `${window.location.origin}/api/v1`
    expect(
      resolveDemoMode({ VITE_DEMO_MODE: 'true', VITE_DEMO_API_BASE: absolute }).enabled,
    ).toBe(false)
  })

  it('rejects a trailing-slash spelling', () => {
    expect(
      resolveDemoMode({ VITE_DEMO_MODE: 'true', VITE_DEMO_API_BASE: '/api/v1/' }).enabled,
    ).toBe(false)
    expect(
      resolveDemoMode({
        VITE_DEMO_MODE: 'true',
        VITE_DEMO_API_BASE: `${window.location.origin}/api/v1///`,
      }).enabled,
    ).toBe(false)
  })

  it('rejects a relative spelling with no leading slash', () => {
    expect(
      resolveDemoMode({ VITE_DEMO_MODE: 'true', VITE_DEMO_API_BASE: 'api/v1' }).enabled,
    ).toBe(false)
  })

  it('rejects a base nested INSIDE the production API', () => {
    // Would issue real requests against real endpoints.
    for (const base of ['/api/v1/demo', '/api/v1/vehicles', '/api/v1/demo/v2']) {
      expect(
        resolveDemoMode({ VITE_DEMO_MODE: 'true', VITE_DEMO_API_BASE: base }).enabled,
        base,
      ).toBe(false)
    }
  })

  it('rejects a base that would CONTAIN the production API', () => {
    expect(
      resolveDemoMode({ VITE_DEMO_MODE: 'true', VITE_DEMO_API_BASE: '/api' }).enabled,
    ).toBe(false)
  })

  it('rejects an unresolvable base rather than assuming it is safe', () => {
    expect(
      resolveDemoMode({ VITE_DEMO_MODE: 'true', VITE_DEMO_API_BASE: 'http://[not a url' })
        .enabled,
    ).toBe(false)
  })

  it('ACCEPTS a lookalike path that is genuinely separate', () => {
    // `/api/v1-demo` merely starts with the production string; it is a
    // different path segment, so a naive startsWith would wrongly reject it.
    for (const base of ['/api/v1-demo', '/api/v2', '/demo-api/v1', '/api/demo/v1']) {
      expect(
        resolveDemoMode({ VITE_DEMO_MODE: 'true', VITE_DEMO_API_BASE: base }).enabled,
        base,
      ).toBe(true)
    }
  })

  it('ACCEPTS an absolute base on a different host', () => {
    expect(
      resolveDemoMode({
        VITE_DEMO_MODE: 'true',
        VITE_DEMO_API_BASE: 'https://demo.example.com/api/v1',
      }).enabled,
    ).toBe(true)
  })

  it('fails closed into NORMAL mode — no banner, no demo namespace', () => {
    // The whole point of rejecting a colliding config: the app must behave as
    // if demo mode was never configured at all.
    const colliding = {
      VITE_DEMO_MODE: 'true',
      VITE_DEMO_API_BASE: `${window.location.origin}/api/v1`,
    }
    expect(isDemoModeEnabled(colliding)).toBe(false)
    expect(resolveDemoMode(colliding).apiBase).toBeUndefined()
    expect(() => demoStorageKey('saved-views', colliding)).toThrow(/demo mode is disabled/)
    expect(() => demoQueryKey(['vehicles'], colliding)).toThrow(/demo mode is disabled/)
    expect(() => assertDemoModeEnabled(colliding)).toThrow(
      /demo_api_base_collides_with_production/,
    )
  })
})

describe('resolveDemoMode — fail-closed', () => {
  it('is disabled with no configuration at all', () => {
    expect(resolveDemoMode({})).toEqual({ enabled: false, reason: 'flag_absent' })
  })

  it('is disabled for every truthy-looking value that is not exactly "true"', () => {
    for (const value of ['1', 'yes', 'TRUE', 'True', 'on', ' true']) {
      const state = resolveDemoMode({ ...ENABLED, VITE_DEMO_MODE: value })
      expect(state.enabled).toBe(false)
      expect(state.reason).toBe('flag_not_exact_true')
    }
  })

  it('is disabled when the flag is set but no isolated API base is configured', () => {
    expect(resolveDemoMode({ VITE_DEMO_MODE: 'true' })).toEqual({
      enabled: false,
      reason: 'demo_api_base_missing',
    })
  })

  it('is disabled when the demo API base IS the production base', () => {
    expect(
      resolveDemoMode({ VITE_DEMO_MODE: 'true', VITE_DEMO_API_BASE: PRODUCTION_API_BASE }),
    ).toEqual({ enabled: false, reason: 'demo_api_base_collides_with_production' })
  })

  it('ignores a trailing slash when comparing against the production base', () => {
    expect(
      resolveDemoMode({ VITE_DEMO_MODE: 'true', VITE_DEMO_API_BASE: '/api/v1/' }).enabled,
    ).toBe(false)
  })

  it('enables only when the flag is exact AND the base is isolated', () => {
    expect(resolveDemoMode(ENABLED)).toEqual({ enabled: true, apiBase: '/demo-api/v1' })
    expect(isDemoModeEnabled(ENABLED)).toBe(true)
  })

  it('is disabled by default in this test environment (no env vars set)', () => {
    // Guards against a stray VITE_DEMO_MODE leaking into a real build.
    expect(isDemoModeEnabled()).toBe(false)
  })
})

describe('storage isolation', () => {
  it('namespaces demo keys', () => {
    expect(demoStorageKey('saved-views', ENABLED)).toBe(
      `${DEMO_STORAGE_NAMESPACE}saved-views`,
    )
  })

  it('is idempotent — an already-namespaced key is not double-prefixed', () => {
    const key = demoStorageKey('x', ENABLED)
    expect(demoStorageKey(key, ENABLED)).toBe(key)
  })

  it('throws rather than returning a production key when demo mode is off', () => {
    expect(() => demoStorageKey('saved-views', {})).toThrow(/demo mode is disabled/)
  })

  it('rejects an empty key', () => {
    expect(() => demoStorageKey('   ', ENABLED)).toThrow()
  })

  it('recognises namespaced keys in any mode', () => {
    expect(isDemoStorageKey(`${DEMO_STORAGE_NAMESPACE}x`)).toBe(true)
    expect(isDemoStorageKey('teslasync:settings')).toBe(false)
  })

  it('purges only demo keys and never real ones', () => {
    window.localStorage.setItem('teslasync:settings', 'real')
    window.localStorage.setItem(`${DEMO_STORAGE_NAMESPACE}a`, '1')
    window.localStorage.setItem(`${DEMO_STORAGE_NAMESPACE}b`, '2')

    expect(purgeDemoStorage()).toBe(2)
    expect(window.localStorage.getItem('teslasync:settings')).toBe('real')
    expect(window.localStorage.getItem(`${DEMO_STORAGE_NAMESPACE}a`)).toBeNull()
  })
})

describe('query-cache isolation', () => {
  it('namespaces query keys so demo data cannot be served from the real cache', () => {
    expect(demoQueryKey(['vehicles'], ENABLED)).toEqual([DEMO_QUERY_KEY_PREFIX, 'vehicles'])
  })

  it('throws when demo mode is off', () => {
    expect(() => demoQueryKey(['vehicles'], {})).toThrow(/demo mode is disabled/)
  })

  it('recognises namespaced query keys', () => {
    expect(isDemoQueryKey([DEMO_QUERY_KEY_PREFIX, 'vehicles'])).toBe(true)
    expect(isDemoQueryKey(['vehicles'])).toBe(false)
    expect(isDemoQueryKey(undefined as unknown as unknown[])).toBe(false)
  })
})

describe('assertDemoModeEnabled', () => {
  it('throws with the machine-readable reason when disabled', () => {
    expect(() => assertDemoModeEnabled({})).toThrow(/flag_absent/)
    expect(() => assertDemoModeEnabled({ VITE_DEMO_MODE: 'true' })).toThrow(
      /demo_api_base_missing/,
    )
  })

  it('is a no-op when fully configured', () => {
    expect(() => assertDemoModeEnabled(ENABLED)).not.toThrow()
  })
})
