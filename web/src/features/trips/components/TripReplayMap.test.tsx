/**
 * TripReplayMap — behaviour, branch, interaction, a11y and null-safety
 * coverage for both exports of the file:
 *
 *   1. `nearestSampleIndex(positions, lat, lng)` — the pure linear-scan helper
 *      that turns a map click into the closest sample index (drives map→chart
 *      sync). Covered directly: empty guard, exact hit, and nearest-of-many.
 *
 *   2. `<TripReplayMap>` — the leaflet wrapper. Exercised postures:
 *        - EMPTY (no positions) → shared <EmptyState>, no map mounted;
 *        - ROUTE (GPS varies ≥ 10 m) → speed-coloured polyline segments,
 *          green start / red end pins, the animated playhead, and a
 *          `fitBounds` on the derived bbox;
 *        - REDUCED MOTION → the playhead degrades to a snapping <CircleMarker>
 *          (no <AnimatedMarker>) and the container disables map animations;
 *        - STATIONARY GPS (one frozen coord) → no polyline, a single anchor
 *          marker, the "Route can't be plotted" banner, and a `setView`
 *          fallback (never a bogus zero-extent fitBounds);
 *        - ALL-INVALID GPS ((0,0) placeholders) → still no crash, no markers;
 *        - the polyline `click` → nearest-sample → `onSeekToIndex` channel;
 *        - the layer switcher threading a new tile style through;
 *        - OUT-OF-RANGE `currentIndex` (the page owns it and can transiently
 *          overshoot) → clamped, not crashed (regression guard for the
 *          `positions[undefined]` heading bug this suite surfaced).
 *
 * Strategy (mirrors ../../../components/maps/__tests__/RoutePlayback.test.tsx):
 * the `@/components/maps` barrel is mocked to inert, prop-capturing stubs so
 * leaflet never touches jsdom. `useMap` / `latLngBounds` are faked with real
 * min/max maths so the <FitBounds> branch logic runs for real. `react-i18next`
 * resolves the developer fallback string. The shared <GlassPanel> /
 * <EmptyState> / <AlertBanner> stay REAL so the rendered chrome is genuine.
 * `@testing-library/user-event` is intentionally NOT a dependency of this repo
 * (see web/package.json) — interactions use `fireEvent`, like the sibling
 * map/page tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DrivePosition } from '@/types/driving';

/* Prop-capturing shared state for the mocked maps barrel. Hoisted so the
 * mock factory (evaluated before imports) and the specs both reach it. */
 
const { maps } = vi.hoisted(() => ({
  maps: {
    containers: [] as any[],
    tileLayers: [] as any[],
    polylines: [] as any[],
    circleMarkers: [] as any[],
    animatedMarkers: [] as any[],
    layerSwitchers: [] as any[],
    map: { fitBounds: vi.fn(), setView: vi.fn() },
    nextClick: { lat: 47.6, lng: -122.3 },
  },
}));

vi.mock('@/components/maps', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  const h = React.createElement;
  return {
    MapContainer: (props: any) => {
      maps.containers.push(props);
      return h('div', { 'data-testid': 'map-container' }, props.children);
    },
    MapTileLayer: (props: any) => {
      maps.tileLayers.push(props);
      return h('div', { 'data-testid': 'tile-layer', 'data-style': props.style });
    },
    MapInvalidator: () => null,
    MapLayerSwitcher: (props: any) => {
      maps.layerSwitchers.push(props);
      return h(
        'button',
        {
          type: 'button',
          'data-testid': 'layer-switch',
          'data-current': props.current,
          onClick: () => props.onChange('satellite'),
        },
        'satellite',
      );
    },
    Polyline: (props: any) => {
      maps.polylines.push(props);
      return h('button', {
        type: 'button',
        'data-testid': 'polyline',
        'aria-label': 'route segment',
        onClick: () => props.eventHandlers?.click?.({ latlng: { ...maps.nextClick } }),
      });
    },
    CircleMarker: (props: any) => {
      maps.circleMarkers.push(props);
      return h('div', { 'data-testid': 'circle-marker', 'data-color': props.pathOptions?.color });
    },
    AnimatedMarker: (props: any) => {
      maps.animatedMarkers.push(props);
      return h('div', { 'data-testid': 'animated-marker', 'data-color': props.color });
    },
    latLngBounds: (coords: [number, number][]) => {
      const lats = coords.map((c) => c[0]);
      const lngs = coords.map((c) => c[1]);
      return {
        isValid: () => coords.length > 0,
        getSouthWest: () => ({ lat: Math.min(...lats), lng: Math.min(...lngs) }),
        getNorthEast: () => ({ lat: Math.max(...lats), lng: Math.max(...lngs) }),
      };
    },
    useMap: () => maps.map,
  };
});

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : _key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

