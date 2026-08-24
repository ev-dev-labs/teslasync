/**
 * SystemHealthOverview contract tests.
 *
 * SystemHealthOverview is a presentational KPI band: it receives the two
 * TanStack `UseQueryResult`s the SystemPage owns as props and never fetches
 * itself, so the tests drive it with hand-built query objects rather than
 * mocking the network (mirrors GasPriceKpiBand.test.tsx). Coverage:
 *   1. First-load skeleton band + role="status"/aria-busy.
 *   2. One feed landing first paints live cards with em-dash for the other.
 *   3. Empty feeds paint a full band of 0 / placeholder values.
 *   4. Rate rollups: worst severity, tightest-window peak usage, colour
 *      thresholds (green/amber/red), >100% over-budget, limit-0 token buckets.
 *   5. Queue rollups: healthy/total workers colour, backlog/success/failure
 *      aggregation, failed-tile red-vs-green branch.
 *   6. Resilience: null numeric fields, missing scopes/workers arrays, and the
 *      "never blank on error" contract.
 *   7. Module surface: named export === default export.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'

import type {
  RateLimitStatusResponse,
  ScopeBudget,
  QueueStatusResponse,
  QueueStat,
} from '@/api/types'

// ── i18n: honour t(key, default, opts) with {{var}} interpolation so labels
//    resolve to their English defaults. ───────────────────────────────────────
vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') {
          if (opts && typeof opts === 'object') {
            const o = opts as Record<string, unknown>
            return fallbackOrOpts.replace(/{{(\w+)}}/g, (_, name) =>
              name in o ? String(o[name]) : `{{${name}}}`,
            )
          }
          return fallbackOrOpts
        }
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>
          if (typeof o.defaultValue === 'string') return o.defaultValue
        }
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { SystemHealthOverview } from './SystemHealthOverview'
import SystemHealthOverviewDefault from './SystemHealthOverview'

type RateQuery = UseQueryResult<RateLimitStatusResponse, Error>
type QueueQuery = UseQueryResult<QueueStatusResponse, Error>

const DASH = '\u2014' // em dash — the placeholder the component renders

const LABELS = {
  budgets: 'Throttle budgets',
  peak: 'Peak budget usage',
  workers: 'Active workers',
  backlog: 'Queue backlog',
  succeeded: 'Succeeded 24h',
  failed: 'Failed 24h',
} as const

function makeQuery<T>(overrides: Partial<UseQueryResult<T, Error>> = {}): UseQueryResult<T, Error> {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isPending: false,
    isFetching: false,
    isError: false,
    isSuccess: false,
    refetch: vi.fn(),
    ...overrides,
  } as unknown as UseQueryResult<T, Error>
}

function scope(overrides: Partial<ScopeBudget> = {}): ScopeBudget {
  return {
    id: 'scope',
    name: 'Scope',
    current: 0,
    limit: 100,
    window_seconds: 60,
    severity: 'ok',
    ...overrides,
  }
}

function worker(overrides: Partial<QueueStat> = {}): QueueStat {
  return {
    worker: 'notification',
    display_name: 'Notification worker',
    pending: 0,
    in_progress: 0,
    succeeded_24h: 0,
    failed_24h: 0,
    oldest_pending_age_seconds: 0,
    heartbeat_severity: 'ok',
    heartbeat_detail: 'Last beat 5s ago',
    ...overrides,
  }
}

function rateData(scopes: ScopeBudget[]): RateLimitStatusResponse {
  return { generated_at: '2026-07-04T00:00:00Z', scopes }
}

function queueData(workers: QueueStat[]): QueueStatusResponse {
  return { generated_at: '2026-07-04T00:00:00Z', workers }
}

function renderOverview(rate: RateQuery, queue: QueueQuery) {
  return render(<SystemHealthOverview rateLimit={rate} queue={queue} />)
}

/** The MetricCard root (`[data-role="metric-card"]`) that owns the given headline label. */
function card(label: string): HTMLElement {
  const labelNode = screen.getByText(label)
  const root = labelNode.closest('[data-role="metric-card"]')
  if (!(root instanceof HTMLElement)) {
    throw new Error(`MetricCard root not found for "${label}"`)
  }
  return root
}

