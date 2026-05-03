/**
 * @module api/client
 *
 * Foundation layer — resilient HTTP helper used by every domain module.
 */
import { resilientFetch, ApiError, getApiBase, isApiError } from '../lib/resilience'

export { ApiError, getApiBase, isApiError }

export interface ApiRequestOptions extends RequestInit {
  responseType?: 'json' | 'text'
  skipAuthRefresh?: boolean
}

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}

/** Builds a fully qualified API URL for browser-owned flows such as downloads. */
export function apiUrl(path: string): string {
  return `${getApiBase()}/api/v1${normalizePath(path)}`
}

function buildHeaders(headers: HeadersInit | undefined, hasBody: boolean): Headers {
  const merged = new Headers(headers)
  if (!merged.has('Accept')) merged.set('Accept', 'application/json')
  if (hasBody && !merged.has('Content-Type')) merged.set('Content-Type', 'application/json')
  return merged
}

async function parseError(res: Response): Promise<string> {
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('json')) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    return typeof body.error === 'string' ? body.error : res.statusText
  }

  const text = await res.text()
  return text || res.statusText
}

async function directRequest<T>(
  path: string,
  options: RequestInit,
  responseType: 'json' | 'text',
): Promise<T> {
  const { headers, body, ...rest } = options
  const res = await fetch(apiUrl(path), {
    ...rest,
    body,
    headers: buildHeaders(headers, body != null),
  })

  if (!res.ok) {
    throw new ApiError(await parseError(res), res.status)
  }

  if (responseType === 'text') {
    return await res.text() as T
  }

  if (res.status === 204) {
    return undefined as T
  }

  return await res.json() as T
}

/**
 * Makes a resilient API request to the given path, with automatic retry
 * and circuit breaker protection.
 * @template T - Expected JSON response type
 * @param path - API endpoint path (without /api/v1 prefix)
 * @param options - Standard fetch RequestInit options
 * @returns Parsed JSON response of type T
 */
export async function request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { responseType = 'json', skipAuthRefresh = false, ...fetchOptions } = options

  if (responseType === 'text' || skipAuthRefresh) {
    return directRequest<T>(path, fetchOptions, responseType)
  }

  return resilientFetch<T>(path, fetchOptions)
}
