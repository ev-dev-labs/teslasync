import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  appIdentityHeaders,
  authHeaders,
  clearAccessToken,
  clearServerConnection,
  getAccessToken,
  getServerBaseUrl,
  isRemoteMode,
  needsServerSetup,
  normalizeServerUrl,
  probeServer,
  serverStreamUrl,
  serverCredentials,
  setServerConnection,
} from './serverConnection'

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  delete window.__TESLASYNC_SHELL__
  vi.unstubAllGlobals()
})

afterEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  delete window.__TESLASYNC_SHELL__
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('normalizeServerUrl', () => {
  it.each([
    ['https://teslasync.example.com', 'https://teslasync.example.com'],
    ['teslasync.example.com', 'https://teslasync.example.com'],
    ['  https://teslasync.example.com/  ', 'https://teslasync.example.com'],
    ['http://192.168.1.10:4000/', 'http://192.168.1.10:4000'],
    ['http://localhost:4000', 'http://localhost:4000'],
    ['myserver.tailnet.ts.net:4000', 'https://myserver.tailnet.ts.net:4000'],
  ])('accepts %q as %q', (input, want) => {
    const result = normalizeServerUrl(input)
    expect(result.accepted).toBe(true)
    expect(result.url).toBe(want)
  })

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['ftp://files.example.com', 'unsupported-scheme'],
    ['javascript:alert(1)', 'unparseable'],
    ['https://user:pass@host.example.com', 'credentials-in-url'],
    ['https://host.example.com/teslasync', 'subpath-not-supported'],
  ])('rejects %q (%s)', (input, rejection) => {
    const result = normalizeServerUrl(input)
    expect(result.accepted).toBe(false)
    expect(result.rejection).toBe(rejection)
  })

  it('rejects non-strings', () => {
    expect(normalizeServerUrl(null).accepted).toBe(false)
    expect(normalizeServerUrl(undefined).accepted).toBe(false)
  })
})

describe('stored connection', () => {
  it('defaults to same-origin with no token', () => {
    expect(getServerBaseUrl()).toBe('')
    expect(getAccessToken()).toBeNull()
    expect(isRemoteMode()).toBe(false)
  })

  it('round-trips a server URL and token', () => {
    setServerConnection('https://srv.example.com', 'ts_test_secret')
    expect(getServerBaseUrl()).toBe('https://srv.example.com')
    expect(getAccessToken()).toBe('ts_test_secret')
    expect(isRemoteMode()).toBe(true)
    expect(window.localStorage.getItem('teslasync-access-token')).toBeNull()
  })

  it('stores a URL without a token', () => {
    setServerConnection('http://192.168.1.5:4000', null)
    expect(isRemoteMode()).toBe(true)
    expect(getAccessToken()).toBeNull()
  })

  it('does not send browser cookies to a remote server', () => {
    expect(serverCredentials()).toBe('include')
    setServerConnection('https://srv.example.com', 'ts_test_secret')
    expect(serverCredentials()).toBe('omit')
  })

  it('rejects non-normalised URLs', () => {
    expect(() => setServerConnection('srv.example.com', null)).toThrow()
    expect(() => setServerConnection('https://srv.example.com/app', null)).toThrow()
  })

  it('clears the connection', () => {
    setServerConnection('https://srv.example.com', 'ts_test_secret')
    clearServerConnection()
    expect(getServerBaseUrl()).toBe('')
    expect(getAccessToken()).toBeNull()
  })

  it('forgets only a rejected token while keeping the server for reconnection', () => {
    window.__TESLASYNC_SHELL__ = 'electron'
    setServerConnection('https://srv.example.com', 'ts_test_secret')
    clearAccessToken()
    expect(getAccessToken()).toBeNull()
    expect(getServerBaseUrl()).toBe('https://srv.example.com')
    expect(needsServerSetup()).toBe(true)
  })

  it('treats a corrupt stored value as same-origin', () => {
    window.localStorage.setItem('teslasync-server-base-url', '::not a url::')
    expect(getServerBaseUrl()).toBe('')
  })
})

describe('serverStreamUrl', () => {
  it('is the identity in same-origin mode', () => {
    expect(serverStreamUrl('/api/v1/events')).toBe('/api/v1/events')
  })

  it('prepends the saved origin in remote mode', () => {
    setServerConnection('https://srv.example.com', null)
    expect(serverStreamUrl('/api/v1/events')).toBe('https://srv.example.com/api/v1/events')
  })
})

