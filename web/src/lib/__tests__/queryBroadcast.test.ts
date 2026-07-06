import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { QueryClient, type QueryKey } from '@tanstack/react-query'

/**
 * queryBroadcast — TanStack Query cross-tab invalidation adapter.
 *
 * These tests isolate the coalescing/broadcast layer from the actual bus by
 * mocking `./broadcast` so we can assert exactly what queryBroadcast puts on
 * the wire (envelope type + coalesced keys) without touching BroadcastChannel
 * or localStorage. The cross-tab transport itself is covered exhaustively in
 * `broadcast.test.ts`. Never hits the network.
 *
 * We keep the real exports of `./broadcast` and override only `broadcast()`
 * so any transitive consumer pulled in by the setup file still resolves
 * `subscribe` / `TAB_ID` / etc.
 */
vi.mock('../broadcast', async () => {
  const actual = await vi.importActual<typeof import('../broadcast')>('../broadcast')
  return { ...actual, broadcast: vi.fn() }
})

import { broadcast } from '../broadcast'
import {
  invalidateAndBroadcast,
  __flushQueryBroadcastForTests,
  __resetQueryBroadcastForTests,
} from '../queryBroadcast'

const broadcastMock = vi.mocked(broadcast)

/** A real QueryClient — used to prove the end-to-end shape/type contract. */
function makeQc(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
}

/**
 * A minimal fake QueryClient that only records `invalidateQueries`. Used for
 * the coalescing assertions (and the non-serializable-key case, where the
 * real TanStack key-hasher would itself throw on a circular reference before
 * queryBroadcast's own try/catch is even reached).
 */
function makeSpyQc(): { qc: QueryClient; invalidate: ReturnType<typeof vi.fn> } {
  const invalidate = vi.fn().mockResolvedValue(undefined)
  const qc = { invalidateQueries: invalidate } as unknown as QueryClient
  return { qc, invalidate }
}

beforeEach(() => {
  broadcastMock.mockReset()
  __resetQueryBroadcastForTests()
})

afterEach(() => {
  __resetQueryBroadcastForTests()
  vi.useRealTimers()
})

describe('invalidateAndBroadcast', () => {
  it('invalidates locally immediately and defers the cross-tab broadcast', () => {
    const { qc, invalidate } = makeSpyQc()

    invalidateAndBroadcast(qc, { queryKey: ['vehicles'] })

    // Local invalidation is synchronous — the user's own tab updates now.
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['vehicles'] })
    // ...but the bus message is coalesced, not emitted inline.
    expect(broadcastMock).not.toHaveBeenCalled()

    __flushQueryBroadcastForTests()

    expect(broadcastMock).toHaveBeenCalledTimes(1)
    expect(broadcastMock).toHaveBeenCalledWith({
      type: 'queryInvalidate',
      keys: [['vehicles']],
    })
  })

  it('coalesces multiple distinct keys from one tick into a single envelope', () => {
    const { qc } = makeSpyQc()

    invalidateAndBroadcast(qc, { queryKey: ['alerts'] })
    invalidateAndBroadcast(qc, { queryKey: ['unread-count', 3] })

    __flushQueryBroadcastForTests()

    // One envelope, both keys, insertion order preserved.
    expect(broadcastMock).toHaveBeenCalledTimes(1)
    expect(broadcastMock).toHaveBeenCalledWith({
      type: 'queryInvalidate',
      keys: [['alerts'], ['unread-count', 3]],
    })
  })

  it('de-duplicates structurally-equal keys but still invalidates each locally', () => {
    const { qc, invalidate } = makeSpyQc()

    invalidateAndBroadcast(qc, { queryKey: ['vehicles', 1] })
    invalidateAndBroadcast(qc, { queryKey: ['vehicles', 1] })

    // The caller's local side-effect must fire on every call...
    expect(invalidate).toHaveBeenCalledTimes(2)

    __flushQueryBroadcastForTests()

    // ...but the wire carries the key only once.
    expect(broadcastMock).toHaveBeenCalledTimes(1)
    const msg = broadcastMock.mock.calls[0][0] as { type: string; keys: unknown[] }
    expect(msg.keys).toHaveLength(1)
    expect(msg.keys).toEqual([['vehicles', 1]])
  })

  it('starts a fresh batch for invalidations enqueued after a flush (no leakage)', () => {
    const { qc } = makeSpyQc()

    invalidateAndBroadcast(qc, { queryKey: ['a'] })
    __flushQueryBroadcastForTests()
    expect(broadcastMock).toHaveBeenCalledTimes(1)

    invalidateAndBroadcast(qc, { queryKey: ['b'] })
    __flushQueryBroadcastForTests()

    expect(broadcastMock).toHaveBeenCalledTimes(2)
    // The second envelope must NOT still contain ['a'].
    expect(broadcastMock).toHaveBeenLastCalledWith({
      type: 'queryInvalidate',
      keys: [['b']],
    })
  })

  it('works against a real QueryClient with a real query key', () => {
    const qc = makeQc()
    const spy = vi.spyOn(qc, 'invalidateQueries')

    invalidateAndBroadcast(qc, { queryKey: ['analytics', 'fleet'] })

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith({ queryKey: ['analytics', 'fleet'] })

    __flushQueryBroadcastForTests()
    expect(broadcastMock).toHaveBeenCalledWith({
      type: 'queryInvalidate',
      keys: [['analytics', 'fleet']],
    })

    spy.mockRestore()
  })
})

