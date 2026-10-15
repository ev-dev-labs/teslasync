// TeslaAccountSection tests.
//
// Strategy (mirrors ActiveOrdersSection.test.tsx's hook-boundary pattern):
//   • The five settings hooks the section consumes (`useAuthStatus`,
//     `useAuthURL`, `useRefreshAuth`, `useDisconnectAuth`, `useSyncVehicles`)
//     are mocked at the `@/api/hooks/useSettings` boundary so every render
//     branch (loading / not-connected / connected / expiring-soon / expired)
//     and every mutation outcome is deterministic and no network is touched.
//   • react-i18next is stubbed to echo the fallback string (with {{var}}
//     interpolation) so assertions target rendered English.
//   • The section is rendered inside QueryClientProvider + ToastProvider so the
//     shared `useToast()` helper and the <ConfirmDialog> portal both resolve.
//   • The two document-level CustomEvents the section mirrors
//     (`teslasync:tesla-auth-expired` / `-recovered`) are dispatched via `act`.

import {
  describe, it, expect, beforeEach, afterEach, vi, type Mock,
} from 'vitest'
import {
  render, screen, fireEvent, waitFor, within, act,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { formatDateTime, type FormatOptions } from '@/lib/dateFormat'

const datePreferences = vi.hoisted(() => ({
  current: { locale: 'en-US', tz: 'UTC' } as FormatOptions,
}))

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDateTime: (value: string | Date | null | undefined) =>
      formatDateTime(value, datePreferences.current),
  }),
}))

vi.mock('@/api/hooks/useVehicles', async (importActual) => ({
  ...await importActual<typeof import('@/api/hooks/useVehicles')>(),
  useVehicles: vi.fn(),
  useWakeVehicle: vi.fn(),
}))

vi.mock('@/api/hooks/useFleetSetup', async (importActual) => ({
  ...await importActual<typeof import('@/api/hooks/useFleetSetup')>(),
  useFleetTelemetryConfig: vi.fn(),
  useFleetTelemetryErrors: vi.fn(),
  useSubscribeFleetTelemetry: vi.fn(),
  useUnsubscribeFleetTelemetry: vi.fn(),
}))

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

vi.mock('@/api/hooks/useSettings', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useSettings')>()
  return {
    ...actual,
    useAuthStatus: vi.fn(),
    useAuthURL: vi.fn(),
    useRefreshAuth: vi.fn(),
    useDisconnectAuth: vi.fn(),
    useSyncVehicles: vi.fn(),
  }
})

import {
  useAuthStatus,
  useAuthURL,
  useRefreshAuth,
  useDisconnectAuth,
  useSyncVehicles,
} from '@/api/hooks/useSettings'
import { ToastProvider } from '@/components/feedback'
import { TeslaAccountSection } from './TeslaAccountSection'
import { FleetSetupSubscribePanel } from './fleet-setup/FleetSetupSubscribePanel'
import { useVehicles, useWakeVehicle } from '@/api/hooks/useVehicles'
import {
  useFleetTelemetryConfig, useFleetTelemetryErrors,
  useSubscribeFleetTelemetry, useUnsubscribeFleetTelemetry,
} from '@/api/hooks/useFleetSetup'

const mockedAuthStatus = useAuthStatus as unknown as Mock
const mockedAuthURL = useAuthURL as unknown as Mock
const mockedRefresh = useRefreshAuth as unknown as Mock
const mockedDisconnect = useDisconnectAuth as unknown as Mock
const mockedSync = useSyncVehicles as unknown as Mock

const DAY_MS = 24 * 60 * 60 * 1000

interface AuthValue {
  authenticated: boolean
  expires_at?: string
}

/** The section reads only `.data` off the auth query. */
function authState(auth: AuthValue | undefined) {
  return { data: auth, isLoading: auth === undefined, refetch: vi.fn() }
}

