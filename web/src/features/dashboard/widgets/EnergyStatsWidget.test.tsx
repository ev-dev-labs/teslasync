/**
 * EnergyStatsWidget — behaviour + hardening coverage.
 *
 * The widget summarises a vehicle's rolling energy usage inside a WidgetShell:
 * a compact big-number (total kWh) at 1×N, and a daily-usage area chart plus a
 * stat grid (Total Used / Total Charged / Avg Efficiency / CO₂ Saved, and — at
 * ≥3 cols — Total Cost / Net Energy) at standard/wide sizes. Every data hook is
 * mocked so the network is never touched; `useUnits` is stubbed with a
 * deterministic preference whose `formatEnergy` is wired to the REAL
 * `@/lib/unitConversion` formatter so the Wh→kWh display math is exercised
 * end-to-end, and the km↔mi efficiency conversion is flipped per test.
 *
 * It exposes a default component plus one pure helper (`buildEnergyChartData`).
 *
 * Facets covered:
 *   - buildEnergyChartData: the Wh→kWh conversion regression (the chart axis,
 *     tooltip, and series name are all labelled "kWh", so the series must be in
 *     kWh — it used to plot raw watt-hours, overstating every point 1000×), plus
 *     the null-breakdown / null-per-day null-safety and multi-point mapping.
 *   - compact (1×N): the big-number hero (total_wh → kWh) + the energy unit
 *     label, and the no-data empty state (role="status").
 *   - standard (2×N): title, the four base stat cards with their formatted
 *     values/units, and the withholding of the wide-only Cost/Net cards.
 *   - wide (≥3 cols): the two extra Total Cost / Net Energy cards.
 *   - unit conversion: the Avg-Efficiency value + label follow the km↔mi
 *     preference (Wh/km ↔ Wh/mi), never the SI source.
 *   - null-safety: missing energy/efficiency/co2 fields collapse to 0-valued
 *     placeholders without crashing.
 *   - empty / loading / error states (EmptyState, Skeleton, QueryError).
 *   - refresh wiring (the freshness control refetches).
 *   - vehicle-id resolution: explicit prop, first-vehicle fallback, and the
 *     disabled (null id) query when no vehicle exists.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { DailyEnergy } from '@/types/energy';
import { formatEnergy as libFormatEnergy, type UnitPref } from '@/lib/unitConversion';

// ── i18n stub: return the English fallback (2nd arg) or the key. ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, def?: string) => (typeof def === 'string' ? def : _key),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// ── Data hooks + the display-boundary unit bridge, driven per test. ──
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: vi.fn() }));
vi.mock('@/api/hooks/useEnergy', () => ({ useEnergyStats: vi.fn() }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: vi.fn() }));

import { useVehicles } from '@/api/hooks/useVehicles';
import { useEnergyStats } from '@/api/hooks/useEnergy';
import { useUnits } from '@/hooks/useUnits';
import EnergyStatsWidget, { buildEnergyChartData } from './EnergyStatsWidget';

const mockVehicles = useVehicles as unknown as ReturnType<typeof vi.fn>;
const mockEnergy = useEnergyStats as unknown as ReturnType<typeof vi.fn>;
const mockUnits = useUnits as unknown as ReturnType<typeof vi.fn>;

 
function makeQuery(over: Record<string, unknown> = {}): any {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function makeDay(over: Partial<DailyEnergy> = {}): DailyEnergy {
  return {
    date: '2026-06-01',
    energy_wh: 5000,
    cost: 1,
    distance_m: 1000,
    efficiency_wh_per_m: 0.15,
    ...over,
  };
}

// SI-valued EnergyStats fixture. Watt-hours for energy, Wh/m for efficiency —
// the widget converts everything at the display boundary. The loose return
// type lets a test override a field with `null` to prove the `?? 0` guards.
function makeStats(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    vehicle_id: 42,
    period_days: 30,
    total_energy_used_wh: 12_000,
    total_energy_charged_wh: 15_000,
    total_wh: 45_000,
    total_cost: 4.5,
    total_distance_m: 100_000,
    avg_efficiency_wh_per_m: 0.15,
    co2_saved_kg: 3.2,
    daily_breakdown: [
      makeDay({ date: '2026-06-01', energy_wh: 5000 }),
      makeDay({ date: '2026-06-02', energy_wh: 7000 }),
    ],
    ...over,
  };
}

// A full UnitPref bag so the real lib formatter runs. `energy: 'kWh'` +
// `locale: 'en-US'` pin the display output deterministically.
function prefs(distance: 'km' | 'mi'): UnitPref {
  return {
    distance,
    speed: distance === 'mi' ? 'mph' : 'km/h',
    temperature: '°C',
    pressure: 'bar',
    energy: 'kWh',
    duration: 'h',
    power: 'kW',
    locale: 'en-US',
  };
}

const COMPACT = { cols: 1, rows: 2 };
const STANDARD = { cols: 2, rows: 4 };
const WIDE = { cols: 3, rows: 4 };

function setup(
  opts: {
     
    stats?: any;
     
    vehicles?: any;
    distance?: 'km' | 'mi';
  } = {},
) {
  const p = prefs(opts.distance ?? 'km');
  mockVehicles.mockReturnValue(opts.vehicles ?? makeQuery({ data: [{ id: 42 }] }));
  mockEnergy.mockReturnValue(opts.stats ?? makeQuery({ data: makeStats() }));
  mockUnits.mockReturnValue({
    unitPrefs: p,
    formatEnergy: (value: number | null | undefined, options?: { precision?: number }) =>
      libFormatEnergy(value, p, options),
  });
}

function renderWidget(props: { size: { cols: number; rows: number }; vehicleId?: number }) {
  return render(
    <MemoryRouter>
      <EnergyStatsWidget {...props} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Force reduced motion so <AnimatedNumber> lands on its target value
  // synchronously (skipping the rAF tween) — makes the compact big number
  // assertable without advancing timers.
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: /prefers-reduced-motion/.test(query),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
});

describe('buildEnergyChartData', () => {
  it('converts the SI watt-hour series to kWh so it matches the "kWh" axis/tooltip labels', () => {
    // Regression: the series used to be raw watt-hours under a "kWh" label,
    // overstating every point by 1000×. 5000 Wh → 5 kWh, 7000 Wh → 7 kWh.
    const out = buildEnergyChartData([
      makeDay({ date: '2026-06-01', energy_wh: 5000 }),
      makeDay({ date: '2026-06-02', energy_wh: 7000 }),
    ]);

    expect(out).toEqual([
      { date: '2026-06-01', energy: 5 },
      { date: '2026-06-02', energy: 7 },
    ]);
  });

  it('is null-safe for a missing breakdown and a missing per-day energy value', () => {
    expect(buildEnergyChartData(undefined)).toEqual([]);
    expect(buildEnergyChartData(null)).toEqual([]);
    expect(
      buildEnergyChartData([makeDay({ date: 'd', energy_wh: null as unknown as number })]),
    ).toEqual([{ date: 'd', energy: 0 }]);
  });
});

describe('EnergyStatsWidget — compact (1×N)', () => {
  it('renders the total-kWh big number and the energy unit, with no title/chart/stats', () => {
    setup({ stats: makeQuery({ data: makeStats({ total_wh: 45_000 }) }) });
    renderWidget({ size: COMPACT });

    // 45,000 Wh → 45 kWh.
    expect(screen.getByText('45')).toBeInTheDocument();
    expect(screen.getByText('kWh')).toBeInTheDocument();
    // Compact is title-less and stat-less.
    expect(screen.queryByText('Energy Stats')).not.toBeInTheDocument();
    expect(screen.queryByText('Total Used')).not.toBeInTheDocument();
  });

  it('shows the no-data empty state (role="status") when the endpoint returns nothing', () => {
    setup({ stats: makeQuery({ data: null }) });
    renderWidget({ size: COMPACT });

    expect(screen.getByText('No energy data available')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('kWh')).not.toBeInTheDocument();
  });
});

describe('EnergyStatsWidget — standard (2×N)', () => {
  it('renders the title and the four base stat cards with formatted values + units', () => {
    setup({ stats: makeQuery({ data: makeStats() }) });
    renderWidget({ size: STANDARD });

    expect(screen.getByText('Energy Stats')).toBeInTheDocument();

    // Total Used: 12,000 Wh → "12.0 kWh"; Total Charged: 15,000 Wh → "15.0 kWh".
    expect(screen.getByText('Total Used')).toBeInTheDocument();
    expect(screen.getByText('12.0 kWh')).toBeInTheDocument();
    expect(screen.getByText('Total Charged')).toBeInTheDocument();
    expect(screen.getByText('15.0 kWh')).toBeInTheDocument();

    // Avg Efficiency: 0.15 Wh/m × 1000 = 150 Wh/km.
    expect(screen.getByText('Avg Efficiency')).toBeInTheDocument();
    expect(screen.getByText('150.0')).toBeInTheDocument();
    expect(screen.getByText('Wh/km')).toBeInTheDocument();

    // CO₂ Saved: 3.2 kg.
    expect(screen.getByText('CO₂ Saved')).toBeInTheDocument();
    expect(screen.getByText('3.2')).toBeInTheDocument();
    expect(screen.getByText('kg')).toBeInTheDocument();
  });

  it('withholds the wide-only Total Cost / Net Energy cards at 2 columns', () => {
    setup({ stats: makeQuery({ data: makeStats() }) });
    renderWidget({ size: STANDARD });

    expect(screen.queryByText('Total Cost')).not.toBeInTheDocument();
    expect(screen.queryByText('Net Energy')).not.toBeInTheDocument();
  });

  it('renders 0-valued placeholders for missing fields without crashing (null-safety)', () => {
    setup({
      stats: makeQuery({
        data: makeStats({
          total_energy_used_wh: null,
          total_energy_charged_wh: null,
          avg_efficiency_wh_per_m: null,
          co2_saved_kg: null,
        }),
      }),
    });
    renderWidget({ size: STANDARD });

    // Used + Charged both collapse to "0.0 kWh"; efficiency + co2 to "0.0".
    expect(screen.getAllByText('0.0 kWh')).toHaveLength(2);
    expect(screen.getAllByText('0.0')).toHaveLength(2);
    // Still rendered, not crashed.
    expect(screen.getByText('Energy Stats')).toBeInTheDocument();
  });
});

describe('EnergyStatsWidget — wide (≥3 cols)', () => {
  it('adds the Total Cost and Net Energy cards', () => {
    setup({ stats: makeQuery({ data: makeStats() }) });
    renderWidget({ size: WIDE });

    // Total Cost: 4.5 → "4.50" with a "$" unit.
    expect(screen.getByText('Total Cost')).toBeInTheDocument();
    expect(screen.getByText('4.50')).toBeInTheDocument();
    expect(screen.getByText('$')).toBeInTheDocument();

    // Net Energy: (15,000 − 12,000) Wh = 3,000 Wh → "3.0 kWh".
    expect(screen.getByText('Net Energy')).toBeInTheDocument();
    expect(screen.getByText('3.0 kWh')).toBeInTheDocument();
  });
});

describe('EnergyStatsWidget — unit conversion', () => {
  it('renders the efficiency value + label in Wh/mi when the distance preference is mi', () => {
    setup({ stats: makeQuery({ data: makeStats() }), distance: 'mi' });
    renderWidget({ size: STANDARD });

    // 0.15 Wh/m × 1609.344 = 241.4016 → "241.4"; label follows the preference.
    expect(screen.getByText('241.4')).toBeInTheDocument();
    expect(screen.getByText('Wh/mi')).toBeInTheDocument();
    expect(screen.queryByText('Wh/km')).not.toBeInTheDocument();
    expect(screen.queryByText('150.0')).not.toBeInTheDocument();
  });
});

describe('EnergyStatsWidget — states & interaction', () => {
  it('shows the empty state (role="status") but keeps the title at standard size', () => {
    setup({ stats: makeQuery({ data: null }) });
    renderWidget({ size: STANDARD });

    expect(screen.getByText('No energy data available')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    // Standard widgets keep their header even when empty…
    expect(screen.getByText('Energy Stats')).toBeInTheDocument();
    // …but the stat cards are gated behind having data.
    expect(screen.queryByText('Total Used')).not.toBeInTheDocument();
  });

  it('shows a loading skeleton and withholds header + content while loading', () => {
    setup({ stats: makeQuery({ isLoading: true, data: undefined }) });
    const { container } = renderWidget({ size: STANDARD });

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Energy Stats')).not.toBeInTheDocument();
    expect(screen.queryByText('No energy data available')).not.toBeInTheDocument();
  });

  it('renders the error branch (role="alert") instead of the stats on query failure', () => {
    setup({ stats: makeQuery({ data: undefined, error: new Error('boom'), isError: true }) });
    renderWidget({ size: STANDARD });

    // A non-ApiError falls through QueryError to the network/unknown branch.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Energy Stats')).not.toBeInTheDocument();
  });

  it('refetches the energy query when the accessible Refresh control is clicked', () => {
    const refetch = vi.fn();
    setup({ stats: makeQuery({ data: makeStats(), refetch }) });
    renderWidget({ size: STANDARD });

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('EnergyStatsWidget — vehicle resolution', () => {
  it('keys the energy query on the explicit vehicleId prop (as a string)', () => {
    setup({ stats: makeQuery({ data: makeStats() }) });
    renderWidget({ size: STANDARD, vehicleId: 7 });

    expect(mockEnergy).toHaveBeenCalledWith('7');
  });

  it('falls back to the first vehicle id when no vehicleId prop is supplied', () => {
    setup({
      vehicles: makeQuery({ data: [{ id: 3 }, { id: 9 }] }),
      stats: makeQuery({ data: makeStats() }),
    });
    renderWidget({ size: STANDARD });

    expect(mockEnergy).toHaveBeenCalledWith('3');
  });

  it('disables the query (null id) and degrades to the empty state when no vehicle exists', () => {
    setup({ vehicles: makeQuery({ data: [] }), stats: makeQuery({ data: null }) });
    renderWidget({ size: STANDARD });

    expect(mockEnergy).toHaveBeenCalledWith(null);
    expect(screen.getByText('No energy data available')).toBeInTheDocument();
  });
});
