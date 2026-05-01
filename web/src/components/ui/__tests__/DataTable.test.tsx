import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import '@/i18n'
import { DataTable, type Column } from '../DataTable'

interface Row {
  id: number
  name: string
  status: 'ok' | 'fail'
  detail: string
}

const ROWS: Row[] = [
  { id: 1, name: 'Alpha',   status: 'ok',   detail: 'first row detail' },
  { id: 2, name: 'Bravo',   status: 'fail', detail: 'second row detail' },
  { id: 3, name: 'Charlie', status: 'ok',   detail: 'third row detail' },
]

const COLS: Column<Row>[] = [
  { key: 'id', header: 'ID', render: r => <span>{r.id}</span> },
  { key: 'name', header: 'Name', render: r => <span>{r.name}</span> },
  { key: 'status', header: 'Status', render: r => <span>{r.status}</span> },
  { key: 'detail', header: 'Detail', render: r => <span>{r.detail}</span>, defaultVisible: false },
]

beforeEach(() => {
  window.localStorage.clear()
})

describe('DataTable — baseline behavior (no opt-in features)', () => {
  it('renders all visible columns and rows', () => {
    render(<DataTable columns={COLS.slice(0, 3)} data={ROWS} keyExtractor={r => r.id} />)
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Bravo')).toBeInTheDocument()
    expect(screen.getByText('Charlie')).toBeInTheDocument()
    // Header is present
    expect(screen.getByText('Name')).toBeInTheDocument()
  })

  it('renders empty message when data is empty', () => {
    render(<DataTable columns={COLS.slice(0, 3)} data={[]} keyExtractor={r => r.id} emptyMessage="Nothing here" />)
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
  })

  it('calls onSort when a sortable header is clicked', () => {
    const onSort = vi.fn()
    const cols: Column<Row>[] = [
      { key: 'name', header: 'Name', render: r => <span>{r.name}</span>, sortable: true },
    ]
    render(<DataTable columns={cols} data={ROWS} keyExtractor={r => r.id} onSort={onSort} />)
    fireEvent.click(screen.getByRole('button', { name: /name/i }))
    expect(onSort).toHaveBeenCalledWith('name')
  })
})

describe('DataTable — column visibility (defaultVisible + persistence)', () => {
  it('hides columns whose defaultVisible is false', () => {
    render(<DataTable columns={COLS} data={ROWS} keyExtractor={r => r.id} />)
    expect(screen.queryByText('Detail')).not.toBeInTheDocument()
    expect(screen.queryByText('first row detail')).not.toBeInTheDocument()
  })

  it('renders the Columns picker when showColumnsMenu + tableId set, and toggles visibility', () => {
    render(
      <DataTable
        columns={COLS}
        data={ROWS}
        keyExtractor={r => r.id}
        tableId="test-1"
        showColumnsMenu
      />,
    )
    // Open the menu
    fireEvent.click(screen.getByRole('button', { name: /show or hide columns/i }))
    // Toggle the hidden 'Detail' column on
    const detailCheckbox = screen.getByRole('checkbox', { name: /detail/i })
    expect(detailCheckbox).not.toBeChecked()
    fireEvent.click(detailCheckbox)
    // Detail header now appears in the table (use columnheader role to disambiguate from menu label)
    expect(screen.getByRole('columnheader', { name: 'Detail' })).toBeInTheDocument()
    expect(screen.getByText('first row detail')).toBeInTheDocument()
    // localStorage was updated with the visible-keys list
    const stored = JSON.parse(window.localStorage.getItem('teslasync.table.test-1.visible')!)
    expect(stored).toContain('detail')
  })

  it('reads visible keys from localStorage on mount', () => {
    window.localStorage.setItem(
      'teslasync.table.test-2.visible',
      JSON.stringify(['id', 'detail']),
    )
    render(
      <DataTable
        columns={COLS}
        data={ROWS}
        keyExtractor={r => r.id}
        tableId="test-2"
      />,
    )
    expect(screen.getByText('first row detail')).toBeInTheDocument()
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
  })
})