interface MutationOverrides {
  mutate?: Mock
  isPending?: boolean
  isSuccess?: boolean
  data?: unknown
}

/** Minimal mutation-result shape; loose enough for the fields the section reads. */
function mutation(over: MutationOverrides = {}) {
  return {
    mutate: vi.fn(),
    isPending: false,
    isSuccess: false,
    data: undefined,
    ...over,
  }
}

function tree(children: ReactNode = <TeslaAccountSection />) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  return (
    <MemoryRouter>
    <QueryClientProvider client={qc}>
      <ToastProvider>
        {children}
      </ToastProvider>
    </QueryClientProvider>
    </MemoryRouter>
  )
}

function renderSection() {
  const utils = render(tree())
  return { ...utils, rerender: () => utils.rerender(tree()) }
}

beforeEach(() => {
  vi.clearAllMocks()
  datePreferences.current = { locale: 'en-US', tz: 'UTC' }
  mockedAuthStatus.mockReturnValue(authState(undefined))
  mockedAuthURL.mockReturnValue(mutation())
  mockedRefresh.mockReturnValue(mutation())
  mockedDisconnect.mockReturnValue(mutation())
  mockedSync.mockReturnValue(mutation())
})

describe('TeslaAccountSection — header + connection status region', () => {
  it.each([false, true])('keeps account actions touch-sized and wrapping with desktop restoration (connected=%s)', (authenticated) => {
    mockedAuthStatus.mockReturnValue(authState({ authenticated }))
    renderSection()
    const labels = authenticated
      ? ['Refresh token', 'Sync vehicles', 'Re-authorize', 'Disconnect']
      : ['Connect Tesla account']
    for (const name of labels) {
      expect(screen.getByRole('button', { name })).toHaveClass(
        'h-auto', 'min-h-11', 'min-w-11', 'md:min-h-10', 'md:min-w-0',
        'max-w-full', 'whitespace-normal',
      )
    }
  })

  it('shows a source failure and read-only retry instead of inventing disconnected status', () => {
    const refetch = vi.fn()
    mockedAuthStatus.mockReturnValue({
      ...authState(undefined), isLoading: false, isError: true, error: new Error('Read failed'), refetch,
    })
    renderSection()
    expect(screen.getByText('Tesla account status unavailable.')).toBeInTheDocument()
    expect(screen.queryByText('Not connected')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(mockedAuthURL.mock.results[0].value.mutate).not.toHaveBeenCalled()
  })

  it('preserves the connected state and existing controls after a retained refresh failure', () => {
    mockedAuthStatus.mockReturnValue({
      ...authState({ authenticated: true }), isError: true, error: new Error('Refresh failed'),
    })
    renderSection()
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.getByText('Previously loaded data remains visible while affected sources recover.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh token' })).toBeEnabled()
    expect(screen.queryByText('Not connected')).toBeNull()
  })
  it('always renders the panel heading and subtitle', () => {
    renderSection()
    expect(screen.getByRole('heading', { name: 'Tesla account', level: 2 })).toBeInTheDocument()
    expect(
      screen.getByText('Connect your Tesla account to sync vehicles and data'),
    ).toBeInTheDocument()
  })

  it('exposes the connection state as an aria-live status region', () => {
    mockedAuthStatus.mockReturnValue(authState({ authenticated: true }))
    renderSection()
    const region = screen.getByTestId('tesla-connection-status')
    expect(region).toHaveAttribute('role', 'status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    // The decorative status glyph must be hidden from assistive tech since
    // the adjacent text already conveys the state.
    const icon = region.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('TeslaAccountSection — disconnected / not-connected branch', () => {
  it('keeps connection status unknown and only the connect action while auth is loading', () => {
    mockedAuthStatus.mockReturnValue(authState(undefined))
    renderSection()
    expect(screen.queryByText('Not connected')).toBeNull()
    expect(screen.getByRole('status', { name: 'Loading Tesla account' })).toBeInTheDocument()
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(
      screen.getByRole('button', { name: 'Connect Tesla account' }),
    ).toBeInTheDocument()
  })

  it('renders the connect-only layout when the account is explicitly unauthenticated', () => {
    mockedAuthStatus.mockReturnValue(authState({ authenticated: false }))
    renderSection()
    expect(screen.getByText('Not connected')).toBeInTheDocument()
    expect(screen.queryByText('Connected')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Disconnect' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Refresh token' }),
    ).not.toBeInTheDocument()
  })
})

describe('TeslaAccountSection — connected branch', () => {
  it('updates expiry presentation with current date preferences while retaining the raw instant', () => {
    const expires = '2099-01-01T01:30:00Z'
    const auth = { authenticated: true, expires_at: expires }
    mockedAuthStatus.mockReturnValue(authState(auth))
    const { rerender } = renderSection()
    const initial = formatDateTime(expires, datePreferences.current)
    expect(screen.getByText(initial)).toHaveAttribute('datetime', expires)
    expect(screen.getByText(initial)).toHaveAttribute('title', expires)

    datePreferences.current = { locale: 'de-DE', tz: 'America/Los_Angeles' }
    rerender()
    const updated = formatDateTime(expires, datePreferences.current)
    expect(updated).not.toBe(initial)
    expect(screen.getByText(updated)).toHaveAttribute('datetime', expires)
    expect(auth.expires_at).toBe(expires)
    expect(screen.getByRole('button', { name: 'Refresh token' })).toBeEnabled()
  })

  it('renders the full authenticated action set and hides the connect CTA', () => {
    mockedAuthStatus.mockReturnValue(authState({ authenticated: true }))
    renderSection()

    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh token' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sync vehicles' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Re-authorize' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Connect Tesla account' }),
    ).not.toBeInTheDocument()
  })

  describe('FleetSetupSubscribePanel — telemetry error dates', () => {
    beforeEach(() => {
      mockedAuthStatus.mockReturnValue(authState({ authenticated: true }))
      vi.mocked(useVehicles).mockReturnValue({
        data: [{ id: 1, vin: 'TEST-VIN', display_name: 'Test vehicle' }],
        isLoading: false, refetch: vi.fn(),
      } as ReturnType<typeof useVehicles>)
      vi.mocked(useFleetTelemetryConfig).mockReturnValue({
        data: { config: { hostname: 'telemetry.example.com', port: 4443, fields: { Soc: {} } } },
        isLoading: false, refetch: vi.fn(),
      } as ReturnType<typeof useFleetTelemetryConfig>)
      vi.mocked(useWakeVehicle).mockReturnValue(mutation() as ReturnType<typeof useWakeVehicle>)
      vi.mocked(useSubscribeFleetTelemetry).mockReturnValue(mutation() as ReturnType<typeof useSubscribeFleetTelemetry>)
      vi.mocked(useUnsubscribeFleetTelemetry).mockReturnValue(mutation() as ReturnType<typeof useUnsubscribeFleetTelemetry>)
    })

    it('formats error instants with current preferences without losing full messages or populated config', () => {
      const timestamp = '2026-10-14T01:30:00Z'
      const message = 'Certificate rejected: full diagnostic detail.\nRetry after replacing the complete CA chain.'
      const errors = [{ code: 'TLS_ERROR', message, timestamp }]
      vi.mocked(useFleetTelemetryErrors).mockReturnValue({
        data: errors, isLoading: false, refetch: vi.fn(),
      } as ReturnType<typeof useFleetTelemetryErrors>)
      const rendered = render(tree(<FleetSetupSubscribePanel />))
      fireEvent.change(screen.getByRole('combobox', { name: 'Vehicle' }), {
        target: { value: 'TEST-VIN' },
      })
      const initial = formatDateTime(timestamp, datePreferences.current)
      expect(screen.getByText(initial)).toHaveAttribute('datetime', timestamp)
      expect(screen.getByText(initial)).toHaveAttribute('title', timestamp)
      expect(screen.getByText(message, { exact: true, collapseWhitespace: false })).toHaveTextContent(
        'Certificate rejected: full diagnostic detail. Retry after replacing the complete CA chain.',
      )
      expect(screen.getByText('telemetry.example.com')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Subscribe Test vehicle' })).toBeEnabled()

      datePreferences.current = { locale: 'de-DE', tz: 'America/Los_Angeles' }
      rendered.rerender(tree(<FleetSetupSubscribePanel />))
      const updated = formatDateTime(timestamp, datePreferences.current)
      expect(updated).not.toBe(initial)
      expect(screen.getByText(updated)).toHaveAttribute('datetime', timestamp)
      expect(errors).toEqual([{ code: 'TLS_ERROR', message, timestamp }])
    })

    it.each([false, true])('retains every loaded error in a contained list (refresh failed=%s)', (refreshFailed) => {
      const errors = Array.from({ length: 8 }, (_, index) => ({
        code: `ERROR_${index + 1}`,
        message: `Complete diagnostic ${index + 1}.\nAdditional diagnostic detail.`,
        timestamp: `2026-10-14T01:30:0${index}Z`,
      }))
      vi.mocked(useFleetTelemetryErrors).mockReturnValue({
        data: errors,
        isLoading: false,
        isError: refreshFailed,
        error: refreshFailed ? new Error('Refresh failed') : null,
        refetch: vi.fn(),
      } as ReturnType<typeof useFleetTelemetryErrors>)
      render(tree(<FleetSetupSubscribePanel />))
      fireEvent.change(screen.getByRole('combobox', { name: 'Vehicle' }), {
        target: { value: 'TEST-VIN' },
      })

      const diagnostics = screen.getByRole('region', { name: 'Tesla telemetry errors' })
      expect(diagnostics).toHaveAttribute('tabindex', '0')
      expect(diagnostics).toHaveClass('max-h-80', 'overflow-y-auto')
      for (const error of errors) {
        expect(within(diagnostics).getByText(error.code)).toBeInTheDocument()
        expect(within(diagnostics).getByText(error.message, {
          exact: true, collapseWhitespace: false,
        })).toBeInTheDocument()
      }
      expect(diagnostics.querySelectorAll('time')).toHaveLength(errors.length)
      expect(Array.from(diagnostics.querySelectorAll('time'), (time) =>
        time.getAttribute('datetime'))).toEqual(errors.map((error) => error.timestamp))
      expect(screen.getByText('telemetry.example.com')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Subscribe Test vehicle' })).toBeEnabled()
      if (refreshFailed) {
        expect(screen.getByText('Previously loaded data remains visible while affected sources recover.')).toBeInTheDocument()
      }
    })

    it('retains timestamp-only, message-only and missing-detail error cases', () => {
      const timestamp = '2026-10-14T01:30:00Z'
      vi.mocked(useFleetTelemetryErrors).mockReturnValue({
        data: [
          { code: 'TIME', message: '', timestamp },
          { code: 'MESSAGE', message: 'Complete message without a timestamp', timestamp: '' },
          { code: '', message: '', timestamp: '' },
        ],
        isLoading: false, refetch: vi.fn(),
      } as ReturnType<typeof useFleetTelemetryErrors>)
      render(tree(<FleetSetupSubscribePanel />))
      fireEvent.change(screen.getByRole('combobox', { name: 'Vehicle' }), {
        target: { value: 'TEST-VIN' },
      })
      expect(screen.getByText(formatDateTime(timestamp, datePreferences.current))).toBeInTheDocument()
      expect(screen.getByText('Complete message without a timestamp')).toBeInTheDocument()
      expect(screen.getByText('Tesla reported a telemetry error for this VIN.')).toBeInTheDocument()
      expect(screen.getByText('Tesla telemetry error')).toBeInTheDocument()
    })
  })

  it('renders the token-expiry line but no soft-warning pill when expiry is far out', () => {
    const expires = new Date(Date.now() + 30 * DAY_MS).toISOString()
    mockedAuthStatus.mockReturnValue(authState({ authenticated: true, expires_at: expires }))
    renderSection()
    expect(screen.getByText(/Token expires/)).toBeInTheDocument()
    expect(screen.queryByTestId('tesla-expiring-soon-pill')).not.toBeInTheDocument()
  })

  it('surfaces the "expires in Nd" pill when the token expires within 7 days', () => {
    // 2.5 days out lands cleanly in the ceil→3 bucket regardless of the ms
    // that elapse between this Date.now() and the component's.
    const expires = new Date(Date.now() + 2.5 * DAY_MS).toISOString()
    mockedAuthStatus.mockReturnValue(authState({ authenticated: true, expires_at: expires }))
    renderSection()
    const pill = screen.getByTestId('tesla-expiring-soon-pill')
    expect(pill).toBeInTheDocument()
    expect(pill.textContent).toContain('Expires in 3d')
  })

  it('suppresses the pill once the token is already past its expiry', () => {
    const expires = new Date(Date.now() - DAY_MS).toISOString()
    mockedAuthStatus.mockReturnValue(authState({ authenticated: true, expires_at: expires }))
    renderSection()
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.queryByTestId('tesla-expiring-soon-pill')).not.toBeInTheDocument()
  })

  it('does not crash or show a pill for an unparseable expires_at', () => {
    mockedAuthStatus.mockReturnValue(
      authState({ authenticated: true, expires_at: 'not-a-real-date' }),
    )
    renderSection()
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.queryByTestId('tesla-expiring-soon-pill')).not.toBeInTheDocument()
    // Formatter falls back to the em dash rather than "Invalid Date".
    expect(screen.getByText(/Token expires/)).toBeInTheDocument()
  })

  it('omits the token-expiry line entirely when no expires_at is present', () => {
    mockedAuthStatus.mockReturnValue(authState({ authenticated: true }))
    renderSection()
    expect(screen.queryByText(/Token expires/)).not.toBeInTheDocument()
  })
})

