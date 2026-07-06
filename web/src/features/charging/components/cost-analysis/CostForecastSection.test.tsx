/**
 * CostForecastSection — behaviour, hardening + regression cover.
 *
 * <CostForecastSection forecastData … /> orchestrates three data-bound bands of
 * the Cost Analysis page:
 *   1. a <ComposedChart> that overlays historical actual monthly cost, the
 *      projected cost line, and a 95% confidence band drawn as a stacked
 *      floating <Area> (`ci_low` invisible base + `ci_band` visible height);
 *   2. the <ForecastDetails> breakdown/savings/insights trio (a child); and
 *   3. a <LineChart> cost-per-kWh trend fed straight from the historical rows.
 * Its own real work is *derivation + gating*, not pixels: it merges the two
 * month series onto one axis, computes the confidence-band height, and decides
 * per-section whether to show the chart or a localized empty state.
 *
 * Strategy (mirrors the sibling SessionComparisonChart / DetailedStatistics
 * tests): the presentation shells are stubbed to lightweight prop-echoing
 * markers so the derivations are asserted directly and deterministically —
 *   - <CostSection>     → a faithful gate: echoes title / loading / error /
 *                          empty / message and renders its chart children ONLY
 *                          when active (never a blank panel), plus a retry
 *                          control when an error is present.
 *   - <ForecastDetails> → echoes the query state + whether data reached it, so
 *                          the parent's delegation is verifiable.
 *   - <ComposedChart>/<LineChart> → echo their `data` array as JSON so the
 *                          merge + band math are inspectable (recharts'
 *                          <ResponsiveContainer> measures 0×0 under jsdom).
 *   - <Area>/<Line>/<YAxis> → echo dataKey / name / stroke / fill / unit.
 * `useChartPalette` is pinned to a fixed 3-colour array and `useFormatting` to a
 * non-`$` currency ('€') so the "actual" stroke and the axis-unit assertions are
 * exact — and prove the axis is no longer hardcoded to `$`. i18n resolves to the
 * English fallback so the empty-state copy is assertable. Nothing hits the
 * network — the component is pure and receives its data by prop.
 *
 * Covered facets:
 *   1. MERGE     — history + projection fold onto one month axis; actual-only
 *      rows carry `actual`, projection rows carry `forecast` + the band.
 *   2. BAND-CLAMP— an inverted CI (high < low) clamps to a zero-height band.
 *   3. BUGFIX    — a missing / non-finite CI bound drops the band entirely
 *      instead of injecting NaN into the stacked <Area>.
 *   4. SERIES    — each Area/Line is wired to the right dataKey/name/stroke/fill.
 *   5. CURRENCY  — both Y axes are labelled with the user currency, not "$".
 *   6. GATE-FC   — the forecast chart needs ≥3 historical months AND a
 *      projection; otherwise the localized "need data" empty state shows.
 *   7. GATE-TREND— the cost/kWh trend needs >1 historical month.
 *   8. STATES    — loading threads into every section; an error surfaces a retry
 *      control that invokes the onRetry callback.
 *   9. NULL-SAFE — undefined forecastData degrades to empty states, no throw.
 *  10. DELEGATE  — forecastData + query state are handed to <ForecastDetails>.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import type {
  CostForecastData,
  CostHistoricalMonth,
  CostForecastMonth,
} from '@/types/charging';

// Fixed palette so the "actual" series stroke assertion is exact.
const { PALETTE } = vi.hoisted(() => ({ PALETTE: ['#aa0000', '#00bb00', '#0000cc'] }));
// Deliberately NOT '$' so the Y-axis unit assertion proves the symbol comes
// from settings (useFormatting) rather than a hardcoded literal.
const CURRENCY = '€';

// English-fallback i18n with {{placeholder}} interpolation (repo convention).
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, arg2?: unknown, arg3?: unknown) => {
        let template = key;
        let options: Record<string, unknown> | undefined;
        if (typeof arg2 === 'string') {
          template = arg2;
          if (arg3 && typeof arg3 === 'object') options = arg3 as Record<string, unknown>;
        } else if (arg2 && typeof arg2 === 'object') {
          options = arg2 as Record<string, unknown>;
          if (typeof options.defaultValue === 'string') template = options.defaultValue;
        }
        if (options) {
          template = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) =>
            options && options[name] != null ? String(options[name]) : '',
          );
        }
        return template;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/hooks/useChartPalette', () => ({
  useChartPalette: () => PALETTE,
}));

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: CURRENCY }),
}));

// Shared chart primitives → prop-echoing stubs. The chart wrappers echo their
// `data` array as JSON so the merge + band derivations are inspectable.
vi.mock('@/components/charts', () => ({
  ChartTooltip: () => null,
  chartGrid: {},
  axisTickSm: {},
  AREA_DEFAULTS: {},
  areaGradient: () => null,
  ComposedChart: ({ data, children }: { data?: unknown[]; children?: ReactNode }) => (
    <div data-testid="composed-chart" data-json={JSON.stringify(data ?? [])}>
      {children}
    </div>
  ),
  LineChart: ({ data, children }: { data?: unknown[]; children?: ReactNode }) => (
    <div data-testid="line-chart" data-json={JSON.stringify(data ?? [])}>
      {children}
    </div>
  ),
  Area: ({ dataKey, name, stroke, fill }: Record<string, unknown>) => (
    <div
      data-testid="area"
      data-key={String(dataKey ?? '')}
      data-name={String(name ?? '')}
      data-stroke={String(stroke ?? '')}
      data-fill={String(fill ?? '')}
    />
  ),
  Line: ({ dataKey, name, stroke }: Record<string, unknown>) => (
    <div
      data-testid="line"
      data-key={String(dataKey ?? '')}
      data-name={String(name ?? '')}
      data-stroke={String(stroke ?? '')}
    />
  ),
  XAxis: () => null,
  YAxis: ({ unit }: { unit?: string }) => <div data-testid="yaxis" data-unit={unit ?? ''} />,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

// Faithful <CostSection> gate: renders its chart children ONLY when the section
// is active (not loading / errored / empty) — mirroring the real shell — and
// exposes a retry control while an error is present so the callback is testable.
vi.mock('./CostSection', () => ({
  CostSection: ({
    title,
    isLoading,
    error,
    onRetry,
    isEmpty,
    emptyMessage,
    skeletonHeight,
    children,
  }: {
    title: string;
    isLoading?: boolean;
    error?: unknown;
    onRetry?: () => void;
    isEmpty?: boolean;
    emptyMessage?: string;
    skeletonHeight?: number;
    children?: ReactNode;
  }) => {
    const active = !isLoading && error == null && !isEmpty;
    return (
      <section
        data-testid="cost-section"
        data-title={title}
        data-loading={String(!!isLoading)}
        data-errored={String(error != null)}
        data-empty={String(!!isEmpty)}
        data-empty-message={emptyMessage ?? ''}
        data-skeleton-height={String(skeletonHeight ?? '')}
      >
        {error != null && onRetry ? (
          <button type="button" aria-label={`retry ${title}`} onClick={() => onRetry()}>
            retry
          </button>
        ) : null}
        {active ? children : null}
      </section>
    );
  },
}));

// <ForecastDetails> echoes what the parent threads into it.
vi.mock('./ForecastDetails', () => ({
  ForecastDetails: ({
    forecastData,
    isLoading,
    error,
    onRetry,
  }: {
    forecastData?: unknown;
    isLoading?: boolean;
    error?: unknown;
    onRetry?: () => void;
  }) => (
    <div
      data-testid="forecast-details"
      data-has-data={String(forecastData != null)}
      data-loading={String(!!isLoading)}
      data-errored={String(error != null)}
      data-has-retry={String(typeof onRetry === 'function')}
    />
  ),
}));

import { CostForecastSection } from './CostForecastSection';

afterEach(() => cleanup());

/* ── fixtures ─────────────────────────────────────────────── */

