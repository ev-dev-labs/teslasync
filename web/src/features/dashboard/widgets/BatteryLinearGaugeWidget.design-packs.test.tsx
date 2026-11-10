import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DataStateSource } from '@/api/dataState';
import type { VehicleState } from '@/api/types';
import BatteryLinearGaugeWidget from './BatteryLinearGaugeWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';
import type { WidgetProps } from './types';

interface StateEvidence {
  state?: Partial<VehicleState>;
  live: boolean;
  freshness?: string;
  observedAt?: number;
  verifiedFields?: readonly string[];
}

const mocks = vi.hoisted(() => ({
  vehicles: vi.fn<() => { data: { id: number }[] }>(),
  state: vi.fn<(id: number) => DataStateSource<StateEvidence>>(),
  distance: 'mi' as 'mi' | 'km',
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: mocks.vehicles,
  useVehicleState: mocks.state,
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: mocks.distance } }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      if (typeof fallback !== 'string') return key;
      return Object.entries(options ?? {}).reduce(
        (text, [name, value]) => text.replace(`{{${name}}}`, String(value)), fallback,
      );
    },
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

function stateQuery(
  state: Partial<VehicleState> | undefined = {
    battery_level: 64, rated_range: 100_000, charge_limit_soc_pct: 80, is_charging: true,
  },
  overrides: Partial<DataStateSource<StateEvidence>> = {},
): DataStateSource<StateEvidence> {
  return {
    data: {
      state, live: true, freshness: 'fresh',
      observedAt: Date.now(), verifiedFields: ['is_charging'],
    },
    error: null, isLoading: false, isFetching: false, isError: false, isStale: false,
    dataUpdatedAt: Date.now(), refetch: vi.fn(),
    ...overrides,
  };
}

function renderWidget(packId: PackId, size: WidgetProps['size'] = { cols: 2, rows: 2 }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (pack: PackId, nextSize: WidgetProps['size']) => (
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <PackBoundary requestedPackId={pack}>
          <BatteryLinearGaugeWidget vehicleId={7} size={nextSize} />
        </PackBoundary>
      </QueryClientProvider>
    </MemoryRouter>
  );
  const view = render(tree(packId, size));
  return {
    ...view,
    update: (pack = packId, nextSize = size) => view.rerender(tree(pack, nextSize)),
  };
}

async function expectPresentation(container: HTMLElement, pack: Exclude<PackId, 'classic'>) {
  await waitFor(() => expect(container.querySelector(
    `[data-widget-family="ring"][data-widget-appearance="${PACK_APPEARANCES[pack]}"]`,
  )).toBeInTheDocument());
}

beforeEach(() => {
  mocks.distance = 'mi';
  mocks.vehicles.mockReset().mockReturnValue({ data: [{ id: 1 }] });
  mocks.state.mockReset().mockReturnValue(stateQuery());
});

