/**
 * ForecastDetails — behaviour, hardening + regression cover.
 *
 * <ForecastDetails forecastData … /> is the three-column detail band under the
 * Cost Forecast chart. It splits the forecast payload into three independently
 * gated <CostSection>s:
 *   1. BREAKDOWN — a Home-vs-Supercharger donut (<Pie> with two <Cell>s) plus a
 *      per-kWh cost legend.
 *   2. SAVINGS   — the Gas-vs-EV block: an animated monthly figure, annual +
 *      lifetime <Currency>, and gas/EV/avg-distance rows.
 *   3. INSIGHTS  — one chip per free-text insight.
 * Its real work is *derivation + per-section gating*, not pixels: it decides
 * per band whether to show content or a localized empty state, and it must stay
 * null-safe when a slice of the payload is missing.
 *
 * Strategy (mirrors the sibling CostForecastSection / DetailedStatistics tests):
 *   - <CostSection> → a faithful gate: echoes title / loading / error / empty /
 *     message and renders its children ONLY when active (never a blank panel),
 *     plus a retry control when an error is present.
 *   - `@/components/charts` → real module with the donut primitives overridden
 *     to prop-echoing stubs (recharts' <ResponsiveContainer> measures 0×0 under
 *     jsdom, so the <Pie> `data` is echoed as JSON to make the shares
 *     inspectable; <Cell> echoes its fill).
 *   - <Text>/<Caption>/<AnimatedNumber>/<Currency> render for real so the
 *     user-visible copy + the settings currency symbol are asserted directly.
 *     The global useSettings mock in test-setup pins the symbol to "$";
 *     requestAnimationFrame is collapsed so <AnimatedNumber> settles
 *     synchronously on its final value.
 * i18n resolves to the English fallback so empty-state copy is assertable.
 * Nothing hits the network — the component is pure and receives its data by prop.
 *
 * Covered facets:
 *   1. LAYOUT    — the three sections render in order with a shared skeleton height.
 *   2. BREAKDOWN — donut shares, cell colours, ring geometry, a11y label, legend.
 *   3. SAVINGS   — animated monthly + annual/lifetime + gas/EV/avg-distance, all
 *                  in the settings currency, with the right colour accents.
 *   4. EMPTY     — an undefined payload degrades every section to its localized
 *                  empty state with no chart body leaking behind it.
 *   5. BUGFIX    — a present envelope with a MISSING breakdown / gas_comparison
 *                  slice degrades to empty instead of throwing on a nested field.
 *   6. NULL-SAFE — missing shares clamp to 0; a missing per-kWh cost renders "—".
 *   7. INSIGHTS  — blank / null insights are filtered; an all-blank list collapses
 *                  to empty.
 *   8. STATES    — loading threads into every section; an error surfaces a retry
 *                  control per section that invokes onRetry.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { CostForecastData } from '@/types/charging';

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

// Real charts module with the donut primitives overridden to prop-echoing
// stubs. Spreading `actual` keeps every other chart export intact so the real
// data-display / ui barrels that transitively touch charts still resolve.
vi.mock('@/components/charts', async () => {
  const actual = await vi.importActual<typeof import('@/components/charts')>('@/components/charts');
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return {
    ...actual,
    ...chartTestDoubles,
    ChartTooltip: () => null,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    PieChart: ({ children }: { children?: ReactNode }) => <div data-testid="pie-chart">{children}</div>,
    Pie: ({
      data,
      dataKey,
      innerRadius,
      outerRadius,
      children,
    }: {
      data?: unknown[];
      dataKey?: string;
      innerRadius?: number;
      outerRadius?: number;
      children?: ReactNode;
    }) => (
      <div
        data-testid="pie"
        data-json={JSON.stringify(data ?? [])}
        data-key={String(dataKey ?? '')}
        data-inner={String(innerRadius ?? '')}
        data-outer={String(outerRadius ?? '')}
      >
        {children}
      </div>
    ),
    Cell: ({ fill }: { fill?: string }) => <div data-testid="cell" data-fill={String(fill ?? '')} />,
    Tooltip: () => null,
  };
});

// Faithful <CostSection> gate: renders its children ONLY when the section is
// active (not loading / errored / empty) and exposes a retry control while an
// error is present so the callback is testable.
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

import { ForecastDetails } from './ForecastDetails';

beforeEach(() => {
  // Collapse <AnimatedNumber>'s ease-out onto its final frame so the rendered
  // value is deterministic and available synchronously after render().
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
    cb(1e9);
    return 1;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/* ── fixtures ─────────────────────────────────────────────── */

