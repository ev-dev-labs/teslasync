/**
 * SignalGapHealthPanel contract tests.
 *
 * SignalGapHealthPanel is a self-gating, prop-driven presentational panel: it
 * owns no fetching and decides HOW to render whatever `analysis` (a derived
 * query bundle) and `hasVehicle` flag the page hands it. The behaviour locked
 * in here:
 *
 *   1. Header — the "Signal Health Distribution" title is always present in a
 *      level-3 heading with a decorative (aria-hidden) Activity glyph, so the
 *      panel never collapses to nothing regardless of state.
 *   2. State machine & precedence — the body resolves to exactly one of five
 *      mutually exclusive states in a fixed priority order:
 *      no-vehicle → loading → error → empty(total 0) → distribution. Each higher
 *      state wins even when a lower-priority condition is simultaneously true.
 *   3. Error recovery — the error branch forwards the query error and wires the
 *      retry affordance back to `query.refetch()`.
 *   4. Distribution body — the proportional staleness strip is an accessible
 *      role="img" whose label reports the signal total; only non-zero buckets
 *      draw a segment (sized by share of total) while the legend always lists
 *      all four buckets (including zeros); the bar chart is fed all four
 *      segments, each Cell painted from the canonical bucket palette.
 *   5. Null-safety (the hardened source) — a malformed `buckets` with missing
 *      numeric fields collapses each count to 0 (never NaN / undefined), and a
 *      missing `total` is treated as empty rather than rendering a broken chart.
 *
 * react-i18next is stubbed to echo the English fallback AND interpolate
 * `{{var}}` placeholders so copy + the strip's dynamic aria-label are asserted
 * independently of the locale bundle. The charts barrel and the feedback barrel
 * are doubled with lightweight stand-ins: recharts paints at 0x0 in jsdom, and
 * <QueryError> otherwise needs a Router; the doubles surface the props the panel
 * binds (segment count, bar name, cell fills, error, onRetry) as DOM. The shared
 * <GlassPanel>/<PanelTitle>/<Text>/<Caption> primitives render for real so the
 * true title → strip → legend → chart wiring is exercised end-to-end.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: unknown, options?: Record<string, unknown>) => {
      const template = typeof defaultValue === 'string' ? defaultValue : key;
      const vars =
        options && typeof options === 'object'
          ? options
          : defaultValue && typeof defaultValue === 'object'
            ? (defaultValue as Record<string, unknown>)
            : undefined;
      return vars
        ? template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) => String(vars[name] ?? ''))
        : template;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// Charts barrel double. recharts renders nothing measurable at jsdom's 0x0
// layout, so the BarChart / Bar / Cell / axes echo their bound props as
// data-* attributes to make the segment count, series name and per-bucket
// fills observable.
/* eslint-disable @typescript-eslint/no-explicit-any */
vi.mock('@/components/charts', () => ({
  ResponsiveContainer: ({ children }: any) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  BarChart: ({ children, data }: any) => (
    <div data-testid="bar-chart" data-count={String((data ?? []).length)}>
      {children}
    </div>
  ),
  Bar: ({ children, name, dataKey }: any) => (
    <div data-testid="bar" data-name={String(name)} data-key={String(dataKey)}>
      {children}
    </div>
  ),
  Cell: ({ fill }: any) => <div data-testid="cell" data-fill={String(fill)} />,
  XAxis: ({ dataKey }: any) => <div data-testid="x-axis" data-key={String(dataKey)} />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  ChartTooltip: () => <div data-testid="chart-tooltip" />,
}));

// Feedback barrel double. <QueryError> reaches for a Router (useNavigate) which
// a bare render() doesn't provide; the stand-ins surface only what the panel
// binds — the empty-state message, the skeleton height, and the error + retry
// wiring — so the branch choice and recovery path are observable.
vi.mock('@/components/feedback', () => ({
  Skeleton: ({ height }: any) => <div data-testid="skeleton" data-height={String(height)} />,
  EmptyState: ({ message }: any) => <div data-testid="empty-state">{message}</div>,
  QueryError: ({ error, onRetry }: any) => (
    <div data-testid="query-error">
      <span data-testid="query-error-message">{(error as Error)?.message ?? ''}</span>
      <button type="button" onClick={onRetry}>
        retry
      </button>
    </div>
  ),
}));
/* eslint-enable @typescript-eslint/no-explicit-any */

import { SignalGapHealthPanel } from './SignalGapHealthPanel';
import type { SignalGapAnalysis } from '../hooks/useSignalGapAnalysis';
import { GAP_BUCKET_COLORS, type GapBuckets } from '../signalGapUtils';

type QueryOverrides = Partial<{
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}>;

const EMPTY_BUCKETS: GapBuckets = { total: 0, active: 0, aging: 0, stale: 0, never: 0 };

