import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DataTable, type Column } from './DataTable'
import { Button } from './Button'
import { buildMobileTableRow } from './MobileDataTableAdapter'
import type { MobileDataTablePresentation, MobileTableRowKey } from './MobileDataTableAdapter.types'
import { downloadCSV, downloadJSON } from '@/lib/csvExport'

vi.mock('@/lib/csvExport', async () => ({
  ...await vi.importActual<typeof import('@/lib/csvExport')>('@/lib/csvExport'),
  downloadCSV: vi.fn(),
  downloadJSON: vi.fn(),
}))

interface Row {
  id: MobileTableRowKey
  name: string
  amount: number | null
  secret: string
}

const rows: Row[] = [
  { id: 0, name: 'Numeric zero', amount: 0, secret: 'private numeric' },
  { id: '0', name: 'String zero', amount: null, secret: 'private string' },
  { id: 2, name: 'Last record', amount: 1500, secret: 'private last' },
]
const columns: Column<Row>[] = [
  { key: 'name', header: 'Name', render: row => row.name, sortable: true, filterValue: row => row.name },
  { key: 'amount', header: 'Amount', render: row => row.amount, exportValue: row => row.amount },
  { key: 'secret', header: 'Secret', render: row => row.secret, defaultVisible: false },
]
const presentation: MobileDataTablePresentation<Row> = {
  roles: { name: 'title', amount: 'primary' },
  displayValue: (row, key) => key === 'name' ? row.name : key === 'amount' ? row.amount : null,
  canShowField: key => key !== 'secret',
}
const observers = new Map<Element, ResizeObserverCallback>()
function resize(width: number) {
  act(() => observers.forEach((callback, element) => callback(
    [{ target: element, contentRect: { width } } as ResizeObserverEntry],
    {} as ResizeObserver,
  )))
}
beforeEach(() => {
  localStorage.clear()
  observers.clear()
  vi.clearAllMocks()
  vi.stubGlobal('ResizeObserver', class {
    private elements = new Set<Element>()
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: Element) {
      this.elements.add(element)
      observers.set(element, this.callback)
    }
    unobserve(element: Element) {
      this.elements.delete(element)
      observers.delete(element)
    }
    disconnect() {
      this.elements.forEach(element => observers.delete(element))
      this.elements.clear()
    }
  })
})
afterEach(() => vi.unstubAllGlobals())

