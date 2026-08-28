/**
 * @module sw/apiCachePolicy
 *
 * The allowlist that decides which authenticated API reads the service worker
 * is permitted to keep in Cache Storage (PWA-02).
 *
 * ## Design rules (do not relax without re-reading these)
 *
 * 1. **Read-only only.** Anything other than `GET` is network-only. A cached
 *    mutation response would let a stale optimistic result resurface after a
 *    failed write.
 * 2. **Allowlist, never denylist.** New endpoints default to network-only.
 *    A denylist silently starts caching every future endpoint — including
 *    the next one that returns a credential.
 * 3. **No secrets, no credentials, no exports.** Settings, admin, auth,
 *    tokens, keys, backups, GDPR/data exports and share links are excluded
 *    by construction: they are simply not on the list, and
 *    {@link SENSITIVE_PATH_MARKERS} is a second belt that rejects them even
 *    if somebody adds an over-broad pattern later.
 * 4. **Never cache a redirect.** Behind ForwardAuth (Authentik / Authelia /
 *    oauth2-proxy) an expired session answers a GET with a 302 to the login
 *    page. Caching the followed response would pin a login page under an API
 *    URL and break auth recovery for the lifetime of the cache entry.
 *    {@link isCacheableApiResponse} rejects `response.redirected`.
 * 5. **Every cache hit is disclosed.** Entries are stamped with
 *    {@link CACHED_AT_HEADER} at write time and {@link CACHE_SOURCE_HEADER}
 *    at read time so the UI can say *exactly* when the data on screen was
 *    captured instead of implying it is live.
 *
 * Pure module: no `self`, no `caches`, no `fetch`. Imported by `sw.ts` and by
 * app code that renders the cached-at disclosure.
 */

/** Response header stamped onto every cached API read (epoch ms, base 10). */
export const CACHED_AT_HEADER = 'x-teslasync-cached-at'

/** Response header stamped when a response is served FROM the cache. */
export const CACHE_SOURCE_HEADER = 'x-teslasync-cache-source'

/** Value of {@link CACHE_SOURCE_HEADER} on a cache hit. */
export const CACHE_SOURCE_CACHE = 'cache'

/** Prefix every TeslaSync REST path shares. */
export const API_PATH_PREFIX = '/api/v1'

/**
 * How long a cached API read may be shown as an offline fallback before the
 * SW stops serving it at all. Twelve hours is long enough to cover a flight
 * or a commute through a tunnel, short enough that nobody mistakes it for
 * live fleet state.
 */
export const API_CACHE_MAX_AGE_SECONDS = 12 * 60 * 60

/** Hard ceiling on cached API entries so storage stays bounded. */
export const API_CACHE_MAX_ENTRIES = 48

/**
 * Substrings that disqualify a path outright, regardless of the allowlist.
 * Defence in depth against a future over-broad pattern.
 */
export const SENSITIVE_PATH_MARKERS: readonly string[] = [
  'token',
  'secret',
  'password',
  'credential',
  'private',
  'auth',
  'session',
  'backup',
  'export',
  'admin',
  'settings',
  'share',
  'impersonat',
  'totp',
  'key',
]

/**
 * Exact read-only endpoints that may be cached for offline viewing.
 *
 * Each entry is a full-path matcher over the portion AFTER
 * {@link API_PATH_PREFIX}. `:id` matches one positive integer segment.
 *
 * Keep this list aligned with `internal/api/router.go`. Every entry must be
 * (a) a `GET`, (b) free of credentials/PII beyond what the page already
 * shows, and (c) genuinely useful when the network is gone.
 */
export const CACHEABLE_READ_PATTERNS: readonly string[] = [
  '/vehicles',
  '/vehicles/:id/state',
  '/vehicles/:id/battery',
  '/vehicles/:id/energy',
  '/drives',
  '/drives/:id',
  '/charging',
  '/charging/:id',
  '/notifications/unread-count',
  '/notifications/logs',
  '/system/version',
]

const SEGMENT_ID = /^[1-9][0-9]{0,17}$/

function matchesPattern(pathname: string, pattern: string): boolean {
  const actual = pathname.split('/')
  const expected = pattern.split('/')
  if (actual.length !== expected.length) return false
  for (let i = 0; i < expected.length; i += 1) {
    const want = expected[i]
    if (want === ':id') {
      if (!SEGMENT_ID.test(actual[i])) return false
      continue
    }
    if (want !== actual[i]) return false
  }
  return true
}