/** A well-formed distribution: 3 active, 2 aging, 5 stale, 0 never of 10. */
const POPULATED_BUCKETS: GapBuckets = { total: 10, active: 3, aging: 2, stale: 5, never: 0 };

function makeQuery(overrides: QueryOverrides = {}): SignalGapAnalysis['query'] {
  return {
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  } as unknown as SignalGapAnalysis['query'];
}

function makeAnalysis(buckets: GapBuckets, query: QueryOverrides = {}): SignalGapAnalysis {
  return {
    query: makeQuery(query),
    rows: [],
    buckets,
    freshnessPct: 0,
    topStale: [],
  };
}

function renderPanel(
  overrides: { hasVehicle?: boolean; buckets?: GapBuckets; query?: QueryOverrides } = {},
) {
  const { hasVehicle = true, buckets = POPULATED_BUCKETS, query } = overrides;
  return render(
    <SignalGapHealthPanel analysis={makeAnalysis(buckets, query)} hasVehicle={hasVehicle} />,
  );
}

/** Assert none of the four non-header bodies rendered (for the terminal states). */
function expectNoBody() {
  expect(screen.queryByTestId('bar-chart')).toBeNull();
  expect(screen.queryByRole('img')).toBeNull();
}

// ── Header (always present) ───────────────────────────────────────────────────

describe('SignalGapHealthPanel — header', () => {
  it('always renders the distribution title in a level-3 heading with a decorative glyph', () => {
    const { container } = renderPanel({ hasVehicle: false });

    expect(
      screen.getByRole('heading', { level: 3, name: 'Signal Health Distribution' }),
    ).toBeInTheDocument();
    // The header Activity glyph is decorative so a screen reader announces the
    // title, not the icon.
    expect(container.querySelector('.lucide-activity')).toHaveAttribute('aria-hidden', 'true');
  });
});

// ── State machine & precedence ────────────────────────────────────────────────

describe('SignalGapHealthPanel — no-vehicle state', () => {
  it('prompts for a vehicle and renders no data body when none is selected', () => {
    renderPanel({ hasVehicle: false });

    expect(screen.getByTestId('empty-state')).toHaveTextContent(
      'Select a vehicle to inspect its signal freshness.',
    );
    expect(screen.queryByTestId('skeleton')).toBeNull();
    expect(screen.queryByTestId('query-error')).toBeNull();
    expectNoBody();
  });

  it('wins over a simultaneously-loading query (no-vehicle has top priority)', () => {
    renderPanel({ hasVehicle: false, query: { isLoading: true } });

    expect(screen.getByTestId('empty-state')).toHaveTextContent('Select a vehicle');
    expect(screen.queryByTestId('skeleton')).toBeNull();
  });
});

describe('SignalGapHealthPanel — loading state', () => {
  it('renders the sized skeleton while the query is loading', () => {
    renderPanel({ hasVehicle: true, query: { isLoading: true } });

    const skeleton = screen.getByTestId('skeleton');
    expect(skeleton).toBeInTheDocument();
    expect(skeleton).toHaveAttribute('data-height', '260');
    expect(screen.queryByTestId('empty-state')).toBeNull();
    expectNoBody();
  });

  it('wins over a simultaneous error (loading outranks error)', () => {
    renderPanel({
      hasVehicle: true,
      query: { isLoading: true, isError: true, error: new Error('boom') },
    });

    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('query-error')).toBeNull();
  });
});

