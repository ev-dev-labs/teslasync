/**
 * SpeedProfileWidget tests.
 *
 * The widget renders a vehicle's speed distribution (per-bucket drive
 * frequency) plus an average-power line, sourced from `useSpeedProfile()`.
 * Everything on the wire is SI: the distribution's `avg_power_w` is watts and
 * `optimalSpeedMps` is metres-per-second, BUT the API's `speed_bucket` LABELS
 * are miles-per-hour strings (`'33.55-67.11'` = 34-67 mph — the Go handler buckets on
 * `6.7056 mps = 15 mph`). The widget converts at the render boundary via
 * `convertSpeedFromSI` / `convertPowerFromSI` + `useUnits().unitPrefs`. Its
 * behaviour surface — the thing under test:
 *
 *   1. Two responsive layouts driven by `size.cols`:
 *        - compact (cols <= 1): a titled shell with just the "Most Common"
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
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { chartMargin } from '@/components/charts';
import type { SpeedProfileData, SpeedBucket } from '@/types/driving';
import SpeedProfileWidget, { frequencyAxisWidth } from './SpeedProfileWidget';

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
const chartGeometry = vi.hoisted(() => ({ enabled: false }));

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
  const { cloneElement, createElement } = await import('react');
  return {
    ...actual,
    ...chartTestDoubles,
    ResponsiveContainer: (props: { children: ReactElement<{ width?: number; height?: number }> }) =>
      chartGeometry.enabled
        ? cloneElement(props.children, { width: 640, height: 200 })
        : createElement(actual.ResponsiveContainer, props),
  };
});

vi.mock('@/components/ui/ThemeProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/ThemeProvider')>();
  return {
    ...actual,
    useTheme: () => ({
      theme: { primary: '#22d3ee', accent: '#a855f7' },
      mode: { colorScheme: 'dark' },
    }),
  };
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
  chartGeometry.enabled = false;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    font: '',
    measureText: (label: string) => ({ width: label.length * 6 }),
  } as unknown as CanvasRenderingContext2D);
  // Sensible defaults so a test that forgets to seed a hook still renders
  // rather than crashing on a destructure of `undefined`.
  useVehiclesMock.mockReturnValue({ data: [{ id: 1 }] });
  useUnitsMock.mockReturnValue({ unitPrefs: { speed: 'km/h', power: 'kW' } });
  useSpeedProfileMock.mockReturnValue(makeQuery());
});

it.each([1, 2, 3])('keeps an accessible heading at %s columns', cols => {
  renderWidget({ cols, rows: 4 });
  expect(screen.getByRole('heading', { name: 'Speed profile', level: 3 })).toBeVisible();
});

describe('percentage axis label width', () => {
  it('reserves measured text width plus tick and edge spacing', () => {
    const measure = vi.fn((label: string) => label === '100.00%' ? 43.2 : 30);
    expect(frequencyAxisWidth(['0.00%', '100.00%'], measure)).toBe(56);
    expect(measure).toHaveBeenCalledWith('100.00%');
  });

  it('preserves locale separators and increased precision instead of abbreviating labels', () => {
    const measure = (label: string) => label.length * 7;
    expect(frequencyAxisWidth(['0,00 %', '100,00 %'], measure)).toBe(68);
    expect(frequencyAxisWidth(['100.00000000%'], measure)).toBe(103);
    expect(frequencyAxisWidth(['١٠٠٫٠٠٪'], measure)).toBe(61);
  });

  it.each([2, 3])('measures actual formatted percentage labels in the %s-column chart font', cols => {
    renderWidget({ cols, rows: 4 });
    const context = vi.mocked(HTMLCanvasElement.prototype.getContext).mock.results[0].value as CanvasRenderingContext2D;
    expect(context.font).toMatch(new RegExp(`^${cols === 3 ? 11 : 10}px `));
    expect(frequencyAxisWidth(['100.00%'], label => context.measureText(label).width)).toBe(54);
  });

  it('retains the 35px minimum for empty or narrow labels', () => {
    expect(frequencyAxisWidth([], () => 0)).toBe(35);
    expect(frequencyAxisWidth(['0%'], () => 1)).toBe(35);
  });

  it('does not measure a canvas for the compact summary', () => {
    renderWidget({ cols: 1, rows: 4 });
    expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled();
  });

  it('remeasures complete formatted source labels using the inherited font after fonts are ready', async () => {
    const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
    const originalFontFamily = document.body.style.fontFamily;
    let ready!: () => void;
    const fontReady = new Promise<void>(resolve => { ready = resolve; });
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: fontReady } });
    document.body.style.fontFamily = 'AxisIntegrationFont';
    let characterWidth = 6;
    const measureText = vi.fn((label: string) => ({ width: label.length * characterWidth }));
    const context = { font: '', measureText } as unknown as CanvasRenderingContext2D;
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(context);
    useSpeedProfileMock.mockReturnValue(makeQuery({ data: makeData({ distribution: TWO_BUCKETS }) }));
    try {
      renderWidget({ cols: 3, rows: 4 });
      expect(context.font).toBe('11px AxisIntegrationFont');
      expect(measureText).toHaveBeenCalledWith('100.00%');
      expect(measureText).toHaveBeenCalledWith('75.00%');
      expect(measureText.mock.calls.filter(([label]) => label === '75.00%')).toHaveLength(2);
      expect(frequencyAxisWidth(['100.00%'], label => context.measureText(label).width)).toBe(54);
      characterWidth = 8;
      await act(async () => { ready(); await fontReady; });
      expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledTimes(4);
      expect(context.font).toBe('11px AxisIntegrationFont');
      expect(measureText.mock.calls.filter(([label]) => label === '75.00%')).toHaveLength(4);
      expect(frequencyAxisWidth(['100.00%'], label => context.measureText(label).width)).toBe(68);
    } finally {
      cleanup();
      document.body.style.fontFamily = originalFontFamily;
      if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
      else Reflect.deleteProperty(document, 'fonts');
    }
  });

  describe('power axis label width', () => {
    it.each([2, 3])('measures complete signed and grouped power labels at %i columns', cols => {
      chartGeometry.enabled = true;
      const measureText = vi.fn((label: string) => ({ width: label.length * 6 }));
      const context = { font: '', measureText };
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        configurable: true, value: () => context,
      });
      useUnitsMock.mockReturnValue({ unitPrefs: { speed: 'km/h', power: 'W' } });
      useSpeedProfileMock.mockReturnValue(makeQuery({
        data: makeData({
          distribution: [
            bucket({ avg_power_w: -123456.789, readings: 30 }),
            bucket({ avg_power_w: 987654.321, readings: 10 }),
            bucket({ avg_power_w: undefined, readings: 0 }),
            bucket({ avg_power_w: Number.NaN, readings: 0 }),
          ],
        }),
      }));
      const { container } = renderWidget({ cols, rows: 4 });
      expect(measureText).toHaveBeenCalledWith('-123,456.79');
      expect(measureText).toHaveBeenCalledWith('987,654.32');
      expect(context.font).toMatch(new RegExp(`^${cols === 3 ? 11 : 10}px `));
      expect(measureText.mock.calls.flat()).not.toEqual(
        expect.arrayContaining(['null', 'undefined', 'NaN']),
      );
      expect(measureText).toHaveBeenCalledWith('100.00%');
      const axes = container.querySelectorAll('.recharts-yAxis');
      expect(axes).toHaveLength(2);
      expect(axes[0].querySelector('.recharts-cartesian-axis-tick-value')).toHaveAttribute(
        'x', String(chartMargin.left + 54 - 8),
      );
      expect(axes[1].querySelector('.recharts-cartesian-axis-tick-value')).toHaveAttribute(
        'x', String(640 - chartMargin.right - 86 + 8),
      );
      expect(axes[1].querySelector('.recharts-cartesian-axis-tick-value')).toHaveAttribute('text-anchor', 'start');
    });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SpeedProfileWidget — standard layout (km/h)', () => {
  it('renders the titled shell with the most-common bucket, peak frequency, and sweet-spot stats', () => {
    useSpeedProfileMock.mockReturnValue(
      makeQuery({ data: makeData({ distribution: TWO_BUCKETS, optimalSpeedMps: 0 }) }),
    );

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Speed profile')).toBeInTheDocument();
    // Most common = highest-frequency bucket = '33.55-67.11' mph → 54-108 km/h.
    expect(screen.getByText('Most common')).toBeInTheDocument();
    expect(screen.getByText('54.00-108.00')).toBeInTheDocument();
    // 30 of 40 readings → 75.0%.
    expect(screen.getByText('Peak freq')).toBeInTheDocument();
    expect(screen.getByText('75.00%')).toBeInTheDocument();
    // Sweet spot falls back to the lowest-power bucket '100.66-134.22' mph → 162-216 km/h.
    expect(screen.getByText('Lowest power range')).toBeInTheDocument();
    expect(screen.getByText('162.00-216.00')).toBeInTheDocument();
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
    expect(screen.getAllByText('54.00-108.00').length).toBeGreaterThan(0);
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
    expect(screen.getByText('72.00')).toBeInTheDocument();
    expect(screen.getByText('Most common')).toBeInTheDocument();
    expect(screen.getByText('54.00-108.00')).toBeInTheDocument();
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
    expect(screen.getByText('270.00+')).toBeInTheDocument();
    expect(screen.getByText('90.00')).toBeInTheDocument();
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
    expect(screen.getByText('108.00-162.00')).toBeInTheDocument();
    // optimal 10 m/s → 36 km/h.
    expect(screen.getByText('36.00')).toBeInTheDocument();
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
    expect(screen.getByText('33.55-67.11')).toBeInTheDocument();
    expect(screen.getByText('100.66-134.22')).toBeInTheDocument();
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
    expect(screen.getByText('54.00-108.00')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('degrades a partial {} payload to an EmptyState without throwing', () => {
    useSpeedProfileMock.mockReturnValue(
      makeQuery({ data: {} as SpeedProfileData }),
    );

    expect(() => renderWidget({ cols: 2, rows: 2 })).not.toThrow();

    // Titled shell still renders; the body is the empty placeholder.
    expect(screen.getByText('Speed profile')).toBeInTheDocument();
    expect(screen.getByText('No speed data')).toBeInTheDocument();
  });
});

describe('SpeedProfileWidget — compact layout', () => {
  it('renders only the most-common + sweet-spot stats, dropping the title and peak-freq', () => {
    useSpeedProfileMock.mockReturnValue(
      makeQuery({ data: makeData({ distribution: TWO_BUCKETS, optimalSpeedMps: 0 }) }),
    );

    renderWidget({ cols: 1, rows: 1 });

    expect(screen.getByText('Most common')).toBeInTheDocument();
    expect(screen.getByText('Lowest power range')).toBeInTheDocument();
    expect(screen.getByText('54.00-108.00')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Speed profile', level: 3 })).toBeVisible();
    expect(screen.queryByText('Peak freq')).not.toBeInTheDocument();
  });

  it('shows an EmptyState (never a blank panel) when compact and data-less', () => {
    useSpeedProfileMock.mockReturnValue(
      makeQuery({ data: makeData({ distribution: [] }) }),
    );

    renderWidget({ cols: 1, rows: 1 });

    expect(screen.getByText('No speed data')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Speed profile', level: 3 })).toBeVisible();
  });
});

describe('SpeedProfileWidget — wide layout', () => {
  it('renders the titled shell with all three summary stats', () => {
    useSpeedProfileMock.mockReturnValue(
      makeQuery({ data: makeData({ distribution: TWO_BUCKETS, optimalSpeedMps: 0 }) }),
    );

    renderWidget({ cols: 3, rows: 3 });

    expect(screen.getByText('Speed profile')).toBeInTheDocument();
    expect(screen.getByText('Most common')).toBeInTheDocument();
    expect(screen.getByText('Peak freq')).toBeInTheDocument();
    expect(screen.getByText('Lowest power range')).toBeInTheDocument();
  });
});

describe('SpeedProfileWidget — query states', () => {
  it('keeps the heading with a loading skeleton and no empty message', () => {
    useSpeedProfileMock.mockReturnValue(
      makeQuery({ isLoading: true, data: undefined }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Speed profile')).toBeInTheDocument();
    expect(screen.queryByText('No speed data')).not.toBeInTheDocument();
  });

  it('renders the full-panel QueryError on an initial load failure (no cached data)', () => {
    useSpeedProfileMock.mockReturnValue(
      makeQuery({ error: new Error('boom'), isError: true, data: undefined }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // Generic (non-HTTP) error → network/unknown branch of <QueryError>.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('Speed profile')).toBeInTheDocument();
    expect(screen.queryByText('Most common')).not.toBeInTheDocument();
  });

  it('renders the titled shell with an EmptyState placeholder when data is absent', () => {
    useSpeedProfileMock.mockReturnValue(
      makeQuery({ data: makeData({ distribution: [] }), isLoading: false, error: null }),
    );

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Speed profile')).toBeInTheDocument();
    expect(screen.getByText('No speed data')).toBeInTheDocument();
    expect(screen.queryByText('Most common')).not.toBeInTheDocument();
  });

  it('keeps measured buckets and flags freshness on a transient background failure', () => {
    useSpeedProfileMock.mockReturnValue(
      makeQuery({
        data: makeData({ distribution: TWO_BUCKETS, optimalSpeedMps: 0 }),
        error: new Error('transient'),
        isError: true,
        isFetching: false,
      }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    expect(screen.getByText('Speed profile')).toBeInTheDocument();
    expect(screen.getByText('54.00-108.00')).toBeInTheDocument();
    expect(container.querySelector('.bg-red-400')).toBeInTheDocument();
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