describe('coalesce window (timer)', () => {
  it('auto-flushes the batch after the 50ms coalesce window elapses', () => {
    vi.useFakeTimers()
    const { qc } = makeSpyQc()

    invalidateAndBroadcast(qc, { queryKey: ['drives'] })
    expect(broadcastMock).not.toHaveBeenCalled()

    // Just under the window — still pending.
    vi.advanceTimersByTime(49)
    expect(broadcastMock).not.toHaveBeenCalled()

    // Cross the window — the scheduled flush fires on its own.
    vi.advanceTimersByTime(1)
    expect(broadcastMock).toHaveBeenCalledTimes(1)
    expect(broadcastMock).toHaveBeenCalledWith({
      type: 'queryInvalidate',
      keys: [['drives']],
    })
  })

  it('arms only one timer for a burst within the same window', () => {
    vi.useFakeTimers()
    const { qc } = makeSpyQc()

    invalidateAndBroadcast(qc, { queryKey: ['x'] })
    invalidateAndBroadcast(qc, { queryKey: ['y'] })
    invalidateAndBroadcast(qc, { queryKey: ['z'] })

    vi.advanceTimersByTime(50)

    // A single fire delivers the whole batch — not one envelope per key.
    expect(broadcastMock).toHaveBeenCalledTimes(1)
    expect(broadcastMock).toHaveBeenCalledWith({
      type: 'queryInvalidate',
      keys: [['x'], ['y'], ['z']],
    })
  })
})

describe('non-serializable keys', () => {
  it('skips a circular key on the wire but still invalidates it locally', () => {
    const { qc, invalidate } = makeSpyQc()

    const circular: Record<string, unknown> = {}
    circular.self = circular
    const badKey = ['vehicle', circular] as unknown as QueryKey

    invalidateAndBroadcast(qc, { queryKey: badKey })

    // Wire-serializability has no bearing on the local invalidation.
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: badKey })

    __flushQueryBroadcastForTests()

    // Nothing serializable was queued → no envelope at all.
    expect(broadcastMock).not.toHaveBeenCalled()
  })

  it('still broadcasts serializable keys queued alongside a skipped one', () => {
    const { qc } = makeSpyQc()

    const circular: Record<string, unknown> = {}
    circular.self = circular

    invalidateAndBroadcast(qc, { queryKey: ['vehicle', circular] as unknown as QueryKey })
    invalidateAndBroadcast(qc, { queryKey: ['charging'] })

    __flushQueryBroadcastForTests()

    expect(broadcastMock).toHaveBeenCalledTimes(1)
    expect(broadcastMock).toHaveBeenCalledWith({
      type: 'queryInvalidate',
      keys: [['charging']],
    })
  })
})

describe('test helpers', () => {
  it('__flushQueryBroadcastForTests is a safe no-op when nothing is queued', () => {
    expect(() => __flushQueryBroadcastForTests()).not.toThrow()
    expect(broadcastMock).not.toHaveBeenCalled()
  })

  it('__resetQueryBroadcastForTests cancels the pending timer and drops queued work', () => {
    vi.useFakeTimers()
    const { qc } = makeSpyQc()

    invalidateAndBroadcast(qc, { queryKey: ['alerts'] })

    __resetQueryBroadcastForTests()

    // Neither the auto-flush timer nor a manual flush emits anything.
    vi.advanceTimersByTime(100)
    __flushQueryBroadcastForTests()
    expect(broadcastMock).not.toHaveBeenCalled()
  })
})
