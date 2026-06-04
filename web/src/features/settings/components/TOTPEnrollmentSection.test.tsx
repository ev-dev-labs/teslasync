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
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
        <TOTPEnrollmentSection />
      </ToastProvider>
    </QueryClientProvider>,
  )
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