function hist(month: string, cost: number, costPerKwh = 0.15): CostHistoricalMonth {
  return { month, cost, kwh: 100, sessions: 5, cost_per_kwh: costPerKwh };
}

function fc(
  month: string,
  cost: number,
  cost_low: number,
  cost_high: number,
): CostForecastMonth {
  return { month, cost, cost_low, cost_high, kwh: 100 };
}

function makeData(overrides: Partial<CostForecastData> = {}): CostForecastData {
  return {
    historical: [hist('2024-01', 100), hist('2024-02', 110), hist('2024-03', 120)],
    forecast: [fc('2024-04', 130, 110, 150), fc('2024-05', 140, 115, 170)],
    breakdown: {
      home: { pct: 70, avg_cost_per_kwh: 0.12, monthly_avg: 90 },
      supercharger: { pct: 30, avg_cost_per_kwh: 0.34, monthly_avg: 40 },
    },
    gas_comparison: {
      avg_km_per_month: 1500,
      gas_cost_per_month: 220,
      ev_cost_per_month: 60,
      monthly_savings: 160,
      annual_savings: 1920,
      lifetime_savings: 19200,
    },
    insights: ['Charge at home overnight to save more.'],
    ...overrides,
  };
}

type Row = Record<string, number>;

function composedRows(): Row[] {
  return JSON.parse(screen.getByTestId('composed-chart').getAttribute('data-json') ?? '[]');
}

