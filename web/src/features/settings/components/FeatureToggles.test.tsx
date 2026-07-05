// FeatureToggles adoption tests.
//
// The panel reads Tesla's account feature-config through two hooks that both
// round-trip the shared `request()` client:
//   • useTeslaFeatureConfig       → GET  /tesla/user/feature-config
//   • useRefreshTeslaFeatureConfig → POST /tesla/user/feature-config/refresh
//
// We mock @/api/client so the whole hook layer flows through one router-style
// switch and we can assert on the wire shape (path + method). react-i18next is
// stubbed so `{{var}}` / `defaultValue` interpolation is deterministic (same
// convention as AICostCapSpendBar.test.tsx). No real network.
//
// Rendered inside QueryClientProvider + ToastProvider because the refresh hook
// emits its toast via the shared useMutationToast() helper (which calls
// useToast()) — mirrors ResetSection.test.tsx / WebhookChannelsSection.test.tsx.
//
// fireEvent only (user-event is not installed in this repo).

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, request: vi.fn() }
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
        const dv = opts && typeof opts.defaultValue === 'string' ? (opts.defaultValue as string) : undefined
        let result = fallback ?? dv ?? key
        if (opts) {
          for (const [k, v] of Object.entries(opts)) {
            if (k === 'defaultValue') continue
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

import { request } from '@/api/client'
import { ToastProvider } from '@/components/feedback/Toast'
import { FeatureToggles } from './FeatureToggles'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

const GET_PATH = '/tesla/user/feature-config'
const REFRESH_PATH = '/tesla/user/feature-config/refresh'

/** Builds the {data, fetched_at} envelope the hook resolves to. */
function envelope(
  data: unknown,
  fetchedAt: string | null = '2024-06-01T10:00:00Z',
) {
  return { data, fetched_at: fetchedAt }
}

/** Resolve the GET with the given config; reject everything else loudly. */
function mockConfig(data: unknown, fetchedAt: string | null = '2024-06-01T10:00:00Z') {
  mockedRequest.mockImplementation((path: string, init?: { method?: string }) => {
    if (path === GET_PATH) return Promise.resolve(envelope(data, fetchedAt))
    return Promise.reject(new Error(`unexpected ${init?.method ?? 'GET'} ${path}`))
  })
}

function renderPanel() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <FeatureToggles />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mockedRequest.mockReset()
})

