/**
 * TirePressureSection unit tests.
 *
 * The section renders a per-corner tyre-pressure snapshot (FL/FR/RL/RR) as a
 * shared OperationalBrief. Every pressure arrives from the API in SI-canonical
 * pascals and must be converted at the render boundary — Pa → kPa
 * (`paToKpa`) → the user's pressure preference through the typed metric formatter.
 * Each card also carries a severity Badge whose colour + label come from the
 * shared `tirePressureVariant` / `tirePressureStatus` helpers.
 *
 * The global test setup (`src/test-setup.ts`) mocks `@/hooks/useSettings` with
 * the SI defaults (km / °C / bar, precision 2), so the REAL `useUnits` +
 * `lib/unitConversion` run here and exercise the actual conversion math: a
 * 300 000 Pa tyre must display as "3.00 bar" (300 000 / 1000 / 100), never the
 * raw pascal magnitude. `react-i18next` is stubbed to echo each key's inline
 * English fallback, so the visible labels are the fallbacks and the i18n keys
 * are exercised without a raw key leaking into the UI.
 *
 * These tests also pin the directional-status bug fix: the previous inline
 * ternary labelled an OVER-inflated tyre (above the high-warning threshold)
 * as "Low" because it only checked membership of the wide critical band. The
 * hardened `tirePressureStatus` helper distinguishes low vs high, so an
 * over-inflated tyre now correctly reads "High".
 *
 * Coverage:
 *   1. Panel heading is a real heading; one labelled card per corner.
 *   2. SI pascals convert to the user's bar preference (no raw magnitude).
 *   3. Each band is labelled directionally: normal / low / high / critical.
 *   4. Regression: an over-inflated tyre reads "High", never "Low".
 *   5. Critical-low AND critical-high both collapse to "Critical".
 *   6. Badge colour matches severity (success / warning / danger).
 *   7. A null corner degrades to an em-dash value + neutral "No Data" badge,
 *      while the rest of the grid still renders (never a blank panel).
 *   8. Null / undefined snapshot shows the empty state and four unknown corners.
 *   9. a11y: the decorative Review details icon is aria-hidden.
 *  10. Labels come from the i18n fallbacks — no raw translation key leaks.
 */

import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { TirePressureSnapshot } from '@/api/types'

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, values?: Record<string, unknown>) => {
        let out = typeof fallback === 'string' ? fallback : key
        if (values) {
          for (const [k, v] of Object.entries(values)) out = out.replace(`{{${k}}}`, String(v))
        }
        return out
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

vi.mock('@/hooks/useOperationalMetrics', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useOperationalMetrics')>('@/hooks/useOperationalMetrics')
  return { ...actual, useOperationalMetrics: vi.fn(actual.useOperationalMetrics) }
})

import { TirePressureSection } from './TirePressureSection'
import { assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions'
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics'
import { tirePressureVariant } from './helpers'
import { statText } from '../statstrip-vehicle-detail/testQueries'

// Backend SI pascals chosen to land squarely inside each status band.
// Thresholds (Pa): LOW_CRITICAL 206_800 · LOW_WARNING 241_300 ·
//                  HIGH_WARNING 310_300 · HIGH_CRITICAL 344_700.
const NORMAL_PA = 300_000 // inside [LOW_WARNING, HIGH_WARNING] → 3.00 bar
const LOW_PA = 220_000 // [LOW_CRITICAL, LOW_WARNING)          → 2.20 bar
const HIGH_PA = 320_000 // (HIGH_WARNING, HIGH_CRITICAL]        → 3.20 bar
const CRIT_LOW_PA = 190_000 // < LOW_CRITICAL                   → 1.90 bar
const CRIT_HIGH_PA = 360_000 // > HIGH_CRITICAL                 → 3.60 bar

function makeTire(overrides: Partial<TirePressureSnapshot> = {}): TirePressureSnapshot {
  return {
    id: 1,
    vehicle_id: 7,
    front_left: NORMAL_PA,
    front_right: NORMAL_PA,
    rear_left: NORMAL_PA,
    rear_right: NORMAL_PA,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/** A snapshot with one corner in each status band (normal/low/high/crit). */
function mixedTire(): TirePressureSnapshot {
  return makeTire({
    front_left: NORMAL_PA,
    front_right: LOW_PA,
    rear_left: HIGH_PA,
    rear_right: CRIT_HIGH_PA,
  })
}

/** Status badges moved into drawer groups; open the drawer, assert, then close it. */
function openDrawer() {
  const brief = screen.getByTestId('vehicle-tire-pressure-summary')
  fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }))
  return screen.getByRole('dialog')
}

