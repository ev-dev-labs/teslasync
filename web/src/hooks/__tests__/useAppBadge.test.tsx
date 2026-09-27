import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import React from 'react'

let mockCount = 0
vi.mock('@/api/hooks/useNotifications', () => ({
  useUnreadCount: () => ({ data: mockCount }),
}))

let mockTabBadgeEnabled: boolean | undefined = true
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: { tab_badge_enabled: mockTabBadgeEnabled },
  }),
}))

import { useAppBadge } from '../useAppBadge'

function wrapper({ children }: { children: ReactNode }) {
  return React.createElement(React.Fragment, null, children)
}

describe('useAppBadge', () => {
  const setAppBadge = vi.fn(() => Promise.resolve())
  const clearAppBadge = vi.fn(() => Promise.resolve())

  beforeEach(() => {
    mockCount = 0
    mockTabBadgeEnabled = true
    setAppBadge.mockClear()
    clearAppBadge.mockClear()
    Object.defineProperty(navigator, 'setAppBadge', {
      writable: true,
      configurable: true,
      value: setAppBadge,
    })
    Object.defineProperty(navigator, 'clearAppBadge', {
      writable: true,
      configurable: true,
      value: clearAppBadge,
    })
  })

  afterEach(() => {
    // @ts-expect-error removing the test-only stub
    delete navigator.setAppBadge
    // @ts-expect-error removing the test-only stub
    delete navigator.clearAppBadge
  })

  it('sets the OS badge to the unread count', () => {
    mockCount = 3
    renderHook(() => useAppBadge(), { wrapper })
    expect(setAppBadge).toHaveBeenCalledWith(3)
    expect(clearAppBadge).not.toHaveBeenCalled()
  })

  it('clears the badge when the count returns to zero', () => {
    mockCount = 0
    renderHook(() => useAppBadge(), { wrapper })
    expect(clearAppBadge).toHaveBeenCalledTimes(1)
    expect(setAppBadge).not.toHaveBeenCalled()
  })

  it('clears the badge when the shared toggle is off', () => {
    mockCount = 5
    mockTabBadgeEnabled = false
    renderHook(() => useAppBadge(), { wrapper })
    expect(clearAppBadge).toHaveBeenCalledTimes(1)
    expect(setAppBadge).not.toHaveBeenCalled()
  })

  it('no-ops where the Badging API is absent (unsupported browser)', () => {
    // @ts-expect-error removing the test-only stub
    delete navigator.setAppBadge
    mockCount = 5
    expect(() => renderHook(() => useAppBadge(), { wrapper })).not.toThrow()
    expect(setAppBadge).not.toHaveBeenCalled()
  })
})