describe('TeslaAccountSection — connect / re-authorize (OAuth handoff)', () => {
  let origLocation: Location

  beforeEach(() => {
    origLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...origLocation, href: 'http://localhost/' },
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: origLocation,
    })
  })

  it('redirects the tab to the returned auth_url on a successful connect', () => {
    const mutate = vi.fn((_v: undefined, opts?: { onSuccess?: (d: { auth_url: string }) => void }) => {
      opts?.onSuccess?.({ auth_url: 'https://auth.tesla.com/oauth2/v3/authorize' })
    })
    mockedAuthURL.mockReturnValue(mutation({ mutate }))
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'Connect Tesla account' }))

    expect(mutate).toHaveBeenCalledTimes(1)
    expect(window.location.href).toBe('https://auth.tesla.com/oauth2/v3/authorize')
  })

  it('does NOT navigate when the success payload lacks an auth_url', () => {
    const mutate = vi.fn((_v: undefined, opts?: { onSuccess?: (d: { auth_url?: string }) => void }) => {
      opts?.onSuccess?.({})
    })
    mockedAuthURL.mockReturnValue(mutation({ mutate }))
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'Connect Tesla account' }))

    expect(mutate).toHaveBeenCalledTimes(1)
    // Guard holds — the tab stays on its original URL rather than "/undefined".
    expect(window.location.href).toBe('http://localhost/')
  })

  it('routes the Re-authorize button through the same auth-URL handoff', () => {
    const mutate = vi.fn()
    mockedAuthStatus.mockReturnValue(authState({ authenticated: true }))
    mockedAuthURL.mockReturnValue(mutation({ mutate }))
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'Re-authorize' }))
    expect(mutate).toHaveBeenCalledTimes(1)
  })

  it('shows the connect button in a loading state while the auth URL is pending', () => {
    mockedAuthURL.mockReturnValue(mutation({ isPending: true }))
    renderSection()
    const button = screen.getByRole('button', { name: 'Connect Tesla account' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
  })
})

