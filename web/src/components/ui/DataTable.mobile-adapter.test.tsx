import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DataTable, type Column } from './DataTable'
import { Button } from './Button'
import { buildMobileTableRow } from './MobileDataTableAdapter'
import type { MobileDataTablePresentation } from './MobileDataTableAdapter.types'
import { downloadCSV, downloadJSON } from '@/lib/csvExport'

vi.mock('@/lib/csvExport', async () => ({
  ...await vi.importActual<typeof import('@/lib/csvExport')>('@/lib/csvExport'),
  downloadCSV: vi.fn(), downloadJSON: vi.fn(),
}))

interface Row { id: string | number; name: string; amount: number | null; secret: string }
const rows: Row[] = [
  { id: 0, name: 'Zero', amount: 0, secret: 'private' },
  { id: '0', name: 'String zero', amount: null, secret: 'private' },
  { id: 2, name: 'Last', amount: 123.45, secret: 'private' },
]
const columns: Column<Row>[] = [
  { key: 'name', header: 'Name', render: row => row.name, sortable: true, filterValue: row => row.name },
  { key: 'amount', header: 'Amount', align: 'right', render: row => row.amount ?? '—', exportValue: row => row.amount },
  { key: 'secret', header: 'Secret', render: row => row.secret, defaultVisible: false },
]
const presentation: MobileDataTablePresentation<Row> = {
  roles: { name: 'title', amount: 'primary' },
  displayValue: (row, key) => key === 'name' ? row.name : key === 'amount' ? row.amount : null,
  canShowField: key => key !== 'secret',
}
const observers: { element: Element; callback: ResizeObserverCallback }[] = []
function resize(width: number) {
  act(() => observers.forEach(({ element, callback }) => callback(
    [{ target: element, contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver,
  )))
}
beforeEach(() => {
  localStorage.clear()
  observers.length = 0
  vi.clearAllMocks()
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: Element) { observers.push({ element, callback: this.callback }) }
    unobserve() {}
    disconnect() {}
  })
})
afterEach(() => vi.unstubAllGlobals())

function mount(extra: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) {
  return render(<DataTable tableId="test:mobile" columns={columns} data={rows}
    keyExtractor={row => row.id} mobilePresentation={presentation} {...extra} />)
}

