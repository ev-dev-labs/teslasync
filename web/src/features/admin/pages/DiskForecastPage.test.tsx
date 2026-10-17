/**
 * DiskForecastPage contract tests.
 *
 * The page is a read-only observability surface backed by
 * GET /admin/observability/disk-forecast (via useDiskForecast). These tests
 * pin the behaviour that actually matters to an operator:
 *
 *  1. Loading skeletons render before data lands.
 *  2. The KPI band computes fleet totals, compression sizes, growth, and the
 *     soonest-to-quota table from the raw hypertable rows.
 *  3. The per-hypertable detail table renders each row (name + chunk count).
 *  4. Accessible landmarks + chart labels are present (a11y contract).
 *  5. The "Quota pressure" banner appears only when a hypertable is critical.
 *  6. A 503 renders the unsupported-deployment explainer (not an error).
 *  7. A genuine (non-503) failure renders <QueryError> everywhere — and the
 *     KPI band must NOT surface fabricated zero totals.
 *  8. Zero hypertables renders empty states for every section.
 *  9. Full hypertable identities remain in the summary, growth and quota.
 * 10. The header freshness control refetches on click.
 *
 * Network is mocked at the `@/api/client` boundary (the repo convention —
 * see FleetTelemetryCoveragePage.test.tsx). `@/lib/resilience` is left real
 * so the page's own `isApiError`/`ApiError` 503 branch is exercised honestly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

vi.mock('@/hooks/useChartPalette', async () => {
  const { CHART_COLORS } = await vi.importActual<typeof import('@/lib/colors')>('@/lib/colors')
  return { useChartPalette: () => CHART_COLORS }
})

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

describe('DiskForecastPage semantic and mobile adoption', () => {
  it('names the embedded table and keeps every measurement reachable through row expansion', async () => {
    mockedRequest.mockResolvedValueOnce(makeResponse())
    renderPage()

    const table = await screen.findByRole('table', { name: 'Hypertables' })
    expect(table.closest('[data-grid-frame]')).toHaveAttribute('data-grid-variant', 'embedded')
    const row = within(table).getByText(LONG_NAME).closest('tr')
    expect(row).not.toBeNull()
    // Row expansion names now carry the row label; the row scope keeps the query exact.
    const expand = within(row!).getByRole('button', { name: /Expand row/ })
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(expand)

    const details = table.querySelector('dl')
    expect(details).not.toBeNull()
    const detail = within(details!)
    expect([...details!.querySelectorAll('dt')].map(node => node.textContent)).toEqual([
      'Hypertable', 'Total', 'Before / after compression', 'Growth (per day)', 'Days to quota', 'Severity',
    ])
    expect(detail.getByText(LONG_NAME)).toBeInTheDocument()
    expect(detail.getByText('10 chunks')).toBeInTheDocument()
    expect(detail.getByText('3.00 GB')).toBeInTheDocument()
    expect(detail.getByText('2.00 GB')).toBeInTheDocument()
    expect(detail.getByText('1.00 GB after compression')).toBeInTheDocument()
    expect(detail.getByText('100.00 MB/d')).toBeInTheDocument()
    expect(detail.getByText('5.00')).toBeInTheDocument()
    expect(detail.getByText('Critical')).toBeInTheDocument()
    const collapse = within(row!).getByRole('button', { name: /Collapse row/ })
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(collapse)
    expect(table.querySelector('dl')).toBeNull()
  })

  it('labels unknown server severity without changing its classification or missing estimate', async () => {
    mockedRequest.mockResolvedValueOnce(makeResponse([makeRow({
      hypertable_name: 'unknown_table', severity: 'unknown', est_days_to_quota: null,
    })]))
    renderPage()

    const table = await screen.findByRole('table', { name: 'Hypertables' })
    expect(within(table).getByText('Unknown')).toBeInTheDocument()
    expect(within(table).queryByText('OK')).not.toBeInTheDocument()
    expect(within(table).getByText('—')).toBeInTheDocument()
    expect(screen.queryByText('Quota pressure')).not.toBeInTheDocument()
  })

  it('retains measured zero quota days and source severity with semantic presentation', async () => {
    mockedRequest.mockResolvedValueOnce(makeResponse([makeRow({
      hypertable_name: 'quota_reached', severity: 'critical', est_days_to_quota: 0,
    })]))
    renderPage()

    const table = await screen.findByRole('table', { name: 'Hypertables' })
    expect(within(table).getByText('0.00')).toBeInTheDocument()
    expect(within(table).getByText('Critical')).toBeInTheDocument()
    const outlook = screen.getByRole('region', { name: 'Growth and quota outlook' })
    expect(within(outlook).getByText('0.00 d')).toHaveClass('text-[var(--semantic-danger)]')
    expect(screen.getByText('Quota pressure')).toBeInTheDocument()
  })
})

import { request } from '@/api/client'
import { ApiError } from '@/lib/resilience'
import { operatorConfidenceKeys } from '@/api/hooks/useOperatorConfidence'
import DiskForecastPage from './DiskForecastPage'
import type {
  DiskForecastResponse,
  HypertableSize,
} from '@/types/admin-operator-confidence'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

const MB = 1024 * 1024
const GB = 1024 * 1024 * 1024

// A long identity must remain available outside the space-limited chart ticks.
const LONG_NAME = 'signal_log_history_ht'

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
//   before compression = 2GB + 0.5GB + 0.5GB = 3.0 GB
//   after compression  = 1GB + 0.5GB + 0    = 1.5 GB
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

function renderPage(client = new QueryClient({
  defaultOptions: { queries: { retry: false, retryDelay: 0 } },
})) {
  // retryDelay:0 keeps the hook's `retry: 1` (which overrides the client
  // default) from adding a real backoff to the rejection-path tests.
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <DiskForecastPage />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

function summaryValue(label: string): string {
  const summary = screen.getByTestId('disk-forecast-summary')
  const node = within(summary).getByText(label).closest('[data-operational-metric]')
  return node?.querySelector('[data-operational-value]')?.textContent ?? ''
}

/** Opens the summary Brief's Review-details drawer; context and hidden counts live there. */
async function openSummaryDrawer() {
  const summary = screen.getByTestId('disk-forecast-summary')
  fireEvent.click(within(summary).getByRole('button', { name: 'Review details' }))
  return screen.findByRole('dialog', { name: 'Fleet disk summary details' })
}

