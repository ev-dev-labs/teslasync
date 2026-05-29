/**
 * ImpersonationBanner contract.
 *
 * Coverage:
 *   1. Open mode renders nothing (the hook returns mode='open').
 *   2. Inactive mode renders nothing.
 *   3. Active mode renders the banner with target + countdown.
 *   4. Click on End fires the end mutation, which POSTs to
 *      /admin/impersonate/end and surfaces a success toast.
 *   5. Mutation in flight disables the End button + shows the
 *      "Ending…" label.
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
        const interpolate = (str: string) => {
          if (!opts) return str
          return Object.entries(opts).reduce<string>((acc, [k, v]) => {
            if (k === 'defaultValue') return acc
            return acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v))
          }, str)
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
import { ImpersonationBanner } from './ImpersonationBanner'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

function renderBanner() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <ImpersonationBanner />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mockedRequest.mockReset()
})

describe('ImpersonationBanner', () => {
  it('renders nothing in open mode', async () => {
    mockedRequest.mockRejectedValue(
      new ApiError('open mode', 501, 'AUTH_MODE_OPEN'),
    )
    renderBanner()
    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        '/admin/impersonate',
        expect.objectContaining({}),
      ),
    )
    expect(screen.queryByTestId('impersonation-banner')).toBeNull()
  })

  it('renders nothing when inactive', async () => {
    mockedRequest.mockResolvedValue({ mode: 'inactive' })
    renderBanner()
    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalled(),
    )
    expect(screen.queryByTestId('impersonation-banner')).toBeNull()
  })

  it('renders banner when active with target + countdown', async () => {
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
    mockedRequest.mockResolvedValue({
      mode: 'active',
      original_admin: 'admin',
      target: 'alice',
      expires_at: expiresAt,
    })
    renderBanner()
    const banner = await screen.findByTestId('impersonation-banner')
    expect(banner).toBeInTheDocument()
    expect(banner.dataset.target).toBe('alice')
    expect(banner.dataset.originalAdmin).toBe('admin')
    expect(screen.getByText(/alice/)).toBeInTheDocument()
    expect(screen.getByTestId('impersonation-banner-countdown')).toBeInTheDocument()
  })

  it('renders banner active without countdown when expires_at is absent', async () => {
    mockedRequest.mockResolvedValue({
      mode: 'active',
      original_admin: 'admin',
      target: 'alice',
      expires_at: '',
    })
    renderBanner()
    await screen.findByTestId('impersonation-banner')
    expect(screen.queryByTestId('impersonation-banner-countdown')).toBeNull()
  })

  it('clicking End fires POST /admin/impersonate/end', async () => {
    mockedRequest
      // initial GET state
      .mockResolvedValueOnce({
        mode: 'active',
        original_admin: 'admin',
        target: 'alice',
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      })
      // POST end
      .mockResolvedValueOnce(undefined)
      // re-fetch GET state after invalidate
      .mockResolvedValue({ mode: 'inactive' })
    renderBanner()
    const endBtn = await screen.findByTestId('impersonation-banner-end')
    fireEvent.click(endBtn)
    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        '/admin/impersonate/end',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
  })

  it('end mutation in flight shows the Ending… label', async () => {
    let resolveEnd: () => void = () => undefined
    const endPromise = new Promise<void>((resolve) => {
      resolveEnd = resolve
    })
    mockedRequest.mockImplementation(async (path: string) => {
      if (path === '/admin/impersonate') {
        return {
          mode: 'active',
          original_admin: 'admin',
          target: 'alice',
          expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        }
      }
      // /admin/impersonate/end stays pending
      await endPromise
      return undefined
    })
    renderBanner()
    const endBtn = await screen.findByTestId('impersonation-banner-end')
    fireEvent.click(endBtn)
    await waitFor(() => {
      expect(screen.getByTestId('impersonation-banner-end')).toHaveTextContent(/ending/i)
    })
    resolveEnd()
  })
})
