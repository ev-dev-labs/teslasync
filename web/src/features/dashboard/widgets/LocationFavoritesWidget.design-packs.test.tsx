import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, type UseQueryResult } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { useLocations } from '@/api/hooks/useLocations';
import { useLocationSnapshotLatest, useVehicles } from '@/api/hooks/useVehicles';
import type { LocationSnapshot, Vehicle } from '@/api/types';
import type { Location } from '@/types/location';
import LocationFavoritesWidget from './LocationFavoritesWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES } from './designPacks/types';
import type { WidgetSize } from './types';

vi.mock('@/api/hooks/useLocations', async () => ({
  ...await vi.importActual<typeof import('@/api/hooks/useLocations')>('@/api/hooks/useLocations'),
  useLocations: vi.fn(),
}));
vi.mock('@/api/hooks/useVehicles', async () => ({
  ...await vi.importActual<typeof import('@/api/hooks/useVehicles')>('@/api/hooks/useVehicles'),
  useVehicles: vi.fn(),
  useLocationSnapshotLatest: vi.fn(),
}));

function query<T>(data: T | undefined, overrides: Partial<UseQueryResult<T, Error>> = {}): UseQueryResult<T, Error> {
  return {
    data, error: null, isLoading: false, isPending: false, isFetching: false,
    isStale: false, isError: false, isSuccess: true, status: 'success',
    fetchStatus: 'idle', dataUpdatedAt: Date.now(), refetch: vi.fn(),
    ...overrides,
  } as UseQueryResult<T, Error>;
}

function place(id: string, addressName: string, visitCount: number): Location {
  return {
    id, addressName, visitCount, latitude: 37.123456, longitude: -122.654321,
    totalDurationS: 3600, lastVisited: null,
  };
}

function snapshot(): LocationSnapshot {
  return {
    id: 1, vehicle_id: 7, created_at: new Date().toISOString(),
    located_at_home: true, destination_name: 'Home',
    latitude: 37.123456, longitude: -122.654321,
  };
}

const vehicle: Vehicle = {
  id: 42, vehicle_id: 42, vin: 'TEST-VEHICLE', display_name: 'Test vehicle',
  model: 'Model 3', trim_badging: '', exterior_color: '', wheel_type: '',
  state: 'online', healthy: true, created_at: '', updated_at: '',
};
const sizes: WidgetSize[] = [{ cols: 1, rows: 1 }, { cols: 2, rows: 2 }];
const locRefetch = vi.fn();
const snapRefetch = vi.fn();

function renderWidget(packId: unknown = 'classic', size: WidgetSize = sizes[1]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (requestedPackId: unknown) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PackBoundary requestedPackId={requestedPackId}>
          <LocationFavoritesWidget vehicleId={7} size={size} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(packId));
  return { ...view, selectPack: (next: unknown) => view.rerender(tree(next)) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useVehicles).mockReturnValue(query([vehicle]));
  vi.mocked(useLocations).mockReturnValue(query([
    place('unknown', 'Unknown visits', Number.NaN),
    place('zero', 'Measured zero', 0),
    place('home', 'Home', 8),
  ], { refetch: locRefetch }));
  vi.mocked(useLocationSnapshotLatest).mockReturnValue(query<LocationSnapshot | null>(snapshot(), { refetch: snapRefetch }));
});

