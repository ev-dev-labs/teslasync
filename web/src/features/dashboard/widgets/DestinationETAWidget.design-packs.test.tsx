import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { LocationSnapshot } from '@/api/types';
import DestinationETAWidget from './DestinationETAWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES } from './designPacks/types';
import type { WidgetSize } from './types';

// Leaflet checks SVG support at import time; jsdom otherwise omits this browser capability.
vi.hoisted(() => {
  Object.defineProperty(SVGSVGElement.prototype, 'createSVGRect', {
    configurable: true, value: () => ({}),
  });
});
const mocks = vi.hoisted(() => ({
  vehicles: vi.fn(), snapshot: vi.fn(), units: vi.fn(), refresh: vi.fn(),
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => mocks.vehicles(),
  useLocationSnapshotLatest: (id: number) => mocks.snapshot(id),
}));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => mocks.units() }));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatTime: () => '5:03 PM' }),
}));
vi.mock('@/api/settings', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/settings')>(),
  getMapConfig: vi.fn().mockResolvedValue({ provider: 'free', api_key: '' }),
}));
vi.mock('@/api/hooks/useSettings', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/hooks/useSettings')>(),
  useSettings: () => ({ data: undefined, isPending: false, isLoading: false, isError: false, error: null }),
}));

interface SnapshotQuery {
  data: LocationSnapshot | null | undefined;
  error: Error | null;
  isError: boolean;
  isLoading: boolean;
  isPending: boolean;
  isFetching: boolean;
  isStale: boolean;
  fetchStatus: 'idle' | 'paused' | 'fetching';
  dataUpdatedAt: number;
  refetch: typeof mocks.refresh;
}

function snapshot(overrides: Partial<LocationSnapshot> = {}): LocationSnapshot {
  return {
    id: 1, vehicle_id: 7, created_at: '2026-11-06T12:00:00Z',
    destination_name: 'Library', minutes_to_arrival: 12, miles_to_arrival: 16093.44,
    ...overrides,
  };
}
function query(data: SnapshotQuery['data'], overrides: Partial<SnapshotQuery> = {}): SnapshotQuery {
  return {
    data, error: null, isError: false, isLoading: false, isPending: false,
    isFetching: false, isStale: false, fetchStatus: 'idle',
    dataUpdatedAt: Date.now(), refetch: mocks.refresh, ...overrides,
  };
}
const sizes: WidgetSize[] = [{ cols: 1, rows: 2 }, { cols: 2, rows: 2 }];
const clients: QueryClient[] = [];

function mount(packId: unknown = 'classic', size: WidgetSize = sizes[1]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const tree = (requestedPackId: unknown) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PackBoundary requestedPackId={requestedPackId}>
          <DestinationETAWidget vehicleId={7} size={size} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(packId));
  return { ...view, selectPack: (next: unknown) => view.rerender(tree(next)) };
}
async function presentation(container: HTMLElement, appearance: string) {
  await waitFor(() => expect(container.querySelector(
    `[data-widget-family="map"][data-widget-appearance="${appearance}"]`,
  )).not.toBeNull());
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.vehicles.mockReturnValue({ data: [{ id: 42 }] });
  mocks.units.mockReturnValue({ unitPrefs: { distance: 'mi' } });
  mocks.snapshot.mockReturnValue(query(snapshot()));
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
});

describe.each(Object.entries(PACK_APPEARANCES))('Destination ETA %s / %s', (packId, appearance) => {
  it.each(sizes)('preserves actual navigation, selected vehicle and refresh at $cols columns', async size => {
    const { container } = mount(packId, size);
    await presentation(container, appearance);
    expect(screen.getByRole('heading', { name: 'Destination ETA' })).toBeInTheDocument();
    expect(screen.getByText('Library')).toBeInTheDocument();
    expect(screen.getByText('ETA')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('min')).toBeInTheDocument();
    if (size.cols > 1) {
      expect(screen.getByText('Arrival')).toBeInTheDocument();
      expect(screen.getByText('5:03 PM')).toBeInTheDocument();
      expect(screen.getByText('Remaining')).toBeInTheDocument();
      expect(screen.getByText('10 mi')).toBeInTheDocument();
      expect(screen.getByText('Destination coordinates unavailable')).toBeInTheDocument();
    } else {
      expect(screen.queryByText('Arrival')).not.toBeInTheDocument();
      expect(screen.queryByText('Remaining')).not.toBeInTheDocument();
    }
    expect(container.querySelector('[data-widget-family="map"] .lucide-navigation2')).not.toBeNull();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(mocks.snapshot).toHaveBeenCalledExactlyOnceWith(7);
    expect(mocks.vehicles).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it('distinguishes missing and invalid readings from genuine zero', async () => {
    mocks.snapshot.mockReturnValue(query(snapshot({
      minutes_to_arrival: Number.NaN, miles_to_arrival: -1,
    })));
    const view = mount(packId);
    await presentation(view.container, appearance);
    expect(screen.getAllByText('—')).toHaveLength(3);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('5:03 PM')).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN|Infinity/)).not.toBeInTheDocument();
    mocks.snapshot.mockReturnValue(query(snapshot({ minutes_to_arrival: 0, miles_to_arrival: 0 })));
    view.selectPack(packId);
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('0 mi')).toBeInTheDocument();
    expect(screen.getByText('5:03 PM')).toBeInTheDocument();
  });

  it.each(['missing', 'idle'] as const)('keeps the %s navigation explanation and shell visible', async state => {
    mocks.snapshot.mockReturnValue(query(state === 'missing' ? null : snapshot({ destination_name: '' })));
    const { container } = mount(packId);
    await presentation(container, appearance);
    expect(screen.getByRole('heading', { name: 'Destination ETA' })).toBeInTheDocument();
    expect(screen.getByText(state === 'missing' ? 'No location data' : 'No active navigation')).toBeInTheDocument();
    if (state === 'idle') {
      expect(screen.getByText('Start a route in the car to see distance and arrival time here.')).toBeInTheDocument();
    }
    expect(screen.queryByText('12')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Destination map' })).not.toBeInTheDocument();
  });
});

