/**
 * SubjectsTable contract.
 *
 * SubjectsTable is a presentational hero panel: every branch owns its own
 * open / loading / error / empty / list state so the page never gates the
 * whole surface behind one flag. These tests exercise each branch plus the
 * search filter, the "current target" flag, the active-session disable, the
 * header count gating, and the a11y affordances.
 *
 * Coverage:
 *   1. open mode → callout, no table, no count.
 *   2. loading  → skeleton, and the header count is suppressed even when
 *                 stale subjects are still in props (the R-fix under test).
 *   3. error    → QueryError + Retry wired to onRetry; count suppressed.
 *   4. empty    → EmptyState, no search box, no count.
 *   5. list     → rows render, "Available" badges, "Showing N of N" count.
 *   6. search   → narrows rows + count; no-match shows the table empty copy.
 *   7. target   → the impersonated row shows "Current target", others don't.
 *   8. active   → every impersonate button is disabled, dialog can't open.
 *   9. list interaction → an enabled impersonate button opens the dialog.
 *  10. a11y     → search has an accessible name; buttons name the subject.
 *  11. open beats loading/error in the branch precedence chain.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ComponentProps, ReactNode } from 'react'

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
        const fallback = typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined
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
        if (opts && typeof opts.defaultValue === 'string') return interpolate(opts.defaultValue)
        if (fallback != null) return interpolate(fallback)
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { ToastProvider } from '@/components/feedback/Toast'
import { SubjectsTable } from './SubjectsTable'

type Props = ComponentProps<typeof SubjectsTable>

function subjects(...names: string[]): Props['subjects'] {
  return names.map((subject) => ({ subject }))
}

function renderTable(overrides: Partial<Props> = {}) {
  const props: Props = {
    subjects: subjects('alice@corp', 'bob@corp', 'carol@corp'),
    open: false,
    active: false,
    targetSubject: null,
    isLoading: false,
    isError: false,
    error: null,
    onRetry: vi.fn(),
    ...overrides,
  }
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  const utils = render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <SubjectsTable {...props} />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
  return { ...utils, props }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SubjectsTable', () => {
  it('renders the open-mode callout and nothing else when open', () => {
    renderTable({ open: true, subjects: subjects('alice@corp') })

    expect(screen.getByTestId('users-page-open-mode')).toBeInTheDocument()
    expect(screen.queryByTestId('users-page-list')).toBeNull()
    expect(screen.queryByTestId('users-page-loading')).toBeNull()
    // Header count must never show in a non-list branch.
    expect(screen.queryByText(/Showing/)).toBeNull()
  })

  it('renders the skeleton while loading and suppresses the stale count', () => {
    // Stale subjects are still in props (TanStack keeps last data across a
    // refetch); the count must NOT claim to describe a table that isn't shown.
    renderTable({ isLoading: true })

    expect(screen.getByTestId('users-page-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('users-page-list')).toBeNull()
    expect(screen.queryByText(/Showing/)).toBeNull()
  })

  it('renders QueryError and wires Retry to onRetry, with the count suppressed', () => {
    const onRetry = vi.fn()
    renderTable({ isError: true, error: new Error('down'), onRetry })

    const retry = screen.getByRole('button', { name: 'Retry' })
    expect(retry).toBeInTheDocument()
    expect(screen.queryByText(/Showing/)).toBeNull()

    fireEvent.click(retry)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('renders the empty state (no search box) when there are no subjects', () => {
    renderTable({ subjects: subjects() })

    expect(screen.getByText('No other subjects')).toBeInTheDocument()
    expect(screen.queryByTestId('users-page-list')).toBeNull()
    expect(screen.queryByLabelText('Search subjects')).toBeNull()
    expect(screen.queryByText(/Showing/)).toBeNull()
  })

  it('renders one row per subject with an Available badge and the total count', () => {
    renderTable()

    expect(screen.getByTestId('users-page-list')).toBeInTheDocument()
    expect(screen.getByText('alice@corp')).toBeInTheDocument()
    expect(screen.getByText('bob@corp')).toBeInTheDocument()
    expect(screen.getByText('carol@corp')).toBeInTheDocument()
    expect(screen.getAllByText('Available')).toHaveLength(3)
    expect(screen.getByText('Showing 3 of 3')).toBeInTheDocument()
  })

  it('filters rows by the search term and reflects it in the count', () => {
    renderTable()

    const box = screen.getByLabelText('Search subjects')
    fireEvent.change(box, { target: { value: 'ali' } })

    expect(screen.getByText('alice@corp')).toBeInTheDocument()
    expect(screen.queryByText('bob@corp')).toBeNull()
    expect(screen.queryByText('carol@corp')).toBeNull()
    expect(screen.getByText('Showing 1 of 3')).toBeInTheDocument()
  })

  it('shows the table empty copy (not the panel empty state) when no rows match', () => {
    renderTable()

    fireEvent.change(screen.getByLabelText('Search subjects'), {
      target: { value: 'zzz-nobody' },
    })

    expect(screen.getByText('No subjects match your search.')).toBeInTheDocument()
    // The panel-level empty state must NOT be used for a search miss.
    expect(screen.queryByText('No other subjects')).toBeNull()
    expect(screen.getByText('Showing 0 of 3')).toBeInTheDocument()
  })

  it('flags only the impersonated row as the current target', () => {
    renderTable({ targetSubject: 'bob@corp' })

    expect(screen.getByText('Current target')).toBeInTheDocument()
    // alice + carol remain available; bob is the target.
    expect(screen.getAllByText('Available')).toHaveLength(2)
  })

  it('disables every impersonate button while a session is active', () => {
    renderTable({ active: true, targetSubject: 'bob@corp' })

    const buttons = screen.getAllByRole('button', { name: /^Impersonate / })
    expect(buttons).toHaveLength(3)
    buttons.forEach((btn) => expect(btn).toBeDisabled())

    fireEvent.click(buttons[0])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens the confirm dialog naming the subject when a row button is clicked', () => {
    renderTable()

    fireEvent.click(screen.getByTestId('user-impersonate-button-alice@corp'))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByText(/alice@corp/)).toBeInTheDocument()
  })

  it('exposes accessible names on the search box and the row actions', () => {
    renderTable({ subjects: subjects('alice@corp') })

    const box = screen.getByLabelText('Search subjects')
    expect(box).toHaveAttribute('type', 'search')

    expect(
      screen.getByRole('button', { name: 'Impersonate alice@corp' }),
    ).toBeInTheDocument()
  })

  it('gives the open-mode branch precedence over loading and error', () => {
    renderTable({ open: true, isLoading: true, isError: true, error: new Error('x') })

    expect(screen.getByTestId('users-page-open-mode')).toBeInTheDocument()
    expect(screen.queryByTestId('users-page-loading')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })
})
