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

// ─────────────────────────────────────────────────────────────────────────────
// The cooldown must THROTTLE recoveries, never DISCARD them.
//
// The original implementation returned early inside the cooldown window and
// dropped `pendingRef` on the floor. A second genuine outage landing a few
// seconds after a recovery therefore lost its outage marker permanently: the
// state missed during that second outage was never re-read, the connection
// indicator went green, and the UI silently stayed behind — the exact
// failure this hook exists to prevent, now wearing a healthy badge.
//
// Every case below runs on fake timers so the deferred flush is observed
// deterministically rather than inferred from a wall-clock race.
describe('useLiveRecovery — a second outage inside the cooldown is deferred, never dropped', () => {
  const T0 = 1_700_000_000_000
  const COOLDOWN = 5_000

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
    vi.useFakeTimers()
    vi.setSystemTime(T0)
  })

  afterEach(() => {
    vi.useRealTimers()
    if (hiddenDescriptor) {
      Object.defineProperty(Document.prototype, 'hidden', hiddenDescriptor)
    }
  })

  /** Mount with an explicit cooldown; the pipe is already live at mount. */
  function mount(cooldownMs = COOLDOWN, onRecover?: (ms: number) => void) {
    return renderHook(
      () => useLiveRecovery({ queryKeys: [['vehicle-state']], cooldownMs, onRecover }),
      { wrapper: wrapper(client) },
    )
  }

  /** One complete outage: down for `forMs`, then back up. */
  function outage(forMs: number) {
    act(() => { emit('disconnected') })
    act(() => { vi.advanceTimersByTime(forMs) })
    act(() => { emit('connected') })
  }

  it('runs the FIRST recovery immediately even when the clock sits at the epoch', () => {
    // Regression guard for seeding "never recovered" as `0`: at t≈0 the
    // elapsed-since-last-recovery arithmetic yielded a value inside the
    // cooldown, so the very first recovery was needlessly deferred.
    vi.setSystemTime(0)
    mount()

    outage(1_000)

    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('holds the second outage and flushes exactly ONE recovery when the cooldown expires', () => {
    const onRecover = vi.fn()
    mount(COOLDOWN, onRecover)

    // Outage #1 — recovers immediately, opening the cooldown window.
    outage(1_000)
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(onRecover).toHaveBeenLastCalledWith(1_000)

    // Outage #2 — a genuine, separate outage that ends inside the window.
    act(() => { vi.advanceTimersByTime(1_000) })
    outage(2_000)

    // Throttled, not dropped: nothing has fired yet, but a flush is armed.
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(1)

    // Nothing escapes early.
    act(() => { vi.advanceTimersByTime(1_999) })
    expect(invalidate).toHaveBeenCalledTimes(1)

    act(() => { vi.advanceTimersByTime(2) })
    expect(invalidate).toHaveBeenCalledTimes(2)
    expect(invalidate).toHaveBeenLastCalledWith({ queryKey: ['vehicle-state'] })
    expect(onRecover).toHaveBeenCalledTimes(2)
    // The window reported is the SECOND outage, not the first.
    expect(onRecover).toHaveBeenLastCalledWith(2_000)
    // No stray timer survives the flush.
    expect(vi.getTimerCount()).toBe(0)
  })

  it('collapses three in-window outages into ONE deferred recovery reporting the LONGEST gap', () => {
    const onRecover = vi.fn()
    mount(60_000, onRecover)

    outage(500)                                   // recovery #1, opens the window
    expect(invalidate).toHaveBeenCalledTimes(1)

    act(() => { vi.advanceTimersByTime(100) })
    outage(3_000)
    act(() => { vi.advanceTimersByTime(100) })
    outage(800)                                   // shorter — must not win
    act(() => { vi.advanceTimersByTime(100) })
    outage(5_000)                                 // longest

    // Exactly one flush is armed for all three.
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(1)

    act(() => { vi.advanceTimersByTime(60_000) })

    expect(invalidate).toHaveBeenCalledTimes(2)
    expect(onRecover).toHaveBeenCalledTimes(2)
    // An honest window: the operator missed at least 5 s of state.
    expect(onRecover).toHaveBeenLastCalledWith(5_000)
  })

  it('keeps the pending recovery when the tab hides BEFORE the deferred flush fires', () => {
    mount()

    outage(0)                                     // recovery #1 at T0
    expect(invalidate).toHaveBeenCalledTimes(1)

    act(() => { vi.advanceTimersByTime(1_000) })
    outage(1_000)                                 // ends T0+2000, flush due T0+5000
    expect(invalidate).toHaveBeenCalledTimes(1)

    // Tab goes to the background before the flush is due.
    act(() => {
      hidden = true
      document.dispatchEvent(new Event('visibilitychange'))
    })
    act(() => { vi.advanceTimersByTime(10_000) })

    // Hidden tabs issue no traffic — and the pending marker is NOT discarded.
    expect(invalidate).toHaveBeenCalledTimes(1)

    act(() => {
      hidden = false
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(invalidate).toHaveBeenCalledTimes(2)
  })

  it('keeps the pending recovery for an in-window outage that happens entirely while hidden', () => {
    mount()

    outage(0)                                     // recovery #1
    hidden = true

    act(() => { vi.advanceTimersByTime(1_000) })
    outage(1_000)

    // While hidden nothing is even scheduled — the flush is driven by
    // visibility, so no background timer can leak a request out.
    expect(invalidate).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(invalidate).toHaveBeenCalledTimes(1)

    act(() => {
      hidden = false
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(invalidate).toHaveBeenCalledTimes(2)
  })

  it('never fires a deferred recovery into an unmounted consumer', () => {
    const onRecover = vi.fn()
    const { unmount } = mount(COOLDOWN, onRecover)

    outage(0)
    act(() => { vi.advanceTimersByTime(1_000) })
    outage(500)
    expect(vi.getTimerCount()).toBe(1)

    unmount()
    // The armed flush is cancelled with the subscription, not left to fire
    // into a dead tree.
    expect(vi.getTimerCount()).toBe(0)

    act(() => { vi.advanceTimersByTime(60_000) })
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(onRecover).toHaveBeenCalledTimes(1)
  })

  it('re-arms a pending recovery when the cooldown option changes mid-window', () => {
    // The effect cleanup clears the armed timer, so an options change used to
    // strand an already-deferred recovery for the rest of the session.
    const { rerender } = renderHook(
      ({ cd }: { cd: number }) =>
        useLiveRecovery({ queryKeys: [['vehicle-state']], cooldownMs: cd }),
      { wrapper: wrapper(client), initialProps: { cd: 60_000 } },
    )

    outage(0)                                     // recovery #1 at T0
    expect(invalidate).toHaveBeenCalledTimes(1)

    act(() => { vi.advanceTimersByTime(1_000) })
    outage(1_000)                                 // deferred to T0+60000
    expect(invalidate).toHaveBeenCalledTimes(1)

    act(() => { rerender({ cd: 3_000 }) })

    // Re-armed against the NEW cooldown: due at T0+3000, i.e. 1 s from now.
    act(() => { vi.advanceTimersByTime(1_001) })
    expect(invalidate).toHaveBeenCalledTimes(2)
  })

  it('arms no deferred flush for pre-open failures — there is nothing to recover', () => {
    managerState.state = 'reconnecting'
    managerState.everConnected = false
    mount()

    act(() => { emit('disconnected'); emit('disconnected') })
    act(() => { emit('connected') })

    expect(invalidate).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)

    // A REAL outage after that first open still recovers normally.
    act(() => { vi.advanceTimersByTime(1_000) })
    outage(1_000)
    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  it('recovers a late-mounted outage immediately and still defers a follow-up outage', () => {
    // Late subscriber: the `disconnected` fired before mount and is never
    // replayed, so the outage marker is seeded from the manager's own state.
    managerState.state = 'reconnecting'
    managerState.everConnected = true
    mount()

    act(() => { emit('connected') })
    expect(invalidate).toHaveBeenCalledTimes(1)

    act(() => { vi.advanceTimersByTime(1_000) })
    outage(1_000)
    expect(invalidate).toHaveBeenCalledTimes(1)

    act(() => { vi.advanceTimersByTime(COOLDOWN) })
    expect(invalidate).toHaveBeenCalledTimes(2)
  })
})
