/**
 * Behavioural tests for the dedicated automation SSE client
 * (`web/src/lib/automationSSE.ts`). Because the client is a module-level
 * singleton, every test re-imports a fresh copy via `vi.resetModules()` so the
 * internal `source` / `state` / `failCount` / `connecting` latches never bleed
 * between cases.
 *
 * Coverage:
 *   - subscribe() opens exactly one EventSource on the dedicated endpoint and
 *     is shared across subscribers
 *   - the `connected` event flips state and fans out to onConnect listeners
 *   - each of the five typed events is parsed and dispatched
 *   - malformed JSON and throwing listeners are isolated (no crash)
 *   - heartbeat events are ignored
 *   - onerror schedules a capped exponential-backoff reconnect
 *   - unsubscribe() tears down and, critically, does NOT leak the `connecting`
 *     latch (would wedge reconnection) or a pending reconnect timer (zombie
 *     stream) — the two bugs this file hardens against
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AutomationTriggeredEvent,
  AutomationSucceededEvent,
  AutomationFailedEvent,
  AutomationSkippedEvent,
  AutomationStateChangedEvent,
  AutomationSSEEventType,
} from '@/api/types'

type AnyAutomationEvent =
  | AutomationTriggeredEvent
  | AutomationSucceededEvent
  | AutomationFailedEvent
  | AutomationSkippedEvent
  | AutomationStateChangedEvent

// ---------------------------------------------------------------------------
// Controllable EventSource test double
// ---------------------------------------------------------------------------

class FakeEventSource {
  static instances: FakeEventSource[] = []
  static last(): FakeEventSource {
    const s = FakeEventSource.instances.at(-1)
    if (!s) throw new Error('no FakeEventSource has been constructed yet')
    return s
  }

  url: string
  readyState = 1
  closed = false
  onerror: ((ev: Event) => void) | null = null
  private listeners = new Map<string, Set<EventListener>>()

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: EventListener): void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(listener)
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener)
  }

  close(): void {
    this.closed = true
    this.readyState = 2
  }

  /** Dispatch a named SSE event. Pass `data` for typed (MessageEvent) events. */
  emit(type: string, data?: string): void {
    const ev = data !== undefined ? new MessageEvent(type, { data }) : new Event(type)
    for (const listener of this.listeners.get(type) ?? []) {
      listener(ev)
    }
  }

  /** Simulate the underlying stream erroring (drives the backoff/reconnect). */
  fail(): void {
    this.onerror?.(new Event('error'))
  }
}

type AutomationSSE = typeof import('./automationSSE').automationSSE

async function loadFreshClient(): Promise<AutomationSSE> {
  vi.resetModules()
  const mod = await import('./automationSSE')
  return mod.automationSSE
}

const PAYLOADS: Record<AutomationSSEEventType, AnyAutomationEvent> = {
  'automation.triggered': {
    automation_id: 1,
    name: 'Nightly charge',
    vehicle: 'Model 3',
    trigger: 'schedule',
    at: '2026-01-01T00:00:00Z',
    mode: 'live',
  },
  'automation.succeeded': {
    automation_id: 1,
    name: 'Nightly charge',
    duration_ms: 1200,
    actions: 3,
    mode: 'live',
  },
  'automation.failed': {
    automation_id: 2,
    name: 'Preheat',
    error: 'vehicle asleep',
    action_index: 0,
    mode: 'test',
  },
  'automation.skipped': {
    automation_id: 3,
    name: 'Geofence lock',
    reason: 'condition not met',
    mode: 'live',
  },
  'automation.state_changed': {
    automation_id: 4,
    name: 'Retry loop',
    from: 'idle',
    to: 'running',
    trigger: 'manual',
    at: '2026-01-01T00:00:00Z',
    retry_count: 1,
    consecutive_failures: 0,
    mode: 'live',
  },
}

const ALL_TYPES = Object.keys(PAYLOADS) as AutomationSSEEventType[]

