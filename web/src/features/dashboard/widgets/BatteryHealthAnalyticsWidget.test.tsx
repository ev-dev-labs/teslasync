/**
 * BatteryHealthAnalyticsWidget tests.
 *
 * The widget renders a battery State-of-Health (SoH) hero plus a four-stat
 * summary (cycles, discharge depth, DC-fast ratio, temperature
 * exposure score) sourced from
 * `useBatteryHealthAnalytics()`. Its behaviour surface — the thing under test:
 *
 *   1. Two responsive layouts driven by `size.cols`:
 *        - compact (cols <= 1): a hero only, no stat grid.
 *        - standard (cols >= 2): a titled shell + hero + the four-stat grid.
 *   2. The four query states every data source must handle: loading (skeleton),
 *      initial error (QueryError panel), empty (EmptyState placeholder — never a
 *      blank panel), and data.
 *   3. The SoH → status pill logic: >= 80 Good, 50–79 Fair, < 50 Poor —
 *      asserted through the pill text and semantic badge classes.
 *   4. Null-safety: a partial `{}` payload keeps every field unknown without
 *      fabricating zeros or a Poor pill.
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
 * read the English defaults. The shared WidgetShell / WidgetBigNumber /
 * WidgetStatGrid / FreshnessDot / EmptyState primitives all run for real, so the
 * assertions exercise the true rendered DOM. `<MemoryRouter>` wraps every render
 * because the error branch's <QueryError> uses `useNavigate`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { BatteryHealthAnalytics } from '@/types/energy';
import BatteryHealthAnalyticsWidget from './BatteryHealthAnalyticsWidget';

// jsdom lacks matchMedia; framer-motion's useReducedMotion (reached via
// <FreshnessDot> → useMotionPreference) reads it during render. Install a
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
    t: (key: string, defaultValue?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      const template = typeof defaultValue === 'string' ? defaultValue : key;
      return options
        ? template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(options[name] ?? ''))
        : template;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

function makeAnalytics(
  overrides: Partial<BatteryHealthAnalytics> = {},
): BatteryHealthAnalytics {
  return {
    vehicle_id: 1,
    current_soh: 0,
    estimated_capacity_wh: 0,
    original_capacity_wh: 0,
    degradation_rate_pct_per_year: 0,
    battery_age_months: 0,
    total_cycles: 0,
    avg_depth_of_discharge_pct: 0,
    fast_charge_pct: 0,
    full_charge_pct: 0,
    charge_habits_score: 0,
    stress_level: 'Low',
    temp_exposure_score: 0,
    temp_exposure_reason: null,
    history: [],
    prediction: {
      has_enough_data: false,
      slope_per_year: 0,
      years_to_80_pct: 0,
      predicted_date: null,
      projection_points: [],
    },
    projections: [],
    charging_habits: {
      fast_charge_count: 0,
      slow_charge_count: 0,
      deep_discharge_count: 0,
      charge_to_full_count: 0,
      high_soc_count: 0,
      avg_energy_per_session: 0,
      total_count: 0,
    },
    risk_factors: [],
    recommendations: [],
    charging_analysis: {
      charge_level_distribution: [],
      avg_start_soc_pct: null,
      avg_end_soc_pct: null,
      ac_session_count: 0,
      dc_session_count: 0,
      supercharger_count: 0,
      dc_fast_count: 0,
      deep_discharge_count: 0,
      ac_energy_wh: 0,
      dc_energy_wh: 0,
      total_sessions: 0,
    },
    capacity_source: 'default',
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

function pillBadge(): HTMLElement {
  const el = screen.getByText(/^(Good|Fair|Poor)$/);
  return el.closest('span') as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults so a test that forgets to seed a hook still renders
  // rather than crashing on a destructure of `undefined`.
  useVehiclesMock.mockReturnValue({ data: [] });
  useBatteryHealthAnalyticsMock.mockReturnValue(makeQuery());
});

it.each([1, 2, 3])('keeps an accessible heading at %s columns', cols => {
  renderWidget({ cols, rows: 4 });
  expect(screen.getByRole('heading', { name: 'Battery analytics', level: 3 })).toBeVisible();
});

afterEach(() => {
  cleanup();
});

describe('BatteryHealthAnalyticsWidget — standard layout', () => {
  it('renders the titled shell, the SoH hero with Good pill, and all four formatted stats', () => {
    useBatteryHealthAnalyticsMock.mockReturnValue(
      makeQuery({
        data: makeAnalytics({
          current_soh: 92,
          total_cycles: 512,
          full_charge_pct: 71,
          avg_depth_of_discharge_pct: 43,
          fast_charge_pct: 18,
          temp_exposure_score: 88,
          charge_habits_score: 76,
        }),
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // Titled shell + hero label/value and status pill.
    expect(screen.getByText('Battery analytics')).toBeInTheDocument();
    expect(screen.getByText('health')).toBeInTheDocument();
    expect(screen.getByText('92')).toBeInTheDocument();
    expect(screen.getByText('Good')).toBeInTheDocument();
    expect(pillBadge().className).toContain('var(--semantic-success)');

    // All four After-card stat labels …
    expect(screen.getByText('Cycles')).toBeInTheDocument();
    expect(screen.getByText('Discharge')).toBeInTheDocument();
    expect(screen.getByText('DC fast')).toBeInTheDocument();
    expect(screen.getByText('Temp score')).toBeInTheDocument();

    // … and their whole-number formatted values (spec rule 2).
    expect(screen.getByText('512')).toBeInTheDocument();
    expect(screen.getByText('43')).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();
    expect(screen.getByText('88')).toBeInTheDocument();
    expect(screen.getByText('/ 100')).toBeInTheDocument();
  });

  it('keeps measured zero visible and unknown stats as dashes without fabricating values', () => {
    useBatteryHealthAnalyticsMock.mockReturnValue(makeQuery({
      data: makeAnalytics({ current_soh: 92, total_cycles: 0, fast_charge_pct: Number.NaN }),
    }));
    const { container } = renderWidget();
    expect(screen.getByText('Cycles')).toBeInTheDocument();
    // Measured zeros stay visible (cycles, discharge and temp score are 0).
    expect(screen.getAllByText('0')).toHaveLength(3);
    expect(container.textContent).not.toContain('NaN');
    expect(screen.getByText('Good')).toBeInTheDocument();
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

describe('BatteryHealthAnalyticsWidget — SoH status thresholds', () => {
  it('shows a Good success pill at and above the 80 threshold', () => {
    useBatteryHealthAnalyticsMock.mockReturnValue(
      makeQuery({ data: makeAnalytics({ current_soh: 80 }) }),
    );
    renderWidget({ cols: 2, rows: 2 });
    expect(screen.getByText('Good')).toBeInTheDocument();
    expect(pillBadge().className).toContain('var(--semantic-success)');
  });

  it('shows a Fair warning pill in the 50–79 band', () => {
    useBatteryHealthAnalyticsMock.mockReturnValue(
      makeQuery({ data: makeAnalytics({ current_soh: 65 }) }),
    );
    renderWidget({ cols: 2, rows: 2 });
    expect(screen.getByText('Fair')).toBeInTheDocument();
    expect(pillBadge().className).toContain('var(--semantic-warning)');
  });

  it('shows a Poor danger pill below 50', () => {
    useBatteryHealthAnalyticsMock.mockReturnValue(
      makeQuery({ data: makeAnalytics({ current_soh: 49 }) }),
    );
    renderWidget({ cols: 2, rows: 2 });
    expect(screen.getByText('Poor')).toBeInTheDocument();
    expect(pillBadge().className).toContain('var(--semantic-danger)');
  });
});

describe('BatteryHealthAnalyticsWidget — compact layout', () => {
  it('renders a hero only — no stat grid', () => {
    useBatteryHealthAnalyticsMock.mockReturnValue(
      makeQuery({
        data: makeAnalytics({ current_soh: 88, total_cycles: 300 }),
      }),
    );

    renderWidget({ cols: 1, rows: 1 });

    expect(screen.getByText('health')).toBeInTheDocument();
    expect(screen.getByText('88')).toBeInTheDocument();
    expect(screen.getByText('Good')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Battery analytics', level: 3 })).toBeVisible();
    expect(screen.queryByText('Cycles')).not.toBeInTheDocument();
    expect(screen.queryByText('Temp score')).not.toBeInTheDocument();
  });

  it('shows the empty placeholder (not a blank panel) when compact and data-less', () => {
    useBatteryHealthAnalyticsMock.mockReturnValue(makeQuery({ data: undefined }));

    renderWidget({ cols: 1, rows: 1 });

    expect(screen.getByText('No battery health data')).toBeInTheDocument();
  });
});

describe('BatteryHealthAnalyticsWidget — query states', () => {
  it('keeps the heading while loading without a gauge or empty message', () => {
    useBatteryHealthAnalyticsMock.mockReturnValue(
      makeQuery({ isLoading: true, data: undefined }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    const shell = container.querySelector('[data-data-state="initial"]');
    expect(shell).toHaveAttribute('aria-busy', 'true');
    expect(shell?.querySelector('[aria-hidden="true"].min-h-24')).toHaveClass(
      'h-full', 'min-h-24', 'rounded-xl', 'bg-[var(--skeleton-bg)]',
    );
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(screen.queryByText('Battery analytics')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Battery analytics', level: 3 })).toBeVisible();
    expect(screen.queryByText('Cycles')).not.toBeInTheDocument();
    expect(screen.queryByText('No battery health data')).not.toBeInTheDocument();
  });

  it('renders the QueryError panel on an initial load failure (no cached data)', () => {
    useBatteryHealthAnalyticsMock.mockReturnValue(
      makeQuery({ error: new Error('boom'), isError: true, data: undefined }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // Generic (non-HTTP) error → network/unknown branch of <QueryError>.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('Battery analytics')).toBeInTheDocument();
    expect(screen.queryByText('Cycles')).not.toBeInTheDocument();
  });

  it('renders an EmptyState placeholder (never a blank panel) when data is absent', () => {
    useBatteryHealthAnalyticsMock.mockReturnValue(
      makeQuery({ data: undefined, isLoading: false, error: null, isError: false }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // Titled shell still renders; the body degrades to the placeholder.
    expect(screen.getByText('Battery analytics')).toBeInTheDocument();
    expect(screen.getByText('No battery health data')).toBeInTheDocument();
    expect(screen.queryByText('Cycles')).not.toBeInTheDocument();
  });

  it('keeps a partial payload unknown without fabricating zeros or a Poor pill', () => {
    useBatteryHealthAnalyticsMock.mockReturnValue(
      makeQuery({ data: {} as BatteryHealthAnalytics }),
    );

    expect(() => {
      renderWidget({ cols: 2, rows: 2 });
    }).not.toThrow();

    expect(screen.getByText('Cycles')).toBeInTheDocument();
    // Hero placeholder plus one dash per stat tile.
    expect(screen.getAllByText('—')).toHaveLength(5);
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByText('Poor')).toBeNull();
    expect(screen.queryByText('Good')).toBeNull();
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
    expect(screen.getByText('Battery analytics')).toBeInTheDocument();
    expect(screen.getByText('640')).toBeInTheDocument();
    expect(screen.getByText('Good')).toBeInTheDocument();
    // … the full-panel error is NOT shown …
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    // … and the freshness indicator retains its semantic error state.
    expect(container.querySelector('[class~="bg-[var(--semantic-danger)]"]')).toBeTruthy();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
  });
});
