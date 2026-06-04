import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'

/**
 * ReauthDialog contract coverage.
 *
 * Coverage:
 *   • Credential mode: password tab submission resolves the queued
 *     promise with { mode: 'session', token }.
 *   • Credential mode: TOTP tab submission resolves through the same
 *     path with { totp_code }.
 *   • Credential mode: backend INVALID_CREDENTIAL surfaces the
 *     localised error and keeps the dialog open.
 *   • Credential mode: REAUTH_NOT_CONFIGURED surfaces the
 *     "ask your administrator" message.
 *   • Confirm mode (open mode): typed confirmation resolves with
 *     { mode: 'open' } and never POSTs to /auth/reauth.
 *   • Cancel: rejects the queued promise with SudoCanceledError.
 *   • Root + queue: enqueueing a challenge opens the dialog and a
 *     successful submit resolves the awaiting Promise.
 */

type MockMonitor = {
  mode: 'open' | 'session' | 'unknown'
  hasExpired: boolean
  expiresInSeconds: number | null
  isExpiringSoon: boolean
  refresh: () => Promise<void>
}

let mockMonitor: MockMonitor

vi.mock('@/hooks/useSessionMonitor', () => ({
  useSessionMonitor: () => mockMonitor,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      defaultOrOpts?: string | Record<string, unknown>,
      maybeOpts?: Record<string, unknown>,
    ) => {
      const fallback = typeof defaultOrOpts === 'string' ? defaultOrOpts : key
      const opts =
        typeof defaultOrOpts === 'object' && defaultOrOpts != null
          ? defaultOrOpts
          : maybeOpts
      if (opts == null) return fallback
      return Object.entries(opts).reduce<string>(
        (acc, [k, v]) => acc.replaceAll(`{{${k}}}`, String(v)),
        fallback,
      )
    },
  }),
}))

// ReauthDialogRoot consults the TOTP status query to decide whether
// to show the TOTP tab and where to
// route TOTP submissions. The existing tests run without a
// QueryClientProvider, so we stub the hook with a sensible default
// that mirrors the open-mode 501 (TOTP unavailable). Individual
// tests below override `mockTotpStatus` when they need to exercise
// the per-user TOTP path.
type MockTotpStatus = {
  data: { mode: 'open' } | { mode: 'session'; activated: boolean } | undefined
  isError: boolean
  isFetched: boolean
}
let mockTotpStatus: MockTotpStatus = {
  data: { mode: 'open' },
  isError: false,
  isFetched: true,
}
vi.mock('@/api/hooks/useTOTP', () => ({
  useTOTPStatus: () => mockTotpStatus,
}))

import {
  ReauthDialog,
  ReauthDialogRoot,
  __enqueueSudoChallengeForTests,
  __resetReauthDialogForTests,
} from './ReauthDialog'
import {
  SudoCanceledError,
  __resetSudoStateForTests,
  type SudoCredential,
} from '@/api/client'

beforeEach(() => {
  mockMonitor = {
    mode: 'session',
    hasExpired: false,
    expiresInSeconds: 600,
    isExpiringSoon: false,
    refresh: () => Promise.resolve(),
  }
  mockTotpStatus = {
    data: { mode: 'open' },
    isError: false,
    isFetched: true,
  }
  __resetReauthDialogForTests()
  __resetSudoStateForTests()
})

afterEach(() => {
  __resetReauthDialogForTests()
  __resetSudoStateForTests()
  vi.restoreAllMocks()
})

