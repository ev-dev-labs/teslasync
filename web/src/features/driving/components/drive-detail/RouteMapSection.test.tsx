/**
 * RouteMapSection — behaviour + hardening contract.
 *
 * RouteMapSection is the drive-detail route map. It owns no data source: the
 * parent (`useDriveDetailData`) hands it an already-derived `trail`,
 * `speedSegments`, `startPos`/`endPos`, `centerPos` plus the raw `drive`
 * (whose `positions` it re-scans for the stationary-GPS heuristic). These tests
 * pin every branch a user can reach plus the hardening this elevation added:
 *
 *   - EMPTY   → an empty trail collapses to the "No route data" placeholder,
 *               never a blank leaflet container, and no map side effects fire;
 *   - NULL-SAFE→ an `undefined` trail / speedSegments (a partial hook shape)
 *               no longer throws on `.length` / `.map` — it renders the same
 *               empty state (the `?? []` hardening);
 *   - ROUTE    → a meaningful multi-point route renders the tile layer, one
 *               polyline per speed segment, start + end markers, the km/h speed
 *               legend, and fits the viewport to the bounds;
 *   - IN-PROGRESS→ a null `endTs` swaps the end popup to "In progress" AND hides
 *               the bottom "End:" label, while the "Start:" label stays;
 *   - STATIONARY→ positions clustered within ~10 m (real `hasMeaningfulRoute`)
 *               drop the polyline for a single last-known marker at the first
 *               VALID coord (`firstValidIndex` skips the (0,0) GPS placeholder),
 *               show the explanatory banner, suppress the legend + trip markers,
 *               and hand the map a fixed anchor view;
 *   - DEGENERATE→ a meaningful drive whose trail collapses to identical coords
 *               (zero-extent bbox) still falls back to the anchor `setView`
 *               instead of letting leaflet zoom past maxZoom on an empty box;
 *   - mi PREF  → the legend flips to mph and the thresholds convert through the
 *               real `convertSpeedFromSI`;
 *   - a11y + interaction → the map is exposed as a named region and the layer
 *               switcher drives the tile style.
 *
 * `@/components/maps` is mocked to lightweight capture components (real leaflet
 * `latLngBounds` is kept so FitBounds' spread maths runs for real) and a spied
 * `useMap`, since the fit/setView calls are the logic under test and never
 * surface as visible text. `react-i18next` echoes the English fallback, `FadeIn`
 * is a passthrough (its framer-motion / matchMedia reach is irrelevant here),
 * and `useUnits` is the settings-backed boundary hook driving the km/mi branch —
 * the pure geo, date, number and unit helpers all run for real. Interactions use
 * `fireEvent` (repo convention — `@testing-library/user-event` is not installed).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';

import { RouteMapSection } from './RouteMapSection';
import {
  SPEED_SEGMENT_LOW_MPS,
  SPEED_SEGMENT_MED_MPS,
  SPEED_SEGMENT_HIGH_MPS,
} from './constants';
import { convertSpeedFromSI } from '@/lib/unitConversion';
import { fmtNumber } from '@/lib/numberFormat';
import type { DriveDetail, DrivePosition } from '@/types/driving';
import type { FsdEvidenceInterval } from '@/types/fsd';
import type { RoutePoint, SpeedSegment } from './types';

/* ── Hoisted controllable state (read inside the vi.mock factories) ─────────── */
const mapCtl = vi.hoisted(() => ({
  fitBounds: vi.fn(),
  setView: vi.fn(),
}));
const unitCtl = vi.hoisted(() => ({ speed: 'km/h' as 'km/h' | 'mph' }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// FadeIn reaches for framer-motion + matchMedia via useMotionPreference; a
// passthrough keeps the test focused on RouteMapSection's own logic.
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: unitCtl.speed === 'mph' ? 'mi' : 'km',
      speed: unitCtl.speed,
      temperature: '°C',
      pressure: 'bar',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
      precision: 2,
    },
  }),
}));

