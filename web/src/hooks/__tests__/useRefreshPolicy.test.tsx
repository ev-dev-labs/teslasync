import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// The connection model has its own suite (`useConnectionModel.test.ts` for the
// pure reducer, `useConnectionModel.freshness.test.tsx` for the clock). Here it
// is a controlled INPUT so the wiring can be exercised without jsdom network
// plumbing.
const { connectionMock } = vi.hoisted(() => ({ connectionMock: vi.fn() }))

vi.mock('../useConnectionModel', () => ({
  useConnectionModel: () => connectionMock(),
}))

import {
  SAVE_DATA_INTERVAL_MULTIPLIER,
  resolveRefreshInterval,
  useDocumentHidden,
  useRefreshInterval,
  useSaveData,
  type RefreshContext,
} from '../useRefreshPolicy'
import type { ConnectionModel } from '../useConnectionModel'

const BASE = 10_000

/** A fully healthy connection model; override only what a case is about. */
function model(overrides: Partial<ConnectionModel> = {}): ConnectionModel {
  return {
    browser: 'online',
    api: 'ok',
    stream: 'connected',
    telemetry: { scope: 'fleet', status: 'fresh', lastTelemetryAt: null, ageMs: 0 },
    overall: 'live',
    reason: 'ok',
    canReachApi: true,
    isStreaming: false,
    ...overrides,
  }
}

function context(overrides: Partial<RefreshContext> = {}): RefreshContext {
  return {
    documentHidden: false,
    online: true,
    apiReachable: true,
    saveData: false,
    streaming: false,
    ...overrides,
  }
}

describe('resolveRefreshInterval — hidden-tab pause', () => {
  it('stops standard polling while the tab is hidden', () => {
    expect(resolveRefreshInterval(BASE, context({ documentHidden: true }))).toBe(false)
  })

  it('stops background polling while the tab is hidden', () => {
    expect(
      resolveRefreshInterval(BASE, context({ documentHidden: true, priority: 'background' })),
    ).toBe(false)
  })

  it('keeps essential polling alive while hidden (live drive / active charge)', () => {
    expect(
      resolveRefreshInterval(BASE, context({ documentHidden: true, priority: 'essential' })),
    ).toBe(BASE)
  })

  it('resumes at the base cadence when the tab becomes visible again', () => {
    expect(resolveRefreshInterval(BASE, context({ documentHidden: false }))).toBe(BASE)
  })
})

describe('resolveRefreshInterval — offline and unreachable API', () => {
  it('stops every poller when the device has no network', () => {
    for (const priority of ['essential', 'standard', 'background'] as const) {
      expect(resolveRefreshInterval(BASE, context({ online: false, priority }))).toBe(false)
    }
  })

  it('stops non-essential pollers when the API is unreachable but the device is online', () => {
    expect(resolveRefreshInterval(BASE, context({ apiReachable: false }))).toBe(false)
    expect(
      resolveRefreshInterval(BASE, context({ apiReachable: false, priority: 'background' })),
    ).toBe(false)
  })

  it('lets essential pollers keep probing for API recovery', () => {
    expect(
      resolveRefreshInterval(BASE, context({ apiReachable: false, priority: 'essential' })),
    ).toBe(BASE)
  })
})

describe('resolveRefreshInterval — save-data', () => {
  it('slows standard pollers rather than killing them', () => {
    expect(resolveRefreshInterval(BASE, context({ saveData: true }))).toBe(
      BASE * SAVE_DATA_INTERVAL_MULTIPLIER,
    )
  })

  it('suppresses decorative pollers entirely', () => {
    expect(
      resolveRefreshInterval(BASE, context({ saveData: true, priority: 'background' })),
    ).toBe(false)
  })

  it('leaves essential pollers at full cadence', () => {
    expect(
      resolveRefreshInterval(BASE, context({ saveData: true, priority: 'essential' })),
    ).toBe(BASE)
  })
})

describe('resolveRefreshInterval — streaming and invalid input', () => {
  it('halves decorative polling while SSE is delivering pushes', () => {
    expect(
      resolveRefreshInterval(BASE, context({ streaming: true, priority: 'background' })),
    ).toBe(BASE * 2)
  })

  it('does not slow standard pollers just because SSE is up', () => {
    expect(resolveRefreshInterval(BASE, context({ streaming: true }))).toBe(BASE)
  })

  it('never lets NaN / non-positive intervals reach the scheduler', () => {
    expect(resolveRefreshInterval(Number.NaN, context())).toBe(false)
    expect(resolveRefreshInterval(0, context())).toBe(false)
    expect(resolveRefreshInterval(-1, context())).toBe(false)
    expect(resolveRefreshInterval(false, context())).toBe(false)
  })
})

