/**
 * RecentDrivesSection — behaviour, a11y, and regression coverage.
 *
 * The section owns a GlassPanel that either lists a vehicle's recent drives in
 * the shared <DataTable> (Date / Distance / Duration / Battery columns) or, when
 * there is nothing to show, degrades to an <EmptyState> — never a blank panel.
 *
 * These tests render the REAL DataTable + useSortToggle (only `react-i18next`
 * and `@/hooks/useUnits` are stubbed) so the SI→display conversions, the
 * null-safe cell renders, and the sort wiring are all exercised end-to-end.
 * A <MemoryRouter> is supplied because the "View all" affordance is a real
 * react-router <Link>.
 *
 * It also locks in the hardening applied while elevating the file:
 *   - REGRESSION (real bug): the Distance column was flagged `sortable: true`
 *     but the component passed no `onSort` / `sortKey` / `sortDir` and never
 *     pre-sorted the rows, so the header rendered an interactive button that
 *     did nothing. The shared `useSortToggle` is now wired with a null/NaN-safe
 *     SI (`distance_m`) accessor, so clicking the header actually reorders the
 *     rows numerically (not lexicographically by the formatted string).
 *   - an absent `drives` prop resolves to a stable empty array (no crash, empty
 *     state), and null distance / duration coerce to 0 instead of leaking NaN.
 *
 * `@testing-library/user-event` is not installed in this repo, so the click
 * interaction uses `fireEvent` (matching the sibling suites). No network is
 * touched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

import type { Drive } from '@/api/types'

// Mutable distance preference shared with the `useUnits` mock below so a single
// test can flip km→mi at the display boundary.
const unitState = vi.hoisted(() => ({ distance: 'km' as 'km' | 'mi' }))

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: unitState.distance } }),
}))

// Echo the English fallback so assertions read naturally.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { RecentDrivesSection } from './RecentDrivesSection'

function makeDrive(overrides: Partial<Drive> = {}): Drive {
  return {
    id: 1,
    vehicle_id: 1,
    start_ts: '2026-06-15T12:00:00Z',
    end_ts: '2026-06-15T13:00:00Z',
    duration_s: 3600,
    distance_m: 40_000,
    start_address: null,
    end_address: null,
    start_lat: null,
    start_lon: null,
    end_lat: null,
    end_lon: null,
    start_soc_pct: 80,
    end_soc_pct: 70,
    energy_used_wh: null,
    regen_energy_wh: null,
    avg_speed_mps: null,
    max_speed_mps: null,
    avg_power_w: null,
    outside_temp_avg_c: null,
    inside_temp_avg_c: null,
    score: null,
    ended_status: null,
    created_at: '2026-06-15T13:00:00Z',
    updated_at: '2026-06-15T13:00:00Z',
    ...overrides,
  }
}

function renderSection(drives: Drive[] | undefined) {
  return render(
    <MemoryRouter>
      <RecentDrivesSection drives={drives} />
    </MemoryRouter>,
  )
}

/** Data <tr> rows in DOM (render) order. */
function bodyRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll('tbody tr')) as HTMLElement[]
}

/** Text of a given 0-based column cell within a row. Columns: date(0) distance(1) duration(2) battery(3). */
function cellText(row: HTMLElement, col: number): string {
  return row.querySelectorAll('td')[col]?.textContent?.trim() ?? ''
}

/** Numeric distance value per row (parsed from the "<n> km" cell), in render order. */
function distanceValues(): number[] {
  return bodyRows().map((r) => parseFloat(cellText(r, 1)))
}

beforeEach(() => {
  unitState.distance = 'km'
})

