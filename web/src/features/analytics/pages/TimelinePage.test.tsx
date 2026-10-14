/**
 * TimelinePage contract tests.
 *
 * TimelinePage fans two TanStack Query hooks — GET /vehicle-states/timeline
 * (FSM transition events) and GET /vehicle-states/summary (per-state dwell +
 * transition counts) — plus the header-selected vehicle into a four-tile
 * KPI band, a proportional state-distribution bar, a daily-breakdown chart, a
 * per-state dwell panel, and a paginated transitions table. These tests drive
 * the page end-to-end (real hooks + real formatting boundary against a mocked
 * `request()`), covering every branch a user can reach:
 *
 *   1. Full render: title, KPI band, all four section panels, and the
 *      transitions table populated from the timeline payload.
 *   2. Duration formatting at the hour/minute boundary — the regression this
 *      elevation fixes: 7199s must render "2h" (never "1h 60m") and 3599s must
 *      render "1h" (never "60m").
 *   3. Empty payloads → every section shows its explicit EmptyState copy and
 *      the KPI band retains zero transition counts and unknown absent dwell.
 *   4. Both state queries pending → independent loading shells remain,
 *      without fabricated KPI measurements.
 *   5. A timeline fetch failure → section-specific error text and recovery,
 *      while the independent summary remains measured.
 *   6. The icon-only refresh control exposes an accessible name and refetches.
 *   7. Changing the header-selected vehicle re-scopes both state queries.
 *
 * Network is mocked at the `@/api/client` boundary (the repo convention — see
 * FleetComparePage.test.tsx / DiskForecastPage.test.tsx). `useSettings` /
 * `useTimezone` come from the global stubs in src/test-setup.ts; react-i18next
 * is stubbed locally so the English fallbacks render deterministically.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useSearchParams } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui'
import { containerPolicy } from '@/components/layout/layout-reference'
import { chartTokens } from '@/lib/tokens'
import { formatDateTime } from '@/lib/dateFormat'
import { setGlobalLocale } from '@/lib/numberFormat'

const timezoneFixture = vi.hoisted(() => ({ value: 'UTC' }))

vi.mock('@/lib/timezone', async () => {
  const actual = await vi.importActual<typeof import('@/lib/timezone')>('@/lib/timezone')
  return { ...actual, useTimezone: () => timezoneFixture.value }
})

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return {
    ...actual,
    request: vi.fn(),
  }
})

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
        const fallback = typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined
        const opts =
          typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
            ? (fallbackOrOpts as Record<string, unknown>)
            : (maybeOpts as Record<string, unknown> | undefined)
        const interpolate = (s: string) =>
          opts
            ? Object.keys(opts).reduce(
                (acc, k) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(opts[k])),
                s,
              )
            : s
        if (opts && typeof opts.defaultValue === 'string') return interpolate(opts.defaultValue)
        if (fallback != null) return interpolate(fallback)
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { request } from '@/api/client'
import { SelectedVehicleProvider } from '@/store/selectedVehicle'
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle'
import TimelinePage from './TimelinePage'
import type { Vehicle } from '@/types/vehicle'

const mockedRequest = vi.mocked(request)

/* ── Fixtures ─────────────────────────────────────────── */

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 1,
    vehicle_id: 1,
    vin: 'VIN0000000000001',
    display_name: 'Model 3 LR',
    model: 'Model 3',
    trim_badging: 'Long Range',
    exterior_color: 'DeepBlue',
    wheel_type: 'Aero19',
    state: 'online',
    healthy: true,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

interface ByStateRow {
  state: string
  total_seconds: number
  percentage: number
  transition_count: number
}

// Vehicle 1 dwell chosen so the KPI band exercises the boundary bug fix:
//   driving  7199s (1h59m59s) → "2h"  (never "1h 60m")
//   charging 3599s (59m59s)   → "1h"  (never "60m")
//   idle+sleep = online 1000 + asleep 500 = 1500s → "25m"
//   totalTransitions = 4 + 3 + 2 + 1 = 10
const summaryRowsV1: ByStateRow[] = [
  { state: 'driving', total_seconds: 7199, percentage: 58.5, transition_count: 4 },
  { state: 'charging', total_seconds: 3599, percentage: 29.3, transition_count: 3 },
  { state: 'online', total_seconds: 1000, percentage: 8.1, transition_count: 2 },
  { state: 'asleep', total_seconds: 500, percentage: 4.1, transition_count: 1 },
]

// Vehicle 2 has a deliberately distinct transition total (5 + 2 = 7) so a
// vehicle switch is observable purely from rendered output.
const summaryRowsV2: ByStateRow[] = [
  { state: 'driving', total_seconds: 3600, percentage: 66.7, transition_count: 5 },
  { state: 'charging', total_seconds: 1800, percentage: 33.3, transition_count: 2 },
]

function summaryFor(id: number) {
  const rows = id === 2 ? summaryRowsV2 : summaryRowsV1
  const total = rows.reduce((s, r) => s + r.total_seconds, 0)
  return { vehicle_id: id, days: 7, total_seconds: total, by_state: rows }
}

const transitions = [
  { ts: '2025-03-01T10:00:00Z', from_state: 'asleep', to_state: 'driving', trigger_field: 'shift_state', trigger_value: 'D' },
  { ts: '2025-03-01T11:00:00Z', from_state: 'driving', to_state: 'charging', trigger_field: 'charge_state', trigger_value: null },
  { ts: '2025-03-02T09:00:00Z', from_state: 'charging', to_state: 'online', trigger_field: null, trigger_value: null },
]

