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

  it('defaults stickyHeader to true so every DataTable has a sticky thead', () => {
    const { container } = render(
      <DataTable
        columns={COLS.slice(0, 3)}
        data={ROWS}
        keyExtractor={r => r.id}
      />,
    )
    const thead = container.querySelector('thead')
    const tr = thead?.querySelector('tr')
    expect(tr?.className).toMatch(/sticky/)
  })

  it('respects stickyHeader={false} as an explicit opt-out', () => {
    const { container } = render(
      <DataTable
        columns={COLS.slice(0, 3)}
        data={ROWS}
        keyExtractor={r => r.id}
        stickyHeader={false}
      />,
    )
    const thead = container.querySelector('thead')
    const tr = thead?.querySelector('tr')
    expect(tr?.className).not.toMatch(/sticky/)
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

// ─── Virtualization ─────────────────────────────────────────────────────────
//
// jsdom doesn't lay anything out (every element has 0×0 dimensions), so the
// virtualizer can't measure the viewport and decide which rows are visible.
// The tests below verify the integration plumbing (props are wired, spacer
// rows appear, content rows still render, sticky header auto-enables, the
// expandable + virtualized combination is rejected gracefully) rather than
// the per-pixel cull behavior, which only meaningfully runs in a real
// browser.

describe('DataTable — virtualization (Phase-40 / Prompt 37)', () => {
  function buildRows(count: number): Row[] {
    return Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      name: `Row ${i + 1}`,
      status: i % 2 === 0 ? 'ok' : 'fail',
      detail: `detail ${i + 1}`,
    }))
  }

  it('non-virtualized (default) renders every row in the DOM', () => {
    const data = buildRows(50)
    const { container } = render(
      <DataTable columns={COLS.slice(0, 3)} data={data} keyExtractor={r => r.id} />,
    )
    const tbody = container.querySelector('tbody')
    expect(tbody).not.toBeNull()
    const rows = tbody!.querySelectorAll('tr')
    expect(rows.length).toBe(50)
  })

  it('virtualized renders the spacer rows + the visible window', () => {
    const data = buildRows(2000)
    const { container } = render(
      <DataTable
        columns={COLS.slice(0, 3)}
        data={data}
        keyExtractor={r => r.id}
        virtualized
        rowHeight={36}
        maxHeight={400}
      />,
    )
    const tbody = container.querySelector('tbody')
    expect(tbody).not.toBeNull()
    // We do not render all 2000 rows.
    const rows = tbody!.querySelectorAll('tr')
    expect(rows.length).toBeLessThan(2000)
    // The first row should be the top spacer when scrollTop=0 and the
    // dataset is large enough that not every row fits in the viewport.
    // (jsdom always has bottom padding because the viewport is 0 high.)
    const bottomSpacer = tbody!.querySelector('tr[data-virtual-spacer="bottom"]')
    expect(bottomSpacer).not.toBeNull()
  })

  it('virtualized auto-enables sticky header even when stickyHeader is omitted', () => {
    const data = buildRows(100)
    const { container } = render(
      <DataTable
        columns={COLS.slice(0, 3)}
        data={data}
        keyExtractor={r => r.id}
        virtualized
        rowHeight={36}
      />,
    )
    const thead = container.querySelector('thead')
    const tr = thead?.querySelector('tr')
    expect(tr?.className).toMatch(/sticky/)
  })

  it('virtualized defaults maxHeight to 600 when not provided', () => {
    const data = buildRows(100)
    const { container } = render(
      <DataTable
        columns={COLS.slice(0, 3)}
        data={data}
        keyExtractor={r => r.id}
        virtualized
        rowHeight={36}
      />,
    )
    const wrapper = container.querySelector('div[style*="max-height"]') as HTMLElement | null
    expect(wrapper).not.toBeNull()
    expect(wrapper?.style.maxHeight).toBe('600px')
  })

  it('virtualized + expandable falls back to non-virtualized rendering', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const data = buildRows(20)
    const { container } = render(
      <DataTable
        columns={COLS.slice(0, 3)}
        data={data}
        keyExtractor={r => r.id}
        virtualized
        expandable
        expandedKeys={[]}
        onExpandedChange={() => {}}
        renderExpanded={r => <span>{r.detail}</span>}
      />,
    )
    // No virtual spacers should be in the DOM when virtualization is disabled.
    expect(container.querySelector('tr[data-virtual-spacer="top"]')).toBeNull()
    expect(container.querySelector('tr[data-virtual-spacer="bottom"]')).toBeNull()
    // Every data row is rendered (expand chevron column + 3 data cols = 4).
    const tbody = container.querySelector('tbody')
    expect(tbody!.querySelectorAll('tr').length).toBe(20)
    warnSpy.mockRestore()
  })

  it('virtualized still supports sort + select-all (header-level controls)', () => {
    const onSort = vi.fn()
    const onSelectionChange = vi.fn()
    const sortableCols: Column<Row>[] = [
      { key: 'id', header: 'ID', render: r => <span>{r.id}</span>, sortable: true },
      { key: 'name', header: 'Name', render: r => <span>{r.name}</span>, sortable: true },
    ]
    const data = buildRows(500)
    render(
      <DataTable
        columns={sortableCols}
        data={data}
        keyExtractor={r => r.id}
        virtualized
        rowHeight={36}
        maxHeight={400}
        selectable="multi"
        selectedKeys={[]}
        onSelectionChange={onSelectionChange}
        onSort={onSort}
      />,
    )
    // Sort handler still fires on virtualized tables.
    fireEvent.click(screen.getByRole('button', { name: /name/i }))
    expect(onSort).toHaveBeenCalledWith('name')
    // Select-all still emits the full underlying dataset (selection state
    // is keyed on the entire `data` array, not just the rendered window).
    const headerCheckbox = screen.getByRole('checkbox', { name: /select all rows/i })
    fireEvent.click(headerCheckbox)
    const lastCall = onSelectionChange.mock.calls[onSelectionChange.mock.calls.length - 1][0] as number[]
    expect(lastCall.length).toBe(500)
    expect(lastCall).toContain(1)
    expect(lastCall).toContain(500)
  })

  it('virtualized renders empty state instead of spacers when data is empty', () => {
    const { container } = render(
      <DataTable
        columns={COLS.slice(0, 3)}
        data={[]}
        keyExtractor={r => r.id}
        virtualized
        rowHeight={36}
        emptyMessage="No rows"
      />,
    )
    expect(screen.getByText('No rows')).toBeInTheDocument()
    expect(container.querySelector('tr[data-virtual-spacer="top"]')).toBeNull()
    expect(container.querySelector('tr[data-virtual-spacer="bottom"]')).toBeNull()
  })
})

