/**
 * TripReplayPage — helper-branch + page-orchestration coverage.
 *
 * Two surfaces are exercised:
 *
 *   1. The pure, module-private helpers exported for testability:
 *      `fmtDuration` ("HH:MM:SS" / "MM:SS" with a non-finite/negative →
 *      "00:00" guard) and `fmtDriveTime` ("Xh Ym", rounding whole minutes
 *      first so a fractional input can't render the impossible "60m", and
 *      a non-finite/non-positive → "0m" guard). These carry the real branch
 *      logic behind the summary band.
 *
 *   2. The page's OWN behaviour: the loading / error(+refetch) / empty-GPS /
 *      populated postures; the SI→display conversions threaded through the
 *      summary KPI band, the current-position stats rail, the elevation
 *      profile and the speed/power timeline; and the shared `seekTo`
 *      handler that keeps the (stubbed) map + charts in lockstep through the
 *      REAL `useTripReplay` hook.
 *
 * Strategy (mirrors ../../driving/pages/SpeedProfilePage.test.tsx):
 *   - `useDrive` + `useUnits` are mocked with hoisted vi.fn()s so the network
 *     is never touched and each render is deterministic. The REAL
 *     `convertXFromSI` + `fmtNumber` + `useTripReplay` + `computeReplayMarkers`
 *     run, so the derivations are genuinely exercised.
 *   - The jsdom-hostile leaf surfaces (`TripReplayMap` → leaflet,
 *     `TripReplayCharts`/`ElevationProfile`/`Sparkline` → recharts,
 *     `PlaybackControls` → scrubber DOM) are stubbed to inert
 *     `React.createElement('div')` capture points so we can assert the exact
 *     props the page computed. `StatCard`/`MetricCard` stay REAL so the
 *     rendered summary/stat text is the genuine article.
 *   - react-i18next resolves the developer fallback string.
 *
 * `@testing-library/user-event` is intentionally NOT a dependency of this
 * codebase (see web/package.json) — interactions use `fireEvent` / `act`,
 * consistent with the other page tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// jsdom lacks matchMedia; framer-motion (<FadeIn>/<Stagger*>) + the <Spinner>'s
// useMotionPreference read it at module load for the reduced-motion preference.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

// Shared, hoisted test doubles so the mock factories below and the specs can
// both reach them.
const { captured, driveMock, unitsMock } = vi.hoisted(() => ({
   
  captured: {} as Record<string, any>,
  driveMock: vi.fn(),
  unitsMock: vi.fn(),
}));

// i18n → return the developer fallback string.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

// Drive the data hook deterministically without any network.
vi.mock('@/api/hooks/useDriving', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useDriving')>('@/api/hooks/useDriving');
  return {
    ...actual,
    useDrive: (...args: unknown[]) => driveMock(...args),
  };
});

vi.mock('@/hooks/useUnits', () => ({ useUnits: () => unitsMock() }));

// Stub the jsdom-hostile leaf surfaces. Each captures the props the page
// handed it so we can assert on the genuine derivations. createElement (not
// JSX) keeps jsx-a11y off the mock markup.
vi.mock('@/features/trips/components/TripReplayMap', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
     
    TripReplayMap: (props: any) => {
      captured.map = props;
      return React.createElement('div', { 'data-testid': 'trip-replay-map' });
    },
  };
});

vi.mock('@/features/trips/components/TripReplayCharts', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
     
    TripReplayCharts: (props: any) => {
      captured.charts = props;
      return React.createElement('div', { 'data-testid': 'trip-replay-charts' });
    },
  };
});

vi.mock('@/components/charts', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
     
    ElevationProfile: (props: any) => {
      captured.elevation = props;
      return React.createElement('div', { 'data-testid': 'elevation-profile' });
    },
     
    Sparkline: (props: any) => {
      captured.sparkline = props;
      return React.createElement('div', { 'data-testid': 'sparkline' });
    },
  };
});

// Keep StatCard / MetricCard REAL (they render the summary + stat text we
// assert on); stub only PlaybackControls (its scrubber DOM needs layout
// measurements jsdom can't supply) and capture its transport props.
vi.mock('@/components/data-display', async () => {
  const actual = await vi.importActual<typeof import('@/components/data-display')>('@/components/data-display');
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
     
    PlaybackControls: (props: any) => {
      captured.playback = props;
      return React.createElement('div', { 'data-testid': 'playback-controls' });
    },
  };
});

import TripReplayPage, { fmtDuration, fmtDriveTime } from '../TripReplayPage';
import {
  convertDistanceFromSI,
  convertSpeedFromSI,
  convertTempFromSI,
  type UnitPref,
} from '@/lib/unitConversion';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import type { Drive, DriveDetail, DrivePosition } from '@/types/driving';
import type { TripReplayChartPoint } from '@/features/trips/components/TripReplayCharts';
import type { ElevationDataPoint } from '@/components/charts';

/* ── Captured-prop shapes ─────────────────────────────────────────── */