const never = () => new Promise<never>(() => {})
const idOf = (path: string) =>
  new URLSearchParams(path.split('?')[1] ?? '').get('vehicle_id')

interface InstallOptions {
  vehicles?: Vehicle[]
  timelinePending?: boolean
  summaryPending?: boolean
  timelineError?: boolean
  summaryError?: boolean
  emptyTimeline?: boolean
  emptySummary?: boolean
}

function install(opts: InstallOptions = {}) {
  const {
    vehicles = [
      makeVehicle(),
      makeVehicle({ id: 2, vehicle_id: 2, vin: 'VIN0000000000002', display_name: 'Model Y P', model: 'Model Y' }),
    ],
    timelinePending = false,
    summaryPending = false,
    timelineError = false,
    summaryError = false,
    emptyTimeline = false,
    emptySummary = false,
  } = opts

  mockedRequest.mockImplementation((path: string) => {
    if (path === '/vehicles') return Promise.resolve(vehicles)
    if (path.startsWith('/vehicle-states/timeline')) {
      if (timelinePending) return never()
      if (timelineError) return Promise.reject(new Error('timeline boom'))
      if (emptyTimeline) return Promise.resolve({ transitions: [] })
      return Promise.resolve({ transitions })
    }
    if (path.startsWith('/vehicle-states/summary')) {
      if (summaryPending) return never()
      if (summaryError) return Promise.reject(new Error('summary boom'))
      if (emptySummary) return Promise.resolve({ vehicle_id: 1, days: 7, total_seconds: 0, by_state: [] })
      return Promise.resolve(summaryFor(Number(idOf(path) ?? '1')))
    }
    return Promise.resolve({})
  })
}

function renderPage(path = '/timeline?from=2025-03-01&to=2025-03-02') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  })
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={client}>
        <SelectedVehicleProvider>
          <HeaderVehicleSwitch />
          <TimelinePage />
        </SelectedVehicleProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

function HeaderVehicleSwitch() {
  const { setVehicleId } = useSelectedVehicle()
  const [params, setParams] = useSearchParams()
  return <>
    <Button onClick={() => setVehicleId(2)}>Select Model Y in header</Button>
    <Button onClick={() => setVehicleId(1)}>Select Model 3 in header</Button>
    <Button onClick={() => {
      const next = new URLSearchParams(params)
      next.set('from', '2025-03-02')
      next.set('to', '2025-03-02')
      setParams(next)
    }}>Change window in header</Button>
  </>
}

beforeEach(() => {
  setGlobalLocale('en-US')
  onlineManager.setOnline(true)
  timezoneFixture.value = 'UTC'
  mockedRequest.mockReset()
  window.localStorage.clear()
  install()
})

afterEach(() => {
  setGlobalLocale('en-US')
  onlineManager.setOnline(true)
})

