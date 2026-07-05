/**
 * ChargingDetailSection — behaviour + branch coverage.
 *
 * The section renders four self-sufficient <AnalyticsPanel>s off a single
 * `useFleetAnalytics()` result that the parent threads down as `query`:
 *
 *   1. Charger Brands — a leaderboard whose bar widths are `count / maxCount`
 *      (the top brand is always 100%). Rank + locale-formatted session count.
 *   2. Cost by Charger Type — per-type share bars (`count / typeTotal`) plus a
 *      locale-formatted count and rounded percentage.
 *   3. Cost Analysis — four MetricCards (min / avg / median / max) run through
 *      `useFormatting().formatCurrency`.
 *   4. Monthly Charging Trend — a full-width ComposedChart.
 *
 * Every panel owns its own loading / error / empty branch, so no panel is ever
 * gated away — these tests assert that all four headings stay mounted through
 * loading, error, and empty, and that the retry wiring reaches `refetch`.
 *
 * Strategy: the component takes its data as a prop, so no network is touched —
 * we hand it hand-built `UseQueryResult` shapes. The global test-setup already
 * stubs `useSettings` (metric units, `$`, precision 2) which is all
 * `useFormatting` / `useUnits` need. Only `react-i18next` is mocked here, so
 * `t(key, fallback)` renders the English fallback deterministically. The tree
 * is wrapped in QueryClient + MemoryRouter because <QueryError> reaches for
 * `useNavigate`.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { FleetAnalytics } from '@/api/types';

// jsdom lacks matchMedia; install a benign stub before any module that might
// read it at import time evaluates (defensive — shared UI pulls it in).
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

// i18n → return the developer fallback string, interpolating {{vars}} so any
// error/empty copy reads as real English instead of a raw key.
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

import { ChargingDetailSection } from './ChargingDetailSection';
import type { FleetAnalyticsQuery } from './constants';
import { ApiError } from '@/lib/resilience';

const STATS = { min: 0, max: 0, avg: 0, median: 0, p95: 0, count: 0 };

// Brand counts are chosen so the leaderboard widths land on exact binary
// fractions (800 → 100%, 400 → 50%, 200 → 25%) — no float dust in the inline
// `width` style, so `toEqual` on the raw strings is safe.
const CA = {
  hourly_pattern: [],
  charger_types: [
    { type: 'Supercharger', count: 800 },
    { type: 'Level 2', count: 1234567 },
    { type: 'Level 1', count: 40 },
  ],
  charger_brands: [
    { brand: 'Tesla Supercharger', count: 800 },
    { brand: 'Electrify America', count: 400 },
    { brand: 'ChargePoint', count: 200 },
  ],
  monthly_trend: [
    { month: '2024-01', energy: 320, cost: 42, sessions: 12, avg_power: 48, gas_cost: 80, savings: 38 },
    { month: '2024-02', energy: 410, cost: 55, sessions: 18, avg_power: 51, gas_cost: 95, savings: 40 },
  ],
  power_stats: STATS,
  duration_stats: STATS,
  energy_stats: STATS,
  cost_stats: { min: 1.5, max: 88.25, avg: 12.4, median: 9.75, p95: 60, count: 100 },
  start_battery_dist: [],
  efficiency_stats: STATS,
};

// charging_analytics present, but every section is empty and cost_stats absent.
const EMPTY_CA = {
  hourly_pattern: [],
  charger_types: [],
  charger_brands: [],
  monthly_trend: [],
  power_stats: STATS,
  duration_stats: STATS,
  energy_stats: STATS,
  start_battery_dist: [],
  efficiency_stats: STATS,
};

const FULL = { charging_analytics: CA } as unknown as FleetAnalytics;
const EMPTY = { charging_analytics: EMPTY_CA } as unknown as FleetAnalytics;
// A brand/type row missing its label and count — exercises the `?? '—'` /
// `fmtInt(undefined)` null-safety without crashing.
const MALFORMED = {
  charging_analytics: {
    ...EMPTY_CA,
    charger_brands: [{ brand: undefined, count: undefined }],
    charger_types: [{ type: undefined, count: undefined }],
  },
} as unknown as FleetAnalytics;

interface QueryOverrides {
  data?: FleetAnalytics;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  refetch?: () => void;
}

function makeQuery(over: QueryOverrides = {}): FleetAnalyticsQuery {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...over,
  } as unknown as FleetAnalyticsQuery;
}

function renderSection(query: FleetAnalyticsQuery) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ChargingDetailSection query={query} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const PANEL_TITLES = [
  'Charger Brands',
  'Cost by Charger Type',
  'Cost Analysis',
  'Monthly Charging Trend',
];

describe('ChargingDetailSection — populated', () => {
  it('mounts all four panel headings as level-3 headings', () => {
    renderSection(makeQuery({ data: FULL }));
    for (const name of PANEL_TITLES) {
      expect(screen.getByRole('heading', { level: 3, name })).toBeInTheDocument();
    }
  });

  it('renders the brand leaderboard with rank, locale-formatted counts, and count-relative bar widths', () => {
    const { container } = renderSection(makeQuery({ data: FULL }));

    // Rank prefix + brand label (the top brand drives 100% width).
    expect(screen.getByText('#1 Tesla Supercharger')).toBeInTheDocument();
    expect(screen.getByText('#2 Electrify America')).toBeInTheDocument();
    expect(screen.getByText('#3 ChargePoint')).toBeInTheDocument();

    // Session counts run through fmtInt → grouped thousands.
    expect(screen.getByText('800 sessions')).toBeInTheDocument();
    expect(screen.getByText('400 sessions')).toBeInTheDocument();

    // Bar width = count / maxCount → 100% / 50% / 25%.
    const fills = Array.from(
      container.querySelectorAll<HTMLElement>('div.bg-neon-green'),
    ).map((el) => el.style.width);
    expect(fills).toEqual(['100%', '50%', '25%']);
  });

  it('renders charger-type share bars with grouped counts and rounded percentages', () => {
    renderSection(makeQuery({ data: FULL }));

    // The dominant type: fmtInt groups the count and rounds the share to 100%.
    expect(screen.getByText('1,234,567 (100%)')).toBeInTheDocument();
    // A negligible-share type rounds down to 0% but still lists its count.
    expect(screen.getByText('800 (0%)')).toBeInTheDocument();
    expect(screen.getByText('Level 2')).toBeInTheDocument();
  });

  it('formats the four cost MetricCards through formatCurrency (2dp, $)', () => {
    renderSection(makeQuery({ data: FULL }));

    expect(screen.getByText('Min Cost')).toBeInTheDocument();
    expect(screen.getByText('$1.50')).toBeInTheDocument();
    expect(screen.getByText('$12.40')).toBeInTheDocument();
    expect(screen.getByText('$9.75')).toBeInTheDocument();
    expect(screen.getByText('$88.25')).toBeInTheDocument();
  });

  it('mounts the monthly-trend chart body (not the empty placeholder) when trend rows exist', () => {
    renderSection(makeQuery({ data: FULL }));
    expect(
      screen.getByRole('heading', { level: 3, name: 'Monthly Charging Trend' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('No monthly data')).toBeNull();
  });
});

describe('ChargingDetailSection — loading', () => {
  it('shows skeleton bodies under every heading and leaks no data while loading', () => {
    const { container } = renderSection(makeQuery({ isLoading: true, data: FULL }));

    // Loading takes precedence — skeletons render, panel titles stay mounted.
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    for (const name of PANEL_TITLES) {
      expect(screen.getByRole('heading', { level: 3, name })).toBeInTheDocument();
    }
    // No populated content bleeds through the skeleton.
    expect(screen.queryByText('#1 Tesla Supercharger')).toBeNull();
    expect(screen.queryByText('$1.50')).toBeNull();
  });
});

describe('ChargingDetailSection — error + retry', () => {
  it('surfaces a retryable error in every panel and wires Retry to refetch', () => {
    const refetch = vi.fn();
    renderSection(
      makeQuery({ isError: true, error: new ApiError('charging feed exploded', 500), refetch }),
    );

    // Each of the four panels renders its own QueryError (never a blank panel).
    expect(screen.getAllByText('Server error')).toHaveLength(4);
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries).toHaveLength(4);

    fireEvent.click(retries[0]);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale error object when isError is false', () => {
    // err = isError ? error : undefined — a non-error query must not render QueryError.
    renderSection(makeQuery({ data: FULL, isError: false, error: new ApiError('stale', 500) }));
    expect(screen.queryByText('Server error')).toBeNull();
    expect(screen.getByText('#1 Tesla Supercharger')).toBeInTheDocument();
  });
});

describe('ChargingDetailSection — empty states', () => {
  it('renders every panel with its own empty copy when the query has no data', () => {
    renderSection(makeQuery({ data: undefined }));

    expect(screen.getByText('No charger brand data')).toBeInTheDocument();
    expect(screen.getByText('No charger type data')).toBeInTheDocument();
    expect(screen.getByText('No cost statistics')).toBeInTheDocument();
    expect(screen.getByText('No monthly data')).toBeInTheDocument();

    // Panels stay mounted — the empty state lives inside them.
    for (const name of PANEL_TITLES) {
      expect(screen.getByRole('heading', { level: 3, name })).toBeInTheDocument();
    }
  });

  it('shows per-section empty copy when charging_analytics is present but sections are empty', () => {
    renderSection(makeQuery({ data: EMPTY }));

    expect(screen.getByText('No charger brand data')).toBeInTheDocument();
    expect(screen.getByText('No cost statistics')).toBeInTheDocument();
    // No leaderboard rows rendered.
    expect(screen.queryByText('#1 Tesla Supercharger')).toBeNull();
  });
});

describe('ChargingDetailSection — null safety', () => {
  it('renders placeholder labels and zeroed counts without crashing on missing fields', () => {
    renderSection(makeQuery({ data: MALFORMED }));

    // Missing brand → em-dash label, undefined count → fmtInt(undefined) = "0".
    expect(screen.getByText('#1 —')).toBeInTheDocument();
    expect(screen.getByText('0 sessions')).toBeInTheDocument();
    // Missing charger type → em-dash label, count "0 (0%)".
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('0 (0%)')).toBeInTheDocument();
  });
});