interface CapturedMap {
  positions: DrivePosition[];
  currentIndex: number;
  onSeekToIndex: (i: number) => void;
  reduceMotion?: boolean;
  height?: number;
}
interface CapturedCharts {
  data: TripReplayChartPoint[];
  currentIndex: number;
  speedUnit: string;
  onSeekToIndex: (i: number) => void;
}
interface CapturedElevation {
  data: ElevationDataPoint[];
  currentIndex: number;
  onClickIndex: (i: number) => void;
  distanceUnit: string;
}
interface CapturedPlayback {
  isPlaying: boolean;
  progress: number;
  elapsed: string;
  markers: unknown[];
  getPreviewAt: (n: number) => unknown;
  onSeek: (p: number) => void;
  onPlay: () => void;
}

/* ── Unit-preference bags ─────────────────────────────────────────── */

const UNIT_PREFS_KM: UnitPref = {
  distance: 'km',
  speed: 'km/h',
  temperature: '°C',
  pressure: 'bar',
  energy: 'kWh',
  duration: 'h',
  power: 'kW',
  locale: 'en-US',
  precision: undefined,
};
const UNIT_PREFS_MI: UnitPref = { ...UNIT_PREFS_KM, distance: 'mi', speed: 'mph', temperature: '°F', pressure: 'psi' };

/* ── Fixtures ─────────────────────────────────────────────────────── */

// 1-minute spacing per sample → predictable timeline offsets (0/60k/120k/180k
// ms) so `totalTime` and the chart X-axis (minutes) are exact integers.
const BASE_MS = new Date('2024-06-15T12:00:00Z').getTime();

function makePosition(i: number, over: Partial<DrivePosition> = {}): DrivePosition {
  return {
    latitude: 47.6 + i * 0.02,
    longitude: -122.3 - i * 0.02,
    speed: null,
    power: null,
    batteryLevel: 80 - i * 2,
    timestamp: new Date(BASE_MS + i * 60_000).toISOString(),
    elevation: null,
    insideTemp: 21,
    outsideTemp: null,
    idealRange: null,
    ratedRange: null,
    odometer: 10_000 + i,
    fanStatus: 0,
    isClimateOn: false,
    ...over,
  };
}

// SI values: speed m/s, ratedRange m, outsideTemp °C, elevation m, power kW.
const POSITIONS: DrivePosition[] = [
  makePosition(0, { speed: 10, power: 5, elevation: 100, ratedRange: 300_000, outsideTemp: 20 }),
  makePosition(1, { speed: 20, power: 15, elevation: 130, ratedRange: 295_000, outsideTemp: 19 }),
  makePosition(2, { speed: 25, power: 30, elevation: 120, ratedRange: 290_000, outsideTemp: 18 }),
  makePosition(3, { speed: 15, power: -8, elevation: 160, ratedRange: 285_000, outsideTemp: 17 }),
];

