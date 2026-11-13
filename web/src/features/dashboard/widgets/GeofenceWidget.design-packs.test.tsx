import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DataStateSource } from '@/api/dataState';
import type { VehicleStateFreshness, VerifiedVehicleStateField } from '@/api/hooks/useVehicles';
import type { Geofence } from '@/types/location';
import { CHART_NEUTRAL, CHART_SEMANTIC } from '@/lib/colors';
import GeofenceWidget from './GeofenceWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES } from './designPacks/types';
import type { WidgetSize } from './types';

const mocks = vi.hoisted(() => ({
  vehicles: vi.fn(),
  state: vi.fn(),
  fences: vi.fn(),
  stateRefetch: vi.fn(),
  fenceRefetch: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => mocks.vehicles(),
  useVehicleState: (id: number) => mocks.state(id),
}));
vi.mock('@/api/hooks/useLocations', () => ({
  useGeofences: () => mocks.fences(),
}));

interface MapProps {
  center: [number, number];
  zoom: number;
  scrollWheelZoom: boolean;
  zoomControl: boolean;
  dragging: boolean;
  children?: ReactNode;
}

interface CircleProps {
  center: [number, number];
  radius: number;
  pathOptions: { color?: string; fillColor?: string; fillOpacity?: number; weight?: number };
}

// Keep the real map frame, detail list, shell, boundary and lazy presentation.
// Only Leaflet's DOM-dependent primitives are replaced.
vi.mock('@/components/maps', async () => {
  const { vehicleIcon } = await vi.importActual<typeof import('@/components/maps/vehicleIcon')>('@/components/maps/vehicleIcon');
  return {
    vehicleIcon,
    MapContainer: ({ children, center, zoom, scrollWheelZoom, zoomControl, dragging }: MapProps) => (
      <div data-testid="leaflet-map" data-center={JSON.stringify(center)} data-zoom={zoom}
        data-scroll-wheel-zoom={String(scrollWheelZoom)} data-zoom-control={String(zoomControl)}
        data-dragging={String(dragging)}>
        {children}
      </div>
    ),
    MapInvalidator: () => null,
    MapTileLayer: ({ style }: { style?: string }) => <div data-testid="map-tiles" data-map-style={style} />,
    Circle: ({ center, radius, pathOptions }: CircleProps) => (
      <div data-testid="fence-circle" data-center={JSON.stringify(center)} data-radius={radius}
        data-color={pathOptions.color} data-fill={pathOptions.fillColor}
        data-opacity={pathOptions.fillOpacity} data-weight={pathOptions.weight} />
    ),
    Marker: ({ position, title }: { position: [number, number]; title?: string }) => (
      <div data-testid="vehicle-marker" data-position={JSON.stringify(position)} title={title} />
    ),
  };
});

vi.mock('./shared', async () => ({
  WidgetMapView: (await import('./shared/WidgetMapView')).WidgetMapView,
  WidgetDetailCard: (await import('./shared/WidgetDetailCard')).WidgetDetailCard,
}));

interface StateFixture {
  state?: { latitude: number | null; longitude: number | null };
  live: boolean;
  observedAt: number | null;
  freshness: VehicleStateFreshness;
  verifiedFields: readonly VerifiedVehicleStateField[];
}

const latitude = 37.7749;
const longitude = -122.4194;
const full: WidgetSize = { cols: 2, rows: 4 };
const compact: WidgetSize = { cols: 1, rows: 1 };
const short: WidgetSize = { cols: 2, rows: 2 };
const sizes = [['full', full], ['compact', compact]] as const;
const packs = Object.entries(PACK_APPEARANCES);

function stateFixture(overrides: Partial<StateFixture> = {}): StateFixture {
  return {
    state: { latitude, longitude }, live: true, observedAt: Date.now(),
    freshness: 'fresh', verifiedFields: ['latitude', 'longitude'], ...overrides,
  };
}

function query<T>(data: T | undefined, overrides: Partial<DataStateSource<T>> = {}): DataStateSource<T> {
  return {
    data, error: null, isPending: false, isLoading: false, isFetching: false,
    isStale: false, isError: false, fetchStatus: 'idle',
    dataUpdatedAt: data === undefined ? 0 : Date.now(), ...overrides,
  };
}

function fence(overrides: Partial<Geofence> = {}): Geofence {
  return {
    id: 'home', name: 'Home', latitude, longitude, radius: 500,
    enabled: true, alertOnEntry: false, alertOnExit: false, origin: 'manual',
    needsReview: false, createdAt: '2026-11-01T12:00:00Z', ...overrides,
  };
}

