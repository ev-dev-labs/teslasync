/**
 * SystemPage contract tests.
 *
 * SystemPage is the operator "system budgets" dashboard. It owns the two
 * TanStack queries (rate-limits + queues) so the header freshness chip and the
 * "Refresh all" action can span both feeds, then composes the health-overview
 * band on top of the two self-contained detail panels. These tests exercise the
 * page's orchestration end-to-end against the real child subtree, mocking only
 * the network `request` helper (the same convention the sibling panel tests
 * use). Both exports are covered:
 *
 *   • SYSTEM_PAGE_PATH — the canonical route constant.
 *   • SystemPage (default) — composition, the roll-up KPI band, the shared
 *     "Refresh all" action, and delegated loading / error / empty states.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

vi.mock('@/api/client', () => ({
  request: vi.fn(),
}))

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
        // t(key, defaultStr, opts) signature — interpolate {{name}} tokens.
        if (typeof fallbackOrOpts === 'string') {
          if (opts && typeof opts === 'object') {
            const o = opts as Record<string, unknown>
            return fallbackOrOpts.replace(/{{(\w+)}}/g, (_, name) =>
              name in o ? String(o[name]) : `{{${name}}}`,
            )
          }
          return fallbackOrOpts
        }
        // t(key, opts) signature — honour an explicit defaultValue.
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

import { request } from '@/api/client'
import { ToastProvider } from '@/components/feedback/Toast'
import SystemPage, { SYSTEM_PAGE_PATH } from './SystemPage'
import type {
  RateLimitSeverity,
  RateLimitStatusResponse,
  ScopeBudget,
  QueueHeartbeatSeverity,
  QueueStat,
  QueueStatusResponse,
} from '@/api/types'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

const RATE_URL = '/system/rate-limits'
const QUEUE_URL = '/system/queues'

// ── fixtures ──────────────────────────────────────────────────────────────

function makeScope(
  id: string,
  current: number,
  limit: number,
  severity: RateLimitSeverity,
  windowSeconds = 60,
): ScopeBudget {
  return {
    id,
    name: id,
    current,
    limit,
    window_seconds: windowSeconds,
    severity,
    detail: `${id} detail`,
  }
}

function buildRateResponse(
  overrides: Partial<RateLimitStatusResponse> = {},
): RateLimitStatusResponse {
  return {
    generated_at: '2026-07-03T12:00:00Z',
    scopes: [
      makeScope('tesla.fleet_api.burst', 1, 5, 'ok', 0),
      makeScope('api.internal.minute', 350, 600, 'warn', 60),
      makeScope('api.write.minute', 110, 120, 'critical', 60),
    ],
    ...overrides,
  }
}

function makeStat(
  worker: string,
  display: string,
  severity: QueueHeartbeatSeverity,
  overrides: Partial<QueueStat> = {},
): QueueStat {
  return {
    worker,
    display_name: display,
    pending: 0,
    in_progress: 0,
    succeeded_24h: 0,
    failed_24h: 0,
    oldest_pending_age_seconds: 0,
    heartbeat_severity: severity,
    heartbeat_detail: '',
    last_heartbeat_at: null,
    started_at: null,
    host: 'worker-host-1',
    version: '1.0.0',
    ...overrides,
  }
}

function buildQueueResponse(
  overrides: Partial<QueueStatusResponse> = {},
): QueueStatusResponse {
  return {
    generated_at: '2026-07-03T12:00:00Z',
    workers: [
      makeStat('notification', 'Notification worker', 'ok', {
        succeeded_24h: 42,
        failed_24h: 0,
      }),
      makeStat('export', 'Export worker', 'warn', {
        pending: 3,
        in_progress: 1,
        failed_24h: 2,
      }),
      makeStat('automation', 'Automation worker', 'ok', { succeeded_24h: 7 }),
    ],
    ...overrides,
  }
}

// A manually-settleable promise so the loading-state tests can hold the two
// feeds pending, assert, then resolve cleanly (no leaked in-flight queries).
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Route the single mocked `request` by URL to the right feed. */
function installRouter(
  opts: {
    rate?: () => Promise<RateLimitStatusResponse>
    queue?: () => Promise<QueueStatusResponse>
  } = {},
) {
  const rate = opts.rate ?? (() => Promise.resolve(buildRateResponse()))
  const queue = opts.queue ?? (() => Promise.resolve(buildQueueResponse()))
  mockedRequest.mockImplementation((url: unknown) => {
    if (typeof url === 'string' && url.startsWith(RATE_URL)) return rate()
    if (typeof url === 'string' && url.startsWith(QUEUE_URL)) return queue()
    return Promise.reject(new Error(`unexpected url: ${String(url)}`))
  })
}

