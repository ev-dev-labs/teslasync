// TwinDetailPanel unit tests.
//
// TwinDetailPanel is the shared surface for every Digital Twin
// component-state section. It owns four mutually-exclusive branches
// (loading / error / empty / ready) plus a ready-only footer slot, so
// the coverage here exercises each branch, their precedence, the
// accessibility affordances, the error → onRetry wiring, and the
// null-safety hardening around the KVList rows.
//
// Coverage:
//   1. Ready state renders the title, decorative icon, and every row.
//   2. The footer slot renders only in the ready state.
//   3. Loading state exposes an accessible status region + aria-busy and
//      hides the rows and footer.
//   4. Loading takes precedence over a concurrent error.
//   5. Empty state renders the message + icon and suppresses the footer.
//   6. A generic (network) error renders an alert and its Retry control
//      invokes the onRetry callback.
//   7. A 404 ApiError is forwarded to QueryError's not-found branch with
//      no retry affordance.
//   8. Passing `undefined` for items does not crash (null-safe rows).
//   9. The columns prop is forwarded to KVList.

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

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
        if (opts && typeof opts.defaultValue === 'string') return opts.defaultValue as string
        let out = fallback ?? key
        if (opts) {
          for (const [k, v] of Object.entries(opts)) {
            out = out.replace(`{{${k}}}`, String(v))
          }
        }
        return out
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

// QueryError branches on the browser online state; pin it to `true` so
// the generic-error path renders the enabled "Retry" affordance
// deterministically instead of the offline "Retry when online" variant.
vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}))

import { ApiError } from '@/api/client'
import { TwinDetailPanel, type TwinDetailItem } from './TwinDetailPanel'

const ROWS: TwinDetailItem[] = [
  { label: 'Driver Front', value: 'Closed' },
  { label: 'Passenger Front', value: 'Open' },
]

const TITLE = 'Doors & Openings'

interface RenderOptions {
  title?: string
  icon?: ReactNode
  items?: TwinDetailItem[]
  isLoading?: boolean
  error?: unknown
  isEmpty?: boolean
  emptyIcon?: ReactNode
  emptyMessage?: string
  onRetry?: () => void
  footer?: ReactNode
  columns?: 1 | 2
}

function renderPanel(opts: RenderOptions = {}) {
  const {
    title = TITLE,
    items = ROWS,
    emptyMessage = 'No door data available',
    ...rest
  } = opts
  return render(
    <MemoryRouter>
      <TwinDetailPanel title={title} items={items} emptyMessage={emptyMessage} {...rest} />
    </MemoryRouter>,
  )
}

describe('TwinDetailPanel — ready state', () => {
  it('renders the title, decorative icon, and every key/value row', () => {
    const { container } = renderPanel({
      icon: <svg data-testid="door-icon" aria-hidden="true" />,
    })

    expect(screen.getByText(TITLE)).toBeInTheDocument()
    expect(screen.getByTestId('door-icon')).toBeInTheDocument()
    expect(screen.getByText('Driver Front')).toBeInTheDocument()
    expect(screen.getByText('Closed')).toBeInTheDocument()
    expect(screen.getByText('Passenger Front')).toBeInTheDocument()
    expect(screen.getByText('Open')).toBeInTheDocument()

    // Neither the loading status nor the error alert should appear.
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    // The content region is not marked busy once data is present.
    expect(container.querySelector('[aria-busy="true"]')).toBeNull()
  })

  it('renders the footer slot only in the ready state', () => {
    renderPanel({ footer: <span data-testid="twin-footer">badge</span> })
    expect(screen.getByTestId('twin-footer')).toBeInTheDocument()
    expect(screen.getByText('badge')).toBeInTheDocument()
  })
})

describe('TwinDetailPanel — loading state', () => {
  it('exposes an accessible loading status + aria-busy and hides rows and footer', () => {
    const { container } = renderPanel({
      isLoading: true,
      footer: <span data-testid="twin-footer">badge</span>,
    })

    const status = screen.getByRole('status', { name: /loading/i })
    expect(status).toBeInTheDocument()
    // The section title is interpolated into the accessible name.
    expect(status).toHaveAttribute('aria-label', `Loading ${TITLE}`)
    // Busy is signalled on the content region while telemetry loads.
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()

    // Rows and footer must not render behind the skeleton.
    expect(screen.queryByText('Driver Front')).toBeNull()
    expect(screen.queryByTestId('twin-footer')).toBeNull()
  })

  it('takes precedence over a concurrent error (loading wins)', () => {
    renderPanel({ isLoading: true, error: new Error('still loading') })
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument()
    // The error branch must not render while loading.
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('TwinDetailPanel — empty state', () => {
  it('renders the empty message + icon and suppresses the footer', () => {
    renderPanel({
      isEmpty: true,
      emptyMessage: 'No door data available',
      emptyIcon: <svg data-testid="empty-icon" aria-hidden="true" />,
      footer: <span data-testid="twin-footer">badge</span>,
    })

    expect(screen.getByText('No door data available')).toBeInTheDocument()
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument()
    // Real rows and the footer are both hidden in the empty branch.
    expect(screen.queryByText('Driver Front')).toBeNull()
    expect(screen.queryByTestId('twin-footer')).toBeNull()
  })
})

describe('TwinDetailPanel — error state', () => {
  it('renders a recoverable network error whose Retry invokes onRetry', () => {
    const onRetry = vi.fn()
    renderPanel({ error: new Error('boom'), onRetry })

    expect(screen.getByRole('alert')).toBeInTheDocument()
    // Rows are replaced by the error, never rendered alongside it.
    expect(screen.queryByText('Driver Front')).toBeNull()

    const retry = screen.getByRole('button', { name: 'Retry' })
    fireEvent.click(retry)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('forwards a 404 ApiError to the not-found branch with no retry affordance', () => {
    const onRetry = vi.fn()
    renderPanel({ error: new ApiError('missing', 404), onRetry })

    expect(screen.getByText(/not found/i)).toBeInTheDocument()
    // Without a listHref, the 404 branch renders no actionable control,
    // so onRetry stays untouched and no button is offered.
    expect(screen.queryByRole('button')).toBeNull()
    expect(onRetry).not.toHaveBeenCalled()
  })
})

describe('TwinDetailPanel — hardening', () => {
  it('does not crash when items is undefined (null-safe rows)', () => {
    // Render directly (not via the renderPanel default) so `undefined`
    // reaches the component and exercises the `items ?? []` guard — the
    // renderPanel helper's default parameter would otherwise substitute
    // a populated array.
    const { container } = render(
      <MemoryRouter>
        <TwinDetailPanel
          title={TITLE}
          items={undefined as unknown as TwinDetailItem[]}
          emptyMessage="No door data available"
        />
      </MemoryRouter>,
    )

    // The panel chrome still renders instead of throwing on `.map`.
    expect(screen.getByText(TITLE)).toBeInTheDocument()
    const list = container.querySelector('dl')
    expect(list).not.toBeNull()
    // No rows are produced from an absent collection.
    expect(within(list as HTMLElement).queryAllByRole('term')).toHaveLength(0)
  })

  it('forwards the columns prop to KVList', () => {
    const { container: two } = renderPanel({ columns: 2 })
    expect(two.querySelector('dl')?.className).toContain('grid-cols-2')

    const { container: one } = renderPanel({ columns: 1 })
    expect(one.querySelector('dl')?.className ?? '').not.toContain('grid-cols-2')
  })
})
