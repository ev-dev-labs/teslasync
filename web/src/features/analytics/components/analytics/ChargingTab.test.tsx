/**
 * ChargingTab — charging analytics tab contract + hardening tests.
 *
 * ChargingTab threads a single `useFleetAnalytics()` query object into a
 * self-sufficient KPI band (6 MetricCards) plus three chart panels (Charger
 * Types donut, Start Battery Distribution, Hourly Charging Pattern) and the
 * `<ChargingDetailSection>` deep-dive band. Each chart panel owns its own
 * loading / error / empty state through <AnalyticsPanel> so no panel gates the
 * others. Recharts inside `ResponsiveContainer` gets a 0×0 box in jsdom and
 * paints nothing, so — like the sibling CostByVehicleChart / AnalyticsPage
 * suites — these tests assert against the always-present panel shells, the KPI
 * band, and the four mutually-exclusive state branches rather than chart pixels.
 *
 * Facets covered:
 *   1. Loading — the KPI band and every chart panel render skeletons; no KPI
 *      labels, empty states, or errors leak through.
 *   2. Loaded — the top-level KPIs (sessions / energy / cost) and the stat KPIs
 *      (avg power / charge efficiency) render their formatted values inside the
 *      labelled summary region.
 *   3. Empty — data present but the three chart arrays are empty ⇒ each panel
 *      renders its own EmptyState (never a blank panel), and the KPI band still
 *      shows the real top-level totals.
 *   4. Error — a failed query surfaces a QueryError alert + working Retry in
 *      every chart panel, and the Retry is wired to `refetch`.
 *   5. Silent-zero hardening — on error (no data) the sessions / energy / cost
 *      KPIs render "—" (unknown), NOT a fabricated `0` / `0.0` / `$0.00`.
 *   6. a11y — the KPI band and the charts grid are both labelled `region`
 *      landmarks; panel icons are decorative (aria-hidden).
 *   7. Query threading — the same query object reaches <ChargingDetailSection>
 *      unchanged across loading / loaded / error.
 *   8. Null-safety — an absent `charging_analytics` block is treated as empty
 *      (arrays default to []) without crashing, and the stat KPIs fall back to
 *      "—".
 *
 * `react-i18next` is stubbed so `t(key, 'Default')` yields the English default;
 * `useSettings` is already stubbed globally in test-setup (currency '$',
 * precision 2). `useOnlineStatus` is pinned online so QueryError renders its
 * network `role="alert"` branch with an enabled Retry. `<ChargingDetailSection>`
 * is replaced with a prop-capturing stub so the assertions stay focused on
 * ChargingTab and the panel counts stay deterministic. Nothing touches the
 * network.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) =>
        typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

// Pin online so QueryError renders its network `role="alert"` branch with an
// enabled Retry (mirrors CostByVehicleChart / QueryError suites).
vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

// Prop-capturing stub for the charging deep-dive band: echoes the threaded
// query's state so ChargingTab's data-threading contract is observable without
// mounting four more recharts panels.
interface StubQuery {
  isLoading: boolean;
  isError: boolean;
  data?: { total_charging_sessions?: number } | null;
}
vi.mock('./ChargingDetailSection', () => ({
  ChargingDetailSection: ({ query }: { query: StubQuery }) => (
    <div data-testid="charging-detail">
      {query.isLoading
        ? 'detail:loading'
        : query.isError
          ? 'detail:error'
          : `detail:ready:${query.data?.total_charging_sessions ?? 0}`}
    </div>
  ),
}));

// jsdom lacks matchMedia; framer-motion (via <FadeIn>) reads it. Guarded
// polyfill keeps the render deterministic.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

import { ChargingTab } from './ChargingTab';
import type { FleetAnalytics, StatsSummary } from '@/api/types';
import type { FleetAnalyticsQuery } from './constants';

const SUMMARY_REGION = 'Charging summary metrics';
const CHARTS_REGION = 'Charging';
const PANEL_TITLES = [
  'Charger Types',
  'Start Battery Distribution',
  'Hourly Charging Pattern',
] as const;

function makeStats(overrides: Partial<StatsSummary> = {}): StatsSummary {
  return { min: 0, max: 0, avg: 0, median: 0, p95: 0, count: 0, ...overrides };
}

type ChargingAnalytics = FleetAnalytics['charging_analytics'];

function makeChargingAnalytics(
  overrides: Partial<ChargingAnalytics> = {},
): ChargingAnalytics {
  return {
    hourly_pattern: [{ hour: 2, charges: 5, energy: 30 }],
    charger_types: [
      { type: 'Supercharger', count: 40 },
      { type: 'Home', count: 88 },
    ],
    charger_brands: [],
    monthly_trend: [],
    power_stats: makeStats({ avg: 48.6 }),
    duration_stats: makeStats({ avg: 42 }),
    energy_stats: makeStats(),
    cost_stats: makeStats(),
    start_battery_dist: [{ range: '0-20%', count: 12 }],
    efficiency_stats: makeStats({ avg: 92.4 }),
    ...overrides,
  };
}

function makeFleet(overrides: Partial<FleetAnalytics> = {}): FleetAnalytics {
  return {
    total_charging_sessions: 128,
    total_energy_kwh: 543.2,
    total_cost: 87.5,
    charging_analytics: makeChargingAnalytics(),
    ...overrides,
  } as unknown as FleetAnalytics;
}

interface QueryOverrides {
  data?: FleetAnalytics;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  refetch?: () => void;
}

function makeQuery(o: QueryOverrides = {}): FleetAnalyticsQuery {
  return {
    data: o.data,
    isLoading: o.isLoading ?? false,
    isError: o.isError ?? false,
    error: o.error ?? null,
    refetch: o.refetch ?? vi.fn(),
  } as unknown as FleetAnalyticsQuery;
}

function renderTab(query: FleetAnalyticsQuery) {
  return render(
    <MemoryRouter>
      <ChargingTab query={query} />
    </MemoryRouter>,
  );
}

describe('ChargingTab — loading', () => {
  it('renders skeletons for the KPI band and every chart panel, with no KPI labels or state leakage', () => {
    const { container } = renderTab(makeQuery({ isLoading: true }));

    // Skeletons paint while the first payload loads.
    expect(container.querySelector('.animate-pulse')).not.toBeNull();

    // Panel shells (titles) are always present, even mid-load.
    for (const title of PANEL_TITLES) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }

    // The KPI band is a skeleton — no metric labels, and no empty/error UI.
    expect(screen.queryByText('Sessions')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('ChargingTab — loaded', () => {
  it('renders the formatted top-level and stat KPIs inside the labelled summary region', () => {
    renderTab(makeQuery({ data: makeFleet() }));

    const region = screen.getByRole('region', { name: SUMMARY_REGION });
    // Top-level totals (sessions / energy / cost via the '$' currency stub).
    expect(within(region).getByText('128')).toBeInTheDocument();
    expect(within(region).getByText('543.2')).toBeInTheDocument();
    expect(within(region).getByText('$87.50')).toBeInTheDocument();
    // Stat-derived KPIs (avg power / charge efficiency).
    expect(within(region).getByText('48.6')).toBeInTheDocument();
    expect(within(region).getByText('92.4')).toBeInTheDocument();

    // Loaded, non-empty ⇒ no skeletons, no empty states, no errors.
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('threads the resolved query down to <ChargingDetailSection> unchanged', () => {
    renderTab(makeQuery({ data: makeFleet({ total_charging_sessions: 128 }) }));

    expect(screen.getByTestId('charging-detail')).toHaveTextContent(
      'detail:ready:128',
    );
  });
});

describe('ChargingTab — empty', () => {
  it('renders an EmptyState per chart panel (never a blank panel) while the KPI band keeps its totals', () => {
    renderTab(
      makeQuery({
        data: makeFleet({
          charging_analytics: makeChargingAnalytics({
            charger_types: [],
            start_battery_dist: [],
            hourly_pattern: [],
          }),
        }),
      }),
    );

    // Each panel surfaces its own empty copy.
    expect(screen.getByText('No charger type data')).toBeInTheDocument();
    expect(
      screen.getByText('No battery distribution data'),
    ).toBeInTheDocument();
    expect(screen.getByText('No hourly data')).toBeInTheDocument();

    // Exactly three EmptyStates (role="status"); the detail band is stubbed.
    expect(screen.getAllByRole('status')).toHaveLength(3);
    expect(screen.queryByRole('alert')).toBeNull();

    // The KPI band still renders real totals — chart emptiness doesn't blank it.
    const region = screen.getByRole('region', { name: SUMMARY_REGION });
    expect(within(region).getByText('128')).toBeInTheDocument();
  });
});

describe('ChargingTab — error', () => {
  it('surfaces a QueryError alert with a working Retry in every chart panel', () => {
    const refetch = vi.fn();
    renderTab(
      makeQuery({
        isError: true,
        error: new Error('charging analytics down'),
        refetch,
      }),
    );

    // One alert per chart panel (three), all with the network copy.
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(3);
    expect(
      screen.getAllByText(/can't reach server/i).length,
    ).toBeGreaterThanOrEqual(1);

    // Retry is wired to the query's refetch.
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries).toHaveLength(3);
    fireEvent.click(retries[0]);
    expect(refetch).toHaveBeenCalledTimes(1);

    // The error also threads through to the detail band.
    expect(screen.getByTestId('charging-detail')).toHaveTextContent(
      'detail:error',
    );
  });

  it('renders "—" for the sessions / energy / cost KPIs instead of fabricated zeros (silent-zero guard)', () => {
    renderTab(
      makeQuery({ isError: true, error: new Error('boom') }),
    );

    // The band is still a labelled landmark — the page never blanks it.
    const region = screen.getByRole('region', { name: SUMMARY_REGION });

    // Regression guard: pre-hardening these rendered "0" / "0.0" / "$0.00",
    // which reads as "actually zero" rather than "unknown".
    expect(screen.queryByText('$0.00')).toBeNull();
    expect(screen.queryByText('0.0')).toBeNull();

    // Every KPI collapses to the unknown placeholder when there is no data.
    expect(within(region).getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });
});

describe('ChargingTab — a11y', () => {
  it('exposes both the KPI band and the charts grid as labelled region landmarks with decorative icons', () => {
    const { container } = renderTab(makeQuery({ data: makeFleet() }));

    expect(
      screen.getByRole('region', { name: SUMMARY_REGION }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: CHARTS_REGION }),
    ).toBeInTheDocument();

    // Panel title icons are wrapped as decorative (aria-hidden) spans.
    expect(
      container.querySelector('span[aria-hidden="true"]'),
    ).not.toBeNull();
  });
});

describe('ChargingTab — null-safety', () => {
  it('treats an absent charging_analytics block as empty without crashing', () => {
    renderTab(
      makeQuery({
        data: makeFleet({
          charging_analytics: undefined as unknown as ChargingAnalytics,
        }),
      }),
    );

    // Arrays default to [] ⇒ three empty chart panels, no crash.
    expect(screen.getAllByRole('status')).toHaveLength(3);
    expect(screen.getByText('No charger type data')).toBeInTheDocument();

    // Stat KPIs (power / duration / efficiency) fall back to "—" when the
    // stat objects are absent, while the top-level totals still render.
    const region = screen.getByRole('region', { name: SUMMARY_REGION });
    expect(within(region).getByText('128')).toBeInTheDocument();
    expect(within(region).getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });
});