function trendRows(): Row[] {
  return JSON.parse(screen.getByTestId('line-chart').getAttribute('data-json') ?? '[]');
}

function section(title: string): HTMLElement {
  const found = screen
    .getAllByTestId('cost-section')
    .find((s) => s.getAttribute('data-title') === title);
  if (!found) throw new Error(`no CostSection titled "${title}"`);
  return found;
}

/* ── 1. MERGE ─────────────────────────────────────────────── */

describe('CostForecastSection — forecast chart data merge', () => {
  it('folds historical actuals and projected months (with band) onto one month axis', () => {
    render(<CostForecastSection forecastData={makeData()} />);

    const rows = composedRows();
    // 3 historical + 2 forecast = 5 rows, ordered history-then-projection.
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.month)).toEqual([
      '2024-01', '2024-02', '2024-03', '2024-04', '2024-05',
    ]);

    // Historical rows carry ONLY `actual` — no forecast/band keys leak in.
    expect(rows[0]).toEqual({ month: '2024-01', actual: 100 });
    expect(rows[0]).not.toHaveProperty('forecast');
    expect(rows[0]).not.toHaveProperty('ci_band');

    // Projection rows carry the forecast + a stacked band: base `ci_low` and
    // height `ci_band = cost_high - cost_low` (150 - 110 = 40).
    expect(rows[3]).toEqual({ month: '2024-04', forecast: 130, ci_low: 110, ci_band: 40 });
    expect(rows[3]).not.toHaveProperty('actual');
    // 170 - 115 = 55.
    expect(rows[4].ci_band).toBe(55);
  });
});

/* ── 2. BAND-CLAMP ────────────────────────────────────────── */

describe('CostForecastSection — confidence band clamp', () => {
  it('clamps an inverted confidence interval (high < low) to a zero-height band', () => {
    const data = makeData({ forecast: [fc('2024-04', 130, 120, 100)] });
    render(<CostForecastSection forecastData={data} />);

    const projection = composedRows().find((r) => r.month === '2024-04')!;
    expect(projection.ci_low).toBe(120);
    // Math.max(0, 100 - 120) → 0, never a negative segment.
    expect(projection.ci_band).toBe(0);
  });
});

/* ── 3. BUGFIX: NaN-guarded band ──────────────────────────── */

describe('CostForecastSection — malformed CI bound (regression)', () => {
  it('drops the band instead of emitting NaN when a bound is missing/non-finite', () => {
    // Pre-fix, `cost_high - cost_low` on a nullish bound produced NaN, which
    // recharts serialises as `null` and renders as a broken stacked <Area>.
    const data = makeData({
      forecast: [
        { month: '2024-04', cost: 130, cost_low: 110, cost_high: undefined as unknown as number, kwh: 100 },
        { month: '2024-05', cost: 140, cost_low: Number.NaN, cost_high: 170, kwh: 100 },
      ],
    });
    render(<CostForecastSection forecastData={data} />);

    const rows = composedRows();
    const raw = screen.getByTestId('composed-chart').getAttribute('data-json') ?? '';
    // No NaN/null band ever reaches the chart payload.
    expect(raw).not.toContain('NaN');

    const apr = rows.find((r) => r.month === '2024-04')!;
    expect(apr).toEqual({ month: '2024-04', forecast: 130 });
    expect(apr).not.toHaveProperty('ci_band');
    expect(apr).not.toHaveProperty('ci_low');

    const may = rows.find((r) => r.month === '2024-05')!;
    expect(may).not.toHaveProperty('ci_band');
  });
});

