import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DailyEnergy, EnergyStats } from '@/types/energy';
import type { UnitPref } from '@/lib/unitConversion';
import EnergyStatsWidget from './EnergyStatsWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import type { WidgetProps } from './types';

type EnergyFixture = Omit<EnergyStats,
  'total_energy_used_wh' | 'total_energy_charged_wh' | 'avg_efficiency_wh_per_m' | 'co2_saved_kg' | 'daily_breakdown'
> & {
  total_energy_used_wh: number | null;
  total_energy_charged_wh: number | null;
  avg_efficiency_wh_per_m: number | null;
  co2_saved_kg: number | null;
  daily_breakdown: Array<Omit<DailyEnergy, 'energy_wh'> & { energy_wh: number | null }>;
};

interface QueryFixture<T> {
  data: T | undefined;
  error: Error | null;
  isLoading: boolean;
  isPending: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  fetchStatus: 'idle' | 'fetching' | 'paused';
  dataUpdatedAt: number;
  refetch: Mock<() => Promise<void>>;
}

const sources = vi.hoisted(() => ({
  energy: vi.fn<(vehicleId: string | null) => QueryFixture<EnergyFixture>>(),
  vehicles: vi.fn<() => QueryFixture<Array<{ id: number }>>>(),
  units: vi.fn<() => { unitPrefs: UnitPref }>(),
}));

vi.mock('@/api/hooks/useEnergy', () => ({ useEnergyStats: sources.energy }));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: sources.vehicles }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: sources.units }));

const productionPacks = [
  ['v1', 'studio'],
  ['v2', 'elevated'],
  ['v3', 'precision'],
  ['v4', 'owner'],
  ['v5', 'iconic'],
  ['v6', 'expressive'],
  ['v7', 'pixel'],
] as const;

const unitPrefs: UnitPref = {
  distance: 'km',
  speed: 'km/h',
  temperature: '°C',
  pressure: 'bar',
  energy: 'kWh',
  duration: 'h',
  power: 'kW',
  locale: 'en-US',
};

function makeQuery<T>(data: T | undefined, over: Partial<QueryFixture<T>> = {}): QueryFixture<T> {
  return {
    data,
    error: null,
    isLoading: false,
    isPending: false,
    isFetching: false,
    isStale: false,
    isError: false,
    fetchStatus: 'idle',
    dataUpdatedAt: Date.now(),
    refetch: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    ...over,
  };
}

function day(date: string, energy_wh: number | null): EnergyFixture['daily_breakdown'][number] {
  return { date, energy_wh, cost: 0, distance_m: 0, efficiency_wh_per_m: 0.12 };
}

function stats(over: Partial<EnergyFixture> = {}): EnergyFixture {
  return {
    vehicle_id: 7,
    period_days: 30,
    total_energy_used_wh: 12_000,
    total_energy_charged_wh: 15_000,
    total_wh: 12_000,
    total_cost: 4.5,
    total_distance_m: 100_000,
    avg_efficiency_wh_per_m: 0.12,
    co2_saved_kg: 3.2,
    daily_breakdown: [day('2026-11-05', 5_000), day('2026-11-06', 7_000)],
    ...over,
  };
}

function widgetTree(pack: string, props: Partial<WidgetProps> = { vehicleId: 7 }) {
  return (
    <MemoryRouter>
      <PackBoundary requestedPackId={pack}>
        <EnergyStatsWidget {...props} size={props.size ?? { cols: 2, rows: 4 }} />
      </PackBoundary>
    </MemoryRouter>
  );
}

function chartRows() {
  const table = screen.getByRole('table', { name: 'Energy stats — data table' });
  return within(table).getAllByRole('row').slice(1).map(row =>
    within(row).getAllByRole('cell').map(cell => cell.textContent),
  );
}

async function expectAppearance(container: HTMLElement, appearance: string) {
  await waitFor(() => {
    expect(container.querySelector('[data-widget-family="bars"]'))
      .toHaveAttribute('data-widget-appearance', appearance);
  });
  expect(container.querySelectorAll('[data-widget-family="bars"]')).toHaveLength(1);
}

