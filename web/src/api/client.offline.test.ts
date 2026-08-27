import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Offline-write and cancellation contract at the `request()` boundary.
 *
 * Two properties are asserted here that no higher layer can guarantee:
 *
 *  1. **Destructive writes are never queued.** Vehicle commands, data-repair
 *     writes and security writes must fail immediately while offline, with a
 *     typed error, and MUST NOT reach the network — otherwise any future
 *     persistence/retry layer could replay an unlock or a repair minutes
 *     later, in a context the operator can no longer see.
 *  2. **Cancellation short-circuits the whole pipeline.** A caller abort must
 *     propagate as an AbortError without opening the reauth dialog and
 *     without re-entering the resilient retry loop, so a superseded scope
 *     cannot resolve into fresher UI state.
 */

const resilientFetchMock = vi.fn()

vi.mock('../lib/resilience', async () => {
  const actual: typeof import('../lib/resilience') = await vi.importActual('../lib/resilience')
  return {
    ...actual,
    resilientFetch: (path: string, options: RequestInit) => resilientFetchMock(path, options),
  }
})

import { request, __resetSudoStateForTests } from './client'
import { isOfflineWriteRejectedError } from './offlineCache'

let fetchMock: ReturnType<typeof vi.spyOn>

const onLineDescriptor = Object.getOwnPropertyDescriptor(
  window.navigator.constructor.prototype,
  'onLine',
)

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => value,
  })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('request() — offline destructive-write prohibition', () => {
  beforeEach(() => {
    __resetSudoStateForTests()
    resilientFetchMock.mockReset()
    fetchMock = vi.spyOn(globalThis, 'fetch') as ReturnType<typeof vi.spyOn>
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (onLineDescriptor) {
      Object.defineProperty(window.navigator.constructor.prototype, 'onLine', onLineDescriptor)
    }
    Reflect.deleteProperty(window.navigator as unknown as Record<string, unknown>, 'onLine')
  })

  const destructive: readonly [string, string][] = [
    ['POST', '/vehicles/7/command/door_unlock'],
    ['POST', '/vehicles/7/wake'],
    ['POST', '/data-repair/drives/3/close'],
    ['POST', '/repair-cases/3/transition'],
    ['DELETE', '/sessions/abc'],
    ['DELETE', '/admin/api-keys/1'],
  ]

  it.each(destructive)(
    'rejects %s %s offline without touching the network',
    async (method, path) => {
      setOnline(false)
      await expect(request(path, { method })).rejects.toSatisfy(isOfflineWriteRejectedError)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(resilientFetchMock).not.toHaveBeenCalled()
    },
  )

  it('does not queue the rejected write for later replay', async () => {
    setOnline(false)
    await expect(
      request('/vehicles/7/command/honk_horn', { method: 'POST' }),
    ).rejects.toThrow(/never queued/i)

    // Coming back online must not flush anything: there is no queue at all.
    setOnline(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still serves safe reads offline so cached data can render', async () => {
    setOnline(false)
    await expect(request('/vehicles')).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('allows the same destructive write once back online', async () => {
    setOnline(true)
    await expect(
      request('/vehicles/7/command/door_unlock', { method: 'POST' }),
    ).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('lets non-destructive writes fail with a real network error instead of a policy error', async () => {
    setOnline(false)
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    resilientFetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(request('/feedback', { method: 'POST', body: '{}' })).rejects.toThrow(
      /Failed to fetch/,
    )
  })
})

describe('request() — AbortSignal threading for superseded scopes', () => {
  beforeEach(() => {
    __resetSudoStateForTests()
    resilientFetchMock.mockReset()
    fetchMock = vi.spyOn(globalThis, 'fetch') as ReturnType<typeof vi.spyOn>
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('forwards the caller signal to fetch', async () => {
    const controller = new AbortController()
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))
    await request('/drives?vehicle_id=1', { signal: controller.signal })

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.signal).toBe(controller.signal)
  })

  it('propagates an abort as AbortError and never falls through to the retry loop', async () => {
    const controller = new AbortController()
    const abortError = new Error('aborted')
    abortError.name = 'AbortError'
    fetchMock.mockRejectedValue(abortError)

    controller.abort()
    await expect(
      request('/drives?vehicle_id=1', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })

    // Re-entering resilientFetch would let a superseded scope's response
    // resolve after the user already moved on.
    expect(resilientFetchMock).not.toHaveBeenCalled()
  })
})
