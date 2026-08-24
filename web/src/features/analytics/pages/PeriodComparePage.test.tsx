/**
 * PeriodComparePage — behaviour + branch coverage.
 *
 * The page is the "compare two time windows for one vehicle" analytics surface.
 * Its own responsibilities (what these tests exercise) are:
 *
 *   1. Two `useQuery(period-stats?vehicle_id&days)` feeds keyed on the derived
 *      active vehicle + the two selected period windows.
 *   2. SI → display-unit conversion of the KPI band (km/Wh·km here — the global
 *      useSettings stub reports metric units).
 *   3. Section-local loading / error / empty branches for EVERY panel (KPI band,
 *      side-by-side chart, insights, comparison table) — no panel is gated away.
 *   4. Deterministic percent-change derivations (`fmtNumber(pct, 1)`) surfaced in
 *      the insight sentences, KPI pills, and table.
 *   5. The disambiguation banner: shown for multi-vehicle accounts, hidden for
 *      single-vehicle accounts, and hidden once dismissed (persisted to
 *      localStorage). This is where the real bug lived — see the banner block.
 *   6. Toolbar wiring (vehicle + both period selects + refresh) and the AI
 *      narration section receiving the active-vehicle context.
 *
 * Strategy: render the REAL page + REAL shared subtree (PageContainer, MetricCard,
 * DataTable, QueryError, FadeIn, charts). Only the network `request` helper, the
 * chart-palette hook, and the AI narration section are mocked. `useVehicles` runs
 * for real (driven by the mocked `request`) precisely so its async `undefined →
 * []` transition reproduces the banner-suppression bug the fix addresses.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// jsdom lacks matchMedia; framer-motion (reached via <FadeIn> + PageContainer's
// freshness chip) reads it at module load. Install before any import evaluates.
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

// Hoisted test doubles so the mock factories below and the specs can share them.
const { mockRequest, aiCapture } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  aiCapture: { props: null as Record<string, unknown> | null },
}));

// Only `request` is replaced; the real `isApiError` / `ApiError` exports stay so
// <QueryError> classifies the injected ApiError(500) into its "Server error" branch.
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: mockRequest };
});

// Deterministic palette — the real hook reads the settings query we don't stub.
vi.mock('@/hooks/useChartPalette', () => ({
  useChartPalette: () => ['#0ea5e9', '#a855f7', '#22c55e', '#f59e0b'],
}));

// Stub the AI narration section (its own off-contract suite covers it) and
// capture the props the page hands it so we can assert the active-vehicle wiring.
vi.mock('@/components/ai/AIPeriodCompareNarration', () => ({
  AIPeriodCompareNarration: (props: Record<string, unknown>) => {
    aiCapture.props = props;
    return <div data-testid="ai-narration-stub" />;
  },
}));

// i18n → return the developer fallback, interpolating {{vars}} so assertions can
// read real sentences instead of raw keys.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, opts?: unknown) => {
        const template = typeof fallback === 'string' ? fallback : key;
        const vars = (
          opts && typeof opts === 'object'
            ? opts
            : fallback && typeof fallback === 'object'
              ? fallback
              : undefined
        ) as Record<string, unknown> | undefined;
        if (!vars) return template;
        return template.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in vars ? String(vars[name]) : `{{${name}}}`,
        );
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

import PeriodComparePage from './PeriodComparePage';
import { ApiError } from '@/lib/resilience';

const BANNER_KEY = 'phase40.compareBanner.dismissed.period';

interface PeriodStats {
  total_distance: number;
  total_drives: number;
  energy_used: number;
  avg_efficiency: number;
  total_cost: number;
  co2_saved: number;
}

// days=30 vs days=90 stats deliberately diverge so the percent-change output is
// unambiguous: distance −50%, efficiency −4.8%, cost −54.5%.
const STATS_30: PeriodStats = {
  total_distance: 1000,
  total_drives: 50,
  energy_used: 200,
  avg_efficiency: 200,
  total_cost: 40,
  co2_saved: 120,
};
const STATS_90: PeriodStats = {
  total_distance: 2000,
  total_drives: 90,
  energy_used: 420,
  avg_efficiency: 210,
  total_cost: 88,
  co2_saved: 250,
};
const STATS_7: PeriodStats = {
  total_distance: 300,
  total_drives: 12,
  energy_used: 60,
  avg_efficiency: 190,
  total_cost: 11,
  co2_saved: 35,
};
const STATS_BY_DAYS: Record<number, PeriodStats> = { 7: STATS_7, 30: STATS_30, 90: STATS_90 };

const TWO_VEHICLES = [
  { id: 10, vehicle_id: 10, vin: 'VIN00010', display_name: 'Model 3', state: 'online' },
  { id: 20, vehicle_id: 20, vin: 'VIN00020', display_name: 'Model Y', state: 'asleep' },
];
const ONE_VEHICLE = [TWO_VEHICLES[0]];

type StatsMode = 'resolve' | 'pending' | 'reject';

interface InstallOpts {
  vehicles?: unknown[];
  statsMode?: StatsMode;
  statsError?: unknown;
}

function installRequest({ vehicles = TWO_VEHICLES, statsMode = 'resolve', statsError }: InstallOpts = {}) {
  mockRequest.mockImplementation((url: unknown) => {
    const u = String(url);
    if (u.includes('period-stats')) {
      if (statsMode === 'pending') return new Promise(() => {});
      if (statsMode === 'reject') return Promise.reject(statsError ?? new Error('boom'));
      const m = /days=(\d+)/.exec(u);
      const days = m ? Number(m[1]) : 0;
      return Promise.resolve(STATS_BY_DAYS[days] ?? STATS_30);
    }
    if (u.includes('/vehicles')) return Promise.resolve(vehicles);
    return Promise.resolve({});
  });
}

function periodStatsCalls(): string[] {
  return mockRequest.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes('period-stats'));
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PeriodComparePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockRequest.mockReset();
  aiCapture.props = null;
  window.localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('PeriodComparePage — happy path', () => {
  it('renders the page shell, all six KPI metrics, and every analytics panel heading', async () => {
    installRequest();
    renderPage();

    // Insight sentence proves BOTH feeds resolved and derivations ran.
    await screen.findByText(/Distance traveled was -50\.0% less/);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Period Comparison' }),
    ).toBeInTheDocument();

    // All six KPI labels are present — no section is gutted.
    for (const label of [
      /Total Distance/,
      /Total Drives/,
      /Energy Used/,
      /Avg Efficiency/,
      /Total Cost/,
      /Saved/,
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }

    // The three lower panels each render their title (mounted, not hidden).
    expect(
      screen.getByRole('heading', { level: 3, name: 'Side-by-Side Comparison' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Insights' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 3, name: 'Comparison Details' }),
    ).toBeInTheDocument();
  });

  it('derives deterministic percent-change insight sentences from both feeds', async () => {
    installRequest();
    renderPage();

    // fmtNumber(pct, 1) → always one decimal, independent of the global precision.
    expect(
      await screen.findByText(/Distance traveled was -50\.0% less in Period A vs Period B\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Efficiency declined by -4\.8% compared to Period B\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Costs were -54\.5% lower in Period A\./),
    ).toBeInTheDocument();
  });

  it('queries period-stats for the derived active vehicle with the default 30 vs 90 day windows', async () => {
    installRequest();
    renderPage();

    await screen.findByText(/Distance traveled was -50\.0% less/);

    const calls = periodStatsCalls();
    // Active vehicle falls back to the first vehicle (id 10); both windows fetched.
    expect(calls.some((u) => /vehicle_id=10\b/.test(u) && /days=30\b/.test(u))).toBe(true);
    expect(calls.some((u) => /vehicle_id=10\b/.test(u) && /days=90\b/.test(u))).toBe(true);
    // snake_case query params, no /api/v1 double prefix.
    expect(calls.every((u) => !u.includes('/api/v1'))).toBe(true);
  });

  it('hands the AI narration section the active vehicle id and both day windows', async () => {
    installRequest();
    renderPage();

    await screen.findByText(/Distance traveled was -50\.0% less/);
    expect(screen.getByTestId('ai-narration-stub')).toBeInTheDocument();
    expect(aiCapture.props).toMatchObject({ vehicleId: '10', daysA: 30, daysB: 90 });
  });
});

describe('PeriodComparePage — loading / error / empty branches', () => {
  it('shows skeleton placeholders (never a blank panel) while the feeds are in flight', async () => {
    installRequest({ statsMode: 'pending' });
    const { container } = renderPage();

    // Once the vehicle list resolves the (pending) stats queries turn loading.
    await waitFor(() =>
      expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0),
    );
    // The chart panel is still mounted (title present) — only its body is a skeleton.
    expect(
      screen.getByRole('heading', { level: 3, name: 'Side-by-Side Comparison' }),
    ).toBeInTheDocument();
    // No KPI card content leaks while loading.
    expect(screen.queryByText(/Total Distance/)).toBeNull();
  });

  it('renders per-section error states with a working Retry that refetches both feeds', async () => {
    installRequest({ statsMode: 'reject', statsError: new ApiError('kaboom', 500) });
    renderPage();

    // Every data section surfaces the error rather than blanking.
    await waitFor(() =>
      expect(screen.getAllByText('Server error').length).toBeGreaterThan(0),
    );
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries.length).toBeGreaterThan(0);

    const before = periodStatsCalls().length;
    fireEvent.click(retries[0]);
    await waitFor(() => expect(periodStatsCalls().length).toBeGreaterThan(before));
  });

  it('shows the "select a vehicle" empty state (not a crash) when the fleet is empty', async () => {
    installRequest({ vehicles: [] });
    renderPage();

    await waitFor(() =>
      expect(
        screen.getAllByText(/Select a vehicle and two periods to compare\./).length,
      ).toBeGreaterThan(0),
    );
    // Insights panel owns its own dedicated empty copy.
    expect(
      screen.getByText(/Insights appear once both periods have data\./),
    ).toBeInTheDocument();
    // No metric card rendered, and the feeds never fired (no active vehicle).
    expect(screen.queryByText(/1,000/)).toBeNull();
    expect(periodStatsCalls().length).toBe(0);
  });
});

describe('PeriodComparePage — disambiguation banner', () => {
  it('keeps the banner visible for a multi-vehicle account after the async vehicle list resolves', async () => {
    // Regression guard: the hide-effect must NOT fire on the first render (when
    // useVehicles data is still `undefined`, count 0). If it does, the banner is
    // suppressed for every account — including the multi-vehicle ones it serves.
    installRequest({ vehicles: TWO_VEHICLES });
    renderPage();

    // Wait until the vehicle list has resolved (KPI band populated).
    await screen.findByText(/Distance traveled was -50\.0% less/);

    expect(
      screen.getByText(/Looking to compare two vehicles instead\?/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open Fleet comparison/ })).toBeInTheDocument();
  });

  it('hides the banner for a single-vehicle account (cross-navigation is pointless)', async () => {
    installRequest({ vehicles: ONE_VEHICLE });
    renderPage();

    await screen.findByText(/Distance traveled was -50\.0% less/);
    await waitFor(() =>
      expect(screen.queryByText(/Looking to compare two vehicles instead\?/)).toBeNull(),
    );
    expect(screen.queryByRole('link', { name: /Open Fleet comparison/ })).toBeNull();
  });

  it('dismisses the banner on close and persists the choice to localStorage', async () => {
    installRequest({ vehicles: TWO_VEHICLES });
    renderPage();

    await screen.findByText(/Looking to compare two vehicles instead\?/);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    await waitFor(() =>
      expect(screen.queryByText(/Looking to compare two vehicles instead\?/)).toBeNull(),
    );
    expect(window.localStorage.getItem(BANNER_KEY)).toBe('1');
  });

  it('stays hidden when a previous dismissal was persisted', async () => {
    window.localStorage.setItem(BANNER_KEY, '1');
    installRequest({ vehicles: TWO_VEHICLES });
    renderPage();

    await screen.findByText(/Distance traveled was -50\.0% less/);
    expect(screen.queryByText(/Looking to compare two vehicles instead\?/)).toBeNull();
  });
});

describe('PeriodComparePage — toolbar interactions & a11y', () => {
  it('exposes accessible labelled selects and a refresh control that refetches both feeds', async () => {
    installRequest();
    renderPage();

    await screen.findByText(/Distance traveled was -50\.0% less/);

    expect(screen.getByRole('combobox', { name: 'Vehicle' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Period A' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Period B' })).toBeInTheDocument();

    // The toolbar refresh (rendered after PageContainer's freshness chip, which
    // also exposes a "Refresh" control) triggers a refetch of both feeds.
    const refreshButtons = screen.getAllByRole('button', { name: 'Refresh' });
    expect(refreshButtons.length).toBeGreaterThan(0);
    const before = periodStatsCalls().length;
    fireEvent.click(refreshButtons[refreshButtons.length - 1]);
    await waitFor(() => expect(periodStatsCalls().length).toBeGreaterThan(before));
  });

  it('refetches with the newly selected window when Period A changes to 7 days', async () => {
    installRequest();
    renderPage();

    await screen.findByText(/Distance traveled was -50\.0% less/);
    expect(periodStatsCalls().some((u) => /days=7(?:&|$)/.test(u))).toBe(false);

    fireEvent.change(screen.getByRole('combobox', { name: 'Period A' }), {
      target: { value: '7' },
    });

    await waitFor(() =>
      expect(
        periodStatsCalls().some((u) => /vehicle_id=10\b/.test(u) && /days=7(?:&|$)/.test(u)),
      ).toBe(true),
    );
  });

  it('switches the active vehicle feed when a different vehicle is selected', async () => {
    installRequest();
    renderPage();

    await screen.findByText(/Distance traveled was -50\.0% less/);

    fireEvent.change(screen.getByRole('combobox', { name: 'Vehicle' }), {
      target: { value: '20' },
    });

    await waitFor(() =>
      expect(periodStatsCalls().some((u) => /vehicle_id=20\b/.test(u))).toBe(true),
    );
  });
});
