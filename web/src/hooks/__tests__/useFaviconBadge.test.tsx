import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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

import { useFaviconBadge } from '../useFaviconBadge'

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return React.createElement(QueryClientProvider, { client: qc }, children)
}

const ORIGINAL_HREF = 'http://localhost/favicon.svg'
const SECOND_HREF = 'http://localhost/icons/icon-192.svg'
const STUB_DATA_URL = 'data:image/png;base64,STUB'

function setupFavicons() {
  document.head.innerHTML = ''
  const link1 = document.createElement('link')
  link1.rel = 'icon'
  link1.type = 'image/svg+xml'
  link1.href = ORIGINAL_HREF
  document.head.appendChild(link1)
  const link2 = document.createElement('link')
  link2.rel = 'icon'
  link2.type = 'image/svg+xml'
  link2.href = SECOND_HREF
  document.head.appendChild(link2)
  return [link1, link2] as const
}

describe('useFaviconBadge', () => {
  let originalImage: typeof Image
  let originalToDataURL: typeof HTMLCanvasElement.prototype.toDataURL

  beforeEach(() => {
    mockCount = 0
    mockTabBadgeEnabled = true

    // Stub Image so img.onload fires synchronously.
    originalImage = global.Image
    class FakeImage {
      crossOrigin = ''
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      private _src = ''
      get src() { return this._src }
      set src(value: string) {
        this._src = value
        // Defer to allow handlers to be assigned in any order.
        queueMicrotask(() => this.onload?.())
      }
    }
    // @ts-expect-error — assigning a constructor that satisfies the runtime contract
    global.Image = FakeImage

    // Stub canvas APIs so toDataURL returns deterministic output.
    originalToDataURL = HTMLCanvasElement.prototype.toDataURL
    HTMLCanvasElement.prototype.toDataURL = () => STUB_DATA_URL
    // jsdom returns null from getContext('2d') by default.
    HTMLCanvasElement.prototype.getContext = (() => ({
      drawImage: () => {},
      fillStyle: '',
      font: '',
      textAlign: '',
      textBaseline: '',
      beginPath: () => {},
      arc: () => {},
      fill: () => {},
      fillText: () => {},
    })) as unknown as HTMLCanvasElement['getContext']
  })

  afterEach(() => {
    global.Image = originalImage
    HTMLCanvasElement.prototype.toDataURL = originalToDataURL
    document.head.innerHTML = ''
  })

  it('does not modify favicon when count is zero', async () => {
    const [link1, link2] = setupFavicons()
    mockCount = 0
    renderHook(() => useFaviconBadge(), { wrapper })
    await waitFor(() => {
      expect(link1.href).toBe(ORIGINAL_HREF)
      expect(link2.href).toBe(SECOND_HREF)
    })
  })

  it('paints a badged data URL on every icon link when count > 0', async () => {
    const [link1, link2] = setupFavicons()
    mockCount = 4
    renderHook(() => useFaviconBadge(), { wrapper })
    await waitFor(() => {
      expect(link1.href).toBe(STUB_DATA_URL)
      expect(link2.href).toBe(STUB_DATA_URL)
    })
  })

  it('restores originals when toggle is disabled', async () => {
    const [link1, link2] = setupFavicons()
    mockCount = 4
    mockTabBadgeEnabled = false
    renderHook(() => useFaviconBadge(), { wrapper })
    await waitFor(() => {
      expect(link1.href).toBe(ORIGINAL_HREF)
      expect(link2.href).toBe(SECOND_HREF)
    })
  })

  it('restores originals on unmount', async () => {
    const [link1, link2] = setupFavicons()
    mockCount = 9
    const { unmount } = renderHook(() => useFaviconBadge(), { wrapper })
    await waitFor(() => expect(link1.href).toBe(STUB_DATA_URL))
    unmount()
    expect(link1.href).toBe(ORIGINAL_HREF)
    expect(link2.href).toBe(SECOND_HREF)
  })

  it('is a no-op when no favicon link exists', () => {
    document.head.innerHTML = ''
    mockCount = 5
    expect(() => {
      renderHook(() => useFaviconBadge(), { wrapper })
    }).not.toThrow()
  })
})