describe.each(Object.keys(PACK_APPEARANCES) as Exclude<PackId, 'classic'>[])(
  'BatteryLinearGaugeWidget — %s',
  pack => {
    it('uses the ring family while retaining source readings, display units, charge limit and refresh', async () => {
      const refetch = vi.fn();
      mocks.state.mockReturnValue(stateQuery(undefined, { refetch }));
      const view = renderWidget(pack);
      await expectPresentation(view.container, pack);

      expect(screen.getByText('64')).toBeInTheDocument();
      expect(screen.getByText('62 mi range')).toBeInTheDocument();
      expect(screen.getByText('Charge limit 80%')).toBeInTheDocument();
      expect(screen.getByRole('meter', { name: 'Battery' })).toHaveAttribute('aria-valuenow', '64');
      expect(screen.getByRole('meter', { name: 'Battery' })).toHaveAttribute('aria-valuemax', '100');
      expect(screen.getByTestId('gauge-marker')).toHaveStyle({ left: '80%' });
      expect(view.container.querySelector('.widget-cell-stream')).toHaveClass('widget-state-motion');
      expect(view.container.querySelector('.widget-energy-stream')).toHaveClass('widget-state-motion');
      expect(screen.getByRole('img', { name: 'Charging' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
      expect(refetch).toHaveBeenCalledOnce();
      expect(mocks.state).toHaveBeenLastCalledWith(7);

      mocks.distance = 'km';
      mocks.state.mockReturnValue(stateQuery(undefined, {
        data: { state: { battery_level: 64, rated_range: 100_000, is_charging: true }, live: true },
      }));
      view.update();
      expect(screen.getByText('100 km range')).toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'Charging · Last reported' })).toBeInTheDocument();
      expect(view.container.querySelector('.widget-state-motion')).toBeNull();
    });

    it('retains the gauge on failed or paused background refresh without implying current charging', async () => {
      const view = renderWidget(pack);
      await expectPresentation(view.container, pack);
      for (const overrides of [
        { isError: true, error: new Error('refresh failed') },
        { fetchStatus: 'paused' as const },
      ]) {
        mocks.state.mockReturnValue(stateQuery(undefined, overrides));
        view.update();
        expect(view.container.querySelector('[data-data-state="stale"]')).toBeInTheDocument();
        expect(screen.getByRole('meter', { name: 'Battery' })).toHaveAttribute('aria-valuenow', '64');
        expect(screen.getByText('62 mi range')).toBeInTheDocument();
        expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
        expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'Charging · Last reported' })).toBeInTheDocument();
        expect(view.container.querySelector('.widget-state-motion')).toBeNull();
      }
    });

    it('preserves initial loading, failure, empty recovery and a measured zero as distinct states', async () => {
      const refetch = vi.fn();
      mocks.state.mockReturnValue(stateQuery(undefined, { data: undefined, isLoading: true }));
      const view = renderWidget(pack);
      expect(view.container.querySelector('[data-data-state="initial"]')).toHaveAttribute('aria-busy', 'true');
      expect(screen.queryByRole('meter')).not.toBeInTheDocument();
      expect(screen.queryByText('No battery data')).not.toBeInTheDocument();

      mocks.state.mockReturnValue(stateQuery(undefined, {
        data: undefined, isError: true, error: new Error('initial failure'), refetch,
      }));
      view.update();
      expect(screen.getByText("Can't reach server")).toBeInTheDocument();
      expect(screen.queryByText('No battery data')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
      expect(refetch).toHaveBeenCalledOnce();

      mocks.state.mockReturnValue(stateQuery(undefined, { data: { state: undefined, live: false } }));
      view.update();
      await expectPresentation(view.container, pack);
      expect(screen.getByText('No battery data')).toBeInTheDocument();
      expect(screen.queryByRole('meter')).not.toBeInTheDocument();

      mocks.state.mockReturnValue(stateQuery({
        battery_level: 0, rated_range: 0, charge_limit_soc_pct: 0, is_charging: false,
      }));
      view.update();
      expect(screen.getByRole('meter', { name: 'Battery' })).toHaveAttribute('aria-valuenow', '0');
      expect(screen.getByText('0 mi range')).toBeInTheDocument();
      expect(screen.getByText('Charge limit 0%')).toBeInTheDocument();
      expect(screen.getByTestId('gauge-marker')).toHaveStyle({ left: '0%' });
      expect(screen.getByRole('img', { name: 'Not charging' })).toBeInTheDocument();
      expect(view.container.querySelector('[data-charge-level="0"]')).toBeInTheDocument();
      expect(view.container.querySelector('.widget-state-motion')).toBeNull();
    });

    it('keeps unknown and invalid observations honest without losing a valid independent limit', async () => {
      mocks.state.mockReturnValue(stateQuery({
        battery_level: Number.NaN, rated_range: Number.NaN, charge_limit_soc_pct: 90,
      }));
      const view = renderWidget(pack);
      await expectPresentation(view.container, pack);
      expect(screen.getByText('—')).toBeInTheDocument();
      expect(screen.getByText('Limit')).toBeInTheDocument();
      expect(screen.getByText('90')).toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'Unknown' })).toBeInTheDocument();
      expect(screen.queryByRole('meter')).not.toBeInTheDocument();
      expect(screen.queryByText(/mi range/)).not.toBeInTheDocument();
      expect(screen.queryByText(/NaN|Infinity/)).not.toBeInTheDocument();

      for (const limit of [Number.NaN, Number.POSITIVE_INFINITY, -1, 101]) {
        mocks.state.mockReturnValue(stateQuery({
          battery_level: 64, rated_range: undefined, charge_limit_soc_pct: limit, is_charging: false,
        }));
        view.update();
        expect(screen.getByRole('meter', { name: 'Battery' })).toHaveAttribute('aria-valuenow', '64');
        expect(screen.queryByTestId('gauge-marker')).not.toBeInTheDocument();
        expect(screen.queryByText(/mi range/)).not.toBeInTheDocument();
        expect(screen.queryByText(/NaN|Infinity/)).not.toBeInTheDocument();
      }
    });

    it('preserves compact charging content and reveals range when the existing controller is resized', async () => {
      const view = renderWidget(pack, { cols: 1, rows: 1 });
      await expectPresentation(view.container, pack);
      expect(screen.getByRole('meter', { name: 'Battery' })).toHaveAttribute('aria-valuenow', '64');
      expect(screen.getByText('Charge limit 80%')).toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'Charging' })).toBeInTheDocument();
      expect(screen.queryByText('62 mi range')).not.toBeInTheDocument();
      view.update(pack, { cols: 2, rows: 2 });
      expect(screen.getByText('62 mi range')).toBeInTheDocument();
      expect(screen.getByRole('meter', { name: 'Battery' })).toHaveAttribute('aria-valuenow', '64');
    });
  },
);

it('switches every pack on the same controller without losing vehicle scope or retained readings', async () => {
  const refetch = vi.fn();
  mocks.state.mockReturnValue(stateQuery(undefined, { refetch }));
  const view = renderWidget('classic');
  for (const pack of PACK_IDS) {
    view.update(pack);
    if (pack !== 'classic') await expectPresentation(view.container, pack);
    expect(screen.getByRole('meter', { name: 'Battery' })).toHaveAttribute('aria-valuenow', '64');
    expect(screen.getByText('62 mi range')).toBeInTheDocument();
    expect(mocks.state).toHaveBeenLastCalledWith(7);
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
  }
  expect(refetch).toHaveBeenCalledTimes(PACK_IDS.length);
});