function makeDrive(over: Partial<DriveDetail> = {}): DriveDetail {
  const base: Drive = {
    id: 7,
    vehicleId: 42,
    startTs: '2024-06-15T12:00:00Z',
    endTs: '2024-06-15T13:01:00Z',
    durationS: 3660, // 61 min → "1h 1m"
    distanceM: 12_000, // 12 km
    startAddress: 'Home',
    endAddress: 'Office',
    startLat: 47.6,
    startLon: -122.3,
    endLat: 47.66,
    endLon: -122.36,
    startBatteryPct: 90,
    endBatteryPct: 70,
    energyUsedWh: 3000,
    regenEnergyWh: 200,
    avgSpeedMps: 20, // 72 km/h
    maxSpeedMps: 30, // 108 km/h
    avgPowerW: 15_000,
    outsideTempAvgC: 19,
    insideTempAvgC: 21,
    score: 92,
    endedStatus: 'completed',
    createdAt: '2024-06-15T13:01:00Z',
    updatedAt: '2024-06-15T13:01:00Z',
  };
  return { ...base, positions: POSITIONS, telemetry: [], ...over };
}

 
function makeDriveQuery(over: { data?: DriveDetail; isLoading?: boolean; error?: unknown; refetch?: () => any } = {}) {
  return {
    data: over.data,
    isLoading: over.isLoading ?? false,
    isFetching: false,
    isStale: false,
    isError: over.error != null,
    error: over.error ?? null,
    dataUpdatedAt: Date.now(),
    refetch: over.refetch ?? vi.fn(),
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/drives/7/replay']}>
        <Routes>
          <Route path="/drives/:id/replay" element={<TripReplayPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(captured)) delete captured[key];
  driveMock.mockReturnValue(makeDriveQuery({ data: makeDrive() }));
  unitsMock.mockReturnValue({ unitPrefs: UNIT_PREFS_KM });
});

afterEach(() => {
  cleanup();
});

/* ── Specs: pure helpers ──────────────────────────────────────────── */

describe('fmtDuration', () => {
  it('collapses non-finite / non-positive input to "00:00"', () => {
    expect(fmtDuration(Number.NaN)).toBe('00:00');
    expect(fmtDuration(Number.POSITIVE_INFINITY)).toBe('00:00');
    expect(fmtDuration(0)).toBe('00:00');
    expect(fmtDuration(-5_000)).toBe('00:00');
  });

  it('renders sub-hour durations as zero-padded "MM:SS"', () => {
    expect(fmtDuration(65_000)).toBe('01:05'); // 1m 5s
    expect(fmtDuration(600_000)).toBe('10:00'); // 10m
    expect(fmtDuration(9_000)).toBe('00:09'); // 9s
  });

  it('promotes hour-plus durations to "H:MM:SS"', () => {
    expect(fmtDuration(3_661_000)).toBe('1:01:01'); // 1h 1m 1s
    expect(fmtDuration(7_200_000)).toBe('2:00:00'); // 2h
  });
});

describe('fmtDriveTime', () => {
  it('collapses non-finite / non-positive input to "0m"', () => {
    expect(fmtDriveTime(0)).toBe('0m');
    expect(fmtDriveTime(-5)).toBe('0m');
    expect(fmtDriveTime(Number.NaN)).toBe('0m');
  });

  it('formats sub-hour and hour-plus minute counts', () => {
    expect(fmtDriveTime(45)).toBe('45m');
    expect(fmtDriveTime(90)).toBe('1h 30m');
    expect(fmtDriveTime(120)).toBe('2h 0m');
    expect(fmtDriveTime(61)).toBe('1h 1m');
  });

  it('rounds whole minutes first so 59.6 rolls over to "1h 0m" (never "60m")', () => {
    // Regression: the previous `Math.round(min % 60)` produced the impossible
    // "60m" for any fractional input that rounded the minute component to 60.
    expect(fmtDriveTime(59.6)).toBe('1h 0m');
    expect(fmtDriveTime(119.7)).toBe('2h 0m');
  });
});

/* ── Specs: page postures ─────────────────────────────────────────── */

