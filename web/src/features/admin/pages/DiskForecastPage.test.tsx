/**
 * DiskForecastPage contract tests.
 *
 * The page is a read-only observability surface backed by
 * GET /admin/observability/disk-forecast (via useDiskForecast). These tests
 * pin the behaviour that actually matters to an operator:
 *
 *  1. Loading skeletons render before data lands.
 *  2. The KPI band computes fleet totals, percentages, growth, and the
 *     soonest-to-quota table from the raw hypertable rows.
 *  3. The per-hypertable detail table renders each row (name + chunk count).
 *  4. Accessible landmarks + chart labels are present (a11y contract).
 *  5. The "Quota pressure" banner appears only when a hypertable is critical.
 *  6. A 503 renders the unsupported-deployment explainer (not an error).
 *  7. A genuine (non-503) failure renders <QueryError> everywhere — and the
 *     KPI band must NOT surface fabricated zero totals.
 *  8. Zero hypertables renders empty states for every section.
 *  9. Over-long hypertable names are truncated in the summary cards.
 * 10. The header freshness control refetches on click.
 *
 * Network is mocked at the `@/api/client` boundary (the repo convention —
 * see FleetTelemetryCoveragePage.test.tsx). `@/lib/resilience` is left real
 * so the page's own `isApiError`/`ApiError` 503 branch is exercised honestly.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

vi.mock('@/api/client', () => ({
  request: vi.fn(),
  // <QueryError> imports isApiError from @/api/client; stub it to false so a
  // plain Error falls to the generic "Can't reach server" branch. The PAGE
  // imports isApiError from @/lib/resilience (left real), so the 503
  // subsystem branch is still driven by a genuine ApiError instance.
  isApiError: () => false,
}))

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

import { request } from '@/api/client'
import { ApiError } from '@/lib/resilience'
import DiskForecastPage from './DiskForecastPage'
import type {
  DiskForecastResponse,
  HypertableSize,
} from '@/types/admin-operator-confidence'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

const MB = 1024 * 1024
const GB = 1024 * 1024 * 1024

// 21 chars — exceeds truncate()'s 18-char ceiling so the summary cards must
// clip it while the full name still surfaces in the table / growth / quota.
const LONG_NAME = 'signal_log_history_ht'
const TRUNCATED = `${LONG_NAME.slice(0, 17)}\u2026`

function makeRow(overrides: Partial<HypertableSize> = {}): HypertableSize {
  return {
    hypertable_name: 'table',
    total_bytes: GB,
    uncompressed_bytes: 512 * MB,
    compressed_bytes: 512 * MB,
    chunk_count: 4,
    growth_bytes_per_day: 10 * MB,
    est_days_to_quota: 42,
    severity: 'ok',
    ...overrides,
  }
}

// Three rows chosen so every derived metric has a clean, predictable string:
//   total       = 3GB + 1GB + 0.5GB = 4.5 GB
//   uncompressed = 2GB + 0.5GB + 0.5GB = 3.0 GB  (66.7% of total)
//   compressed   = 1GB + 0.5GB + 0    = 1.5 GB  (33.3% of total)
//   growth       = 100MB + 50MB + 0   = 150.0 MB/d
//   soonest quota = min(5, 30) = 5 days (the critical table)
function defaultRows(): HypertableSize[] {
  return [
    makeRow({
      hypertable_name: LONG_NAME,
      total_bytes: 3 * GB,
      uncompressed_bytes: 2 * GB,
      compressed_bytes: 1 * GB,
      chunk_count: 10,
      growth_bytes_per_day: 100 * MB,
      est_days_to_quota: 5,
      severity: 'critical',
    }),
    makeRow({
      hypertable_name: 'drives',
      total_bytes: 1 * GB,
      uncompressed_bytes: 512 * MB,
      compressed_bytes: 512 * MB,
      chunk_count: 5,
      growth_bytes_per_day: 50 * MB,
      est_days_to_quota: 30,
      severity: 'warn',
    }),
    makeRow({
      hypertable_name: 'charging_sessions',
      total_bytes: 512 * MB,
      uncompressed_bytes: 512 * MB,
      compressed_bytes: 0,
      chunk_count: 2,
      growth_bytes_per_day: 0,
      est_days_to_quota: null,
      severity: 'ok',
    }),
  ]
}

function makeResponse(rows: HypertableSize[] = defaultRows()): DiskForecastResponse {
  return { hypertables: rows }
}

function renderPage() {
  // retryDelay:0 keeps the hook's `retry: 1` (which overrides the client
  // default) from adding a real backoff to the rejection-path tests.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <DiskForecastPage />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockedRequest.mockReset()
})

describe('DiskForecastPage', () => {
  it('renders skeleton placeholders while the query is loading', () => {
    let resolve: (v: DiskForecastResponse) => void = () => {}
    mockedRequest.mockReturnValueOnce(
      new Promise<DiskForecastResponse>((r) => {
        resolve = r
      }),
    )

    const { container } = renderPage()

    // Title chrome is always present; the KPI cards are not — the band is
    // still showing its six pulse skeletons.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Disk Forecast' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Total disk')).toBeNull()
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)

    // Settle the promise so React-Query teardown is clean.
    resolve(makeResponse([]))
  })

  it('computes fleet totals, percentages, growth, and soonest-quota in the KPI band', async () => {
    mockedRequest.mockResolvedValueOnce(makeResponse())

    renderPage()

    await waitFor(() =>
      expect(screen.getByText('Total disk')).toBeInTheDocument(),
    )

    // Totals are summed and byte-formatted.
    expect(screen.getByText('4.5 GB')).toBeInTheDocument()

    // Uncompressed / compressed carry their share-of-total subtitles. Scope
    // these assertions away from the chart's accessible fallback table.
    const summary = within(
      screen.getByRole('region', { name: 'Fleet disk summary' }),
    )
    expect(summary.getByText('Uncompressed')).toBeInTheDocument()
    expect(summary.getByText('66.7% of total')).toBeInTheDocument()
    expect(summary.getByText('Compressed')).toBeInTheDocument()
    expect(summary.getByText('33.3% of total')).toBeInTheDocument()

    // Daily growth is summed across all rows.
    expect(screen.getByText('150.0 MB/d')).toBeInTheDocument()

    // Soonest quota picks the SMALLEST days-to-quota (5), not the largest (30).
    expect(screen.getByText('Soonest quota')).toBeInTheDocument()
    expect(screen.getAllByText('5.00 d').length).toBeGreaterThan(0)
  })

  it('renders one detail-table row per hypertable with its chunk count', async () => {
    mockedRequest.mockResolvedValueOnce(makeResponse())

    renderPage()

    const table = await waitFor(() =>
      within(screen.getByRole('region', { name: 'Hypertables' })).getByRole('table'),
    )

    expect(within(table).getByText(LONG_NAME)).toBeInTheDocument()
    expect(within(table).getByText('drives')).toBeInTheDocument()
    expect(within(table).getByText('charging_sessions')).toBeInTheDocument()
    // The chunk-count caption interpolates the row's chunk_count.
    expect(within(table).getByText('10 chunks')).toBeInTheDocument()
  })

  it('exposes accessible landmarks and chart labels', async () => {
    mockedRequest.mockResolvedValueOnce(makeResponse())

    renderPage()

    // Gate on a data-dependent card so the charts have replaced their
    // loading skeletons before we assert their labels (the landmark
    // <section>s themselves render in every state).
    await waitFor(() =>
      expect(screen.getByText('Total disk')).toBeInTheDocument(),
    )

    expect(
      screen.getByRole('region', { name: 'Fleet disk summary' }),
    ).toBeInTheDocument()

    // Charts are announced to assistive tech via role=img + descriptive labels.
    expect(
      screen.getByRole('img', {
        name: /stacked bar chart of the largest hypertables/i,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('img', {
        name: /donut chart of hypertables grouped by quota severity/i,
      }),
    ).toBeInTheDocument()
  })

  it('surfaces the quota-pressure banner when a hypertable is critical', async () => {
    mockedRequest.mockResolvedValueOnce(makeResponse())

    renderPage()

    await waitFor(() =>
      expect(screen.getByText('Quota pressure')).toBeInTheDocument(),
    )

    // Count is interpolated (exactly one critical row in the fixture).
    expect(
      screen.getByText(/1 hypertable\(s\) are in the critical tier/i),
    ).toBeInTheDocument()
    // "Critical" surfaces in the severity legend and the row badges.
    expect(screen.getAllByText('Critical').length).toBeGreaterThan(0)
  })

  it('hides the quota-pressure banner when nothing is critical', async () => {
    mockedRequest.mockResolvedValueOnce(
      makeResponse([
        makeRow({ hypertable_name: 'a', severity: 'ok' }),
        makeRow({ hypertable_name: 'b', severity: 'warn', est_days_to_quota: 12 }),
      ]),
    )

    renderPage()

    await waitFor(() =>
      expect(screen.getByText('Total disk')).toBeInTheDocument(),
    )
    expect(screen.queryByText('Quota pressure')).toBeNull()
  })

  it('renders the subsystem-unavailable explainer on a 503 (not an error)', async () => {
    mockedRequest.mockRejectedValue(
      new ApiError('not configured', 503, 'SUBSYSTEM_NOT_CONFIGURED'),
    )

    renderPage()

    await waitFor(() =>
      expect(screen.getByText('Feature not supported')).toBeInTheDocument(),
    )
    expect(
      screen.getByText(/TimescaleDB hypertable metrics are unavailable/i),
    ).toBeInTheDocument()
    // 503 is a graceful "not wired" state — never a red error panel.
    expect(screen.queryByText("Can't reach server")).toBeNull()
  })

  it('renders an error state (and no fabricated totals) on a non-503 failure', async () => {
    mockedRequest.mockRejectedValue(new Error('boom'))

    renderPage()

    await waitFor(() =>
      expect(screen.getAllByText("Can't reach server").length).toBeGreaterThan(0),
    )
    // The KPI band must not lie with "0 B" totals when the fetch failed.
    expect(screen.queryByText('Total disk')).toBeNull()
    // A hard failure is distinct from the 503 not-configured state.
    expect(screen.queryByText('Feature not supported')).toBeNull()
  })

  it('renders empty states for every section when there are zero hypertables', async () => {
    mockedRequest.mockResolvedValueOnce(makeResponse([]))

    renderPage()

    await waitFor(() =>
      expect(
        screen.getByText('No hypertable sizes to chart yet.'),
      ).toBeInTheDocument(),
    )

    // Detail table + KPI placeholders degrade gracefully.
    expect(screen.getByText('No hypertables')).toBeInTheDocument()
    expect(screen.getByText('No data')).toBeInTheDocument()
    // "No quota configured" is the soonest-quota subtitle AND the quota panel
    // empty title — both should be present.
    expect(screen.getAllByText('No quota configured').length).toBeGreaterThan(0)
    // Totals collapse to "0 B" rather than vanishing.
    expect(screen.getAllByText('0 B').length).toBeGreaterThan(0)
  })

  it('truncates over-long hypertable names in the summary cards', async () => {
    mockedRequest.mockResolvedValueOnce(makeResponse())

    renderPage()

    await waitFor(() =>
      expect(screen.getByText('Largest table')).toBeInTheDocument(),
    )

    // Summary cards clip the 21-char name to 17 chars + ellipsis…
    expect(screen.getAllByText(TRUNCATED).length).toBeGreaterThan(0)
    // …while the full name is preserved where horizontal space allows.
    expect(screen.getAllByText(LONG_NAME).length).toBeGreaterThan(0)
  })

  it('refetches when the header freshness control is activated', async () => {
    mockedRequest.mockResolvedValue(makeResponse())

    renderPage()

    await waitFor(() =>
      expect(screen.getByText('Total disk')).toBeInTheDocument(),
    )

    const refresh = screen.getByRole('button', { name: /refresh/i })
    const before = mockedRequest.mock.calls.length
    fireEvent.click(refresh)

    await waitFor(() =>
      expect(mockedRequest.mock.calls.length).toBeGreaterThan(before),
    )
  })
})
