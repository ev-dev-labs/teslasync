import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { SecurityEvent, VehicleStateReadings } from '@/api/types';
import type { useVehicleState } from '@/api/hooks/useVehicles';
import type { Vehicle } from '@/types/vehicle';
import type { UnitPref } from '@/lib/unitConversion';
import { patchMatchMedia } from '@/test/setup';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, type PackId } from './designPacks/types';
import VehicleHeroCardWidget from './VehicleHeroCardWidget';
import type { WidgetSize } from './types';

type StateData = NonNullable<ReturnType<typeof useVehicleState>['data']>;
type ProductionPack = Exclude<PackId, 'classic'>;

const source = vi.hoisted(() => ({
  vehicles: [] as Vehicle[] | undefined,
  fleetLoading: false,
  fleetError: false,
  state: undefined as StateData | undefined,
  security: undefined as SecurityEvent | undefined,
  units: {} as UnitPref,
  query: {
    isLoading: false, isFetching: false, isStale: false, isError: false,
    error: null as Error | null, dataUpdatedAt: 0,
  },
  refetch: vi.fn(),
  refetchSecurity: vi.fn(),
  stateIds: vi.fn(),
  securityIds: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/hooks/useVehicles')>(),
  useVehicles: () => ({
    data: source.vehicles, isLoading: source.fleetLoading, isError: source.fleetError,
  }),
  useVehicleState: (id: number) => {
    source.stateIds(id);
    return { ...source.query, data: source.state, refetch: source.refetch };
  },
  useSecurityLatest: (id: number) => {
    source.securityIds(id);
    return { data: source.security, isError: false, refetch: source.refetchSecurity };
  },
}));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => ({ unitPrefs: source.units }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, values?: Record<string, unknown>) => {
      const options = typeof fallback === 'object' && fallback !== null
        ? fallback as Record<string, unknown> : values;
      return Object.entries(options ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        typeof fallback === 'string' ? fallback : key,
      );
    },
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}));

const packs = Object.keys(PACK_APPEARANCES) as ProductionPack[];
const clients: QueryClient[] = [];
let media: ReturnType<typeof patchMatchMedia>;

function vehicle(id: number, name: string): Vehicle {
  return {
    id, vehicle_id: id, display_name: name, vin: `TEST-VEHICLE-${id}`,
    model: 'Model 3', trim_badging: 'Long Range', exterior_color: 'DeepBlue',
    wheel_type: '', state: 'online', healthy: true, created_at: '', updated_at: '',
  };
}

function readings(overrides: Partial<VehicleStateReadings> = {}): VehicleStateReadings {
  return {
    vehicle_id: 7, state: 'online', latitude: null, longitude: null,
    speed: null, power: null, battery_level: 72, rated_range: null,
    ideal_range: 430_000, odometer: null, inside_temp: 21, outside_temp: 18,
    is_climate_on: null, is_charging: true, charger_power: 11_000,
    charge_rate: null, time_to_full_charge: null, is_locked: null,
    sentry_mode: null, software_version: null, ...overrides,
  };
}

function observed(overrides: Partial<VehicleStateReadings> = {}): StateData {
  const state = readings(overrides);
  return {
    state, live: true, observedAt: Date.now(), freshness: 'fresh',
    verifiedFields: Object.keys(state) as Array<keyof VehicleStateReadings>,
  };
}

function mountWidget(requestedPackId?: PackId, size: WidgetSize = { cols: 3, rows: 2 }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const tree = (pack?: PackId) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PackBoundary requestedPackId={pack}>
          <VehicleHeroCardWidget vehicleId={7} size={size} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(requestedPackId));
  return { ...view, selectPack: (pack: PackId) => view.rerender(tree(pack)) };
}

async function expectPack(container: HTMLElement, pack: ProductionPack) {
  await waitFor(() => {
    expect(container.querySelector(`[data-widget-appearance="${PACK_APPEARANCES[pack]}"]`))
      .toHaveAttribute('data-widget-family', 'vehicle');
  });
}