import { TripReplayMap, nearestSampleIndex, type TripReplayMapProps } from './TripReplayMap';

/* ── colours the source uses (kept in one place so the specs read cleanly) ── */
const GREEN = '#10b981';
const CYAN = '#22d3ee';
const AMBER = '#f59e0b';
const RED = '#ef4444';
const ANCHOR = '#22d3ee';
const PLAYHEAD = '#00b4d8';

function pos(latitude: number, longitude: number, over: Partial<DrivePosition> = {}): DrivePosition {
  return {
    latitude,
    longitude,
    speed: 0,
    power: null,
    batteryLevel: 80,
    timestamp: '2024-06-01T10:00:00Z',
    insideTemp: null,
    outsideTemp: null,
    idealRange: null,
    ratedRange: null,
    odometer: null,
    elevation: null,
    fanStatus: null,
    isClimateOn: null,
    ...over,
  };
}

/** A spatially-real route near Seattle: each hop is ~0.001° (~110 m) so
 *  `hasMeaningfulRoute` is satisfied. `speeds[i]` seeds sample i's speed. */
function route(speeds: (number | null)[]): DrivePosition[] {
  return speeds.map((s, i) => pos(47.6 + i * 0.001, -122.3 - i * 0.001, { speed: s }));
}

/* Segment colour for sample i is speedColor(positions[i].speed), so these five
 * speeds paint the four buckets plus the null→0 (green) null-safety path. */
const ROUTE = route([0, 10, 45, 80, 130, null]);
const STATIONARY = [pos(47.6, -122.3), pos(47.6, -122.3), pos(47.6, -122.3)];
const INVALID = [pos(0, 0), pos(0, 0)];

function renderMap(props: Partial<TripReplayMapProps> = {}) {
  const onSeekToIndex = props.onSeekToIndex ?? vi.fn();
  const utils = render(
    <TripReplayMap
      positions={props.positions ?? ROUTE}
      currentIndex={props.currentIndex ?? 0}
      onSeekToIndex={onSeekToIndex}
      reduceMotion={props.reduceMotion}
      initialMapStyle={props.initialMapStyle}
      className={props.className}
      height={props.height}
    />,
  );
  return { ...utils, onSeekToIndex };
}

const markerColors = (arr: any[]) => arr.map((m) => m.pathOptions?.color);

beforeEach(() => {
  maps.containers.length = 0;
  maps.tileLayers.length = 0;
  maps.polylines.length = 0;
  maps.circleMarkers.length = 0;
  maps.animatedMarkers.length = 0;
  maps.layerSwitchers.length = 0;
  maps.map.fitBounds.mockClear();
  maps.map.setView.mockClear();
  maps.nextClick = { lat: 47.6, lng: -122.3 };
});

describe('nearestSampleIndex', () => {
  const line = route([0, 0, 0]); // (47.6,-122.3) (47.601,-122.301) (47.602,-122.302)

  it('returns 0 for an empty positions array (no crash, safe default)', () => {
    expect(nearestSampleIndex([], 47.6, -122.3)).toBe(0);
  });

  it('returns the index of an exact coordinate hit', () => {
    expect(nearestSampleIndex(line, 47.601, -122.301)).toBe(1);
  });

  it('returns the nearest sample when the click lands between points', () => {
    // A point hugging the last sample must resolve to index 2, not 0/1.
    expect(nearestSampleIndex(line, 47.60205, -122.30205)).toBe(2);
    // A point hugging the first sample resolves to 0.
    expect(nearestSampleIndex(line, 47.5999, -122.2999)).toBe(0);
  });
});

