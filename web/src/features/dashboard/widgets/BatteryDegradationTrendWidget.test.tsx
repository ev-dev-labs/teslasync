/**
 * BatteryDegradationTrendWidget — behaviour, branch + hardening coverage.
 *
 * The widget is the dashboard's battery-state-of-health tile. Its surface
 * under test:
 *
 *   1. Responsive layout: standard/wide renders a titled shell + a SoH /
 *      Degradation / Cycles stat row + a health-trend area chart; compact
 *      (1×1) drops the title, icon and chart and shows the stat row only.
 *   2. The health-trend chart path: it plots the `avg_health` series, applies
 *      the shared dashed CartesianGrid, and draws the 80%-SoH reference line.
 *      (Regression guard for the `{...chartGrid}` → `{chartGrid}` fix — the
 *      grid previously received React-internal props instead of its styling.)
 *   3. The `current_health_pct ?? current_health` precedence, including the
 *      subtlety that a genuine `0` must win over the legacy field (nullish,
 *      not falsy, coalescing).
 *   4. The conditional Degradation stat (shown only when the rate is > 0).
 *   5. Loading / error / empty branches (never a blank panel). The error
 *      branch surfaces the shared QueryError panel — before the fix the widget
 *      only forwarded `isError` and a fetch failure masqueraded as "no data".
 *   6. Freshness-control refresh → refetch.
 *   7. Null-safety of a malformed / partial payload (no crash; em-dash
 *      placeholders; the chart still coerces bad points to 0).
 *   8. Vehicle selection: an explicit `vehicleId` wins, otherwise the first
 *      vehicle from `useVehicles` is used.
 *
 * Strategy (mirrors AnalyticsSummaryWidget.test.tsx + ElevationProfile.test.tsx):
 *   - The data hooks are mocked with hoisted vi.fn()s so the network is never
 *     touched. The widget keeps the REAL number formatter + REAL chart palette
 *     builder (only useTheme is stubbed so useThemeChartPalette resolves).
 *   - recharts primitives are replaced with DOM doubles that expose their key
 *     props via data-* attributes, so the chart path renders under jsdom and is
 *     genuinely assertable (ResponsiveContainer renders 0×0 otherwise).
 *   - react-i18next resolves the developer fallback string.
 *   - matchMedia is shimmed so framer-motion (via the freshness chip) settles.
 *   - Renders are wrapped in <MemoryRouter> because the error branch mounts
 *     <QueryError>, which calls useNavigate.
 *
 * user-event is intentionally NOT a dependency of this codebase (see
 * web/package.json) — interactions use fireEvent, consistent with the other
 * dashboard tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// jsdom lacks matchMedia; framer-motion (useReducedMotion, read by the
// freshness chip) reads it at module load. Report reduced motion so the
// freshness dot settles deterministically.
vi.hoisted(() => {
  if (typeof window !== 'undefined') {
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

const { degradationMock, vehiclesMock } = vi.hoisted(() => ({
  degradationMock: vi.fn(),
  vehiclesMock: vi.fn(),
}));

// i18n → return the developer fallback string, interpolating `{{vars}}`.
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

vi.mock('@/api/hooks/useEnergy', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useEnergy')>('@/api/hooks/useEnergy');
  return { ...actual, useBatteryDegradation: (...args: unknown[]) => degradationMock(...args) };
});

vi.mock('@/api/hooks/useVehicles', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useVehicles')>('@/api/hooks/useVehicles');
  return { ...actual, useVehicles: () => vehiclesMock() };
});

vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return { ...actual, ...chartTestDoubles };
});

// useThemeChartPalette() calls useTheme(), which throws outside a
// <ThemeProvider>. Stub useTheme with a fixed theme/mode so the REAL
// buildChartPalette runs and yields a genuine series palette. Mocking the
// provider (rather than wrapping it) also avoids its on-mount settings fetch.
vi.mock('@/components/ui/ThemeProvider', async () => {
  const actual = await vi.importActual<typeof import('@/components/ui/ThemeProvider')>(
    '@/components/ui/ThemeProvider',
  );
  return {
    ...actual,
    useTheme: () => ({
      themeId: 'neon-cyan',
      modeId: 'dark',
      theme: {
        id: 'neon-cyan',
        name: 'Neon Cyan',
        primary: '#00b4d8',
        primaryRGB: '0,180,216',
        accent: '#e63946',
        accentRGB: '230,57,70',
      },
      mode: { id: 'dark', name: 'Dark', colorScheme: 'dark' },
      setTheme: vi.fn(),
      setMode: vi.fn(),
      setCustomColors: vi.fn(),
      themes: {},
      modes: {},
    }),
  };
});

// Replace the recharts primitives the widget renders (via the @/components/charts
// barrel) with DOM doubles that expose their props. `...actual` keeps every
// other recharts export real, so the barrel and `chartGrid` (a <CartesianGrid/>
// element built at module load) resolve against the same doubles.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  const React = await vi.importActual<typeof import('react')>('react');
  type P = Record<string, unknown> & { children?: ReactNode };
  const ResponsiveContainer = (props: P) =>
    React.createElement('div', { 'data-testid': 'responsive-container' }, props.children as ReactNode);
  const AreaChart = (props: P) =>
    React.createElement(
      'div',
      {
        'data-testid': 'area-chart',
        'data-points': String(Array.isArray(props.data) ? props.data.length : 0),
      },
      React.createElement('svg', null, props.children as ReactNode),
    );
  const Area = (props: P) =>
    React.createElement('g', {
      'data-testid': 'area',
      'data-key': String(props.dataKey ?? ''),
      'data-name': String(props.name ?? ''),
      'data-stroke': String(props.stroke ?? ''),
    });
  const CartesianGrid = (props: P) =>
    React.createElement('g', {
      'data-testid': 'cartesian-grid',
      'data-dash': String(props.strokeDasharray ?? ''),
    });
  const ReferenceLine = (props: P) =>
    React.createElement('g', { 'data-testid': 'reference-line', 'data-y': String(props.y ?? '') });
  const XAxis = (props: P) =>
    React.createElement('g', { 'data-testid': 'x-axis', 'data-key': String(props.dataKey ?? '') });
  const YAxis = () => React.createElement('g', { 'data-testid': 'y-axis' });
  const Tooltip = () => React.createElement('g', { 'data-testid': 'tooltip' });
  return { ...actual, ResponsiveContainer, AreaChart, Area, CartesianGrid, ReferenceLine, XAxis, YAxis, Tooltip };
});

import BatteryDegradationTrendWidget from './BatteryDegradationTrendWidget';
import type { WidgetSize } from './types';
import type { DegradationData } from '@/types/energy';

/* ── Fixtures ─────────────────────────────────────────────────────── */

