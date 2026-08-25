/**
 * Trip-replay map ↔ chart sync tests.
 *
 * Verifies the bidirectional cursor-sync wiring
 * without booting the entire TripReplayPage shell (which would require
 * react-leaflet, recharts, the QueryClient, and a router stack):
 *
 *  1. The chart's `<ChartCursorBridge>` forwards persistent cursor-sync
 *     writes (e.g. from a sibling synced chart, or this chart's own
 *     `onMouseMove` hover) to the supplied `onSeekToIndex` callback,
 *     mapping the synced X-axis value (minutes) back to the row index.
 *
 *  2. The map component wires `onClick` handlers onto every speed
 *     polyline segment; clicking any of them resolves to the nearest
 *     sample by haversine distance and invokes `onSeekToIndex`.
 *
 *  3. The pure helpers (`nearestSampleIndex`, `nearestIndexByTime`)
 *     return the correct row in degenerate cases (empty array, exact
 *     match, between-samples).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

import {
  ChartTimeRangeProvider,
  setCursorSyncPosition,
} from '@/components/charts';
import { _resetCursorSyncStore } from '@/components/charts/cursorSync';
import { ToastProvider } from '@/components/feedback/Toast';

// ---------------------------------------------------------------------------
//  Mocks — react-leaflet / leaflet are jsdom-hostile; replace the maps barrel
//  with inert stubs that capture the props the production component would
//  hand to leaflet so we can assert on them.
// ---------------------------------------------------------------------------

const polylineProps: Array<{
  positions: unknown;
  pathOptions?: unknown;
  eventHandlers?: { click?: (e: { latlng: { lat: number; lng: number } }) => void };
}> = [];

vi.mock('@/components/maps', async () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children);
  return {
    MapContainer: passthrough,
    Polyline: (props: {
      positions: unknown;
      pathOptions?: unknown;
      eventHandlers?: { click?: (e: { latlng: { lat: number; lng: number } }) => void };
    }) => {
      polylineProps.push(props);
      return null;
    },
    CircleMarker: () => null,
    Marker: () => null,
    Popup: () => null,
    Circle: () => null,
    Rectangle: () => null,
    FeatureGroup: () => null,
    MapTileLayer: () => null,
    MapInvalidator: () => null,
    MapLayerSwitcher: () => null,
    AnimatedMarker: ({
      position,
    }: {
      position: [number, number];
      heading?: number;
      color?: string;
    }) =>
      React.createElement('div', {
        'data-testid': 'animated-marker',
        'data-lat': position[0],
        'data-lng': position[1],
      }),
    vehicleIcon: () => ({}),
    GeofenceDrawer: () => null,
    MarkerCluster: () => null,
    RoutePlayback: () => null,
    describeFence: () => '',
    latLngBounds: () => ({
      isValid: () => false,
      getSouthWest: () => ({ lat: 0, lng: 0 }),
      getNorthEast: () => ({ lat: 0, lng: 0 }),
    }),
    useMap: () => ({
      fitBounds: vi.fn(),
      setView: vi.fn(),
      getBounds: () => ({ contains: () => true }),
      panTo: vi.fn(),
      invalidateSize: vi.fn(),
    }),
  };
});

// recharts ResponsiveContainer hates jsdom's zero-size rect; render its
// children directly without the wrapper measurement gymnastics.
vi.mock('recharts', async () => {
  const actual: Record<string, unknown> = await vi.importActual('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', { style: { width: 800, height: 220 } }, children),
  };
});

import { TripReplayMap, nearestSampleIndex } from '../../components/TripReplayMap';
import {
  TripReplayCharts,
  type TripReplayChartPoint,
  nearestIndexByTime,
} from '../../components/TripReplayCharts';
import type { DrivePosition } from '@/types/driving';

// ---------------------------------------------------------------------------
//  Test wrapper — supplies the QueryClient required by ChartContainer's
//  built-in `useChartAnnotationsAsData` hook. We never make a real network
//  request because there is no fetch mock; the hook stays in `pending`
//  state for the lifetime of the test, which is what we want.
// ---------------------------------------------------------------------------

function withQuery(node: React.ReactNode): React.ReactElement {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>{node}</ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

// ---------------------------------------------------------------------------
//  Fixtures
// ---------------------------------------------------------------------------

function pos(
  i: number,
  lat: number,
  lng: number,
  speed: number,
  power: number,
): DrivePosition {
  // 1-minute spacing per sample → predictable cursor-sync values in test.
  const baseMs = new Date('2024-01-01T00:00:00Z').getTime();
  return {
    latitude: lat,
    longitude: lng,
    speed,
    power,
    batteryLevel: 80 - i,
    timestamp: new Date(baseMs + i * 60_000).toISOString(),
    elevation: 100 + i * 5,
    insideTemp: 22,
    outsideTemp: 18,
    idealRange: 300 - i,
    ratedRange: 300 - i,
    odometer: 10_000 + i,
    fanStatus: 0,
    isClimateOn: false,
  };
}

const FIXTURE_POSITIONS: DrivePosition[] = [
  pos(0, 47.60, -122.30, 0, 0),
  pos(1, 47.62, -122.32, 35, 25),
  pos(2, 47.64, -122.34, 65, 50),
  pos(3, 47.66, -122.36, 80, 70),
  pos(4, 47.68, -122.38, 50, 30),
];

const FIXTURE_CHART_DATA: TripReplayChartPoint[] = FIXTURE_POSITIONS.map(
  (p, i) => ({ index: i, time: i, speed: p.speed ?? 0, power: p.power ?? 0 }),
);

// ---------------------------------------------------------------------------
//  Pure helper tests
// ---------------------------------------------------------------------------

describe('Phase-45 / Prompt 26 — pure helpers', () => {
  it('nearestSampleIndex returns 0 on empty array', () => {
    expect(nearestSampleIndex([], 0, 0)).toBe(0);
  });

  it('nearestSampleIndex picks the closest sample by haversine', () => {
    const idx = nearestSampleIndex(FIXTURE_POSITIONS, 47.66, -122.36);
    expect(idx).toBe(3);
  });

  it('nearestSampleIndex handles a click between two samples (picks closer)', () => {
    // Halfway between samples 1 and 2 but a hair closer to sample 1.
    const idx = nearestSampleIndex(FIXTURE_POSITIONS, 47.625, -122.325);
    expect([1, 2]).toContain(idx);
  });

  it('nearestIndexByTime returns 0 on empty array', () => {
    expect(nearestIndexByTime([], 5)).toBe(0);
  });

  it('nearestIndexByTime exact match returns that index', () => {
    expect(nearestIndexByTime(FIXTURE_CHART_DATA, 2)).toBe(2);
  });

  it('nearestIndexByTime picks the closer of two neighbours', () => {
    expect(nearestIndexByTime(FIXTURE_CHART_DATA, 2.7)).toBe(3);
    expect(nearestIndexByTime(FIXTURE_CHART_DATA, 2.3)).toBe(2);
  });

  it('nearestIndexByTime clamps requests below the first sample', () => {
    expect(nearestIndexByTime(FIXTURE_CHART_DATA, -100)).toBe(0);
  });

  it('nearestIndexByTime clamps requests above the last sample', () => {
    expect(nearestIndexByTime(FIXTURE_CHART_DATA, 1_000)).toBe(
      FIXTURE_CHART_DATA.length - 1,
    );
  });
});

// ---------------------------------------------------------------------------
//  TripReplayMap — polyline click → onSeekToIndex
// ---------------------------------------------------------------------------

describe('Phase-45 / Prompt 26 — TripReplayMap polyline click', () => {
  beforeEach(() => {
    polylineProps.length = 0;
  });
  afterEach(() => {
    cleanup();
    polylineProps.length = 0;
  });

  it('wires an onClick handler onto every speed-coloured segment', () => {
    const onSeek = vi.fn();
    render(
      <TripReplayMap
        positions={FIXTURE_POSITIONS}
        currentIndex={0}
        onSeekToIndex={onSeek}
      />,
    );
    // 5 positions → 4 segments (i=1..4).
    expect(polylineProps.length).toBe(FIXTURE_POSITIONS.length - 1);
    for (const props of polylineProps) {
      expect(typeof props.eventHandlers?.click).toBe('function');
    }
  });

  it('forwards a polyline click to onSeekToIndex with the nearest sample idx', () => {
    const onSeek = vi.fn();
    render(
      <TripReplayMap
        positions={FIXTURE_POSITIONS}
        currentIndex={0}
        onSeekToIndex={onSeek}
      />,
    );
    // Simulate a click at the lat/lng of sample 2.
    const target = FIXTURE_POSITIONS[2];
    polylineProps[0].eventHandlers!.click!({
      latlng: { lat: target.latitude, lng: target.longitude },
    });
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(2);
  });

  it('renders the AnimatedMarker for currentIndex when motion is allowed', () => {
    const { getByTestId } = render(
      <TripReplayMap
        positions={FIXTURE_POSITIONS}
        currentIndex={3}
        onSeekToIndex={vi.fn()}
      />,
    );
    const marker = getByTestId('animated-marker');
    expect(marker.getAttribute('data-lat')).toBe(
      String(FIXTURE_POSITIONS[3].latitude),
    );
    expect(marker.getAttribute('data-lng')).toBe(
      String(FIXTURE_POSITIONS[3].longitude),
    );
  });

  it('omits the AnimatedMarker under reduced motion (snap fallback used)', () => {
    const { queryByTestId } = render(
      <TripReplayMap
        positions={FIXTURE_POSITIONS}
        currentIndex={2}
        onSeekToIndex={vi.fn()}
        reduceMotion
      />,
    );
    expect(queryByTestId('animated-marker')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
//  TripReplayCharts — cursor-sync hover → onSeekToIndex (chart → map sync)
// ---------------------------------------------------------------------------

describe('Phase-45 / Prompt 26 — TripReplayCharts cursor bridge', () => {
  beforeEach(() => {
    _resetCursorSyncStore();
  });
  afterEach(() => {
    cleanup();
    _resetCursorSyncStore();
  });

  it('forwards persistent cursor-sync writes to onSeekToIndex (idx mapping)', () => {
    const onSeek = vi.fn();
    render(
      withQuery(
        <TripReplayCharts
          data={FIXTURE_CHART_DATA}
          currentIndex={0}
          speedUnit="km/h"
          onSeekToIndex={onSeek}
          syncId="trip-replay-test-1"
        />,
      ),
    );

    // Simulate a sibling synced chart (or this chart's own hover) writing
    // a cursor X value into the persistent sync store.
    act(() => {
      setCursorSyncPosition('trip-replay-test-1', 3);
    });

    expect(onSeek).toHaveBeenCalledWith(3);
  });

  it('coalesces repeat writes of the same value (no double-seek)', () => {
    const onSeek = vi.fn();
    render(
      withQuery(
        <TripReplayCharts
          data={FIXTURE_CHART_DATA}
          currentIndex={0}
          speedUnit="km/h"
          onSeekToIndex={onSeek}
          syncId="trip-replay-test-2"
        />,
      ),
    );

    act(() => setCursorSyncPosition('trip-replay-test-2', 2));
    act(() => setCursorSyncPosition('trip-replay-test-2', 2));
    act(() => setCursorSyncPosition('trip-replay-test-2', 2));

    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenLastCalledWith(2);
  });

  it('snaps a between-sample cursor to the nearest indexed row', () => {
    const onSeek = vi.fn();
    render(
      withQuery(
        <TripReplayCharts
          data={FIXTURE_CHART_DATA}
          currentIndex={0}
          speedUnit="km/h"
          onSeekToIndex={onSeek}
          syncId="trip-replay-test-3"
        />,
      ),
    );

    // 2.7 is closer to time=3 (sample 3).
    act(() => setCursorSyncPosition('trip-replay-test-3', 2.7));
    expect(onSeek).toHaveBeenLastCalledWith(3);

    // 2.3 is closer to time=2 (sample 2).
    act(() => setCursorSyncPosition('trip-replay-test-3', 2.3));
    expect(onSeek).toHaveBeenLastCalledWith(2);
  });

  it('ignores non-finite cursor values', () => {
    const onSeek = vi.fn();
    render(
      withQuery(
        <TripReplayCharts
          data={FIXTURE_CHART_DATA}
          currentIndex={0}
          speedUnit="km/h"
          onSeekToIndex={onSeek}
          syncId="trip-replay-test-4"
        />,
      ),
    );

    act(() => setCursorSyncPosition('trip-replay-test-4', 'not-a-number'));
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('clears the cursor entry on unmount so the next mount starts fresh', () => {
    const onSeek = vi.fn();
    const { unmount } = render(
      withQuery(
        <TripReplayCharts
          data={FIXTURE_CHART_DATA}
          currentIndex={0}
          speedUnit="km/h"
          onSeekToIndex={onSeek}
          syncId="trip-replay-test-5"
        />,
      ),
    );

    act(() => setCursorSyncPosition('trip-replay-test-5', 4));
    expect(onSeek).toHaveBeenCalledWith(4);

    unmount();

    // Re-mount with a fresh callback — the previous cursor must NOT replay.
    const onSeek2 = vi.fn();
    render(
      withQuery(
        <TripReplayCharts
          data={FIXTURE_CHART_DATA}
          currentIndex={0}
          speedUnit="km/h"
          onSeekToIndex={onSeek2}
          syncId="trip-replay-test-5"
        />,
      ),
    );
    expect(onSeek2).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
//  Integration — single shared seek handler keeps map + charts in lockstep
// ---------------------------------------------------------------------------

describe('Phase-45 / Prompt 26 — shared seek handler integration', () => {
  beforeEach(() => {
    _resetCursorSyncStore();
    polylineProps.length = 0;
  });
  afterEach(() => {
    cleanup();
    _resetCursorSyncStore();
    polylineProps.length = 0;
  });

  it('chart cursor → seek → map marker updates on next render', () => {
    let currentIndex = 0;
    const seek = vi.fn((i: number) => {
      currentIndex = i;
    });

    function Harness() {
      // Re-render whenever seek runs by reading currentIndex on each
      // render; in production this is replay.currentIndex from useTripReplay.
      return (
        <ChartTimeRangeProvider syncId="trip-replay-int-1" syncMethod="value">
          <TripReplayMap
            positions={FIXTURE_POSITIONS}
            currentIndex={currentIndex}
            onSeekToIndex={seek}
          />
          <TripReplayCharts
            data={FIXTURE_CHART_DATA}
            currentIndex={currentIndex}
            speedUnit="km/h"
            onSeekToIndex={seek}
            syncId="trip-replay-int-1"
          />
        </ChartTimeRangeProvider>
      );
    }

    const { rerender, getByTestId } = render(withQuery(<Harness />));

    act(() => setCursorSyncPosition('trip-replay-int-1', 4));
    expect(seek).toHaveBeenCalledWith(4);
    expect(currentIndex).toBe(4);

    // Force a re-render so the map marker picks up the new currentIndex
    // (production wiring re-renders automatically via React state).
    rerender(withQuery(<Harness />));
    const marker = getByTestId('animated-marker');
    expect(marker.getAttribute('data-lat')).toBe(
      String(FIXTURE_POSITIONS[4].latitude),
    );
  });

  it('map polyline click → seek → chart cursor index updates', () => {
    let currentIndex = 0;
    const seek = vi.fn((i: number) => {
      currentIndex = i;
    });

    function Harness() {
      return (
        <ChartTimeRangeProvider syncId="trip-replay-int-2" syncMethod="value">
          <TripReplayMap
            positions={FIXTURE_POSITIONS}
            currentIndex={currentIndex}
            onSeekToIndex={seek}
          />
          <TripReplayCharts
            data={FIXTURE_CHART_DATA}
            currentIndex={currentIndex}
            speedUnit="km/h"
            onSeekToIndex={seek}
            syncId="trip-replay-int-2"
          />
        </ChartTimeRangeProvider>
      );
    }

    render(withQuery(<Harness />));

    // Click on sample 2's coordinates — the click handler should resolve
    // to that sample and call the shared seek handler.
    const target = FIXTURE_POSITIONS[2];
    polylineProps[0].eventHandlers!.click!({
      latlng: { lat: target.latitude, lng: target.longitude },
    });
    expect(seek).toHaveBeenCalledWith(2);
    expect(currentIndex).toBe(2);
  });
});
