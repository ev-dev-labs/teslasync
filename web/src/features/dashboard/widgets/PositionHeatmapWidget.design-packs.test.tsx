import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DataStateSource } from '@/api/dataState';
import type { Position } from '@/api/types';
import PositionHeatmapWidget from './PositionHeatmapWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES } from './designPacks/types';
import type { WidgetSize } from './types';

const { positionsMock, vehiclesMock, refetch } = vi.hoisted(() => ({
  positionsMock: vi.fn(),
  vehiclesMock: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => vehiclesMock(),
  useVehiclePositions: (vehicleId: number) => positionsMock(vehicleId),
}));
vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: () => ({
    startInstant: '2026-10-01T00:00:00.000Z',
    endInstantExclusive: '2026-10-23T00:00:00.000Z',
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}));
vi.mock('@/components/maps', () => ({
  MapInvalidator: () => null,
  MapTileLayer: ({ style }: { style: string }) => (
    <div data-testid="density-tiles" data-style={style} />
  ),
  MapContainer: ({ children, center, zoom, scrollWheelZoom, zoomControl, dragging }: {
    children?: ReactNode;
    center: [number, number];
    zoom: number;
    scrollWheelZoom: boolean;
    zoomControl: boolean;
    dragging: boolean;
  }) => (
    <div
      data-testid="density-map"
      data-center={JSON.stringify(center)}
      data-zoom={zoom}
      data-scroll={scrollWheelZoom}
      data-controls={zoomControl}
      data-dragging={dragging}
    >
      {children}
    </div>
  ),
  CircleMarker: ({ center, radius, pathOptions }: {
    center: [number, number];
    radius: number;
    pathOptions: { color: string; fillColor: string; fillOpacity: number };
  }) => (
    <div
      data-testid="density-point"
      data-center={JSON.stringify(center)}
      data-radius={radius}
      data-fill={pathOptions.fillColor}
      data-opacity={pathOptions.fillOpacity}
      data-stroke={pathOptions.color}
    />
  ),
}));

function position(latitude: number, longitude: number, ts = '2026-10-12T12:00:00Z'): Position {
  return {
    vehicle_id: 42, latitude, longitude, ts, heading: null, speed_mph: null,
    elevation_m: null, gps_state: null, source: 'test',
  };
}

const positions: Position[] = [
  position(37.7749, -122.4194),
  position(37.77492, -122.41942),
  position(37.77495, -122.41945),
  position(40, -74),
];
const sizes: WidgetSize[] = [
  { cols: 1, rows: 2 },
  { cols: 2, rows: 2 },
  { cols: 3, rows: 2 },
];

function query(overrides: Partial<DataStateSource<Position[]>> = {}): DataStateSource<Position[]> {
  return {
    data: positions, error: null, isPending: false, isLoading: false,
    isFetching: false, isStale: false, isError: false, isSuccess: true,
    fetchStatus: 'idle', dataUpdatedAt: Date.now(), refetch, ...overrides,
  };
}

function widget(packId: unknown = 'classic', size: WidgetSize = sizes[1], vehicleId?: number) {
  return (
    <MemoryRouter>
      <PackBoundary requestedPackId={packId}>
        <PositionHeatmapWidget vehicleId={vehicleId} size={size} />
      </PackBoundary>
    </MemoryRouter>
  );
}

async function appearance(container: HTMLElement, name: string) {
  await waitFor(() => expect(container.querySelector(
    `[data-widget-family="map"][data-widget-appearance="${name}"]`,
  )).toBeInTheDocument());
}

function expectOriginalMap(cols: number) {
  expect(screen.getAllByTestId('density-map')).toHaveLength(1);
  const map = screen.getByTestId('density-map');
  const center: unknown = JSON.parse(map.getAttribute('data-center') ?? 'null');
  expect(Array.isArray(center)).toBe(true);
  if (!Array.isArray(center)) throw new Error('Expected the original map center');
  expect(center[0]).toBeCloseTo((37.77492333333333 + 40) / 2, 8);
  expect(center[1]).toBeCloseTo((-122.41942333333333 - 74) / 2, 8);
  expect(map).toHaveAttribute('data-zoom', cols >= 3 ? '12' : '11');
  for (const attribute of ['data-scroll', 'data-controls', 'data-dragging']) {
    expect(map).toHaveAttribute(attribute, String(cols > 1));
  }
  const markers = screen.getAllByTestId('density-point');
  expect(markers).toHaveLength(2);
  expect(Number(markers[0].getAttribute('data-radius'))).toBeCloseTo(cols === 1 ? 10 : cols >= 3 ? 20 : 16);
  expect(Number(markers[1].getAttribute('data-radius'))).toBeCloseTo(
    cols === 1 ? 6 : 6 + (cols >= 3 ? 14 : 10) / 3,
  );
  expect(markers[0]).toHaveAttribute('data-fill', 'rgba(245,64,226,0.9)');
  expect(Number(markers[0].getAttribute('data-opacity'))).toBeCloseTo(0.9);
  expect(Number(markers[1].getAttribute('data-opacity'))).toBeCloseTo(cols === 1 ? 0.4 + 0.5 / 3 : 0.35 + 0.55 / 3);
  markers.forEach(marker => expect(marker).toHaveAttribute('data-stroke', 'transparent'));
  expect(screen.getByTestId('density-tiles')).toHaveAttribute('data-style', 'dark');
  expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
  positionsMock.mockReturnValue(query());
  vehiclesMock.mockReturnValue({ data: [{ id: 7 }] });
  document.documentElement.classList.remove('light-mode');
});

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('light-mode');
});

