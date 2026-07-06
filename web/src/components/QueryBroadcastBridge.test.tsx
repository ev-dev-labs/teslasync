import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

/**
 * QueryBroadcastBridge — cross-tab query-invalidation subscriber.
 *
 * The bridge mounts once under the QueryClientProvider, listens for
 * `queryInvalidate` messages emitted by OTHER tabs, and re-runs the bare
 * `qc.invalidateQueries(...)` for each key (bare — never
 * `invalidateAndBroadcast` — to avoid an infinite ping-pong).
 *
 * The low-level bus mechanics (BroadcastChannel ↔ storage fallback ↔
 * self-tab filtering) are exhaustively covered in
 * `lib/__tests__/broadcast.test.ts`; here we drive the REAL bus through the
 * storage-event transport (the same convention as
 * `hooks/__tests__/useSettings.broadcast.test.tsx`) and additionally capture
 * the registered handler so malformed-payload safety can be asserted
 * directly (a thrown handler is swallowed by `subscribe`, so it is otherwise
 * unobservable through the bus).
 */

// Wrap subscribe() so we can grab the handler the bridge registers, while
// still delegating to the real implementation (keeps the storage-event
// integration path intact). vi.hoisted lets the hoisted vi.mock factory
// reference this holder safely.
const bus = vi.hoisted(() => ({
  handler: null as ((msg: unknown) => void) | null,
}))

vi.mock('@/lib/broadcast', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/broadcast')>('@/lib/broadcast')
  return {
    ...actual,
    subscribe: (handler: (msg: unknown) => void) => {
      bus.handler = handler
      return actual.subscribe(
        handler as unknown as (m: import('@/lib/broadcast').BroadcastMessage) => void,
      )
    },
  }
})

import { QueryBroadcastBridge } from './QueryBroadcastBridge'
import {
  TAB_ID,
  __resetBroadcastForTests,
  type BroadcastMessage,
} from '@/lib/broadcast'

// ── Test plumbing ──────────────────────────────────────────────────────────

function renderBridge() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  const utils = render(<QueryBroadcastBridge />, { wrapper })
  // Stub invalidateQueries so the real cache machinery never runs and we can
  // assert exactly which query keys the bridge asked to invalidate.
  const invalidateSpy = vi
    .spyOn(qc, 'invalidateQueries')
    .mockImplementation(() => Promise.resolve())
  return { qc, invalidateSpy, ...utils }
}

/** Simulate a peer tab writing a bus envelope via the storage transport. */
function emitFromPeer(msg: unknown, from = 'peer-tab') {
  act(() => {
    const env = { _from: from, _ts: Date.now(), msg }
    const key = `__teslasync_bus_${Date.now()}_${Math.random().toString(36).slice(2)}`
    window.dispatchEvent(
      new StorageEvent('storage', { key, newValue: JSON.stringify(env) }),
    )
  })
}

beforeEach(() => {
  __resetBroadcastForTests()
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  __resetBroadcastForTests()
  window.localStorage.clear()
  bus.handler = null
})

// ── Rendering ──────────────────────────────────────────────────────────────

describe('QueryBroadcastBridge — mount', () => {
  it('renders nothing (side-effect-only mount)', () => {
    const { container } = renderBridge()
    expect(container).toBeEmptyDOMElement()
  })

  it('registers a bus subscriber on mount', () => {
    renderBridge()
    expect(bus.handler).toBeTypeOf('function')
  })
})

// ── Happy path: peer invalidations flow into this tab's QueryClient ─────────

