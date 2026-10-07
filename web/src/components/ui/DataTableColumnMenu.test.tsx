/**
 * `<DataTableColumnMenu>` contract tests.
 *
 * The menu is the combined column visibility + reorder popover DataTable
 * surfaces when a table opts into `columnVisibility` and/or `columnReorder`.
 * These tests lock in the user-facing behaviour so feature tables can rely on:
 *   - trigger open/close (default button + custom render-prop),
 *   - one row per column rendered in the effective layout order,
 *   - checkbox visibility state, `defaultVisible:false`, and the
 *     "keep at least one column visible" guardrail,
 *   - required columns cannot be toggled,
 *   - ↑/↓ reorder emits a fresh {order, hidden} layout, with the ends disabled,
 *   - `reorderable` / `toggleable` gating of the two control groups,
 *   - reset, Escape-close, outside-click-close, inside-click keeps open,
 *   - empty-columns hardening (an empty-state row, never a blank/crashing panel),
 *   - accessible labelling on the icon-only reorder controls.
 *
 * `react-i18next` is stubbed so aria-labels/copy assert as their
 * human-readable default strings, with `{{col}}` interpolation applied.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, def?: string, opts?: Record<string, unknown>) => {
      let s = def ?? key
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          s = s.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v))
        }
      }
      return s
    },
  }),
}))

import { DataTableColumnMenu } from './DataTableColumnMenu'
import type { ColumnLayout } from '@/lib/columnOrderStore'

type MenuProps = Parameters<typeof DataTableColumnMenu>[0]

const COLUMNS: MenuProps['columns'] = [
  { key: 'name', header: 'Name' },
  { key: 'status', header: 'Status' },
  { key: 'detail', header: 'Detail' },
]

function setup(props: Partial<MenuProps> = {}) {
  const onChange = vi.fn()
  const onReset = vi.fn()
  const utils = render(
    <DataTableColumnMenu
      columns={COLUMNS}
      layout={null}
      onChange={onChange}
      onReset={onReset}
      {...props}
    />,
  )
  return { onChange, onReset, ...utils }
}

/** Open via the default trigger (its accessible name always contains "columns"). */
function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: /columns/i }))
  return screen.getByTestId('datatable-column-menu')
}

afterEach(() => cleanup())