beforeEach(() => {
  mockedRequest.mockReset()
})

afterEach(() => {
  onlineManager.setOnline(true)
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
      screen.getByRole('heading', { level: 1, name: 'Disk forecast' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('disk-forecast-summary')).toHaveAttribute('aria-busy', 'true')
    expect(summaryValue('Total disk')).toBe('')
    expect(container.querySelectorAll('[data-operational-brief][aria-busy="true"]').length).toBe(1)

    // Settle the promise so React-Query teardown is clean.
    resolve(makeResponse([]))
  })

  it('computes fleet totals, compression sizes, growth, and soonest-quota in the KPI band', async () => {
    mockedRequest.mockResolvedValueOnce(makeResponse())

    renderPage()

    await waitFor(() =>
      expect(summaryValue('Total disk')).toBe('4.50 GB'),
    )

    // Totals are summed and byte-formatted.
    expect(summaryValue('Total disk')).toBe('4.50 GB')

    // Before/after measurements retain both raw totals and their actual basis.
    const summary = within(
      screen.getByRole('region', { name: 'Fleet disk summary' }),
    )
    expect(summary.getByText('Before compression')).toBeInTheDocument()
    expect(summaryValue('Before compression')).toBe('3.00 GB')
    expect(summary.getByText('After compression')).toBeInTheDocument()
    expect(summaryValue('After compression')).toBe('1.50 GB')
    // Compression basis moved from the face to the Review-details drawer (asserted at the end).
    expect(summary.queryByText('Compressed chunks only; not a share of current disk usage.')).not.toBeInTheDocument()
    expect(summary.queryByText(/% of total/)).not.toBeInTheDocument()

    // Daily growth is summed across all rows.
    expect(summaryValue('Growth (per day)')).toBe('150.00 MB/d')

    // Soonest quota picks the SMALLEST days-to-quota (5), not the largest (30).
    expect(screen.getByText('Soonest quota')).toBeInTheDocument()
    expect(summaryValue('Soonest quota')).toBe('5.00 d')
    const strip = screen.getByTestId('disk-forecast-summary')
    expect(strip).toHaveAttribute('data-operational-brief')
    expect([...strip.querySelectorAll('[data-operational-metric]')].map(tile => tile.getAttribute('data-operational-metric')))
      .toEqual(['total-disk', 'uncompressed', 'compressed', 'daily-growth', 'largest-table', 'soonest-quota'])
    expect(strip.querySelectorAll('[data-value-state="value"]')).toHaveLength(6)

    const drawer = await openSummaryDrawer()
    expect(within(drawer).getAllByText('Compressed chunks only; not a share of current disk usage.')).toHaveLength(2)
    expect(within(drawer).queryByText(/% of total/)).not.toBeInTheDocument()
  })

  it('keeps growth values readable when the bar is green', async () => {
    mockedRequest.mockResolvedValueOnce(makeResponse([makeRow({ growth_bytes_per_day: 10 * MB })]))

    renderPage()

    const outlook = await screen.findByRole('region', { name: 'Growth and quota outlook' })
    const bar = await within(outlook).findByRole('progressbar', { name: 'table' })
    expect(within(bar).getByText('10.00 MB/d')).toHaveClass('text-[var(--text-primary)]')
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
      expect(summaryValue('Total disk')).toBe('4.50 GB'),
    )

    expect(
      screen.getByRole('region', { name: 'Fleet disk summary' }),
    ).toBeInTheDocument()

    // Interactive charts are named groups; static charts retain image semantics.
    expect(
      screen.getByRole('group', {
        name: /grouped bar chart comparing before and after compression sizes/i,
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
      expect(summaryValue('Total disk')).toBe('2.00 GB'),
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
    expect(screen.getByText('No metric values are available yet.')).toBeInTheDocument()
    const drawer = await openSummaryDrawer()
    expect(drawer).toHaveTextContent('6 empty fields are hidden.')
  })

  it('renders an error state (and no fabricated totals) on a non-503 failure', async () => {
    mockedRequest.mockRejectedValue(new Error('boom'))

    renderPage()

    await waitFor(() =>
      expect(screen.getAllByText("Can't reach server").length).toBeGreaterThan(0),
    )
    // The KPI band must not lie with "0 B" totals when the fetch failed.
    expect(screen.getByText('No metric values are available yet.')).toBeInTheDocument()
    const drawer = await openSummaryDrawer()
    expect(drawer).toHaveTextContent('6 empty fields are hidden.')
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
    // A missing estimate cannot establish whether a quota is configured.
    expect(screen.getAllByText('No quota estimate available').length).toBeGreaterThan(0)
    expect(screen.queryByText('No quota configured')).not.toBeInTheDocument()
    // Totals collapse to "0 B" rather than vanishing; unknown largest/soonest are omitted.
    expect(summaryValue('Total disk')).toBe('0 B')
    expect(summaryValue('Growth (per day)')).toBe('0 B/d')
    expect(screen.getByTestId('disk-forecast-summary').querySelector('[data-operational-metric="largest-table"]')).toBeNull()
    expect(screen.getByTestId('disk-forecast-summary').querySelector('[data-operational-metric="soonest-quota"]')).toBeNull()
    expect(screen.getByTestId('disk-forecast-summary').querySelectorAll('[data-value-state="value"]')).toHaveLength(4)
    const drawer = await openSummaryDrawer()
    expect(drawer).toHaveTextContent('2 empty fields are hidden.')
  })

  it('preserves full hypertable names in summary cards and detail views', async () => {
    mockedRequest.mockResolvedValueOnce(makeResponse())

    renderPage()

    await waitFor(() =>
      expect(summaryValue('Largest table')).toBe('3.00 GB'),
    )

    // Full identities moved from summary cards to the Review-details drawer.
    const drawer = await openSummaryDrawer()
    expect(within(drawer).getAllByText(LONG_NAME)).toHaveLength(2)
    expect(screen.getAllByText(LONG_NAME).length).toBeGreaterThan(2)
  })

  it('refetches when the header freshness control is activated', async () => {
    mockedRequest.mockResolvedValue(makeResponse())

    renderPage()

    await waitFor(() =>
      expect(summaryValue('Total disk')).toBe('4.50 GB'),
    )

    const refresh = screen.getByRole('button', { name: /refresh/i })
    const before = mockedRequest.mock.calls.length
    fireEvent.click(refresh)

    await waitFor(() =>
      expect(mockedRequest.mock.calls.length).toBeGreaterThan(before),
    )
  })

  it('retains complete disk, growth, quota and table evidence after a 503 refresh', async () => {
    mockedRequest.mockImplementation((path: string) =>
      path === '/admin/observability/disk-forecast'
        ? Promise.resolve(makeResponse())
        : Promise.resolve([]),
    )
    renderPage()
    await waitFor(() => expect(summaryValue('Total disk')).toBe('4.50 GB'))
    await waitFor(() => expect(screen.getAllByText(LONG_NAME).length).toBeGreaterThan(2))
    mockedRequest.mockImplementation((path: string) =>
      path === '/admin/observability/disk-forecast'
        ? Promise.reject(new ApiError('not configured', 503, 'SUBSYSTEM_NOT_CONFIGURED'))
        : Promise.resolve([]),
    )
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))
    await waitFor(() => expect(screen.getByText('Data may be stale')).toBeInTheDocument())

    expect(screen.getByText('Total disk')).toBeInTheDocument()
    expect(screen.getByText('Fastest-growing hypertables')).toBeInTheDocument()
    expect(screen.getAllByText(LONG_NAME).length).toBeGreaterThan(2)
    expect(screen.getByText('Quota pressure')).toBeInTheDocument()
    expect(screen.queryByText('Feature not supported')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Retry$/ })).not.toBeInTheDocument()
    expect(screen.getByTestId('disk-forecast-summary').closest('[data-retained]')).toHaveAttribute('data-retained', 'true')
  })

  it('reports a missing quota estimate without inferring configuration or suggesting an unsupported variable', async () => {
    mockedRequest.mockResolvedValueOnce(makeResponse([makeRow({
      hypertable_name: 'stable_table', growth_bytes_per_day: 0, est_days_to_quota: null,
    })]))
    renderPage()

    await waitFor(() => expect(summaryValue('Total disk')).toBe('1.00 GB'))
    expect(screen.getAllByText('No quota estimate available')).toHaveLength(1)
    expect(screen.getByText('An estimate may be absent when there is no measurable growth. Missing estimates do not establish whether a quota is configured.')).toBeInTheDocument()
    expect(screen.queryByText('No quota configured')).not.toBeInTheDocument()
    expect(screen.queryByText(/HYPERTABLE_QUOTA_BYTES/)).not.toBeInTheDocument()
    expect(screen.getByTestId('disk-forecast-summary').querySelector('[data-operational-metric="soonest-quota"]')).toBeNull()
    expect(within(screen.getByRole('table', { name: 'Hypertables' })).getByText('OK')).toBeInTheDocument()
    const drawer = await openSummaryDrawer()
    expect(drawer).toHaveTextContent('1 empty fields are hidden.')
  })

  it.each(['paused', 'unresolved'] as const)('keeps cold %s sections pending rather than authoritatively empty', (state) => {
    if (state === 'paused') onlineManager.setOnline(false)
    const client = new QueryClient({
      defaultOptions: { queries: { enabled: state !== 'unresolved', retry: false } },
    })
    renderPage(client)

    expect(screen.getByTestId('disk-forecast-summary')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Fastest-growing hypertables')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Growth and quota outlook' }))
      .getByRole('heading', { name: 'Days to quota' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Hypertables' })).toBeInTheDocument()
    expect(screen.queryByText('No hypertables')).not.toBeInTheDocument()
    expect(screen.queryByText('No hypertable sizes to chart yet.')).not.toBeInTheDocument()
    expect(screen.queryByText('No severity data available yet.')).not.toBeInTheDocument()
    expect(screen.queryByText('No measurable daily growth yet.')).not.toBeInTheDocument()
    expect(screen.queryByText('No quota estimate available')).not.toBeInTheDocument()
    expect(mockedRequest).not.toHaveBeenCalled()
    if (state === 'paused') {
      expect(screen.getByText('Refresh paused')).toBeInTheDocument()
      expect(screen.queryByText('Paused offline')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Retry unavailable sources' })).toBeEnabled()
    }
    client.clear()
  })

  it('keeps retained paused evidence and its retry until the source resumes', async () => {
    mockedRequest.mockImplementation((path: string) =>
      Promise.resolve(path === '/admin/observability/disk-forecast' ? makeResponse() : []),
    )
    renderPage()
    await waitFor(() => expect(summaryValue('Total disk')).toBe('4.50 GB'))
    act(() => onlineManager.setOnline(false))
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))
    await waitFor(() => expect(screen.getByText('Refresh paused')).toBeInTheDocument())
    expect(screen.queryByText('Paused offline')).not.toBeInTheDocument()

    expect(summaryValue('Soonest quota')).toBe('5.00 d')
    expect(screen.getByRole('table', { name: 'Hypertables' })).toBeInTheDocument()
    expect(screen.getAllByText(LONG_NAME).length).toBeGreaterThan(2)
    expect(screen.queryByText('No quota estimate available')).not.toBeInTheDocument()
    expect(screen.getByTestId('disk-forecast-summary').closest('[data-retained]')).toHaveAttribute('data-retained', 'true')
    const before = mockedRequest.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable sources' }))
    act(() => onlineManager.setOnline(true))
    await waitFor(() => expect(mockedRequest.mock.calls.length).toBeGreaterThan(before))
    await waitFor(() => expect(screen.queryByText('Refresh paused')).not.toBeInTheDocument())
    expect(summaryValue('Total disk')).toBe('4.50 GB')
  })

  it('compares before/after sizes independently when before compression exceeds current disk usage', async () => {
    mockedRequest.mockResolvedValueOnce(makeResponse([makeRow({
      hypertable_name: 'compressed_chunks', total_bytes: 10 * MB,
      uncompressed_bytes: 100 * MB, compressed_bytes: 10 * MB,
    })]))
    renderPage()
    await waitFor(() => expect(summaryValue('Total disk')).toBe('10.00 MB'))
    expect(summaryValue('Before compression')).toBe('100.00 MB')
    expect(summaryValue('After compression')).toBe('10.00 MB')
    expect(screen.queryByText(/% of total/)).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: /grouped bar chart comparing before and after compression sizes/i })).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'Before vs after compression — data table' })
    expect(within(table).getByRole('columnheader', { name: 'Before compression' })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'After compression' })).toBeInTheDocument()
    expect(within(table).getByText('100.00 MB')).toBeInTheDocument()
    expect(within(table).getByText('10.00 MB')).toBeInTheDocument()
  })

  it.each([
    ['ok', 'var(--semantic-success)'],
    ['warn', 'var(--semantic-warning)'],
    ['critical', 'var(--semantic-danger)'],
    ['unknown', 'var(--text-secondary)'],
  ] as const)('uses the supported solid fill for %s growth severity', async (severity, color) => {
    mockedRequest.mockResolvedValueOnce(makeResponse([makeRow({ severity })]))
    renderPage()
    const bar = await screen.findByRole('progressbar', { name: 'table' })
    const fill = bar.querySelector<HTMLElement>('[data-metric-fill]')
    expect(fill).not.toBeNull()
    expect(fill!.style.background).toBe(color)
    expect(fill!.style.background).not.toContain('linear-gradient')
    expect(bar).toHaveAttribute('aria-valuenow', String(10 * MB))
  })
})

