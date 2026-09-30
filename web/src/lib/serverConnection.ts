/**
 * @module lib/serverConnection
 *
 * Generic-app server picker state (docs/apps.md).
 *
 * The installed PWA and the per-domain wrappers are served by the server
 * itself, so same-origin API calls just work. The generic native shells
 * (Capacitor, Electron) bundle the UI with no server origin — the user
 * picks their server URL (plus a session-scoped personal access token when
 * that server runs forward-auth mode) and every API/SSE call is routed there.
 *
 * Pure module: browser storage + URL parsing only. It must stay importable
 * from `lib/resilience.ts`, so it imports nothing from the API layer.
 */

import { safeRandomUUID } from './safeUUID'
import { stripCredentialHeadersForDemo } from './demoMode'

const SERVER_URL_KEY = 'teslasync-server-base-url'
const ACCESS_TOKEN_KEY = 'teslasync-access-token'
const TOKEN_REQUIRED_KEY = 'teslasync-server-token-required'
const APP_INSTALLATION_KEY = 'teslasync-app-installation-id'
const APP_HEADER = 'X-Teslasync-App'
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** Query param that forces the connect screen (manual testing, server switching). */
export const CONNECT_QUERY_PARAM = 'connect'

/** Why a server URL candidate was rejected. Surfaced in the connect form. */
export type ServerUrlRejection =
  | 'empty'
  | 'unsupported-scheme'
  | 'unparseable'
  | 'missing-host'
  | 'credentials-in-url'
  | 'subpath-not-supported'

export interface ServerUrlResult {
  /** Normalised origin (`https://host[:port]`), or '' when rejected. */
  url: string
  accepted: boolean
  rejection: ServerUrlRejection | null
}

/**
 * Validate and normalise a user-typed server address into an origin.
 *
 * Lenient where users vary (missing scheme defaults to https, trailing
 * slashes are stripped, LAN/Tailscale hosts and explicit http are
 * allowed — this is client-side routing, not server-side fetch, so the
 * SSRF loopback rules do not apply) and strict where it matters
 * (http/https only, no `user:pass@`, no subpaths — the backend assumes
 * it is mounted at the domain root).
 */