describe('TripReplayMap — empty state', () => {
  it('renders the shared empty state and mounts no map when positions is empty', () => {
    renderMap({ positions: [] });

    expect(
      screen.getByText('No position data available for this drive'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('map-container')).toBeNull();
    expect(screen.queryByTestId('polyline')).toBeNull();
  });

  it('exposes the panel as a labelled region for screen readers', () => {
    renderMap({ positions: [] });
    expect(screen.getByRole('region', { name: 'Trip route map' })).toBeInTheDocument();
  });
});

describe('TripReplayMap — meaningful route', () => {
  it('mounts the map with the tile layer, polyline segments, and start/end pins', () => {
    renderMap();

    expect(screen.getByTestId('map-container')).toBeInTheDocument();
    expect(screen.getByTestId('tile-layer')).toHaveAttribute('data-style', 'dark');

    // 6 samples → 5 speed segments.
    expect(screen.getAllByTestId('polyline')).toHaveLength(5);

    // Exactly two circle markers: the green start pin and the red end pin.
    expect(maps.circleMarkers).toHaveLength(2);
    expect(markerColors(maps.circleMarkers)).toEqual(
      expect.arrayContaining([GREEN, RED]),
    );

    // The route case never surfaces the stationary banner.
    expect(screen.queryByText("Route can't be plotted")).toBeNull();
  });

  it('anchors the start pin at the first sample and the end pin at the last', () => {
    renderMap();
    const start = maps.circleMarkers.find((m) => m.pathOptions.color === GREEN);
    const end = maps.circleMarkers.find((m) => m.pathOptions.color === RED);
    expect(start.center).toEqual([47.6, -122.3]);
    // Float accumulation across 5 hops → compare component-wise with tolerance.
    expect(end.center[0]).toBeCloseTo(47.605, 6);
    expect(end.center[1]).toBeCloseTo(-122.305, 6);
  });

  it('fits the map to the derived route bounds (not a collapsed dot)', () => {
    renderMap();
    expect(maps.map.fitBounds).toHaveBeenCalledTimes(1);
    expect(maps.map.fitBounds.mock.calls[0][1]).toEqual({ padding: [40, 40] });
    expect(maps.map.setView).not.toHaveBeenCalled();
  });

  it('renders the animated playhead with a valid heading and enables animation', () => {
    renderMap({ currentIndex: 0 });

    expect(maps.animatedMarkers).toHaveLength(1);
    const playhead = maps.animatedMarkers[0];
    expect(playhead.color).toBe(PLAYHEAD);
    expect(playhead.position).toEqual([47.6, -122.3]);
    // Sample 0→1 travels north-west, so the compass bearing sits in (270,360).
    expect(playhead.heading).toBeGreaterThan(270);
    expect(playhead.heading).toBeLessThan(360);
    // Animations on (reduced-motion is false by default).
    expect(maps.containers[0].fadeAnimation).toBe(true);
  });

  it('honours initialMapStyle for the tile layer', () => {
    renderMap({ initialMapStyle: 'terrain' });
    expect(screen.getByTestId('tile-layer')).toHaveAttribute('data-style', 'terrain');
  });
});

describe('TripReplayMap — speed-coloured segments', () => {
  it('colours each segment by the arriving sample speed and treats null speed as 0', () => {
    renderMap();
    // curr speeds 10,45,80,130,null → green, cyan, amber, red, green(null→0).
    expect(maps.polylines.map((p) => p.pathOptions.color)).toEqual([
      GREEN,
      CYAN,
      AMBER,
      RED,
      GREEN,
    ]);
  });
});

describe('TripReplayMap — reduced motion', () => {
  it('snaps the playhead to a CircleMarker and disables map animation', () => {
    renderMap({ reduceMotion: true, currentIndex: 1 });

    // No animated marker under reduced motion.
    expect(maps.animatedMarkers).toHaveLength(0);
    // Start, end, and the snapped playhead → 3 circle markers.
    expect(maps.circleMarkers).toHaveLength(3);
    expect(markerColors(maps.circleMarkers)).toEqual(
      expect.arrayContaining([GREEN, RED, PLAYHEAD]),
    );
    const playhead = maps.circleMarkers.find((m) => m.pathOptions.color === PLAYHEAD);
    expect(playhead.center).toEqual([47.601, -122.301]);
    expect(maps.containers[0].fadeAnimation).toBe(false);
  });
});

describe('TripReplayMap — stationary GPS', () => {
  it('shows the banner, a single anchor marker, and no polyline', () => {
    renderMap({ positions: STATIONARY });

    expect(screen.getByText("Route can't be plotted")).toBeInTheDocument();
    expect(screen.getByText(/Only one GPS coordinate was recorded/)).toBeInTheDocument();
    expect(screen.queryByTestId('polyline')).toBeNull();

    // One cyan anchor marker so the user still sees where the drive happened.
    expect(maps.circleMarkers).toHaveLength(1);
    expect(maps.circleMarkers[0].pathOptions.color).toBe(ANCHOR);
    expect(maps.circleMarkers[0].center).toEqual([47.6, -122.3]);
    // No playhead when there is no route.
    expect(maps.animatedMarkers).toHaveLength(0);
  });

  it('falls back to setView on the anchor instead of a zero-extent fitBounds', () => {
    renderMap({ positions: STATIONARY });
    expect(maps.map.fitBounds).not.toHaveBeenCalled();
    expect(maps.map.setView).toHaveBeenCalledWith([47.6, -122.3], 15);
  });
});

describe('TripReplayMap — all-invalid GPS (null safety)', () => {
  it('renders the map and banner without any markers or crash', () => {
    expect(() => renderMap({ positions: INVALID })).not.toThrow();

    expect(screen.getByTestId('map-container')).toBeInTheDocument();
    expect(screen.getByText("Route can't be plotted")).toBeInTheDocument();
    // No valid anchor → no markers at all, but never a thrown render.
    expect(maps.circleMarkers).toHaveLength(0);
    expect(maps.animatedMarkers).toHaveLength(0);
    // No fallback centre either, so neither fit nor setView fires.
    expect(maps.map.fitBounds).not.toHaveBeenCalled();
    expect(maps.map.setView).not.toHaveBeenCalled();
  });
});

describe('TripReplayMap — polyline click → seek', () => {
  it('maps a polyline click to the nearest sample index and calls onSeekToIndex', () => {
    const onSeekToIndex = vi.fn();
    maps.nextClick = { lat: 47.60405, lng: -122.30405 }; // hugs sample index 4
    renderMap({ onSeekToIndex });

    fireEvent.click(screen.getAllByTestId('polyline')[0]);

    expect(onSeekToIndex).toHaveBeenCalledTimes(1);
    expect(onSeekToIndex).toHaveBeenCalledWith(4);
  });

  it('resolves a click near the origin to index 0', () => {
    const onSeekToIndex = vi.fn();
    maps.nextClick = { lat: 47.5999, lng: -122.2999 };
    renderMap({ onSeekToIndex });

    fireEvent.click(screen.getAllByTestId('polyline')[1]);
    expect(onSeekToIndex).toHaveBeenCalledWith(0);
  });
});

describe('TripReplayMap — layer switcher', () => {
  it('threads a new tile style through when the switcher fires onChange', () => {
    renderMap();
    expect(screen.getByTestId('tile-layer')).toHaveAttribute('data-style', 'dark');

    fireEvent.click(screen.getByTestId('layer-switch'));

    expect(screen.getByTestId('tile-layer')).toHaveAttribute('data-style', 'satellite');
    // The switcher is told the current selection so it can mark it active.
    expect(maps.layerSwitchers[maps.layerSwitchers.length - 1].current).toBe('satellite');
  });
});

describe('TripReplayMap — out-of-range currentIndex (regression guard)', () => {
  it('clamps an index past the last sample instead of crashing', () => {
    expect(() => renderMap({ currentIndex: 999 })).not.toThrow();
    // currentPosition is null out of range → no playhead, but the map still draws.
    expect(screen.queryByTestId('animated-marker')).toBeNull();
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
    expect(screen.getAllByTestId('polyline')).toHaveLength(5);
  });

  it('clamps a negative currentIndex instead of crashing', () => {
    expect(() => renderMap({ currentIndex: -7 })).not.toThrow();
    expect(screen.queryByTestId('animated-marker')).toBeNull();
  });
});

describe('TripReplayMap — height prop', () => {
  it('converts a numeric height to a px string on the panel', () => {
    renderMap({ height: 320 });
    expect(screen.getByTestId('trip-replay-map')).toHaveStyle({ height: '320px' });
  });

  it('passes a string height through verbatim', () => {
    renderMap({ height: '60vh' });
    expect(screen.getByTestId('trip-replay-map')).toHaveStyle({ height: '60vh' });
  });
});
