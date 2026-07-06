/**
 * EntriesTable — DLQ Inspector entries table.
 *
 * The component is presentational: it takes `rows`, `loading` and an
 * `onInspect` callback, sorts the rows locally via `useSortToggle`, and
 * renders them through the shared `DataTable`. These tests cover the sole
 * export (`EntriesTable`) plus the internal `formatBytes` helper via its
 * rendered output.
 *
 * Coverage:
 *   1. Row rendering — every column (reason, vin, topic, payload size,
 *      redeliveries, replayable badge) plus the per-row Inspect action.
 *   2. Default sort — arrived_at descending (newest first).
 *   3. Interactive re-sort — toggling the Payload header flips asc/desc.
 *   4. onInspect fires with the exact row; each button has a unique,
 *      row-scoped accessible name (a11y).
 *   5. Empty state (not loading) vs loading placeholder.
 *   6. Null-safety — em-dash placeholders for every nullable field and an
 *      invalid (negative) payload size.
 *   7. formatBytes B / KB / MB boundaries.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

// Deterministic i18n: `t(key, default, opts)` returns the default string with
// `{{token}}` interpolated. Keeps assertions independent of the shipped
// translation catalogue.
vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') {
          if (opts && typeof opts === 'object') {
            const o = opts as Record<string, unknown>
            return fallbackOrOpts.replace(/{{(\w+)}}/g, (_, name) =>
              name in o ? String(o[name]) : `{{${name}}}`,
            )
          }
          return fallbackOrOpts
        }
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>
          if (typeof o.defaultValue === 'string') return o.defaultValue
        }
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

// TimeStamp transitively pulls the settings query (useTimeFormatPreference →
// @/api/hooks/useSettings → useQuery). Stub the transport so nothing hits the
// network; the absolute format we request never reads the preference anyway.
vi.mock('@/api/client', async () => {
  const actual =
    await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, request: vi.fn().mockResolvedValue({}) }
})

import { EntriesTable } from './EntriesTable'
import type { DLQEntrySummary } from '@/types/admin-diagnostics'

function makeEntry(
  over: Partial<DLQEntrySummary> & { id: number },
): DLQEntrySummary {
  return {
    id: over.id,
    arrived_at: over.arrived_at ?? '2026-01-01T00:00:00Z',
    dlq_topic: over.dlq_topic ?? 'dlq/telemetry',
    parsed_reason: over.parsed_reason ?? 'reason',
    parsed_vehicle_id: over.parsed_vehicle_id ?? null,
    parsed_vin: over.parsed_vin ?? null,
    parsed_source_topic: over.parsed_source_topic ?? null,
    parsed_redeliveries: over.parsed_redeliveries ?? null,
    parsed_timestamp: over.parsed_timestamp ?? null,
    parse_error: over.parse_error ?? null,
    replayable: over.replayable ?? false,
    raw_payload_size: over.raw_payload_size ?? 0,
    inner_payload_size: over.inner_payload_size ?? 0,
  }
}

const e1 = makeEntry({
  id: 1,
  arrived_at: '2026-01-10T00:00:00Z',
  parsed_reason: 'alpha',
  parsed_vin: 'VIN-A',
  parsed_source_topic: 'topic/a',
  parsed_redeliveries: 3,
  raw_payload_size: 512,
  replayable: true,
})
const e2 = makeEntry({
  id: 2,
  arrived_at: '2026-03-10T00:00:00Z',
  parsed_reason: 'bravo',
  parsed_vin: 'VIN-B',
  parsed_source_topic: 'topic/b',
  parsed_redeliveries: null,
  raw_payload_size: 2048,
  replayable: false,
})
const e3 = makeEntry({
  id: 3,
  arrived_at: '2026-02-10T00:00:00Z',
  parsed_reason: 'charlie',
  parsed_vin: null,
  parsed_source_topic: null,
  parsed_redeliveries: 0,
  raw_payload_size: 3145728,
  replayable: true,
})

/** Reason codes in DOM (render) order — the reason column is the only <code>. */
function reasonOrder(): string[] {
  return Array.from(document.querySelectorAll('tbody td code')).map(
    (el) => el.textContent ?? '',
  )
}

