/**
 * SpeedProfileWidget tests.
 *
 * The widget renders a vehicle's speed distribution (per-bucket drive
 * frequency) plus an average-power line, sourced from `useSpeedProfile()`.
 * Everything on the wire is SI: the distribution's `avg_power_w` is watts and
 * `optimalSpeedMps` is metres-per-second, BUT the API's `speed_bucket` LABELS
 * are miles-per-hour strings (`'34-67'` = 34-67 mph — the Go handler buckets on
 * `6.7056 mps = 15 mph`). The widget converts at the render boundary via
 * `convertSpeedFromSI` / `convertPowerFromSI` + `useUnits().unitPrefs`. Its
 * behaviour surface — the thing under test:
 *
 *   1. Two responsive layouts driven by `size.cols`:
 *        - compact (cols <= 1): a title-less shell with just the "Most Common"
 *          + "Sweet Spot" summary stats (no "Peak Freq", no chart), or an
 *          EmptyState.
 *        - standard/wide (cols >= 2): a titled "Speed Profile" shell with the
 *          three summary stats + the composed chart region.
 *   2. Bucket-label conversion (the R1 bug fix): the mph bucket edges are
 *      lifted to SI m/s before display conversion, so "34-67" renders "34-67"
 *      in mph and "54-108" in km/h — NOT the pre-fix "34-67"/"54-108".
 *   3. The sweet-spot resolution: the API's `optimalSpeedMps` (SI m/s) wins and
 *      is shown as a single converted number; otherwise it falls back to the
 *      bucket with the lowest `avg_power_w` (the R2 bug fix — pre-fix this was
 *      always "—" because the widget read a non-existent `avg_power_kw`).
 *   4. Peak frequency + most-common bucket derived from the readings totals.
 *   5. The query states every data source must handle: loading (skeleton),
 *      initial error (full-panel QueryError, only when there is no cached
 *      data), empty (EmptyState — never a blank panel), and graceful
 *      degradation (a transient background error keeps the cached stats and
 *      flags the freshness dot instead of blanking the panel).
 *   6. Null-safety: a partial `{}` payload and a bucket with no `avg_power_w`
 *      degrade gracefully rather than throwing.
 *   7. Vehicle resolution: an explicit `vehicleId` wins, else the first
 *      vehicle; a missing vehicle passes `undefined` (disabling the query).
 *   8. The freshness control: clicking refetches, but only when a fetch is not
 *      already in flight.
 *
 * `@/api/hooks/useDriving`, `@/api/hooks/useVehicles`, and `@/hooks/useUnits`
 * are mocked so the network is never touched and every query state + unit
 * preference is driven deterministically. `convertSpeedFromSI` /
 * `convertPowerFromSI` run for real so the conversion math is genuinely
 * exercised. `react-i18next` is stubbed with a passthrough `t(key, default)` so
 * assertions read the English defaults. The shared WidgetShell /
 * WidgetChartSummary / DataFreshness / EmptyState primitives all run for real.
 * `<MemoryRouter>` wraps every render because the error branch's <QueryError>
 * reaches for router context.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SpeedProfileData, SpeedBucket } from '@/types/driving';
import SpeedProfileWidget from './SpeedProfileWidget';

// jsdom lacks matchMedia; DataFreshness → useMotionPreference reads it during
// render. Install a benign stub before any component mounts.
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

const { useSpeedProfileMock, useVehiclesMock, useUnitsMock } = vi.hoisted(() => ({
  useSpeedProfileMock: vi.fn(),
  useVehiclesMock: vi.fn(),
  useUnitsMock: vi.fn(),
}));

vi.mock('@/api/hooks/useDriving', () => ({
  useSpeedProfile: (vehicleId?: string) => useSpeedProfileMock(vehicleId),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => useVehiclesMock(),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => useUnitsMock(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string | Record<string, unknown>) =>
      typeof defaultValue === 'string' ? defaultValue : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return { ...actual, ...chartTestDoubles };
});

function makeData(overrides: Partial<SpeedProfileData> = {}): SpeedProfileData {
  return {
    distribution: [],
    avgSpeedMps: 0,
    peakSpeedMps: 0,
    optimalSpeedMps: 0,
    ...overrides,
  };
}

function bucket(overrides: Partial<SpeedBucket>): SpeedBucket {
  return { speed_bucket: '', readings: 0, ...overrides };
}

interface QueryState {
  data: SpeedProfileData | undefined;
  isLoading: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

function makeQuery(overrides: Partial<QueryState> = {}): QueryState {
  return {
    data: undefined,
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderWidget(
  size: { cols: number; rows: number } = { cols: 2, rows: 2 },
  vehicleId?: number,
) {
  return render(
    <MemoryRouter>
      <SpeedProfileWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

// A two-bucket distribution whose peak-frequency bucket ('15-30') differs from
// its lowest-power sweet-spot bucket ('45-60'), so the three summary stats are
// mutually distinct and independently assertable.
const TWO_BUCKETS: SpeedBucket[] = [
  bucket({ speed_bucket: '15-30', readings: 30, avg_power_w: 20000 }),
  bucket({ speed_bucket: '45-60', readings: 10, avg_power_w: 9000 }),
];

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults so a test that forgets to seed a hook still renders
  // rather than crashing on a destructure of `undefined`.
  useVehiclesMock.mockReturnValue({ data: [{ id: 1 }] });
  useUnitsMock.mockReturnValue({ unitPrefs: { speed: 'km/h', power: 'kW' } });
  useSpeedProfileMock.mockReturnValue(makeQuery());
});

afterEach(() => {
  cleanup();
});

describe('SpeedProfileWidget — standard layout (km/h)', () => {
  it('renders the titled shell with the most-common bucket, peak frequency, and sweet-spot stats', () => {
    useSpeedProfileMock.mockReturnValue(
      makeQuery({ data: makeData({ distribution: TWO_BUCKETS, optimalSpeedMps: 0 }) }),
    );

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Speed Profile')).toBeInTheDocument();
    // Most common = highest-frequency bucket = '34-67' mph → 54-108 km/h.
    expect(screen.getByText('Most Common')).toBeInTheDocument();
    expect(screen.getByText('54-108')).toBeInTheDocument();
    // 30 of 40 readings → 75.0%.
    expect(screen.getByText('Peak Freq')).toBeInTheDocument();
    expect(screen.getByText('75.0%')).toBeInTheDocument();
    // Sweet spot falls back to the lowest-power bucket '101-134' mph → 162-216 km/h.
    expect(screen.getByText('Sweet Spot')).toBeInTheDocument();
    expect(screen.getByText('162-216')).toBeInTheDocument();
    // Speed stats carry the km/h unit chip.
    expect(screen.getAllByText('km/h').length).toBeGreaterThan(0);
  });

  it('lifts mph bucket edges to SI before converting so km/h labels are correct (R1 fix)', () => {
    useSpeedProfileMock.mockReturnValue(
      makeQuery({
        data: makeData({
          distribution: [bucket({ speed_bucket: '15-30', readings: 5, avg_power_w: 12000 })],
          optimalSpeedMps: 0,
        }),
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // 15 mph = 24.14 km/h, 30 mph = 48.28 km/h → "54-108". The pre-fix code
    // treated 15/30 as m/s and rendered "54-108". (Single bucket → it is both
    // the most-common and the sweet-spot stat, hence getAllByText.)
    expect(screen.getAllByText('54-108').length).toBeGreaterThan(0);
    expect(screen.queryByText('24-48')).not.toBeInTheDocument();
  });

  it('renders the optimal-speed sweet spot (SI m/s) as a single converted number', () => {
    useSpeedProfileMock.mockReturnValue(
      makeQuery({
        data: makeData({
          distribution: [bucket({ speed_bucket: '15-30', readings: 10, avg_power_w: 15000 })],
          optimalSpeedMps: 20,
        }),
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // optimalSpeedMps 20 m/s → 72 km/h (single number, no range dash).
    expect(screen.getByText('72')).toBeInTheDocument();
    expect(screen.getByText('Most Common')).toBeInTheDocument();
    expect(screen.getByText('54-108')).toBeInTheDocument();
  });

  it('formats a "75+" open-ended bucket via the numeric branch', () => {
    useSpeedProfileMock.mockReturnValue(
      makeQuery({
        data: makeData({
          distribution: [bucket({ speed_bucket: '75+', readings: 5, avg_power_w: 10000 })],
          optimalSpeedMps: 25,
        }),
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // 75 mph = 120.7 km/h → "270+"; optimal 25 m/s → 90 km/h.
    expect(screen.getByText('270+')).toBeInTheDocument();
    expect(screen.getByText('90')).toBeInTheDocument();
  });

  it('falls back to the camelCase speedBucket label when snake_case is absent', () => {
    const raw = [
      { speedBucket: '30-45', readings: 5, avg_power_w: 8000 },
    ] as unknown as SpeedBucket[];
    useSpeedProfileMock.mockReturnValue(
      makeQuery({ data: makeData({ distribution: raw, optimalSpeedMps: 10 }) }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // 30 mph = 48.28 km/h, 45 mph = 72.42 km/h → "108-162".
    expect(screen.getByText('108-162')).toBeInTheDocument();
    // optimal 10 m/s → 36 km/h.
    expect(screen.getByText('36')).toBeInTheDocument();
  });
});

describe('SpeedProfileWidget — unit conversion (mph)', () => {
  it('renders the same payload with mph labels unchanged and no km/h leakage', () => {
    useUnitsMock.mockReturnValue({ unitPrefs: { speed: 'mph', power: 'kW' } });
    useSpeedProfileMock.mockReturnValue(
      makeQuery({ data: makeData({ distribution: TWO_BUCKETS, optimalSpeedMps: 0 }) }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // mph is the source unit → the bucket edges pass through unchanged.
    expect(screen.getByText('34-67')).toBeInTheDocument();
    expect(screen.getByText('101-134')).toBeInTheDocument();
    expect(screen.getAllByText('mph').length).toBeGreaterThan(0);
    // The km/h conversion must NOT leak through.
    expect(screen.queryByText('24-48')).not.toBeInTheDocument();
    expect(screen.queryByText('km/h')).not.toBeInTheDocument();
  });
});

describe('SpeedProfileWidget — sweet-spot null safety', () => {
  it('shows a "—" sweet spot when no bucket carries an avg_power_w and no optimal speed', () => {
    useSpeedProfileMock.mockReturnValue(
      makeQuery({
        data: makeData({
          distribution: [bucket({ speed_bucket: '15-30', readings: 10 })],
          optimalSpeedMps: 0,
        }),
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // Most common still resolves; sweet spot degrades to a dash rather than
    // throwing or picking a zero-power bucket.
    expect(screen.getByText('54-108')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('degrades a partial {} payload to an EmptyState without throwing', () => {
    useSpeedProfileMock.mockReturnValue(
      makeQuery({ data: {} as SpeedProfileData }),
    );

    expect(() => renderWidget({ cols: 2, rows: 2 })).not.toThrow();

    // Titled shell still renders; the body is the empty placeholder.
    expect(screen.getByText('Speed Profile')).toBeInTheDocument();
    expect(screen.getByText('No speed data')).toBeInTheDocument();
  });
});

describe('SpeedProfileWidget — compact layout', () => {
  it('renders only the most-common + sweet-spot stats, dropping the title and peak-freq', () => {
    useSpeedProfileMock.mockReturnValue(
      makeQuery({ data: makeData({ distribution: TWO_BUCKETS, optimalSpeedMps: 0 }) }),
    );

    renderWidget({ cols: 1, rows: 1 });

    expect(screen.getByText('Most Common')).toBeInTheDocument();
    expect(screen.getByText('Sweet Spot')).toBeInTheDocument();
    expect(screen.getByText('54-108')).toBeInTheDocument();
    // Compact drops the header title and the peak-frequency stat.
    expect(screen.queryByText('Speed Profile')).not.toBeInTheDocument();
    expect(screen.queryByText('Peak Freq')).not.toBeInTheDocument();
  });

  it('shows an EmptyState (never a blank panel) when compact and data-less', () => {
    useSpeedProfileMock.mockReturnValue(
      makeQuery({ data: makeData({ distribution: [] }) }),
    );

    renderWidget({ cols: 1, rows: 1 });

    expect(screen.getByText('No speed data')).toBeInTheDocument();
    expect(screen.queryByText('Speed Profile')).not.toBeInTheDocument();
  });
});

describe('SpeedProfileWidget — wide layout', () => {
  it('renders the titled shell with all three summary stats', () => {
    useSpeedProfileMock.mockReturnValue(
      makeQuery({ data: makeData({ distribution: TWO_BUCKETS, optimalSpeedMps: 0 }) }),
    );

    renderWidget({ cols: 3, rows: 3 });

    expect(screen.getByText('Speed Profile')).toBeInTheDocument();
    expect(screen.getByText('Most Common')).toBeInTheDocument();
    expect(screen.getByText('Peak Freq')).toBeInTheDocument();
    expect(screen.getByText('Sweet Spot')).toBeInTheDocument();
  });
});

describe('SpeedProfileWidget — query states', () => {
  it('renders a skeleton while loading with no title or empty message', () => {
    useSpeedProfileMock.mockReturnValue(
      makeQuery({ isLoading: true, data: undefined }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Speed Profile')).not.toBeInTheDocument();
    expect(screen.queryByText('No speed data')).not.toBeInTheDocument();
  });

  it('renders the full-panel QueryError on an initial load failure (no cached data)', () => {
    useSpeedProfileMock.mockReturnValue(
      makeQuery({ error: new Error('boom'), isError: true, data: undefined }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // Generic (non-HTTP) error → network/unknown branch of <QueryError>.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('Speed Profile')).not.toBeInTheDocument();
    expect(screen.queryByText('Most Common')).not.toBeInTheDocument();
  });

  it('renders the titled shell with an EmptyState placeholder when data is absent', () => {
    useSpeedProfileMock.mockReturnValue(
      makeQuery({ data: makeData({ distribution: [] }), isLoading: false, error: null }),
    );

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Speed Profile')).toBeInTheDocument();
    expect(screen.getByText('No speed data')).toBeInTheDocument();
    expect(screen.queryByText('Most Common')).not.toBeInTheDocument();
  });

  it('keeps rendering cached stats and flags the freshness dot on a transient background error', () => {
    useSpeedProfileMock.mockReturnValue(
      makeQuery({
        data: makeData({ distribution: TWO_BUCKETS, optimalSpeedMps: 0 }),
        error: new Error('transient'),
        isError: true,
        isFetching: false,
      }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('Speed Profile')).not.toBeInTheDocument();
    expect(screen.queryByText('54-108')).not.toBeInTheDocument();
    expect(container.querySelector('.bg-red-400')).toBeNull();
  });
});

describe('SpeedProfileWidget — vehicle resolution', () => {
  it('resolves the first vehicle id (as a string) when no vehicleId prop is given', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 42 }, { id: 7 }] });

    renderWidget({ cols: 2, rows: 2 });

    expect(useSpeedProfileMock).toHaveBeenCalledWith('42');
  });

  it('prefers an explicit vehicleId prop over the first vehicle', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 42 }] });

    renderWidget({ cols: 2, rows: 2 }, 7);

    expect(useSpeedProfileMock).toHaveBeenCalledWith('7');
  });

  it('passes undefined (disabling the query) when no vehicle can be resolved', () => {
    useVehiclesMock.mockReturnValue({ data: [] });

    renderWidget({ cols: 2, rows: 2 });

    expect(useSpeedProfileMock).toHaveBeenCalledWith(undefined);
  });
});

describe('SpeedProfileWidget — freshness interaction', () => {
  it('refetches when the accessible refresh control is clicked', () => {
    const refetch = vi.fn();
    useSpeedProfileMock.mockReturnValue(
      makeQuery({
        data: makeData({ distribution: TWO_BUCKETS, optimalSpeedMps: 0 }),
        isFetching: false,
        refetch,
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('does not refetch while a fetch is already in flight', () => {
    const refetch = vi.fn();
    useSpeedProfileMock.mockReturnValue(
      makeQuery({
        data: makeData({ distribution: TWO_BUCKETS, optimalSpeedMps: 0 }),
        isFetching: true,
        refetch,
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    expect(refetch).not.toHaveBeenCalled();
  });
});