function countCalls(prefix: string): number {
  return mockedRequest.mock.calls.filter(
    (c) => typeof c[0] === 'string' && (c[0] as string).startsWith(prefix),
  ).length
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      // `retryDelay: 0` collapses the hooks' built-in `retry: 1` backoff so the
      // error-state assertions settle promptly instead of waiting out the
      // default ~1s exponential delay.
      queries: { retry: false, retryDelay: 0 },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <SystemPage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mockedRequest.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SYSTEM_PAGE_PATH', () => {
  it('exposes the canonical admin route', () => {
    expect(SYSTEM_PAGE_PATH).toBe('/admin/system')
    expect(typeof SYSTEM_PAGE_PATH).toBe('string')
  })
})

describe('SystemPage', () => {
  it('renders the page shell with both labelled sections, panels, and the refresh action', async () => {
    installRouter()
    renderPage()

    await waitFor(() =>
      expect(screen.getByTestId('rate-limit-rows')).toBeInTheDocument(),
    )

    // Page + section headings form the semantic outline (h1 → two h2s).
    expect(
      screen.getByRole('heading', { level: 1, name: 'System budgets' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'Health at a glance' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'Throttles & workers' }),
    ).toBeInTheDocument()

    // Both sections are aria-labelled by their heading — never anonymous.
    expect(screen.getByTestId('system-page-overview')).toHaveAttribute(
      'aria-labelledby',
      'system-overview-heading',
    )
    expect(screen.getByTestId('system-page-stack')).toHaveAttribute(
      'aria-labelledby',
      'system-detail-heading',
    )

    // Both detail panels mount below the roll-up band.
    expect(screen.getByTestId('rate-limit-status-panel')).toBeInTheDocument()
    expect(screen.getByTestId('queue-status-panel')).toBeInTheDocument()
    expect(screen.getByTestId('queue-rows')).toBeInTheDocument()

    // The shared toolbar action is present and accessible.
    expect(
      screen.getByRole('button', { name: 'Refresh all' }),
    ).toBeInTheDocument()
  })

  it('rolls both feeds up into the health-at-a-glance KPI band', async () => {
    installRouter()
    renderPage()

    await waitFor(() =>
      expect(screen.getByTestId('system-overview')).toBeInTheDocument(),
    )
    // Live band, not the skeleton placeholder.
    expect(screen.queryByTestId('system-overview-loading')).toBeNull()

    // Scope to the overview: several labels ("Succeeded 24h" / "Failed 24h")
    // also appear inside the worker cards below, so a page-wide getByText
    // would be ambiguous.
    const overview = within(screen.getByTestId('system-overview'))

    // All six KPI labels render from the two feeds.
    expect(overview.getByText('Throttle budgets')).toBeInTheDocument()
    expect(overview.getByText('Peak budget usage')).toBeInTheDocument()
    expect(overview.getByText('Active workers')).toBeInTheDocument()
    expect(overview.getByText('Queue backlog')).toBeInTheDocument()
    expect(overview.getByText('Succeeded 24h')).toBeInTheDocument()
    expect(overview.getByText('Failed 24h')).toBeInTheDocument()

    // Computed roll-ups: 2 of 3 workers healthy, 49 (42+0+7) jobs succeeded,
    // and 91.7% peak usage (110/120) rounded to the nearest whole percent.
    expect(overview.getByText('2 / 3')).toBeInTheDocument()
    expect(overview.getByText('49')).toBeInTheDocument()
    expect(overview.getByText('92%')).toBeInTheDocument()
  })

  it('holds the loading skeleton + panel spinners until data lands, then swaps to the live band', async () => {
    const rd = deferred<RateLimitStatusResponse>()
    const qd = deferred<QueueStatusResponse>()
    installRouter({ rate: () => rd.promise, queue: () => qd.promise })
    renderPage()

    // Both feeds pending → the overview skeleton and both panel spinners show.
    expect(screen.getByTestId('system-overview-loading')).toBeInTheDocument()
    expect(screen.getByTestId('rate-limit-loading')).toBeInTheDocument()
    expect(screen.getByTestId('queue-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('system-overview')).toBeNull()

    // Settle both feeds and confirm the skeleton is replaced by live content.
    rd.resolve(buildRateResponse())
    qd.resolve(buildQueueResponse())

    await waitFor(() =>
      expect(screen.getByTestId('system-overview')).toBeInTheDocument(),
    )
    expect(screen.queryByTestId('system-overview-loading')).toBeNull()
  })

  it('disables and marks the refresh button busy while a feed is in flight', async () => {
    const rd = deferred<RateLimitStatusResponse>()
    const qd = deferred<QueueStatusResponse>()
    installRouter({ rate: () => rd.promise, queue: () => qd.promise })
    renderPage()

    const button = screen.getByRole('button', { name: 'Refresh all' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')

    rd.resolve(buildRateResponse())
    qd.resolve(buildQueueResponse())

    await waitFor(() => expect(button).not.toBeDisabled())
    expect(button).not.toHaveAttribute('aria-busy', 'true')
  })

  it('refetches BOTH feeds when "Refresh all" is clicked', async () => {
    installRouter()
    renderPage()

    // Wait for the first load to settle and the button to become enabled.
    await waitFor(() =>
      expect(screen.getByTestId('rate-limit-rows')).toBeInTheDocument(),
    )
    const button = screen.getByRole('button', { name: 'Refresh all' })
    await waitFor(() => expect(button).not.toBeDisabled())

    const rateBefore = countCalls(RATE_URL)
    const queueBefore = countCalls(QUEUE_URL)

    fireEvent.click(button)

    await waitFor(() => {
      expect(countCalls(RATE_URL)).toBeGreaterThan(rateBefore)
      expect(countCalls(QUEUE_URL)).toBeGreaterThan(queueBefore)
    })
  })

  it('surfaces each feed error state without blanking the sections', async () => {
    // Retries are disabled on the page QueryClient, so a single rejection
    // drives each feed straight to its error branch.
    mockedRequest.mockRejectedValue(new Error('boom'))
    renderPage()

    await waitFor(
      () => {
        expect(screen.getByTestId('rate-limit-error')).toBeInTheDocument()
        expect(screen.getByTestId('queue-error')).toBeInTheDocument()
      },
      { timeout: 5000 },
    )

    // The page frame + roll-up band stay mounted; errors are panel-local.
    expect(screen.getByTestId('system-page-overview')).toBeInTheDocument()
    expect(screen.getByTestId('system-page-stack')).toBeInTheDocument()
    expect(screen.getByTestId('system-overview')).toBeInTheDocument()
  })

  it('renders panel empty states while keeping the overview visible', async () => {
    installRouter({
      rate: () => Promise.resolve(buildRateResponse({ scopes: [] })),
      queue: () => Promise.resolve(buildQueueResponse({ workers: [] })),
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('rate-limit-empty')).toBeInTheDocument()
      expect(screen.getByTestId('queue-empty')).toBeInTheDocument()
    })

    // Overview never disappears — it collapses to a zeroed / "no budgets" band.
    expect(screen.getByTestId('system-overview')).toBeInTheDocument()
    expect(screen.getByText('No active budgets')).toBeInTheDocument()
  })

  it('sets the document title via usePageTitle', async () => {
    installRouter()
    renderPage()

    await waitFor(() => expect(document.title).toContain('System budgets'))
    expect(document.title).toContain('TeslaSync')
  })
})
