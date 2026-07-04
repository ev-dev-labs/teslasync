/**
 * TelemetryErrorsPanel contract + regression tests.
 *
 * TelemetryErrorsPanel is the presentational surface behind the "View Errors"
 * button in the Fleet Telemetry Config dev-tool. It is a pure props-in/JSX-out
 * component (no hooks, no network of its own), so these tests drive it directly
 * with props rather than through a QueryClient — the network wiring lives in
 * FleetApiSection and is covered separately.
 *
 * Its single export renders FIVE mutually-exclusive states, in strict
 * precedence order: idle → loading → error → data → empty. The pre-fix code
 * only rendered the data state, so loading / error / empty silently looked like
 * "the button did nothing"; every state below is asserted to be distinct and to
 * NOT leak the others.
 *
 * Coverage:
 *   1. Idle          — before a request, only the title + idle copy render.
 *   2. Loading       — a skeleton (never a table / empty / error) while pending.
 *   3. Error         — the upstream error string, not a masquerading empty state.
 *   4. Precedence    — idle wins even when `loading` is also set.
 *   5. Data          — the DataTable renders the rows through the caller columns.
 *   6. Download (a11y + behaviour) — the export button builds a JSON Blob,
 *      names it after the VIN, and attaches→clicks→detaches→revokes the anchor.
 *   7. Download (no VIN) — filename falls back to `-all.json`.
 *   8. Empty / ok    — a success-toned "0" badge + copy, and NO raw disclosure
 *      even when a raw payload is present (healthy steady state).
 *   9. Empty / not-ok — a warning-toned "?" badge + the raw-response disclosure
 *      so an operator can debug Tesla wire-shape drift.
 *  10. Empty / not-ok, no raw — the disclosure is guarded off when rawData null.
 *  11. Null-safety (NEW hardening) — an undefined `errors` degrades to the empty
 *      state instead of throwing on `.length`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react'
import type { ComponentProps } from 'react'
import type { Column } from '@/components/ui'

// The panel itself does not call useTranslation, but the shared DataTable it
// mounts does. Stub it so the table chrome is deterministic and locale-file
// independent (repo convention — see BackendTool.test.tsx).
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) =>
        typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

import { TelemetryErrorsPanel } from './TelemetryErrorsPanel'
import type { TelemetryError } from './types'

type PanelProps = ComponentProps<typeof TelemetryErrorsPanel>

// ── Fixtures ─────────────────────────────────────────────────────────────────
const VIN = '5YJ3E1EA1KF000001'

const errorRowA: TelemetryError = {
  rowKey: 'k-a',
  timestamp: '2024-01-01T00:00:00.000Z',
  code: 'MISSING_KEY',
  message: 'Vehicle key not paired',
}

const errorRowB: TelemetryError = {
  rowKey: 'k-b',
  timestamp: '2024-01-02T00:00:00.000Z',
  code: 'STREAM_TIMEOUT',
  message: 'Telemetry stream stalled',
}

// Columns mirror the caller's shape (timestamp / code / message) but keep the
// render functions trivial so the assertions target the panel, not formatting.
const columns: Column<TelemetryError>[] = [
  { key: 'timestamp', header: 'Timestamp', render: (r) => <span>{r.timestamp || '—'}</span> },
  { key: 'code', header: 'Code', render: (r) => <span>{r.code || '—'}</span> },
  { key: 'message', header: 'Message', render: (r) => <span>{r.message || '—'}</span> },
]

const IDLE = 'Click View Errors to fetch recent Fleet Telemetry errors.'
const EMPTY = 'No Fleet Telemetry errors reported for this vehicle.'
const RAW_LABEL = 'Show raw Tesla response'
const DOWNLOAD = 'Download Errors'

function baseProps(overrides: Partial<PanelProps> = {}): PanelProps {
  return {
    title: 'Telemetry Errors',
    loading: false,
    error: undefined,
    requested: true,
    ok: true,
    errors: [],
    columns,
    vin: VIN,
    idleMessage: IDLE,
    emptyMessage: EMPTY,
    rawData: undefined,
    rawDisclosureLabel: RAW_LABEL,
    downloadLabel: DOWNLOAD,
    ...overrides,
  }
}

function renderPanel(overrides: Partial<PanelProps> = {}) {
  return render(<TelemetryErrorsPanel {...baseProps(overrides)} />)
}

// jsdom does not implement the object-URL API; stub it so the download handler
// can run, and capture the anchor state at click-time via a prototype spy.
const createObjectURL = vi.fn(() => 'blob:mock-url')
const revokeObjectURL = vi.fn()
let clickedAnchor: { download: string; href: string } | null = null

beforeEach(() => {
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
  clickedAnchor = null
  URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL
  URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clickedAnchor = { download: this.download, href: this.href }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  cleanup()
})

describe('TelemetryErrorsPanel', () => {
  it('renders the idle state with the title and idle copy before a request', () => {
    renderPanel({ requested: false, idleMessage: IDLE })

    expect(screen.getByText('Telemetry Errors')).toBeInTheDocument()
    expect(screen.getByText(IDLE)).toBeInTheDocument()
    // None of the later states leak into idle.
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByText(EMPTY)).toBeNull()
    expect(screen.queryByRole('button', { name: DOWNLOAD })).toBeNull()
  })

  it('renders a loading skeleton (and nothing settled) while the request is pending', () => {
    const { container } = renderPanel({ requested: true, loading: true })

    expect(screen.getByText('Telemetry Errors')).toBeInTheDocument()
    // Skeleton pulses are present…
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(1)
    // …with no table, empty copy, or error text bleeding through.
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByText(EMPTY)).toBeNull()
    expect(screen.queryByText(IDLE)).toBeNull()
  })

  it('renders the upstream error message instead of masquerading as an empty state', () => {
    renderPanel({ error: 'Tesla returned 502', ok: false, rawData: { foo: 1 } })

    expect(screen.getByText('Tesla returned 502')).toBeInTheDocument()
    // The error state must NOT show the "no errors" empty copy or the raw
    // disclosure, even though ok=false + rawData are set.
    expect(screen.queryByText(EMPTY)).toBeNull()
    expect(screen.queryByText(RAW_LABEL)).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('gives idle precedence over loading when both flags are set', () => {
    // `requested=false` short-circuits before the loading branch is reached.
    renderPanel({ requested: false, loading: true })

    expect(screen.getByText(IDLE)).toBeInTheDocument()
    expect(document.querySelector('.animate-pulse')).toBeNull()
  })

  it('renders the DataTable with the caller-supplied rows in the data state', () => {
    renderPanel({ errors: [errorRowA, errorRowB] })

    const table = screen.getByRole('table')
    expect(table).toBeInTheDocument()
    // Both rows are projected through the caller columns.
    expect(within(table).getByText('MISSING_KEY')).toBeInTheDocument()
    expect(within(table).getByText('Telemetry stream stalled')).toBeInTheDocument()
    // The export affordance is present in the data state only.
    expect(screen.getByRole('button', { name: DOWNLOAD })).toBeInTheDocument()
    // The idle/empty copy must be gone.
    expect(screen.queryByText(EMPTY)).toBeNull()
  })

  it('exports the rows as a VIN-named JSON blob and cleans up the object URL on download', async () => {
    renderPanel({ errors: [errorRowA] })

    fireEvent.click(screen.getByRole('button', { name: DOWNLOAD }))

    // A single application/json blob is created and its object URL revoked.
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blobArg = createObjectURL.mock.calls[0][0] as Blob
    expect(blobArg).toBeInstanceOf(Blob)
    expect(blobArg.type).toBe('application/json')
    await expect(blobArg.text()).resolves.toContain('MISSING_KEY')

    // The anchor was clicked with the VIN-scoped filename + the object URL,
    // and the URL was revoked afterwards (no leak).
    expect(clickedAnchor?.download).toBe(`telemetry-errors-${VIN}.json`)
    expect(clickedAnchor?.href).toContain('blob:mock-url')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
    // The transient anchor is detached again after the click.
    expect(document.querySelector('a[download]')).toBeNull()
  })

  it('falls back to an "all" filename when no VIN is selected', () => {
    renderPanel({ errors: [errorRowA], vin: '' })

    fireEvent.click(screen.getByRole('button', { name: DOWNLOAD }))

    expect(clickedAnchor?.download).toBe('telemetry-errors-all.json')
  })

  it('renders a success-toned "0" badge and hides the raw disclosure when ok', () => {
    // Even with a raw payload present, ok=true means "healthy, zero errors" —
    // no debug disclosure should appear.
    renderPanel({ errors: [], ok: true, rawData: { response: { errors: [] } } })

    expect(screen.getByText(EMPTY)).toBeInTheDocument()
    const badge = screen.getByText('0')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('bg-green-100')
    expect(screen.queryByText(RAW_LABEL)).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('renders a warning "?" badge and the raw-response disclosure when the shape is unknown', () => {
    const rawData = { unexpected: 'wire-shape', count: 7 }
    renderPanel({ errors: [], ok: false, rawData })

    // Warning-toned badge signals "we could not parse the response".
    const badge = screen.getByText('?')
    expect(badge.className).toContain('bg-yellow-100')

    // The disclosure exposes the raw Tesla payload for debugging.
    const summary = screen.getByText(RAW_LABEL)
    expect(summary).toBeInTheDocument()
    expect(summary.closest('details')).not.toBeNull()
    expect(screen.getByText(/"unexpected": "wire-shape"/)).toBeInTheDocument()
  })

  it('omits the raw disclosure when the shape is unknown but there is no raw payload', () => {
    renderPanel({ errors: [], ok: false, rawData: null })

    expect(screen.getByText('?')).toBeInTheDocument()
    expect(screen.getByText(EMPTY)).toBeInTheDocument()
    expect(screen.queryByText(RAW_LABEL)).toBeNull()
    expect(document.querySelector('details')).toBeNull()
  })

  it('degrades to the empty state instead of throwing when errors is undefined', () => {
    // Regression guard for the `errors ?? []` hardening: a runtime shape-drift
    // that hands the panel `undefined` must not crash on `.length`.
    expect(() =>
      renderPanel({ errors: undefined as unknown as TelemetryError[], ok: true }),
    ).not.toThrow()

    expect(screen.getByText(EMPTY)).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('0')).toBeInTheDocument()
  })
})