// Capture the leaflet plumbing. The fit/setView side effects are the logic under
// test, so `useMap` returns a spied instance; the visual children just echo the
// props RouteMapSection feeds them. Real `latLngBounds` keeps FitBounds' spread
// arithmetic honest.
vi.mock('@/components/maps', async () => {
  const leaflet = await vi.importActual<typeof import('leaflet')>('leaflet');
  return {
    latLngBounds: leaflet.latLngBounds,
    useMap: () => mapCtl,
    MapContainer: ({ children, center, zoom }: { children?: ReactNode; center: unknown; zoom: number }) => (
      <div data-testid="map-container" data-center={JSON.stringify(center)} data-zoom={String(zoom)}>
        {children}
      </div>
    ),
     
    Polyline: ({ positions, pathOptions }: any) => (
      <div data-testid="polyline" data-color={pathOptions?.color} data-count={String((positions ?? []).length)} />
    ),
     
    CircleMarker: ({ center, pathOptions, children }: any) => (
      <div data-testid="circle-marker" data-center={JSON.stringify(center)} data-color={pathOptions?.color}>
        {children}
      </div>
    ),
    Popup: ({ children }: { children?: ReactNode }) => <div data-testid="popup">{children}</div>,
    MapTileLayer: ({ style }: { style?: string }) => <div data-testid="tile-layer" data-style={style} />,
    MapInvalidator: () => <div data-testid="map-invalidator" />,
     
    MapLayerSwitcher: ({ current, onChange }: any) => (
      <div data-testid="layer-switcher">
        {(['dark', 'satellite', 'streets', 'terrain'] as const).map((s) => (
          <button key={s} type="button" aria-pressed={current === s} onClick={() => onChange(s)}>
            {s}
          </button>
        ))}
      </div>
    ),
  };
});

/* ── Fixtures ──────────────────────────────────────────────────────────────── */
function makePos(latitude: number, longitude: number): DrivePosition {
  return {
    latitude,
    longitude,
    speed: 20,
    power: 15,
    batteryLevel: 70,
    timestamp: '2025-03-01T10:00:00Z',
    insideTemp: 21,
    outsideTemp: 14,
    idealRange: 300,
    ratedRange: 280,
    odometer: 10000,
    elevation: 40,
    fanStatus: 2,
    isClimateOn: true,
  };
}

function makeDrive(overrides: Partial<DriveDetail> = {}): DriveDetail {
  return {
    id: 42,
    vehicleId: 1,
    startTs: '2025-03-01T10:00:00Z',
    endTs: '2025-03-01T10:45:00Z',
    durationS: 2700,
    distanceM: 32000,
    startAddress: 'Downtown Seattle',
    endAddress: 'SeaTac Airport',
    startLat: 47.6,
    startLon: -122.33,
    endLat: 47.44,
    endLon: -122.3,
    startBatteryPct: 82,
    endBatteryPct: 68,
    energyUsedWh: 7200,
    regenEnergyWh: 900,
    avgSpeedMps: 20,
    maxSpeedMps: 31,
    avgPowerW: 15000,
    outsideTempAvgC: 14,
    insideTempAvgC: 21,
    score: 88,
    endedStatus: 'parked',
    createdAt: '2025-03-01T10:45:05Z',
    updatedAt: '2025-03-01T10:45:05Z',
    positions: [],
    telemetry: [],
    ...overrides,
  };
}

// Two coordinates ~18 km apart — well above the 10 m meaningful-route floor.
const START: [number, number] = [47.6, -122.33];
const END: [number, number] = [47.44, -122.3];
const CENTER: [number, number] = [47.52, -122.31];
const SPREAD_TRAIL: [number, number][] = [START, END];
const SEGMENTS: SpeedSegment[] = [
  { positions: [START, [47.52, -122.31]], color: '#10b981' },
  { positions: [[47.52, -122.31], END], color: '#ef4444' },
];

interface RenderOpts {
  drive?: DriveDetail;
  trail?: [number, number][];
  startPos?: [number, number];
  endPos?: [number, number];
  centerPos?: [number, number];
  speedSegments?: SpeedSegment[];
  routePoints?: RoutePoint[];
  fsdEvidence?: FsdEvidenceInterval[];
}

function renderSection(opts: RenderOpts = {}) {
  return render(
    <RouteMapSection
      drive={opts.drive ?? makeDrive()}
      trail={opts.trail as never}
      startPos={opts.startPos}
      endPos={opts.endPos}
      centerPos={opts.centerPos ?? CENTER}
      speedSegments={opts.speedSegments as never}
      routePoints={opts.routePoints}
      fsdEvidence={opts.fsdEvidence}
    />,
  );
}

