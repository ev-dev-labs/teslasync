/**
 * HeroGauges — behaviour + hardening contract.
 *
 * The Fleet Analytics KPI band renders six tiles off a single
 * `useFleetAnalytics()` query result and owns its own loading state. These
 * tests pin the behaviour that matters and the null-safety hardening this file
 * added:
 *
 *   - loading → a six-tile skeleton band, never partial data;
 *   - ready (km) → distance goes through the SI meter helper (so 2000 km stays
 *     2000 km), integer drive counts skip the fractional display precision,
 *     energy reads in kWh, efficiency stays Wh/km, CO₂ = km * 0.12, and gas
 *     savings are currency-formatted at 0 dp;
 *   - ready (mi) → distance converts to miles and efficiency to Wh/mi via the
 *     1.609344 factor, while the KM-anchored gas-savings / CO₂ heuristics stay
 *     put so the dollar/kg outputs don't drift with the display unit;
 *   - negative raw gas savings clamp to 0 (never a "-$744" tile);
 *   - RESOLVED-BUT-EMPTY (error, or an idle state that never loaded) → every
 *     tile shows a neutral "—" instead of a misleading band of "0"/"$0"s
 *     (regression guard — it used to coerce the absent payload to zeros that
 *     read as real data; mirrors the DrivingPerformanceCards sibling), and the
 *     currency formatter is never even invoked on that path;
 *   - a NaN/Infinity payload is coerced to 0 by `safe(...)` so no tile ever
 *     renders "NaN".
 *
 * `react-i18next` is mocked to echo the English fallback (mirrors the
 * AchievementBadge / FleetCostKpis convention). `useUnits` and `useFormatting`
 * are the settings-backed boundary hooks, so they're mocked to drive the
 * km/mi branch and to assert the currency-format call — the pure SI converters
 * and number formatters run for real. The component exposes no interactive
 * controls, so there is no userEvent surface to exercise.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { HeroGauges } from './HeroGauges';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { fmtNumber } from '@/lib/numberFormat';
import type { FleetAnalytics } from '@/api/types';
import type { FleetAnalyticsQuery } from './constants';

// Mutable mock state. `vi.mock` factories are hoisted above the imports, so the
// shared handles must be created with `vi.hoisted` to be referenceable inside.
const h = vi.hoisted(() => ({
  distance: { current: 'km' as 'km' | 'mi' },
  formatCurrency: vi.fn((amount: number, decimals?: number) => `$${amount.toFixed(decimals ?? 2)}`),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: h.distance.current } }),
}));

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ formatCurrency: h.formatCurrency }),
}));

const DASH = '—';

/** Build the subset of FleetAnalytics HeroGauges actually reads. */
function makeData(overrides: Partial<Record<string, number>> = {}): FleetAnalytics {
  return {
    total_distance_km: 2000,
    total_drives: 128,
    total_energy_kwh: 250,
    total_cost: 55,
    avg_efficiency_wh_km: 150,
    ...overrides,
  } as unknown as FleetAnalytics;
}

/** Minimal UseQueryResult stand-in — HeroGauges only reads `data` + `isLoading`. */
function makeQuery(data: FleetAnalytics | undefined, isLoading = false): FleetAnalyticsQuery {
  return {
    data,
    isLoading,
    isError: !data && !isLoading,
    isSuccess: Boolean(data),
    isPending: isLoading,
  } as unknown as FleetAnalyticsQuery;
}

const ALL_LABELS = ['Distance', 'Drives', 'Energy', 'Efficiency', 'Gas Savings', 'CO₂ Saved'];

beforeEach(() => {
  h.distance.current = 'km';
  h.formatCurrency.mockClear();
});

