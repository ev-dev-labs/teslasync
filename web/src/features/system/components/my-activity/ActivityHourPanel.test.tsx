/**
 * ActivityHourPanel — behaviour + hardening contract.
 *
 * ActivityHourPanel is the "By hour of day" panel of the My Activity bento. It
 * projects the derived `HourPoint[]` histogram into a bar chart while owning its
 * own loading / error / empty states, so the surrounding page never has to gate
 * the panel on data. This suite pins every branch of that state machine plus the
 * chart wiring (series key / colour / axis / a11y label) so a regression in any
 * one surface is caught deterministically.
 *
 * Conventions (mirrors ChargingSection / MyActivityPage tests in this repo):
 *   - `react-i18next` is stubbed to echo the inline English fallback.
 *   - The jsdom-hostile recharts barrel (`@/components/charts`) is replaced with
 *     inert, prop-capturing stubs so the derived chart data is assertable without
 *     a real SVG/ResizeObserver layout pass.
 *   - Renders are wrapped in a `MemoryRouter` because `QueryError` (the error
 *     branch) reaches for `useNavigate`. Interactions use `fireEvent`
 *     (`@testing-library/user-event` is not a dependency of this repo).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import { ActivityHourPanel, type ActivityHourPanelProps } from './ActivityHourPanel';
import type { HourPoint } from './myActivityAnalytics';
import { chartTokens } from '@/lib/tokens';

/* ── react-i18next: deterministic English-fallback rendering ─────────────── */
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') return fallbackOrOpts;
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>;
          if (typeof o.defaultValue === 'string') return o.defaultValue;
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

/* ── Inert recharts barrel — capture derived chart data / series props ────── */
const H = vi.hoisted(() => ({
  barChartData: null as HourPoint[] | null,
  barProps: null as Record<string, unknown> | null,
  xAxisProps: null as Record<string, unknown> | null,
}));

vi.mock('@/components/charts', () => ({
  ChartTooltip: () => null,
  chartGrid: null,
  axisTickSm: {},
  BarChart: ({ data, children }: { data: HourPoint[]; children?: ReactNode }) => {
    H.barChartData = data;
    return (
      <div data-testid="bar-chart" data-count={data?.length ?? 0}>
        {children}
      </div>
    );
  },
  Bar: (props: Record<string, unknown>) => {
    H.barProps = props;
    return (
      <div
        data-testid="bar"
        data-datakey={String(props.dataKey ?? '')}
        data-fill={String(props.fill ?? '')}
      />
    );
  },
  XAxis: (props: Record<string, unknown>) => {
    H.xAxisProps = props;
    return <div data-testid="xaxis" data-datakey={String(props.dataKey ?? '')} />;
  },
  YAxis: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="responsive">{children}</div>
  ),
}));

/* ── Fixtures ─────────────────────────────────────────────────────────────── */
/** A full, canonical 24-bucket histogram — matches what the page always feeds. */
function makeHours(): HourPoint[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: String(hour).padStart(2, '0'),
    // A deterministic, non-uniform shape so "populated" is distinguishable.
    count: (hour * 7) % 5,
  }));
}

interface RenderOverrides {
  data?: HourPoint[];
  isLoading?: boolean;
  isError?: boolean;
  isEmpty?: boolean;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
}

function renderPanel(over: RenderOverrides = {}) {
  const props: ActivityHourPanelProps = {
    // Use `in` so an explicit `data: undefined` (the defensive edge case) is
    // preserved rather than swallowed by the default fixture.
    data: ('data' in over ? over.data : makeHours()) as HourPoint[],
    isLoading: over.isLoading ?? false,
    isError: over.isError ?? false,
    isEmpty: over.isEmpty ?? false,
    error: 'error' in over ? over.error : null,
    onRetry: over.onRetry ?? vi.fn(),
    className: over.className,
  };
  return render(
    <MemoryRouter>
      <ActivityHourPanel {...props} />
    </MemoryRouter>,
  );
}

const EMPTY_MESSAGE = 'No activity to chart by hour yet.';
const CHART_ARIA = 'Activity counts by hour of day';

