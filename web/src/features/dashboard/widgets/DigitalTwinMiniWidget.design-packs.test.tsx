import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { SecurityEvent, ChargingTelemetry } from '@/api/types';
import type { RawStateResponse } from '@/api/hooks/useVehicles';
import type { Vehicle } from '@/types/vehicle';
import { BADGE_VARIANTS } from '@/components/ui';
import type { WidgetProps } from './types';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';
import DigitalTwinMiniWidget from './DigitalTwinMiniWidget';

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn<(path: string) => Promise<unknown>>(),
}));
vi.mock('@/api/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  request: requestMock,
}));
vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/setup');
  return createReactI18nextMock({ resources: { en: {
    digitalTwin: {
      title: 'Digital twin', doorDriverFront: 'Front left', doorDriverRear: 'Rear left',
      doorPassengerFront: 'Front right', doorPassengerRear: 'Rear right',
      windowFD: 'Front left', windowFP: 'Front right', windowRD: 'Rear left', windowRP: 'Rear right',
      chargePort: 'Charge port', sentryMode: 'Sentry mode', driving: 'Driving',
    },
    teslaOnly: { door: 'door', window: 'window' },
    common: {
      unknown: 'Unknown', open: 'Open', closed: 'Closed', on: 'On', off: 'Off',
      locked: 'Locked', unlocked: 'Unlocked', charging: 'Charging', notCharging: 'Not charging',
    },
    dayLog: { windowStates: { partial: 'Partially open' } },
  } } });
});
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: true, durationMs: 0 }),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatTime: (value: number | string | Date) => new Date(value).toISOString() }),
}));

const NOW = Date.parse('2026-11-07T02:25:00Z');
const OBSERVED = '2026-11-07T02:24:50Z';
const PACKS = PACK_IDS
  .filter((pack): pack is Exclude<PackId, 'classic'> => pack !== 'classic')
  .map(pack => [pack, PACK_APPEARANCES[pack]] as const);
const PATHS = ['/vehicles', '/vehicles/17/state', '/security/latest?vehicle_id=17', '/charging-telemetry/latest?vehicle_id=17'];
let client: QueryClient;
let vehicles: Vehicle[];
let security: SecurityEvent | null;
let state: RawStateResponse;
let charging: Partial<ChargingTelemetry> | null;
let failedPaths: Set<string>;

function tree(pack: PackId = 'classic', size: WidgetProps['size'] = { cols: 2, rows: 2 }) {
  return <QueryClientProvider client={client}><MemoryRouter><PackBoundary requestedPackId={pack}>
    <DigitalTwinMiniWidget vehicleId={17} size={size} />
  </PackBoundary></MemoryRouter></QueryClientProvider>;
}

async function settled() {
  await waitFor(() => expect(client.isFetching()).toBe(0));
}

async function presentation(container: HTMLElement, appearance: string) {
  await waitFor(() => expect(container.querySelector('[data-widget-family="twin"]'))
    .toHaveAttribute('data-widget-appearance', appearance));
  await settled();
}

function cell(label: string) {
  const item = screen.getByText(label).closest('[role="listitem"]');
  if (!(item instanceof HTMLElement)) throw new Error(`Missing status cell: ${label}`);
  return item;
}

function twin() {
  return screen.getByRole('img', { name: 'Digital twin' });
}

function photo() {
  const image = twin().querySelector('img');
  if (!image) throw new Error('Missing original vehicle compositor image');
  return image;
}