describe('TimelinePage', () => {
  it.each(['vehicle', 'window'] as const)('clears preview evidence and actions on a header %s change before the next source resolves', async scope => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect transition asleep to driving' }))
    const drawer = screen.getByRole('dialog', { name: 'asleep → driving' })
    expect(within(drawer).getByText('1h')).toBeInTheDocument()
    expect(within(drawer).getByRole('link', { name: 'Vehicle' })).toHaveAttribute('href', '/vehicles/1')

    install({ timelinePending: true, summaryPending: true })
    fireEvent.click(screen.getByRole('button', {
      name: scope === 'vehicle' ? 'Select Model Y in header' : 'Change window in header',
    }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('status', { name: 'Loading State transitions' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Telemetry evidence' })).toBeNull()
    if (scope === 'vehicle') {
      fireEvent.click(screen.getByRole('button', { name: 'Select Model 3 in header' }))
      await screen.findByRole('table', { name: 'State transitions' })
      expect(screen.queryByRole('dialog')).toBeNull()
    }
  })

  it.each(['vehicle', 'window'] as const)('clears the shared mobile quick view when the header %s changes', async scope => {
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 0, 375, 44))
    try {
      renderPage()
      const inspect = await screen.findByRole('button', { name: 'Inspect transition asleep to driving' })
      const mobile = inspect.closest('[data-mobile-table]')!
      fireEvent.click(within(mobile).getAllByRole('button', { name: 'Quick view' })[0])
      expect(screen.getByRole('dialog')).toHaveTextContent('shift_state')
      fireEvent.click(screen.getByRole('button', {
        name: scope === 'vehicle' ? 'Select Model Y in header' : 'Change window in header',
      }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    } finally {
      bounds.mockRestore()
    }
  })

  it('resets the summary evidence drawer instead of rebinding an open review to another vehicle', async () => {
    renderPage()
    await screen.findByText('10', {}, { timeout: 8000 })
    fireEvent.click(within(screen.getByTestId('timeline-summary')).getByRole('button', { name: 'Review details' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('Operational metrics')
    fireEvent.click(screen.getByRole('button', { name: 'Select Model Y in header' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await within(screen.getByTestId('timeline-summary')).findByText('7')).toBeInTheDocument()
  })

  it('keeps paused first loads distinct from successful empty or zero evidence and recovers', async () => {
    onlineManager.setOnline(false)
    install({ emptyTimeline: true, emptySummary: true })
    renderPage()
    expect(await screen.findByText('State transitions is paused while the connection is unavailable')).toBeInTheDocument()
    expect(screen.queryByText('No state transitions recorded')).toBeNull()
    expect(screen.queryByText('No daily transition activity yet')).toBeNull()
    const brief = screen.getByTestId('timeline-summary')
    expect(within(brief).queryByText('0', { exact: true })).toBeNull()
    expect(within(brief).queryByText('0m')).toBeNull()
    expect(screen.getByRole('button', { name: 'Refresh timeline' })).toBeDisabled()
    await act(async () => onlineManager.setOnline(true))
    expect(await screen.findByText('No state transitions recorded')).toBeInTheDocument()
    expect(screen.getByText('No daily transition activity yet')).toBeInTheDocument()
    expect(within(brief).getByText('0', { exact: true })).toBeInTheDocument()
    expect(brief.querySelectorAll('[data-value-state="missing"]')).toHaveLength(3)
  })

  it('preserves originating preview evidence through same-scope refresh failure and recovery', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect transition asleep to driving' }))
    install({ timelineError: true })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh timeline' }))
    expect(await screen.findByText(/Showing retained State transitions after a refresh failed/)).toHaveTextContent('timeline boom')
    const drawer = screen.getByRole('dialog', { name: 'asleep → driving' })
    expect(within(drawer).getByText('1h')).toBeInTheDocument()
    expect(within(drawer).getByText('D')).toBeInTheDocument()
    expect(within(drawer).getByRole('link', { name: 'Vehicle' })).toHaveAttribute('href', '/vehicles/1')
    install()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh timeline' }))
    await waitFor(() => expect(screen.queryByText(/Showing retained State transitions after a refresh failed/)).toBeNull())
    expect(screen.getByRole('dialog', { name: 'asleep → driving' })).toHaveTextContent('shift_state')
    expect(screen.getByRole('table', { name: 'State transitions' })).toHaveTextContent('shift_state')
  })

  it('preserves bounded mobile durations, complete quick-view fields, and keyboard inspection', async () => {
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 0, 375, 44))
    try {
      const user = userEvent.setup()
      renderPage()
      const inspect = await screen.findByRole('button', { name: 'Inspect transition asleep to driving' })
      const mobile = inspect.closest('[data-mobile-table]')!
      expect(mobile).not.toBeNull()
      expect(within(mobile).getByText('1h')).toBeInTheDocument()
      expect(inspect).toHaveClass('min-h-11')
      inspect.focus()
      await user.keyboard('{Enter}')
      const drawer = screen.getByRole('dialog', { name: 'asleep → driving' })
      expect(within(drawer).getByText('1h')).toBeInTheDocument()
      expect(within(drawer).getByText('shift_state')).toBeInTheDocument()
      expect(within(drawer).getByText('D')).toBeInTheDocument()
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'asleep → driving' })).toBeNull())

      fireEvent.click(within(mobile).getAllByRole('button', { name: 'Quick view' })[0])
      const quickView = screen.getByRole('dialog')
      for (const field of ['Time', 'From state', 'To state', 'Duration', 'Trigger', 'Trigger value']) {
        expect(within(quickView).getByText(field, { exact: true })).toBeInTheDocument()
      }
      expect(within(quickView).getByText('1h')).toBeInTheDocument()
      expect(within(quickView).getByText('D')).toBeInTheDocument()
    } finally {
      bounds.mockRestore()
    }
  })

  it('leaves the last historical duration unknown in the table and preview', async () => {
    renderPage()
    const inspect = await screen.findByRole('button', { name: 'Inspect transition charging to online' })
    const row = inspect.closest('tr')!
    expect(within(row).getAllByRole('cell')[3]).toHaveTextContent('—')
    fireEvent.click(inspect)
    const drawer = screen.getByRole('dialog', { name: 'charging → online' })
    expect(within(drawer).getByText('Duration').closest('dt')!.parentElement).toHaveTextContent('—')
    expect(within(drawer).getByText('Trigger value')).toBeInTheDocument()
  })

  it('clips successor evidence to both requested bounds and preserves minute rounding', async () => {
    mockedRequest.mockImplementation((path: string) => {
      if (path === '/vehicles') return Promise.resolve([makeVehicle()])
      if (path.startsWith('/vehicle-states/summary')) return Promise.resolve(summaryFor(1))
      if (path.startsWith('/vehicle-states/timeline')) return Promise.resolve({
        transitions: [
          { ...transitions[0], ts: '2025-02-28T23:00:00Z' },
          { ...transitions[1], ts: '2025-03-01T00:59:59Z' },
          { ...transitions[2], ts: '2025-03-02T01:00:00Z' },
        ],
      })
      return Promise.resolve({})
    })
    renderPage('/timeline?from=2025-03-01&to=2025-03-01')
    const firstInspect = await screen.findByRole('button', { name: 'Inspect transition asleep to driving' })
    expect(within(firstInspect.closest('tr')!).getAllByRole('cell')[3]).toHaveTextContent('1h')
    const secondInspect = screen.getByRole('button', { name: 'Inspect transition driving to charging' })
    expect(within(secondInspect.closest('tr')!).getAllByRole('cell')[3]).toHaveTextContent('23h')
    fireEvent.click(secondInspect)
    expect(within(screen.getByRole('dialog', { name: 'driving → charging' })).getByText('23h')).toBeInTheDocument()
  })

  it('does not infer duration for invalid, simultaneous, or out-of-window intervals', async () => {
    mockedRequest.mockImplementation((path: string) => {
      if (path === '/vehicles') return Promise.resolve([makeVehicle()])
      if (path.startsWith('/vehicle-states/summary')) return Promise.resolve(summaryFor(1))
      if (path.startsWith('/vehicle-states/timeline')) return Promise.resolve({
        transitions: [
          { ...transitions[0], ts: '2025-02-28T10:00:00Z' },
          { ...transitions[1], ts: '2025-02-28T11:00:00Z' },
          { ...transitions[2], ts: '2025-02-28T11:00:00Z' },
          { ...transitions[0], ts: 'invalid' },
        ],
      })
      return Promise.resolve({})
    })
    renderPage()
    const table = await screen.findByRole('table', { name: 'State transitions' })
    await within(table).findAllByText('shift_state')
    for (const row of within(table).getAllByRole('row').slice(1)) {
      expect(within(row).getAllByRole('cell')[3]).toHaveTextContent('—')
    }
  })

  it('reviews original dwell rounding and source bounds in the real evidence drawer', async () => {
    renderPage()
    await screen.findByText('10', {}, { timeout: 8000 })
    const brief = screen.getByTestId('timeline-summary')
    expect(brief).toHaveAttribute('data-operational-brief')
    expect(brief.querySelectorAll('[data-value-state="value"]')).toHaveLength(4)
    expect(within(brief).getByText('2h')).toBeInTheDocument()
    expect(within(brief).getByText('1h')).toBeInTheDocument()
    expect(within(brief).getByText('25m')).toBeInTheDocument()
    const calls = mockedRequest.mock.calls.length
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }))
    const drawer = await screen.findByRole('dialog')
    expect(within(drawer).getByText('Operational metrics')).toBeInTheDocument()
    expect(within(drawer).getByText('Time in the driving state, rounded to whole minutes')).toBeInTheDocument()
    expect(within(drawer).getByText(/continuous observation coverage is unknown/, { selector: `[id="${drawer.getAttribute('aria-describedby')}"]` })).toBeInTheDocument()
    expect(mockedRequest.mock.calls.length).toBe(calls)
  })

  it('filters loaded transitions without recomputing dwell from the remaining rows', async () => {
    renderPage()
    await screen.findByText('10', {}, { timeout: 8000 })
    const filterButton = screen.getByRole('button', { name: 'To state filter' })
    const table = screen.getByRole('table', { name: 'State transitions' })
    const firstRow = (await within(table).findByText('asleep')).closest('tr')!
    expect(within(firstRow).getByText('1h')).toBeInTheDocument()

    fireEvent.click(filterButton)
    const filter = screen.getByRole('dialog', { name: 'To state filter' })
    fireEvent.click(within(filter).getByRole('checkbox', { name: 'charging' }))
    fireEvent.click(within(filter).getByRole('button', { name: 'Done' }))

    expect(within(table).getAllByRole('row')).toHaveLength(3)
    const filteredFirstRow = within(table).getByText('asleep').closest('tr')!
    expect(within(filteredFirstRow).getByText('1h')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Summary metrics' })).toHaveTextContent('10')
    })

    fireEvent.click(filterButton)
    const reopened = screen.getByRole('dialog', { name: 'To state filter' })
    expect(within(reopened).getByRole('checkbox', { name: 'charging' })).not.toBeChecked()
    fireEvent.click(within(reopened).getByRole('button', { name: 'Clear' }))
    fireEvent.click(within(reopened).getByRole('button', { name: 'Done' }))
    expect(within(table).getAllByRole('row')).toHaveLength(4)
  })

  it('renders the KPI band, every section panel, and the transitions table', async () => {
    renderPage()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Timeline' }),
    ).toBeInTheDocument()

    // Wait for the summary to settle — Total Transitions = sum of the per-state
    // transition counts (4 + 3 + 2 + 1 = 10).
    expect(await screen.findByText('10', {}, { timeout: 8000 })).toBeInTheDocument()
    const kpiBand = screen.getByRole('region', { name: 'Summary metrics' })
    expect(within(kpiBand).getByText('Total transitions')).toBeInTheDocument()
    expect(within(kpiBand).getByText('Total transitions')).toBeInTheDocument()

    // All four section panels render their titles (never hidden).
    for (const name of ['State distribution', 'Daily breakdown', 'Time by state', 'State transitions']) {
      expect(screen.getAllByRole('heading', { name }).length).toBeGreaterThan(0)
    }

    // The real shared card applies its container-band height policy. Keep
    // bounded desktop/mobile CSS heights, rather than testing mock-only
    // attributes or the old page-owned dimensions.
    const dailyChart = screen.getByRole('group', {
      name: 'Daily transition counts by vehicle state',
    })
    const figure = dailyChart.closest('figure')!
    const grid = figure.closest('[data-card-grid]')!
    expect(grid).toHaveAttribute('data-container-band', 'phone')
    expect(dailyChart).toHaveStyle({
      '--chart-height-desktop': `${containerPolicy(0).chartHeight}px`,
      '--chart-height-mobile': `${containerPolicy(0).chartHeight}px`,
    })
    expect(figure).not.toHaveAttribute('data-chart-fluid')
    expect(within(figure).getByRole('table')).toHaveTextContent('2025-03-01')
    expect(within(figure).getByRole('table')).toHaveTextContent('2025-03-02')

    // With data present, sections are NOT showing their empty copy.
    expect(screen.queryByText('No daily transition activity yet')).toBeNull()
    expect(screen.queryByText('No state transitions recorded')).toBeNull()

    // Transitions table: one row per event, with trigger fields + state badges.
    const table = screen.getByRole('table', { name: 'State transitions' })
    expect(within(table).getByText('shift_state')).toBeInTheDocument()
    expect(within(table).getByText('charge_state')).toBeInTheDocument()
    // 'driving' surfaces as row1 to_state AND row2 from_state.
    expect(within(table).getAllByText('driving').length).toBe(2)
  })

  it('formats dwell durations without rolling over to "60m" / "1h 60m"', async () => {
    renderPage()

    // Settle the summary (Total Transitions = 10), then read the KPI band fresh.
    await screen.findByText('10', {}, { timeout: 8000 })
    const kpiBand = screen.getByRole('region', { name: 'Summary metrics' })

    // 7199s → "2h", 3599s → "1h", 1500s → "25m".
    expect(within(kpiBand).getByText('2h')).toBeInTheDocument()
    expect(within(kpiBand).getByText('1h')).toBeInTheDocument()
    expect(within(kpiBand).getByText('25m')).toBeInTheDocument()

    // The regression guard: neither overflow string is ever emitted.
    expect(within(kpiBand).queryByText('1h 60m')).toBeNull()
    expect(within(kpiBand).queryByText('60m')).toBeNull()
  })

  it('updates populated dwell, transitions and preview durations with the effective numeric locale', async () => {
    renderPage()
    await screen.findByText('10', {}, { timeout: 8000 })
    fireEvent.click(screen.getByRole('button', { name: 'Inspect transition asleep to driving' }))
    const requestCount = mockedRequest.mock.calls.length

    act(() => setGlobalLocale('ar-EG'))

    const kpiBand = screen.getByRole('region', { name: 'Summary metrics' })
    expect(within(kpiBand).getByText('٢h')).toBeInTheDocument()
    expect(within(kpiBand).getByText('١h')).toBeInTheDocument()
    expect(within(kpiBand).getByText('٢٥m')).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'State transitions' })
    expect(within(table).getByText('١h')).toBeInTheDocument()
    expect(within(table).getByText('٢٢h')).toBeInTheDocument()
    expect(within(screen.getByRole('dialog', { name: 'asleep → driving' })).getByText('١h')).toBeInTheDocument()
    expect(screen.getByText(/^٢h ·/)).toBeInTheDocument()
    expect(screen.getByText(/^١٧m ·/)).toBeInTheDocument()
    expect(mockedRequest.mock.calls).toHaveLength(requestCount)
  })

  it.each([
    { seconds: 0.49, duration: '٠s', dwell: '٠m' },
    { seconds: 59.49, duration: '٥٩s', dwell: '١m' },
    { seconds: 59.5, duration: '١m', dwell: '١m' },
    { seconds: 3599, duration: '١h', dwell: '١h' },
    { seconds: 7199, duration: '٢h', dwell: '٢h' },
    { seconds: 3690, duration: '١h ٢m', dwell: '١h ٢m' },
  ])('preserves seconds thresholds and once-only rounding for $seconds seconds in the effective locale', async ({ seconds, duration, dwell }) => {
    setGlobalLocale('ar-EG')
    mockedRequest.mockImplementation((path: string) => {
      if (path === '/vehicles') return Promise.resolve([makeVehicle()])
      if (path.startsWith('/vehicle-states/summary')) return Promise.resolve({
        total_seconds: seconds,
        by_state: [{ state: 'driving', total_seconds: seconds, percentage: 100, transition_count: 1 }],
      })
      if (path.startsWith('/vehicle-states/timeline')) return Promise.resolve({
        transitions: [
          transitions[0],
          { ...transitions[1], ts: new Date(new Date(transitions[0].ts).getTime() + seconds * 1000).toISOString() },
        ],
      })
      return Promise.resolve({})
    })
    renderPage()
    const inspect = await screen.findByRole('button', { name: 'Inspect transition asleep to driving' })
    expect(within(inspect.closest('tr')!).getAllByRole('cell')[3]).toHaveTextContent(duration)
    expect(within(screen.getByRole('region', { name: 'Summary metrics' })).getByText(dwell)).toBeInTheDocument()
    expect(screen.getByText(text => text.startsWith(`${duration} ·`))).toBeInTheDocument()
    fireEvent.click(inspect)
    expect(within(screen.getByRole('dialog', { name: 'asleep → driving' })).getByText(duration)).toBeInTheDocument()
  })

  it('degrades every section to an explicit empty state when there is no activity', async () => {
    install({ emptyTimeline: true, emptySummary: true })
    renderPage()

    // Table + daily-breakdown empty copy.
    expect(await screen.findByText('No state transitions recorded')).toBeInTheDocument()
    expect(screen.getByText('No daily transition activity yet')).toBeInTheDocument()
    // Shared copy used by BOTH the distribution bar and the time-by-state panel.
    expect(screen.getAllByText('No state distribution available yet').length).toBe(2)

    // An authoritative empty count is zero; absent dwell is not measured zero.
    const kpiBand = screen.getByRole('region', { name: 'Summary metrics' })
    expect(within(kpiBand).getByText('Total transitions')).toBeInTheDocument()
    expect(within(kpiBand).getByText('0', { exact: true })).toBeInTheDocument()
    expect(kpiBand.querySelectorAll('[data-value-state="missing"]')).toHaveLength(3)
    expect(within(kpiBand).queryByText('0m')).toBeNull()
  })

  it.each([
    { name: 'missing', value: undefined, state: 'missing', text: null },
    { name: 'null', value: null, state: 'missing', text: null },
    { name: 'NaN', value: NaN, state: 'invalid', text: null },
    { name: 'infinity', value: Infinity, state: 'invalid', text: null },
    { name: 'numeric string', value: '0', state: 'invalid', text: null },
    { name: 'measured zero', value: 0, state: 'value', text: '0m' },
    { name: 'signed duration', value: -90.5, state: 'value', text: '-2m' },
    { name: 'fractional duration', value: 90.5, state: 'value', text: '2m' },
  ])('distinguishes $name dwell from fabricated zero across all dwell metrics', async ({ value, state, text }) => {
    mockedRequest.mockImplementation((path: string) => {
      if (path === '/vehicles') return Promise.resolve([makeVehicle()])
      if (path.startsWith('/vehicle-states/timeline')) return Promise.resolve({ transitions: [] })
      if (path.startsWith('/vehicle-states/summary')) return Promise.resolve({
        total_seconds: 0,
        by_state: ['driving', 'charging', 'online'].map(state => ({
          state, total_seconds: value, percentage: 0, transition_count: 0,
        })),
      })
      return Promise.resolve({})
    })
    renderPage()
    await screen.findByText('No state transitions recorded')
    const brief = screen.getByTestId('timeline-summary')
    await waitFor(() => expect(brief.querySelectorAll(`[data-value-state="${state}"]`))
      .toHaveLength(state === 'value' ? 4 : 3))
    expect(within(brief).getByText('0', { exact: true })).toBeInTheDocument()
    if (text) expect(within(brief).getAllByText(text)).toHaveLength(3)
    else expect(within(brief).queryByText('0m')).toBeNull()
    expect(screen.getAllByText('No state distribution available yet')).toHaveLength(
      typeof value === 'number' && value > 0 ? 1 : 2,
    )
  })

  it('keeps composition and transition-list emptiness independent', async () => {
    install({ emptySummary: true })
    renderPage()
    await screen.findByRole('table', { name: 'State transitions' })
    expect(screen.getAllByText('No state distribution available yet')).toHaveLength(2)
    expect(screen.queryByText('No state transitions recorded')).toBeNull()
    const brief = screen.getByTestId('timeline-summary')
    expect(brief.querySelectorAll('[data-value-state="missing"]')).toHaveLength(3)
  })

  it('retains explicit zero for one state without inventing dwell for absent states', async () => {
    mockedRequest.mockImplementation((path: string) => {
      if (path === '/vehicles') return Promise.resolve([makeVehicle()])
      if (path.startsWith('/vehicle-states/timeline')) return Promise.resolve({ transitions: [] })
      if (path.startsWith('/vehicle-states/summary')) return Promise.resolve({
        total_seconds: 0,
        by_state: [{ state: 'online', total_seconds: 0, percentage: 0, transition_count: 0 }],
      })
      return Promise.resolve({})
    })
    renderPage()
    await screen.findByText('No state transitions recorded')
    const brief = screen.getByTestId('timeline-summary')
    expect(brief.querySelectorAll('[data-value-state="missing"]')).toHaveLength(2)
    expect(brief.querySelectorAll('[data-value-state="value"]')).toHaveLength(2)
    expect(within(brief).getByText('0m')).toBeInTheDocument()
  })

  it.each([
    { value: null, state: 'missing' },
    { value: '0', state: 'invalid' },
    { value: NaN, state: 'invalid' },
  ])('does not hide a $state operand inside combined idle / sleep dwell', async ({ value, state }) => {
    mockedRequest.mockImplementation((path: string) => {
      if (path === '/vehicles') return Promise.resolve([makeVehicle()])
      if (path.startsWith('/vehicle-states/timeline')) return Promise.resolve({ transitions: [] })
      if (path.startsWith('/vehicle-states/summary')) return Promise.resolve({
        total_seconds: 60,
        by_state: [
          { state: 'online', total_seconds: 60, percentage: 100, transition_count: 1 },
          { state: 'asleep', total_seconds: value, percentage: 0, transition_count: 0 },
        ],
      })
      return Promise.resolve({})
    })
    renderPage()
    await screen.findByText('No state transitions recorded')
    const brief = screen.getByTestId('timeline-summary')
    expect(brief.querySelectorAll(`[data-value-state="${state}"]`))
      .toHaveLength(state === 'missing' ? 3 : 1)
    expect(within(brief).queryByText('1m')).toBeNull()
  })

  it('shows the page-level loading shell while both state queries are pending', async () => {
    install({ timelinePending: true, summaryPending: true })
    renderPage()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Timeline' }),
    ).toBeInTheDocument()

    // Modernization keeps each independent source shell, with no measured
    // values while pending. The summary label is not itself a measurement.
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Loading State transitions' })).toBeInTheDocument(),
    )
    expect(screen.getByRole('status', { name: 'Loading State distribution' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Loading Time by state' })).toBeInTheDocument()
    const summary = screen.getByRole('region', { name: 'Summary metrics' })
    expect(summary).toHaveAttribute('aria-busy', 'true')
    expect(summary.querySelectorAll('[data-operational-value]')).toHaveLength(0)
    expect(within(summary).queryByText('10')).toBeNull()
    expect(within(summary).queryByText('2h')).toBeNull()
    expect(screen.getAllByRole('heading', { name: 'Daily breakdown' }).length).toBeGreaterThan(0)
  })

  it('surfaces an AlertBanner when the timeline query fails', async () => {
    install({ timelineError: true })
    renderPage()

    // Failure is scoped to timeline-fed panels, not the healthy summary.
    expect(
      await screen.findByText('Unable to load State transitions: timeline boom'),
    ).toBeInTheDocument()

    // The banner does not replace the page — the shell + KPI band still render.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Timeline' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'Summary metrics' }),
    ).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Summary metrics' })).getByText('10')).toBeInTheDocument()
    const before = mockedRequest.mock.calls.filter(([path]) => path.startsWith('/vehicle-states/timeline')).length
    install()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh timeline' }))
    await waitFor(() => expect(mockedRequest.mock.calls.filter(([path]) => path.startsWith('/vehicle-states/timeline')).length).toBeGreaterThan(before))
    expect(await screen.findByRole('table', { name: 'State transitions' })).toHaveTextContent('shift_state')
  })

  it('refetches through the accessible icon-only refresh control', async () => {
    renderPage()

    // Settle the initial load before interacting.
    await screen.findByText('10', {}, { timeout: 8000 })

    // The icon-only button carries a distinct accessible name (the a11y fix);
    // it must not collide with the DataFreshness "Refresh" control.
    const refresh = screen.getByRole('button', { name: 'Refresh timeline' })
    expect(refresh).toBeInTheDocument()

    const before = mockedRequest.mock.calls.length
    fireEvent.click(refresh)

    await waitFor(() =>
      expect(mockedRequest.mock.calls.length).toBeGreaterThan(before),
    )
  })

  it('re-scopes the queries when the header vehicle changes', async () => {
    renderPage()

    // Vehicle 1 is auto-selected → 10 transitions in the KPI band.
    await screen.findByText('10', {}, { timeout: 8000 })

    fireEvent.click(screen.getByRole('button', { name: 'Select Model Y in header' }))

    // Vehicle 2's distinct total (7) proves the queries re-scoped to it.
    expect(await screen.findByText('7', {}, { timeout: 8000 })).toBeInTheDocument()
    const kpiBand = screen.getByRole('region', { name: 'Summary metrics' })
    expect(within(kpiBand).getByText('7')).toBeInTheDocument()
    expect(within(kpiBand).queryByText('10')).toBeNull()
  })

  it('opens state-transition evidence without leaving the timeline', async () => {
    renderPage()

    const inspect = await screen.findByRole('button', {
      name: 'Inspect transition asleep to driving',
    })
    fireEvent.click(inspect)

    const drawer = screen.getByRole('dialog', { name: 'asleep → driving' })
    expect(within(drawer).getByText('State transition')).toBeInTheDocument()
    expect(within(drawer).getByText('shift_state')).toBeInTheDocument()
    expect(within(drawer).getByText('D')).toBeInTheDocument()
    expect(within(drawer).getByRole('link', { name: 'Vehicle' }))
      .toHaveAttribute('href', '/vehicles/1')
    expect(within(drawer).getByRole('link', { name: 'Telemetry evidence' }))
      .toHaveAttribute(
        'href',
        '/signals?from=2025-03-01&to=2025-03-01&signals=shift_state',
      )

    fireEvent.click(within(drawer).getByText('Close'))
    expect(screen.queryByRole('dialog', { name: 'asleep → driving' })).toBeNull()
  })

  it('loads All time / wide ranges via start/end instead of a days cap', async () => {
    renderPage('/timeline?from=2015-01-01&to=2026-09-15')

    expect(screen.queryByText(/days exceeds maximum/i)).toBeNull()
    expect(
      screen.queryByText(/State history is limited to the last 90 days/i),
    ).toBeNull()

    await waitFor(() => {
      const timelineCalls = mockedRequest.mock.calls
        .map((c) => String(c[0]))
        .filter((p) => p.startsWith('/vehicle-states/timeline'))
      const summaryCalls = mockedRequest.mock.calls
        .map((c) => String(c[0]))
        .filter((p) => p.startsWith('/vehicle-states/summary'))
      expect(timelineCalls.length).toBeGreaterThan(0)
      expect(summaryCalls.length).toBeGreaterThan(0)
      expect(timelineCalls.every((p) => p.includes('start=') && p.includes('end='))).toBe(true)
      expect(summaryCalls.every((p) => p.includes('start=') && p.includes('end='))).toBe(true)
      expect(timelineCalls.every((p) => !p.includes('days='))).toBe(true)
      expect(timelineCalls.some((p) => decodeURIComponent(p).includes('2015-01-01'))).toBe(true)
    })
  })

  it('recovers the summary source independently without refetching the timeline', async () => {
    install({ summaryError: true })
    renderPage()
    expect(await screen.findByText('Unable to load Summary metrics: summary boom')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'State transitions' })).toHaveTextContent('shift_state')
    const brief = screen.getByTestId('timeline-summary')
    expect(within(brief).queryByText('10')).toBeNull()
    expect(within(brief).queryByText('0m')).toBeNull()
    const timelineCalls = mockedRequest.mock.calls.filter(([path]) => path.startsWith('/vehicle-states/timeline')).length
    const summaryCalls = mockedRequest.mock.calls.filter(([path]) => path.startsWith('/vehicle-states/summary')).length
    install()
    fireEvent.click(screen.getByRole('button', { name: /Refresh data.*Source: Summary metrics/ }))
    expect(await within(brief).findByText('10')).toBeInTheDocument()
    expect(mockedRequest.mock.calls.filter(([path]) => path.startsWith('/vehicle-states/timeline'))).toHaveLength(timelineCalls)
    expect(mockedRequest.mock.calls.filter(([path]) => path.startsWith('/vehicle-states/summary'))).toHaveLength(summaryCalls + 1)
    expect(screen.queryByText('Unable to load Summary metrics: summary boom')).toBeNull()
  })

  it('retains summary measurements and independent transitions after a summary refresh fails', async () => {
    renderPage()
    await screen.findByText('10', {}, { timeout: 8000 })
    install({ summaryError: true })
    fireEvent.click(screen.getByRole('button', { name: /Refresh data.*Source: Summary metrics/ }))
    expect(await screen.findByText(/Showing retained Summary metrics after a refresh failed/)).toHaveTextContent('summary boom')
    const brief = screen.getByTestId('timeline-summary')
    expect(within(brief).getByText('10')).toBeInTheDocument()
    expect(within(brief).getByText('2h')).toBeInTheDocument()
    expect(within(brief).getByText('1h')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'State transitions' })).toHaveTextContent('shift_state')
    expect(screen.queryByText('No state distribution available yet')).toBeNull()
    expect(screen.getAllByRole('progressbar')).toHaveLength(4)
  })

  it('uses restrained solid dwell colors while preserving all eight state identities', async () => {
    renderPage()
    await screen.findByText('10', {}, { timeout: 8000 })
    const distribution = screen.getByRole('group', { name: 'State distribution' })
    for (const state of ['driving', 'charging', 'idle', 'sleeping', 'online', 'offline', 'parked', 'asleep']) {
      expect(within(distribution).getAllByText(state).length).toBeGreaterThan(0)
    }
    const driving = screen.getByRole('progressbar', { name: 'Driving' })
    const fill = driving.querySelector<HTMLElement>('[data-metric-fill]')!
    expect(fill).toHaveStyle({ background: chartTokens.series[1] })
    expect(fill.style.background).not.toContain('gradient')
    expect(driving).toHaveAttribute('aria-valuenow', '7199')
    expect(driving).toHaveTextContent('2h')
  })

  it('retains daily series grouping and exposes unclassified transitions without claiming measured sleep', async () => {
    const states = ['driving', 'charging', 'idle', 'online', 'parked', 'sleeping', 'asleep', 'offline', 'service', 'unknown']
    mockedRequest.mockImplementation((path: string) => {
      if (path === '/vehicles') return Promise.resolve([makeVehicle()])
      if (path.startsWith('/vehicle-states/summary')) return Promise.resolve(summaryFor(1))
      if (path.startsWith('/vehicle-states/timeline')) return Promise.resolve({
        transitions: states.map((state, index) => ({
          ts: `2025-03-01T10:${String(index).padStart(2, '0')}:00Z`,
          from_state: index === 0 ? null : states[index - 1],
          to_state: state,
          trigger_field: 'state',
          trigger_value: state,
        })),
      })
      return Promise.resolve({})
    })
    renderPage()
    await screen.findByRole('button', { name: 'Inspect transition asleep to offline' })
    const chart = await screen.findByRole('group', { name: 'Daily transition counts by vehicle state' })
    const figure = chart.closest('figure')!
    const dailyTable = within(figure).getByRole('table')
    expect(within(dailyTable).getAllByRole('columnheader').map(cell => cell.textContent))
      .toEqual(['Day', 'Driving', 'Charging', 'Idle', 'Sleeping', 'Unclassified'])
    const dataRow = within(dailyTable).getAllByRole('row')[1]
    expect(within(dataRow).getAllByRole('cell').map(cell => cell.textContent))
      .toEqual(['2025-03-01', '1', '1', '3', '3', '2'])
    expect(screen.getByText(/Sleeping groups sleeping, asleep and offline transitions/))
      .toHaveTextContent('this grouping does not establish measured sleep')
    const table = screen.getByRole('table', { name: 'State transitions' })
    for (const state of states) {
      expect(within(table).getAllByText(state).length).toBeGreaterThan(0)
    }
    fireEvent.click(screen.getByRole('button', { name: 'Inspect transition asleep to offline' }))
    const drawer = screen.getByRole('dialog', { name: 'asleep → offline' })
    expect(within(drawer).getAllByText('offline').length).toBeGreaterThan(0)
    expect(within(screen.getByTestId('timeline-summary')).getByText('25m')).toBeInTheDocument()
  })

  it('uses the vehicle day for preview navigation without changing UTC daily buckets', async () => {
    timezoneFixture.value = 'America/Los_Angeles'
    install()
    mockedRequest.mockImplementation((path: string) => {
      if (path === '/vehicles') return Promise.resolve([makeVehicle()])
      if (path.startsWith('/vehicle-states/summary')) return Promise.resolve(summaryFor(1))
      if (path.startsWith('/vehicle-states/timeline')) return Promise.resolve({
        transitions: [
          { ts: '2025-03-09T07:30:00Z', from_state: 'offline', to_state: 'driving', trigger_field: 'shift_state', trigger_value: 'D' },
          { ts: '2025-03-09T10:30:00Z', from_state: 'driving', to_state: 'charging', trigger_field: null, trigger_value: null },
        ],
      })
      return Promise.resolve({})
    })
    renderPage('/timeline?from=2025-03-08&to=2025-03-09')
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect transition offline to driving' }))
    const drawer = screen.getByRole('dialog', { name: 'offline → driving' })
    expect(within(drawer).getByRole('link', { name: 'Drive history' })).toHaveAttribute('href', '/drives?from=2025-03-08&to=2025-03-08')
    expect(within(drawer).getByRole('link', { name: 'Telemetry evidence' })).toHaveAttribute('href', '/signals?from=2025-03-08&to=2025-03-08&signals=shift_state')
    expect(within(drawer).getByText(`Recorded ${formatDateTime('2025-03-09T07:30:00Z', { tz: 'America/Los_Angeles' })}`)).toBeInTheDocument()
    expect(within(drawer).getByText('3h')).toBeInTheDocument()
    fireEvent.click(within(drawer).getByText('Close'))
    const chart = screen.getByRole('group', { name: 'Daily transition counts by vehicle state' })
    expect(within(chart.closest('figure')!).getByRole('table')).toHaveTextContent('2025-03-09')
    const table = screen.getByRole('table', { name: 'State transitions' })
    expect(within(table).getByText('offline')).toHaveClass('bg-[var(--surface-2)]')
    const rangeCalls = mockedRequest.mock.calls.map(([path]) => path).filter(path => path.startsWith('/vehicle-states/'))
    for (const path of rangeCalls) {
      const params = new URLSearchParams(path.split('?')[1])
      expect(params.get('start')).toBe('2025-03-08T08:00:00.000Z')
      expect(params.get('end')).toBe('2025-03-10T07:00:00.000Z')
    }
    expect(rangeCalls).toHaveLength(2)
  })
})
