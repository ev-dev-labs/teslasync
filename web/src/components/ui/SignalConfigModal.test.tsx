/**
 * `<SignalConfigModal>` — Fleet Telemetry signal picker coverage.
 *
 * The modal is the single control surface the DevTools "Configure Signals"
 * button opens: it flattens the per-category field catalogue into a selectable
 * list, lets the operator pick a sampling interval per-signal / per-category /
 * globally, applies named presets, and finally emits `{ name, interval }[]` to
 * `onSubmit`. These tests pin every branch a caller relies on:
 *
 *   1. Open/closed rendering + the shared <Modal> labelling.
 *   2. The live "selected / total" summary + footer accounting.
 *   3. Per-signal, per-category and master selection toggles (aria-pressed).
 *   4. Per-signal, per-category and master interval changes.
 *   5. Search filtering + the "no matches" / "no signals" empty states.
 *   6. Named preset application (selection AND interval side-effects).
 *   7. Category expand/collapse (aria-expanded) hiding its rows.
 *   8. Submit payload shape + Cancel, and the disabled-when-empty guard.
 *   9. Regression: reopening re-seeds from the latest props and clears search.
 *  10. Null-safety: undefined `categories`/`initialSelected` never throw.
 *
 * react-i18next is stubbed to echo each English fallback (with `{{var}}`
 * interpolation) so assertions read against stable copy without a provider.
 * `@testing-library/user-event` is not installed in this repo, so interactions
 * are driven with `fireEvent` — matching every other component test here.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, defOrOpts?: unknown, maybeOpts?: unknown) => {
        let fallback: string | undefined
        let opts: Record<string, unknown> | undefined
        if (typeof defOrOpts === 'string') {
          fallback = defOrOpts
          opts = maybeOpts as Record<string, unknown> | undefined
        } else {
          opts = defOrOpts as Record<string, unknown> | undefined
        }
        let out = fallback ?? key
        if (opts) {
          out = out.replace(/\{\{(\w+)\}\}/g, (_, name) => (opts?.[name] != null ? String(opts[name]) : ''))
        }
        return out
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

import SignalConfigModal from './SignalConfigModal'

afterEach(() => cleanup())

const CATEGORIES = [
  { category: 'Driving', fields: ['VehicleSpeed', 'Gear'] },
  { category: 'Charging', fields: ['ChargeState'] },
]

type Props = React.ComponentProps<typeof SignalConfigModal>

function renderModal(overrides: Partial<Props> = {}) {
  const onSubmit = vi.fn()
  const onClose = vi.fn()
  const props: Props = {
    open: true,
    onClose,
    categories: CATEGORIES,
    initialSelected: [],
    initialInterval: 10,
    onSubmit,
    ...overrides,
  }
  const result = render(<SignalConfigModal {...props} />)
  return { ...result, onSubmit, onClose, props }
}

/** The per-signal interval <select> exposed via its aria-label. */
function intervalSelect(signal: string): HTMLSelectElement {
  return screen.getByRole('combobox', { name: `Sampling interval for ${signal}` }) as HTMLSelectElement
}

