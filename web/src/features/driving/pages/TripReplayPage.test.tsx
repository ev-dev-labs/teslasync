/**
 * TripReplayPage contract + hardening tests.
 *
 * `features/driving/pages/TripReplayPage` is a thin re-export shim for the real
 * implementation at `features/trips/pages/TripReplayPage`, so exercising the
 * default export through this path covers BOTH the shim and the page. The page
 * is the orchestration layer for a single drive replay: it pulls the drive from
 * `useDrive`, normalises the position trail, threads a single `currentIndex`
 * through the (heavy, separately-tested) map / scrubber / chart leaves, owns the
 * always-visible Drive-Summary KPI band, and gates the replay surfaces behind a
 * "does this drive have a GPS trail?" check. These tests control the query hook
 * and unit preference and stub the leaf components (each has its own suite) so
 * the assertions target the page's own logic:
 *
 *   1. Loading  → PageContainer's spinner owns the screen; no KPIs, no map.
 *   2. Error    → the query error surfaces and every section is withheld.
 *   3. No trail → the KPI band still renders (summary is drive-derived) beside
 *                 an explicit "no GPS" empty state — never a blank panel.
 *   4. Rich drive→ every KPI, the live-stats rail, and the three replay
 *                 surfaces render with SI→display-converted values.
 *   5. Seek     → the shared seek handler threaded into the map moves the
 *                 live-stats rail (map → page → rail lockstep).
 *   6. Deep link→ `?at=` restores the playhead so the rail opens mid-trip.
 *   7. a11y     → icon-only refresh control is labelled; sections are regions;
 *                 reduced-motion is threaded to the map.
 *   8. Hardening→ `fmtDriveTime` no longer emits "60m"; `timelineData` never
 *                 feeds NaN into the chart when the first row's ts is unparseable.
 *   9. Miles    → the whole conversion boundary flips, incl. the efficiency
 *                 unit label (was hardcoded "Wh/km").
 *
 * `useTimezone` comes from the global stub in src/test-setup.ts; react-i18next,
 * useSettings, useMotionPreference and the leaf components are stubbed locally
 * (file-level vi.mock takes precedence over the setupFiles registration).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { DriveDetail, DrivePosition } from '@/types/driving';

/* ── react-i18next: deterministic English-fallback rendering ─────────────── */
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
        const fallback = typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined;
        const opts =
          typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
            ? (fallbackOrOpts as Record<string, unknown>)
            : (maybeOpts as Record<string, unknown> | undefined);
        const interpolate = (s: string) =>
          opts
            ? Object.keys(opts).reduce(
                (acc, k) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(opts[k])),
                s,
              )
            : s;
        if (opts && typeof opts.defaultValue === 'string') return interpolate(opts.defaultValue);
        if (fallback != null) return interpolate(fallback);
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

/* ── Controllable unit preference ────────────────────────────────────────── */
type SettingsBag = Record<string, unknown> & {
  unit_of_length: 'km' | 'mi';
  unit_of_temp: 'C' | 'F';
  unit_of_pressure: 'bar' | 'psi';
  decimal_precision: number;
  locale: string;
  tz_display_default: string;
  ui_density: string;
  preferred_range: string;
};

function makeSettings(overrides: Partial<SettingsBag> = {}): SettingsBag {
  return {
    unit_of_length: 'km',
    unit_of_temp: 'C',
    unit_of_pressure: 'bar',
    preferred_range: 'rated',
    language: 'en',
    base_cost_per_kwh: 0.12,
    theme: 'neon-cyan',
    mode: 'dark',
    decimal_precision: 2,
    currency_symbol: '$',
    locale: 'en-US',
    tz_display_default: 'vehicle',
    ui_density: 'comfortable',
    time_format_default: 'relative',
    ai_mode: 'off',
    ...overrides,
  };
}

const settingsState: { current: SettingsBag } = { current: makeSettings() };

vi.mock('@/hooks/useSettings', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useSettings')>('@/hooks/useSettings');
  return {
    ...actual,
    useSettings: () => {
      const s = settingsState.current;
      return {
        settings: s,
        isMiles: s.unit_of_length === 'mi',
        isFahrenheit: s.unit_of_temp === 'F',
        isPSI: s.unit_of_pressure === 'psi',
        decimals: s.decimal_precision,
        locale: s.locale,
        density: s.ui_density,
        rangeType: s.preferred_range,
      };
    },
  };
});