/** A fully meaningful route: spread positions + trail + both markers + segments. */
function renderMeaningfulRoute(driveOverrides: Partial<DriveDetail> = {}) {
  return renderSection({
    drive: makeDrive({ positions: [makePos(...START), makePos(...END)], ...driveOverrides }),
    trail: SPREAD_TRAIL,
    startPos: START,
    endPos: END,
    speedSegments: SEGMENTS,
  });
}

beforeEach(() => {
  mapCtl.fitBounds.mockClear();
  mapCtl.setView.mockClear();
  unitCtl.speed = 'km/h';
});

/* ── EMPTY / NULL-SAFETY ───────────────────────────────────────────────────── */
describe('RouteMapSection — empty + null-safety', () => {
  it('renders the no-route placeholder (never a blank map) when the trail is empty', () => {
    renderSection({ drive: makeDrive({ positions: [] }), trail: [], speedSegments: [] });

    expect(screen.getByText('No route data available for this drive')).toBeInTheDocument();
    // No leaflet container and no viewport side effects when there is nothing to plot.
    expect(screen.queryByTestId('map-container')).toBeNull();
    expect(mapCtl.fitBounds).not.toHaveBeenCalled();
    expect(mapCtl.setView).not.toHaveBeenCalled();
    // The panel heading still anchors the section.
    expect(screen.getByRole('heading', { name: 'Route' })).toBeInTheDocument();
  });

  it('tolerates an undefined trail and speedSegments without throwing (?? [] hardening)', () => {
    // A partial hook shape must degrade to the empty state, not crash on .length/.map.
    expect(() =>
      renderSection({ drive: makeDrive({ positions: [] }), trail: undefined, speedSegments: undefined }),
    ).not.toThrow();

    expect(screen.getByText('No route data available for this drive')).toBeInTheDocument();
    expect(screen.queryByTestId('map-container')).toBeNull();
  });
});

