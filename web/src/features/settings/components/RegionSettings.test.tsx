// RegionSettings tests.
//
// Strategy (mirrors the sibling ActiveOrdersSection.test.tsx hook-boundary
// pattern):
//   • The two data hooks (`useTeslaUserRegion`, `useRefreshTeslaRegion`) are
//     mocked at the `@/api/hooks/useUser` boundary so every render branch
//     (loading / error / empty / populated) and both mutation outcomes are
//     deterministic and no network is touched.
//   • react-i18next is stubbed to echo the fallback string (with {{var}}
//     interpolation) so assertions target rendered English regardless of the
//     'settings' namespace or the default namespace QueryError uses.
//   • The component is rendered inside QueryClientProvider + MemoryRouter +
//     ToastProvider so the shared toast helper and <QueryError>'s router
//     (useNavigate) usage both resolve.
//   • fireEvent only — @testing-library/user-event is not installed in this
//     repo (see ResetSection.test.tsx).

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

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
        let result = fallback ?? key
        if (opts) {
          for (const [k, v] of Object.entries(opts)) {
            result = result.replace(new RegExp(`{{${k}}}`, 'g'), String(v))
          }
        }
        return result
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

vi.mock('@/api/hooks/useUser', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useUser')>()
  return {
    ...actual,
    useTeslaUserRegion: vi.fn(),
    useRefreshTeslaRegion: vi.fn(),
  }
})

import { useTeslaUserRegion, useRefreshTeslaRegion } from '@/api/hooks/useUser'
import { ApiError } from '@/api/client'
import { ToastProvider } from '@/components/feedback/Toast'
import { RegionSettings } from './RegionSettings'

const mockedUseRegion = useTeslaUserRegion as unknown as Mock
const mockedUseRefresh = useRefreshTeslaRegion as unknown as Mock

interface RegionEnvelope {
  data: { region: string; fleet_api_base_url: string }
  fetched_at: string | null
}

const NA_ENVELOPE: RegionEnvelope = {
  data: { region: 'na', fleet_api_base_url: 'https://fleet-api.prd.na.vn.cloud.tesla.com' },
  fetched_at: '2025-03-01T00:00:00Z',
}

// A full react-query result is large; the component only reads a handful of
// fields. Build just those and let the loose Mock return type absorb the rest.
function regionState(over: Record<string, unknown> = {}) {
  return {
    data: NA_ENVELOPE as RegionEnvelope | undefined,
    isLoading: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
    ...over,
  }
}

function renderSection() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ToastProvider>
          <RegionSettings />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedUseRegion.mockReturnValue(regionState())
  mockedUseRefresh.mockReturnValue({ mutate: vi.fn(), isPending: false })
})

describe('RegionSettings — header', () => {
  it('always renders the panel heading, subtitle, and refresh control', () => {
    renderSection()
    expect(screen.getByRole('heading', { name: 'Region & API' })).toBeInTheDocument()
    expect(
      screen.getByText('Tesla account region and Fleet API endpoint'),
    ).toBeInTheDocument()
    // The refresh control is a shared <Button> with a decorative (aria-hidden)
    // icon, so its accessible name is exactly the text label.
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
  })

  it('shows the last-synced timestamp only when the region was fetched', () => {
    mockedUseRegion.mockReturnValue(
      regionState({ data: { ...NA_ENVELOPE, fetched_at: '2025-03-15T12:00:00Z' } }),
    )
    renderSection()
    expect(screen.getByText('Synced', { exact: false })).toBeInTheDocument()
  })

  it('hides the last-synced timestamp before the first fetch', () => {
    mockedUseRegion.mockReturnValue(regionState({ data: undefined }))
    renderSection()
    expect(screen.queryByText('Synced', { exact: false })).not.toBeInTheDocument()
  })
})