const fences = [
  fence(),
  fence({ id: 'work', name: 'Work', latitude: 37.3382, longitude: -121.8863, radius: 2000 }),
  fence({ id: 'off', name: 'Disabled zone', enabled: false, radius: 250 }),
];

function renderWidget(requestedPackId?: unknown, size = full) {
  const tree = (packId: unknown) => (
    <MemoryRouter>
      <PackBoundary requestedPackId={packId}>
        <GeofenceWidget size={size} vehicleId={77} />
      </PackBoundary>
    </MemoryRouter>
  );
  const view = render(tree(requestedPackId));
  return { ...view, selectPack: (next: unknown) => view.rerender(tree(next)) };
}

async function appearance(container: HTMLElement, name: string) {
  await waitFor(() => expect(container.querySelector(
    `[data-widget-family="map"][data-widget-appearance="${name}"]`,
  )).toBeInTheDocument(), { timeout: 5000 });
}

function configuredList(container: HTMLElement): HTMLElement {
  const list = container.querySelector<HTMLElement>('dl.widget-detail-list');
  expect(list).toBeInTheDocument();
  if (!list) throw new Error('Configured fence list did not render');
  return list;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.vehicles.mockReturnValue({ data: [{ id: 5 }] });
  mocks.state.mockReturnValue(query(stateFixture(), { refetch: mocks.stateRefetch }));
  mocks.fences.mockReturnValue(query(fences, { refetch: mocks.fenceRefetch }));
});
afterEach(cleanup);

describe.each(packs)('geofence-status %s / %s', (packId, name) => {
  it.each(sizes)('preserves the source sections and dual-source refresh in %s size', async (_label, size) => {
    const { container } = renderWidget(packId, size);
    await appearance(container, name);

    expect(screen.getByRole('heading', { name: 'Geofence status' })).toBeInTheDocument();
    expect(screen.getByText('Last reported membership')).toBeInTheDocument();
    expect(container.querySelector('[data-widget-family="map"] .lucide-crosshair')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(mocks.state).toHaveBeenCalledWith(77);
    expect(mocks.state).toHaveBeenCalledOnce();
    expect(mocks.fences).toHaveBeenCalledOnce();

    if (size.cols === 1) {
      expect(screen.getByText('Home')).toHaveClass('text-[var(--semantic-success)]');
      expect(screen.queryByText('Work')).not.toBeInTheDocument();
      expect(screen.queryByTestId('leaflet-map')).not.toBeInTheDocument();
      expect(container.querySelector('.widget-detail-list')).toBeNull();
    } else {
      const list = within(configuredList(container));
      expect(list.getAllByRole('term')).toHaveLength(3);
      expect(list.getByText('Home')).toBeInTheDocument();
      expect(list.getByText('Inside')).toHaveClass('text-[var(--semantic-success)]');
      expect(list.getByText('Work')).toBeInTheDocument();
      expect(list.getByText('Outside')).toBeInTheDocument();
      expect(list.getByText('Disabled zone')).toBeInTheDocument();
      expect(list.getByText('Disabled')).toHaveClass('text-[var(--text-secondary)]');
      const map = screen.getByTestId('leaflet-map');
      expect(map).toHaveAttribute('data-center', JSON.stringify([latitude, longitude]));
      expect(map).toHaveAttribute('data-zoom', '12');
      expect(map).toHaveAttribute('data-scroll-wheel-zoom', 'true');
      expect(map).toHaveAttribute('data-zoom-control', 'true');
      expect(map).toHaveAttribute('data-dragging', 'true');
      const circles = screen.getAllByTestId('fence-circle');
      expect(circles.map(circle => circle.getAttribute('data-radius'))).toEqual(['500', '2000', '250']);
      expect(circles.map(circle => circle.getAttribute('data-color'))).toEqual([
        CHART_SEMANTIC.vehicle.online, CHART_NEUTRAL, CHART_NEUTRAL,
      ]);
      circles.forEach(circle => {
        expect(circle).toHaveAttribute('data-opacity', '0.15');
        expect(circle).toHaveAttribute('data-weight', '2');
        expect(circle.getAttribute('data-fill')).toBe(circle.getAttribute('data-color'));
      });
      expect(screen.getByTestId('vehicle-marker')).toHaveAttribute('data-position', JSON.stringify([latitude, longitude]));
      expect(screen.getByTestId('vehicle-marker')).toHaveAttribute('title', 'Vehicle position');
    }

    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/ }));
    expect(mocks.stateRefetch).toHaveBeenCalledOnce();
    expect(mocks.fenceRefetch).toHaveBeenCalledOnce();
  });

  it('keeps an authoritatively empty configuration separate from the actual position', async () => {
    mocks.fences.mockReturnValue(query<Geofence[]>([], { refetch: mocks.fenceRefetch }));
    const { container } = renderWidget(packId);
    await appearance(container, name);
    expect(screen.getByText('No geofences configured')).toBeInTheDocument();
    expect(screen.getByTestId('vehicle-marker')).toHaveAttribute('data-position', JSON.stringify([latitude, longitude]));
    expect(screen.queryByTestId('fence-circle')).not.toBeInTheDocument();
    expect(screen.queryByText('Inside')).not.toBeInTheDocument();
    expect(screen.queryByText('Outside')).not.toBeInTheDocument();
    expect(container.querySelector('.widget-detail-list')).toBeNull();
  });

  it('retains configured fences while missing position leaves membership unknown', async () => {
    mocks.state.mockReturnValue(query(stateFixture({ state: undefined }), { refetch: mocks.stateRefetch }));
    const { container } = renderWidget(packId);
    await appearance(container, name);
    const list = within(configuredList(container));
    expect(list.getByText('Home')).toBeInTheDocument();
    expect(list.getByText('Work')).toBeInTheDocument();
    expect(list.getByText('Disabled')).toBeInTheDocument();
    expect(list.getAllByText('—')).toHaveLength(2);
    expect(screen.getByText('No location data available')).toBeInTheDocument();
    expect(screen.queryByTestId('leaflet-map')).not.toBeInTheDocument();
    expect(screen.queryByText('Inside')).not.toBeInTheDocument();
    expect(screen.queryByText('Outside')).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN|Infinity|undefined/)).not.toBeInTheDocument();
  });
});

