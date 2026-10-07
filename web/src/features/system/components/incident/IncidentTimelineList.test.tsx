import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

import { IncidentTimelineList } from './IncidentTimelineList'
import { type IncidentUpdateEntry } from '@/api/hooks/useIncidents'

// Deterministic i18n: return the inline fallback (2nd arg) so assertions read
// against the English defaults regardless of whether a global i18n instance is
// initialised. This mock also covers `useIncidentStatusLabel`, which resolves
// status → label through the same `react-i18next` module.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

// `useDateFormat` runs for real here — its `useSettings` (locale en-US) and
// `useTimezone` (UTC) dependencies are stubbed globally in src/test-setup.ts,
// so `formatDateTime` produces a stable en-US/UTC string and returns the "—"
// placeholder for empty/invalid input.

function makeUpdate(overrides: Partial<IncidentUpdateEntry> = {}): IncidentUpdateEntry {
  return {
    at: '2026-04-04T02:30:00Z',
    status: 'investigating',
    message: 'Investigation started.',
    ...overrides,
  }
}

describe('IncidentTimelineList', () => {
  it('renders the empty state (and no list) when there are no updates', () => {
    render(<IncidentTimelineList updates={[]} />)

    expect(screen.getByText('No updates recorded yet.')).toBeInTheDocument()
    // EmptyState renders role="status".
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('list')).toBeNull()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('renders one labelled list item per update with message, status label and formatted date', () => {
    const updates = [
      makeUpdate({ status: 'investigating', message: 'We are investigating.', at: '2026-04-04T02:30:00Z' }),
      makeUpdate({ status: 'monitoring', message: 'Mitigation applied.', at: '2026-04-03T10:15:00Z' }),
      makeUpdate({ status: 'resolved', message: 'All systems nominal.', at: '2026-04-02T18:45:00Z' }),
    ]

    render(<IncidentTimelineList updates={updates} />)

    // Accessible list name comes from the aria-label we added.
    const list = screen.getByRole('list', { name: 'Incident updates' })
    expect(list).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)

    expect(screen.getByText('We are investigating.')).toBeInTheDocument()
    expect(screen.getByText('Mitigation applied.')).toBeInTheDocument()
    expect(screen.getByText('All systems nominal.')).toBeInTheDocument()

    expect(screen.getByText('Investigating')).toBeInTheDocument()
    expect(screen.getByText('Monitoring')).toBeInTheDocument()
    expect(screen.getByText('Resolved')).toBeInTheDocument()

    // Each timestamp is formatted per-entry, en-US in UTC → "Apr 4, 2026, …".
    expect(screen.getByText(/Apr 4, 2026/)).toBeInTheDocument()
    expect(screen.getByText(/Apr 3, 2026/)).toBeInTheDocument()
    expect(screen.getByText(/Apr 2, 2026/)).toBeInTheDocument()
  })

  it('shows the author caption only for updates that carry an author', () => {
    const updates = [
      makeUpdate({ message: 'With author', author: 'alice' }),
      makeUpdate({ message: 'No author', author: undefined }),
    ]

    render(<IncidentTimelineList updates={updates} />)

    expect(screen.getByText(/·\s*alice/)).toBeInTheDocument()
    // The middot separator only appears in an author caption — exactly one here.
    expect(screen.getAllByText(/·/)).toHaveLength(1)
    expect(screen.getByText('No author')).toBeInTheDocument()
  })

  it('falls back gracefully for an unknown status (raw label, no crash)', () => {
    const updates = [
      makeUpdate({
        status: 'archived' as unknown as IncidentUpdateEntry['status'],
        message: 'Legacy status entry.',
      }),
    ]

    render(<IncidentTimelineList updates={updates} />)

    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    // statusLabel() returns the raw status when it is not a known member.
    expect(screen.getByText('archived')).toBeInTheDocument()
    expect(screen.getByText('Legacy status entry.')).toBeInTheDocument()
  })

  it('degrades to the empty state when the updates prop is nullish (null-safety)', () => {
    render(<IncidentTimelineList updates={undefined as unknown as IncidentUpdateEntry[]} />)

    expect(screen.getByText('No updates recorded yet.')).toBeInTheDocument()
    expect(screen.queryByRole('list')).toBeNull()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('renders a malformed entry (missing message and date) without throwing', () => {
    const updates = [
      makeUpdate({ at: '', status: 'identified', message: undefined as unknown as string }),
    ]

    render(<IncidentTimelineList updates={updates} />)

    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('Identified')).toBeInTheDocument()
    // Empty timestamp → formatter placeholder rather than "Invalid Date".
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('preserves multi-line message content and marks it whitespace-pre-wrap', () => {
    const multiline = 'Root cause found.\nRolling back deploy.'
    render(<IncidentTimelineList updates={[makeUpdate({ message: multiline })]} />)

    const paragraph = screen.getByText(
      (_content, el) => el?.tagName === 'P' && el.textContent === multiline,
    )
    expect(paragraph).toBeInTheDocument()
    expect(paragraph).toHaveClass('whitespace-pre-wrap')
    expect(paragraph.textContent).toContain('\n')
  })
})