// ─── Density ─────────────────────────────────────────────────────────────────

describe('DataTable — density', () => {
  it('density="compact" applies the tight padding class to body cells', () => {
    const { container } = render(
      <DataTable
        columns={COLS.slice(0, 3)}
        data={ROWS}
        keyExtractor={r => r.id}
        density="compact"
      />,
    )
    const firstBodyCell = container.querySelector('tbody td')
    expect(firstBodyCell).not.toBeNull()
    expect(firstBodyCell?.className).toContain('px-3')
    expect(firstBodyCell?.className).toContain('py-2')
    // Compact must NOT use the density-token utilities — those are only
    // wired in for the implicit 'auto' mode.
    expect(firstBodyCell?.className).not.toContain('px-d-pad-x')
  })

  it('density="spacious" applies the loose padding class to body cells', () => {
    const { container } = render(
      <DataTable
        columns={COLS.slice(0, 3)}
        data={ROWS}
        keyExtractor={r => r.id}
        density="spacious"
      />,
    )
    const firstBodyCell = container.querySelector('tbody td')
    expect(firstBodyCell?.className).toContain('px-5')
    expect(firstBodyCell?.className).toContain('py-4')
  })

  it('density defaults to "auto" (uses density-token utilities) when neither density nor compact is passed', () => {
    const { container } = render(
      <DataTable
        columns={COLS.slice(0, 3)}
        data={ROWS}
        keyExtractor={r => r.id}
      />,
    )
    const firstBodyCell = container.querySelector('tbody td')
    expect(firstBodyCell?.className).toContain('px-d-pad-x')
    expect(firstBodyCell?.className).toContain('py-d-pad-y')
  })

  it('legacy compact={true} prop is respected (back-compat)', () => {
    const { container } = render(
      <DataTable
        columns={COLS.slice(0, 3)}
        data={ROWS}
        keyExtractor={r => r.id}
        compact
      />,
    )
    const firstBodyCell = container.querySelector('tbody td')
    expect(firstBodyCell?.className).toContain('px-3')
    expect(firstBodyCell?.className).toContain('py-2')
  })
})