function expectOriginalArtwork(container: HTMLElement) {
  expect(container.querySelectorAll('[data-vehicle-studio]')).toHaveLength(1);
  expect(container.querySelector('[data-studio-layout="compact"]')).toHaveClass('h-24');
  const twin = container.querySelector('[data-vehicle-twin]');
  expect(twin).toBeInTheDocument();
  expect(twin?.querySelector('img')).toHaveAttribute('src', expect.stringContaining('model=m3'));
  expect(twin?.querySelector('img')).toHaveAttribute('src', expect.stringContaining('$PPSB'));
}

beforeEach(() => {
  vi.clearAllMocks();
  media = patchMatchMedia(query => query.includes('prefers-reduced-motion'));
  source.vehicles = [vehicle(3, 'Other vehicle'), vehicle(7, 'Aurora')];
  source.fleetLoading = false;
  source.fleetError = false;
  source.state = observed();
  source.security = {
    vehicle_id: 7, ts: new Date().toISOString(), event_type: 'lights',
    lights_high_beams: true, doors_open: null, windows_open: null, locked: null,
    sentry_mode: null, user_present: null, detail: null, source: 'signal_log',
    created_at: new Date().toISOString(),
  };
  source.query = {
    isLoading: false, isFetching: false, isStale: false, isError: false,
    error: null, dataUpdatedAt: Date.now(),
  };
  source.units = {
    distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
    energy: 'kWh', duration: 'h', power: 'kW', locale: 'en-US', precision: 2,
  };
});

afterEach(() => {
  cleanup();
  media.restore();
  clients.splice(0).forEach(client => client.clear());
});

describe.each(packs)('Vehicle hero %s', pack => {
  it('keeps the selected vehicle, real artwork, all full metrics, SI power and refresh', async () => {
    const { container } = mountWidget(pack);
    await expectPack(container, pack);
    expect(screen.getByText('Aurora')).toBeInTheDocument();
    expect(screen.queryByText('Other vehicle')).not.toBeInTheDocument();
    expect(screen.getByText('Model 3 Long Range')).toBeInTheDocument();
    expect(screen.getByText('online')).toBeInTheDocument();
    expect(screen.getByText('Battery')).toBeInTheDocument();
    expect(screen.getByText('72.00%')).toBeInTheDocument();
    expect(screen.getByText('430.00 km')).toBeInTheDocument();
    expect(screen.getByText('21.00°C')).toBeInTheDocument();
    expect(screen.getByText('18.00°C')).toBeInTheDocument();
    expect(screen.getByText('Charging')).toBeInTheDocument();
    expect(screen.getByText('11.00 kW')).toBeInTheDocument();
    expect(screen.getByText('⚡')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('progressbar', { name: 'Battery' })).toHaveAttribute('aria-valuenow', '72');
    expectOriginalArtwork(container);
    expect(source.stateIds).toHaveBeenLastCalledWith(7);
    expect(source.securityIds).toHaveBeenLastCalledWith(0);
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/ }));
    expect(source.refetch).toHaveBeenCalledOnce();
    expect(source.refetchSecurity).not.toHaveBeenCalled();
  });

  it('retains the compact battery, name, verified driving/lights and both refresh sources', async () => {
    source.state = observed({ state: 'driving', speed: 20, is_charging: false });
    const { container } = mountWidget(pack, { cols: 1, rows: 1 });
    await expectPack(container, pack);
    expect(screen.getByText('Aurora')).toBeInTheDocument();
    expect(screen.getByText('72.00%')).toBeInTheDocument();
    expect(screen.getByText('driving')).toBeInTheDocument();
    expect(screen.queryByText('Model 3 Long Range')).not.toBeInTheDocument();
    for (const label of ['Range', 'Cabin', 'Outside', 'Charging']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    expectOriginalArtwork(container);
    expect(container.querySelector('[data-vehicle-studio]')).toHaveAttribute('data-activity', 'driving');
    expect(screen.getByTestId('vehicle-road-motion')).toBeInTheDocument();
    expect(container.querySelector('[data-vehicle-road-lighting]')).toBeInTheDocument();
    expect(source.securityIds).toHaveBeenLastCalledWith(7);
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/ }));
    expect(source.refetch).toHaveBeenCalledOnce();
    expect(source.refetchSecurity).toHaveBeenCalledOnce();
  });

  it('keeps unverified readings unknown rather than claiming zero, online or charging', async () => {
    source.state = { ...observed({ state: 'driving', speed: 20 }), verifiedFields: [] };
    const { container } = mountWidget(pack);
    await expectPack(container, pack);
    expect(screen.getByText('Aurora')).toBeInTheDocument();
    expect(screen.getByText('unknown')).toBeInTheDocument();
    expect(container.querySelector('.widget-big-number')).toHaveTextContent('—');
    for (const label of ['Range', 'Cabin', 'Outside']) {
      expect(screen.getByText(label).parentElement).toHaveTextContent('—');
    }
    const meter = screen.getByRole('progressbar', { name: 'Battery' });
    expect(meter).not.toHaveAttribute('aria-valuenow');
    expect(meter).toHaveAttribute('aria-valuetext', 'No reading');
    expect(screen.queryByText('0.00%')).not.toBeInTheDocument();
    expect(screen.queryByText('online')).not.toBeInTheDocument();
    expect(screen.queryByText('Charging')).not.toBeInTheDocument();
    expect(screen.queryByTestId('vehicle-road-motion')).not.toBeInTheDocument();
    expect(container.querySelector('[data-vehicle-road-lighting]')).not.toBeInTheDocument();
    expectOriginalArtwork(container);
  });

  it('keeps the source shell and honest empty message without inventing a vehicle or scale', async () => {
    source.vehicles = [];
    source.state = undefined;
    const { container } = mountWidget(pack);
    await expectPack(container, pack);
    expect(screen.getByText('No vehicle data')).toBeInTheDocument();
    expect(screen.getByTestId('widget-body')).toBeInTheDocument();
    expect(container.querySelector('[data-vehicle-twin]')).not.toBeInTheDocument();
    expect(container.querySelector('.widget-big-number')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(source.stateIds).toHaveBeenLastCalledWith(0);
  });
});

