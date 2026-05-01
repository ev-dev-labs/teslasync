import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import React from 'react'

// --- Mock useUnreadCount ----------------------------------------------------
let mockCount = 0
vi.mock('@/api/hooks/useNotifications', () => ({
  useUnreadCount: () => ({ data: mockCount }),
  notificationKeys: { unreadCount: ['notification-logs', 'unread-count'] as const },
}))

// --- Mock useSettings (the unit-conversion hook) ----------------------------
let mockTabBadgeEnabled: boolean | undefined = true
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: {
      tab_badge_enabled: mockTabBadgeEnabled,
    },
  }),
}))

// --- Mock sseManager --------------------------------------------------------
type Listener = (data: unknown) => void
const sseListeners = new Map<string, Set<Listener>>()
vi.mock('@/lib/sseManager', () => ({
  sseManager: {
    subscribe: (event: string, listener: Listener) => {
      if (!sseListeners.has(event)) sseListeners.set(event, new Set())
      sseListeners.get(event)!.add(listener)
    },
    unsubscribe: (event: string, listener: Listener) => {
      sseListeners.get(event)?.delete(listener)
    },
  },
}))

import { useTitleBadge } from '../useTitleBadge'
import { __resetTitleStoreForTests } from '@/lib/titleStore'

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return React.createElement(QueryClientProvider, { client: qc }, children)
}

describe('useTitleBadge', () => {
  beforeEach(() => {
    mockCount = 0
    mockTabBadgeEnabled = true
    sseListeners.clear()
    __resetTitleStoreForTests()
  })

  afterEach(() => {
    __resetTitleStoreForTests()
  })

  it('does not add a prefix when the count is zero', async () => {
    mockCount = 0
    renderHook(() => useTitleBadge(), { wrapper })
    await waitFor(() => expect(document.title).toBe('TeslaSync'))
  })

  it('adds a "(N) " prefix when the count is positive', async () => {
    mockCount = 3
    renderHook(() => useTitleBadge(), { wrapper })
    await waitFor(() => expect(document.title).toBe('(3) TeslaSync'))
  })

  it('caps the displayed count at 99+', async () => {
    mockCount = 250
    renderHook(() => useTitleBadge(), { wrapper })
    await waitFor(() => expect(document.title).toBe('(99+) TeslaSync'))
  })

  it('omits the prefix when tab_badge_enabled is false', async () => {
    mockCount = 5
    mockTabBadgeEnabled = false
    renderHook(() => useTitleBadge(), { wrapper })
    await waitFor(() => expect(document.title).toBe('TeslaSync'))
  })

  it('treats undefined tab_badge_enabled as enabled (default ON)', async () => {
    mockCount = 1
    mockTabBadgeEnabled = undefined
    renderHook(() => useTitleBadge(), { wrapper })
    await waitFor(() => expect(document.title).toBe('(1) TeslaSync'))
  })

  it('clears the prefix when the host component unmounts', async () => {
    mockCount = 7
    const { unmount } = renderHook(() => useTitleBadge(), { wrapper })
    await waitFor(() => expect(document.title).toBe('(7) TeslaSync'))
    unmount()
    expect(document.title).toBe('TeslaSync')
  })

  it('subscribes to the SSE alert channel', async () => {
    renderHook(() => useTitleBadge(), { wrapper })
    await waitFor(() => expect(sseListeners.get('alert')?.size).toBe(1))
  })
})
