/**
 * YearReviewPage — behaviour + branch coverage.
 *
 * The page is the full-width "your electric year, summarized" recap for a
 * single vehicle. Its own responsibilities (what these tests exercise) are:
 *
 *   1. A `useYearReview(year, vehicle_id)` feed keyed on the URL `:year` param
 *      and the `?vehicle_id` search param, only enabled once a vehicle exists.
 *   2. SI → display-unit derivation of the six-tile KPI band (km→m, kWh→Wh,
 *      currency, integer counts) via useUnits / useFormatting — the global
 *      test-setup useSettings stub reports metric units.
 *   3. A per-section state gate (`gate`) that shows a skeleton while loading,
 *      a <QueryError> with Retry on failure, and — the bug this suite pins —
 *      a skeleton (NOT the "pick a vehicle" prompt) while the fleet list is
 *      still resolving or the auto-select is one frame away. The genuine
 *      empty prompt is reserved for a resolved-but-empty fleet.
 *   4. Year navigation (prev / next / next-disabled-at-current-year / close)
 *      and vehicle disambiguation (multi-vehicle select + URL auto-select).
 *   5. The zero-activity info banner and the vehicle subtitle.
 *   6. Handing the correct data/props to each of the nine review sub-panels
 *      and the numeric vehicle id to the AI narration section.
 *
 * Strategy mirrors the sibling PeriodComparePage.test.tsx: render the REAL
 * page + REAL shared subtree (PageContainer, MetricCard, QueryError, EmptyState,
 * FadeIn, Select, Button). The network `request` helper, `useNavigate`, the AI
 * narration section, and the nine chart/panel sub-components are the only
 * doubles — the sub-components are stubbed so the assertions stay focused on
 * the PAGE's orchestration (state gating + prop wiring) rather than each
 * panel's internals, which own their own suites.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { ReactNode } from 'react';

// jsdom lacks matchMedia; framer-motion (reached via <FadeIn>) reads it at
// module load. Install before any import evaluates.
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

// Hoisted test doubles shared between the mock factories and the specs.
const { mockRequest, navigateSpy, aiCapture, reviewCaptures } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  navigateSpy: vi.fn(),
  aiCapture: { props: null as Record<string, unknown> | null },
  reviewCaptures: {} as Record<string, Record<string, unknown>>,
}));

// Only `request` is replaced; the real `isApiError` / `ApiError` exports stay so
// <QueryError> classifies the injected ApiError(500) into its "Server error" branch.
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: mockRequest };
});

// Replace only useNavigate so the specs can assert year navigation + close,
// while useParams / useSearchParams / MemoryRouter stay real (they drive the
// query key + the vehicle auto-select effect under test).
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateSpy };
});

// i18n → return the developer fallback, interpolating {{vars}} so assertions
// read real sentences. Handles all three call shapes the page uses:
//   t(key, 'Default')                         → 'Default'
//   t(key, 'Default {{x}}', { x })            → interpolated
//   t(key, { x, defaultValue: '{{x}} ...' })  → defaultValue interpolated
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, second?: unknown, third?: unknown) => {
        const opts = (
          third && typeof third === 'object'
            ? third
            : second && typeof second === 'object'
              ? second
              : undefined
        ) as Record<string, unknown> | undefined;
        let template: string;
        if (typeof second === 'string') template = second;
        else if (opts && typeof opts.defaultValue === 'string') template = opts.defaultValue;
        else template = key;
        if (!opts) return template;
        return template.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in opts ? String(opts[name]) : `{{${name}}}`,
        );
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// Stub the nine review sub-panels. Each echoes the props the page hands it so
// the specs can assert both "the section resolved to content" (testid present)
// and "the page wired the right data" (captured props / data attributes).
vi.mock('../components/review', () => {
  const stub = (testid: string) => (props: Record<string, unknown>) => {
    reviewCaptures[testid] = props;
    return <div data-testid={testid} />;
  };
  return {
    YearMonthlyChart: stub('year-monthly-chart'),
    YearChargingBreakdown: stub('year-charging-breakdown'),
    YearSavingsPanel: stub('year-savings-panel'),
    YearEnvironmentPanel: stub('year-environment-panel'),
    YearPatternsPanel: stub('year-patterns-panel'),
    YearExtremes: stub('year-extremes'),
    YearSummaryCard: stub('year-summary-card'),
    YearComparisons: (props: Record<string, unknown>) => {
      reviewCaptures['year-comparisons'] = props;
      const items = (props.comparisons as unknown[] | undefined) ?? [];
      return <div data-testid="year-comparisons" data-count={items.length} />;
    },
    // Rendered four times — capture the wiring per instance via data attrs.
    YearDriveHighlight: (props: Record<string, unknown>) => {
      const drive = props.drive as { drive_id?: number } | null;
      return (
        <div
          data-testid="year-drive-highlight"
          data-label={String(props.label ?? '')}
          data-drive={drive ? String(drive.drive_id) : 'none'}
        />
      );
    },
  };
});

// Capture the props the page hands the AI narration section (its own AI-off
// contract suite covers the component itself).
vi.mock('@/components/ai/AIYearReviewNarration', () => ({
  AIYearReviewNarration: (props: Record<string, unknown>) => {
    aiCapture.props = props;
    return <div data-testid="ai-year-narration" />;
  },
}));

import YearReviewPage from './YearReviewPage';
import { ApiError } from '@/lib/resilience';
import type { YearReview } from '@/api/types';

const CURRENT_YEAR = new Date().getFullYear();

const TWO_VEHICLES = [
  { id: 10, vehicle_id: 10, vin: 'VIN00010', display_name: 'Model 3', state: 'online' },
  { id: 20, vehicle_id: 20, vin: 'VIN00020', display_name: 'Model Y', state: 'asleep' },
];
const ONE_VEHICLE = [TWO_VEHICLES[0]];

function highlight(driveId: number, distanceKm: number, efficiency: number): YearReview['longest_drive'] {
  return {
    drive_id: driveId,
    date: '2023-06-01',
    distance_km: distanceKm,
    duration_min: 240,
    start_address: 'Start',
    end_address: 'End',
    efficiency_wh_km: efficiency,
  };
}

// Values chosen so the format output is stable regardless of global precision:
// fmtInt → integer counts, formatCurrency(_, 0) → whole dollars.
const YEAR_REVIEW: YearReview = {
  year: 2023,
  vehicle: { id: 10, display_name: 'Model 3', model: 'Model S' },
  total_drives: 128,
  total_distance_km: 12000,
  total_energy_kwh: 3400,
  total_charge_sessions: 42,
  total_driving_minutes: 4200,
  total_charging_cost: 512,
  gas_savings: 1875,
  co2_offset_kg: 640,
  longest_drive: highlight(501, 320, 150),
  shortest_drive: highlight(502, 2, 180),
  most_efficient_drive: highlight(503, 80, 120),
  least_efficient_drive: highlight(504, 40, 260),
  fastest_speed_kmh: 180,
  coldest_drive_temp_c: -8,
  hottest_drive_temp_c: 39,
  monthly_stats: [
    { month: 1, drives: 10, distance_km: 800, energy_kwh: 120, cost: 30 },
    { month: 2, drives: 14, distance_km: 1100, energy_kwh: 160, cost: 41 },
  ],
  most_active_day_of_week: 'Saturday',
  most_active_hour: 17,
  avg_drives_per_week: 3,
  avg_distance_per_drive_km: 94,
  avg_efficiency_wh_km: 168,
  supercharger_pct: 55,
  dc_fast_pct: 15,
  ac_other_pct: 30,
  avg_charge_start_soc: 32,
  comparisons: [
    { label: 'Trees planted', value: '12', emoji: '🌳' },
    { label: 'Phone charges', value: '9000', emoji: '🔋' },
  ],
};

const NO_ACTIVITY_REVIEW: YearReview = {
  ...YEAR_REVIEW,
  total_drives: 0,
  total_charge_sessions: 0,
  longest_drive: null,
  shortest_drive: null,
  most_efficient_drive: null,
  least_efficient_drive: null,
  monthly_stats: [],
  comparisons: [],
};

type LoadMode = 'resolve' | 'pending' | 'reject';

interface InstallOpts {
  vehicles?: unknown[];
  vehiclesMode?: LoadMode;
  review?: YearReview;
  reviewMode?: LoadMode;
  reviewError?: unknown;
}

function installRequest({
  vehicles = TWO_VEHICLES,
  vehiclesMode = 'resolve',
  review = YEAR_REVIEW,
  reviewMode = 'resolve',
  reviewError,
}: InstallOpts = {}) {
  mockRequest.mockImplementation((url: unknown) => {
    const u = String(url);
    if (u.includes('/analytics/year-review')) {
      if (reviewMode === 'pending') return new Promise(() => {});
      if (reviewMode === 'reject') return Promise.reject(reviewError ?? new Error('boom'));
      return Promise.resolve(review);
    }
    if (u.includes('/vehicles')) {
      if (vehiclesMode === 'pending') return new Promise(() => {});
      return Promise.resolve(vehicles);
    }
    return Promise.resolve({});
  });
}

function yearReviewCalls(): string[] {
  return mockRequest.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes('/analytics/year-review'));
}

function renderPage(path = '/year-review/2023?vehicle_id=10') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/year-review" element={<YearReviewPage />} />
          <Route path="/year-review/:year" element={<YearReviewPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockRequest.mockReset();
  navigateSpy.mockReset();
  aiCapture.props = null;
  for (const k of Object.keys(reviewCaptures)) delete reviewCaptures[k];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('YearReviewPage — happy path', () => {
  it('renders the page shell, all six section regions, the KPI band and every review panel', async () => {
    installRequest();
    renderPage();

    // A resolved child panel proves the feed resolved + the gate reached content.
    await screen.findByTestId('year-monthly-chart');

    expect(
      screen.getByRole('heading', { level: 1, name: '2023 Year in Review' }),
    ).toBeInTheDocument();

    for (const name of [
      'Year highlights',
      'Activity',
      'Impact',
      'Drives of the year',
      'Fun facts about your year',
      'Recap',
    ]) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }

    for (const label of ['Distance', 'Drives', 'Energy', 'Charges', 'You saved']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }

    // Every review sub-panel is mounted (not gated away).
    for (const testid of [
      'year-charging-breakdown',
      'year-savings-panel',
      'year-environment-panel',
      'year-patterns-panel',
      'year-extremes',
      'year-comparisons',
      'year-summary-card',
      'ai-year-narration',
    ]) {
      expect(screen.getByTestId(testid)).toBeInTheDocument();
    }
  });

  it('derives the KPI tiles from the SI feed (counts, savings, CO₂ offset)', async () => {
    installRequest();
    renderPage();

    await screen.findByTestId('year-monthly-chart');

    // fmtInt integer counts — stable regardless of precision.
    expect(screen.getByText('128')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    // formatCurrency(gas_savings, 0) → whole-dollar string with the `$` symbol.
    expect(screen.getByText('$1,875')).toBeInTheDocument();
    // co2_offset_kg rendered with the `kg` unit suffix on its own tile.
    expect(screen.getByText(/^640(\.\d+)? kg$/)).toBeInTheDocument();
  });

  it('wires the correct drive + comparison props into each sub-panel', async () => {
    installRequest();
    renderPage();

    const highlights = await screen.findAllByTestId('year-drive-highlight');
    expect(highlights).toHaveLength(4);

    const byLabel = Object.fromEntries(
      highlights.map((el) => [el.getAttribute('data-label'), el.getAttribute('data-drive')]),
    );
    expect(byLabel['Longest drive']).toBe('501');
    expect(byLabel['Most efficient drive']).toBe('503');
    expect(byLabel['Shortest drive']).toBe('502');
    expect(byLabel['Least efficient drive']).toBe('504');

    // Fun-facts panel receives the full comparisons array; monthly chart the feed.
    expect(screen.getByTestId('year-comparisons')).toHaveAttribute('data-count', '2');
    expect((reviewCaptures['year-monthly-chart'].data as YearReview).total_drives).toBe(128);
  });

  it('queries year-review for the URL vehicle with snake_case params and no /api/v1 prefix', async () => {
    installRequest();
    renderPage();

    await screen.findByTestId('year-monthly-chart');

    const calls = yearReviewCalls();
    expect(calls.some((u) => /vehicle_id=10\b/.test(u) && /year=2023\b/.test(u))).toBe(true);
    expect(calls.every((u) => !u.includes('/api/v1'))).toBe(true);
    expect(calls.every((u) => !/vehicleId=/.test(u))).toBe(true);
  });

  it('renders the vehicle subtitle and hands the numeric vehicle id to the AI narration', async () => {
    installRequest();
    renderPage();

    await screen.findByTestId('year-monthly-chart');

    expect(screen.getByText('Model 3 · Model S')).toBeInTheDocument();
    expect(aiCapture.props).toMatchObject({ vehicleId: 10 });
  });
});

describe('YearReviewPage — loading / error / empty branches', () => {
  it('shows skeletons (never a blank panel) while the review feed is in flight', async () => {
    installRequest({ reviewMode: 'pending' });
    const { container } = renderPage();

    await waitFor(() =>
      expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0),
    );
    // Sections stay mounted (only their bodies are skeletons)…
    expect(screen.getByRole('region', { name: 'Activity' })).toBeInTheDocument();
    // …but no resolved content and no misleading "pick a vehicle" prompt leak.
    expect(screen.queryByTestId('year-monthly-chart')).toBeNull();
    expect(screen.queryByText(/Select a vehicle to view/)).toBeNull();
  });

  it('renders per-section QueryError with a working Retry that refetches the feed', async () => {
    installRequest({ reviewMode: 'reject', reviewError: new ApiError('kaboom', 500) });
    renderPage();

    await waitFor(() => expect(screen.getAllByText('Server error').length).toBeGreaterThan(0));
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries.length).toBeGreaterThan(0);

    const before = yearReviewCalls().length;
    fireEvent.click(retries[0]);
    await waitFor(() => expect(yearReviewCalls().length).toBeGreaterThan(before));
  });

  it('shows the "select a vehicle" empty prompt for a resolved-but-empty fleet and never fires the feed', async () => {
    installRequest({ vehicles: [] });
    renderPage('/year-review/2023');

    await waitFor(() =>
      expect(screen.getAllByText(/Select a vehicle to view/).length).toBeGreaterThan(0),
    );
    // No vehicle → the review query is disabled and must not run.
    expect(yearReviewCalls().length).toBe(0);
    expect(screen.queryByTestId('year-monthly-chart')).toBeNull();
  });

  it('shows a skeleton — NOT the empty prompt — while the vehicle list is still loading', async () => {
    // Regression guard for the gate fix: before the fix, a disabled query with
    // a still-loading fleet fell through to the "pick a vehicle" EmptyState,
    // which is misleading because the page is about to auto-select.
    installRequest({ vehiclesMode: 'pending' });
    const { container } = renderPage('/year-review/2023');

    await waitFor(() =>
      expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0),
    );
    expect(screen.queryByText(/Select a vehicle to view/)).toBeNull();
    expect(yearReviewCalls().length).toBe(0);
  });
});

describe('YearReviewPage — zero-activity banner', () => {
  it('surfaces the info banner when the year recorded no drives or charges', async () => {
    installRequest({ review: NO_ACTIVITY_REVIEW });
    renderPage();

    expect(
      await screen.findByText(/No drives or charges were recorded for 2023/),
    ).toBeInTheDocument();
    // The KPI band still renders (zeroed), rather than blanking the page.
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });

  it('hides the banner for a normal active year', async () => {
    installRequest();
    renderPage();

    await screen.findByTestId('year-monthly-chart');
    expect(screen.queryByText(/No drives or charges were recorded/)).toBeNull();
  });
});

describe('YearReviewPage — year navigation & a11y', () => {
  it('exposes labelled prev/next/close controls and navigates to the previous year keeping the vehicle', async () => {
    installRequest();
    renderPage('/year-review/2023?vehicle_id=10');

    await screen.findByTestId('year-monthly-chart');

    expect(screen.getByRole('button', { name: 'Previous year' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next year' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.getByText('2023')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Previous year' }));
    expect(navigateSpy).toHaveBeenCalledWith('/year-review/2022?vehicle_id=10');
  });

  it('navigates forward when the viewed year is before the current year', async () => {
    installRequest();
    renderPage(`/year-review/${CURRENT_YEAR - 1}?vehicle_id=10`);

    await screen.findByTestId('year-monthly-chart');

    const next = screen.getByRole('button', { name: 'Next year' });
    expect(next).not.toBeDisabled();
    fireEvent.click(next);
    expect(navigateSpy).toHaveBeenCalledWith(`/year-review/${CURRENT_YEAR}?vehicle_id=10`);
  });

  it('disables the next-year control at the current year', async () => {
    installRequest();
    renderPage(`/year-review/${CURRENT_YEAR}?vehicle_id=10`);

    await screen.findByTestId('year-monthly-chart');
    expect(screen.getByRole('button', { name: 'Next year' })).toBeDisabled();
  });

  it('navigates back in history when the close control is pressed', async () => {
    installRequest();
    renderPage();

    await screen.findByTestId('year-monthly-chart');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(navigateSpy).toHaveBeenCalledWith(-1);
  });
});

describe('YearReviewPage — vehicle selection & URL auto-select', () => {
  it('renders a labelled select for multi-vehicle accounts and refetches + rewires AI on switch', async () => {
    installRequest();
    renderPage('/year-review/2023?vehicle_id=10');

    await screen.findByTestId('year-monthly-chart');

    const select = screen.getByRole('combobox', { name: 'Select vehicle' });
    fireEvent.change(select, { target: { value: '20' } });

    await waitFor(() =>
      expect(yearReviewCalls().some((u) => /vehicle_id=20\b/.test(u))).toBe(true),
    );
    await waitFor(() => expect(aiCapture.props).toMatchObject({ vehicleId: 20 }));
  });

  it('auto-selects the first vehicle when the URL omits vehicle_id and then fires the feed for it', async () => {
    installRequest();
    renderPage('/year-review/2023');

    await waitFor(() =>
      expect(yearReviewCalls().some((u) => /vehicle_id=10\b/.test(u))).toBe(true),
    );
  });

  it('hides the vehicle select for a single-vehicle account', async () => {
    installRequest({ vehicles: ONE_VEHICLE });
    renderPage('/year-review/2023?vehicle_id=10');

    await screen.findByTestId('year-monthly-chart');
    expect(screen.queryByRole('combobox', { name: 'Select vehicle' })).toBeNull();
  });
});