it('preserves the original Classic body by default and after selecting every production pack', async () => {
  const { container, selectPack } = mountWidget();
  expect(container.querySelector('[data-widget-appearance]')).not.toBeInTheDocument();
  expect(container.querySelector('[data-vehicle-card-layout="short"]')).toBeInTheDocument();
  expect(screen.getByText('72.00%')).toBeInTheDocument();
  expectOriginalArtwork(container);
  const originalImage = container.querySelector('[data-vehicle-twin] img')?.getAttribute('src');
  for (const pack of packs) {
    selectPack(pack);
    await expectPack(container, pack);
    expect(screen.getByText('72.00%')).toBeInTheDocument();
    expect(screen.getByText('11.00 kW')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-vehicle-twin]')).toHaveLength(1);
    expect(container.querySelector('[data-vehicle-twin] img')).toHaveAttribute('src', originalImage);
  }
  selectPack('classic');
  expect(container.querySelector('[data-widget-appearance]')).not.toBeInTheDocument();
  expect(container.querySelector('[data-vehicle-card-layout="short"]')).toBeInTheDocument();
  expect(screen.getByText('Aurora')).toBeInTheDocument();
  expect(screen.getByText('72.00%')).toBeInTheDocument();
  expect(screen.getByText('430.00 km')).toBeInTheDocument();
  expect(screen.getByText('Outside')).toBeInTheDocument();
  expect(screen.getByText('11.00 kW')).toBeInTheDocument();
  expect(source.refetch).not.toHaveBeenCalled();
  expect(source.refetchSecurity).not.toHaveBeenCalled();
});

