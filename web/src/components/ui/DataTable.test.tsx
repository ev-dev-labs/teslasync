/**
 * DataTable column reorder + visibility tests.
 *
 * Sibling test file (next to DataTable.tsx) for the new
 * `columnReorder` + `columnVisibility` props. The pre-existing,
 * full-coverage suite still lives in
 * `web/src/components/ui/__tests__/DataTable.test.tsx`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useMemo, useState } from 'react'
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import '@/i18n'
import { DataTable, type Column } from './DataTable'
import { ToastProvider } from '../feedback/Toast'
import { Button } from './Button'
import { downloadRowsAsCSV } from '@/lib/csvExport'
import { useNumberFormatting } from '@/hooks/useNumberFormatting'
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat'

interface Row {
  id: number
  name: string
  status: 'ok' | 'fail'
}

const ROWS: Row[] = [
  { id: 1, name: 'Alpha',   status: 'ok' },
  { id: 2, name: 'Bravo',   status: 'fail' },
  { id: 3, name: 'Charlie', status: 'ok' },
]

const REORDER_COLS: Column<Row>[] = [
  { key: 'id', header: 'ID', render: r => <span>{r.id}</span> },
  { key: 'name', header: 'Name', render: r => <span>{r.name}</span> },
  { key: 'status', header: 'Status', render: r => <span>{r.status}</span> },
]

function getHeaderOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('thead th[data-column-key]')).map(
    (th) => th.getAttribute('data-column-key') ?? '',
  )
}

beforeEach(() => {
  window.localStorage.clear()
  setGlobalLocale('en-US')
  setGlobalPrecision(2)
})

describe('DataTable — reusable value filters', () => {
  const columns: Column<Row>[] = [
    { key: 'name', header: 'Name', render: row => <span>{row.name}</span>, filterValue: row => row.name },
    { key: 'status', header: 'Status', render: row => <span>{row.status}</span>, filterValue: row => row.status, groupStart: true },
  ]

  it('updates mounted measurement cells and memoized filter labels without losing canonical selections', () => {
    const readings = [
      { id: 1, energy: 12.34567 },
      { id: 2, energy: 23.45678 },
    ]
    const original = JSON.stringify(readings)
    function PrecisionTable() {
      const { fmtNumber, fmtInt } = useNumberFormatting()
      const formatted = useMemo<Column<(typeof readings)[number]>[]>(() => [
        { key: 'id', header: 'ID', render: row => fmtInt(row.id) },
        {
          key: 'energy', header: 'Energy', render: row => `${fmtNumber(row.energy)} kWh`,
          filterValue: row => row.energy,
          filterValueLabel: (_value, row) => `${fmtNumber(row.energy)} kWh`,
        },
      ], [fmtNumber, fmtInt])
      return <DataTable columns={formatted} data={readings} keyExtractor={row => row.id} enableValueFilters />
    }
    render(<PrecisionTable />)
    fireEvent.click(screen.getByRole('button', { name: 'Energy filter' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all shown values' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '12.35 kWh' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByText('12.35 kWh')).toBeInTheDocument()
    expect(screen.queryByText('23.46 kWh')).toBeNull()

    act(() => setGlobalPrecision(3))
    const cell = screen.getByText('12.346 kWh')
    expect(within(cell.closest('tr')!).getByText('1')).toBeInTheDocument()
    expect(screen.queryByText('23.457 kWh')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Energy filter' }))
    expect(screen.getByRole('checkbox', { name: '12.346 kWh' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '23.457 kWh' })).not.toBeChecked()
    act(() => setGlobalLocale('de-DE'))
    expect(screen.getByRole('checkbox', { name: '12,346 kWh' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '23,457 kWh' })).not.toBeChecked()
    expect(JSON.stringify(readings)).toBe(original)
  })

  it('labels raw null as unknown rather than extracting a renderer-coerced zero', () => {
    const rows = [{ id: 1, value: null }, { id: 2, value: 0 }]
    render(<DataTable data={rows} keyExtractor={row => row.id} enableValueFilters
      columns={[{ key: 'value', header: 'Reading', filterValue: row => row.value,
        render: row => <span>{row.value ?? 0}</span> }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reading filter' }))
    expect(screen.getByRole('checkbox', { name: '—' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '0' })).toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: '0' }))
    expect(screen.getByText('1 matching / 2 loaded rows')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '—' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '0' })).not.toBeChecked()
  })

  it('does not silently enable loaded-row filters by default', () => {
    render(<DataTable columns={columns} data={ROWS} keyExtractor={row => row.id} />)
    expect(screen.queryByRole('button', { name: 'Status filter' })).toBeNull()
  })

  it('filters all loaded rows before pagination and retains an editable header for zero matches', () => {
    render(<DataTable columns={columns} data={ROWS} keyExtractor={row => row.id}
      enableValueFilters pagination={{ defaultPageSize: 1, pageSizeOptions: [1, 2] }} emptyMessage="Nothing matches" />)
    fireEvent.click(screen.getByRole('button', { name: 'Status filter' }))
    const filter = screen.getByRole('dialog', { name: 'Status filter' })
    fireEvent.click(within(filter).getByRole('checkbox', { name: 'ok' }))
    expect(screen.getByText('Bravo')).toBeInTheDocument()
    expect(screen.queryByText('Alpha')).toBeNull()
    expect(screen.getByText('1 matching / 3 loaded rows')).toBeInTheDocument()
    fireEvent.click(within(filter).getByRole('checkbox', { name: 'fail' }))
    expect(screen.getByText('Nothing matches')).toBeInTheDocument()
    expect(screen.getByText('0 matching / 3 loaded rows')).toBeInTheDocument()
    fireEvent.click(within(filter).getByRole('button', { name: 'Clear' }))
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.queryByText(/matching \/ 3 loaded rows/)).toBeNull()
  })

  it('uses independently loaded candidates and keeps legacy conditions in an accordion', () => {
    render(<DataTable columns={[{ ...columns[1], filter: <span>Minimum confidence</span>, filterActive: true }]}
      data={ROWS.slice(0, 1)} filterData={ROWS} keyExtractor={row => row.id} enableValueFilters />)
    fireEvent.click(screen.getByRole('button', { name: 'Status filter' }))
    expect(screen.getByRole('checkbox', { name: 'fail' }).closest('label')).toHaveTextContent('1')
    expect(screen.getByRole('button', { name: /Conditions/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Minimum confidence')).toBeVisible()
  })

  it('limits select-all to filtered loaded rows without rewriting controlled hidden selections', () => {
    const onSelectionChange = vi.fn()
    render(<DataTable columns={columns} data={ROWS} keyExtractor={row => row.id} enableValueFilters
      selectable="multi" selectedKeys={[1]} onSelectionChange={onSelectionChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Status filter' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'ok' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onSelectionChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }))
    expect(onSelectionChange).toHaveBeenCalledWith([1, 2])
  })

  it('does not turn nested control key presses into row-selection shortcuts', () => {
    const onSelectionChange = vi.fn()
    render(<DataTable columns={[{ key: 'name', header: 'Name', render: row => <a href="#preview">{row.name}</a> }]}
      data={ROWS} keyExtractor={row => row.id} selectable="multi" onSelectionChange={onSelectionChange} />)
    fireEvent.keyDown(screen.getByRole('link', { name: 'Alpha' }), { key: ' ' })
    expect(onSelectionChange).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole('link', { name: 'Alpha' }).closest('tr')!, { key: ' ' })
    expect(onSelectionChange).toHaveBeenCalledWith([1])
  })

  it('retains canonical selections when formatted units change and combines columns', () => {
    const formatted = (unit: string): Column<Row>[] => [
      { ...columns[0], filterValue: row => row.id, filterValueLabel: value => `${value} ${unit}` },
      columns[1],
    ]
    const { rerender } = render(<DataTable columns={formatted('m')} data={ROWS} keyExtractor={row => row.id} enableValueFilters />)
    fireEvent.click(screen.getByRole('button', { name: 'Name filter' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all shown values' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '1 m' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    rerender(<DataTable columns={formatted('ft')} data={ROWS} keyExtractor={row => row.id} enableValueFilters />)
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.queryByText('Bravo')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Name filter' }))
    expect(screen.getByRole('checkbox', { name: '1 ft' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    fireEvent.click(screen.getByRole('button', { name: 'Status filter' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'ok' }))
    expect(screen.queryByText('Alpha')).toBeNull()
    expect(screen.getByText('0 matching / 3 loaded rows')).toBeInTheDocument()
  })

  it('shares neutral framing, group dividers, numeric alignment, and selection markers without a visible machine heading', () => {
    const { container } = render(<DataTable tableId="machine:opaque" columns={[
      ...columns, { key: 'id', header: 'ID', align: 'right', render: row => row.id },
    ]} data={ROWS} keyExtractor={row => row.id} selectable="multi" selectedKeys={[2]} />)
    expect(container.firstElementChild).toHaveClass('min-w-0', 'max-w-full', 'rounded-xl')
    expect(container.querySelector('th[data-column-key=status]')).toHaveClass('border-l')
    expect(container.querySelector('td[data-column-key=status]')).toHaveClass('border-l')
    expect(container.querySelector('td[data-column-key=id]')).toHaveClass('text-right', 'tabular-nums')
    expect(container.querySelector('tr[aria-selected=true]')).toHaveClass('!bg-[var(--control-bg)]')
    expect(screen.queryByRole('heading', { name: 'machine:opaque' })).toBeNull()
  })
})

describe('DataTable — responsive toolbar ownership', () => {
  it('preserves selection without duplicating a page-owned selection summary', () => {
    const onSelectionChange = vi.fn()
    render(
      <DataTable columns={REORDER_COLS} data={ROWS} keyExtractor={row => row.id}
        selectable="multi" selectedKeys={[1]} onSelectionChange={onSelectionChange}
        toolbarHeading={<span>Evidence</span>} showSelectionSummary={false} />,
    )
    expect(screen.getByText('Evidence')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull()
    expect(screen.getAllByRole('checkbox')[1]).toBeChecked()
    fireEvent.click(screen.getAllByRole('checkbox')[1])
    expect(onSelectionChange).toHaveBeenCalledWith([])
  })

  it('keeps the existing selection summary by default', () => {
    render(
      <DataTable columns={REORDER_COLS} data={ROWS} keyExtractor={row => row.id}
        selectable="multi" selectedKeys={[1]} />,
    )
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toBeInTheDocument()
  })
})

describe('DataTable — columnReorder + columnVisibility (Phase-46 / Prompt 45)', () => {
  it('defaults persistent tables to one unified resize/reorder/visibility toolbar without inventing sorting', () => {
    const { container } = render(<DataTable columns={REORDER_COLS} data={ROWS} keyExtractor={row => row.id}
      tableId="pro-defaults" toolbarHeading={<span>Evidence</span>} toolbarActions={<Button>Page export</Button>} />)
    expect(screen.getAllByRole('button', { name: /reorder or hide columns/i })).toHaveLength(1)
    expect(screen.getAllByRole('separator')).toHaveLength(3)
    expect(container.querySelector('th[data-column-key=name]')).toHaveAttribute('draggable', 'true')
    expect(screen.queryByRole('button', { name: 'Name' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /reorder or hide columns/i }))
    expect(screen.getByRole('checkbox', { name: /show or hide name/i })).toBeChecked()
  })

  it('preserves complete explicit opt-outs and mobile column structure', () => {
    const { container } = render(<DataTable columns={REORDER_COLS} data={ROWS} keyExtractor={row => row.id}
      tableId="fixed-axis" resizable={false} columnReorder={false} columnVisibility={false} mobileColumns={['name']} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('separator')).toBeNull()
    expect(container.querySelector('th[data-column-key=id]')).toHaveClass('hidden', 'md:table-cell')
    expect(container.querySelector('th[data-column-key=name]')).not.toHaveAttribute('draggable')
  })

  it('honors a legacy visibility opt-out independently of reorder and resize', () => {
    render(<DataTable columns={REORDER_COLS} data={ROWS} keyExtractor={row => row.id}
      tableId="legacy-opt-out" showColumnsMenu={false} columnReorder={false} resizable={false} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('does not add persistent controls without an identifier or no-op sorting without a handler', () => {
    const { container } = render(<DataTable columns={[{ ...REORDER_COLS[1], sortable: true }]}
      data={ROWS} keyExtractor={row => row.id} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('separator')).toBeNull()
    expect(container.querySelector('th')).not.toHaveAttribute('aria-sort')
  })

  it('keeps new optional columns hidden when reordering an existing saved layout', () => {
    window.localStorage.setItem('teslasync.table.reorder-upgrade.columns', JSON.stringify({
      order: ['id', 'name', 'status'], hidden: [],
    }))
    const columns: Column<Row>[] = [
      ...REORDER_COLS,
      { key: 'detail', header: 'Detail', defaultVisible: false, render: row => row.status },
    ]
    const { container } = render(
      <DataTable columns={columns} data={ROWS} keyExtractor={row => row.id} tableId="reorder-upgrade" columnReorder />,
    )
    expect(getHeaderOrder(container)).toEqual(['id', 'name', 'status'])
    const source = container.querySelector('thead th[data-column-key="id"]')!
    const target = container.querySelector('thead th[data-column-key="status"]')!
    fireEvent.dragStart(source)
    fireEvent.dragOver(target)
    fireEvent.drop(target)
    expect(getHeaderOrder(container)).toEqual(['name', 'status', 'id'])
    expect(JSON.parse(window.localStorage.getItem('teslasync.table.reorder-upgrade.columns')!).hidden)
      .toEqual(['detail'])
  })

  it('reorders columns via drag-and-drop and persists the new layout', () => {
    const { container } = render(
      <DataTable
        columns={REORDER_COLS}
        data={ROWS}
        keyExtractor={r => r.id}
        tableId="reorder-1"
        columnReorder
      />,
    )
    expect(getHeaderOrder(container)).toEqual(['id', 'name', 'status'])
    const ths = container.querySelectorAll('thead th[data-column-key]')
    const source = ths[0] as HTMLElement // 'id'
    const target = ths[2] as HTMLElement // 'status'
    fireEvent.dragStart(source)
    fireEvent.dragOver(target)
    fireEvent.drop(target)
    fireEvent.dragEnd(source)
    // 'id' has been moved to position 2 (where 'status' was).
    expect(getHeaderOrder(container)).toEqual(['name', 'status', 'id'])
    // Persistence: the layout went to localStorage under the new key.
    const stored = JSON.parse(window.localStorage.getItem('teslasync.table.reorder-1.columns')!)
    expect(stored.order).toEqual(['name', 'status', 'id'])
    expect(stored.hidden).toEqual([])
  })

  it('keyboard ↑ / ↓ in the column menu reorders and persists', () => {
    const { container } = render(
      <DataTable
        columns={REORDER_COLS}
        data={ROWS}
        keyExtractor={r => r.id}
        tableId="reorder-2"
        columnReorder
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /reorder or hide columns/i }))
    // Move 'id' down twice — ends up last.
    fireEvent.click(screen.getByTestId('datatable-column-menu-down-id'))
    fireEvent.click(screen.getByTestId('datatable-column-menu-down-id'))
    expect(getHeaderOrder(container)).toEqual(['name', 'status', 'id'])
    // Move 'status' up once — ends up first.
    fireEvent.click(screen.getByTestId('datatable-column-menu-up-status'))
    expect(getHeaderOrder(container)).toEqual(['status', 'name', 'id'])
    const stored = JSON.parse(window.localStorage.getItem('teslasync.table.reorder-2.columns')!)
    expect(stored.order).toEqual(['status', 'name', 'id'])
  })

  it('hides a column from the menu and persists', () => {
    const { container } = render(
      <DataTable
        columns={REORDER_COLS}
        data={ROWS}
        keyExtractor={r => r.id}
        tableId="reorder-3"
        columnVisibility
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /reorder or hide columns/i }))
    const nameCheckbox = screen.getByRole('checkbox', { name: /show or hide name/i })
    expect(nameCheckbox).toBeChecked()
    fireEvent.click(nameCheckbox)
    // Header for 'name' is gone from the rendered table.
    expect(getHeaderOrder(container)).toEqual(['id', 'status'])
    const stored = JSON.parse(window.localStorage.getItem('teslasync.table.reorder-3.columns')!)
    expect(stored.hidden).toContain('name')
  })

  it('Reset clears the persisted layout and restores defaults', () => {
    window.localStorage.setItem(
      'teslasync.table.reorder-4.columns',
      JSON.stringify({ order: ['status', 'id', 'name'], hidden: ['name'] }),
    )
    const { container } = render(
      <DataTable
        columns={REORDER_COLS}
        data={ROWS}
        keyExtractor={r => r.id}
        tableId="reorder-4"
        columnReorder
      />,
    )
    // Reflects the seeded layout on mount.
    expect(getHeaderOrder(container)).toEqual(['status', 'id'])
    fireEvent.click(screen.getByRole('button', { name: /reorder or hide columns/i }))
    fireEvent.click(screen.getByTestId('datatable-column-menu-reset'))
    // Back to source order with all columns visible.
    expect(getHeaderOrder(container)).toEqual(['id', 'name', 'status'])
    expect(window.localStorage.getItem('teslasync.table.reorder-4.columns')).toBeNull()
  })

  it('migrates the legacy `.visible` storage key into the new layout shape', () => {
    window.localStorage.setItem(
      'teslasync.table.reorder-5.visible',
      JSON.stringify(['status', 'id']),
    )
    const { container } = render(
      <DataTable
        columns={REORDER_COLS}
        data={ROWS}
        keyExtractor={r => r.id}
        tableId="reorder-5"
        columnVisibility
      />,
    )
    // 'name' was missing from the legacy list → migrated as hidden.
    expect(getHeaderOrder(container)).toEqual(['status', 'id'])
  })

  it('does NOT show the menu trigger when columnReorder is set without tableId', () => {
    render(
      <DataTable
        columns={REORDER_COLS}
        data={ROWS}
        keyExtractor={r => r.id}
        columnReorder
      />,
    )
    expect(screen.queryByRole('button', { name: /reorder or hide columns/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /show or hide columns/i })).toBeNull()
  })

  it('drop on the same column key is a no-op (no persistence write)', () => {
    const { container } = render(
      <DataTable
        columns={REORDER_COLS}
        data={ROWS}
        keyExtractor={r => r.id}
        tableId="reorder-6"
        columnReorder
      />,
    )
    const ths = container.querySelectorAll('thead th[data-column-key]')
    const source = ths[1] as HTMLElement
    fireEvent.dragStart(source)
    fireEvent.drop(source)
    fireEvent.dragEnd(source)
    expect(getHeaderOrder(container)).toEqual(['id', 'name', 'status'])
    expect(window.localStorage.getItem('teslasync.table.reorder-6.columns')).toBeNull()
  })

  it('renders a grip handle on every header when columnReorder is enabled', () => {
    render(
      <DataTable
        columns={REORDER_COLS}
        data={ROWS}
        keyExtractor={r => r.id}
        tableId="reorder-7"
        columnReorder
      />,
    )
    expect(screen.getByTestId('datatable-column-grip-id')).toBeInTheDocument()
    expect(screen.getByTestId('datatable-column-grip-name')).toBeInTheDocument()
    expect(screen.getByTestId('datatable-column-grip-status')).toBeInTheDocument()
  })

  it('mirrors the visible-keys list to the legacy `.visible` storage key for back-compat', () => {
    render(
      <DataTable
        columns={REORDER_COLS}
        data={ROWS}
        keyExtractor={r => r.id}
        tableId="reorder-8"
        columnVisibility
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /reorder or hide columns/i }))
    fireEvent.click(screen.getByRole('checkbox', { name: /show or hide status/i }))
    const legacy = JSON.parse(window.localStorage.getItem('teslasync.table.reorder-8.visible')!)
    expect(legacy).toEqual(['id', 'name'])
    const layout = JSON.parse(window.localStorage.getItem('teslasync.table.reorder-8.columns')!)
    expect(layout.hidden).toContain('status')
  })
})

describe('DataTable — pagination persistence', () => {
  const PAGINATED_ROWS = Array.from({ length: 60 }, (_, index) => ({
    id: index + 1,
    name: `Row ${index + 1}`,
    status: 'ok' as const,
  }))

  it('restores the selected page size for a stable table identifier', () => {
    const first = render(
      <DataTable
        columns={REORDER_COLS}
        data={PAGINATED_ROWS}
        keyExtractor={row => row.id}
        tableId="pagination-persistence"
        pagination
      />,
    )

    const pageSize = screen.getByRole('combobox', { name: 'Rows per page' })
    expect(pageSize).toHaveValue('25')
    fireEvent.change(pageSize, { target: { value: '50' } })
    expect(window.localStorage.getItem('teslasync.table.pagination-persistence.page-size')).toBe('50')
    first.unmount()

    render(
      <DataTable
        columns={REORDER_COLS}
        data={PAGINATED_ROWS}
        keyExtractor={row => row.id}
        tableId="pagination-persistence"
        pagination
      />,
    )

    expect(screen.getByRole('combobox', { name: 'Rows per page' })).toHaveValue('50')
    expect(screen.getByText('Showing 1–50 of 60')).toBeInTheDocument()
  })
})

// Virtualization stress tests.
// Stress test: with `virtualized` enabled on a 5000-row dataset the DOM
// must contain only the spacer rows + a small visible window — never
// the full row set. This guards against accidental virtualization
// regressions on the long-list pages (TeslaChargingSessionsPage,
// TeslaChargingHistoryPage, RedisSignalViewerPage, etc.) where we rely
// on a bounded DOM to keep scroll smooth.
describe('DataTable — virtualization stress (Phase-46 / Prompt 52)', () => {
  function buildBigDataset(count: number): Row[] {
    return Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      name: `Row ${i + 1}`,
      status: i % 2 === 0 ? 'ok' : 'fail',
    }))
  }

  it('renders < 50 body rows when handed 5000 rows with virtualized', () => {
    const data = buildBigDataset(5000)
    const { container } = render(
      <DataTable
        columns={REORDER_COLS}
        data={data}
        keyExtractor={r => r.id}
        virtualized
        rowHeight={56}
        maxHeight={600}
      />,
    )
    const tbody = container.querySelector('tbody')
    expect(tbody).not.toBeNull()
    const rows = tbody!.querySelectorAll('tr')
    // Count includes spacer rows; the regression threshold is < 50.
    expect(rows.length).toBeLessThan(50)
    // Defensive: also ensure we did NOT explode the DOM.
    expect(rows.length).toBeGreaterThan(0)
  })

  it('5000-row virtualized table keeps a bottom spacer so scrollHeight reflects the full dataset', () => {
    const data = buildBigDataset(5000)
    const { container } = render(
      <DataTable
        columns={REORDER_COLS}
        data={data}
        keyExtractor={r => r.id}
        virtualized
        rowHeight={56}
        maxHeight={600}
      />,
    )
    const tbody = container.querySelector('tbody')
    const bottomSpacer = tbody?.querySelector('tr[data-virtual-spacer="bottom"]')
    expect(bottomSpacer).not.toBeNull()
  })
})

// DataTable export tests.
// Long-tail list pages (charging, alerts, etc.) opt into a "Download CSV"
// button via the `exportable` prop. These tests guard against regressions
// in the export pipeline:
//   1. The button is rendered + accessible when `exportable` is true.
//   2. Clicking it triggers a download with the configured filename.
//   3. The exported CSV contains the rows currently visible to the user
//      (post-filter / post-sort), serialized via `exportRow` so React-node
//      cells flatten to plain strings.
describe('DataTable — export adoption (Phase-46 / Prompt 55)', () => {
  // Capture all download attempts triggered by `<a download="…">.click()`.
  // jsdom doesn't navigate, so we intercept via spy on
  // HTMLAnchorElement.prototype.click. URL.createObjectURL is stubbed to
  // stash the source Blob keyed by the synthetic blob URL, and the test
  // helper `latestCsv()` awaits the Blob's text() to read it back.
  const blobStash = new Map<string, Blob>()
  const downloads: { filename: string; url: string }[] = []
  let originalClick: typeof HTMLAnchorElement.prototype.click

  beforeEach(() => {
    blobStash.clear()
    downloads.length = 0
    originalClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function () {
      downloads.push({
        filename: (this as HTMLAnchorElement).download,
        url: (this as HTMLAnchorElement).href,
      })
    }
    // @ts-expect-error — jsdom URL.createObjectURL isn't typed as configurable.
    URL.createObjectURL = vi.fn((blob: Blob) => {
      const url = `blob:test/${blobStash.size + 1}`
      blobStash.set(url, blob)
      return url
    })
    // @ts-expect-error — jsdom URL.revokeObjectURL isn't typed as configurable.
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    HTMLAnchorElement.prototype.click = originalClick
  })

  async function latestCsv(): Promise<string> {
    const last = downloads[downloads.length - 1]
    if (!last) throw new Error('no download captured')
    const blob = blobStash.get(last.url)
    if (!blob) throw new Error(`no blob stashed for ${last.url}`)
    return await blob.text()
  }

  const filterColumns: Column<Row>[] = REORDER_COLS.map(column => column.key === 'status'
    ? { ...column, filterValue: row => row.status }
    : column)

  function excludeFailedRows() {
    fireEvent.click(screen.getByRole('button', { name: 'Status filter' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'fail' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  }

  it('exports matching loaded rows across all internal pages in incoming sort order', async () => {
    const sorted = [...ROWS].reverse()
    render(<DataTable columns={filterColumns} data={sorted} keyExtractor={row => row.id}
      enableValueFilters exportable exportFilename="matching"
      exportRow={row => ({ id: row.id, name: row.name.toUpperCase(), status: row.status })}
      pagination={{ defaultPageSize: 1, pageSizeOptions: [1] }} />)
    excludeFailedRows()
    expect(screen.getByText('Charlie')).toBeInTheDocument()
    expect(screen.queryByText('Alpha')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /download csv/i }))
    await waitFor(() => expect(downloads).toHaveLength(1))
    expect(await latestCsv()).toBe('ID,Name,Status\r\n3,CHARLIE,ok\r\n1,ALPHA,ok')
  })

  it('retains hidden selected rows for explicit bulk exports, independently of ordinary CSV', async () => {
    const onSelectionChange = vi.fn()
    render(<DataTable columns={filterColumns} data={ROWS} keyExtractor={row => row.id}
      enableValueFilters exportable selectable="multi" selectedKeys={[1, 2]} onSelectionChange={onSelectionChange}
      pagination={{ defaultPageSize: 1, pageSizeOptions: [1] }}
      bulkActions={selected => <Button onClick={() => downloadRowsAsCSV('selected', selected, REORDER_COLS)}>
        Export selected
      </Button>} />)
    excludeFailedRows()
    expect(onSelectionChange).not.toHaveBeenCalled()
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toHaveTextContent('2 selected')
    fireEvent.click(screen.getByRole('button', { name: 'Export selected' }))
    expect(await latestCsv()).toBe('ID,Name,Status\r\n1,Alpha,ok\r\n2,Bravo,fail')
    fireEvent.click(screen.getByRole('button', { name: /download csv/i }))
    await waitFor(() => expect(downloads).toHaveLength(2))
    expect(await latestCsv()).toBe('ID,Name,Status\r\n1,Alpha,ok\r\n3,Charlie,ok')
  })

  it('preserves caller-owned full export callbacks rather than applying loaded-row filters to their result', async () => {
    const serverRow: Row = { id: 99, name: 'Server row', status: 'fail' }
    const exportAll = vi.fn(async () => [serverRow])
    render(<DataTable columns={filterColumns} data={ROWS} keyExtractor={row => row.id}
      enableValueFilters exportable exportAll={exportAll} />)
    excludeFailedRows()
    fireEvent.click(screen.getByRole('button', { name: 'Status filter' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'ok' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByText('0 matching / 3 loaded rows')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /download csv/i })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: /download csv/i }))
    await waitFor(() => expect(downloads).toHaveLength(1))
    expect(exportAll).toHaveBeenCalledOnce()
    expect(await latestCsv()).toBe('ID,Name,Status\r\n99,Server row,fail')
  })

  it('disables ordinary CSV when no loaded rows match an internal value filter', () => {
    render(<DataTable columns={filterColumns} data={ROWS} keyExtractor={row => row.id}
      enableValueFilters exportable />)
    fireEvent.click(screen.getByRole('button', { name: 'Status filter' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all shown values' }))
    expect(screen.getByRole('button', { name: /download csv/i })).toBeDisabled()
  })

  it('select-all adds and removes matching loaded keys without dropping hidden selections', () => {
    function SelectedTable() {
      const [selected, setSelected] = useState<Array<string | number>>([2])
      return <DataTable columns={filterColumns} data={ROWS} keyExtractor={row => row.id}
        enableValueFilters selectable="multi" selectedKeys={selected} onSelectionChange={setSelected}
        bulkActions={rows => <span>Selected IDs: {rows.map(row => row.id).join(',')}</span>} />
    }
    render(<SelectedTable />)
    excludeFailedRows()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }))
    expect(screen.getByText('Selected IDs: 1,2,3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Deselect all rows' }))
    expect(screen.getByText('Selected IDs: 2')).toBeInTheDocument()
  })

  it('renders the "Download CSV" button when `exportable` is set', () => {
    render(
      <DataTable
        columns={REORDER_COLS}
        data={ROWS}
        keyExtractor={r => r.id}
        tableId="export-1"
        exportable
      />,
    )
    expect(screen.getByRole('button', { name: /download csv/i })).toBeInTheDocument()
  })

  it('does NOT render the export button when `exportable` is omitted', () => {
    render(
      <DataTable
        columns={REORDER_COLS}
        data={ROWS}
        keyExtractor={r => r.id}
        tableId="export-2"
      />,
    )
    expect(screen.queryByRole('button', { name: /download csv/i })).toBeNull()
  })

  it('disables the export button when there is no data', () => {
    render(
      <DataTable
        columns={REORDER_COLS}
        data={[]}
        keyExtractor={r => r.id}
        tableId="export-3"
        exportable
      />,
    )
    expect(screen.getByRole('button', { name: /download csv/i })).toBeDisabled()
  })

  it('clicking export triggers a download with the configured filename', async () => {
    render(
      <DataTable
        columns={REORDER_COLS}
        data={ROWS}
        keyExtractor={r => r.id}
        tableId="export-4"
        exportable
        exportFilename="drives-2024-11"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /download csv/i }))
    // The export handler is async; flush microtasks so the download lands.
    await new Promise((r) => setTimeout(r, 0))
    expect(downloads.length).toBe(1)
    // downloadCSV() appends `.csv` if missing.
    expect(downloads[0].filename).toBe('drives-2024-11.csv')
  })

  it('falls back to a date-stamped filename derived from `tableId` when `exportFilename` is omitted', async () => {
    render(
      <DataTable
        columns={REORDER_COLS}
        data={ROWS}
        keyExtractor={r => r.id}
        tableId="export-5"
        exportable
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /download csv/i }))
    await new Promise((r) => setTimeout(r, 0))
    expect(downloads.length).toBe(1)
    // Filename pattern: `<tableId>-YYYY-MM-DD.csv`.
    expect(downloads[0].filename).toMatch(/^export-5-\d{4}-\d{2}-\d{2}\.csv$/)
  })

  it('exports the visible rows with values flattened via `exportRow`', async () => {
    render(
      <DataTable
        columns={REORDER_COLS}
        data={ROWS}
        keyExtractor={r => r.id}
        tableId="export-6"
        exportable
        exportFilename="export-6"
        exportRow={(row) => ({
          id: row.id,
          name: row.name.toUpperCase(),
          status: row.status,
        })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /download csv/i }))
    await new Promise((r) => setTimeout(r, 0))
    expect(downloads.length).toBe(1)
    const csv = await latestCsv()
    // Header derived from column.header values.
    expect(csv).toContain('ID,Name,Status')
    // exportRow uppercased the name field.
    expect(csv).toContain('1,ALPHA,ok')
    expect(csv).toContain('2,BRAVO,fail')
    expect(csv).toContain('3,CHARLIE,ok')
  })

  it('keeps the export control visibly busy until an async full-data export resolves', async () => {
    let resolveRows: ((rows: Row[]) => void) | undefined
    const exportAll = vi.fn(
      () =>
        new Promise<Row[]>((resolve) => {
          resolveRows = resolve
        }),
    )
    render(
      <DataTable
        columns={REORDER_COLS}
        data={ROWS}
        keyExtractor={r => r.id}
        tableId="export-7"
        exportable
        exportAll={exportAll}
      />,
    )

    const button = screen.getByRole('button', { name: /download csv/i })
    fireEvent.click(button)
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')

    resolveRows?.(ROWS)
    await waitFor(() => expect(button).toBeEnabled())
    expect(exportAll).toHaveBeenCalledTimes(1)
  })

  it('surfaces async export failures and restores the control', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    render(
      <ToastProvider>
        <DataTable
          columns={REORDER_COLS}
          data={ROWS}
          keyExtractor={r => r.id}
          tableId="export-8"
          exportable
          exportAll={() => Promise.reject(new Error('query failed'))}
        />
      </ToastProvider>,
    )

    const button = screen.getByRole('button', { name: /download csv/i })
    fireEvent.click(button)

    expect(
      await screen.findByText('Could not prepare the table export.'),
    ).toBeInTheDocument()
    expect(button).toBeEnabled()
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