/* ── Controllable motion preference ──────────────────────────────────────── */
const motionState: { current: { reduce: boolean; durationMs: number } } = {
  current: { reduce: false, durationMs: 0 },
};
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => motionState.current,
}));

/* ── Controllable drive query ────────────────────────────────────────────── */
interface DriveQueryStub {
  data: DriveDetail | undefined;
  isLoading: boolean;
  error: Error | null;
  isError: boolean;
  isFetching: boolean;
  isStale: boolean;
  isSuccess: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}
// Seeded with a trail-free query so the module-eval initializer never touches
// the `POSITIONS` const declared further down (it lives in the TDZ here).
// beforeEach installs a fully-loaded query before any render.
const driveState: { current: DriveQueryStub } = { current: emptyQuery() };
vi.mock('@/api/hooks/useDriving', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/useDriving')>();
  return { ...actual, useDrive: () => driveState.current };
});

/* ── Motion barrel → inert passthroughs (avoid framer timing/act churn) ──── */
vi.mock('@/components/motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/motion')>();
  const pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return { ...actual, FadeIn: pass, StaggerContainer: pass, StaggerItem: pass };
});

/* ── Heavy leaf components → prop-capturing stubs ─────────────────────────── */
interface MapStubProps {
  positions: DrivePosition[];
  currentIndex: number;
  onSeekToIndex: (i: number) => void;
  reduceMotion?: boolean;
  height?: number | string;
}
interface ChartPoint {
  index: number;
  time: number;
  speed: number;
  power: number;
}
interface ChartsStubProps {
  data: ChartPoint[];
  currentIndex: number;
  speedUnit: string;
  onSeekToIndex: (i: number) => void;
  height?: number;
}
interface ElevationPoint {
  index: number;
  distance: number;
  elevation: number;
  speed: number;
}
interface ElevationStubProps {
  data: ElevationPoint[];
  currentIndex: number;
  onClickIndex: (i: number) => void;
  distanceUnit: string;
  height?: number;
}
interface PlaybackStubProps {
  isPlaying: boolean;
  progress: number;
  elapsed: string;
  total: string;
}

const mapProps: { last: MapStubProps | null } = { last: null };
const chartsProps: { last: ChartsStubProps | null } = { last: null };
const elevationProps: { last: ElevationStubProps | null } = { last: null };
const playbackProps: { last: PlaybackStubProps | null } = { last: null };

vi.mock('@/features/trips/components/TripReplayMap', () => ({
  TripReplayMap: (props: MapStubProps) => {
    mapProps.last = props;
    return <div data-testid="trip-replay-map" />;
  },
}));
vi.mock('@/features/trips/components/TripReplayCharts', () => ({
  TripReplayCharts: (props: ChartsStubProps) => {
    chartsProps.last = props;
    return <div data-testid="trip-replay-charts" />;
  },
}));
vi.mock('@/components/charts/ElevationProfile', () => ({
  ElevationProfile: (props: ElevationStubProps) => {
    elevationProps.last = props;
    return <div data-testid="elevation-profile" />;
  },
}));
vi.mock('@/components/charts/Sparkline', () => ({ Sparkline: () => null }));
vi.mock('@/components/data-display/PlaybackControls', () => ({
  PlaybackControls: (props: PlaybackStubProps) => {
    playbackProps.last = props;
    return <div data-testid="playback-controls" />;
  },
}));

import TripReplayPage from './TripReplayPage';

/* ── Fixtures ────────────────────────────────────────────────────────────── */
function makePos(overrides: Partial<DrivePosition> = {}): DrivePosition {
  return {
    latitude: 47.6,
    longitude: -122.3,
    speed: 0,
    power: 0,
    batteryLevel: 80,
    timestamp: '2024-01-01T00:00:00Z',
    insideTemp: 21,
    outsideTemp: 15,
    idealRange: 300000,
    ratedRange: 300000,
    odometer: 10000,
    elevation: 1000,
    fanStatus: 0,
    isClimateOn: false,
    ...overrides,
  };
}

