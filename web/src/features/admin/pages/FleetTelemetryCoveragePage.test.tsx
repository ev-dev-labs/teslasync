/**
 * FleetTelemetryCoveragePage contract tests.
 *
 * Covers:
 *  1. Loading state spinner renders.
 *  2. Categories render with destination breakdown.
 *  3. Empty state renders when categories are empty.
 *  4. Error state renders.
 *  5. Orphan fields warning renders ONLY when non-empty.
 *  6. Filter narrows the visible categories.
 *  7. Refresh button triggers refetch.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
import FleetTelemetryCoveragePage from './FleetTelemetryCoveragePage'
import type { FleetTelemetryCoverageResponse } from '@/api/types'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

function makeResponse(
  overrides: Partial<FleetTelemetryCoverageResponse> = {},
): FleetTelemetryCoverageResponse {
  return {
    categories: [
      {
        category: 'driving',
        total_fields: 2,
        destinations: { signal_log: 2 },
        fields: [
          {
            field: 'VehicleSpeed',
            destination: 'signal_log',
            column: '',
            also_signal_log: false,
            subscribed: true,
          },
          {
            field: 'BrakePedal',
            destination: 'drive_telemetry',
            column: 'brake_pedal',
            also_signal_log: true,
            subscribed: true,
          },
        ],
      },
      {
        category: 'climate',
        total_fields: 1,
        destinations: { climate_snapshot: 1 },
        fields: [
          {
            field: 'InsideTemp',
            destination: 'climate_snapshot',
            column: 'inside_temp_c',
            also_signal_log: false,
            subscribed: false,
          },
        ],
      },
    ],
    destination_totals: {
      signal_log: 3,
      drive_telemetry: 1,
      climate_snapshot: 1,
    },
    orphan_fields: [],
    ...overrides,
  }
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <FleetTelemetryCoveragePage />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockedRequest.mockReset()
})

describe('FleetTelemetryCoveragePage', () => {
  it('renders the spinner while the query is loading', () => {
    let resolver: (value: FleetTelemetryCoverageResponse) => void = () => {}
    mockedRequest.mockReturnValueOnce(
      new Promise<FleetTelemetryCoverageResponse>((resolve) => {
        resolver = resolve
      }),
    )

    renderPage()

    expect(screen.getByTestId('coverage-loading')).toBeInTheDocument()

    // Resolve so React-Query teardown is clean.
    resolver({ categories: [], destination_totals: {}, orphan_fields: [] })
  })

  it('renders summary stats and categories from the response', async () => {
    mockedRequest.mockResolvedValueOnce(makeResponse())

    renderPage()

    await waitFor(() =>
      expect(screen.getByTestId('coverage-categories')).toBeInTheDocument(),
    )

    // Both categories surface.
    expect(screen.getByTestId('coverage-category-driving')).toBeInTheDocument()
    expect(screen.getByTestId('coverage-category-climate')).toBeInTheDocument()

    // Stats are computed: 2 categories, 3 routed fields, 2 subscribed,
    // 1 unsubscribed-but-routed, 0 orphans. The presence of the stat
    // tiles confirms the summary path is hit; we don't pin exact text
    // here because StatCard's value rendering is a shared concern.
    expect(screen.getByTestId('coverage-stat-categories')).toBeInTheDocument()
    expect(screen.getByTestId('coverage-stat-routed')).toBeInTheDocument()
    expect(screen.getByTestId('coverage-stat-subscribed')).toBeInTheDocument()
    expect(screen.getByTestId('coverage-stat-unsubscribed')).toBeInTheDocument()
    expect(screen.getByTestId('coverage-stat-orphans')).toBeInTheDocument()

    // Destination breakdown chips render in descending count order.
    expect(screen.getByTestId('coverage-dest-signal_log')).toBeInTheDocument()
    expect(screen.getByTestId('coverage-dest-drive_telemetry')).toBeInTheDocument()
    expect(screen.getByTestId('coverage-dest-climate_snapshot')).toBeInTheDocument()
  })

  it('does NOT render the orphan warning when orphan_fields is empty', async () => {
    mockedRequest.mockResolvedValueOnce(makeResponse({ orphan_fields: [] }))

    renderPage()

    await waitFor(() =>
      expect(screen.getByTestId('coverage-categories')).toBeInTheDocument(),
    )

    expect(screen.queryByTestId('coverage-orphans-panel')).toBeNull()
  })

  it('renders the orphan warning when orphan_fields is non-empty', async () => {
    mockedRequest.mockResolvedValueOnce(
      makeResponse({ orphan_fields: ['MysteriousField', 'AnotherDrift'] }),
    )

    renderPage()

    await waitFor(() =>
      expect(screen.getByTestId('coverage-orphans-panel')).toBeInTheDocument(),
    )

    expect(screen.getByText('MysteriousField')).toBeInTheDocument()
    expect(screen.getByText('AnotherDrift')).toBeInTheDocument()
  })

  it('renders the empty state when categories is empty', async () => {
    mockedRequest.mockResolvedValueOnce({
      categories: [],
      destination_totals: {},
      orphan_fields: [],
    } satisfies FleetTelemetryCoverageResponse)

    renderPage()

    await waitFor(() =>
      expect(screen.getByTestId('coverage-empty')).toBeInTheDocument(),
    )
  })

  it('renders the error banner when the query rejects', async () => {
    mockedRequest.mockRejectedValue(new Error('boom'))

    renderPage()

    await waitFor(() =>
      expect(screen.getByTestId('coverage-error')).toBeInTheDocument(),
    )
  })

  it('filters categories to those matching the input', async () => {
    mockedRequest.mockResolvedValueOnce(makeResponse())

    renderPage()

    await waitFor(() =>
      expect(screen.getByTestId('coverage-category-driving')).toBeInTheDocument(),
    )

    const input = screen.getByTestId('coverage-filter-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'climate' } })

    await waitFor(() =>
      expect(screen.queryByTestId('coverage-category-driving')).toBeNull(),
    )
    expect(screen.getByTestId('coverage-category-climate')).toBeInTheDocument()
  })

  it('shows the filter-empty state when no category matches the filter', async () => {
    mockedRequest.mockResolvedValueOnce(makeResponse())

    renderPage()

    await waitFor(() =>
      expect(screen.getByTestId('coverage-categories')).toBeInTheDocument(),
    )

    const input = screen.getByTestId('coverage-filter-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'nonexistent-zzz-xxx' } })

    await waitFor(() =>
      expect(screen.getByTestId('coverage-filter-empty')).toBeInTheDocument(),
    )
  })

  it('refresh button triggers a refetch', async () => {
    mockedRequest.mockResolvedValue(makeResponse())

    renderPage()

    await waitFor(() =>
      expect(screen.getByTestId('coverage-categories')).toBeInTheDocument(),
    )

    const callsBefore = mockedRequest.mock.calls.length
    fireEvent.click(screen.getByTestId('coverage-refresh-button'))

    await waitFor(() =>
      expect(mockedRequest.mock.calls.length).toBeGreaterThan(callsBefore),
    )
  })
})