it.each([full, compact])('preserves Classic and unknown-ID recovery at $cols columns', async size => {
  const view = renderWidget(undefined, size);
  const assertClassic = () => {
    expect(view.container.querySelector('[data-widget-family]')).toBeNull();
    expect(screen.queryByText('Last reported membership')).not.toBeInTheDocument();
    if (size.cols > 1) {
      expect(within(configuredList(view.container)).getAllByRole('term')).toHaveLength(3);
      expect(screen.getAllByTestId('fence-circle')).toHaveLength(3);
    } else {
      expect(screen.getByText('Home')).toBeInTheDocument();
      expect(screen.queryByTestId('leaflet-map')).not.toBeInTheDocument();
    }
  };
  assertClassic();
  view.selectPack('v7');
  await appearance(view.container, 'pixel');
  view.selectPack('classic');
  assertClassic();
  view.selectPack('unrecognized-pack');
  assertClassic();
  fireEvent.click(screen.getByRole('button', { name: /^Refresh data/ }));
  expect(mocks.stateRefetch).toHaveBeenCalledOnce();
  expect(mocks.fenceRefetch).toHaveBeenCalledOnce();
});

describe.each(packs)('geofence-status states %s / %s', (packId, name) => {
  it('preserves the short full-width list branch without adding a map', async () => {
    const { container } = renderWidget(packId, short);
    await appearance(container, name);
    expect(within(configuredList(container)).getAllByRole('term')).toHaveLength(3);
    expect(screen.queryByTestId('leaflet-map')).not.toBeInTheDocument();
  });

  it.each([full, compact])('preserves the outside/no-zone distinction at $cols columns', async size => {
    mocks.fences.mockReturnValue(query([fences[1]], { refetch: mocks.fenceRefetch }));
    const { container } = renderWidget(packId, size);
    await appearance(container, name);
    expect(screen.getByText('No zone')).toBeInTheDocument();
    expect(screen.queryByText('Inside')).not.toBeInTheDocument();
    if (size.cols > 1) {
      expect(within(configuredList(container)).getByText('Outside')).toBeInTheDocument();
    } else {
      expect(screen.queryByText('Work')).not.toBeInTheDocument();
    }
  });

  it.each([
    ['nonfinite position', { latitude: Number.NaN, longitude }],
    ['null island', { latitude: 0, longitude: 0 }],
    ['out-of-range position', { latitude: 91, longitude }],
    ['absent latitude', { latitude: null, longitude }],
  ] as const)('does not manufacture a map or membership from %s', async (_label, state) => {
    mocks.state.mockReturnValue(query(stateFixture({ state }), { refetch: mocks.stateRefetch }));
    const { container } = renderWidget(packId);
    await appearance(container, name);
    expect(within(configuredList(container)).getByText('Home')).toBeInTheDocument();
    expect(screen.queryByTestId('leaflet-map')).not.toBeInTheDocument();
    expect(screen.queryByText('Inside')).not.toBeInTheDocument();
    expect(screen.queryByText('Outside')).not.toBeInTheDocument();
  });

  it.each([
    { latitude: 0, longitude },
    { latitude, longitude: 0 },
  ])('preserves zero-radius membership at $latitude, $longitude', async state => {
    mocks.state.mockReturnValue(query(stateFixture({ state }), { refetch: mocks.stateRefetch }));
    mocks.fences.mockReturnValue(query([fence({ ...state, radius: 0 })], { refetch: mocks.fenceRefetch }));
    const { container } = renderWidget(packId);
    await appearance(container, name);
    expect(within(configuredList(container)).getByText('Inside')).toHaveClass('text-[var(--semantic-success)]');
    expect(screen.getByTestId('vehicle-marker')).toHaveAttribute('data-position', JSON.stringify([state.latitude, state.longitude]));
    expect(screen.getByTestId('fence-circle')).toHaveAttribute('data-radius', '0');
    expect(screen.getByTestId('fence-circle')).toHaveAttribute('data-color', CHART_SEMANTIC.vehicle.online);
    expect(screen.queryByText('Current membership is unconfirmed')).not.toBeInTheDocument();
  });

  it('keeps invalid fence geometry unknown while retaining the actual vehicle position', async () => {
    mocks.fences.mockReturnValue(query([
      fence({ id: 'bad-radius', name: 'Unknown radius', radius: Number.NaN }),
      fence({ id: 'bad-center', name: 'Unknown center', longitude: Number.POSITIVE_INFINITY }),
    ], { refetch: mocks.fenceRefetch }));
    const { container } = renderWidget(packId);
    await appearance(container, name);
    const list = within(configuredList(container));
    expect(list.getByText('Unknown radius')).toBeInTheDocument();
    expect(list.getByText('Unknown center')).toBeInTheDocument();
    expect(list.getAllByText('—')).toHaveLength(2);
    expect(screen.getByTestId('vehicle-marker')).toBeInTheDocument();
    expect(screen.queryByTestId('fence-circle')).not.toBeInTheDocument();
    expect(screen.queryByText('Inside')).not.toBeInTheDocument();
    expect(screen.queryByText('Outside')).not.toBeInTheDocument();
    expect(screen.queryByText('No zone')).not.toBeInTheDocument();
  });

  it.each([
    ['unverified fields', () => ({ verifiedFields: [] })],
    ['unknown freshness', () => ({ freshness: 'unknown', observedAt: null })],
    ['historical source', () => ({ live: false })],
    ['old observation', () => ({ observedAt: Date.now() - 180_000 })],
    ['future observation', () => ({ observedAt: Date.now() + 180_000 })],
  ] satisfies Array<[string, () => Partial<StateFixture>]>)('does not promote %s to confirmed membership', async (_label, overrides) => {
    mocks.state.mockReturnValue(query(stateFixture(overrides()), { refetch: mocks.stateRefetch }));
    const { container } = renderWidget(packId);
    await appearance(container, name);
    expect(screen.getByText('Current membership is unconfirmed')).toBeInTheDocument();
    expect(within(configuredList(container)).getByText('Inside')).toHaveClass('text-[var(--text-secondary)]');
    expect(screen.getAllByTestId('fence-circle').every(circle => circle.getAttribute('data-color') === CHART_NEUTRAL)).toBe(true);
  });

  it.each(['state', 'fences', 'paused', 'stale'] as const)('retains map and membership during %s degradation without success styling', async source => {
    if (source === 'fences') {
      mocks.fences.mockReturnValue(query(fences, {
        isError: true, error: new Error('Fence refresh failed'), refetch: mocks.fenceRefetch,
      }));
    } else {
      mocks.state.mockReturnValue(query(stateFixture(), {
        isError: source === 'state', error: source === 'state' ? new Error('Position refresh failed') : null,
        fetchStatus: source === 'paused' ? 'paused' : 'idle', isStale: source === 'stale',
        refetch: mocks.stateRefetch,
      }));
    }
    const { container } = renderWidget(packId);
    await appearance(container, name);
    expect(within(configuredList(container)).getByText('Inside')).toHaveClass('text-[var(--text-secondary)]');
    expect(screen.getAllByTestId('fence-circle')).toHaveLength(3);
    expect(screen.getAllByTestId('fence-circle').every(circle => circle.getAttribute('data-color') === CHART_NEUTRAL)).toBe(true);
    expect(screen.getByText('Current membership is unconfirmed')).toBeInTheDocument();
    if (source !== 'stale') expect(screen.getAllByTestId('stale-refresh-warning').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/ }));
    expect(mocks.stateRefetch).toHaveBeenCalledOnce();
    expect(mocks.fenceRefetch).toHaveBeenCalledOnce();
  });

  it.each(['state', 'fences'] as const)('keeps the independent source usable with a source-specific %s retry', async source => {
    if (source === 'state') {
      mocks.state.mockReturnValue(query<StateFixture>(undefined, {
        isError: true, error: new Error('Position unavailable'), refetch: mocks.stateRefetch,
      }));
    } else {
      mocks.fences.mockReturnValue(query<Geofence[]>(undefined, {
        isError: true, error: new Error('Configuration unavailable'), refetch: mocks.fenceRefetch,
      }));
    }
    const { container } = renderWidget(packId);
    await appearance(container, name);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No geofences configured')).not.toBeInTheDocument();
    if (source === 'state') {
      expect(within(configuredList(container)).getByText('Home')).toBeInTheDocument();
      expect(screen.queryByText('Inside')).not.toBeInTheDocument();
      expect(screen.queryByText('Outside')).not.toBeInTheDocument();
      expect(screen.queryByTestId('leaflet-map')).not.toBeInTheDocument();
    } else {
      expect(screen.getByTestId('vehicle-marker')).toBeInTheDocument();
      expect(screen.queryByTestId('fence-circle')).not.toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.stateRefetch).toHaveBeenCalledTimes(source === 'state' ? 1 : 0);
    expect(mocks.fenceRefetch).toHaveBeenCalledTimes(source === 'fences' ? 1 : 0);
  });

  it('keeps an unresolved configuration unknown instead of reporting an empty configuration', async () => {
    mocks.fences.mockReturnValue(query<Geofence[]>(undefined, { refetch: mocks.fenceRefetch }));
    const { container } = renderWidget(packId);
    await appearance(container, name);
    expect(screen.getByText('Geofence configuration unavailable')).toBeInTheDocument();
    expect(screen.queryByText('No geofences configured')).not.toBeInTheDocument();
    expect(screen.getByTestId('vehicle-marker')).toBeInTheDocument();
    expect(screen.queryByText('Outside')).not.toBeInTheDocument();
  });

  it('keeps the map visible while the independent configuration is loading', async () => {
    mocks.fences.mockReturnValue(query<Geofence[]>(undefined, {
      isPending: true, isLoading: true, isFetching: true, refetch: mocks.fenceRefetch,
    }));
    const { container } = renderWidget(packId);
    await appearance(container, name);
    expect(screen.getByTestId('vehicle-marker')).toBeInTheDocument();
    expect(container.querySelector('[class*="--skeleton-bg"]')).toBeInTheDocument();
    expect(screen.queryByText('No geofences configured')).not.toBeInTheDocument();
  });

  it('keeps the initial-loading shell without fabricated observations', () => {
    mocks.state.mockReturnValue(query<StateFixture>(undefined, { isPending: true, isLoading: true }));
    mocks.fences.mockReturnValue(query<Geofence[]>(undefined, { isPending: true, isLoading: true }));
    const { container } = renderWidget(packId);
    expect(screen.getByRole('heading', { name: 'Geofence status' })).toBeInTheDocument();
    expect(container.querySelector('[data-data-state="initial"][aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryByText('Home')).not.toBeInTheDocument();
    expect(screen.queryByText('No geofences configured')).not.toBeInTheDocument();
    expect(screen.queryByTestId('leaflet-map')).not.toBeInTheDocument();
  });

  it('does not start a second refresh while either contributing query is in flight', async () => {
    mocks.fences.mockReturnValue(query(fences, { isFetching: true, refetch: mocks.fenceRefetch }));
    const { container } = renderWidget(packId);
    await appearance(container, name);
    const refresh = screen.getByRole('button', { name: /^Refresh data/ });
    expect(refresh).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(refresh);
    expect(mocks.stateRefetch).not.toHaveBeenCalled();
    expect(mocks.fenceRefetch).not.toHaveBeenCalled();
    expect(within(configuredList(container)).getByText('Home')).toBeInTheDocument();
  });
});
