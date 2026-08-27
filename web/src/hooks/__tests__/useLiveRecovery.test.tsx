import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

type Listener = (data: unknown) => void

const listeners = new Map<string, Set<Listener>>()

function emit(event: string) {
  for (const fn of listeners.get(event) ?? []) fn(undefined)
}

// Mirrors sseManager's own lifecycle state so the hook can be tested against
// "already connected on mount", "never connected yet", and "connected earlier
// this session" — the three cases that decide whether a `disconnected` frame
// is a real outage or a failed first connect.
const managerState = {
  state: 'connected' as 'connected' | 'reconnecting',
  everConnected: true,
}

vi.mock('@/lib/sseManager', () => ({
  sseManager: {
    subscribe: (event: string, fn: Listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(fn)
    },
    unsubscribe: (event: string, fn: Listener) => {
      listeners.get(event)?.delete(fn)
    },
    getState: () => managerState.state,
    getLastMessageAt: () => null,
    hasEverConnected: () => managerState.everConnected,
    connect: () => {},
    disconnect: () => {},
  },
}))

import { useLiveRecovery } from '../useLiveRecovery'

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

const hiddenDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden')
let hidden = false

describe('useLiveRecovery — Redis Pub/Sub has no replay, so we re-read', () => {
  let client: QueryClient
  let invalidate: ReturnType<typeof vi.fn>

  beforeEach(() => {
    listeners.clear()
    hidden = false
    managerState.state = 'connected'
    managerState.everConnected = true
    Object.defineProperty(Document.prototype, 'hidden', {
      configurable: true,
      get: () => hidden,
    })
    client = new QueryClient()
    invalidate = vi.fn()
    client.invalidateQueries = invalidate as unknown as QueryClient['invalidateQueries']
  })

  afterEach(() => {
    if (hiddenDescriptor) {
      Object.defineProperty(Document.prototype, 'hidden', hiddenDescriptor)
    }
    vi.useRealTimers()
  })

  it('does NOT invalidate on the first connect of the session', () => {
    managerState.state = 'reconnecting'
    managerState.everConnected = false

    renderHook(() => useLiveRecovery({ queryKeys: [['vehicle-state']] }), {
      wrapper: wrapper(client),
    })

    act(() => { emit('connected') })

    // The normal query lifecycle already fetched everything; recovering here
    // would double every page load's request count.
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('does NOT recover when the FIRST EventSource attempt errors before opening', () => {
    // Regression guard: sseManager emits `disconnected` for a pre-open error.
    // Treating that as an outage made the very first successful connect look
    // like a recovery and refetch everything the page had just loaded.
    managerState.state = 'reconnecting'
    managerState.everConnected = false

    renderHook(() => useLiveRecovery({ queryKeys: [['vehicle-state']] }), {
      wrapper: wrapper(client),
    })

    act(() => { emit('disconnected') })   // EventSource error, never opened
    act(() => { emit('disconnected') })   // retry also failed
    act(() => { emit('connected') })      // first-ever successful open

    expect(invalidate).not.toHaveBeenCalled()
  })

  it('recovers on a real connect → disconnect → reconnect cycle', () => {
    managerState.state = 'reconnecting'
    managerState.everConnected = false
    const onRecover = vi.fn()

    renderHook(() => useLiveRecovery({ queryKeys: [['vehicle-state']], onRecover }), {
      wrapper: wrapper(client),
    })

    act(() => { emit('connected') })       // first-ever open — no recovery
    expect(invalidate).not.toHaveBeenCalled()

    act(() => { emit('disconnected') })     // genuine outage after a live pipe
    act(() => { emit('connected') })        // reconnect → missed state exists

    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(onRecover).toHaveBeenCalledTimes(1)
  })

  it('recovers when the pipe connected earlier this session but is down at mount', () => {
    // The exact late-mount case: the `disconnected` event fired BEFORE this
    // hook subscribed and is never replayed, so no disconnect is emitted here.
    // The outage marker has to be seeded from the manager's own state or the
    // next `connected` looks like a first connect and the state missed during
    // the outage is never re-read.
    managerState.state = 'reconnecting'
    managerState.everConnected = true

    renderHook(() => useLiveRecovery({ queryKeys: [['vehicle-state']] }), {
      wrapper: wrapper(client),
    })

    act(() => { emit('connected') })

    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['vehicle-state'] })
  })

  it('recovers exactly ONCE for a late-mounted outage, not on every later connect', () => {
    managerState.state = 'reconnecting'
    managerState.everConnected = true

    renderHook(
      () => useLiveRecovery({ queryKeys: [['vehicle-state']], cooldownMs: 0 }),
      { wrapper: wrapper(client) },
    )

    act(() => { emit('connected') })
    expect(invalidate).toHaveBeenCalledTimes(1)

    // A duplicate `connected` with no intervening outage must not re-fire.
    act(() => { emit('connected') })
    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  it('negative control: a late mount while merely reconnecting-but-never-connected still does NOT recover', () => {
    // Same manager state EXCEPT hasEverConnected() is false — the app has
    // never had a live pipe, so there is no missed state to recover.
    managerState.state = 'reconnecting'
    managerState.everConnected = false

    renderHook(() => useLiveRecovery({ queryKeys: [['vehicle-state']] }), {
      wrapper: wrapper(client),
    })

    act(() => { emit('connected') })
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('negative control: a late mount while ALREADY connected does not recover on a redundant connect', () => {
    managerState.state = 'connected'
    managerState.everConnected = true

    renderHook(() => useLiveRecovery({ queryKeys: [['vehicle-state']] }), {
      wrapper: wrapper(client),
    })

    act(() => { emit('connected') })
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('recovers after an explicit disconnect when the hook mounted while connected', () => {
    // A late subscriber receives no replayed `connected` event, so the prior
    // live state has to be seeded from the manager or a genuine outage would
    // be misclassified as a never-connected failure and skipped.
    managerState.state = 'connected'
    managerState.everConnected = true

    renderHook(() => useLiveRecovery({ queryKeys: [['vehicle-state']] }), {
      wrapper: wrapper(client),
    })

    act(() => { emit('disconnected') })
    act(() => { emit('connected') })

    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  it('re-reads the canonical sources after a reconnect', () => {
    const onRecover = vi.fn()
    renderHook(
      () => useLiveRecovery({ queryKeys: [['vehicle-state'], ['signals', 'live']], onRecover }),
      { wrapper: wrapper(client) },
    )

    act(() => { emit('connected') })
    act(() => { emit('disconnected') })
    act(() => { emit('connected') })

    expect(invalidate).toHaveBeenCalledTimes(2)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['vehicle-state'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['signals', 'live'] })
    expect(onRecover).toHaveBeenCalledTimes(1)
    expect(onRecover.mock.calls[0]![0]).toBeGreaterThanOrEqual(0)
  })

  it('collapses a flapping connection into a single recovery', () => {
    renderHook(
      () => useLiveRecovery({ queryKeys: [['vehicle-state']], cooldownMs: 60_000 }),
      { wrapper: wrapper(client) },
    )

    act(() => { emit('connected') })
    act(() => { emit('disconnected'); emit('connected') })
    act(() => { emit('disconnected'); emit('connected') })
    act(() => { emit('disconnected'); emit('connected') })

    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  it('defers recovery while the tab is hidden and catches up on visibility', () => {
    renderHook(() => useLiveRecovery({ queryKeys: [['vehicle-state']] }), {
      wrapper: wrapper(client),
    })

    act(() => { emit('connected') })
    hidden = true
    act(() => { emit('disconnected'); emit('connected') })

    // Hidden tabs must not issue network traffic.
    expect(invalidate).not.toHaveBeenCalled()

    act(() => {
      hidden = false
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  it('does nothing when disabled', () => {
    renderHook(
      () => useLiveRecovery({ queryKeys: [['vehicle-state']], enabled: false }),
      { wrapper: wrapper(client) },
    )
    act(() => { emit('connected'); emit('disconnected'); emit('connected') })
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(
      () => useLiveRecovery({ queryKeys: [['vehicle-state']] }),
      { wrapper: wrapper(client) },
    )
    expect(listeners.get('connected')?.size).toBe(1)
    unmount()
    expect(listeners.get('connected')?.size ?? 0).toBe(0)
    expect(listeners.get('disconnected')?.size ?? 0).toBe(0)
  })
})