describe('HeroGauges', () => {
  describe('loading', () => {
    it('renders a skeleton band (no KPI data, no currency call) while the query loads', () => {
      const { container } = render(<HeroGauges query={makeQuery(undefined, true)} />);

      // Two shimmer bars per tile × six tiles.
      expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(6);
      // No real labels or values leak through during the first load.
      expect(screen.queryByText('Distance')).not.toBeInTheDocument();
      expect(screen.queryByText(DASH)).not.toBeInTheDocument();
      // The expensive currency derive is never computed on the loading path.
      expect(h.formatCurrency).not.toHaveBeenCalled();
    });
  });

  describe('ready — kilometres', () => {
    it('renders all six tiles with km-derived values and unit subtitles', () => {
      const { container } = render(<HeroGauges query={makeQuery(makeData())} />);

      // Six tiles, all six labels.
      const grid = container.querySelector('.grid');
      expect(grid?.children).toHaveLength(6);
      for (const label of ALL_LABELS) {
        expect(screen.getByText(label)).toBeInTheDocument();
      }

      // Distance: SI helper leaves 2000 km unchanged → "2,000.0" + km subtitle.
      expect(screen.getByText('2,000.0')).toBeInTheDocument();
      expect(screen.getByText('km')).toBeInTheDocument();

      // Drives: integer formatting, no fractional precision.
      expect(screen.getByText('128')).toBeInTheDocument();

      // Energy in kWh.
      expect(screen.getByText('250.0')).toBeInTheDocument();
      expect(screen.getByText('kWh')).toBeInTheDocument();

      // Efficiency stays Wh/km when the distance unit is km.
      expect(screen.getByText('150.0')).toBeInTheDocument();
      expect(screen.getByText('Wh/km')).toBeInTheDocument();

      // CO₂: 2000 km * 0.12 = 240 kg.
      expect(screen.getByText('240')).toBeInTheDocument();
      expect(screen.getByText('kg')).toBeInTheDocument();

      // Gas savings: 2000*0.085*1.5 - 55 = 200, currency-formatted at 0 dp.
      expect(h.formatCurrency).toHaveBeenCalledWith(200, 0);
      expect(screen.getByText('$200')).toBeInTheDocument();
    });
  });

  describe('ready — miles', () => {
    it('converts distance to miles and efficiency to Wh/mi, keeping KM-based savings stable', () => {
      h.distance.current = 'mi';
      render(<HeroGauges query={makeQuery(makeData())} />);

      // Distance routes through the SI meter helper → miles, a different figure
      // from the km reading (proves the conversion actually happened).
      const expectedMi = fmtNumber(convertDistanceFromSI(2_000_000, 'mi'), 1);
      expect(screen.getByText(expectedMi)).toBeInTheDocument();
      expect(screen.queryByText('2,000.0')).not.toBeInTheDocument();
      expect(screen.getByText('mi')).toBeInTheDocument();

      // Efficiency scales by 1.609344 → 150 * 1.609344 = 241.4016 → "241.4".
      expect(screen.getByText('241.4')).toBeInTheDocument();
      expect(screen.getByText('Wh/mi')).toBeInTheDocument();

      // Gas savings + CO₂ are KM-anchored, so they don't move with display unit.
      expect(h.formatCurrency).toHaveBeenCalledWith(200, 0);
      expect(screen.getByText('240')).toBeInTheDocument();
    });
  });

  describe('gas-savings clamp', () => {
    it('clamps negative raw savings to $0 instead of a negative tile', () => {
      // Electricity cost outruns the gas-equivalent: 255 - 999 = -744 → max(…,0).
      render(<HeroGauges query={makeQuery(makeData({ total_cost: 999 }))} />);

      expect(h.formatCurrency).toHaveBeenCalledWith(0, 0);
      expect(screen.getByText('$0')).toBeInTheDocument();
    });
  });

  describe('resolved-but-empty (error / idle) hardening', () => {
    it('shows an em-dash in every tile — never a misleading band of zeros', () => {
      render(<HeroGauges query={makeQuery(undefined, false)} />);

      // Six tiles, six placeholders.
      expect(screen.getAllByText(DASH)).toHaveLength(6);

      // The previous behaviour painted "0.0"/"0"/"$0" as if it were real data.
      expect(screen.queryByText('0.0')).not.toBeInTheDocument();
      expect(screen.queryByText('0')).not.toBeInTheDocument();
      expect(screen.queryByText('$0')).not.toBeInTheDocument();

      // Currency isn't even computed when there is no payload.
      expect(h.formatCurrency).not.toHaveBeenCalled();

      // Labels still render — the section is never blanked out.
      for (const label of ALL_LABELS) {
        expect(screen.getByText(label)).toBeInTheDocument();
      }
    });
  });

  describe('NaN / Infinity safety', () => {
    it('coerces a NaN distance payload to 0 rather than rendering "NaN"', () => {
      const { container } = render(
        <HeroGauges query={makeQuery(makeData({ total_distance_km: NaN }))} />,
      );

      // safe(NaN) → 0, so distance collapses to "0.0" and no tile reads "NaN".
      expect(container.textContent).not.toContain('NaN');
      expect(screen.getByText('0.0')).toBeInTheDocument();
      // Gas savings (max(0 - 55, 0)) also resolve cleanly to $0.
      expect(h.formatCurrency).toHaveBeenCalledWith(0, 0);
    });
  });
});
