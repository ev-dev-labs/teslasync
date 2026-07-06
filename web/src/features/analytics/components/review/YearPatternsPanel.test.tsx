/**
 * YearPatternsPanel — driving-cadence panel contract + hardening tests.
 *
 * YearPatternsPanel turns the Year-in-Review payload into two labelled rows
 * (favorite day, peak hour) plus three summary stats (drives/week, average
 * distance per drive, average efficiency). It converts SI at the render
 * boundary via the user's `unitPrefs.distance` (km vs mi) and formats the
 * peak hour on a 12-hour clock.
 *
 * Facets covered:
 *   1. Metric / km path — every row + stat renders with the km-derived value
 *      and the km unit labels.
 *   2. Imperial / mi path — the same payload re-renders with mi-converted
 *      distance, Wh/mi efficiency, and mi-suffixed unit labels (SI is
 *      converted at the boundary, so switching the pref must switch output).
 *   3. 12-hour clock — midnight (0) → "12 AM" and noon (12) → "12 PM", the two
 *      boundary cases the modulo logic gets wrong if written naively.
 *   4. Clock hardening (regression) — a non-finite (`NaN`) or out-of-range
 *      (`25`) hour must NOT print "NaN AM" / "25 …"; it truncates + wraps into
 *      a valid 0-23 label instead. Pre-hardening `most_active_hour ?? 0`
 *      only caught null/undefined and leaked "NaN AM" for bad telemetry.
 *   5. String null-safety — an empty `most_active_day_of_week` collapses to the
 *      "—" placeholder, never the literal "undefined".
 *   6. Numeric null-safety — null distance/efficiency/cadence values render as
 *      "0" / "0.0" (via the SI formatters) instead of "NaN".
 *   7. a11y — the panel title is a real level-3 heading and both leading icons
 *      are decorative (aria-hidden) so assistive tech skips them.
 *
 * `react-i18next` is stubbed so `t(key, 'Default')` yields the English default
 * and `t(key, { defaultValue, ...vars })` interpolates `{{var}}` tokens.
 * `useUnits` is stubbed to a deterministic distance preference so the boundary
 * conversion is testable without the settings store. The real
 * `unitConversion` / `numberFormat` helpers run so the maths is exercised
 * end-to-end. The component pulls no data hooks and touches no network.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, arg?: unknown) => {
        if (typeof arg === 'string') return arg;
        if (arg && typeof arg === 'object') {
          const o = arg as Record<string, unknown>;
          const template = typeof o.defaultValue === 'string' ? o.defaultValue : key;
          return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => {
            const v = o[name];
            return v == null ? '' : String(v);
          });
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

vi.mock('@/hooks/useUnits', () => ({ useUnits: vi.fn() }));

import { YearPatternsPanel } from './YearPatternsPanel';
import { useUnits } from '@/hooks/useUnits';
import type { YearReview } from '@/api/types';

const mockUseUnits = vi.mocked(useUnits);

/** Minimal `useUnits` result — the panel only reads `unitPrefs.distance`. */
function units(distance: 'km' | 'mi') {
  return { unitPrefs: { distance } } as unknown as ReturnType<typeof useUnits>;
}

/** Fully-typed YearReview with sensible defaults; override per-test. */
function review(overrides: Partial<YearReview> = {}): YearReview {
  const base: YearReview = {
    year: 2024,
    vehicle: { id: 1, display_name: 'Model 3', model: 'model3' },
    total_drives: 0,
    total_distance_km: 0,
    total_energy_kwh: 0,
    total_charge_sessions: 0,
    total_driving_minutes: 0,
    total_charging_cost: 0,
    gas_savings: 0,
    co2_offset_kg: 0,
    longest_drive: null,
    shortest_drive: null,
    most_efficient_drive: null,
    least_efficient_drive: null,
    fastest_speed_kmh: 0,
    coldest_drive_temp_c: 0,
    hottest_drive_temp_c: 0,
    monthly_stats: [],
    most_active_day_of_week: 'Friday',
    most_active_hour: 17,
    avg_drives_per_week: 5.5,
    avg_distance_per_drive_km: 42,
    avg_efficiency_wh_km: 150,
    supercharger_pct: 0,
    dc_fast_pct: 0,
    ac_other_pct: 0,
    avg_charge_start_soc: 0,
    comparisons: [],
  };
  return { ...base, ...overrides };
}

