import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { VehicleStateReadings } from '@/api/types';
import type { useVehicleState } from '@/api/hooks/useVehicles';
import EnergyFlowAnimatedWidget from './EnergyFlowAnimatedWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES } from './designPacks/types';
import type { WidgetProps } from './types';

type StatePayload = NonNullable<ReturnType<typeof useVehicleState>['data']>;

interface Query<T> {
  data: T | undefined;
  error: Error | null;
  isLoading: boolean;
  isPending: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  fetchStatus: 'idle' | 'fetching' | 'paused';
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn<() => void>>;
}

const sources = vi.hoisted(() => ({
  vehicles: vi.fn<() => Query<Array<{ id: number }>>>(),
  state: vi.fn<(id: number, options?: { refetchInterval?: number | false }) => Query<StatePayload>>(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: sources.vehicles,
  useVehicleState: sources.state,
}));

function query<T>(data: T | undefined, over: Partial<Query<T>> = {}): Query<T> {
  return {
    data, error: null, isLoading: false, isPending: false, isFetching: false,
    isStale: false, isError: false, fetchStatus: 'idle', dataUpdatedAt: Date.now(),
    refetch: vi.fn<() => void>(), ...over,
  };
}

function stateQuery(
  readings: Partial<VehicleStateReadings> = {},
  payload: Partial<StatePayload> = {},
  options: Partial<Query<StatePayload>> = {},
): Query<StatePayload> {
  const state: VehicleStateReadings = {
    vehicle_id: 8, state: 'online', latitude: 0, longitude: 0, speed: 0,
    power: 14_000, battery_level: 72, rated_range: 0, ideal_range: 0,
    odometer: 0, inside_temp: 20, outside_temp: 18, is_climate_on: false,
    is_charging: true, charger_power: 11, charge_rate: 0, time_to_full_charge: 0,
    is_locked: true, sentry_mode: false, software_version: '', ...readings,
  };
  return query<StatePayload>({
    state, live: true, observedAt: Date.now(), freshness: 'fresh',
    verifiedFields: ['power', 'battery_level', 'charger_power', 'is_charging'],
    ...payload,
  }, options);
}

function tree(pack: string, props: Partial<WidgetProps> = {}) {
  return (
    <MemoryRouter>
      <PackBoundary requestedPackId={pack}>
        <EnergyFlowAnimatedWidget size={{ cols: 2, rows: 2 }} {...props} />
      </PackBoundary>
    </MemoryRouter>
  );
}

async function expectPack(container: HTMLElement, appearance: string) {
  await waitFor(() => {
    expect(container.querySelector('[data-widget-family="flow"]'))
      .toHaveAttribute('data-widget-appearance', appearance);
  });
  expect(container.querySelectorAll('[data-widget-family="flow"]')).toHaveLength(1);
}

function diagram() {
  return screen.getByRole('img', { name: /^Energy flow:/ });
}

function activeDirections() {
  return Array.from(diagram().querySelectorAll('[data-flow-edge].flow-active'),
    edge => edge.getAttribute('d'));
}

beforeEach(() => {
  sources.vehicles.mockReset();
  sources.state.mockReset();
  sources.vehicles.mockReturnValue(query([{ id: 42 }]));
  sources.state.mockReturnValue(stateQuery());
});

afterEach(cleanup);

describe.each(Object.entries(PACK_APPEARANCES))('Energy flow %s (%s)', (pack, appearance) => {
  it('preserves the complete three-node flow, both active directions, actual values and refresh', async () => {
    const source = stateQuery();
    sources.state.mockReturnValue(source);
    const { container } = render(tree(pack, { vehicleId: 8, config: { vehicleId: 77 } }));
    await expectPack(container, appearance);

    expect(screen.getByRole('heading', { name: 'Energy flow' })).toBeVisible();
    expect(screen.getByText('Vehicle energy flow')).toBeInTheDocument();
    expect(screen.getByText('Charging')).toBeInTheDocument();
    expect(screen.getByText('72.00%')).toBeInTheDocument();
    expect(screen.getByText('14.00 kW')).toBeInTheDocument();
    expect(screen.getAllByText('11.00 kW')).toHaveLength(2);
    expect(within(diagram()).getByText('Wall connector')).toBeInTheDocument();
    expect(within(diagram()).getByText('Battery')).toBeInTheDocument();
    expect(within(diagram()).getByText('Consuming')).toBeInTheDocument();
    expect(Array.from(diagram().querySelectorAll('[data-flow-node]'),
      node => node.getAttribute('data-flow-node'))).toEqual(['charger', 'battery', 'drive']);
    expect(diagram().querySelectorAll('[data-flow-edge]')).toHaveLength(3);
    expect(activeDirections()).toEqual([
      'M180 75 C240 75 240 75 300 75',
      'M60 75 C120 75 120 75 180 75',
    ]);
    expect(Array.from(diagram().querySelectorAll('[data-flow-edge].flow-active'),
      edge => edge.getAttribute('stroke-dasharray'))).toEqual(['9 23', '9 23']);
    expect(container.querySelector('[data-widget-family="flow"] svg.lucide-zap')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(sources.state).toHaveBeenCalledTimes(1);
    expect(sources.state).toHaveBeenCalledWith(8, { refetchInterval: 5_000 });

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(source.refetch).toHaveBeenCalledOnce();
    expect(screen.getAllByRole('img', { name: /^Energy flow:/ })).toHaveLength(1);
  });

  it('preserves the compact battery and absolute regen reading without adding a diagram', async () => {
    sources.state.mockReturnValue(stateQuery({ power: -15_000, is_charging: false }));
    const { container } = render(tree(pack, { size: { cols: 1, rows: 2 } }));
    await expectPack(container, appearance);

    expect(screen.getByText('72.00%')).toBeInTheDocument();
    expect(screen.getByText('15.00 kW')).toBeInTheDocument();
    expect(screen.getByText('Regenerating')).toBeInTheDocument();
    expect(screen.queryByText('-15.00 kW')).not.toBeInTheDocument();
    expect(screen.queryByText('Charger')).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /^Energy flow:/ })).not.toBeInTheDocument();
    expect(container.querySelector('[data-widget-family="flow"] svg.lucide-zap')).toBeInTheDocument();
  });

  it('keeps unverified mapper defaults unknown, not idle, zero or active charging', async () => {
    sources.state.mockReturnValue(stateQuery(
      { power: 0, battery_level: 0, charger_power: 0, is_charging: true },
      { live: false, freshness: 'unknown', verifiedFields: [] },
    ));
    const { container } = render(tree(pack));
    await expectPack(container, appearance);

    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'partial');
    expect(screen.getAllByText('Unknown')).toHaveLength(2);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('Standby')).not.toBeInTheDocument();
    expect(screen.queryByText('Charging')).not.toBeInTheDocument();
    expect(screen.queryByText('0.00%')).not.toBeInTheDocument();
    expect(screen.queryByText('0.00 kW')).not.toBeInTheDocument();
    expect(diagram().querySelector('[data-flow-node="charger"]')).not.toBeInTheDocument();
    expect(activeDirections()).toEqual([]);
    expect(diagram().closest('.widget-flow-frame')).toHaveAttribute('data-motion-suppressed', 'true');
  });

  it('retains cached regen direction, values, last success and nonblocking refresh warnings', async () => {
    const updatedAt = Date.now() - 60_000;
    sources.state.mockReturnValue(stateQuery(
      { power: -15_000, is_charging: false },
      { live: false, freshness: 'stale' },
      { isError: true, error: new Error('Synthetic refresh failure'), dataUpdatedAt: updatedAt },
    ));
    const { container } = render(tree(pack));
    await expectPack(container, appearance);

    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'stale');
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-motion-suppressed', 'true');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    expect(screen.getByText('72.00%')).toBeInTheDocument();
    expect(screen.getAllByText('15.00 kW')).toHaveLength(2);
    expect(activeDirections()).toEqual(['M300 75 C240 75 240 75 180 75']);
    expect(diagram().querySelectorAll('[data-flow-edge]')).toHaveLength(2);
    expect(diagram().closest('.widget-flow-frame')).toHaveAttribute('data-motion-suppressed', 'true');
  });

  it('keeps the source shell and honest empty explanation when no state exists', async () => {
    sources.state.mockReturnValue(stateQuery({}, {
      state: undefined, live: false, observedAt: null, freshness: 'unknown', verifiedFields: [],
    }));
    const { container } = render(tree(pack));
    await expectPack(container, appearance);

    expect(screen.getByRole('heading', { name: 'Energy flow' })).toBeInTheDocument();
    expect(screen.getByText('No energy data available')).toBeInTheDocument();
    expect(screen.queryByText('Vehicle energy flow')).not.toBeInTheDocument();
    expect(screen.queryByText('0.00 kW')).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /^Energy flow:/ })).not.toBeInTheDocument();
    expect(container.querySelector('[data-widget-family="flow"] svg.lucide-zap')).toBeInTheDocument();
  });
});