beforeEach(() => {
  FakeEventSource.instances.length = 0
  vi.stubGlobal('EventSource', FakeEventSource)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

describe('automationSSE — connection lifecycle', () => {
  it('starts in the reconnecting state and opens nothing before a subscription', async () => {
    const sse = await loadFreshClient()
    expect(sse.getState()).toBe('reconnecting')
    expect(FakeEventSource.instances).toHaveLength(0)
  })

  it('opens a single EventSource on the dedicated automations endpoint on first subscribe', async () => {
    const sse = await loadFreshClient()
    sse.subscribe(vi.fn())
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.last().url).toBe('/api/v1/automations/events')
  })

  it('reuses one EventSource across multiple subscribers and fans events out to each', async () => {
    const sse = await loadFreshClient()
    const a = vi.fn()
    const b = vi.fn()
    sse.subscribe(a)
    sse.subscribe(b)
    expect(FakeEventSource.instances).toHaveLength(1)

    FakeEventSource.last().emit('automation.triggered', JSON.stringify(PAYLOADS['automation.triggered']))
    expect(a).toHaveBeenCalledWith('automation.triggered', PAYLOADS['automation.triggered'])
    expect(b).toHaveBeenCalledWith('automation.triggered', PAYLOADS['automation.triggered'])
  })

  it("flips state to 'connected' and notifies onConnect listeners on the connected event", async () => {
    const sse = await loadFreshClient()
    const onConnect = vi.fn()
    sse.subscribe(vi.fn())
    sse.onConnect(onConnect)
    expect(sse.getState()).toBe('reconnecting')

    FakeEventSource.last().emit('connected')
    expect(sse.getState()).toBe('connected')
    expect(onConnect).toHaveBeenCalledTimes(1)
  })

  it('offConnect removes a previously registered connect listener', async () => {
    const sse = await loadFreshClient()
    const onConnect = vi.fn()
    sse.subscribe(vi.fn())
    sse.onConnect(onConnect)
    sse.offConnect(onConnect)

    FakeEventSource.last().emit('connected')
    expect(sse.getState()).toBe('connected')
    expect(onConnect).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Event dispatch
// ---------------------------------------------------------------------------

describe('automationSSE — event dispatch', () => {
  it('parses and dispatches every one of the five automation event types', async () => {
    const sse = await loadFreshClient()
    const listener = vi.fn()
    sse.subscribe(listener)
    const es = FakeEventSource.last()

    ALL_TYPES.forEach((type, i) => {
      es.emit(type, JSON.stringify(PAYLOADS[type]))
      expect(listener).toHaveBeenNthCalledWith(i + 1, type, PAYLOADS[type])
    })
    expect(listener).toHaveBeenCalledTimes(ALL_TYPES.length)
  })

  it('swallows malformed JSON without throwing and without notifying listeners', async () => {
    const sse = await loadFreshClient()
    const listener = vi.fn()
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    sse.subscribe(listener)

    expect(() => FakeEventSource.last().emit('automation.triggered', '{ not json')).not.toThrow()
    expect(listener).not.toHaveBeenCalled()
    expect(consoleErr).toHaveBeenCalled()
  })

  it('isolates a throwing subscriber so the others still receive the event', async () => {
    const sse = await loadFreshClient()
    const boom = vi.fn(() => {
      throw new Error('listener blew up')
    })
    const good = vi.fn()
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    sse.subscribe(boom)
    sse.subscribe(good)

    expect(() =>
      FakeEventSource.last().emit('automation.failed', JSON.stringify(PAYLOADS['automation.failed'])),
    ).not.toThrow()
    expect(good).toHaveBeenCalledWith('automation.failed', PAYLOADS['automation.failed'])
    expect(consoleErr).toHaveBeenCalled()
  })

  it('ignores heartbeat events (no listener invocation, no throw)', async () => {
    const sse = await loadFreshClient()
    const listener = vi.fn()
    sse.subscribe(listener)

    expect(() => FakeEventSource.last().emit('heartbeat')).not.toThrow()
    expect(listener).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Reconnect / backoff
// ---------------------------------------------------------------------------

describe('automationSSE — reconnect backoff', () => {
  /** Fail the newest stream and assert it reconnects exactly at `delay` ms. */
  function expectReconnectAfter(delay: number): void {
    const before = FakeEventSource.instances.length
    FakeEventSource.last().fail()
    vi.advanceTimersByTime(delay - 1)
    expect(FakeEventSource.instances).toHaveLength(before)
    vi.advanceTimersByTime(1)
    expect(FakeEventSource.instances).toHaveLength(before + 1)
  }

  it('reconnects with growing exponential backoff (1s → 2s → 4s) after errors', async () => {
    vi.useFakeTimers()
    const sse = await loadFreshClient()
    sse.subscribe(vi.fn())

    // state stays 'reconnecting' until a `connected` event arrives
    expect(sse.getState()).toBe('reconnecting')

    expectReconnectAfter(1000)
    expectReconnectAfter(2000)
    expectReconnectAfter(4000)
  })

  it('caps the backoff at 60s no matter how many failures accumulate', async () => {
    vi.useFakeTimers()
    const sse = await loadFreshClient()
    sse.subscribe(vi.fn())

    // failCount 1..6 → 1s,2s,4s,8s,16s,32s
    let delay = 1000
    for (let i = 0; i < 6; i++) {
      expectReconnectAfter(Math.min(delay, 60000))
      delay *= 2
    }
    // failCount 7 → raw 64s, capped to 60s. Proving the cap: at 59_999ms the
    // stream must NOT have reconnected yet, and it must at exactly 60_000ms.
    expectReconnectAfter(60000)
  })
})

// ---------------------------------------------------------------------------
// Teardown + the two hardened bugs
// ---------------------------------------------------------------------------

describe('automationSSE — teardown & regression guards', () => {
  it("closes the stream and returns to 'reconnecting' when the last subscriber leaves", async () => {
    const sse = await loadFreshClient()
    const listener = vi.fn()
    sse.subscribe(listener)
    FakeEventSource.last().emit('connected')
    expect(sse.getState()).toBe('connected')

    sse.unsubscribe(listener)
    expect(FakeEventSource.instances[0].closed).toBe(true)
    expect(sse.getState()).toBe('reconnecting')
  })

  it('keeps the stream open while at least one subscriber remains', async () => {
    const sse = await loadFreshClient()
    const a = vi.fn()
    const b = vi.fn()
    sse.subscribe(a)
    sse.subscribe(b)
    sse.unsubscribe(a)
    expect(FakeEventSource.instances[0].closed).toBe(false)
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it('reopens the stream after an unsubscribe that happened mid-connect (no stuck connecting latch)', async () => {
    const sse = await loadFreshClient()
    const a = vi.fn()
    // subscribe → doConnect() sets connecting=true, but no `connected` event fires
    sse.subscribe(a)
    expect(FakeEventSource.instances).toHaveLength(1)

    // tear down before the connection completes
    sse.unsubscribe(a)
    expect(FakeEventSource.instances[0].closed).toBe(true)

    // a brand-new subscriber MUST reopen the stream — the old code leaked
    // connecting=true here and this second subscribe was a silent no-op.
    sse.subscribe(vi.fn())
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(FakeEventSource.last().closed).toBe(false)
  })

  it('cancels a pending backoff reconnect when the last subscriber leaves (no zombie stream)', async () => {
    vi.useFakeTimers()
    const sse = await loadFreshClient()
    const a = vi.fn()
    sse.subscribe(a)

    // stream errors → a reconnect timer is scheduled while source is null
    FakeEventSource.last().fail()
    expect(sse.getState()).toBe('reconnecting')

    // last subscriber leaves during the backoff window
    sse.unsubscribe(a)

    // advancing well past any backoff must NOT resurrect the stream
    vi.advanceTimersByTime(120000)
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it('does not churn a healthy reconnect when a subscribe races a pending backoff timer', async () => {
    vi.useFakeTimers()
    const sse = await loadFreshClient()
    sse.subscribe(vi.fn())

    // instance 0 errors → schedules a reconnect timer, source becomes null
    FakeEventSource.last().fail()

    // a second subscriber arrives during the backoff window → immediate connect
    sse.subscribe(vi.fn())
    expect(FakeEventSource.instances).toHaveLength(2)
    FakeEventSource.last().emit('connected')
    expect(sse.getState()).toBe('connected')

    // the superseded backoff timer must have been cancelled — advancing time
    // must not tear down and re-open the healthy stream.
    vi.advanceTimersByTime(120000)
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(FakeEventSource.instances[1].closed).toBe(false)
  })

  it('resets the backoff schedule after teardown so a fresh subscribe reconnects at 1s again', async () => {
    vi.useFakeTimers()
    const sse = await loadFreshClient()
    const a = vi.fn()
    sse.subscribe(a)

    // grow the backoff: fail twice (failCount → 2)
    FakeEventSource.last().fail()
    vi.advanceTimersByTime(1000)
    FakeEventSource.last().fail()
    vi.advanceTimersByTime(2000)
    const grown = FakeEventSource.instances.length

    // teardown resets failCount
    sse.unsubscribe(a)
    sse.subscribe(vi.fn())
    const afterResubscribe = FakeEventSource.instances.length
    expect(afterResubscribe).toBe(grown + 1)

    // a fresh error should reconnect after 1s (not the grown 4s), proving reset
    FakeEventSource.last().fail()
    vi.advanceTimersByTime(999)
    expect(FakeEventSource.instances).toHaveLength(afterResubscribe)
    vi.advanceTimersByTime(1)
    expect(FakeEventSource.instances).toHaveLength(afterResubscribe + 1)
  })
})
