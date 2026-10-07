/**
 * TirePressurePanel — behaviour, branch, unit-conversion, severity-colour,
 * a11y, and null-safety coverage for the file's sole export.
 *
 * The panel is a presentational leaf: given `tireData: TirePressureSnapshot |
 * null | undefined` it renders four per-corner pressure tiles plus an overall
 * status chip, OR a labelled empty state when there is no snapshot. There is no
 * data source of its own — the surface under test is:
 *
 *   1. PANEL CHROME + a11y — the title renders through the i18n fallback as a
 *      level-3 heading and its decorative gauge icon is hidden from assistive
 *      tech.
 *   2. EMPTY BRANCH — a nullish `tireData` renders the shared <EmptyState>
 *      (role="status", translated copy) instead of a blank panel; no tiles or
 *      status chip leak through.
 *   3. UNIT BOUNDARY — every corner reads the backend SI value (Pascals),
 *      normalises to kPa, then formats to the user's pressure preference via
 *      `useUnits()` → bar by default, psi under a Fahrenheit/psi profile. Both
 *      branches are exercised through a mutable settings mock.
 *   4. SEVERITY — tile border/number colour AND the overall chip are derived
 *      from `tirePressureVariant` on the SI value, so a corner outside the
 *      warning/critical band is coloured (amber/red) and the chip summarises
 *      the fleet ("All Normal" / "Check Pressure" / "Attention Needed").
 *   5. NULL-SAFETY + HARDENING — a `null` corner draws the muted em-dash in a
 *      neutral tile, and a non-finite (NaN) reading degrades to the SAME
 *      neutral tile rather than the old code's false "healthy green" (regression
 *      pin for the bug this pass fixes).
 *   6. i18n — the title, empty copy, corner labels, and every status phrase
 *      resolve through translation keys with English fallbacks (the spy pins the
 *      contract).
 *
 * Strategy (mirrors the sibling drivetrain-health/TemperatureGauges.test.tsx):
 *   - `@/hooks/useSettings` is mocked per-file with a mutable object so the bar
 *     and psi branches of useUnits are both reachable; this file-level mock takes
 *     precedence over the global test-setup stub.
 *   - `react-i18next` is mocked so `t(key, fallback)` renders the English
 *     fallback deterministically while a spy records the (key, fallback) pairs.
 *   - A matchMedia stub is installed before any module evaluates (defensive —
 *     shared chrome occasionally reaches for it under jsdom).
 *   - user-event is intentionally NOT a dependency of this codebase (see
 *     web/package.json) and this panel exposes no interactive controls, so a
 *     bare render() is the full surface.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { TirePressureSnapshot } from '@/api/types'

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

// Mutable settings so a single test can flip bar ↔ psi. useUnits reads
// settings.unit_of_pressure synchronously each render, so mutating before render
// is enough. This file-level mock takes precedence over the global test-setup stub.
let mockSettings = {
  unit_of_length: 'km' as const,
  unit_of_temp: 'C' as const,
  unit_of_pressure: 'bar' as const,
  locale: 'en-US',
  decimal_precision: 2,
}
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ settings: mockSettings }),
}))

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

import { TirePressurePanel } from './TirePressurePanel'

/** kPa per psi — mirrors the constant inside `@/lib/unitConversion`. */
const KPA_PER_PSI = 6.894757

/**
 * SI tire-pressure band edges in Pascals (mirrors `TIRE_PRESSURE_PA` in the
 * vehicle-detail helpers) so fixtures land unambiguously inside a band.
 *   critical-low < 206_800 ≤ warning-low < 241_300 ≤ SAFE ≤ 310_300
 *                < warning-high ≤ 344_700 < critical-high
 */
const SAFE_PA = 275_000 // 2.75 bar — dead centre of the safe band
const WARN_LOW_PA = 220_000 // 2.20 bar — soft-low band
const CRIT_LOW_PA = 190_000 // 1.90 bar — critical-low band

/** A fully-populated, all-safe snapshot; each spec overrides the corners it asserts. */
function tire(over: Partial<TirePressureSnapshot> = {}): TirePressureSnapshot {
  return {
    id: 1,
    vehicle_id: 1,
    front_left: SAFE_PA,
    front_right: SAFE_PA,
    rear_left: SAFE_PA,
    rear_right: SAFE_PA,
    ...over,
  }
}

function renderPanel(tireData: TirePressureSnapshot | null | undefined) {
  return render(<TirePressurePanel tireData={tireData} />)
}

/** The four corner tiles are exposed as named groups; fetch one by its label. */
function corner(name: string): HTMLElement {
  return screen.getByRole('group', { name })
}

beforeEach(() => {
  tSpy.mockClear()
  mockSettings = {
    unit_of_length: 'km',
    unit_of_temp: 'C',
    unit_of_pressure: 'bar',
    locale: 'en-US',
    decimal_precision: 2,
  }
})

