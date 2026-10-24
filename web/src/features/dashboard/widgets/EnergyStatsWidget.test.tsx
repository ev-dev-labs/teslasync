import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DailyEnergy } from '@/types/energy';
import { formatEnergy as libFormatEnergy, type UnitPref } from '@/lib/unitConversion';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, options?: Record<string, unknown>) => {
      const text = fallback ?? key;
      return options ? text.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(options[name] ?? '')) : text;
    },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: vi.fn() }));
vi.mock('@/api/hooks/useEnergy', () => ({ useEnergyStats: vi.fn() }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: vi.fn() }));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDayKey: (value: string) => value,
    formatTime: (value: string | number | Date | null | undefined) => value == null ? '' : String(value),
    formatDateTime: (value: string | number | Date | null | undefined) => value == null ? '' : String(value),
    formatRelativeTime: (value: string | number | Date | null | undefined) => value == null ? '' : String(value),
    formatRelative: (value: string | number | Date | null | undefined) => value == null ? '' : String(value),
  }),
}));
vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return { ...actual, ...chartTestDoubles };
});

import { useVehicles } from '@/api/hooks/useVehicles';
import { useEnergyStats } from '@/api/hooks/useEnergy';
import { useUnits } from '@/hooks/useUnits';
import EnergyStatsWidget, { buildEnergyChartData } from './EnergyStatsWidget';

const mockVehicles = useVehicles as unknown as ReturnType<typeof vi.fn>;
const mockEnergy = useEnergyStats as unknown as ReturnType<typeof vi.fn>;
const mockUnits = useUnits as unknown as ReturnType<typeof vi.fn>;

function makeQuery(over: Record<string, unknown> = {}) {
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

function makeStats(over: Record<string, unknown> = {}) {
  return {
    vehicle_id: 42,
    period_days: 30,
    total_energy_used_wh: 12_000,
    total_energy_charged_wh: 15_000,
    total_wh: 45_000,
    total_cost: 4.5,
    avg_efficiency_wh_per_m: 0.15,
    co2_saved_kg: 3.2,
    daily_breakdown: [
      { date: '2026-06-01', energy_wh: 5000 },
      { date: '2026-06-02', energy_wh: 7000 },
    ],
    ...over,
  };
}

function prefs(distance: 'km' | 'mi' = 'km', energy: 'Wh' | 'kWh' = 'kWh'): UnitPref {
  return {
    distance,
    speed: distance === 'mi' ? 'mph' : 'km/h',
    temperature: '°C',
    pressure: 'bar',
    energy,
    duration: 'h',
    power: 'kW',
    locale: 'en-US',
  };
}

function setup(opts: { stats?: ReturnType<typeof makeQuery>; vehicles?: ReturnType<typeof makeQuery>; distance?: 'km' | 'mi'; energy?: 'Wh' | 'kWh' } = {}) {
  const pref = prefs(opts.distance, opts.energy);
  mockVehicles.mockReturnValue(opts.vehicles ?? makeQuery({ data: [{ id: 42 }] }));
  mockEnergy.mockReturnValue(opts.stats ?? makeQuery({ data: makeStats() }));
  mockUnits.mockReturnValue({
    unitPrefs: pref,
    formatEnergy: (value: number | null | undefined) => libFormatEnergy(value, pref),
  });
}

function renderWidget(size = { cols: 2, rows: 4 }, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <EnergyStatsWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
});

describe('EnergyStatsWidget redesign', () => {
  it('converts chart SI values and preserves gaps', () => {
    expect(buildEnergyChartData([
      { date: '2026-06-01', energy_wh: 5000 } as DailyEnergy,
      { date: '2026-06-02', energy_wh: null } as unknown as DailyEnergy,
    ])).toEqual([
      { date: '2026-06-01', energy: 5 },
      { date: '2026-06-02', energy: null },
    ]);
    expect(buildEnergyChartData(null)).toEqual([]);
  });

  it('uses used energy as the one headline and source-backed secondary metrics at standard size', () => {
    setup();
    renderWidget();
    expect(screen.getByText('Total used')).toBeInTheDocument();
    expect(screen.getByText('12.0')).toBeInTheDocument();
    expect(screen.getByText('Total charged')).toBeInTheDocument();
    expect(screen.getByText('15.0')).toBeInTheDocument();
    expect(screen.getByText('Avg efficiency')).toBeInTheDocument();
    expect(screen.getByText('150 Wh/km')).toBeInTheDocument();
    expect(screen.getByText('CO₂ saved')).toBeInTheDocument();
    expect(screen.getByText('3.20')).toBeInTheDocument();
    expect(screen.getByText('kg')).toBeInTheDocument();
  });

  it('uses compact size for the single used-energy headline only', () => {
    setup();
    renderWidget({ cols: 1, rows: 2 });
    expect(screen.getByRole('heading', { name: 'Energy stats' })).toBeInTheDocument();
    expect(screen.getByText('Total used')).toBeInTheDocument();
    expect(screen.getByText('kWh')).toBeInTheDocument();
    expect(screen.queryByText('Total charged')).not.toBeInTheDocument();
  });

  it('follows shared efficiency and energy unit preferences', () => {
    setup({ distance: 'mi', energy: 'Wh' });
    renderWidget({ cols: 3, rows: 4 });
    expect(screen.getByText('12,000')).toBeInTheDocument();
    expect(screen.getByText('241 Wh/mi')).toBeInTheDocument();
  });

  it('does not replace unknown readings with fabricated zero values', () => {
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
    renderWidget();
    expect(screen.queryByText('0.00 kWh')).not.toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByText('Energy stats')).toBeInTheDocument();
  });

  it('keeps the daily bar chart and honest empty state', () => {
    setup({ stats: makeQuery({ data: makeStats({ daily_breakdown: [] }) }) });
    renderWidget();
    expect(screen.getByText('No energy data available')).toBeInTheDocument();
  });

  it('uses WidgetShell freshness refresh and empty/loading/error states', () => {
    const refetch = vi.fn();
    setup({ stats: makeQuery({ data: makeStats(), error: new Error('refresh failed'), isError: true, refetch }) });
    renderWidget();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('resolves the explicit vehicle and first-vehicle fallback IDs', () => {
    setup();
    renderWidget({ cols: 2, rows: 4 }, 7);
    expect(mockEnergy).toHaveBeenCalledWith('7');
  });
});
