/**
 * DataTable — column reorder + visibility (Phase-46 / Prompt 45)
 *
 * Sibling test file (next to DataTable.tsx) for the new
 * `columnReorder` + `columnVisibility` props. The pre-existing,
 * full-coverage suite still lives in
 * `web/src/components/ui/__tests__/DataTable.test.tsx`.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@/i18n'
import { DataTable, type Column } from './DataTable'

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
})

describe('DataTable — columnReorder + columnVisibility (Phase-46 / Prompt 45)', () => {
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
    fireEvent.click(screen.getByRole('button', { name: /show or hide columns/i }))
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
    fireEvent.click(screen.getByRole('button', { name: /show or hide columns/i }))
    fireEvent.click(screen.getByRole('checkbox', { name: /show or hide status/i }))
    const legacy = JSON.parse(window.localStorage.getItem('teslasync.table.reorder-8.visible')!)
    expect(legacy).toEqual(['id', 'name'])
    const layout = JSON.parse(window.localStorage.getItem('teslasync.table.reorder-8.columns')!)
    expect(layout.hidden).toContain('status')
  })
})
