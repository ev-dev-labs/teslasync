import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'

/**
 * OfflineBanner contract.
 *
 * The banner is a thin composition over <AlertBanner> driven by the real
 * {@link useOnlineStatus} hook — which in turn subscribes to the shared
 * `@/lib/resilience` connection broadcaster. Rather than mocking the hook,
 * these tests exercise the *real* wiring end-to-end by firing the browser
 * `online` / `offline` window events and asserting the component reacts:
 *
 *   1. Nothing renders while the browser is online.
 *   2. Going offline surfaces the banner with the right copy.
 *   3. The banner is a polite `role="status"` live region for assistive tech.
 *   4. The decorative wifi glyph is `aria-hidden` so screen readers skip it.
 *   5. The wrapper is a fixed, non-blocking bottom-right overlay.
 *   6. Reconnecting hides the banner again with no manual dismiss.
 *
 * jsdom reports `navigator.onLine === true` by default, so every test starts
 * from the online state; `beforeEach` re-normalises the shared resilience
 * singleton to online to keep the cases order-independent.
 *
 * react-i18next is stubbed to echo the default (fallback) value so assertions
 * can match the English copy directly without pulling the i18n runtime into
 * the spec — the same convention used by the sibling banner specs.
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      defaultOrOpts?: string | Record<string, unknown>,
      opts?: Record<string, unknown>,
    ) => {
      if (typeof defaultOrOpts === 'string') {
        let out = defaultOrOpts
        const interp = opts ?? {}
        for (const [k, v] of Object.entries(interp)) {
          out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v))
        }
        return out
      }
      return _key
    },
  }),
}))

import { OfflineBanner } from './OfflineBanner'

function goOffline() {
  act(() => {
    window.dispatchEvent(new Event('offline'))
  })
}

function goOnline() {
  act(() => {
    window.dispatchEvent(new Event('online'))
  })
}

beforeEach(() => {
  // Normalise the shared resilience singleton back to 'online' before each
  // case. RTL's auto-cleanup has already unmounted the previous test's tree,
  // so no component is listening — this is a plain reset dispatch (the
  // broadcaster short-circuits when the status is unchanged).
  window.dispatchEvent(new Event('online'))
})

describe('OfflineBanner', () => {
  it('renders nothing while the browser is online', () => {
    const { container } = render(<OfflineBanner />)

    expect(container.firstChild).toBeNull()
    expect(screen.queryByTestId('offline-banner')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('surfaces the banner when the connection drops after mounting online', () => {
    render(<OfflineBanner />)
    expect(screen.queryByTestId('offline-banner')).toBeNull()

    goOffline()

    expect(screen.getByTestId('offline-banner')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows the offline title and cached-data guidance copy', () => {
    render(<OfflineBanner />)
    goOffline()

    expect(screen.getByText("You're offline")).toBeInTheDocument()
    expect(
      screen.getByText(
        'Showing cached data. New requests will retry when you reconnect.',
      ),
    ).toBeInTheDocument()
  })

  it('exposes a polite status live region so assistive tech is not interrupted', () => {
    render(<OfflineBanner />)
    goOffline()

    const region = screen.getByRole('status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region.textContent).toContain("You're offline")
  })

  it('marks the decorative wifi glyph as aria-hidden so screen readers skip it', () => {
    render(<OfflineBanner />)
    goOffline()

    const icon = screen.getByTestId('offline-banner').querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it('positions the banner as a fixed, non-blocking overlay', () => {
    render(<OfflineBanner />)
    goOffline()

    const wrapper = screen.getByTestId('offline-banner')
    expect(wrapper.className).toContain('fixed')
    expect(wrapper.className).toContain('right-4')
  })

  it('hides itself again once connectivity is restored — no manual dismiss', () => {
    render(<OfflineBanner />)

    goOffline()
    expect(screen.getByTestId('offline-banner')).toBeInTheDocument()

    goOnline()
    expect(screen.queryByTestId('offline-banner')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('toggles across repeated connectivity transitions without leaking state', () => {
    render(<OfflineBanner />)

    goOffline()
    expect(screen.getByTestId('offline-banner')).toBeInTheDocument()
    goOnline()
    expect(screen.queryByTestId('offline-banner')).toBeNull()
    goOffline()
    expect(screen.getByTestId('offline-banner')).toBeInTheDocument()
  })
})
