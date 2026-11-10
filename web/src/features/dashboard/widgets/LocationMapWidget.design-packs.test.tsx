import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import LocationMapWidget from './LocationMapWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, type PackAppearance } from './designPacks/types';
import type { WidgetSize } from './types';

const { vehiclesMock, vehicleStateMock, refetch } = vi.hoisted(() => ({
  vehiclesMock: vi.fn(),
  vehicleStateMock: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: vehiclesMock,
  useVehicleState: vehicleStateMock,
}));

vi.mock('@/components/maps', () => ({
  MapContainer: ({ children, center, zoom, dragging, zoomControl, scrollWheelZoom }: {
    children?: ReactNode;
    center: [number, number];
    zoom: number;
    dragging: boolean;
    zoomControl: boolean;
    scrollWheelZoom: boolean;
  }) => (
    <div data-testid="map" data-center={center.join(',')} data-zoom={zoom}
      data-dragging={dragging} data-zoom-control={zoomControl} data-scroll-zoom={scrollWheelZoom}>
      {children}
    </div>
  ),
  MapTileLayer: ({ style }: { style: string }) => <div data-testid="map-tiles" data-map-style={style} />,
  MapInvalidator: () => null,
  AnimatedMarker: ({ position, heading }: { position: [number, number]; heading?: number }) => (
    <div data-testid="marker" data-position={position.join(',')} data-heading={heading ?? ''} />
  ),
  MapLayerSwitcher: () => null,
  useMap: () => ({ panTo: vi.fn(), getBounds: () => ({ contains: () => true }) }),
}));

interface Fix {
  latitude: number | null;
  longitude: number | null;
  heading?: number | null;
}

interface StateQuery {
  data: {
    state?: Fix;
    live: boolean;
    freshness: 'fresh' | 'stale' | 'unknown';
  } | undefined;
  error: Error | null;
  isLoading: boolean;
  isPending: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  fetchStatus: 'idle' | 'fetching' | 'paused';
  dataUpdatedAt: number;
  refetch: () => void;
}

const FIX: Fix = { latitude: 51.48, longitude: 0, heading: -90 };
const COMPACT: WidgetSize = { cols: 1, rows: 1 };
const FULL: WidgetSize = { cols: 2, rows: 2 };
const EXPANDED: WidgetSize = { cols: 3, rows: 3 };

function stateQuery(fix: Fix | undefined, overrides: Partial<StateQuery> = {}): StateQuery {
  return {
    data: { state: fix, live: true, freshness: 'fresh' },
    error: null, isLoading: false, isPending: false, isFetching: false,
    isStale: false, isError: false, fetchStatus: 'idle',
    dataUpdatedAt: Date.now(), refetch,
    ...overrides,
  };
}

function widget(packId: unknown = 'classic', size: WidgetSize = FULL) {
  return (
    <MemoryRouter>
      <PackBoundary requestedPackId={packId}>
        <LocationMapWidget vehicleId={42} size={size} />
      </PackBoundary>
    </MemoryRouter>
  );
}

async function expectAppearance(container: HTMLElement, appearance: PackAppearance) {
  await waitFor(() => expect(container.querySelector(
    `[data-widget-family="map"][data-widget-appearance="${appearance}"]`,
  )).toBeInTheDocument());
}

function reading(label: string) {
  return screen.getByText(label, { selector: 'dt' }).nextElementSibling;
}

beforeEach(() => {
  vi.clearAllMocks();
  vehiclesMock.mockReturnValue({ data: [{ id: 7 }] });
  vehicleStateMock.mockReturnValue(stateQuery(FIX));
});

afterEach(() => {
  document.documentElement.classList.remove('light-mode');
});

