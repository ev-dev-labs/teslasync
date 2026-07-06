/**
 * TripKpiBand — behaviour + hardening contract.
 *
 * The band is the six-tile summary at the top of the Trip Detail page. It owns
 * no data source of its own (the page passes `trip` + `isLoading`), so these
 * tests pin the display behaviour that matters and the null-safety hardening
 * this elevation added:
 *
 *   - km preference → SI values render through the REAL converters:
 *     `convertDistanceFromSI` (32 000 m → "32 km"), `fmtInt`-rounded efficiency
 *     derived at the display boundary ("225 Wh/km"), and
 *     `formatDurationSecondsAsMinutes` (2700 s → "45m"). The energy + currency
 *     formatters are the settings-backed boundary hooks, so they're mocked to
 *     assert they receive SI Wh / raw cost;
 *   - mi preference → distance converts to miles and the efficiency unit suffix
 *     follows the display unit ("Wh/mi");
 *   - loading (no trip yet) → six aria-hidden skeletons, no region, no data;
 *   - background refetch (loading WITH a cached trip) → keeps showing data, never
 *     blanks to skeletons — proving the `isLoading && !trip` gate;
 *   - empty (no trip, not loading) → the region still renders with zeroed tiles
 *     and "—" placeholders for the two derived metrics, never a blank panel;
 *   - malformed data (the real bug this elevation fixed) → negative / NaN /
 *     Infinity totals are clamped to 0 by `safeMetric`, so the band never leaks
 *     "-5 km", "-3 drives", "$-9.99", a negative efficiency, or "NaN".
 *
 * `react-i18next` is mocked to echo the English fallback (with `{{count}}`
 * interpolation), mirroring the DriveStatCards / FleetCostKpis convention.
 * `useUnits` + `useFormatting` are mocked to drive the km/mi branch and to
 * assert the formatter calls; the pure SI converter, integer formatter, and
 * duration formatter run for real. The component exposes no interactive
 * controls, so there is no userEvent surface.
 */
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { TripKpiBand, safeMetric } from './TripKpiBand';
import type { TripDetail } from '@/api/types';

/* ── Controllable mock state, hoisted above the vi.mock factories ─────────── */
const h = vi.hoisted(() => ({ system: 'km' as 'km' | 'mi' }));

const fmt = vi.hoisted(() => ({
  formatEnergy: vi.fn((wh: number) => `${(wh / 1000).toFixed(1)} kWh`),
  formatCurrency: vi.fn(
    (amount: number, decimals?: number) => `$${amount.toFixed(decimals ?? 2)}`,
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, opts?: Record<string, unknown>) => {
      let out = typeof fallback === 'string' ? fallback : key;
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
      }
      return out;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: h.system === 'mi' ? 'mi' : 'km',
      speed: h.system === 'mi' ? 'mph' : 'km/h',
      temperature: '°C',
      pressure: 'bar',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
      precision: 2,
    },
    formatEnergy: fmt.formatEnergy,
  }),
}));

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ formatCurrency: fmt.formatCurrency }),
}));

/* ── Unicode glyph the component renders (escaped to avoid encoding drift) ── */
const DASH = '\u2014'; // —

/* ── Fixture ─────────────────────────────────────────────────────────────── */
function makeTrip(overrides: Partial<TripDetail> = {}): TripDetail {
  return {
    id: 7,
    vehicle_id: 1,
    name: 'Weekend road trip',
    start_date: '2025-03-01',
    end_date: '2025-03-02',
    started_at: '2025-03-01T08:00:00Z',
    ended_at: '2025-03-02T18:00:00Z',
    total_distance_m: 32000, // 32.0 km / 19.9 mi
    total_energy_wh: 7200, // 7.2 kWh
    total_duration_s: 2700, // 45 min
    total_cost: 12.5,
    drive_count: 3,
    charge_count: 2,
    created_at: '2025-03-02T18:05:00Z',
    energy_used_wh: 7200,
    drives: [],
    ...overrides,
  };
}

const REGION = { name: 'Trip summary metrics' };

beforeEach(() => {
  h.system = 'km';
  fmt.formatEnergy.mockClear();
  fmt.formatCurrency.mockClear();
});

