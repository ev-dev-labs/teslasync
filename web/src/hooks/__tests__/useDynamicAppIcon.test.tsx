import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import React from 'react'

// ── Theme mock ────────────────────────────────────────────────────────────
// We control the theme from the test so we can assert that toggling
// primary/accent re-renders the favicon while mode controls browser chrome.
let mockTheme = { primary: '#3b82f6', accent: '#06b6d4' }
let mockMode = { bg: '#0b0d12' }
vi.mock('@/components/ui/ThemeProvider', () => ({
  useTheme: () => ({ theme: mockTheme, mode: mockMode }),
}))

import { useDynamicAppIcon } from '../useDynamicAppIcon'
import { buildAppIconSvg, svgToDataUrl } from '@/lib/appIcon'

function wrapper({ children }: { children: ReactNode }) {
  return React.createElement(React.Fragment, null, children)
}

function setupHead() {
  document.head.innerHTML = ''
  const icon = document.createElement('link')
  icon.rel = 'icon'
  icon.type = 'image/svg+xml'
  icon.href = 'http://localhost/favicon.svg'
  document.head.appendChild(icon)

  const apple = document.createElement('link')
  apple.rel = 'apple-touch-icon'
  apple.setAttribute('sizes', '180x180')
  apple.href = 'http://localhost/icons/apple-touch-icon.png'
  document.head.appendChild(apple)

  const manifest = document.createElement('link')
  manifest.rel = 'manifest'
  manifest.href = 'http://localhost/manifest.webmanifest'
  document.head.appendChild(manifest)

  return { icon, apple, manifest }
}

describe('useDynamicAppIcon', () => {
  beforeEach(() => {
    mockTheme = { primary: '#3b82f6', accent: '#06b6d4' }
    mockMode = { bg: '#0b0d12' }
    setupHead()
    // Stub URL.createObjectURL / revokeObjectURL — jsdom ships only a
    // partial implementation that throws on Blob inputs in some versions.
    let counter = 0
    Object.defineProperty(URL, 'createObjectURL', {
      writable: true,
      configurable: true,
      value: vi.fn(() => `blob:test-${++counter}`),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      writable: true,
      configurable: true,
      value: vi.fn(),
    })
  })

  afterEach(() => {
    document.head.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('paints the favicon with the active framed brand mark as an SVG data URL', () => {
    renderHook(() => useDynamicAppIcon(), { wrapper })

    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')!
    expect(link.href.startsWith('data:image/svg+xml;base64,')).toBe(true)
    expect(link.getAttribute('data-dynamic-app-icon')).toBe('true')

    // Verify the encoded SVG contains the active theme accents.
    const expectedSvg = buildAppIconSvg({
      primary: '#3b82f6',
      accent: '#06b6d4',
      mode: 'standard',
    })
    expect(link.href).toBe(svgToDataUrl(expectedSvg))
  })

  it('exposes the live data URL via data-base-href so useFaviconBadge can composite over it', () => {
    renderHook(() => useDynamicAppIcon(), { wrapper })
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')!
    expect(link.dataset.baseHref).toBe(link.href)
  })

  it('updates <meta name="theme-color"> to the active surface mode', () => {
    renderHook(() => useDynamicAppIcon(), { wrapper })
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!
    expect(meta).not.toBeNull()
    expect(meta.getAttribute('content')).toBe('#0b0d12')
    expect(meta.getAttribute('data-dynamic-app-icon')).toBe('true')
  })

  it('repaints the favicon without saturating browser chrome when the theme changes', () => {
    const { rerender } = renderHook(() => useDynamicAppIcon(), { wrapper })
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')!
    const firstHref = link.href

    act(() => {
      mockTheme = { primary: '#e31937', accent: '#ff4060' }
    })
    rerender()

    expect(link.href).not.toBe(firstHref)
    const expectedSvg = buildAppIconSvg({
      primary: '#e31937',
      accent: '#ff4060',
      mode: 'standard',
    })
    expect(link.href).toBe(svgToDataUrl(expectedSvg))

    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!
    expect(meta.getAttribute('content')).toBe('#0b0d12')
  })

  it('updates browser chrome when the surface mode changes', () => {
    const { rerender } = renderHook(() => useDynamicAppIcon(), { wrapper })
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!

    act(() => {
      mockMode = { bg: '#f8fafc' }
    })
    rerender()

    expect(meta.getAttribute('content')).toBe('#f8fafc')
  })

  it('skips work when the theme has not changed', () => {
    const { rerender } = renderHook(() => useDynamicAppIcon(), { wrapper })
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')!
    const firstHref = link.href

    // Re-render with the same theme — href identity should be preserved
    // (no spurious favicon churn).
    rerender()
    expect(link.href).toBe(firstHref)
  })

  it('creates the meta theme-color tag when missing', () => {
    document.head.innerHTML = '' // remove everything including any meta
    setupHead()
    expect(
      document.querySelector('meta[name="theme-color"]'),
    ).toBeNull()

    renderHook(() => useDynamicAppIcon(), { wrapper })

    expect(
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.getAttribute('content'),
    ).toBe('#0b0d12')
  })

  it('falls back to safe default colours when the theme contains a malformed hex', () => {
    mockTheme = { primary: 'not-a-colour', accent: '#abcdef' }
    renderHook(() => useDynamicAppIcon(), { wrapper })

    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')!
    // The malformed primary should be replaced with the fallback (#3b82f6)
    // by buildAppIconSvg's safeHex guard. The accent (a valid hex) flows
    // through unchanged.
    const expectedSvg = buildAppIconSvg({
      primary: 'not-a-colour',
      accent: '#abcdef',
      mode: 'standard',
    })
    expect(link.href).toBe(svgToDataUrl(expectedSvg))
    // And it should NOT contain the bogus value anywhere in the encoded
    // SVG payload.
    const decoded = atob(link.href.replace('data:image/svg+xml;base64,', ''))
    expect(decoded).not.toContain('not-a-colour')
    expect(decoded).toContain('#3b82f6')
  })

  it('is a no-op when no <link rel="icon"> exists', () => {
    document.head.innerHTML = ''
    expect(() =>
      renderHook(() => useDynamicAppIcon(), { wrapper }),
    ).not.toThrow()
  })
})