/* ── 4. SERIES wiring ─────────────────────────────────────── */

describe('CostForecastSection — series wiring', () => {
  it('wires each Area/Line to its dataKey, name, stroke and fill', () => {
    render(<CostForecastSection forecastData={makeData()} />);

    const chart = screen.getByTestId('composed-chart');
    const areas = within(chart).getAllByTestId('area');
    const byKey = (k: string) => areas.find((a) => a.getAttribute('data-key') === k)!;

    // Invisible confidence-band base.
    expect(byKey('ci_low')).toHaveAttribute('data-stroke', 'none');
    expect(byKey('ci_low')).toHaveAttribute('data-fill', 'transparent');
    // Visible band height, localized legend name + gradient fill.
    expect(byKey('ci_band')).toHaveAttribute('data-name', '95% Confidence');
    expect(byKey('ci_band')).toHaveAttribute('data-fill', 'url(#forecastBand)');
    // Actual cost area uses the palette's primary colour.
    expect(byKey('actual')).toHaveAttribute('data-stroke', PALETTE[0]);
    expect(byKey('actual')).toHaveAttribute('data-name', 'Actual Cost');

    // Projected cost is a dashed line series.
    const forecastLine = within(chart).getByTestId('line');
    expect(forecastLine).toHaveAttribute('data-key', 'forecast');
    expect(forecastLine).toHaveAttribute('data-name', 'Projected Cost');
    expect(forecastLine).toHaveAttribute('data-stroke', '#a855f7');
  });

  it('renders the cost/kWh trend line from the historical rows', () => {
    render(<CostForecastSection forecastData={makeData()} />);

    // The trend LineChart is fed the raw historical array untouched.
    expect(trendRows().map((r) => r.month)).toEqual(['2024-01', '2024-02', '2024-03']);

    const trend = screen.getByTestId('line-chart');
    const line = within(trend).getByTestId('line');
    expect(line).toHaveAttribute('data-key', 'cost_per_kwh');
    expect(line).toHaveAttribute('data-stroke', '#06b6d4');
    expect(line).toHaveAttribute('data-name', '$/kWh');
  });
});

/* ── 5. CURRENCY axis ─────────────────────────────────────── */

describe('CostForecastSection — currency-aware axes', () => {
  it('labels every Y axis with the user currency symbol, not a hardcoded "$"', () => {
    render(<CostForecastSection forecastData={makeData()} />);

    const axes = screen.getAllByTestId('yaxis');
    // Both charts render a Y axis; each must reflect the settings currency.
    expect(axes.length).toBeGreaterThanOrEqual(2);
    axes.forEach((axis) => expect(axis).toHaveAttribute('data-unit', CURRENCY));
    expect(axes.some((a) => a.getAttribute('data-unit') === '$')).toBe(false);
  });
});

/* ── 6. GATE: forecast ────────────────────────────────────── */

describe('CostForecastSection — forecast gating', () => {
  it('shows the chart with ≥3 historical months and at least one projection', () => {
    render(<CostForecastSection forecastData={makeData()} />);

    expect(section('Cost Forecast')).toHaveAttribute('data-empty', 'false');
    expect(screen.getByTestId('composed-chart')).toBeInTheDocument();
  });

  it('shows the "need data" empty state with fewer than 3 historical months', () => {
    const data = makeData({ historical: [hist('2024-01', 100), hist('2024-02', 110)] });
    render(<CostForecastSection forecastData={data} />);

    const fcSection = section('Cost Forecast');
    expect(fcSection).toHaveAttribute('data-empty', 'true');
    expect(fcSection.getAttribute('data-empty-message')).toContain('at least 3 months');
    // Empty → the chart is never mounted (no blank panel behind a mounted chart).
    expect(screen.queryByTestId('composed-chart')).toBeNull();
  });

  it('treats ≥3 historical months but no projection as empty', () => {
    const data = makeData({ forecast: [] });
    render(<CostForecastSection forecastData={data} />);

    expect(section('Cost Forecast')).toHaveAttribute('data-empty', 'true');
    expect(screen.queryByTestId('composed-chart')).toBeNull();
    // …while the cost/kWh trend (3 months) still renders.
    expect(section('Cost per kWh Trend')).toHaveAttribute('data-empty', 'false');
  });
});

