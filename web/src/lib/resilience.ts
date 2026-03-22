/**
 * @module resilience
 *
 * Frontend resilience utilities for TeslaSync API communication.
 * Implements a client-side circuit breaker (opens after 5 consecutive
 * failures, half-opens after 30 s), exponential-backoff retry with
 * jitter, automatic GET request deduplication, browser offline
 * detection, and connection status tracking ('online' | 'degraded' |
 * 'offline'). All API calls should go through {@link resilientFetch}.
 */

type RequestStatus = 'online' | 'degraded' | 'offline'

// --- Circuit Breaker ---

interface BreakerState {
  failures: number
  lastFailure: number
  state: 'closed' | 'open' | 'half-open'
}

const breaker: BreakerState = { failures: 0, lastFailure: 0, state: 'closed' }
const BREAKER_THRESHOLD = 5
const BREAKER_RESET_MS = 30_000

function checkBreaker(): boolean {
  if (breaker.state === 'closed') return true
  if (breaker.state === 'open') {
    if (Date.now() - breaker.lastFailure > BREAKER_RESET_MS) {
      breaker.state = 'half-open'
      return true
    }
    return false
  }
  // half-open: allow one request through
  return true
}

function recordSuccess() {
  breaker.failures = 0
  breaker.state = 'closed'
}

function recordFailure() {
  breaker.failures++
  breaker.lastFailure = Date.now()
  if (breaker.failures >= BREAKER_THRESHOLD) {
    breaker.state = 'open'
  }
}

// --- Offline Detection ---

let _status: RequestStatus = navigator.onLine ? 'online' : 'offline'
const _listeners = new Set<(s: RequestStatus) => void>()

function setStatus(s: RequestStatus) {
  if (_status === s) return
  _status = s
  _listeners.forEach(fn => fn(s))
}

window.addEventListener('online', () => {
  if (_status === 'offline') setStatus('online')
})
window.addEventListener('offline', () => setStatus('offline'))

/** Returns the current network/API connection status ('online' | 'degraded' | 'offline'). */
export function getConnectionStatus(): RequestStatus { return _status }

/** Registers a callback invoked whenever the connection status changes. Returns an unsubscribe function. */
export function onStatusChange(fn: (s: RequestStatus) => void): () => void {
  _listeners.add(fn)
  return () => { _listeners.delete(fn) }
}

// --- Request Deduplication ---

const inflight = new Map<string, Promise<unknown>>()

function dedup<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key)
  if (existing) return existing as Promise<T>
  const p = fn().finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

// --- Token Refresh on 401 ---

let _refreshing: Promise<void> | null = null

async function refreshTokenOnce(): Promise<void> {
  if (_refreshing) return _refreshing
  _refreshing = fetch('/api/v1/auth/refresh', { method: 'POST' })
    .then(res => { if (!res.ok) throw new Error('refresh failed') })
    .finally(() => { _refreshing = null })
  return _refreshing
}

// --- Resilient Fetch ---

interface ResilientOptions extends RequestInit {
  retries?: number        // max retries (default 2)
  retryDelay?: number     // initial delay ms (default 1000)
  timeout?: number        // request timeout ms (default 15000)
  dedupKey?: string       // dedup key for GET requests
}

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

/** Custom error class for API responses. Includes the HTTP status code and whether the request is retryable (5xx, 408, 429). */
export class ApiError extends Error {
  status: number
  retryable: boolean

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.retryable = status >= 500 || status === 408 || status === 429
  }
}

/**
 * Performs a fetch request with automatic retry (exponential backoff), circuit breaker
 * protection, request deduplication for GETs, and offline detection.
 */
export async function resilientFetch<T>(
  path: string,
  options: ResilientOptions = {},
): Promise<T> {
  const {
    retries = 2,
    retryDelay = 1000,
    timeout = 15000,
    dedupKey,
    ...fetchOpts
  } = options

  // For GET requests, auto-dedup using the path
  const key = dedupKey || ((!fetchOpts.method || fetchOpts.method === 'GET') ? path : '')
  if (key) {
    return dedup(key, () => _doFetch<T>(path, fetchOpts, retries, retryDelay, timeout))
  }

  return _doFetch<T>(path, fetchOpts, retries, retryDelay, timeout)
}

async function _doFetch<T>(
  path: string,
  fetchOpts: RequestInit,
  retries: number,
  retryDelay: number,
  timeout: number,
): Promise<T> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    // Circuit breaker check
    if (!checkBreaker()) {
      setStatus('degraded')
      throw new ApiError('Service temporarily unavailable (circuit open)', 503)
    }

    // Offline check
    if (!navigator.onLine) {
      setStatus('offline')
      throw new ApiError('No network connection', 0)
    }

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeout)

      const res = await fetch(`/api/v1${path}`, {
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        ...fetchOpts,
      })
      clearTimeout(timer)

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        const apiErr = new ApiError(err.error || `HTTP ${res.status}`, res.status)

        // 401 Unauthorized — attempt automatic token refresh and retry once
        if (res.status === 401 && attempt === 0) {
          try {
            await refreshTokenOnce()
            continue // retry the request with fresh token
          } catch {
            recordFailure()
            throw new ApiError('Session expired. Please reconnect your Tesla account in Settings.', 401)
          }
        }

        // Non-retryable errors: don't retry
        if (!apiErr.retryable) {
          recordSuccess() // server responded, just a client error
          setStatus('online')
          throw apiErr
        }

        throw apiErr
      }

      // Success
      recordSuccess()
      setStatus('online')
      return await res.json() as T
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))

      // Abort/timeout
      if (lastError.name === 'AbortError') {
        lastError = new ApiError('Request timed out', 408)
      }

      const isRetryable = lastError instanceof ApiError ? lastError.retryable : true

      if (isRetryable && attempt < retries) {
        const delay = retryDelay * Math.pow(2, attempt) * (0.75 + Math.random() * 0.5)
        await sleep(delay)
        continue
      }

      recordFailure()
      if (breaker.state === 'open') {
        setStatus('degraded')
      }
    }
  }

  throw lastError || new ApiError('Request failed', 0)
}

// --- System Status Polling ---

export interface SystemStatus {
  overall: string
  database: { status: string; consecutive_failures?: number }
  tesla_api: { status: string }
  mqtt?: { status: string; consecutive_failures?: number; last_error?: string }
  worker?: { status: string; consecutive_failures?: number }
}

/** Fetches the backend system health status (database, Tesla API, MQTT, worker). */
export async function fetchSystemStatus(): Promise<SystemStatus> {
  const res = await fetch('/api/v1/system/status')
  if (!res.ok) throw new Error('Failed to fetch system status')
  return res.json()
}