describe('SignalGapHealthPanel — error state', () => {
  it('forwards the query error to <QueryError>', () => {
    renderPanel({
      hasVehicle: true,
      query: { isError: true, error: new Error('signal fetch failed') },
    });

    expect(screen.getByTestId('query-error')).toBeInTheDocument();
    expect(screen.getByTestId('query-error-message')).toHaveTextContent('signal fetch failed');
    expectNoBody();
  });

  it('wires the retry affordance back to query.refetch()', () => {
    const refetch = vi.fn();
    renderPanel({
      hasVehicle: true,
      query: { isError: true, error: new Error('nope'), refetch },
    });

    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('wins over an empty bucket total (error outranks empty)', () => {
    renderPanel({
      hasVehicle: true,
      buckets: EMPTY_BUCKETS,
      query: { isError: true, error: new Error('still an error') },
    });

    expect(screen.getByTestId('query-error')).toBeInTheDocument();
    expect(screen.queryByTestId('empty-state')).toBeNull();
  });
});

describe('SignalGapHealthPanel — empty state', () => {
  it('shows the no-data empty state when the total is zero', () => {
    renderPanel({ hasVehicle: true, buckets: EMPTY_BUCKETS });

    expect(screen.getByTestId('empty-state')).toHaveTextContent('No signal data available');
    expectNoBody();
  });
});

// ── Distribution body ─────────────────────────────────────────────────────────

describe('SignalGapHealthPanel — distribution strip', () => {
  it('exposes the proportional strip as a labelled image reporting the total', () => {
    renderPanel({ buckets: POPULATED_BUCKETS });

    expect(
      screen.getByRole('img', { name: 'Staleness distribution across 10 signals' }),
    ).toBeInTheDocument();
  });

  it('sizes each non-zero segment by its share of the total', () => {
    renderPanel({ buckets: POPULATED_BUCKETS });

    // 3/10, 2/10, 5/10 → 30% / 20% / 50%.
    expect(screen.getByTitle('Active (<30s): 3')).toHaveStyle({ width: '30%' });
    expect(screen.getByTitle('Aging (<5min): 2')).toHaveStyle({ width: '20%' });
    expect(screen.getByTitle('Stale (>5min): 5')).toHaveStyle({ width: '50%' });
  });

  it('omits a strip segment for an empty bucket (zero draws nothing)', () => {
    renderPanel({ buckets: POPULATED_BUCKETS });

    // `never` is 0 here — it must not paint a strip segment...
    expect(screen.queryByTitle(/^Never Received:/)).toBeNull();
  });
});

describe('SignalGapHealthPanel — distribution legend', () => {
  it('lists all four buckets with their counts, including the zero bucket', () => {
    renderPanel({ buckets: POPULATED_BUCKETS });

    // ...but the legend ALWAYS lists every bucket, zero included.
    expect(screen.getByText('Active (<30s)')).toBeInTheDocument();
    expect(screen.getByText('Aging (<5min)')).toBeInTheDocument();
    expect(screen.getByText('Stale (>5min)')).toBeInTheDocument();
    expect(screen.getByText('Never Received')).toBeInTheDocument();

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('marks the four legend swatches decorative (aria-hidden)', () => {
    const { container } = renderPanel({ buckets: POPULATED_BUCKETS });

    const swatches = container.querySelectorAll('span[aria-hidden="true"]');
    expect(swatches).toHaveLength(4);
  });
});

describe('SignalGapHealthPanel — distribution chart', () => {
  it('feeds all four segments to the bar chart under the "Signals" series', () => {
    renderPanel({ buckets: POPULATED_BUCKETS });

    expect(screen.getByTestId('bar-chart')).toHaveAttribute('data-count', '4');
    const bar = screen.getByTestId('bar');
    expect(bar).toHaveAttribute('data-name', 'Signals');
    expect(bar).toHaveAttribute('data-key', 'count');
    expect(screen.getByTestId('x-axis')).toHaveAttribute('data-key', 'label');
  });

  it('paints each cell from the canonical bucket palette in bucket order', () => {
    renderPanel({ buckets: POPULATED_BUCKETS });

    const cells = screen.getAllByTestId('cell');
    expect(cells).toHaveLength(4);
    expect(cells[0]).toHaveAttribute('data-fill', GAP_BUCKET_COLORS.active);
    expect(cells[1]).toHaveAttribute('data-fill', GAP_BUCKET_COLORS.aging);
    expect(cells[2]).toHaveAttribute('data-fill', GAP_BUCKET_COLORS.stale);
    expect(cells[3]).toHaveAttribute('data-fill', GAP_BUCKET_COLORS.never);
  });
});

// ── Null-safety (hardened source) ─────────────────────────────────────────────

describe('SignalGapHealthPanel — null-safety', () => {
  it('collapses missing bucket counts to 0 without emitting NaN', () => {
    // A malformed bucket bag: a positive total but no per-bucket counts. The
    // `?? 0` guards must render "0" for every legend entry and keep the strip
    // width math finite (no "NaN%").
    const malformed = { total: 3 } as unknown as GapBuckets;
    const { container } = renderPanel({ hasVehicle: true, buckets: malformed });

    // Still a distribution (total > 0), announced with the real total.
    expect(
      screen.getByRole('img', { name: 'Staleness distribution across 3 signals' }),
    ).toBeInTheDocument();
    // Every legend count collapsed to 0 → four zeroes, none of them "NaN".
    expect(screen.getAllByText('0')).toHaveLength(4);
    expect(container.textContent ?? '').not.toContain('NaN');
    // With every count at 0, the strip draws no segments.
    expect(screen.queryByTitle(/:/)).toBeNull();
  });

  it('treats a missing total as empty rather than rendering a broken chart', () => {
    const noTotal = {} as unknown as GapBuckets;
    renderPanel({ hasVehicle: true, buckets: noTotal });

    expect(screen.getByTestId('empty-state')).toHaveTextContent('No signal data available');
    expect(screen.queryByTestId('bar-chart')).toBeNull();
  });
});