it.each(sizes)('preserves default Classic and recovery after pack changes at $cols columns', async size => {
  const view = mount(undefined, size);
  const classic = () => {
    expect(view.container.querySelector('[data-widget-family]')).toBeNull();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.queryByText('Arrival')).not.toBeInTheDocument();
    expect(screen.queryByText('Destination coordinates unavailable')).not.toBeInTheDocument();
    if (size.cols > 1) {
      expect(screen.getByText('Library')).toBeInTheDocument();
      expect(screen.getByText('10 mi')).toBeInTheDocument();
      expect(screen.getByText('5:03 PM')).toBeInTheDocument();
    } else expect(screen.queryByText('Library')).not.toBeInTheDocument();
  };
  classic();
  view.selectPack('v7');
  await presentation(view.container, 'pixel');
  view.selectPack('classic');
  classic();
  view.selectPack('unknown-pack');
  classic();
});

it.each([{ lat: 37.78, lon: -122.41 }, { lat: 51.48, lon: 0 }])(
  'renders an interactive real destination map for $lat, $lon without inventing a route',
  async ({ lat, lon }) => {
    mocks.snapshot.mockReturnValue(query(snapshot({ destination_lat: lat, destination_lon: lon })));
    const { container } = mount('v1');
    await presentation(container, 'studio');
    const map = screen.getByRole('region', { name: 'Destination map' });
    expect(map.querySelector('.leaflet-container')).not.toBeNull();
    expect(within(map).getByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
    const marker = map.querySelector('path.leaflet-interactive');
    expect(marker).not.toBeNull();
    if (!marker) throw new Error('Expected the reported destination marker');
    expect(map.querySelectorAll('path.leaflet-interactive')).toHaveLength(1);
    fireEvent.click(marker);
    await waitFor(() => expect(map.querySelector('.leaflet-popup-content')).toHaveTextContent('Library'));
    expect(screen.queryByText('Destination coordinates unavailable')).not.toBeInTheDocument();
    expect(mocks.snapshot).toHaveBeenCalledExactlyOnceWith(7);
  },
);

it.each([[0, 0], [91, 20], [20, 181], [Number.POSITIVE_INFINITY, 20]])(
  'leaves an invalid destination fix (%s, %s) unknown while retaining ETA and user distance units',
  async (latitude, longitude) => {
    mocks.units.mockReturnValue({ unitPrefs: { distance: 'km' } });
    mocks.snapshot.mockReturnValue(query(snapshot({ destination_lat: latitude, destination_lon: longitude })));
    const { container } = mount('v3');
    await presentation(container, 'precision');
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('16 km')).toBeInTheDocument();
    expect(screen.getByText('Destination coordinates unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Destination map' })).not.toBeInTheDocument();
  },
);

it('retains cached navigation and source warning on refresh failure, with the original retry', async () => {
  mocks.snapshot.mockReturnValue(query(snapshot(), { error: new Error('refresh failed'), isError: true }));
  const { container } = mount('v4');
  await presentation(container, 'owner');
  expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
  expect(screen.getByText('Library')).toBeInTheDocument();
  expect(screen.getByText('12')).toBeInTheDocument();
  expect(screen.getByText('10 mi')).toBeInTheDocument();
  expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
  expect(mocks.refresh).toHaveBeenCalledOnce();
});

it('does not refresh navigation again while its source is already fetching', async () => {
  mocks.snapshot.mockReturnValue(query(snapshot(), { isFetching: true }));
  const { container } = mount('v5');
  await presentation(container, 'iconic');
  fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it('keeps loading and fatal failure honest without presenting cached or invented navigation', async () => {
  mocks.snapshot.mockReturnValue(query(undefined, { isLoading: true, isPending: true }));
  const view = mount('v2');
  expect(screen.getByRole('heading', { name: 'Destination ETA' })).toBeInTheDocument();
  expect(view.container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(screen.queryByText('No location data')).not.toBeInTheDocument();
  expect(screen.queryByText('12')).not.toBeInTheDocument();
  mocks.snapshot.mockReturnValue(query(undefined, { error: new Error('initial failure'), isError: true }));
  view.selectPack('v2');
  expect(await screen.findByText("Can't reach server")).toBeInTheDocument();
  expect(screen.queryByText('No active navigation')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(mocks.refresh).toHaveBeenCalledOnce();
});