it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 101])(
  'does not turn invalid battery %s or nonfinite measurements into successful readings',
  async battery_level => {
    source.state = observed({
      battery_level, ideal_range: -1, inside_temp: Number.NaN, outside_temp: Number.POSITIVE_INFINITY,
    });
    const { container } = mountWidget('v7');
    await expectPack(container, 'v7');
    expect(container.querySelector('.widget-big-number')).toHaveTextContent('—');
    for (const label of ['Range', 'Cabin', 'Outside']) {
      expect(screen.getByText(label).parentElement).toHaveTextContent('—');
    }
    expect(screen.getByRole('progressbar', { name: 'Battery' })).not.toHaveAttribute('aria-valuenow');
    expect(container.querySelector('[data-metric-fill]')).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN|Infinity/)).not.toBeInTheDocument();
  },
);

it('keeps a genuine observed zero battery and range distinct from unknown', async () => {
  source.state = observed({ battery_level: 0, ideal_range: 0, inside_temp: 0 });
  const { container } = mountWidget('v7');
  await expectPack(container, 'v7');
  expect(screen.getByText('0.00%')).toBeInTheDocument();
  expect(screen.getByText('0.00 km')).toBeInTheDocument();
  expect(screen.getByText('0.00°C')).toBeInTheDocument();
  expect(screen.getByRole('progressbar', { name: 'Battery' })).toHaveAttribute('aria-valuenow', '0');
});

it('applies the user display units without altering raw readings', async () => {
  source.units = { ...source.units, distance: 'mi', temperature: '°F', power: 'W' };
  source.state = observed({ ideal_range: 160_934.4, inside_temp: 0, outside_temp: -10 });
  const { container } = mountWidget('v3');
  await expectPack(container, 'v3');
  expect(screen.getByText('100.00 mi')).toBeInTheDocument();
  expect(screen.getByText('32.00°F')).toBeInTheDocument();
  expect(screen.getByText('14.00°F')).toBeInTheDocument();
  expect(screen.getByText('11,000.00 W')).toBeInTheDocument();
  expect(source.state.state?.ideal_range).toBe(160_934.4);
  expect(source.state.state?.charger_power).toBe(11_000);
});

it('retains metrics and trust warnings on failed refresh without continuing verified driving', async () => {
  source.state = observed({ state: 'driving', speed: 20, is_charging: false });
  source.query.isError = true;
  source.query.isStale = true;
  source.query.error = new Error('Refresh unavailable');
  const { container } = mountWidget('v4');
  await expectPack(container, 'v4');
  expect(container.querySelector('[data-data-state="stale"]')).toBeInTheDocument();
  expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
  expect(screen.getByText('72.00%')).toBeInTheDocument();
  expect(screen.getByText('430.00 km')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(container.querySelector('[data-vehicle-studio]')).toHaveAttribute('data-activity', 'static');
  expect(screen.queryByTestId('vehicle-road-motion')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Refresh/ }));
  expect(source.refetch).toHaveBeenCalledOnce();
});

it('retains readings while refresh is in flight and prevents duplicate refreshes', async () => {
  source.query.isFetching = true;
  const { container } = mountWidget('v2');
  await expectPack(container, 'v2');
  expect(screen.getByText('72.00%')).toBeInTheDocument();
  const refresh = screen.getByRole('button', { name: /^Refresh/ });
  expect(refresh).toBeDisabled();
  fireEvent.click(refresh);
  expect(source.refetch).not.toHaveBeenCalled();
});

it('preserves initial-loading and fatal-error chrome instead of claiming a loaded pack', () => {
  source.state = undefined;
  source.query.isLoading = true;
  const { container, selectPack } = mountWidget('v6');
  expect(container.querySelector('[data-data-state="initial"]')).toHaveAttribute('aria-busy', 'true');
  expect(container.querySelector('[data-widget-appearance]')).not.toBeInTheDocument();
  expect(screen.queryByText('No vehicle data')).not.toBeInTheDocument();
  source.query.isLoading = false;
  source.query.isError = true;
  source.query.error = new Error('Vehicle state unavailable');
  selectPack('v6');
  expect(container.querySelector('[data-data-state="initialFailure"]')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(container.querySelector('[data-widget-appearance]')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /retry/i }));
  expect(source.refetch).toHaveBeenCalledOnce();
});