/** The rendered headline value text for a card (the `[data-role="metric-value"]` node). */
function cardValue(label: string): string {
  const node = card(label).querySelector('[data-role="metric-value"]')
  return node?.textContent ?? ''
}

/** The icon wrapper's `data-color`, which carries the semantic NeonColor tone. */
function cardTone(label: string): string {
  const chip = card(label).querySelector('[data-role="metric-icon"]')
  if (!(chip instanceof HTMLElement)) {
    throw new Error(`icon tone chip not found for "${label}"`)
  }
  return chip.dataset.color ?? ''
}

describe('SystemHealthOverview — first paint', () => {
  it('shows a busy six-tile skeleton band while both feeds first-load', () => {
    renderOverview(
      makeQuery<RateLimitStatusResponse>({ isLoading: true, isPending: true, isFetching: true }),
      makeQuery<QueueStatusResponse>({ isLoading: true, isPending: true, isFetching: true }),
    )

    const loading = screen.getByTestId('system-overview-loading')
    expect(loading).toHaveAttribute('role', 'status')
    expect(loading).toHaveAttribute('aria-busy', 'true')
    expect(loading).toHaveAttribute('aria-label', expect.stringContaining('Loading system health'))
    expect(loading.querySelectorAll('.animate-pulse')).toHaveLength(6)
    expect(screen.queryByTestId('system-overview')).not.toBeInTheDocument()
  })

  it('paints live cards as soon as one feed lands, dashing the still-loading feed', () => {
    renderOverview(
      makeQuery<RateLimitStatusResponse>({
        isSuccess: true,
        data: rateData([scope({ severity: 'ok' })]),
      }),
      makeQuery<QueueStatusResponse>({ isLoading: true, isPending: true, isFetching: true }),
    )

    expect(screen.getByTestId('system-overview')).toBeInTheDocument()
    expect(screen.queryByTestId('system-overview-loading')).not.toBeInTheDocument()
    // Rate feed populated → real count; queue feed still loading → em dash.
    expect(cardValue(LABELS.budgets)).toBe('1')
    expect(cardValue(LABELS.workers)).toBe(DASH)
    expect(cardValue(LABELS.backlog)).toBe(DASH)
  })
})

describe('SystemHealthOverview — empty feeds', () => {
  it('paints a full band of zero / placeholder values when both feeds are empty', () => {
    renderOverview(
      makeQuery<RateLimitStatusResponse>({ isSuccess: true, data: rateData([]) }),
      makeQuery<QueueStatusResponse>({ isSuccess: true, data: queueData([]) }),
    )

    expect(screen.getByTestId('system-overview')).toBeInTheDocument()
    expect(cardValue(LABELS.budgets)).toBe('0')
    expect(within(card(LABELS.budgets)).getByText('No active budgets')).toBeInTheDocument()
    expect(cardValue(LABELS.peak)).toBe('0%')
    expect(cardValue(LABELS.workers)).toBe('0 / 0')
    expect(cardValue(LABELS.backlog)).toBe('0')
    expect(cardValue(LABELS.succeeded)).toBe('0')
    expect(cardValue(LABELS.failed)).toBe('0')
    // No budgets / no workers → neutral cyan; no failures → green.
    expect(cardTone(LABELS.budgets)).toBe('cyan')
    expect(cardTone(LABELS.workers)).toBe('cyan')
    expect(cardTone(LABELS.failed)).toBe('green')
  })
})