describe('real DataTable mobile bridge', () => {
  it('keeps typed desktop identities and cell/expansion state distinct through reorder, filtering and presentation transitions', async () => {
    const errors = vi.spyOn(console, 'error')
    const warnings = vi.spyOn(console, 'warn')
    try {
      const data = [...rows.slice(0, 2), { ...rows[2], id: '0-expanded', name: 'Suffix' }, rows[2]]
      const StatefulCell = ({ row, kind }: { row: Row; kind: 'cell' | 'expanded' }) => {
        const [mountedKey] = useState(row.id)
        const [count, setCount] = useState(0)
        return <Button aria-label={`${kind} ${row.name}`} onClick={() => setCount(value => value + 1)}>
          {`${typeof mountedKey}:${mountedKey}/${count}`}
        </Button>
      }
      const statefulColumns: Column<Row>[] = [...columns, {
        key: 'cellState', header: 'Cell state', render: row => <StatefulCell row={row} kind="cell" />,
      }]
      const Controlled = ({ data }: { data: Row[] }) => {
        const [keys, setKeys] = useState<(string | number)[]>([])
        const [expanded, setExpanded] = useState<(string | number)[]>([0, '0'])
        return <>
          <DataTable columns={statefulColumns} data={data} keyExtractor={row => row.id}
            tableId="test:typed-react-keys" columnVisibility={false} columnReorder={false}
            mobilePresentation={presentation} rowLabel={row => row.name}
            selectable="multi" selectedKeys={keys} onSelectionChange={setKeys}
            expandable expandedKeys={expanded} onExpandedChange={setExpanded}
            renderExpanded={row => <StatefulCell row={row} kind="expanded" />} />
          <output aria-label="Native selected keys">{JSON.stringify(keys)}</output>
          <output aria-label="Native expanded keys">{JSON.stringify(expanded)}</output>
        </>
      }
      const view = render(<Controlled data={data} />)
      const keyWarnings = () => [...errors.mock.calls, ...warnings.mock.calls].filter(args =>
        args.some(value => typeof value === 'string' && /same key|unique.*key/i.test(value)))
      const assertRows = (names: string[]) => {
        const table = screen.getByRole('table', { name: 'test:typed-react-keys' })
        const recordRows = Array.from(table.querySelectorAll('tbody > tr:not([data-expanded-content])'))
        expect(recordRows).toHaveLength(names.length)
        expect(recordRows.map(row => row.querySelector('[data-column-key="name"]')?.textContent)).toEqual(names)
        for (const name of names) expect(within(table).getAllByText(name)).toHaveLength(1)
        expect(keyWarnings()).toHaveLength(0)
      }
      assertRows(['Zero', 'String zero', 'Suffix', 'Last'])
      expect(view.container.querySelectorAll('[data-expanded-content]')).toHaveLength(2)
      const numericCell = screen.getByRole('button', { name: 'cell Zero' })
      const stringCell = screen.getByRole('button', { name: 'cell String zero' })
      const numericExpanded = screen.getByRole('button', { name: 'expanded Zero' })
      const stringExpanded = screen.getByRole('button', { name: 'expanded String zero' })
      for (const button of [numericCell, stringCell, numericExpanded, stringExpanded]) fireEvent.click(button)
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Zero' }))
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select String zero' }))
      expect(screen.getByLabelText('Native selected keys')).toHaveTextContent('[0,"0"]')
      expect(screen.getByLabelText('Native expanded keys')).toHaveTextContent('[0,"0"]')
      view.rerender(<Controlled data={[...data].reverse()} />)
      assertRows(['Last', 'Suffix', 'String zero', 'Zero'])
      expect(screen.getByRole('button', { name: 'cell Zero' })).toBe(numericCell)
      expect(screen.getByRole('button', { name: 'cell String zero' })).toBe(stringCell)
      expect(numericCell).toHaveTextContent('number:0/1')
      expect(stringCell).toHaveTextContent('string:0/1')
      expect(screen.getByRole('button', { name: 'expanded Zero' })).toBe(numericExpanded)
      expect(screen.getByRole('button', { name: 'expanded String zero' })).toBe(stringExpanded)
      expect(numericExpanded).toHaveTextContent('number:0/1')
      expect(stringExpanded).toHaveTextContent('string:0/1')
      fireEvent.change(screen.getByRole('searchbox', { name: 'Search loaded rows' }), { target: { value: 'String zero' } })
      await waitFor(() => assertRows(['String zero']))
      expect(view.container.querySelectorAll('[data-expanded-content]')).toHaveLength(1)
      expect(screen.getByRole('button', { name: 'cell String zero' })).toBe(stringCell)
      expect(screen.getByRole('button', { name: 'expanded String zero' })).toBe(stringExpanded)
      expect(screen.getByLabelText('Native selected keys')).toHaveTextContent('[0,"0"]')
      expect(screen.getByLabelText('Native expanded keys')).toHaveTextContent('[0,"0"]')
      fireEvent.change(screen.getByRole('searchbox', { name: 'Search loaded rows' }), { target: { value: '' } })
      await waitFor(() => assertRows(['Last', 'Suffix', 'String zero', 'Zero']))
      expect(view.container.querySelectorAll('[data-expanded-content]')).toHaveLength(2)
      expect(screen.getByRole('button', { name: 'cell Zero' })).toHaveTextContent('number:0/0')
      expect(screen.getByRole('button', { name: 'expanded Zero' })).toHaveTextContent('number:0/0')
      expect(stringCell).toHaveTextContent('string:0/1')
      expect(stringExpanded).toHaveTextContent('string:0/1')
      const stringRow = screen.getByText('String zero').closest('tr') as HTMLElement
      fireEvent.click(within(stringRow).getByRole('button', { name: 'Collapse row' }))
      expect(screen.getByLabelText('Native expanded keys')).toHaveTextContent('[0]')
      expect(view.container.querySelectorAll('[data-expanded-content]')).toHaveLength(1)
      expect(screen.getByRole('button', { name: 'expanded Zero' })).toHaveTextContent('number:0/0')
      fireEvent.click(within(stringRow).getByRole('button', { name: 'Expand row' }))
      expect(screen.getByLabelText('Native expanded keys')).toHaveTextContent('[0,"0"]')
      expect(screen.getByRole('button', { name: 'expanded String zero' })).toHaveTextContent('string:0/0')
      resize(375)
      expect(view.container.querySelector('table')).toBeNull()
      expect(view.container.querySelectorAll('[data-mobile-table]')).toHaveLength(1)
      expect(screen.getByLabelText('Native selected keys')).toHaveTextContent('[0,"0"]')
      expect(screen.getByLabelText('Native expanded keys')).toHaveTextContent('[0,"0"]')
      resize(640)
      assertRows(['Last', 'Suffix', 'String zero', 'Zero'])
      expect(view.container.querySelector('[data-mobile-table]')).toBeNull()
      expect(view.container.querySelectorAll('[data-expanded-content]')).toHaveLength(2)
      expect(screen.getByRole('checkbox', { name: 'Deselect Zero' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Deselect String zero' })).toBeChecked()
      expect(screen.getByRole('button', { name: 'cell Zero' })).toHaveTextContent('number:0/0')
      expect(screen.getByRole('button', { name: 'cell String zero' })).toHaveTextContent('string:0/0')
      expect(keyWarnings()).toHaveLength(0)
    } finally {
      errors.mockRestore()
      warnings.mockRestore()
    }
  })

  it('keeps default callers desktop, selects one mounted surface at allocated 639/640/641', () => {
    const view = mount()
    resize(639)
    expect(view.container.querySelector('table')).toBeNull()
    expect(view.container.querySelectorAll('[data-mobile-table]')).toHaveLength(1)
    resize(640)
    expect(view.container.querySelector('table')).not.toBeNull()
    expect(view.container.querySelector('[data-mobile-table]')).toBeNull()
    resize(641)
    expect(view.container.querySelector('table')).not.toBeNull()
    view.unmount()
    const defaultView = render(<DataTable columns={columns} data={rows} keyExtractor={row => row.id} />)
    resize(320)
    expect(defaultView.container.querySelector('table')).not.toBeNull()
  })

  it('preserves numeric/string row keys, zero/null and caller-owned selection across filters', async () => {
    function Controlled() {
      const [keys, setKeys] = useState<(string | number)[]>([])
      return <><DataTable columns={columns} data={rows} keyExtractor={row => row.id}
        mobilePresentation={presentation} selectable="multi" selectedKeys={keys} onSelectionChange={setKeys} />
        <output>{JSON.stringify(keys)}</output></>
    }
    render(<Controlled />)
    resize(375)
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Select Zero' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Zero' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select String zero' }))
    expect(screen.getByText('[0,"0"]')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('[0,"0"]')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search loaded rows' }), { target: { value: 'Last' } })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Zero' })).toBeNull())
    expect(screen.getByText('[0,"0"]')).toBeInTheDocument()
  })

  it('reveals actual processed rows cumulatively and resets on shared search without clearing selection', async () => {
    const view = mount({ pagination: { defaultPageSize: 1, pageSizeOptions: [1, 2] }, selectedKeys: [0] })
    resize(390)
    expect(view.container.querySelectorAll('[data-card]')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Load 1 more' }))
    expect(view.container.querySelectorAll('[data-card]')).toHaveLength(2)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search loaded rows' }), { target: { value: 'Last' } })
    await waitFor(() => expect(view.container.querySelectorAll('[data-card]')).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'Last' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Load .* more/ })).toBeNull()
    expect(localStorage.getItem('teslasync.table.test:mobile.page-size')).toBeNull()
  })

  it('keeps server replacing pages honest and invokes the actual Next handler', () => {
    const next = vi.fn()
    const view = mount({ paginationControls: { page: 1, pageSize: 3, total: 12, onPageChange: next } })
    resize(320)
    expect(screen.queryByRole('button', { name: /Load .* more/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(next).toHaveBeenCalledWith(2)
    expect(view.container.querySelectorAll('[data-card]')).toHaveLength(3)
  })

  it('keeps real column-value filters editable for zero matches and retains selected identities', () => {
    const selection = vi.fn()
    const view = mount({ enableValueFilters: true, selectable: 'multi', selectedKeys: [0],
      onSelectionChange: selection, pagination: { defaultPageSize: 1, pageSizeOptions: [1] } })
    resize(375)
    fireEvent.click(screen.getByRole('button', { name: 'Name filter' }))
    const filter = screen.getByRole('dialog', { name: 'Name filter' })
    fireEvent.click(within(filter).getByRole('checkbox', { name: 'Select all shown values' }))
    expect(view.container.querySelectorAll('[data-card]')).toHaveLength(0)
    expect(selection).not.toHaveBeenCalled()
    fireEvent.click(within(filter).getByRole('checkbox', { name: 'Last' }))
    expect(view.container.querySelectorAll('[data-card]')).toHaveLength(1)
    expect(view.container.querySelector('[data-card-label]')).toHaveTextContent('Last')
    expect(selection).not.toHaveBeenCalled()
  })

  it.each(['cards', 'keyValue'] as const)('retains full details, privacy and sibling inline actions without nested interactivity (%s)', async variant => {
    const action = vi.fn()
    const view = mount({ mobilePresentation: { ...presentation,
      variant,
      inlineActions: () => <Button onClick={action}>Real action</Button>,
      allDetails: () => [{ key: 'native', label: 'Native field', value: 0 }],
    } })
    resize(375)
    const interactiveSelector = 'button, a[href], input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"]'
    const cards = view.container.querySelectorAll('[data-card], [data-kv-row]')
    expect(cards).toHaveLength(rows.length)
    for (const card of cards) {
      expect(card.querySelector(interactiveSelector)).toBeNull()
      expect(card.parentElement?.closest(interactiveSelector)).toBeNull()
    }
    const actionGroups = view.container.querySelectorAll('[data-mobile-row-actions]')
    expect(actionGroups).toHaveLength(rows.length)
    for (const group of actionGroups) {
      const buttons = within(group as HTMLElement).getAllByRole('button')
      expect(buttons).toHaveLength(2)
      for (const button of buttons) {
        expect(button.closest('[data-card], [data-kv-row]')).toBeNull()
        // closest() includes the element itself; only ancestors establish nesting.
        expect(button.parentElement?.closest(interactiveSelector)).toBeNull()
      }
    }
    fireEvent.click(screen.getAllByRole('button', { name: 'Real action' })[0])
    expect(action).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    const trigger = screen.getAllByRole('button', { name: 'Quick view' })[0]
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Native field')).toBeInTheDocument()
    expect(within(dialog).getAllByText('0')).toHaveLength(2)
    expect(within(dialog).queryByText('Secret')).toBeNull()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('opens row details with keyboard, closes stale details when filters remove the row', async () => {
    mount()
    resize(375)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Zero' }), { key: 'Enter' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Zero' }), { key: ' ' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search loaded rows' }), { target: { value: 'Last' } })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('keeps real context/expansion callbacks outside row activation and selection', () => {
    const contextAction = vi.fn()
    const disabledAction = vi.fn()
    const openRow = vi.fn()
    function Controlled() {
      const [keys, setKeys] = useState<(string | number)[]>([])
      const [expanded, setExpanded] = useState<(string | number)[]>([0])
      return <>
        <DataTable columns={columns} data={rows} keyExtractor={row => row.id}
          mobilePresentation={{ ...presentation, onOpenRow: openRow }}
          selectable="multi" selectedKeys={keys} onSelectionChange={setKeys}
          expandable expandedKeys={expanded} onExpandedChange={setExpanded}
          renderExpanded={row => <div>Expanded {row.name}</div>}
          rowContextMenu={row => [
            { id: 'context', label: `Context ${row.name}`, onClick: () => contextAction(row.id) },
            { id: 'disabled', label: `Disabled ${row.name}`, disabled: true, onClick: disabledAction },
          ]} />
        <output aria-label="Native selection">{JSON.stringify(keys)}</output>
      </>
    }
    render(<Controlled />)
    resize(375)
    fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    const context = screen.getByRole('button', { name: 'Context Zero' })
    expect(context.parentElement?.closest('button, [role="button"], a[href]')).toBeNull()
    fireEvent.click(context)
    expect(contextAction).toHaveBeenCalledTimes(1)
    expect(contextAction).toHaveBeenCalledWith(0)
    expect(openRow).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Native selection')).toHaveTextContent('[]')
    const disabled = screen.getByRole('button', { name: 'Disabled Zero' })
    expect(disabled).toBeDisabled()
    fireEvent.click(disabled)
    expect(disabledAction).not.toHaveBeenCalled()
    expect(screen.getByText('Expanded Zero')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse row' }))
    expect(screen.queryByText('Expanded Zero')).toBeNull()
    expect(screen.getByLabelText('Native selection')).toHaveTextContent('[]')
    fireEvent.keyDown(screen.getByRole('button', { name: 'Zero' }), { key: ' ' })
    expect(screen.getByLabelText('Native selection')).toHaveTextContent('[0]')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(screen.getByRole('button', { name: 'Zero' }), { key: 'Enter' })
    expect(openRow).toHaveBeenCalledTimes(1)
    expect(openRow).toHaveBeenCalledWith(rows[0])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not expose selection for unsupported callers and preserves source order/sort requests', () => {
    const onSort = vi.fn()
    const view = mount({ data: [...rows].reverse(), onSort, sortKey: 'name', sortDir: 'desc' })
    resize(375)
    expect(screen.queryByRole('button', { name: 'Select' })).toBeNull()
    expect(Array.from(view.container.querySelectorAll('[data-row-key]')).map(node =>
      node.getAttribute('data-row-key'))).toEqual(['2', '0', '0'])
    fireEvent.click(screen.getByRole('button', { name: 'Name' }))
    expect(onSort).toHaveBeenCalledWith('name')
  })

  it('respects stored column visibility without leaking a hidden title into the card', () => {
    localStorage.setItem('teslasync.table.test:mobile.columns',
      JSON.stringify({ order: ['name', 'amount', 'secret'], hidden: ['name', 'secret'] }))
    const view = mount()
    resize(375)
    expect(screen.queryByRole('button', { name: 'Zero' })).toBeNull()
    expect(view.container.querySelector('[data-card-label]')).toHaveTextContent('test:mobile')
    fireEvent.click(screen.getAllByRole('button', { name: 'Quick view' })[0])
    expect(within(screen.getByRole('dialog')).getByText('Zero')).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).queryByText('private')).toBeNull()
  })

  it('reuses exactly the existing JSON/CSV export handler across surfaces and selected/full-result scopes', async () => {
    const full = vi.fn(async () => rows)
    const view = mount({ selectedKeys: [0], selectable: 'multi', onSelectionChange: vi.fn(), exportable: true,
      exportAll: full, exportFilename: 'same', exportRow: row => ({ name: row.name, amount: row.amount }) })
    async function exportJson() {
      fireEvent.click(screen.getByRole('button', { name: 'Export list' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Download as JSON' }))
      await waitFor(() => expect(downloadJSON).toHaveBeenCalled())
    }
    await exportJson()
    const desktop = vi.mocked(downloadJSON).mock.calls.slice(-1)[0]
    fireEvent.click(screen.getByRole('button', { name: 'Export list' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Visible' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as CSV' }))
    await waitFor(() => expect(downloadCSV).toHaveBeenCalledTimes(1))
    const desktopCsv = vi.mocked(downloadCSV).mock.calls.slice(-1)[0]
    resize(375)
    fireEvent.click(screen.getByRole('button', { name: 'Export list' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Selected (1)' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as JSON' }))
    await waitFor(() => expect(downloadJSON).toHaveBeenCalledTimes(2))
    expect(vi.mocked(downloadJSON).mock.calls.slice(-1)[0]).toEqual(desktop)
    expect(full).toHaveBeenCalledTimes(1)
    expect(desktop?.[1]).toEqual([{ name: 'Zero', amount: 0 }])
    fireEvent.click(screen.getByRole('button', { name: 'Export list' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Visible' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as CSV' }))
    await waitFor(() => expect(downloadCSV).toHaveBeenCalledTimes(2))
    expect(full).toHaveBeenCalledTimes(2)
    expect(vi.mocked(downloadCSV).mock.calls.slice(-1)[0]).toEqual(desktopCsv)
    expect(vi.mocked(downloadCSV).mock.calls.slice(-1)[0]?.[1]).toContain('String zero')
    expect(vi.mocked(downloadCSV).mock.calls.slice(-1)[0]?.[1]).not.toContain('private')
    view.unmount()
  })

  it('exports matching loaded rows through shared filtering, not the currently revealed batch', async () => {
    mount({ pagination: { defaultPageSize: 1, pageSizeOptions: [1] }, exportable: true,
      exportFilename: 'matching', exportRow: row => ({ name: row.name, amount: row.amount }) })
    resize(375)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search loaded rows' }), { target: { value: 'zero' } })
    await waitFor(() => expect(screen.getByText(/2 matching/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Export list' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as JSON' }))
    await waitFor(() => expect(downloadJSON).toHaveBeenCalled())
    expect(vi.mocked(downloadJSON).mock.calls.slice(-1)[0]?.[1]).toEqual([
      { name: 'Zero', amount: 0 }, { name: 'String zero', amount: null },
    ])
  })

  it('reveals 200 real loaded rows without querying or changing table persistence keys', () => {
    const many = Array.from({ length: 200 }, (_, id) => ({ ...rows[0], id, name: `Row ${id}` }))
    const view = mount({ data: many, pagination: { defaultPageSize: 25, pageSizeOptions: [25, 50] } })
    resize(430)
    expect(view.container.querySelectorAll('[data-card]')).toHaveLength(25)
    fireEvent.click(screen.getByRole('button', { name: 'Load 25 more' }))
    expect(view.container.querySelectorAll('[data-card]')).toHaveLength(50)
    fireEvent.change(screen.getByRole('combobox', { name: 'Rows per page' }), { target: { value: '50' } })
    expect(localStorage.getItem('teslasync.table.test:mobile.page-size')).toBe('50')
    expect(view.container.querySelectorAll('[data-card]')).toHaveLength(50)
  })

  it.each([0, 1, 3])('renders %i loaded rows without fake totals', count => {
    const view = mount({ data: rows.slice(0, count), emptyMessage: 'No source rows' })
    resize(375)
    expect(view.container.querySelectorAll('[data-card]')).toHaveLength(count)
    if (count === 0) expect(screen.getByText('No source rows')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Load .* more/ })).toBeNull()
  })

  it('honors retained failures and actual retry callbacks', () => {
    const retry = vi.fn()
    const view = mount({ mobilePresentation: { ...presentation,
      state: { kind: 'error', message: 'Refresh failed', retained: true }, onRetry: retry,
    } })
    resize(375)
    expect(screen.getByRole('alert')).toHaveTextContent('Refresh failed')
    expect(view.container.querySelectorAll('[data-card]')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('uses explicit roles/values and never parses rendered JSX', () => {
    const result = buildMobileTableRow(rows[0], 0, columns, presentation, 'Table')
    expect(result.key).toBe(0)
    expect(result.primary).toBe('0')
    expect(result.details.some(field => field.key === 'secret')).toBe(false)
    expect(buildMobileTableRow(rows[1], '0', columns, presentation, 'Table').key).toBe('0')
    expect(buildMobileTableRow(rows[1], '0', columns, presentation, 'Table').primary).toBe('—')
  })
})