describe('TeslaAccountSection — refresh token action', () => {
  beforeEach(() => {
    mockedAuthStatus.mockReturnValue(authState({ authenticated: true }))
  })

  it('invokes the refresh mutation with success + error callbacks', () => {
    const mutate = vi.fn()
    mockedRefresh.mockReturnValue(mutation({ mutate }))
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh token' }))

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
    const mutate = vi.fn((_v: undefined, opts?: { onSuccess?: () => void }) => {
      opts?.onSuccess?.()
    })
    mockedRefresh.mockReturnValue(mutation({ mutate }))
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh token' }))
    expect(await screen.findByText('Token refreshed')).toBeInTheDocument()
  })

  it('shows an error toast carrying the failure message when the refresh rejects', async () => {
    const mutate = vi.fn((_v: undefined, opts?: { onError?: (e: Error) => void }) => {
      opts?.onError?.(new Error('token endpoint 500'))
    })
    mockedRefresh.mockReturnValue(mutation({ mutate }))
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh token' }))
    expect(await screen.findByText('Token refresh failed')).toBeInTheDocument()
    expect(screen.getByText('token endpoint 500')).toBeInTheDocument()
  })

  it('disables the refresh button while a refresh is in flight', () => {
    mockedRefresh.mockReturnValue(mutation({ isPending: true }))
    renderSection()
    expect(screen.getByRole('button', { name: 'Refresh token' })).toBeDisabled()
  })
})

