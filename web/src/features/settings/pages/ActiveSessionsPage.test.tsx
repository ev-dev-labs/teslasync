/**
 * ActiveSessionsPage contract.
 *
 * Migrated from the old `ActiveSessionsSection.test.tsx` when the sessions
 * experience was promoted into a full modern-UI page (KPI band + device
 * breakdown bento + active-devices table). The behavioural contract is
 * unchanged — same endpoints, same data-testids, same confirm-dialog copy —
 * so the assertions below mirror the originals; only the render target (the
 * whole page) and the "wait for data-dependent element" style changed, since
 * the redesigned page keeps every section panel mounted (with skeletons)
 * during the initial load instead of swapping the whole body for a spinner.
 *
 * Coverage:
 *   1. Open mode (AUTH_MODE_OPEN 501) renders the inline placeholder and never
 *      lists rows or the all-others action.
 *   2. Forward-auth + non-empty list renders one row per session, flags the
 *      "current" row, and never shows a per-row revoke button on it.
 *   3. Per-row revoke opens the ConfirmDialog and fires DELETE
 *      /auth/sessions/{id} on confirm.
 *   4. "Sign out all other devices" opens its own ConfirmDialog and fires
 *      DELETE /auth/sessions/all-others.
 *   5. Empty / single-current lists hide the all-others action and surface the
 *      DataTable empty placeholder.
 *
 * The shared `request` helper is mocked so the real hooks run end-to-end
 * without a network; i18n is stubbed to fall back to defaults.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return {
    ...actual,
    request: vi.fn(),
    setCachedSudoToken: vi.fn(),
  }
})

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
        const fallback =
          typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined
        const opts =
          typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
            ? (fallbackOrOpts as Record<string, unknown>)
            : (maybeOpts as Record<string, unknown> | undefined)
        // Inline interpolation just enough for this test surface
        // ({{device}} is the only variable we use).
        const interpolate = (s: string) => {
          if (!opts) return s
          return Object.keys(opts).reduce(
            (acc, k) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(opts[k])),
            s,
          )
        }
        if (opts && typeof opts.defaultValue === 'string') {
          return interpolate(opts.defaultValue)
        }
        if (fallback != null) return interpolate(fallback)
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { request, ApiError } from '@/api/client'
import { ToastProvider } from '@/components/feedback/Toast'
import ActiveSessionsPage from './ActiveSessionsPage'
import { sessionKeys } from '@/api/hooks/useSessions'
import { authModeKeys } from '@/api/hooks/useAuthMode'
import { subscribeAnnouncer } from '@/hooks/useAnnouncer'
import { __resetStatusAnnouncerForTests } from '@/hooks/useStatusAnnouncer'
import { __resetAnnouncePolicyForTests } from '@/lib/announcePolicy'
import type { ActiveSession, ActiveSessionsResponse, AuthModeResponse } from '@/api/types'

const availableAuth: AuthModeResponse = {
  mode: 'forward_auth',
  subject: 'session-test',
  capabilities: {
    session_list: true, step_up_reauth: true, totp_enrollment: true,
    impersonation: true, rbac: true,
  },
}

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  qc.setQueryData(authModeKeys.all, availableAuth)
  const rendered = render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <ActiveSessionsPage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
  return { ...rendered, client: qc }
}

beforeEach(() => {
  mockedRequest.mockReset()
  __resetStatusAnnouncerForTests()
  __resetAnnouncePolicyForTests()
})

afterEach(() => {
  __resetStatusAnnouncerForTests()
})

describe('ActiveSessionsPage — load announcements', () => {
  it.each(['populated', 'empty', 'failure'] as const)(
    'announces the %s initial outcome once without replacing section shells',
    async (outcome) => {
      const response = {
        mode: 'session',
        sessions: outcome === 'populated' ? [
          { id: 'announced-current', user_agent: 'Firefox', ip: '10.0.0.1', current: true,
            created_at: '2026-05-05T10:00:00Z', last_seen_at: '2026-05-05T12:00:00Z' },
        ] : [],
      }
      let resolveSessions!: (value: typeof response) => void
      let rejectSessions!: (reason: Error) => void
      mockedRequest.mockImplementation(() => new Promise<typeof response>((resolve, reject) => {
        resolveSessions = resolve
        rejectSessions = reject
      }))
      const announcement = vi.fn()
      const unsubscribe = subscribeAnnouncer(announcement)
      try {
        const { client, container } = renderPage()
        await waitFor(() => expect(client.getQueryState(sessionKeys.list)?.fetchStatus).toBe('fetching'))
        const page = container.querySelector('[data-role="page-container"]')
        const summary = screen.getByRole('region', { name: 'Session summary' })
        const devices = screen.getByTestId('active-sessions-section')
        expect(page).toHaveAttribute('aria-busy', 'true')
        expect(screen.getByText('By browser')).toBeInTheDocument()
        expect(screen.getByText('By platform')).toBeInTheDocument()
        expect(screen.getByText('By network')).toBeInTheDocument()
        expect(announcement).not.toHaveBeenCalled()

        await act(async () => {
          if (outcome === 'failure') rejectSessions(new Error('Sessions unavailable'))
          else resolveSessions(response)
        })
        await waitFor(() => expect(announcement).toHaveBeenCalledTimes(1))
        const message = outcome === 'failure'
          ? 'Could not refresh Active sessions'
          : outcome === 'empty'
            ? 'No Active sessions to show'
            : 'Active sessions loaded, 1 item'
        expect(announcement).toHaveBeenCalledWith(
          expect.stringContaining(message),
          outcome === 'failure' ? 'assertive' : 'polite',
        )
        expect(page).not.toHaveAttribute('aria-busy')
        expect(screen.getByRole('region', { name: 'Session summary' })).toBe(summary)
        expect(screen.getByTestId('active-sessions-section')).toBe(devices)
        expect(screen.getByText('By browser')).toBeInTheDocument()
        expect(screen.getByText('By platform')).toBeInTheDocument()
        expect(screen.getByText('By network')).toBeInTheDocument()

        if (outcome === 'populated') {
          expect(screen.getByTestId('active-sessions-current-pill-announced-current')).toBeInTheDocument()
          act(() => {
            void client.invalidateQueries({ queryKey: sessionKeys.list })
          })
          await waitFor(() => expect(page).toHaveAttribute('aria-busy', 'true'))
          expect(screen.getByTestId('active-sessions-current-pill-announced-current')).toBeInTheDocument()
          await act(async () => resolveSessions(response))
          await waitFor(() => expect(page).not.toHaveAttribute('aria-busy'))
          expect(announcement).toHaveBeenCalledTimes(1)
        }
      } finally {
        unsubscribe()
      }
    },
  )
})

describe('ActiveSessionsPage — open mode', () => {
  it('renders inline placeholder and never lists rows', async () => {
    // The open-mode response surfaces as an ApiError(501) carrying
    // code AUTH_MODE_OPEN; the hook normalises it to {mode:'open'}.
    mockedRequest.mockImplementation(async (path: string) => {
      if (path === '/auth/sessions') {
        throw new ApiError('open mode', 501, 'AUTH_MODE_OPEN')
      }
      throw new Error(`unexpected request to ${path}`)
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('active-sessions-open-mode')).toBeTruthy()
    })
    expect(screen.queryByTestId('active-sessions-section')).toBeNull()
    expect(screen.queryByTestId('active-sessions-revoke-all-others')).toBeNull()
  })
})

describe('ActiveSessionsPage — forward-auth + non-empty list', () => {
  it('renders one row per session and flags the current row', async () => {
    mockedRequest.mockImplementation(async (path: string) => {
      if (path === '/auth/sessions') {
        return {
          mode: 'session',
          sessions: [
            {
              id: '11111111-1111-1111-1111-111111111111',
              user_agent: 'Mozilla/5.0 (Windows NT 10.0) Firefox/120.0',
              ip: '10.1.1.1',
              created_at: '2026-05-05T10:00:00Z',
              last_seen_at: '2026-05-05T12:00:00Z',
              current: true,
            },
            {
              id: '22222222-2222-2222-2222-222222222222',
              user_agent: 'Mozilla/5.0 (Macintosh) Chrome/120.0',
              ip: '10.2.2.2',
              created_at: '2026-05-04T08:00:00Z',
              last_seen_at: '2026-05-05T11:30:00Z',
              current: false,
            },
          ],
        }
      }
      throw new Error(`unexpected request to ${path}`)
    })

    renderPage()

    // Wait for a data-dependent element — the current pill only renders once
    // the list query resolves and the DataTable paints its rows.
    await waitFor(() => {
      expect(
        screen.getByTestId('active-sessions-current-pill-11111111-1111-1111-1111-111111111111'),
      ).toBeTruthy()
    })
    expect(screen.getByTestId('active-sessions-section')).toBeTruthy()
    // The current row MUST NOT have a revoke button.
    expect(
      screen.queryByTestId('active-sessions-revoke-11111111-1111-1111-1111-111111111111'),
    ).toBeNull()
    // The non-current row gets one.
    expect(
      screen.getByTestId('active-sessions-revoke-22222222-2222-2222-2222-222222222222'),
    ).toBeTruthy()
    // Header "all others" shows because hasOthers=true.
    expect(screen.getByTestId('active-sessions-revoke-all-others')).toBeTruthy()
    expect(screen.getByTestId('active-sessions-revoke-all-others').closest('[data-action-group="destructive"]')).not.toBeNull()
  })

  it('per-row revoke opens confirm and fires DELETE on confirm', async () => {
    mockedRequest.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/auth/sessions' && (!init || init.method !== 'DELETE')) {
        return {
          mode: 'session',
          sessions: [
            {
              id: 'aaaa1111-1111-1111-1111-111111111111',
              user_agent: 'Firefox',
              ip: '1.2.3.4',
              created_at: '2026-05-05T10:00:00Z',
              last_seen_at: '2026-05-05T12:00:00Z',
              current: true,
            },
            {
              id: 'bbbb2222-2222-2222-2222-222222222222',
              user_agent: 'Chrome',
              ip: '5.6.7.8',
              created_at: '2026-05-04T08:00:00Z',
              last_seen_at: '2026-05-05T11:30:00Z',
              current: false,
            },
          ],
        }
      }
      if (
        path === '/auth/sessions/bbbb2222-2222-2222-2222-222222222222' &&
        init?.method === 'DELETE'
      ) {
        return undefined
      }
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${path}`)
    })

    renderPage()

    await waitFor(() => {
      expect(
        screen.getByTestId('active-sessions-revoke-bbbb2222-2222-2222-2222-222222222222'),
      ).toBeTruthy()
    })

    fireEvent.click(
      screen.getByTestId('active-sessions-revoke-bbbb2222-2222-2222-2222-222222222222'),
    )

    // Confirm dialog opens — locate it via the dialog role + scope to
    // avoid colliding with row-level "Sign out" buttons.
    const dialog = await screen.findByRole('dialog')
    const confirmBtn = within(dialog).getByRole('button', { name: /^Sign out$/ })
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      const deleteCall = mockedRequest.mock.calls.find(
        (call) =>
          call[0] === '/auth/sessions/bbbb2222-2222-2222-2222-222222222222' &&
          call[1]?.method === 'DELETE',
      )
      expect(deleteCall).toBeTruthy()
    })
  })
})

describe('ActiveSessionsPage — all-others revoke', () => {
  it('opens confirm and fires DELETE /auth/sessions/all-others', async () => {
    mockedRequest.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/auth/sessions' && (!init || init.method !== 'DELETE')) {
        return {
          mode: 'session',
          sessions: [
            {
              id: 'cccc1111-1111-1111-1111-111111111111',
              user_agent: 'Firefox',
              ip: '1.2.3.4',
              created_at: '2026-05-05T10:00:00Z',
              last_seen_at: '2026-05-05T12:00:00Z',
              current: true,
            },
            {
              id: 'dddd2222-2222-2222-2222-222222222222',
              user_agent: 'Chrome',
              ip: '5.6.7.8',
              created_at: '2026-05-04T08:00:00Z',
              last_seen_at: '2026-05-05T11:30:00Z',
              current: false,
            },
          ],
        }
      }
      if (path === '/auth/sessions/all-others' && init?.method === 'DELETE') {
        return { mode: 'session', revoked: 1 }
      }
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${path}`)
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('active-sessions-revoke-all-others')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('active-sessions-revoke-all-others'))

    const dialog = await screen.findByRole('dialog')
    const confirmBtn = within(dialog).getByRole('button', { name: /^Sign out all others$/ })
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      const deleteCall = mockedRequest.mock.calls.find(
        (call) =>
          call[0] === '/auth/sessions/all-others' && call[1]?.method === 'DELETE',
      )
      expect(deleteCall).toBeTruthy()
    })
  })
})

describe('ActiveSessionsPage — confirmation scope', () => {
  const current: ActiveSession = {
    id: 'scope-current', user_agent: 'Firefox', ip: '10.0.0.1', current: true,
    created_at: '2026-05-05T10:00:00Z', last_seen_at: '2026-05-05T12:00:00Z',
  }
  const other: ActiveSession = {
    ...current, id: 'scope-other', user_agent: 'Chrome', current: false,
  }
  const replacement: ActiveSession = { ...other, id: 'scope-replacement' }
  const cases: { name: string; action: 'session' | 'all-others'; updated: ActiveSessionsResponse }[] = [
    { name: 'row mode becomes open', action: 'session', updated: { mode: 'open' } },
    { name: 'row disappears without retargeting', action: 'session',
      updated: { mode: 'session', sessions: [current, replacement] } },
    { name: 'row becomes current', action: 'session',
      updated: { mode: 'session', sessions: [{ ...current, current: false }, { ...other, current: true }] } },
    { name: 'row is revoked', action: 'session',
      updated: { mode: 'session', sessions: [current, { ...other, revoked_at: '2026-05-05T13:00:00Z' }] } },
    { name: 'row identity is replaced', action: 'session',
      updated: { mode: 'session', sessions: [current, { ...other, created_at: '2026-05-06T10:00:00Z' }] } },
    { name: 'current device scope changes', action: 'session',
      updated: { mode: 'session', sessions: [{ ...current, id: 'new-current' }, other] } },
    { name: 'bulk mode becomes open', action: 'all-others', updated: { mode: 'open' } },
    { name: 'bulk has no remaining targets', action: 'all-others',
      updated: { mode: 'session', sessions: [current] } },
    { name: 'bulk target is replaced', action: 'all-others',
      updated: { mode: 'session', sessions: [current, replacement] } },
    { name: 'bulk scope expands', action: 'all-others',
      updated: { mode: 'session', sessions: [current, other, replacement] } },
    { name: 'bulk current device changes', action: 'all-others',
      updated: { mode: 'session', sessions: [{ ...current, current: false }, { ...other, current: true }] } },
  ]

  it.each(cases)('blocks submission when $name, including before a cache update renders', async ({ action, updated }) => {
    mockedRequest.mockResolvedValue({ mode: 'session', sessions: [current, other] })
    const { client } = renderPage()
    const trigger = await screen.findByTestId(
      action === 'session' ? 'active-sessions-revoke-scope-other' : 'active-sessions-revoke-all-others',
    )
    fireEvent.click(trigger)
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', {
      name: action === 'session' ? /^Sign out$/ : /^Sign out all others$/,
    })
    expect(confirm).toBeEnabled()
    act(() => {
      client.setQueryData<ActiveSessionsResponse>(sessionKeys.list, updated)
      fireEvent.click(confirm)
    })

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The session mode or selected devices changed. Nothing was signed out.',
    )
    expect(confirm).toBeDisabled()
    expect(mockedRequest.mock.calls.some(call => call[1]?.method === 'DELETE')).toBe(false)
    act(() => {
      client.setQueryData<ActiveSessionsResponse>(sessionKeys.list, { mode: 'session', sessions: [current, other] })
    })
    expect(confirm).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('button', {
      name: action === 'session' ? 'Keep signed in' : 'Cancel',
    }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    fireEvent.click(await screen.findByTestId(
      action === 'session' ? 'active-sessions-revoke-scope-other' : 'active-sessions-revoke-all-others',
    ))
    expect(within(await screen.findByRole('dialog')).getByRole('button', {
      name: action === 'session' ? /^Sign out$/ : /^Sign out all others$/,
    })).toBeEnabled()
  })

  it.each(['session', 'all-others'] as const)(
    'preserves %s confirmation through activity updates and row reordering',
    async action => {
      mockedRequest.mockImplementation(async (_path: string, init?: RequestInit) =>
        init?.method === 'DELETE'
          ? { mode: 'session', revoked: 1 }
          : { mode: 'session', sessions: [current, other] },
      )
      const { client } = renderPage()
      fireEvent.click(await screen.findByTestId(
        action === 'session' ? 'active-sessions-revoke-scope-other' : 'active-sessions-revoke-all-others',
      ))
      const dialog = await screen.findByRole('dialog')
      act(() => {
        client.setQueryData<ActiveSessionsResponse>(sessionKeys.list, {
          mode: 'session', sessions: [{ ...other, last_seen_at: '2026-05-05T13:00:00Z' }, current],
        })
      })
      fireEvent.click(within(dialog).getByRole('button', {
        name: action === 'session' ? /^Sign out$/ : /^Sign out all others$/,
      }))
      await waitFor(() => expect(mockedRequest).toHaveBeenCalledWith(
        action === 'session' ? '/auth/sessions/scope-other' : '/auth/sessions/all-others',
        { method: 'DELETE' },
      ))
    },
  )
})

describe('ActiveSessionsPage — empty list', () => {
  it('hides the "all others" action when no other sessions exist', async () => {
    mockedRequest.mockImplementation(async (path: string) => {
      if (path === '/auth/sessions') {
        return {
          mode: 'session',
          sessions: [
            {
              id: 'eeee1111-1111-1111-1111-111111111111',
              user_agent: 'Firefox',
              ip: '1.2.3.4',
              created_at: '2026-05-05T10:00:00Z',
              last_seen_at: '2026-05-05T12:00:00Z',
              current: true,
            },
          ],
        }
      }
      throw new Error(`unexpected request to ${path}`)
    })

    renderPage()

    // Wait for the single row's current pill so the query has resolved.
    await waitFor(() => {
      expect(
        screen.getByTestId('active-sessions-current-pill-eeee1111-1111-1111-1111-111111111111'),
      ).toBeTruthy()
    })
    expect(screen.getByTestId('active-sessions-section')).toBeTruthy()
    expect(screen.queryByTestId('active-sessions-revoke-all-others')).toBeNull()
  })

  it('renders the empty-state row when the subject has zero sessions', async () => {
    mockedRequest.mockImplementation(async (path: string) => {
      if (path === '/auth/sessions') {
        return { mode: 'session', sessions: [] }
      }
      throw new Error(`unexpected request to ${path}`)
    })

    renderPage()

    // DataTable's empty state surfaces our message verbatim once the query
    // resolves (during load it shows a skeleton instead).
    await waitFor(() => {
      expect(screen.getByText(/No Active sessions for this account\./i)).toBeTruthy()
    })
    expect(screen.getByTestId('active-sessions-section')).toBeTruthy()
    expect(screen.queryByTestId('active-sessions-revoke-all-others')).toBeNull()
  })
})

describe('ActiveSessionsPage — retained source', () => {
  it('keeps device rows and breakdowns but defers revocation after refresh failure', async () => {
    mockedRequest.mockResolvedValue({
      mode: 'session',
      sessions: [
        { id: 'retained-current', user_agent: 'Firefox', ip: '10.0.0.1', current: true,
          created_at: '2026-05-05T10:00:00Z', last_seen_at: '2026-05-05T12:00:00Z' },
        { id: 'retained-other', user_agent: 'Chrome', ip: '10.0.0.2', current: false,
          created_at: '2026-05-04T10:00:00Z', last_seen_at: '2026-05-05T11:00:00Z' },
      ],
    })
    const { client, container } = renderPage()
    await screen.findByTestId('active-sessions-revoke-retained-other')
    expect(container.querySelector('[data-layout-reference]')).not.toBeNull()

    mockedRequest.mockRejectedValue(new Error('Refresh unavailable'))
    await act(async () => {
      await client.invalidateQueries({ queryKey: sessionKeys.list })
    })
    await waitFor(() => expect(client.getQueryState(sessionKeys.list)?.status).toBe('error'))

    expect(await screen.findByText('Data may be stale')).toBeInTheDocument()
    expect(screen.getByTestId('active-sessions-current-pill-retained-current')).toBeInTheDocument()
    expect(screen.getByTestId('active-sessions-revoke-retained-other')).toBeInTheDocument()
    expect(screen.getByText('By browser')).toBeInTheDocument()
    expect(screen.getByText('By platform')).toBeInTheDocument()
    expect(screen.getByText('By network')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('active-sessions-revoke-retained-other'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('active-sessions-deferred')).toHaveTextContent('The latest values are temporarily unavailable.')
    expect(screen.getByTestId('active-sessions-revoke-all-others')).toBeDisabled()
    expect(mockedRequest.mock.calls.some(call => call[1]?.method === 'DELETE')).toBe(false)
  })
})

describe('ActiveSessionsPage — revocation readiness', () => {
  const sessions: ActiveSession[] = [
    { id: 'ready-current', user_agent: 'Firefox', ip: '10.0.0.1', current: true,
      created_at: '2026-05-05T10:00:00Z', last_seen_at: '2026-05-05T12:00:00Z' },
    { id: 'ready-other', user_agent: 'Chrome', ip: '10.0.0.2', current: false,
      created_at: '2026-05-04T10:00:00Z', last_seen_at: '2026-05-05T11:00:00Z' },
  ]

  afterEach(() => {
    vi.restoreAllMocks()
    window.history.replaceState(null, '', '/')
  })

  it.each(['session_list', 'step_up_reauth'] as const)(
    'retains metadata but refuses entry when %s is unavailable',
    async capability => {
      mockedRequest.mockResolvedValue({ mode: 'session', sessions })
      const { client } = renderPage()
      await screen.findByTestId('active-sessions-revoke-ready-other')
      act(() => {
        client.setQueryData(authModeKeys.all, {
          ...availableAuth,
          capabilities: { ...availableAuth.capabilities, [capability]: false },
        })
        fireEvent.click(screen.getByTestId('active-sessions-revoke-ready-other'))
      })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.getByTestId('active-sessions-current-pill-ready-current')).toBeInTheDocument()
      // The IP also appears in the "By network" breakdown; scope to the
      // device table whose row metadata this test retains.
      expect(within(screen.getByTestId('active-sessions-section')).getByText('10.0.0.2')).toBeInTheDocument()
      expect(screen.getByTestId('active-sessions-deferred')).toHaveTextContent('not available with the current server or deployment configuration')
      expect(mockedRequest.mock.calls.some(call => call[1]?.method === 'DELETE')).toBe(false)
    },
  )

  it.each(['session', 'all-others'] as const)(
    'rechecks %s readiness at final confirm before cache changes render',
    async action => {
      for (const change of ['capability', 'auth-failure', 'paused', 'refresh-failure', 'refreshing', 'offline', 'historical'] as const) {
        mockedRequest.mockResolvedValue({ mode: 'session', sessions })
        const { client, unmount } = renderPage()
        fireEvent.click(await screen.findByTestId(action === 'session'
          ? 'active-sessions-revoke-ready-other' : 'active-sessions-revoke-all-others'))
        const dialog = await screen.findByRole('dialog')
        const confirm = within(dialog).getByRole('button', {
          name: action === 'session' ? /^Sign out$/ : /^Sign out all others$/,
        })
        expect(confirm).toBeEnabled()
        act(() => {
          if (change === 'capability') {
            client.setQueryData(authModeKeys.all, {
              ...availableAuth, capabilities: { ...availableAuth.capabilities, session_list: false },
            })
          } else if (change === 'auth-failure') {
            client.getQueryCache().find({ queryKey: authModeKeys.all })?.setState({
              status: 'error', error: new ApiError('Forbidden', 403),
            })
          } else if (change === 'offline') {
            vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
          } else if (change === 'historical') {
            window.history.replaceState(null, '', '?as_of=2026-05-05T10:00:00Z')
          } else {
            client.getQueryCache().find({ queryKey: sessionKeys.list })?.setState(
              change === 'refresh-failure'
                ? { status: 'error', error: new Error('Refresh failed') }
                : { fetchStatus: change === 'paused' ? 'paused' : 'fetching' },
            )
          }
          fireEvent.click(confirm)
        })
        expect(await within(dialog).findByRole('alert')).not.toHaveTextContent('selected devices changed')
        expect(confirm).toBeDisabled()
        expect(screen.getByTestId('active-sessions-current-pill-ready-current')).toBeInTheDocument()
        expect(mockedRequest.mock.calls.some(call => call[1]?.method === 'DELETE')).toBe(false)
        unmount()
        client.clear()
        vi.restoreAllMocks()
        window.history.replaceState(null, '', '/')
      }
    },
  )
})

describe('ActiveSessionsPage — deferred loading', () => {
  it('distinguishes a paused first load from an active request while preserving shells', async () => {
    const response = {
      mode: 'session',
      sessions: [
        { id: 'resumed-current', user_agent: 'Firefox', ip: '10.0.0.1', current: true,
          created_at: '2026-05-05T10:00:00Z', last_seen_at: '2026-05-05T12:00:00Z' },
      ],
    }
    let resolveSessions!: (value: typeof response) => void
    mockedRequest.mockImplementation(() => new Promise<typeof response>((resolve) => {
      resolveSessions = resolve
    }))
    const { client } = renderPage()

    await waitFor(() => expect(client.getQueryState(sessionKeys.list)?.fetchStatus).toBe('fetching'))
    expect(screen.queryByTestId('active-sessions-paused')).not.toBeInTheDocument()
    act(() => {
      client.getQueryCache().find({ queryKey: sessionKeys.list })?.setState({ fetchStatus: 'paused' })
    })

    const notice = await screen.findByTestId('active-sessions-paused')
    expect(notice).toHaveTextContent('Paused')
    expect(within(notice).getByRole('button', { name: 'Retry' })).toBeEnabled()
    expect(notice).not.toHaveTextContent(/offline|server error/i)
    expect(screen.getByRole('region', { name: 'Session summary' })).toBeInTheDocument()
    expect(screen.getByText('By browser')).toBeInTheDocument()
    expect(screen.getByText('By platform')).toBeInTheDocument()
    expect(screen.getByText('By network')).toBeInTheDocument()
    expect(screen.getByTestId('active-sessions-section')).toBeInTheDocument()
    expect(screen.queryByText('No active sessions for this account.')).not.toBeInTheDocument()
    expect(screen.queryByTestId('active-sessions-revoke-all-others')).not.toBeInTheDocument()
    expect(client.getQueryState(sessionKeys.list)?.error).toBeNull()

    act(() => {
      client.getQueryCache().find({ queryKey: sessionKeys.list })?.setState({ fetchStatus: 'fetching' })
    })
    await waitFor(() => expect(screen.queryByTestId('active-sessions-paused')).not.toBeInTheDocument())
    await act(async () => resolveSessions(response))
    expect(await screen.findByTestId('active-sessions-current-pill-resumed-current')).toBeInTheDocument()
  })

  it('keeps retained devices and offers source recovery when refresh is paused', async () => {
    mockedRequest.mockResolvedValue({
      mode: 'session',
      sessions: [
        { id: 'paused-other', user_agent: 'Chrome', ip: '10.0.0.2', current: false,
          created_at: '2026-05-05T10:00:00Z', last_seen_at: '2026-05-05T12:00:00Z' },
      ],
    })
    const { client } = renderPage()
    await screen.findByTestId('active-sessions-revoke-paused-other')
    act(() => {
      client.getQueryCache().find({ queryKey: sessionKeys.list })?.setState({ fetchStatus: 'paused' })
    })

    const warning = await screen.findByTestId('stale-refresh-warning')
    expect(warning).toHaveAttribute('data-refresh-blocked', 'true')
    expect(warning).not.toHaveTextContent(/offline|server error/i)
    expect(screen.queryByTestId('active-sessions-paused')).not.toBeInTheDocument()
    expect(screen.getByTestId('active-sessions-revoke-paused-other')).toBeInTheDocument()
    expect(screen.getByTestId('active-sessions-revoke-all-others')).toBeInTheDocument()
    expect(screen.getByTestId('active-sessions-revoke-all-others')).toBeDisabled()
    fireEvent.click(screen.getByTestId('active-sessions-revoke-paused-other'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('active-sessions-deferred')).toHaveTextContent('Refresh paused')
    expect(screen.getByText('By browser')).toBeInTheDocument()
    expect(screen.getByText('By platform')).toBeInTheDocument()
    expect(screen.getByText('By network')).toBeInTheDocument()
    expect(client.getQueryState(sessionKeys.list)?.error).toBeNull()

    fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument())
    expect(screen.getByTestId('active-sessions-revoke-paused-other')).toBeInTheDocument()
  })
})