describe('DataTable — selection (multi)', () => {
  it('renders a leading checkbox column when selectable=multi', () => {
    render(
      <DataTable
        columns={COLS.slice(0, 3)}
        data={ROWS}
        keyExtractor={r => r.id}
        selectable="multi"
        selectedKeys={[]}
        onSelectionChange={() => {}}
      />,
    )
    // Header checkbox + 1 per row.
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(1 + ROWS.length)
  })

  it('toggles a single row on click', () => {
    const onChange = vi.fn()
    render(
      <DataTable
        columns={COLS.slice(0, 3)}
        data={ROWS}
        keyExtractor={r => r.id}
        selectable="multi"
        selectedKeys={[]}
        onSelectionChange={onChange}
      />,
    )
    const checkboxes = screen.getAllByRole('checkbox')
    // checkboxes[0] is header; click first row checkbox.
    fireEvent.click(checkboxes[1])
    expect(onChange).toHaveBeenCalledWith([1])
  })

  it('select-all header checkbox selects every row', () => {
    const onChange = vi.fn()
    render(
      <DataTable
        columns={COLS.slice(0, 3)}
        data={ROWS}
        keyExtractor={r => r.id}
        selectable="multi"
        selectedKeys={[]}
        onSelectionChange={onChange}
      />,
    )
    const headerCheckbox = screen.getByRole('checkbox', { name: /select all rows/i })
    fireEvent.click(headerCheckbox)
    expect(onChange).toHaveBeenCalledWith([1, 2, 3])
  })

  it('shift-click extends a range from the last clicked row', () => {
    let selectedKeys: (string | number)[] = []
    const onChange = vi.fn((keys: (string | number)[]) => { selectedKeys = keys })
    const { rerender } = render(
      <DataTable
        columns={COLS.slice(0, 3)}
        data={ROWS}
        keyExtractor={r => r.id}
        selectable="multi"
        selectedKeys={selectedKeys}
        onSelectionChange={onChange}
      />,
    )
    const cbs = screen.getAllByRole('checkbox')
    fireEvent.click(cbs[1]) // row id=1
    // Re-render with new selection so component sees state.
    rerender(
      <DataTable
        columns={COLS.slice(0, 3)}
        data={ROWS}
        keyExtractor={r => r.id}
        selectable="multi"
        selectedKeys={selectedKeys}
        onSelectionChange={onChange}
      />,
    )
    const cbs2 = screen.getAllByRole('checkbox')
    fireEvent.click(cbs2[3], { shiftKey: true }) // shift-click row id=3
    expect(onChange).toHaveBeenLastCalledWith([1, 2, 3])
  })

  it('renders the bulk-action bar when at least one row is selected', () => {
    render(
      <DataTable
        columns={COLS.slice(0, 3)}
        data={ROWS}
        keyExtractor={r => r.id}
        selectable="multi"
        selectedKeys={[1, 2]}
        onSelectionChange={() => {}}
        bulkActions={(rows) => <button type="button">Export {rows.length}</button>}
      />,
    )
    expect(screen.getByRole('region', { name: /bulk actions/i })).toBeInTheDocument()
    expect(screen.getByText(/2 selected/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /export 2/i })).toBeInTheDocument()
  })

  it('Clear selection button calls onSelectionChange with empty list', () => {
    const onChange = vi.fn()
    render(
      <DataTable
        columns={COLS.slice(0, 3)}
        data={ROWS}
        keyExtractor={r => r.id}
        selectable="multi"
        selectedKeys={[1]}
        onSelectionChange={onChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /clear selection/i }))
    expect(onChange).toHaveBeenCalledWith([])
  })
})

describe('DataTable — expansion', () => {
  it('renders chevron column and expanded body when row is expanded', () => {
    const onChange = vi.fn()
    render(
      <DataTable
        columns={COLS.slice(0, 3)}
        data={ROWS}
        keyExtractor={r => r.id}
        expandable
        expandedKeys={[2]}
        onExpandedChange={onChange}
        renderExpanded={r => <div data-testid="expanded">payload: {r.detail}</div>}
      />,
    )
    expect(screen.getByTestId('expanded')).toHaveTextContent('payload: second row detail')
  })

  it('clicking the chevron toggles expansion', () => {
    const onChange = vi.fn()
    render(
      <DataTable
        columns={COLS.slice(0, 3)}
        data={ROWS}
        keyExtractor={r => r.id}
        expandable
        expandedKeys={[]}
        onExpandedChange={onChange}
        renderExpanded={r => <span>{r.detail}</span>}
      />,
    )
    const expandButtons = screen.getAllByRole('button', { name: /expand row/i })
    fireEvent.click(expandButtons[0])
    expect(onChange).toHaveBeenCalledWith([1])
  })
})

describe('DataTable — sticky header / max height', () => {
  it('applies the sticky header class when stickyHeader is true', () => {
    const { container } = render(
      <DataTable
        columns={COLS.slice(0, 3)}
        data={ROWS}
        keyExtractor={r => r.id}
        stickyHeader
        maxHeight={400}
      />,
    )
    const thead = container.querySelector('thead')
    const tr = thead?.querySelector('tr')
    expect(tr?.className).toMatch(/sticky/)
    // Wrapper has overflow + maxHeight inline style.
    const wrapper = container.querySelector('div[style*="max-height"]') as HTMLElement | null
    expect(wrapper).not.toBeNull()
    expect(wrapper?.style.maxHeight).toBe('400px')
  })
})

describe('DataTable — column resize persistence', () => {
  it('reads stored widths from localStorage and applies inline width style', () => {
    window.localStorage.setItem(
      'teslasync.table.test-w.widths',
      JSON.stringify({ name: 250 }),
    )
    const { container } = render(
      <DataTable
        columns={COLS.slice(0, 3)}
        data={ROWS}
        keyExtractor={r => r.id}
        tableId="test-w"
        resizable
      />,
    )
    const headers = container.querySelectorAll('th')
    // Find the "Name" header by text and inspect inline style.
    const nameHeader = Array.from(headers).find(h => within(h).queryByText('Name'))
    expect(nameHeader).toBeDefined()
    expect((nameHeader as HTMLElement).style.width).toBe('250px')
  })

  it('renders a resizer separator handle on each column when resizable + tableId', () => {
    const { container } = render(
      <DataTable
        columns={COLS.slice(0, 3)}
        data={ROWS}
        keyExtractor={r => r.id}
        tableId="test-w2"
        resizable
      />,
    )
    const handles = container.querySelectorAll('[role="separator"]')
    expect(handles.length).toBe(3)
  })
})
