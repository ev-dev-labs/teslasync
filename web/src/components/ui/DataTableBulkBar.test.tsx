/**
 * `<DataTableBulkBar>` contract tests.
 *
 * The bulk-action toolbar rendered above a `<DataTable>` when at least one
 * row is selected. It owns three responsibilities that these tests pin:
 *
 *   - Visibility gating: shows only for a positive, finite, integer count.
 *     A bare `count <= 0` guard would leak `NaN` / `undefined` / `Infinity`
 *     and render a nonsensical "NaN selected" bar, so the source coerces to
 *     a safe non-negative integer first — we exercise every branch here.
 *   - Accessible structure: a labelled `region`, a polite live count, and an
 *     icon-only-safe "Clear selection" button whose accessible name comes
 *     from its `aria-label` (the `<X>` glyph is `aria-hidden`).
 *   - Composition: the consumer's bulk actions render into the `children`
 *     slot, and a caller `className` is merged onto the token base classes.
 *
 * `@testing-library/user-event` is not installed in this repo, so we drive
 * interactions with `fireEvent` — matching every other component test here
 * (FullscreenButton, PinButton, Lightbox, EditableText, ContextMenu).
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

// i18n stub — resolve `t(key, default, opts)` to the default string with
// `{{count}}` interpolation so the count copy is human-readable in
// assertions. Mirrors the FullscreenButton/PinButton convention.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      defaultOrOpts?: string | Record<string, unknown>,
      opts?: Record<string, unknown>,
    ) => {
      let template: string
      let interpolations: Record<string, unknown> | undefined
      if (typeof defaultOrOpts === 'string') {
        template = defaultOrOpts || key
        interpolations = opts
      } else {
        template = key
        interpolations = defaultOrOpts
      }
      if (!interpolations) return template
      return template.replace(/\{\{(\w+)\}\}/g, (_, name) =>
        String(interpolations?.[name] ?? `{{${name}}}`),
      )
    },
  }),
}))

import { DataTableBulkBar } from './DataTableBulkBar'

afterEach(() => cleanup())

function getRegion() {
  return screen.getByRole('region', { name: 'Bulk actions' })
}

describe('DataTableBulkBar — visibility gating', () => {
  it('renders nothing when count is 0', () => {
    const { container } = render(<DataTableBulkBar count={0} onClear={vi.fn()} />)
    expect(container.firstChild).toBeNull()
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('renders nothing for a negative count', () => {
    const { container } = render(<DataTableBulkBar count={-4} onClear={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing for a NaN count (guards against undefined length)', () => {
    const { container } = render(<DataTableBulkBar count={Number.NaN} onClear={vi.fn()} />)
    expect(container.firstChild).toBeNull()
    // The naive `count <= 0` guard would let NaN through and paint
    // "NaN selected" — assert that copy never appears.
    expect(screen.queryByText(/NaN/i)).toBeNull()
  })

  it('renders nothing for a non-finite (Infinity) count', () => {
    const { container } = render(
      <DataTableBulkBar count={Number.POSITIVE_INFINITY} onClear={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing for a fractional count below 1 (truncates to 0)', () => {
    const { container } = render(<DataTableBulkBar count={0.6} onClear={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('DataTableBulkBar — selected count copy', () => {
  it('renders a labelled region with the interpolated count for a single row', () => {
    render(<DataTableBulkBar count={1} onClear={vi.fn()} />)
    const region = getRegion()
    expect(region).toBeInTheDocument()
    expect(region).toHaveAccessibleName('Bulk actions')
    expect(within(region).getByText('1 selected')).toBeInTheDocument()
  })

  it('interpolates larger counts', () => {
    render(<DataTableBulkBar count={12} onClear={vi.fn()} />)
    expect(screen.getByText('12 selected')).toBeInTheDocument()
  })

  it('truncates a fractional count to an integer in the copy', () => {
    render(<DataTableBulkBar count={3.9} onClear={vi.fn()} />)
    expect(screen.getByText('3 selected')).toBeInTheDocument()
    expect(screen.queryByText('3.9 selected')).toBeNull()
  })

  it('marks the count as a polite live region so screen readers announce updates', () => {
    render(<DataTableBulkBar count={2} onClear={vi.fn()} />)
    const count = screen.getByText('2 selected')
    expect(count).toHaveAttribute('aria-live', 'polite')
  })

  it('updates the copy when the count prop changes', () => {
    const { rerender } = render(<DataTableBulkBar count={2} onClear={vi.fn()} />)
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    rerender(<DataTableBulkBar count={7} onClear={vi.fn()} />)
    expect(screen.getByText('7 selected')).toBeInTheDocument()
    expect(screen.queryByText('2 selected')).toBeNull()
  })
})

describe('DataTableBulkBar — clear button', () => {
  it('exposes an accessibly-named clear button', () => {
    render(<DataTableBulkBar count={3} onClear={vi.fn()} />)
    const btn = screen.getByRole('button', { name: 'Clear selection' })
    expect(btn).toHaveAttribute('type', 'button')
  })

  it('hides the decorative X glyph from the accessibility tree', () => {
    render(<DataTableBulkBar count={3} onClear={vi.fn()} />)
    const btn = screen.getByRole('button', { name: 'Clear selection' })
    const icon = btn.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it('does not invoke onClear on mount', () => {
    const onClear = vi.fn()
    render(<DataTableBulkBar count={3} onClear={onClear} />)
    expect(onClear).not.toHaveBeenCalled()
  })

  it('invokes onClear exactly once when the clear button is clicked', () => {
    const onClear = vi.fn()
    render(<DataTableBulkBar count={3} onClear={onClear} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(onClear).toHaveBeenCalledTimes(1)
    // The handler is wired straight to the button's onClick, so it receives
    // the click event.
    const [event] = onClear.mock.calls[0]
    expect(event).toMatchObject({ type: 'click' })
  })
})

describe('DataTableBulkBar — composition', () => {
  it('renders consumer bulk actions passed via children', () => {
    render(
      <DataTableBulkBar count={4} onClear={vi.fn()}>
        <button type="button">Export</button>
        <button type="button">Delete</button>
      </DataTableBulkBar>,
    )
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    // The clear affordance coexists with the consumer actions.
    expect(screen.getByRole('button', { name: 'Clear selection' })).toBeInTheDocument()
  })

  it('merges a caller className onto the token base classes', () => {
    render(<DataTableBulkBar count={1} onClear={vi.fn()} className="mt-4 custom-bar" />)
    const region = getRegion()
    expect(region.className).toContain('custom-bar')
    // Base token classes (from tableTokens.bulkBar) survive the merge.
    expect(region.className).toContain('rounded-lg')
  })
})