describe('SystemHealthOverview — rate-limit rollups', () => {
  it('summarises the worst severity and the tightest window usage', () => {
    renderOverview(
      makeQuery<RateLimitStatusResponse>({
        isSuccess: true,
        data: rateData([
          scope({ id: 'a', current: 20, limit: 100, severity: 'ok' }), // 20%
          scope({ id: 'b', current: 90, limit: 100, severity: 'critical' }), // 90%
          scope({ id: 'c', current: 60, limit: 100, severity: 'warn' }), // 60%
        ]),
      }),
      makeQuery<QueueStatusResponse>({ isSuccess: true, data: queueData([]) }),
    )

    expect(cardValue(LABELS.budgets)).toBe('3')
    expect(within(card(LABELS.budgets)).getByText('critical')).toBeInTheDocument()
    expect(cardTone(LABELS.budgets)).toBe('red') // worst severity → red
    expect(cardValue(LABELS.peak)).toBe('90%') // tightest window
    expect(cardTone(LABELS.peak)).toBe('red') // 90% ≥ 80 → red
  })

  it('colours peak usage amber in the 50–80% band and green below 50%', () => {
    const { rerender } = renderOverview(
      makeQuery<RateLimitStatusResponse>({
        isSuccess: true,
        data: rateData([scope({ current: 60, limit: 100, severity: 'warn' })]),
      }),
      makeQuery<QueueStatusResponse>({ isSuccess: true, data: queueData([]) }),
    )
    expect(cardValue(LABELS.peak)).toBe('60%')
    expect(cardTone(LABELS.peak)).toBe('amber')

    rerender(
      <SystemHealthOverview
        rateLimit={makeQuery<RateLimitStatusResponse>({
          isSuccess: true,
          data: rateData([scope({ current: 30, limit: 100, severity: 'ok' })]),
        })}
        queue={makeQuery<QueueStatusResponse>({ isSuccess: true, data: queueData([]) })}
      />,
    )
    expect(cardValue(LABELS.peak)).toBe('30%')
    expect(cardTone(LABELS.peak)).toBe('green')
  })

  it('does not clamp usage above 100% for an over-budget window', () => {
    renderOverview(
      makeQuery<RateLimitStatusResponse>({
        isSuccess: true,
        data: rateData([scope({ current: 150, limit: 100, severity: 'critical' })]),
      }),
      makeQuery<QueueStatusResponse>({ isSuccess: true, data: queueData([]) }),
    )

    expect(cardValue(LABELS.peak)).toBe('150%')
    expect(cardTone(LABELS.peak)).toBe('red')
  })

  it('ignores token-bucket windows (limit 0) when computing peak usage', () => {
    renderOverview(
      makeQuery<RateLimitStatusResponse>({
        isSuccess: true,
        data: rateData([
          scope({ id: 'bucket', current: 5, limit: 0, window_seconds: 0, severity: 'ok' }),
          scope({ id: 'window', current: 40, limit: 100, severity: 'ok' }),
        ]),
      }),
      makeQuery<QueueStatusResponse>({ isSuccess: true, data: queueData([]) }),
    )

    // The limit-0 bucket contributes 0 (no divide-by-zero → no NaN/Infinity).
    expect(cardValue(LABELS.peak)).toBe('40%')
    expect(cardValue(LABELS.budgets)).toBe('2')
  })
})

describe('SystemHealthOverview — queue rollups', () => {
  it('reports healthy/total workers in green when every worker beats', () => {
    renderOverview(
      makeQuery<RateLimitStatusResponse>({ isSuccess: true, data: rateData([]) }),
      makeQuery<QueueStatusResponse>({
        isSuccess: true,
        data: queueData([
          worker({ worker: 'a', heartbeat_severity: 'ok' }),
          worker({ worker: 'b', heartbeat_severity: 'ok' }),
        ]),
      }),
    )

    expect(cardValue(LABELS.workers)).toBe('2 / 2')
    expect(cardTone(LABELS.workers)).toBe('green')
  })

  it('reports amber and counts only ok heartbeats when a worker is unhealthy', () => {
    renderOverview(
      makeQuery<RateLimitStatusResponse>({ isSuccess: true, data: rateData([]) }),
      makeQuery<QueueStatusResponse>({
        isSuccess: true,
        data: queueData([
          worker({ worker: 'a', heartbeat_severity: 'ok' }),
          worker({ worker: 'b', heartbeat_severity: 'down' }),
          worker({ worker: 'c', heartbeat_severity: 'warn' }),
        ]),
      }),
    )

    expect(cardValue(LABELS.workers)).toBe('1 / 3')
    expect(cardTone(LABELS.workers)).toBe('amber')
  })

  it('aggregates backlog, successes and failures across workers', () => {
    renderOverview(
      makeQuery<RateLimitStatusResponse>({ isSuccess: true, data: rateData([]) }),
      makeQuery<QueueStatusResponse>({
        isSuccess: true,
        data: queueData([
          worker({ worker: 'a', pending: 5, in_progress: 2, succeeded_24h: 1000, failed_24h: 3 }),
          worker({ worker: 'b', pending: 10, in_progress: 1, succeeded_24h: 500, failed_24h: 4 }),
        ]),
      }),
    )

    expect(cardValue(LABELS.backlog)).toBe('18') // 5+2+10+1
    expect(cardValue(LABELS.succeeded)).toBe('1,500') // locale grouping
    expect(cardValue(LABELS.failed)).toBe('7') // 3+4
    expect(cardTone(LABELS.failed)).toBe('red') // failures > 0 → red
  })

  it('keeps the failed tile green when there are zero terminal failures', () => {
    renderOverview(
      makeQuery<RateLimitStatusResponse>({ isSuccess: true, data: rateData([]) }),
      makeQuery<QueueStatusResponse>({
        isSuccess: true,
        data: queueData([worker({ failed_24h: 0, succeeded_24h: 42 })]),
      }),
    )

    expect(cardValue(LABELS.failed)).toBe('0')
    expect(cardTone(LABELS.failed)).toBe('green')
    expect(cardValue(LABELS.succeeded)).toBe('42')
  })
})

