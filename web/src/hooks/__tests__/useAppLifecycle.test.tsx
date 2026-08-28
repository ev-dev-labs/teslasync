import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import * as React from 'react'

/**
 * Mobile background / foreground / suspension recovery (PWA-08).
 *
 * The pure decision matrix is asserted exhaustively; the hook itself is then
 * driven with real DOM lifecycle events to prove the wiring, including the
 * bfcache path (`pageshow.persisted`) that never remounts React and therefore
 * never triggers a normal refetch.
 */

const sse = vi.hoisted(() => ({
  state: 'connected' as 'connected' | 'reconnecting',
  lastMessageAt: null as number | null,
  everConnected: true,
  connect: vi.fn(),
  disconnect: vi.fn(),
}))

vi.mock('@/lib/sseManager', () => ({
  sseManager: {
    getState: () => sse.state,
    getLastMessageAt: () => sse.lastMessageAt,
    hasEverConnected: () => sse.everConnected,
    connect: sse.connect,
    disconnect: sse.disconnect,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  },
}))

import {
  RESUME_REFETCH_AFTER_MS,
  RESUME_STREAM_RESET_AFTER_MS,
  deriveResumeAction,
  useAppLifecycle,
  type ResumeContext,
} from '../useAppLifecycle'

const NOW = 1_800_000_000_000

function ctx(patch: Partial<ResumeContext> = {}): ResumeContext {
  return {
    trigger: 'visible',
    awayMs: 10 * 60 * 1000,
    online: true,
    streamConnected: true,
    lastStreamMessageAt: NOW - 1000,
    now: NOW,
    ...patch,
  }
}

describe('deriveResumeAction', () => {
  it('does nothing while offline — the online event handles recovery later', () => {
    expect(deriveResumeAction(ctx({ online: false }))).toEqual({
      refetch: false,
      resetStream: false,
      checkForUpdate: false,
      reason: 'offline',
    })
  })

  it('does nothing after a brief tab switch', () => {
    const action = deriveResumeAction(ctx({ awayMs: RESUME_REFETCH_AFTER_MS - 1 }))
    expect(action.refetch).toBe(false)
    expect(action.reason).toBe('brief-absence')
  })

  it('refetches after a long absence', () => {
    const action = deriveResumeAction(ctx({ awayMs: RESUME_REFETCH_AFTER_MS + 1 }))
    expect(action).toMatchObject({ refetch: true, checkForUpdate: true, reason: 'foreground' })
  })

  it('labels a Page Lifecycle resume distinctly', () => {
    expect(deriveResumeAction(ctx({ trigger: 'resume' })).reason).toBe('process-resume')
  })

  it('always fully recovers a bfcache restore, however brief', () => {
    // Nothing remounted, so even a two-second restore is showing pre-suspension
    // values.
    const action = deriveResumeAction(ctx({ trigger: 'bfcache-restore', awayMs: 100 }))
    expect(action).toMatchObject({ refetch: true, checkForUpdate: true, reason: 'bfcache-restore' })
  })

  it('always resets the stream on a network reconnect', () => {
    const action = deriveResumeAction(
      ctx({ trigger: 'reconnect', streamConnected: true, lastStreamMessageAt: NOW }),
    )
    expect(action).toMatchObject({ refetch: true, resetStream: true, reason: 'network-reconnect' })
  })

  it('leaves a healthy stream alone', () => {
    expect(deriveResumeAction(ctx({ streamConnected: true, lastStreamMessageAt: NOW })).resetStream)
      .toBe(false)
  })

  it('resets a disconnected stream', () => {
    expect(deriveResumeAction(ctx({ streamConnected: false })).resetStream).toBe(true)
  })

  it('resets a stream that claims to be connected but has gone silent', () => {
    // Mobile OSes tear the socket down without updating readyState.
    const action = deriveResumeAction(
      ctx({
        streamConnected: true,
        lastStreamMessageAt: NOW - RESUME_STREAM_RESET_AFTER_MS - 1,
      }),
    )
    expect(action.resetStream).toBe(true)
  })

  it('resets a stream that has never delivered a message', () => {
    expect(deriveResumeAction(ctx({ lastStreamMessageAt: null })).resetStream).toBe(true)
  })
})

