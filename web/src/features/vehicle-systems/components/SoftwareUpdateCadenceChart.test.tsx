/**
 * SoftwareUpdateCadenceChart — unit coverage.
 *
 * The component is a thin presentational wrapper around a recharts <BarChart>.
 * recharts refuses to lay out at 0×0 in jsdom, so `@/components/charts` is
 * replaced wholesale with prop-surfacing doubles (the same strategy the page
 * suites use). That lets us assert the component's OWN contract deterministically:
 *   - the cadence points are threaded verbatim into <BarChart>;
 *   - the <Bar> series is wired from the shared design tokens (dataKey / name /
 *     fill) and the X axis reads the human `label`;
 *   - the chart canvas is announced as a single labelled figure (role="img");
 *   - the hoisted margin / cursor objects stay referentially stable across
 *     renders (the perf reason they were lifted out of JSX);
 *   - absent OR empty data degrades to an accessible empty state, never a bare
 *     axis frame.
 *
 * `react-i18next` is stubbed to echo the English fallback so copy is assertable.
 * The real `@/components/feedback` EmptyState and `@/lib/tokens` are used so the
 * empty branch and the token wiring are exercised end-to-end. Nothing touches
 * the network.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

// i18n stub → return the fallback string so assertions target the rendered copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// Capture the props recharts children receive. Hoisted so the (hoisted)
// vi.mock factory below can close over it.
const captured = vi.hoisted(() => ({
  barChart: [] as Array<{ data: unknown; margin: unknown }>,
  bar: [] as Array<Record<string, unknown>>,
  cursor: [] as unknown[],
}));

// Replace the charts barrel with layout-free doubles. recharts BarChart drops
// its axis children when it can't measure, so we surface every prop we assert.
vi.mock('@/components/charts', async () => ({
  ...(await import('@/test/chartTestDoubles')).chartTestDoubles,
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  BarChart: ({
    data,
    margin,
    children,
  }: {
    data: unknown;
    margin: unknown;
    children?: ReactNode;
  }) => {
    captured.barChart.push({ data, margin });
    return (
      <div data-testid="bar-chart" data-rows={Array.isArray(data) ? data.length : -1}>
        {children}
      </div>
    );
  },
  Bar: (props: Record<string, unknown>) => {
    captured.bar.push(props);
    return (
      <div
        data-testid="bar"
        data-key={String(props.dataKey)}
        data-name={String(props.name)}
        data-fill={String(props.fill)}
      />
    );
  },
  CartesianGrid: () => <div data-testid="grid" />,
  XAxis: ({ dataKey }: { dataKey?: string }) => (
    <div data-testid="xaxis" data-key={String(dataKey)} />
  ),
  YAxis: ({ allowDecimals }: { allowDecimals?: boolean }) => (
    <div data-testid="yaxis" data-allow-decimals={String(allowDecimals)} />
  ),
  Tooltip: ({ cursor }: { cursor?: unknown }) => {
    captured.cursor.push(cursor);
    return <div data-testid="tooltip" />;
  },
  ChartTooltip: () => null,
  axisTickSm: { fill: 'var(--text-muted)', fontSize: 10 },
}));

import { chartTokens } from '@/lib/tokens';
import { SoftwareUpdateCadenceChart, type CadencePoint } from './SoftwareUpdateCadenceChart';

const POINTS: CadencePoint[] = [
  { month: '2025-03', label: "Mar '25", count: 1 },
  { month: '2025-05', label: "May '25", count: 2 },
  { month: '2025-06', label: "Jun '25", count: 1 },
];

beforeEach(() => {
  captured.barChart.length = 0;
  captured.bar.length = 0;
  captured.cursor.length = 0;
});

describe('SoftwareUpdateCadenceChart — chart canvas', () => {
  it('threads the cadence points verbatim into <BarChart> and labels the figure for AT', () => {
    render(<SoftwareUpdateCadenceChart data={POINTS} />);

    const chart = screen.getByTestId('bar-chart');
    expect(chart).toHaveAttribute('data-rows', '3');
    expect(captured.barChart).toHaveLength(1);
    expect(captured.barChart[0].data).toEqual(POINTS);

    // The canvas is announced as one labelled image, not a pile of SVG nodes.
    const figure = screen.getByRole('img', { name: 'Software updates per calendar month' });
    expect(figure).toBeInTheDocument();
    // Non-empty data → no empty-state fallback.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('wires the Bar series and X axis from the shared design tokens', () => {
    render(<SoftwareUpdateCadenceChart data={POINTS} />);

    const bar = screen.getByTestId('bar');
    expect(bar).toHaveAttribute('data-key', 'count');
    // i18n fallback copy for the series name.
    expect(bar).toHaveAttribute('data-name', 'Updates');
    // Fill comes from the canonical chart palette (index 5), not a literal hex.
    expect(bar).toHaveAttribute('data-fill', chartTokens.series[5]);

    expect(screen.getByTestId('xaxis')).toHaveAttribute('data-key', 'label');
    // Counts are whole numbers → the Y axis suppresses decimal ticks.
    expect(screen.getByTestId('yaxis')).toHaveAttribute('data-allow-decimals', 'false');
  });

  it('applies the responsive height utilities to the chart wrapper', () => {
    render(<SoftwareUpdateCadenceChart data={POINTS} />);

    const figure = screen.getByRole('img');
    expect(figure.parentElement).toHaveClass('h-56', 'sm:h-64', 'xl:h-72');
  });

  it('keeps the margin + tooltip cursor referentially stable across renders (perf)', () => {
    const { rerender } = render(<SoftwareUpdateCadenceChart data={POINTS} />);
    rerender(<SoftwareUpdateCadenceChart data={POINTS.slice(0, 2)} />);

    expect(captured.barChart[0].margin).toEqual({ top: 8, right: 8, left: -18, bottom: 0 });
    // Hoisted module constants → identical object reference on every render.
    expect(Object.is(captured.barChart[0].margin, captured.barChart[1].margin)).toBe(true);
    expect(Object.is(captured.cursor[0], captured.cursor[1])).toBe(true);
  });

  it('renders exactly one Bar for a single-point range', () => {
    render(<SoftwareUpdateCadenceChart data={[{ month: '2025-06', label: "Jun '25", count: 3 }]} />);

    expect(screen.getByTestId('bar-chart')).toHaveAttribute('data-rows', '1');
    expect(screen.getAllByTestId('bar')).toHaveLength(1);
  });
});

describe('SoftwareUpdateCadenceChart — empty / null-safety', () => {
  it('renders an accessible empty state (never a bare axis frame) for an empty array', () => {
    render(<SoftwareUpdateCadenceChart data={[]} />);

    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    expect(screen.getByText('No update activity in this range')).toBeInTheDocument();
    // The chart canvas must not mount at all.
    expect(screen.queryByTestId('bar-chart')).toBeNull();
    expect(
      screen.getByRole('img', { name: /software updates per calendar month/i }),
    ).toContainElement(status);
  });

  it('treats absent data as empty via null-safety and shows the same empty state', () => {
    render(<SoftwareUpdateCadenceChart />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('No update activity in this range')).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).toBeNull();
    expect(captured.barChart).toHaveLength(0);
  });
});