it.each(['classic', 'retired-pack'])('preserves the original Classic body and recovery for %s', pack => {
  const { container } = render(tree(pack));
  expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', 'classic');
  expect(container.querySelector('[data-widget-appearance]')).not.toBeInTheDocument();
  expect(screen.queryByText('Vehicle energy flow')).not.toBeInTheDocument();
  expect(screen.queryByText('Charging')).not.toBeInTheDocument();
  expect(screen.getByText('72.00%')).toBeInTheDocument();
  expect(screen.getByText('11.00 kW')).toBeInTheDocument();
  expect(screen.getByText('14.00 kW')).toBeInTheDocument();
  expect(diagram().querySelectorAll('[data-flow-node]')).toHaveLength(3);
});

it('preserves full/compact branches and configured/fallback vehicle scope across every pack change', async () => {
  const view = render(tree('classic', { config: { vehicleId: 77 } }));
  expect(sources.state).toHaveBeenLastCalledWith(77, { refetchInterval: 5_000 });
  for (const [pack, appearance] of Object.entries(PACK_APPEARANCES)) {
    view.rerender(tree(pack, { config: { vehicleId: 77 } }));
    await expectPack(view.container, appearance);
    expect(screen.getAllByRole('img', { name: /^Energy flow:/ })).toHaveLength(1);
    expect(sources.state).toHaveBeenLastCalledWith(77, { refetchInterval: 5_000 });
  }
  view.rerender(tree('classic', { size: { cols: 1, rows: 1 } }));
  expect(view.container.querySelector('[data-widget-appearance]')).not.toBeInTheDocument();
  expect(screen.getByText('72.00%')).toBeInTheDocument();
  expect(screen.getByText('11.00 kW')).toBeInTheDocument();
  expect(screen.queryByText('Standby')).not.toBeInTheDocument();
  expect(screen.queryByRole('img', { name: /^Energy flow:/ })).not.toBeInTheDocument();
  expect(sources.state).toHaveBeenLastCalledWith(42, { refetchInterval: 5_000 });
});