/* ── 7. GATE: trend ───────────────────────────────────────── */

describe('CostForecastSection — trend gating', () => {
  it('shows the "need trend data" empty state with a single historical month', () => {
    const data = makeData({
      historical: [hist('2024-01', 100)],
      forecast: [],
    });
    render(<CostForecastSection forecastData={data} />);

    const trend = section('Cost per kWh Trend');
    expect(trend).toHaveAttribute('data-empty', 'true');
    expect(trend.getAttribute('data-empty-message')).toContain('at least 2 months');
    expect(screen.queryByTestId('line-chart')).toBeNull();
  });
});

/* ── 8. STATES: loading / error / retry ───────────────────── */

describe('CostForecastSection — loading, error + retry', () => {
  it('threads the loading flag into every section and the details child', () => {
    render(<CostForecastSection forecastData={undefined} isLoading />);

    screen.getAllByTestId('cost-section').forEach((s) =>
      expect(s).toHaveAttribute('data-loading', 'true'),
    );
    expect(screen.getByTestId('forecast-details')).toHaveAttribute('data-loading', 'true');
    // Loading suppresses the charts.
    expect(screen.queryByTestId('composed-chart')).toBeNull();
  });

  it('surfaces the error and invokes onRetry when the user activates retry', () => {
    const onRetry = vi.fn();
    const error = new Error('boom');
    render(<CostForecastSection forecastData={makeData()} error={error} onRetry={onRetry} />);

    // Every section reports the error and none render their chart body.
    screen.getAllByTestId('cost-section').forEach((s) =>
      expect(s).toHaveAttribute('data-errored', 'true'),
    );
    expect(screen.queryByTestId('composed-chart')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'retry Cost Forecast' }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    // The error is also handed to the details child so it can recover too.
    expect(screen.getByTestId('forecast-details')).toHaveAttribute('data-errored', 'true');
    expect(screen.getByTestId('forecast-details')).toHaveAttribute('data-has-retry', 'true');
  });
});

/* ── 9. NULL-SAFE ─────────────────────────────────────────── */

describe('CostForecastSection — null safety', () => {
  it('degrades to empty states without throwing when forecastData is undefined', () => {
    const renderPanel = () => render(<CostForecastSection forecastData={undefined} />);
    expect(renderPanel).not.toThrow();

    expect(section('Cost Forecast')).toHaveAttribute('data-empty', 'true');
    expect(section('Cost per kWh Trend')).toHaveAttribute('data-empty', 'true');
    expect(screen.queryByTestId('composed-chart')).toBeNull();
    expect(screen.queryByTestId('line-chart')).toBeNull();
    expect(document.body.textContent).not.toContain('undefined');
    expect(document.body.textContent).not.toContain('NaN');
  });
});

/* ── 10. DELEGATE ─────────────────────────────────────────── */

describe('CostForecastSection — delegation to ForecastDetails', () => {
  it('hands the forecast payload and query state to <ForecastDetails>', () => {
    const onRetry = vi.fn();
    render(<CostForecastSection forecastData={makeData()} onRetry={onRetry} />);

    const details = screen.getByTestId('forecast-details');
    expect(details).toHaveAttribute('data-has-data', 'true');
    expect(details).toHaveAttribute('data-loading', 'false');
    expect(details).toHaveAttribute('data-errored', 'false');
    expect(details).toHaveAttribute('data-has-retry', 'true');
  });

  it('reports no data to <ForecastDetails> when forecastData is undefined', () => {
    render(<CostForecastSection forecastData={undefined} />);
    expect(screen.getByTestId('forecast-details')).toHaveAttribute('data-has-data', 'false');
  });
});
