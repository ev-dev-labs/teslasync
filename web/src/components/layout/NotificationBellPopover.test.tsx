/**
 * NotificationBellPopover behaviour tests.
 *
 * Validates the in-place triage panel that opens from the header bell:
 *   - desktop click opens a role="dialog" popover
 *   - empty unread list shows the "all caught up" empty state
 *   - "Mark all read" wires through to useBulkMarkRead({ all: true })
 *   - Escape closes the popover
 *   - focus returns to the trigger after close
 *   - mobile (≤640 px) viewport bypasses the popover and navigates
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import '../../i18n'

import type { AlertRule, NotificationLog } from '@/api/types'
import type { Vehicle } from '@/types/vehicle'

// ── Mocks ─────────────────────────────────────────────────────────────

const bulkMarkReadMutate = vi.fn()
const bulkMarkReadMutateAsync = vi.fn(async (vars: unknown) => {
  bulkMarkReadMutate(vars)
  return { updated: 0 }
})

let unreadCountMock = 3
let unreadLogsMock: NotificationLog[] = []
let unreadIsLoadingMock = false
let unreadErrorMock: unknown = null
let isMobileMock = false

vi.mock('@/api/hooks/useNotifications', async () => {
  const actual = await vi.importActual<
    typeof import('@/api/hooks/useNotifications')
  >('@/api/hooks/useNotifications')
  return {
    ...actual,
    useUnreadCount: () => ({ data: unreadCountMock }),
    useUnreadNotifications: () => ({
      data: unreadLogsMock.length === 0 && (unreadIsLoadingMock || unreadErrorMock)
        ? undefined
        : unreadLogsMock,
      isLoading: unreadIsLoadingMock,
      error: unreadErrorMock,
    }),
    useAlertRules: () => ({ data: RULES }),
    useBulkMarkRead: () => ({
      mutate: (vars: unknown) => bulkMarkReadMutate(vars),
      mutateAsync: bulkMarkReadMutateAsync,
      isPending: false,
    }),
  }
})

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: VEHICLES }),
}))

vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: () => false,
  useIsMobile: () => isMobileMock,
  useIsCoarsePointer: () => false,
}))

// ── Fixtures ──────────────────────────────────────────────────────────

const VEHICLES: Vehicle[] = [
  {
    id: 1,
    vehicle_id: 1,
    vin: 'VIN-A',
    display_name: 'Roadster',
    model: 'roadster',
    trim_badging: '',
    exterior_color: '',
    wheel_type: '',
    state: 'online',
    healthy: true,
    created_at: '',
    updated_at: '',
  },
]

function makeRule(id: number, name: string, severity: AlertRule['severity']): AlertRule {
  return {
    id,
    name,
    enabled: true,
    severity,
    vehicle_id: 1,
    signal_name: 'battery_level',
    op: '<',
    value_num: 20,
    cooldown_min: 0,
    trigger_mode: 'once',
    channel_ids: [],
    created_at: '',
    updated_at: '',
  }
}

const RULES: AlertRule[] = [
  makeRule(10, 'Battery Low', 'warn'),
  makeRule(11, 'Thermal Runaway', 'critical'),
  makeRule(12, 'Charge Complete', 'info'),
]

const NOW = new Date()
const ONE_HOUR_AGO = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString()

function makeLog(id: number, title: string, message: string, alertId = 10): NotificationLog {
  return {
    id,
    alert_id: alertId,
    channel_id: 1,
    title,
    message,
    status: 'sent',
    error: '',
    created_at: ONE_HOUR_AGO,
    sent_at: ONE_HOUR_AGO,
    read_at: null,
    archived_at: null,
  }
}

// Imported AFTER the vi.mock blocks so the mocks are wired before the
// component module evaluates its top-level hook references.
import { NotificationBellPopover } from './NotificationBellPopover'

function LocationProbe() {
  const loc = useLocation()
  return (
    <>
      <div data-testid="location">{loc.pathname}</div>
      <div data-testid="location-search">{loc.search}</div>
    </>
  )
}

function renderPopover(initialEntry = '/') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Wrapper>
          <NotificationBellPopover />
          <LocationProbe />
        </Wrapper>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function Wrapper({ children }: { children: ReactNode }) {
  return <div>{children}</div>
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('NotificationBellPopover', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  beforeEach(async () => {
    await import('./NotificationSeverityFilter')
    cleanup()
    bulkMarkReadMutate.mockReset()
    bulkMarkReadMutateAsync.mockClear()
    bulkMarkReadMutateAsync.mockImplementation(async (vars: unknown) => {
      bulkMarkReadMutate(vars)
      return { updated: 0 }
    })
    unreadCountMock = 3
    unreadLogsMock = [makeLog(100, 'Battery low', 'Battery dropped below 20%')]
    unreadIsLoadingMock = false
    unreadErrorMock = null
    isMobileMock = false
  })

  it('renders the bell trigger with an unread badge and aria-label', () => {
    renderPopover()
    const trigger = screen.getByRole('button', {
      name: /3 unread notifications/i,
    })
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveTextContent('3')
  })

  it('renders "Notifications" aria-label when count is zero (no badge)', () => {
    unreadCountMock = 0
    unreadLogsMock = []
    renderPopover()
    const trigger = screen.getByRole('button', { name: /^Notifications$/i })
    expect(trigger).toBeInTheDocument()
    // Badge span carries the count text — none should be rendered.
    expect(trigger.textContent?.trim()).toBe('')
  })

  it('caps the badge display at "99+" for large counts', () => {
    unreadCountMock = 250
    renderPopover()
    const trigger = screen.getByRole('button', {
      name: /250 unread notifications/i,
    })
    expect(trigger).toHaveTextContent('99+')
  })

  it('opens a role="dialog" popover on click and flips aria-expanded', async () => {
    renderPopover()
    const trigger = screen.getByRole('button', {
      name: /3 unread notifications/i,
    })
    fireEvent.click(trigger)
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('aria-labelledby')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    // Heading shown
    expect(
      screen.getByRole('heading', { name: /Notifications/i }),
    ).toBeInTheDocument()
  })

  it('renders the unread list with title, message preview, and vehicle', async () => {
    renderPopover()
    fireEvent.click(
      screen.getByRole('button', { name: /3 unread notifications/i }),
    )
    await screen.findByRole('dialog')
    expect(screen.getByText('Battery low')).toBeInTheDocument()
    expect(
      screen.getByText(/Battery dropped below 20%/i),
    ).toBeInTheDocument()
    // Vehicle name is joined via useAlertRules → useVehicles
    expect(screen.getByText('Roadster')).toBeInTheDocument()
  })

  it('shows the empty "all caught up" state when there are no unread items', async () => {
    unreadLogsMock = []
    unreadCountMock = 0
    renderPopover()
    fireEvent.click(screen.getByRole('button', { name: /^Notifications$/i }))
    await screen.findByRole('dialog')
    expect(
      screen.getByText(/You're all caught up/i),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('bell-popover-list')).toBeNull()
  })

  it('shows an error banner when the unread query fails', async () => {
    unreadLogsMock = []
    unreadErrorMock = new Error('boom')
    renderPopover()
    fireEvent.click(
      screen.getByRole('button', { name: /3 unread notifications/i }),
    )
    await screen.findByRole('dialog')
    expect(
      screen.getByText(/Could not load notifications/i),
    ).toBeInTheDocument()
  })

  it('shows the loading state when isLoading is true and there are no logs yet', async () => {
    unreadLogsMock = []
    unreadIsLoadingMock = true
    renderPopover()
    fireEvent.click(
      screen.getByRole('button', { name: /3 unread notifications/i }),
    )
    await screen.findByRole('dialog')
    expect(screen.getByText(/Loading…/i)).toBeInTheDocument()
  })

  it('"Mark all read" calls useBulkMarkRead with { all: true }', async () => {
    renderPopover()
    fireEvent.click(
      screen.getByRole('button', { name: /3 unread notifications/i }),
    )
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: /Mark all read/i }))
    await waitFor(() => expect(bulkMarkReadMutate).toHaveBeenCalledTimes(1))
    expect(bulkMarkReadMutate).toHaveBeenCalledWith({ all: true })
  })

  it('does NOT fire useBulkMarkRead when the preview list is empty', async () => {
    unreadLogsMock = []
    unreadCountMock = 0
    renderPopover()
    fireEvent.click(screen.getByRole('button', { name: /^Notifications$/i }))
    await screen.findByRole('dialog')
    const markBtn = screen.getByRole('button', { name: /Mark all read/i })
    // Disabled when nothing to mark.
    expect(markBtn).toBeDisabled()
    fireEvent.click(markBtn)
    expect(bulkMarkReadMutate).not.toHaveBeenCalled()
  })

  it('opens the full inbox without filters when showing all severities', async () => {
    renderPopover('/dashboard')
    fireEvent.click(
      screen.getByRole('button', { name: /3 unread notifications/i }),
    )
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: /Open full inbox/i }))
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/notifications/inbox'),
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('clicking a row navigates to /notifications/inbox and closes the popover', async () => {
    renderPopover('/dashboard')
    fireEvent.click(
      screen.getByRole('button', { name: /3 unread notifications/i }),
    )
    await screen.findByRole('dialog')
    // The row is rendered as a button containing the title.
    const row = screen.getByRole('button', { name: /Battery low/i })
    fireEvent.click(row)
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/notifications/inbox'),
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Escape key closes the popover', async () => {
    renderPopover()
    fireEvent.click(
      screen.getByRole('button', { name: /3 unread notifications/i }),
    )
    await screen.findByRole('dialog')
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('outside-click (mousedown on body) closes the popover', async () => {
    renderPopover()
    fireEvent.click(
      screen.getByRole('button', { name: /3 unread notifications/i }),
    )
    await screen.findByRole('dialog')
    act(() => {
      fireEvent.mouseDown(document.body)
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('returns focus to the bell trigger after close', async () => {
    renderPopover()
    const trigger = screen.getByRole('button', {
      name: /3 unread notifications/i,
    })
    fireEvent.click(trigger)
    await screen.findByRole('dialog')
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })

  it('mobile viewport bypasses the popover and navigates directly', async () => {
    isMobileMock = true
    renderPopover('/dashboard')
    fireEvent.click(
      screen.getByRole('button', { name: /3 unread notifications/i }),
    )
    // No dialog opens
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/notifications/inbox'),
    )
  })

  it('filters the preview by severity with per-severity counts', async () => {
    unreadLogsMock = [
      makeLog(100, 'Battery low', 'Battery dropped below 20%', 10),
      makeLog(101, 'Pack overheating', 'Cell delta too high', 11),
      makeLog(102, 'Charge complete', 'Reached target SoC', 12),
    ]
    renderPopover()
    fireEvent.click(
      screen.getByRole('button', { name: /3 unread notifications/i }),
    )
    await screen.findByRole('dialog')

    expect(screen.getByRole('button', { name: 'All, 3 in latest 3' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Critical, 1 in latest 3' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Warning, 1 in latest 3' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Info, 1 in latest 3' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Critical, 1 in latest 3' }))
    expect(screen.getByText('Pack overheating')).toBeInTheDocument()
    expect(screen.queryByText('Battery low')).toBeNull()
    expect(screen.queryByText('Charge complete')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'All, 3 in latest 3' }))
    expect(screen.getByText('Battery low')).toBeInTheDocument()
    expect(screen.getByText('Pack overheating')).toBeInTheDocument()
    expect(screen.getByText('Charge complete')).toBeInTheDocument()
  })

  it('shows an empty-filter state instead of a blank list', async () => {
    unreadLogsMock = [makeLog(100, 'Battery low', 'Battery dropped below 20%', 10)]
    renderPopover()
    fireEvent.click(
      screen.getByRole('button', { name: /3 unread notifications/i }),
    )
    await screen.findByRole('dialog')

    fireEvent.click(screen.getByRole('button', { name: 'Critical, 0 in latest 1' }))
    expect(screen.queryByText('Battery low')).toBeNull()
    expect(screen.queryByTestId('bell-popover-list')).toBeNull()
    expect(screen.getByText('No matches in this preview. Open the inbox for older notifications.')).toBeInTheDocument()
  })

  it('scopes zero severity counts to the latest ten when older unread items exist', async () => {
    unreadCountMock = 25
    unreadLogsMock = Array.from({ length: 10 }, (_, index) =>
      makeLog(index + 100, `Info ${index}`, 'Recent informational item', 12),
    )
    renderPopover()
    fireEvent.click(screen.getByRole('button', { name: /25 unread notifications/i }))
    await screen.findByRole('dialog')

    expect(screen.getByText('Preview: 10 of 25 unread')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Critical, 0 in latest 10' }))
    expect(screen.getByText('No matches in this preview. Open the inbox for older notifications.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'See all critical unread' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/notifications/inbox')
    expect(screen.getByTestId('location-search')).toHaveTextContent('severity=critical&read=unread')
  })

  it('Tab from the last focusable element wraps back to the first (focus trap)', async () => {
    renderPopover()
    fireEvent.click(
      screen.getByRole('button', { name: /3 unread notifications/i }),
    )
    const dialog = await screen.findByRole('dialog')
    const focusables = dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    expect(focusables.length).toBeGreaterThan(1)
    const last = focusables[focusables.length - 1]
    last.focus()
    expect(document.activeElement).toBe(last)
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(document.activeElement).toBe(focusables[0])
  })

  it('retains primitive focus and motion chrome without decorative badge severity', () => {
    renderPopover()
    const trigger = screen.getByRole('button', { name: /3 unread notifications/i })
    expect(trigger).toHaveClass('rounded-shape-sm', 'focus-visible:outline-2', 'focus-visible:outline-offset-2')
    expect(trigger).toHaveClass('duration-fast', 'ease-standard', 'motion-reduce:transition-none')
    expect(trigger).not.toHaveClass('focus-visible:outline-none', 'focus-visible:ring-cyan-500')
    const badge = trigger.querySelector('span[aria-hidden="true"]')
    expect(badge).toHaveClass('bg-[var(--semantic-info-bg)]', 'text-[var(--semantic-info)]', 'min-w-4')
    expect(badge).not.toHaveClass('bg-rose-500', 'shadow')
  })

  it('does not steal focus on initial mount', () => {
    const focusedBeforeMount = document.activeElement
    renderPopover()
    expect(document.activeElement).toBe(focusedBeforeMount)
  })

  it('toggles closed from the trigger and removes the dialog association', async () => {
    renderPopover()
    const trigger = screen.getByRole('button', { name: /3 unread notifications/i })
    expect(trigger).not.toHaveAttribute('aria-controls')
    fireEvent.click(trigger)
    const dialog = await screen.findByRole('dialog')
    expect(trigger).toHaveAttribute('aria-controls', dialog.id)
    fireEvent.mouseDown(trigger)
    expect(dialog).toBeInTheDocument()
    fireEvent.click(trigger)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).not.toHaveAttribute('aria-controls')
    expect(document.activeElement).toBe(trigger)
  })

  it('keeps inside presses and unrelated keys open, then restores focus from Close', async () => {
    renderPopover()
    const trigger = screen.getByRole('button', { name: /3 unread notifications/i })
    fireEvent.click(trigger)
    const dialog = await screen.findByRole('dialog')
    fireEvent.mouseDown(dialog)
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(dialog).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Close$/i }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('preserves portaled edge clamp and fixed positioning on resize and nested scroll', async () => {
    renderPopover()
    const trigger = screen.getByRole('button', { name: /3 unread notifications/i })
    const bounds = vi.spyOn(trigger, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(100, 20, 36, 36))
    fireEvent.click(trigger)
    const dialog = await screen.findByRole('dialog')
    expect(dialog.parentElement).toBe(document.body)
    expect(dialog).toHaveStyle({
      position: 'fixed', top: '64px', width: '360px',
      right: `${Math.max(8, window.innerWidth - 360 - 8)}px`,
    })
    expect(dialog.style.maxWidth).toBe('calc(100vw - 1rem)')
    bounds.mockReturnValue(new DOMRect(window.innerWidth - 36, 80, 36, 36))
    fireEvent.resize(window)
    expect(dialog).toHaveStyle({ top: '124px', right: '8px' })
    bounds.mockReturnValue(new DOMRect(window.innerWidth - 36, 100, 36, 36))
    fireEvent.scroll(trigger.parentElement ?? trigger)
    expect(dialog).toHaveStyle({ top: '144px', right: '8px' })
  })

  it('retains complete long notification content in an RTL host', async () => {
    const title = 'تنبيه البطارية '.repeat(20)
    const message = 'تفاصيل التنبيه '.repeat(40)
    unreadLogsMock = [makeLog(100, title, message)]
    const view = renderPopover()
    view.container.dir = 'rtl'
    fireEvent.click(screen.getByRole('button', { name: /3 unread notifications/i }))
    await screen.findByRole('dialog')
    expect(screen.getByRole('button', { name: /تنبيه البطارية/ })).toHaveTextContent(title.trim())
    expect(screen.getByText(message.trim())).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open full inbox/i })).toBeEnabled()
  })
})