describe.each(Object.entries(PACK_APPEARANCES))('Location map %s / %s', (packId, appearance) => {
  it.each([FULL, EXPANDED])('keeps the real map, normalized bearing, position and refresh at $cols columns', async size => {
    const { container } = render(widget(packId, size));
    await expectAppearance(container, appearance);

    expect(screen.getByRole('heading', { name: 'Vehicle location map' })).toBeVisible();
    expect(screen.getByText('Vehicle location')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Map' })).toBeInTheDocument();
    expect(screen.getAllByTestId('map')).toHaveLength(1);
    expect(screen.getByTestId('map')).toHaveAttribute('data-center', '51.48,0');
    expect(screen.getByTestId('map')).toHaveAttribute('data-zoom', '14');
    for (const control of ['dragging', 'zoom-control', 'scroll-zoom']) {
      expect(screen.getByTestId('map')).toHaveAttribute(`data-${control}`, 'true');
    }
    expect(screen.getByTestId('marker')).toHaveAttribute('data-position', '51.48,0');
    expect(screen.getByTestId('marker')).toHaveAttribute('data-heading', '270');
    expect(reading('Position')).toHaveTextContent('51.48, 0.00');
    expect(reading('Heading')).toHaveTextContent('270°');
    expect(screen.getByTestId('map-tiles')).toHaveAttribute('data-map-style', 'dark');
    expect(container.querySelector('[data-widget-family="map"] .lucide-map-pin')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText('Last known position')).not.toBeInTheDocument();
    expect(vehicleStateMock).toHaveBeenCalledWith(42);
    expect(vehicleStateMock).toHaveBeenCalledTimes(1);
    expect(vehiclesMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('keeps the compact map and bearing without exposing full coordinate details or enabling gestures', async () => {
    const { container } = render(widget(packId, COMPACT));
    await expectAppearance(container, appearance);
    expect(screen.getByTestId('map')).toHaveAttribute('data-zoom', '13');
    expect(screen.getByTestId('marker')).toHaveAttribute('data-heading', '270');
    for (const control of ['dragging', 'zoom-control', 'scroll-zoom']) {
      expect(screen.getByTestId('map')).toHaveAttribute(`data-${control}`, 'false');
    }
    expect(screen.queryByText('Position')).not.toBeInTheDocument();
    expect(screen.queryByText('Heading')).not.toBeInTheDocument();
    expect(screen.queryByText('51.48, 0.00')).not.toBeInTheDocument();
  });

  it('keeps an absent longitude empty, never manufacturing a prime-meridian fix or a zero heading', async () => {
    vehicleStateMock.mockReturnValue(stateQuery({ latitude: 51.48, longitude: null, heading: null }));
    const { container } = render(widget(packId));
    await expectAppearance(container, appearance);
    expect(screen.getByText('No location data available')).toBeInTheDocument();
    expect(reading('Position')).toHaveTextContent('—');
    expect(reading('Heading')).toHaveTextContent('—');
    expect(screen.queryByTestId('map')).not.toBeInTheDocument();
    expect(screen.queryByTestId('marker')).not.toBeInTheDocument();
    expect(screen.queryByText('0°')).not.toBeInTheDocument();
  });

  it('keeps the fix when its heading is unknown without rotating the marker to zero', async () => {
    vehicleStateMock.mockReturnValue(stateQuery({ ...FIX, heading: Number.NaN }));
    const { container } = render(widget(packId));
    await expectAppearance(container, appearance);
    expect(screen.getByTestId('marker')).toHaveAttribute('data-heading', '');
    expect(reading('Position')).toHaveTextContent('51.48, 0.00');
    expect(reading('Heading')).toHaveTextContent('—');
    expect(screen.queryByText('0°')).not.toBeInTheDocument();
  });

  it('retains the original map and source warning after a failed refresh', async () => {
    vehicleStateMock.mockReturnValue(stateQuery(FIX, { isError: true, error: new Error('refresh failed') }));
    const { container } = render(widget(packId));
    await expectAppearance(container, appearance);
    expect(screen.getByTestId('map')).toHaveAttribute('data-center', '51.48,0');
    expect(reading('Heading')).toHaveTextContent('270°');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByText('Last known position')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});

it('preserves Classic medium/expanded/compact bodies and recovers them after every production selection', async () => {
  vehicleStateMock.mockReturnValue(stateQuery(FIX, { data: { state: FIX, live: false, freshness: 'stale' } }));
  const view = render(widget('classic', EXPANDED));
  expect(screen.getByRole('group', { name: 'Vehicle location status' })).toBeInTheDocument();
  expect(screen.getByText('270°')).toBeInTheDocument();
  expect(screen.getByText('51.48, 0.00')).toBeInTheDocument();
  expect(screen.getByText('Last known position')).toBeInTheDocument();
  expect(view.container.querySelector('[data-widget-family]')).not.toBeInTheDocument();

  for (const [packId, appearance] of Object.entries(PACK_APPEARANCES)) {
    view.rerender(widget(packId, EXPANDED));
    await expectAppearance(view.container, appearance);
    expect(screen.getAllByTestId('map')).toHaveLength(1);
    expect(screen.getByTestId('marker')).toHaveAttribute('data-heading', '270');
  }
  view.rerender(widget('classic'));
  expect(screen.getByText('Last known position')).toBeInTheDocument();
  expect(screen.queryByText('270°')).not.toBeInTheDocument();
  expect(view.container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
  view.rerender(widget('retired-pack', COMPACT));
  expect(view.container.querySelector('[data-widget-pack="classic"]')).toBeInTheDocument();
  expect(screen.queryByText('Last known position')).not.toBeInTheDocument();
  expect(screen.getByTestId('map')).toHaveAttribute('data-zoom', '13');
  fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
  expect(refetch).toHaveBeenCalledOnce();
});

describe.each(Object.entries(PACK_APPEARANCES))('Location map %s / %s source states', (packId, appearance) => {
  it.each([
    ['null island', 0, 0],
    ['non-finite latitude', Number.NaN, 10],
    ['out-of-range longitude', 51.48, 181],
  ] as const)('does not send %s coordinates to Leaflet', async (_label, latitude, longitude) => {
    vehicleStateMock.mockReturnValue(stateQuery({ latitude, longitude, heading: 90 }));
    const { container } = render(widget(packId));
    await expectAppearance(container, appearance);
    expect(screen.getByText('No location data available')).toBeInTheDocument();
    expect(reading('Position')).toHaveTextContent('—');
    expect(screen.queryByTestId('map')).not.toBeInTheDocument();
  });

  it.each(['unknown', 'stale'] as const)('labels %s source freshness as retained, even when the payload says live', async freshness => {
    vehicleStateMock.mockReturnValue(stateQuery(FIX, { data: { state: FIX, live: true, freshness } }));
    const { container } = render(widget(packId));
    await expectAppearance(container, appearance);
    expect(screen.getByText('Last known position')).toBeInTheDocument();
    expect(screen.getByTestId('marker')).toBeInTheDocument();
  });

  it('keeps the source shell while loading and exposes an initial failure with its actual retry', () => {
    vehicleStateMock.mockReturnValue(stateQuery(undefined, { data: undefined, isLoading: true, isPending: true }));
    const view = render(widget(packId));
    expect(screen.getByRole('heading', { name: 'Vehicle location map' })).toBeInTheDocument();
    expect(view.container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryByText('No location data available')).not.toBeInTheDocument();
    expect(screen.queryByTestId('map')).not.toBeInTheDocument();

    vehicleStateMock.mockReturnValue(stateQuery(undefined, { data: undefined, isError: true, error: new Error('state unavailable') }));
    view.rerender(widget(packId));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('map')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('keeps in-flight refresh disabled and preserves theme-aware map tiles', async () => {
    vehicleStateMock.mockReturnValue(stateQuery(FIX, { isFetching: true }));
    const { container } = render(widget(packId));
    await expectAppearance(container, appearance);
    const refresh = screen.getByRole('button', { name: /^Refresh/i });
    expect(refresh).toBeDisabled();
    fireEvent.click(refresh);
    expect(refetch).not.toHaveBeenCalled();
    document.documentElement.classList.add('light-mode');
    await waitFor(() => expect(screen.getByTestId('map-tiles')).toHaveAttribute('data-map-style', 'streets'));
    expect(screen.getByTestId('marker')).toHaveAttribute('data-position', '51.48,0');
  });
});
