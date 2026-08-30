import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'

/**
 * HELP-12 client wiring (correction round).
 *
 * `apiUrl()` is the single place every outbound request resolves its
 * destination, so it is where "demo mode routes only to the demo base" either
 * is or is not true. These tests drive it through the real module with
 * `import.meta.env` stubbed, rather than asserting on the pure helper alone.
 */

const ORIGINAL_ENV = { ...import.meta.env }

async function loadClient() {
  vi.resetModules()
  return await import('../client')
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  // `vi.stubEnv` mutates the shared env object; restore it so unrelated
  // suites are unaffected by whatever this one configured.
  for (const key of Object.keys(import.meta.env)) {
    if (!(key in ORIGINAL_ENV)) {
      vi.stubEnv(key as 'VITE_APP_VERSION', undefined as unknown as string)
    }
  }
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('apiUrl — normal mode', () => {
  it('routes to the production /api/v1 path', async () => {
    const { apiUrl } = await loadClient()
    expect(apiUrl('/vehicles')).toBe('/api/v1/vehicles')
  })

  it('is unaffected by a demo base when the flag is absent', async () => {
    vi.stubEnv('VITE_DEMO_API_BASE', '/demo-api/v1')
    const { apiUrl } = await loadClient()
    expect(apiUrl('/vehicles')).toBe('/api/v1/vehicles')
  })

  it('is unaffected when the flag is set but the base is missing (fail closed)', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'true')
    const { apiUrl } = await loadClient()
    expect(apiUrl('/vehicles')).toBe('/api/v1/vehicles')
  })

  it('is unaffected when the demo base collides with production (fail closed)', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'true')
    vi.stubEnv('VITE_DEMO_API_BASE', '/api/v1')
    const { apiUrl } = await loadClient()
    expect(apiUrl('/vehicles')).toBe('/api/v1/vehicles')
  })
})

describe('apiUrl — demo mode', () => {
  it('routes every request to the isolated demo base and never to production', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'true')
    vi.stubEnv('VITE_DEMO_API_BASE', '/demo-api/v1')
    const { apiUrl } = await loadClient()

    for (const path of ['/vehicles', '/drives', '/system/health', 'settings']) {
      const url = apiUrl(path)
      expect(url.startsWith('/demo-api/v1'), url).toBe(true)
      expect(url.includes('/api/v1'), url).toBe(false)
    }
  })

  it('still strips a stray /api/v1 prefix a caller passed', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'true')
    vi.stubEnv('VITE_DEMO_API_BASE', '/demo-api/v1')
    const { apiUrl } = await loadClient()
    expect(apiUrl('/api/v1/vehicles')).toBe('/demo-api/v1/vehicles')
  })

  it('routes to an absolute cross-origin demo base', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'true')
    vi.stubEnv('VITE_DEMO_API_BASE', 'https://demo.example.com/api/v1')
    const { apiUrl } = await loadClient()
    expect(apiUrl('/vehicles')).toBe('https://demo.example.com/api/v1/vehicles')
  })
})

describe('demo helpers are unreachable in normal mode', () => {
  it('refuses to namespace storage keys', async () => {
    const { demoStorageKey } = await import('@/lib/demoMode')
    expect(() => demoStorageKey('saved-views')).toThrow(/demo mode is disabled/)
  })

  it('refuses to namespace query keys', async () => {
    const { demoQueryKey } = await import('@/lib/demoMode')
    expect(() => demoQueryKey(['vehicles'])).toThrow(/demo mode is disabled/)
  })

  it('refuses to guard a synthetic-data path', async () => {
    const { assertDemoModeEnabled } = await import('@/lib/demoMode')
    expect(() => assertDemoModeEnabled()).toThrow(/flag_absent/)
  })
})