describe('RegionSettings — loading / error / empty states', () => {
  it('renders a status spinner (not the empty panel) while the query is pending', () => {
    mockedUseRegion.mockReturnValue(
      regionState({ data: undefined, isLoading: true }),
    )
    renderSection()

    // The localized loading label doubles as the spinner's accessible name.
    expect(screen.getByText('Loading region…')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Loading region…' })).toBeInTheDocument()
    // The header (and its refresh control) stay mounted during load.
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
    // The misleading "no data" empty copy must NOT compete with the spinner —
    // this is the core bug the harden fixes.
    expect(screen.queryByText(/No region data yet/)).not.toBeInTheDocument()
  })

  it('surfaces a QueryError whose retry refetches when the initial load fails', () => {
    const refetch = vi.fn()
    mockedUseRegion.mockReturnValue(
      regionState({
        data: undefined,
        isError: true,
        error: new ApiError('Tesla upstream failed', 503),
        refetch,
      }),
    )
    renderSection()

    // 503 → QueryError "Server error" branch with a Retry CTA.
    expect(screen.getByText('Server error')).toBeInTheDocument()
    // No empty panel is shown when the load errored.
    expect(screen.queryByText(/No region data yet/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('prefers rendering cached region data over a background refetch error', () => {
    mockedUseRegion.mockReturnValue(
      regionState({
        data: NA_ENVELOPE,
        isError: true,
        error: new ApiError('flaky refetch', 503),
      }),
    )
    renderSection()

    // Data wins — the error UI is suppressed while we still have a region.
    expect(screen.getByText('na')).toBeInTheDocument()
    expect(screen.queryByText('Server error')).not.toBeInTheDocument()
  })

  it('shows the "no data yet" empty state before the first successful fetch', () => {
    mockedUseRegion.mockReturnValue(regionState({ data: undefined }))
    renderSection()
    expect(
      screen.getByText('No region data yet. Click Refresh to fetch from Tesla.'),
    ).toBeInTheDocument()
  })

  it('shows the "no region" empty state after a fetch returns a blank region', () => {
    mockedUseRegion.mockReturnValue(
      regionState({
        data: { data: { region: '', fleet_api_base_url: '' }, fetched_at: '2025-03-01T00:00:00Z' },
      }),
    )
    renderSection()
    expect(
      screen.getByText('Tesla did not return a region for this account.'),
    ).toBeInTheDocument()
    // The "never fetched" copy must not appear once a fetch has happened.
    expect(screen.queryByText(/No region data yet/)).not.toBeInTheDocument()
  })
})

describe('RegionSettings — populated region card', () => {
  it('renders the region code and Fleet API base URL labels + values', () => {
    mockedUseRegion.mockReturnValue(
      regionState({
        data: {
          data: { region: 'eu', fleet_api_base_url: 'https://fleet-api.prd.eu.vn.cloud.tesla.com' },
          fetched_at: '2025-03-01T00:00:00Z',
        },
      }),
    )
    renderSection()

    expect(screen.getByText('Region')).toBeInTheDocument()
    expect(screen.getByText('eu')).toBeInTheDocument()
    expect(screen.getByText('Fleet API Base URL')).toBeInTheDocument()
    expect(
      screen.getByText('https://fleet-api.prd.eu.vn.cloud.tesla.com'),
    ).toBeInTheDocument()
  })

  it('falls back to an em dash when the Fleet API base URL is missing', () => {
    mockedUseRegion.mockReturnValue(
      regionState({
        data: {
          // `fleet_api_base_url` intentionally absent — exercises the `?? '—'`
          // null-safety guard on a well-formed but partial payload.
          data: { region: 'cn' } as RegionEnvelope['data'],
          fetched_at: '2025-03-01T00:00:00Z',
        },
      }),
    )
    renderSection()

    expect(screen.getByText('cn')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})

describe('RegionSettings — refresh action', () => {
  it('invokes the refresh mutation with success/error callbacks on click', () => {
    const mutate = vi.fn()
    mockedUseRefresh.mockReturnValue({ mutate, isPending: false })
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    )
  })

  it('shows a success toast when the refresh resolves', async () => {
    const mutate = vi.fn((_input: undefined, opts?: { onSuccess?: () => void }) => {
      opts?.onSuccess?.()
    })
    mockedUseRefresh.mockReturnValue({ mutate, isPending: false })
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(await screen.findByText('Region info refreshed')).toBeInTheDocument()
  })

  it('shows an error toast carrying the failure message when the refresh rejects', async () => {
    const mutate = vi.fn(
      (_input: undefined, opts?: { onError?: (e: Error) => void }) => {
        opts?.onError?.(new Error('Tesla timeout'))
      },
    )
    mockedUseRefresh.mockReturnValue({ mutate, isPending: false })
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(await screen.findByText('Failed to refresh region')).toBeInTheDocument()
    expect(screen.getByText('Tesla timeout')).toBeInTheDocument()
  })

  it('disables the refresh button and spins its icon while a refresh is pending', () => {
    mockedUseRefresh.mockReturnValue({ mutate: vi.fn(), isPending: true })
    renderSection()

    const button = screen.getByRole('button', { name: 'Refresh' })
    expect(button).toBeDisabled()
    expect(button.querySelector('.animate-spin')).not.toBeNull()
  })
})
