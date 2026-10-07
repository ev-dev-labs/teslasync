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

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <ActiveSessionsPage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockedRequest.mockReset()
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
      expect(screen.getByText(/No active sessions for this account\./i)).toBeTruthy()
    })
    expect(screen.getByTestId('active-sessions-section')).toBeTruthy()
    expect(screen.queryByTestId('active-sessions-revoke-all-others')).toBeNull()
  })
})
