import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@/i18n'
import { DataTable, type Column } from '../DataTable'
import type { MobileDataTablePresentation } from '../MobileDataTableAdapter.types'
import { Button } from '../Button'

interface Row {
  id: number
  name: string
  status: string
}

const rows: Row[] = [
  { id: 1, name: 'Alpha', status: 'Ready' },
  { id: 2, name: 'Bravo', status: 'Review' },
  { id: 3, name: 'Charlie', status: 'Ready' },
]
const columns: Column<Row>[] = [
  { key: 'name', header: 'Name', render: row => row.name },
  { key: 'status', header: 'Status', render: row => row.status, filterValue: row => row.status },
]
const presentation: MobileDataTablePresentation<Row> = {
  roles: { name: 'title', status: 'meta' },
  displayValue: (row, key) => key === 'name' ? row.name : row.status,
}
const cleanCopy = 'No replays in this scope. Everything is clean.'
const observers = new Map<Element, ResizeObserverCallback>()

beforeEach(() => {
  localStorage.clear()
  observers.clear()
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: Element) { observers.set(element, this.callback) }
    unobserve(element: Element) { observers.delete(element) }
    disconnect() {
      observers.forEach((callback, element) => {
        if (callback === this.callback) observers.delete(element)
      })
    }
  })
})
afterEach(() => vi.unstubAllGlobals())

function resize(width: number) {
  act(() => observers.forEach((callback, element) => callback(
    [{ target: element, contentRect: { width } } as ResizeObserverEntry],
    {} as ResizeObserver,
  )))
}

function mount(extra: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) {
  return render(<DataTable tableId="filtered-empty:records" columns={columns} data={rows}
    keyExtractor={row => row.id} emptyMessage={cleanCopy} {...extra} />)
}

function search(value: string) {
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search loaded rows' }),
    { target: { value } })
}

