/**
 * ImpersonationStatusPanel contract tests.
 *
 * The panel is a pure presentational component driven by
 * { status, isLoading, isError }. These tests pin:
 *   • every discriminated branch of the impersonation status union
 *     (open / active / inactive) plus the undefined fallback,
 *   • the loading + error affordances and their precedence,
 *   • the null-safe em-dash fallbacks for empty active fields,
 *   • the regression guard that a transient error with cached data does
 *     NOT mask a live "active" session, and
 *   • the a11y contract of the busy region (role + aria-busy + label).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
        // t(key, defaultStr, opts) signature — return the default string.
        if (typeof fallbackOrOpts === 'string') {
          if (opts && typeof opts === 'object') {
            const o = opts as Record<string, unknown>
            return fallbackOrOpts.replace(/{{(\w+)}}/g, (_, name) =>
              name in o ? String(o[name]) : `{{${name}}}`,
            )
          }
          return fallbackOrOpts
        }
        // t(key, opts) signature.
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>
          if (typeof o.defaultValue === 'string') return o.defaultValue
        }
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { ImpersonationStatusPanel } from './ImpersonationStatusPanel'
import type { ImpersonationStatus } from '@/api/hooks/useImpersonation'

type ActiveStatus = Extract<ImpersonationStatus, { mode: 'active' }>

const activeStatus: ActiveStatus = {
  mode: 'active',
  original_admin: 'admin@corp.example',
  target: 'driver@corp.example',
  expires_at: '2026-07-04T22:00:00Z',
}

interface PanelProps {
  status: ImpersonationStatus | undefined
  isLoading: boolean
  isError?: boolean
}

function renderPanel(props: Partial<PanelProps> = {}) {
  const merged: PanelProps = { status: undefined, isLoading: false, ...props }
  return render(<ImpersonationStatusPanel {...merged} />)
}

describe('ImpersonationStatusPanel', () => {
  it('always renders the panel heading regardless of state', () => {
    renderPanel({ status: { mode: 'inactive' } })
    expect(
      screen.getByRole('heading', { name: 'Session Status' }),
    ).toBeInTheDocument()
  })

  it('renders an accessible busy region while loading and hides every callout', () => {
    renderPanel({ isLoading: true, status: undefined })

    const busy = screen.getByTestId('impersonation-status-loading')
    expect(busy).toHaveAttribute('aria-busy', 'true')
    expect(busy).toHaveAttribute('role', 'status')
    // The skeleton must carry an accessible name — a bare shimmer is a
    // blank panel to a screen reader.
    expect(screen.getByLabelText(/Loading session status/)).toBe(busy)

    expect(
      screen.queryByTestId('impersonation-status-inactive'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('impersonation-status-active'),
    ).not.toBeInTheDocument()
  })

  it('prioritises the loading state over a concurrent error', () => {
    renderPanel({ isLoading: true, isError: true, status: undefined })
    expect(
      screen.getByTestId('impersonation-status-loading'),
    ).toBeInTheDocument()
    expect(
      screen.queryByTestId('impersonation-status-error'),
    ).not.toBeInTheDocument()
  })

  it('renders the warning callout in open (forward-auth disabled) mode', () => {
    renderPanel({ status: { mode: 'open' } })
    const callout = screen.getByTestId('impersonation-status-open')
    expect(callout).toHaveTextContent(/Forward-auth is disabled/)
    expect(
      screen.queryByTestId('impersonation-status-active'),
    ).not.toBeInTheDocument()
  })

  it('renders the active session detail rows with admin, target and expiry', () => {
    const { container } = renderPanel({ status: activeStatus })

    expect(screen.getByTestId('impersonation-status-active')).toHaveTextContent(
      /Impersonation is active/,
    )

    expect(screen.getByText('Original admin')).toBeInTheDocument()
    expect(screen.getByText('Target subject')).toBeInTheDocument()
    expect(screen.getByText('Expires')).toBeInTheDocument()

    expect(screen.getByText('admin@corp.example')).toBeInTheDocument()
    expect(screen.getByText('driver@corp.example')).toBeInTheDocument()

    // The <DateTime> span carries the canonical ISO string in its title,
    // independent of the runtime locale/timezone.
    const stamp = container.querySelector('[title]')
    expect(stamp?.getAttribute('title')).toContain('2026-07-04T22:00:00')
  })

  it('falls back to an em dash when active fields are empty', () => {
    renderPanel({
      status: { mode: 'active', original_admin: '', target: '', expires_at: '' },
    })
    // Two <Code> placeholders + the empty <DateTime> placeholder.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })

  it('renders the inactive callout for the inactive mode', () => {
    renderPanel({ status: { mode: 'inactive' } })
    expect(
      screen.getByTestId('impersonation-status-inactive'),
    ).toHaveTextContent(/not impersonating anyone/)
  })

  it('treats an undefined status as inactive when not loading or errored', () => {
    renderPanel({ status: undefined })
    expect(
      screen.getByTestId('impersonation-status-inactive'),
    ).toBeInTheDocument()
    expect(
      screen.queryByTestId('impersonation-status-error'),
    ).not.toBeInTheDocument()
  })

  it('surfaces the error callout when the query failed with no cached status', () => {
    renderPanel({ status: undefined, isError: true })
    const err = screen.getByTestId('impersonation-status-error')
    expect(err).toHaveTextContent(/unavailable right now/)
    // The error branch must win over the inactive fallback.
    expect(
      screen.queryByTestId('impersonation-status-inactive'),
    ).not.toBeInTheDocument()
  })

  it('keeps rendering the last-good status when an error arrives with cached data', () => {
    renderPanel({ status: activeStatus, isError: true })
    // A transient background-refetch failure must not mask a live session
    // by flipping "active" to an error/inactive placeholder.
    expect(
      screen.getByTestId('impersonation-status-active'),
    ).toBeInTheDocument()
    expect(
      screen.queryByTestId('impersonation-status-error'),
    ).not.toBeInTheDocument()
  })
})