describe('DataTableColumnMenu — trigger + popover lifecycle', () => {
  it('renders a labelled trigger and keeps the popover closed until clicked', () => {
    setup()
    const trigger = screen.getByRole('button', { name: 'Reorder or hide columns' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('datatable-column-menu')).toBeNull()
  })

  it('toggles the popover open and closed from the trigger', () => {
    setup()
    const trigger = screen.getByRole('button', { name: 'Reorder or hide columns' })
    fireEvent.click(trigger)
    expect(screen.getByTestId('datatable-column-menu')).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(trigger)
    expect(screen.queryByTestId('datatable-column-menu')).toBeNull()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('uses the visibility-only trigger label when reorder is disabled', () => {
    setup({ reorderable: false })
    expect(
      screen.getByRole('button', { name: 'Show or hide columns' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Reorder or hide columns' }),
    ).toBeNull()
  })

  it('closes the popover on Escape', () => {
    setup()
    openMenu()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('datatable-column-menu')).toBeNull()
  })

  it('closes the popover on an outside pointer press', () => {
    setup()
    openMenu()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByTestId('datatable-column-menu')).toBeNull()
  })

  it('keeps the popover open when the press lands inside it', () => {
    setup()
    const menu = openMenu()
    fireEvent.mouseDown(menu)
    expect(screen.getByTestId('datatable-column-menu')).toBeInTheDocument()
  })

  it('supports a custom trigger render-prop that controls the menu', () => {
    const trigger = (open: () => void): ReactNode => (
      <button type="button" data-testid="custom-trigger" onClick={open}>
        Configure
      </button>
    )
    setup({ trigger })
    // Default trigger is replaced by the custom one.
    expect(
      screen.queryByRole('button', { name: 'Reorder or hide columns' }),
    ).toBeNull()
    expect(screen.queryByTestId('datatable-column-menu')).toBeNull()
    fireEvent.click(screen.getByTestId('custom-trigger'))
    expect(screen.getByTestId('datatable-column-menu')).toBeInTheDocument()
  })
})

describe('DataTableColumnMenu — visibility toggling', () => {
  it('renders one checkbox per column, all visible by default', () => {
    setup()
    openMenu()
    const checks = screen.getAllByRole('checkbox')
    expect(checks).toHaveLength(3)
    checks.forEach((c) => expect(c).toBeChecked())
    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('Detail')).toBeInTheDocument()
  })

  it('honours defaultVisible:false as an initially-unchecked column', () => {
    setup({
      columns: [
        { key: 'name', header: 'Name' },
        { key: 'detail', header: 'Detail', defaultVisible: false },
      ],
    })
    openMenu()
    expect(screen.getByRole('checkbox', { name: 'Show or hide Name' })).toBeChecked()
    expect(
      screen.getByRole('checkbox', { name: 'Show or hide Detail' }),
    ).not.toBeChecked()
  })

  it('emits a layout that hides a column when its checkbox is unchecked', () => {
    const { onChange } = setup()
    openMenu()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show or hide Status' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({
      order: ['name', 'status', 'detail'],
      hidden: ['status'],
    })
  })

  it('emits a layout that re-shows a previously-hidden column', () => {
    const layout: ColumnLayout = {
      order: ['name', 'status', 'detail'],
      hidden: ['status'],
    }
    const { onChange } = setup({ layout })
    openMenu()
    const statusBox = screen.getByRole('checkbox', { name: 'Show or hide Status' })
    expect(statusBox).not.toBeChecked()
    fireEvent.click(statusBox)
    expect(onChange).toHaveBeenCalledWith({
      order: ['name', 'status', 'detail'],
      hidden: [],
    })
  })

  it('disables the last visible column so it cannot be hidden', () => {
    const layout: ColumnLayout = {
      order: ['name', 'status', 'detail'],
      hidden: ['status', 'detail'],
    }
    const { onChange } = setup({ layout })
    openMenu()
    const nameBox = screen.getByRole('checkbox', { name: 'Show or hide Name' })
    expect(nameBox).toBeChecked()
    expect(nameBox).toBeDisabled()
    fireEvent.click(nameBox)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('disables the checkbox for a required column', () => {
    const { onChange } = setup({
      columns: [
        { key: 'name', header: 'Name', required: true },
        { key: 'status', header: 'Status' },
      ],
    })
    openMenu()
    const nameBox = screen.getByRole('checkbox', { name: 'Show or hide Name' })
    expect(nameBox).toBeDisabled()
    fireEvent.click(nameBox)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('hides the checkboxes entirely when toggleable is false', () => {
    setup({ toggleable: false })
    openMenu()
    expect(screen.queryByRole('checkbox')).toBeNull()
    // Reorder controls remain because reorderable defaults to true.
    expect(screen.getByTestId('datatable-column-menu-up-detail')).toBeInTheDocument()
  })
})

describe('DataTableColumnMenu — reordering', () => {
  it('moves a column down and emits the reordered layout', () => {
    const { onChange } = setup()
    openMenu()
    fireEvent.click(screen.getByTestId('datatable-column-menu-down-name'))
    expect(onChange).toHaveBeenCalledWith({
      order: ['status', 'name', 'detail'],
      hidden: [],
    })
  })

  it('moves a column up and emits the reordered layout', () => {
    const { onChange } = setup()
    openMenu()
    fireEvent.click(screen.getByTestId('datatable-column-menu-up-detail'))
    expect(onChange).toHaveBeenCalledWith({
      order: ['name', 'detail', 'status'],
      hidden: [],
    })
  })

  it('disables ↑ on the first row and ↓ on the last row', () => {
    const { onChange } = setup()
    openMenu()
    const firstUp = screen.getByTestId('datatable-column-menu-up-name')
    const lastDown = screen.getByTestId('datatable-column-menu-down-detail')
    expect(firstUp).toBeDisabled()
    expect(lastDown).toBeDisabled()
    fireEvent.click(firstUp)
    fireEvent.click(lastDown)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('labels the icon-only reorder buttons with the column name', () => {
    setup()
    openMenu()
    expect(screen.getByRole('button', { name: 'Move Status up' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Move Status down' }),
    ).toBeInTheDocument()
  })

  it('hides the reorder controls when reorderable is false', () => {
    setup({ reorderable: false })
    fireEvent.click(screen.getByRole('button', { name: 'Show or hide columns' }))
    expect(screen.getByTestId('datatable-column-menu')).toBeInTheDocument()
    expect(screen.queryByTestId('datatable-column-menu-up-name')).toBeNull()
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
  })
})

describe('DataTableColumnMenu — reset + empty hardening', () => {
  it('invokes onReset when the reset control is clicked', () => {
    const { onReset } = setup()
    openMenu()
    fireEvent.click(screen.getByTestId('datatable-column-menu-reset'))
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('renders an empty-state row instead of crashing when there are no columns', () => {
    setup({ columns: [] })
    openMenu()
    expect(screen.getByTestId('datatable-column-menu-empty')).toHaveTextContent(
      'No columns to configure',
    )
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByTestId('datatable-column-menu-up-name')).toBeNull()
  })
})