describe.each(Object.entries(PACK_APPEARANCES))('Favorite locations %s / %s', (packId, appearance) => {
  it.each(sizes)('preserves ranked readings, presence, privacy and refresh at $cols columns', async (size) => {
    const { container } = renderWidget(packId, size);
    await waitFor(() => expect(container.querySelector(
      `[data-widget-family="list"][data-widget-appearance="${appearance}"]`,
    )).not.toBeNull());

    expect(screen.getByRole('heading', { name: 'Favorite locations' })).toBeInTheDocument();
    expect(screen.getByText('Returned locations').previousElementSibling).toHaveTextContent('3');
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Home');
    expect(within(rows[0]).getByText('Here now')).toBeInTheDocument();
    expect(within(rows[0]).getByText('8 visits')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Current')).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent('Measured zero');
    expect(rows[1]).toHaveTextContent('0 visits');
    expect(rows[2]).toHaveTextContent('Unknown visits');
    expect(rows[2]).toHaveTextContent('Visit count unavailable');
    expect(screen.queryByText(/37\.123456|-122\.654321|TEST-VEHICLE/)).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(container.querySelector('[data-widget-family="list"] .lucide-map-pin')).not.toBeNull();
    expect(vi.mocked(useLocations)).toHaveBeenCalledWith('7');
    expect(vi.mocked(useLocationSnapshotLatest)).toHaveBeenCalledWith(7);
    expect(vi.mocked(useLocations)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(useLocationSnapshotLatest)).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(locRefetch).toHaveBeenCalledOnce();
    expect(snapRefetch).toHaveBeenCalledOnce();
  });

  it('keeps an authoritatively empty list visible without inventing a current location', async () => {
    vi.mocked(useLocations).mockReturnValue(query<Location[]>([], { refetch: locRefetch }));
    vi.mocked(useLocationSnapshotLatest).mockReturnValue(query<LocationSnapshot | null>(null, { refetch: snapRefetch }));
    const { container } = renderWidget(packId, sizes[0]);
    await waitFor(() => expect(container.querySelector(`[data-widget-appearance="${appearance}"]`)).not.toBeNull());
    expect(screen.getByText('Returned locations').previousElementSibling).toHaveTextContent('0');
    expect(screen.getByText('No favorite locations')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    expect(screen.queryByText('Other')).not.toBeInTheDocument();
    expect(screen.queryByText('Current')).not.toBeInTheDocument();
  });
});

it('preserves the default Classic list and recovers it after changing packs or receiving an unknown ID', async () => {
  const view = renderWidget();
  const assertClassic = () => {
    expect(view.container.querySelector('[data-widget-family]')).toBeNull();
    expect(screen.queryByText('Returned locations')).not.toBeInTheDocument();
    const row = screen.getAllByRole('listitem')[0];
    expect(row).toHaveTextContent('Here now · 8 visits');
    expect(within(row).getByText('Here now · 8 visits')).toHaveClass('whitespace-normal');
  };
  assertClassic();
  view.selectPack('v7');
  await waitFor(() => expect(view.container.querySelector('[data-widget-appearance="pixel"]')).not.toBeNull());
  view.selectPack('classic');
  assertClassic();
  view.selectPack('not-a-production-pack');
  assertClassic();
  fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
  expect(locRefetch).toHaveBeenCalledOnce();
  expect(snapRefetch).toHaveBeenCalledOnce();
});

it.each(sizes)('retains the original row limits and stable ties at $cols columns', async (size) => {
  vi.mocked(useLocations).mockReturnValue(query(
    Array.from({ length: 6 }, (_, index) => place(String(index), `Place ${index}`, 4)),
  ));
  const { container } = renderWidget('v3', size);
  await waitFor(() => expect(container.querySelector('[data-widget-appearance="precision"]')).not.toBeNull());
  const rows = screen.getAllByRole('listitem');
  expect(rows).toHaveLength(size.cols === 1 ? 3 : 5);
  rows.forEach((row, index) => expect(row).toHaveTextContent(`Place ${index}`));
  expect(screen.getByText('Returned locations').previousElementSibling).toHaveTextContent('6');
});

it('keeps compact ranked locations usable when the independent snapshot fails, with its own retry', async () => {
  vi.mocked(useLocationSnapshotLatest).mockReturnValue(query<LocationSnapshot | null>(undefined, {
    isError: true, error: new Error('snapshot unavailable'), refetch: snapRefetch,
  }));
  const { container } = renderWidget('v4', sizes[0]);
  await waitFor(() => expect(container.querySelector('[data-widget-appearance="owner"]')).not.toBeNull());
  expect(screen.getByText("Can't reach server")).toBeInTheDocument();
  expect(screen.getByText('Home')).toBeInTheDocument();
  expect(screen.queryByText('Current')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(snapRefetch).toHaveBeenCalledOnce();
  expect(locRefetch).not.toHaveBeenCalled();
});

it('keeps a failed location source unknown rather than reporting zero returned locations', async () => {
  vi.mocked(useLocations).mockReturnValue(query<Location[]>(undefined, {
    isError: true, error: new Error('locations unavailable'), refetch: locRefetch,
  }));
  const { container } = renderWidget('v2');
  await waitFor(() => expect(container.querySelector('[data-widget-appearance="elevated"]')).not.toBeNull());
  expect(screen.getByText('Returned locations').previousElementSibling).toHaveTextContent('—');
  expect(screen.getByText("Can't reach server")).toBeInTheDocument();
  expect(screen.queryByText('No favorite locations')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(locRefetch).toHaveBeenCalledOnce();
  expect(snapRefetch).not.toHaveBeenCalled();
});

it.each(['refresh-error', 'stale', 'paused'] as const)('retains rows without claiming current presence during %s', async (state) => {
  vi.mocked(useLocationSnapshotLatest).mockReturnValue(query<LocationSnapshot | null>(snapshot(), {
    isError: state === 'refresh-error',
    error: state === 'refresh-error' ? new Error('refresh failed') : null,
    isStale: state === 'stale',
    fetchStatus: state === 'paused' ? 'paused' : 'idle',
    refetch: snapRefetch,
  }));
  const { container } = renderWidget('v6');
  await waitFor(() => expect(container.querySelector('[data-widget-appearance="expressive"]')).not.toBeNull());
  expect(screen.getByText('Home')).toBeInTheDocument();
  expect(screen.getByText('8 visits')).toBeInTheDocument();
  expect(screen.queryByText('Current')).not.toBeInTheDocument();
  expect(screen.queryByText(/Here now/)).not.toBeInTheDocument();
  if (state !== 'stale') expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
});

it('keeps invalid visit counts distinct from measured zero', async () => {
  vi.mocked(useLocations).mockReturnValue(query([
    place('negative', 'Invalid negative', -1),
    place('fraction', 'Invalid fraction', 1.5),
    place('infinite', 'Invalid infinite', Number.POSITIVE_INFINITY),
    place('zero', 'Measured zero', 0),
  ]));
  const { container } = renderWidget('v5');
  await waitFor(() => expect(container.querySelector('[data-widget-appearance="iconic"]')).not.toBeNull());
  const rows = screen.getAllByRole('listitem');
  expect(rows[0]).toHaveTextContent('Measured zero');
  expect(rows[0]).toHaveTextContent('0 visits');
  rows.slice(1).forEach(row => expect(row).toHaveTextContent('Visit count unavailable'));
});

it('keeps the loading shell without fabricating a returned-location count', () => {
  vi.mocked(useLocations).mockReturnValue(query<Location[]>(undefined, { isLoading: true, isPending: true }));
  vi.mocked(useLocationSnapshotLatest).mockReturnValue(query<LocationSnapshot | null>(undefined, { isLoading: true, isPending: true }));
  const { container } = renderWidget('v1');
  expect(screen.getByRole('heading', { name: 'Favorite locations' })).toBeInTheDocument();
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(screen.queryByText('Returned locations')).not.toBeInTheDocument();
  expect(screen.queryByText('No favorite locations')).not.toBeInTheDocument();
});
