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

import { describe, expect, it, vi, beforeEach } from 'vitest'
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
      data: unreadLogsMock,
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

const RULES: AlertRule[] = [
  {
    id: 10,
    name: 'Battery Low',
    enabled: true,
    severity: 'warn',
    vehicle_id: 1,
    signal: 'battery_level',
    operator: '<',
    value: 20,
    cooldown_seconds: 0,
    notification_channels: [],
    created_at: '',
    updated_at: '',
  } as unknown as AlertRule,
]

const NOW = new Date()
const ONE_HOUR_AGO = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString()

function makeLog(id: number, title: string, message: string): NotificationLog {
  return {
    id,
    alert_id: 10,
    channel_id: 1,
    title,
    message,
    status: 'sent',
    error: '',
    created_at: ONE_HOUR_AGO,
    sent_at: ONE_HOUR_AGO,
    read_at: null,
    archived_at: null,
  } as unknown as NotificationLog
}

// Imported AFTER the vi.mock blocks so the mocks are wired before the
// component module evaluates its top-level hook references.
import { NotificationBellPopover } from './NotificationBellPopover'

function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="location">{loc.pathname}</div>
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
  beforeEach(() => {
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

  it('"View all" navigates to /notifications/inbox and closes the popover', async () => {
    renderPopover('/dashboard')
    fireEvent.click(
      screen.getByRole('button', { name: /3 unread notifications/i }),
    )
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: /View all/i }))
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
})
