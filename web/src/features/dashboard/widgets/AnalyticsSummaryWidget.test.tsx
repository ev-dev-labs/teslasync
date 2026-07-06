/**
 * AnalyticsSummaryWidget — behaviour, conversion, branch + hardening coverage.
 *
 * The widget is the dashboard's fleet-rollup tile. Its surface under test:
 *
 *   1. Responsive layout branches keyed off `size.cols`:
 *        - compact (cols ≤ 1) → a single animated distance headline,
 *        - standard (2–3 cols) → a 4-up KPI stat grid,
 *        - wide (cols ≥ 4) → the stat grid + a labelled trend-sparkline row.
 *   2. The SI-boundary conversions it owns: analytics emits kilometres +
 *      Wh/km; the widget converts distance to the user's unit (real
 *      `convertDistanceFromSI`) and scales Wh/km → Wh/mi on the mi branch.
 *   3. Loading / error / empty branches (never a blank panel).
 *   4. Currency formatting for cost-per-distance, and the em-dash fallback
 *      when there is no positive cost.
 *   5. Freshness-control refresh → refetch.
 *   6. Null-safety of a partial payload.
 *   7. The defensive `toNumberArray` guard: a malformed trend payload (a
 *      scalar where an array is expected) must not crash the sparkline row —
 *      before the fix a mixed payload threw inside <Sparkline>.
 *
 * Strategy (mirrors web/src/features/dashboard/pages/QuickStatsPage.test.tsx):
 *   - The data hook + useUnits / useFormatting are mocked with hoisted
 *     vi.fn()s so the network is never touched and every render is
 *     deterministic. The widget keeps the REAL number formatter + REAL
 *     convertDistanceFromSI, so conversions are genuinely exercised.
 *   - react-i18next resolves the developer fallback string (interpolating
 *     `{{vars}}`), so assertions read the English defaults.
 *   - matchMedia is shimmed to report `prefers-reduced-motion: reduce`, which
 *     lands <AnimatedNumber> on its final value synchronously (no RAF tween).
 *   - Renders are wrapped in <MemoryRouter> because the error branch mounts
 *     <QueryError>, which calls `useNavigate`.
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
// freshness chip) + <AnimatedNumber> read it at module load. Report reduced
// motion so the animated headline settles on its final value immediately.
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

const { analyticsMock, useUnitsMock, useFormattingMock } = vi.hoisted(() => ({
  analyticsMock: vi.fn(),
  useUnitsMock: vi.fn(),
  useFormattingMock: vi.fn(),
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

vi.mock('@/api/hooks/useAnalytics', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useAnalytics')>(
    '@/api/hooks/useAnalytics',
  );
  return { ...actual, useAnalyticsSummary: (...args: unknown[]) => analyticsMock(...args) };
});

vi.mock('@/hooks/useUnits', () => ({ useUnits: () => useUnitsMock() }));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => useFormattingMock() }));

import AnalyticsSummaryWidget from './AnalyticsSummaryWidget';
import type { WidgetSize } from './types';
import type { AnalyticsSummary } from '@/types/analytics';

/* ── Fixtures ─────────────────────────────────────────────────────── */

// Deliberately round numbers so the conversion + formatting maths is exact:
//   1000 km → identity km / 621 mi.  150 Wh/km → 241 Wh/mi.
//   cost 250 / 1000 km = 0.250 per km.
const SUMMARY: AnalyticsSummary = {
  totalVehicles: 3,
  totalDrives: 100,
  totalChargingSessions: 40,
  totalDistanceKm: 1000,
  totalEnergyKwh: 200,
  totalCost: 250,
  avgEfficiencyWhKm: 150,
  co2SavedKg: 90,
  vehicleComparison: [],
};

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

function setUnits(distance: 'km' | 'mi') {
  useUnitsMock.mockReturnValue({ unitPrefs: { distance } });
}

