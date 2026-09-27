import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { PinnedItem } from '../types'

const requestMock = vi.fn()
const toastError = vi.fn()
vi.mock('../client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
  isApiError: (cause: unknown) => cause instanceof Error && 'status' in cause,
}))
vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ success: vi.fn(), error: toastError }),
}))
vi.mock('@/hooks/useRefreshPolicy', () => ({
  useRefreshInterval: () => false,
}))

import { navigationPaths, useNavigationPins } from './useNavigationPins'

function wrapper(qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
  return Wrapper
}

let rows: PinnedItem[]
let nextId: number

beforeEach(() => {
  rows = []
  nextId = 1
  window.localStorage.removeItem('teslasync-navigation-pins-pending')
  requestMock.mockReset()
  toastError.mockReset()
  requestMock.mockImplementation(async (url: string, options?: { method?: string; body?: string }) => {
    if (url === '/pinned?type=navigation' && !options?.method) return [...rows]
    if (url === '/pinned' && options?.method === 'POST') {
      const body = JSON.parse(options.body ?? '{}') as { item_type: string; item_id: string }
      if (body.item_type !== 'navigation') throw new Error('unexpected pin type')
      if (rows.some(row => row.item_id === body.item_id)) {
        const conflict = Object.assign(new Error('already pinned'), { status: 409 })
        throw conflict
      }
      rows.forEach(row => { row.position += 1 })
      const added: PinnedItem = {
        id: nextId++,
        item_type: 'navigation',
        item_id: body.item_id,
        position: 0,
        pinned_at: '2026-01-01T00:00:00Z',
      }
      rows = [added, ...rows]
      return added
    }
    if (url.startsWith('/pinned/') && options?.method === 'DELETE') {
      rows = rows.filter(row => row.id !== Number(url.slice('/pinned/'.length)))
      return null
    }
    throw new Error(`unexpected request: ${url}`)
  })
})

