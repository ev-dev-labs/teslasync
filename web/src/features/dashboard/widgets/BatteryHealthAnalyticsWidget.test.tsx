/**
 * BatteryHealthAnalyticsWidget tests.
 *
 * The widget renders a battery State-of-Health (SoH) gauge plus a six-stat
 * summary (cycles, charge depth, discharge depth, DC-fast ratio, temperature
 * exposure score, charge-habits score) sourced from
 * `useBatteryHealthAnalytics()`. Its behaviour surface — the thing under test:
 *
 *   1. Two responsive layouts driven by `size.cols`:
 *        - compact (cols <= 1): a gauge only, no section title, no stat grid.
 *        - standard (cols >= 2): a titled shell + gauge + the six-stat grid.
 *   2. The four query states every data source must handle: loading (skeleton),
 *      initial error (QueryError panel), empty (EmptyState placeholder — never a
 *      blank panel), and data.
 *   3. The SoH → colour threshold logic (the internal `scoreColor`): >= 80 green,
 *      50–79 amber, < 50 red — asserted through the gauge's coloured arc stroke.
 *   4. Null-safety: a partial `{}` payload must degrade every field to 0 (and a
 *      red gauge) rather than throw.
 *   5. Vehicle resolution: an explicit `vehicleId` prop wins; otherwise the first
 *      vehicle from `useVehicles()` is used; with neither, the query is disabled
 *      by passing `null`.
 *   6. The freshness control: clicking it refetches, but only when a fetch is not
 *      already in flight.
 *   7. Graceful degradation (the hardened bug): a transient background-refetch
 *      error MUST NOT blank out otherwise-valid cached numbers — the widget keeps
 *      rendering and surfaces the failure through the freshness indicator's error
 *      state instead of the full-panel QueryError.
 *
 * `@/api/hooks/useEnergy` and `@/api/hooks/useVehicles` are mocked so the network
 * is never touched and every query state is driven deterministically.
 * `react-i18next` is stubbed with a passthrough `t(key, default)` so assertions
 * read the English defaults. The shared WidgetShell / WidgetGaugeHero /
 * RadialGauge / DataFreshness / EmptyState primitives all run for real, so the
 * assertions exercise the true rendered DOM. `<MemoryRouter>` wraps every render
 * because the error branch's <QueryError> uses `useNavigate`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { BatteryHealthAnalytics } from '@/types/energy';
import BatteryHealthAnalyticsWidget from './BatteryHealthAnalyticsWidget';

// jsdom lacks matchMedia; framer-motion's useReducedMotion (reached via
// <DataFreshness> → useMotionPreference) reads it during render. Install a
// benign stub before any component mounts.
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

const { useBatteryHealthAnalyticsMock, useVehiclesMock } = vi.hoisted(() => ({
  useBatteryHealthAnalyticsMock: vi.fn(),
  useVehiclesMock: vi.fn(),
}));

vi.mock('@/api/hooks/useEnergy', () => ({
  useBatteryHealthAnalytics: (vehicleId: string | null) =>
    useBatteryHealthAnalyticsMock(vehicleId),
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

// Colour tokens returned by the widget's internal `scoreColor()` and rendered
// as the RadialGauge arc `stroke`.
const GREEN = '#10b981';
const AMBER = '#f59e0b';
const RED = '#ef4444';

function makeAnalytics(
  overrides: Partial<BatteryHealthAnalytics> = {},
): BatteryHealthAnalytics {
  return {
    current_soh: 0,
    estimated_capacity: 0,
    original_capacity: 0,
    degradation_rate_yr: 0,
    battery_age_months: 0,
    total_cycles: 0,
    avg_depth_of_discharge: 0,
    fast_charge_pct: 0,
    full_charge_pct: 0,
    charge_habits_score: 0,
    temp_exposure_score: 0,
    history: [],
    ...overrides,
  };
}

interface QueryState {
  data: BatteryHealthAnalytics | undefined;
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
      <BatteryHealthAnalyticsWidget size={size} vehicleId={vehicleId} />
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
  useVehiclesMock.mockReturnValue({ data: [] });
  useBatteryHealthAnalyticsMock.mockReturnValue(makeQuery());
});

afterEach(() => {
  cleanup();
});

describe('BatteryHealthAnalyticsWidget — standard layout', () => {
  it('renders the titled shell, the SoH gauge, and all six formatted stats', () => {
    useBatteryHealthAnalyticsMock.mockReturnValue(
      makeQuery({
        data: makeAnalytics({
          current_soh: 92,
          total_cycles: 512,
          full_charge_pct: 71,
          avg_depth_of_discharge: 43,
          fast_charge_pct: 18,
          temp_exposure_score: 88,
          charge_habits_score: 76,
        }),
      }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    // Titled shell + gauge unit label.
    expect(screen.getByText('Battery Analytics')).toBeInTheDocument();
    expect(screen.getByText('health')).toBeInTheDocument();

    // All six stat labels …
    expect(screen.getByText('Cycles')).toBeInTheDocument();
    expect(screen.getByText('Charge Depth')).toBeInTheDocument();
    expect(screen.getByText('Discharge')).toBeInTheDocument();
    expect(screen.getByText('DC Fast')).toBeInTheDocument();
    expect(screen.getByText('Temp Score')).toBeInTheDocument();
    expect(screen.getByText('Habits')).toBeInTheDocument();

    // … and their formatted values.
    expect(screen.getByText('512')).toBeInTheDocument();
    expect(screen.getByText('71')).toBeInTheDocument();
    expect(screen.getByText('43')).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();
    expect(screen.getByText('88')).toBeInTheDocument();
    expect(screen.getByText('76')).toBeInTheDocument();

    // A healthy SoH paints the gauge arc green.
    expect(gaugeArc(container, GREEN)).toBeTruthy();
  });

  it('formats a large cycle count with locale thousands separators', () => {
    useBatteryHealthAnalyticsMock.mockReturnValue(
      makeQuery({ data: makeAnalytics({ current_soh: 85, total_cycles: 12345 }) }),
    );

    renderWidget({ cols: 3, rows: 2 });

    expect(screen.getByText('12,345')).toBeInTheDocument();
    expect(screen.getByText('Cycles')).toBeInTheDocument();
  });
});

describe('BatteryHealthAnalyticsWidget — SoH colour thresholds', () => {
  it('paints the gauge green at and above the 80 threshold', () => {
    useBatteryHealthAnalyticsMock.mockReturnValue(
      makeQuery({ data: makeAnalytics({ current_soh: 80 }) }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    expect(gaugeArc(container, GREEN)).toBeTruthy();
    expect(gaugeArc(container, AMBER)).toBeNull();
    expect(gaugeArc(container, RED)).toBeNull();
  });

  it('paints the gauge amber in the 50–79 band', () => {
    useBatteryHealthAnalyticsMock.mockReturnValue(
      makeQuery({ data: makeAnalytics({ current_soh: 65 }) }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    expect(gaugeArc(container, AMBER)).toBeTruthy();
    expect(gaugeArc(container, GREEN)).toBeNull();
  });

  it('paints the gauge red below 50', () => {
    useBatteryHealthAnalyticsMock.mockReturnValue(
      makeQuery({ data: makeAnalytics({ current_soh: 49 }) }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    expect(gaugeArc(container, RED)).toBeTruthy();
    expect(gaugeArc(container, AMBER)).toBeNull();
  });
});

describe('BatteryHealthAnalyticsWidget — compact layout', () => {
  it('renders a gauge only — no section title and no stat grid', () => {
    useBatteryHealthAnalyticsMock.mockReturnValue(
      makeQuery({
        data: makeAnalytics({ current_soh: 88, total_cycles: 300 }),
      }),
    );

    const { container } = renderWidget({ cols: 1, rows: 1 });

    // Gauge (with its unit) is present …
    expect(screen.getByText('health')).toBeInTheDocument();
    expect(gaugeArc(container, GREEN)).toBeTruthy();
    // … but the titled header and the stat grid are dropped in compact mode.
    expect(screen.queryByText('Battery Analytics')).not.toBeInTheDocument();
    expect(screen.queryByText('Cycles')).not.toBeInTheDocument();
    expect(screen.queryByText('Habits')).not.toBeInTheDocument();
  });

  it('shows the empty placeholder (not a blank panel) when compact and data-less', () => {
    useBatteryHealthAnalyticsMock.mockReturnValue(makeQuery({ data: undefined }));

    renderWidget({ cols: 1, rows: 1 });

    expect(screen.getByText('No battery health data')).toBeInTheDocument();
  });
});

describe('BatteryHealthAnalyticsWidget — query states', () => {
  it('renders a skeleton while loading and no title, gauge, or empty message', () => {
    useBatteryHealthAnalyticsMock.mockReturnValue(
      makeQuery({ isLoading: true, data: undefined }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Battery Analytics')).not.toBeInTheDocument();
    expect(screen.queryByText('No battery health data')).not.toBeInTheDocument();
  });

  it('renders the QueryError panel on an initial load failure (no cached data)', () => {
    useBatteryHealthAnalyticsMock.mockReturnValue(
      makeQuery({ error: new Error('boom'), isError: true, data: undefined }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // Generic (non-HTTP) error → network/unknown branch of <QueryError>.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('Battery Analytics')).not.toBeInTheDocument();
    expect(screen.queryByText('Cycles')).not.toBeInTheDocument();
  });

  it('renders an EmptyState placeholder (never a blank panel) when data is absent', () => {
    useBatteryHealthAnalyticsMock.mockReturnValue(
      makeQuery({ data: undefined, isLoading: false, error: null, isError: false }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // Titled shell still renders; the body degrades to the placeholder.
    expect(screen.getByText('Battery Analytics')).toBeInTheDocument();
    expect(screen.getByText('No battery health data')).toBeInTheDocument();
    expect(screen.queryByText('Cycles')).not.toBeInTheDocument();
  });

  it('degrades a partial payload to zeros and a red gauge without throwing', () => {
    // A `{}` payload is truthy, so the gauge + stats render — every field falls
    // back to 0 via the widget's `?? 0` guards rather than crashing, and SoH 0
    // trips the red threshold.
    useBatteryHealthAnalyticsMock.mockReturnValue(
      makeQuery({ data: {} as BatteryHealthAnalytics }),
    );

    let container!: HTMLElement;
    expect(() => {
      container = renderWidget({ cols: 2, rows: 2 }).container;
    }).not.toThrow();

    expect(screen.getByText('Cycles')).toBeInTheDocument();
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    expect(gaugeArc(container, RED)).toBeTruthy();
  });
});

describe('BatteryHealthAnalyticsWidget — vehicle resolution', () => {
  it('falls back to the first vehicle when no vehicleId prop is supplied', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 42 }, { id: 7 }] });

    renderWidget({ cols: 2, rows: 2 });

    expect(useBatteryHealthAnalyticsMock).toHaveBeenCalledWith('42');
  });

  it('prefers an explicit vehicleId prop over the first vehicle', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 42 }] });

    renderWidget({ cols: 2, rows: 2 }, 7);

    expect(useBatteryHealthAnalyticsMock).toHaveBeenCalledWith('7');
  });

  it('passes null (disabling the query) when no vehicle can be resolved', () => {
    useVehiclesMock.mockReturnValue({ data: [] });

    renderWidget({ cols: 2, rows: 2 });

    expect(useBatteryHealthAnalyticsMock).toHaveBeenCalledWith(null);
  });
});

describe('BatteryHealthAnalyticsWidget — freshness interaction', () => {
  it('refetches when the accessible refresh control is clicked', () => {
    const refetch = vi.fn();
    useBatteryHealthAnalyticsMock.mockReturnValue(
      makeQuery({
        data: makeAnalytics({ current_soh: 90 }),
        isFetching: false,
        dataUpdatedAt: Date.now(),
        refetch,
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    const refreshControl = screen.getByRole('button', { name: /refresh/i });
    fireEvent.click(refreshControl);

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('does not refetch while a fetch is already in flight', () => {
    const refetch = vi.fn();
    useBatteryHealthAnalyticsMock.mockReturnValue(
      makeQuery({
        data: makeAnalytics({ current_soh: 90 }),
        isFetching: true,
        refetch,
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    const refreshControl = screen.getByRole('button', { name: /refresh/i });
    fireEvent.click(refreshControl);

    expect(refetch).not.toHaveBeenCalled();
  });
});

describe('BatteryHealthAnalyticsWidget — graceful degradation on transient error', () => {
  it('keeps rendering cached data and flags the freshness indicator instead of blanking out', () => {
    useBatteryHealthAnalyticsMock.mockReturnValue(
      makeQuery({
        data: makeAnalytics({ current_soh: 91, total_cycles: 640 }),
        error: new Error('transient'),
        isError: true,
        isFetching: false,
        dataUpdatedAt: Date.now(),
      }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    // Data is still on screen …
    expect(screen.getByText('Battery Analytics')).toBeInTheDocument();
    expect(screen.getByText('640')).toBeInTheDocument();
    expect(gaugeArc(container, GREEN)).toBeTruthy();
    // … the full-panel error is NOT shown …
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    // … and the freshness indicator is in its error state (red dot).
    expect(container.querySelector('.bg-red-400')).toBeTruthy();
  });
});
