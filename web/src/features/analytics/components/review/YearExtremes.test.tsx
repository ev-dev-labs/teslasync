/**
 * YearExtremes — record-setting moments of the year (top speed + temp extremes).
 *
 * These tests pin the behaviours that matter for a display-boundary component:
 *  1. km/h → SI m/s conversion before formatting (the formatter expects m/s).
 *  2. Celsius extremes flow straight to the temperature formatter, including
 *     sub-zero readings that must not be clamped.
 *  3. A missing extreme renders the formatter's "—" placeholder rather than a
 *     fabricated "0" — `null * 1000` would otherwise coerce to a real-looking 0.
 *  4. A legitimate zero reading is NOT mistaken for missing data.
 *  5. The icons are decorative and stay out of the accessibility tree.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { YearExtremes } from './YearExtremes';
import type { YearReview } from '@/api/types';

// i18n: return the inline English fallback so assertions read real labels.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

// Deterministic display-boundary formatters. `—` mirrors the real lib's
// empty-value fallback (resolveEmpty) so the missing-data path is observable.
const { formatSpeed, formatTemperature } = vi.hoisted(() => {
  const isEmpty = (v: number | null | undefined) => v == null || Number.isNaN(v);
  return {
    formatSpeed: vi.fn((v: number | null | undefined) => (isEmpty(v) ? '—' : `${v} m/s`)),
    formatTemperature: vi.fn((v: number | null | undefined) => (isEmpty(v) ? '—' : `${v}°`)),
  };
});

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ formatSpeed, formatTemperature }),
}));

const baseData: YearReview = {
  year: 2025,
  vehicle: { id: 1, display_name: 'Test Car', model: 'model3' },
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
  most_active_day_of_week: '',
  most_active_hour: 0,
  avg_drives_per_week: 0,
  avg_distance_per_drive_km: 0,
  avg_efficiency_wh_km: 0,
  supercharger_pct: 0,
  dc_fast_pct: 0,
  ac_other_pct: 0,
  avg_charge_start_soc: 0,
  comparisons: [],
};

const makeData = (overrides: Partial<YearReview> = {}): YearReview => ({
  ...baseData,
  ...overrides,
});

beforeEach(() => {
  formatSpeed.mockClear();
  formatTemperature.mockClear();
});

describe('YearExtremes', () => {
  it('renders the three extreme cards with their translated labels', () => {
    render(
      <YearExtremes
        data={makeData({ fastest_speed_kmh: 100, hottest_drive_temp_c: 30, coldest_drive_temp_c: -5 })}
      />,
    );
    expect(screen.getByText('Top speed')).toBeInTheDocument();
    expect(screen.getByText('Hottest drive')).toBeInTheDocument();
    expect(screen.getByText('Coldest drive')).toBeInTheDocument();
  });

  it('converts fastest_speed_kmh (km/h) to SI m/s before formatting', () => {
    // 216 km/h = 216_000 m / 3600 s = exactly 60 m/s.
    render(<YearExtremes data={makeData({ fastest_speed_kmh: 216 })} />);
    expect(formatSpeed).toHaveBeenCalledWith(60);
    expect(screen.getByText('60 m/s')).toBeInTheDocument();
  });

  it('preserves full precision for a non-round speed (100 km/h ≈ 27.78 m/s)', () => {
    render(<YearExtremes data={makeData({ fastest_speed_kmh: 100 })} />);
    const arg = formatSpeed.mock.calls[0]?.[0];
    expect(arg).toBeCloseTo(27.7778, 3);
  });

  it('passes Celsius extremes straight through, keeping sub-zero cold intact', () => {
    render(<YearExtremes data={makeData({ hottest_drive_temp_c: 41.5, coldest_drive_temp_c: -18 })} />);
    expect(formatTemperature).toHaveBeenCalledWith(41.5);
    expect(formatTemperature).toHaveBeenCalledWith(-18);
    expect(screen.getByText('41.5°')).toBeInTheDocument();
    expect(screen.getByText('-18°')).toBeInTheDocument();
  });

  it('shows the formatter placeholder (not a fabricated 0) for a missing extreme', () => {
    render(
      <YearExtremes
        data={makeData({
          // Runtime payloads can be null even though the type declares number.
          fastest_speed_kmh: null as unknown as number,
          hottest_drive_temp_c: undefined as unknown as number,
          coldest_drive_temp_c: null as unknown as number,
        })}
      />,
    );
    // null km/h must NOT be coerced to 0 by the arithmetic — it stays null.
    expect(formatSpeed).toHaveBeenCalledWith(null);
    expect(formatTemperature).toHaveBeenCalledWith(undefined);
    expect(formatTemperature).toHaveBeenCalledWith(null);
    expect(screen.queryByText('0 m/s')).not.toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(3);
  });

  it('renders a legitimate zero reading instead of placeholdering it', () => {
    render(<YearExtremes data={makeData({ fastest_speed_kmh: 0, hottest_drive_temp_c: 0, coldest_drive_temp_c: 0 })} />);
    expect(formatSpeed).toHaveBeenCalledWith(0);
    expect(formatTemperature).toHaveBeenCalledWith(0);
    expect(screen.getByText('0 m/s')).toBeInTheDocument();
    expect(screen.getAllByText('0°')).toHaveLength(2);
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('marks the three metric icons as decorative (aria-hidden, absent from a11y tree)', () => {
    const { container } = render(<YearExtremes data={makeData({ fastest_speed_kmh: 90 })} />);
    expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(3);
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });
});
