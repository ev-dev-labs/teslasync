import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { renderRoot } = vi.hoisted(() => ({ renderRoot: vi.fn() }))
vi.mock('react-dom/client', () => ({ default: { createRoot: () => ({ render: renderRoot }) } }))
vi.mock('./App', () => ({ default: () => null }))
vi.mock('./lib/errorReporter', () => ({ installGlobalErrorReporting: vi.fn(), reportFrontendError: vi.fn() }))
vi.mock('virtual:pwa-register/react', () => ({ useRegisterSW: vi.fn() }))
vi.mock('web-vitals', () => ({
  onCLS: vi.fn(), onINP: vi.fn(), onLCP: vi.fn(), onFCP: vi.fn(), onTTFB: vi.fn(),
}))

beforeEach(() => {
  vi.resetModules()
  renderRoot.mockClear()
  window.localStorage.clear()
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function savedAndroidConnection(load: () => Promise<{ url: string; token: string }>) {
  window.localStorage.setItem('teslasync-server-base-url', 'https://saved.example.com')
  window.localStorage.setItem('teslasync-server-token-required', '1')
  window.localStorage.setItem('teslasync-native-connection', '1')
  vi.stubGlobal('Capacitor', {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    Plugins: { ServerConnection: { load, save: vi.fn(), clear: vi.fn() } },
  })
}

describe('connection-aware application startup', () => {
  it('restores Android credentials before mounting API providers or choosing the connect screen', async () => {
    let finishRestore: (value: { url: string; token: string }) => void = () => {
      throw new Error('Restore not started')
    }
    const load = vi.fn(() => new Promise<{ url: string; token: string }>((resolve) => {
      finishRestore = resolve
    }))
    savedAndroidConnection(load)

    await import('./main')
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce())
    expect(renderRoot).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/')

    finishRestore({ url: 'https://saved.example.com', token: 'ts_test_only' })

    await vi.waitFor(() => expect(renderRoot).toHaveBeenCalledOnce())
    expect(window.location.pathname).toBe('/')
    expect(window.sessionStorage.getItem('teslasync-access-token')).toBe('ts_test_only')
  })

  it('still opens setup when native restoration fails instead of leaving the splash stuck', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    savedAndroidConnection(vi.fn().mockRejectedValue(new Error('Keystore unavailable')))

    await import('./main')

    await vi.waitFor(() => expect(renderRoot).toHaveBeenCalledOnce())
    expect(window.location.pathname).toBe('/connect')
    expect(window.sessionStorage.getItem('teslasync-access-token')).toBeNull()
    expect(warn).toHaveBeenCalledWith('Could not restore native connection storage')
  })

  it('does not delay ordinary browser startup on a native bridge', async () => {
    await import('./main')

    expect(renderRoot).toHaveBeenCalledOnce()
    expect(window.location.pathname).toBe('/')
  })
})
