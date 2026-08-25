/**
 * BatteryLevelChart — behaviour + hardening coverage.
 *
 * The component takes a `data: StartLevelBucket[]` prop (a start-of-charge SOC
 * histogram) and either plots a recharts bar chart or, when there is nothing to
 * plot, surfaces an accessible empty state instead of a blank set of axes. This
 * suite drives every branch and asserts the behaviour that matters:
 *   - the panel chrome (title + hint + decorative, aria-hidden icon) always
 *     frames the section,
 *   - the populated path feeds the guarded buckets straight to the BarChart and
 *     binds the i18n series name / axis keys / bar colour,
 *   - the empty path (undefined prop, empty array, all-zero counts) renders an
 *     EmptyState and withholds the chart — the null-safety + "never a blank
 *     panel" guard,
 *   - a mixed zero/positive distribution still counts as data and plots,
 *   - and the caller-supplied array is passed through untouched.
 *
 * Only the `@/components/charts` barrel is doubled — its ResponsiveContainer
 * renders 0x0 in jsdom, so the series/data would otherwise be unobservable. The
 * `@/components/feedback` EmptyState is the REAL implementation so the rendered
 * `role="status"` + copy are genuinely exercised. This component has no data
 * source of its own, so the network is never touched.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import type { StartLevelBucket } from './helpers';
import { BatteryLevelChart } from './BatteryLevelChart';

// ── i18n: resolve the string fallback (2nd arg) so assertions read on copy. ──
vi.mock('react-i18next', () => {
  const t = (key: string, fallback?: unknown): string =>
    typeof fallback === 'string' ? fallback : key;
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

// ── charts barrel double: ResponsiveContainer renders its children so the
//    BarChart double can surface the component-computed `data` (as JSON) plus
//    the series/axis bindings for direct assertion. `chartGrid` is a renderable
//    node in the real barrel (a <CartesianGrid/> element) — the component drops
//    it in as a child, so the double must be a valid node too. ──
vi.mock('@/components/charts', async () => {
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  const Inert = () => null;
  return {
    ...chartTestDoubles,
    chartGrid: null,
    axisTickSm: { fontSize: 10 },
    ChartTooltip: Inert,
    Tooltip: Inert,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    BarChart: ({
      data,
      children,
    }: {
      data?: ReadonlyArray<Record<string, unknown>>;
      children?: ReactNode;
    }) => (
      <div data-testid="bar-chart">
        <span data-testid="bar-chart-data">{JSON.stringify(data ?? [])}</span>
        {children}
      </div>
    ),
    Bar: ({
      dataKey,
      name,
      fill,
      fillOpacity,
      radius,
    }: {
      dataKey?: string;
      name?: string;
      fill?: string;
      fillOpacity?: number;
      radius?: number | [number, number, number, number];
    }) => (
      <span
        data-testid="bar-series"
        data-key={String(dataKey ?? '')}
        data-name={String(name ?? '')}
        data-fill={String(fill ?? '')}
        data-fill-opacity={String(fillOpacity ?? '')}
        data-radius={JSON.stringify(radius ?? null)}
      />
    ),
    XAxis: ({ dataKey }: { dataKey?: string }) => (
      <span data-testid="x-axis" data-key={String(dataKey ?? '')} />
    ),
    YAxis: () => <span data-testid="y-axis" />,
  };
});

function renderChart(data: StartLevelBucket[]) {
  return render(
    <MemoryRouter>
      <BatteryLevelChart data={data} />
    </MemoryRouter>,
  );
}

/** Rows the recharts BarChart double received as its `data` prop. */
function readChartRows(): StartLevelBucket[] {
  return JSON.parse(screen.getByTestId('bar-chart-data').textContent || '[]');
}

const DIST: StartLevelBucket[] = [
  { range: '0-10%', count: 2 },
  { range: '10-20%', count: 5 },
  { range: '20-30%', count: 3 },
];

describe('BatteryLevelChart — panel chrome', () => {
  it('always frames the panel with the title, the explanatory hint and a decorative (aria-hidden) icon', () => {
    const { container } = renderChart(DIST);

    expect(
      screen.getByRole('heading', { name: /Battery Level at Charge Start/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('How low do you typically go before charging?'),
    ).toBeInTheDocument();
    // The lucide icon in the header is purely decorative and hidden from AT.
    expect(container.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThan(0);
  });
});

describe('BatteryLevelChart — populated', () => {
  it('feeds the guarded buckets straight to the bar chart and hides the empty state', () => {
    renderChart(DIST);

    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    expect(readChartRows()).toEqual(DIST);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('binds the i18n series name, count/range keys and the amber bar colour', () => {
    renderChart(DIST);

    const series = screen.getByTestId('bar-series');
    expect(series).toHaveAttribute('data-key', 'count');
    // The hardcoded "Sessions" literal is now routed through t() — the mock
    // resolves the English fallback, proving the string is translatable.
    expect(series).toHaveAttribute('data-name', 'Sessions');
    expect(series).toHaveAttribute('data-fill', '#f59e0b');
    expect(series).toHaveAttribute('data-radius', '[4,4,0,0]');
    expect(screen.getByTestId('x-axis')).toHaveAttribute('data-key', 'range');
  });

  it('does not mutate the caller-supplied distribution array', () => {
    const source: StartLevelBucket[] = [{ range: '0-10%', count: 7 }];
    renderChart(source);

    expect(source).toEqual([{ range: '0-10%', count: 7 }]);
    expect(readChartRows()).toEqual([{ range: '0-10%', count: 7 }]);
  });
});

describe('BatteryLevelChart — empty & null-safety', () => {
  it('treats an undefined data prop as empty instead of throwing', () => {
    expect(() =>
      renderChart(undefined as unknown as StartLevelBucket[]),
    ).not.toThrow();

    expect(screen.getByRole('status')).toHaveTextContent(
      'No charge-start levels to chart yet.',
    );
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });

  it('renders an accessible empty state (not a blank chart) when every bucket is zero', () => {
    renderChart([
      { range: '0-10%', count: 0 },
      { range: '10-20%', count: 0 },
    ]);

    expect(screen.getByRole('status')).toHaveTextContent(
      'No charge-start levels to chart yet.',
    );
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
    // Panel chrome still frames the empty state.
    expect(
      screen.getByRole('heading', { name: /Battery Level at Charge Start/i }),
    ).toBeInTheDocument();
  });

  it('still plots when at least one bucket has a positive count', () => {
    const mixed: StartLevelBucket[] = [
      { range: '0-10%', count: 0 },
      { range: '10-20%', count: 4 },
    ];
    renderChart(mixed);

    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    expect(readChartRows()).toEqual(mixed);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
