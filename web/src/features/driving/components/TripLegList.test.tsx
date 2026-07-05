/**
 * TripLegList — route-breakdown panel behaviour + hardening contract.
 *
 * TripLegList renders the per-leg breakdown of a planned trip (distance,
 * duration, energy, start→arrival SOC) plus the charging stop that follows each
 * leg. Every measurement arrives from the backend in SI canonical units
 * (`distance_m` metres, `duration_s`/`charge_duration_s` seconds, `energy_wh`
 * watt-hours) and is converted at the render boundary via `useUnits` /
 * `useFormatting`.
 *
 * These tests pin every facet of the component:
 *   - the headline REGRESSION: a leg's `duration_s` is SECONDS, so it must be
 *     divided by 60 before being labelled "min" — exactly like the sibling
 *     charge-stop duration and the parent page's `total_duration_s / 60`. The
 *     pre-fix code rendered `Math.round(leg.duration_s)` (raw seconds) with a
 *     "min" suffix, so a 61-minute leg showed "3660 min";
 *   - the charge-stop row renders its duration in minutes, energy in kWh, cost
 *     through the currency formatter, and the SOC transition, plus the optional
 *     "recommended" caption;
 *   - arrival SOC below 20 % is flagged rose, at/above 20 % amber, and the
 *     start SOC is always emerald (colour-branch coverage);
 *   - null-safety hardening: missing coordinates fall back to "lat, lng" then an
 *     em-dash (never a `.toFixed()` crash), and missing numeric fields render 0
 *     / "—" rather than "NaN";
 *   - empty and undefined `legs` both render the EmptyState (role="status") with
 *     no leg cards;
 *   - accessibility: every decorative lucide icon is `aria-hidden`;
 *   - unit preference: distance honours the user's miles preference end-to-end.
 *
 * `react-i18next` is stubbed to echo the fallback string, and `useSettings` is
 * stubbed to a fixed, mutable preference bag so `useUnits`/`useFormatting` run
 * their real conversion/formatting logic offline (no QueryClient / network).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

import type { TripLeg, TripChargeStop } from '@/types/driving'

// i18n stub: resolve the positional fallback (or a `defaultValue` option) so we
// assert real user-visible copy rather than raw keys.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') return fallbackOrOpts
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

// Mutable settings bag driving useUnits/useFormatting. `vi.hoisted` makes it
// available to the (hoisted) vi.mock factory below; individual tests flip
// `mockState.settings.unit_of_length` to exercise the miles branch.
const mockState = vi.hoisted(() => {
  const baseSettings = {
    unit_of_length: 'km',
    unit_of_temp: 'C',
    unit_of_pressure: 'bar',
    locale: 'en-US',
    decimal_precision: 2,
    base_cost_per_kwh: 0.12,
    currency_symbol: '$',
    gas_efficiency_mpg: 25,
    gas_price_per_unit: 0,
    gas_unit: 'gallon',
  }
  return { baseSettings, settings: { ...baseSettings } }
})

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: mockState.settings,
    isMiles: mockState.settings.unit_of_length === 'mi',
    isFahrenheit: mockState.settings.unit_of_temp === 'F',
    isPSI: mockState.settings.unit_of_pressure === 'psi',
    decimals: mockState.settings.decimal_precision,
    locale: mockState.settings.locale,
    density: 'comfortable' as const,
    rangeType: 'rated' as const,
  }),
}))

// jsdom lacks matchMedia (framer-motion's useReducedMotion via <FadeIn>).
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

import { TripLegList } from './TripLegList'

// Fixture builders — SI canonical inputs. `duration_s` / `charge_duration_s`
// are SECONDS; the component is responsible for the /60 display conversion.
function makeLeg(overrides: Partial<TripLeg> = {}): TripLeg {
  return {
    from: { lat: 37.7749, lng: -122.4194, name: 'San Francisco' },
    to: { lat: 34.0522, lng: -118.2437, name: 'Los Angeles' },
    distance_m: 45000, // 45.0 km
    duration_s: 3660, // 61 min
    energy_wh: 12000, // 12.0 kWh
    start_soc: 88,
    arrival_soc: 17,
    ...overrides,
  }
}

function makeStop(overrides: Partial<TripChargeStop> = {}): TripChargeStop {
  return {
    name: 'Buttonwillow Supercharger',
    location: { lat: 35.4, lng: -119.4, name: 'Buttonwillow' },
    charge_from_soc: 17,
    charge_to_soc: 82,
    charge_duration_s: 1500, // 25 min
    energy_wh: 38000, // 38.0 kWh
    cost: 9.4, // $9.40
    is_recommended: true,
    ...overrides,
  }
}

// The "Duration" (etc.) Caption and its value live in sibling nodes under a
// common wrapper div — read the wrapper to get the whole "label + value" text.
function cellText(labelEl: HTMLElement): string {
  return labelEl.parentElement?.textContent ?? ''
}

beforeEach(() => {
  mockState.settings = { ...mockState.baseSettings }
})

describe('TripLegList — leg metrics + duration regression', () => {
  it('converts a leg duration from seconds to minutes (was rendered as raw seconds)', () => {
    render(<TripLegList legs={[makeLeg()]} chargeStops={[]} />)

    // Panel header always present.
    expect(
      screen.getByRole('heading', { name: /route breakdown/i }),
    ).toBeInTheDocument()

    // Endpoint names render via locationLabel.
    expect(screen.getByText('San Francisco')).toBeInTheDocument()
    expect(screen.getByText('Los Angeles')).toBeInTheDocument()

    // 3660 s ÷ 60 = 61 min — NOT "3660 min" (the pre-fix bug).
    const duration = cellText(screen.getByText('Duration'))
    expect(duration).toContain('61 min')
    expect(duration).not.toContain('3660')

    // Sibling metrics convert SI → display too.
    expect(cellText(screen.getByText('Distance'))).toContain('45.0 km')
    expect(cellText(screen.getByText('Energy'))).toContain('12.0 kWh')
    const battery = cellText(screen.getByText('Battery'))
    expect(battery).toContain('88%')
    expect(battery).toContain('17%')
  })

  it('renders the charge stop after its leg with minutes, kWh, currency, SOC and the recommended caption', () => {
    render(<TripLegList legs={[makeLeg()]} chargeStops={[makeStop()]} />)

    const stop = screen.getByText('Buttonwillow Supercharger').parentElement
    const stopText = stop?.textContent ?? ''
    expect(stopText).toContain('25 min') // 1500 s ÷ 60
    expect(stopText).toContain('17% → 82%')
    expect(stopText).toContain('38.0 kWh')
    expect(stopText).toContain('$9.40') // formatCurrency
    expect(
      screen.getByText(/Recommended stop point/i),
    ).toBeInTheDocument()
  })

  it('omits the recommended caption when the stop is not recommended', () => {
    render(
      <TripLegList
        legs={[makeLeg()]}
        chargeStops={[makeStop({ is_recommended: false })]}
      />,
    )
    expect(screen.getByText('Buttonwillow Supercharger')).toBeInTheDocument()
    expect(screen.queryByText(/Recommended stop point/i)).toBeNull()
  })
})

describe('TripLegList — SOC threshold colouring', () => {
  it('flags arrival SOC below 20% rose, at/above 20% amber, and start SOC emerald', () => {
    render(
      <TripLegList
        legs={[
          makeLeg({ start_soc: 90, arrival_soc: 12 }),
          makeLeg({ start_soc: 60, arrival_soc: 45 }),
        ]}
        chargeStops={[]}
      />,
    )

    expect(screen.getByText('12%').className).toContain('text-rose-400')
    expect(screen.getByText('45%').className).toContain('text-amber-400')
    expect(screen.getByText('90%').className).toContain('text-emerald-400')
    expect(screen.getByText('60%').className).toContain('text-emerald-400')
  })
})

describe('TripLegList — null-safety + fallbacks', () => {
  it('falls back to coordinates when a name is blank and an em-dash when coordinates are non-finite', () => {
    const { container } = render(
      <TripLegList
        legs={[
          makeLeg({
            from: { lat: 37.7749, lng: -122.4194, name: '' },
            to: { lat: Number.NaN, lng: Number.NaN, name: '' },
          }),
        ]}
        chargeStops={[]}
      />,
    )

    expect(screen.getByText('37.77, -122.42')).toBeInTheDocument()
    // The unusable endpoint degrades to an em-dash, never "NaN, NaN".
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(container.textContent).not.toContain('NaN')
  })

  it('treats missing numeric fields as zero / em-dash instead of rendering NaN', () => {
    const { container } = render(
      <TripLegList
        legs={[
          makeLeg({
            distance_m: undefined,
            duration_s: undefined,
            energy_wh: undefined,
            start_soc: undefined,
            arrival_soc: undefined,
          }),
        ]}
        chargeStops={[]}
      />,
    )

    expect(container.textContent).not.toContain('NaN')
    expect(cellText(screen.getByText('Distance'))).toContain('0.0 km')
    expect(cellText(screen.getByText('Duration'))).toContain('0 min')
    expect(cellText(screen.getByText('Energy'))).toContain('—')
    expect(cellText(screen.getByText('Battery'))).toContain('0%')
  })

  it('uses a fallback charge-stop label and $0.00 when the stop name and cost are missing', () => {
    render(
      <TripLegList
        legs={[makeLeg()]}
        chargeStops={[makeStop({ name: '', cost: undefined })]}
      />,
    )
    const label = screen.getByText('Charging stop')
    expect(label).toBeInTheDocument()
    expect(label.parentElement?.textContent).toContain('$0.00')
  })
})

describe('TripLegList — empty + undefined states', () => {
  it('renders the EmptyState (role=status) and no leg cards when legs is empty', () => {
    render(<TripLegList legs={[]} chargeStops={[]} />)

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(
      screen.getByText('Plan a trip to see the route breakdown'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /route breakdown/i }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Distance')).toBeNull()
  })

  it('does not crash and shows the EmptyState when legs/chargeStops are undefined', () => {
    render(
      <TripLegList
        legs={undefined as unknown as TripLeg[]}
        chargeStops={undefined as unknown as TripChargeStop[]}
      />,
    )
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(
      screen.getByText('Plan a trip to see the route breakdown'),
    ).toBeInTheDocument()
  })
})

describe('TripLegList — accessibility + unit preference', () => {
  it('marks every decorative icon aria-hidden so screen readers skip them', () => {
    const { container } = render(
      <TripLegList legs={[makeLeg()]} chargeStops={[makeStop()]} />,
    )
    const svgs = Array.from(container.querySelectorAll('svg'))
    // 2 MapPin + 1 ArrowRight (leg) + 1 Zap + 1 Clock (stop).
    expect(svgs.length).toBeGreaterThanOrEqual(5)
    expect(svgs.every((el) => el.getAttribute('aria-hidden') === 'true')).toBe(true)
  })

  it('renders distance in miles when the user length preference is miles', () => {
    mockState.settings.unit_of_length = 'mi'
    render(
      <TripLegList legs={[makeLeg({ distance_m: 16093.44 })]} chargeStops={[]} />,
    )
    // 16093.44 m = 10.0 mi exactly; the label follows the preference.
    const distance = cellText(screen.getByText('Distance'))
    expect(distance).toContain('10.0 mi')
    expect(distance).not.toContain('km')
  })
})