describe('useAppLifecycle', () => {
  let queryClient: QueryClient
  let invalidate: ReturnType<typeof vi.spyOn>

  const wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children)

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    sse.state = 'connected'
    sse.lastMessageAt = NOW
    sse.everConnected = true
    sse.connect.mockClear()
    sse.disconnect.mockClear()
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function hide() {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
  }

  function show() {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
  }

  it('does not refetch on a quick hide/show cycle', () => {
    renderHook(() => useAppLifecycle(), { wrapper })
    hide()
    vi.setSystemTime(NOW + 5_000)
    show()
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('invalidates only ACTIVE queries after a long background period', () => {
    const onResume = vi.fn()
    renderHook(() => useAppLifecycle({ onResume }), { wrapper })

    hide()
    vi.setSystemTime(NOW + 20 * 60 * 1000)
    show()

    expect(invalidate).toHaveBeenCalledWith({ type: 'active' })
    expect(onResume).toHaveBeenCalledTimes(1)
    expect(onResume.mock.calls[0][0]).toMatchObject({ refetch: true, reason: 'foreground' })
  })

  it('asks for a service-worker update check on resume', () => {
    const onCheckForUpdate = vi.fn()
    renderHook(() => useAppLifecycle({ onCheckForUpdate }), { wrapper })

    hide()
    vi.setSystemTime(NOW + 20 * 60 * 1000)
    show()

    expect(onCheckForUpdate).toHaveBeenCalledTimes(1)
  })

  it('recovers from a bfcache restore even though React never remounted', () => {
    renderHook(() => useAppLifecycle(), { wrapper })

    act(() => {
      const event = new Event('pageshow') as PageTransitionEvent & { persisted: boolean }
      Object.defineProperty(event, 'persisted', { value: true })
      window.dispatchEvent(event)
    })

    expect(invalidate).toHaveBeenCalledWith({ type: 'active' })
  })

  it('ignores a non-persisted pageshow (a normal navigation already refetched)', () => {
    renderHook(() => useAppLifecycle(), { wrapper })

    act(() => {
      const event = new Event('pageshow') as PageTransitionEvent & { persisted: boolean }
      Object.defineProperty(event, 'persisted', { value: false })
      window.dispatchEvent(event)
    })

    expect(invalidate).not.toHaveBeenCalled()
  })

  it('handles the Page Lifecycle freeze/resume pair', () => {
    const onResume = vi.fn()
    renderHook(() => useAppLifecycle({ onResume }), { wrapper })

    act(() => {
      document.dispatchEvent(new Event('freeze'))
    })
    vi.setSystemTime(NOW + 45 * 60 * 1000)
    act(() => {
      document.dispatchEvent(new Event('resume'))
    })

    expect(onResume.mock.calls[0][0]).toMatchObject({ reason: 'process-resume', refetch: true })
  })

  it('reconnects a stale SSE pipe exactly once', () => {
    sse.state = 'reconnecting'
    renderHook(() => useAppLifecycle(), { wrapper })

    hide()
    vi.setSystemTime(NOW + 20 * 60 * 1000)
    show()

    expect(sse.disconnect).toHaveBeenCalledTimes(1)
    expect(sse.connect).toHaveBeenCalledTimes(1)
  })

  it('never opens a socket for a session that never used SSE', () => {
    sse.state = 'reconnecting'
    sse.everConnected = false
    renderHook(() => useAppLifecycle(), { wrapper })

    hide()
    vi.setSystemTime(NOW + 20 * 60 * 1000)
    show()

    expect(sse.connect).not.toHaveBeenCalled()
  })

  it('recovers when the device comes back online', () => {
    renderHook(() => useAppLifecycle(), { wrapper })

    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    expect(invalidate).toHaveBeenCalledWith({ type: 'active' })
    expect(sse.disconnect).toHaveBeenCalled()
  })

  it('detaches every listener on unmount', () => {
    const { unmount } = renderHook(() => useAppLifecycle(), { wrapper })
    unmount()

    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    expect(invalidate).not.toHaveBeenCalled()
  })

  it('exposes an imperative recovery entry point', () => {
    const { result } = renderHook(() => useAppLifecycle(), { wrapper })

    let action
    act(() => {
      action = result.current.recoverNow('bfcache-restore')
    })

    expect(action).toMatchObject({ refetch: true, reason: 'bfcache-restore' })
    expect(invalidate).toHaveBeenCalledWith({ type: 'active' })
  })
})
