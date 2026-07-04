/**
 * SentryModeChart contract + hardening tests.
 *
 * The panel is a presentational view over a pre-computed `SentryDayBucket[]`
 * plus the loading / error flags its parent owns. It never fetches, so the
 * tests drive it directly with hand-built props rather than mocking the
 * network.
 *
 * Recharts renders 0×0 under jsdom (no layout engine), so the real BarChart
 * never paints its SVG/bars — which would make the component's data wiring
 * (series keys, fills, stacking, the date `tickFormatter`) invisible to the
 * DOM. Following the repo convention (see LiveSignalKindBreakdown /
 * SmallMultiplesChart tests) we swap the shared `@/components/charts` barrel
 * for lightweight doubles that surface the `data` prop and each series' props
 * as inspectable attributes. Only the pixel-pushing chart library is stubbed;
 * the component's own logic still runs.
 *
 * Coverage:
 *   1. Panel chrome (title + hidden icon) stays visible in every state so the
 *      panel is never a blank rectangle.
 *   2. Ready — one datum per day bucket with its date + on/off counts.
 *   3. Ready — two stacked series with the right keys, names, fills, stackId.
 *   4. Ready — the chart lives in a labelled `img` region and wires the date
 *      axis through `formatDateShort` + renders the tooltip and legend.
 *   5. Loading — a 256px skeleton, no chart leaks through.
 *   6. Error — a retry-able banner, `onRetry` forwarded, no chart (also pins
 *      error-over-data precedence: non-empty buckets stay hidden).
 *   7. Error precedence — an error wins over a concurrent loading flag.
 *   8. Empty — the empty-state copy, no chart, for an explicit `[]`.
 *   9. Null-safety (regression) — an (untyped-at-runtime) `undefined` buckets
 *      prop renders the empty state instead of crashing on `.length`.
 *  10. `className` is forwarded onto the GlassPanel wrapper.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps, ReactNode } from 'react';

import { chartTokens } from '@/lib/tokens';
import type { SentryDayBucket } from './helpers';

/* ── i18n: resolve t(key, fallback) → fallback so copy is deterministic and
 *    locale-file independent. Applies to QueryError's copy too. ─────────── */
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

/* ── charts: surface the derived data + per-series props for inspection. ── */
vi.mock('@/components/charts', () => ({
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  BarChart: ({
    data,
    children,
  }: {
    data?: SentryDayBucket[];
    children?: ReactNode;
  }) => (
    <div data-testid="bar-chart" data-bar-count={String((data ?? []).length)}>
      <ul data-testid="bar-data">
        {(data ?? []).map((d, i) => (
          <li
            key={i}
            data-testid="bar-datum"
            data-date={String(d.date)}
            data-on={String(d.sentryOn)}
            data-off={String(d.sentryOff)}
          />
        ))}
      </ul>
      {children}
    </div>
  ),
  Bar: ({
    name,
    dataKey,
    fill,
    stackId,
  }: {
    name?: string;
    dataKey?: string;
    fill?: string;
    stackId?: string;
  }) => (
    <div
      data-testid="bar"
      data-name={String(name)}
      data-key={String(dataKey)}
      data-fill={String(fill)}
      data-stack={String(stackId)}
    />
  ),
  XAxis: ({
    dataKey,
    tickFormatter,
  }: {
    dataKey?: string;
    tickFormatter?: (v: string) => string;
  }) => (
    <div
      data-testid="x-axis"
      data-key={String(dataKey)}
      data-sample={tickFormatter ? tickFormatter('2026-04-30T12:00:00Z') : ''}
    />
  ),
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => null,
  Tooltip: () => <div data-testid="tooltip" />,
  Legend: () => <div data-testid="legend" />,
  ChartTooltip: () => null,
}));

import { SentryModeChart } from './SentryModeChart';

type ChartProps = ComponentProps<typeof SentryModeChart>;

function bucket(overrides: Partial<SentryDayBucket> = {}): SentryDayBucket {
  return { date: '2026-04-28', sentryOn: 4, sentryOff: 1, ...overrides };
}

function renderChart(overrides: Partial<ChartProps> = {}) {
  const onRetry = overrides.onRetry ?? vi.fn();
  const props: ChartProps = {
    sentryBuckets: [],
    isLoading: false,
    error: null,
    onRetry,
    ...overrides,
  };
  const utils = render(
    <MemoryRouter>
      <SentryModeChart {...props} />
    </MemoryRouter>,
  );
  return { ...utils, onRetry };
}

afterEach(() => {
  cleanup();
});

