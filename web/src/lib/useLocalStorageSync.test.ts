/**
 * useLocalStorageSync contract tests.
 *
 * Co-located beside the source. Exercises the initial read (present value,
 * empty key, and a parser that throws on the stored raw), the setter (write /
 * remove-on-null / quota-swallow / bus fan-out), both refresh transports (the
 * hook's own `storage` listener and the cross-tab bus via a synthetic fallback
 * envelope), listener cleanup on unmount, and the two hardening guarantees: a
 * stable `set` identity and use of the *latest* `parse` on a cross-tab refresh
 * (a regression guard for the pre-hardening stale-closure bug).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

// Keep the real message bus (subscribe + envelope parsing) but stub the
// outbound `broadcast` so the setter's fan-out is assertable without wiring up
// a second tab. subscribe() is still exercised for real via synthetic
// `storage` events dispatched below.
vi.mock('./broadcast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./broadcast')>()
  return { ...actual, broadcast: vi.fn() }
})

import { broadcast } from './broadcast'
import { useLocalStorageSync } from './useLocalStorageSync'

const broadcastMock = vi.mocked(broadcast)
const KEY = 'apex-sync-key'
const MSG = 'dashboard.layout' as const

const identity = (v: string): string => v
const orNone = (raw: string | null): string => raw ?? 'none'

beforeEach(() => {
  window.localStorage.clear()
  broadcastMock.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// A synthetic cross-tab bus envelope, delivered through the localStorage
// fallback transport that `subscribe()` listens on (jsdom has no
// BroadcastChannel, so this is the live path). `_from` must differ from this
// tab's TAB_ID so the self-filter lets the message through.
function dispatchBusMessage(type: string): void {
  const envelope = { _from: 'other-tab', _ts: Date.now(), msg: { type } }
  const busKey = `__teslasync_bus_${Date.now()}_${Math.random().toString(36).slice(2)}`
  act(() => {
    window.dispatchEvent(
      new StorageEvent('storage', { key: busKey, newValue: JSON.stringify(envelope) }),
    )
  })
}

function dispatchStorage(key: string, newValue: string | null): void {
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key, newValue }))
  })
}

describe('useLocalStorageSync — initial read', () => {
  it('reads and parses an existing localStorage value on mount', () => {
    window.localStorage.setItem(KEY, 'stored')
    const parse = vi.fn((raw: string | null) => `parsed:${raw ?? 'none'}`)

    const { result } = renderHook(() => useLocalStorageSync(KEY, parse, identity, MSG))

    expect(result.current[0]).toBe('parsed:stored')
    expect(parse).toHaveBeenCalledWith('stored')
  })

  it('parses null when the key is absent', () => {
    const { result } = renderHook(() =>
      useLocalStorageSync(KEY, (raw) => raw ?? 'DEFAULT', identity, MSG),
    )

    expect(result.current[0]).toBe('DEFAULT')
  })

  it('falls back to parse(null) when the parser throws on the stored raw', () => {
    window.localStorage.setItem(KEY, 'BOOM')
    const parse = (raw: string | null): string => {
      if (raw === 'BOOM') throw new Error('unparseable')
      return raw ?? 'SAFE'
    }

    const { result } = renderHook(() => useLocalStorageSync(KEY, parse, identity, MSG))

    expect(result.current[0]).toBe('SAFE')
  })
})

describe('useLocalStorageSync — setter', () => {
  it('writes to localStorage, updates state, and broadcasts the message type', () => {
    const { result } = renderHook(() => useLocalStorageSync(KEY, orNone, identity, MSG))

    act(() => result.current[1]('written'))

    expect(window.localStorage.getItem(KEY)).toBe('written')
    expect(result.current[0]).toBe('written')
    expect(broadcastMock).toHaveBeenCalledTimes(1)
    expect(broadcastMock).toHaveBeenCalledWith({ type: MSG })
  })

  it('removes the storage key when serialize returns null', () => {
    window.localStorage.setItem(KEY, 'existing')
    const serialize = (v: string): string | null => (v === '' ? null : v)

    const { result } = renderHook(() => useLocalStorageSync(KEY, orNone, serialize, MSG))

    act(() => result.current[1](''))

    expect(window.localStorage.getItem(KEY)).toBeNull()
    expect(result.current[0]).toBe('')
    expect(broadcastMock).toHaveBeenCalledWith({ type: MSG })
  })

  it('swallows a storage quota error but still updates state and broadcasts', () => {
    const { result } = renderHook(() => useLocalStorageSync(KEY, orNone, identity, MSG))
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    expect(() => act(() => result.current[1]('boom'))).not.toThrow()
    spy.mockRestore()

    expect(result.current[0]).toBe('boom')
    expect(broadcastMock).toHaveBeenCalledWith({ type: MSG })
  })
})

describe('useLocalStorageSync — cross-tab refresh', () => {
  it('refreshes from the hook\'s own storage listener on a matching key', () => {
    const { result } = renderHook(() => useLocalStorageSync(KEY, orNone, identity, MSG))
    expect(result.current[0]).toBe('none')

    // Simulate a sibling tab writing to the same key, then the storage event
    // that jsdom would otherwise only fire cross-document.
    window.localStorage.setItem(KEY, 'peer-write')
    dispatchStorage(KEY, 'peer-write')

    expect(result.current[0]).toBe('peer-write')
  })

  it('ignores storage events for an unrelated key', () => {
    const parse = vi.fn(orNone)
    const { result } = renderHook(() => useLocalStorageSync(KEY, parse, identity, MSG))
    parse.mockClear()

    window.localStorage.setItem('unrelated', 'x')
    dispatchStorage('unrelated', 'x')

    expect(parse).not.toHaveBeenCalled()
    expect(result.current[0]).toBe('none')
  })

  it('refreshes from a cross-tab bus message whose type matches', () => {
    const { result } = renderHook(() => useLocalStorageSync(KEY, orNone, identity, MSG))

    window.localStorage.setItem(KEY, 'via-bus')
    dispatchBusMessage(MSG)

    expect(result.current[0]).toBe('via-bus')
  })

  it('ignores a cross-tab bus message whose type does not match', () => {
    const { result } = renderHook(() => useLocalStorageSync(KEY, orNone, identity, MSG))

    window.localStorage.setItem(KEY, 'via-bus')
    dispatchBusMessage('onboarded')

    expect(result.current[0]).toBe('none')
  })
})

describe('useLocalStorageSync — cleanup', () => {
  it('stops refreshing after unmount (both listeners removed)', () => {
    const parse = vi.fn(orNone)
    const { unmount } = renderHook(() => useLocalStorageSync(KEY, parse, identity, MSG))

    unmount()
    parse.mockClear()

    window.localStorage.setItem(KEY, 'after-unmount')
    dispatchStorage(KEY, 'after-unmount')
    dispatchBusMessage(MSG)

    expect(parse).not.toHaveBeenCalled()
  })
})

describe('useLocalStorageSync — hardening guarantees', () => {
  it('returns a stable set identity across re-renders and rebinds when the key changes', () => {
    const { result, rerender } = renderHook(
      ({ k }: { k: string }) => useLocalStorageSync(k, orNone, identity, MSG),
      { initialProps: { k: KEY } },
    )
    const firstSet = result.current[1]

    rerender({ k: KEY })
    expect(result.current[1]).toBe(firstSet)

    rerender({ k: 'other-key' })
    expect(result.current[1]).not.toBe(firstSet)
  })

  it('uses the latest parse on a cross-tab refresh after the parser identity changes', () => {
    const { result, rerender } = renderHook(
      ({ p }: { p: (raw: string | null) => string }) =>
        useLocalStorageSync(KEY, p, identity, MSG),
      { initialProps: { p: (raw: string | null) => `v1:${raw ?? 'none'}` } },
    )
    expect(result.current[0]).toBe('v1:none')

    // Swap in a new parser with the same key/msgType. The effect must not
    // re-subscribe, yet the next refresh must run the *new* parser — the
    // pre-hardening closure captured the stale one and rendered 'v1:X'.
    rerender({ p: (raw: string | null) => `v2:${raw ?? 'none'}` })
    window.localStorage.setItem(KEY, 'X')
    dispatchStorage(KEY, 'X')

    expect(result.current[0]).toBe('v2:X')
  })
})