function excludeAllValues() {
  fireEvent.click(screen.getByRole('button', { name: 'Status filter' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all shown values' }))
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
}

describe('DataTable filtered empty copy', () => {
  it('shows no-match for populated loaded search and keyboard reset restores rows and actions', async () => {
    const action = vi.fn()
    mount({ toolbarActions: <Button onClick={action}>Inspect source</Button>, searchable: true })
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    search('no loaded record')
    expect(await screen.findByText('No results')).toBeInTheDocument()
    expect(screen.queryByText(cleanCopy)).not.toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Inspect source' }))
    expect(action).toHaveBeenCalledTimes(1)
    const reset = screen.getByRole('button', { name: 'Clear filters' })
    reset.focus()
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Bravo')).toBeInTheDocument()
    expect(screen.getByText('Charlie')).toBeInTheDocument()
    expect(screen.getByRole('searchbox')).toHaveValue('')
    expect(screen.queryByText('No results')).not.toBeInTheDocument()
  })

  it('shows no-match for an empty value selection and reset restores all loaded values', () => {
    mount({ enableValueFilters: true })
    excludeAllValues()
    expect(screen.getByText('No results')).toBeInTheDocument()
    expect(screen.queryByText(cleanCopy)).not.toBeInTheDocument()
    expect(screen.getByText('0 matching / 3 loaded rows')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Status filter' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Bravo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Status filter' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps authoritative zero-row caller copy even with search and candidate rows', async () => {
    mount({ data: [], filterData: rows, enableValueFilters: true })
    search('absent')
    await waitFor(() => expect(screen.getByRole('searchbox')).toHaveValue('absent'))
    expect(screen.getByText(cleanCopy)).toBeInTheDocument()
    expect(screen.queryByText('No results')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
  })

  it('preserves the default genuine empty wording', () => {
    render(<DataTable columns={columns} data={[]} keyExtractor={row => row.id} />)
    expect(screen.getByText('No data')).toBeInTheDocument()
    expect(screen.queryByText('No results')).not.toBeInTheDocument()
  })

  it('preserves caller-owned server search and empty-page copy without inventing local filtering', () => {
    const onSearch = vi.fn()
    const onPageChange = vi.fn()
    const props = { paginationControls: { page: 2, pageSize: 1, total: 10, onPageChange },
      controls: { search: { value: 'absent remotely', onChange: onSearch, ariaLabel: 'Server search' } } }
    const view = mount({ ...props, data: [rows[1]] })
    expect(screen.getByText('Bravo')).toBeInTheDocument()
    expect(screen.queryByRole('searchbox', { name: 'Search loaded rows' })).not.toBeInTheDocument()
    view.rerender(<DataTable columns={columns} data={[]} keyExtractor={row => row.id}
      emptyMessage="No records on this loaded server page" {...props} />)
    expect(screen.getByText('No records on this loaded server page')).toBeInTheDocument()
    expect(screen.queryByText('No results')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('table'), { key: 'PageDown' })
    expect(onPageChange).toHaveBeenCalledWith(3)
    expect(onSearch).not.toHaveBeenCalled()
  })

  it('combines search and value filters before pagination and resets both without changing page size', async () => {
    mount({ enableValueFilters: true, pagination: { defaultPageSize: 1, pageSizeOptions: [1, 2] } })
    fireEvent.keyDown(screen.getByRole('table'), { key: 'PageDown' })
    expect(screen.getByText('Bravo')).toBeInTheDocument()
    search('Alpha')
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Status filter' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ready' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByText('No results')).toBeInTheDocument()
    expect(screen.queryByText(cleanCopy)).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Comfortable' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Rows per page' })).toHaveValue('1')
    fireEvent.change(screen.getByRole('combobox', { name: 'Rows per page' }), { target: { value: '2' } })
    expect(screen.getByText('Bravo')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('Charlie')).toBeInTheDocument()
    expect(screen.queryByText('No results')).not.toBeInTheDocument()
  })

  it('retains hidden selection and full-result export through no-match and restores keyboard row selection', async () => {
    const exportAll = vi.fn(async () => rows)
    const onExport = vi.fn()
    function Controlled() {
      const [keys, setKeys] = useState<(string | number)[]>([1])
      return <DataTable columns={columns} data={rows} keyExtractor={row => row.id}
        emptyMessage={cleanCopy} selectedKeys={keys} onSelectionChange={setKeys}
        selectable="multi" rowLabel={row => row.name} exportAll={exportAll} onExport={onExport} />
    }
    render(<Controlled />)
    search('absent')
    expect(await screen.findByText('No results')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toHaveTextContent('1 selected')
    fireEvent.click(screen.getByRole('button', { name: 'Export list' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Visible' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as CSV' }))
    await waitFor(() => expect(onExport).toHaveBeenCalledWith('csv', rows, 'visible'))
    expect(exportAll).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(await screen.findByRole('checkbox', { name: 'Deselect Alpha' })).toBeChecked()
    fireEvent.keyDown(screen.getByText('Bravo').closest('tr')!, { key: ' ' })
    expect(screen.getByRole('checkbox', { name: 'Deselect Bravo' })).toBeChecked()
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toHaveTextContent('2 selected')
  })

  it('renders filtered no-match before virtual spacers and reset retains virtualization', async () => {
    const view = mount({ virtualized: true, maxHeight: 400 })
    expect(view.container.querySelector('[data-virtual-spacer="bottom"]')).toBeInTheDocument()
    search('absent')
    expect(await screen.findByText('No results')).toBeInTheDocument()
    expect(view.container.querySelector('[data-virtual-spacer]')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(view.container.querySelector('[data-virtual-spacer="bottom"]')).toBeInTheDocument())
    expect(screen.queryByText(cleanCopy)).not.toBeInTheDocument()
  })

  it('shares loaded-filter no-match and reset across mobile and desktop views', async () => {
    const view = mount({ mobilePresentation: presentation, enableValueFilters: true })
    resize(375)
    excludeAllValues()
    expect(screen.getByText('No results')).toBeInTheDocument()
    expect(screen.queryByText(cleanCopy)).not.toBeInTheDocument()
    resize(640)
    expect(within(screen.getByRole('table')).getByText('No results')).toBeInTheDocument()
    resize(375)
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(view.container.querySelectorAll('[data-card]')).toHaveLength(3)
    search('absent')
    expect(await screen.findByText('No results')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(view.container.querySelectorAll('[data-card]')).toHaveLength(3))
  })

  it('preserves caller loading and retained-error mobile states when local filters match nothing', async () => {
    const retry = vi.fn()
    const loading = { ...presentation, state: { kind: 'loading' as const } }
    const view = mount({ mobilePresentation: loading })
    resize(375)
    search('absent')
    await waitFor(() => expect(screen.getByRole('searchbox')).toHaveValue('absent'))
    expect(screen.getByRole('status', { name: 'Loading...' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText('No results')).not.toBeInTheDocument()
    view.rerender(<DataTable columns={columns} data={rows} keyExtractor={row => row.id}
      emptyMessage={cleanCopy} mobilePresentation={{ ...presentation, onRetry: retry,
        state: { kind: 'error', message: 'Refresh failed; retained source rows', retained: true } }} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Refresh failed; retained source rows')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('No results')).not.toBeInTheDocument()
  })
})