describe('DiskForecastPage no-snapshot notice causality', () => {
  it('keeps a cold query-policy pause cause-neutral and preserves its real notice body and retry', async () => {
    onlineManager.setOnline(false)
    mockedRequest.mockImplementation((path: string) =>
      Promise.resolve(path === '/admin/observability/disk-forecast' ? makeResponse() : []),
    )
    const { container } = renderPage()

    const body = screen.getByText('No requested source has returned usable data yet.')
    const notice = body.closest('[data-data-state]')
    expect(notice).toHaveAttribute('data-data-state', 'unavailable')
    expect(notice).not.toHaveAttribute('data-unavailable-reason')
    expect(notice).toHaveTextContent('Refresh paused')
    expect(notice).not.toHaveTextContent('This feature is not enabled by the current deployment configuration.')
    expect(container.querySelector('[data-data-state="unsupported"]')).toBeNull()
    expect(screen.queryByText('No hypertables')).not.toBeInTheDocument()
    expect(screen.queryByText('No quota estimate available')).not.toBeInTheDocument()
    expect(screen.getByTestId('disk-forecast-summary')).toHaveAttribute('aria-busy', 'true')
    expect(mockedRequest).not.toHaveBeenCalled()

    fireEvent.click(within(notice as HTMLElement).getByRole('button', { name: 'Retry unavailable sources' }))
    act(() => onlineManager.setOnline(true))
    await waitFor(() => expect(summaryValue('Total disk')).toBe('4.50 GB'))
    expect(container.querySelector('[data-data-state="unavailable"]')).toBeNull()
    expect(container.querySelector('[data-data-state="unsupported"]')).toBeNull()
  })

  it.each(['fetching', 'idle'] as const)('does not assign a disabled-deployment notice to a cold pending %s query', async (fetchStatus) => {
    let resolveDisk: ((value: DiskForecastResponse) => void) | undefined
    mockedRequest.mockImplementation((path: string) =>
      path === '/admin/observability/disk-forecast'
        ? new Promise<DiskForecastResponse>((resolve) => { resolveDisk = resolve })
        : Promise.resolve([]),
    )
    const client = new QueryClient({
      defaultOptions: { queries: { enabled: fetchStatus !== 'idle', retry: false } },
    })
    const { container } = renderPage(client)

    expect(client.getQueryState(operatorConfidenceKeys.diskForecast)).toMatchObject({
      data: undefined, status: 'pending', fetchStatus,
    })
    expect(screen.getByTestId('disk-forecast-summary')).toHaveAttribute('aria-busy', 'true')
    expect(container.querySelector('[data-data-state]')).toBeNull()
    expect(screen.queryByText('This feature is not enabled by the current deployment configuration.')).not.toBeInTheDocument()
    expect(screen.queryByText('No requested source has returned usable data yet.')).not.toBeInTheDocument()
    expect(screen.queryByText('No hypertables')).not.toBeInTheDocument()
    expect(screen.queryByText('No quota estimate available')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Growth and quota outlook' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Hypertables' })).toBeInTheDocument()
    await act(async () => { resolveDisk?.(makeResponse([])) })
    client.clear()
  })

  it('keeps genuine unsupported guidance but makes all three unmeasured section bodies cause-neutral', async () => {
    mockedRequest.mockRejectedValue(new ApiError('not configured', 503, 'SUBSYSTEM_NOT_CONFIGURED'))
    const { container } = renderPage()

    const title = await screen.findByText('Feature not supported')
    const unsupported = title.closest('[data-data-state]')
    expect(unsupported).toHaveAttribute('data-data-state', 'unsupported')
    expect(unsupported).toHaveTextContent('TimescaleDB hypertable metrics are unavailable on this deployment. This page requires TimescaleDB to be installed and accessible.')
    expect(container.querySelectorAll('[data-data-state="unsupported"]')).toHaveLength(1)
    expect(screen.queryByText('This feature is not enabled by the current deployment configuration.')).not.toBeInTheDocument()

    const outlook = screen.getByRole('region', { name: 'Growth and quota outlook' })
    const tableSection = screen.getByRole('region', { name: 'Hypertables' })
    const unmeasured = [
      ...within(outlook).getAllByText('No requested source has returned usable data yet.'),
      within(tableSection).getByText('No requested source has returned usable data yet.'),
    ]
    expect(unmeasured).toHaveLength(3)
    for (const body of unmeasured) {
      expect(body.tagName).toBe('P')
      expect(body).toHaveClass('text-[var(--text-secondary)]')
      expect(body.closest('[data-data-state]')).toBeNull()
    }
    expect(screen.getByText('No metric values are available yet.')).toBeInTheDocument()
    const drawer = await openSummaryDrawer()
    expect(drawer).toHaveTextContent('6 empty fields are hidden.')
    expect(screen.queryByText('No hypertables')).not.toBeInTheDocument()
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument()
  })

  it('keeps a real refresh-error notice stale without replacing retained sections with disabled-deployment claims', async () => {
    mockedRequest.mockImplementation((path: string) =>
      Promise.resolve(path === '/admin/observability/disk-forecast' ? makeResponse() : []),
    )
    const { container } = renderPage()
    await waitFor(() => expect(summaryValue('Total disk')).toBe('4.50 GB'))
    mockedRequest.mockImplementation((path: string) =>
      path === '/admin/observability/disk-forecast'
        ? Promise.reject(new ApiError('refresh failed', 500, 'INTERNAL'))
        : Promise.resolve([]),
    )
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))
    const body = await screen.findByText('Previously loaded data remains visible while affected sources recover.')
    const notice = body.closest('[data-data-state]')
    expect(notice).toHaveAttribute('data-data-state', 'stale')
    expect(notice).toHaveTextContent('Cached · refresh failed')
    expect(within(notice as HTMLElement).getByRole('button', { name: 'Retry unavailable sources' })).toBeEnabled()
    expect(container.querySelector('[data-data-state="unsupported"]')).toBeNull()
    expect(screen.queryByText('This feature is not enabled by the current deployment configuration.')).not.toBeInTheDocument()
    expect(summaryValue('Total disk')).toBe('4.50 GB')
    expect(summaryValue('Soonest quota')).toBe('5.00 d')
    expect(screen.getByRole('table', { name: 'Hypertables' })).toBeInTheDocument()
    expect(screen.getByText('Quota pressure')).toBeInTheDocument()
    expect(screen.getByTestId('disk-forecast-summary').closest('[data-retained]')).toHaveAttribute('data-retained', 'true')
  })
})
