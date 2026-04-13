/**
 * @module resilience
 *
 * Frontend resilience utilities for TeslaSync API communication.
 * Implements exponential-backoff retry with jitter, automatic GET
 * request deduplication, and browser offline detection.
 * All API calls should go through {@link resilientFetch}.
 */

type RequestStatus = 'online' | 'offline'

// --- Snake-case to camelCase transformer ---
// The Go backend returns snake_case JSON but TypeScript types use camelCase.

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())
}

function camelCaseKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(camelCaseKeys)
  if (obj !== null && typeof obj === 'object' && !(obj instanceof Date)) {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const transformed = camelCaseKeys(value)
      result[key] = transformed
      const camelKey = snakeToCamel(key)
      if (camelKey !== key) {
        result[camelKey] = transformed
      }
    }
    return result
  }
  return obj
}

// --- API Base URL ---
// Injected at runtime by Nginx via sub_filter into index.html.
// Falls back to empty string (relative paths) if not set.
declare global {
  interface Window {
    __TESLASYNC_API_BASE__?: string
  }
}

export function getApiBase(): string {
  return (window.__TESLASYNC_API_BASE__ || '').replace(/\/+$/, '')
}

// --- Offline Detection ---

let _status: RequestStatus = navigator.onLine ? 'online' : 'offline'
const _listeners = new Set<(s: RequestStatus) => void>()

function setStatus(s: RequestStatus) {
  if (_status === s) return
  _status = s
  _listeners.forEach(fn => fn(s))
}

window.addEventListener('online', () => setStatus('online'))
window.addEventListener('offline', () => setStatus('offline'))

/** Returns the current network connection status ('online' | 'offline'). */
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
  _refreshing = fetch(`${getApiBase()}/api/v1/auth/refresh`, { method: 'POST' })
    .then(res => { if (!res.ok) throw new Error('refresh failed') })
    .finally(() => { _refreshing = null })
  return _refreshing
}

// --- Resilient Fetch ---

interface ResilientOptions extends RequestInit {
  retries?: number        // max retries (default 1)
  retryDelay?: number     // initial delay ms (default 1000)
  timeout?: number        // request timeout ms (default 15000)
  dedupKey?: string       // dedup key for GET requests
}

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

/** Custom error class for API responses. Includes the HTTP status code. */
export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/**
 * Performs a fetch request with automatic retry (exponential backoff),
 * request deduplication for GETs, and offline detection.
 */
export async function resilientFetch<T>(
  path: string,
  options: ResilientOptions = {},
): Promise<T> {
  const {
    retries = 1,
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
    if (!navigator.onLine) {
      setStatus('offline')
      throw new ApiError('No network connection', 0)
    }

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeout)

      const res = await fetch(`${getApiBase()}/api/v1${path}`, {
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        ...fetchOpts,
      })
      clearTimeout(timer)

      // Any server response (even errors) means we're online
      setStatus('online')

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        const apiErr = new ApiError(err.error || `HTTP ${res.status}`, res.status)

        // 401 Unauthorized — attempt automatic token refresh and retry once
        if (res.status === 401 && attempt === 0) {
          try {
            await refreshTokenOnce()
            continue
          } catch {
            throw new ApiError('Session expired. Please reconnect your Tesla account in Settings.', 401)
          }
        }

        // 429 Rate Limited — wait and retry
        if (res.status === 429 && attempt < retries) {
          await sleep(2000 * (attempt + 1))
          continue
        }

        throw apiErr
      }

      const parsed = camelCaseKeys(await res.json())
      return parsed as T
    } catch (err) {
      if (err instanceof ApiError) throw err

      lastError = err instanceof Error ? err : new Error(String(err))

      if (lastError.name === 'AbortError') {
        lastError = new ApiError('Request timed out', 408)
      }

      if (attempt < retries) {
        const delay = retryDelay * Math.pow(2, attempt) * (0.75 + Math.random() * 0.5)
        await sleep(delay)
        continue
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

/** Fetches the backend system health status. */
export async function fetchSystemStatus(): Promise<SystemStatus> {
  return resilientFetch<SystemStatus>('/system/status', { retries: 0, timeout: 10000 })
}