beforeEach(() => {
  H.barChartData = null;
  H.barProps = null;
  H.xAxisProps = null;
});

/* ── State machine: loading / error / empty branches ─────────────────────── */
describe('ActivityHourPanel — state machine', () => {
  it('renders the skeleton while loading and suppresses the chart + empty state', () => {
    const { container } = renderPanel({ isLoading: true });

    // The panel title mounts in every state — never gated on data.
    expect(screen.getByText('By hour of day')).toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByTestId('bar-chart')).toBeNull();
    expect(screen.queryByText(EMPTY_MESSAGE)).toBeNull();
  });

  it('renders a retryable QueryError when isError and wires the retry callback', () => {
    const onRetry = vi.fn();
    renderPanel({ isError: true, error: new Error('hour fetch boom'), onRetry });

    // The chart must not render behind the error surface.
    expect(screen.queryByTestId('bar-chart')).toBeNull();
    // ...but the panel title is still present around the error.
    expect(screen.getByText('By hour of day')).toBeInTheDocument();

    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state (not a blank panel) when isEmpty, even with 24 populated buckets', () => {
    renderPanel({ isEmpty: true, data: makeHours() });

    expect(screen.getByText(EMPTY_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).toBeNull();
    expect(screen.queryByRole('img', { name: CHART_ARIA })).toBeNull();
  });

  it('shows the empty state when the derived series is an empty array', () => {
    // isEmpty=false but zero rows must still degrade to the empty state via the
    // `rows.length === 0` guard rather than mounting a chart with no bars.
    renderPanel({ data: [] });

    expect(screen.getByText(EMPTY_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).toBeNull();
  });

  it('degrades to the empty state (no crash) when data is undefined', () => {
    // The `data ?? []` guard must absorb a missing series rather than throwing
    // on `.length` / `.map`.
    renderPanel({ data: undefined });

    expect(screen.getByText(EMPTY_MESSAGE)).toBeInTheDocument();
    expect(screen.getByText('By hour of day')).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).toBeNull();
  });
});

/* ── Chart branch: series wiring, axis, colour, a11y ─────────────────────── */
describe('ActivityHourPanel — chart wiring', () => {
  it('feeds the full 24-bucket histogram straight into the bar chart', () => {
    const rows = makeHours();
    renderPanel({ data: rows });

    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    expect(H.barChartData).toHaveLength(24);
    expect(H.barChartData).toEqual(rows);
    // The empty branch must NOT also render.
    expect(screen.queryByText(EMPTY_MESSAGE)).toBeNull();
  });

  it('binds the count series to the "Actions" name, series colour, and hoisted radius', () => {
    renderPanel({ data: makeHours() });

    expect(H.barProps?.dataKey).toBe('count');
    expect(H.barProps?.name).toBe('Actions');
    // The stable, colour-blind-safe series slot [4] (see chartTokens.series).
    expect(H.barProps?.fill).toBe(chartTokens.series[4]);
    // Verifies the hoisted BAR_RADIUS constant flows through unchanged.
    expect(H.barProps?.radius).toEqual([3, 3, 0, 0]);
  });

  it('plots the zero-padded hour label on the X axis', () => {
    renderPanel({ data: makeHours() });

    expect(H.xAxisProps?.dataKey).toBe('label');
  });

  it('exposes the chart to assistive tech as a labelled image region', () => {
    renderPanel({ data: makeHours() });

    // House a11y idiom: role="img" + aria-label is the text alternative for the
    // otherwise-inaccessible SVG chart.
    expect(screen.getByRole('img', { name: CHART_ARIA })).toBeInTheDocument();
  });
});

/* ── Structure / a11y invariants ─────────────────────────────────────────── */
describe('ActivityHourPanel — structure', () => {
  it('marks the decorative title icon as aria-hidden', () => {
    renderPanel();

    const title = screen.getByText('By hour of day');
    const icon = title.querySelector('svg');

    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('forwards the className to the outer GlassPanel', () => {
    const { container } = renderPanel({ className: 'sentinel-panel-class' });

    expect(container.querySelector('.sentinel-panel-class')).not.toBeNull();
  });
});