beforeEach(() => {
  vi.clearAllMocks();
  sources.energy.mockReturnValue(makeQuery(stats()));
  sources.vehicles.mockReturnValue(makeQuery([{ id: 42 }]));
  sources.units.mockReturnValue({ unitPrefs });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(0, 0, 600, 240));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe.each(productionPacks)('Energy stats %s (%s)', (pack, appearance) => {
  it('keeps the real daily chart, all metrics, estimate disclosure and retained-data refresh', async () => {
    const query = makeQuery(stats(), {
      error: new Error('Synthetic background refresh failure'),
      isError: true,
      isStale: true,
    });
    sources.energy.mockReturnValue(query);
    const { container } = render(widgetTree(pack));
    await expectAppearance(container, appearance);

    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'stale');
    expect(screen.getByText('Total used')).toBeInTheDocument();
    expect(screen.getByText('12.0')).toBeInTheDocument();
    expect(screen.getByText('Total charged')).toBeInTheDocument();
    expect(screen.getByText('15.0')).toBeInTheDocument();
    expect(screen.getByText('Avg efficiency')).toBeInTheDocument();
    expect(screen.getByText('120 Wh/km')).toBeInTheDocument();
    expect(screen.getByText('CO₂ saved')).toBeInTheDocument();
    expect(screen.getByText('3.20')).toBeInTheDocument();
    expect(screen.getByText('kg')).toBeInTheDocument();
    expect(screen.getByText('CO₂ savings are estimated.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Daily driving energy usage' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Daily usage (kWh)' })).toBeInTheDocument();
    expect(chartRows()).toEqual([['Nov 5', '5'], ['Nov 6', '7']]);
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(container.querySelector('[data-widget-family="bars"] svg.lucide-zap')).not.toBeNull();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(sources.energy).toHaveBeenLastCalledWith('7');
    await waitFor(() => expect(container.querySelectorAll('pattern')).toHaveLength(pack === 'v7' ? 2 : 0));
    if (pack === 'v7') {
      for (const bar of container.querySelectorAll('.recharts-bar-rectangle path')) {
        expect(bar.getAttribute('fill')).toMatch(/^url\(#bar-/);
      }
    }

    fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));
    expect(query.refetch).toHaveBeenCalledOnce();
    expect(screen.getByText('12.0')).toBeInTheDocument();
    expect(chartRows()).toHaveLength(2);
  });

  it('preserves the compact single-headline branch', async () => {
    const { container } = render(widgetTree(pack, { vehicleId: 7, size: { cols: 1, rows: 2 } }));
    await expectAppearance(container, appearance);
    expect(screen.getByText('Total used')).toBeInTheDocument();
    expect(screen.getByText('12.0')).toBeInTheDocument();
    expect(screen.getByText('kWh')).toBeInTheDocument();
    expect(screen.queryByText('Total charged')).not.toBeInTheDocument();
    expect(screen.queryByText('Avg efficiency')).not.toBeInTheDocument();
    expect(screen.queryByText('CO₂ saved')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Daily driving energy usage' })).not.toBeInTheDocument();
  });

  it('retains unknown sections, chart gaps, measured zero and signed samples without fabricating a scale', async () => {
    sources.energy.mockReturnValue(makeQuery(stats({
      total_energy_used_wh: null,
      total_energy_charged_wh: null,
      avg_efficiency_wh_per_m: Number.NaN,
      co2_saved_kg: null,
      daily_breakdown: [
        day('2026-11-05', 5_000), day('2026-11-06', null),
        day('2026-11-07', 0), day('2026-11-08', -1_000),
      ],
    })));
    const view = render(widgetTree(pack));
    await expectAppearance(view.container, appearance);
    expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'partial');
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText('NaN')).not.toBeInTheDocument();
    expect(chartRows()).toEqual([['Nov 5', '5'], ['Nov 6', '—'], ['Nov 7', '0'], ['Nov 8', '-1']]);
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();

    sources.energy.mockReturnValue(makeQuery<EnergyFixture>(undefined, { dataUpdatedAt: 0 }));
    view.rerender(widgetTree(pack));
    await expectAppearance(view.container, appearance);
    expect(screen.getByText('Total used')).toBeInTheDocument();
    expect(screen.getByText('Total charged')).toBeInTheDocument();
    expect(screen.getByText('Avg efficiency')).toBeInTheDocument();
    expect(screen.getByText('CO₂ saved')).toBeInTheDocument();
    expect(screen.getByText('No energy data available')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(screen.queryByText('0.0')).not.toBeInTheDocument();
  });
});

it.each(['classic', 'retired-pack'])('preserves the original Classic body and recovery for %s', pack => {
  const { container } = render(widgetTree(pack));
  expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', 'classic');
  expect(container.querySelector('[data-widget-appearance]')).toBeNull();
  expect(screen.getByText('12.0')).toBeInTheDocument();
  expect(screen.getByText('15.0')).toBeInTheDocument();
  expect(screen.getByText('120 Wh/km')).toBeInTheDocument();
  expect(chartRows()).toEqual([['Nov 5', '5'], ['Nov 6', '7']]);
  expect(screen.queryByText('CO₂ savings are estimated.')).not.toBeInTheDocument();
});

it('changes presentation without multiplying charts and converts every sample at the display boundary', async () => {
  const view = render(widgetTree('classic'));
  for (const [pack, appearance] of productionPacks) {
    view.rerender(widgetTree(pack));
    await expectAppearance(view.container, appearance);
    expect(screen.getAllByRole('table')).toHaveLength(1);
    expect(screen.getByText('12.0')).toBeInTheDocument();
  }
  sources.units.mockReturnValue({
    unitPrefs: { ...unitPrefs, energy: 'Wh', distance: 'mi', speed: 'mph' },
  });
  view.rerender(widgetTree('v7'));
  expect(screen.getByText('12,000')).toBeInTheDocument();
  expect(screen.getByText('193 Wh/mi')).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Daily usage (Wh)' })).toBeInTheDocument();
  expect(chartRows()).toEqual([['Nov 5', '5000'], ['Nov 6', '7000']]);

  view.rerender(widgetTree('classic'));
  expect(view.container.querySelector('[data-widget-appearance]')).toBeNull();
  expect(screen.getByText('12,000')).toBeInTheDocument();
});

it('keeps configured vehicle selection and the first-vehicle fallback through pack changes', async () => {
  const view = render(widgetTree('v4', { config: { vehicleId: 9 } }));
  await expectAppearance(view.container, 'owner');
  expect(sources.energy).toHaveBeenLastCalledWith('9');
  view.rerender(widgetTree('v7', {}));
  await expectAppearance(view.container, 'pixel');
  expect(sources.energy).toHaveBeenLastCalledWith('42');
});

it('retains the source shell through initial loading, fatal failure and recovery', async () => {
  sources.energy.mockReturnValue(makeQuery<EnergyFixture>(undefined, {
    isLoading: true, isPending: true, isFetching: true, fetchStatus: 'fetching', dataUpdatedAt: 0,
  }));
  const view = render(widgetTree('v3'));
  expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'initial');
  expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('aria-busy', 'true');
  expect(screen.queryByText('12.0')).not.toBeInTheDocument();

  const failed = makeQuery<EnergyFixture>(undefined, {
    error: new Error('Synthetic initial failure'), isError: true, dataUpdatedAt: 0,
  });
  sources.energy.mockReturnValue(failed);
  view.rerender(widgetTree('v3'));
  expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'initialFailure');
  expect(view.container.querySelector('[data-widget-appearance]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));
  expect(failed.refetch).toHaveBeenCalledOnce();

  sources.energy.mockReturnValue(makeQuery(stats()));
  view.rerender(widgetTree('v3'));
  await expectAppearance(view.container, 'precision');
  expect(screen.getByText('12.0')).toBeInTheDocument();
  expect(chartRows()).toHaveLength(2);
});
