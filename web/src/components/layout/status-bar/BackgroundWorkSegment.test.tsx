/**
 * BackgroundWorkSegment behaviour tests.
 *
 * Exercises the footer status-bar segment that surfaces in-flight background
 * work (exports, mutations, ad-hoc jobs). Covers:
 *   - hidden entirely when nothing is running (returns null)
 *   - trigger summary: the single job label vs pluralised "{{count}} tasks"
 *   - iconOnly mode drops the visible label but keeps the a11y name + spinner
 *   - the tooltip content contract
 *   - opening the popover: role="dialog", aria-expanded flip, heading + rows
 *   - per-kind icon mapping (export→FileDown, mutation→Save, custom→Sparkles)
 *   - the defensive fallback icon for an unknown job kind (no crash)
 *   - optional per-job description line
 *   - Escape / outside-mousedown dismissal (and inside-click keeping it open)
 *   - re-toggle closing, and full unmount when the last job drains away
 *
 * The single dependency, useBackgroundJobs, is mocked so the component can be
 * driven through every branch without a QueryClient or real network. This
 * mirrors the mock-the-hook convention used by NotificationBellPopover.test.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import '../../../i18n'
import type {
  BackgroundJob,
  UseBackgroundJobsResult,
} from '@/hooks/useBackgroundJobs'

// Mutable fixture the mocked hook reads fresh on every render. `mock`-prefixed
// so vitest's factory-hoist analysis permits the reference.
let mockJobs: BackgroundJob[] = []

import { BackgroundWorkSegment } from './BackgroundWorkSegment'

function TestSegment({
  iconOnly,
  embedded,
}: {
  iconOnly?: boolean
  embedded?: boolean
}) {
  const backgroundJobs: UseBackgroundJobsResult = {
    jobs: mockJobs,
    hasJobs: mockJobs.length > 0,
    count: mockJobs.length,
  }
  return (
    <BackgroundWorkSegment
      backgroundJobs={backgroundJobs}
      iconOnly={iconOnly}
      embedded={embedded}
    />
  )
}

function makeJob(over: Partial<BackgroundJob> = {}): BackgroundJob {
  return {
    id: 'job-1',
    label: 'CSV export',
    kind: 'export',
    status: 'running',
    description: 'Processing',
    startedAt: '2024-01-01T00:00:00.000Z',
    ...over,
  }
}

function openPopover() {
  fireEvent.click(screen.getByRole('button', { name: /background tasks/i }))
}

beforeEach(() => {
  mockJobs = []
})

afterEach(() => {
  cleanup()
  mockJobs = []
})

describe('BackgroundWorkSegment', () => {
  it('renders nothing when there is no background work', () => {
    mockJobs = []
    const { container } = render(<TestSegment />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('renders a single job label directly in the status bar', () => {
    mockJobs = [makeJob()]
    render(<TestSegment />)
    const trigger = screen.getByRole('button', { name: /background tasks/i })
    expect(trigger).toHaveAttribute('aria-label', 'Background tasks: CSV export')
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveTextContent('CSV export')
  })

  it('exposes the "work in progress" tooltip with the current summary', () => {
    mockJobs = [makeJob({ id: 'a' }), makeJob({ id: 'b' })]
    render(<TestSegment />)
    const tip = screen.getByRole('tooltip')
    expect(tip).toHaveTextContent(/background work in progress/i)
    expect(tip).toHaveTextContent('2 tasks')
  })

  it('pluralises the summary as "{{count}} tasks" for multiple jobs', () => {
    mockJobs = [makeJob({ id: 'a' }), makeJob({ id: 'b' }), makeJob({ id: 'c' })]
    render(<TestSegment />)
    const trigger = screen.getByRole('button', { name: /background tasks/i })
    expect(trigger).toHaveTextContent('3 tasks')
    expect(trigger).toHaveAttribute('aria-label', 'Background tasks: 3 tasks')
  })

  it('surfaces transient success and failure outcomes directly in the trigger', () => {
    mockJobs = [makeJob({ label: 'Changes saved', status: 'success' })]
    const { rerender } = render(<TestSegment />)

    let trigger = screen.getByRole('button', { name: /changes saved/i })
    expect(trigger).toHaveTextContent('Changes saved')
    expect(trigger.className).toContain('text-emerald-300')
    expect(trigger.querySelector('.animate-spin')).toBeNull()

    mockJobs = [makeJob({ label: 'Sync failed', status: 'error' })]
    rerender(<TestSegment />)
    trigger = screen.getByRole('button', { name: /sync failed/i })
    expect(trigger).toHaveTextContent('Sync failed')
    expect(trigger.className).toContain('text-rose-300')
  })

  it('hides the visible label but keeps the spinner and aria-label in iconOnly mode', () => {
    mockJobs = [makeJob()]
    render(<TestSegment iconOnly />)
    const trigger = screen.getByRole('button', { name: /background tasks/i })
    // Label text suppressed…
    expect(trigger).not.toHaveTextContent(/task/i)
    // …but the accessible name and the (decorative, hidden) spinner remain.
    expect(trigger).toHaveAttribute('aria-label', 'Background tasks: CSV export')
    const spinner = trigger.querySelector('svg')
    expect(spinner).toBeTruthy()
    expect(spinner).toHaveAttribute('aria-hidden')
  })

  it('opens the job popover on click, flips aria-expanded, and shows the heading + rows', () => {
    mockJobs = [makeJob({ id: 'a', label: 'Drives CSV', description: 'Queued' })]
    render(<TestSegment />)
    const trigger = screen.getByRole('button', { name: /background tasks/i })

    openPopover()

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAccessibleName('Background tasks')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(within(dialog).getByText('Drives CSV')).toBeInTheDocument()
    expect(within(dialog).getByText('Queued')).toBeInTheDocument()
  })

  it('renders the correct icon for each job kind', () => {
    mockJobs = [
      makeJob({ id: 'e', label: 'Export bundle', kind: 'export' }),
      makeJob({ id: 'm', label: 'Save settings', kind: 'mutation' }),
      makeJob({ id: 'c', label: 'Custom backup', kind: 'custom' }),
    ]
    render(<TestSegment />)
    openPopover()

    const exportRow = screen.getByText('Export bundle').closest('div')!
    const mutationRow = screen.getByText('Save settings').closest('div')!
    const customRow = screen.getByText('Custom backup').closest('div')!

    expect(exportRow.querySelector('.lucide-file-down')).toBeTruthy()
    expect(mutationRow.querySelector('.lucide-save')).toBeTruthy()
    expect(customRow.querySelector('.lucide-sparkles')).toBeTruthy()
  })

  it('falls back to a default icon for an unknown job kind instead of crashing', () => {
    // Force a value outside the BackgroundJobKind union to hit the defensive
    // `?? Sparkles` branch — this must render, not throw "Element type is invalid".
    mockJobs = [
      {
        id: 'legacy',
        label: 'Legacy job',
        kind: 'legacy',
        startedAt: '2024-01-01T00:00:00.000Z',
      } as unknown as BackgroundJob,
    ]
    render(<TestSegment />)
    openPopover()

    const dialog = screen.getByRole('dialog')
    const row = within(dialog).getByText('Legacy job').closest('div')!
    expect(dialog).toBeInTheDocument()
    expect(row.querySelector('.lucide-sparkles')).toBeTruthy()
  })

  it('only renders the description line for jobs that have one', () => {
    mockJobs = [
      makeJob({ id: 'a', label: 'With desc', description: 'Queued' }),
      makeJob({ id: 'b', label: 'No desc', description: undefined }),
    ]
    render(<TestSegment />)
    openPopover()

    expect(screen.getByText('Queued')).toBeInTheDocument()
    // The secondary line is the only `text-2xs` element inside a row.
    const withDescRow = screen.getByText('With desc').closest('div')!
    const noDescRow = screen.getByText('No desc').closest('div')!
    expect(withDescRow.querySelector('.text-2xs')).toBeTruthy()
    expect(noDescRow.querySelector('.text-2xs')).toBeNull()
  })

  it('closes the popover when Escape is pressed', () => {
    mockJobs = [makeJob()]
    render(<TestSegment />)
    openPopover()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(
      screen.getByRole('button', { name: /background tasks/i }),
    ).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes on an outside mousedown but stays open when clicking inside', () => {
    mockJobs = [makeJob()]
    render(<TestSegment />)
    openPopover()

    // Click inside the dialog → stays open.
    const dialog = screen.getByRole('dialog')
    act(() => {
      fireEvent.pointerDown(dialog)
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // Click outside (on the document body) → closes.
    act(() => {
      fireEvent.pointerDown(document.body)
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('toggles the popover closed when the trigger is clicked a second time', () => {
    mockJobs = [makeJob()]
    render(<TestSegment />)
    openPopover()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    openPopover()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('unmounts the whole segment once the last job drains away', () => {
    mockJobs = [makeJob()]
    const { rerender } = render(<TestSegment />)
    openPopover()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // Simulate the hook reporting no more work on the next render.
    mockJobs = []
    rerender(<TestSegment />)

    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
