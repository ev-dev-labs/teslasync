import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

/**
 * useVersionWatcher contract.
 * Behaviours under test:
 *   1. On mount, captures the boot version exactly once.
 *   2. Periodic poll surfaces a divergent backend version as
 *      `newVersionAvailable=true`.
 *   3. Identical poll responses keep `newVersionAvailable=false`.
 *   4. Transient `request()` failures are swallowed (the next tick retries).
 *   5. Empty / missing `app_version` fields are ignored.
 */

const requestMock = vi.fn<(path: string) => Promise<unknown>>()

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return {
    ...actual,
    request: (path: string) => requestMock(path),
  }
})

import { useVersionWatcher } from '../useVersionWatcher'

const POLL_INTERVAL_MS = 5 * 60 * 1000

/**
 * Flush enough microtask + React commit ticks for the boot probe to
 * resolve, the resulting setState calls to flush, AND the dependent
 * effect (which schedules the poll interval) to settle.
 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve()
  }
}

describe('useVersionWatcher', () => {
  beforeEach(() => {
    requestMock.mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('captures the boot version on first mount and reports newVersionAvailable=false initially', async () => {
    requestMock.mockResolvedValue({ app_version: 'v1.0.0' })

    const { result } = renderHook(() => useVersionWatcher())

    await act(async () => {
      await flushMicrotasks()
    })

    expect(result.current.bootVersion).toBe('v1.0.0')
    expect(result.current.latestVersion).toBe('v1.0.0')
    expect(result.current.newVersionAvailable).toBe(false)
  })

  it('flips newVersionAvailable=true when a poll returns a different app_version', async () => {
    requestMock
      .mockResolvedValueOnce({ app_version: 'v1.0.0' }) // boot
      .mockResolvedValue({ app_version: 'v1.1.0' }) // every subsequent poll

    const { result } = renderHook(() => useVersionWatcher())

    await act(async () => {
      await flushMicrotasks()
    })
    expect(result.current.bootVersion).toBe('v1.0.0')

    // Advance past the 5-minute poll interval and let the awaited
    // fetchVersion + state update settle.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
      await flushMicrotasks()
    })

    expect(result.current.latestVersion).toBe('v1.1.0')
    expect(result.current.newVersionAvailable).toBe(true)
    expect(result.current.bootVersion).toBe('v1.0.0')
  })

  it('keeps newVersionAvailable=false when the polled version matches boot', async () => {
    requestMock.mockResolvedValue({ app_version: 'v1.0.0' })

    const { result } = renderHook(() => useVersionWatcher())

    await act(async () => {
      await flushMicrotasks()
    })
    expect(result.current.bootVersion).toBe('v1.0.0')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
      await flushMicrotasks()
    })

    expect(result.current.newVersionAvailable).toBe(false)
    expect(requestMock).toHaveBeenCalledWith('/system/version')
    expect(requestMock.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('survives a transient request rejection without flipping the banner', async () => {
    requestMock
      .mockResolvedValueOnce({ app_version: 'v2.0.0' }) // boot
      .mockRejectedValueOnce(new Error('network down')) // first poll fails
      .mockResolvedValue({ app_version: 'v2.0.0' }) // recovery

    const { result } = renderHook(() => useVersionWatcher())

    await act(async () => {
      await flushMicrotasks()
    })
    expect(result.current.bootVersion).toBe('v2.0.0')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
      await flushMicrotasks()
    })

    expect(result.current.newVersionAvailable).toBe(false)
    expect(result.current.bootVersion).toBe('v2.0.0')
  })

  it('ignores responses with a missing or empty app_version field', async () => {
    requestMock
      .mockResolvedValueOnce({ app_version: 'v3.0.0' })
      .mockResolvedValueOnce({ app_version: '' })
      .mockResolvedValueOnce({})

    const { result } = renderHook(() => useVersionWatcher())

    await act(async () => {
      await flushMicrotasks()
    })
    expect(result.current.bootVersion).toBe('v3.0.0')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
      await flushMicrotasks()
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
      await flushMicrotasks()
    })

    expect(result.current.newVersionAvailable).toBe(false)
    expect(result.current.latestVersion).toBe('v3.0.0')
  })
})
