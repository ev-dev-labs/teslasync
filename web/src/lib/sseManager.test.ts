/**
 * Unit tests for the singleton SSE connection manager
 * (`web/src/lib/sseManager.ts`).
 *
 * The module exposes a single runtime export — `sseManager` — whose surface is
 * exercised in full here:
 *   - subscribe / unsubscribe   (auto-connect on first, auto-teardown on last)
 *   - connect / disconnect      (idempotency + pending-reconnect cancellation)
 *   - getState                  ('reconnecting' → 'connected' transitions)
 *   - getLastMessageAt          (server-message freshness, NOT bumped on error)
 *   - hasEverConnected          (session-lifetime latch)
 *
 * It also pins the three hardening fixes the source carries:
 *   1. malformed / empty frames yield `null` instead of throwing (safeParse),
 *      and a bad `connected` frame still transitions the wire to "connected";
 *   2. a fresh connect() cancels any scheduled reconnect (no duplicate socket);
 *   3. explicit disconnect() / last-unsubscribe resets the exponential backoff.
 *
 * The transport is a controllable `FakeEventSource` swapped onto the global,
 * mirroring the pattern in `api/__tests__/sseClient.test.ts`. The module is
 * re-imported fresh for every test (`vi.resetModules()`) so its module-scoped
 * connection state never leaks across cases. No real EventSource / network is
 * ever opened.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// --- Controllable fake transport -------------------------------------------

class FakeEventSource {
  static instances: FakeEventSource[] = []

  url: string
  readyState = 1
  closed = false
  onerror: ((ev: Event) => void) | null = null
  private handlers = new Map<string, Set<EventListener>>()

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, cb: EventListener): void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set())
    this.handlers.get(type)!.add(cb)
  }

  removeEventListener(type: string, cb: EventListener): void {
    this.handlers.get(type)?.delete(cb)
  }

  close(): void {
    this.readyState = 2
    this.closed = true
  }

  /** Deliver a named server frame with an optional raw string payload. */
  emit(type: string, data?: string): void {
    const ev = new MessageEvent(type, data === undefined ? {} : { data })
    this.handlers.get(type)?.forEach((cb) => cb(ev))
  }

  /** Fire the transport-level error handler (drives reconnect/backoff). */
  fail(): void {
    this.onerror?.(new Event('error'))
  }
}

function latestES(): FakeEventSource {
  const list = FakeEventSource.instances
  return list[list.length - 1]
}

const globalWithES = globalThis as { EventSource?: unknown }
const ORIGINAL_EVENT_SOURCE = globalWithES.EventSource

// A fresh module instance per test — the manager keeps all state at module
// scope, so without this the singleton would carry connections between cases.
let sseManager: typeof import('./sseManager').sseManager

beforeEach(async () => {
  FakeEventSource.instances = []
  globalWithES.EventSource = FakeEventSource
  vi.resetModules()
  const mod = await import('./sseManager')
  sseManager = mod.sseManager
  // Deterministic timers for every reconnect/backoff assertion.
  vi.useFakeTimers()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  if (ORIGINAL_EVENT_SOURCE) {
    globalWithES.EventSource = ORIGINAL_EVENT_SOURCE
  } else {
    delete globalWithES.EventSource
  }
})

// ---------------------------------------------------------------------------
// connection lifecycle
// ---------------------------------------------------------------------------

