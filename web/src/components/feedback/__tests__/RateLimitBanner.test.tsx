import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import '@/i18n'

import { RateLimitBanner } from '../RateLimitBanner'

/**
 * RateLimitBanner contract.
 *
 * The banner reacts to two document-level CustomEvents:
 *   • teslasync:rate-limited  — fired by resilientFetch on 429.
 *   • teslasync:upstream-down — fired by resilientFetch on 503 with
 *     code UPSTREAM_BREAKER_OPEN.
 *
 * Asserts the visibility lifecycle, countdown ticking, "Retry now"
 * gating + queryClient.invalidateQueries() side-effect, and dismiss.
 */

function makeWrapper(invalidateSpy: ReturnType<typeof vi.fn>) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  // Spy on the real method so production-equivalent behaviour is exercised.
  qc.invalidateQueries = invalidateSpy as unknown as typeof qc.invalidateQueries
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

function fireRateLimited(retryAfterSec: number, scope = '/vehicles') {
  act(() => {
    document.dispatchEvent(
      new CustomEvent('teslasync:rate-limited', { detail: { scope, retryAfterSec } }),
    )
  })
}

function fireUpstreamDown(retryAfterSec: number, upstream = 'tesla') {
  act(() => {
    document.dispatchEvent(
      new CustomEvent('teslasync:upstream-down', { detail: { upstream, retryAfterSec } }),
    )
  })
}

describe('RateLimitBanner', () => {
  let invalidateSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    invalidateSpy = vi.fn().mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing by default', () => {
    const Wrapper = makeWrapper(invalidateSpy)
    const { container } = render(
      <Wrapper>
        <RateLimitBanner />
      </Wrapper>,
    )
    expect(container.firstChild).toBeNull()
  })

  it('appears on teslasync:rate-limited with countdown copy', () => {
    const Wrapper = makeWrapper(invalidateSpy)
    render(
      <Wrapper>
        <RateLimitBanner />
      </Wrapper>,
    )

    fireRateLimited(30)

    const banner = screen.getByTestId('rate-limit-banner')
    expect(banner).toBeInTheDocument()
    expect(banner).toHaveAttribute('role', 'alert')
    expect(banner).toHaveAttribute('aria-live', 'polite')
    expect(banner).toHaveAttribute('data-kind', 'rate-limited')
    expect(screen.getByText(/pausing for 30s/i)).toBeInTheDocument()
  })

  it('appears on teslasync:upstream-down with the upstream copy variant', () => {
    const Wrapper = makeWrapper(invalidateSpy)
    render(
      <Wrapper>
        <RateLimitBanner />
      </Wrapper>,
    )

    fireUpstreamDown(45)

    const banner = screen.getByTestId('rate-limit-banner')
    expect(banner).toBeInTheDocument()
    expect(banner).toHaveAttribute('data-kind', 'upstream-down')
    expect(screen.getByText(/Tesla upstream unavailable/i)).toBeInTheDocument()
    expect(screen.getByText(/retry in 45s/i)).toBeInTheDocument()
  })

  it('disables Retry now while the countdown is positive', () => {
    const Wrapper = makeWrapper(invalidateSpy)
    render(
      <Wrapper>
        <RateLimitBanner />
      </Wrapper>,
    )

    fireRateLimited(30)

    const retry = screen.getByTestId('rate-limit-banner-retry')
    expect(retry).toBeDisabled()

    fireEvent.click(retry)
    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  it('enables Retry now once the countdown reaches zero, and clicking calls invalidateQueries', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-03T12:00:00Z'))

    const Wrapper = makeWrapper(invalidateSpy)
    render(
      <Wrapper>
        <RateLimitBanner />
      </Wrapper>,
    )

    fireRateLimited(2)

    const retry = screen.getByTestId('rate-limit-banner-retry')
    expect(retry).toBeDisabled()

    // Advance 3 real seconds — the 1s tick interval fires, remaining → 0.
    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(retry).not.toBeDisabled()

    fireEvent.click(retry)
    expect(invalidateSpy).toHaveBeenCalledTimes(1)
    // Banner hides on retry click.
    expect(screen.queryByTestId('rate-limit-banner')).not.toBeInTheDocument()
  })

  it('hides the banner on dismiss without calling invalidateQueries', () => {
    const Wrapper = makeWrapper(invalidateSpy)
    render(
      <Wrapper>
        <RateLimitBanner />
      </Wrapper>,
    )

    fireRateLimited(30)
    expect(screen.getByTestId('rate-limit-banner')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('rate-limit-banner-dismiss'))
    expect(screen.queryByTestId('rate-limit-banner')).not.toBeInTheDocument()
    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  it('reappears when a new event fires after dismissal', () => {
    const Wrapper = makeWrapper(invalidateSpy)
    render(
      <Wrapper>
        <RateLimitBanner />
      </Wrapper>,
    )

    fireRateLimited(30)
    fireEvent.click(screen.getByTestId('rate-limit-banner-dismiss'))
    expect(screen.queryByTestId('rate-limit-banner')).not.toBeInTheDocument()

    fireRateLimited(20)
    expect(screen.getByTestId('rate-limit-banner')).toBeInTheDocument()
    expect(screen.getByText(/pausing for 20s/i)).toBeInTheDocument()
  })

  it('cleans up event listeners on unmount', () => {
    const Wrapper = makeWrapper(invalidateSpy)
    const { unmount } = render(
      <Wrapper>
        <RateLimitBanner />
      </Wrapper>,
    )
    unmount()

    fireRateLimited(30)
    expect(screen.queryByTestId('rate-limit-banner')).not.toBeInTheDocument()
  })

  it('ignores malformed events with no detail or non-numeric retryAfterSec', () => {
    const Wrapper = makeWrapper(invalidateSpy)
    render(
      <Wrapper>
        <RateLimitBanner />
      </Wrapper>,
    )

    act(() => {
      document.dispatchEvent(new CustomEvent('teslasync:rate-limited', { detail: undefined }))
    })
    expect(screen.queryByTestId('rate-limit-banner')).not.toBeInTheDocument()

    act(() => {
      document.dispatchEvent(
        new CustomEvent('teslasync:rate-limited', {
          detail: { scope: '/vehicles', retryAfterSec: 'soon' as unknown as number },
        }),
      )
    })
    expect(screen.queryByTestId('rate-limit-banner')).not.toBeInTheDocument()
  })
})