/** Why a request was or was not classified as cacheable. */
export type ApiCacheReason =
  | 'cacheable-read'
  | 'not-api'
  | 'cross-origin'
  | 'mutation'
  | 'range-request'
  | 'sensitive-path'
  | 'not-allowlisted'

export interface ApiCacheDecision {
  cacheable: boolean
  reason: ApiCacheReason
  /** Normalised path (without the `/api/v1` prefix) when this is an API URL. */
  apiPath: string | null
}

export interface ClassifyApiRequestInput {
  method: string
  /** Absolute request URL. */
  url: string
  /** The service worker's own origin. */
  origin: string
  /** `Range` header presence — partial responses must never be cached. */
  hasRangeHeader?: boolean
}

/**
 * Decide whether one request is an API read this SW may cache.
 *
 * Returns a decision object rather than a boolean so the SW can log/count
 * *why* something was rejected, and so tests can assert the specific rule
 * that fired instead of a bare `false`.
 */
export function classifyApiRequest(
  input: ClassifyApiRequestInput,
): ApiCacheDecision {
  let url: URL
  try {
    url = new URL(input.url)
  } catch {
    return { cacheable: false, reason: 'not-api', apiPath: null }
  }

  if (url.origin !== input.origin) {
    return { cacheable: false, reason: 'cross-origin', apiPath: null }
  }
  if (
    url.pathname !== API_PATH_PREFIX
    && !url.pathname.startsWith(`${API_PATH_PREFIX}/`)
  ) {
    return { cacheable: false, reason: 'not-api', apiPath: null }
  }

  const apiPath = url.pathname.slice(API_PATH_PREFIX.length) || '/'

  if (input.method.toUpperCase() !== 'GET') {
    return { cacheable: false, reason: 'mutation', apiPath }
  }
  if (input.hasRangeHeader === true) {
    return { cacheable: false, reason: 'range-request', apiPath }
  }

  const haystack = apiPath.toLowerCase()
  if (SENSITIVE_PATH_MARKERS.some((marker) => haystack.includes(marker))) {
    return { cacheable: false, reason: 'sensitive-path', apiPath }
  }

  const allowed = CACHEABLE_READ_PATTERNS.some((pattern) =>
    matchesPattern(apiPath, pattern),
  )
  return allowed
    ? { cacheable: true, reason: 'cacheable-read', apiPath }
    : { cacheable: false, reason: 'not-allowlisted', apiPath }
}

/** Minimal structural view of a `Response` used by the guards below. */
export interface ResponseLike {
  status: number
  redirected: boolean
  type?: string
  url?: string
  headers: { get(name: string): string | null }
}

/**
 * Second gate, applied to the *response*: a request may be allowlisted and
 * the response still be uncacheable.
 *
 * Rejects non-200s (a cached 404 is worse than no cache), opaque/redirected
 * responses (ForwardAuth login pages), anything the server marked
 * `no-store`/`private`, and anything carrying a `Set-Cookie` (a rotated
 * session cookie must never be replayed from cache).
 */
export function isCacheableApiResponse(response: ResponseLike): boolean {
  if (response.status !== 200) return false
  if (response.redirected) return false
  if (response.type === 'opaque' || response.type === 'opaqueredirect') {
    return false
  }
  if (response.headers.get('set-cookie') != null) return false
  const cacheControl = response.headers.get('cache-control')?.toLowerCase() ?? ''
  if (cacheControl.includes('no-store') || cacheControl.includes('private')) {
    return false
  }
  return true
}

/**
 * Read the disclosure timestamp off a cached response.
 * Returns `null` when the header is missing or unparseable — the caller must
 * then present the data as "cached at an unknown time", never as live.
 */
export function readCachedAt(response: ResponseLike): number | null {
  const raw = response.headers.get(CACHED_AT_HEADER)
  if (raw == null) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/** `true` when a cached entry is older than {@link API_CACHE_MAX_AGE_SECONDS}. */
export function isCachedEntryExpired(
  cachedAtMs: number | null,
  nowMs: number,
): boolean {
  if (cachedAtMs == null) return true
  return nowMs - cachedAtMs > API_CACHE_MAX_AGE_SECONDS * 1000
}
