/**
 * SignalChartPanel contract tests.
 *
 * SignalChartPanel is a pure, prop-driven presentational chart shell: it owns no
 * data fetching and simply decides HOW to render whatever `data` / `selectedSignals`
 * / `stats` the caller hands it. The behaviour locked in here:
 *
 *   1. Header & title — the title resolves to a mode default ("Signal Chart" /
 *      "Live Signal Stream") or an explicit override, always inside a level-2
 *      heading, with the correct (decorative, aria-hidden) status glyph.
 *   2. Live annotations — the event/point counters pass through `fmtInt`
 *      (locale separators) and `liveEventCount ?? 0` collapses a missing count
 *      to zero rather than "NaN".
 *   3. Historical annotations — the "points loaded" badge shows only when data
 *      is present AND `pointsLoaded` is non-null (0 is a valid count).
 *   4. Loading / empty states — a labelled loading status (skeleton) for
 *      historical loads; a live "waiting" status that ignores the loading flag;
 *      distinct historical vs live empty states, each announced via role=status.
 *   5. Mode resolution — overlay vs small-multiples grid across the
 *      overlay/grid/auto matrix, including the "grid needs ≥2 signals" rule and
 *      a custom `gridAutoThreshold`; the grid receives cell height + a
 *      mode-scoped sync id.
 *   6. Overlay internals — one line per signal (keyed + named), and the
 *      auto dual-axis decision (a right axis + right-bound second series only
 *      when the first two signal ranges diverge by >10×), plus the
 *      isLive→no-animation switch.
 *   7. Null-safety (the hardened source) — undefined `data` / `selectedSignals`
 *      / `stats` never crash the panel.
 *
 * react-i18next echoes the English fallback/key so copy is locale-independent.
 * <FadeIn> is flattened (framer-motion / matchMedia are irrelevant), and the
 * charts barrel is doubled with lightweight stand-ins that surface the props
 * SignalChartPanel binds (series keys, axis ids, animation, margins, sync id)
 * as DOM attributes — jsdom paints recharts at 0×0 so the real SVG is invisible.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// Flatten the entry animation — framer-motion / matchMedia are irrelevant here.
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

// Charts barrel double. The overlay `LineChart` / `Line` / axes and the grid
// `SmallMultiplesChart` echo their bound props as data-* attributes so the
// mode/axis/animation wiring is observable without recharts' real layout.
 
vi.mock('@/components/charts', async () => {
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return {
    EmbeddedChart: chartTestDoubles.EmbeddedChart,
    ChartLegend: chartTestDoubles.ChartLegend,
    ResponsiveContainer: ({ children }: any) => (
      <div data-testid="responsive-container">{children}</div>
    ),
    LineChart: ({ children, margin }: any) => (
      <div data-testid="line-chart" data-margin-right={String(margin?.right)}>
        {children}
      </div>
    ),
    Line: ({ dataKey, name, yAxisId, isAnimationActive, connectNulls, stroke }: any) => (
      <div
        data-testid="line"
        data-key={String(dataKey)}
        data-name={String(name)}
        data-yaxis={String(yAxisId)}
        data-animated={String(isAnimationActive)}
        data-connect-nulls={String(connectNulls)}
        data-stroke={String(stroke)}
      />
    ),
  XAxis: ({ dataKey }: any) => <div data-testid="x-axis" data-key={String(dataKey)} />,
  YAxis: ({ yAxisId, orientation }: any) => (
    <div data-testid={`y-axis-${yAxisId}`} data-orientation={orientation ?? 'left'} />
  ),
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  SmallMultiplesChart: ({ series, cellHeight, syncId }: any) => (
    <div
      data-testid="small-multiples"
      data-series={(series ?? []).join(',')}
      data-cell-height={String(cellHeight)}
      data-sync-id={String(syncId)}
    />
  ),
  };
});
 

import { SignalChartPanel, type SignalChartPanelProps } from './SignalChartPanel';
import type { SignalStat } from '../hooks/useLiveSignalStream';

// U+00B7 middle dot joins the live event/point counters. Declared via an escape
// so the assertions stay independent of this file's byte encoding.
const DOT = '\u00B7';

const BASE_STATS: SignalStat[] = [{ signal: 'speed', min: 0, max: 100, avg: 50, count: 3 }];
const BASE_DATA: Record<string, unknown>[] = [
  { timestamp: '2024-01-01T00:00:00Z', speed: 10 },
  { timestamp: '2024-01-01T00:00:05Z', speed: 20 },
];

/** Two comparable-range signals — the auto dual-axis heuristic stays single-axis. */
const COMPARABLE_STATS: SignalStat[] = [
  { signal: 'a', min: 0, max: 100, avg: 50, count: 1 },
  { signal: 'b', min: 0, max: 90, avg: 45, count: 1 },
];
/** Two divergent-range signals (1000 vs 10 → >10×) — triggers the right axis. */
const DIVERGENT_STATS: SignalStat[] = [
  { signal: 'a', min: 0, max: 1000, avg: 500, count: 1 },
  { signal: 'b', min: 0, max: 10, avg: 5, count: 1 },
];
const TWO_SERIES_DATA: Record<string, unknown>[] = [{ timestamp: 't', a: 1, b: 2 }];