const TREND = [
  { month: 'Jan', avg_health: 99, avg_capacity: 74, avg_range: 400 },
  { month: 'Feb', avg_health: 97, avg_capacity: 73, avg_range: 392 },
  { month: 'Mar', avg_health: 95, avg_capacity: 72, avg_range: 385 },
];

// Legacy `current_health` deliberately differs from `current_health_pct` so the
// coalescing-precedence assertions are unambiguous.
const BASE: Record<string, unknown> = {
  current_health: 88,
  current_capacity: 72,
  current_cycles: 512,
  current_range: 385,
  current_temp: 20,
  stress_level: 'Low',
  fast_charge_ratio: 0.2,
  snapshots: [],
  monthly_trend: TREND,
  prediction: null,
  charging_habits: null,
  current_health_pct: 95.4,
  degradation_rate_pct_per_month: 0.42,
  projected_80pct_date: null,
  projections: [],
  risk_factors: [],
  recommendations: [],
};

function makeData(overrides: Record<string, unknown> = {}): DegradationData {
  return { ...BASE, ...overrides } as unknown as DegradationData;
}

interface FakeQuery {
  data?: unknown;
  error: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

function makeQuery(overrides: Partial<FakeQuery> = {}): FakeQuery {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderWidget(size: WidgetSize = { cols: 2, rows: 2 }, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <BatteryDegradationTrendWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  degradationMock.mockReset();
  vehiclesMock.mockReset();
  degradationMock.mockReturnValue(makeQuery({ data: makeData() }));
  vehiclesMock.mockReturnValue({ data: [{ id: 7 }] });
});

/* ── Specs ────────────────────────────────────────────────────────── */

describe('BatteryDegradationTrendWidget', () => {
  it('renders the titled shell with SoH, Degradation and Cycles stats', () => {
    renderWidget();

    // Titled shell — no gutted panel.
    expect(screen.getByText('Battery Degradation')).toBeInTheDocument();

    // SoH prefers current_health_pct (95.4), formatted to one decimal.
    expect(screen.getByText('SoH')).toBeInTheDocument();
    expect(screen.getByText('95.4%')).toBeInTheDocument();

    // Degradation stat is present with its "/mo" unit and rate value.
    expect(screen.getByText('Degradation')).toBeInTheDocument();
    expect(screen.getByText('/mo')).toBeInTheDocument();
    expect(screen.getByText(/0\.42%/)).toBeInTheDocument();

    // Cycles as a plain integer.
    expect(screen.getByText('Cycles')).toBeInTheDocument();
    expect(screen.getByText('512')).toBeInTheDocument();
  });

  it('plots the health series with the shared dashed grid and the 80% reference line', () => {
    renderWidget();

    // Three trend points reach the chart.
    const chart = screen.getByTestId('area-chart');
    expect(chart).toHaveAttribute('data-points', '3');

    // The area draws the `avg_health` series, labelled from i18n, with a
    // theme-derived stroke colour.
    const area = screen.getByTestId('area');
    expect(area).toHaveAttribute('data-key', 'health');
    expect(area).toHaveAttribute('data-name', 'Health %');
    expect(area.getAttribute('data-stroke')).toMatch(/^#[0-9a-f]{6}$/i);

    // Regression guard: `{chartGrid}` forwards the shared dashed styling. The
    // old `<CartesianGrid {...chartGrid} />` spread dropped it (data-dash '').
    expect(screen.getByTestId('cartesian-grid')).toHaveAttribute('data-dash', '3 3');

    // 80%-SoH end-of-life threshold marker.
    expect(screen.getByTestId('reference-line')).toHaveAttribute('data-y', '80');
    expect(screen.getByTestId('x-axis')).toHaveAttribute('data-key', 'month');

    // The chart path renders — not the "need more data" fallback.
    expect(screen.queryByText('More data needed for trend')).not.toBeInTheDocument();
  });

  it('shows the "more data needed" fallback when there is a single trend point', () => {
    degradationMock.mockReturnValue(
      makeQuery({ data: makeData({ monthly_trend: [TREND[0]] }) }),
    );
    renderWidget();

    expect(screen.getByText('More data needed for trend')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
    // Stats still render alongside the fallback.
    expect(screen.getByText('SoH')).toBeInTheDocument();
  });

  it('treats a genuine 0% SoH as real data (nullish, not falsy, coalescing)', () => {
    degradationMock.mockReturnValue(
      makeQuery({ data: makeData({ current_health_pct: 0, current_health: 88 }) }),
    );
    renderWidget();

    // 0 must win over the legacy 88 → "0.0%", never "88.0%".
    expect(screen.getByText('0.0%')).toBeInTheDocument();
    expect(screen.queryByText('88.0%')).not.toBeInTheDocument();
  });

  it('falls back to the legacy current_health when the pct field is absent', () => {
    degradationMock.mockReturnValue(
      makeQuery({ data: makeData({ current_health_pct: undefined, current_health: 88 }) }),
    );
    renderWidget();

    expect(screen.getByText('88.0%')).toBeInTheDocument();
  });

  it('hides the Degradation stat when the rate is not positive', () => {
    degradationMock.mockReturnValue(
      makeQuery({ data: makeData({ degradation_rate_pct_per_month: 0 }) }),
    );
    renderWidget();

    expect(screen.queryByText('Degradation')).not.toBeInTheDocument();
    expect(screen.queryByText('/mo')).not.toBeInTheDocument();
    // SoH + Cycles remain.
    expect(screen.getByText('SoH')).toBeInTheDocument();
    expect(screen.getByText('512')).toBeInTheDocument();
  });

  it('shows the empty state (keeping the titled shell) when there is no data', () => {
    degradationMock.mockReturnValue(makeQuery({ data: undefined }));
    renderWidget();

    expect(screen.getByText('Battery Degradation')).toBeInTheDocument();
    expect(screen.getByText('No degradation data')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    // Stats + chart are not rendered while empty.
    expect(screen.queryByText('SoH')).not.toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
  });

  it('renders a skeleton placeholder while the query is loading', () => {
    degradationMock.mockReturnValue(makeQuery({ isLoading: true, dataUpdatedAt: 0 }));
    const { container } = renderWidget();

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.queryByText('SoH')).not.toBeInTheDocument();
  });

  it('surfaces the error panel (not the empty state) when the query fails', () => {
    // Regression guard: the widget now forwards `error` so a fetch failure is
    // distinguishable from genuinely-empty data.
    degradationMock.mockReturnValue(
      makeQuery({ error: new Error('boom'), isError: true, dataUpdatedAt: 0 }),
    );
    renderWidget();

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // The misleading "no data" empty state must NOT appear on error.
    expect(screen.queryByText('No degradation data')).not.toBeInTheDocument();
    expect(screen.queryByText('SoH')).not.toBeInTheDocument();
    // The error branch replaces the header, so there is no refresh control.
    expect(screen.queryByRole('button', { name: /^Refresh/i })).not.toBeInTheDocument();
  });

  it('drops the title and chart in the compact 1×1 layout, keeping the stat row', () => {
    renderWidget({ cols: 1, rows: 1 });

    expect(screen.getByText('SoH')).toBeInTheDocument();
    expect(screen.getByText('512')).toBeInTheDocument();
    // Compact hides the title and the chart.
    expect(screen.queryByText('Battery Degradation')).not.toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
  });

  it('refetches when the freshness control is activated', () => {
    const q = makeQuery({ data: makeData() });
    degradationMock.mockReturnValue(q);
    renderWidget();

    const refresh = screen.getByRole('button', { name: /Refresh data/ });
    expect(q.refetch).not.toHaveBeenCalled();
    fireEvent.click(refresh);
    expect(q.refetch).toHaveBeenCalledTimes(1);
  });

  it('is null-safe: a malformed payload renders em-dash placeholders without crashing', () => {
    degradationMock.mockReturnValue(
      makeQuery({
        data: makeData({
          current_health_pct: undefined,
          current_health: undefined,
          current_cycles: null,
          degradation_rate_pct_per_month: null,
          monthly_trend: [
            { month: 'A' },
            { month: 'B', avg_health: null, avg_range: undefined },
          ],
        }),
      }),
    );

    expect(() => renderWidget()).not.toThrow();

    // SoH + Cycles both collapse to the em-dash placeholder.
    expect(screen.getAllByText('—')).toHaveLength(2);
    // Degradation is hidden (rate null).
    expect(screen.queryByText('Degradation')).not.toBeInTheDocument();
    // Two (coerced) points still reach the chart without throwing.
    expect(screen.getByTestId('area-chart')).toHaveAttribute('data-points', '2');
  });

  it('falls back to the first vehicle when no vehicleId prop is supplied', () => {
    renderWidget();
    expect(degradationMock).toHaveBeenCalledWith('7');
  });

  it('uses the explicit vehicleId prop over the vehicle list', () => {
    renderWidget({ cols: 2, rows: 2 }, 42);
    expect(degradationMock).toHaveBeenCalledWith('42');
  });
});
