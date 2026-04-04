/**
 * @module api/client
 *
 * Foundation layer — resilient HTTP helper used by every domain module.
 */
import { resilientFetch, ApiError, getApiBase } from '../lib/resilience'

export { ApiError, getApiBase }

/**
 * Makes a resilient API request to the given path, with automatic retry
 * and circuit breaker protection.
 * @template T - Expected JSON response type
 * @param path - API endpoint path (without /api/v1 prefix)
 * @param options - Standard fetch RequestInit options
 * @returns Parsed JSON response of type T
 */
export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  return resilientFetch<T>(path, options)
}