/* ── MEANINGFUL ROUTE (km) ─────────────────────────────────────────────────── */
describe('RouteMapSection — meaningful route (km)', () => {
  it('renders the map, tile layer and one polyline per speed segment', () => {
    renderMeaningfulRoute();

    const map = screen.getByTestId('map-container');
    expect(map).toBeInTheDocument();
    // 2+ points → the closer street-level zoom, centred on the supplied center.
    expect(map).toHaveAttribute('data-zoom', '13');
    expect(map).toHaveAttribute('data-center', JSON.stringify(CENTER));
    expect(screen.getByTestId('tile-layer')).toHaveAttribute('data-style', 'dark');

    const polylines = screen.getAllByTestId('polyline');
    expect(polylines).toHaveLength(2);
    expect(polylines[0]).toHaveAttribute('data-color', '#10b981');
    expect(polylines[1]).toHaveAttribute('data-color', '#ef4444');
  });

  it('renders start and end markers (with popups) and no stationary marker/banner', () => {
    renderMeaningfulRoute();

    const markers = screen.getAllByTestId('circle-marker');
    const colors = markers.map((m) => m.getAttribute('data-color'));
    expect(colors).toContain('#10b981'); // start
    expect(colors).toContain('#ef4444'); // end
    // Popups carry the exact "Start"/"End" labels…
    expect(screen.getByText('Start')).toBeInTheDocument();
    expect(screen.getByText('End')).toBeInTheDocument();
    // …and the stationary affordances are absent for a real route.
    expect(screen.queryByText('Last known location')).toBeNull();
    expect(screen.queryByText(/Route can.t be plotted/)).toBeNull();
  });

  it('renders the speed legend with km/h thresholds only when the trail has 2+ points', () => {
    renderMeaningfulRoute();

    expect(screen.getByText('km/h')).toBeInTheDocument();
    const low = fmtNumber(convertSpeedFromSI(SPEED_SEGMENT_LOW_MPS, 'km/h'));
    const high = fmtNumber(convertSpeedFromSI(SPEED_SEGMENT_HIGH_MPS, 'km/h'));
    // Thresholds come straight from the real SI converter (30 mph ≈ 48.28 km/h).
    expect(screen.getAllByText((c) => c.includes(low)).length).toBeGreaterThan(0);
    expect(screen.getAllByText((c) => c.includes(high)).length).toBeGreaterThan(0);
  });

  it('fits the map viewport to the route bounds', () => {
    renderMeaningfulRoute();

    expect(mapCtl.fitBounds).toHaveBeenCalledTimes(1);
    expect(mapCtl.setView).not.toHaveBeenCalled();
  });

  it('renders only a dashed approximate overlay for counter-increase evidence', () => {
    renderSection({
      drive: makeDrive({ positions: [makePos(...START), makePos(...END)] }),
      trail: SPREAD_TRAIL,
      startPos: START,
      endPos: END,
      speedSegments: SEGMENTS,
      routePoints: [
        { lat: START[0], lng: START[1], speed: 10, timestamp: '2025-03-01T10:00:00Z' },
        { lat: END[0], lng: END[1], speed: 12, timestamp: '2025-03-01T10:10:00Z' },
      ],
      fsdEvidence: [{
        start_at: '2025-03-01T10:04:00Z',
        end_at: '2025-03-01T10:06:00Z',
        fsd_distance_m: 500,
        confidence: 'high',
        approximate: true,
      }],
    });

    expect(screen.getAllByTestId('polyline')).toHaveLength(3);
    expect(screen.getAllByTestId('polyline')[2]).toHaveAttribute('data-color', '#c084fc');
    expect(screen.getByText(/Approximate area where the FSD counter increased/)).toBeInTheDocument();
    expect(screen.getByText(/not an exact FSD-active segment/)).toBeInTheDocument();
  });

  it('does not extend approximate evidence into route segments that only touch a boundary', () => {
    renderSection({
      drive: makeDrive({ positions: [makePos(...START), makePos(...END)] }),
      trail: SPREAD_TRAIL,
      startPos: START,
      endPos: END,
      speedSegments: [],
      routePoints: [
        { lat: 47.60, lng: -122.30, speed: 10, timestamp: '2025-03-01T10:00:00Z' },
        { lat: 47.61, lng: -122.31, speed: 10, timestamp: '2025-03-01T10:05:00Z' },
        { lat: 47.62, lng: -122.32, speed: 10, timestamp: '2025-03-01T10:10:00Z' },
        { lat: 47.63, lng: -122.33, speed: 10, timestamp: '2025-03-01T10:15:00Z' },
      ],
      fsdEvidence: [{
        start_at: '2025-03-01T10:05:00Z',
        end_at: '2025-03-01T10:10:00Z',
        fsd_distance_m: 500,
        confidence: 'high',
        approximate: true,
      }],
    });

    expect(screen.getAllByTestId('polyline')).toHaveLength(1);
    expect(screen.getByTestId('polyline')).toHaveAttribute('data-color', '#c084fc');
  });

  it('shows the bottom Start and End labels for a completed drive', () => {
    renderMeaningfulRoute();

    // The bottom row labels carry the "<label>: <time>" shape (distinct from the
    // bare popup labels above).
    expect(screen.getByText(/^Start:/)).toBeInTheDocument();
    expect(screen.getByText(/^End:/)).toBeInTheDocument();
  });

  it('exposes the interactive map as a named region', () => {
    renderMeaningfulRoute();

    expect(screen.getByRole('region', { name: 'Route map' })).toBeInTheDocument();
  });
});

/* ── IN-PROGRESS DRIVE ─────────────────────────────────────────────────────── */
describe('RouteMapSection — in-progress drive', () => {
  it('swaps the end popup to "In progress" and hides the bottom End label when endTs is null', () => {
    renderMeaningfulRoute({ endTs: null });

    expect(screen.getByText('In progress')).toBeInTheDocument();
    // The bottom "End: <time>" label is gated on a real endTs…
    expect(screen.queryByText(/^End:/)).toBeNull();
    // …while the start label is unconditional.
    expect(screen.getByText(/^Start:/)).toBeInTheDocument();
  });
});

