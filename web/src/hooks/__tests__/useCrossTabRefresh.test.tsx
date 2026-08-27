import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { useCrossTabRefresh } from '../useCrossTabRefresh'
import {
  __flushQueryBroadcastForTests,
  __resetQueryBroadcastForTests,
} from '@/lib/queryBroadcast'
import { __resetBroadcastForTests } from '@/lib/broadcast'

/**
 * Cross-tab refresh contract.
 *
 * A refresh in the working tab must reach the pinned dashboard tab, and it
 * must do so through the EXISTING broadcast infrastructure (one shared
 * `teslasync` channel, 50 ms coalescing) rather than by opening another one.
 */

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

describe('useCrossTabRefresh', () => {
  let client: QueryClient
  let invalidate: ReturnType<typeof vi.fn>
  let posted: unknown[]

  beforeEach(() => {
    __resetQueryBroadcastForTests()
    __resetBroadcastForTests()
    posted = []
    class RecordingChannel {
      constructor(public name: string) {}
      postMessage(msg: unknown) { posted.push(msg) }
      addEventListener() {}
      removeEventListener() {}
      close() {}
    }
    vi.stubGlobal('BroadcastChannel', RecordingChannel)

    client = new QueryClient()
    invalidate = vi.fn()
    client.invalidateQueries = invalidate as unknown as QueryClient['invalidateQueries']
  })

  afterEach(() => {
    __resetQueryBroadcastForTests()
    __resetBroadcastForTests()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('invalidates locally and broadcasts to peer tabs', () => {
    const { result } = renderHook(
      () => useCrossTabRefresh({ queryKeys: [['drives'], ['charging']] }),
      { wrapper: wrapper(client) },
    )

    act(() => {
      expect(result.current.refresh()).toBe(true)
    })

    expect(invalidate).toHaveBeenCalledTimes(2)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['drives'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['charging'] })

    __flushQueryBroadcastForTests()

    // Coalesced into a SINGLE cross-tab envelope carrying both keys.
    expect(posted).toHaveLength(1)
    const envelope = posted[0] as { msg: { type: string; keys: unknown[][] } }
    expect(envelope.msg.type).toBe('queryInvalidate')
    expect(envelope.msg.keys).toEqual([['drives'], ['charging']])
  })

  it('suppresses a repeat refresh inside the cooldown', () => {
    const { result } = renderHook(
      () => useCrossTabRefresh({ queryKeys: [['drives']], cooldownMs: 60_000 }),
      { wrapper: wrapper(client) },
    )

    act(() => {
      expect(result.current.refresh()).toBe(true)
      expect(result.current.refresh()).toBe(false)
      expect(result.current.refresh()).toBe(false)
    })

    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  it('allows another refresh once the cooldown elapses', () => {
    vi.useFakeTimers()
    const { result } = renderHook(
      () => useCrossTabRefresh({ queryKeys: [['drives']], cooldownMs: 1_000 }),
      { wrapper: wrapper(client) },
    )

    act(() => { result.current.refresh() })
    act(() => { vi.advanceTimersByTime(1_500) })
    act(() => {
      expect(result.current.refresh()).toBe(true)
    })
    expect(invalidate).toHaveBeenCalledTimes(2)
  })
})
