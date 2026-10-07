/**
 * MileageStatsWidget tests.
 *
 * The widget projects a vehicle's odometer rollup (lifetime + trailing-30-day
 * distance) sourced from `useMileageStats()`. Everything on disk / over the
 * wire is SI kilometres; the widget lifts to metres and converts to the user's
 * display unit at the render boundary via `convertDistanceFromSI` +
 * `useUnits().unitPrefs.distance`. Its behaviour surface — the thing under test:
 *
 *   1. Two responsive layouts driven by `size.cols`:
 *        - compact (cols <= 1): a title-less shell with the daily-average big
 *          number + a "{unit}/day" caption, or an EmptyState.
 *        - standard/wide (cols >= 2): a titled "Mileage Stats" shell with a
 *          four-stat grid (Daily Avg, Weekly Avg, Monthly Avg, Next Milestone),
 *          or an EmptyState.
 *   2. The derived stats: daily avg = last_30d_km / 30 (converted, 1 dp), weekly
 *      = daily × 7, monthly = daily × 30, and the next 10 000-unit milestone
 *      above the lifetime total, with a "~N mo" ETA from the daily average.
 *   3. Unit-awareness: the SAME payload renders km or mi depending on the
 *      distance preference — every number and unit chip follows.
 *   4. The `nextMilestone` boundary rule: an exact 10 000 multiple still rounds
 *      UP to the next milestone (the `+ 1` guard) so "remaining" is never 0.
 *   5. The four query states every data source must handle: loading (skeleton),
 *      initial error (QueryError panel, only when there is no cached data),
 *      empty (EmptyState — never a blank panel), and data.
 *   6. Null-safety: a partial `{}` payload degrades every field to 0 (daily
 *      "0.0", milestone the first 10 000 step) rather than throwing.
 *   7. Vehicle resolution: an explicit `vehicleId` wins, else the first vehicle;
 *      a missing vehicle passes '' which disables the query.
 *   8. The freshness control: clicking refetches, but only when a fetch is not
 *      already in flight.
 *   9. Graceful degradation (the hardened bug): a transient background-refetch
 *      error MUST NOT blank out otherwise-valid cached numbers — the widget
 *      keeps rendering and surfaces the failure through the freshness
 *      indicator's error state instead of the full-panel QueryError.
 *
 * `@/api/hooks/useAnalytics`, `@/api/hooks/useVehicles`, and `@/hooks/useUnits`
 * are mocked so the network is never touched and every query state + unit
 * preference is driven deterministically. `convertDistanceFromSI` runs for real
 * so the conversion math is genuinely exercised. `react-i18next` is stubbed with
 * a passthrough `t(key, default, opts)` that also resolves `{{interpolation}}`
 * so assertions read the English defaults. The shared WidgetShell / StatCard /
 * AnimatedNumber / DataFreshness / EmptyState primitives all run for real, so
 * assertions exercise the true rendered DOM. `<MemoryRouter>` wraps every render
 * because the error branch's <QueryError> uses `useNavigate`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { MileageStats } from '@/types/analytics';
import MileageStatsWidget from './MileageStatsWidget';

// jsdom lacks matchMedia; AnimatedNumber (compact big number) and DataFreshness
// both read it during render. Report `prefers-reduced-motion: reduce` so the
// AnimatedNumber tween is skipped and the value lands on its target
// synchronously — that makes the compact numeric assertions deterministic and
// disables framer-motion animation timers.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: /prefers-reduced-motion/.test(query),
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

const { useMileageStatsMock, useVehiclesMock, useUnitsMock } = vi.hoisted(() => ({
  useMileageStatsMock: vi.fn(),
  useVehiclesMock: vi.fn(),
  useUnitsMock: vi.fn(),
}));

vi.mock('@/api/hooks/useAnalytics', () => ({
  useMileageStats: (vehicleId: string) => useMileageStatsMock(vehicleId),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => useVehiclesMock(),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => useUnitsMock(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      defaultValue?: string | Record<string, unknown>,
      opts?: Record<string, unknown>,
    ) => {
      const template = typeof defaultValue === 'string' ? defaultValue : key;
      if (opts && typeof opts === 'object') {
        return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
          opts[name] != null ? String(opts[name]) : '',
        );
      }
      return template;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

function makeStats(overrides: Partial<MileageStats> = {}): MileageStats {
  return {
    vehicle_id: 1,
    lifetime_km: 0,
    last_7d_km: 0,
    last_30d_km: 0,
    last_365d_km: 0,
    drive_count_lifetime: 0,
    drive_count_30d: 0,
    first_drive_at: null,
    last_drive_at: null,
    ...overrides,
  };
}

interface QueryState {
  data: MileageStats | undefined;
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
      <MileageStatsWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults so a test that forgets to seed a hook still renders
  // rather than crashing on a destructure of `undefined`.
  useVehiclesMock.mockReturnValue({ data: [{ id: 1 }] });
  useUnitsMock.mockReturnValue({ unitPrefs: { distance: 'km' } });
  useMileageStatsMock.mockReturnValue(makeQuery());
});

afterEach(() => {
  cleanup();
});

describe('MileageStatsWidget — standard layout (km)', () => {
  it('renders the titled shell and all four derived stats', () => {
    useMileageStatsMock.mockReturnValue(
      makeQuery({ data: makeStats({ lifetime_km: 45000, last_30d_km: 900 }) }),
    );

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Mileage Stats')).toBeInTheDocument();

    // Labels.
    expect(screen.getByText('Daily Avg')).toBeInTheDocument();
    expect(screen.getByText('Weekly Avg')).toBeInTheDocument();
    expect(screen.getByText('Monthly Avg')).toBeInTheDocument();
    expect(screen.getByText('Next Milestone')).toBeInTheDocument();

    // daily = 900 / 30 = 30 km/day (1 dp) → weekly ×7, monthly ×30.
    expect(screen.getByText('30.0')).toBeInTheDocument();
    expect(screen.getByText('210')).toBeInTheDocument();
    expect(screen.getByText('900')).toBeInTheDocument();

    // Every stat chip carries the km unit.
    expect(screen.getAllByText('km')).toHaveLength(4);
  });

  it('rounds the milestone up to the next 10 000 above the lifetime total and shows the ETA', () => {
    useMileageStatsMock.mockReturnValue(
      makeQuery({ data: makeStats({ lifetime_km: 45000, last_30d_km: 900 }) }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // lifetime 45 000 → next milestone 50 000; remaining 5 000 at 30 km/day
    // ≈ round(5000 / 30 / 30) = 6 months.
    expect(screen.getByText('50,000')).toBeInTheDocument();
    expect(screen.getByText('~6 mo')).toBeInTheDocument();
  });

  it('advances past an exact 10 000 multiple (the +1 boundary guard)', () => {
    useMileageStatsMock.mockReturnValue(
      makeQuery({ data: makeStats({ lifetime_km: 20000, last_30d_km: 300 }) }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // 20 000 is itself a milestone, so we must round up to 30 000 (remaining
    // 10 000 at 10 km/day ≈ 33 months) rather than reporting "0 remaining".
    expect(screen.getByText('30,000')).toBeInTheDocument();
    expect(screen.getByText('~33 mo')).toBeInTheDocument();
    expect(screen.getByText('10.0')).toBeInTheDocument();
  });
});

describe('MileageStatsWidget — unit conversion', () => {
  it('converts the same payload to miles when the distance preference is mi', () => {
    useUnitsMock.mockReturnValue({ unitPrefs: { distance: 'mi' } });
    useMileageStatsMock.mockReturnValue(
      makeQuery({ data: makeStats({ lifetime_km: 45000, last_30d_km: 900 }) }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // 30 km/day = 30 000 m / 1609.344 ≈ 18.6 mi/day.
    expect(screen.getByText('18.6')).toBeInTheDocument();
    expect(screen.getAllByText('mi')).toHaveLength(4);
    // The km value must NOT leak through — proves the conversion ran.
    expect(screen.queryByText('30.0')).not.toBeInTheDocument();
  });
});

describe('MileageStatsWidget — compact layout', () => {
  it('renders the daily-average big number and a "{unit}/day" caption, no title', () => {
    useMileageStatsMock.mockReturnValue(
      makeQuery({ data: makeStats({ lifetime_km: 45000, last_30d_km: 900 }) }),
    );

    renderWidget({ cols: 1, rows: 1 });

    // Reduced motion → AnimatedNumber lands on 30 (0 dp) immediately.
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('km/day')).toBeInTheDocument();
    // Compact drops the header title and the stat grid.
    expect(screen.queryByText('Mileage Stats')).not.toBeInTheDocument();
    expect(screen.queryByText('Daily Avg')).not.toBeInTheDocument();
  });

  it('shows an EmptyState (never a blank panel) when compact and data-less', () => {
    useMileageStatsMock.mockReturnValue(makeQuery({ data: undefined }));

    renderWidget({ cols: 1, rows: 1 });

    expect(screen.getByText('No mileage data')).toBeInTheDocument();
    expect(screen.queryByText('Mileage Stats')).not.toBeInTheDocument();
  });
});

describe('MileageStatsWidget — query states', () => {
  it('renders a skeleton while loading with no title or empty message', () => {
    useMileageStatsMock.mockReturnValue(
      makeQuery({ isLoading: true, data: undefined }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Mileage Stats')).not.toBeInTheDocument();
    expect(screen.queryByText('No mileage data')).not.toBeInTheDocument();
  });

  it('renders the QueryError panel on an initial load failure (no cached data)', () => {
    useMileageStatsMock.mockReturnValue(
      makeQuery({ error: new Error('boom'), isError: true, data: undefined }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // Generic (non-HTTP) error → network/unknown branch of <QueryError>.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('Mileage Stats')).not.toBeInTheDocument();
    expect(screen.queryByText('Daily Avg')).not.toBeInTheDocument();
  });

  it('renders the titled shell with an EmptyState placeholder when data is absent', () => {
    useMileageStatsMock.mockReturnValue(
      makeQuery({ data: undefined, isLoading: false, error: null }),
    );

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Mileage Stats')).toBeInTheDocument();
    expect(screen.getByText('No mileage data')).toBeInTheDocument();
    expect(screen.queryByText('Daily Avg')).not.toBeInTheDocument();
  });

  it('degrades a partial payload to zeros without throwing (null-safety)', () => {
    // A `{}` payload is truthy, so the grid renders — every field falls back to
    // 0 via the widget's `?? 0` guards rather than crashing, and the milestone
    // rounds up from 0 to the first 10 000 step.
    useMileageStatsMock.mockReturnValue(
      makeQuery({ data: {} as MileageStats }),
    );

    expect(() => renderWidget({ cols: 2, rows: 2 })).not.toThrow();

    expect(screen.getByText('Daily Avg')).toBeInTheDocument();
    expect(screen.getByText('0.0')).toBeInTheDocument();
    expect(screen.getByText('10,000')).toBeInTheDocument();
  });
});

describe('MileageStatsWidget — vehicle resolution', () => {
  it('resolves the first vehicle id (as a string) when no vehicleId prop is given', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 42 }, { id: 7 }] });

    renderWidget({ cols: 2, rows: 2 });

    expect(useMileageStatsMock).toHaveBeenCalledWith('42');
  });

  it('prefers an explicit vehicleId prop over the first vehicle', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 42 }] });

    renderWidget({ cols: 2, rows: 2 }, 7);

    expect(useMileageStatsMock).toHaveBeenCalledWith('7');
  });

  it("passes '' (disabling the query) when no vehicle can be resolved", () => {
    useVehiclesMock.mockReturnValue({ data: [] });

    renderWidget({ cols: 2, rows: 2 });

    expect(useMileageStatsMock).toHaveBeenCalledWith('');
  });
});

describe('MileageStatsWidget — freshness interaction', () => {
  it('refetches when the accessible refresh control is clicked', () => {
    const refetch = vi.fn();
    useMileageStatsMock.mockReturnValue(
      makeQuery({
        data: makeStats({ lifetime_km: 45000, last_30d_km: 900 }),
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
    useMileageStatsMock.mockReturnValue(
      makeQuery({
        data: makeStats({ lifetime_km: 45000, last_30d_km: 900 }),
        isFetching: true,
        refetch,
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    expect(refetch).not.toHaveBeenCalled();
  });
});

describe('MileageStatsWidget — graceful degradation on transient error', () => {
  it('keeps rendering cached stats and flags the freshness dot instead of blanking out', () => {
    useMileageStatsMock.mockReturnValue(
      makeQuery({
        data: makeStats({ lifetime_km: 45000, last_30d_km: 900 }),
        error: new Error('transient'),
        isError: true,
        isFetching: false,
      }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    // Data is still on screen …
    expect(screen.getByText('Mileage Stats')).toBeInTheDocument();
    expect(screen.getByText('30.0')).toBeInTheDocument();
    expect(screen.getByText('50,000')).toBeInTheDocument();
    // … the full-panel error is NOT shown …
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    // … and the freshness indicator is in its error state (red dot).
    expect(container.querySelector('.bg-red-400')).toBeTruthy();
  });
});