describe('TripReplayPage postures', () => {
  it('shows only the page spinner while the drive load is in flight', () => {
    driveMock.mockReturnValue(makeDriveQuery({ isLoading: true }));
    renderPage();

    expect(screen.getByRole('status', { name: 'Loading…' })).toBeInTheDocument();
    // The title renders above the loading gate; the data sections do not.
    expect(screen.getByRole('heading', { level: 1, name: 'Trip Replay' })).toBeInTheDocument();
    expect(screen.queryByText('Distance')).not.toBeInTheDocument();
    expect(captured.map).toBeUndefined();
  });

  it('surfaces a drive fetch error with its message and no data sections', () => {
    driveMock.mockReturnValue(makeDriveQuery({ error: new Error('drive fetch failed') }));
    renderPage();

    // ErrorDisplay renders production-safe structured copy rather than the
    // raw error.message — status-less errors fall into the network branch.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByTestId('trip-replay-map')).not.toBeInTheDocument();
    expect(captured.map).toBeUndefined();
  });

  it('renders the summary band but a GPS empty-state when the drive has no positions', () => {
    driveMock.mockReturnValue(
      makeDriveQuery({
        data: makeDrive({
          positions: [],
          avgSpeedMps: null,
          maxSpeedMps: null,
          startBatteryPct: null,
          endBatteryPct: null,
        }),
      }),
    );
    renderPage();

    // Summary KPI band still renders (it reads the drive record, not the trail).
    expect(screen.getByText('Distance')).toBeInTheDocument();
    expect(
      screen.getByText(
        'No GPS data available for this drive. Trip replay requires valid position coordinates from Fleet Telemetry.',
      ),
    ).toBeInTheDocument();
    // The map / scrubber / charts are gated behind the empty branch.
    expect(screen.queryByTestId('trip-replay-map')).not.toBeInTheDocument();
    expect(captured.map).toBeUndefined();
    // avg/max speed, efficiency, battery, elevation gain + loss → "—".
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
  });
});

/* ── Specs: populated page orchestration ──────────────────────────── */

