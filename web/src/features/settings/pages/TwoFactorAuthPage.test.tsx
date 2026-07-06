/**
 * TwoFactorAuthPage contract.
 *
 * The page is a pure orchestrator: it fans a single `useTOTPStatus()` query
 * into the KPI band + the freshness chip, and mounts the interactive
 * `TOTPEnrollmentSection` alongside the always-on guide / apps / recovery
 * panels. These tests exercise the page through its real subtree (no shallow
 * rendering) so the assertions cover the actual composed behaviour:
 *
 *   1. Open mode (AUTH_MODE_OPEN) — KPI shows "Unavailable", the enrollment
 *      section renders the inline notice, no enroll/disable controls appear,
 *      and the enroll endpoint is never hit (only /auth/totp is requested).
 *   2. Orchestration — the copy-link + freshness header controls render and
 *      both labelled bento regions are present.
 *   3. Forward-auth + not enrolled — the KPI status AND the section pill both
 *      say "Not enrolled"; the Enable button shows and Disable does not.
 *   4. Enable interaction — clicking Enable opens the enroll modal with the
 *      QR secret and fires POST /auth/totp/enroll.
 *   5. Forward-auth + active — KPI shows "Active" + the remaining backup count,
 *      and the section exposes Disable + Regenerate (no Enable).
 *   6. Disable interaction — opens the typed-confirmation dialog without
 *      firing the DELETE until the user confirms.
 *   7. Loading — the section spinner + static panels render while the KPI
 *      band shows its skeleton (no metric cells yet).
 *
 * The shared `request` helper is mocked so the real hooks run end-to-end
 * without a network; i18n is stubbed to fall back to default English so the
 * assertions can match on copy.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
        const fallback = typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined
        const opts =
          typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
            ? (fallbackOrOpts as Record<string, unknown>)
            : (maybeOpts as Record<string, unknown> | undefined)
        const interpolate = (s: string) => {
          if (!opts) return s
          return Object.keys(opts).reduce(
            (acc, k) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(opts[k])),
            s,
          )
        }
        if (opts && typeof opts.defaultValue === 'string') return interpolate(opts.defaultValue)
        if (fallback != null) return interpolate(fallback)
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { request } from '@/api/client'
import { ToastProvider } from '@/components/feedback/Toast'
import TwoFactorAuthPage from './TwoFactorAuthPage'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

const ENROLLMENT = {
  secret: 'JBSWY3DPEHPK3PXP',
  otpauth_uri: 'otpauth://totp/TeslaSync:alice?secret=JBSWY3DPEHPK3PXP&issuer=TeslaSync',
  qr_data_uri: 'data:image/png;base64,iVBORw0KGgo=',
  backup_codes: ['AAAA-AAAA', 'BBBB-BBBB', 'CCCC-CCCC'],
  expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
}

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
          <TwoFactorAuthPage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockedRequest.mockReset()
})

describe('TwoFactorAuthPage — open mode', () => {
  it('renders the unavailable KPI + inline notice and never hits the enroll endpoint', async () => {
    mockedRequest.mockImplementation(async (path: string) => {
      if (path === '/auth/totp') return { mode: 'open' }
      throw new Error(`unexpected request to ${path}`)
    })

    renderPage()

    // The enrollment section collapses to the inline open-mode notice.
    await waitFor(() => {
      expect(screen.getByTestId('totp-section-open-mode')).toBeInTheDocument()
    })

    // KPI band surfaces the "unavailable" protection cell.
    expect(screen.getByText('Protection')).toBeInTheDocument()
    expect(screen.getByText('Unavailable')).toBeInTheDocument()

    // No enroll/disable controls are offered in open mode.
    expect(screen.queryByTestId('totp-enroll')).toBeNull()
    expect(screen.queryByTestId('totp-disable')).toBeNull()

    // The always-on context panels still render (never a blank bento).
    expect(screen.getByText('How setup works')).toBeInTheDocument()
    expect(screen.getByText('Compatible apps')).toBeInTheDocument()
    expect(screen.getByText('Recovery & good habits')).toBeInTheDocument()

    // The single shared status query is the only network call — no enroll,
    // verify or revoke endpoint is touched (the two useTOTPStatus consumers
    // dedupe to one fetch of /auth/totp).
    expect(mockedRequest.mock.calls.length).toBeGreaterThan(0)
    expect(mockedRequest.mock.calls.every((call) => call[0] === '/auth/totp')).toBe(true)

    // The page-level h1 is the accessible page title.
    expect(
      screen.getByRole('heading', { level: 1, name: /Two-factor authentication/i }),
    ).toBeInTheDocument()
  })

  it('renders the copy-link control, freshness chip and both labelled bento regions', async () => {
    mockedRequest.mockImplementation(async (path: string) => {
      if (path === '/auth/totp') return { mode: 'open' }
      throw new Error(`unexpected request to ${path}`)
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('totp-section-open-mode')).toBeInTheDocument()
    })

    // Header affordances driven by `copyLink` + `query` props.
    expect(screen.getByRole('button', { name: /Copy link to this view/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Refresh$/i })).toBeInTheDocument()

    // Both bento sections expose accessible region names (a11y landmarks).
    expect(
      screen.getByRole('region', { name: /Manage two-factor authentication/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: /Two-factor apps and recovery/i }),
    ).toBeInTheDocument()
  })
})

describe('TwoFactorAuthPage — forward-auth + not enrolled', () => {
  it('mirrors the "Not enrolled" state across the KPI band and the section pill', async () => {
    mockedRequest.mockImplementation(async (path: string) => {
      if (path === '/auth/totp') {
        return { mode: 'session', activated: false, backup_codes_remaining: 0 }
      }
      throw new Error(`unexpected request to ${path}`)
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('totp-status-pill').textContent).toMatch(/Not enrolled/i)
    })

    // Both the KPI protection cell AND the hero pill say "Not enrolled".
    expect(screen.getAllByText(/^Not enrolled$/i).length).toBeGreaterThanOrEqual(2)

    // Enable is offered; Disable is not (no active credential yet).
    expect(screen.getByTestId('totp-enroll')).toBeInTheDocument()
    expect(screen.queryByTestId('totp-disable')).toBeNull()

    // The full four-cell KPI band is present (unique labels/subtitle).
    expect(screen.getByText('Last verified')).toBeInTheDocument()
    expect(screen.getByText('RFC 6238')).toBeInTheDocument()
  })

  it('opens the enroll modal and fires POST /auth/totp/enroll on Enable click', async () => {
    mockedRequest.mockImplementation(async (path: string) => {
      if (path === '/auth/totp') {
        return { mode: 'session', activated: false, backup_codes_remaining: 0 }
      }
      if (path === '/auth/totp/enroll') return ENROLLMENT
      throw new Error(`unexpected request to ${path}`)
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('totp-enroll')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('totp-enroll'))

    await waitFor(() => {
      expect(screen.getByTestId('totp-enroll-modal')).toBeInTheDocument()
    })
    expect(screen.getByTestId('totp-secret').textContent).toBe('JBSWY3DPEHPK3PXP')
    expect(screen.getByTestId('totp-verify-input')).toBeInTheDocument()
    expect(mockedRequest).toHaveBeenCalledWith('/auth/totp/enroll', { method: 'POST' })
  })
})

describe('TwoFactorAuthPage — forward-auth + active', () => {
  it('shows the Active KPI + backup count and the Disable/Regenerate controls', async () => {
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

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('totp-status-pill').textContent).toMatch(/Active/i)
    })

    // "Active" appears in both the KPI protection cell and the pill badge.
    expect(screen.getAllByText(/^Active$/i).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByTestId('totp-backup-remaining').textContent).toContain('7')

    // Active credential → manage controls, no Enable button.
    expect(screen.getByTestId('totp-disable')).toBeInTheDocument()
    expect(screen.getByTestId('totp-regenerate')).toBeInTheDocument()
    expect(screen.queryByTestId('totp-enroll')).toBeNull()
  })

  it('opens the typed-confirmation dialog on Disable without firing DELETE early', async () => {
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

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('totp-disable')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('totp-disable'))

    // ConfirmDialog requires typing DISABLE — match on its placeholder.
    await waitFor(() => {
      expect(screen.getByPlaceholderText('DISABLE')).toBeInTheDocument()
    })
    // Merely opening the dialog must NOT have fired the revoke DELETE.
    expect(
      mockedRequest.mock.calls.some((call) => (call[1] as RequestInit | undefined)?.method === 'DELETE'),
    ).toBe(false)
  })
})

describe('TwoFactorAuthPage — loading', () => {
  it('renders the section spinner + static panels while the KPI band is skeletoned', async () => {
    // A never-resolving status keeps the query in its loading state.
    mockedRequest.mockImplementation(
      (path: string) =>
        new Promise(() => {
          void path
        }),
    )

    renderPage()

    // Interactive section shows its loading affordance…
    expect(await screen.findByText('Loading two-factor settings…')).toBeInTheDocument()
    // …the KPI band is in skeleton mode, so no metric cells have rendered yet…
    expect(screen.queryByText('Protection')).toBeNull()
    // …but the static guidance panels are always mounted.
    expect(screen.getByText('How setup works')).toBeInTheDocument()
    expect(screen.getByText('Compatible apps')).toBeInTheDocument()
  })
})
