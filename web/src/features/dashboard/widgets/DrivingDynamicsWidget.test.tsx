/**
 * DrivingDynamicsWidget tests.
 *
 * The widget projects a vehicle's driving-dynamics summary (peak/average
 * accel-, brake-, and cornering g-forces) plus an optional acceleration
 * histogram, sourced from `useDrivingDynamics()` and
 * `useAccelerationDistribution()`. Its behaviour surface — the thing under
 * test:
 *
 *   1. Two responsive layouts driven by `size.cols`:
 *        - compact (cols <= 1): a title-less shell showing the peak-g big
 *          number + a "Smooth"/"Aggressive" Badge, or an EmptyState.
 *        - standard/wide (cols >= 2): a titled "Driving Dynamics" shell with
 *          three RadialGauges (Accel/Brake/Lateral), a severity Badge, and —
 *          only when wide (cols >= 3) and the histogram has buckets — a
 *          "G-Force Distribution" bar chart.
 *   2. The peak-g "smooth" classification (`isSmooth`: maxG < 0.4) selecting
 *      the compact Badge copy + variant.
 *   3. The severity classification (`deriveSeverity`) across all four bands
 *      (calm / normal / sporty / aggressive) from the avg accel+brake mean.
 *   4. The per-gauge colour thresholds (`gaugeColor`): < 0.2 green, < 0.4 cyan,
 *      < 0.6 amber, else red — asserted through each gauge's coloured arc.
 *   5. The four query states every data source must handle: loading (skeleton),
 *      initial error (QueryError panel, only when there is no cached data),
 *      empty (EmptyState — never a blank panel), and data.
 *   6. Null-safety: a partial `{}` payload degrades every g-force to 0 rather
 *      than throwing.
 *   7. Vehicle resolution: an explicit `vehicleId` wins, else the first
 *      vehicle; a missing vehicle disables the queries with `undefined`.
 *   8. The freshness control: clicking refetches, but only when a fetch is not
 *      already in flight.
 *   9. Graceful degradation (the hardened bug): a transient background-refetch
 *      error MUST NOT blank out otherwise-valid cached g-forces — the widget
 *      keeps rendering and surfaces the failure through the freshness
 *      indicator's error state instead of the full-panel QueryError.
 *
 * `@/api/hooks/useDriving` and `@/api/hooks/useVehicles` are mocked so the
 * network is never touched and every query state is driven deterministically.
 * `react-i18next` is stubbed with a passthrough `t(key, default)` so assertions
 * read the English defaults. `@/components/ui/ThemeProvider`'s `useTheme` is
 * stubbed (via importOriginal, keeping every other export real) so
 * `useThemeChartPalette()` — which the widget calls unconditionally — resolves
 * a deterministic palette without a ThemeProvider ancestor. The shared
 * WidgetShell / RadialGauge / Badge / DataFreshness / EmptyState primitives all
 * run for real, so assertions exercise the true rendered DOM. `<MemoryRouter>`
 * wraps every render because the error branch's <QueryError> uses `useNavigate`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type {
  DrivingDynamicsData,
  AccelerationDistributionData,
} from '@/types/driving';
import DrivingDynamicsWidget from './DrivingDynamicsWidget';

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

const { useDrivingDynamicsMock, useAccelerationDistributionMock, useVehiclesMock } =
  vi.hoisted(() => ({
    useDrivingDynamicsMock: vi.fn(),
    useAccelerationDistributionMock: vi.fn(),
    useVehiclesMock: vi.fn(),
  }));

vi.mock('@/api/hooks/useDriving', () => ({
  useDrivingDynamics: (vehicleId?: string) => useDrivingDynamicsMock(vehicleId),
  useAccelerationDistribution: (vehicleId?: string) =>
    useAccelerationDistributionMock(vehicleId),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => useVehiclesMock(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string | Record<string, unknown>) =>
      typeof defaultValue === 'string' ? defaultValue : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// `useThemeChartPalette()` (called unconditionally at the top of the widget)
// reaches `useTheme()`, which throws outside a <ThemeProvider>. Stub only the
// hook — keep the real ThemeProvider component + tokens — and hand
// `buildChartPalette` valid primary/accent hexes so it derives a real palette.
vi.mock('@/components/ui/ThemeProvider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useTheme: () => ({
      themeId: 'neon-cyan',
      modeId: 'dark',
      theme: { primary: '#22d3ee', accent: '#a855f7' },
      mode: { colorScheme: 'dark' },
      setTheme: vi.fn(),
      setMode: vi.fn(),
      setCustomColors: vi.fn(),
      themes: {},
      modes: {},
    }),
  };
});

// Colour tokens returned by the widget's internal `gaugeColor()` and rendered
// as each RadialGauge arc `stroke`.
const GREEN = '#10b981';
const CYAN = '#22d3ee';
const AMBER = '#f59e0b';
const RED = '#ef4444';

function makeDynamics(
  overrides: Partial<DrivingDynamicsData> = {},
): DrivingDynamicsData {
  return {
    maxAccelerationG: 0,
    maxBrakingG: 0,
    maxCorneringG: 0,
    avgAccelerationG: 0,
    avgBrakingG: 0,
    smoothnessScore: 0,
    ...overrides,
  };
}

interface DynamicsQuery {
  data: DrivingDynamicsData | undefined;
  isLoading: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

function makeQuery(overrides: Partial<DynamicsQuery> = {}): DynamicsQuery {
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

interface DistQuery {
  data: AccelerationDistributionData | undefined;
  isLoading: boolean;
  isFetching: boolean;
  dataUpdatedAt: number;
}

function makeDistQuery(overrides: Partial<DistQuery> = {}): DistQuery {
  return {
    data: undefined,
    isLoading: false,
    isFetching: false,
    dataUpdatedAt: Date.now(),
    ...overrides,
  };
}

function renderWidget(
  size: { cols: number; rows: number } = { cols: 2, rows: 2 },
  vehicleId?: number,
) {
  return render(
    <MemoryRouter>
      <DrivingDynamicsWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

function gaugeArc(container: HTMLElement, color: string): SVGCircleElement | null {
  return container.querySelector(`circle[stroke="${color}"]`);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults so a test that forgets to seed a hook still renders
  // rather than crashing on a destructure of `undefined`.
  useVehiclesMock.mockReturnValue({ data: [{ id: 1 }] });
  useDrivingDynamicsMock.mockReturnValue(makeQuery());
  useAccelerationDistributionMock.mockReturnValue(makeDistQuery());
});

afterEach(() => {
  cleanup();
});

describe('DrivingDynamicsWidget — standard layout', () => {
  it('renders the titled shell, the three g-force gauges, and the severity badge', () => {
    useDrivingDynamicsMock.mockReturnValue(
      makeQuery({
        data: makeDynamics({
          avgAccelerationG: 0.1,
          avgBrakingG: 0.1,
          maxCorneringG: 0.1,
        }),
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Driving Dynamics')).toBeInTheDocument();
    expect(screen.getByText('Accel')).toBeInTheDocument();
    expect(screen.getByText('Brake')).toBeInTheDocument();
    expect(screen.getByText('Lateral')).toBeInTheDocument();
    // avg = (0.1 + 0.1) / 2 = 0.1 < 0.15 → calm.
    expect(screen.getByText('Calm')).toBeInTheDocument();
  });

  it('does not render the g-force histogram at standard width (cols === 2)', () => {
    useDrivingDynamicsMock.mockReturnValue(
      makeQuery({ data: makeDynamics({ avgAccelerationG: 0.2 }) }),
    );
    useAccelerationDistributionMock.mockReturnValue(
      makeDistQuery({ data: { values: [1, 2, 3, 4, 5, 6] } }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // The distribution chart is gated behind the wide (cols >= 3) breakpoint.
    expect(screen.queryByText('G-Force Distribution')).not.toBeInTheDocument();
    expect(screen.getByText('Accel')).toBeInTheDocument();
  });
});

describe('DrivingDynamicsWidget — wide layout (histogram)', () => {
  it('renders the "G-Force Distribution" chart when wide and the histogram has buckets', () => {
    useDrivingDynamicsMock.mockReturnValue(
      makeQuery({ data: makeDynamics({ avgAccelerationG: 0.2 }) }),
    );
    useAccelerationDistributionMock.mockReturnValue(
      makeDistQuery({ data: { values: [3, 7, 5, 2, 1, 0] } }),
    );

    renderWidget({ cols: 3, rows: 3 });

    expect(screen.getByText('G-Force Distribution')).toBeInTheDocument();
    // The gauges still render alongside the chart.
    expect(screen.getByText('Lateral')).toBeInTheDocument();
  });

  it('omits the histogram when wide but the distribution has no buckets', () => {
    useDrivingDynamicsMock.mockReturnValue(
      makeQuery({ data: makeDynamics({ avgAccelerationG: 0.2 }) }),
    );
    useAccelerationDistributionMock.mockReturnValue(
      makeDistQuery({ data: { values: [] } }),
    );

    renderWidget({ cols: 3, rows: 3 });

    // histogramData is empty → the whole chart section is dropped, but the
    // gauges must still render (never a blank panel).
    expect(screen.queryByText('G-Force Distribution')).not.toBeInTheDocument();
    expect(screen.getByText('Accel')).toBeInTheDocument();
  });
});

describe('DrivingDynamicsWidget — gauge colour thresholds', () => {
  it('paints each gauge by its g-force band: green (<0.2), cyan (<0.4), amber (<0.6)', () => {
    useDrivingDynamicsMock.mockReturnValue(
      makeQuery({
        data: makeDynamics({
          avgAccelerationG: 0.1, // green
          avgBrakingG: 0.3, // cyan
          maxCorneringG: 0.5, // amber
        }),
      }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    expect(gaugeArc(container, GREEN)).toBeTruthy();
    expect(gaugeArc(container, CYAN)).toBeTruthy();
    expect(gaugeArc(container, AMBER)).toBeTruthy();
    // No gauge crossed the red (>= 0.6) threshold.
    expect(gaugeArc(container, RED)).toBeNull();
  });

  it('paints a gauge red once a g-force reaches the 0.6 threshold', () => {
    useDrivingDynamicsMock.mockReturnValue(
      makeQuery({
        data: makeDynamics({
          avgAccelerationG: 0.7,
          avgBrakingG: 0.7,
          maxCorneringG: 0.7,
        }),
      }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    expect(gaugeArc(container, RED)).toBeTruthy();
    expect(gaugeArc(container, GREEN)).toBeNull();
  });
});

describe('DrivingDynamicsWidget — severity classification', () => {
  const severityCases = [
    { avg: 0.1, label: 'Calm' }, // mean 0.1 < 0.15
    { avg: 0.2, label: 'Normal' }, // mean 0.2 < 0.3
    { avg: 0.4, label: 'Sporty' }, // mean 0.4 < 0.5
    { avg: 0.6, label: 'Aggressive' }, // mean 0.6 >= 0.5
  ] as const;

  it.each(severityCases)(
    'classifies avg accel/brake of $avg as "$label"',
    ({ avg, label }) => {
      useDrivingDynamicsMock.mockReturnValue(
        makeQuery({
          data: makeDynamics({ avgAccelerationG: avg, avgBrakingG: avg }),
        }),
      );

      renderWidget({ cols: 2, rows: 2 });

      expect(screen.getByText(label)).toBeInTheDocument();
    },
  );
});

describe('DrivingDynamicsWidget — compact layout', () => {
  it('renders the peak-g big number + "Smooth" badge (maxG < 0.4) and no section title', () => {
    useDrivingDynamicsMock.mockReturnValue(
      makeQuery({
        data: makeDynamics({ maxAccelerationG: 0.3, maxBrakingG: 0.2 }),
      }),
    );

    renderWidget({ cols: 1, rows: 1 });

    // maxG = max(0.3, 0.2, 0) = 0.30, formatted to two decimals.
    expect(screen.getByText('0.30')).toBeInTheDocument();
    expect(screen.getByText('Max g')).toBeInTheDocument();
    expect(screen.getByText('Smooth')).toBeInTheDocument();
    // Compact mode drops the header title and the gauges.
    expect(screen.queryByText('Driving Dynamics')).not.toBeInTheDocument();
    expect(screen.queryByText('Accel')).not.toBeInTheDocument();
  });

  it('flags "Aggressive" in compact mode once peak-g reaches the 0.4 threshold', () => {
    useDrivingDynamicsMock.mockReturnValue(
      makeQuery({ data: makeDynamics({ maxBrakingG: 0.5 }) }),
    );

    renderWidget({ cols: 1, rows: 1 });

    expect(screen.getByText('0.50')).toBeInTheDocument();
    expect(screen.getByText('Aggressive')).toBeInTheDocument();
    expect(screen.queryByText('Smooth')).not.toBeInTheDocument();
  });

  it('shows an EmptyState (never a blank panel) when compact and data-less', () => {
    useDrivingDynamicsMock.mockReturnValue(makeQuery({ data: undefined }));

    renderWidget({ cols: 1, rows: 1 });

    expect(screen.getByText('No dynamics data')).toBeInTheDocument();
    expect(screen.queryByText('Driving Dynamics')).not.toBeInTheDocument();
  });
});

describe('DrivingDynamicsWidget — query states', () => {
  it('renders a skeleton while loading with no title, gauges, or empty message', () => {
    useDrivingDynamicsMock.mockReturnValue(
      makeQuery({ isLoading: true, data: undefined }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Driving Dynamics')).not.toBeInTheDocument();
    expect(screen.queryByText('No dynamics data')).not.toBeInTheDocument();
  });

  it('enters the loading state when only the distribution query is still loading', () => {
    useDrivingDynamicsMock.mockReturnValue(
      makeQuery({ data: makeDynamics({ avgAccelerationG: 0.2 }) }),
    );
    useAccelerationDistributionMock.mockReturnValue(
      makeDistQuery({ isLoading: true }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    // isLoading = dynLoading || distLoading → the shell shows the skeleton
    // and suppresses the gauges even though the dynamics payload has landed.
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Accel')).not.toBeInTheDocument();
  });

  it('renders the QueryError panel on an initial load failure (no cached data)', () => {
    useDrivingDynamicsMock.mockReturnValue(
      makeQuery({ error: new Error('boom'), isError: true, data: undefined }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // Generic (non-HTTP) error → network/unknown branch of <QueryError>.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('Driving Dynamics')).not.toBeInTheDocument();
    expect(screen.queryByText('Accel')).not.toBeInTheDocument();
  });

  it('renders the titled shell with an EmptyState placeholder when data is absent', () => {
    useDrivingDynamicsMock.mockReturnValue(
      makeQuery({ data: undefined, isLoading: false, error: null }),
    );

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Driving Dynamics')).toBeInTheDocument();
    expect(screen.getByText('No dynamics data')).toBeInTheDocument();
    expect(screen.queryByText('Accel')).not.toBeInTheDocument();
  });

  it('degrades a partial payload to zeros without throwing (null-safety)', () => {
    // A `{}` payload is truthy, so the gauges render — every g-force falls back
    // to 0 via the widget's `?? 0` guards rather than crashing, and the mean
    // trips the "calm" severity band.
    useDrivingDynamicsMock.mockReturnValue(
      makeQuery({ data: {} as DrivingDynamicsData }),
    );

    let container!: HTMLElement;
    expect(() => {
      container = renderWidget({ cols: 2, rows: 2 }).container;
    }).not.toThrow();

    expect(screen.getByText('Accel')).toBeInTheDocument();
    expect(screen.getByText('Calm')).toBeInTheDocument();
    // Every g-force degraded to 0 → all three gauges paint green (< 0.2).
    expect(gaugeArc(container, GREEN)).toBeTruthy();
  });
});

describe('DrivingDynamicsWidget — vehicle resolution', () => {
  it('resolves the first vehicle id (as a string) when no vehicleId prop is given', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 42 }, { id: 7 }] });

    renderWidget({ cols: 2, rows: 2 });

    expect(useDrivingDynamicsMock).toHaveBeenCalledWith('42');
    expect(useAccelerationDistributionMock).toHaveBeenCalledWith('42');
  });

  it('prefers an explicit vehicleId prop over the first vehicle', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 42 }] });

    renderWidget({ cols: 2, rows: 2 }, 7);

    expect(useDrivingDynamicsMock).toHaveBeenCalledWith('7');
    expect(useAccelerationDistributionMock).toHaveBeenCalledWith('7');
  });

  it('passes undefined (disabling the queries) when no vehicle can be resolved', () => {
    useVehiclesMock.mockReturnValue({ data: [] });

    renderWidget({ cols: 2, rows: 2 });

    expect(useDrivingDynamicsMock).toHaveBeenCalledWith(undefined);
    expect(useAccelerationDistributionMock).toHaveBeenCalledWith(undefined);
  });
});

describe('DrivingDynamicsWidget — freshness interaction', () => {
  it('refetches the dynamics query when the accessible refresh control is clicked', () => {
    const refetch = vi.fn();
    useDrivingDynamicsMock.mockReturnValue(
      makeQuery({
        data: makeDynamics({ avgAccelerationG: 0.2 }),
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
    useDrivingDynamicsMock.mockReturnValue(
      makeQuery({
        data: makeDynamics({ avgAccelerationG: 0.2 }),
        isFetching: true,
        refetch,
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    expect(refetch).not.toHaveBeenCalled();
  });
});

describe('DrivingDynamicsWidget — graceful degradation on transient error', () => {
  it('keeps rendering cached g-forces and flags the freshness dot instead of blanking out', () => {
    useDrivingDynamicsMock.mockReturnValue(
      makeQuery({
        data: makeDynamics({
          avgAccelerationG: 0.1,
          avgBrakingG: 0.1,
          maxCorneringG: 0.1,
        }),
        error: new Error('transient'),
        isError: true,
        isFetching: false,
      }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    // Data is still on screen …
    expect(screen.getByText('Driving Dynamics')).toBeInTheDocument();
    expect(screen.getByText('Accel')).toBeInTheDocument();
    expect(screen.getByText('Calm')).toBeInTheDocument();
    // … the full-panel error is NOT shown …
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    // … and the freshness indicator is in its error state (red dot).
    expect(container.querySelector('.bg-red-400')).toBeTruthy();
  });
});