describe('authHeaders', () => {
  it('passes headers through untouched without a token', () => {
    const out = authHeaders({ 'Content-Type': 'application/json' })
    expect(out.get('Content-Type')).toBe('application/json')
    expect(out.has('Authorization')).toBe(false)
  })

  it('overlays Bearer when a token is stored', () => {
    setServerConnection('https://srv.example.com', 'ts_test_secret')
    const out = authHeaders({ 'Content-Type': 'application/json' })
    expect(out.get('Authorization')).toBe('Bearer ts_test_secret')
    expect(out.get('Content-Type')).toBe('application/json')
  })

  it('never overwrites an explicit Authorization', () => {
    setServerConnection('https://srv.example.com', 'ts_test_secret')
    const out = authHeaders({ Authorization: 'Basic abc' })
    expect(out.get('Authorization')).toBe('Basic abc')
  })

  it('reuses a distinct per-install ID across token replacement and server switches', () => {
    window.__TESLASYNC_SHELL__ = 'electron'
    setServerConnection('https://srv.example.com', 'ts_test_secret')
    const first = authHeaders().get('X-Teslasync-App')
    expect(first).toMatch(/^(?:windows|macos|linux):[0-9a-f-]{36}$/)
    clearAccessToken()
    setServerConnection('https://other.example.com', 'ts_other')
    expect(authHeaders().get('X-Teslasync-App')).toBe(first)
    clearServerConnection()
    expect(appIdentityHeaders().get('X-Teslasync-App')).toBe(first)
    window.localStorage.removeItem('teslasync-app-installation-id')
    expect(authHeaders().get('X-Teslasync-App')).not.toBe(first)
  })

  it('labels Android and iOS independently but never labels browser traffic', () => {
    expect(authHeaders().has('X-Teslasync-App')).toBe(false)
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true, getPlatform: () => 'android' })
    expect(authHeaders().get('X-Teslasync-App')).toMatch(/^android:/)
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true, getPlatform: () => 'ios' })
    expect(authHeaders().get('X-Teslasync-App')).toMatch(/^ios:/)
  })

  it('warns and securely replaces a corrupted stored installation ID', () => {
    window.__TESLASYNC_SHELL__ = 'electron'
    window.localStorage.setItem('teslasync-app-installation-id', 'invalid')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(appIdentityHeaders().get('X-Teslasync-App')).toMatch(/:[0-9a-f-]{36}$/)
    expect(warn).toHaveBeenCalledWith('Invalid native app installation ID; generating a new diagnostic ID')
  })
})

describe('needsServerSetup', () => {
  it('is false in a plain browser with no server saved', () => {
    expect(needsServerSetup()).toBe(false)
  })

  it('is true in a native shell with no server saved', () => {
    window.__TESLASYNC_SHELL__ = 'capacitor'
    expect(needsServerSetup()).toBe(true)
  })

  it('is false once a server is saved', () => {
    window.__TESLASYNC_SHELL__ = 'electron'
    setServerConnection('https://srv.example.com', null)
    expect(needsServerSetup()).toBe(false)
  })

  it('asks for a new token on native app restart without losing the server URL', () => {
    window.__TESLASYNC_SHELL__ = 'electron'
    setServerConnection('https://srv.example.com', 'ts_test_secret')
    window.sessionStorage.clear()
    expect(getServerBaseUrl()).toBe('https://srv.example.com')
    expect(needsServerSetup()).toBe(true)
  })

  it('honours the ?connect=1 override', () => {
    window.history.replaceState(null, '', '/?connect=1')
    try {
      expect(needsServerSetup()).toBe(true)
    } finally {
      window.history.replaceState(null, '', '/')
    }
  })
})

describe('probeServer', () => {
  it('reports the auth mode on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ mode: 'forward_auth' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await probeServer('https://srv.example.com', 'ts_test_x')
    expect(result).toEqual({ ok: true, mode: 'forward_auth' })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(fetchMock.mock.calls[0][0]).toBe('https://srv.example.com/api/v1/system/auth-mode')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer ts_test_x')
  })

  it('fails closed on transport errors and bad payloads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    expect(await probeServer('https://srv.example.com', null)).toEqual({ ok: false })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    expect(await probeServer('https://srv.example.com', null)).toEqual({ ok: false })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ nope: 1 }),
    }))
    expect(await probeServer('https://srv.example.com', null)).toEqual({ ok: false })
  })

  it('asks for a token when an auth-protected server rejects an anonymous probe', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))
    expect(await probeServer('https://srv.example.com', null)).toEqual({
      ok: false,
      authenticationRequired: true,
    })

  })

  it('reports authentication failure when the server rejects a supplied token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))
    expect(await probeServer('https://srv.example.com', 'ts_invalid')).toEqual({
      ok: false,
      authenticationRequired: true,
    })
  })
})