describe('ReauthDialog (presentation-only)', () => {
  it('does not render when open=false', () => {
    render(
      <ReauthDialog
        open={false}
        mode="credential"
        path="/api-keys/42"
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.queryByTestId('reauth-dialog')).toBeNull()
  })

  it('credential mode: submits password and resolves with the server credential', async () => {
    const onSubmit = vi.fn()
    const fakeCred: SudoCredential = {
      mode: 'session',
      token: 'srv-token-123',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }
    const onSubmitCredential = vi.fn().mockResolvedValue(fakeCred)

    render(
      <ReauthDialog
        open
        mode="credential"
        path="/api-keys/42"
        onSubmit={onSubmit}
        onCancel={() => {}}
        onSubmitCredential={onSubmitCredential}
      />,
    )

    fireEvent.change(screen.getByTestId('reauth-password'), {
      target: { value: 'hunter2' },
    })
    fireEvent.click(screen.getByTestId('reauth-submit'))

    await waitFor(() => {
      expect(onSubmitCredential).toHaveBeenCalledWith({ password: 'hunter2' })
    })
    expect(onSubmit).toHaveBeenCalledWith(fakeCred)
  })

  it('credential mode: TOTP submission strips non-digits and POSTs totp_code', async () => {
    const onSubmit = vi.fn()
    const fakeCred: SudoCredential = { mode: 'session', token: 'tok' }
    const onSubmitCredential = vi.fn().mockResolvedValue(fakeCred)

    render(
      <ReauthDialog
        open
        mode="credential"
        path="/admin"
        onSubmit={onSubmit}
        onCancel={() => {}}
        onSubmitCredential={onSubmitCredential}
      />,
    )

    fireEvent.click(screen.getByRole('tab', { name: /Authenticator/i }))
    const totpInput = screen.getByTestId('reauth-totp') as HTMLInputElement
    fireEvent.change(totpInput, { target: { value: 'abc123-456' } })
    expect(totpInput.value).toBe('123456')
    fireEvent.click(screen.getByTestId('reauth-submit'))

    await waitFor(() => {
      expect(onSubmitCredential).toHaveBeenCalledWith({ totp_code: '123456' })
    })
    expect(onSubmit).toHaveBeenCalledWith(fakeCred)
  })

  it('credential mode: backend INVALID_CREDENTIAL surfaces the localised error', async () => {
    const onSubmit = vi.fn()
    const failure = Object.assign(new Error('invalid'), {
      code: 'INVALID_CREDENTIAL',
      status: 401,
    })
    const onSubmitCredential = vi.fn().mockRejectedValue(failure)

    render(
      <ReauthDialog
        open
        mode="credential"
        path="/x"
        onSubmit={onSubmit}
        onCancel={() => {}}
        onSubmitCredential={onSubmitCredential}
      />,
    )

    fireEvent.change(screen.getByTestId('reauth-password'), {
      target: { value: 'wrong' },
    })
    fireEvent.click(screen.getByTestId('reauth-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('reauth-error')).toBeTruthy()
    })
    expect(screen.getByTestId('reauth-error').textContent).toMatch(/Password did not match/i)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('credential mode: REAUTH_NOT_CONFIGURED surfaces the admin message', async () => {
    const onSubmit = vi.fn()
    const failure = Object.assign(new Error('boom'), {
      code: 'REAUTH_NOT_CONFIGURED',
      status: 503,
    })
    const onSubmitCredential = vi.fn().mockRejectedValue(failure)

    render(
      <ReauthDialog
        open
        mode="credential"
        path="/x"
        onSubmit={onSubmit}
        onCancel={() => {}}
        onSubmitCredential={onSubmitCredential}
      />,
    )

    fireEvent.change(screen.getByTestId('reauth-password'), {
      target: { value: 'anything' },
    })
    fireEvent.click(screen.getByTestId('reauth-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('reauth-error').textContent).toMatch(
        /TESLASYNC_SUDO_PASSWORD/i,
      )
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('confirm mode: typed-confirmation submission resolves with mode=open and skips network', () => {
    const onSubmit = vi.fn()
    const onSubmitCredential = vi.fn()

    render(
      <ReauthDialog
        open
        mode="confirm"
        path="/x"
        onSubmit={onSubmit}
        onCancel={() => {}}
        onSubmitCredential={onSubmitCredential}
      />,
    )

    fireEvent.change(screen.getByTestId('reauth-confirm-text'), {
      target: { value: 'CONFIRM' },
    })
    fireEvent.click(screen.getByTestId('reauth-submit'))

    expect(onSubmit).toHaveBeenCalledWith({ mode: 'open' })
    expect(onSubmitCredential).not.toHaveBeenCalled()
  })

  it('confirm mode: wrong typed-confirmation surfaces error and does not resolve', () => {
    const onSubmit = vi.fn()

    render(
      <ReauthDialog
        open
        mode="confirm"
        path="/x"
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    )

    fireEvent.change(screen.getByTestId('reauth-confirm-text'), {
      target: { value: 'wrongtoken' },
    })
    fireEvent.click(screen.getByTestId('reauth-submit'))

    expect(screen.getByTestId('reauth-error').textContent).toMatch(/Type CONFIRM/i)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('cancel button calls onCancel', () => {
    const onCancel = vi.fn()
    render(
      <ReauthDialog
        open
        mode="credential"
        path="/x"
        onSubmit={() => {}}
        onCancel={onCancel}
      />,
    )
    fireEvent.click(screen.getByTestId('reauth-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

describe('ReauthDialogRoot (queue + provider wiring)', () => {
  it('opens when a challenge is enqueued and resolves the Promise on submit', async () => {
    // Mock the /auth/reauth endpoint that the default submit calls.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          mode: 'session',
          token: 'srv-tok-A',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    render(<ReauthDialogRoot />)

    let resolved: SudoCredential | null = null
    let rejected: Error | null = null

    act(() => {
      void __enqueueSudoChallengeForTests('/api-keys/1').then(
        (cred) => {
          resolved = cred
        },
        (err: Error) => {
          rejected = err
        },
      )
    })

    await waitFor(() => {
      expect(screen.getByTestId('reauth-dialog')).toBeTruthy()
    })

    fireEvent.change(screen.getByTestId('reauth-password'), {
      target: { value: 'pw' },
    })
    fireEvent.click(screen.getByTestId('reauth-submit'))

    await waitFor(() => {
      expect(resolved).not.toBeNull()
    })
    expect(rejected).toBeNull()
    expect(resolved?.token).toBe('srv-tok-A')
    expect(fetchSpy).toHaveBeenCalled()
  })

  it('rejects with SudoCanceledError when the user cancels', async () => {
    render(<ReauthDialogRoot />)

    let resolved: SudoCredential | null = null
    let rejected: Error | null = null

    act(() => {
      void __enqueueSudoChallengeForTests('/x').then(
        (cred) => {
          resolved = cred
        },
        (err: Error) => {
          rejected = err
        },
      )
    })

    await waitFor(() => {
      expect(screen.getByTestId('reauth-dialog')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('reauth-cancel'))

    await waitFor(() => {
      expect(rejected).not.toBeNull()
    })
    expect(resolved).toBeNull()
    expect(rejected).toBeInstanceOf(SudoCanceledError)
  })

  it('renders the credential-mode form when monitor.mode is "session"', async () => {
    mockMonitor.mode = 'session'
    render(<ReauthDialogRoot />)

    act(() => {
      void __enqueueSudoChallengeForTests('/x').catch(() => {})
    })

    await waitFor(() => {
      expect(screen.getByTestId('reauth-password')).toBeTruthy()
    })
    expect(screen.queryByTestId('reauth-confirm-text')).toBeNull()
  })

  it('renders the confirm-mode form when monitor.mode is "open"', async () => {
    mockMonitor.mode = 'open'
    render(<ReauthDialogRoot />)

    act(() => {
      void __enqueueSudoChallengeForTests('/x').catch(() => {})
    })

    await waitFor(() => {
      expect(screen.getByTestId('reauth-confirm-text')).toBeTruthy()
    })
    expect(screen.queryByTestId('reauth-password')).toBeNull()
  })

  it('queues subsequent challenges and only opens for one at a time', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            mode: 'session',
            token: 'tok',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    )
    render(<ReauthDialogRoot />)

    let firstResolved = false
    let secondResolved = false

    act(() => {
      void __enqueueSudoChallengeForTests('/x1').then(
        () => {
          firstResolved = true
        },
        () => {},
      )
      void __enqueueSudoChallengeForTests('/x2').then(
        () => {
          secondResolved = true
        },
        () => {},
      )
    })

    await waitFor(() => {
      expect(screen.getByTestId('reauth-dialog')).toBeTruthy()
    })

    // Resolve the first.
    fireEvent.change(screen.getByTestId('reauth-password'), {
      target: { value: 'pw' },
    })
    fireEvent.click(screen.getByTestId('reauth-submit'))

    await waitFor(() => {
      expect(firstResolved).toBe(true)
    })

    // Dialog re-opens for the second challenge.
    await waitFor(() => {
      expect(screen.getByTestId('reauth-dialog')).toBeTruthy()
    })
    expect(secondResolved).toBe(false)

    fireEvent.change(screen.getByTestId('reauth-password'), {
      target: { value: 'pw' },
    })
    fireEvent.click(screen.getByTestId('reauth-submit'))

    await waitFor(() => {
      expect(secondResolved).toBe(true)
    })
  })
})
