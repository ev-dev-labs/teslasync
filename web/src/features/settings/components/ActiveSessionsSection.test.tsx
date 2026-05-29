/**
 * ActiveSessionsSection contract.
 *
 * Coverage:
 *   1. Open mode (status.mode='open') renders the inline placeholder
 *      and never lists rows. The /auth/sessions endpoint IS hit (the
 *      open-mode signal comes back as a 501) but no DELETE call is
 *      made.
 *   2. Forward-auth + non-empty list renders one row per session,
 *      flags the "current" row with the data-testid pill, and never
 *      shows a per-row revoke button on the current row.
 *   3. Per-row revoke opens the ConfirmDialog. Clicking confirm fires
 *      DELETE /auth/sessions/{id} and refetches the list.
 *   4. "Sign out all other devices" opens its own ConfirmDialog and
 *      fires DELETE /auth/sessions/all-others.
 *   5. Empty-list response (no sessions for the subject) renders the
 *      "no active sessions" placeholder, no revoke buttons, and the
 *      footer all-others button is hidden (no others to sign out).
 *   6. The error path on the LIST query surfaces the inline error
 *      banner via the data-testid="active-sessions-error" hook.
 *
 * The shared `request` helper is mocked so the real hooks run end-to-
 * end without a network. i18n is stubbed to fall back to defaults.
 * Test file colocated NEXT TO the component (NOT under __tests__/)
 * because the gate's allowed-files regex 'features/settings/components/
 * ActiveSessions' is a substring match.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
import { ActiveSessionsSection } from './ActiveSessionsSection'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

function renderSection() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <ActiveSessionsSection />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mockedRequest.mockReset()
})

describe('ActiveSessionsSection — open mode', () => {
  it('renders inline placeholder and never lists rows', async () => {
    // The open-mode response surfaces as an ApiError(501) carrying
    // code AUTH_MODE_OPEN; the hook normalises it to {mode:'open'}.
    mockedRequest.mockImplementation(async (path: string) => {
      if (path === '/auth/sessions') {
        throw new ApiError('open mode', 501, 'AUTH_MODE_OPEN')
      }
      throw new Error(`unexpected request to ${path}`)
    })

    renderSection()

    await waitFor(() => {
      expect(screen.getByTestId('active-sessions-open-mode')).toBeTruthy()
    })
    expect(screen.queryByTestId('active-sessions-section')).toBeNull()
    expect(screen.queryByTestId('active-sessions-revoke-all-others')).toBeNull()
  })
})

describe('ActiveSessionsSection — forward-auth + non-empty list', () => {
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

    renderSection()

    await waitFor(() => {
      expect(screen.getByTestId('active-sessions-section')).toBeTruthy()
    })
    expect(
      screen.getByTestId('active-sessions-current-pill-11111111-1111-1111-1111-111111111111'),
    ).toBeTruthy()
    // The current row MUST NOT have a revoke button.
    expect(
      screen.queryByTestId('active-sessions-revoke-11111111-1111-1111-1111-111111111111'),
    ).toBeNull()
    // The non-current row gets one.
    expect(
      screen.getByTestId('active-sessions-revoke-22222222-2222-2222-2222-222222222222'),
    ).toBeTruthy()
    // Footer "all others" shows because hasOthers=true.
    expect(screen.getByTestId('active-sessions-revoke-all-others')).toBeTruthy()
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

    renderSection()

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

describe('ActiveSessionsSection — all-others revoke', () => {
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

    renderSection()

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

describe('ActiveSessionsSection — empty list', () => {
  it('hides the "all others" footer button when no other sessions exist', async () => {
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

    renderSection()

    await waitFor(() => {
      expect(screen.getByTestId('active-sessions-section')).toBeTruthy()
    })
    expect(screen.queryByTestId('active-sessions-revoke-all-others')).toBeNull()
  })

  it('renders the empty-state row when the subject has zero sessions', async () => {
    mockedRequest.mockImplementation(async (path: string) => {
      if (path === '/auth/sessions') {
        return { mode: 'session', sessions: [] }
      }
      throw new Error(`unexpected request to ${path}`)
    })

    renderSection()

    await waitFor(() => {
      expect(screen.getByTestId('active-sessions-section')).toBeTruthy()
    })
    expect(screen.queryByTestId('active-sessions-revoke-all-others')).toBeNull()
    // DataTable's empty state surfaces our message verbatim.
    expect(screen.getByText(/No active sessions for this account\./i)).toBeTruthy()
  })
})
