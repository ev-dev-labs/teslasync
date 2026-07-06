/**
 * HoursTrendPanel — behaviour + hardening coverage.
 *
 * The panel owns four mutually-exclusive presentation paths driven by its
 * props: a truthy `isLoading` shows a skeleton; an `error` short-circuits to a
 * retryable <QueryError> banner; an empty (or undefined) point set surfaces an
 * accessible <EmptyState> instead of a blank set of axes; otherwise the
 * remaining-runtime line chart is drawn. This suite drives every path and
 * asserts the behaviour that matters:
 *   - the panel chrome (localized title heading + a decorative, aria-hidden
 *     icon) always frames the section, in every branch,
 *   - the null-safe, memoised `rows` derivation feeds the guarded points to the
 *     recharts <LineChart> and binds the i18n series name / value key / cyan
 *     stroke / labelled X axis / " h"-suffixed Y axis,
 *   - the per-point `?? 0` / `?? ''` guards and the `points ?? []` crash guard
 *     (an `undefined` prop must render the empty state, never throw),
 *   - the line is drawn clean (dots off, active dot r=4, animation disabled),
 *   - the caller-supplied array is never mutated in place,
 *   - the loading / empty branches withhold the chart but keep the chrome,
 *   - and the error branch surfaces a retryable QueryError whose Retry button
 *     invokes `onRetry`, winning even over supplied data.
 *
 * Only the `@/components/charts` barrel is doubled — its ResponsiveContainer
 * renders 0×0 in jsdom, so the series/data would otherwise be unobservable. The
 * `@/components/feedback` EmptyState / Skeleton / QueryError are the REAL
 * implementations so the rendered `role="status"` / `role="alert"` + copy are
 * genuinely exercised. `useOnlineStatus` is pinned online so QueryError lands
 * on its retryable "Can't reach server" branch. `@testing-library/user-event`
 * is not a dependency of this repo, so `fireEvent` drives the interaction.
 * This component has no data source of its own, so the network is never
 * touched.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import type { TrendPoint } from './constants';
import { HoursTrendPanel } from './HoursTrendPanel';

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

// ── keep the real QueryError on its online "Can't reach server" branch so the
//    Retry button is enabled (offline would disable it + auto-retry instead). ──
vi.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));

// ── charts barrel double: ResponsiveContainer renders its children so the
//    LineChart double can surface the component-computed `data` (as JSON) plus
//    the series/axis bindings for direct assertion. `chartGrid` is a renderable
//    node in the real barrel — the component drops it in as a child, so the
//    double must be a valid node too (null renders nothing). ──
vi.mock('@/components/charts', () => {
  const Inert = () => null;
  return {
    chartGrid: null,
    axisTickSm: { fontSize: 10 },
    ChartTooltip: Inert,
    Tooltip: Inert,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    LineChart: ({
      data,
      children,
    }: {
      data?: ReadonlyArray<Record<string, unknown>>;
      children?: ReactNode;
    }) => (
      <div data-testid="line-chart">
        <span data-testid="line-chart-data">{JSON.stringify(data ?? [])}</span>
        {children}
      </div>
    ),
    Line: ({
      dataKey,
      name,
      stroke,
      dot,
      activeDot,
      isAnimationActive,
    }: {
      dataKey?: string;
      name?: string;
      stroke?: string;
      dot?: unknown;
      activeDot?: unknown;
      isAnimationActive?: boolean;
    }) => (
      <span
        data-testid="line-series"
        data-key={String(dataKey ?? '')}
        data-name={String(name ?? '')}
        data-stroke={String(stroke ?? '')}
        data-dot={String(dot)}
        data-active-dot={JSON.stringify(activeDot ?? null)}
        data-animation={String(isAnimationActive)}
      />
    ),
    XAxis: ({ dataKey }: { dataKey?: string }) => (
      <span data-testid="x-axis" data-key={String(dataKey ?? '')} />
    ),
    YAxis: ({ unit }: { unit?: string }) => (
      <span data-testid="y-axis" data-unit={String(unit ?? '')} />
    ),
  };
});

const TREND: TrendPoint[] = [
  { ts: '2026-07-04T10:00:00Z', label: '10:00', value: 8.2 },
  { ts: '2026-07-04T10:05:00Z', label: '10:05', value: 7.9 },
  { ts: '2026-07-04T10:10:00Z', label: '10:10', value: 7.5 },
];

type PanelProps = {
  points?: TrendPoint[];
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
};

function renderPanel({ points = TREND, isLoading = false, error = null, onRetry }: PanelProps = {}) {
  const retry = onRetry ?? vi.fn();
  const utils = render(
    <MemoryRouter>
      <HoursTrendPanel
        points={points as TrendPoint[]}
        isLoading={isLoading}
        error={error}
        onRetry={retry}
      />
    </MemoryRouter>,
  );
  return { ...utils, onRetry: retry };
}

/** Rows the recharts LineChart double received as its `data` prop. */
function readChartRows(): TrendPoint[] {
  return JSON.parse(screen.getByTestId('line-chart-data').textContent || '[]');
}

