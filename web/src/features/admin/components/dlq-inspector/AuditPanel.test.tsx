/**
 * AuditPanel contract tests — DLQ Inspector replay-audit log.
 *
 * Exercises every branch of the panel:
 *  - global vs scoped empty states (message + role="status")
 *  - the in-table loading placeholder (no EmptyState swap-out)
 *  - full row rendering across all seven columns
 *  - the result → Badge variant mapping, including the unknown-result
 *    `?? 'neutral'` fallback (a runtime branch the union type hides)
 *  - empty-string field fallbacks to the shared "—" placeholder
 *  - the null-safe `rows` guard (undefined / null must not crash)
 *
 * `react-i18next` is stubbed so `t(key, 'Default')` yields the English
 * default — assertions then read against the real copy. `TimeStamp` is
 * stubbed to a deterministic span so the test does not drag in the
 * settings / timezone / selected-vehicle provider stack (that component
 * carries its own suite under components/data-display). Everything else —
 * DataTable, Badge, Text, EmptyState — renders for real.
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
      t: (key: string, fallback?: unknown) =>
        typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

vi.mock('@/components/data-display', () => ({
  TimeStamp: ({ value, format }: { value: unknown; format?: string }) => (
    <span data-testid="dlq-timestamp" data-format={format}>
      {String(value)}
    </span>
  ),
}))

import { AuditPanel } from './AuditPanel'
import type {
  DLQReplayAuditRecord,
  DLQReplayResult,
} from '@/types/admin-diagnostics'
import { BADGE_VARIANTS } from '@/components/ui'

function makeRow(
  overrides: Partial<DLQReplayAuditRecord> = {},
): DLQReplayAuditRecord {
  return {
    id: 1,
    replayed_at: '2026-05-05T12:00:00Z',
    actor: 'alice@ops',
    actor_ip: '10.0.0.1',
    dlq_id: 501,
    src_topic: 'telemetry/dlq',
    dst_topic: 'telemetry/VIN123/v/VehicleSpeed',
    payload: 'e30=',
    reason: 'codec_drop',
    result: 'ok',
    error: '',
    trace_id: 'trace-abc',
    ...overrides,
  }
}

describe('AuditPanel', () => {
  it('renders the global empty state (no table) when not loading and no rows', () => {
    render(<AuditPanel rows={[]} loading={false} />)

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('No replay attempts yet')).toBeInTheDocument()
    expect(
      screen.getByText(/Replay attempts will appear here once an operator triggers one\./),
    ).toBeInTheDocument()
    // No DataTable is mounted in the empty branch.
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('renders the scoped empty message when a scopedDlqId is supplied', () => {
    render(<AuditPanel rows={[]} loading={false} scopedDlqId={77} />)

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(
      screen.getByText(/This entry has not been replayed\./),
    ).toBeInTheDocument()
    // The scoped copy replaces the global copy — not both.
    expect(
      screen.queryByText(/Replay attempts will appear here/),
    ).toBeNull()
  })

  it('shows the in-table loading placeholder instead of the empty state while loading', () => {
    render(<AuditPanel rows={[]} loading />)

    // Loading keeps the table mounted with a placeholder row rather than
    // swapping to the role="status" EmptyState.
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('Loading audit log…')).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('renders every column header and the row values for the supplied records', () => {
    const rows = [
      makeRow({
        id: 1,
        dlq_id: 501,
        actor: 'alice@ops',
        dst_topic: 'telemetry/a',
        error: 'boom',
        trace_id: 'trace-1',
        replayed_at: '2026-05-05T12:00:00Z',
      }),
      makeRow({
        id: 2,
        dlq_id: 502,
        actor: 'bob@ops',
        dst_topic: 'telemetry/b',
        error: 'nope',
        trace_id: 'trace-2',
        result: 'publish_failed',
      }),
    ]
    render(<AuditPanel rows={rows} loading={false} />)

    // All seven column headers.
    for (const header of [
      'Replayed at',
      'Actor',
      'DLQ ID',
      'Result',
      'Destination',
      'Error',
      'Trace ID',
    ]) {
      expect(screen.getByText(header)).toBeInTheDocument()
    }

    // Cell values from both rows.
    expect(screen.getByText('alice@ops')).toBeInTheDocument()
    expect(screen.getByText('bob@ops')).toBeInTheDocument()
    expect(screen.getByText('501')).toBeInTheDocument()
    expect(screen.getByText('502')).toBeInTheDocument()
    expect(screen.getByText('telemetry/a')).toBeInTheDocument()
    expect(screen.getByText('boom')).toBeInTheDocument()
    expect(screen.getByText('trace-2')).toBeInTheDocument()

    // The replayed_at cell wires the shared TimeStamp with absolute format.
    const stamps = screen.getAllByTestId('dlq-timestamp')
    expect(stamps).toHaveLength(2)
    expect(stamps[0]).toHaveAttribute('data-format', 'absolute')
    expect(stamps[0]).toHaveTextContent('2026-05-05T12:00:00Z')
  })

  it('maps each known result to its Badge variant colour', () => {
    const cases: Array<[DLQReplayResult, string]> = [
      ['ok', 'bg-green-100'],
      ['publish_failed', 'bg-red-100'],
      ['rate_limited', 'bg-yellow-100'],
      ['disabled', 'bg-yellow-100'],
      ['not_found', BADGE_VARIANTS.neutral],
      ['unparseable', 'bg-red-100'],
    ]

    for (const [result, expectedClass] of cases) {
      const { unmount } = render(
        <AuditPanel rows={[makeRow({ result })]} loading={false} />,
      )
      const badge = screen.getByText(result)
      expect(badge).toHaveClass(expectedClass)
      unmount()
    }
  })

  it('falls back to the neutral Badge variant for an unknown result value', () => {
    const rows = [makeRow({ result: 'throttled' as unknown as DLQReplayResult })]
    render(<AuditPanel rows={rows} loading={false} />)

    const badge = screen.getByText('throttled')
    // RESULT_VARIANT has no `throttled` key → `?? 'neutral'` catches it.
    expect(badge).toHaveClass(BADGE_VARIANTS.neutral)
  })

  it('renders the "—" placeholder for blank actor / destination / error / trace fields', () => {
    const rows = [
      makeRow({
        actor: '',
        dst_topic: '',
        error: '',
        trace_id: '',
        result: 'ok',
      }),
    ]
    render(<AuditPanel rows={rows} loading={false} />)

    // Four blank string columns each collapse to the shared em-dash.
    expect(screen.getAllByText('—')).toHaveLength(4)
    // The result Badge still renders its value, not a dash.
    expect(screen.getByText('ok')).toBeInTheDocument()
  })

  it('is null-safe: undefined or null rows render the empty state without crashing', () => {
    const { unmount } = render(<AuditPanel rows={undefined} loading={false} />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('No replay attempts yet')).toBeInTheDocument()
    unmount()

    render(<AuditPanel rows={null} loading={false} />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