describe('FeatureToggles — header + structure', () => {
  it('always renders the title, subtitle and an accessible Refresh button', () => {
    mockConfig({})
    renderPanel()

    // Header chrome is rendered regardless of data state (it holds the action).
    expect(screen.getByTestId('feature-toggles')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Feature Flags' })).toBeInTheDocument()
    expect(screen.getByText('Tesla account feature configuration')).toBeInTheDocument()
    const refresh = screen.getByRole('button', { name: 'Refresh' })
    expect(refresh).toBeInTheDocument()
    expect(refresh).toBeEnabled()
  })
})

describe('FeatureToggles — loading state', () => {
  it('shows skeleton rows while the first fetch is in flight, not the empty state', () => {
    mockedRequest.mockReturnValue(new Promise(() => {})) // never resolves
    renderPanel()

    const loading = screen.getByTestId('feature-toggles-loading')
    expect(loading).toBeInTheDocument()
    // Three skeleton bars, no misleading "no data" copy, no rows.
    expect(loading.querySelectorAll('.animate-pulse')).toHaveLength(3)
    expect(
      screen.queryByText('No feature config data yet. Click Refresh to fetch from Tesla.'),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Enabled')).not.toBeInTheDocument()
  })
})

describe('FeatureToggles — empty state', () => {
  it('renders the no-data empty state once an empty config resolves', async () => {
    mockConfig({}, null)
    renderPanel()

    expect(
      await screen.findByText('No feature config data yet. Click Refresh to fetch from Tesla.'),
    ).toBeInTheDocument()
    // Loading skeleton is gone, and with fetched_at=null there is no "Synced" stamp.
    expect(screen.queryByTestId('feature-toggles-loading')).not.toBeInTheDocument()
    expect(screen.queryByText(/Synced/)).not.toBeInTheDocument()
  })

  it('treats a null / non-object config payload as empty rather than crashing', async () => {
    mockConfig(null, null)
    renderPanel()

    expect(
      await screen.findByText('No feature config data yet. Click Refresh to fetch from Tesla.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Enabled')).not.toBeInTheDocument()
  })
})

describe('FeatureToggles — populated table', () => {
  it('renders a row per feature with enabled/disabled badges, details and the sync stamp', async () => {
    mockConfig({
      sentry_mode: { enabled: true, subscribe_connectivity: true, cellular_enabled: false },
      autopilot: true,
      valet_mode: false,
    })
    renderPanel()

    // Column headers.
    expect(await screen.findByText('Feature')).toBeInTheDocument()
    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByText('Details')).toBeInTheDocument()

    // Nested object → enabled badge + compact detail summary of remaining keys.
    const sentry = screen.getByTestId('feature-toggles-row-sentry_mode')
    expect(within(sentry).getByText('Enabled')).toBeInTheDocument()
    expect(
      within(sentry).getByText('subscribe_connectivity: true, cellular_enabled: false'),
    ).toBeInTheDocument()

    // Primitive true → enabled, no details.
    const autopilot = screen.getByTestId('feature-toggles-row-autopilot')
    expect(within(autopilot).getByText('Enabled')).toBeInTheDocument()
    expect(within(autopilot).getByText('—')).toBeInTheDocument()

    // Primitive false → disabled.
    const valet = screen.getByTestId('feature-toggles-row-valet_mode')
    expect(within(valet).getByText('Disabled')).toBeInTheDocument()

    // fetched_at present → "Synced …" stamp rendered.
    expect(screen.getByText(/Synced/)).toBeInTheDocument()
  })

  it('normalises an object carrying only `enabled` to a "—" details cell (empty-string bug)', async () => {
    mockConfig({ plain_flag: { enabled: false } }, null)
    renderPanel()

    const row = await screen.findByTestId('feature-toggles-row-plain_flag')
    expect(within(row).getByText('Disabled')).toBeInTheDocument()
    // Regression guard: the details join produced '' which the `?? '—'` fallback
    // did NOT catch, leaving a blank cell. It must now render the placeholder.
    expect(within(row).getByText('—')).toBeInTheDocument()
    expect(row.children[row.children.length - 1].textContent).toBe('—')
  })
})

describe('FeatureToggles — refresh action', () => {
  it('POSTs the refresh endpoint and surfaces exactly one success toast', async () => {
    mockedRequest.mockImplementation((path: string, init?: { method?: string }) => {
      if (path === GET_PATH) return Promise.resolve(envelope({ autopilot: true }))
      if (path === REFRESH_PATH && init?.method === 'POST') {
        return Promise.resolve(envelope({ autopilot: true }))
      }
      return Promise.reject(new Error(`unexpected ${init?.method ?? 'GET'} ${path}`))
    })

    renderPanel()
    await screen.findByTestId('feature-toggles-row-autopilot')

    fireEvent.click(screen.getByTestId('feature-toggles-refresh'))

    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledWith(
        REFRESH_PATH,
        expect.objectContaining({ method: 'POST' }),
      )
    })

    // Duplicate-toast regression: the panel used to pass mutate() callbacks that
    // duplicated the hook's own toast, firing TWO identical toasts. Exactly one.
    const toasts = await screen.findAllByText('Feature config refreshed')
    expect(toasts).toHaveLength(1)
  })

  it('surfaces a single error toast with the failure detail when refresh fails', async () => {
    mockedRequest.mockImplementation((path: string, init?: { method?: string }) => {
      if (path === GET_PATH) return Promise.resolve(envelope({ autopilot: true }))
      if (path === REFRESH_PATH && init?.method === 'POST') {
        return Promise.reject(new Error('rate limited'))
      }
      return Promise.reject(new Error(`unexpected ${init?.method ?? 'GET'} ${path}`))
    })

    renderPanel()
    await screen.findByTestId('feature-toggles-row-autopilot')

    fireEvent.click(screen.getByTestId('feature-toggles-refresh'))

    expect(await screen.findByText('Failed to refresh feature config')).toBeInTheDocument()
    // The underlying error message is surfaced as the toast's secondary line.
    expect(screen.getByText('rate limited')).toBeInTheDocument()
    expect(await screen.findAllByText('Failed to refresh feature config')).toHaveLength(1)
  })

  it('disables the Refresh button and spins its icon while a refresh is in flight', async () => {
    mockedRequest.mockImplementation((path: string, init?: { method?: string }) => {
      if (path === GET_PATH) return Promise.resolve(envelope({ autopilot: true }))
      if (path === REFRESH_PATH && init?.method === 'POST') return new Promise(() => {})
      return Promise.reject(new Error(`unexpected ${init?.method ?? 'GET'} ${path}`))
    })

    renderPanel()
    await screen.findByTestId('feature-toggles-row-autopilot')

    const btn = screen.getByTestId('feature-toggles-refresh')
    expect(btn).toBeEnabled()

    fireEvent.click(btn)

    await waitFor(() => expect(btn).toBeDisabled())
    expect(btn.querySelector('.animate-spin')).not.toBeNull()
  })
})

describe('FeatureToggles — fetch error + retry', () => {
  it('shows a retryable error state on fetch failure and recovers when retried', async () => {
    let getCalls = 0
    mockedRequest.mockImplementation((path: string, init?: { method?: string }) => {
      if (path === GET_PATH) {
        getCalls += 1
        if (getCalls === 1) return Promise.reject(new Error('boom'))
        return Promise.resolve(envelope({ autopilot: true }))
      }
      return Promise.reject(new Error(`unexpected ${init?.method ?? 'GET'} ${path}`))
    })

    renderPanel()

    // Error branch: retryable state, NOT the neutral "no data" empty state.
    expect(
      await screen.findByText(/Something went wrong fetching your Tesla feature configuration/),
    ).toBeInTheDocument()
    const retry = screen.getByRole('button', { name: 'Retry' })
    expect(retry).toBeInTheDocument()
    expect(
      screen.queryByText('No feature config data yet. Click Refresh to fetch from Tesla.'),
    ).not.toBeInTheDocument()

    fireEvent.click(retry)

    // refetch() re-runs the query; the second GET resolves and the table renders.
    expect(await screen.findByTestId('feature-toggles-row-autopilot')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(getCalls).toBe(2)
  })
})