describe('HoursTrendPanel — panel chrome & a11y', () => {
  it('always frames the panel with the localized title heading and a decorative (aria-hidden) icon', () => {
    const { container } = renderPanel();

    expect(
      screen.getByRole('heading', { name: /Remaining Runtime Trend/i }),
    ).toBeInTheDocument();
    // The lucide icon in the header is purely decorative and hidden from AT.
    expect(container.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThan(0);
  });

  it('keeps the title chrome framing the section even when there is nothing to plot', () => {
    renderPanel({ points: [] });

    expect(
      screen.getByRole('heading', { name: /Remaining Runtime Trend/i }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
  });
});

describe('HoursTrendPanel — populated', () => {
  it('feeds the null-safe rows to the line chart and hides the empty state', () => {
    renderPanel({ points: TREND });

    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
    expect(readChartRows()).toEqual(TREND);
    // No EmptyState (role="status") when data is present.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('binds the runtime series (value key, i18n name, cyan stroke) and the labelled / unit-suffixed axes', () => {
    renderPanel({ points: TREND });

    const series = screen.getByTestId('line-series');
    expect(series).toHaveAttribute('data-key', 'value');
    // The "Hours Remaining" literal is routed through t() — the mock resolves
    // the English fallback, proving the string is translatable.
    expect(series).toHaveAttribute('data-name', 'Hours Remaining');
    expect(series).toHaveAttribute('data-stroke', '#06b6d4');
    expect(screen.getByTestId('x-axis')).toHaveAttribute('data-key', 'label');
    expect(screen.getByTestId('y-axis')).toHaveAttribute('data-unit', ' h');
  });

  it('draws a clean line: dots off, a stable active-dot radius, and animation disabled', () => {
    renderPanel({ points: TREND });

    const series = screen.getByTestId('line-series');
    expect(series).toHaveAttribute('data-dot', 'false');
    expect(series).toHaveAttribute('data-active-dot', '{"r":4}');
    expect(series).toHaveAttribute('data-animation', 'false');
  });

  it('does not mutate the caller-supplied points array in place', () => {
    const source: TrendPoint[] = [{ ts: '2026-07-04T10:00:00Z', label: '10:00', value: 8.2 }];
    renderPanel({ points: source });

    // The component copies via .map() before rendering — the source is untouched.
    expect(source).toEqual([{ ts: '2026-07-04T10:00:00Z', label: '10:00', value: 8.2 }]);
    expect(readChartRows()).toEqual(source);
  });
});

describe('HoursTrendPanel — null-safety & malformed points', () => {
  it('coerces a missing value / label to 0 / empty string so the chart still plots', () => {
    renderPanel({
      points: [
        { ts: '2026-07-04T10:00:00Z', label: undefined, value: undefined } as unknown as TrendPoint,
        { ts: '2026-07-04T10:05:00Z', label: '10:05', value: 7.9 },
      ],
    });

    const rows = readChartRows();
    expect(rows[0]).toEqual({ ts: '2026-07-04T10:00:00Z', label: '', value: 0 });
    expect(rows[1]).toEqual({ ts: '2026-07-04T10:05:00Z', label: '10:05', value: 7.9 });
    // A guarded point is still data, not an empty state.
    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
  });

  it('treats an undefined points prop as empty instead of throwing (crash guard)', () => {
    // Render directly (not via the helper) so a genuine `undefined` reaches the
    // component rather than the helper default replacing it while destructuring.
    const renderUndefined = () =>
      render(
        <MemoryRouter>
          <HoursTrendPanel
            points={undefined as unknown as TrendPoint[]}
            isLoading={false}
            error={null}
            onRetry={vi.fn()}
          />
        </MemoryRouter>,
      );
    expect(renderUndefined).not.toThrow();

    expect(screen.getByRole('status')).toHaveTextContent(/No runtime readings yet/i);
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
  });
});

describe('HoursTrendPanel — empty', () => {
  it('renders the accessible empty state and withholds the chart; chrome stays', () => {
    renderPanel({ points: [] });

    expect(screen.getByRole('status')).toHaveTextContent(
      'No runtime readings yet. Estimated hours appear once Powershare reports telemetry.',
    );
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Remaining Runtime Trend/i }),
    ).toBeInTheDocument();
  });
});

describe('HoursTrendPanel — loading', () => {
  it('shows the skeleton and withholds both the chart and the empty state while isLoading', () => {
    const { container } = renderPanel({ points: TREND, isLoading: true });

    // The <Skeleton> is a pulsing placeholder — loading beats data.
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
    // Neither the empty state (status) nor an error (alert) shows while loading.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // The title still frames the panel while loading.
    expect(
      screen.getByRole('heading', { name: /Remaining Runtime Trend/i }),
    ).toBeInTheDocument();
  });
});

describe('HoursTrendPanel — error branch (real QueryError)', () => {
  it('renders a retryable QueryError and hides the chart on failure', () => {
    const onRetry = vi.fn();
    renderPanel({ error: new Error('boom'), onRetry });

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // The chart is not rendered on the error path.
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
    // The title still frames the error via the panel chrome.
    expect(
      screen.getByRole('heading', { name: /Remaining Runtime Trend/i }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^retry$/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('prioritises the error banner over supplied points (error wins over data)', () => {
    // Even with a full trend passed, a truthy error short-circuits the chart.
    renderPanel({ points: TREND, error: new Error('stale') });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
  });
});