/* ── Pure clamp helper ────────────────────────────────────────────────────── */
describe('safeMetric', () => {
  it('clamps nullish and non-finite inputs to 0', () => {
    expect(safeMetric(undefined)).toBe(0);
    expect(safeMetric(null)).toBe(0);
    expect(safeMetric(Number.NaN)).toBe(0);
    expect(safeMetric(Number.POSITIVE_INFINITY)).toBe(0);
    expect(safeMetric(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('clamps negatives to 0 and passes non-negative finite values through unchanged', () => {
    expect(safeMetric(-1)).toBe(0);
    expect(safeMetric(-0.001)).toBe(0);
    // A legitimate 0 stays 0 — clamping is behaviour-preserving for valid data.
    expect(safeMetric(0)).toBe(0);
    expect(safeMetric(32000)).toBe(32000);
    expect(safeMetric(7.2)).toBe(7.2);
  });
});

/* ── Core render — metric (km) preference ─────────────────────────────────── */
describe('TripKpiBand — km preference', () => {
  it('renders every KPI tile with its label, SI-derived value, and subtitles', () => {
    render(<TripKpiBand trip={makeTrip()} isLoading={false} />);

    // Accessibly-named landmark region wrapping the band.
    const region = screen.getByRole('region', REGION);
    expect(region.tagName.toLowerCase()).toBe('section');

    // Every label present.
    for (const label of ['Distance', 'Energy Used', 'Efficiency', 'Duration', 'Drives', 'Cost']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    // Distance: 32 000 m → 32 km via the REAL converter + fmtInt.
    expect(screen.getByText('32 km')).toBeInTheDocument();
    // Efficiency: 7200 Wh / 32 km = 225 → "225 Wh/km" (derived at the boundary).
    expect(screen.getByText('225 Wh/km')).toBeInTheDocument();
    // Duration: 2700 s → 45 min via the REAL formatter.
    expect(screen.getByText('45m')).toBeInTheDocument();
    // Energy + currency come from the mocked boundary hooks.
    expect(screen.getByText('7.2 kWh')).toBeInTheDocument();
    expect(screen.getByText('$12.50')).toBeInTheDocument();

    // Subtitles interpolate the drive / charge counts.
    expect(screen.getByText('3 drives')).toBeInTheDocument();
    expect(screen.getByText('2 charges')).toBeInTheDocument();
  });

  it('feeds SI Wh to formatEnergy and the raw cost to formatCurrency', () => {
    render(<TripKpiBand trip={makeTrip()} isLoading={false} />);

    expect(fmt.formatEnergy).toHaveBeenCalledWith(7200);
    expect(fmt.formatCurrency).toHaveBeenCalledWith(12.5);
  });

  it('renders exactly six tiles, each with an aria-hidden decorative icon', () => {
    const { container } = render(<TripKpiBand trip={makeTrip()} isLoading={false} />);

    // One metric label + one hidden icon per tile — no section is dropped.
    expect(container.querySelectorAll('.metric-label')).toHaveLength(6);
    expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(6);
  });

  it('rounds a fractional distance and formats a multi-hour duration', () => {
    // 5 400 s → 1h 30m; distance stays integer via fmtInt.
    render(<TripKpiBand trip={makeTrip({ total_duration_s: 5400 })} isLoading={false} />);
    expect(screen.getByText('1h 30m')).toBeInTheDocument();
  });
});

/* ── Imperial (mi) preference ─────────────────────────────────────────────── */
describe('TripKpiBand — mi preference', () => {
  beforeEach(() => {
    h.system = 'mi';
  });

  it('converts distance to miles and switches the efficiency unit suffix', () => {
    render(<TripKpiBand trip={makeTrip()} isLoading={false} />);

    // 32 000 m / 1609.344 = 19.88 → "20 mi" (fmtInt rounds to a whole mile).
    expect(screen.getByText('20 mi')).toBeInTheDocument();
    // 7200 Wh / 19.88 mi = 362 → the efficiency unit follows the display unit.
    expect(screen.getByText('362 Wh/mi')).toBeInTheDocument();
    expect(screen.queryByText('225 Wh/km')).not.toBeInTheDocument();
  });
});

/* ── Loading branch ───────────────────────────────────────────────────────── */
describe('TripKpiBand — loading', () => {
  it('renders six aria-hidden skeletons and no region/data before the first load', () => {
    const { container } = render(<TripKpiBand trip={undefined} isLoading />);

    // Six skeleton placeholders inside a grid hidden from assistive tech.
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(6);
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.getAttribute('aria-hidden')).toBe('true');

    // No landmark + no metric labels while the first load is in flight.
    expect(screen.queryByRole('region', REGION)).not.toBeInTheDocument();
    expect(screen.queryByText('Distance')).not.toBeInTheDocument();
    expect(fmt.formatEnergy).not.toHaveBeenCalled();
  });
});

/* ── Background refetch ────────────────────────────────────────────────────── */
describe('TripKpiBand — background refetch', () => {
  it('keeps showing cached data (not skeletons) when loading WITH a trip present', () => {
    const { container } = render(<TripKpiBand trip={makeTrip()} isLoading />);

    // loading && trip → the band stays data, proving the `!trip` half of the gate.
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(screen.getByRole('region', REGION)).toBeInTheDocument();
    expect(screen.getByText('32 km')).toBeInTheDocument();
  });
});

/* ── Empty state (no trip, not loading) ───────────────────────────────────── */
describe('TripKpiBand — empty', () => {
  it('renders the region with zeroed tiles and "—" for the two derived metrics', () => {
    render(<TripKpiBand trip={undefined} isLoading={false} />);

    // Region never blanks — it renders even with no trip.
    expect(screen.getByRole('region', REGION)).toBeInTheDocument();

    // Zeroed direct metrics.
    expect(screen.getByText('0 km')).toBeInTheDocument();
    expect(screen.getByText('0 drives')).toBeInTheDocument();
    expect(screen.getByText('0 charges')).toBeInTheDocument();
    expect(fmt.formatEnergy).toHaveBeenCalledWith(0);
    expect(fmt.formatCurrency).toHaveBeenCalledWith(0);

    // Efficiency (0 distance) + duration (0 s) both fall back to the placeholder.
    expect(screen.getAllByText(DASH)).toHaveLength(2);
  });
});

/* ── Malformed data hardening — the real bug this elevation fixed ─────────── */
describe('TripKpiBand — malformed data hardening', () => {
  it('clamps negative / NaN / Infinity totals to 0 instead of leaking garbage', () => {
    const { container } = render(
      <TripKpiBand
        trip={makeTrip({
          total_distance_m: -5000,
          total_energy_wh: -3000,
          total_duration_s: Number.NaN,
          drive_count: -3,
          charge_count: Number.POSITIVE_INFINITY,
          total_cost: -9.99,
        })}
        isLoading={false}
      />,
    );

    // Distance is clamped: "0 km", never the leaked "-5 km".
    expect(screen.getByText('0 km')).toBeInTheDocument();
    expect(screen.queryByText('-5 km')).not.toBeInTheDocument();

    // Counts are clamped: "0 drives" / "0 charges", never "-3 drives".
    expect(screen.getByText('0 drives')).toBeInTheDocument();
    expect(screen.getByText('0 charges')).toBeInTheDocument();
    expect(screen.queryByText('-3 drives')).not.toBeInTheDocument();

    // Energy + cost formatters receive the clamped 0, never the raw negatives —
    // so the derived efficiency can't go negative either.
    expect(fmt.formatEnergy).toHaveBeenCalledWith(0);
    expect(fmt.formatEnergy).not.toHaveBeenCalledWith(-3000);
    expect(fmt.formatCurrency).toHaveBeenCalledWith(0);
    expect(screen.getByText('$0.00')).toBeInTheDocument();

    // No "NaN", negative, or Infinity string leaks anywhere in the band.
    expect(container.textContent).not.toContain('NaN');
    expect(container.textContent).not.toContain('Infinity');
    expect(container.textContent).not.toContain('-5');
    expect(container.textContent).not.toContain('-3');
    expect(container.textContent).not.toContain('-9');
  });
});