describe('SystemHealthOverview — resilience', () => {
  it('tolerates null numeric fields from the backend without crashing', () => {
    const dirtyScope = scope({
      current: null as unknown as number,
      limit: null as unknown as number,
      severity: 'ok',
    })
    const dirtyWorker = worker({
      pending: null as unknown as number,
      in_progress: null as unknown as number,
      succeeded_24h: null as unknown as number,
      failed_24h: null as unknown as number,
    })

    renderOverview(
      makeQuery<RateLimitStatusResponse>({ isSuccess: true, data: rateData([dirtyScope]) }),
      makeQuery<QueueStatusResponse>({ isSuccess: true, data: queueData([dirtyWorker]) }),
    )

    expect(cardValue(LABELS.peak)).toBe('0%') // null current/limit → 0, never NaN
    expect(cardValue(LABELS.backlog)).toBe('0')
    expect(cardValue(LABELS.succeeded)).toBe('0')
    expect(cardValue(LABELS.failed)).toBe('0')
    expect(cardValue(LABELS.workers)).toBe('1 / 1') // still one ok worker
  })

  it('renders zero rollups when the payload omits the scopes/workers arrays', () => {
    renderOverview(
      makeQuery<RateLimitStatusResponse>({
        isSuccess: true,
        data: { generated_at: 'x', scopes: null as unknown as ScopeBudget[] },
      }),
      makeQuery<QueueStatusResponse>({
        isSuccess: true,
        data: { generated_at: 'x', workers: null as unknown as QueueStat[] },
      }),
    )

    expect(screen.getByTestId('system-overview')).toBeInTheDocument()
    expect(cardValue(LABELS.budgets)).toBe('0')
    expect(cardValue(LABELS.workers)).toBe('0 / 0')
  })

  it('keeps the band visible with em-dash placeholders when both feeds error', () => {
    renderOverview(
      makeQuery<RateLimitStatusResponse>({ isError: true, error: new Error('rate down') }),
      makeQuery<QueueStatusResponse>({ isError: true, error: new Error('queue down') }),
    )

    // Never a blank panel: the six headline tiles still render (no skeleton).
    expect(screen.getByTestId('system-overview')).toBeInTheDocument()
    expect(screen.queryByTestId('system-overview-loading')).not.toBeInTheDocument()
    expect(cardValue(LABELS.budgets)).toBe(DASH)
    expect(cardValue(LABELS.workers)).toBe(DASH)
    expect(cardValue(LABELS.failed)).toBe(DASH)
    expect(within(card(LABELS.budgets)).getByText('Awaiting data')).toBeInTheDocument()
  })
})

describe('SystemHealthOverview — module surface', () => {
  it('exposes the same component as the named and default export', () => {
    expect(SystemHealthOverviewDefault).toBe(SystemHealthOverview)
    expect(typeof SystemHealthOverview).toBe('function')
  })
})