it('distinguishes measured zero from invalid and missing readings without inventing motion', async () => {
  sources.state.mockReturnValue(stateQuery({ power: 0, is_charging: false, battery_level: 0 }));
  const view = render(tree('v7'));
  await expectPack(view.container, 'pixel');
  expect(screen.getByText('0.00 kW')).toBeInTheDocument();
  expect(screen.getByText('0.00%')).toBeInTheDocument();
  expect(screen.getAllByText('Standby')).toHaveLength(2);
  expect(activeDirections()).toEqual([]);

  sources.state.mockReturnValue(stateQuery({ power: Number.NaN, battery_level: null, is_charging: false }));
  view.rerender(tree('v7'));
  expect(screen.getAllByText('Unknown')).toHaveLength(2);
  expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  expect(screen.queryByText('0.00 kW')).not.toBeInTheDocument();
  expect(screen.queryByText('0.00%')).not.toBeInTheDocument();
  expect(screen.queryByText('NaN')).not.toBeInTheDocument();
  expect(activeDirections()).toEqual([]);
});

it('does not animate an old observation just because its HTTP poll completed recently', async () => {
  const observedAt = Date.now() - 180_000;
  sources.state.mockReturnValue(stateQuery({}, { observedAt }, { dataUpdatedAt: Date.now() }));
  const { container } = render(tree('v1'));
  await expectPack(container, 'studio');

  expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'stale');
  expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
  expect(screen.getByText('72.00%')).toBeInTheDocument();
  expect(screen.getByText('14.00 kW')).toBeInTheDocument();
  expect(diagram().closest('.widget-flow-frame')).toHaveAttribute('data-motion-suppressed', 'true');
});

it('retains discovery/loading/error source shells and recovers into the requested presentation', async () => {
  sources.vehicles.mockReturnValue(query<Array<{ id: number }>>(undefined, { isLoading: true }));
  sources.state.mockReturnValue(query<StatePayload>(undefined, { dataUpdatedAt: 0 }));
  const view = render(tree('v3'));
  expect(sources.state).toHaveBeenLastCalledWith(0, { refetchInterval: 5_000 });
  expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('aria-busy', 'true');
  expect(screen.queryByText('No energy data available')).not.toBeInTheDocument();
  expect(screen.queryByRole('img', { name: /^Energy flow:/ })).not.toBeInTheDocument();

  sources.vehicles.mockReturnValue(query([{ id: 42 }]));
  sources.state.mockReturnValue(query<StatePayload>(undefined, {
    isError: true, error: new Error('Synthetic initial failure'), dataUpdatedAt: 0,
  }));
  view.rerender(tree('v3'));
  expect(screen.getByText("Can't reach server")).toBeInTheDocument();
  expect(screen.queryByText('No energy data available')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Energy flow' })).toBeInTheDocument();

  sources.state.mockReturnValue(stateQuery());
  view.rerender(tree('v3'));
  await expectPack(view.container, 'precision');
  expect(diagram()).toBeInTheDocument();
  expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
});