export function normalizeServerUrl(raw: unknown): ServerUrlResult {
  const reject = (rejection: ServerUrlRejection): ServerUrlResult => ({
    url: '',
    accepted: false,
    rejection,
  })
  if (typeof raw !== 'string') return reject('empty')
  const trimmed = raw.trim()
  if (trimmed === '') return reject('empty')

  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`
  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    return reject('unparseable')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return reject('unsupported-scheme')
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return reject('credentials-in-url')
  }
  if (parsed.hostname === '') return reject('missing-host')
  if (parsed.pathname !== '' && parsed.pathname !== '/') {
    return reject('subpath-not-supported')
  }
  return { url: parsed.origin, accepted: true, rejection: null }
}

/** Saved server origin, or '' for same-origin (PWA served by the server). */
export function getServerBaseUrl(): string {
  try {
    const raw = window.localStorage.getItem(SERVER_URL_KEY) ?? ''
    const result = normalizeServerUrl(raw)
    return result.accepted ? result.url : ''
  } catch {
    return ''
  }
}

/** True when API traffic is routed to a picked server instead of same-origin. */
export function isRemoteMode(): boolean {
  return getServerBaseUrl() !== ''
}

/** Remote requests authenticate with a bearer token, not browser cookies. */
export function serverCredentials(): RequestCredentials {
  return isRemoteMode() ? 'omit' : 'include'
}

/** Session-scoped access token; never persisted to localStorage. */
export function getAccessToken(): string | null {
  try {
    const raw = (window.sessionStorage.getItem(ACCESS_TOKEN_KEY) ?? '').trim()
    return raw === '' ? null : raw
  } catch {
    return null
  }
}

/**
 * Persist a server connection. The caller must pass a normalised origin
 * (see {@link normalizeServerUrl}) — anything else throws. Saving
 * requires a full reload to take effect (see `ConnectPage`).
 */
export function setServerConnection(url: string, token: string | null): void {
  const result = normalizeServerUrl(url)
  if (!result.accepted || result.url !== url) {
    throw new Error('setServerConnection: URL must be a normalised origin')
  }
  if (token != null && token.trim() !== '') {
    window.sessionStorage.setItem(ACCESS_TOKEN_KEY, token.trim())
    window.localStorage.setItem(TOKEN_REQUIRED_KEY, '1')
  } else {
    window.sessionStorage.removeItem(ACCESS_TOKEN_KEY)
    window.localStorage.removeItem(TOKEN_REQUIRED_KEY)
  }
  window.localStorage.removeItem(ACCESS_TOKEN_KEY)
  window.localStorage.setItem(SERVER_URL_KEY, result.url)
}

/** Forget the picked server and token (same-origin from the next reload). */
export function clearServerConnection(): void {
  window.localStorage.removeItem(SERVER_URL_KEY)
  window.localStorage.removeItem(TOKEN_REQUIRED_KEY)
  window.localStorage.removeItem(ACCESS_TOKEN_KEY)
  window.sessionStorage.removeItem(ACCESS_TOKEN_KEY)
}

/** Discard a rejected app token without forgetting the server address. */
export function clearAccessToken(): void {
  window.sessionStorage.removeItem(ACCESS_TOKEN_KEY)
}

/**
 * Absolute API URL for a path. In same-origin mode this is the identity
 * (relative path preserved, no behaviour change); in remote mode the
 * saved origin is prepended. For EventSource call sites that already
 * carry the full `/api/v1/...` path.
 */
export function serverStreamUrl(path: string): string {
  const base = getServerBaseUrl()
  return base === '' ? path : `${base}${path}`
}

/**
 * Overlay the stored access token as `Authorization: Bearer` onto a
 * headers init. Never overwrites an explicit Authorization the caller
 * set, and no-ops when no token is stored — same-origin traffic is
 * byte-identical with or without this helper.
 */
export function authHeaders(init?: HeadersInit): Headers {
  const merged = new Headers(init)
  const token = getAccessToken()
  if (token != null && !merged.has('Authorization')) {
    merged.set('Authorization', `Bearer ${token}`)
  }
  return stripCredentialHeadersForDemo(appIdentityHeaders(merged))
}

/** Adds a per-install diagnostic label only to bundled native app requests. */
export function appIdentityHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init)
  if (!isNativeShell()) return headers

  const capacitor = (window as Window & {
    Capacitor?: { getPlatform?: () => string }
  }).Capacitor
  const capacitorPlatform = capacitor?.getPlatform?.()
  const platform = window.__TESLASYNC_SHELL__ === 'electron'
    ? /Windows/i.test(navigator.userAgent) ? 'windows'
      : /Macintosh/i.test(navigator.userAgent) ? 'macos' : 'linux'
    : capacitorPlatform === 'ios' ? 'ios'
      : capacitorPlatform === 'android' ? 'android' : 'mobile'

  let id = window.localStorage.getItem(APP_INSTALLATION_KEY)
  if (id !== null && !UUID_V4.test(id)) {
    console.warn('Invalid native app installation ID; generating a new diagnostic ID')
    id = null
  }
  if (id === null) {
    id = safeRandomUUID(true)
    if (!UUID_V4.test(id)) throw new Error('Could not generate a valid native app installation ID')
    window.localStorage.setItem(APP_INSTALLATION_KEY, id)
  }
  headers.set(APP_HEADER, `${platform}:${id}`)
  return headers
}

declare global {
  interface Window {
    /** Injected by the native shells (`capacitor` | `electron`). */
    __TESLASYNC_SHELL__?: string
  }
}

/** True inside a bundled native shell (Capacitor / Electron). */
export function isNativeShell(): boolean {
  if (typeof window !== 'undefined' && typeof window.__TESLASYNC_SHELL__ === 'string') {
    return true
  }
  const capacitor = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  return capacitor?.isNativePlatform?.() === true
}

/**
 * True when the app must show the server picker instead of the normal
 * chrome: `?connect=1` forces it (testing, switching servers); otherwise
 * it shows in a native shell with no saved server, where same-origin
 * calls would hit the bundle origin and fail.
 */
export function needsServerSetup(): boolean {
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get(CONNECT_QUERY_PARAM) === '1') return true
  } catch {
    // fall through to the shell check
  }
  return isNativeShell() &&
    (!isRemoteMode() || (window.localStorage.getItem(TOKEN_REQUIRED_KEY) === '1' && getAccessToken() == null))
}

export interface ServerProbeSuccess {
  ok: true
  /** Raw `mode` value from /system/auth-mode (`open` | `forward_auth`). */
  mode: string
}

export interface ServerProbeFailure {
  ok: false
  authenticationRequired?: boolean
}

export type ServerProbeResult = ServerProbeSuccess | ServerProbeFailure

/**
 * Probe a server candidate: reachable, serving the TeslaSync API, and in
 * which auth mode. Used by the connect form to validate the URL before
 * saving and to decide whether a token is required. Never throws.
 */
export async function probeServer(base: string, token: string | null): Promise<ServerProbeResult> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 10_000)
  try {
    const headers = new Headers({ Accept: 'application/json' })
    if (token != null && token.trim() !== '') {
      headers.set('Authorization', `Bearer ${token.trim()}`)
    }
    const res = await fetch(`${base}/api/v1/system/auth-mode`, {
      headers,
      signal: controller.signal,
      credentials: 'omit',
    })
    if (res.status === 401) {
      return { ok: false, authenticationRequired: true }
    }
    if (!res.ok) return { ok: false }
    const body = (await res.json().catch(() => null)) as { mode?: unknown } | null
    if (body == null || typeof body.mode !== 'string' || body.mode === '') {
      return { ok: false }
    }
    return { ok: true, mode: body.mode }
  } catch {
    return { ok: false }
  } finally {
    window.clearTimeout(timer)
  }
}