describe('TeslaAccountSection — sync vehicles action', () => {
  beforeEach(() => {
    mockedAuthStatus.mockReturnValue(authState({ authenticated: true }))
  })

  it('invokes the sync mutation with an error callback on click', () => {
    const mutate = vi.fn()
    mockedSync.mockReturnValue(mutation({ mutate }))
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'Sync vehicles' }))
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ onError: expect.any(Function) }),
    )
  })

  it('surfaces an error toast with the failure message when the sync rejects', async () => {
    const mutate = vi.fn((_v: undefined, opts?: { onError?: (e: Error) => void }) => {
      opts?.onError?.(new Error('fleet API unreachable'))
    })
    mockedSync.mockReturnValue(mutation({ mutate }))
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'Sync vehicles' }))
    expect(await screen.findByText('Vehicle sync failed')).toBeInTheDocument()
    expect(screen.getByText('fleet API unreachable')).toBeInTheDocument()
  })

  it('renders the synced-count summary after a successful sync', () => {
    mockedSync.mockReturnValue(mutation({ isSuccess: true, data: { synced: 3 } }))
    renderSection()
    expect(screen.getByText('Synced 3 vehicle(s).')).toBeInTheDocument()
  })

  it('falls back to zero (no crash) when a successful sync returns no body', () => {
    // react-query can report isSuccess with `data === undefined` for a 204;
    // the null-safe `?? 0` must keep the summary rendering instead of throwing.
    mockedSync.mockReturnValue(mutation({ isSuccess: true, data: undefined }))
    renderSection()
    expect(screen.getByText('Synced 0 vehicle(s).')).toBeInTheDocument()
  })

  it('disables the sync button while a sync is in flight', () => {
    mockedSync.mockReturnValue(mutation({ isPending: true }))
    renderSection()
    expect(screen.getByRole('button', { name: 'Sync vehicles' })).toBeDisabled()
  })
})