// 4 samples, 1-minute spacing. Elevations chosen so gain=115 / loss=27 are
// unique text nodes; batteries 80→79→78→77 make each playhead index checkable.
const POSITIONS: DrivePosition[] = [
  makePos({ latitude: 47.6, longitude: -122.3, speed: 0, power: 0, batteryLevel: 80, elevation: 1000, ratedRange: 300000, timestamp: '2024-01-01T00:00:00Z' }),
  makePos({ latitude: 47.62, longitude: -122.32, speed: 20, power: 25, batteryLevel: 79, elevation: 1050, ratedRange: 297000, timestamp: '2024-01-01T00:01:00Z' }),
  makePos({ latitude: 47.64, longitude: -122.34, speed: 30, power: 50, batteryLevel: 78, elevation: 1023, ratedRange: 294000, timestamp: '2024-01-01T00:02:00Z' }),
  makePos({ latitude: 47.66, longitude: -122.36, speed: 25, power: 30, batteryLevel: 77, elevation: 1088, ratedRange: 291000, timestamp: '2024-01-01T00:03:00Z' }),
];

function makeDrive(overrides: Partial<DriveDetail> = {}): DriveDetail {
  return {
    id: 42,
    vehicleId: 1,
    startTs: '2024-01-01T00:00:00Z',
    endTs: '2024-01-01T00:45:00Z',
    durationS: 2700, // 45 min
    distanceM: 32000, // 32 km
    startAddress: 'Home',
    endAddress: 'Office',
    startLat: 47.6,
    startLon: -122.3,
    endLat: 47.66,
    endLon: -122.36,
    startBatteryPct: 82,
    endBatteryPct: 68,
    energyUsedWh: 7200,
    regenEnergyWh: 900,
    avgSpeedMps: 20, // 72 km/h
    maxSpeedMps: 30, // 108 km/h
    avgPowerW: 15000,
    outsideTempAvgC: 15,
    insideTempAvgC: 21,
    score: 88,
    endedStatus: 'parked',
    createdAt: '2024-01-01T00:45:05Z',
    updatedAt: '2024-01-01T00:45:05Z',
    positions: POSITIONS,
    telemetry: [],
    ...overrides,
  };
}

function emptyQuery(): DriveQueryStub {
  return {
    data: undefined,
    isLoading: false,
    error: null,
    isError: false,
    isFetching: false,
    isStale: false,
    isSuccess: false,
    dataUpdatedAt: 0,
    refetch: vi.fn(),
  };
}

function loadedQuery(driveOverrides: Partial<DriveDetail> = {}): DriveQueryStub {
  return {
    ...emptyQuery(),
    data: makeDrive(driveOverrides),
    isSuccess: true,
    dataUpdatedAt: Date.now(),
  };
}