describe('useNavigationPins', () => {
  it('imports existing browser pins once, then other devices load the server order', async () => {
    const firstPaths = vi.fn()
    const first = renderHook(() => useNavigationPins(['/drives', '/charging'], firstPaths), { wrapper: wrapper() })
    await waitFor(() => expect(first.result.current.ready).toBe(true))
    expect(firstPaths).toHaveBeenLastCalledWith(['/drives', '/charging'])
    expect(rows.filter(row => row.item_id === '@navigation-initialized')).toHaveLength(1)
    await act(async () => {
      await first.result.current.toggle('/drive-calendar', true)
    })
    await waitFor(() => expect(firstPaths).toHaveBeenLastCalledWith(['/drive-calendar', '/drives', '/charging']))
    first.unmount()

    const secondPaths = vi.fn()
    const second = renderHook(() => useNavigationPins(['/battery'], secondPaths), { wrapper: wrapper() })
    await waitFor(() => expect(second.result.current.ready).toBe(true))
    expect(secondPaths).toHaveBeenLastCalledWith(['/drive-calendar', '/drives', '/charging'])
    expect(rows.some(row => row.item_id === '/battery')).toBe(false)
    await act(async () => {
      await second.result.current.toggle('/drive-calendar', false)
    })
    await waitFor(() => expect(secondPaths).toHaveBeenLastCalledWith(['/drives', '/charging']))
    second.unmount()

    const thirdPaths = vi.fn()
    const third = renderHook(() => useNavigationPins(['/drive-calendar'], thirdPaths), { wrapper: wrapper() })
    await waitFor(() => expect(third.result.current.ready).toBe(true))
    expect(thirdPaths).toHaveBeenLastCalledWith(['/drives', '/charging'])
    third.unmount()
  })

  it('excludes the bootstrap marker and non-navigation paths from display', () => {
    expect(navigationPaths([
      { id: 1, item_type: 'navigation', item_id: '@navigation-initialized', position: 0, pinned_at: '' },
      { id: 2, item_type: 'navigation', item_id: '//other-site', position: 1, pinned_at: '' },
      { id: 3, item_type: 'navigation', item_id: '/drives', position: 2, pinned_at: '' },
    ])).toEqual(['/drives'])
  })

  it('accepts pins before the server responds and syncs them when connectivity returns', async () => {
    rows = [
      { id: nextId++, item_type: 'navigation', item_id: '@navigation-initialized', position: 1, pinned_at: '' },
      { id: nextId++, item_type: 'navigation', item_id: '/drives', position: 0, pinned_at: '' },
    ]
    let offline = true
    const serverRequest = requestMock.getMockImplementation()!
    requestMock.mockImplementation((url: string, options?: { method?: string; body?: string }) => {
      if (offline) throw new Error('offline')
      return serverRequest(url, options)
    })
    const onServerPaths = vi.fn()
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const result = renderHook(() => useNavigationPins(['/drives'], onServerPaths), { wrapper: wrapper(qc) })
    await waitFor(() => expect(result.result.current.syncUnavailable).toBe(true))
    expect(result.result.current.ready).toBe(false)

    await act(async () => {
      await result.result.current.toggle('/drive-calendar', true)
      await result.result.current.toggle('/drives', false)
    })
    expect(window.localStorage.getItem('teslasync-navigation-pins-pending')).toContain('/drive-calendar')
    expect(toastError).toHaveBeenCalledWith(
      expect.any(Error),
      'toast.pin.navigation.pending',
      'Saved on this device; pin will sync when connected',
    )
    offline = false
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['pinned', 'navigation'] })
    })
    await waitFor(() => expect(result.result.current.ready).toBe(true))
    expect(onServerPaths).toHaveBeenLastCalledWith(['/drive-calendar'])
    expect(rows.some(row => row.item_id === '/drives')).toBe(false)
    expect(window.localStorage.getItem('teslasync-navigation-pins-pending')).toBeNull()
    result.unmount()
  })

  it('keeps a clicked pin locally if the write fails, then syncs on refetch', async () => {
    rows = [{ id: nextId++, item_type: 'navigation', item_id: '@navigation-initialized', position: 0, pinned_at: '' }]
    const serverRequest = requestMock.getMockImplementation()!
    let failWrite = true
    requestMock.mockImplementation((url: string, options?: { method?: string; body?: string }) => {
      if (url === '/pinned' && options?.method === 'POST' && failWrite) throw new Error('offline')
      return serverRequest(url, options)
    })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const onServerPaths = vi.fn()
    const result = renderHook(() => useNavigationPins([], onServerPaths), { wrapper: wrapper(qc) })
    await waitFor(() => expect(result.result.current.ready).toBe(true))
    await act(async () => {
      await result.result.current.toggle('/drives', true)
    })
    expect(result.result.current.ready).toBe(false)
    expect(window.localStorage.getItem('teslasync-navigation-pins-pending')).toContain('/drives')
    failWrite = false
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['pinned', 'navigation'] })
    })
    await waitFor(() => expect(result.result.current.ready).toBe(true))
    expect(onServerPaths).toHaveBeenLastCalledWith(['/drives'])
    expect(window.localStorage.getItem('teslasync-navigation-pins-pending')).toBeNull()
    result.unmount()
  })

  it('restores queued offline changes after a reload', async () => {
    rows = [{ id: nextId++, item_type: 'navigation', item_id: '@navigation-initialized', position: 0, pinned_at: '' }]
    window.localStorage.setItem('teslasync-navigation-pins-pending', JSON.stringify([['/drive-calendar', true]]))
    const onServerPaths = vi.fn()
    const result = renderHook(() => useNavigationPins(['/drive-calendar'], onServerPaths), { wrapper: wrapper() })
    await waitFor(() => expect(result.result.current.ready).toBe(true))
    expect(onServerPaths).toHaveBeenLastCalledWith(['/drive-calendar'])
    expect(rows.some(row => row.item_id === '/drive-calendar')).toBe(true)
    expect(window.localStorage.getItem('teslasync-navigation-pins-pending')).toBeNull()
    result.unmount()
  })

  it('serializes rapid pin then unpin so the final click wins', async () => {
    rows = [{ id: nextId++, item_type: 'navigation', item_id: '@navigation-initialized', position: 0, pinned_at: '' }]
    const serverRequest = requestMock.getMockImplementation()!
    requestMock.mockImplementation(async (url: string, options?: { method?: string; body?: string }) => {
      if (url === '/pinned' && options?.method === 'POST') {
        await new Promise(resolve => setTimeout(resolve, 40))
      }
      return serverRequest(url, options)
    })
    const result = renderHook(() => useNavigationPins([], vi.fn()), { wrapper: wrapper() })
    await waitFor(() => expect(result.result.current.ready).toBe(true))
    await act(async () => {
      const pin = result.result.current.toggle('/drives', true)
      const unpin = result.result.current.toggle('/drives', false)
      await Promise.all([pin, unpin])
    })
    expect(rows.some(row => row.item_id === '/drives')).toBe(false)
    result.unmount()
  })
})