/** Build a single row that carries a value for every provided signal. */
function rowFor(signals: string[]): Record<string, unknown> {
  return signals.reduce<Record<string, unknown>>((row, s) => ({ ...row, [s]: 1 }), {
    timestamp: 't',
  });
}

function renderPanel(overrides: Partial<SignalChartPanelProps> = {}) {
  const props: SignalChartPanelProps = {
    selectedSignals: ['speed'],
    data: BASE_DATA,
    stats: BASE_STATS,
    ...overrides,
  };
  return render(<SignalChartPanel {...props} />);
}

// ── Header & title ────────────────────────────────────────────────────────────

describe('SignalChartPanel — header & title', () => {
  it('renders the historical title in an h2 with a decorative bar-chart glyph', () => {
    const { container } = renderPanel();

    expect(
      screen.getByRole('heading', { level: 2, name: 'Signal Chart' }),
    ).toBeInTheDocument();
    expect(container.querySelector('.lucide-bar-chart3')).not.toBeNull();
    expect(container.querySelector('.lucide-radio')).toBeNull();
  });

  it('renders the live title with the radio glyph and hides the bar-chart glyph', () => {
    const { container } = renderPanel({ isLive: true, data: [] });

    expect(
      screen.getByRole('heading', { level: 2, name: 'Live Signal Stream' }),
    ).toBeInTheDocument();
    expect(container.querySelector('.lucide-radio')).not.toBeNull();
    expect(container.querySelector('.lucide-bar-chart3')).toBeNull();
  });

  it('prefers an explicit title over the mode default', () => {
    renderPanel({ isLive: true, title: 'Custom Title' });

    expect(
      screen.getByRole('heading', { level: 2, name: 'Custom Title' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Live Signal Stream')).toBeNull();
  });

  it('marks the header status glyph aria-hidden so screen readers skip it', () => {
    const { container } = renderPanel();

    expect(container.querySelector('.lucide-bar-chart3')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });
});

// ── Live annotations ──────────────────────────────────────────────────────────

describe('SignalChartPanel — live annotations', () => {
  it('surfaces the live event + point counters through fmtInt with separators', () => {
    const { container } = renderPanel({
      isLive: true,
      liveEventCount: 1234,
      data: BASE_DATA, // length 2
    });

    // fmtInt(1234) → "1,234"; fmtInt(data.length=2) → "2".
    expect(container).toHaveTextContent(`1,234 events ${DOT} 2 points`);
    const dot = container.querySelector('.bg-red-500.rounded-full');
    expect(dot).toHaveAttribute('aria-hidden', 'true');
  });

  it('collapses a missing liveEventCount to zero (never NaN)', () => {
    const { container } = renderPanel({
      isLive: true,
      liveEventCount: undefined,
      data: [],
    });

    expect(container).toHaveTextContent(`0 events ${DOT} 0 points`);
    expect(container).not.toHaveTextContent('NaN');
  });
});

// ── Historical annotations ────────────────────────────────────────────────────

describe('SignalChartPanel — historical annotations', () => {
  it('shows the points-loaded badge when data and pointsLoaded are present', () => {
    renderPanel({ pointsLoaded: 1500, data: BASE_DATA });

    expect(screen.getByText(/points loaded/)).toHaveTextContent('1,500 points loaded');
  });

  it('renders a zero points-loaded badge (0 is a valid count)', () => {
    renderPanel({ pointsLoaded: 0, data: BASE_DATA });

    expect(screen.getByText(/points loaded/)).toHaveTextContent('0 points loaded');
  });

  it('omits the points-loaded badge when pointsLoaded is undefined', () => {
    renderPanel({ pointsLoaded: undefined, data: BASE_DATA });

    expect(screen.queryByText(/points loaded/)).toBeNull();
  });

  it('omits the points-loaded badge when there is no data', () => {
    renderPanel({ pointsLoaded: 1500, data: [] });

    expect(screen.queryByText(/points loaded/)).toBeNull();
  });
});

// ── Loading state ─────────────────────────────────────────────────────────────

describe('SignalChartPanel — loading state', () => {
  it('renders a labelled loading status with a skeleton for historical loads', () => {
    const { container } = renderPanel({ loading: true });

    expect(screen.getByRole('status', { name: /Loading chart/ })).toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    // The chart body must NOT render while loading.
    expect(screen.queryByTestId('line-chart')).toBeNull();
    expect(screen.queryByTestId('small-multiples')).toBeNull();
  });

  it('ignores the loading flag in live mode and shows the waiting state', () => {
    renderPanel({ loading: true, isLive: true, data: [] });

    expect(screen.queryByRole('status', { name: /Loading chart/ })).toBeNull();
    expect(screen.getByText(/Waiting for live signal data/)).toBeInTheDocument();
  });
});

// ── Empty states ──────────────────────────────────────────────────────────────

describe('SignalChartPanel — empty states', () => {
  it('shows the historical empty state announced via role=status', () => {
    renderPanel({ data: [] });

    expect(
      screen.getByText('No signal samples were recorded in this time range.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'No signal samples were recorded in this time range.',
    );
    expect(screen.getByText(/Expand the range or select another signal/)).toBeInTheDocument();
    expect(screen.queryByTestId('line-chart')).toBeNull();
  });

  it('shows the live waiting state with decorative radio glyphs', () => {
    const { container } = renderPanel({ isLive: true, data: [] });

    expect(screen.getByText(/Waiting for live signal data/)).toBeInTheDocument();
    expect(screen.getByText(/publishes the chosen signals/)).toBeInTheDocument();
    // Only the header glyph — EmbeddedChart's empty state does not add a Radio icon.
    const radios = container.querySelectorAll('.lucide-radio');
    expect(radios).toHaveLength(1);
    radios.forEach((r) => expect(r).toHaveAttribute('aria-hidden', 'true'));
  });
});

// ── Mode resolution ───────────────────────────────────────────────────────────

describe('SignalChartPanel — chart mode resolution', () => {
  it('renders the overlay line chart for a single signal', () => {
    renderPanel({ selectedSignals: ['speed'] });

    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
    expect(screen.queryByTestId('small-multiples')).toBeNull();
  });

  it('forces overlay when chartMode="grid" but only one signal is selected', () => {
    renderPanel({ chartMode: 'grid', selectedSignals: ['speed'], data: BASE_DATA });

    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
    expect(screen.queryByTestId('small-multiples')).toBeNull();
  });

  it('switches to the small-multiples grid for chartMode="grid" with ≥2 signals', () => {
    renderPanel({ chartMode: 'grid', selectedSignals: ['a', 'b'], data: TWO_SERIES_DATA });

    const grid = screen.getByTestId('small-multiples');
    expect(grid).toBeInTheDocument();
    expect(grid).toHaveAttribute('data-series', 'a,b');
    expect(screen.queryByTestId('line-chart')).toBeNull();
  });

  it('keeps overlay in auto mode at the grid threshold', () => {
    const signals = Array.from({ length: 8 }, (_, i) => `s${i}`);
    renderPanel({
      chartMode: 'auto',
      selectedSignals: signals,
      gridAutoThreshold: 8,
      data: [rowFor(signals)],
    });

    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
    expect(screen.queryByTestId('small-multiples')).toBeNull();
  });

  it('flips to grid in auto mode once the threshold is exceeded', () => {
    const signals = Array.from({ length: 9 }, (_, i) => `s${i}`);
    renderPanel({
      chartMode: 'auto',
      selectedSignals: signals,
      gridAutoThreshold: 8,
      data: [rowFor(signals)],
    });

    expect(screen.getByTestId('small-multiples')).toBeInTheDocument();
    expect(screen.queryByTestId('line-chart')).toBeNull();
  });

  it('respects a custom gridAutoThreshold', () => {
    const signals = ['a', 'b', 'c'];
    renderPanel({
      chartMode: 'auto',
      gridAutoThreshold: 2,
      selectedSignals: signals,
      data: [rowFor(signals)],
    });

    expect(screen.getByTestId('small-multiples')).toBeInTheDocument();
    expect(screen.queryByTestId('line-chart')).toBeNull();
  });

  it('passes the cell height and a historical-scoped sync id to the grid', () => {
    renderPanel({
      chartMode: 'grid',
      selectedSignals: ['a', 'b'],
      gridCellHeight: 200,
      data: TWO_SERIES_DATA,
    });

    const grid = screen.getByTestId('small-multiples');
    expect(grid).toHaveAttribute('data-cell-height', '200');
    expect(grid).toHaveAttribute('data-sync-id', 'signal-chart-historical');
  });

  it('scopes the grid sync id to live mode when streaming', () => {
    renderPanel({
      chartMode: 'grid',
      isLive: true,
      selectedSignals: ['a', 'b'],
      data: TWO_SERIES_DATA,
    });

    expect(screen.getByTestId('small-multiples')).toHaveAttribute(
      'data-sync-id',
      'signal-chart-live',
    );
  });
});

// ── Overlay internals ─────────────────────────────────────────────────────────

describe('SignalChartPanel — overlay internals', () => {
  it('renders one line per selected signal, keyed and named by signal', () => {
    renderPanel({
      selectedSignals: ['a', 'b'],
      chartMode: 'overlay',
      data: TWO_SERIES_DATA,
      stats: COMPARABLE_STATS,
    });

    const lines = screen.getAllByTestId('line');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveAttribute('data-key', 'a');
    expect(lines[1]).toHaveAttribute('data-name', 'b');
  });

  it('keeps a single left axis when signal ranges are comparable', () => {
    renderPanel({
      selectedSignals: ['a', 'b'],
      chartMode: 'overlay',
      data: TWO_SERIES_DATA,
      stats: COMPARABLE_STATS,
    });

    expect(screen.getByTestId('y-axis-left')).toBeInTheDocument();
    expect(screen.queryByTestId('y-axis-right')).toBeNull();
    const lines = screen.getAllByTestId('line');
    expect(lines[0]).toHaveAttribute('data-yaxis', 'left');
    expect(lines[1]).toHaveAttribute('data-yaxis', 'left');
    expect(screen.getByTestId('line-chart')).toHaveAttribute('data-margin-right', '10');
  });

  it('adds a right axis and binds the second series to it for divergent ranges', () => {
    renderPanel({
      selectedSignals: ['a', 'b'],
      chartMode: 'overlay',
      data: TWO_SERIES_DATA,
      stats: DIVERGENT_STATS,
    });

    expect(screen.getByTestId('y-axis-right')).toBeInTheDocument();
    const lines = screen.getAllByTestId('line');
    expect(lines[0]).toHaveAttribute('data-yaxis', 'left');
    expect(lines[1]).toHaveAttribute('data-yaxis', 'right');
    expect(screen.getByTestId('line-chart')).toHaveAttribute('data-margin-right', '20');
  });

  it('animates series for historical data but disables animation while live', () => {
    const { unmount } = renderPanel({
      selectedSignals: ['a', 'b'],
      chartMode: 'overlay',
      data: TWO_SERIES_DATA,
      stats: COMPARABLE_STATS,
    });
    expect(screen.getAllByTestId('line')[0]).toHaveAttribute('data-animated', 'true');
    unmount();

    renderPanel({
      selectedSignals: ['a', 'b'],
      chartMode: 'overlay',
      isLive: true,
      data: TWO_SERIES_DATA,
      stats: COMPARABLE_STATS,
    });
    expect(screen.getAllByTestId('line')[0]).toHaveAttribute('data-animated', 'false');
  });
});

// ── Null-safety (hardened source) ─────────────────────────────────────────────

describe('SignalChartPanel — null-safety', () => {
  it('renders the empty state instead of crashing when data is undefined', () => {
    expect(() =>
      renderPanel({ data: undefined as unknown as SignalChartPanelProps['data'] }),
    ).not.toThrow();
    expect(
      screen.getByText('No signal samples were recorded in this time range.'),
    ).toBeInTheDocument();
  });

  it('tolerates an undefined selectedSignals list (zero lines, no crash)', () => {
    expect(() =>
      renderPanel({
        selectedSignals: undefined as unknown as string[],
        data: BASE_DATA,
      }),
    ).not.toThrow();
    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
    expect(screen.queryAllByTestId('line')).toHaveLength(0);
  });

  it('tolerates undefined stats when deciding the axis layout', () => {
    expect(() =>
      renderPanel({
        selectedSignals: ['a', 'b'],
        chartMode: 'overlay',
        stats: undefined as unknown as SignalStat[],
        data: TWO_SERIES_DATA,
      }),
    ).not.toThrow();
    expect(screen.getByTestId('y-axis-left')).toBeInTheDocument();
    expect(screen.queryByTestId('y-axis-right')).toBeNull();
  });
});