describe('RecentDrivesSection — structure & a11y', () => {
  it('renders the panel heading with a decorative, aria-hidden icon', () => {
    renderSection([makeDrive()])

    const heading = screen.getByRole('heading', { level: 3, name: 'Recent Drives' })
    expect(heading).toBeInTheDocument()
    // The lucide glyph is decorative — hidden from assistive tech so it does
    // not pollute the heading's accessible name.
    expect(heading.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('links "View all" to the drives list route', () => {
    renderSection([makeDrive()])

    const link = screen.getByRole('link', { name: 'View all' })
    expect(link).toHaveAttribute('href', '/drives')
    // The trailing chevron is decorative.
    expect(link.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('renders the four data columns as headers', () => {
    renderSection([makeDrive()])

    for (const name of ['Date', 'Distance', 'Duration', 'Battery']) {
      expect(screen.getByRole('columnheader', { name })).toBeInTheDocument()
    }
  })
})

describe('RecentDrivesSection — cell rendering', () => {
  it('renders one body row per drive, each with four cells', () => {
    renderSection([makeDrive({ id: 1 }), makeDrive({ id: 2 })])

    const rows = bodyRows()
    expect(rows).toHaveLength(2)
    expect(rows[0].querySelectorAll('td')).toHaveLength(4)
  })

  it('formats distance from SI metres to the user unit (km) with a suffix', () => {
    renderSection([makeDrive({ distance_m: 40_000 })])
    // 40 000 m ÷ 1000 = 40 km.
    expect(cellText(bodyRows()[0], 1)).toMatch(/^40(\.0+)? km$/)
  })

  it('re-converts distance when the unit preference is miles', () => {
    unitState.distance = 'mi'
    renderSection([makeDrive({ distance_m: 1_609.344 })])
    // 1609.344 m ÷ 1609.344 = 1 mi — proves the unit boundary is live.
    const cell = cellText(bodyRows()[0], 1)
    expect(cell).toMatch(/^1(\.0+)? mi$/)
    expect(cell).not.toContain('km')
  })

  it('formats duration seconds as hours/minutes', () => {
    renderSection([
      makeDrive({ id: 1, duration_s: 3600 }),
      makeDrive({ id: 2, duration_s: 1800 }),
    ])
    // 3600 s → 60 min → "1h 0m"; 1800 s → 30 min → "30m".
    expect(cellText(bodyRows()[0], 2)).toBe('1h 0m')
    expect(cellText(bodyRows()[1], 2)).toBe('30m')
  })

  it('renders the battery SoC transition when both endpoints are present', () => {
    renderSection([makeDrive({ start_soc_pct: 80, end_soc_pct: 70 })])
    expect(cellText(bodyRows()[0], 3)).toBe('80% → 70%')
  })

  it('renders an em-dash for battery when the end SoC is missing', () => {
    renderSection([makeDrive({ start_soc_pct: 80, end_soc_pct: null })])
    expect(cellText(bodyRows()[0], 3)).toBe('—')
  })

  it('renders the drive start date in the date cell', () => {
    renderSection([makeDrive({ start_ts: '2026-06-15T12:00:00Z' })])
    // Assert the year (timezone-stable for a mid-month noon-UTC timestamp).
    expect(cellText(bodyRows()[0], 0)).toContain('2026')
  })
})

describe('RecentDrivesSection — null-safety (the hardening this test guards)', () => {
  it('coerces a null distance / duration to 0 without leaking NaN', () => {
    const { container } = renderSection([
      makeDrive({
        distance_m: null as unknown as number,
        duration_s: null as unknown as number,
      }),
    ])

    const row = bodyRows()[0]
    expect(cellText(row, 1)).toMatch(/^0(\.0+)? km$/)
    expect(cellText(row, 2)).toBe('0m')
    expect(container.textContent).not.toMatch(/NaN/)
  })
})

describe('RecentDrivesSection — empty & undefined states', () => {
  it('shows the empty state (never a blank panel) when there are no drives', () => {
    renderSection([])

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('No drives recorded yet')).toBeInTheDocument()
    // No data table is mounted at all in the empty branch.
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('shows the empty state and does not crash when drives is undefined', () => {
    expect(() => renderSection(undefined)).not.toThrow()

    expect(screen.getByText('No drives recorded yet')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })
})

describe('RecentDrivesSection — sortable distance column (the bug fix)', () => {
  /** distance_m: 40 km, 100 km, 9 km — deliberately unsorted + lexicographically tricky. */
  function mixedDrives(): Drive[] {
    return [
      makeDrive({ id: 1, distance_m: 40_000 }),
      makeDrive({ id: 2, distance_m: 100_000 }),
      makeDrive({ id: 3, distance_m: 9_000 }),
    ]
  }

  it('exposes only the Distance header as an operable sort button', () => {
    renderSection(mixedDrives())

    expect(screen.getByRole('button', { name: 'Distance' })).toBeInTheDocument()
    // The other columns are not sortable, so their headers are plain (no button).
    expect(screen.queryByRole('button', { name: 'Date' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Battery' })).toBeNull()
  })

  it('sorts rows by distance numerically (descending) on the first click', () => {
    renderSection(mixedDrives())

    // Untouched: the API order is preserved (no implicit sort).
    expect(distanceValues()).toEqual([40, 100, 9])

    fireEvent.click(screen.getByRole('button', { name: 'Distance' }))

    // Numeric descending → 100, 40, 9. A lexicographic sort of the formatted
    // strings ("100.00 km" < "40.00 km" < "9.00 km") would give 9, 40, 100 —
    // this ordering proves the accessor sorts on the SI value, not the label.
    expect(distanceValues()).toEqual([100, 40, 9])
    expect(screen.getByRole('columnheader', { name: 'Distance' })).toHaveAttribute(
      'aria-sort',
      'descending',
    )
  })

  it('toggles to ascending when the Distance header is clicked again', () => {
    renderSection(mixedDrives())
    const header = () => screen.getByRole('button', { name: 'Distance' })

    fireEvent.click(header()) // → descending
    fireEvent.click(header()) // → ascending

    expect(distanceValues()).toEqual([9, 40, 100])
    expect(screen.getByRole('columnheader', { name: 'Distance' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    )
  })
})
