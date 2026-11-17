import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { RateLimitBanner } from '../RateLimitBanner'
import { RateLimitError } from '@/lib/resilience'
import { observeRateLimit, rateLimitContext, rateLimitFor, resetRateLimits, type RateLimitNotice } from '@/lib/rateLimit'
import { ratePolicyHeaders, TEST_RATE_BUCKET } from '@/test/rateLimit'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/setup')
  const { default: en } = await import('@/i18n/en.json')
  return createReactI18nextMock({ language: 'en', resources: { en: { translation: en } } })
})

/**
 * RateLimitBanner contract.
 *
 * The banner reacts to two document-level CustomEvents:
 *   • teslasync:rate-limited  — fired by resilientFetch on 429.
 *   • teslasync:upstream-down — fired by resilientFetch on 503 with
 *     code UPSTREAM_BREAKER_OPEN.
 *
 * Asserts the visibility lifecycle, countdown ticking, "Retry now"
 * gating, read-only scoped recovery, concurrent notices, and dismiss.
 */

function makeWrapper(refetchSpy: ReturnType<typeof vi.fn>) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  // Spy on the real method so production-equivalent behaviour is exercised.
  qc.refetchQueries = refetchSpy as unknown as typeof qc.refetchQueries
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

function fireRateLimited(retryAfterSec: number, scope = '/vehicles', overrides: Partial<RateLimitNotice> = {}) {
  act(() => {
    document.dispatchEvent(
      new CustomEvent('teslasync:rate-limited', { detail: {
        scope, retryAfterSec, expiresAt: Date.now() + retryAfterSec * 1000,
        bucket: TEST_RATE_BUCKET, methods: 'GET', requestMethod: 'GET',
        source: 'teslasync', enforcement: 'process', ...overrides,
      } }),
    )
  })
}

function fireUpstreamDown(retryAfterSec: number, upstream = 'tesla') {
  act(() => {
    document.dispatchEvent(
      new CustomEvent('teslasync:upstream-down', { detail: {
        upstream, retryAfterSec, scope: '/vehicles', requestMethod: 'GET',
        expiresAt: Date.now() + retryAfterSec * 1000,
      } }),
    )
  })
}

describe('RateLimitBanner', () => {
  let invalidateSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    invalidateSpy = vi.fn().mockResolvedValue(undefined)
  })

  afterEach(() => {
    act(() => resetRateLimits())
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
    expect(banner).toHaveAttribute('role', 'status')
    expect(banner).toHaveAttribute('aria-live', 'polite')
    expect(banner).toHaveAttribute('data-kind', 'rate-limited')
    expect(screen.getByText(/TeslaSync request limit reached/i)).toBeInTheDocument()
    expect(screen.getByText(/Try again in 30s/i)).toHaveAttribute('aria-live', 'off')
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
    expect(screen.getByText(/Try again in 45s/i)).toBeInTheDocument()
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

  it('enables only scoped read recovery after the deadline, never whole-cache invalidation', () => {
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
    const [filter, options] = invalidateSpy.mock.calls[0]
    expect(filter.type).toBe('active')
    expect(options).toEqual({ cancelRefetch: false })
    const qc = new QueryClient()
    const affected = qc.getQueryCache().build(qc, { queryKey: ['affected'] })
    const unrelated = qc.getQueryCache().build(qc, { queryKey: ['unrelated'] })
    affected.setState({ error: new RateLimitError('limited', 0, '/vehicles', {
      bucket: TEST_RATE_BUCKET, scope: '/vehicles', methods: 'GET', requestMethod: 'GET',
      source: 'teslasync', enforcement: 'process', expiresAt: Date.now(), retryAfterSec: 0,
    }) })
    unrelated.setState({ error: new Error('unrelated') })
    expect(filter.predicate(affected)).toBe(true)
    expect(filter.predicate(unrelated)).toBe(false)
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
    expect(screen.getByText(/Try again in 20s/i)).toBeInTheDocument()
  })

  it('does not replace a longer cooldown with a shorter concurrent bucket', () => {
    const Wrapper = makeWrapper(invalidateSpy)
    render(<Wrapper><RateLimitBanner /></Wrapper>)
    fireRateLimited(60)
    fireRateLimited(5, '/charging', { bucket: 'b'.repeat(32) })
    expect(screen.getByText(/Try again in 60s/i)).toBeInTheDocument()
  })

  it('explains a Tesla action limit without offering automatic command replay', () => {
    const Wrapper = makeWrapper(invalidateSpy)
    render(<Wrapper><RateLimitBanner /></Wrapper>)
    fireRateLimited(30, '/vehicles/7/wake', { methods: 'POST', requestMethod: 'POST', source: 'tesla' })
    expect(screen.getByText('Tesla request limit reached')).toBeInTheDocument()
    expect(screen.getByText(/Retry the action yourself/i)).toBeInTheDocument()
    expect(screen.queryByTestId('rate-limit-banner-retry')).not.toBeInTheDocument()
  })

  it('dismissal does not clear or bypass the actual transport cooldown', () => {
    const Wrapper = makeWrapper(invalidateSpy)
    render(<Wrapper><RateLimitBanner /></Wrapper>)
    act(() => {
      const context = rateLimitContext('https://api.example.test')
      observeRateLimit(new Response('{}', { status: 429, headers: ratePolicyHeaders() }),
        '/vehicles/7/refresh', 'POST', context)
    })
    fireEvent.click(screen.getByTestId('rate-limit-banner-dismiss'))
    expect(screen.queryByTestId('rate-limit-banner')).not.toBeInTheDocument()
    expect(rateLimitFor('/vehicles/9/refresh', 'POST')).toBeDefined()
  })

  it('shows a cooldown received before the layout mounted its banner listener', () => {
    const context = rateLimitContext('https://api.example.test')
    observeRateLimit(new Response('{}', { status: 429, headers: ratePolicyHeaders() }),
      '/vehicles/7/refresh', 'POST', context)
    const Wrapper = makeWrapper(invalidateSpy)
    render(<Wrapper><RateLimitBanner /></Wrapper>)
    expect(screen.getByText('TeslaSync request limit reached')).toBeInTheDocument()
    expect(screen.queryByTestId('rate-limit-banner-retry')).not.toBeInTheDocument()
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