describe('TripReplayPage populated', () => {
  it('renders every summary + current-position section (no hidden panels)', () => {
    renderPage();

    for (const label of ['Distance', 'Duration', 'Avg Speed', 'Max Speed', 'Efficiency', 'Elevation Gain', 'Elevation Loss']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    for (const label of ['Speed', 'Power', 'Elevation', 'Range', 'Temperature']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // "Battery" labels both the summary tile and the live-stats card.
    expect(screen.getAllByText('Battery').length).toBeGreaterThanOrEqual(2);
    // All three heavy surfaces mounted.
    expect(screen.getByTestId('trip-replay-map')).toBeInTheDocument();
    expect(screen.getByTestId('elevation-profile')).toBeInTheDocument();
    expect(screen.getByTestId('trip-replay-charts')).toBeInTheDocument();
  });

  it('converts the summary KPIs from SI to the km/h · km display units', () => {
    renderPage();

    // distance 12000 m → 12 km ; avg 20 m/s → 72 km/h ; max 30 m/s → 108 km/h.
    expect(screen.getByText(fmtNumber(convertDistanceFromSI(12_000, 'km')))).toBeInTheDocument();
    expect(screen.getByText(fmtNumber(convertSpeedFromSI(20, 'km/h')))).toBeInTheDocument();
    expect(screen.getByText(fmtNumber(convertSpeedFromSI(30, 'km/h')))).toBeInTheDocument();
    // durationS 3660 → 61 min → "1h 1m" ; battery band "90% → 70%".
    expect(screen.getByText('1h 1m')).toBeInTheDocument();
    expect(screen.getByText('90% → 70%')).toBeInTheDocument();
  });

  it('sums positive/negative elevation deltas for the summary band', () => {
    renderPage();
    // 100→130 (+30), 130→120 (−10), 120→160 (+40) ⇒ gain 70, loss 10.
    expect(screen.getByText('70')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('feeds SI-converted, timestamp-indexed series to the elevation + timeline charts', () => {
    renderPage();

    const charts = captured.charts as CapturedCharts;
    expect(charts.speedUnit).toBe('km/h');
    expect(charts.data).toHaveLength(4);
    expect(charts.data.map((d) => d.time)).toEqual([0, 1, 2, 3]); // minutes since start
    expect(charts.data[2].speed).toBe(convertSpeedFromSI(25, 'km/h')); // 90 km/h
    expect(charts.data[0].power).toBe(5);

    const elevation = captured.elevation as CapturedElevation;
    expect(elevation.distanceUnit).toBe('km');
    expect(elevation.data).toHaveLength(4);
    expect(elevation.data[0].distance).toBe(0);
    expect(elevation.data.map((d) => d.elevation)).toEqual([100, 130, 120, 160]);
    // Cumulative haversine distance is monotonically non-decreasing.
    expect(elevation.data[3].distance).toBeGreaterThan(elevation.data[1].distance);
  });

  it('hands the map its SI trail + initial playhead + resolved motion preference', () => {
    renderPage();

    const map = captured.map as CapturedMap;
    expect(map.positions).toHaveLength(4);
    expect(map.positions[2].speed).toBe(25); // SI passed through untouched
    expect(map.currentIndex).toBe(0);
    expect(map.reduceMotion).toBe(false);
    expect(typeof map.onSeekToIndex).toBe('function');
  });

  it('wires the scrubber transport props off the replay hook', () => {
    renderPage();

    const pb = captured.playback as CapturedPlayback;
    expect(pb.isPlaying).toBe(false);
    expect(pb.progress).toBe(0);
    expect(pb.elapsed).toBe('00:00'); // fmtDuration(elapsedTime = 0)
    expect(Array.isArray(pb.markers)).toBe(true);
    expect(typeof pb.getPreviewAt).toBe('function');
    expect(typeof pb.onSeek).toBe('function');
  });

  it('re-derives every figure when the unit preference flips to mph / mi', () => {
    unitsMock.mockReturnValue({ unitPrefs: UNIT_PREFS_MI });
    renderPage();

    const charts = captured.charts as CapturedCharts;
    expect(charts.speedUnit).toBe('mph');
    expect(charts.data[2].speed).toBeCloseTo(convertSpeedFromSI(25, 'mph'), 5);

    const elevation = captured.elevation as CapturedElevation;
    expect(elevation.distanceUnit).toBe('mi');

    // Summary distance now reads in miles (12000 m → ~7.46 mi).
    expect(screen.getByText(fmtNumber(convertDistanceFromSI(12_000, 'mi')))).toBeInTheDocument();
  });

  it('shares one seek handler so a map click moves the charts + live stats in lockstep', () => {
    renderPage();

    // Sanity: the live Speed card starts on position 0 (10 m/s → 36 km/h).
    expect(
      screen.getByText(`${fmtNumber(convertSpeedFromSI(10, 'km/h'))} km/h`),
    ).toBeInTheDocument();

    // A polyline click resolves to sample index 2 and drives the shared hook.
    act(() => {
      (captured.map as CapturedMap).onSeekToIndex(2);
    });

    expect((captured.map as CapturedMap).currentIndex).toBe(2);
    expect((captured.charts as CapturedCharts).currentIndex).toBe(2);
    // The live-stats rail followed the playhead to position 2 (25 m/s → 90 km/h).
    expect(
      screen.getByText(`${fmtNumber(convertSpeedFromSI(25, 'km/h'))} km/h`),
    ).toBeInTheDocument();
  });

  it('renders the current-position stats from position 0 with SI conversions + null-safe fallbacks', () => {
    renderPage();

    const p0 = POSITIONS[0];
    expect(screen.getByText(`${fmtNumber(convertSpeedFromSI(p0.speed!, 'km/h'))} km/h`)).toBeInTheDocument();
    expect(screen.getByText(`${fmtNumber(p0.power!, 1)} kW`)).toBeInTheDocument();
    expect(screen.getByText(`${fmtInt(p0.batteryLevel)}%`)).toBeInTheDocument();
    expect(screen.getByText(`${fmtInt(p0.elevation!)} m`)).toBeInTheDocument();
    expect(
      screen.getByText(`${fmtNumber(convertDistanceFromSI(p0.ratedRange!, 'km'))} km`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`${fmtNumber(convertTempFromSI(p0.outsideTemp!, '°C'))} °C`),
    ).toBeInTheDocument();
  });

  it('invokes the drive query refetch when the refresh action is clicked', () => {
    const refetch = vi.fn();
    driveMock.mockReturnValue(makeDriveQuery({ data: makeDrive(), refetch }));
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh replay data' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