function mount(extra: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) {
  return render(<DataTable tableId="production:records" caption="Production records"
    columns={columns} data={rows} keyExtractor={row => row.id}
    mobilePresentation={presentation} {...extra} />)
}
function selectMode(width: number) {
  resize(width)
  if (width < 640) fireEvent.click(screen.getByRole('button', { name: 'Select' }))
}
async function exportAs(format: 'CSV' | 'JSON', scope?: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Export list' }))
  if (scope) fireEvent.click(screen.getByRole('radio', { name: scope }))
  fireEvent.click(screen.getByRole('menuitem', { name: `Download as ${format}` }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Export list' })).toBeEnabled())
}
function onlyLastValue() {
  fireEvent.click(screen.getByRole('button', { name: 'Name filter' }))
  const filter = screen.getByRole('dialog', { name: 'Name filter' })
  fireEvent.click(within(filter).getByRole('checkbox', { name: 'Select all shown values' }))
  fireEvent.click(within(filter).getByRole('checkbox', { name: 'Last record' }))
  fireEvent.click(within(filter).getByRole('button', { name: 'Done' }))
}

describe('DataTable production pipeline contracts', () => {
  it.each([375, 640])('keeps absent controlled identities during replacing-page select-all at %ipx', width => {
    function Controlled() {
      const [page, setPage] = useState(1)
      const [keys, setKeys] = useState<MobileTableRowKey[]>(['outside'])
      return <>
        <DataTable tableId="production:replacing" columns={columns}
          data={[rows[page - 1]]} keyExtractor={row => row.id}
          mobilePresentation={presentation} selectable="multi"
          selectedKeys={keys} onSelectionChange={setKeys}
          paginationControls={{ page, pageSize: 1, total: 2, onPageChange: setPage }} />
        <output aria-label="Controlled keys">{JSON.stringify(keys)}</output>
      </>
    }
    render(<Controlled />)
    selectMode(width)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }))
    expect(screen.getByLabelText('Controlled keys')).toHaveTextContent('["outside",0]')
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByLabelText('Controlled keys')).toHaveTextContent('["outside",0]')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }))
    expect(screen.getByLabelText('Controlled keys')).toHaveTextContent('["outside",0,"0"]')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Deselect all rows' }))
    expect(screen.getByLabelText('Controlled keys')).toHaveTextContent('["outside",0]')
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }))
    expect(screen.getByRole('checkbox', { name: 'Deselect Numeric zero' })).toBeChecked()
    expect(screen.queryByRole('button', { name: /Load .* more/ })).toBeNull()
  })

  it.each([375, 640])('adds/removes search matches without discarding hidden controlled selection at %ipx', async width => {
    function Controlled() {
      const [keys, setKeys] = useState<MobileTableRowKey[]>([0, 'outside'])
      return <>
        <DataTable tableId="production:search-selection" columns={columns} data={rows}
          keyExtractor={row => row.id} mobilePresentation={presentation}
          selectable="multi" selectedKeys={keys} onSelectionChange={setKeys} />
        <output aria-label="Controlled keys">{JSON.stringify(keys)}</output>
      </>
    }
    render(<Controlled />)
    selectMode(width)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search loaded rows' }),
      { target: { value: 'String zero' } })
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'Deselect Numeric zero' })).toBeNull())
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }))
    expect(screen.getByLabelText('Controlled keys')).toHaveTextContent('[0,"outside","0"]')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Deselect all rows' }))
    expect(screen.getByLabelText('Controlled keys')).toHaveTextContent('[0,"outside"]')
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.getByLabelText('Controlled keys')).toHaveTextContent('[]')
  })

  it('preserves desktop page, selection and stored preferences through allocated 639/640/641 changes', () => {
    localStorage.setItem('teslasync.table.production:records.columns',
      JSON.stringify({ order: ['amount', 'name', 'secret'], hidden: ['secret'] }))
    localStorage.setItem('teslasync.table.production:records.widths', JSON.stringify({ amount: 144 }))
    localStorage.setItem('teslasync.table.production:records.page-size', '1')
    const baselineStorage = { ...localStorage }
    const view = mount({ pagination: { defaultPageSize: 1, pageSizeOptions: [1, 2] },
      selectable: 'multi', selectedKeys: [0], onSelectionChange: vi.fn(), rowLabel: row => row.name })
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(within(screen.getByRole('table')).getByText('String zero')).toBeInTheDocument()
    resize(639)
    expect(view.container.querySelector('table')).toBeNull()
    expect(view.container.querySelectorAll('[data-card]')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Numeric zero' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load 1 more' }))
    expect(view.container.querySelectorAll('[data-card]')).toHaveLength(2)
    resize(640)
    expect(view.container.querySelector('[data-mobile-table]')).toBeNull()
    expect(within(screen.getByRole('table')).getByText('String zero')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    resize(641)
    expect(within(screen.getByRole('table')).getByText('Last record')).toBeInTheDocument()
    expect(view.container.querySelector('[data-column-key="amount"]')).toHaveStyle({ width: '144px' })
    resize(639)
    fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    expect(screen.getByRole('checkbox', { name: 'Deselect Numeric zero' })).toBeChecked()
    resize(640)
    expect(within(screen.getByRole('table')).getByText('Last record')).toBeInTheDocument()
    expect({ ...localStorage }).toEqual(baselineStorage)
  })

  it('uses the allocated container rather than viewport width and observes opt-in removal', () => {
    vi.stubGlobal('innerWidth', 1920)
    const view = mount()
    const frame = view.container.querySelector('[data-grid-frame]') as HTMLElement
    expect(observers.has(frame)).toBe(true)
    resize(375)
    expect(view.container.querySelector('table')).toBeNull()
    vi.stubGlobal('innerWidth', 320)
    resize(640)
    expect(view.container.querySelector('table')).not.toBeNull()
    expect(observers.has(frame)).toBe(true)
    view.rerender(<DataTable columns={columns} data={rows} keyExtractor={row => row.id}
      tableId="production:records" />)
    resize(320)
    expect(view.container.querySelector('[data-mobile-table]')).toBeNull()
    expect(view.container.querySelector('table')).not.toBeNull()
    expect(observers.has(frame)).toBe(false)
    // The existing virtualizer still observes the desktop scroll viewport.
    expect([...observers.keys()]).toEqual([view.container.querySelector('[data-grid-viewport]')])
    view.unmount()
    expect(observers.size).toBe(0)
  })

  it.each([375, 640])('exports selected loaded rows versus all matching loaded rows, never a page, at %ipx', async width => {
    const source = [rows[2], rows[1], rows[0]]
    const selection = vi.fn()
    mount({ data: source, enableValueFilters: true, exportable: true, exportFilename: 'scope',
      pagination: { defaultPageSize: 1, pageSizeOptions: [1] },
      selectable: 'multi', selectedKeys: [0, '0', 'outside'], onSelectionChange: selection })
    resize(width)
    onlyLastValue()
    expect(selection).not.toHaveBeenCalled()
    await exportAs('JSON', 'Visible (1)')
    expect(downloadJSON).toHaveBeenLastCalledWith('scope', [{ name: 'Last record', amount: 1500 }])
    await exportAs('JSON', 'Selected (2)')
    expect(downloadJSON).toHaveBeenLastCalledWith('scope', [
      { name: 'String zero', amount: null }, { name: 'Numeric zero', amount: 0 },
    ])
    await exportAs('CSV', 'Selected (2)')
    expect(downloadCSV).toHaveBeenCalledTimes(1)
    const csv = vi.mocked(downloadCSV).mock.calls[0][1]
    expect(csv).toContain('String zero')
    expect(csv).toContain('Numeric zero')
    expect(csv).not.toContain('Last record')
    expect(csv).not.toContain('outside')
    expect(csv).not.toContain('private')
  })

  it.each([375, 640])('passes original matching and selected loaded rows to a custom exporter at %ipx', async width => {
    const onExport = vi.fn<NonNullable<Parameters<typeof DataTable<Row>>[0]['onExport']>>(async () => {})
    mount({ enableValueFilters: true, exportable: true, onExport,
      pagination: { defaultPageSize: 1, pageSizeOptions: [1] },
      selectable: 'multi', selectedKeys: [0, 'outside'], onSelectionChange: vi.fn() })
    resize(width)
    onlyLastValue()
    await exportAs('JSON', 'Visible (1)')
    expect(onExport).toHaveBeenLastCalledWith('json', [rows[2]], 'visible')
    await exportAs('CSV', 'Selected (1)')
    expect(onExport).toHaveBeenLastCalledWith('csv', [rows[0]], 'selected')
    expect(onExport.mock.calls[0][1][0]).toBe(rows[2])
    expect(downloadJSON).not.toHaveBeenCalled()
    expect(downloadCSV).not.toHaveBeenCalled()
  })

  it('passes every local search match to a custom exporter rather than only the current page', async () => {
    const onExport = vi.fn<NonNullable<Parameters<typeof DataTable<Row>>[0]['onExport']>>(async () => {})
    mount({ data: [rows[2], rows[0], rows[1]], onExport, exportable: true,
      pagination: { defaultPageSize: 1, pageSizeOptions: [1] } })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search loaded rows' }),
      { target: { value: 'zero' } })
    await waitFor(() => expect(screen.queryByText('Last record')).toBeNull())
    await exportAs('JSON')
    expect(onExport).toHaveBeenCalledWith('json', [rows[0], rows[1]], 'visible')
    expect(downloadJSON).not.toHaveBeenCalled()
  })

  it('passes full-result rows to a custom exporter without local filtering or projection', async () => {
    const serverRows = [{ ...rows[2], id: 99, name: 'Server-only record' }]
    const full = vi.fn(async () => serverRows)
    const onExport = vi.fn<NonNullable<Parameters<typeof DataTable<Row>>[0]['onExport']>>(async () => {})
    mount({ exportAll: full, onExport })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search loaded rows' }),
      { target: { value: 'no loaded matches' } })
    await waitFor(() => expect(screen.queryByText('Last record')).toBeNull())
    await exportAs('JSON')
    expect(full).toHaveBeenCalledOnce()
    expect(onExport).toHaveBeenCalledWith('json', serverRows, 'visible')
    expect(downloadJSON).not.toHaveBeenCalled()
  })

  it('surfaces custom-export rejection without falling back to a projected download', async () => {
    const error = new Error('Raw export unavailable')
    const onExport = vi.fn().mockRejectedValue(error)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      mount({ exportable: true, onExport })
      await exportAs('CSV')
      expect(onExport).toHaveBeenCalledOnce()
      expect(log).toHaveBeenCalledWith('[ListExportMenu] CSV export failed', error)
      expect(downloadJSON).not.toHaveBeenCalled()
      expect(downloadCSV).not.toHaveBeenCalled()
    } finally {
      log.mockRestore()
    }
  })

  it('keeps caller-owned export controls ahead of the scoped exporter', async () => {
    const onExport = vi.fn()
    const onExportJson = vi.fn()
    mount({ onExport, controls: { exports: { onExportJson, onExportCsv: vi.fn() } } })
    await exportAs('JSON')
    expect(onExportJson).toHaveBeenCalledWith('visible')
    expect(onExport).not.toHaveBeenCalled()
    expect(downloadJSON).not.toHaveBeenCalled()
  })

  it('selects the entire filtered loaded set, not the revealed batch, and resolves bulk rows from the source', () => {
    const data = [rows[2], rows[1], rows[0]]
    function Controlled() {
      const [keys, setKeys] = useState<MobileTableRowKey[]>(['outside'])
      return <>
        <DataTable tableId="production:loaded-selection" columns={columns} data={data}
          keyExtractor={row => row.id} mobilePresentation={presentation} selectable="multi"
          selectedKeys={keys} onSelectionChange={setKeys} enableValueFilters
          pagination={{ defaultPageSize: 1, pageSizeOptions: [1] }}
          bulkActions={selected => <output aria-label="Resolved rows">{JSON.stringify(selected.map(row => row.id))}</output>} />
        <output aria-label="Controlled keys">{JSON.stringify(keys)}</output>
      </>
    }
    const view = render(<Controlled />)
    selectMode(375)
    expect(view.container.querySelectorAll('[data-card]')).toHaveLength(1)
    onlyLastValue()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }))
    expect(screen.getByLabelText('Controlled keys')).toHaveTextContent('["outside",2]')
    expect(screen.getByLabelText('Resolved rows')).toHaveTextContent('[2]')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Deselect all rows' }))
    expect(screen.getByLabelText('Controlled keys')).toHaveTextContent('["outside"]')
    fireEvent.click(screen.getByRole('button', { name: 'Name filter' }))
    const filter = screen.getByRole('dialog', { name: 'Name filter' })
    fireEvent.click(within(filter).getByRole('checkbox', { name: 'Select all shown values' }))
    fireEvent.click(within(filter).getByRole('button', { name: 'Done' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }))
    expect(screen.getByLabelText('Controlled keys')).toHaveTextContent('[2,"0",0]')
    expect(screen.getByLabelText('Resolved rows')).toHaveTextContent('[2,"0",0]')
    expect(view.container.querySelectorAll('[data-card]')).toHaveLength(1)
  })

  it('keeps full-result export available at zero local matches without filtering server rows', async () => {
    const serverRows = [{ ...rows[2], id: 99, name: 'Server-only record' }]
    const full = vi.fn(async () => serverRows)
    const view = mount({ enableValueFilters: true, exportAll: full, exportFilename: 'full-result' })
    resize(375)
    fireEvent.click(screen.getByRole('button', { name: 'Name filter' }))
    const filter = screen.getByRole('dialog', { name: 'Name filter' })
    fireEvent.click(within(filter).getByRole('checkbox', { name: 'Select all shown values' }))
    fireEvent.click(within(filter).getByRole('button', { name: 'Done' }))
    expect(view.container.querySelectorAll('[data-card]')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Export list' })).toBeEnabled()
    await exportAs('JSON')
    expect(full).toHaveBeenCalledTimes(1)
    expect(downloadJSON).toHaveBeenLastCalledWith('full-result', [{ name: 'Server-only record', amount: 1500 }])
    expect(serverRows).toEqual([{ ...rows[2], id: 99, name: 'Server-only record' }])
  })

  it('does not fake a download when the real full-result callback rejects', async () => {
    const error = new Error('Server export unavailable')
    const full = vi.fn().mockRejectedValue(error)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      mount({ exportAll: full })
      resize(375)
      await exportAs('JSON')
      expect(full).toHaveBeenCalledTimes(1)
      expect(downloadJSON).not.toHaveBeenCalled()
      expect(downloadCSV).not.toHaveBeenCalled()
      expect(log).toHaveBeenCalledWith('[ListExportMenu] JSON export failed', error)
    } finally {
      log.mockRestore()
    }
  })

  it.each(['cards', 'keyValue'] as const)('retains long/hidden-layout details, missing readings and recorded zero (%s)', async variant => {
    const longName = 'Long localized vehicle name '.repeat(12)
    const metadata = ['first', 'second', 'third', 'fourth'].map(key => ({
      key, header: `Metadata ${key}`, render: () => `${key} source`,
    }))
    const detailColumns: Column<Row>[] = [...columns, ...metadata,
      { key: 'unavailable', header: 'Unavailable source', render: () => undefined },
      { key: 'hiddenLayout', header: 'Hidden layout evidence', defaultVisible: false, render: () => 'Retained layout evidence' }]
    const display: MobileDataTablePresentation<Row> = {
      ...presentation, variant,
      roles: { ...presentation.roles, ...Object.fromEntries(metadata.map(column => [column.key, 'meta' as const])) },
      displayValue: (row, key) => metadata.some(column => column.key === key)
        ? `${key} source` : presentation.displayValue(row, key),
      allDetails: () => [
        { key: 'recordedZero', label: 'Recorded extra zero', value: 0 },
        { key: 'missingExtra', label: 'Missing extra reading', value: null },
        { key: 'secret', label: 'Masked extra evidence', value: 'Never disclose' },
      ],
    }
    const source = [{ ...rows[0], name: longName }, rows[1]]
    const mapping = buildMobileTableRow(source[0], 0, detailColumns, display, 'Records')
    expect(mapping.meta).toHaveLength(3)
    expect(mapping.details.map(field => field.key)).toContain('fourth')
    expect(mapping.primary).toBe('0')
    const view = mount({ columns: detailColumns, data: source, mobilePresentation: display })
    resize(375)
    const title = view.container.querySelector('[data-card-label]')
    expect(title).toHaveTextContent(longName.trim())
    expect(title).toHaveAttribute('title', longName)
    const trigger = screen.getAllByRole('button', { name: 'Quick view' })[0]
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('fourth source')).toBeInTheDocument()
    expect(within(dialog).getByText('Retained layout evidence')).toBeInTheDocument()
    expect(within(dialog).getAllByText('0')).toHaveLength(2)
    expect(within(dialog).getAllByText('—')).toHaveLength(2)
    expect(within(dialog).queryByText('Secret')).toBeNull()
    expect(within(dialog).queryByText('Never disclose')).toBeNull()
    const footer = dialog.querySelector('[data-modal-footer]') as HTMLElement
    fireEvent.click(within(footer).getByRole('button', { name: 'Close', exact: true }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(trigger).toHaveFocus())
    fireEvent.click(screen.getAllByRole('button', { name: 'Quick view' })[1])
    expect(within(screen.getByRole('dialog')).getAllByText('—')).toHaveLength(3)
  })

  it('keeps single-selection native keys and open-row callbacks independent of sibling actions', () => {
    const open = vi.fn()
    const action = vi.fn()
    function Controlled() {
      const [keys, setKeys] = useState<MobileTableRowKey[]>([])
      return <>
        <DataTable tableId="production:single" columns={columns} data={rows} keyExtractor={row => row.id}
          selectable="single" selectedKeys={keys} onSelectionChange={setKeys}
          mobilePresentation={{ ...presentation, onOpenRow: open,
            inlineActions: row => <Button onClick={() => action(row)}>Inspect source</Button> }} />
        <output aria-label="Controlled keys">{JSON.stringify(keys)}</output>
      </>
    }
    render(<Controlled />)
    selectMode(375)
    expect(screen.queryByRole('checkbox', { name: 'Select all rows' })).toBeNull()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Numeric zero' }), { key: ' ' })
    expect(screen.getByLabelText('Controlled keys')).toHaveTextContent('[0]')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select String zero' }))
    expect(screen.getByLabelText('Controlled keys')).toHaveTextContent('["0"]')
    fireEvent.click(screen.getAllByRole('button', { name: 'Inspect source' })[0])
    expect(action).toHaveBeenCalledWith(rows[0])
    expect(open).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Controlled keys')).toHaveTextContent('["0"]')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(screen.getByRole('button', { name: 'Numeric zero' }), { key: 'Enter' })
    expect(open).toHaveBeenCalledWith(rows[0])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it.each([375, 640])('uses source order for additive shift-selection across client batches at %ipx', width => {
    function Controlled() {
      const [keys, setKeys] = useState<MobileTableRowKey[]>(['outside'])
      return <>
        <DataTable tableId="production:shift" columns={columns} data={[rows[2], rows[1], rows[0]]}
          keyExtractor={row => row.id} mobilePresentation={presentation} selectable="multi"
          selectedKeys={keys} onSelectionChange={setKeys}
          pagination={{ defaultPageSize: 1, pageSizeOptions: [1] }} />
        <output aria-label="Controlled keys">{JSON.stringify(keys)}</output>
      </>
    }
    render(<Controlled />)
    selectMode(width)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Last record' }))
    if (width < 640) {
      fireEvent.click(screen.getByRole('button', { name: 'Load 1 more' }))
      fireEvent.click(screen.getByRole('button', { name: 'Load 1 more' }))
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
      fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    }
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Numeric zero' }), { shiftKey: true })
    expect(screen.getByLabelText('Controlled keys')).toHaveTextContent('["outside",2,"0",0]')
  })

  it('does not locally sort mobile rows and resets cumulative reveal only after the caller supplies new order', () => {
    const sort = vi.fn()
    const view = mount({ pagination: { defaultPageSize: 1, pageSizeOptions: [1] }, onSort: sort })
    resize(375)
    fireEvent.click(screen.getByRole('button', { name: 'Load 1 more' }))
    expect(view.container.querySelectorAll('[data-card]')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Name', exact: true }))
    expect(sort).toHaveBeenCalledWith('name')
    expect(Array.from(view.container.querySelectorAll('[data-card-label]')).map(node => node.textContent))
      .toEqual(['Numeric zero', 'String zero'])
    view.rerender(<DataTable tableId="production:records" caption="Production records"
      columns={columns} data={[...rows].reverse()} keyExtractor={row => row.id}
      mobilePresentation={presentation} onSort={sort} sortKey="name" sortDir="desc"
      pagination={{ defaultPageSize: 1, pageSizeOptions: [1] }} />)
    expect(view.container.querySelectorAll('[data-card]')).toHaveLength(1)
    expect(view.container.querySelector('[data-card-label]')).toHaveTextContent('Last record')
    expect(sort).toHaveBeenCalledTimes(1)
    expect(rows.map(row => row.id)).toEqual([0, '0', 2])
  })

  it('invokes the actual no-match clear callback without clearing controlled identities', () => {
    const clear = vi.fn()
    const selection = vi.fn()
    const view = mount({ selectedKeys: [0, '0'], selectable: 'multi', onSelectionChange: selection,
      mobilePresentation: { ...presentation, state: { kind: 'noMatch', query: 'caller query' }, onClear: clear } })
    resize(375)
    expect(view.container.querySelectorAll('[data-card]')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Clear', exact: true }))
    expect(clear).toHaveBeenCalledTimes(1)
    expect(selection).not.toHaveBeenCalled()
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toHaveTextContent('2 selected')
  })
})