beforeEach(() => {
  mockUseUnits.mockReturnValue(units('km'));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('YearPatternsPanel — metric (km) rendering', () => {
  it('renders the title, both pattern rows, and all three km stats', () => {
    render(<YearPatternsPanel data={review()} />);

    // Title + row labels.
    expect(
      screen.getByRole('heading', { level: 3, name: 'Your driving patterns' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Favorite driving day')).toBeInTheDocument();
    expect(screen.getByText('Friday')).toBeInTheDocument();
    expect(screen.getByText('Peak driving hour')).toBeInTheDocument();
    // 17:00 → 5 PM on the 12-hour clock.
    expect(screen.getByText('5 PM')).toBeInTheDocument();

    // Stats: cadence, distance/drive (km), efficiency (Wh/km).
    expect(screen.getByText('5.5')).toBeInTheDocument();
    expect(screen.getByText('drives/week')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('km/drive avg')).toBeInTheDocument();
    expect(screen.getByText('150')).toBeInTheDocument();
    expect(screen.getByText('Wh/km avg')).toBeInTheDocument();
  });
});

describe('YearPatternsPanel — imperial (mi) rendering', () => {
  it('converts distance to miles and efficiency to Wh/mi when the pref is mi', () => {
    mockUseUnits.mockReturnValue(units('mi'));

    render(<YearPatternsPanel data={review()} />);

    // 42 km/drive → 26 mi/drive (42000 m / 1609.344).
    expect(screen.getByText('26')).toBeInTheDocument();
    expect(screen.getByText('mi/drive avg')).toBeInTheDocument();
    // 150 Wh/km → 241 Wh/mi (× 1.609344).
    expect(screen.getByText('241')).toBeInTheDocument();
    expect(screen.getByText('Wh/mi avg')).toBeInTheDocument();
    // The km-labelled variants must be gone.
    expect(screen.queryByText('km/drive avg')).toBeNull();
    expect(screen.queryByText('Wh/km avg')).toBeNull();
  });
});

describe('YearPatternsPanel — 12-hour clock boundaries', () => {
  it('renders midnight (0) as "12 AM" and noon (12) as "12 PM"', () => {
    const { rerender } = render(
      <YearPatternsPanel data={review({ most_active_hour: 0 })} />,
    );
    expect(screen.getByText('12 AM')).toBeInTheDocument();

    rerender(<YearPatternsPanel data={review({ most_active_hour: 12 })} />);
    expect(screen.getByText('12 PM')).toBeInTheDocument();
    expect(screen.queryByText('12 AM')).toBeNull();
  });
});

describe('YearPatternsPanel — clock hardening (regression)', () => {
  it('never prints "NaN" for a non-finite hour and wraps an out-of-range hour', () => {
    // Pre-hardening: `most_active_hour ?? 0` let NaN through → "NaN AM".
    const { container, rerender } = render(
      <YearPatternsPanel data={review({ most_active_hour: Number.NaN })} />,
    );
    expect(container.textContent).not.toContain('NaN');
    expect(screen.getByText('12 AM')).toBeInTheDocument();

    // 25:00 is invalid clock data — it wraps to 01:00 ("1 AM"), never "25".
    rerender(<YearPatternsPanel data={review({ most_active_hour: 25 })} />);
    expect(screen.getByText('1 AM')).toBeInTheDocument();
    expect(screen.queryByText('25 AM')).toBeNull();

    // A fractional hour truncates rather than printing "1.7 PM".
    rerender(<YearPatternsPanel data={review({ most_active_hour: 13.7 })} />);
    expect(screen.getByText('1 PM')).toBeInTheDocument();
  });
});

describe('YearPatternsPanel — null-safety', () => {
  it('shows the "—" placeholder for an empty favorite day, never "undefined"', () => {
    render(
      <YearPatternsPanel
        data={review({ most_active_day_of_week: '' })}
      />,
    );

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('undefined')).toBeNull();
    // The row label still renders alongside the placeholder.
    expect(screen.getByText('Favorite driving day')).toBeInTheDocument();
  });

  it('formats null numeric stats as "0" / "0.0" instead of "NaN"', () => {
    const { container } = render(
      <YearPatternsPanel
        data={review({
          avg_drives_per_week: null as unknown as number,
          avg_distance_per_drive_km: null as unknown as number,
          avg_efficiency_wh_km: null as unknown as number,
        })}
      />,
    );

    expect(container.textContent).not.toContain('NaN');
    expect(container.textContent).not.toContain('undefined');
    // Cadence keeps one decimal; distance + efficiency collapse to "0".
    expect(screen.getByText('0.0')).toBeInTheDocument();
    expect(screen.getAllByText('0')).toHaveLength(2);
  });
});

describe('YearPatternsPanel — accessibility', () => {
  it('exposes a level-3 heading and marks the leading icons decorative', () => {
    const { container } = render(<YearPatternsPanel data={review()} />);

    expect(
      screen.getByRole('heading', { level: 3, name: 'Your driving patterns' }),
    ).toBeInTheDocument();

    // Both lucide glyphs are aria-hidden so screen readers skip them and read
    // the adjacent text label instead.
    const decorativeIcons = container.querySelectorAll('svg[aria-hidden="true"]');
    expect(decorativeIcons).toHaveLength(2);
  });
});