describe.each(Object.entries(PACK_APPEARANCES))('Position heatmap %s / %s', (packId, packAppearance) => {
  it.each(sizes)('preserves the density map, controls, refresh and privacy at $cols columns', async (size) => {
    const view = render(widget(packId, size, 42));
    await appearance(view.container, packAppearance);
    expect(screen.getByRole('heading', { name: 'Position heatmap' })).toBeVisible();
    expect(screen.getByText('Position density')).toBeInTheDocument();
    expect(screen.getByText('Visited areas')).toBeInTheDocument();
    expect(screen.getByText('Historical GPS samples')).toBeInTheDocument();
    const scale = screen.getByRole('group', { name: 'Relative sample density' });
    expect(scale).toHaveTextContent('Low density');
    expect(scale).toHaveTextContent('High density');
    expect(screen.getByText('Density uses returned GPS samples, not visit counts. The selected range filters only those samples.')).toBeInTheDocument();
    expectOriginalMap(size.cols);
    expect(view.container.querySelector('[data-widget-family="map"] svg.lucide-map-pin')).toBeInTheDocument();
    expect(positionsMock).toHaveBeenCalledWith(42);
    expect(positionsMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Hide locations' }));
    expect(screen.getByRole('button', { name: 'Show locations' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Locations hidden on this screen')).toBeVisible();
    expect(screen.queryByTestId('density-map')).not.toBeInTheDocument();
    expect(screen.queryByTestId('density-point')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show locations' }));
    expect(screen.getByRole('button', { name: 'Hide locations' })).toHaveAttribute('aria-pressed', 'false');
    expectOriginalMap(size.cols);
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('keeps the empty map source honest without fabricating a center, count or scale reading', async () => {
    positionsMock.mockReturnValue(query({ data: [] }));
    const view = render(widget(packId, sizes[0]));
    await appearance(view.container, packAppearance);
    expect(screen.getByText('No position data')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Position heatmap' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Relative sample density' })).toBeInTheDocument();
    expect(screen.queryByTestId('density-map')).not.toBeInTheDocument();
    expect(screen.queryByTestId('density-point')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});

it.each(sizes)('preserves default Classic and unknown-ID recovery at $cols columns', async (size) => {
  const view = render(widget(undefined, size));
  expect(view.container.querySelector('[data-widget-appearance]')).not.toBeInTheDocument();
  expect(screen.queryByText('Position density')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Hide locations' })).not.toBeInTheDocument();
  expectOriginalMap(size.cols);
  expect(positionsMock).toHaveBeenCalledWith(7);
  view.rerender(widget('v7', size));
  await appearance(view.container, 'pixel');
  expectOriginalMap(size.cols);
  view.rerender(widget('unrecognized-pack', size));
  expect(view.container.querySelector('[data-widget-appearance]')).not.toBeInTheDocument();
  expect(screen.queryByText('Position density')).not.toBeInTheDocument();
  expectOriginalMap(size.cols);
});

it.each(Object.entries(PACK_APPEARANCES))('preserves an explicit privacy choice from %s through pack changes and Classic recovery', async (packId, packAppearance) => {
  const view = render(widget(packId));
  await appearance(view.container, packAppearance);
  fireEvent.click(screen.getByRole('button', { name: 'Hide locations' }));
  view.rerender(widget('v4'));
  await appearance(view.container, 'owner');
  expect(screen.queryByTestId('density-map')).not.toBeInTheDocument();
  view.rerender(widget('classic'));
  expect(screen.queryByTestId('density-map')).not.toBeInTheDocument();
  expect(screen.getByText('Locations hidden on this screen')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Show locations' }));
  expectOriginalMap(2);
  expect(screen.queryByRole('button', { name: 'Hide locations' })).not.toBeInTheDocument();
  expect(refetch).not.toHaveBeenCalled();
});

it.each(Object.entries(PACK_APPEARANCES))('%s filters both range boundaries, rejects bad coordinates and discloses unscoped timestamps', async (packId, packAppearance) => {
  positionsMock.mockReturnValue(query({ data: [
    position(10, 20, '2026-10-01T00:00:00.000Z'),
    position(11, 21, '2026-10-22T23:59:59.999Z'),
    position(12, 22, '2026-09-30T23:59:59.999Z'),
    position(13, 23, '2026-10-23T00:00:00.000Z'),
    position(14, 24, ''),
    position(15, 25, 'unknown'),
    position(0, 0), position(91, 20), position(10, 181),
    position(Number.NaN, 20), position(10, Number.POSITIVE_INFINITY),
  ] }));
  const view = render(widget(packId));
  await appearance(view.container, packAppearance);
  expect(screen.getAllByTestId('density-point').map(marker => marker.getAttribute('data-center'))).toEqual([
    '[10,20]', '[11,21]', '[14,24]', '[15,25]',
  ]);
  expect(screen.getByText('Samples without valid timestamps may fall outside the selected range.')).toBeInTheDocument();
  expect(screen.queryByText('0')).not.toBeInTheDocument();
});

it.each(Object.entries(PACK_APPEARANCES))('%s keeps the compact coarser-grid branch instead of silently adopting the full map clusters', async (packId, packAppearance) => {
  positionsMock.mockReturnValue(query({ data: [position(10, 20), position(10.003, 20)] }));
  const view = render(widget(packId, sizes[0]));
  await appearance(view.container, packAppearance);
  expect(screen.getAllByTestId('density-point')).toHaveLength(1);
  expect(screen.getByTestId('density-map')).toHaveAttribute('data-dragging', 'false');
  view.rerender(widget(packId, sizes[1]));
  await appearance(view.container, packAppearance);
  expect(screen.getAllByTestId('density-point')).toHaveLength(2);
  expect(screen.getByTestId('density-map')).toHaveAttribute('data-dragging', 'true');
});

describe.each(Object.entries(PACK_APPEARANCES))('%s retained position history', (packId, packAppearance) => {
  it.each(['refresh-error', 'paused', 'stale'] as const)('retains the real map and its trust state during %s', async state => {
    positionsMock.mockReturnValue(query({
      isError: state === 'refresh-error',
      error: state === 'refresh-error' ? new Error('Refresh failed') : null,
      isStale: true,
      fetchStatus: state === 'paused' ? 'paused' : 'idle',
    }));
    const view = render(widget(packId));
    await appearance(view.container, packAppearance);
    expectOriginalMap(2);
    expect(view.container.querySelector('[data-content-degraded="true"]')).toBeInTheDocument();
    if (state !== 'stale') {
      expect(view.container.querySelector('[data-data-state="stale"]')).toBeInTheDocument();
      expect(screen.getByTestId('stale-refresh-warning')).toBeVisible();
    }
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});

it.each(Object.entries(PACK_APPEARANCES))('%s preserves the source shell while loading and on fatal failure, with retry rather than an empty success', packId => {
  positionsMock.mockReturnValue(query({ data: undefined, isLoading: true, isPending: true, dataUpdatedAt: 0 }));
  const view = render(widget(packId));
  expect(screen.getByRole('heading', { name: 'Position heatmap' })).toBeInTheDocument();
  expect(view.container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  expect(screen.queryByText('No position data')).not.toBeInTheDocument();
  expect(screen.queryByTestId('density-map')).not.toBeInTheDocument();
  positionsMock.mockReturnValue(query({
    data: undefined, isError: true, error: new Error('Position source unavailable'), dataUpdatedAt: 0,
  }));
  view.rerender(widget(packId));
  expect(screen.getByRole('heading', { name: 'Position heatmap' })).toBeInTheDocument();
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.queryByText('No position data')).not.toBeInTheDocument();
  expect(screen.queryByTestId('density-map')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /retry/i }));
  expect(refetch).toHaveBeenCalledOnce();
});

it.each(Object.entries(PACK_APPEARANCES))('%s does not refetch twice while refresh is already in flight', async (packId, packAppearance) => {
  positionsMock.mockReturnValue(query({ isFetching: true }));
  const view = render(widget(packId));
  await appearance(view.container, packAppearance);
  const refresh = screen.getByRole('button', { name: /^Refresh/i });
  expect(refresh).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(refresh);
  expect(refetch).not.toHaveBeenCalled();
  expectOriginalMap(2);
});

it.each(Object.entries(PACK_APPEARANCES))('%s preserves light-theme map tiles without changing the historical density geometry', async (packId, packAppearance) => {
  document.documentElement.classList.add('light-mode');
  const view = render(widget(packId));
  await appearance(view.container, packAppearance);
  expect(screen.getByTestId('density-tiles')).toHaveAttribute('data-style', 'streets');
  expect(screen.getAllByTestId('density-point')).toHaveLength(2);
});
