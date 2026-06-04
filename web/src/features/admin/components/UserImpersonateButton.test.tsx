/**
 * UserImpersonateButton contract.
 *
 * Coverage:
 *   1. Click opens the ConfirmDialog with target subject in the body.
 *   2. Cancel closes the dialog without firing the mutation.
 *   3. Confirm fires POST /admin/impersonate with the expected body.
 *   4. disabled prop hides interactivity (no dialog opens).
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

import { request } from '@/api/client'
import { ToastProvider } from '@/components/feedback/Toast'
import { UserImpersonateButton } from './UserImpersonateButton'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

function renderButton(props: { subject: string; disabled?: boolean }) {
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
          <UserImpersonateButton {...props} />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockedRequest.mockReset()
})

describe('UserImpersonateButton', () => {
  it('opens the ConfirmDialog with the target subject', () => {
    renderButton({ subject: 'alice' })
    fireEvent.click(screen.getByTestId('user-impersonate-button-alice'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/alice/)).toBeInTheDocument()
  })

  it('cancel closes the dialog without firing the mutation', async () => {
    renderButton({ subject: 'alice' })
    fireEvent.click(screen.getByTestId('user-impersonate-button-alice'))
    const dialog = screen.getByRole('dialog')
    const cancel = within(dialog).getByRole('button', { name: /cancel/i })
    fireEvent.click(cancel)
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(mockedRequest).not.toHaveBeenCalled()
  })

  it('confirm fires POST /admin/impersonate', async () => {
    mockedRequest.mockResolvedValueOnce({
      mode: 'active',
      original_admin: 'admin',
      target: 'alice',
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    })
    renderButton({ subject: 'alice' })
    fireEvent.click(screen.getByTestId('user-impersonate-button-alice'))
    const dialog = screen.getByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: /start impersonation/i })
    fireEvent.click(confirm)
    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledWith(
        '/admin/impersonate',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ subject: 'alice' }),
        }),
      )
    })
  })

  it('disabled prop suppresses dialog open', () => {
    renderButton({ subject: 'alice', disabled: true })
    const btn = screen.getByTestId('user-impersonate-button-alice')
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
