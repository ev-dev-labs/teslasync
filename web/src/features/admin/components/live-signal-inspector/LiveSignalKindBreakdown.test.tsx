/**
 * LiveSignalKindBreakdown contract + hardening tests.
 *
 * The panel is a presentational view over a pre-computed `LiveSignalStats`
 * plus a `SectionStatus`. It never fetches, so the tests drive it directly
 * with hand-built stats/status props rather than mocking the network.
 *
 * Recharts renders 0×0 under jsdom (no layout engine), so the real BarChart
 * never paints its SVG/bars — which would make the component's own
 * data-derivation (`useMemo`) and per-bucket colour logic invisible to the
 * DOM. We therefore swap the shared `@/components/charts` barrel for
 * lightweight doubles that surface the derived `data` prop and each `<Cell>`
 * fill as inspectable attributes. The component's derivation still runs; only
 * the pixel-pushing chart library is stubbed (the repo convention — see the
 * SmallMultiplesChart / GasPriceKpiBand tests).
 *
 * Coverage:
 *   1. Panel chrome (title + hidden icon) stays visible in every state so the
 *      panel is never a blank rectangle.
 *   2. Ready — one bar per bucket, translated labels, exact counts.
 *   3. Ready — palette colour is assigned by bucket index; series is named.
 *   4. Ready — the chart lives in an accessible region and has a tooltip.
 *   5. Ready — the palette cycles across the full seven-kind set.
 *   6. Loading — skeleton (at the requested height), no chart leaks through.
 *   7. Error — retry-able alert, `onRetry` forwarded, no chart.
 *   8. No-vehicle — the no-vehicle copy + forwarded icon, no chart.
 *   9. Empty — the empty-data copy, no chart.
 *  10. Resilience — a missing `byKind` renders an empty chart, never a crash.
 *  11. Resilience — an unknown category degrades to a readable label and a
 *      null count degrades to zero.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps, ReactNode } from 'react';

import { chartTokens } from '@/lib/tokens';
import type {
  KindBucket,
  LiveSignalStats,
  SectionStatus,
} from './liveSignalStats';

// i18n: resolve t(key, fallback) → fallback so copy is deterministic and
// locale-file independent. Applies to QueryError's copy too.
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

type Datum = { category: string; label: string; value: number };

vi.mock('@/components/charts', async () => {
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return {
    EmbeddedChart: chartTestDoubles.EmbeddedChart,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
      <div data-testid="responsive-container">{children}</div>
    ),
    BarChart: ({ data, children }: { data?: Datum[]; children?: ReactNode }) => (
      <div data-testid="bar-chart" data-bar-count={String((data ?? []).length)}>
        <ul data-testid="bar-data">
          {(data ?? []).map((d) => (
            <li
              key={d.category}
              data-testid="bar-datum"
              data-category={String(d.category)}
              data-label={String(d.label)}
              data-value={String(d.value)}
            >
              {d.label}
            </li>
          ))}
        </ul>
        {children}
    </div>
  ),
  Bar: ({ name, children }: { name?: string; children?: ReactNode }) => (
    <div data-testid="bar" data-name={String(name)}>
      {children}
    </div>
  ),
  Cell: ({ fill }: { fill?: string }) => (
    <span data-testid="cell" data-fill={String(fill)} />
  ),
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => <div data-testid="tooltip" />,
  ChartTooltip: () => null,
  };
});

import { LiveSignalKindBreakdown } from './LiveSignalKindBreakdown';

type PanelProps = ComponentProps<typeof LiveSignalKindBreakdown>;

function makeStats(overrides: Partial<LiveSignalStats> = {}): LiveSignalStats {
  return {
    total: 0,
    live: 0,
    stale: 0,
    legacy: 0,
    numeric: 0,
    bySource: { l1: 0, l2: 0, stale: 0, unknown: 0 },
    byKind: [],
    freshestAgeMs: null,
    ...overrides,
  };
}

function statsWithKinds(byKind: KindBucket[]): LiveSignalStats {
  return makeStats({
    byKind,
    total: byKind.reduce((sum, bucket) => sum + (bucket.count ?? 0), 0),
  });
}

function renderPanel(overrides: Partial<PanelProps> = {}) {
  const onRetry = overrides.onRetry ?? vi.fn();
  const props: PanelProps = {
    stats: makeStats(),
    status: 'ready',
    error: null,
    onRetry,
    ...overrides,
  };
  const utils = render(
    <MemoryRouter>
      <LiveSignalKindBreakdown {...props} />
    </MemoryRouter>,
  );
  return { ...utils, onRetry };
}

describe('LiveSignalKindBreakdown — panel chrome', () => {
  it('always shows the titled panel + hidden icon so it is never blank', () => {
    const statuses: SectionStatus[] = [
      'no-vehicle',
      'loading',
      'error',
      'empty',
      'ready',
    ];
    for (const status of statuses) {
      const { unmount } = renderPanel({ status, error: new Error('x') });
      const heading = screen.getByRole('heading', { name: /signal kinds/i });
      expect(heading).toBeInTheDocument();
      // The decorative BarChart3 icon must be hidden from the a11y tree.
      expect(heading.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      unmount();
    }
  });
});

describe('LiveSignalKindBreakdown — ready state', () => {
  it('derives one bar per kind bucket with translated labels and counts', () => {
    renderPanel({
      status: 'ready',
      stats: statsWithKinds([
        { category: 'numeric', count: 12 },
        { category: 'boolean', count: 3 },
        { category: 'text', count: 5 },
      ]),
    });

    expect(screen.getByTestId('bar-chart')).toHaveAttribute(
      'data-bar-count',
      '3',
    );
    const data = screen.getAllByTestId('bar-datum');
    expect(data).toHaveLength(3);
    expect(data[0]).toHaveAttribute('data-label', 'Numeric');
    expect(data[0]).toHaveAttribute('data-value', '12');
    expect(data[1]).toHaveAttribute('data-label', 'Boolean');
    expect(data[1]).toHaveAttribute('data-value', '3');
    expect(data[2]).toHaveAttribute('data-label', 'Text');
    expect(data[2]).toHaveAttribute('data-value', '5');
  });

  it('assigns a palette colour per bucket index and names the series', () => {
    renderPanel({
      status: 'ready',
      stats: statsWithKinds([
        { category: 'numeric', count: 1 },
        { category: 'boolean', count: 1 },
        { category: 'enum', count: 1 },
      ]),
    });

    const cells = screen.getAllByTestId('cell');
    expect(cells).toHaveLength(3);
    expect(cells[0]).toHaveAttribute('data-fill', chartTokens.series[0]);
    expect(cells[1]).toHaveAttribute('data-fill', chartTokens.series[1]);
    expect(cells[2]).toHaveAttribute('data-fill', chartTokens.series[2]);
    expect(screen.getByTestId('bar')).toHaveAttribute('data-name', 'Fields');
  });

  it('wraps the chart in an accessible region and renders a tooltip', () => {
    renderPanel({
      status: 'ready',
      stats: statsWithKinds([{ category: 'numeric', count: 2 }]),
    });

    expect(
      screen.getByRole('img', { name: /bar chart of live signal counts/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('tooltip')).toBeInTheDocument();
  });

  it('cycles the palette across the full seven-kind set', () => {
    const byKind: KindBucket[] = [
      { category: 'numeric', count: 1 },
      { category: 'boolean', count: 2 },
      { category: 'text', count: 3 },
      { category: 'enum', count: 4 },
      { category: 'time', count: 5 },
      { category: 'compound', count: 6 },
      { category: 'other', count: 7 },
    ];
    renderPanel({ status: 'ready', stats: statsWithKinds(byKind) });

    const cells = screen.getAllByTestId('cell');
    expect(cells).toHaveLength(7);
    cells.forEach((cell, index) => {
      expect(cell).toHaveAttribute(
        'data-fill',
        chartTokens.series[index % chartTokens.series.length],
      );
    });
    expect(screen.getAllByTestId('bar-datum')[5]).toHaveAttribute(
      'data-label',
      'Compound',
    );
  });
});

describe('LiveSignalKindBreakdown — section states', () => {
  it('shows a skeleton at the requested height and no chart while loading', () => {
    const { container } = renderPanel({ status: 'loading' });

    const skeleton = container.querySelector('.animate-pulse');
    expect(skeleton).not.toBeNull();
    expect(skeleton).toHaveStyle({ height: '256px' });
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });

  it('renders a retry-able error alert and forwards onRetry', () => {
    const onRetry = vi.fn();
    renderPanel({ status: 'error', error: new Error('boom'), onRetry });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the no-vehicle empty state with its icon and copy, no chart', () => {
    renderPanel({
      status: 'no-vehicle',
      noVehicleIcon: <svg data-testid="no-vehicle-icon" />,
    });

    expect(
      screen.getByText(
        'Select a vehicle to break its signals down by value kind.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId('no-vehicle-icon')).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });

  it('shows the empty-data copy when there are no signals to categorise', () => {
    renderPanel({ status: 'empty' });

    expect(
      screen.getByText('No live signals to categorise yet.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });
});

describe('LiveSignalKindBreakdown — resilience', () => {
  it('does not crash when byKind is missing (renders an empty chart)', () => {
    expect(() =>
      renderPanel({
        status: 'ready',
        stats: makeStats({ byKind: undefined as unknown as KindBucket[] }),
      }),
    ).not.toThrow();

    expect(screen.getByTestId('bar-chart')).toHaveAttribute(
      'data-bar-count',
      '0',
    );
    expect(screen.queryAllByTestId('bar-datum')).toHaveLength(0);
  });

  it('degrades an unknown category to a readable label and null count to zero', () => {
    const byKind = [
      { category: 'numeric', count: 4 },
      { category: 'mystery', count: undefined },
    ] as unknown as KindBucket[];
    renderPanel({ status: 'ready', stats: statsWithKinds(byKind) });

    const data = screen.getAllByTestId('bar-datum');
    expect(data).toHaveLength(2);
    // Known bucket keeps its translated label + count.
    expect(data[0]).toHaveAttribute('data-label', 'Numeric');
    expect(data[0]).toHaveAttribute('data-value', '4');
    // Unknown category falls back to the raw category string; null → 0.
    expect(data[1]).toHaveAttribute('data-label', 'mystery');
    expect(data[1]).toHaveAttribute('data-value', '0');
  });
});