describe('TeslaAccountSection — disconnect confirmation flow', () => {
  beforeEach(() => {
    mockedAuthStatus.mockReturnValue(authState({ authenticated: true }))
  })

  it('opens a confirmation dialog before disconnecting', async () => {
    const mutate = vi.fn()
    mockedDisconnect.mockReturnValue(mutation({ mutate }))
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Disconnect Tesla account?')).toBeInTheDocument()
    // Nothing fires until the user actually confirms.
    expect(mutate).not.toHaveBeenCalled()
  })

  it('runs the disconnect mutation and toasts success once confirmed', async () => {
    const mutate = vi.fn((_v: undefined, opts?: { onSuccess?: () => void }) => {
      opts?.onSuccess?.()
    })
    mockedDisconnect.mockReturnValue(mutation({ mutate }))
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }))

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Tesla account disconnected')).toBeInTheDocument()
  })

  it('does not disconnect when the confirmation is cancelled', async () => {
    const mutate = vi.fn()
    mockedDisconnect.mockReturnValue(mutation({ mutate }))
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(mutate).not.toHaveBeenCalled()
  })

  it('announces disconnect failures through the feedback provider and retains account controls', async () => {
    const mutate = vi.fn((_v: undefined, opts?: { onError?: (e: Error) => void }) => {
      opts?.onError?.(new Error('Tesla disconnect unavailable'))
    })
    mockedDisconnect.mockReturnValue(mutation({ mutate }))
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }))

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Disconnect failed')).toBeInTheDocument()
    expect(within(alert).getByText('Tesla disconnect unavailable')).toBeInTheDocument()
    expect(alert).toHaveAttribute('aria-live', 'assertive')
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh token' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Sync vehicles' })).toBeEnabled()
    expect(screen.queryByText('Tesla account disconnected')).not.toBeInTheDocument()
  })
})