describe('SentryModeChart — panel chrome', () => {
  it('always renders the titled panel + hidden icon so it is never blank', () => {
    const cases: Partial<ChartProps>[] = [
      { isLoading: false, error: null, sentryBuckets: [] },
      { isLoading: true, error: null, sentryBuckets: [] },
      { isLoading: false, error: new Error('x'), sentryBuckets: [] },
      { isLoading: false, error: null, sentryBuckets: [bucket()] },
    ];
    for (const props of cases) {
      const { unmount } = renderChart(props);
      const heading = screen.getByRole('heading', {
        name: /sentry mode activity/i,
      });
      expect(heading).toBeInTheDocument();
      // The decorative Activity icon must be hidden from the a11y tree.
      expect(heading.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      unmount();
    }
  });
});

describe('SentryModeChart — ready state', () => {
  it('renders one datum per day bucket with its date and on/off counts', () => {
    renderChart({
      sentryBuckets: [
        { date: '2026-04-28', sentryOn: 5, sentryOff: 2 },
        { date: '2026-04-29', sentryOn: 3, sentryOff: 4 },
      ],
    });

    expect(screen.getByTestId('bar-chart')).toHaveAttribute(
      'data-bar-count',
      '2',
    );
    const data = screen.getAllByTestId('bar-datum');
    expect(data).toHaveLength(2);
    expect(data[0]).toHaveAttribute('data-date', '2026-04-28');
    expect(data[0]).toHaveAttribute('data-on', '5');
    expect(data[0]).toHaveAttribute('data-off', '2');
    expect(data[1]).toHaveAttribute('data-date', '2026-04-29');
    expect(data[1]).toHaveAttribute('data-on', '3');
    expect(data[1]).toHaveAttribute('data-off', '4');
  });

  it('renders stacked "Sentry On" / "Sentry Off" series with the right keys, fills, and stackId', () => {
    renderChart({ sentryBuckets: [bucket()] });

    const bars = screen.getAllByTestId('bar');
    expect(bars).toHaveLength(2);

    // Sentry On — first series, brand blue, stacked.
    expect(bars[0]).toHaveAttribute('data-key', 'sentryOn');
    expect(bars[0]).toHaveAttribute('data-name', 'Sentry On');
    expect(bars[0]).toHaveAttribute('data-fill', chartTokens.series[0]);
    expect(bars[0]).toHaveAttribute('data-stack', 'sentry');

    // Sentry Off — muted axis colour, same stack so the bars sum per day.
    expect(bars[1]).toHaveAttribute('data-key', 'sentryOff');
    expect(bars[1]).toHaveAttribute('data-name', 'Sentry Off');
    expect(bars[1]).toHaveAttribute('data-fill', chartTokens.axisStroke);
    expect(bars[1]).toHaveAttribute('data-stack', 'sentry');
  });

  it('wraps the chart in a labelled img region and wires the date axis, tooltip, and legend', () => {
    renderChart({ sentryBuckets: [bucket()] });

    expect(
      screen.getByRole('img', { name: /sentry mode activity/i }),
    ).toBeInTheDocument();

    const xAxis = screen.getByTestId('x-axis');
    expect(xAxis).toHaveAttribute('data-key', 'date');
    // The tickFormatter must route the raw ISO date through formatDateShort —
    // i.e. produce a real short date, not the raw ISO and not the "—" fallback.
    const sample = xAxis.getAttribute('data-sample') ?? '';
    expect(sample).not.toBe('2026-04-30T12:00:00Z');
    expect(sample).not.toBe('—');
    expect(sample).toMatch(/[A-Za-z]/);
    expect(sample).toMatch(/\d/);

    expect(screen.getByTestId('tooltip')).toBeInTheDocument();
    expect(screen.getByTestId('legend')).toBeInTheDocument();
  });
});

describe('SentryModeChart — loading + error states', () => {
  it('shows a 256px skeleton (not the chart) while loading', () => {
    const { container } = renderChart({ isLoading: true, sentryBuckets: [] });

    const skeleton = container.querySelector('.animate-pulse');
    expect(skeleton).not.toBeNull();
    expect(skeleton).toHaveStyle({ height: '256px' });
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });

  it('renders a retry-able error, forwards onRetry, and hides the chart even with data present', () => {
    const onRetry = vi.fn();
    renderChart({
      error: new Error('boom'),
      onRetry,
      sentryBuckets: [bucket()],
    });

    // Plain Error → QueryError's online network branch copy.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    // Error wins over non-empty data — the chart must not leak through.
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('prefers the error over a concurrent loading flag', () => {
    const { container } = renderChart({
      isLoading: true,
      error: new Error('down'),
      sentryBuckets: [],
    });

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });
});

describe('SentryModeChart — empty + null safety', () => {
  it('shows the empty state (no chart) when there are no buckets', () => {
    renderChart({ sentryBuckets: [] });

    expect(screen.getByText('No data available')).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });

  it('does not crash and shows the empty state when sentryBuckets is undefined', () => {
    // The prop is typed non-null, but the untyped API can transiently omit it.
    // A missing `Array.isArray` guard would throw on `sentryBuckets.length`.
    expect(() =>
      renderChart({
        sentryBuckets: undefined as unknown as SentryDayBucket[],
      }),
    ).not.toThrow();

    expect(screen.getByText('No data available')).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });
});

describe('SentryModeChart — styling passthrough', () => {
  it('forwards className onto the glass panel wrapper (alongside the base padding)', () => {
    const { container } = renderChart({
      sentryBuckets: [],
      className: 'xl:col-span-2',
    });

    const panel = container.firstChild as HTMLElement;
    expect(panel.className).toContain('xl:col-span-2');
    expect(panel.className).toContain('p-4');
  });
});