describe('<SignalConfigModal>', () => {
  it('renders nothing while closed', () => {
    renderModal({ open: false, initialSelected: ['VehicleSpeed'] })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('VehicleSpeed')).not.toBeInTheDocument()
    expect(screen.queryByText(/signals selected/)).not.toBeInTheDocument()
  })

  it('renders a labelled modal with the summary and every category + signal', () => {
    renderModal({ initialSelected: ['VehicleSpeed'] })

    const dialog = screen.getByRole('dialog', { name: 'Fleet Telemetry Signal Configuration' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')

    // "selected / total" summary — 1 of the 3 catalogue fields is pre-selected.
    expect(screen.getByText('1 / 3 signals selected')).toBeInTheDocument()

    // Every field renders (categories are expanded by default).
    expect(screen.getByText('VehicleSpeed')).toBeInTheDocument()
    expect(screen.getByText('Gear')).toBeInTheDocument()
    expect(screen.getByText('ChargeState')).toBeInTheDocument()

    // Both category headers are keyboard-operable disclosure buttons.
    expect(screen.getByRole('button', { name: /^Driving/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /^Charging/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('toggles an individual signal via its accessible checkbox and updates the summary', () => {
    renderModal({ initialSelected: [] })
    expect(screen.getByText('0 / 3 signals selected')).toBeInTheDocument()

    const select = screen.getByRole('button', { name: 'Select VehicleSpeed' })
    expect(select).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(select)

    const deselect = screen.getByRole('button', { name: 'Deselect VehicleSpeed' })
    expect(deselect).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('1 / 3 signals selected')).toBeInTheDocument()
  })

  it('selects and deselects everything with the master toggle', () => {
    renderModal({ initialSelected: [] })

    const selectAll = screen.getByRole('button', { name: 'Select All' })
    expect(selectAll).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(selectAll)
    expect(screen.getByText('3 / 3 signals selected')).toBeInTheDocument()

    const deselectAll = screen.getByRole('button', { name: 'Deselect All' })
    expect(deselectAll).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(deselectAll)
    expect(screen.getByText('0 / 3 signals selected')).toBeInTheDocument()
  })

  it('applies the master interval to every signal', () => {
    renderModal({ initialSelected: [], initialInterval: 10 })
    expect(intervalSelect('VehicleSpeed')).toHaveValue('10')
    expect(intervalSelect('ChargeState')).toHaveValue('10')

    fireEvent.change(
      screen.getByRole('combobox', { name: 'Master sampling interval for all signals' }),
      { target: { value: '1' } },
    )

    expect(intervalSelect('VehicleSpeed')).toHaveValue('1')
    expect(intervalSelect('Gear')).toHaveValue('1')
    expect(intervalSelect('ChargeState')).toHaveValue('1')
  })

  it('toggles a whole category with the category checkbox', () => {
    renderModal({ initialSelected: [] })

    const catToggle = screen.getByRole('button', { name: 'Select all Driving signals' })
    expect(catToggle).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(catToggle)

    // Driving's two fields flip on; Charging's ChargeState stays off → 2 / 3.
    expect(screen.getByText('2 / 3 signals selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deselect all Driving signals' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Select ChargeState' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('applies a per-category interval only to that category', () => {
    renderModal({ initialSelected: [], initialInterval: 10 })

    fireEvent.change(
      screen.getByRole('combobox', { name: 'Set interval for all Driving signals' }),
      { target: { value: '5' } },
    )

    expect(intervalSelect('VehicleSpeed')).toHaveValue('5')
    expect(intervalSelect('Gear')).toHaveValue('5')
    // Charging is untouched.
    expect(intervalSelect('ChargeState')).toHaveValue('10')
  })

  it('changes a single signal interval without affecting its siblings', () => {
    renderModal({ initialSelected: [], initialInterval: 10 })

    fireEvent.change(intervalSelect('Gear'), { target: { value: '30' } })

    expect(intervalSelect('Gear')).toHaveValue('30')
    expect(intervalSelect('VehicleSpeed')).toHaveValue('10')
  })

  it('filters by search and shows a contextual empty state when nothing matches', () => {
    renderModal({ initialSelected: [] })
    const search = screen.getByRole('textbox', { name: 'Search signals' })

    fireEvent.change(search, { target: { value: 'Charge' } })
    expect(screen.getByText('ChargeState')).toBeInTheDocument()
    expect(screen.queryByText('VehicleSpeed')).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'zzz' } })
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText(/No signals match/)).toHaveTextContent('zzz')
    expect(screen.queryByText('ChargeState')).not.toBeInTheDocument()
  })

  it('shows an empty state when there are no signals to configure', () => {
    renderModal({ categories: [] })
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText(/No telemetry signals are available/)).toBeInTheDocument()
    expect(screen.getByText('0 / 0 signals selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Subscribe/ })).toBeDisabled()
  })

  it('applies a named preset — selecting all signals and rewriting intervals', () => {
    renderModal({ initialSelected: [] })
    expect(screen.getByText('0 / 3 signals selected')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Low Power/ }))

    // "Low Power" selects everything at 60s.
    expect(screen.getByText('3 / 3 signals selected')).toBeInTheDocument()
    expect(intervalSelect('VehicleSpeed')).toHaveValue('60')
    expect(intervalSelect('ChargeState')).toHaveValue('60')
  })

  it('collapses a category to hide its signal rows', () => {
    renderModal({ initialSelected: ['VehicleSpeed'] })
    expect(screen.getByText('VehicleSpeed')).toBeInTheDocument()

    const header = screen.getByRole('button', { name: /^Driving/ })
    expect(header).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(header)

    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('VehicleSpeed')).not.toBeInTheDocument()
    // A sibling category is unaffected.
    expect(screen.getByText('ChargeState')).toBeInTheDocument()
  })

  it('submits the selected signals with their intervals and then closes', () => {
    const { onSubmit, onClose } = renderModal({ initialSelected: ['VehicleSpeed'], initialInterval: 10 })

    fireEvent.click(screen.getByRole('button', { name: 'Subscribe 1 Signals' }))

    expect(onSubmit).toHaveBeenCalledWith([{ name: 'VehicleSpeed', interval: 10 }])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('disables submit when nothing is selected and Cancel just closes', () => {
    const { onSubmit, onClose } = renderModal({ initialSelected: [] })

    expect(screen.getByRole('button', { name: /Subscribe/ })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('re-seeds from the latest props and clears the search when reopened', () => {
    const { rerender, props } = renderModal({ open: false, initialSelected: ['VehicleSpeed'] })

    // Open the first time: reflects VehicleSpeed selection.
    rerender(<SignalConfigModal {...props} open initialSelected={['VehicleSpeed']} />)
    expect(screen.getByRole('button', { name: 'Deselect VehicleSpeed' })).toBeInTheDocument()

    // Type a query that hides everything, then close.
    fireEvent.change(screen.getByRole('textbox', { name: 'Search signals' }), { target: { value: 'zzz' } })
    expect(screen.getByRole('status')).toBeInTheDocument()
    rerender(<SignalConfigModal {...props} open={false} initialSelected={['VehicleSpeed']} />)

    // Reopen with a DIFFERENT selection: search is cleared and Gear (not
    // VehicleSpeed) is now the selected field.
    rerender(<SignalConfigModal {...props} open initialSelected={['Gear']} />)
    expect(screen.getByRole('textbox', { name: 'Search signals' })).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Deselect Gear' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Select VehicleSpeed' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('is null-safe when categories/initialSelected are undefined', () => {
    expect(() =>
      render(
        <SignalConfigModal
          open
          onClose={vi.fn()}
          categories={undefined as unknown as Props['categories']}
          initialSelected={undefined as unknown as Props['initialSelected']}
          initialInterval={undefined as unknown as number}
          onSubmit={vi.fn()}
        />,
      ),
    ).not.toThrow()

    expect(screen.getByText(/No telemetry signals are available/)).toBeInTheDocument()
    expect(screen.getByText('0 / 0 signals selected')).toBeInTheDocument()
  })
})
