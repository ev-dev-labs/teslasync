/**
 * RecentChargesSection — behaviour, branch, unit, a11y, null-safety and
 * regression coverage for both module exports (`chargeDurationMinutes` +
 * `RecentChargesSection`).
 *
 * The section is fed by the `/charging?vehicle_id=…&limit=5` list endpoint,
 * which serializes the raw `charging_sessions` model: `started_at` + `ended_at`,
 * `cost_decimal`, and SoC as `start_soc_pct` / `end_soc_pct` (omitempty). It does
 * NOT send the drive-shaped `start_ts`, `duration_min`, or `cost` fields the
 * earlier code read verbatim — so the Date, Duration and Cost columns each
 * rendered a permanent placeholder ("—" / "0m" / "—"). This suite pins the three
 * copy-paste bugs the hardening pass fixed and the SoC null-safety guard:
 *   1. DATE   — read `started_at` (with a `start_ts` alias fallback), never "—".
 *   2. DURATION — derive from the start/end timestamp delta when no explicit
 *      `duration_min` is supplied; prefer an explicit positive value if present.
 *   3. COST   — read `cost_decimal` (with a legacy `cost` alias), not the
 *      never-sent `cost`.
 *   4. BATTERY — a missing `start_soc_pct` renders "—", never "null%".
 *
 * Strategy (mirrors the sibling telemetry-panels/TirePressurePanel.test.tsx +
 * admin/vehicle-cost/VehicleCostTable.test.tsx conventions):
 *   - `react-i18next` is mocked so `t(key, fallback)` renders the English
 *     fallback deterministically while a spy records the (key, fallback) pairs.
 *   - `@/hooks/useSettings` is stubbed globally by src/test-setup.ts ('$' /
 *     precision 2), so `useFormatting` formats currency without a provider.
 *   - The real shared `DataTable` / `GlassPanel` / `EmptyState` render for real;
 *     renders are wrapped in MemoryRouter because the "View all" <Link> +
 *     EmptyState's <Link> need router context.
 *   - user-event is intentionally NOT a dependency of this codebase (see
 *     web/package.json); this section exposes no interactive controls beyond a
 *     plain navigation link, so a bare render() is the full surface.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ChargingSession } from '@/api/types'

// jsdom lacks matchMedia; some shared chrome reads it at render. Install a
// benign stub before anything evaluates.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false
      },
    })) as unknown as typeof window.matchMedia
  }
})

// i18n → return the developer fallback so labels read as real English; the spy
// records the (key, fallback) pairs so the i18n contract can be asserted.
const { tSpy } = vi.hoisted(() => ({
  tSpy: vi.fn((_key: string, fallback?: string) => fallback ?? _key),
}))
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({ t: tSpy, i18n: { language: 'en', changeLanguage: vi.fn() } }),
  }
})

import { RecentChargesSection, chargeDurationMinutes } from './RecentChargesSection'

/**
 * A charging session in the exact shape the `/charging` list endpoint ships:
 * `started_at` + `ended_at` + `cost_decimal`, and NO `duration_min` / `start_ts`
 * / `cost`. Each spec overrides only the field(s) it asserts. The cast covers
 * the frontend type's (inaccurate) `duration_min: number` requirement — the real
 * payload omits it.
 */
function makeSession(over: Partial<ChargingSession> = {}): ChargingSession {
  const base = {
    id: 1,
    vehicle_id: 7,
    started_at: '2026-06-01T10:00:00Z',
    ended_at: '2026-06-01T11:30:00Z',
    start_soc_pct: 20,
    end_soc_pct: 80,
    delta_soc_pct: 60,
    start_odometer_m: null,
    end_odometer_m: null,
    start_lat: null,
    start_lng: null,
    start_place: null,
    total_energy_added_wh: 42_000,
    peak_power_w: null,
    avg_power_w: null,
    cost_decimal: 7.5,
    cost_currency: 'USD',
    charger_type: null,
    cable_type: null,
    startedAt: '2026-06-01T10:00:00Z',
  }
  return { ...base, ...over } as ChargingSession
}

function renderSection(sessions: ChargingSession[] | undefined) {
  return render(
    <MemoryRouter>
      <RecentChargesSection sessions={sessions} />
    </MemoryRouter>,
  )
}

/** Cells of the single data row, located via its (default) energy cell. */
function dataCells(energyText = '42.00 kWh'): HTMLElement[] {
  const row = screen.getByText(energyText).closest('tr')
  expect(row).not.toBeNull()
  return within(row as HTMLElement).getAllByRole('cell')
}

beforeEach(() => tSpy.mockClear())
afterEach(() => cleanup())

describe('chargeDurationMinutes', () => {
  it('prefers an explicit, positive duration_min over the timestamp delta', () => {
    // Timestamps say 90m, but an explicit 45 wins.
    expect(chargeDurationMinutes(makeSession({ duration_min: 45 }))).toBe(45)
  })

  it('derives minutes from started_at/ended_at when duration_min is absent', () => {
    // The real /charging list shape: no duration_min at all → 10:00→11:30 = 90m.
    expect(chargeDurationMinutes(makeSession())).toBe(90)
  })

  it('ignores a zero, negative, or NaN duration_min and derives from timestamps', () => {
    expect(chargeDurationMinutes(makeSession({ duration_min: 0 }))).toBe(90)
    expect(chargeDurationMinutes(makeSession({ duration_min: -5 }))).toBe(90)
    expect(chargeDurationMinutes(makeSession({ duration_min: Number.NaN }))).toBe(90)
  })

  it('returns 0 for an in-progress session (ended_at null)', () => {
    expect(chargeDurationMinutes(makeSession({ ended_at: null }))).toBe(0)
  })

  it('returns 0 for a reversed or unparseable timestamp pair', () => {
    expect(
      chargeDurationMinutes(
        makeSession({ started_at: '2026-06-01T11:00:00Z', ended_at: '2026-06-01T10:00:00Z' }),
      ),
    ).toBe(0)
    expect(
      chargeDurationMinutes(makeSession({ started_at: 'not-a-date', ended_at: 'nope' })),
    ).toBe(0)
  })

  it('falls back to the start_ts/end_ts aliases when the canonical fields are missing', () => {
    const s = makeSession({
      started_at: undefined,
      ended_at: undefined,
      start_ts: '2026-06-01T10:00:00Z',
      end_ts: '2026-06-01T10:30:00Z',
    })
    expect(chargeDurationMinutes(s)).toBe(30)
  })
})