function closeDrawer() {
  const drawer = screen.getByRole('dialog')
  fireEvent.keyDown(drawer, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
}

describe('TirePressureSection — structure', () => {
  it('renders the "Tire Pressure" panel heading as a real heading element', () => {
    render(<TirePressureSection tireData={makeTire()} />)

    const heading = screen.getByRole('heading', { name: 'Tire pressure' })
    expect(heading).toBeInTheDocument()
    expect(heading.tagName).toBe('H3')
  })

  it('renders one labelled card per corner', () => {
    render(<TirePressureSection tireData={makeTire()} />)

    expect(screen.getByText('Front left')).toBeInTheDocument()
    expect(screen.getByText('Front right')).toBeInTheDocument()
    expect(screen.getByText('Rear left')).toBeInTheDocument()
    expect(screen.getByText('Rear right')).toBeInTheDocument()
    expect(document.querySelector('[data-testid="vehicle-tire-pressure-summary"][data-operational-brief]')).not.toBeNull()
    expect(document.querySelectorAll('[data-operational-metric]')).toHaveLength(4)
  })
})

describe('TirePressureSection — SI pressure conversion', () => {
  it('converts SI pascals to the user\u2019s bar preference at the display boundary', () => {
    render(<TirePressureSection tireData={makeTire()} />)

    // 300 000 Pa / 1000 = 300 kPa / 100 = 3.00 bar, for all four corners.
    expect(screen.getAllByText(statText('3.00 bar'))).toHaveLength(4)
  })

  it('renders each corner\u2019s own converted value and never the raw pascal magnitude', () => {
    render(<TirePressureSection tireData={mixedTire()} />)

    expect(screen.getByText(statText('3.00 bar'))).toBeInTheDocument()
    expect(screen.getByText(statText('2.20 bar'))).toBeInTheDocument()
    expect(screen.getByText(statText('3.20 bar'))).toBeInTheDocument()
    expect(screen.getByText(statText('3.60 bar'))).toBeInTheDocument()
    // The raw SI magnitude must never leak through to the UI.
    expect(screen.queryByText(/320000/)).toBeNull()
    expect(screen.queryByText(/320,000/)).toBeNull()
  })
})

describe('TirePressureSection — directional status labels', () => {
  it('labels each pressure band directionally (normal / low / high / critical)', () => {
    render(<TirePressureSection tireData={mixedTire()} />)

    const drawer = openDrawer()
    expect(within(drawer).getByRole('group', { name: 'Front left' })).toHaveTextContent('Normal')
    expect(within(drawer).getByRole('group', { name: 'Front right' })).toHaveTextContent('Low')
    expect(within(drawer).getByRole('group', { name: 'Rear left' })).toHaveTextContent('High')
    expect(within(drawer).getByRole('group', { name: 'Rear right' })).toHaveTextContent('Critical')
    closeDrawer()
  })

  it('labels an over-inflated tyre "High", never "Low" (high-band regression guard)', () => {
    // Only the rear-left corner is over-inflated; the rest sit in the safe band.
    render(
      <TirePressureSection
        tireData={makeTire({ rear_left: HIGH_PA })}
      />,
    )

    const drawer = openDrawer()
    expect(within(drawer).getByRole('group', { name: 'Rear left' })).toHaveTextContent('High')
    // Pre-fix this over-inflated corner was mislabelled "Low".
    expect(within(drawer).queryByText('Low')).toBeNull()
    expect(within(drawer).getAllByText('Normal')).toHaveLength(3)
    closeDrawer()
  })

  it('collapses both critical-low and critical-high to "Critical"', () => {
    render(
      <TirePressureSection
        tireData={makeTire({ front_left: CRIT_LOW_PA, rear_right: CRIT_HIGH_PA })}
      />,
    )

    const drawer = openDrawer()
    expect(within(drawer).getAllByText('Critical')).toHaveLength(2)
    closeDrawer()
    // Directionally-distinct magnitudes still render on their own cards.
    expect(screen.getByText(statText('1.90 bar'))).toBeInTheDocument()
    expect(screen.getByText(statText('3.60 bar'))).toBeInTheDocument()
  })
})

describe('TirePressureSection — badge severity variants', () => {
  it('colours the status badge by severity', () => {
    render(<TirePressureSection tireData={mixedTire()} />)

    // Badge variant classes come from the shared <Badge> component:
    // success → green, warning → yellow, danger → red.
    const drawer = openDrawer()
    expect(within(drawer).getByText('Normal').className).toContain('bg-[var(--semantic-success-bg)]')
    expect(within(drawer).getByText('Low').className).toContain('bg-[var(--semantic-warning-bg)]')
    expect(within(drawer).getByText('High').className).toContain('bg-[var(--semantic-warning-bg)]')
    expect(within(drawer).getByText('Critical').className).toContain('bg-[var(--semantic-danger-bg)]')
    closeDrawer()
  })
})

describe('TirePressureSection — null-value safety', () => {
  it('degrades a null corner to an em-dash value + neutral "No Data" badge', () => {
    render(<TirePressureSection tireData={makeTire({ front_left: null })} />)

    // The missing corner is omitted with a counted explanation, not a crash.
    assertOperationalMetricUnavailable(screen.getByTestId('vehicle-tire-pressure-summary'), 'Front left')

    // The null corner still maps to the neutral variant with its explicit reason.
    expect(tirePressureVariant(null)).toBe('neutral')
    expect(vi.mocked(useOperationalMetrics)).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ occurrenceId: 'front-left', missingReason: 'No data available' }),
    ]))

    // The rest of the grid still renders — the panel is never left blank.
    expect(screen.getAllByText(statText('3.00 bar'))).toHaveLength(3)
  })
})

