import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@/i18n'
import ReleaseNotes from './ReleaseNotes'

/**
 * ReleaseNotes accordion contract.
 *
 * ReleaseNotes renders a compact, single-open accordion over the newest
 * `limit` entries of the generated changelog. We replace `@/generated/changelog`
 * with a deterministic fixture that exercises every badge variant
 * (latest / stable / beta) and every change type (added / changed / fixed /
 * removed / deprecated / security) so the colour + i18n lookup tables are fully
 * covered. The real i18n bundle is loaded (mirrors ErrorDisplay.test) so we
 * assert on the actual English copy for badges + change-type labels.
 *
 * The `limit`-clamp cases are regression guards for the hardening: a raw
 * `Array.slice(0, limit)` mishandled `limit <= 0` (0 → blank panel, negative →
 * "everything but the last N"). The component now floors + clamps to 0 and
 * falls through to an empty state.
 */

const fixture = vi.hoisted(() => {
  const CHANGELOG = [
    {
      version: '2.0.0',
      date: '2026-06-01',
      badge: 'latest',
      changes: [
        { type: 'added', text: 'Fleet heatmap overlay' },
        { type: 'security', text: 'Rotated signing keys' },
      ],
    },
    {
      version: '1.5.0',
      date: '2026-05-01',
      badge: 'beta',
      changes: [
        { type: 'changed', text: 'Reworked charging curve' },
        { type: 'deprecated', text: 'Legacy CSV export path' },
      ],
    },
    {
      version: '1.0.0',
      date: '2026-04-01',
      badge: 'stable',
      changes: [
        { type: 'fixed', text: 'Null pointer on drive detail' },
        { type: 'removed', text: 'Unused sentry toggle' },
      ],
    },
    {
      version: '0.9.0',
      date: '2026-03-01',
      badge: 'stable',
      changes: [{ type: 'added', text: 'Initial preview build' }],
    },
  ]
  return { CHANGELOG }
})

vi.mock('@/generated/changelog', () => ({
  CHANGELOG: fixture.CHANGELOG,
  // Not consumed by ReleaseNotes, but sibling modules read it — provide it so
  // the mocked module stays shape-compatible.
  LATEST_VERSION: fixture.CHANGELOG[0].version,
}))

const trigger = (version: string) =>
  screen.getByRole('button', { name: new RegExp(`v${version.replace(/\./g, '\\.')}`, 'i') })

const queryTrigger = (version: string) =>
  screen.queryByRole('button', { name: new RegExp(`v${version.replace(/\./g, '\\.')}`, 'i') })

describe('ReleaseNotes', () => {
  it('renders the newest `limit` releases (default 3) and omits the rest', () => {
    render(<ReleaseNotes />)

    expect(trigger('2.0.0')).toBeInTheDocument()
    expect(trigger('1.5.0')).toBeInTheDocument()
    expect(trigger('1.0.0')).toBeInTheDocument()
    // The 4th, oldest entry is beyond the default cap of 3.
    expect(queryTrigger('0.9.0')).not.toBeInTheDocument()
    // Exactly one disclosure trigger per rendered release.
    expect(screen.getAllByRole('button')).toHaveLength(3)
  })

  it('respects a custom `limit`', () => {
    render(<ReleaseNotes limit={1} />)

    expect(trigger('2.0.0')).toBeInTheDocument()
    expect(queryTrigger('1.5.0')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('expands the newest release by default and collapses the others', () => {
    render(<ReleaseNotes />)

    const first = trigger('2.0.0')
    expect(first).toHaveAttribute('aria-expanded', 'true')
    // The open panel's change list is visible.
    expect(screen.getByText('Fleet heatmap overlay')).toBeInTheDocument()
    expect(screen.getByText('Rotated signing keys')).toBeInTheDocument()

    const second = trigger('1.5.0')
    expect(second).toHaveAttribute('aria-expanded', 'false')
    // A collapsed release's body is not mounted.
    expect(screen.queryByText('Reworked charging curve')).not.toBeInTheDocument()
  })

  it('renders the localized badge label for each badge variant', () => {
    render(<ReleaseNotes />)

    // latest → success/"Latest", beta → warning/"Beta", stable → info/"Stable".
    expect(screen.getByText('Latest')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.getByText('Stable')).toBeInTheDocument()
    // The section heading uses the shared changelog copy.
    expect(screen.getByText("What's New")).toBeInTheDocument()
  })

  it('behaves as a single-open accordion on toggle', () => {
    render(<ReleaseNotes />)

    const first = trigger('2.0.0')
    const second = trigger('1.5.0')

    // Collapse the default-open panel.
    fireEvent.click(first)
    expect(first).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Fleet heatmap overlay')).not.toBeInTheDocument()

    // Open the second — the first stays closed.
    fireEvent.click(second)
    expect(second).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Reworked charging curve')).toBeInTheDocument()
    expect(first).toHaveAttribute('aria-expanded', 'false')

    // Re-open the first — the second closes (only one panel open at a time).
    fireEvent.click(first)
    expect(first).toHaveAttribute('aria-expanded', 'true')
    expect(second).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Reworked charging curve')).not.toBeInTheDocument()
  })

  it('labels each change-type dot for assistive tech and tints it by type', () => {
    render(<ReleaseNotes />)

    // The default-open latest release has one "added" and one "security" change.
    const added = screen.getByLabelText('Added')
    expect(added).toHaveAttribute('role', 'img')
    expect(added).toHaveClass('bg-emerald-400/60')

    const security = screen.getByLabelText('Security')
    expect(security).toHaveAttribute('role', 'img')
    expect(security).toHaveClass('bg-rose-400/60')
  })

  it('wires the disclosure for assistive tech (aria-controls ⇄ region/labelledby)', () => {
    render(<ReleaseNotes />)

    const first = trigger('2.0.0')
    const region = screen.getByRole('region')

    const controls = first.getAttribute('aria-controls')
    expect(controls).toBeTruthy()
    // The trigger points at the region, and the region is labelled by its trigger.
    expect(region).toHaveAttribute('id', controls as string)
    expect(region).toHaveAttribute('aria-labelledby', first.id)
    // Triggers are explicit buttons, never an implicit form-submit.
    expect(first).toHaveAttribute('type', 'button')
  })

  it('renders an empty state (not a blank panel) when `limit` is 0', () => {
    render(<ReleaseNotes limit={0} />)

    expect(queryTrigger('2.0.0')).not.toBeInTheDocument()
    // EmptyState surfaces as a polite status region with the localized message.
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText(/no release notes/i)).toBeInTheDocument()
  })

  it('clamps a negative `limit` to empty instead of slice "all but last"', () => {
    render(<ReleaseNotes limit={-2} />)

    // The pre-hardening bug: slice(0, -2) would have rendered v2.0.0 and v1.5.0.
    expect(queryTrigger('2.0.0')).not.toBeInTheDocument()
    expect(queryTrigger('1.5.0')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('floors a fractional `limit`', () => {
    render(<ReleaseNotes limit={2.9} />)

    expect(trigger('2.0.0')).toBeInTheDocument()
    expect(trigger('1.5.0')).toBeInTheDocument()
    // 2.9 floors to 2 → the third release is excluded.
    expect(queryTrigger('1.0.0')).not.toBeInTheDocument()
  })
})