describe('sseManager — connection lifecycle', () => {
  it('opens a single EventSource on /api/v1/events for the first subscriber', () => {
    sseManager.subscribe('vehicle_update', vi.fn())
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(latestES().url).toBe('/api/v1/events')
  })

  it('does not open a second connection for additional subscribers', () => {
    sseManager.subscribe('vehicle_update', vi.fn())
    sseManager.subscribe('alert', vi.fn())
    sseManager.subscribe('heartbeat', vi.fn())
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it('starts "reconnecting" and flips to "connected" on the connected frame', () => {
    sseManager.subscribe('connected', vi.fn())
    expect(sseManager.getState()).toBe('reconnecting')
    expect(sseManager.hasEverConnected()).toBe(false)

    latestES().emit('connected', JSON.stringify({ client_id: 'sse-1' }))
    expect(sseManager.getState()).toBe('connected')
    expect(sseManager.hasEverConnected()).toBe(true)
  })

  it('connect() does not open a second socket when one already exists', () => {
    sseManager.subscribe('vehicle_update', vi.fn())
    expect(FakeEventSource.instances).toHaveLength(1)
    sseManager.connect()
    sseManager.connect()
    expect(FakeEventSource.instances).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// server event dispatch
// ---------------------------------------------------------------------------

describe('sseManager — server event dispatch', () => {
  it('forwards the parsed connected payload to connected subscribers', () => {
    const spy = vi.fn()
    sseManager.subscribe('connected', spy)
    latestES().emit('connected', JSON.stringify({ client_id: 'sse-7' }))
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith({ client_id: 'sse-7' })
  })

  it('forwards every parsed application event on the shared connection', () => {
    const events = [
      'vehicle_update',
      'signal_change',
      'alert',
      'export_status',
      'achievement_unlocked',
    ] as const
    for (const event of events) {
      const spy = vi.fn()
      sseManager.subscribe(event, spy)
      latestES().emit(event, JSON.stringify({ event, value: 42 }))
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy).toHaveBeenCalledWith({ event, value: 42 })
    }
  })

  it('delivers a payload-less heartbeat as null without throwing', () => {
    const spy = vi.fn()
    sseManager.subscribe('heartbeat', spy)
    expect(() => latestES().emit('heartbeat')).not.toThrow()
    expect(spy).toHaveBeenCalledWith(null)
  })

  it('updates lastMessageAt on server frames but NOT on synthetic disconnect', () => {
    expect(sseManager.getLastMessageAt()).toBeNull()
    sseManager.subscribe('vehicle_update', vi.fn())

    latestES().emit('vehicle_update', JSON.stringify({ n: 1 }))
    const t1 = sseManager.getLastMessageAt()
    expect(t1).not.toBeNull()
    expect(typeof t1).toBe('number')

    vi.advanceTimersByTime(5000)
    latestES().emit('vehicle_update', JSON.stringify({ n: 2 }))
    const t2 = sseManager.getLastMessageAt()
    expect(t2).toBe((t1 as number) + 5000)

    // A transport error is synthetic — freshness must stay pinned to t2.
    latestES().fail()
    expect(sseManager.getLastMessageAt()).toBe(t2)
  })
})

// ---------------------------------------------------------------------------
// malformed-payload hardening (safeParse)
// ---------------------------------------------------------------------------

describe('sseManager — malformed payload hardening', () => {
  it('emits null instead of throwing when a data frame carries malformed JSON', () => {
    const spy = vi.fn()
    sseManager.subscribe('vehicle_update', spy)
    expect(() => latestES().emit('vehicle_update', '{ not valid json')).not.toThrow()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(null)
  })

  it('still transitions to connected when the connected frame is malformed', () => {
    const spy = vi.fn()
    sseManager.subscribe('connected', spy)
    expect(() => latestES().emit('connected', 'not-json')).not.toThrow()
    // The wire is up regardless of a bad greeting payload...
    expect(sseManager.getState()).toBe('connected')
    expect(sseManager.hasEverConnected()).toBe(true)
    // ...and subscribers are still notified (with a null payload).
    expect(spy).toHaveBeenCalledWith(null)
  })
})

// ---------------------------------------------------------------------------
// listener management
// ---------------------------------------------------------------------------

describe('sseManager — listener management', () => {
  it('delivers to every subscriber and stops delivering after unsubscribe', () => {
    const a = vi.fn()
    const b = vi.fn()
    sseManager.subscribe('vehicle_update', a)
    sseManager.subscribe('vehicle_update', b)

    latestES().emit('vehicle_update', JSON.stringify({ n: 1 }))
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)

    sseManager.unsubscribe('vehicle_update', a)
    latestES().emit('vehicle_update', JSON.stringify({ n: 2 }))
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(2)
  })

  it('isolates a throwing listener so sibling listeners still run', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const boom = vi.fn(() => {
      throw new Error('listener boom')
    })
    const ok = vi.fn()
    sseManager.subscribe('alert', boom)
    sseManager.subscribe('alert', ok)

    expect(() => latestES().emit('alert', JSON.stringify({ id: 7 }))).not.toThrow()
    expect(boom).toHaveBeenCalledTimes(1)
    expect(ok).toHaveBeenCalledWith({ id: 7 })
    expect(errSpy).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// reconnect + exponential backoff
// ---------------------------------------------------------------------------

describe('sseManager — reconnect + backoff', () => {
  it('flips to reconnecting and notifies disconnected subscribers on transport error', () => {
    const onDisc = vi.fn()
    sseManager.subscribe('disconnected', onDisc)
    latestES().emit('connected', JSON.stringify({}))
    expect(sseManager.getState()).toBe('connected')

    latestES().fail()
    expect(sseManager.getState()).toBe('reconnecting')
    expect(onDisc).toHaveBeenCalledTimes(1)
    expect(latestES().closed).toBe(true)
  })

  it('reconnects with a fresh EventSource after the base 1s backoff', () => {
    sseManager.subscribe('vehicle_update', vi.fn())
    expect(FakeEventSource.instances).toHaveLength(1)

    latestES().fail()
    vi.advanceTimersByTime(999)
    expect(FakeEventSource.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeEventSource.instances).toHaveLength(2)
  })

  it('escalates the reconnect backoff 1s → 2s → 4s on consecutive failures', () => {
    sseManager.subscribe('vehicle_update', vi.fn())

    latestES().fail() // failCount=1 → 1000ms
    vi.advanceTimersByTime(999)
    expect(FakeEventSource.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeEventSource.instances).toHaveLength(2)

    latestES().fail() // failCount=2 → 2000ms
    vi.advanceTimersByTime(1999)
    expect(FakeEventSource.instances).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeEventSource.instances).toHaveLength(3)

    latestES().fail() // failCount=3 → 4000ms
    vi.advanceTimersByTime(3999)
    expect(FakeEventSource.instances).toHaveLength(3)
    vi.advanceTimersByTime(1)
    expect(FakeEventSource.instances).toHaveLength(4)
  })

  it('caps the exponential backoff at 60s', () => {
    sseManager.subscribe('vehicle_update', vi.fn())
    const delays = [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]
    for (const delay of delays) {
      const before = FakeEventSource.instances.length
      latestES().fail()
      vi.advanceTimersByTime(delay - 1)
      expect(FakeEventSource.instances.length).toBe(before)
      vi.advanceTimersByTime(1)
      expect(FakeEventSource.instances.length).toBe(before + 1)
    }
  })

  it('resets the connected wire back to a fresh 1s backoff after a success', () => {
    sseManager.subscribe('vehicle_update', vi.fn())
    latestES().fail() // failCount=1
    vi.advanceTimersByTime(1000)
    latestES().fail() // failCount=2
    vi.advanceTimersByTime(2000) // reconnect

    // A successful connected frame resets failCount to 0.
    latestES().emit('connected', JSON.stringify({}))
    expect(sseManager.getState()).toBe('connected')

    // Next failure should therefore schedule the base 1s delay again.
    const before = FakeEventSource.instances.length
    latestES().fail()
    vi.advanceTimersByTime(999)
    expect(FakeEventSource.instances.length).toBe(before)
    vi.advanceTimersByTime(1)
    expect(FakeEventSource.instances.length).toBe(before + 1)
  })
})

// ---------------------------------------------------------------------------
// teardown resets backoff (hardening fix #3)
// ---------------------------------------------------------------------------

describe('sseManager — teardown resets backoff', () => {
  it('resets the backoff to base 1s after an explicit disconnect', () => {
    sseManager.subscribe('vehicle_update', vi.fn())
    latestES().fail() // failCount=1
    vi.advanceTimersByTime(1000)
    latestES().fail() // failCount=2 (a 2s reconnect is now pending)

    sseManager.disconnect() // cancels the pending reconnect + resets failCount
    vi.advanceTimersByTime(10000)
    const afterDisconnect = FakeEventSource.instances.length

    sseManager.connect()
    expect(FakeEventSource.instances.length).toBe(afterDisconnect + 1)

    // failCount was reset → next failure schedules 1s, not 4s.
    const before = FakeEventSource.instances.length
    latestES().fail()
    vi.advanceTimersByTime(999)
    expect(FakeEventSource.instances.length).toBe(before)
    vi.advanceTimersByTime(1)
    expect(FakeEventSource.instances.length).toBe(before + 1)
  })

  it('resets the backoff after the last subscriber unsubscribes', () => {
    const listener = vi.fn()
    sseManager.subscribe('vehicle_update', listener)
    latestES().fail() // failCount=1
    vi.advanceTimersByTime(1000)
    latestES().fail() // failCount=2
    vi.advanceTimersByTime(2000)
    latestES().fail() // failCount=3 (a 4s reconnect is pending)

    sseManager.unsubscribe('vehicle_update', listener)
    // Pending reconnect was cancelled by the teardown.
    vi.advanceTimersByTime(10000)
    const idle = FakeEventSource.instances.length

    sseManager.subscribe('vehicle_update', vi.fn())
    expect(FakeEventSource.instances.length).toBe(idle + 1)

    const before = FakeEventSource.instances.length
    latestES().fail()
    vi.advanceTimersByTime(999)
    expect(FakeEventSource.instances.length).toBe(before)
    vi.advanceTimersByTime(1)
    expect(FakeEventSource.instances.length).toBe(before + 1)
  })
})

// ---------------------------------------------------------------------------
// connect/disconnect cancels a pending reconnect (hardening fixes #2/#3)
// ---------------------------------------------------------------------------

describe('sseManager — pending-reconnect cancellation', () => {
  it('cancels a scheduled reconnect when connect() races the backoff', () => {
    sseManager.subscribe('vehicle_update', vi.fn())
    latestES().fail() // schedules a 1s reconnect; source is now null
    expect(FakeEventSource.instances).toHaveLength(1)

    // Racing connect() opens immediately AND clears the queued reconnect,
    // so the timer must not later churn a duplicate third socket.
    sseManager.connect()
    expect(FakeEventSource.instances).toHaveLength(2)
    vi.advanceTimersByTime(5000)
    expect(FakeEventSource.instances).toHaveLength(2)
  })

  it('disconnect() closes the socket, cancels reconnect, and leaves state reconnecting', () => {
    sseManager.subscribe('vehicle_update', vi.fn())
    const es1 = latestES()
    es1.emit('connected', JSON.stringify({}))
    expect(sseManager.getState()).toBe('connected')

    es1.fail() // schedule a reconnect
    sseManager.disconnect()
    vi.advanceTimersByTime(60000)

    expect(FakeEventSource.instances).toHaveLength(1)
    expect(es1.closed).toBe(true)
    expect(sseManager.getState()).toBe('reconnecting')
  })
})