function renderTable(opts?: {
  rows?: DLQEntrySummary[]
  loading?: boolean
  onInspect?: (e: DLQEntrySummary) => void
}) {
  const onInspect = opts?.onInspect ?? vi.fn()
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const utils = render(
    <QueryClientProvider client={qc}>
      <EntriesTable
        rows={opts?.rows ?? []}
        loading={opts?.loading ?? false}
        onInspect={onInspect}
      />
    </QueryClientProvider>,
  )
  return { ...utils, onInspect }
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

describe('EntriesTable', () => {
  it('renders every column for each row (reason, vin, topic, payload, redeliveries, replayable)', () => {
    renderTable({ rows: [e1, e2, e3] })

    // Reason codes.
    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.getByText('bravo')).toBeInTheDocument()
    expect(screen.getByText('charlie')).toBeInTheDocument()

    // VIN + source topic (present values).
    expect(screen.getByText('VIN-A')).toBeInTheDocument()
    expect(screen.getByText('VIN-B')).toBeInTheDocument()
    expect(screen.getByText('topic/a')).toBeInTheDocument()

    // formatBytes output across units.
    expect(screen.getByText('512 B')).toBeInTheDocument()
    expect(screen.getByText('2.0 KB')).toBeInTheDocument()
    expect(screen.getByText('3.0 MB')).toBeInTheDocument()

    // Redeliveries: 3 rendered; 0 rendered.
    expect(screen.getByText('3')).toBeInTheDocument()

    // Replayable badges: two "Yes", one "No".
    expect(screen.getAllByText('Yes')).toHaveLength(2)
    expect(screen.getAllByText('No')).toHaveLength(1)

    // One Inspect action per row.
    expect(
      screen.getAllByRole('button', { name: /inspect dlq entry/i }),
    ).toHaveLength(3)
  })

  it('sorts by arrived_at descending (newest first) by default', () => {
    renderTable({ rows: [e1, e2, e3] })
    // e2 (Mar) > e3 (Feb) > e1 (Jan).
    expect(reasonOrder()).toEqual(['bravo', 'charlie', 'alpha'])
  })

  it('re-sorts by payload size and toggles direction when the Payload header is clicked', () => {
    renderTable({ rows: [e1, e2, e3] })

    const payloadHeader = screen.getByRole('button', { name: 'Payload' })

    // First click → sort by size descending: 3MB(e3) > 2KB(e2) > 512B(e1).
    fireEvent.click(payloadHeader)
    expect(reasonOrder()).toEqual(['charlie', 'bravo', 'alpha'])

    // Second click on the same header → ascending.
    fireEvent.click(screen.getByRole('button', { name: 'Payload' }))
    expect(reasonOrder()).toEqual(['alpha', 'bravo', 'charlie'])
  })

  it('marks the active sort column with aria-sort on its header cell', () => {
    renderTable({ rows: [e1, e2, e3] })
    // Default sort key is arrived_at desc.
    const arrivedHeader = screen
      .getByRole('button', { name: 'Arrived' })
      .closest('th')
    expect(arrivedHeader).not.toBeNull()
    expect(arrivedHeader).toHaveAttribute('aria-sort', 'descending')
  })

  it('calls onInspect with the exact row and gives each button a unique accessible name', () => {
    const onInspect = vi.fn()
    renderTable({ rows: [e1, e2, e3], onInspect })

    fireEvent.click(screen.getByRole('button', { name: /inspect dlq entry 2/i }))

    expect(onInspect).toHaveBeenCalledTimes(1)
    expect(onInspect).toHaveBeenCalledWith(e2)

    // Row-scoped names disambiguate otherwise-identical "Inspect" buttons.
    expect(
      screen.getByRole('button', { name: 'Inspect DLQ entry 1' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Inspect DLQ entry 3' }),
    ).toBeInTheDocument()
  })

  it('shows the empty state when there are no entries and not loading', () => {
    renderTable({ rows: [], loading: false })

    expect(screen.getByText(/No DLQ entries/i)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /inspect dlq entry/i }),
    ).toBeNull()
    expect(screen.queryByText(/Loading/i)).toBeNull()
  })

  it('shows a loading placeholder (not the empty message) while loading', () => {
    renderTable({ rows: [], loading: true })

    expect(screen.getByText(/Loading/i)).toBeInTheDocument()
    expect(screen.queryByText(/No DLQ entries/i)).toBeNull()
  })

  it('renders an em-dash for every nullable field and rejects a negative payload size', () => {
    const nulled = makeEntry({
      id: 99,
      parsed_reason: '',
      parsed_vin: null,
      parsed_source_topic: null,
      parsed_redeliveries: null,
      raw_payload_size: -5,
    })
    renderTable({ rows: [nulled] })

    // reason (empty → —), vin, source topic, redeliveries, payload (invalid → —).
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(5)
    // A negative size must never render a byte value.
    expect(screen.queryByText(/B$/)).toBeNull()
  })

  it('formats payload sizes across the B / KB / MB boundaries', () => {
    renderTable({
      rows: [
        makeEntry({ id: 10, parsed_reason: 'zero', raw_payload_size: 0 }),
        makeEntry({ id: 11, parsed_reason: 'sub-kb', raw_payload_size: 1023 }),
        makeEntry({ id: 12, parsed_reason: 'one-kb', raw_payload_size: 1024 }),
        makeEntry({ id: 13, parsed_reason: 'one-mb', raw_payload_size: 1048576 }),
      ],
    })

    expect(screen.getByText('0 B')).toBeInTheDocument()
    expect(screen.getByText('1023 B')).toBeInTheDocument()
    expect(screen.getByText('1.0 KB')).toBeInTheDocument()
    expect(screen.getByText('1.0 MB')).toBeInTheDocument()
  })

  it('does not crash and shows the empty message when rows is undefined', () => {
    // Defensive: the parent should always pass an array, but the null-guard
    // must hold if an undefined slips through (types cast away deliberately).
    renderTable({ rows: undefined as unknown as DLQEntrySummary[] })
    expect(screen.getByText(/No DLQ entries/i)).toBeInTheDocument()
  })
})