function renderWidget(size: WidgetSize = { cols: 2, rows: 2 }) {
  return render(
    <MemoryRouter>
      <AnalyticsSummaryWidget size={size} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  analyticsMock.mockReset();
  useUnitsMock.mockReset();
  useFormattingMock.mockReset();

  analyticsMock.mockReturnValue(makeQuery({ data: SUMMARY }));
  setUnits('km');
  useFormattingMock.mockReturnValue({
    formatCurrency: (amount: number, decimals?: number) =>
      `$${Number(amount ?? 0).toFixed(decimals ?? 2)}`,
  });
});

/* ── Specs ────────────────────────────────────────────────────────── */

describe('AnalyticsSummaryWidget', () => {
  it('renders the four KPI cards with km-unit conversions + currency formatting', () => {
    renderWidget();

    // Titled shell — no gutted panel.
    expect(screen.getByText('Analytics Summary')).toBeInTheDocument();

    // Every stat label is present (each is unique).
    for (const label of ['Total Distance', 'Avg Efficiency', 'Energy Consumed', 'Cost / km']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    // Distance 1000 km → identity → "1,000"; efficiency 150 Wh/km identity.
    expect(screen.getByText('1,000')).toBeInTheDocument();
    expect(screen.getByText('150')).toBeInTheDocument();
    expect(screen.getByText('Wh/km')).toBeInTheDocument();
    // Energy formats to one decimal; unit label present.
    expect(screen.getByText('200.0')).toBeInTheDocument();
    expect(screen.getByText('kWh')).toBeInTheDocument();
    // Cost per km: 250 / 1000 = 0.250 → formatCurrency(0.25, 3).
    expect(screen.getByText('$0.250')).toBeInTheDocument();
  });

  it('applies the mi branch: real km→mi distance + Wh/km→Wh/mi efficiency', () => {
    setUnits('mi');
    renderWidget();

    // 1000 km * 1000 / 1609.344 ≈ 621.4 → fmtNumber(_, 0) → "621".
    expect(screen.getByText('621')).toBeInTheDocument();
    expect(screen.getByText('mi')).toBeInTheDocument();
    // 150 Wh/km * 1.60934 = 241.4 → "241" Wh/mi.
    expect(screen.getByText('241')).toBeInTheDocument();
    expect(screen.getByText('Wh/mi')).toBeInTheDocument();
    expect(screen.getByText('Cost / mi')).toBeInTheDocument();
    // Cost per mi: 250 / 621.37 ≈ 0.402 → "$0.402".
    expect(screen.getByText('$0.402')).toBeInTheDocument();

    // The km-identity strings must be gone once converted.
    expect(screen.queryByText('1,000')).not.toBeInTheDocument();
    expect(screen.queryByText('Wh/km')).not.toBeInTheDocument();
  });

  it('renders an em dash for cost when there is no positive spend', () => {
    analyticsMock.mockReturnValue(
      makeQuery({ data: { ...SUMMARY, totalCost: 0 } }),
    );
    renderWidget();

    // costPerDist collapses to 0 → the "—" placeholder, never "$0.000".
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('$0.000')).not.toBeInTheDocument();
    // The other cards still render their values.
    expect(screen.getByText('1,000')).toBeInTheDocument();
  });

  it('compact layout shows the animated distance headline + caption only', () => {
    renderWidget({ cols: 1, rows: 2 });

    // Single headline (value + unit in one node), reduced-motion settled.
    expect(screen.getByText(/^1,000\s*km$/)).toBeInTheDocument();
    expect(screen.getByText('Total Distance')).toBeInTheDocument();

    // Compact never renders the stat grid or the titled header.
    expect(screen.queryByText('Avg Efficiency')).not.toBeInTheDocument();
    expect(screen.queryByText('Analytics Summary')).not.toBeInTheDocument();
  });

  it('compact layout shows the empty state when there is no data', () => {
    analyticsMock.mockReturnValue(makeQuery({ data: undefined }));
    renderWidget({ cols: 1, rows: 2 });

    expect(screen.getByText('No analytics data')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText(/km$/)).not.toBeInTheDocument();
  });

  it('renders a skeleton placeholder while the summary query is loading', () => {
    analyticsMock.mockReturnValue(makeQuery({ isLoading: true, dataUpdatedAt: 0 }));
    const { container } = renderWidget();

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    // No KPI content while loading.
    expect(screen.queryByText('Total Distance')).not.toBeInTheDocument();
  });

  it('surfaces an error panel (and hides the KPI grid) when the query fails', () => {
    analyticsMock.mockReturnValue(
      makeQuery({ error: new Error('boom'), isError: true, dataUpdatedAt: 0 }),
    );
    renderWidget();

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Total Distance')).not.toBeInTheDocument();
    // The freshness/refresh control lives in the header, which the error
    // branch replaces entirely.
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
  });

  it('shows the no-data empty state (standard) while keeping the titled shell', () => {
    analyticsMock.mockReturnValue(makeQuery({ data: undefined }));
    renderWidget();

    expect(screen.getByText('Analytics Summary')).toBeInTheDocument();
    expect(screen.getByText('No analytics data')).toBeInTheDocument();
    expect(screen.queryByText('Total Distance')).not.toBeInTheDocument();
  });

  it('is null-safe: a partial payload renders zeros and an em dash for cost', () => {
    // Backend contract says every field is present, but the widget must not
    // assume it — a `{ totalDistanceKm }`-only payload must degrade cleanly.
    analyticsMock.mockReturnValue(
      makeQuery({ data: { totalDistanceKm: 500 } as AnalyticsSummary }),
    );
    expect(() => renderWidget()).not.toThrow();

    expect(screen.getByText('500')).toBeInTheDocument();
    // avgEfficiencyWhKm missing → 0; totalEnergyKwh missing → "0.0".
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('0.0')).toBeInTheDocument();
    // totalCost missing → costPerDist 0 → "—".
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('refreshes the summary when the freshness control is activated', () => {
    const q = makeQuery({ data: SUMMARY });
    analyticsMock.mockReturnValue(q);
    renderWidget();

    const refresh = screen.getByRole('button', { name: 'Refresh' });
    expect(q.refetch).not.toHaveBeenCalled();
    fireEvent.click(refresh);
    expect(q.refetch).toHaveBeenCalledTimes(1);
  });

  it('renders four labelled trend sparklines in the wide layout', () => {
    analyticsMock.mockReturnValue(
      makeQuery({
        data: {
          ...SUMMARY,
          distanceTrend: [1, 2, 3],
          efficiencyTrend: [3, 2, 1],
          energyTrend: [1, 1, 2],
          costTrend: [2, 2, 2],
        },
      }),
    );
    renderWidget({ cols: 4, rows: 2 });

    // The stat grid still renders alongside the trends.
    expect(screen.getByText('1,000')).toBeInTheDocument();

    // Each sparkline is an accessible image labelled from its metric.
    const trends = screen.getAllByRole('img', { name: /trend$/ });
    expect(trends).toHaveLength(4);
    expect(screen.getByRole('img', { name: 'Total Distance trend' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Cost / km trend' })).toBeInTheDocument();
  });

  it('omits the sparkline row when the wide layout has no trend data', () => {
    analyticsMock.mockReturnValue(makeQuery({ data: SUMMARY }));
    renderWidget({ cols: 4, rows: 2 });

    // Grid renders, but there are no trend series to plot.
    expect(screen.getByText('1,000')).toBeInTheDocument();
    expect(screen.queryAllByRole('img', { name: /trend$/ })).toHaveLength(0);
  });

  it('guards against a malformed trend payload without crashing', () => {
    // Regression guard for the toNumberArray fix: a scalar where an array is
    // expected previously reached <Sparkline>.filter and threw. The valid
    // sibling series must still render.
    analyticsMock.mockReturnValue(
      makeQuery({
        data: {
          ...SUMMARY,
          distanceTrend: 42,
          efficiencyTrend: [1, 2, 3],
          energyTrend: [Number.NaN, Number.POSITIVE_INFINITY],
          costTrend: null,
        },
      }),
    );

    expect(() => renderWidget({ cols: 4, rows: 2 })).not.toThrow();
    // Only the one valid series survives coercion.
    const trends = screen.getAllByRole('img', { name: /trend$/ });
    expect(trends).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'Avg Efficiency trend' })).toBeInTheDocument();
    expect(screen.getByText('1,000')).toBeInTheDocument();
  });
});
