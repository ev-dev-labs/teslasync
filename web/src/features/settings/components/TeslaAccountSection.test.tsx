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
import { ToastProvider } from '@/components/feedback/Toast'
import { TeslaAccountSection } from './TeslaAccountSection'

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
  return { data: auth }
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

function tree() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <TeslaAccountSection />
      </ToastProvider>
    </QueryClientProvider>
  )
}

function renderSection() {
  const utils = render(tree())
  return { ...utils, rerender: () => utils.rerender(tree()) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedAuthStatus.mockReturnValue(authState(undefined))
  mockedAuthURL.mockReturnValue(mutation())
  mockedRefresh.mockReturnValue(mutation())
  mockedDisconnect.mockReturnValue(mutation())
  mockedSync.mockReturnValue(mutation())
})

describe('TeslaAccountSection — header + connection status region', () => {
  it('always renders the panel heading and subtitle', () => {
    renderSection()
    expect(screen.getByText('Tesla Account')).toBeInTheDocument()
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
  it('shows "Not connected" and only the connect action while auth is loading', () => {
    mockedAuthStatus.mockReturnValue(authState(undefined))
    renderSection()
    expect(screen.getByText('Not connected')).toBeInTheDocument()
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(
      screen.getByRole('button', { name: 'Connect Tesla Account' }),
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
      screen.queryByRole('button', { name: 'Refresh Token' }),
    ).not.toBeInTheDocument()
  })
})

describe('TeslaAccountSection — connected branch', () => {
  it('renders the full authenticated action set and hides the connect CTA', () => {
    mockedAuthStatus.mockReturnValue(authState({ authenticated: true }))
    renderSection()

    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh Token' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sync Vehicles' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Re-authorize' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Connect Tesla Account' }),
    ).not.toBeInTheDocument()
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

    fireEvent.click(screen.getByRole('button', { name: 'Connect Tesla Account' }))

    expect(mutate).toHaveBeenCalledTimes(1)
    expect(window.location.href).toBe('https://auth.tesla.com/oauth2/v3/authorize')
  })

  it('does NOT navigate when the success payload lacks an auth_url', () => {
    const mutate = vi.fn((_v: undefined, opts?: { onSuccess?: (d: { auth_url?: string }) => void }) => {
      opts?.onSuccess?.({})
    })
    mockedAuthURL.mockReturnValue(mutation({ mutate }))
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'Connect Tesla Account' }))

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
    const button = screen.getByRole('button', { name: 'Connect Tesla Account' })
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

    fireEvent.click(screen.getByRole('button', { name: 'Refresh Token' }))

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

    fireEvent.click(screen.getByRole('button', { name: 'Refresh Token' }))
    expect(await screen.findByText('Token refreshed')).toBeInTheDocument()
  })

  it('shows an error toast carrying the failure message when the refresh rejects', async () => {
    const mutate = vi.fn((_v: undefined, opts?: { onError?: (e: Error) => void }) => {
      opts?.onError?.(new Error('token endpoint 500'))
    })
    mockedRefresh.mockReturnValue(mutation({ mutate }))
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh Token' }))
    expect(await screen.findByText('Token refresh failed')).toBeInTheDocument()
    expect(screen.getByText('token endpoint 500')).toBeInTheDocument()
  })

  it('disables the refresh button while a refresh is in flight', () => {
    mockedRefresh.mockReturnValue(mutation({ isPending: true }))
    renderSection()
    expect(screen.getByRole('button', { name: 'Refresh Token' })).toBeDisabled()
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

    fireEvent.click(screen.getByRole('button', { name: 'Sync Vehicles' }))
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

    fireEvent.click(screen.getByRole('button', { name: 'Sync Vehicles' }))
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
    expect(screen.getByRole('button', { name: 'Sync Vehicles' })).toBeDisabled()
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
    expect(within(dialog).getByText('Disconnect Tesla Account?')).toBeInTheDocument()
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