describe('useDocumentHidden', () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden')

  afterEach(() => {
    if (originalDescriptor) {
      Object.defineProperty(Document.prototype, 'hidden', originalDescriptor)
    }
    vi.restoreAllMocks()
  })

  it('tracks visibilitychange', () => {
    let hidden = false
    Object.defineProperty(Document.prototype, 'hidden', {
      configurable: true,
      get: () => hidden,
    })

    const { result } = renderHook(() => useDocumentHidden())
    expect(result.current).toBe(false)

    act(() => {
      hidden = true
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current).toBe(true)

    act(() => {
      hidden = false
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current).toBe(false)
  })
})

describe('useSaveData', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'connection')
  })

  function setConnection(value: unknown) {
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value,
    })
  }

  it('is false when the browser exposes no Network Information API', () => {
    const { result } = renderHook(() => useSaveData())
    expect(result.current).toBe(false)
  })

  it('honours an explicit Data Saver toggle', () => {
    setConnection({ saveData: true })
    const { result } = renderHook(() => useSaveData())
    expect(result.current).toBe(true)
  })

  it('treats 2G / slow-2G as reduced-bandwidth', () => {
    setConnection({ saveData: false, effectiveType: 'slow-2g' })
    expect(renderHook(() => useSaveData()).result.current).toBe(true)

    setConnection({ saveData: false, effectiveType: '2g' })
    expect(renderHook(() => useSaveData()).result.current).toBe(true)

    setConnection({ saveData: false, effectiveType: '4g' })
    expect(renderHook(() => useSaveData()).result.current).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The hook form is where the four suppression conditions actually meet: the
// pure matrix above proves the DECISION, these prove the WIRING. A regression
// that reads the wrong field off the connection model (e.g. `isStreaming`
// instead of `canReachApi`) leaves every pure test green while the expensive
// pollers keep hammering a dead backend.
describe('useRefreshInterval — wiring to the live connection model', () => {
  const hiddenDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden')
  let hidden = false

  beforeEach(() => {
    hidden = false
    connectionMock.mockReturnValue(model())
    Object.defineProperty(Document.prototype, 'hidden', {
      configurable: true,
      get: () => hidden,
    })
  })

  afterEach(() => {
    if (hiddenDescriptor) {
      Object.defineProperty(Document.prototype, 'hidden', hiddenDescriptor)
    }
    Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'connection')
  })

  function setConnection(value: unknown) {
    Object.defineProperty(navigator, 'connection', { configurable: true, value })
  }

  it('returns the base cadence on a healthy, visible, unmetered tab', () => {
    const { result } = renderHook(() => useRefreshInterval(BASE))
    expect(result.current).toBe(BASE)
  })

  it('pauses when the tab is hidden and resumes on visibility', () => {
    const { result } = renderHook(() => useRefreshInterval(BASE))
    act(() => {
      hidden = true
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current).toBe(false)

    act(() => {
      hidden = false
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current).toBe(BASE)
  })

  it('pauses when the device drops off the network', () => {
    connectionMock.mockReturnValue(model({ browser: 'offline', canReachApi: false }))
    expect(renderHook(() => useRefreshInterval(BASE)).result.current).toBe(false)
  })

  it('pauses a standard poller when the API is unreachable but the device is online', () => {
    connectionMock.mockReturnValue(model({ canReachApi: false }))
    expect(renderHook(() => useRefreshInterval(BASE)).result.current).toBe(false)
    // …while an essential poller keeps probing for recovery.
    expect(
      renderHook(() => useRefreshInterval(BASE, { priority: 'essential' })).result.current,
    ).toBe(BASE)
  })

  it('stretches — not silences — a standard poller under Data Saver', () => {
    setConnection({ saveData: true })
    expect(renderHook(() => useRefreshInterval(BASE)).result.current)
      .toBe(BASE * SAVE_DATA_INTERVAL_MULTIPLIER)
  })

  it('stretches a standard poller on a 2G connection with no explicit toggle', () => {
    setConnection({ saveData: false, effectiveType: '2g' })
    expect(renderHook(() => useRefreshInterval(BASE)).result.current)
      .toBe(BASE * SAVE_DATA_INTERVAL_MULTIPLIER)
  })

  it('suppresses decorative pollers entirely under Data Saver', () => {
    setConnection({ saveData: true })
    expect(
      renderHook(() => useRefreshInterval(BASE, { priority: 'background' })).result.current,
    ).toBe(false)
  })

  it('halves decorative pollers while SSE is pushing', () => {
    connectionMock.mockReturnValue(model({ isStreaming: true }))
    expect(
      renderHook(() => useRefreshInterval(BASE, { priority: 'background' })).result.current,
    ).toBe(BASE * 2)
  })

  it('honours an explicit enabled:false regardless of a healthy connection', () => {
    expect(renderHook(() => useRefreshInterval(BASE, { enabled: false })).result.current)
      .toBe(false)
  })

  it('propagates a caller-supplied false base without inventing a cadence', () => {
    expect(renderHook(() => useRefreshInterval(false)).result.current).toBe(false)
  })
})
