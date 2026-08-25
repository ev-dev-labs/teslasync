/**
 * DriveAnalyticsSection — speed-bucket mislabel regression + hardening.
 *
 * Pre-fix (this commit):
 *   The Speed Distribution histogram re-ran each bucket boundary
 *   (0/30/60/90/120) through `toSpeedDisplay` before comparing it to a
 *   drive's display speed. Those boundaries are ALREADY display-unit
 *   numbers — they're the exact figures the axis label prints
 *   ("30–60 mph"). Re-converting them meant the bucketing effectively
 *   happened in raw m/s while the labels said mph/km/h, so a real 100 mph
 *   drive (44.704 m/s) landed in the "30–60 mph" bucket instead of
 *   "90–120 mph". Every non-trivial drive was mis-histogrammed.
 *
 * Post-fix:
 *   `spd` (already in display units) is compared directly to `r.min`/
 *   `r.max`. The suite pins the invariant for both mph and km/h.
 *
 * Also covered: null-speed drives are skipped (not coerced into 0–30),
 * every panel shows a "No data available" placeholder instead of a blank
 * axis-only chart, the Power Profile fallback table renders the recent-20
 * window, and the date-range filter commits both bounds atomically.
 *
 * The chart annotation hooks are stubbed (the real ones hit `/annotations`)
 * and i18n falls back to the `defaultValue` argument, matching the
 * ChartContainer.a11y test pattern.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ComponentProps, ReactNode } from 'react'

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, second?: unknown, third?: unknown) => {
        let def = key
        let opts: Record<string, unknown> | undefined
        if (typeof second === 'string') {
          def = second
          if (third && typeof third === 'object') opts = third as Record<string, unknown>
        } else if (second && typeof second === 'object') {
          opts = second as Record<string, unknown>
          if (typeof opts.defaultValue === 'string') def = opts.defaultValue
        }
        let out = def
        if (opts) {
          for (const [k, v] of Object.entries(opts)) {
            if (k === 'defaultValue') continue
            out = out.replace(new RegExp(`{{${k}}}`, 'g'), String(v))
          }
        }
        return out
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

// ChartContainer unconditionally fetches `/annotations` and wires two
// mutations. Stub the hooks so the section renders without a network.
vi.mock('@/api/hooks/useAnnotations', () => ({
  useChartAnnotationsAsData: () => ({ annotations: [], isLoading: false }),
  useCreateAnnotation: () => ({ mutate: vi.fn() }),
  useDeleteAnnotation: () => ({ mutate: vi.fn() }),
}))

import DriveAnalyticsSection from '../DriveAnalyticsSection'
import { convertSpeedFromSI } from '@/lib/unitConversion'
import type { Drive } from '@/types/driving'

let seq = 0
function drive(overrides: Partial<Drive> = {}): Drive {
  seq += 1
  return {
    id: seq,
    vehicleId: 1,
    startTs: '2026-05-10T12:00:00Z',
    endTs: '2026-05-10T13:00:00Z',
    durationS: 3600,
    distanceM: 50_000,
    avgSpeedMps: null,
    maxSpeedMps: null,
    avgPowerW: null,
    ...overrides,
  } as unknown as Drive
}

const toMph = (mps: number) => convertSpeedFromSI(mps, 'mph')
const toKmh = (mps: number) => convertSpeedFromSI(mps, 'km/h')

type Props = ComponentProps<typeof DriveAnalyticsSection>

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    filteredDrives: [],
    startDate: '2026-05-01',
    endDate: '2026-05-31',
    onRangeChange: vi.fn(),
    toDistanceDisplay: (m: number) => m / 1000,
    toSpeedDisplay: toMph,
    distanceUnit: 'mi',
    speedUnit: 'mph',
    ...overrides,
  }
}

function renderSection(overrides: Partial<Props> = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DriveAnalyticsSection {...baseProps(overrides)} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

// Read the count cell for a bucket row inside a chart figure's SR fallback
// table. Scoping by figure (unique title) avoids the sister Power Profile
// table, and the last cell of the row is always the count column.
function bucketCount(figureName: RegExp, rangeLabel: string): string {
  const figure = screen.getByRole('figure', { name: figureName })
  const table = within(figure).getByRole('table')
  const row = within(table).getByText(rangeLabel).closest('tr') as HTMLTableRowElement
  const cells = within(row).getAllByRole('cell')
  return (cells[cells.length - 1].textContent ?? '').trim()
}

describe('DriveAnalyticsSection — speed distribution bucketing', () => {
  it('buckets each drive by its DISPLAY speed, not raw m/s (mph)', () => {
    // 44.704 m/s = 100 mph → "90–120 mph"; 20.1168 m/s = 45 mph → "30–60 mph".
    // Pre-fix both compared in m/s: 100 mph landed in "30–60", 45 mph in "0–30".
    renderSection({
      filteredDrives: [
        drive({ avgSpeedMps: 44.704 }),
        drive({ avgSpeedMps: 20.1168 }),
      ],
      toSpeedDisplay: toMph,
      speedUnit: 'mph',
    })

    expect(bucketCount(/Speed Distribution/, '90–120 mph')).toBe('1')
    expect(bucketCount(/Speed Distribution/, '30–60 mph')).toBe('1')
    // The regression assertions: pre-fix these were 0 and (wrongly) 1.
    expect(bucketCount(/Speed Distribution/, '0–30 mph')).toBe('0')
    expect(bucketCount(/Speed Distribution/, '60–90 mph')).toBe('0')
  })

  it('buckets correctly under a km/h preference too', () => {
    // 27.7778 m/s = 100 km/h → "90–120 km/h". Pre-fix (compared in m/s)
    // it fell into "0–30 km/h".
    renderSection({
      filteredDrives: [drive({ avgSpeedMps: 27.7778 })],
      toSpeedDisplay: toKmh,
      speedUnit: 'km/h',
    })

    expect(bucketCount(/Speed Distribution/, '90–120 km/h')).toBe('1')
    expect(bucketCount(/Speed Distribution/, '0–30 km/h')).toBe('0')
  })

  it('skips drives with a null average speed instead of counting them as 0', () => {
    renderSection({
      filteredDrives: [
        drive({ avgSpeedMps: 44.704 }), // 100 mph → "90–120 mph"
        drive({ avgSpeedMps: null }), // must be ignored entirely
      ],
      toSpeedDisplay: toMph,
      speedUnit: 'mph',
    })

    expect(bucketCount(/Speed Distribution/, '90–120 mph')).toBe('1')
    // A null-speed drive coerced to 0 would show up here — assert it did not.
    expect(bucketCount(/Speed Distribution/, '0–30 mph')).toBe('0')
  })

  it('labels the SR fallback table columns from i18n', () => {
    renderSection({ filteredDrives: [drive({ avgSpeedMps: 44.704 })] })
    const figure = screen.getByRole('figure', { name: /Speed Distribution/ })
    const headers = within(figure)
      .getAllByRole('columnheader')
      .map((h) => h.textContent)
    expect(headers).toEqual(['Speed range', 'Drives'])
  })
})

describe('DriveAnalyticsSection — empty states', () => {
  it('shows a "No data available" placeholder in every panel when there are no drives', () => {
    renderSection({ filteredDrives: [] })

    for (const name of [/Speed Distribution/, /Acceleration Patterns/, /Power Profile/]) {
      const figure = screen.getByRole('figure', { name })
      expect(within(figure).getByText('No data available')).toBeInTheDocument()
    }
  })

  it('gates each panel independently by its own series', () => {
    // A drive with speed but no power: speed + power panels have data, but
    // the acceleration-pattern scatter (power-only) must show the empty state.
    renderSection({
      filteredDrives: [drive({ avgSpeedMps: 44.704, avgPowerW: null })],
      toSpeedDisplay: toMph,
      speedUnit: 'mph',
    })

    const speedFig = screen.getByRole('figure', { name: /Speed Distribution/ })
    const accelFig = screen.getByRole('figure', { name: /Acceleration Patterns/ })
    const powerFig = screen.getByRole('figure', { name: /Power Profile/ })

    expect(within(speedFig).queryByText('No data available')).toBeNull()
    expect(within(accelFig).getByText('No data available')).toBeInTheDocument()
    expect(within(powerFig).queryByText('No data available')).toBeNull()
  })
})

describe('DriveAnalyticsSection — power profile', () => {
  it('renders the recent-20 window with peak kW and zeroed regen', () => {
    // 21 drives: the OLDEST (999 kW) must be dropped by slice(-20).
    const drives: Drive[] = []
    drives.push(drive({ avgPowerW: 999_000 })) // index 0 — excluded
    for (let i = 1; i <= 19; i++) drives.push(drive({ avgPowerW: i * 1000 }))
    drives.push(drive({ avgPowerW: 42_000 })) // last — included → "42"

    renderSection({ filteredDrives: drives })

    const figure = screen.getByRole('figure', { name: /Power Profile/ })
    const table = within(figure).getByRole('table')

    // 1 header row + 20 data rows.
    expect(within(table).getAllByRole('row')).toHaveLength(21)
    // The oldest drive fell outside the recent-20 window.
    expect(within(table).queryByText('999')).toBeNull()
    // The newest drive is present with its peak kW.
    expect(within(table).getByText('42')).toBeInTheDocument()
    // Regen column is a placeholder 0 for every row (no regen-power field).
    expect(within(table).getAllByText('0').length).toBeGreaterThanOrEqual(20)
  })

  it('labels the power-profile table columns from i18n', () => {
    renderSection({ filteredDrives: [drive({ avgPowerW: 30_000 })] })
    const figure = screen.getByRole('figure', { name: /Power Profile/ })
    const headers = within(figure)
      .getAllByRole('columnheader')
      .map((h) => h.textContent)
    expect(headers).toEqual(['Drive', 'Max kW', 'Regen kW'])
  })
})

describe('DriveAnalyticsSection — date range filter', () => {
  it('forwards a preset selection as one atomic range change', () => {
    const onRangeChange = vi.fn()
    renderSection({ onRangeChange })

    fireEvent.click(screen.getByRole('button', { name: /date range/i }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('option', { name: /last 7 days/i }))

    expect(onRangeChange).toHaveBeenCalledTimes(1)
    expect(onRangeChange).toHaveBeenCalledWith(
      {
        start: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        end: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      },
      '7d',
    )
  })

  it('toggles the range popover open and closed', () => {
    renderSection()
    const trigger = screen.getByRole('button', { name: /date range/i })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(trigger)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('DriveAnalyticsSection — accessibility & structure', () => {
  it('renders the section heading and three labelled chart figures', () => {
    renderSection({
      filteredDrives: [drive({ avgSpeedMps: 44.704, avgPowerW: 30_000 })],
    })

    expect(screen.getByText('Drive Analytics')).toBeInTheDocument()

    // Each Recharts SVG is opaque to assistive tech, so ChartContainer
    // exposes a role="img" with a descriptive aria-label. Pin all three.
    expect(
      screen.getByRole('img', { name: 'Speed-bucket drive count distribution bar chart' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('img', {
        name: 'Per-drive scatter chart of peak power versus trip distance',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: 'Recent-drives peak and regen power dual-area chart' }),
    ).toBeInTheDocument()

    // The three panels are exposed as figure landmarks named by their titles.
    expect(screen.getAllByRole('figure')).toHaveLength(3)
  })
})
