/**
 * LiveStaleDataBanner contract.
 *
 * The banner watches the live-data pipeline health (via `useLiveConnection`)
 * and surfaces a warning `<AlertBanner>` once the pipe has been unavailable for
 * longer than two minutes. `useLiveConnection` is mocked so each test can drive
 * an exact status sequence, and `react-i18next` is stubbed to echo the English
 * fallback copy so text assertions match production strings. Fake timers let us
 * fast-forward the 2-minute threshold deterministically.
 *
 * Coverage:
 *   1. `connected` renders nothing.
 *   2. `unknown` (startup) never surfaces, even past the threshold.
 *   3. A brief sub-threshold reconnect stays hidden.
 *   4. `disconnected` past the threshold surfaces the banner with the right
 *      copy, icon, and polite-live-region a11y wiring.
 *   5. Regression: an outage that oscillates `disconnected`⇄`reconnecting`
 *      still surfaces — the clock must NOT reset on every backoff flap.
 *   6. The banner hides again once the connection is restored.
 *   7. A reconnect that succeeds before the threshold cancels the timer.
 *   8. A caller `className` is forwarded onto the banner.
 *   9. The pending timer is cleared on unmount (no leaked timers).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import type {
  LiveConnectionState,
  LiveConnectionStatus,
} from '@/hooks/useLiveConnection'

let mockStatus: LiveConnectionStatus = 'connected'

vi.mock('@/hooks/useLiveConnection', () => ({
  useLiveConnection: (): LiveConnectionState => ({
    status: mockStatus,
    lastMessageAt: null,
    channels: { sse: mockStatus === 'connected' ? 'open' : 'closed' },
  }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // The component only ever calls t(key, defaultString); echo the default.
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

import { LiveStaleDataBanner } from './LiveStaleDataBanner'

const THRESHOLD_MS = 2 * 60_000
const BANNER = 'live-stale-banner'

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  mockStatus = 'connected'
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('LiveStaleDataBanner', () => {
  it('renders nothing while the live pipe is connected', () => {
    mockStatus = 'connected'
    render(<LiveStaleDataBanner />)
    advance(THRESHOLD_MS + 5_000)
    expect(screen.queryByTestId(BANNER)).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('never surfaces during the indeterminate "unknown" startup state', () => {
    mockStatus = 'unknown'
    render(<LiveStaleDataBanner />)
    // Even well past the threshold, an app that has never connected must not
    // claim the connection "has been offline for more than 2 minutes".
    advance(THRESHOLD_MS + 30_000)
    expect(screen.queryByTestId(BANNER)).toBeNull()
  })

  it('stays hidden during a brief sub-threshold reconnect', () => {
    mockStatus = 'reconnecting'
    render(<LiveStaleDataBanner />)
    advance(30_000)
    expect(screen.queryByTestId(BANNER)).toBeNull()
  })

  it('surfaces a warning banner once the pipe is down past the 2-minute threshold', () => {
    mockStatus = 'disconnected'
    render(<LiveStaleDataBanner />)

    // Just under the threshold: still hidden.
    advance(THRESHOLD_MS - 1_000)
    expect(screen.queryByTestId(BANNER)).toBeNull()

    // Cross the threshold → the banner appears.
    advance(2_000)
    const banner = screen.getByTestId(BANNER)
    expect(banner).toBeInTheDocument()
    // Announced politely to assistive tech when it appears.
    expect(banner).toHaveAttribute('role', 'status')
    expect(banner).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByText('Live data unavailable')).toBeInTheDocument()
    expect(
      screen.getByText(/offline for more than 2 minutes/i),
    ).toBeInTheDocument()
    // The leading icon is present but hidden from assistive tech.
    const icon = banner.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon?.parentElement?.getAttribute('aria-hidden')).toBe('true')
  })

  it('keeps the outage clock running across reconnect flaps (sustained-outage regression)', () => {
    // Regression: `useLiveConnection` flips disconnected⇄reconnecting on every
    // backoff attempt. Keying the timer off the raw `status` reset the clock on
    // each flap, and with a 60s backoff cap (< the 120s threshold) the banner
    // never appeared during a genuine, prolonged outage. It must now surface
    // despite the oscillation.
    mockStatus = 'reconnecting'
    const { rerender } = render(<LiveStaleDataBanner />)

    advance(40_000) // t=40s — still reconnecting
    mockStatus = 'disconnected'
    rerender(<LiveStaleDataBanner />)

    advance(40_000) // t=80s
    mockStatus = 'reconnecting'
    rerender(<LiveStaleDataBanner />) // flap back — must NOT reset the clock

    advance(20_000) // t=100s — still below threshold, still hidden
    expect(screen.queryByTestId(BANNER)).toBeNull()

    mockStatus = 'disconnected'
    rerender(<LiveStaleDataBanner />)
    advance(25_000) // t=125s — outage clock (started at t=0) crosses 120s
    expect(screen.getByTestId(BANNER)).toBeInTheDocument()
  })

  it('hides again once the connection is restored', () => {
    mockStatus = 'disconnected'
    const { rerender } = render(<LiveStaleDataBanner />)
    advance(THRESHOLD_MS + 2_000)
    expect(screen.getByTestId(BANNER)).toBeInTheDocument()

    mockStatus = 'connected'
    rerender(<LiveStaleDataBanner />)
    expect(screen.queryByTestId(BANNER)).toBeNull()
  })

  it('cancels the timer when a reconnect succeeds before the threshold', () => {
    mockStatus = 'reconnecting'
    const { rerender } = render(<LiveStaleDataBanner />)
    advance(30_000)

    // Recovery cancels the pending 2-minute timer.
    mockStatus = 'connected'
    rerender(<LiveStaleDataBanner />)
    expect(vi.getTimerCount()).toBe(0)

    advance(THRESHOLD_MS + 10_000)
    expect(screen.queryByTestId(BANNER)).toBeNull()
  })

  it('forwards a caller className onto the banner', () => {
    mockStatus = 'disconnected'
    render(<LiveStaleDataBanner className="mb-6 test-live-stale" />)
    advance(THRESHOLD_MS + 2_000)
    const banner = screen.getByTestId(BANNER)
    expect(banner.className).toContain('test-live-stale')
    expect(banner.className).toContain('mb-6')
  })

  it('clears the pending outage timer on unmount', () => {
    mockStatus = 'disconnected'
    const { unmount } = render(<LiveStaleDataBanner />)
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