describe('RecentChargesSection — empty states', () => {
  it('renders the translated EmptyState (no table) when sessions is undefined', () => {
    renderSection(undefined)
    expect(screen.getByRole('status')).toHaveTextContent('No charging sessions recorded yet')
    expect(screen.queryByRole('table')).toBeNull()
    expect(tSpy).toHaveBeenCalledWith('common.noCharges', 'No charging sessions recorded yet')
  })

  it('renders the EmptyState for an empty array too', () => {
    renderSection([])
    expect(screen.getByRole('status')).toHaveTextContent('No charging sessions recorded yet')
    expect(screen.queryByRole('table')).toBeNull()
  })
})

describe('RecentChargesSection — chrome + a11y', () => {
  it('renders the panel title as a level-3 heading resolved through i18n', () => {
    renderSection([makeSession()])
    expect(screen.getByRole('heading', { level: 3, name: 'Recent Charges' })).toBeInTheDocument()
    expect(tSpy).toHaveBeenCalledWith('common.recentCharges', 'Recent Charges')
  })

  it('marks the decorative heading icon as hidden from assistive tech', () => {
    renderSection([makeSession()])
    const heading = screen.getByRole('heading', { level: 3 })
    const icon = heading.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it('links "View all" to the charging list page', () => {
    renderSection([makeSession()])
    const link = screen.getByRole('link', { name: /view all/i })
    expect(link).toHaveAttribute('href', '/charging')
    expect(tSpy).toHaveBeenCalledWith('common.viewAll', 'View all')
  })
})

describe('RecentChargesSection — populated table', () => {
  it('renders the five column headers through i18n keys with English fallbacks', () => {
    renderSection([makeSession()])
    expect(screen.getByRole('table')).toBeInTheDocument()
    for (const name of ['Date', 'Energy', 'Duration', 'Cost', 'Battery']) {
      expect(screen.getByRole('columnheader', { name })).toBeInTheDocument()
    }
    expect(tSpy).toHaveBeenCalledWith('common.date', 'Date')
    expect(tSpy).toHaveBeenCalledWith('common.energy', 'Energy')
    expect(tSpy).toHaveBeenCalledWith('common.duration', 'Duration')
    expect(tSpy).toHaveBeenCalledWith('common.cost', 'Cost')
    expect(tSpy).toHaveBeenCalledWith('common.battery', 'Battery')
  })

  it('formats energy (SI Wh→kWh), duration (timestamp delta), cost, and the SoC range', () => {
    renderSection([makeSession()])
    const cells = dataCells()
    expect(cells[1]).toHaveTextContent('42.00 kWh') // 42_000 Wh → 42 kWh @ precision 2
    expect(cells[2]).toHaveTextContent('1h 30m') // 10:00 → 11:30
    expect(cells[3]).toHaveTextContent('$7.50') // cost_decimal via formatCurrency
    expect(cells[4]).toHaveTextContent('20% → 80%')
  })

  it('renders a real date from started_at even though the drive-shaped start_ts is absent', () => {
    // Regression: the pre-fix Date column read `s.start_ts`, which the /charging
    // list endpoint never sends, so it was a permanent "—".
    renderSection([makeSession()])
    const dateCell = dataCells()[0]
    expect(dateCell.textContent).not.toBe('—')
    expect(dateCell).toHaveTextContent(/2026/)
  })

  it('renders one row per session', () => {
    renderSection([
      makeSession({ id: 1, total_energy_added_wh: 42_000 }),
      makeSession({ id: 2, total_energy_added_wh: 21_000 }),
    ])
    // One energy cell (ending in "kWh") per data row.
    expect(screen.getAllByText(/kWh$/)).toHaveLength(2)
    expect(screen.getByText('42.00 kWh')).toBeInTheDocument()
    expect(screen.getByText('21.00 kWh')).toBeInTheDocument()
  })
})

describe('RecentChargesSection — cost & battery branches', () => {
  it('prefers the legacy `cost` alias over `cost_decimal` when both are present', () => {
    renderSection([makeSession({ cost: 3.25 })])
    expect(dataCells()[3]).toHaveTextContent('$3.25')
  })

  it('shows "—" when neither cost nor cost_decimal is present', () => {
    renderSection([makeSession({ cost_decimal: null })])
    expect(dataCells()[3]).toHaveTextContent('—')
  })

  it('shows only the start SoC when end_soc_pct is null', () => {
    renderSection([makeSession({ end_soc_pct: null })])
    const cell = dataCells()[4]
    expect(cell).toHaveTextContent('20%')
    expect(cell.textContent).not.toContain('→')
  })

  it('shows "—" (never "null%") when start_soc_pct is missing', () => {
    // Null-safety regression: `start_soc_pct` is omitempty on the wire, so a
    // partial row used to render "null%".
    renderSection([makeSession({ start_soc_pct: undefined, end_soc_pct: null })])
    const cell = dataCells()[4]
    expect(cell).toHaveTextContent('—')
    expect(cell.textContent).not.toContain('null')
  })
})