describe('TirePressurePanel — panel chrome + a11y', () => {
  it('renders the title as a level-3 heading resolved through i18n', () => {
    renderPanel(tire())

    expect(
      screen.getByRole('heading', { level: 3, name: 'Tire Pressure' }),
    ).toBeInTheDocument()
    expect(tSpy).toHaveBeenCalledWith('common.tirePressure', 'Tire Pressure')
  })

  it('marks the decorative gauge icon as hidden from assistive tech', () => {
    renderPanel(tire())

    const heading = screen.getByRole('heading', { level: 3 })
    const icon = heading.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('TirePressurePanel — empty branch', () => {
  it('renders the translated EmptyState (no tiles, no chip) when tireData is null', () => {
    renderPanel(null)

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('No tire pressure data available')
    expect(tSpy).toHaveBeenCalledWith(
      'telemetry.noTirePressureData',
      'No tire pressure data available',
    )
    // No corner tiles and no status phrase leak through the empty branch.
    expect(screen.queryAllByRole('group')).toHaveLength(0)
    expect(screen.queryByText('All Normal')).toBeNull()
  })

  it('treats an undefined snapshot the same as null', () => {
    renderPanel(undefined)

    expect(screen.getByRole('status')).toHaveTextContent('No tire pressure data available')
    expect(screen.queryAllByRole('group')).toHaveLength(0)
  })
})

describe('TirePressurePanel — populated / all-safe (metric · bar)', () => {
  it('renders one labelled tile per corner with SI→bar formatted pressures', () => {
    renderPanel(
      tire({
        front_left: 260_000,
        front_right: 270_000,
        rear_left: 280_000,
        rear_right: 290_000,
      }),
    )

    // Four accessible corner groups, each named through its i18n key.
    expect(screen.getAllByRole('group')).toHaveLength(4)
    expect(tSpy).toHaveBeenCalledWith('telemetry.tireFrontLeft', 'Front left')
    expect(tSpy).toHaveBeenCalledWith('telemetry.tireRearRight', 'Rear right')

    // Each corner's SI Pascals convert to bar at the render boundary.
    expect(within(corner('Front left')).getByText('2.60 bar')).toBeInTheDocument()
    expect(within(corner('Front right')).getByText('2.70 bar')).toBeInTheDocument()
    expect(within(corner('Rear left')).getByText('2.80 bar')).toBeInTheDocument()
    expect(within(corner('Rear right')).getByText('2.90 bar')).toBeInTheDocument()
  })

  it('summarises an all-safe fleet with a green "All Normal" chip', () => {
    renderPanel(tire())

    const chip = screen.getByRole('status')
    expect(chip).toHaveTextContent('All Normal')
    expect(chip.className).toContain('text-green-400')
    expect(tSpy).toHaveBeenCalledWith('telemetry.tireAllNormal', 'All Normal')

    // Every safe corner is painted green (border derived from the SI band).
    expect(corner('Front left').className).toContain('border-green-500/30')
  })
})

describe('TirePressurePanel — severity branches', () => {
  it('flags a soft-low corner amber and downgrades the chip to "Check Pressure"', () => {
    renderPanel(tire({ front_left: WARN_LOW_PA }))

    const warned = corner('Front left')
    expect(warned.className).toContain('border-amber-500/30')
    expect(within(warned).getByText('2.20 bar')).toBeInTheDocument()

    const chip = screen.getByRole('status')
    expect(chip).toHaveTextContent('Check Pressure')
    expect(chip.className).toContain('text-amber-400')
    expect(tSpy).toHaveBeenCalledWith('telemetry.tireCheckPressure', 'Check Pressure')
  })

  it('escalates the chip to red "Attention Needed" when any corner is critical', () => {
    renderPanel(tire({ front_left: CRIT_LOW_PA }))

    const critical = corner('Front left')
    expect(critical.className).toContain('border-red-500/30')
    expect(within(critical).getByText('1.90 bar')).toBeInTheDocument()

    const chip = screen.getByRole('status')
    expect(chip).toHaveTextContent('Attention Needed')
    expect(chip.className).toContain('text-red-400')
    // A still-safe corner keeps its own green band even while the fleet is red.
    expect(corner('Rear right').className).toContain('border-green-500/30')
  })
})

describe('TirePressurePanel — null-safety + NaN hardening', () => {
  it('draws a muted em-dash in a neutral tile for a null corner (no crash)', () => {
    renderPanel(tire({ front_left: null }))

    const missing = corner('Front left')
    expect(within(missing).getByText('—')).toBeInTheDocument()
    expect(missing.className).toContain('border-gray-600/30')
    expect(missing.className).not.toContain('green')
  })

  it('degrades a non-finite (NaN) reading to the neutral tile, never a false healthy green', () => {
    // Regression pin: the pre-hardening getColor/getBorder fell through their
    // band guards for NaN and returned the "success" green, painting a broken
    // sensor as perfectly healthy. Routing through tirePressureVariant fixes it.
    renderPanel(tire({ front_left: Number.NaN }))

    const broken = corner('Front left')
    expect(within(broken).getByText('—')).toBeInTheDocument()
    expect(broken.className).toContain('border-gray-600/30')
    expect(broken.className).not.toContain('green')
  })
})

describe('TirePressurePanel — unit boundary (psi)', () => {
  it('converts SI Pascals to psi at the render boundary under a psi profile', () => {
    mockSettings = { ...mockSettings, unit_of_pressure: 'psi' }
    renderPanel(tire({ front_left: 250_000 }))

    // 250_000 Pa → 250 kPa → 250 / 6.894757 psi, formatted to 2 dp.
    const expectedPsi = `${(250 / KPA_PER_PSI).toFixed(2)} psi`
    expect(within(corner('Front left')).getByText(expectedPsi)).toBeInTheDocument()
    // The metric formatting must NOT leak through when psi is selected.
    expect(screen.queryByText('2.50 bar')).toBeNull()
  })
})