describe('DigitalTwinMiniWidget production design packs', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    requestMock.mockReset();
    window.localStorage.removeItem('teslasync:vehicle:17:paint');
    failedPaths = new Set();
    const vehicle: Vehicle = {
      id: 17, vehicle_id: 17, vin: 'TEST-ONLY-17', display_name: 'Selected test vehicle',
      model: 'Model 3', trim_badging: '', exterior_color: 'DeepBlue', wheel_type: '',
      state: 'online', healthy: true, created_at: OBSERVED, updated_at: OBSERVED,
    };
    vehicles = [{ ...vehicle, id: 11, vehicle_id: 11, display_name: 'Other test vehicle' }, vehicle];
    security = {
      vehicle_id: 17, ts: OBSERVED, created_at: OBSERVED, event_type: 'snapshot',
      doors_open: null, windows_open: 'Closed', locked: true, sentry_mode: true,
      user_present: null, detail: null, source: 'test',
    };
    state = { vehicle: { id: 17, state: 'online' }, live: false, observed_at: OBSERVED };
    charging = { vehicle_id: 17, ts: OBSERVED, charging_state: 'Stopped', charge_port_door_open: true };
    client = new QueryClient({ defaultOptions: { queries: {
      retry: false, gcTime: Infinity, refetchOnWindowFocus: false,
    } } });
    requestMock.mockImplementation(async path => {
      if (failedPaths.has(path)) throw new Error('Synthetic source unavailable');
      if (path === PATHS[0]) return vehicles;
      if (path === PATHS[1]) return state;
      if (path === PATHS[2]) return security;
      if (path === PATHS[3]) return charging;
      throw new Error(`Unexpected request: ${path}`);
    });
  });

  afterEach(() => {
    cleanup();
    client.clear();
    vi.restoreAllMocks();
  });

  it.each(PACKS)('%s keeps the selected real twin, openings, badges, full status and live refresh', async (pack, appearance) => {
    const view = render(tree(pack, { cols: 3, rows: 3 }));
    await presentation(view.container, appearance);

    expect(screen.getByText('Selected test vehicle')).toBeInTheDocument();
    expect(screen.queryByText('Other test vehicle')).not.toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: 'Digital twin' })).toHaveLength(1);
    expect(twin().querySelector('svg')).toBeInTheDocument();
    expect(twin()).toHaveAccessibleDescription(/Front left window: Closed/);
    expect(twin()).toHaveAccessibleDescription(/Front left door: Unknown/);
    expect(twin()).toHaveAccessibleDescription(/Charge port: Open/);
    expect(photo().getAttribute('src')).toContain('model=m3');
    expect(photo().getAttribute('src')).toContain('$PPSB');
    fireEvent.load(photo());
    expect(photo().style.opacity).toBe('1');
    expect(cell('Windows')).toHaveTextContent('Closed');
    expect(cell('Doors')).toHaveTextContent('Unknown');
    expect(cell('Doors')).toHaveAttribute('data-status', 'unknown');
    expect(screen.getByText('Locked')).toHaveClass('bg-[var(--semantic-success-bg)]');
    expect(screen.getAllByText('Sentry').some(item => item.className.includes('--semantic-info-bg'))).toBe(true);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/digital-twin');
    expect(view.container.querySelector('[data-instrument-family="twin"] .lucide-monitor')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

    security = { ...security!, locked: false, fp_window: 'Partial' };
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
    await screen.findByText('Unlocked');
    await settled();
    expect(cell('Windows')).toHaveTextContent('Partial');
    expect(twin()).toHaveAccessibleDescription(/Front right window: Partially open/);
    expect(twin().querySelector('svg.lucide-lock-open')).toBeInTheDocument();
    expect(twin().querySelector('svg.lucide-shield')).toBeInTheDocument();
    for (const path of PATHS) expect(requestMock.mock.calls.filter(([url]) => url === path)).toHaveLength(2);
  });

  it.each(PACKS)('%s keeps unknown lock, sentry, doors and windows honest in compact mode', async (pack, appearance) => {
    security = { ...security!, locked: null, sentry_mode: null, windows_open: null };
    charging = null;
    const view = render(tree(pack));
    await presentation(view.container, appearance);

    expect(cell('Windows')).toHaveTextContent('Unknown');
    expect(cell('Doors')).toHaveTextContent('Unknown');
    expect(screen.getByText('—').className).toContain(BADGE_VARIANTS.neutral);
    expect(screen.getByText('—')).not.toHaveClass('bg-[var(--semantic-success-bg)]');
    expect(screen.queryByText('Locked', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('Sentry', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('Closed', { exact: true })).not.toBeInTheDocument();
    expect(twin()).toHaveAccessibleDescription(/Front left window: Unknown/);
    expect(twin()).toHaveAccessibleDescription(/Charge port: Unknown/);
    expect(view.container.querySelector('[data-vehicle-studio]')).toHaveAttribute('data-activity', 'static');
    expect(screen.queryByTestId('vehicle-road-motion')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });

  it('switches Classic, all supported packs and cramped/full sizes without duplicating source subscriptions', async () => {
    const view = render(tree());
    await screen.findByRole('img', { name: 'Digital twin' });
    await settled();
    expect(view.container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    const requests = requestMock.mock.calls.length;

    for (const [pack, appearance] of PACKS) {
      view.rerender(tree(pack, pack === 'v1' ? { cols: 1, rows: 1 } : { cols: 3, rows: 3 }));
      await presentation(view.container, appearance);
      expect(twin()).toBeInTheDocument();
      expect(photo().getAttribute('src')).toContain('model=m3');
      if (pack === 'v1') {
        expect(screen.queryByText('Locked')).not.toBeInTheDocument();
        expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
      } else {
        expect(screen.getAllByRole('listitem')).toHaveLength(3);
      }
      const active = client.getQueryCache().getAll().filter(query => query.getObserversCount() > 0);
      expect(active).toHaveLength(4);
      for (const source of active) expect(source.getObserversCount()).toBe(1);
    }

    view.rerender(tree('classic', { cols: 3, rows: 1 }));
    expect(view.container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(requestMock).toHaveBeenCalledTimes(requests);
  });

  it.each(PACKS)('%s preserves the empty source shell and unknown lock without fabricated vehicle art', async (pack, appearance) => {
    vehicles = [];
    const view = render(tree(pack));
    await presentation(view.container, appearance);
    expect(screen.getByText('No vehicle data')).toBeInTheDocument();
    expect(cell('Lock')).toHaveTextContent('Unknown');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(requestMock.mock.calls.map(([path]) => path)).toEqual(['/vehicles']);
  });

  it.each(PACKS)('%s only reports closed openings when every window and cabin door is known closed', async (pack, appearance) => {
    security = { ...security!, door_state: 'ClosedAll' };
    const view = render(tree(pack));
    await presentation(view.container, appearance);
    expect(cell('Windows')).toHaveTextContent('Closed');
    expect(cell('Doors')).toHaveTextContent('Closed');

    security = { ...security!, windows_open: null, fd_window: 'Closed', fp_window: 'Closed', rd_window: 'Closed',
      door_state: '{"DriverFront":false,"PassengerFront":false,"DriverRear":false}' };
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
    await waitFor(() => expect(cell('Windows')).toHaveTextContent('Unknown'));
    await settled();
    expect(cell('Doors')).toHaveTextContent('Unknown');
    expect(cell('Doors')).toHaveAttribute('data-status', 'unknown');
  });

  it.each(PACKS)('%s keeps the loading shell without flashing empty or fabricated readings before discovery resolves', async (pack, appearance) => {
    let release: ((value: Vehicle[]) => void) | undefined;
    requestMock.mockImplementationOnce(() => new Promise<Vehicle[]>(resolve => { release = resolve; }));
    const view = render(tree(pack));
    expect(view.container.querySelector(`[data-widget-pack="${pack}"]`)).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText('No vehicle data')).not.toBeInTheDocument();
    if (!release) throw new Error('Vehicle discovery did not start');
    const resolve = release;
    await act(async () => { resolve(vehicles); });
    await presentation(view.container, appearance);
    expect(twin()).toBeInTheDocument();
  });

  it.each(PACKS)('%s preserves verified activity without inventing motion from zero, invalid or untrusted readings', async (pack, appearance) => {
    const drivingState: RawStateResponse = {
      vehicle: { id: 17, state: 'online' }, position: { speed: 12 },
      live: true, observed_at: OBSERVED, freshness: 'fresh', verified_fields: ['speed'],
    };
    state = drivingState;
    security = { ...security!, lights_high_beams: true };
    const view = render(tree(pack));
    await presentation(view.container, appearance);
    expect(view.container.querySelector('[data-vehicle-studio]')).toHaveAttribute('data-activity', 'driving');
    expect(screen.getByTestId('vehicle-road-motion')).toBeInTheDocument();
    expect(view.container.querySelector('[data-vehicle-road-lighting]')).toBeInTheDocument();

    const untrustedStates: RawStateResponse[] = [
      { ...drivingState, position: { speed: 0 } },
      { ...drivingState, position: { speed: Number.NaN } },
      { ...drivingState, observed_at: 'invalid-observation' },
      { ...drivingState, freshness: 'stale' },
      { ...drivingState, verified_fields: [] },
      { ...drivingState, is_charging: true, verified_fields: ['speed', 'is_charging'] },
    ];
    for (const reading of untrustedStates) {
      state = reading;
      fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
      await settled();
      await waitFor(() => expect(view.container.querySelector('[data-vehicle-studio]')).toHaveAttribute('data-activity', 'static'));
      expect(screen.queryByTestId('vehicle-road-motion')).not.toBeInTheDocument();
      expect(view.container.querySelector('[data-vehicle-road-lighting]')).not.toBeInTheDocument();
      expect(twin()).toBeInTheDocument();
      expect(screen.getByText('Locked')).toBeInTheDocument();
    }

    state = drivingState;
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
    await waitFor(() => expect(screen.getByTestId('vehicle-road-motion')).toBeInTheDocument());
    await settled();
  });

  it.each(PACKS)('%s retains the actual twin and measured overlays after refresh failure, with warning and recovery', async (pack, appearance) => {
    state = {
      vehicle: { id: 17, state: 'online' }, position: { speed: 12 },
      live: true, observed_at: OBSERVED, freshness: 'fresh', verified_fields: ['speed'],
    };
    const view = render(tree(pack));
    await presentation(view.container, appearance);
    expect(screen.getByTestId('vehicle-road-motion')).toBeInTheDocument();
    const imageUrl = photo().getAttribute('src');
    failedPaths.add(PATHS[1]);
    failedPaths.add(PATHS[2]);
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
    await waitFor(() => expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('data-data-state', 'stale'));
    expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent('Previously loaded data remains visible');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(photo()).toHaveAttribute('src', imageUrl);
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(twin().querySelector('svg.lucide-shield')).toBeInTheDocument();
    expect(cell('Windows')).toHaveTextContent('Closed');
    expect(screen.queryByTestId('vehicle-road-motion')).not.toBeInTheDocument();

    failedPaths.clear();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
    await waitFor(() => expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument());
    expect(twin()).toBeInTheDocument();
    expect(screen.getByTestId('vehicle-road-motion')).toBeInTheDocument();
  });

  it.each(PACKS)('%s does not mask initial telemetry failures with vehicle metadata, and retries the original sources', async (pack, appearance) => {
    failedPaths = new Set(PATHS.slice(1));
    const view = render(tree(pack));
    const alert = await screen.findByRole('alert');
    expect(view.container.querySelector('[data-data-state="initialFailure"]')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText('No vehicle data')).not.toBeInTheDocument();

    failedPaths.clear();
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await presentation(view.container, appearance);
    expect(twin()).toBeInTheDocument();
    expect(cell('Windows')).toHaveTextContent('Closed');
  });
});
