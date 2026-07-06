/**
 * TimeOfUseAnalysis — behaviour + hardening coverage.
 *
 * The file exposes one component (`TimeOfUseAnalysis`) plus three pure
 * time-of-use helpers extracted during hardening so the hourly bars and the
 * legend can share a single colour source (they previously drifted: the peak
 * legend dot was rose-500 while the bar was red-500, and the mid dot was
 * neon-cyan while the bar was cyan-400). This suite drives every export and the
 * behaviour that matters:
 *   - `classifyHour` — the peak (14–19) / off-peak (22–05) / mid-peak
 *     classifier including its inclusive boundaries and the non-finite /
 *     out-of-range normalisation guard,
 *   - `hourColor` + `TOU_PERIOD_COLORS` — the shared swatch map the bars AND
 *     the legend both read from,
 *   - the component's four mutually-exclusive <CostSection> states (loading →
 *     error → empty → content) plus the null-safe `hourlyData ?? []` crash
 *     guard (an `undefined` prop must render the empty state, never throw),
 *   - the chart wiring (data, series binding, X-axis interval, Y tick format)
 *     and the per-hour cell colours,
 *   - the legend rendering the SAME colours as the bars,
 *   - the ToU insight cards (populated) and their per-hour empty fallback,
 *   - and the accessible chart image label + heading structure.
 *
 * Only the `@/components/charts` barrel is doubled — recharts' real
 * ResponsiveContainer renders 0×0 in jsdom, so the series/data/cells would be
 * unobservable otherwise. The error path renders the REAL <CostSection> +
 * <QueryError> so the `role="alert"` + Retry copy are genuinely exercised;
 * `@testing-library/user-event` is not a dependency of this repo, so
 * `fireEvent` drives the interaction. Network is never touched — this
 * component has no data source of its own.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import {
  TimeOfUseAnalysis,
  classifyHour,
  hourColor,
  TOU_PERIOD_COLORS,
} from './TimeOfUseAnalysis';
import type { HourBucket, TouInsights } from './types';

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
//    BarChart double can surface the component-computed `data` (as JSON), the
//    series binding, the X-axis interval, the Y tick formatter, and each
//    per-hour <Cell fill> for direct assertion. ──
vi.mock('@/components/charts', () => {
  const Inert = () => null;
  return {
    chartGrid: {},
    axisTickSm: {},
    ChartTooltip: Inert,
    CartesianGrid: Inert,
    Tooltip: Inert,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    BarChart: ({ data, children }: { data?: ReadonlyArray<Record<string, unknown>>; children?: ReactNode }) => (
      <div data-testid="bar-chart">
        <span data-testid="bar-chart-data">{JSON.stringify(data ?? [])}</span>
        {children}
      </div>
    ),
    Bar: ({ dataKey, name, children }: { dataKey?: string; name?: string; children?: ReactNode }) => (
      <div data-testid="bar-series" data-key={String(dataKey ?? '')} data-name={String(name ?? '')}>
        {children}
      </div>
    ),
    Cell: ({ fill }: { fill?: string }) => <span data-testid="cell" data-fill={String(fill ?? '')} />,
    XAxis: ({ dataKey, interval }: { dataKey?: string; interval?: number }) => (
      <span data-testid="x-axis" data-key={String(dataKey ?? '')} data-interval={String(interval ?? '')} />
    ),
    YAxis: ({ tickFormatter }: { tickFormatter?: (v: number) => string }) => (
      <span data-testid="y-tick">{typeof tickFormatter === 'function' ? tickFormatter(7) : ''}</span>
    ),
  };
});

// ── fixtures ──────────────────────────────────────────────────────────────
function bucket(hour: number, over: Partial<HourBucket> = {}): HourBucket {
  return {
    hour,
    label: `${String(hour).padStart(2, '0')}:00`,
    sessions: 0,
    avgCost: 0,
    totalEnergy: 0,
    ...over,
  };
}

// One bucket per period so the cell-colour mapping is exercised end-to-end:
// 3 → off-peak, 10 → mid-peak, 16 → peak, 23 → off-peak.
const HOURLY: HourBucket[] = [
  bucket(3, { sessions: 2 }),
  bucket(10, { sessions: 4 }),
  bucket(16, { sessions: 7 }),
  bucket(23, { sessions: 1 }),
];

const INSIGHTS: TouInsights = {
  cheapest: bucket(3, { sessions: 2, avgCost: 0.12 }),
  priciest: bucket(17, { sessions: 5, avgCost: 0.35 }),
  busiest: bucket(18, { sessions: 9, avgCost: 0.3 }),
  offPeakPct: 42.5,
};

interface RenderProps {
  hourlyData?: HourBucket[];
  touInsights?: TouInsights | null;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

function renderTou({
  hourlyData = HOURLY,
  touInsights = INSIGHTS,
  ...rest
}: RenderProps = {}) {
  return render(
    <MemoryRouter>
      <TimeOfUseAnalysis hourlyData={hourlyData as HourBucket[]} touInsights={touInsights} {...rest} />
    </MemoryRouter>,
  );
}

function cellFills(): string[] {
  return screen.getAllByTestId('cell').map((c) => c.getAttribute('data-fill') ?? '');
}

// ── pure utilities ─────────────────────────────────────────────────────────
describe('classifyHour', () => {
  it('classifies the peak window 14–19 inclusive and excludes 13 / 20', () => {
    expect(classifyHour(14)).toBe('peak');
    expect(classifyHour(16)).toBe('peak');
    expect(classifyHour(19)).toBe('peak');
    expect(classifyHour(13)).toBe('mid-peak');
    expect(classifyHour(20)).toBe('mid-peak');
  });

  it('classifies the off-peak window 22–05 and treats 06 / 21 as mid-peak', () => {
    expect(classifyHour(22)).toBe('off-peak');
    expect(classifyHour(23)).toBe('off-peak');
    expect(classifyHour(0)).toBe('off-peak');
    expect(classifyHour(5)).toBe('off-peak');
    expect(classifyHour(6)).toBe('mid-peak');
    expect(classifyHour(21)).toBe('mid-peak');
  });

  it('normalises non-finite / out-of-range / fractional input into [0,23]', () => {
    // NaN → 0 → off-peak (crash-guard: a malformed bucket still gets a colour).
    expect(classifyHour(Number.NaN)).toBe('off-peak');
    expect(classifyHour(Number.POSITIVE_INFINITY)).toBe('off-peak');
    // 24 wraps to 0 (off-peak); -1 wraps to 23 (off-peak).
    expect(classifyHour(24)).toBe('off-peak');
    expect(classifyHour(-1)).toBe('off-peak');
    // 16.9 truncates to 16 (peak) — never falls through to an uncoloured bar.
    expect(classifyHour(16.9)).toBe('peak');
  });
});

describe('hourColor + TOU_PERIOD_COLORS', () => {
  it('maps each period to its canonical swatch hex', () => {
    expect(TOU_PERIOD_COLORS).toEqual({
      peak: '#ef4444',
      'mid-peak': '#22d3ee',
      'off-peak': '#10b981',
    });
  });

  it('resolves an hour to the colour of its classified period', () => {
    expect(hourColor(16)).toBe(TOU_PERIOD_COLORS.peak);
    expect(hourColor(10)).toBe(TOU_PERIOD_COLORS['mid-peak']);
    expect(hourColor(3)).toBe(TOU_PERIOD_COLORS['off-peak']);
    // The normalisation guard flows through hourColor too.
    expect(hourColor(Number.NaN)).toBe(TOU_PERIOD_COLORS['off-peak']);
  });
});

// ── component: chart wiring ─────────────────────────────────────────────────
describe('TimeOfUseAnalysis — chart wiring', () => {
  it('feeds the null-safe rows straight to the BarChart', () => {
    renderTou();
    const data = JSON.parse(screen.getByTestId('bar-chart-data').textContent || '[]');
    expect(data).toEqual(HOURLY);
  });

  it('binds the sessions series, the label X axis (interval 2) and a plain Y tick', () => {
    renderTou();
    const series = screen.getByTestId('bar-series');
    expect(series).toHaveAttribute('data-key', 'sessions');
    expect(series).toHaveAttribute('data-name', 'Sessions');

    const xAxis = screen.getByTestId('x-axis');
    expect(xAxis).toHaveAttribute('data-key', 'label');
    expect(xAxis).toHaveAttribute('data-interval', '2');

    // tickFormatter(7) → `${7}` → "7".
    expect(screen.getByTestId('y-tick')).toHaveTextContent('7');
  });

  it('colours one <Cell> per bucket by its time-of-use period', () => {
    renderTou();
    // 3 → off-peak, 10 → mid-peak, 16 → peak, 23 → off-peak.
    expect(cellFills()).toEqual([
      TOU_PERIOD_COLORS['off-peak'],
      TOU_PERIOD_COLORS['mid-peak'],
      TOU_PERIOD_COLORS.peak,
      TOU_PERIOD_COLORS['off-peak'],
    ]);
    expect(cellFills()).toEqual(HOURLY.map((r) => hourColor(r.hour)));
  });

  it('does not mutate the caller-supplied hourly array', () => {
    const source: HourBucket[] = [bucket(16, { sessions: 3 })];
    renderTou({ hourlyData: source });
    expect(source).toEqual([bucket(16, { sessions: 3 })]);
  });
});

// ── component: legend ───────────────────────────────────────────────────────
describe('TimeOfUseAnalysis — legend', () => {
  it('renders three decorative swatches whose colours match the bars', () => {
    const { container } = renderTou();
    const dots = container.querySelectorAll('span[aria-hidden="true"][style]');
    expect(dots).toHaveLength(3);
    // Same order + colours as TOU_PERIOD_COLORS → they can never drift from the bars.
    expect(dots[0]).toHaveStyle({ backgroundColor: TOU_PERIOD_COLORS.peak });
    expect(dots[1]).toHaveStyle({ backgroundColor: TOU_PERIOD_COLORS['mid-peak'] });
    expect(dots[2]).toHaveStyle({ backgroundColor: TOU_PERIOD_COLORS['off-peak'] });
  });

  it('labels each swatch with its localized period copy', () => {
    renderTou();
    expect(screen.getByText('Peak (2–7 PM)')).toBeInTheDocument();
    expect(screen.getByText('Mid-peak')).toBeInTheDocument();
    expect(screen.getByText('Off-peak (10 PM–6 AM)')).toBeInTheDocument();
  });
});

// ── component: insights ─────────────────────────────────────────────────────
describe('TimeOfUseAnalysis — insight cards', () => {
  it('renders the cheapest / priciest / busiest / off-peak cards with formatted values', () => {
    renderTou();

    expect(screen.getByText('Cheapest Hour')).toBeInTheDocument();
    expect(screen.getByText('03:00')).toBeInTheDocument();
    expect(screen.getByText('avg 0.120 / session')).toBeInTheDocument();

    expect(screen.getByText('Priciest Hour')).toBeInTheDocument();
    expect(screen.getByText('17:00')).toBeInTheDocument();
    expect(screen.getByText('avg 0.350 / session')).toBeInTheDocument();

    expect(screen.getByText('Busiest Hour')).toBeInTheDocument();
    expect(screen.getByText('18:00')).toBeInTheDocument();
    expect(screen.getByText('9 sessions')).toBeInTheDocument();

    expect(screen.getByText('Off-Peak Charging')).toBeInTheDocument();
    expect(screen.getByText('42.5%')).toBeInTheDocument();
  });

  it('falls back to an empty state (keeping the chart) when there are no insights', () => {
    renderTou({ touInsights: null });
    // The per-hour insight fallback shows...
    expect(screen.getByText('No insights available')).toBeInTheDocument();
    // ...but the hourly chart still renders and no cards leak through.
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    expect(screen.queryByText('Cheapest Hour')).not.toBeInTheDocument();
  });
});

// ── component: CostSection states ───────────────────────────────────────────
describe('TimeOfUseAnalysis — section states', () => {
  it('renders the empty state and withholds the chart for an empty array; title stays', () => {
    renderTou({ hourlyData: [] });
    expect(screen.getByText('Not enough data')).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Electricity Rate Analysis/i }),
    ).toBeInTheDocument();
  });

  it('treats an undefined hourlyData prop as empty instead of throwing (crash guard)', () => {
    // Render directly (not via the helper) so a genuine `undefined` reaches the
    // component rather than the helper's default HOURLY fixture.
    const renderUndefined = () =>
      render(
        <MemoryRouter>
          <TimeOfUseAnalysis
            hourlyData={undefined as unknown as HourBucket[]}
            touInsights={null}
          />
        </MemoryRouter>,
      );
    expect(renderUndefined).not.toThrow();
    expect(screen.getByText('Not enough data')).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });

  it('shows the skeleton (not the chart or empty copy) while loading', () => {
    const { container } = renderTou({ isLoading: true });
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
    expect(screen.queryByText('Not enough data')).not.toBeInTheDocument();
    // Chrome still frames the loading state.
    expect(
      screen.getByRole('heading', { name: /Electricity Rate Analysis/i }),
    ).toBeInTheDocument();
  });

  it('renders a retryable QueryError and hides the chart on failure', () => {
    const onRetry = vi.fn();
    renderTou({ error: new Error('boom'), onRetry });

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^retry$/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('prioritises the error banner over supplied hourly data (error wins)', () => {
    renderTou({ hourlyData: HOURLY, error: new Error('stale') });
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });
});

// ── component: accessibility ────────────────────────────────────────────────
describe('TimeOfUseAnalysis — accessibility', () => {
  it('exposes the chart as an accessible image and structures the headings', () => {
    renderTou();
    expect(
      screen.getByRole('img', {
        name: 'Charging sessions by hour of day with peak and off-peak coloring',
      }),
    ).toBeInTheDocument();
    // Panel heading (h3) + the insights subheading (h4).
    expect(
      screen.getByRole('heading', { level: 3, name: /Electricity Rate Analysis/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Insights' })).toBeInTheDocument();
  });
});