describe('QueryBroadcastBridge — queryInvalidate propagation', () => {
  it('invalidates the query key carried by a peer queryInvalidate broadcast', () => {
    const { invalidateSpy } = renderBridge()

    emitFromPeer({ type: 'queryInvalidate', keys: [['vehicles']] } as BroadcastMessage)

    expect(invalidateSpy).toHaveBeenCalledTimes(1)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['vehicles'] })
  })

  it('invalidates every key when the broadcast coalesces several', () => {
    const { invalidateSpy } = renderBridge()

    emitFromPeer({
      type: 'queryInvalidate',
      keys: [['vehicles'], ['charging', 1], ['drives']],
    } as BroadcastMessage)

    expect(invalidateSpy).toHaveBeenCalledTimes(3)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['vehicles'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['charging', 1] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['drives'] })
  })

  it('is a no-op for a queryInvalidate message with an empty keys array', () => {
    const { invalidateSpy } = renderBridge()

    emitFromPeer({ type: 'queryInvalidate', keys: [] } as BroadcastMessage)

    expect(invalidateSpy).not.toHaveBeenCalled()
  })
})

// ── Message filtering ──────────────────────────────────────────────────────

describe('QueryBroadcastBridge — message filtering', () => {
  it('ignores broadcast topics other than queryInvalidate', () => {
    const { invalidateSpy } = renderBridge()

    emitFromPeer({ type: 'auth.logout' } as BroadcastMessage)
    emitFromPeer({ type: 'settings.changed' } as BroadcastMessage)
    emitFromPeer({ type: 'theme.changed', themeId: 'x', modeId: 'dark' } as BroadcastMessage)

    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  it('does not react to this tab\'s own invalidations (no ping-pong)', () => {
    const { invalidateSpy } = renderBridge()

    // Same TAB_ID => the bus self-filters before the handler runs.
    emitFromPeer(
      { type: 'queryInvalidate', keys: [['vehicles']] } as BroadcastMessage,
      TAB_ID,
    )

    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  it('stops invalidating after the component unmounts', () => {
    const { invalidateSpy, unmount } = renderBridge()

    unmount()
    emitFromPeer({ type: 'queryInvalidate', keys: [['vehicles']] } as BroadcastMessage)

    expect(invalidateSpy).not.toHaveBeenCalled()
  })
})

// ── Malformed payloads (peer running a different app version) ───────────────

describe('QueryBroadcastBridge — malformed payload hardening', () => {
  it('skips non-array key entries instead of forwarding an invalid QueryKey', () => {
    const { invalidateSpy } = renderBridge()

    // A version-skewed peer sends a flat/mixed keys array. The valid entries
    // must still invalidate; the bogus string entry must be dropped.
    emitFromPeer({
      type: 'queryInvalidate',
      keys: [['ok-before'], 'bad-string', ['ok-after']],
    } as unknown as BroadcastMessage)

    expect(invalidateSpy).toHaveBeenCalledTimes(2)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['ok-before'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['ok-after'] })
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: 'bad-string' })
  })

  it('does not throw and does not invalidate when keys is missing entirely', () => {
    const { invalidateSpy } = renderBridge()
    const handler = bus.handler
    expect(handler).toBeTypeOf('function')

    // Invoke the captured handler directly: `subscribe` swallows handler
    // throws, so driving this through the bus would hide a regression. A
    // missing `keys` must be tolerated without a TypeError.
    expect(() =>
      handler?.({ type: 'queryInvalidate' } as BroadcastMessage),
    ).not.toThrow()
    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  it('does not throw when keys is a non-array value', () => {
    const { invalidateSpy } = renderBridge()
    const handler = bus.handler

    expect(() =>
      handler?.({ type: 'queryInvalidate', keys: null } as unknown as BroadcastMessage),
    ).not.toThrow()
    expect(() =>
      handler?.({ type: 'queryInvalidate', keys: 42 } as unknown as BroadcastMessage),
    ).not.toThrow()
    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  it('drops null/undefined entries but still processes the valid ones', () => {
    const { invalidateSpy } = renderBridge()
    const handler = bus.handler

    handler?.({
      type: 'queryInvalidate',
      keys: [['a'], null, undefined, ['b']],
    } as unknown as BroadcastMessage)

    expect(invalidateSpy).toHaveBeenCalledTimes(2)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['a'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['b'] })
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: null })
  })
})
