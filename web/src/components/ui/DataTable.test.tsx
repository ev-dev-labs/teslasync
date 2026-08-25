/**
 * DataTable column reorder + visibility tests.
 *
 * Sibling test file (next to DataTable.tsx) for the new
 * `columnReorder` + `columnVisibility` props. The pre-existing,
 * full-coverage suite still lives in
 * `web/src/components/ui/__tests__/DataTable.test.tsx`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@/i18n'
import { DataTable, type Column } from './DataTable'
import { ToastProvider } from '../feedback/Toast'

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