describe('TeslaAccountSection — Tesla auth expiry/recovery mirroring', () => {
  it('flips the pill to "Disconnected" when a token-expired event fires', () => {
    mockedAuthStatus.mockReturnValue(authState({ authenticated: true }))
    renderSection()
    expect(screen.getByText('Connected')).toBeInTheDocument()

    act(() => {
      document.dispatchEvent(new CustomEvent('teslasync:tesla-auth-expired'))
    })

    expect(screen.getByText('Disconnected')).toBeInTheDocument()
    expect(
      screen.getByText('Reconnect to resume live data and commands.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Connected')).not.toBeInTheDocument()
  })

  it('restores the connected pill when a recovered event follows', () => {
    mockedAuthStatus.mockReturnValue(authState({ authenticated: true }))
    renderSection()

    act(() => {
      document.dispatchEvent(new CustomEvent('teslasync:tesla-auth-expired'))
    })
    expect(screen.getByText('Disconnected')).toBeInTheDocument()

    act(() => {
      document.dispatchEvent(new CustomEvent('teslasync:tesla-auth-recovered'))
    })
    expect(screen.getByText('Connected')).toBeInTheDocument()
  })

  it('emits a recovery event only on the unauthenticated → authenticated edge', () => {
    const recovered = vi.fn()
    document.addEventListener('teslasync:tesla-auth-recovered', recovered)
    try {
      mockedAuthStatus.mockReturnValue(authState({ authenticated: false }))
      const { rerender } = renderSection()
      expect(recovered).not.toHaveBeenCalled()

      mockedAuthStatus.mockReturnValue(authState({ authenticated: true }))
      act(() => {
        rerender()
      })
      expect(recovered).toHaveBeenCalledTimes(1)
    } finally {
      document.removeEventListener('teslasync:tesla-auth-recovered', recovered)
    }
  })

  it('does not emit recovery on the first successful load (undefined → authenticated)', () => {
    const recovered = vi.fn()
    document.addEventListener('teslasync:tesla-auth-recovered', recovered)
    try {
      mockedAuthStatus.mockReturnValue(authState(undefined))
      const { rerender } = renderSection()

      mockedAuthStatus.mockReturnValue(authState({ authenticated: true }))
      act(() => {
        rerender()
      })
      // prevAuth was null (never observed as `false`), so no false→true edge.
      expect(recovered).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('teslasync:tesla-auth-recovered', recovered)
    }
  })
})