/* ── STATIONARY GPS ────────────────────────────────────────────────────────── */
describe('RouteMapSection — stationary GPS cluster', () => {
  // (0,0) is the Tesla "no fix yet" placeholder; the two real samples sit on the
  // same coord → hasMeaningfulRoute() is false, anchor is the first VALID index.
  const ANCHOR: [number, number] = [47.61, -122.34];
  const stationaryDrive = () =>
    makeDrive({ positions: [makePos(0, 0), makePos(...ANCHOR), makePos(...ANCHOR)] });

  it('renders the explanatory banner and a single last-known marker instead of a route', () => {
    renderSection({
      drive: stationaryDrive(),
      trail: [ANCHOR],
      startPos: START,
      endPos: END,
      speedSegments: SEGMENTS,
    });

    // Banner explains the collapse…
    expect(screen.getByText(/Route can.t be plotted/)).toBeInTheDocument();
    expect(screen.getByText(/the route can.t be drawn/)).toBeInTheDocument();
    // …a lone anchor marker sits at the first valid coord…
    expect(screen.getByText('Last known location')).toBeInTheDocument();
    const marker = screen.getByTestId('circle-marker');
    expect(marker).toHaveAttribute('data-center', JSON.stringify(ANCHOR));
    expect(marker).toHaveAttribute('data-color', '#22d3ee');
    // …and neither the polyline segments, the trip markers, nor the legend show.
    expect(screen.queryByTestId('polyline')).toBeNull();
    expect(screen.queryByText('Start')).toBeNull();
    expect(screen.queryByText('km/h')).toBeNull();
  });

  it('hands the map a fixed anchor view rather than fitting empty bounds', () => {
    renderSection({
      drive: stationaryDrive(),
      trail: [ANCHOR],
      speedSegments: [],
    });

    expect(mapCtl.setView).toHaveBeenCalledWith(ANCHOR, 15);
    expect(mapCtl.fitBounds).not.toHaveBeenCalled();
    // A single-point trail also drops to the world zoom.
    expect(screen.getByTestId('map-container')).toHaveAttribute('data-zoom', '3');
  });
});

/* ── DEGENERATE TRAIL (zero-extent bbox on an otherwise meaningful drive) ───── */
describe('RouteMapSection — degenerate zero-spread trail', () => {
  it('falls back to the anchor setView when the trail collapses to identical coords', () => {
    // Positions are genuinely spread (hasRoute = true, so segments/markers render)
    // but the derived trail collapsed to one repeated point — FitBounds must not
    // hand leaflet a zero-extent box.
    renderSection({
      drive: makeDrive({ positions: [makePos(...START), makePos(...END)] }),
      trail: [START, START],
      startPos: START,
      endPos: END,
      speedSegments: SEGMENTS,
    });

    expect(mapCtl.setView).toHaveBeenCalledWith(START, 15);
    expect(mapCtl.fitBounds).not.toHaveBeenCalled();
    // The route affordances still render because the positions are meaningful.
    expect(screen.getAllByTestId('polyline').length).toBeGreaterThan(0);
  });
});

/* ── mi PREFERENCE ─────────────────────────────────────────────────────────── */
describe('RouteMapSection — imperial preference', () => {
  it('renders the legend in mph with imperial thresholds', () => {
    unitCtl.speed = 'mph';
    renderMeaningfulRoute();

    expect(screen.getByText('mph')).toBeInTheDocument();
    const low = fmtNumber(convertSpeedFromSI(SPEED_SEGMENT_LOW_MPS, 'mph')); // "30.00"
    const med = fmtNumber(convertSpeedFromSI(SPEED_SEGMENT_MED_MPS, 'mph')); // "60.00"
    expect(screen.getAllByText((c) => c.includes(low)).length).toBeGreaterThan(0);
    expect(screen.getAllByText((c) => c.includes(med)).length).toBeGreaterThan(0);
    // Sanity: the km/h suffix must be gone in imperial mode.
    expect(screen.queryByText('km/h')).toBeNull();
  });
});

/* ── LAYER SWITCHER INTERACTION ────────────────────────────────────────────── */
describe('RouteMapSection — layer switcher', () => {
  it('drives the tile-layer style when a layer button is clicked', () => {
    renderMeaningfulRoute();

    expect(screen.getByTestId('tile-layer')).toHaveAttribute('data-style', 'dark');

    fireEvent.click(screen.getByRole('button', { name: 'satellite' }));
    expect(screen.getByTestId('tile-layer')).toHaveAttribute('data-style', 'satellite');

    fireEvent.click(screen.getByRole('button', { name: 'terrain' }));
    expect(screen.getByTestId('tile-layer')).toHaveAttribute('data-style', 'terrain');
  });
});
