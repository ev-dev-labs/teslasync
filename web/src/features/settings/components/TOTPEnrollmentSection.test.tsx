/**
 * TOTPEnrollmentSection contract.
 *
 * Coverage:
 *   1. Open mode (status.mode='open') renders the inline placeholder
 *      and never shows enroll/disable buttons. The /auth/totp/enroll
 *      endpoint is NOT hit in this state.
 *   2. Forward-auth + not enrolled renders the "Not enrolled" pill
 *      and the "Enable TOTP" button. Clicking opens the enroll modal
 *      with QR + manual secret + 6-digit verify input.
 *   3. Verify success flips the dialog to the backup-codes view.
 *   4. Forward-auth + active credential renders the "Active" pill,
 *      the last_used_at time, the backup-codes-remaining count, plus
 *      Regenerate + Disable buttons.
 *   5. Disable click opens the typed-confirmation ConfirmDialog.
 *   6. TOTP_INVALID error code surfaces the "code did not match"
 *      message; TOTP_RATE_LIMITED surfaces the "wait 15 minutes"
 *      message.
 *
 * The shared `request` helper is mocked so the real hooks run end-to-
 * end without a network. i18n is stubbed to fall back to default
 * values.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
        if (opts && typeof opts.defaultValue === 'string') {
          return opts.defaultValue
        }
        if (fallback != null) return fallback
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { request, ApiError } from '@/api/client'
import { ToastProvider } from '@/components/feedback/Toast'
import { TOTPEnrollmentSection } from './TOTPEnrollmentSection'
import { totpKeys } from '@/api/hooks/useTOTP'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

function renderSection(props: { capability?: boolean; liveReady?: boolean } = {}) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  const section = (nextProps: typeof props) => (
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <TOTPEnrollmentSection {...nextProps} />
      </ToastProvider>
    </QueryClientProvider>
  )
  const result = render(section(props))
  return { ...result, qc, rerenderSection: (nextProps: typeof props) => result.rerender(section(nextProps)) }
}

beforeEach(() => {
  mockedRequest.mockReset()
})

describe('TOTPEnrollmentSection — open mode', () => {
  it('renders inline placeholder and never hits enroll endpoint', async () => {
    mockedRequest.mockImplementation(async (path: string) => {
      if (path === '/auth/totp') return { mode: 'open' }
      throw new Error(`unexpected request to ${path}`)
    })

    renderSection()

    await waitFor(() => {
      expect(screen.getByTestId('totp-section-open-mode')).toBeTruthy()
    })
    expect(screen.queryByTestId('totp-enroll')).toBeNull()
    expect(screen.queryByTestId('totp-disable')).toBeNull()
    // Only the status query — no enroll/verify/etc.
    expect(mockedRequest).toHaveBeenCalledTimes(1)
    expect(mockedRequest).toHaveBeenCalledWith(
      '/auth/totp',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })
})

describe('TOTPEnrollmentSection — forward-auth + not enrolled', () => {
  it('renders the Enable button and opens the enroll modal on click', async () => {
    mockedRequest.mockImplementation(async (path: string) => {
      if (path === '/auth/totp') {
        return { mode: 'session', activated: false, backup_codes_remaining: 0 }
      }
      if (path === '/auth/totp/enroll') {
        return {
          secret: 'JBSWY3DPEHPK3PXP',
          otpauth_uri:
            'otpauth://totp/TeslaSync:alice?secret=JBSWY3DPEHPK3PXP&issuer=TeslaSync',
          qr_data_uri: 'data:image/png;base64,iVBORw0KGgo=',
          backup_codes: [
            'AAAA-AAAA',
            'BBBB-BBBB',
            'CCCC-CCCC',
            'DDDD-DDDD',
            'EEEE-EEEE',
            'FFFF-FFFF',
            'GGGG-GGGG',
            'HHHH-HHHH',
            'IIII-IIII',
            'JJJJ-JJJJ',
          ],
          expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        }
      }
      throw new Error(`unexpected request to ${path}`)
    })

    renderSection()

    await waitFor(() => {
      expect(screen.getByTestId('totp-status-pill').textContent).toMatch(/Not enrolled/i)
    })
    expect(screen.getByTestId('totp-enroll')).toBeTruthy()
    expect(screen.queryByTestId('totp-disable')).toBeNull()

    fireEvent.click(screen.getByTestId('totp-enroll'))

    await waitFor(() => {
      expect(screen.getByTestId('totp-enroll-modal')).toBeTruthy()
    })
    expect(screen.getByTestId('totp-qr')).toBeTruthy()
    expect(screen.getByTestId('totp-secret').textContent).toBe('JBSWY3DPEHPK3PXP')
    expect(screen.getByTestId('totp-verify-input')).toBeTruthy()
  })

  it('verify success flips dialog to backup-codes view', async () => {
    const codes = [
      'AAAA-AAAA',
      'BBBB-BBBB',
      'CCCC-CCCC',
      'DDDD-DDDD',
      'EEEE-EEEE',
      'FFFF-FFFF',
      'GGGG-GGGG',
      'HHHH-HHHH',
      'IIII-IIII',
      'JJJJ-JJJJ',
    ]
    mockedRequest.mockImplementation(async (path: string) => {
      if (path === '/auth/totp') {
        return { mode: 'session', activated: false, backup_codes_remaining: 0 }
      }
      if (path === '/auth/totp/enroll') {
        return {
          secret: 'JBSWY3DPEHPK3PXP',
          otpauth_uri: 'otpauth://...',
          qr_data_uri: 'data:image/png;base64,iVBORw0KGgo=',
          backup_codes: codes,
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        }
      }
      if (path === '/auth/totp/verify') {
        return { activated: true }
      }
      throw new Error(`unexpected request to ${path}`)
    })

    renderSection()

    await waitFor(() => {
      expect(screen.getByTestId('totp-enroll')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('totp-enroll'))
    await waitFor(() => {
      expect(screen.getByTestId('totp-enroll-modal')).toBeTruthy()
    })

    fireEvent.change(screen.getByTestId('totp-verify-input'), {
      target: { value: '123456' },
    })
    fireEvent.click(screen.getByTestId('totp-verify-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('totp-backup-modal')).toBeTruthy()
    })
    const list = screen.getByTestId('totp-backup-list')
    expect(list.textContent).toContain('AAAA-AAAA')
    expect(list.textContent).toContain('JJJJ-JJJJ')
  })

  it('verify error TOTP_INVALID surfaces the localised message', async () => {
    mockedRequest.mockImplementation(async (path: string) => {
      if (path === '/auth/totp') {
        return { mode: 'session', activated: false, backup_codes_remaining: 0 }
      }
      if (path === '/auth/totp/enroll') {
        return {
          secret: 'JBSWY3DPEHPK3PXP',
          otpauth_uri: 'otpauth://...',
          qr_data_uri: 'data:image/png;base64,iVBORw0KGgo=',
          backup_codes: ['AAAA-AAAA'],
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        }
      }
      if (path === '/auth/totp/verify') {
        throw new ApiError('invalid code', 401, 'TOTP_INVALID')
      }
      throw new Error(`unexpected request to ${path}`)
    })

    renderSection()
    await waitFor(() => {
      expect(screen.getByTestId('totp-enroll')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('totp-enroll'))
    await waitFor(() => {
      expect(screen.getByTestId('totp-enroll-modal')).toBeTruthy()
    })
    fireEvent.change(screen.getByTestId('totp-verify-input'), {
      target: { value: '999999' },
    })
    fireEvent.click(screen.getByTestId('totp-verify-submit'))
    await waitFor(() => {
      expect(screen.getByTestId('totp-verify-error').textContent).toMatch(/did not match/i)
    })
    // Modal stays open so user can try again.
    expect(screen.getByTestId('totp-enroll-modal')).toBeTruthy()
  })

  it('verify error TOTP_RATE_LIMITED surfaces the wait message', async () => {
    mockedRequest.mockImplementation(async (path: string) => {
      if (path === '/auth/totp') {
        return { mode: 'session', activated: false, backup_codes_remaining: 0 }
      }
      if (path === '/auth/totp/enroll') {
        return {
          secret: 'X',
          otpauth_uri: 'otpauth://...',
          qr_data_uri: 'data:image/png;base64,iVBORw0KGgo=',
          backup_codes: ['AAAA-AAAA'],
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        }
      }
      if (path === '/auth/totp/verify') {
        throw new ApiError('rate limited', 429, 'TOTP_RATE_LIMITED')
      }
      throw new Error(`unexpected request to ${path}`)
    })

    renderSection()
    await waitFor(() => {
      expect(screen.getByTestId('totp-enroll')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('totp-enroll'))
    await waitFor(() => {
      expect(screen.getByTestId('totp-enroll-modal')).toBeTruthy()
    })
    fireEvent.change(screen.getByTestId('totp-verify-input'), {
      target: { value: '111111' },
    })
    fireEvent.click(screen.getByTestId('totp-verify-submit'))
    await waitFor(() => {
      expect(screen.getByTestId('totp-verify-error').textContent).toMatch(/15 minutes/i)
    })
  })
})

describe('TOTPEnrollmentSection — forward-auth + active', () => {
  it('renders Active pill, last_used_at, backup count, and Disable + Regenerate buttons', async () => {
    mockedRequest.mockImplementation(async (path: string) => {
      if (path === '/auth/totp') {
        return {
          mode: 'session',
          activated: true,
          last_used_at: '2024-06-01T12:00:00Z',
          backup_codes_remaining: 7,
        }
      }
      throw new Error(`unexpected request to ${path}`)
    })

    renderSection()

    await waitFor(() => {
      expect(screen.getByTestId('totp-status-pill').textContent).toMatch(/Active/i)
    })
    expect(screen.queryByTestId('totp-enroll')).toBeNull()
    expect(screen.getByTestId('totp-disable')).toBeTruthy()
    expect(screen.getByTestId('totp-regenerate')).toBeTruthy()
    expect(screen.getByTestId('totp-backup-remaining').textContent).toContain('7')
  })
})

describe('TOTPEnrollmentSection — live command readiness', () => {
      it('keeps an idle initial read retryable without showing a busy skeleton or open-mode advice', async () => {
        mockedRequest.mockImplementation(() => new Promise(() => {}))
        const { qc } = renderSection()
        act(() => {
          qc.getQueryCache().find({ queryKey: totpKeys.status })?.setState({ fetchStatus: 'idle' })
        })

        expect(await screen.findByRole('button', { name: 'Retry' })).toBeEnabled()
        expect(screen.getByRole('status')).not.toHaveAttribute('aria-busy', 'true')
        expect(screen.queryByTestId('totp-section-open-mode')).toBeNull()
        expect(screen.queryByTestId('totp-enroll')).toBeNull()
        expect(screen.queryByText('Refresh paused')).toBeNull()

        mockedRequest.mockResolvedValue({ mode: 'session', activated: false, backup_codes_remaining: 0 })
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
        expect(await screen.findByTestId('totp-enroll')).toBeEnabled()
      })

      it('distinguishes active loading from a paused read without inventing open mode', async () => {
        mockedRequest.mockImplementation(() => new Promise(() => {}))
        const { qc } = renderSection()
        expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')

        act(() => {
          qc.getQueryCache().find({ queryKey: totpKeys.status })?.setState({ fetchStatus: 'paused' })
        })
        expect(await screen.findByText('Refresh paused')).toBeInTheDocument()
        expect(screen.queryByTestId('totp-section-open-mode')).toBeNull()
        expect(screen.queryByTestId('totp-enroll')).toBeNull()
        expect(screen.getByRole('status')).not.toHaveAttribute('aria-busy', 'true')

        act(() => {
          qc.setQueryData(totpKeys.status, { mode: 'session', activated: false, backup_codes_remaining: 0 })
          qc.getQueryCache().find({ queryKey: totpKeys.status })?.setState({ fetchStatus: 'idle' })
        })
        expect(await screen.findByTestId('totp-enroll')).toBeEnabled()
      })

      it('treats successful not-enrolled and zero backup codes as real status', async () => {
        mockedRequest.mockResolvedValue({ mode: 'session', activated: false, backup_codes_remaining: 0 })
        const { qc } = renderSection()
        expect(await screen.findByTestId('totp-enroll')).toBeEnabled()
        act(() => {
          qc.setQueryData(totpKeys.status, { mode: 'session', activated: true, backup_codes_remaining: 0 })
        })
        expect(await screen.findByTestId('totp-backup-remaining')).toHaveTextContent('0')
        expect(screen.getByTestId('totp-regenerate')).toBeEnabled()
      })

      it('preserves retained status through refresh failure and enables commands only after recovery', async () => {
        mockedRequest.mockResolvedValue({
          mode: 'session', activated: true, last_used_at: '2024-06-01T12:00:00Z', backup_codes_remaining: 7,
        })
        const { qc } = renderSection()
        await screen.findByTestId('totp-disable')
        mockedRequest.mockRejectedValue(new ApiError('status refresh failed', 503))
        await act(async () => {
          await qc.refetchQueries({ queryKey: totpKeys.status })
        })
        expect(await screen.findByTestId('totp-commands-blocked')).toHaveTextContent(/successful live status check/)
        expect(screen.getByTestId('totp-status-pill')).toHaveTextContent('Active')
        expect(screen.getByTestId('totp-backup-remaining')).toHaveTextContent('7')
        expect(screen.getByTestId('totp-disable')).toBeDisabled()
        expect(screen.getByTestId('totp-regenerate')).toBeDisabled()
        fireEvent.click(screen.getByTestId('totp-regenerate'))
        expect(mockedRequest.mock.calls.every(([path]) => path === '/auth/totp')).toBe(true)

        mockedRequest.mockResolvedValue({ mode: 'session', activated: true, backup_codes_remaining: 0 })
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
        await waitFor(() => expect(screen.getByTestId('totp-disable')).toBeEnabled())
        expect(screen.queryByTestId('totp-commands-blocked')).toBeNull()
        expect(screen.getByTestId('totp-backup-remaining')).toHaveTextContent('0')
      })

      it.each([{ capability: false }, { liveReady: false }])('blocks commands for %j without losing retained status', async (props) => {
        mockedRequest.mockResolvedValue({ mode: 'session', activated: false, backup_codes_remaining: 0 })
        const { rerenderSection } = renderSection(props)
        expect(await screen.findByTestId('totp-enroll')).toBeDisabled()
        expect(screen.getByTestId('totp-status-pill')).toHaveTextContent('Not enrolled')
        fireEvent.click(screen.getByTestId('totp-enroll'))
        expect(mockedRequest).toHaveBeenCalledTimes(1)
        rerenderSection({ capability: true, liveReady: true })
        expect(screen.getByTestId('totp-enroll')).toBeEnabled()
      })

      it('does not queue an offline credential command and recovers when online', async () => {
        mockedRequest.mockResolvedValue({ mode: 'session', activated: false })
        renderSection()
        const enroll = await screen.findByTestId('totp-enroll')
        try {
          act(() => onlineManager.setOnline(false))
          fireEvent.click(enroll)
          expect(mockedRequest).toHaveBeenCalledTimes(1)
          expect(await screen.findByTestId('totp-commands-blocked')).toBeInTheDocument()
        } finally {
          act(() => onlineManager.setOnline(true))
        }
        await waitFor(() => expect(screen.getByTestId('totp-enroll')).toBeEnabled())
        expect(mockedRequest).toHaveBeenCalledTimes(1)
      })

      it('rechecks a disable confirmation after readiness changes and preserves its typed draft', async () => {
        mockedRequest.mockResolvedValue({ mode: 'session', activated: true, backup_codes_remaining: 7 })
        const { rerenderSection } = renderSection()
        fireEvent.click(await screen.findByTestId('totp-disable'))
        fireEvent.change(await screen.findByPlaceholderText('DISABLE'), { target: { value: 'DISABLE' } })
        rerenderSection({ liveReady: false })
        const dialog = screen.getByRole('dialog')
        expect(dialog).toHaveTextContent(/successful live status check/)
        expect(screen.getByPlaceholderText('DISABLE')).toHaveValue('DISABLE')
        const confirm = within(dialog).getByRole('button', { name: 'Disable', exact: true })
        expect(confirm).toBeDisabled()
        fireEvent.click(confirm)
        expect(mockedRequest).toHaveBeenCalledTimes(1)
        rerenderSection({ liveReady: true })
        expect(screen.getByPlaceholderText('DISABLE')).toHaveValue('DISABLE')
        expect(screen.getByTestId('totp-disable')).toBeEnabled()
      })

      it('rechecks an open enrollment at submission, retaining its draft until live recovery', async () => {
        mockedRequest.mockImplementation(async (path: string) => {
          if (path === '/auth/totp') return { mode: 'session', activated: false }
          if (path === '/auth/totp/enroll') return {
            secret: 'TEST-SECRET', otpauth_uri: 'otpauth://test',
            qr_data_uri: 'data:image/png;base64,iVBORw0KGgo=',
            backup_codes: ['AAAA-AAAA'], expires_at: new Date(Date.now() + 60_000).toISOString(),
          }
          if (path === '/auth/totp/verify') return { activated: true }
          throw new Error(`unexpected request to ${path}`)
        })
        const { qc } = renderSection()
        fireEvent.click(await screen.findByTestId('totp-enroll'))
        fireEvent.change(await screen.findByTestId('totp-verify-input'), { target: { value: '123456' } })
        await waitFor(() => expect(screen.getByTestId('totp-enroll')).toBeEnabled())

        // Change the cache before observer notification to exercise the submission recheck.
        qc.getQueryCache().find({ queryKey: totpKeys.status })?.setState({ fetchStatus: 'paused' })
        fireEvent.keyDown(screen.getByTestId('totp-verify-input'), { key: 'Enter' })
        expect(mockedRequest.mock.calls.some(([path]) => path === '/auth/totp/verify')).toBe(false)
        expect(await screen.findByTestId('totp-verify-error')).toHaveTextContent(/successful live status check/)
        expect(screen.getByTestId('totp-secret')).toHaveTextContent('TEST-SECRET')
        expect(screen.getByTestId('totp-verify-input')).toHaveValue('123456')

        await act(async () => {
          await qc.refetchQueries({ queryKey: totpKeys.status })
        })
        fireEvent.click(screen.getByTestId('totp-verify-submit'))
        expect(await screen.findByTestId('totp-backup-modal')).toBeInTheDocument()
      })
    })

describe('TOTPEnrollmentSection — disable confirmation', () => {
  it('Disable click opens the typed-confirmation ConfirmDialog', async () => {
    mockedRequest.mockImplementation(async (path: string) => {
      if (path === '/auth/totp') {
        return {
          mode: 'session',
          activated: true,
          last_used_at: '2024-06-01T12:00:00Z',
          backup_codes_remaining: 7,
        }
      }
      throw new Error(`unexpected request to ${path}`)
    })

    renderSection()
    await waitFor(() => {
      expect(screen.getByTestId('totp-disable')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('totp-disable'))
    await waitFor(() => {
      // ConfirmDialog renders an input that requires typing DISABLE.
      // Match by placeholder which is set to the typed-confirmation token.
      expect(screen.getByPlaceholderText('DISABLE')).toBeTruthy()
    })
  })
})