function renderPage(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/drives/42/replay${search}`]}>
      <Routes>
        <Route path="/drives/:id/replay" element={<TripReplayPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  settingsState.current = makeSettings();
  motionState.current = { reduce: false, durationMs: 0 };
  driveState.current = loadedQuery();
  mapProps.last = null;
  chartsProps.last = null;
  elevationProps.last = null;
  playbackProps.last = null;
  window.localStorage.clear();
});

/* ── Page state branches ─────────────────────────────────────────────────── */
describe('TripReplayPage — page state branches', () => {
  it('shows only the loading surface while the drive is loading', () => {
    driveState.current = { ...loadedQuery(), data: undefined, isLoading: true, isSuccess: false };
    renderPage();

    // Title anchors the page even while loading…
    expect(screen.getByRole('heading', { level: 1, name: 'Trip Replay' })).toBeInTheDocument();
    // …but no KPI band, empty state or replay surface is rendered yet.
    expect(screen.queryByText('Distance')).toBeNull();
    expect(screen.queryByText(/No GPS data available/)).toBeNull();
    expect(screen.queryByTestId('trip-replay-map')).toBeNull();
  });

  it('surfaces the query error and withholds every section', () => {
    driveState.current = {
      ...loadedQuery(),
      data: undefined,
      error: new Error('drive fetch exploded'),
      isError: true,
    };
    renderPage();

    // ErrorDisplay renders production-safe structured copy rather than the
    // raw error.message — status-less errors fall into the network branch.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('Distance')).toBeNull();
    expect(screen.queryByTestId('playback-controls')).toBeNull();
  });

  it('keeps the summary band but shows a GPS empty state when there is no trail', () => {
    driveState.current = loadedQuery({ positions: [] });
    renderPage();

    // Drive-derived KPIs still render (they do not depend on the GPS trail)…
    expect(screen.getByText('Distance')).toBeInTheDocument();
    expect(screen.getByText('32.00')).toBeInTheDocument();
    // …beside an explicit empty state instead of the replay surfaces.
    expect(screen.getByText(/No GPS data available for this drive/)).toBeInTheDocument();
    expect(screen.queryByTestId('trip-replay-map')).toBeNull();
    expect(screen.queryByTestId('playback-controls')).toBeNull();
  });
});

/* ── Drive-summary KPI band (metric-only, SI→km) ─────────────────────────── */
describe('TripReplayPage — drive summary KPIs', () => {
  it('renders every KPI label as an accessible region', () => {
    renderPage();

    expect(screen.getByRole('region', { name: 'Drive Summary' })).toBeInTheDocument();
    for (const label of [
      'Distance',
      'Duration',
      'Avg Speed',
      'Max Speed',
      'Efficiency',
      'Elevation Gain',
      'Elevation Loss',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('converts SI drive aggregates to the user unit (km) and formats them', () => {
    renderPage();

    expect(screen.getByText('32.00')).toBeInTheDocument(); // 32000 m → 32 km
    expect(screen.getByText('45m')).toBeInTheDocument(); // 2700 s → 45 min
    expect(screen.getByText('72.00')).toBeInTheDocument(); // 20 m/s → 72 km/h
    expect(screen.getByText('108.00')).toBeInTheDocument(); // 30 m/s → 108 km/h
    expect(screen.getByText('82% → 68%')).toBeInTheDocument();
    // Efficiency = (82-68)/32 * 1000 = 437.5, unit reflects the distance unit.
    expect(screen.getByText('437.50')).toBeInTheDocument();
    expect(screen.getByText('Wh/km')).toBeInTheDocument();
  });

  it('derives elevation gain/loss from the SI position trail', () => {
    renderPage();

    // 1000→1050 (+50), 1050→1023 (-27), 1023→1088 (+65) → gain 115 / loss 27.
    expect(screen.getByText('115')).toBeInTheDocument();
    expect(screen.getByText('27')).toBeInTheDocument();
  });
});

/* ── Live-position rail + shared seek handler ────────────────────────────── */
describe('TripReplayPage — live-position stats + seek', () => {
  it('renders the three replay surfaces and the live-stats rail at index 0', () => {
    renderPage();

    expect(screen.getByTestId('trip-replay-map')).toBeInTheDocument();
    expect(screen.getByTestId('playback-controls')).toBeInTheDocument();
    expect(screen.getByTestId('elevation-profile')).toBeInTheDocument();
    expect(screen.getByTestId('trip-replay-charts')).toBeInTheDocument();
    expect(screen.getByText('Current Position Stats')).toBeInTheDocument();

    // Sample 0 values (speed 0, battery 80, elev 1000 m, range 300 km, 15 °C).
    expect(screen.getByText('0.00 km/h')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('1,000 m')).toBeInTheDocument();
    expect(screen.getByText('300.00 km')).toBeInTheDocument();
    expect(screen.getByText('15.00 °C')).toBeInTheDocument();
  });

  it('threads a single currentIndex + unit into every leaf', () => {
    renderPage();

    expect(mapProps.last?.currentIndex).toBe(0);
    expect(mapProps.last?.positions).toHaveLength(4);
    expect(mapProps.last?.height).toBe(440);
    expect(chartsProps.last?.currentIndex).toBe(0);
    expect(chartsProps.last?.speedUnit).toBe('km/h');
    expect(elevationProps.last?.distanceUnit).toBe('km');
    // Scrubber gets the current playback state + pre-formatted transport time.
    expect(playbackProps.last?.isPlaying).toBe(false);
    expect(playbackProps.last?.progress).toBe(0);
    expect(playbackProps.last?.elapsed).toBe('00:00');
  });

  it('moves the live-stats rail when the map seek handler fires (map → page → rail)', () => {
    renderPage();
    expect(screen.getByText('80%')).toBeInTheDocument(); // index 0 battery

    act(() => {
      mapProps.last?.onSeekToIndex(2);
    });

    // Index 2 → battery 78%, speed 30 m/s → 108 km/h.
    expect(screen.getByText('78%')).toBeInTheDocument();
    expect(screen.getByText('108.00 km/h')).toBeInTheDocument();
    expect(screen.queryByText('80%')).toBeNull();
  });

  it('restores the playhead from the ?at= deep link so the rail opens mid-trip', () => {
    renderPage('?at=0.9');

    // 0.9 of a 3-minute trip lands on the last sample (index 3, battery 77%).
    expect(mapProps.last?.currentIndex).toBe(3);
    expect(screen.getByText('77%')).toBeInTheDocument();
    expect(screen.queryByText('80%')).toBeNull();
  });
});

/* ── Accessibility + motion ──────────────────────────────────────────────── */
describe('TripReplayPage — a11y + motion', () => {
  it('exposes labelled, working refresh + back controls', () => {
    renderPage();

    const refresh = screen.getByRole('button', { name: 'Refresh replay data' });
    fireEvent.click(refresh);
    expect(driveState.current.refetch).toHaveBeenCalledTimes(1);

    const back = screen.getByRole('link', { name: /Back to Drive/ });
    expect(back).toHaveAttribute('href', '/drives/42');
  });

  it('labels the replay surfaces as regions', () => {
    renderPage();

    expect(
      screen.getByRole('region', { name: 'Route map and live position' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Trip elevation and speed timelines' }),
    ).toBeInTheDocument();
  });

  it('threads the reduced-motion preference down to the map', () => {
    motionState.current = { reduce: true, durationMs: 0 };
    renderPage();

    expect(mapProps.last?.reduceMotion).toBe(true);
    expect(screen.getByTestId('trip-replay-map')).toBeInTheDocument();
  });
});

/* ── Hardening regressions ───────────────────────────────────────────────── */
describe('TripReplayPage — hardening', () => {
  it('normalises the minute carry in the duration KPI (no "60m")', () => {
    // 3597 s ≈ 59.95 min → must render "1h 0m", never the naive-round "60m".
    driveState.current = loadedQuery({ durationS: 3597 });
    renderPage();

    expect(screen.getByText('1h 0m')).toBeInTheDocument();
    expect(screen.queryByText('60m')).toBeNull();
  });

  it('never feeds NaN into the speed/power chart when the first ts is unparseable', () => {
    driveState.current = loadedQuery({
      positions: [
        makePos({ latitude: 47.6, longitude: -122.3, timestamp: 'not-a-date' }),
        makePos({ latitude: 47.62, longitude: -122.32, timestamp: '2024-01-01T00:01:00Z' }),
        makePos({ latitude: 47.64, longitude: -122.34, timestamp: '2024-01-01T00:02:00Z' }),
      ],
    });
    renderPage();

    const times = (chartsProps.last?.data ?? []).map((d) => d.time);
    expect(times).toHaveLength(3);
    expect(times.every((t) => Number.isFinite(t))).toBe(true);
    // Anchored on the first *parseable* row → last sample is +1 minute.
    expect(times[times.length - 1]).toBe(1);
  });
});

/* ── Unit-preference flip (miles) ────────────────────────────────────────── */
describe('TripReplayPage — miles preference', () => {
  it('flips the conversion boundary and the efficiency unit label to miles', () => {
    settingsState.current = makeSettings({ unit_of_length: 'mi' });
    renderPage();

    // 32000 m → 19.88 mi; efficiency label reflects the distance unit.
    expect(screen.getByText('19.88')).toBeInTheDocument();
    expect(screen.getByText('Wh/mi')).toBeInTheDocument();
    expect(screen.queryByText('Wh/km')).toBeNull();
    // Speed leaves the page in mph.
    expect(chartsProps.last?.speedUnit).toBe('mph');
    expect(elevationProps.last?.distanceUnit).toBe('mi');
  });
});
