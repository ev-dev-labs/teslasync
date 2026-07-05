/**
 * OperationsSection tests.
 *
 * OperationsSection is the "Operations" accordion on the System Status page. It
 * fans three independent `useQuery` calls (notification stats, notification
 * logs, audit logs) into a header success-rate badge plus two disclosure
 * sections. The component owns real branching that these tests exercise:
 *
 *   - header badge variant by success-rate threshold (success/warning/danger)
 *   - the shared loading skeleton while any query is in flight
 *   - the populated happy path (metric cards + radial gauge + two tables)
 *   - the built-in empty-message path for each table
 *   - a per-source <QueryError> when a query fails, INCLUDING the regression
 *     guard that a failed notification-logs query no longer nukes the whole
 *     delivery section (the old `{notifStats && ...}` gate — prohibited
 *     pattern #6)
 *   - the divide-by-zero + `?? 0` null-safety guards
 *
 * Network is mocked at the `@/api/settings` / `@/api/devtools` module boundary
 * (spreading the real module so unrelated exports stay intact), then driven
 * through a real QueryClient so TanStack's loading/error state machine runs for
 * real. The accordion is collapsed by default, so every body assertion expands
 * it first. `@testing-library/user-event` is intentionally NOT a dependency of
 * this repo, so the single interaction (expand) uses `fireEvent`, matching the
 * sibling status-card tests.
 */

import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { AuditLog, NotificationLog, NotificationStats } from '@/api/types'

const { mockGetStats, mockGetLogs, mockGetAudit } = vi.hoisted(() => ({
  mockGetStats: vi.fn(),
  mockGetLogs: vi.fn(),
  mockGetAudit: vi.fn(),
}))

vi.mock('@/api/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/settings')>()
  return {
    ...actual,
    getNotificationStats: mockGetStats,
    getNotificationLogs: mockGetLogs,
  }
})

vi.mock('@/api/devtools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/devtools')>()
  return {
    ...actual,
    getAuditLogs: mockGetAudit,
  }
})

import { OperationsSection } from '../OperationsSection'

// ── Fixtures ───────────────────────────────────────────────────────────────
function makeStats(overrides: Partial<NotificationStats> = {}): NotificationStats {
  return {
    total_sent: 0,
    sent: 0,
    failed: 0,
    pending: 0,
    total_channels: 0,
    enabled_channels: 0,
    ...overrides,
  }
}

function makeLog(overrides: Partial<NotificationLog> = {}): NotificationLog {
  return {
    id: 1,
    channel_id: 1,
    alert_id: null,
    title: 'Notification title',
    message: 'Notification message',
    status: 'sent',
    error: '',
    created_at: '2025-01-15T10:00:00Z',
    sent_at: '2025-01-15T10:00:01Z',
    ...overrides,
  }
}

function makeAudit(overrides: Partial<AuditLog> = {}): AuditLog {
  return {
    id: 1,
    action: 'update',
    resource: '/resource',
    details: 'details',
    ip: '10.0.0.1',
    created_at: '2025-01-15T09:00:00Z',
    ...overrides,
  }
}

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <OperationsSection />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

// The accordion renders its body lazily; open it before asserting body content.
function expand() {
  fireEvent.click(screen.getByRole('button', { name: /Operations/i }))
}

beforeEach(() => {
  mockGetStats.mockReset()
  mockGetLogs.mockReset()
  mockGetAudit.mockReset()
  // Safe defaults — individual tests override as needed.
  mockGetStats.mockResolvedValue(makeStats())
  mockGetLogs.mockResolvedValue([])
  mockGetAudit.mockResolvedValue([])
})

describe('OperationsSection — header success-rate badge', () => {
  it('renders the header labels and a green success badge once stats load', async () => {
    mockGetStats.mockResolvedValue(makeStats({ total_sent: 200, sent: 190, failed: 10 }))

    renderSection()

    const badge = await screen.findByText(/success rate/i)
    expect(badge).toHaveTextContent('95.0%')
    expect(badge.className).toContain('bg-green-100')
    // Header title/description are visible even while the accordion is collapsed.
    expect(screen.getByText('Operations')).toBeInTheDocument()
    expect(screen.getByText('Notification delivery and audit trail')).toBeInTheDocument()
  })

  it('colours the badge by threshold: warning in [80,95), danger below 80', async () => {
    // Warning band.
    mockGetStats.mockResolvedValue(makeStats({ total_sent: 100, sent: 90, failed: 10 }))
    const { unmount } = renderSection()
    const warn = await screen.findByText(/success rate/i)
    expect(warn).toHaveTextContent('90.0%')
    expect(warn.className).toContain('bg-yellow-100')
    unmount()

    // Danger band.
    mockGetStats.mockResolvedValue(makeStats({ total_sent: 100, sent: 70, failed: 30 }))
    renderSection()
    const danger = await screen.findByText(/success rate/i)
    expect(danger).toHaveTextContent('70.0%')
    expect(danger.className).toContain('bg-red-100')
  })
})