describe('TirePressureSection — empty states', () => {
  it('shows the empty state and four unknown corners when the snapshot is null', () => {
    render(<TirePressureSection tireData={null} />)

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('No tire pressure data available')).toBeInTheDocument()
    expect(screen.getByText('Front left')).toBeInTheDocument()
    expect(screen.getByText('Rear right')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-operational-metric]')).toHaveLength(0)
    assertOperationalMetricUnavailable(screen.getByTestId('vehicle-tire-pressure-summary'), 'Front left')
    const drawer = openDrawer()
    expect(within(drawer).getByText('4 empty fields are hidden.')).toBeInTheDocument()
    closeDrawer()
  })

  it('shows the empty state when the snapshot is undefined', () => {
    render(<TirePressureSection tireData={undefined} />)

    expect(screen.getByText('No tire pressure data available')).toBeInTheDocument()
    expect(screen.getByText('Front left')).toBeInTheDocument()
  })
})

describe('TirePressureSection — accessibility', () => {
  it('marks the decorative shared Review details icon as aria-hidden', () => {
    const { container } = render(<TirePressureSection tireData={makeTire()} />)

    // The shared Review details glyph is decorative, not a second button label.
    expect(container.querySelectorAll('svg:not([aria-hidden="true"])')).toHaveLength(0)
    expect(container.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThanOrEqual(1)
  })
})

describe('TirePressureSection — i18n', () => {
  it('renders translated fallbacks, never raw translation keys', () => {
    render(<TirePressureSection tireData={makeTire({ rear_left: HIGH_PA })} />)

    expect(screen.getByRole('heading', { name: 'Tire pressure' })).toBeInTheDocument()
    const drawer = openDrawer()
    expect(within(drawer).getByRole('group', { name: 'Rear left' })).toHaveTextContent('High')
    closeDrawer()
    // The underlying i18n keys must never leak into the UI.
    expect(screen.queryByText('vehicles.detail.tirePressure')).toBeNull()
    expect(screen.queryByText('common.high')).toBeNull()
  })
})