// Override values are typed `unknown` so tests can intentionally supply
// partial / malformed slices (missing breakdown, null shares, blank insights)
// to exercise the component's null-safety without fighting the strict shape.
function makeData(overrides: Partial<Record<keyof CostForecastData, unknown>> = {}): CostForecastData {
  return {
    historical: [],
    forecast: [],
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
  } as CostForecastData;
}

function section(title: string): HTMLElement {
  const found = screen
    .getAllByTestId('cost-section')
    .find((s) => s.getAttribute('data-title') === title);
  if (!found) throw new Error(`no CostSection titled "${title}"`);
  return found;
}

const BREAKDOWN = 'Charging Breakdown';
const SAVINGS = 'Gas vs EV Savings';
const INSIGHTS = 'Insights';

/* ── 1. LAYOUT ────────────────────────────────────────────── */

describe('ForecastDetails — section layout', () => {
  it('renders the breakdown, savings and insights sections in order', () => {
    render(<ForecastDetails forecastData={makeData()} />);

    const titles = screen.getAllByTestId('cost-section').map((s) => s.getAttribute('data-title'));
    expect(titles).toEqual([BREAKDOWN, SAVINGS, INSIGHTS]);
    screen
      .getAllByTestId('cost-section')
      .forEach((s) => expect(s).toHaveAttribute('data-skeleton-height', '180'));
  });
});

/* ── 2. BREAKDOWN ─────────────────────────────────────────── */

describe('ForecastDetails — breakdown donut', () => {
  it('wires the donut shares, cell colours, ring geometry and a11y label', () => {
    render(<ForecastDetails forecastData={makeData()} />);
    const bd = section(BREAKDOWN);
    expect(bd).toHaveAttribute('data-empty', 'false');

    const pie = within(bd).getByTestId('pie');
    expect(JSON.parse(pie.getAttribute('data-json') ?? '[]')).toEqual([
      { name: 'Home', value: 70 },
      { name: 'Supercharger', value: 30 },
    ]);
    expect(pie).toHaveAttribute('data-key', 'value');
    expect(pie).toHaveAttribute('data-inner', '50');
    expect(pie).toHaveAttribute('data-outer', '75');

    const cells = within(bd).getAllByTestId('cell');
    expect(cells.map((c) => c.getAttribute('data-fill'))).toEqual(['#22c55e', '#f59e0b']);

    // The donut is a labelled image region, not an unlabelled graphic.
    const donut = within(bd).getByRole('img');
    expect(donut).toHaveAccessibleName(/Home versus Supercharger/);
  });

  it('renders the per-kWh legend with the settings currency at 3-dp', () => {
    render(<ForecastDetails forecastData={makeData()} />);
    const bd = section(BREAKDOWN);

    expect(within(bd).getByText('Home')).toBeInTheDocument();
    expect(within(bd).getByText('Supercharger')).toBeInTheDocument();
    expect(bd.textContent).toContain('$0.120/kWh');
    expect(bd.textContent).toContain('$0.340/kWh');
  });
});

/* ── 3. SAVINGS ───────────────────────────────────────────── */

describe('ForecastDetails — savings block', () => {
  it('renders the monthly, annual, lifetime and per-month figures in the settings currency', () => {
    render(<ForecastDetails forecastData={makeData()} />);
    const sv = section(SAVINGS);
    expect(sv).toHaveAttribute('data-empty', 'false');

    expect(within(sv).getByText('Monthly Savings')).toBeInTheDocument();
    // currencySymbol ($) + AnimatedNumber(160, 0), settled synchronously.
    expect(sv.textContent).toContain('$160');
    // Annual / Lifetime at 0-dp with locale separators.
    expect(sv.textContent).toContain('$1,920');
    expect(sv.textContent).toContain('$19,200');

    // Gas (rose) vs EV (emerald) monthly cost at the default 2-dp.
    const gasCost = within(sv).getByText('$220.00');
    expect(gasCost).toHaveClass('text-rose-300');
    const evCost = within(sv).getByText('$60.00');
    expect(evCost).toHaveClass('text-emerald-300');

    // Avg distance uses fmtNumber (locale separators, 0-dp).
    expect(within(sv).getByText('1,500')).toBeInTheDocument();
  });
});

/* ── 4. EMPTY ─────────────────────────────────────────────── */