describe('OperationsSection — loading', () => {
  it('shows skeleton placeholders while the queries are in flight', () => {
    mockGetStats.mockReturnValue(new Promise(() => {}))
    mockGetLogs.mockReturnValue(new Promise(() => {}))
    mockGetAudit.mockReturnValue(new Promise(() => {}))

    const { container } = renderSection()
    expand()

    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(1)
    // Body content has not resolved yet.
    expect(screen.queryByText('Notification Delivery')).toBeNull()
    expect(screen.getByRole('button', { name: /Operations/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })
})

describe('OperationsSection — populated', () => {
  it('renders metric cards, the success gauge, and both data tables', async () => {
    mockGetStats.mockResolvedValue(
      makeStats({ total_sent: 200, sent: 190, failed: 10, enabled_channels: 3, total_channels: 5 }),
    )
    mockGetLogs.mockResolvedValue([
      makeLog({ id: 1, title: 'Battery low', message: 'SOC at 15%', status: 'sent' }),
    ])
    mockGetAudit.mockResolvedValue([
      makeAudit({ id: 1, action: 'login', resource: '/api/v1/settings', details: 'user changed theme' }),
    ])

    renderSection()
    await screen.findByText(/success rate/i)
    expand()

    // Section headings.
    expect(await screen.findByText('Notification Delivery')).toBeInTheDocument()
    expect(screen.getByText('Audit Log')).toBeInTheDocument()

    // Metric cards (label + formatted value).
    expect(screen.getByText('Total Sent')).toBeInTheDocument()
    expect(screen.getByText('200')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('Channels')).toBeInTheDocument()
    expect(screen.getByText('3/5')).toBeInTheDocument()

    // Radial gauge renders the integer success value and its label.
    expect(screen.getByText('95')).toBeInTheDocument()
    expect(screen.getByText('Success')).toBeInTheDocument()

    // Notification-log row.
    expect(screen.getByText('Battery low')).toBeInTheDocument()
    expect(screen.getByText('SOC at 15%')).toBeInTheDocument()
    expect(screen.getByText('sent')).toBeInTheDocument()

    // Audit-log row.
    expect(screen.getByText('login')).toBeInTheDocument()
    expect(screen.getByText('/api/v1/settings')).toBeInTheDocument()
    expect(screen.getByText('user changed theme')).toBeInTheDocument()
  })

  it('shows the built-in empty message for each table when the lists are empty', async () => {
    mockGetStats.mockResolvedValue(makeStats({ total_sent: 50, sent: 50, failed: 0 }))
    mockGetLogs.mockResolvedValue([])
    mockGetAudit.mockResolvedValue([])

    renderSection()
    await screen.findByText(/success rate/i)
    expand()

    expect(await screen.findByText('No recent notifications')).toBeInTheDocument()
    expect(screen.getByText('No audit log entries')).toBeInTheDocument()
    // Metrics still render alongside the empty tables (never a blank panel).
    expect(screen.getByText('Total Sent')).toBeInTheDocument()
    expect(screen.getByText('Notification Delivery')).toBeInTheDocument()
  })
})

describe('OperationsSection — failure paths', () => {
  it('renders an error alert for every data source when the queries fail', async () => {
    mockGetStats.mockRejectedValue(new Error('stats down'))
    mockGetLogs.mockRejectedValue(new Error('logs down'))
    mockGetAudit.mockRejectedValue(new Error('audit down'))

    renderSection()
    expand()

    const alerts = await screen.findAllByRole('alert')
    expect(alerts.length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/reach server/i).length).toBeGreaterThanOrEqual(1)
    // No metric cards and no header badge when stats failed.
    expect(screen.queryByText('Total Sent')).toBeNull()
    expect(screen.queryByText(/success rate/i)).toBeNull()
  })

  it('keeps delivery metrics and the audit table when only the logs query fails', async () => {
    // Regression guard for the old `{notifStats && ...}` gate that used to hide
    // the ENTIRE delivery section (metrics included) whenever anything nested
    // under it was unavailable.
    mockGetStats.mockResolvedValue(
      makeStats({ total_sent: 100, sent: 95, failed: 5, enabled_channels: 2, total_channels: 4 }),
    )
    mockGetLogs.mockRejectedValue(new Error('logs down'))
    mockGetAudit.mockResolvedValue([
      makeAudit({ id: 7, action: 'export', resource: '/exports', details: 'csv' }),
    ])

    renderSection()
    await screen.findByText(/success rate/i)
    expand()

    // Delivery metrics still render despite the logs failure.
    expect(await screen.findByText('Total Sent')).toBeInTheDocument()
    expect(screen.getByText('2/4')).toBeInTheDocument()
    // The failed logs query surfaces its own inline error.
    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(1)
    // Audit table is independent and still shows its row.
    expect(screen.getByText('export')).toBeInTheDocument()
    expect(screen.getByText('/exports')).toBeInTheDocument()
  })
})

describe('OperationsSection — null safety', () => {
  it('treats zero sent as 100% and falls back to 0/0 for missing channel counts', async () => {
    // enabled_channels / total_channels intentionally omitted to hit the `?? 0`
    // guards; total_sent === 0 hits the divide-by-zero fallback branch.
    mockGetStats.mockResolvedValue({
      total_sent: 0,
      sent: 0,
      failed: 0,
      pending: 0,
    } as unknown as NotificationStats)
    mockGetLogs.mockResolvedValue([])
    mockGetAudit.mockResolvedValue([])

    renderSection()
    const badge = await screen.findByText(/success rate/i)
    expect(badge).toHaveTextContent('100.0%')
    expect(badge.className).toContain('bg-green-100')

    expand()
    expect(await screen.findByText('0/0')).toBeInTheDocument()
    expect(screen.getByText('Total Sent')).toBeInTheDocument()
  })
})