describe('ForecastDetails — undefined payload', () => {
  it('degrades every section to its localized empty state with no chart body', () => {
    render(<ForecastDetails forecastData={undefined} />);

    const sections = screen.getAllByTestId('cost-section');
    expect(sections).toHaveLength(3);
    sections.forEach((s) => expect(s).toHaveAttribute('data-empty', 'true'));

    expect(section(BREAKDOWN).getAttribute('data-empty-message')).toContain('Breakdown will appear');
    expect(section(SAVINGS).getAttribute('data-empty-message')).toContain('Savings data will appear');
    expect(section(INSIGHTS).getAttribute('data-empty-message')).toContain('Insights will appear');

    expect(screen.queryByTestId('pie')).toBeNull();
  });
});

/* ── 5. BUGFIX: missing slice ─────────────────────────────── */

describe('ForecastDetails — partial payload (regression)', () => {
  it('shows empty breakdown/savings — never throws — when those slices are missing', () => {
    // Pre-fix, a present envelope with a nullish `breakdown` threw on
    // `forecastData.breakdown.home.pct` during render.
    const data = makeData({ breakdown: undefined, gas_comparison: undefined });

    expect(() => render(<ForecastDetails forecastData={data} />)).not.toThrow();

    expect(section(BREAKDOWN)).toHaveAttribute('data-empty', 'true');
    expect(section(SAVINGS)).toHaveAttribute('data-empty', 'true');
    expect(screen.queryByTestId('pie')).toBeNull();

    // …while the insights slice still renders independently.
    expect(section(INSIGHTS)).toHaveAttribute('data-empty', 'false');
    expect(
      within(section(INSIGHTS)).getByText('Charge at home overnight to save more.'),
    ).toBeInTheDocument();
  });

  it('clamps missing shares to 0 and renders a dash for a missing per-kWh cost', () => {
    const data = makeData({
      breakdown: {
        home: { pct: null, avg_cost_per_kwh: null, monthly_avg: 0 },
        supercharger: { pct: undefined, avg_cost_per_kwh: 0.5, monthly_avg: 0 },
      },
    });
    render(<ForecastDetails forecastData={data} />);
    const bd = section(BREAKDOWN);

    expect(JSON.parse(within(bd).getByTestId('pie').getAttribute('data-json') ?? '[]')).toEqual([
      { name: 'Home', value: 0 },
      { name: 'Supercharger', value: 0 },
    ]);
    // Missing cost → em-dash; present cost → 3-dp currency.
    expect(bd.textContent).toContain('—/kWh');
    expect(bd.textContent).toContain('$0.500/kWh');
  });
});

/* ── 6. INSIGHTS ──────────────────────────────────────────── */

describe('ForecastDetails — insights list', () => {
  it('filters blank/null insights and renders one chip per surviving insight', () => {
    const data = makeData({ insights: ['First insight', '', '   ', null, 'Second insight'] });
    render(<ForecastDetails forecastData={data} />);
    const ins = section(INSIGHTS);

    expect(ins).toHaveAttribute('data-empty', 'false');
    expect(within(ins).getByText('First insight')).toBeInTheDocument();
    expect(within(ins).getByText('Second insight')).toBeInTheDocument();

    // Exactly two chips survive the blank/null filter.
    const list = within(ins).getByText('First insight').closest('.space-y-3');
    expect(list?.children.length).toBe(2);
  });

  it('collapses the insights section to empty when every insight is blank', () => {
    render(<ForecastDetails forecastData={makeData({ insights: ['', '   '] })} />);
    const ins = section(INSIGHTS);

    expect(ins).toHaveAttribute('data-empty', 'true');
    expect(ins.getAttribute('data-empty-message')).toContain('Insights will appear');
  });
});

/* ── 7. STATES: loading / error / retry ───────────────────── */

describe('ForecastDetails — loading, error + retry', () => {
  it('threads the loading flag into every section and suppresses content', () => {
    render(<ForecastDetails forecastData={undefined} isLoading />);

    screen
      .getAllByTestId('cost-section')
      .forEach((s) => expect(s).toHaveAttribute('data-loading', 'true'));
    expect(screen.queryByTestId('pie')).toBeNull();
  });

  it('surfaces the error on every section and invokes onRetry when a retry is activated', () => {
    const onRetry = vi.fn();
    render(
      <ForecastDetails forecastData={makeData()} error={new Error('boom')} onRetry={onRetry} />,
    );

    screen
      .getAllByTestId('cost-section')
      .forEach((s) => expect(s).toHaveAttribute('data-errored', 'true'));
    // Error suppresses the chart body in every section.
    expect(screen.queryByTestId('pie')).toBeNull();

    const retries = screen.getAllByRole('button', { name: /^retry/i });
    expect(retries).toHaveLength(3);
    fireEvent.click(retries[0]);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
